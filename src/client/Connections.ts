import React, { useEffect, useRef, useState } from 'react'
import type { FieldkitCanProfile, FieldkitUsbProfile, FieldkitConnection, FieldkitProfiles, FieldkitScan, FieldkitJob } from '../remote-types.js'
import { panelStyles, text, valueOf, errorText } from './shared.js'
import { finishJob } from './async.js'

const blankCan = (): FieldkitCanProfile => ({ id: '', name: '', adapter: { kind: 'canable2', serial: '' }, node: 0, mode: 'fd', expectedUid: null })
const blankUsb = (): FieldkitUsbProfile => ({ transport: 'usb', id: '', name: '', serial: '', expectedUid: null })
type UidPersistence = { targetId: string; jobId: string; state: 'running' | 'completed' | 'failed' | 'unknown'; message: string }
function requestedNodes(input: string) {
  const fields = input.split(',').map(value => value.trim())
  if (fields.some(value => !/^\d+$/.test(value))) throw new Error('扫描节点须为逗号分隔的整数，不可留空。')
  const nodes = fields.map(Number)
  if (!nodes.length || nodes.length > 16 || nodes.some(node => node > 127) || new Set(nodes).size !== nodes.length) throw new Error('扫描节点须在 0–127，最多 16 个，且不得重复。')
  return nodes
}

export function Connections({ remote, sessionId, capabilities, targets, busy, openTarget, refresh, instanceId }: any) {
  const [profiles, setProfiles] = useState<FieldkitProfiles | null>(null), [connections, setConnections] = useState<readonly FieldkitConnection[]>([])
  const [canDraft, setCanDraft] = useState<FieldkitCanProfile>(blankCan), [usbDraft, setUsbDraft] = useState<FieldkitUsbProfile>(blankUsb)
  const [canFormOpen, setCanFormOpen] = useState(false), [usbFormOpen, setUsbFormOpen] = useState(false)
  const [adapters, setAdapters] = useState<any[]>([]), [selectedNodes, setSelectedNodes] = useState<number[]>([])
  const [scan, setScan] = useState<FieldkitScan | null>(null), [nodes, setNodes] = useState('1,2,3,4'), [batch, setBatch] = useState<FieldkitJob['batch'] | null>(null)
  const [advanced, setAdvanced] = useState({ channel: '', mode: 'fd' as 'classic' | 'fd', python: '' }), [advancedNode, setAdvancedNode] = useState('1')
  const [working, setWorking] = useState(false), [notice, setNotice] = useState('刷新连接以获取服务端缓存。')
  const [persistence, setPersistence] = useState<UidPersistence | null>(null)
  const alive = useRef(false), flight = useRef(false), reloadLatest = useRef<(() => Promise<void>) | null>(null), styles = panelStyles(busy || working)
  const key = JSON.stringify([sessionId, instanceId]), context = useRef({ key, generation: 0 })
  if (context.current.key !== key) context.current = { key, generation: context.current.generation + 1 }
  const generation = context.current.generation, active = () => alive.current && context.current.generation === generation
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const supports = (cap: string) => capabilities?.includes(cap)
  const reload = async () => {
    const c = valueOf(await remote.listConnections(sessionId)); if (!active()) return; setConnections(c.connections)
    if (supports('managed_profiles') || supports('usb_profiles')) { const p = valueOf(await remote.listProfiles(sessionId)); if (active()) setProfiles(p) }
  }
  const act = async (label: string, fn: () => Promise<void | string>) => {
    if (flight.current || busy) return
    flight.current = true; setWorking(true); setNotice(label)
    try { const completed = await fn(); if (active()) setNotice(completed ?? '操作完成；连接状态来自服务端刷新结果。') }
    catch (e) { if (active()) setNotice(errorText(e)) }
    finally {
      flight.current = false
      if (alive.current) { setWorking(false); if (!active()) void reloadLatest.current?.() }
    }
  }
  reloadLatest.current = () => act('正在读取连接缓存…', reload)
  useEffect(() => {
    setScan(null); setSelectedNodes([]); setBatch(null); setProfiles(null); setConnections([]); setPersistence(null)
    if (sessionId && supports('connections')) void act('正在读取连接缓存…', reload)
  }, [sessionId, instanceId])
  const changed = async () => { if (!active()) return; await reload(); if (active()) await refresh() }
  const followUidJob = async (targetId: string, jobId: string) => {
    if (!active()) return
    setPersistence({ targetId, jobId, state: 'running', message: 'UID 绑定持久化正在进行。' })
    try {
      let job: FieldkitJob = valueOf(await remote.getJob(sessionId, jobId))
      while (active() && (job.state === 'queued' || job.state === 'running')) {
        await new Promise(resolve => setTimeout(resolve, 400)); if (!active()) return
        job = valueOf(await remote.getJob(sessionId, jobId))
      }
      if (!active()) return
      const state = job.state === 'failed' ? 'failed' : 'completed'
      const message = state === 'failed' ? `UID 绑定持久化失败：${job.error ?? '服务任务失败'}` : 'UID 绑定持久化任务已完成。'
      setPersistence({ targetId, jobId, state, message })
      return message
    } catch (error) {
      if (!active()) return
      const message = `UID 绑定持久化结果未知：${errorText(error)}；可查询原任务，不重新连接。`
      setPersistence({ targetId, jobId, state: 'unknown', message })
      return message
    }
  }
  const connected = async (result: FieldkitConnection | FieldkitJob) => {
    let connection: FieldkitConnection
    if ('jobId' in result) {
      const job = await finishJob(remote, sessionId, { ok: true, value: result }, active)
      if (!active()) return
      if (!job.connection) throw new Error('连接任务未提供完成后的连接事实；请读取缓存，不自动重试。')
      connection = job.connection
    } else connection = result
    if (!active()) return
    setConnections(current => [...current.filter(c => c.connectionId !== connection.connectionId), connection])
    const uidOutcome = connection.profileJobId ? await followUidJob(connection.targetId, connection.profileJobId) : null
    if (!active()) return
    let cacheOutcome = '连接状态来自服务端刷新结果。'
    try { await changed() } catch (error) { cacheOutcome = `缓存刷新失败：${errorText(error)}` }
    return `${connection.targetId}：服务已报告${connection.connected ? '连接建立' : '连接断开'}；${uidOutcome ? `${uidOutcome}；` : ''}${cacheOutcome}`
  }
  const readScan = async (initial: Promise<any>) => {
    let result: FieldkitScan = valueOf(await initial)
    if (active()) { setScan(result); setSelectedNodes([]); setBatch(null) }
    while (active() && result.state === 'running') {
      await new Promise(resolve => setTimeout(resolve, 500)); if (!active()) return
      result = valueOf(await remote.getScan(sessionId, result.scanId)); if (active()) setScan(result)
    }
    await changed()
    return `扫描完成：${result.nodes.length} 个节点返回 Identity，${result.errors.length} 个节点失败；没有自动连接。`
  }
  const advancedInput = () => {
    if (!advanced.channel.trim()) throw new Error('请填写已有 python-can 配置 context。')
    return { channel: advanced.channel, mode: advanced.mode, python: advanced.python || null }
  }
  const button = (label: string, fn: () => Promise<void | string>, disabled = false) => React.createElement('button', { style: styles.button, disabled: busy || working || disabled, onClick: () => act(`正在${label}…`, fn) }, label)
  const input = (label: string, value: string | number, update: (value: string) => void, type = 'text') => React.createElement('label', null, label, React.createElement('input', { type, value, onChange: (e: any) => update(e.target.value), disabled: busy || working, style: { display: 'block', width: '100%', boxSizing: 'border-box' } }))
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10 }
  return React.createElement('section', { style: styles.card },
    React.createElement('h2', null, '连接与目标'), React.createElement('p', { role: 'status', 'aria-live': 'polite' }, notice),
    persistence && React.createElement('div', null, React.createElement('p', { role: persistence.state === 'failed' || persistence.state === 'unknown' ? 'alert' : undefined }, `${persistence.targetId} · UID 任务 ${persistence.jobId} · ${persistence.message}`),
      persistence.state !== 'completed' && button('查询 UID 持久任务', async () => followUidJob(persistence.targetId, persistence.jobId))),
    targets.map((target: any) => {
      const cached = connections.find(value => value.targetId === target.targetId)
      const stale = !!cached && (cached.connected !== target.connected || cached.connectionGeneration !== target.connectionGeneration || cached.identity?.uid !== target.identity?.uid || cached.identity?.runNonce !== target.identity?.runNonce)
      const reconnectRequired = !!cached && !cached.connected
      return React.createElement('div', { key: target.targetId, style: styles.row },
        React.createElement('strong', null, target.label),
        React.createElement('span', null, stale ? `${target.transport} · 连接缓存：${cached!.connected ? '已连接' : '已断开'}（代次 ${cached!.connectionGeneration}）；目标列表待刷新` : `${target.transport} · ${target.connected ? '已连接' : '未连接'}`),
        React.createElement('button', { style: styles.button, disabled: busy || working || stale || reconnectRequired || (!target.canAttach && !target.canConnect), onClick: () => { if (!stale && !reconnectRequired) return openTarget(target) } }, stale ? '先刷新目标列表' : reconnectRequired ? '请使用下方重新连接' : target.connected ? '选择并观察' : '连接并观察'),
        target.transport === 'usb' && target.targetId.startsWith('usb:') && supports('usb_profiles') && React.createElement('button', { style: styles.button, disabled: busy || working, onClick: () => { setUsbDraft({ ...blankUsb(), serial: target.targetId.slice('usb:'.length), expectedUid: target.identity?.uid ?? null }); setUsbFormOpen(true) } }, '填写 USB 档案'))
    }),
    !supports('connections') ? React.createElement('p', null, '当前服务未发布 P2 connections 能力；USB 观察仍可用。') : React.createElement(React.Fragment, null,
      button('刷新连接与档案', changed),
      connections.map(c => React.createElement('div', { key: c.connectionId, style: { ...styles.card, marginTop: 8 } },
        React.createElement('strong', null, c.targetId), React.createElement('p', null, `${c.connected ? '已连接' : '已断开'} · UID ${c.identity?.uid ?? '未取得（仅可显式重连）'} · 代次 ${c.connectionGeneration} · 遥测年龄 ms ${text(c.telemetryReceivedAgeMs)}`),
        button(c.connected ? '断开此连接' : '重新连接', async () => { const result = valueOf(await remote.changeConnection(sessionId, { connectionId: c.connectionId, identity: c.identity, connectionGeneration: c.connectionGeneration, action: c.connected ? 'disconnect' : 'reconnect' })); return connected(result) }),
        c.connected && c.targetId.startsWith('can:') && React.createElement('div', { style: styles.row }, input('扫描节点（逗号分隔，最多 16）', nodes, setNodes), button('扫描节点', async () => {
          if (!c.identity) throw new Error('此 CAN 会话尚无 Identity，不能开始扫描。')
          return readScan(remote.startScan(sessionId, { connectionId: c.connectionId, identity: c.identity, connectionGeneration: c.connectionGeneration, nodes: requestedNodes(nodes) }))
        }, !supports('can_scan'))))),
      React.createElement('h3', null, '已保存连接档案'),
      profiles?.loadError && React.createElement('p', { role: 'alert' }, profiles.loadError),
      input('档案扫描节点（逗号分隔，最多 16）', nodes, setNodes),
      profiles?.profiles.map(p => React.createElement('div', { key: p.id, style: styles.row }, React.createElement('span', null, p.transport === 'usb' ? `${p.name} · USB ${p.serial}` : `${p.name} · ${p.adapter.serial} · 节点 ${p.node}`), button('编辑', async () => { if (p.transport === 'usb') { setUsbDraft(p); setUsbFormOpen(true) } else { setCanDraft(p); setCanFormOpen(true) } }), button('连接档案', async () => connected(valueOf(await remote.connectProfile(sessionId, p.id)))), button('删除档案', async () => { await finishJob(remote, sessionId, remote.deleteProfile(sessionId, p.id), active); if (active()) await reload() }),
        p.transport !== 'usb' && button('按档案扫描节点', async () => readScan(remote.scanProfile(sessionId, { profileId: p.id, nodes: requestedNodes(nodes) })), !supports('can_scan')))),
      !supports('usb_profiles') ? React.createElement('p', null, '当前服务尚未提供 USB 持久档案。') : React.createElement('details', { open: usbFormOpen, onToggle: (event: any) => setUsbFormOpen(event.currentTarget.open) }, React.createElement('summary', null, '新建 / 编辑 USB 档案'),
        React.createElement('div', { style: grid }, input('USB 档案 ID', usbDraft.id, v => setUsbDraft({ ...usbDraft, id: v })), input('USB 档案名称', usbDraft.name, v => setUsbDraft({ ...usbDraft, name: v })), input('USB 完整稳定序列号', usbDraft.serial, v => setUsbDraft({ ...usbDraft, serial: v })), input('USB 绑定 UID（可留空）', usbDraft.expectedUid ?? '', v => setUsbDraft({ ...usbDraft, expectedUid: v || null }))),
        React.createElement('p', null, '从上方候选填写完整序列号；保存不连接设备。已绑定的 UID 不会因留空而清除。'),
        button('清空 USB 表单', async () => { setUsbDraft(blankUsb()); return 'USB 档案表单已清空；尚未创建或更新档案。' }), button('创建 / 更新 USB 档案', async () => { await finishJob(remote, sessionId, remote.saveProfile(sessionId, usbDraft), active); if (active()) await reload() })),
      supports('managed_profiles') && React.createElement('details', { open: canFormOpen, onToggle: (event: any) => setCanFormOpen(event.currentTarget.open) }, React.createElement('summary', null, '新建 / 编辑 CAN 档案'),
        button('发现适配器', async () => { const result = await finishJob(remote, sessionId, remote.listAdapters(sessionId), active); if (active()) setAdapters([...(result.adapters ?? [])]) }, !supports('adapter_discovery')),
        adapters.map(a => React.createElement('button', { key: `${a.kind}:${a.serial}`, disabled: busy || working, onClick: () => setCanDraft({ ...canDraft, adapter: { kind: 'canable2', serial: a.serial } }) }, `${a.description} · ${a.serial}`)),
        React.createElement('div', { style: grid }, input('档案 ID', canDraft.id, v => setCanDraft({ ...canDraft, id: v })), input('名称', canDraft.name, v => setCanDraft({ ...canDraft, name: v })), input('CANable 稳定序列号', canDraft.adapter.serial, v => setCanDraft({ ...canDraft, adapter: { kind: 'canable2', serial: v } })), input('节点 0–127', canDraft.node, v => setCanDraft({ ...canDraft, node: Number(v) }), 'number'), input('绑定 UID（可留空）', canDraft.expectedUid ?? '', v => setCanDraft({ ...canDraft, expectedUid: v || null }))),
        button('清空 CAN 表单', async () => { setCanDraft(blankCan()); return 'CAN 档案表单已清空；尚未创建或更新档案。' }), button('创建 / 更新 CAN 档案', async () => { await finishJob(remote, sessionId, remote.saveProfile(sessionId, canDraft), active); if (active()) await reload() })),
      !supports('advanced_can') ? React.createElement('p', null, '当前服务尚未提供高级 CAN；已有配置 context、classic 与 Python 覆盖待服务支持。') : React.createElement('details', null, React.createElement('summary', null, '高级 CAN：已有配置与多节点'),
        React.createElement('p', null, '使用已有 python-can 命名配置，明确选择 classic 或 FD；扫描可从未连接网络开始，只读取 Identity。'),
        React.createElement('p', null, '请核对 DSH Host 上的 Python 解释器绝对路径、python-can 依赖，以及已有命名 context 的接口和通道配置。原始失败原因保留在上方；只有已确认是路径、依赖或 context 配置错误，才在修正后人工点击连接或扫描。超时或结果未知时，先查询原任务与连接状态，不重复提交；不会自动重试。'),
        React.createElement('div', { style: grid }, input('python-can 配置 context', advanced.channel, v => setAdvanced({ ...advanced, channel: v })),
          React.createElement('label', null, '高级 CAN 帧格式', React.createElement('select', { value: advanced.mode, disabled: busy || working, onChange: (e: any) => setAdvanced({ ...advanced, mode: e.target.value }) }, React.createElement('option', { value: 'classic' }, 'classic'), React.createElement('option', { value: 'fd' }, 'FD'))),
          input('Python 解释器覆盖（可留空）', advanced.python, v => setAdvanced({ ...advanced, python: v })), input('高级 CAN 单节点 0–127', advancedNode, setAdvancedNode, 'number'), input('高级扫描节点（逗号分隔，最多 16）', nodes, setNodes)),
        button('连接高级 CAN 单节点', async () => { const selection = requestedNodes(advancedNode); if (selection.length !== 1) throw new Error('请明确选择单个节点。'); return connected(valueOf(await remote.connectAdvanced(sessionId, { ...advancedInput(), node: selection[0] }))) }),
        button('扫描高级 CAN 节点', async () => readScan(remote.scanAdvanced(sessionId, { advanced: advancedInput(), nodes: requestedNodes(nodes) })), !supports('can_scan'))),
      scan && React.createElement('div', null, React.createElement('h3', null, `扫描 ${scan.state}`),
        scan.nodes.map(n => React.createElement('label', { key: n.node, style: { display: 'block' } }, React.createElement('input', { type: 'checkbox', disabled: busy || working || scan.state !== 'completed', checked: selectedNodes.includes(n.node), onChange: (e: any) => setSelectedNodes(e.target.checked ? [...selectedNodes, n.node] : selectedNodes.filter(node => node !== n.node)) }), `节点 ${n.node} · UID ${n.identity.uid}`)),
        React.createElement('p', null, `已选择节点：${selectedNodes.join(', ') || '无'}。扫描不会自动连接；批量连接只核对身份，不建立控制群组。`),
        !supports('selected_node_connections') ? React.createElement('p', null, '当前服务尚未提供扫描所选节点批量连接。') : button('连接所选扫描节点', async () => {
          const selected = scan.nodes.filter(n => selectedNodes.includes(n.node)).map(n => n.node)
          if (!selected.length || scan.state !== 'completed') throw new Error('请先完成扫描并选择成功返回 Identity 的节点。')
          setBatch(null)
          const result = await finishJob(remote, sessionId, remote.connectScannedNodes(sessionId, { scanId: scan.scanId, nodes: selected }), active)
          if (!active()) return
          if (!result.batch) throw new Error('批量连接任务未提供逐节点结果；连接效果未知，请读取缓存。')
          setBatch(result.batch); await changed()
          return `批量连接结果：${result.batch.connections.length} 个成功，${result.batch.errors.length} 个失败。失败节点未自动重试。`
        }, scan.state !== 'completed' || !selectedNodes.length),
        scan.errors.map(e => React.createElement('details', { key: e.node }, React.createElement('summary', null, `节点 ${e.node}：${e.message}${e.unknown ? '（结果未知）' : ''}`), React.createElement('pre', { style: styles.mono }, e.errorJsonText)))),
      batch && React.createElement('div', null, React.createElement('h3', null, '所选节点连接结果'), batch.connections.map(c => React.createElement('p', { key: c.connectionId }, `${c.targetId} · ${c.connected ? '已连接' : '已断开'} · UID ${c.identity?.uid ?? '未取得'}`)), batch.errors.map(e => React.createElement('details', { key: e.node }, React.createElement('summary', null, `节点 ${e.node} · ${e.code}：${e.message}${e.unknown ? '（结果未知）' : ''}`), React.createElement('pre', { style: styles.mono }, e.errorJsonText)))),
      React.createElement('p', null, '受管 CAN 档案使用 FD。连接和重连不会启心跳或恢复目标；断开连接与显式 Stop 分别操作。')))
}
