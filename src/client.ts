import { takeOpenedBinding } from './observation.js'
import React, { useEffect, useRef, useState } from 'react'
import type { FieldkitServiceSettings, FieldkitServiceStatus } from './remote-types.js'
import { TYPERT_REMOTE } from '../lib/typert.remote-client.js'

export const name = '@ehapower/dsh-fieldkit'
export const inject = ['remote', 'slots', 'layout', 'sessions']

const PANEL_ID = 'fieldkit'
const SESSION_STORAGE_KEY = 'ehapower.dsh-fieldkit.session.v1'
const INTEGRATION_STEPS = ['connection_identity', 'status', 'measurements', 'diagnostics', 'config_startup', 'config_user']
const LEGACY_STEPS = ['inspect', 'status', 'measurements', 'diagnostics', 'config_startup', 'config_user']
const STEP_LABELS: Record<string, string> = { connection_identity: '连接与身份', inspect: 'inspect', status: 'status', measurements: 'measurements', diagnostics: 'diagnostics', config_startup: 'config-read --view startup', config_user: 'config-read --view user' }
const PANEL_CSS = `
[data-fieldkit-panel] { display:grid; grid-template-columns:minmax(0,1fr) minmax(320px,38%); gap:16px; height:100%; min-height:0; overflow:hidden; padding:16px; box-sizing:border-box; color:var(--dsh-fg,inherit); }
[data-fieldkit-panel] .fieldkit-workbench { display:grid; align-content:start; gap:12px; min-width:0; min-height:0; overflow:auto; }
[data-fieldkit-panel] .fieldkit-chat { display:flex; flex-direction:column; min-width:0; min-height:0; overflow:auto; }
[data-fieldkit-panel] .fieldkit-chat-body { flex:1; min-height:0; overflow:auto; }
@media (max-width:900px) { [data-fieldkit-panel] { grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(280px,1fr) minmax(340px,1fr); overflow:auto; } }
`

function FixedChatView(props: any) {
  return props.renderSlot('conversation.session', { view: 'chat' })
}

function EmbeddedChat(props: any) {
  return props.renderFactorySlot('conversation.content', {
    variant: 'embedded', phase: 'active', hero: false,
  }, { slots: { views: FixedChatView } })
}

function text(value: unknown) {
  return value === null || value === undefined || value === '' ? '—' : String(value)
}

function errorText(error: any) {
  const code = error?.code ?? error?.kind ?? error?.error?.code
  const message = error?.message ?? error?.error?.message ?? String(error)
  return code ? `${code}：${message}` : message
}

function valueOf(result: any) {
  if (result?.ok === true) return result.value
  const error = new Error(result?.error?.message ?? 'Remote request failed') as Error & { code?: string }
  error.code = result?.error?.code
  throw error
}

function isRunSettled(run: any) { return run?.phase === 'finished' || run?.phase === 'report_failed' }
function evidenceStep(item: any, index: number, evidence: readonly any[], legacy: boolean) {
  if (!legacy || item.action !== 'config-read') return item.action
  return evidence.slice(0, index).filter(entry => entry.action === 'config-read').length === 0 ? 'config_startup' : 'config_user'
}
function currentStep(run: any, legacy: boolean) {
  if (!run || !legacy || run.step !== 'config-read') return run?.step
  return (run.evidence ?? []).filter((item: any) => item.action === 'config-read').length <= 1 ? 'config_startup' : 'config_user'
}

function FieldkitPanel(props: any) {
  const { remote, sessions, ensureSession, SessionProvider, renderSlot } = props
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [reference, setReference] = useState<any>(null)
  const [serviceStatus, setServiceStatus] = useState<FieldkitServiceStatus | null>(null)
  const [serviceSettings, setServiceSettings] = useState<FieldkitServiceSettings | null>(null)
  const [shutdownConfirmed, setShutdownConfirmed] = useState(false)
  const [describe, setDescribe] = useState<any>(null)
  const [targets, setTargets] = useState<any[]>([])
  const [discovery, setDiscovery] = useState<{ limited: boolean; reason: string | null }>({ limited: false, reason: null })
  const [binding, setBinding] = useState<any>(null)
  const [snapshot, setSnapshot] = useState<any>(null)
  const [readRun, setReadRun] = useState<any>(null)
  const [configText, setConfigText] = useState('')
  const [configResult, setConfigResult] = useState<any>(null)
  const [notice, setNotice] = useState('正在创建 Fieldkit 专用对话…')
  const [busy, setBusy] = useState(false)
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')
  const [viewEpoch, setViewEpoch] = useState(0)
  const mounted = useRef(false)
  const busyRef = useRef(false)
  const epoch = useRef(0)
  const runEpoch = useRef(0)
  const bindingRef = useRef<any>(null)

  const invalidate = () => { epoch.current++; runEpoch.current++; setViewEpoch(epoch.current); return epoch.current }
  const selectBinding = (next: any) => { bindingRef.current = next; setBinding(next) }
  const begin = () => { if (busyRef.current) return false; busyRef.current = true; setBusy(true); return true }
  const end = () => { busyRef.current = false; if (mounted.current) setBusy(false) }
  const current = (ticket: number, id?: string) => mounted.current && epoch.current === ticket && (id === undefined || bindingRef.current?.bindingId === id)

  useEffect(() => {
    mounted.current = true
    let released = false
    let retained: any
    let retainedSessionId: string | null = null
    void ensureSession(sessions).then((id: string) => {
      if (released) return
      retainedSessionId = id
      retained = sessions.retain(id, { source: 'fieldkit' })
      setSessionId(id)
      setReference(retained)
      setNotice('就绪。按钮操作不需要模型。')
    }).catch((error: unknown) => { if (!released) setNotice(`无法创建内嵌对话：${errorText(error)}`) })
    return () => { released = true; mounted.current = false; epoch.current++; runEpoch.current++; retained?.release(); const selected = bindingRef.current; if (retainedSessionId && selected) void remote.detachTarget(retainedSessionId, { bindingId: selected.bindingId }).catch(() => {}) }
  }, [sessions, ensureSession])

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const refresh = async () => {
    if (!sessionId || !begin()) return
    const ticket = invalidate()
    try {
      const nextDescribe = valueOf(await remote.describe())
      if (!current(ticket)) return
      setDescribe(nextDescribe)
      if (nextDescribe.mode === 'service-v2') { const status = valueOf(await remote.serviceStatus()); if (!current(ticket)) return; setServiceStatus(status); setServiceSettings(status.settings) }
      if (!nextDescribe.available) {
        setTargets([]); setDiscovery({ limited: false, reason: null })
        setSnapshot(null); setReadRun(null)
        if (bindingRef.current) selectBinding({ ...bindingRef.current, expired: true })
        setNotice(`集成不可用：${text(nextDescribe.reason)}`)
        return
      }
      const nextTargets = valueOf(await remote.listTargets(sessionId))
      if (!current(ticket)) return
      setTargets(nextTargets.targets ?? [])
      setDiscovery({ limited: nextTargets.discoveryLimited === true, reason: nextTargets.discoveryReason ?? null })
      const selected = nextTargets.selectedBinding ?? null
      const oldId = bindingRef.current?.bindingId
      selectBinding(selected)
      if (!selected || selected.expired || selected.bindingId !== oldId) { setSnapshot(null); setReadRun(null) }
      let snapshotWarning: string | null = null
      if (selected && !selected.expired) {
        try {
          const nextSnapshot = valueOf(await remote.getSnapshot(sessionId, { bindingId: selected.bindingId }))
          if (current(ticket, selected.bindingId)) { setSnapshot(nextSnapshot); setReadRun(nextSnapshot.readRun ?? null) }
        } catch (error) { if (current(ticket, selected.bindingId)) { setSnapshot(null); snapshotWarning = `目标已选，但缓存状态不可读：${errorText(error)}` } }
      }
      if (current(ticket)) setNotice(snapshotWarning ?? (selected?.expired ? '绑定已过期，请明确重新选择目标。' : '目标列表已刷新。'))
    } catch (error) {
      if (current(ticket)) { setSnapshot(null); setReadRun(null); if (bindingRef.current) selectBinding({ ...bindingRef.current, expired: true }); setNotice(`刷新失败：${errorText(error)}`) }
    } finally { end() }
  }

  useEffect(() => { void refresh() }, [sessionId])

  useEffect(() => {
    if (!visible || !sessionId || !binding || !readRun || isRunSettled(readRun)) return
    const ticket = epoch.current
    const runTicket = runEpoch.current
    const bindingId = binding.bindingId
    const expectedRunId = readRun.readRunId
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      if (!active || !current(ticket, bindingId) || runEpoch.current !== runTicket) return
      try {
        const next = valueOf(await remote.getReadRun(sessionId, expectedRunId ? { readRunId: expectedRunId } : {}))
        if (!active || !current(ticket, bindingId) || runEpoch.current !== runTicket) return
        if (next?.bindingId === bindingId && (expectedRunId ? next.readRunId === expectedRunId : next.status === 'running')) {
          setReadRun(next)
          if (isRunSettled(next)) return
        }
      } catch (error) {
        if (active && current(ticket, bindingId) && runEpoch.current === runTicket) setNotice(`诊断状态读取失败：${errorText(error)}`)
      }
      if (active && current(ticket, bindingId) && runEpoch.current === runTicket) timer = setTimeout(() => { void poll() }, 1000)
    }
    timer = setTimeout(() => { void poll() }, 250)
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [visible, sessionId, binding?.bindingId, readRun?.readRunId, readRun?.status, readRun?.phase, remote, viewEpoch])

  const manageService = async (action: 'save' | 'attach' | 'start' | 'shutdown') => {
    if (!serviceSettings || !begin()) return
    const ticket = invalidate()
    setNotice(({ save: '正在保存服务设置…', start: '正在检查工具版本、启动服务并核对认证实例…', attach: '正在发现服务并核对认证实例…', shutdown: '正在请求仅退出服务；不会请求设备 Stop…' })[action])
    try {
      const result = action === 'save' ? await remote.saveServiceSettings(serviceSettings)
        : action === 'start' ? await remote.startService()
        : action === 'attach' ? await remote.attachService()
        : await remote.shutdownService({ instanceId: serviceStatus?.instance?.instance_id ?? '', confirmation: shutdownConfirmed ? 'shutdown_service_without_stopping_devices' : '' })
      if (!current(ticket)) return
      const status = valueOf(result)
      setServiceStatus(status); setServiceSettings(status.settings); setShutdownConfirmed(false)
      if (status.error) { setNotice(`服务操作未完成：${errorText(status.error)}`); return }
      setTargets([]); setSnapshot(null); setReadRun(null)
      if (bindingRef.current) selectBinding({ ...bindingRef.current, expired: true })
      setNotice(action === 'shutdown' ? '服务已受理退出；没有请求设备 Stop，不能据此认定设备停止。' : action === 'save' ? '设置已保存。请发现或启动服务，再刷新目标。' : '服务已认证附着。请刷新目标并明确选择设备。')
    } catch (error) {
      if (current(ticket)) { setNotice(`服务操作失败：${errorText(error)}`); if (bindingRef.current) selectBinding({ ...bindingRef.current, expired: true }); setSnapshot(null) }
    } finally { end() }
  }

  const openTarget = async (target: any) => {
    if (!sessionId || !begin()) return
    const ticket = invalidate()
    try {
      const request = target.connected
        ? { targetId: target.targetId, intent: 'attach', expectedIdentity: target.identity, connectionGeneration: target.connectionGeneration }
        : { targetId: target.targetId, intent: 'connect' }
      const next = await takeOpenedBinding(remote.openTarget(sessionId, request).then(valueOf), () => current(ticket), (late: any) => remote.detachTarget(sessionId, { bindingId: late.bindingId }).then(valueOf))
      if (!next) return
      selectBinding(next)
      setSnapshot(null)
      setReadRun(null)
      setNotice(`已选择 ${target.label}；连接代次 ${text(next.connectionGeneration)}。`)
    } catch (error) { if (current(ticket)) setNotice(`无法选择目标：${errorText(error)}`) } finally { end() }
  }

  const detach = async () => {
    const selected = bindingRef.current
    if (!sessionId || !selected || !begin()) return
    const ticket = invalidate()
    try {
      const result = valueOf(await remote.detachTarget(sessionId, { bindingId: selected.bindingId }))
      if (!current(ticket, selected.bindingId)) return
      selectBinding(null); setSnapshot(null); setReadRun(null)
      const warnings = result?.observationWarnings ?? []
      setNotice(warnings.length ? `已解除观察；owner 引用释放警告：${warnings.map(errorText).join('；')}` : '已取消选择并解除观察；没有执行设备写入或运动。')
    } catch (error) { if (current(ticket, selected.bindingId)) setNotice(`解除观察失败：${errorText(error)}`) } finally { end() }
  }

  const readSnapshot = async () => {
    const selected = bindingRef.current
    if (!sessionId || !selected || selected.expired || !begin()) return
    const ticket = epoch.current
    try {
      const next = valueOf(await remote.getSnapshot(sessionId, { bindingId: selected.bindingId }))
      if (!current(ticket, selected.bindingId)) return
      setSnapshot(next)
      if (next.expired) selectBinding({ ...selected, expired: true })
      if (next.readRun && (!readRun || next.readRun.readRunId === readRun.readRunId)) setReadRun(next.readRun)
      setNotice('已读取缓存状态。')
    } catch (error) { if (current(ticket, selected.bindingId)) { setSnapshot(null); setNotice(`状态读取失败：${errorText(error)}`) } } finally { end() }
  }

  const diagnose = async () => {
    const selected = bindingRef.current
    if (!sessionId || !selected || selected.expired || !begin()) return
    const ticket = epoch.current
    const runTicket = ++runEpoch.current
    const legacy = describe?.mode === 'legacy-cli'
    setReadRun({ readRunId: null, bindingId: selected.bindingId, status: 'running', phase: 'reading', step: legacy ? 'inspect' : 'connection_identity', evidence: [], reports: null, error: null })
    setNotice(legacy ? '正在执行六次离散 CLI 只读采集；并非同一时刻快照。' : '正在执行六步 owner 门禁只读诊断；页面会显示部分证据。')
    try {
      const next = valueOf(await remote.diagnose(sessionId, { bindingId: selected.bindingId }))
      if (current(ticket, selected.bindingId) && runEpoch.current === runTicket && next.bindingId === selected.bindingId) {
        setReadRun(next)
        if (!next.complete) {
          setSnapshot(null)
          if (['instance_mismatch', 'binding_stale', 'identity_changed', 'not_found'].includes(next.error?.code)) selectBinding({ ...selected, expired: true })
        }
        setNotice(next.reportError ? `${next.complete ? '采集完成' : '采集未完成'}，但报告保存失败：${errorText(next.reportError)}；当前页面仍可查看已取得证据。` : next.complete ? '只读诊断采集完成；完整性不代表设备安全。' : `诊断未完成：${next.error ? errorText(next.error) : '请查看部分证据和报告。'}`)
      }
    } catch (error) {
      if (current(ticket, selected.bindingId) && runEpoch.current === runTicket) { setReadRun(null); setSnapshot(null); setNotice(`诊断请求失败：${errorText(error)}`) }
    } finally { end() }
  }

  const checkConfiguration = async () => {
    if (!begin()) return
    const ticket = epoch.current
    try { const result = valueOf(await remote.checkConfiguration(configText)); if (current(ticket)) { setConfigResult(result); setNotice(result.summary) } }
    catch (error) { if (current(ticket)) setNotice(`配置检查失败：${errorText(error)}`) } finally { end() }
  }

  const legacy = describe?.mode === 'legacy-cli'
  const steps = legacy ? LEGACY_STEPS : INTEGRATION_STEPS
  const identity = binding?.identity ?? snapshot?.identity
  const canAct = binding !== null && !binding?.expired && !busy
  const runActive = !!readRun && !isRunSettled(readRun)
  const canDiagnose = canAct && !runActive && (legacy || snapshot?.readiness?.ready === true)
  const evidence = readRun?.evidence ?? []
  const evidenceSteps = evidence.map((item: any, index: number) => evidenceStep(item, index, evidence, legacy))
  const warnings = binding?.observationWarnings ?? snapshot?.observationWarnings ?? []
  const styles = {
    card: { border: '1px solid var(--dsh-border, #3d4653)', borderRadius: 10, padding: 14, background: 'var(--dsh-bg-elevated, rgba(127,127,127,.08))' },
    row: { display: 'flex', flexWrap: 'wrap' as const, gap: 8, alignItems: 'center' },
    button: { padding: '7px 10px', borderRadius: 7, border: '1px solid var(--dsh-border, #667)', background: 'transparent', color: 'inherit', cursor: busy ? 'wait' : 'pointer' },
    mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'pre-wrap' as const, overflowWrap: 'anywhere' as const, maxHeight: 170, overflow: 'auto' as const },
  }

  return React.createElement('main', { 'data-fieldkit-panel': '' },
    React.createElement('style', null, PANEL_CSS),
    React.createElement('section', { className: 'fieldkit-workbench' },
      React.createElement('div', { style: styles.card },
        React.createElement('h1', null, 'EHA Fieldkit'),
        React.createElement('p', { role: 'status' }, notice),
        React.createElement('div', { style: styles.row },
          React.createElement('button', { style: styles.button, disabled: busy || !sessionId, onClick: refresh }, '刷新目标'),
          React.createElement('button', { style: styles.button, disabled: !canAct, onClick: readSnapshot }, '读取缓存状态'),
          React.createElement('button', { style: styles.button, disabled: !canDiagnose, onClick: diagnose }, legacy ? '六次离散 CLI 诊断' : '六步只读诊断'),
          React.createElement('button', { style: styles.button, disabled: !binding || busy, onClick: detach }, '取消选择 / 解除观察'),
        ),
        describe && React.createElement('p', null, `模式：${describe.mode}　协议：${text(describe.protocol)}　只读：是`),
        legacy && React.createElement('p', null, 'Legacy CLI 是六次离散命令采集，不是持续 owner 会话或同一时刻快照；不会自动回退。'),
        discovery.limited && React.createElement('p', { role: 'alert' }, `目标发现不完整：${text(discovery.reason)}`),
      ),
      describe?.mode === 'service-v2' && React.createElement('section', { style: styles.card, 'aria-label': '服务设置' },
        React.createElement('h2', null, '服务设置'),
        React.createElement('p', null, '关闭页面或卸载插件只解除观察，服务保持独立运行。重新附着不会恢复设备连接、心跳或目标。'),
        serviceSettings && (['toolPath', 'dataDir', 'port', 'runsDir', 'odrivePython'] as const).map(key => React.createElement('label', { key, style: { display: 'block', marginBottom: 8 } },
          ({ toolPath: 'eha-tool 绝对路径', dataDir: '私有数据目录（0700）', port: '服务端口', runsDir: '记录目录（可选）', odrivePython: 'ODrive Python 绝对路径（可选）' })[key],
          React.createElement('input', { value: serviceSettings[key], type: key === 'port' ? 'number' : 'text', min: key === 'port' ? 1 : undefined, max: key === 'port' ? 65535 : undefined, disabled: busy, style: { display: 'block', width: '100%', boxSizing: 'border-box' }, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setServiceSettings({ ...serviceSettings, [key]: key === 'port' ? Number(event.target.value) : event.target.value }) }))),
        React.createElement('div', { style: styles.row },
          React.createElement('button', { style: styles.button, disabled: busy || !serviceSettings, onClick: () => manageService('save') }, '保存设置'),
          React.createElement('button', { style: styles.button, disabled: busy || !serviceSettings, onClick: () => manageService('attach') }, '发现 / 附着服务'),
          React.createElement('button', { style: styles.button, disabled: busy || !serviceSettings, onClick: () => manageService('start') }, '启动服务')),
        serviceStatus?.error && React.createElement('p', { role: 'alert' }, errorText(serviceStatus.error)),
        serviceStatus?.instance && React.createElement(React.Fragment, null,
          React.createElement('p', null, `服务：${serviceStatus.instance.service_state}　版本：${serviceStatus.instance.tool_version}　实例：${serviceStatus.instance.instance_id}　PID：${serviceStatus.instance.pid}`),
          React.createElement('p', null, `设备效果：${serviceStatus.instance.control_effect.state}（${text(serviceStatus.instance.control_effect.reason_code)}）；活动试验：${serviceStatus.instance.activity.trial_active ? '是' : '否'}；未决试验：${serviceStatus.instance.activity.trial_unresolved ? '是' : '否'}`),
          serviceStatus.instance.sessions.map(item => React.createElement('p', { key: item.session_id }, `${item.session_id}：连接 ${item.connected ? '是' : '否'} / 心跳 ${item.heartbeat_active ? '活动' : '未活动'} / 记录 ${item.recording_active ? '活动' : '未活动'}`))),
        React.createElement('label', { style: { display: 'block' } }, React.createElement('input', { type: 'checkbox', checked: shutdownConfirmed, disabled: busy, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setShutdownConfirmed(event.target.checked) }), '我确认仅退出当前服务；不会发送设备 Stop，活动心跳、试验和未决效果需人工判断。'),
        React.createElement('button', { style: styles.button, disabled: busy || !serviceStatus?.attached || !shutdownConfirmed, onClick: () => manageService('shutdown') }, '确认退出服务'),
      ),
      React.createElement('div', { style: styles.card }, React.createElement('h2', null, '目标'),
        targets.length === 0 ? React.createElement('p', null, '未发现可用目标。') : targets.map((target: any) => React.createElement('div', { key: target.targetId, style: { ...styles.row, padding: '8px 0', borderTop: '1px solid var(--dsh-border, #334)' } },
          React.createElement('strong', null, target.label),
          React.createElement('span', null, target.transport),
          React.createElement('span', null, target.connected ? '已连接' : '未连接'),
          React.createElement('button', { style: styles.button, disabled: busy || (!target.canAttach && !target.canConnect), onClick: () => openTarget(target) }, target.connected ? '附着' : '连接'),
        )),
      ),
      React.createElement('div', { style: styles.card }, React.createElement('h2', null, '当前观察'),
        React.createElement('p', null, `UID：${text(identity?.uid)}　run_nonce：${text(identity?.runNonce)}　连接代次：${text(binding?.connectionGeneration ?? snapshot?.connectionGeneration)}`),
        binding?.expired && React.createElement('p', { role: 'alert' }, '绑定已过期；主动读取已停用，请重新选择目标。'),
        warnings.map((warning: any, index: number) => React.createElement('p', { key: index, role: 'alert' }, `owner 引用警告：${errorText(warning)}`)),
        snapshot && React.createElement(React.Fragment, null,
          React.createElement('p', null, legacy ? 'Legacy CLI 无持续 owner 读取门。' : `读取门：${snapshot.readiness?.ready ? '可读取' : `阻止 (${text(snapshot.readiness?.reasonCode)})`}`),
          snapshot.controlEffect && React.createElement('p', { role: snapshot.controlEffect.state === 'unknown' ? 'alert' : undefined }, `设备效果：${snapshot.controlEffect.state}（${text(snapshot.controlEffect.reason_code)}）；读取成功不代表设备停止或安全。`),
          snapshot.nativeJsonText && React.createElement('pre', { style: styles.mono }, snapshot.nativeJsonText)),
      ),
      React.createElement('div', { style: styles.card }, React.createElement('h2', null, '诊断进度'),
        React.createElement('p', null, readRun ? `${readRun.status} · ${text(readRun.phase)} · 当前步骤：${text(STEP_LABELS[currentStep(readRun, legacy)] ?? currentStep(readRun, legacy))}` : '尚未开始。'),
        React.createElement('ol', null, steps.map(step => React.createElement('li', { key: step }, `${evidenceSteps.includes(step) ? '已取得' : '等待'}：${STEP_LABELS[step]}`))),
        evidence.map((item: any, index: number) => React.createElement('details', { key: `${item.action}-${index}` },
          React.createElement('summary', null, `${STEP_LABELS[evidenceSteps[index]] ?? item.action} · ${text(item.receivedAt)}${item.error ? ` · ${errorText(item.error)}` : ''}`),
          React.createElement('p', null, `连接代次：${text(item.connectionGeneration)}；来源时钟：${text(item.sourceTimestamp?.clock)} / ${text(item.sourceTimestamp?.value)}；接收年龄 ms：${text(item.receivedAgeMs)}`),
          item.readPermit && React.createElement('p', null, `本步读取许可：${item.readPermit.ready ? '可读取' : '阻止'}（${text(item.readPermit.reason_code)}）；设备效果：${text(item.controlEffect?.state)}（${text(item.controlEffect?.reason_code)}）`),
          item.exitCode !== undefined && React.createElement('p', null, `进程退出码：${text(item.exitCode)}；信号：${text(item.processError?.signal)}`),
          item.parseError && React.createElement('p', { role: 'alert' }, `解析失败：${item.parseError}`),
          item.dataUtf8 !== undefined && React.createElement('details', null, React.createElement('summary', null, '配置原始载荷'), React.createElement('pre', { style: styles.mono }, item.dataUtf8 ?? item.dataHex)),
          React.createElement('pre', { style: styles.mono }, item.nativeJsonText ?? item.stdout ?? ''),
          item.stderr && React.createElement('pre', { style: styles.mono }, item.stderr))),
        readRun?.error && React.createElement('p', { role: 'alert' }, `首个错误：${errorText(readRun.error)}`),
        readRun?.reports?.markdown && React.createElement('p', null, `Markdown 报告：${readRun.reports.markdown}`),
        readRun?.reports?.json && React.createElement('p', null, `JSON 报告：${readRun.reports.json}`),
        readRun?.reportError && React.createElement('p', { role: 'alert' }, `报告写入失败：${errorText(readRun.reportError)}`),
      ),
      React.createElement('div', { style: styles.card }, React.createElement('h2', null, '离线配置检查'),
        React.createElement('textarea', { value: configText, onChange: (event: any) => setConfigText(event.target.value), placeholder: '粘贴完整配置原文；不会写入设备。', rows: 8, style: { width: '100%', boxSizing: 'border-box' } }),
        React.createElement('button', { style: styles.button, disabled: busy || configText.length === 0, onClick: checkConfiguration }, '检查原文配置'),
        configResult && React.createElement(React.Fragment, null,
          React.createElement('p', { role: 'status' }, configResult.summary),
          React.createElement('details', null, React.createElement('summary', null, 'SDK 校验详情'), React.createElement('pre', { style: styles.mono }, configResult.stderr || configResult.stdout || (configResult.error ? errorText(configResult.error) : '无附加输出')))),
      ),
    ),
    React.createElement('aside', { className: 'fieldkit-chat', style: styles.card, 'aria-label': 'Fieldkit 对话' },
      React.createElement('h2', null, 'Fieldkit 对话'),
      React.createElement('div', { className: 'fieldkit-chat-body' },
        reference && SessionProvider ? React.createElement(SessionProvider, { session: reference }, renderSlot('fieldkit.chat', {})) : React.createElement('p', null, '正在准备输入框…')),
    ),
  )
}

function FieldkitIcon() { return React.createElement('span', null, 'E') }

function readySessionCatalog(sessions: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let settled = false
    let unsubscribe = () => {}
    let timeout: ReturnType<typeof setTimeout> | undefined
    const finish = (catalog?: any, error?: unknown) => {
      if (settled) return
      settled = true
      unsubscribe()
      if (timeout) clearTimeout(timeout)
      if (error) reject(error)
      else resolve(catalog)
    }
    const check = () => {
      const catalog = sessions.list.getSnapshot()
      if (catalog.phase === 'ready') finish(catalog)
    }
    unsubscribe = sessions.list.subscribe(check)
    timeout = setTimeout(() => finish(undefined, new Error('Session catalog did not become ready; saved Fieldkit chat was not replaced')), 15000)
    check()
    if (settled) unsubscribe()
    else void sessions.refresh().then(check, (error: unknown) => finish(undefined, error))
  })
}

export async function apply(ctx: any) {
  const unmountRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  const scoped = await new Promise<any>((resolve) => ctx.inject(['remote.fieldkit'], resolve))
  const remote = scoped.remote.fieldkit
  let dedicatedSessionId: string | null = null
  let creating: Promise<string> | null = null
  const ensureSession = (sessions: any): Promise<string> => {
    if (dedicatedSessionId) return Promise.resolve(dedicatedSessionId)
    if (!creating) creating = (async () => {
      let savedId: string | null = null
      try { savedId = sessionStorage.getItem(SESSION_STORAGE_KEY) } catch { /* Storage may be unavailable; current mount still works. */ }
      if (savedId) {
        const catalog = await readySessionCatalog(sessions)
        if (catalog.ids.includes(savedId)) { dedicatedSessionId = savedId; return savedId }
      }
      const id = await sessions.create({})
      dedicatedSessionId = id
      try { sessionStorage.setItem(SESSION_STORAGE_KEY, id) } catch { /* Keep this mount usable without storage. */ }
      return id
    })().finally(() => { creating = null })
    return creating
  }
  scoped.slots.inject('main', () => scoped.slots.register({
    name: 'main', key: PANEL_ID,
    children: { 'fieldkit.chat': { kind: 'single', scope: 'session' } },
    inject: () => ({ remote, sessions: scoped.sessions, ensureSession }),
  }, FieldkitPanel))
  scoped.slots.inject('fieldkit.chat', () => scoped.slots.register({ name: 'fieldkit.chat' }, EmbeddedChat))
  scoped.slots.inject('sidebar.panellist', () => scoped.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 0, label: () => 'EHA Fieldkit' }, FieldkitIcon))
  scoped.layout.selectPanel(PANEL_ID)
  return async () => { await unmountRemote() }
}
