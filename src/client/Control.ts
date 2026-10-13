import React, { useRef, useState } from 'react'
import { errorText, panelStyles, text } from './shared.js'
import type { MaintenanceTarget } from './Maintenance.js'

export type ControlTarget = MaintenanceTarget
export interface ControlPermission { grantId: string; target: ControlTarget; control: true }
export type ControlDemand =
  | { mode: 'position'; mm: string }
  | { mode: 'velocity'; mm_s: string }
  | { mode: 'force'; n: string }
  | { mode: 'impedance'; equilibrium_mm: string; stiffness_n_per_mm: string; damping_ns_per_mm: string }
export type HeartbeatAction = 'start' | 'stop' | 'once'
export interface ControlTargetRequest { target: ControlTarget; grantId: string; demand: ControlDemand }
export interface ControlHeartbeatRequest { target: ControlTarget; grantId: string; action: HeartbeatAction }
export interface ControlStopRequest { target: ControlTarget }
export type ControlAction = 'target' | 'heartbeat_start' | 'heartbeat_stop' | 'heartbeat_once' | 'stop'
/** UI facts only. The parent/service owns reservation, wire DTOs, IDs and SDK validation. */
export interface ControlReceipt {
  target: ControlTarget
  action: ControlAction
  operationId?: string
  admission: string
  submission: string
  observation?: string | null
  controlEffect?: string | null
  unknown: boolean
  unknownSource?: 'transport' | 'sdk' | null
  nativeJsonText?: string | null
}
export interface ControlProps {
  target: ControlTarget | null
  permission?: ControlPermission | null
  receipt?: ControlReceipt | null
  gateReason?: string | null
  busy?: boolean
  stopGateReason?: string | null
  stopBusy?: boolean
  onGrant(target: ControlTarget): Promise<void>
  onHeartbeat(request: ControlHeartbeatRequest): Promise<ControlReceipt>
  onTarget(request: ControlTargetRequest): Promise<ControlReceipt>
  onStop(request: ControlStopRequest): Promise<ControlReceipt>
}
const scope = (t: ControlTarget | null) => t ? JSON.stringify([t.instanceId, t.bindingId, t.targetId, t.uid, t.runNonce, t.connectionGeneration]) : ''
const known = (t: ControlTarget | null) => !!t && ['instanceId', 'bindingId', 'targetId', 'uid', 'runNonce', 'connectionGeneration'].every(k => typeof t[k as keyof ControlTarget] === 'string' && t[k as keyof ControlTarget] !== '')
const recordKey = (r: ControlReceipt) => JSON.stringify([scope(r.target), r.action, r.operationId ?? null])
const unknown = (r?: ControlReceipt | null) => !!r && (r.unknown || r.submission === 'submission_unknown' || r.controlEffect === 'unknown' || r.controlEffect === 'unresolved')
const modes = { position: '位置', velocity: '速度', force: '力', impedance: '阻抗' }
const heartbeats: Record<HeartbeatAction, string> = { start: '启动持续心跳', stop: '停止持续心跳', once: '发送单次心跳' }
const fields = {
  mm: '目标位置（mm）', mm_s: '目标速度（mm/s）', n: '目标力（N）', equilibrium_mm: '平衡位置（mm）',
  stiffness_n_per_mm: '刚度（N/mm）', damping_ns_per_mm: '阻尼（N·s/mm）',
}
type RawFields = Record<keyof typeof fields, string>
function demand(mode: ControlDemand['mode'], raw: RawFields): ControlDemand {
  if (mode === 'position') return { mode, mm: raw.mm }
  if (mode === 'velocity') return { mode, mm_s: raw.mm_s }
  if (mode === 'force') return { mode, n: raw.n }
  return { mode, equilibrium_mm: raw.equilibrium_mm, stiffness_n_per_mm: raw.stiffness_n_per_mm, damping_ns_per_mm: raw.damping_ns_per_mm }
}

export function Control(props: ControlProps) {
  const targetScope = scope(props.target)
  const [mode, setMode] = useState<ControlDemand['mode']>('position')
  const [raw, setRaw] = useState<RawFields>({ mm: '', mm_s: '', n: '', equilibrium_mm: '', stiffness_n_per_mm: '', damping_ns_per_mm: '' })
  const [heartbeat, setHeartbeat] = useState<HeartbeatAction>('once')
  const [pending, setPending] = useState(false), [stopPending, setStopPending] = useState(false)
  const [notice, setNotice] = useState(''), [stopNotice, setStopNotice] = useState('')
  const [localReceipt, setLocalReceipt] = useState<ControlReceipt | null>(null), [localStopReceipt, setLocalStopReceipt] = useState<ControlReceipt | null>(null)
  const context = JSON.stringify([scope(props.target), props.permission?.grantId, scope(props.permission?.target ?? null), props.permission?.control, mode, raw, heartbeat, props.gateReason, props.busy])
  const emptyIntent = { context, grant: false, target: false, heartbeat: false }
  const [intent, setIntent] = useState(emptyIntent)
  const live = useRef({ context, identity: scope(props.target), grant: false, target: false, heartbeat: false, busy: false, stopBusy: false, stopBlocked: false })
  const unknownRecords = useRef(new Map<string, ControlReceipt>()), unknownStops = useRef(new Set<string>())
  const trackUnknown = (value: ControlReceipt) => {
    const key = recordKey(value)
    const previous = unknownRecords.current.get(key)
    if (unknown(value)) {
      if (!previous || previous.unknownSource === 'transport') unknownRecords.current.set(key, value)
      if (value.action === 'stop') unknownStops.current.add(scope(value.target))
    } else if (previous?.unknownSource === 'transport' && value.operationId && value.admission === 'finished' && value.submission === 'not_submitted' && value.controlEffect === 'not_attempted' && value.unknown === false) {
      unknownRecords.current.delete(key)
      // Keep the resolved local copy when the parent later displays another operation.
      if (localReceipt && recordKey(localReceipt) === key) setLocalReceipt(value)
      if (localStopReceipt && recordKey(localStopReceipt) === key) setLocalStopReceipt(value)
    }
  }
  const hasUnknown = (uid: string) => [...unknownRecords.current.values()].some(record => record.target.uid === uid)
  const active = intent.context === context ? intent : emptyIntent
  if (intent.context !== context) setIntent(emptyIntent)
  if (live.current.context !== context) live.current = { ...live.current, context, grant: false, target: false, heartbeat: false }
  live.current.identity = scope(props.target)
  live.current.stopBlocked = !!props.stopGateReason || props.stopBusy === true
  const receipt = props.receipt?.action !== 'stop' ? props.receipt ?? localReceipt : localReceipt
  const stopReceipt = props.receipt?.action === 'stop' ? props.receipt : localStopReceipt
  if (receipt) trackUnknown(receipt)
  if (stopReceipt) trackUnknown(stopReceipt)
  const busy = !!props.busy || pending
  const styles = panelStyles(busy), stopStyles = panelStyles(!!props.stopBusy || stopPending)
  const authorized = !!props.permission?.control && !!props.permission.grantId && scope(props.permission.target) === scope(props.target)
  const reason = !known(props.target) ? '缺少当前实例、绑定、身份或连接代次。' : props.gateReason || (busy ? '普通操作正在处理。' : !authorized ? '默认只读；须明确取得当前完整身份的 control 授权。' : hasUnknown(props.target!.uid) ? '该 UID 有未知结果；保留原记录，不重试目标或心跳。' : null)
  const stopReason = !known(props.target) ? '普通 Stop 仍须核对完整身份与代次。' : props.stopGateReason || ((props.stopBusy || stopPending) ? '普通 Stop 正在处理。' : unknownStops.current.has(scope(props.target)) ? '本身份的 Stop 结果未知；保留原请求并人工核对，不重试。' : null)
  const value = demand(mode, raw)
  const keys = Object.keys(value).filter(k => k !== 'mode') as (keyof RawFields)[]
  const filled = keys.every(k => raw[k].trim().length > 0)
  const updateIntent = (field: 'grant' | 'target' | 'heartbeat', checked: boolean) => {
    live.current[field] = checked; setIntent({ ...active, [field]: checked })
  }
  const grant = async () => {
    if (!props.target || !known(props.target) || busy || props.gateReason || !active.grant || !live.current.grant || live.current.busy || live.current.context !== context) return
    live.current.grant = false; live.current.busy = true; setIntent({ ...active, grant: false }); setPending(true)
    try { await props.onGrant({ ...props.target }); setNotice('授权请求已返回；以服务返回的当前身份权限为准。') }
    catch (e) { setNotice(`授权未确认：${errorText(e)}；不会自动重试。`) }
    finally { live.current.busy = false; setPending(false) }
  }
  const submit = async (kind: 'target' | 'heartbeat' | 'stop') => {
    const isStop = kind === 'stop'
    if (!props.target || (isStop ? stopReason || unknownStops.current.has(targetScope) || live.current.stopBusy || live.current.stopBlocked || live.current.identity !== targetScope : reason || hasUnknown(props.target.uid) || !active[kind] || !live.current[kind] || live.current.busy || live.current.context !== context || (kind === 'target' && !filled))) return
    const target = { ...props.target }
    const action: ControlAction = kind === 'heartbeat' ? `heartbeat_${heartbeat}` : kind
    if (isStop) { live.current.stopBusy = true; setStopPending(true); setStopNotice('正在请求普通 Stop；受理不证明设备已停止。') }
    else { live.current[kind] = false; live.current.busy = true; setIntent({ ...active, [kind]: false }); setPending(true); setNotice('正在提交明确确认的请求；不自动重试。') }
    const publish = (result: ControlReceipt) => {
      trackUnknown(result)
      if (isStop) setLocalStopReceipt(result); else setLocalReceipt(result)
      const message = unknown(result) ? '结果未知；保留原请求并人工核对，不重试。' : '操作记录已返回；受理、本地提交和后续观测不能互相替代，也不证明机械停止。'
      if (isStop) setStopNotice(message); else setNotice(message)
    }
    try {
      const result = isStop ? await props.onStop({ target }) : kind === 'heartbeat'
        ? await props.onHeartbeat({ target, grantId: props.permission!.grantId, action: heartbeat })
        : await props.onTarget({ target, grantId: props.permission!.grantId, demand: value })
      if (scope(result.target) !== scope(target) || result.action !== action) throw new Error('返回记录与本次目标或动作不一致。')
      publish(result)
    } catch (e) { publish({ target, action, admission: 'unknown', submission: 'submission_unknown', unknown: true, unknownSource: 'transport', nativeJsonText: errorText(e) }) }
    finally { if (isStop) { live.current.stopBusy = false; setStopPending(false) } else { live.current.busy = false; setPending(false) } }
  }
  const summary = props.target ? `${props.target.targetId}；UID ${props.target.uid}；run_nonce ${props.target.runNonce}；代次 ${props.target.connectionGeneration}；实例 ${props.target.instanceId}` : '尚未选择目标。'
  const confirmation = (field: 'target' | 'heartbeat', label: string, disabled: boolean) => React.createElement('label', { style: { display: 'block' } }, React.createElement('input', { type: 'checkbox', 'aria-label': label, checked: active[field] && live.current[field], disabled, onChange: (e: React.ChangeEvent<HTMLInputElement>) => updateIntent(field, e.target.checked) }), label)
  const resultView = (r: ControlReceipt | null) => r && React.createElement('div', null,
    React.createElement('p', null, `记录目标 ${r.target.targetId}；UID ${r.target.uid}；run_nonce ${r.target.runNonce}；代次 ${r.target.connectionGeneration}；实例 ${r.target.instanceId}；动作 ${r.action}；编号 ${text(r.operationId)}`),
    React.createElement('p', null, `受理：${r.admission}；本地提交：${r.submission}；后续观测：${text(r.observation)}`),
    React.createElement('p', { role: unknown(r) ? 'alert' : undefined }, `设备效果${unknown(r) ? '未知' : '未由本记录证明'}：${text(r.controlEffect)}`),
    r.nativeJsonText && React.createElement('details', null, React.createElement('summary', null, '原始结果证据'), React.createElement('pre', { style: styles.mono }, r.nativeJsonText)))
  return React.createElement('section', { style: styles.card, 'aria-label': '控制权限与持续目标' },
    React.createElement('h2', null, '控制'), React.createElement('p', null, summary),
    React.createElement('p', null, '默认只读。到位、超时、切页、解绑、停止心跳及关闭界面均不结束持续目标；服务端校验权限、控制占用、身份与代次。'),
    React.createElement('label', null, React.createElement('input', { type: 'checkbox', 'aria-label': '明确申请当前目标控制权限', checked: active.grant && live.current.grant, disabled: busy || !known(props.target) || !!props.gateReason, onChange: (e: React.ChangeEvent<HTMLInputElement>) => updateIntent('grant', e.target.checked) }), ' 明确申请当前完整身份的 control 授权'),
    React.createElement('button', { style: styles.button, disabled: busy || !known(props.target) || !!props.gateReason || !active.grant, onClick: grant }, '申请控制权限'),
    React.createElement('p', null, `权限：${authorized ? '当前完整身份已获 control 授权' : '只读或权限与身份不匹配'}`),
    React.createElement('h3', null, '持续目标'),
    React.createElement('label', null, '目标模式 ', React.createElement('select', { 'aria-label': '目标模式', value: mode, disabled: busy, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => { if (Object.hasOwn(modes, e.target.value)) setMode(e.target.value as ControlDemand['mode']) } }, ...Object.entries(modes).map(([key, label]) => React.createElement('option', { key, value: key }, label)))),
    ...keys.map(key => React.createElement('label', { key, style: { display: 'block' } }, fields[key], React.createElement('input', { type: 'text', inputMode: 'decimal', 'aria-label': fields[key], value: raw[key], disabled: busy, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setRaw({ ...raw, [key]: e.target.value }) }))),
    React.createElement('p', null, '原始十进制文本直接交给 SDK 一次采用；页面不将显示值重建为请求，也不另设物理范围。目标提交仅提供本地提交事实，不表示已经到位。'),
    reason && React.createElement('p', { role: 'status' }, reason),
    confirmation('target', '确认当前身份、目标模式及全部原始参数', !!reason || !filled),
    React.createElement('button', { style: styles.button, disabled: !!reason || !filled || !active.target || !live.current.target, onClick: () => submit('target') }, '提交持续目标'),
    React.createElement('h3', null, '心跳'), React.createElement('p', null, '启动会持续发送心跳；停止仅停止心跳，不发送 Stop；单次只发送一次心跳，不启动后台循环。'),
    React.createElement('select', { 'aria-label': '心跳动作', value: heartbeat, disabled: busy, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => { if (Object.hasOwn(heartbeats, e.target.value)) setHeartbeat(e.target.value as HeartbeatAction) } }, ...Object.entries(heartbeats).map(([key, label]) => React.createElement('option', { key, value: key }, label))),
    confirmation('heartbeat', `确认当前身份并${heartbeats[heartbeat]}`, !!reason),
    React.createElement('button', { style: styles.button, disabled: !!reason || !active.heartbeat || !live.current.heartbeat, onClick: () => submit('heartbeat') }, '执行心跳动作'),
    notice && React.createElement('p', { role: 'status' }, notice), resultView(receipt),
    React.createElement('h3', null, '普通 Stop'), React.createElement('p', null, '这是普通停止请求，不是急停。独立于普通读取、模型和目标提交；不受其他对话控制占用阻挡，仍由服务核对身份与代次。本地提交不证明机械停止。'),
    stopReason && React.createElement('p', { role: 'status' }, stopReason),
    React.createElement('button', { style: stopStyles.button, disabled: !!stopReason, onClick: () => submit('stop') }, '请求普通 Stop'),
    stopNotice && React.createElement('p', { role: 'status' }, stopNotice), resultView(stopReceipt))
}
