import React, { useEffect, useRef, useState } from 'react'
import type { FieldkitBinding, FieldkitControlCandidate, FieldkitControlCommand, FieldkitControlContext, FieldkitControlResult, FieldkitControlScope, FieldkitMaintenanceTarget, FieldkitTrialReceipt, FieldkitOriginalStopScope, FieldkitOriginalStopResult } from '../remote-types.js'
import { useMutationJournal } from './mutation-journal.js'
import { Control, type ControlDemand, type ControlReceipt } from './Control.js'
import { Trials, type TrialReceipt } from './Trials.js'
import { errorText, panelStyles, text, valueOf } from './shared.js'

const targetKey = (target: FieldkitMaintenanceTarget) => JSON.stringify([target.instanceId, target.bindingId, target.targetId, target.uid, target.runNonce, target.connectionGeneration])
const fixedKey = (scope: FieldkitControlScope | null) => scope ? JSON.stringify([scope.scopeId, scope.instanceId, scope.members.map(member => [targetKey(member.target), member.grantId])]) : ''
// Only explicit pre-submission refusals can be treated as known without a receipt.
const mutationUncertain = (error: any) => error?.unknown === true || error?.unknown !== false && !['bad_request', 'disposed', 'owner_busy', 'busy', 'permission_denied', 'permission_revoked', 'permission_conflict', 'identity_changed', 'binding_stale', 'instance_mismatch', 'invalid_request', 'unsupported'].includes(error?.code)
const membersText = (scope: FieldkitControlScope) => scope.members.map(member => member.target.targetId).join('、')
const emptyContext = (): FieldkitControlContext => ({ scopes: [], activeScopeId: null, capabilities: [] })
const sameMembers = (members: readonly FieldkitMaintenanceTarget[], scope: FieldkitControlScope) => members.length === scope.members.length && members.every(member => scope.members.some(original => targetKey(original.target) === targetKey(member)))
function checkResult(result: FieldkitControlResult, scope: FieldkitControlScope, action?: string) {
  if (result.scopeId !== scope.scopeId || action !== undefined && result.action !== action || !sameMembers(result.results.map(member => member.target), scope) || new Set(result.results.map(member => targetKey(member.target))).size !== scope.members.length) throw new Error('控制结果与原固定范围的完整成员或动作不一致；请查询原记录。')
  return result
}
function ResultEvidence({ result }: { result: FieldkitControlResult | null }) {
  const styles = panelStyles()
  return result && React.createElement('section', { style: styles.card }, React.createElement('h3', null, `固定范围 ${result.scopeId} · ${result.action}`),
    React.createElement('p', { role: result.unknown ? 'alert' : undefined }, result.unknown ? '成员结果未知；保留原记录，不重试。' : '逐台受理与本地提交不证明设备采用、到位或停止。群组不保证原子执行。'),
    result.results.map(member => React.createElement('div', { key: targetKey(member.target) },
      React.createElement('p', null, `${member.target.targetId} · UID ${member.target.uid} · run_nonce ${member.target.runNonce} · 代次 ${member.target.connectionGeneration} · 受理 ${member.admission} · 本地提交：${member.submission} · 观测 ${member.observation} · 效果 ${member.controlEffect} · phase ${text(member.phase)} · 编号 ${text(member.operationId)}`),
      member.unknown && React.createElement('p', { role: 'alert' }, `结果未知 · 来源 ${text(member.unknownSource)}`),
      member.previousOperationId && React.createElement('details', null, React.createElement('summary', null, `先前操作 ${member.previousOperationId} · 提交 ${member.previousSubmission} · 未知 ${member.previousUnknown ? '是' : '否'}（不是本次提交）`), React.createElement('pre', { style: styles.mono }, member.previousNativeJsonText ?? '无原文')),
      member.error && React.createElement('p', { role: 'alert' }, `${member.error.code}：${member.error.message}`),
      member.stopAttemptDelayMs !== undefined && React.createElement('p', null, `Stop 本地提交尝试延迟 ms：${text(member.stopAttemptDelayMs)}`),
      member.recordingId && React.createElement('p', null, `服务记录编号：${member.recordingId}`),
      member.nativeJsonText && React.createElement('details', null, React.createElement('summary', null, 'SDK 原始证据'), React.createElement('pre', { style: styles.mono }, member.nativeJsonText)))),
    result.coalescedExisting && React.createElement('p', null, '沿用原 Stop 请求，没有新增设备提交。'),
    result.newSubmission === false && React.createElement('p', null, '本次响应未新增提交（查询或沿用记录也会如此）；原操作的本地提交事实见逐台记录。'))
}

export interface ScopeStopBarProps {
  fixedScope: FieldkitControlScope | null
  status?: FieldkitControlResult | null
  /** 返回Remote结果；此按钮不使用普通busy，也不切换或缩减原成员。 */
  onStop(scopeId: string): Promise<any>
}
export function ScopeStopBar({ fixedScope, status, onStop }: ScopeStopBarProps) {
  const key = fixedKey(fixedScope), live = useRef({ key, generation: 0, pending: false, blocked: false })
  if (live.current.key !== key) live.current = { key, generation: live.current.generation + 1, pending: false, blocked: false }
  const generation = live.current.generation, active = () => live.current.generation === generation
  const [state, setState] = useState<{ generation: number; pending: boolean; notice: string; result: FieldkitControlResult | null }>({ generation, pending: false, notice: '', result: null })
  const current = state.generation === generation ? state : { pending: false, notice: '', result: null }
  const reason = !fixedScope ? '尚无已明确建立的固定控制范围。' : fixedScope.stopReason ?? (!fixedScope.stopAvailable ? '服务未允许此原始范围请求 Stop；请核对原记录。' : null)
  live.current.blocked = !!reason
  const styles = panelStyles(current.pending)
  const stop = async () => {
    if (!fixedScope || reason || !active() || live.current.pending || live.current.blocked) return
    const original = fixedScope
    live.current.pending = true; setState({ generation, pending: true, notice: '正在请求原固定范围普通 Stop；受理不证明设备已停止。', result: null })
    try {
      const result = checkResult(valueOf(await onStop(original.scopeId)), original, 'stop')
      if (active()) setState({ generation, pending: true, notice: '普通 Stop 记录已返回；逐台提交与机械停止是不同事实。', result })
    } catch (error) { if (active()) setState({ generation, pending: true, notice: `Stop 记录未确认：${errorText(error)}；查询原范围，不自动重发。`, result: null }) }
    finally { if (active()) { live.current.pending = false; setState(previous => ({ ...previous, pending: false })) } }
  }
  const external = status?.scopeId === fixedScope?.scopeId && status?.action === 'stop' ? status : null
  return React.createElement('section', { style: styles.card, 'aria-label': '常驻固定范围 Stop' }, React.createElement('h2', null, '固定范围普通 Stop'),
    React.createElement('p', null, fixedScope ? `原始固定范围 ${fixedScope.scopeId}：${membersText(fixedScope)}。观察目标、切页和解除引用不会改变这些成员。` : '先明确建立控制范围；这里保留独立 Stop 入口。'),
    fixedScope && React.createElement('details', null, React.createElement('summary', null, '核对完整原始成员'), fixedScope.members.map(member => React.createElement('p', { key: targetKey(member.target) }, `实例 ${member.target.instanceId} · ${member.target.targetId} · UID ${member.target.uid} · run_nonce ${member.target.runNonce} · 连接代次 ${member.target.connectionGeneration} · grant ${member.grantId}`))),
    React.createElement('p', null, '普通 Stop 不是急停。不受普通读取、目标提交或模型 busy 阻挡；本地提交不证明机械停止。'),
    reason && React.createElement('p', { role: 'status' }, reason),
    React.createElement('button', { style: styles.button, disabled: !!reason || current.pending, onClick: stop }, '停止固定控制范围'),
    current.notice && React.createElement('p', { role: 'status' }, current.notice), React.createElement(ResultEvidence, { result: external ?? current.result }))
}

const originalKey = (scope: FieldkitOriginalStopScope) => JSON.stringify([scope.referenceId, scope.instanceId, scope.targetId, scope.uid, scope.runNonce, scope.connectionGeneration, scope.controlEpoch, scope.stopRequestId])
const originalJournalKey = (scope: FieldkitOriginalStopScope) => JSON.stringify([scope.instanceId, scope.targetId, scope.uid, scope.runNonce, scope.connectionGeneration, scope.controlEpoch, scope.stopRequestId])
/** 只使用Host已登记的原执行引用；不创建观察binding、不迁移到当前别名。 */
export function OriginalScopeStop({ remote, sessionId }: { remote: any; sessionId: string }) {
  type ReceiptMap = Partial<Record<'stop' | 'heartbeat_stop' | 'recording_stop', FieldkitOriginalStopResult>>
  const journal = useMutationJournal(), originalReceipts = useRef(new Map<string, ReceiptMap>())
  const anonymousKey = (scope: FieldkitOriginalStopScope) => JSON.stringify([sessionId, originalJournalKey(scope)])
  const [stored, setStored] = useState<{ generation: number; scopes: readonly FieldkitOriginalStopScope[]; selected: string; receipts: ReceiptMap; notice: string }>({ generation: 0, scopes: [], selected: '', receipts: {}, notice: '' })
  const [pending, setPending] = useState({ generation: 0, reading: false, stopping: false, cleaning: false, querying: false })
  const [confirmation, setConfirmation] = useState({ key: '', heartbeat_stop: false, recording_stop: false })
  const live = useRef({ sessionId, generation: 0, reading: false, stopping: false, cleaning: false, querying: false, heartbeat_stop: false, recording_stop: false })
  if (live.current.sessionId !== sessionId) live.current = { sessionId, generation: live.current.generation + 1, reading: false, stopping: false, cleaning: false, querying: false, heartbeat_stop: false, recording_stop: false }
  const generation = live.current.generation, active = () => live.current.generation === generation
  const currentPending = pending.generation === generation ? pending : { reading: false, stopping: false, cleaning: false, querying: false }
  const { reading, stopping, cleaning, querying } = currentPending
  const state = stored.generation === generation ? stored : { generation, scopes: [], selected: '', receipts: {}, notice: '' }
  const selected = state.scopes.find(scope => scope.referenceId === state.selected) ?? null, key = selected ? originalKey(selected) : ''
  const recovered = selected ? Object.fromEntries(journal.receipts(sessionId, originalJournalKey(selected)).map(receipt => [receipt.action ?? 'stop', receipt])) as ReceiptMap : {}
  const receipts = { ...recovered, ...(selected ? originalReceipts.current.get(anonymousKey(selected)) ?? {} : {}) }
  const selection = useRef({ key, generation: 0 })
  if (selection.current.key !== key) { selection.current = { key, generation: selection.current.generation + 1 }; live.current.heartbeat_stop = false; live.current.recording_stop = false }
  const selectionGeneration = selection.current.generation, sameSelection = () => active() && selection.current.generation === selectionGeneration
  const update = (next: typeof state) => { if (active()) setStored(next) }
  const setFlight = (field: 'reading' | 'stopping' | 'cleaning' | 'querying', value: boolean) => { if (active()) { live.current[field] = value; setPending({ generation, reading: live.current.reading, stopping: live.current.stopping, cleaning: live.current.cleaning, querying: live.current.querying }) } }
  const read = async () => {
    if (!sessionId || live.current.reading) return
    setFlight('reading', true)
    try { const result = valueOf(await remote.listOriginalStopScopes(sessionId)); update({ generation, scopes: result.scopes, selected: '', receipts: {}, notice: '原执行范围已读取；请明确选择，不使用当前观察别名替换通路。' }) }
    catch (error) { update({ ...state, notice: `原执行范围读取失败：${errorText(error)}` }) }
    finally { setFlight('reading', false) }
  }
  const reason = !selected ? '请先明确读取并选择一个原执行范围。' : !selected.current ? '原执行范围已过期；不替换路由或重发。' : !selected.controlGranted ? '原范围尚无人类 control 授权；须在原范围明确人工授权，不能自动授权或换通路。' : null
  const checked = (result: FieldkitOriginalStopResult, original: FieldkitOriginalStopScope, action: 'stop' | 'heartbeat_stop' | 'recording_stop', operationId?: string) => {
    if (result.referenceId !== original.referenceId || originalKey(result.scope) !== originalKey(original) || !result.operationId || operationId !== undefined && result.operationId !== operationId || action === 'stop' && result.operationId !== original.stopRequestId || action !== 'stop' && result.action !== action) throw new Error('原执行范围回执与所选身份、控制 epoch、动作或原操作编号不一致。')
    return result
  }
  const publish = (action: 'stop' | 'heartbeat_stop' | 'recording_stop', result: FieldkitOriginalStopResult, notice: string) => {
    const resultKey = anonymousKey(result.scope)
    originalReceipts.current.set(resultKey, { ...originalReceipts.current.get(resultKey), [action]: result })
    if (sameSelection()) setStored(previous => ({ ...previous, notice }))
  }
  const stop = async () => {
    if (!selected || reason || !sameSelection() || live.current.stopping || live.current.reading) return
    const original = selected; setFlight('stopping', true)
    try { const result = checked(valueOf(await remote.stopOriginalScope(sessionId, original.referenceId)), original, 'stop'); publish('stop', result, '原执行范围 Stop 回执已返回；没有切换到当前观察通路。本地提交不证明机械停止。') }
    catch (error) { if (sameSelection()) setStored(previous => ({ ...previous, notice: `原执行范围 Stop 未确认：${errorText(error)}；保留原范围，不自动重发。` })) }
    finally { setFlight('stopping', false) }
  }
  const anonymousReason = selected ? journal.reason(sessionId, originalJournalKey(selected)) : null
  const unresolved = !!anonymousReason || Object.values(receipts).some(receipt => receipt && (receipt.unknown || receipt.admission !== 'finished'))
  const cleanup = async (action: 'heartbeat_stop' | 'recording_stop') => {
    if (!selected || reason || unresolved || !sameSelection() || live.current.cleaning || live.current.reading || live.current.querying || confirmation.key !== key || !confirmation[action] || !live.current[action]) return
    const original = selected
    let acknowledge: (receipt?: FieldkitOriginalStopResult) => void
    try { acknowledge = journal.begin(sessionId, originalJournalKey(original), action) } catch (error) { if (sameSelection()) setStored(previous => ({ ...previous, notice: errorText(error) })); return }
    live.current[action] = false; setConfirmation(previous => ({ ...previous, [action]: false })); setFlight('cleaning', true)
    try { const result = checked(valueOf(await remote.cleanupOriginalScope(sessionId, { referenceId: original.referenceId, action })), original, action); acknowledge(result); publish(action, result, '原范围收尾回执已返回；该动作不发送 Stop，不证明机械停止。') }
    catch (error) { if (!mutationUncertain(error)) acknowledge(); if (sameSelection()) setStored(previous => ({ ...previous, notice: `原范围收尾回执未确认：${errorText(error)}；不自动重发。已登记回执仅可按原编号读取。` })) }
    finally { setFlight('cleaning', false) }
  }
  const query = async (action: 'stop' | 'heartbeat_stop' | 'recording_stop', receipt: FieldkitOriginalStopResult) => {
    if (!selected || originalJournalKey(receipt.scope) !== originalJournalKey(selected) || !sameSelection() || live.current.querying || live.current.reading) return
    const original = selected; setFlight('querying', true)
    try { const result = checked(valueOf(await remote.getOriginalScopeOperation(sessionId, { referenceId: original.referenceId, operationId: receipt.operationId, action })), original, action, receipt.operationId); if (receipt.unknownSource === 'sdk' && !result.unknown) throw new Error('原 SDK 未知证据不可降格。'); journal.reconcile(sessionId, originalJournalKey(original), result); publish(action, result, '原操作只读记录已返回；没有新增提交。') }
    catch (error) { if (sameSelection()) setStored(previous => ({ ...previous, notice: `原操作只读查询失败：${errorText(error)}；保留已有回执，不改变其提交事实。` })) }
    finally { setFlight('querying', false) }
  }
  const styles = panelStyles(stopping)
  return React.createElement('section', { style: styles.card, 'aria-label': '原执行范围普通 Stop' }, React.createElement('h3', null, '原执行范围普通 Stop'),
    React.createElement('p', null, '跨 USB/CAN 别名不自动换路由。此处只停止明确选择的原执行范围；原范围没有授权时不自动生成授权。'),
    React.createElement('button', { disabled: reading || !sessionId, onClick: read }, '读取原执行范围'),
    React.createElement('select', { 'aria-label': '明确选择原执行范围', value: state.selected, disabled: reading, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => { const selected = event.target.value; if (!selected || state.scopes.some(scope => scope.referenceId === selected)) { live.current.heartbeat_stop = false; live.current.recording_stop = false; setConfirmation({ key: '', heartbeat_stop: false, recording_stop: false }); update({ ...state, selected, receipts: {}, notice: '' }) } } }, React.createElement('option', { value: '' }, '请明确选择原执行范围'), ...state.scopes.map(scope => React.createElement('option', { key: scope.referenceId, value: scope.referenceId }, `${scope.targetId} · UID ${scope.uid} · epoch ${scope.controlEpoch}`))),
    selected && React.createElement('p', null, `原目标 ${selected.targetId} · UID ${selected.uid} · run_nonce ${selected.runNonce} · 连接代次 ${selected.connectionGeneration} · control epoch ${selected.controlEpoch} · 实例 ${selected.instanceId} · Stop 编号 ${selected.stopRequestId} · 当前范围 ${selected.current ? '是' : '否'}`),
    reason && React.createElement('p', { role: 'status' }, reason), React.createElement('button', { disabled: !!reason || stopping || reading, onClick: stop }, '请求所选原执行范围 Stop'),
    ...(['heartbeat_stop', 'recording_stop'] as const).map(action => { const label = action === 'heartbeat_stop' ? '停止原范围持续心跳' : '停止原范围记录'; return React.createElement('div', { key: action },
      React.createElement('label', null, React.createElement('input', { type: 'checkbox', 'aria-label': `确认${label}（不发送 Stop）`, checked: confirmation.key === key && confirmation[action], disabled: !!reason || cleaning || querying || unresolved, onChange: (event: React.ChangeEvent<HTMLInputElement>) => { if (!sameSelection()) return; live.current[action] = event.target.checked; setConfirmation(previous => ({ ...previous, key, [action]: event.target.checked })) } }), `确认${label}（不发送 Stop）`),
      React.createElement('button', { disabled: !!reason || reading || cleaning || querying || unresolved || confirmation.key !== key || !confirmation[action], onClick: () => cleanup(action) }, label)) }),
    anonymousReason && React.createElement('p', { role: 'alert' }, anonymousReason),
    unresolved && React.createElement('p', { role: 'alert' }, '原操作尚未完成或结果未知；保留原编号，只读查询，不重新提交收尾动作。'),
    state.notice && React.createElement('p', { role: 'status' }, state.notice),
    ...Object.entries(receipts).map(([action, receipt]) => receipt && React.createElement('div', { key: action },
      React.createElement('p', null, `原动作 ${action} · 操作编号 ${receipt.operationId}`),
      React.createElement('p', { role: receipt.unknown ? 'alert' : undefined }, `受理 ${receipt.admission} · 本地提交：${receipt.submission} · 观测 ${receipt.observation} · 效果 ${receipt.controlEffect} · 未知 ${receipt.unknown ? '是' : '否'} · 来源 ${text(receipt.unknownSource)}`),
      receipt.error && React.createElement('p', { role: 'alert' }, `${receipt.error.code}：${receipt.error.message}`),
      receipt.newSubmission === false && React.createElement('p', null, '本次响应未新增提交（查询或沿用记录也会如此）；原操作的本地提交事实见逐台记录。'),
      receipt.referenceId !== selected?.referenceId && React.createElement('p', { role: 'alert' }, '此编号来自先前 Host 引用；仅对当前人工所选的同一 SDK 范围查询原编号，服务须重新核对完整身份、动作与原会话归属。'),
      React.createElement('button', { disabled: reading || querying || cleaning, onClick: () => query(action as 'stop' | 'heartbeat_stop' | 'recording_stop', receipt) }, `只读查询原操作 ${receipt.operationId}`),
      receipt.nativeJsonText && React.createElement('details', null, React.createElement('summary', null, '原操作 SDK 证据'), React.createElement('pre', { style: styles.mono }, receipt.nativeJsonText)))))
}

interface WorkbenchProps {
  remote: any
  sessionId: string
  currentBinding: FieldkitBinding | null
  busy: boolean
  /** document可见性；切换工作页仍保持组件mounted以同步服务元数据。 */
  visible: boolean
  onContextChange?(context: FieldkitControlContext): void
}
const modes = { position: '位置', velocity: '速度', force: '力', impedance: '阻抗' }
const rawLabels = { mm: '群组目标位置（mm）', mm_s: '群组目标速度（mm/s）', n: '群组目标力（N）', equilibrium_mm: '群组平衡位置（mm）', stiffness_n_per_mm: '群组刚度（N/mm）', damping_ns_per_mm: '群组阻尼（N·s/mm）' }
type Raw = Record<keyof typeof rawLabels, string>
const targetCommand = (demand: ControlDemand): FieldkitControlCommand => { const { mode, ...raw } = demand; return { action: mode, ...raw } as FieldkitControlCommand }
function GroupControl({ scope, busy, reason, onCommand }: { scope: FieldkitControlScope; busy: boolean; reason: string | null; onCommand(command: FieldkitControlCommand): Promise<FieldkitControlResult> }) {
  const [mode, setMode] = useState<keyof typeof modes>('position'), [raw, setRaw] = useState<Raw>({ mm: '', mm_s: '', n: '', equilibrium_mm: '', stiffness_n_per_mm: '', damping_ns_per_mm: '' }), [heartbeat, setHeartbeat] = useState<'start' | 'stop' | 'once'>('once')
  const [confirmed, setConfirmed] = useState(''), [pending, setPending] = useState(false), [notice, setNotice] = useState('')
  const context = JSON.stringify([fixedKey(scope), mode, raw, heartbeat, reason, busy]), live = useRef({ context, confirmed: '', pending: false })
  if (live.current.context !== context) live.current = { ...live.current, context, confirmed: '' }
  const command: FieldkitControlCommand = mode === 'position' ? { action: mode, mm: raw.mm } : mode === 'velocity' ? { action: mode, mm_s: raw.mm_s } : mode === 'force' ? { action: mode, n: raw.n } : { action: mode, equilibrium_mm: raw.equilibrium_mm, stiffness_n_per_mm: raw.stiffness_n_per_mm, damping_ns_per_mm: raw.damping_ns_per_mm }
  const fields = Object.keys(command).filter(field => field !== 'action') as (keyof Raw)[]
  const filled = fields.every(field => raw[field].trim()), blocked = busy || pending || !!reason
  const confirm = (kind: string, checked: boolean) => { live.current.confirmed = checked ? `${kind}:${context}` : ''; setConfirmed(live.current.confirmed) }
  const submit = async (kind: 'target' | 'heartbeat') => {
    const token = `${kind}:${context}`
    if (blocked || live.current.pending || live.current.context !== context || confirmed !== token || live.current.confirmed !== token || (kind === 'target' && !filled)) return
    live.current.confirmed = ''; live.current.pending = true; setConfirmed(''); setPending(true)
    try { await onCommand(kind === 'target' ? command : { action: `heartbeat_${heartbeat}` }); setNotice('群组逐台记录已返回；不是原子成功，不证明设备已采用。') }
    catch (error) { setNotice(`群组响应未确认：${errorText(error)}；保留原范围，不自动重试。`) }
    finally { live.current.pending = false; setPending(false) }
  }
  const styles = panelStyles(blocked)
  return React.createElement('section', { style: styles.card }, React.createElement('h2', null, '群组持续目标与心跳'), React.createElement('p', null, `完整固定成员：${membersText(scope)}。每次明确确认全部成员，不借用单台确认。`),
    reason && React.createElement('p', { role: 'status' }, reason),
    React.createElement('select', { 'aria-label': '群组目标模式', value: mode, disabled: blocked, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => { if (Object.hasOwn(modes, event.target.value)) setMode(event.target.value as keyof typeof modes) } }, ...Object.entries(modes).map(([value, label]) => React.createElement('option', { key: value, value }, label))),
    ...fields.map(field => React.createElement('label', { key: field }, rawLabels[field], React.createElement('input', { 'aria-label': rawLabels[field], type: 'text', inputMode: 'decimal', value: raw[field], disabled: blocked, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setRaw({ ...raw, [field]: event.target.value }) }))),
    React.createElement('p', null, '全部原始十进制文字交 SDK 一次采用；到位、超时、切页和停止心跳均不结束持续目标。'),
    React.createElement('label', null, React.createElement('input', { 'aria-label': '确认全部固定成员、群组目标模式及原文参数', type: 'checkbox', checked: confirmed === `target:${context}` && live.current.confirmed === confirmed, disabled: blocked || !filled, onChange: (event: React.ChangeEvent<HTMLInputElement>) => confirm('target', event.target.checked) }), '确认全部固定成员、群组目标模式及原文参数'),
    React.createElement('button', { disabled: blocked || !filled || confirmed !== `target:${context}` || live.current.confirmed !== confirmed, onClick: () => submit('target') }, '提交群组持续目标'),
    React.createElement('select', { 'aria-label': '群组心跳动作', value: heartbeat, disabled: blocked, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => { if (['start', 'stop', 'once'].includes(event.target.value)) setHeartbeat(event.target.value as 'start' | 'stop' | 'once') } }, ...(['start', 'stop', 'once'] as const).map(action => React.createElement('option', { key: action, value: action }, action))),
    React.createElement('p', null, '心跳 start 持续发送，stop 仅停止心跳，once 只发送一次；三者均不替代普通 Stop。'),
    React.createElement('label', null, React.createElement('input', { 'aria-label': '确认全部固定成员及群组心跳动作', type: 'checkbox', checked: confirmed === `heartbeat:${context}` && live.current.confirmed === confirmed, disabled: blocked, onChange: (event: React.ChangeEvent<HTMLInputElement>) => confirm('heartbeat', event.target.checked) }), '确认全部固定成员及群组心跳动作'),
    React.createElement('button', { disabled: blocked || confirmed !== `heartbeat:${context}` || live.current.confirmed !== confirmed, onClick: () => submit('heartbeat') }, '执行群组心跳动作'), notice && React.createElement('p', { role: 'status' }, notice))
}

export function ControlWorkbench({ remote, sessionId, currentBinding, busy, visible, onContextChange }: WorkbenchProps) {
  const [stored, setStored] = useState<{ generation: number; context: FieldkitControlContext; candidates: readonly FieldkitControlCandidate[] }>({ generation: 0, context: emptyContext(), candidates: [] })
  const [selected, setSelected] = useState<string[]>([]), [confirmation, setConfirmation] = useState(''), [notice, setNotice] = useState(''), [working, setWorking] = useState(false)
  const [metadataNotice, setMetadataNotice] = useState('')
  const [recordAction, setRecordAction] = useState<'start' | 'stop'>('start'), [recordConfirmation, setRecordConfirmation] = useState(''), [releaseConfirmation, setReleaseConfirmation] = useState('')
  const journal = useMutationJournal()
  const anonymousKey = (fixed: FieldkitControlScope) => JSON.stringify([sessionId, fixed.scopeId, fixed.instanceId, fixed.members.map(member => targetKey(member.target)).sort()])
  const [receipts, setReceipts] = useState<Record<string, FieldkitControlResult>>({})
  const live = useRef({ sessionId, generation: 0, alive: true }), flight = useRef(false), stopFlights = useRef(new Set<string>()), queryChain = useRef(Promise.resolve()), callback = useRef(onContextChange), reloadLatest = useRef<(() => Promise<void>) | null>(null)
  callback.current = onContextChange
  if (live.current.sessionId !== sessionId) live.current = { ...live.current, sessionId, generation: live.current.generation + 1 }
  const generation = live.current.generation, active = () => live.current.alive && live.current.generation === generation
  const data = stored.generation === generation ? stored : { generation, context: emptyContext(), candidates: [] }, context = data.context
  const scope = context.scopes.find(candidate => candidate.scopeId === context.activeScopeId) ?? null
  const publish = (next: FieldkitControlContext) => { if (active()) { setStored(current => ({ ...current, generation, context: next })); callback.current?.(next) } }
  const refresh = (withCandidates = false) => {
    const run = queryChain.current.catch(() => {}).then(async () => {
      if (!active() || !sessionId) return
      const next: FieldkitControlContext = valueOf(await remote.controlContext(sessionId))
      if (!active()) return
      publish(next)
      if (withCandidates && next.capabilities.includes('control')) {
        const result = valueOf(await remote.controlCandidates(sessionId))
        if (active()) {
          setStored(current => ({ ...current, generation, candidates: result.candidates }))
          setSelected(previous => previous.filter(id => result.candidates.some((candidate: FieldkitControlCandidate) => candidate.candidateId === id)))
          confirmed.current.token = ''; setConfirmation('')
        }
      }
      if (active()) setMetadataNotice('')
    })
    queryChain.current = run.catch(() => {})
    return run
  }
  reloadLatest.current = async () => { try { await refresh() } catch (error) { if (active()) setMetadataNotice(`控制元数据读取失败：${errorText(error)}；原范围和记录保留，不重发。`) } }
  useEffect(() => { live.current.alive = true; return () => { live.current.alive = false } }, [])
  useEffect(() => { setStored({ generation, context: emptyContext(), candidates: [] }); setReceipts({}); setSelected([]); setConfirmation(''); setNotice(''); setMetadataNotice(''); callback.current?.(emptyContext()) }, [sessionId])
  useEffect(() => {
    if (!visible || !sessionId) return
    let cancelled = false, timer: ReturnType<typeof setTimeout> | undefined, initial = true
    const poll = async () => {
      if (cancelled || !active()) return
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        try { await refresh(initial); initial = false } catch (error) { if (active()) setMetadataNotice(`控制元数据读取失败：${errorText(error)}；保留原范围。`) }
      }
      if (active() && !cancelled) timer = setTimeout(poll, 1000)
    }
    void poll(); return () => { cancelled = true; if (timer !== undefined) clearTimeout(timer) }
  }, [sessionId, visible])
  const ordinary = async <T,>(work: () => Promise<T>) => {
    if (busy || flight.current || !active()) throw new Error('普通操作当前不可用。')
    flight.current = true; setWorking(true)
    try { return await work() }
    finally { flight.current = false; if (live.current.alive) setWorking(false); await reloadLatest.current?.() }
  }
  const chosen = data.candidates.filter(candidate => selected.includes(candidate.candidateId))
  const creationContext = JSON.stringify([generation, chosen, context.capabilities, busy, working]), confirmed = useRef({ context: creationContext, token: '' })
  if (confirmed.current.context !== creationContext) confirmed.current = { context: creationContext, token: '' }
  const createReason = !context.capabilities.includes('control') ? '服务未发布 control 调度能力；当前只读。' : !chosen.length || chosen.length !== selected.length ? '请选择完整控制候选。' : new Set(chosen.map(candidate => candidate.uid)).size !== chosen.length || chosen.length > 16 ? '固定范围须为最多16个不同物理 UID。' : chosen.length > 1 && !context.capabilities.includes('control_groups') ? '服务未发布 control_groups。' : null
  const create = async () => {
    if (createReason || confirmation !== creationContext || confirmed.current.token !== creationContext) return
    confirmed.current.token = ''; setConfirmation('')
    try { await ordinary(async () => {
      const fixed: FieldkitControlScope = valueOf(await remote.createControlScope(sessionId, { candidateIds: chosen.map(candidate => candidate.candidateId) }))
      if (active()) { publish({ ...context, scopes: [...context.scopes.filter(item => item.scopeId !== fixed.scopeId), fixed], activeScopeId: fixed.scopeId }); setNotice('固定控制范围已建立；没有自动提交目标或启动心跳。') }
    }) } catch (error) { if (active()) setNotice(`控制范围建立未确认：${errorText(error)}；不自动重试。`) }
  }
  const original = (fixed: FieldkitControlScope) => { if (!active() || !context.scopes.some(item => fixedKey(item) === fixedKey(fixed))) throw new Error('原固定控制范围已变化；不提交新动作。') }
  const remember = (result: FieldkitControlResult) => { if (active()) setReceipts(current => ({ ...current, [result.scopeId]: result })) }
  const mutation = async <T,>(fixed: FieldkitControlScope, work: () => Promise<T>): Promise<T> => {
    original(fixed)
    const blocked = journal.reason(sessionId, anonymousKey(fixed))
    if (blocked) throw new Error(blocked)
    const acknowledge = journal.begin(sessionId, anonymousKey(fixed), 'ordinary')
    try { const result = await work(); acknowledge(); return result }
    catch (error) {
      if (!mutationUncertain(error)) acknowledge()
      else if (active()) setNotice('UI 未取得可关联回执；保留原范围，不重复提交。')
      throw error
    }
  }
  const command = (fixed: FieldkitControlScope, raw: FieldkitControlCommand) => ordinary(() => mutation(fixed, async () => { const result = checkResult(valueOf(await remote.submitControl(sessionId, { scopeId: fixed.scopeId, command: raw })), fixed, raw.action); remember(result); return result }))
  const stop = async (fixed: FieldkitControlScope) => {
    if (!active() || stopFlights.current.has(fixed.scopeId) || !fixed.stopAvailable) throw new Error('原范围 Stop 正在处理或当前不可用。')
    stopFlights.current.add(fixed.scopeId)
    try { const result = checkResult(valueOf(await remote.stopControlScope(sessionId, fixed.scopeId)), fixed, 'stop'); remember(result); return result }
    finally { stopFlights.current.delete(fixed.scopeId); await reloadLatest.current?.() }
  }
  const single = (fixed: FieldkitControlScope, result: FieldkitControlResult, action: ControlReceipt['action']): ControlReceipt => {
    checkResult(result, fixed)
    if (fixed.members.length !== 1) throw new Error('单台回执不能代替完整群组确认。')
    const member = result.results[0]
    return { ...member, operationId: member.operationId ?? undefined, action }
  }
  const [revokeConfirmation, setRevokeConfirmation] = useState('')
  const latest = scope ? scope.latest ?? receipts[scope.scopeId] ?? null : null
  const controlReceipt = scope?.kind === 'single' && latest && ['position', 'velocity', 'force', 'impedance', 'heartbeat_start', 'heartbeat_stop', 'heartbeat_once', 'stop'].includes(latest.action) ? single(scope, latest, ['position', 'velocity', 'force', 'impedance'].includes(latest.action) ? 'target' : latest.action as ControlReceipt['action']) : null
  const reason = !scope ? '尚无固定控制范围。' : journal.reason(sessionId, anonymousKey(scope)) ?? (scope.state !== 'active' || !scope.controlReady ? scope.reason ?? `固定范围为 ${scope.state}；普通动作不可用。` : latest?.unknown ? '原范围包含未知结果；只核对原记录，不提交新目标。' : null)
  const members = scope?.members.map(member => member.target) ?? [], scopeToken = `${generation}:${fixedKey(scope)}`
  const recordingToken = `${scopeToken}:${recordAction}`, intents = useRef({ recordingToken, releaseToken: scopeToken, recording: '', release: '' })
  if (intents.current.recordingToken !== recordingToken) { intents.current.recordingToken = recordingToken; intents.current.recording = '' }
  if (intents.current.releaseToken !== scopeToken) { intents.current.releaseToken = scopeToken; intents.current.release = '' }
  const styles = panelStyles(busy || working)
  const trial = async (work: () => Promise<any>, fixed: FieldkitControlScope): Promise<TrialReceipt> => ordinary(() => mutation(fixed, async () => {
    original(fixed); const receipt: FieldkitTrialReceipt = valueOf(await work())
    if (!sameMembers(receipt.members, fixed)) throw new Error('试验记录与原固定成员不一致。')
    return receipt
  }))
  const trialStop = async (fixed: FieldkitControlScope, trialId: string | null): Promise<TrialReceipt> => {
    const result = await stop(fixed)
    const progress = ['原设备范围的 Stop 记录已返回；没有重发启动。']
    if (trialId) {
      try {
        const receipt: FieldkitTrialReceipt = valueOf(await remote.getControlTrial(sessionId, trialId))
        if (receipt.trialId !== trialId || !sameMembers(receipt.members, fixed)) throw new Error('读取试验记录与原编号或成员不匹配。')
        return receipt
      } catch (error) { progress.push(`试验记录只读查询失败：${errorText(error)}；以下保留已返回的 Stop 提交事实。`) }
    }
    return { members: fixed.members.map(member => member.target), trialId, mode: fixed.trial?.mode ?? 'position', state: result.unknown ? 'result_unknown' : 'stopping', progress, results: result.results.map(member => ({ ...member, preparation: 'not_attempted' })), unknown: result.unknown, stopAvailable: fixed.stopAvailable, recordingIds: fixed.trial?.recordingIds ?? [], newSubmission: result.newSubmission, coalescedExisting: result.coalescedExisting }
  }
  return React.createElement('div', null,
    React.createElement('section', { style: styles.card }, React.createElement('h2', null, '固定控制范围'),
      React.createElement('p', null, `当前观察：${currentBinding?.targetId ?? '无'}。观察对象与固定执行范围独立；切页和选择新观察对象不切换控制成员。`),
      context.scopes.length > 1 && React.createElement('label', null, '明确选择已登记原控制范围 ', React.createElement('select', { value: context.activeScopeId ?? '', onChange: async (event: React.ChangeEvent<HTMLSelectElement>) => { const id = event.target.value; try { publish(valueOf(await remote.selectControlScope(sessionId, id))) } catch (error) { if (active()) setNotice(errorText(error)) } } }, context.scopes.map(item => React.createElement('option', { key: item.scopeId, value: item.scopeId }, `${item.scopeId} · ${membersText(item)} · ${item.state}`)))),
      scope && React.createElement('p', null, `固定范围 ${scope.scopeId}：${membersText(scope)} · ${scope.state}`),
      React.createElement('button', { disabled: busy || working, onClick: async () => { try { await ordinary(() => refresh(true)) } catch (error) { if (active()) setMetadataNotice(`控制元数据读取失败：${errorText(error)}；保留原范围。`) } } }, '刷新控制候选与范围'),
      data.candidates.map(candidate => React.createElement('label', { key: candidate.candidateId, style: { display: 'block' } }, React.createElement('input', { type: 'checkbox', 'aria-label': `控制候选 ${candidate.candidateId}`, checked: selected.includes(candidate.candidateId), disabled: busy || working, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setSelected(event.target.checked ? [...selected.filter(id => id !== candidate.candidateId), candidate.candidateId] : selected.filter(id => id !== candidate.candidateId)) }), `${candidate.label} · UID ${candidate.uid} · run_nonce ${candidate.runNonce} · 代次 ${candidate.connectionGeneration} · 实例 ${candidate.instanceId}`)),
      createReason && React.createElement('p', { role: 'status' }, createReason),
      React.createElement('label', null, React.createElement('input', { 'aria-label': '确认全部所选成员并授权固定控制范围', type: 'checkbox', disabled: busy || working || !!createReason, checked: confirmation === creationContext && confirmed.current.token === creationContext, onChange: (event: React.ChangeEvent<HTMLInputElement>) => { confirmed.current.token = event.target.checked ? creationContext : ''; setConfirmation(confirmed.current.token) } }), `确认全部所选成员 ${chosen.map(candidate => candidate.targetId).join('、') || '无'}，并授权其固定控制范围`),
      React.createElement('button', { disabled: busy || working || !!createReason || confirmation !== creationContext || confirmed.current.token !== creationContext, onClick: create }, '建立固定控制范围'),
      metadataNotice && React.createElement('p', { role: 'status' }, metadataNotice),
      notice && React.createElement('p', { role: 'status' }, notice)),
    scope && React.createElement('section', { style: styles.card }, React.createElement('label', null, React.createElement('input', { type: 'checkbox', checked: revokeConfirmation === fixedKey(scope), disabled: busy || working, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setRevokeConfirmation(event.target.checked ? fixedKey(scope) : '') }), `确认撤销全部原成员 ${membersText(scope)} 的 control 授权（不 Stop、不停心跳、不停止记录；已撤销成员的 Stop 需重新人工授权）`), React.createElement('button', { disabled: busy || working || revokeConfirmation !== fixedKey(scope), onClick: async () => { const fixed = scope; setRevokeConfirmation(''); try { await ordinary(async () => { original(fixed); const next: FieldkitControlScope = valueOf(await remote.revokeControlScope(sessionId, fixed.scopeId)); publish({ ...context, scopes: context.scopes.map(item => item.scopeId === next.scopeId ? next : item) }) }) } catch (error) { if (active()) setNotice(errorText(error)) } } }, '撤销原范围 control 授权')),
    scope?.lastOrdinary && scope.latest?.action === 'stop' && React.createElement(ResultEvidence, { result: scope.lastOrdinary }),
    scope?.recordings?.map(record => React.createElement('details', { key: `record:${targetKey(record.target)}` }, React.createElement('summary', null, `${record.target.targetId} 记录状态：${record.active === null ? '未确认' : record.active ? '活动' : '未活动'} · 失败 ${record.failed === null ? '未确认' : record.failed ? '是' : '否'} · ID ${record.recordingId ?? '无'}`), record.error && React.createElement('p', { role: 'alert' }, `${record.error.code}: ${record.error.message}`), React.createElement('pre', { style: styles.mono }, record.nativeJsonText ?? '无 SDK 原文'))),
    scope?.trial?.results.map(member => member.trialNativeJsonText && React.createElement('details', { key: `trial-evidence:${targetKey(member.target)}` }, React.createElement('summary', null, `${member.target.targetId} 试验 ${member.trialState} · Stop观测 ${member.stopObserved ? '是' : '否'} · 确认超时 ${member.stopConfirmationOverdue ? '是' : '否'} · elapsed_ms ${member.elapsedMs ?? '无'}`), React.createElement('pre', { style: styles.mono }, member.trialNativeJsonText))),
    scope?.kind === 'single' && React.createElement(Control, { key: `control:${scopeToken}`, target: members[0], receipt: controlReceipt, permission: scope.controlGranted === false ? null : { grantId: scope.members[0].grantId, target: members[0], control: true }, gateReason: reason, busy: busy || working, stopGateReason: scope.stopReason ?? (!scope.stopAvailable ? '服务未允许原范围 Stop。' : null),
      onGrant: async () => { await refresh() },
      onTarget: async (request: { demand: ControlDemand }) => single(scope, await command(scope, targetCommand(request.demand)), 'target'),
      onHeartbeat: async (request: { action: 'start' | 'stop' | 'once' }) => single(scope, await command(scope, { action: `heartbeat_${request.action}` }), `heartbeat_${request.action}`),
      onStop: async () => single(scope, await stop(scope), 'stop') }),
    scope?.kind === 'group' && React.createElement(GroupControl, { key: `group:${scopeToken}`, scope, busy: busy || working, reason, onCommand: (raw: FieldkitControlCommand) => command(scope, raw) }),
    scope && React.createElement(ResultEvidence, { result: latest }),
    scope && React.createElement(Trials, { key: `trials:${scopeToken}`, candidates: members, reservation: { reservationId: scope.scopeId, members }, receipt: scope.trial, busy: busy || working, stopGateReason: scope.stopReason ?? (!scope.stopAvailable ? '服务未允许原范围 Stop。' : null), gateReason: reason ?? (!context.capabilities.includes('trials') ? '服务未发布 trials。' : null),
      onStart: (request: { parameters: any; members: readonly FieldkitMaintenanceTarget[] }) => { if (!sameMembers(request.members, scope)) throw new Error('必须明确确认固定范围的全部成员。'); return trial(() => remote.startControlTrial(sessionId, { scopeId: scope.scopeId, parameters: request.parameters }), scope) },
      onUpdate: (request: { trialId: string; positionRaw: string }) => trial(() => remote.updateControlTrial(sessionId, { trialId: request.trialId, positionRaw: request.positionRaw }), scope),
      onTrialStop: (request: { trialId: string }) => trialStop(scope, request.trialId), onScopeStop: () => trialStop(scope, null),
      onRelease: (request: { trialId: string }) => trial(() => remote.releaseControlTrial(sessionId, request.trialId), scope).then(() => {}) }),
    scope && React.createElement('section', { style: styles.card }, React.createElement('h3', null, '服务记录与范围引用'),
      React.createElement('select', { 'aria-label': '固定范围录制动作', value: recordAction, disabled: busy || working, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => { if (['start', 'stop'].includes(event.target.value)) setRecordAction(event.target.value as 'start' | 'stop') } }, React.createElement('option', { value: 'start' }, '开始服务录制'), React.createElement('option', { value: 'stop' }, '结束服务录制')),
      React.createElement('label', null, React.createElement('input', { type: 'checkbox', 'aria-label': '确认全部固定成员的录制动作', disabled: busy || working || !!reason || !context.capabilities.includes('recording_write'), checked: recordConfirmation === recordingToken && intents.current.recording === recordingToken, onChange: (event: React.ChangeEvent<HTMLInputElement>) => { intents.current.recording = event.target.checked ? recordingToken : ''; setRecordConfirmation(intents.current.recording) } }), `确认全部固定成员 ${membersText(scope)} 的录制 ${recordAction}；路径由服务管理`),
      React.createElement('button', { disabled: busy || working || !!reason || !context.capabilities.includes('recording_write') || recordConfirmation !== recordingToken || intents.current.recording !== recordingToken, onClick: async () => {
        if (intents.current.recording !== recordingToken) return
        intents.current.recording = ''; setRecordConfirmation('')
        try { await ordinary(() => mutation(scope, async () => { remember(checkResult(valueOf(await remote.recordControl(sessionId, { scopeId: scope.scopeId, action: recordAction })), scope, `recording_${recordAction}`)) })) } catch (error) { if (active()) setNotice(`录制响应未确认：${errorText(error)}；不重发。`) }
      } }, '执行固定范围录制动作'),
      React.createElement('label', null, React.createElement('input', { type: 'checkbox', 'aria-label': '确认解除整个固定范围引用', disabled: busy || working || scope.state !== 'active', checked: releaseConfirmation === scopeToken && intents.current.release === scopeToken, onChange: (event: React.ChangeEvent<HTMLInputElement>) => { intents.current.release = event.target.checked ? scopeToken : ''; setReleaseConfirmation(intents.current.release) } }), '确认解除整个固定范围引用；不发送 Stop、不断连、不证明设备停止'),
      React.createElement('button', { disabled: busy || working || scope.state !== 'active' || releaseConfirmation !== scopeToken || intents.current.release !== scopeToken, onClick: async () => {
        if (intents.current.release !== scopeToken) return
        intents.current.release = ''; setReleaseConfirmation('')
        try { await ordinary(async () => { original(scope); valueOf(await remote.releaseControlScope(sessionId, scope.scopeId)); if (active()) setNotice('范围引用解除请求已返回；原成员 Stop 入口继续保留。') }) } catch (error) { if (active()) setNotice(`解除范围引用未确认：${errorText(error)}；不重发。`) }
      } }, '解除整个固定范围（不 Stop）')))
}
