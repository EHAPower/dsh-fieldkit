import { createFieldkitSessions } from './client/fieldkit-sessions.js'
import { SessionSwitcher } from './client/SessionSwitcher.js'
import { RecoveryHistory } from './client/RecoveryHistory.js'
import { ControlWorkbench, ScopeStopBar, OriginalScopeStop } from './client/ControlWorkbench.js'
import type { FieldkitControlContext } from './remote-types.js'
import { ConfigurationMaintenance } from './client/ConfigurationMaintenance.js'
import { Connections } from './client/Connections.js'
import { Observation } from './client/Observation.js'
import { Recordings } from './client/Recordings.js'
import { ServiceSettings } from './client/ServiceSettings.js'
import { Diagnostics } from './client/Diagnostics.js'
import { text, errorText, valueOf, panelStyles, isExpiredBindingError } from './client/shared.js'
import { takeOpenedBinding } from './observation.js'
import React, { useEffect, useRef, useState } from 'react'
import type { FieldkitServiceSettings, FieldkitServiceStatus } from './remote-types.js'
import { TYPERT_REMOTE } from '../lib/typert.remote-client.js'

export const name = '@ehapower/dsh-fieldkit'
export const inject = ['remote', 'slots', 'layout', 'sessions']

const PANEL_ID = 'fieldkit'
const PANEL_CSS = `
[data-fieldkit-panel] { display:grid; grid-template-columns:minmax(0,1fr) minmax(320px,38%); gap:16px; height:100%; min-height:0; overflow:hidden; padding:16px; box-sizing:border-box; color:var(--dsh-fg,inherit); }
[data-fieldkit-panel] input, [data-fieldkit-panel] textarea, [data-fieldkit-panel] select { max-width:100%; min-width:0; box-sizing:border-box; }
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

function isRunSettled(run: any) { return run?.phase === 'finished' || run?.phase === 'report_failed' }
function FieldkitPanel(props: any) {
  const { remote, sessions, ensureSession, sessionManager, onSessionSelected, SessionProvider, renderSlot } = props
  const [controlState, setControlState] = useState<{ sessionId: string | null; value: FieldkitControlContext | null }>({ sessionId: null, value: null })
  const [tab, setTab] = useState('connections')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const controlContext = controlState.sessionId === sessionId ? controlState.value : null
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
    let authenticating = true
    try {
      const nextDescribe = valueOf(await remote.describe())
      if (!current(ticket)) return
      authenticating = false
      setDescribe(nextDescribe)
      if (!nextDescribe.available) {
        if (nextDescribe.mode === 'service-v2') { authenticating = true; const status = valueOf(await remote.serviceStatus()); if (!current(ticket)) return; authenticating = false; setServiceStatus(status); setServiceSettings(status.settings) }
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
        } catch (error) { if (current(ticket, selected.bindingId)) { setSnapshot(null); if (isExpiredBindingError(error)) selectBinding({ ...selected, expired: true }); snapshotWarning = isExpiredBindingError(error) ? `观察已过期；身份、代次或实例不再匹配，请明确重新选择目标。${errorText(error)}` : `目标已选，但缓存状态不可读：${errorText(error)}` } }
      }
      if (nextDescribe.mode === 'service-v2') { authenticating = true; const status = valueOf(await remote.serviceStatus()); if (!current(ticket)) return; authenticating = false; setServiceStatus(status); setServiceSettings(status.settings) }
      if (current(ticket)) setNotice(snapshotWarning ?? (selected?.expired ? '绑定已过期，请明确重新选择目标。' : '目标列表已刷新。'))
    } catch (error) {
      if (current(ticket)) { if (authenticating) setDescribe((previous: any) => previous ? { ...previous, available: false, instanceId: null } : null); setSnapshot(null); setReadRun(null); if (bindingRef.current && isExpiredBindingError(error)) selectBinding({ ...bindingRef.current, expired: true }); setNotice(`刷新失败：${errorText(error)}`) }
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

  useEffect(() => {
    if (!visible || !sessionId) return
    let active = true, timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (!busyRef.current) try {
        const ticket = epoch.current
        const latest = valueOf(await remote.getReadRun(sessionId, {}))
        if (!active || !current(ticket) || busyRef.current) return
        if (latest && latest.bindingId !== bindingRef.current?.bindingId) {
          const state = valueOf(await remote.listTargets(sessionId))
          if (!active || !current(ticket) || busyRef.current) return
          const selected = state.selectedBinding
          if (selected?.bindingId === latest.bindingId) {
            selectBinding(selected); setTargets(state.targets); setSnapshot(null)
            if (!selected.expired) {
              try {
                const cached = valueOf(await remote.getSnapshot(sessionId, { bindingId: selected.bindingId }))
                if (active && current(ticket, selected.bindingId)) setSnapshot(cached)
              } catch (error) {
                if (active && current(ticket, selected.bindingId) && isExpiredBindingError(error)) {
                  selectBinding({ ...selected, expired: true }); setSnapshot(null)
                  setNotice(`观察已过期：${errorText(error)}；请重新选择目标。`)
                }
              }
            }
          }
        }
        if (active && current(ticket) && latest && latest.bindingId === bindingRef.current?.bindingId) setReadRun((previous: any) => previous?.readRunId === latest.readRunId && previous?.phase === latest.phase && previous?.evidence?.length === latest.evidence.length ? previous : latest)
      } catch { /* explicit actions surface errors; passive discovery never reconnects */ }
      finally { if (active) timer = setTimeout(poll, 1000) }
      else if (active) timer = setTimeout(poll, 1000)
    }
    void poll(); return () => { active = false; clearTimeout(timer) }
  }, [visible, sessionId, remote])

  const refreshServiceStatus = async () => {
    if (!begin()) return
    const ticket = invalidate()
    setShutdownConfirmed(false)
    try {
      const status = valueOf(await remote.serviceStatus())
      if (!current(ticket)) return
      setServiceStatus(status)
      setNotice(status.error ? `服务概要读取失败：${errorText(status.error)}` : '服务概要已刷新；这是本次读取到的服务元数据。')
    } catch (error) {
      if (current(ticket)) {
        setDescribe((previous: any) => previous ? { ...previous, available: false, instanceId: null } : null)
        setNotice(`服务概要读取失败：${errorText(error)}；保留上次概要。`)
      }
    } finally { end() }
  }

  const manageService = async (action: 'save' | 'attach' | 'start' | 'shutdown') => {
    if (!serviceSettings || !begin()) return
    const ticket = invalidate()
    let authenticating = true
    setDescribe((previous: any) => previous ? { ...previous, available: false, instanceId: null } : null)
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
      selectBinding(null)
      if (action !== 'shutdown') {
        const next = valueOf(await remote.describe())
        if (!current(ticket)) return
        authenticating = false
        setDescribe(next)
        if (sessionId && next.available) {
          const listed = valueOf(await remote.listTargets(sessionId))
          if (!current(ticket)) return
          setTargets(listed.targets ?? []); setDiscovery({ limited: listed.discoveryLimited === true, reason: listed.discoveryReason ?? null })
          selectBinding(listed.selectedBinding?.expired ? null : listed.selectedBinding ?? null)
          authenticating = true
          const actual = valueOf(await remote.serviceStatus())
          if (!current(ticket)) return
          authenticating = false
          setServiceStatus(actual); setServiceSettings(actual.settings)
        }
      } else setDescribe((previous: any) => previous ? { ...previous, available: false, capabilities: [], instanceId: null } : { mode: 'service-v2', available: false, capabilities: [], instanceId: null })
      setNotice(action === 'shutdown' ? '服务已受理退出；没有请求设备 Stop，不能据此认定设备停止。' : action === 'save' ? '设置已保存，服务能力与目标状态已重新核对；服务未运行时请显式启动。' : '服务已认证附着，能力与目标已刷新。请明确选择设备。')
    } catch (error) {
      if (current(ticket)) { if (authenticating) setDescribe((previous: any) => previous ? { ...previous, available: false, instanceId: null } : null); setNotice(`服务操作失败：${errorText(error)}`); if (bindingRef.current) selectBinding({ ...bindingRef.current, expired: true }); setSnapshot(null) }
    } finally { end() }
  }

  const openTarget = async (target: any) => {
    if (!sessionId || !begin()) return
    const ticket = invalidate()
    let openedBindingId: string | null = null
    try {
      const request = target.connected
        ? { targetId: target.targetId, intent: 'attach', expectedIdentity: target.identity, connectionGeneration: target.connectionGeneration }
        : { targetId: target.targetId, intent: 'connect' }
      const next = await takeOpenedBinding(remote.openTarget(sessionId, request).then(valueOf), () => current(ticket), (late: any) => remote.detachTarget(sessionId, { bindingId: late.bindingId }).then(valueOf))
      if (!next) return
      openedBindingId = next.bindingId
      selectBinding(next)
      setSnapshot(null)
      setReadRun(null)
      // Refresh authenticated owner facts after the handshake; never invent connected=true.
      const actual = valueOf(await remote.listTargets(sessionId))
      if (!current(ticket, next.bindingId)) return
      setTargets(actual.targets); selectBinding(actual.selectedBinding ?? next)
      const cached = valueOf(await remote.getSnapshot(sessionId, { bindingId: next.bindingId }))
      if (!current(ticket, next.bindingId)) return
      setSnapshot(cached)
      if (describe?.mode === 'service-v2') { const status = await remote.serviceStatus().then(valueOf).catch((error: unknown) => { if (current(ticket, next.bindingId)) setDescribe((previous: any) => previous ? { ...previous, available: false, instanceId: null } : null); throw error }); if (current(ticket, next.bindingId)) setServiceStatus(status) }
      if (current(ticket, next.bindingId)) setNotice(`已选择 ${target.label}；连接、缓存与服务概要已刷新，代次 ${text(next.connectionGeneration)}。`)
    } catch (error) { if (current(ticket)) {
      const stale = openedBindingId && bindingRef.current?.bindingId === openedBindingId && isExpiredBindingError(error)
      if (stale) { selectBinding({ ...bindingRef.current, expired: true }); setSnapshot(null) }
      setNotice(stale ? `观察已过期：${errorText(error)}；请重新选择目标。` : `无法选择目标：${errorText(error)}`)
    } } finally { end() }
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
    if (!sessionId || !selected || selected.expired || !begin()) return false
    const ticket = epoch.current
    try {
      const next = valueOf(await remote.getSnapshot(sessionId, { bindingId: selected.bindingId }))
      if (!current(ticket, selected.bindingId)) return false
      setSnapshot(next)
      if (next.expired) selectBinding({ ...selected, expired: true })
      if (next.readRun && (!readRun || next.readRun.readRunId === readRun.readRunId)) setReadRun(next.readRun)
      setNotice('已读取缓存状态。')
      return true
    } catch (error) { if (current(ticket, selected.bindingId)) { setSnapshot(null); if (isExpiredBindingError(error)) selectBinding({ ...selected, expired: true }); setNotice(isExpiredBindingError(error) ? `观察已过期；身份、代次或实例不再匹配，请明确重新选择目标。${errorText(error)}` : `状态读取失败：${errorText(error)}`) } return false } finally { end() }
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
  const identity = binding?.identity ?? snapshot?.identity
  const canAct = binding !== null && !binding?.expired && !busy
  const runActive = !!readRun && !isRunSettled(readRun)
  const canDiagnose = canAct && !runActive && (legacy || snapshot?.readiness?.ready === true)
  const warnings = binding?.observationWarnings ?? snapshot?.observationWarnings ?? []
  const styles = panelStyles(busy)
  const currentServiceInstanceId = serviceStatus?.attached && !serviceStatus.error && serviceStatus.instance?.service_state === 'running' && describe?.available && describe.instanceId === serviceStatus.instance.instance_id ? serviceStatus.instance.instance_id : null

  return React.createElement('main', { 'data-fieldkit-panel': '' },
    React.createElement('style', null, PANEL_CSS),
    React.createElement('section', { className: 'fieldkit-workbench' },
      sessionId && React.createElement(ScopeStopBar, { fixedScope: controlContext?.scopes.find(scope => scope.scopeId === controlContext.activeScopeId) ?? null, status: controlContext?.scopes.find(scope => scope.scopeId === controlContext.activeScopeId)?.latest, onStop: (scopeId: string) => remote.stopControlScope(sessionId, scopeId) }),
      sessionId && React.createElement(OriginalScopeStop, { remote, sessionId, currentInstanceId: currentServiceInstanceId }),
      sessionId && React.createElement(RecoveryHistory, { remote, sessionId, currentInstanceId: currentServiceInstanceId }),
      React.createElement('div', { style: styles.card },
        React.createElement('h1', null, 'EHA Fieldkit'),
        React.createElement('p', { role: 'status' }, notice),
        React.createElement('div', { style: styles.row },
          React.createElement('button', { style: styles.button, disabled: busy || !sessionId, onClick: refresh }, '刷新目标'),
          React.createElement('button', { style: styles.button, disabled: !canAct, onClick: readSnapshot }, '读取缓存状态'),
          React.createElement('button', { style: styles.button, disabled: !canDiagnose, onClick: diagnose }, legacy ? '六次离散 CLI 诊断' : '六步只读诊断'),
          React.createElement('button', { style: styles.button, disabled: !binding || busy, onClick: detach }, '取消选择 / 解除观察'),
        ),
        !canDiagnose && React.createElement('p', null, `诊断不可用：${busy ? '操作进行中' : !binding ? '先明确选择目标' : binding.expired ? '观察已过期，请重新选择' : !snapshot ? '先读取缓存状态' : snapshot.readiness?.reasonCode ?? '读取门尚未开放'}。`),
        describe && React.createElement('p', null, `模式：${describe.mode}　协议：${text(describe.protocol)}　默认只读；维护须明确授权`),
        legacy && React.createElement('p', null, 'Legacy CLI 是六次离散命令采集，不是持续 owner 会话或同一时刻快照；不会自动回退。'),
        discovery.limited && React.createElement('p', { role: 'alert' }, `目标发现不完整：${text(discovery.reason)}`),
      ),
      (describe?.mode === 'service-v2' || serviceSettings !== null) && React.createElement(ServiceSettings, { serviceSettings, serviceStatus, setServiceSettings, shutdownConfirmed, setShutdownConfirmed, busy, manageService, refreshServiceStatus }),
      React.createElement('nav', { 'aria-label': 'Fieldkit 工作区', style: styles.row }, [['connections', '连接'], ['observe', '观察与诊断'], ['records', '记录 / ODrive'], ['configuration', '配置 / 维护'], ['control', '控制 / 试验']].map(([key, label]) => React.createElement('button', { key, 'aria-pressed': tab === key, onClick: () => setTab(key), style: styles.button }, label))),
      sessionId && React.createElement('div', { style: { display: tab === 'control' ? 'block' : 'none' } }, React.createElement(ControlWorkbench, { remote, sessionId, currentBinding: binding, busy, visible, onContextChange: (value: FieldkitControlContext) => setControlState({ sessionId, value }) })),
      tab === 'connections' && React.createElement(Connections, { remote, sessionId, capabilities: describe?.capabilities, instanceId: describe?.instanceId, targets, busy, openTarget, refresh }),
      tab === 'records' && React.createElement(Recordings, { remote, sessionId, capabilities: describe?.capabilities, onOpenControl: () => setTab('control') }),
      sessionId && React.createElement('div', { style: { display: tab === 'configuration' ? 'block' : 'none' } }, React.createElement(ConfigurationMaintenance, { remote, sessionId, binding, busy, onRefresh: refresh, onBindingInvalidated: (target: any, reason: string) => { if (bindingRef.current?.bindingId === target.bindingId && bindingRef.current?.instanceId === target.instanceId) { selectBinding({ ...bindingRef.current, expired: true }); setSnapshot(null); setNotice(reason) } }, capabilities: describe?.capabilities, visible: visible && tab === 'configuration' })),
      React.createElement('div', { style: { display: tab === 'observe' ? 'grid' : 'none', gap: 12 } },
      React.createElement(Observation, { remote, sessionId, binding, enabled: describe?.capabilities?.includes('events'), visible: visible && tab === 'observe', onGap: readSnapshot }),
      React.createElement('div', { style: styles.card }, React.createElement('h2', null, '当前观察'),
        React.createElement('p', null, `UID：${text(identity?.uid)}　run_nonce：${text(identity?.runNonce)}　连接代次：${text(binding?.connectionGeneration ?? snapshot?.connectionGeneration)}`),
        binding?.expired && React.createElement('p', { role: 'alert' }, '绑定已过期；主动读取已停用，请重新选择目标。'),
        warnings.map((warning: any, index: number) => React.createElement('p', { key: index, role: 'alert' }, `owner 引用警告：${errorText(warning)}`)),
        snapshot && React.createElement(React.Fragment, null,
          React.createElement('p', null, legacy ? 'Legacy CLI 无持续 owner 读取门。' : `读取门：${snapshot.readiness?.ready ? '可读取' : `阻止 (${text(snapshot.readiness?.reasonCode)})`}`),
          snapshot.controlEffect && React.createElement('p', { role: snapshot.controlEffect.state === 'unknown' ? 'alert' : undefined }, `设备效果：${snapshot.controlEffect.state}（${text(snapshot.controlEffect.reason_code)}）；读取成功不代表设备停止或安全。`),
          snapshot.nativeJsonText && React.createElement('pre', { style: styles.mono }, snapshot.nativeJsonText)),
      ),
      React.createElement(Diagnostics, { readRun, legacy, remote, sessionId })),
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
      React.createElement(SessionSwitcher, { sessions, manager: sessionManager, currentSessionId: sessionId, onSelected: onSessionSelected }),
      React.createElement('div', { className: 'fieldkit-chat-body' },
        reference && SessionProvider ? React.createElement(SessionProvider, { session: reference }, renderSlot('fieldkit.chat', {})) : React.createElement('p', null, '正在准备输入框…')),
    ),
  )
}

function FieldkitIcon() { return React.createElement('span', null, 'E') }

function FieldkitSessionPanel(props: any) {
  const [sessionGeneration, setSessionGeneration] = useState(0)
  return React.createElement(FieldkitPanel, { ...props, key: sessionGeneration, onSessionSelected: () => setSessionGeneration(value => value + 1) })
}

export async function apply(ctx: any) {
  const unmountRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  const scoped = await new Promise<any>((resolve) => ctx.inject(['remote.fieldkit'], resolve))
  const remote = scoped.remote.fieldkit
  const sessionManager = createFieldkitSessions()
  const ensureSession = sessionManager.ensure
  scoped.slots.inject('main', () => scoped.slots.register({
    name: 'main', key: PANEL_ID,
    children: { 'fieldkit.chat': { kind: 'single', scope: 'session' } },
    inject: () => ({ remote, sessions: scoped.sessions, ensureSession, sessionManager }),
  }, FieldkitSessionPanel))
  scoped.slots.inject('fieldkit.chat', () => scoped.slots.register({ name: 'fieldkit.chat' }, EmbeddedChat))
  scoped.slots.inject('sidebar.panellist', () => scoped.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 0, label: () => 'EHA Fieldkit' }, FieldkitIcon))
  scoped.layout.selectPanel(PANEL_ID)
  return async () => { await unmountRemote() }
}
