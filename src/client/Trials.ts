import React, { useRef, useState } from 'react'
import { errorText, panelStyles, text } from './shared.js'

export interface TrialTarget { instanceId: string; bindingId: string; targetId: string; uid: string; runNonce: string; connectionGeneration: string }
export type TrialMode = 'position' | 'velocity' | 'force' | 'impedance'
/** UI strings only. The injected service validates and adopts the original decimals. */
export interface TrialParameters {
  mode: TrialMode
  command: { positionMm: string; velocityMmS: string; forceN: string; equilibriumMm: string; stiffnessNPerMm: string; dampingNsPerMm: string }
  envelope: { positionMinMm: string; positionMaxMm: string; velocityAbsMaxMmS: string; forceAbsMaxN: string; stiffnessMaxNPerMm: string; dampingMaxNsPerMm: string; durationMaxS: string }
  durationS: string
  reach: { toleranceMm: string; settleMs: string } | null
}
export interface TrialScope { members: readonly TrialTarget[] }
export interface TrialReference extends TrialScope { trialId: string }
export interface TrialMemberResult { target: TrialTarget; preparation: string; admission: string; submission: string; observation: string | null; unknown: boolean; nativeJsonText?: string | null; operationId?: string | null; unknownSource?: 'transport' | 'sdk' | null; controlEffect?: string | null }
export interface TrialReceipt extends TrialScope {
  trialId: string | null
  statusRead?: 'not_read' | 'available' | 'unavailable' | 'historical'
  statusReason?: string | null
  referenceReleased?: boolean
  mode: TrialMode
  state: string
  progress: readonly string[]
  results: readonly TrialMemberResult[]
  unknown: boolean
  stopAvailable: boolean
  recordingIds: readonly string[]
  newSubmission?: boolean
  coalescedExisting?: boolean
}
export interface TrialStartRequest extends TrialScope { reservationId: string; parameters: TrialParameters }
export interface TrialsProps {
  candidates: readonly TrialTarget[]
  reservation?: { reservationId: string; members: readonly TrialTarget[] } | null
  receipt?: TrialReceipt | null
  busy?: boolean
  gateReason?: string | null
  historyReason?: string | null
  /** Only explicit original-scope Stop gates; never ordinary busy or read gates. */
  stopGateReason?: string | null
  onStart(request: TrialStartRequest): Promise<TrialReceipt>
  onUpdate(request: TrialReference & { positionRaw: string }): Promise<TrialReceipt>
  onTrialStop(request: TrialReference): Promise<TrialReceipt>
  onScopeStop(request: TrialScope): Promise<TrialReceipt>
  onRelease(request: TrialReference): Promise<void>
}
const key = (t: TrialTarget) => JSON.stringify([t.instanceId, t.bindingId, t.targetId, t.uid, t.runNonce, t.connectionGeneration])
const scopeKey = (members: readonly TrialTarget[]) => JSON.stringify(members.map(key).sort())
const copy = (members: readonly TrialTarget[]) => members.map(t => ({ ...t }))
const complete = (t: TrialTarget) => Object.values(t).length >= 6 && [t.instanceId, t.bindingId, t.targetId, t.uid, t.runNonce, t.connectionGeneration].every(v => typeof v === 'string' && v.length > 0)
const commandFields = { position: ['positionMm'], velocity: ['velocityMmS'], force: ['forceN'], impedance: ['equilibriumMm', 'stiffnessNPerMm', 'dampingNsPerMm'] } as const
const commandLabels: Record<keyof TrialParameters['command'], string> = { positionMm: '位置 mm', velocityMmS: '速度 mm/s', forceN: '力 N', equilibriumMm: '平衡位置 mm', stiffnessNPerMm: '刚度 N/mm', dampingNsPerMm: '阻尼 Ns/mm' }
const envelopeLabels: Record<keyof TrialParameters['envelope'], string> = { positionMinMm: '位置下限 mm', positionMaxMm: '位置上限 mm', velocityAbsMaxMmS: '速度绝对上限 mm/s', forceAbsMaxN: '力绝对上限 N', stiffnessMaxNPerMm: '刚度上限 N/mm', dampingMaxNsPerMm: '阻尼上限 Ns/mm', durationMaxS: '最长试验时长 s' }
const initial: TrialParameters = { mode: 'position', command: { positionMm: '', velocityMmS: '', forceN: '', equilibriumMm: '', stiffnessNPerMm: '', dampingNsPerMm: '' }, envelope: { positionMinMm: '', positionMaxMm: '', velocityAbsMaxMmS: '', forceAbsMaxN: '', stiffnessMaxNPerMm: '', dampingMaxNsPerMm: '', durationMaxS: '' }, durationS: '', reach: null }
const memberUnknown = (v: TrialMemberResult) => v.unknown || v.submission === 'unknown' || v.submission === 'submission_unknown' || v.controlEffect === 'unresolved'
const unknown = (r: TrialReceipt) => r.unknown || r.results.some(memberUnknown)
const notSubmitted = (v: TrialMemberResult) => v.admission === 'finished' && v.submission === 'not_submitted' && v.controlEffect === 'not_attempted' && v.unknown === false
const allNotSubmitted = (r: TrialReceipt) => !unknown(r) && r.members.length > 0 && r.results.length === r.members.length && r.members.every(t => r.results.filter(v => key(v.target) === key(t) && notSubmitted(v)).length === 1)
function checkReceipt(r: TrialReceipt, members: readonly TrialTarget[], trialId?: string) {
  if (scopeKey(r.members) !== scopeKey(members) || (trialId !== undefined && r.trialId !== trialId) || r.results.some(v => !members.some(t => key(t) === key(v.target)))) throw new Error('试验结果与原始成员或试验编号不匹配。')
}

export function Trials(props: TrialsProps) {
  const [selected, setSelected] = useState<string[]>([]), [parameters, setParameters] = useState<TrialParameters>(initial)
  const [confirmation, setConfirmation] = useState(''), [position, setPosition] = useState(''), [notice, setNotice] = useState('')
  const [pending, setPending] = useState(false), [stopping, setStopping] = useState<string[]>([])
  const [history, setHistory] = useState<{ action: string; receipt: TrialReceipt }[]>([])
  const [latest, setLatest] = useState<{ order: number; receipt: TrialReceipt } | null>(null)
  const flight = useRef(false), stopFlights = useRef(new Set<string>()), unknownRecords = useRef(new Map<string, TrialMemberResult>()), order = useRef(0)
  const liveContext = useRef(''), confirmed = useRef(''), stopGate = useRef(props.stopGateReason)
  stopGate.current = props.stopGateReason
  const trackUnknown = (r: TrialReceipt) => {
    const track = (v: TrialMemberResult) => {
      const recordKey = JSON.stringify([key(v.target), v.operationId ?? null])
      const previous = unknownRecords.current.get(recordKey)
      if (memberUnknown(v)) {
        // SDK and anonymous evidence cannot be downgraded to a recoverable transport failure.
        if (!previous || previous.unknownSource === 'transport') unknownRecords.current.set(recordKey, v)
      } else if (previous?.unknownSource === 'transport' && v.operationId && notSubmitted(v)) unknownRecords.current.delete(recordKey)
    }
    r.results.forEach(track)
    if (r.unknown) {
      const unexplained = !r.results.some(memberUnknown)
      for (const target of r.members) if (unexplained || !r.results.some(v => key(v.target) === key(target))) track({ target, preparation: 'unknown', admission: 'unknown', submission: 'unknown', observation: null, unknown: true })
    }
  }
  const blocked = (targets: readonly TrialTarget[]) => [...unknownRecords.current.values()].some(v => targets.some(t => t.uid === v.target.uid))
  const members = props.candidates.filter(t => selected.includes(key(t)))
  const memberScope = scopeKey(members)
  const context = JSON.stringify([memberScope, parameters, props.reservation, props.gateReason, props.receipt?.trialId, props.receipt?.members, props.receipt?.state, props.receipt?.statusRead, props.historyReason])
  if (liveContext.current !== context) { liveContext.current = context; confirmed.current = '' }
  const receipt = props.receipt ?? latest?.receipt ?? null
  if (receipt) trackUnknown(receipt)
  const busy = props.busy === true || pending
  const styles = panelStyles(busy)
  const matchingReservation = !!props.reservation?.reservationId && scopeKey(props.reservation.members) === memberScope
  const paramsPresent = commandFields[parameters.mode].every(k => parameters.command[k].trim()) && Object.values(parameters.envelope).every(v => v.trim()) && parameters.durationS.trim() && (!parameters.reach || parameters.reach.toleranceMm.trim() && parameters.reach.settleMs.trim())
  const statusGate = props.historyReason ?? (receipt?.statusRead === 'unavailable' || receipt?.statusRead === 'historical' ? receipt.statusReason ?? '当前试验状态尚未核对；请刷新原范围状态。' : null)
  const reason = props.gateReason || statusGate || (!members.length || members.length !== selected.length || !members.every(complete) || new Set(members.map(t => t.uid)).size !== members.length ? '请明确选择完整且不重复的原始成员。' : !matchingReservation ? '须由服务为这些精确成员提供控制占用。' : blocked(members) ? '成员存在未知效果，不能重试或提交新目标。' : receipt && !allNotSubmitted(receipt) && !['idle', 'completed', 'failed', 'released'].includes(receipt.state) && receipt.members.some(t => members.some(m => m.uid === t.uid)) ? '原成员已有活动或未决试验；请先核对原记录。' : !paramsPresent ? '请填写本次目标、限值与时长原文；数值有效性由 SDK 校验。' : null)
  const canStart = !busy && !reason && confirmation === context && confirmed.current === context
  const originalCurrent = receipt && receipt.members.every(t => props.candidates.some(c => key(c) === key(t))) && scopeKey(receipt.members) === memberScope
  const canUpdate = !!receipt?.trialId && receipt.mode === 'position' && receipt.state === 'active' && !unknown(receipt) && !blocked(receipt.members) && originalCurrent && matchingReservation && !props.gateReason && !statusGate && !busy && !!position.trim()
  const retain = (action: string, result: TrialReceipt, sequence: number) => {
    trackUnknown(result)
    setHistory(previous => [...previous, { action, receipt: result }])
    setLatest(previous => !previous || previous.order <= sequence ? { order: sequence, receipt: result } : previous)
  }
  const unresolved = (members: readonly TrialTarget[], mode: TrialMode, trialId: string | null, error: unknown): TrialReceipt => ({ members: copy(members), trialId, mode, state: 'result_unknown', progress: [errorText(error)], results: [], unknown: true, stopAvailable: true, recordingIds: [] })
  const start = async () => {
    if (!canStart || blocked(members) || flight.current || liveContext.current !== context || confirmed.current !== context || !props.reservation) return
    flight.current = true; confirmed.current = ''; setConfirmation(''); setPending(true)
    const fixed = copy(members), sequence = ++order.current
    // Keep a fixed device scope immediately: a lost start response must not remove manual Stop.
    const pendingReceipt: TrialReceipt = { members: fixed, trialId: null, mode: parameters.mode, state: 'preparing', progress: ['已请求预检，等待服务事实。'], results: [], unknown: false, stopAvailable: true, recordingIds: [] }
    setLatest({ order: sequence, receipt: pendingReceipt }); setHistory(previous => [...previous, { action: '启动等待', receipt: pendingReceipt }])
    try {
      const result = await props.onStart({ members: fixed, reservationId: props.reservation.reservationId, parameters: { ...parameters, command: { ...parameters.command }, envelope: { ...parameters.envelope }, reach: parameters.reach ? { ...parameters.reach } : null } })
      checkReceipt(result, fixed); retain('启动试验', result, sequence); setNotice('试验记录已返回；逐台预检、提交与设备效果分别判断。')
    } catch (error) { retain('启动试验结果未知', unresolved(fixed, parameters.mode, null, error), sequence); setNotice('启动结果未知；不重试，可按原设备范围人工请求停止。') }
    finally {
      // Retire only this call's synthetic waiting row; retain every actual receipt.
      setHistory(previous => previous.filter(entry => entry.receipt !== pendingReceipt))
      flight.current = false; setPending(false)
    }
  }
  const update = async () => {
    if (!canUpdate || !receipt?.trialId || blocked(receipt.members) || flight.current || liveContext.current !== context) return
    flight.current = true; setPending(true)
    const fixed = copy(receipt.members), trialId = receipt.trialId, raw = position, sequence = ++order.current
    try { const result = await props.onUpdate({ trialId, members: fixed, positionRaw: raw }); checkReceipt(result, fixed, trialId); retain('更新位置', result, sequence); setNotice('位置更新已返回；不代表设备已经到位。') }
    catch (error) { retain('位置更新结果未知', unresolved(fixed, receipt.mode, trialId, error), sequence); setNotice('位置更新结果未知；不重发。') }
    finally { flight.current = false; setPending(false) }
  }
  const stop = async (original: TrialReceipt) => {
    const stopKey = scopeKey(original.members)
    if (!original.stopAvailable || stopGate.current || stopFlights.current.has(stopKey)) return
    stopFlights.current.add(stopKey); setStopping([...stopFlights.current])
    const fixed = copy(original.members), sequence = ++order.current
    try {
      const result = original.trialId ? await props.onTrialStop({ trialId: original.trialId, members: fixed }) : await props.onScopeStop({ members: fixed })
      checkReceipt(result, fixed, original.trialId ?? undefined); retain('显式停止请求', result, sequence); setNotice('已返回停止请求证据；本地提交不证明设备停止。')
    } catch (error) { retain('停止结果未知', unresolved(fixed, original.mode, original.trialId, error), sequence); setNotice('停止结果未知；未自动重试，原试验与成员事实保留。') }
    finally { stopFlights.current.delete(stopKey); setStopping([...stopFlights.current]) }
  }
  const release = async () => {
    if (!receipt?.trialId || busy || flight.current) return
    flight.current = true; setPending(true)
    try { await props.onRelease({ trialId: receipt.trialId, members: copy(receipt.members) }); setNotice('已请求释放原试验引用；不发送 Stop，不证明设备停止。') }
    catch (error) { setNotice(`释放结果未确定：${errorText(error)}；不重试。`) }
    finally { flight.current = false; setPending(false) }
  }
  const input = (label: string, raw: string, onChange: (value: string) => void) => React.createElement('label', { key: label, style: { display: 'block' } }, label, React.createElement('input', { 'aria-label': label, type: 'text', inputMode: 'decimal', value: raw, disabled: busy, onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value), style: { color: 'inherit', background: 'var(--dsh-bg, transparent)' } }))
  return React.createElement('section', { style: styles.card, 'aria-label': '单台与群组试验' },
    React.createElement('h2', null, '单台 / 群组试验'),
    React.createElement('p', null, '逐台预检不承诺群组原子执行。限值、时长和到位条件由 SDK 校验；关闭页面、释放引用或停止绘图均不等于 Stop。'),
    props.candidates.map(t => React.createElement('label', { key: key(t), style: { display: 'block' } }, React.createElement('input', { type: 'checkbox', 'aria-label': `试验成员 ${t.targetId}`, checked: selected.includes(key(t)), disabled: busy, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSelected(e.target.checked ? [...selected.filter(k => k !== key(t) && props.candidates.some(c => key(c) === k)), key(t)] : selected.filter(k => k !== key(t))) }), `${t.targetId} · UID ${t.uid} · run_nonce ${t.runNonce} · 代次 ${t.connectionGeneration} · 实例 ${t.instanceId}`)),
    React.createElement('p', null, `明确成员：${members.map(t => t.targetId).join('、') || '未选择'}（${members.length} 台）`),
    React.createElement('label', null, '试验模式', React.createElement('select', { 'aria-label': '试验模式', value: parameters.mode, disabled: busy, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => { if (Object.hasOwn(commandFields, e.target.value)) setParameters({ ...parameters, mode: e.target.value as TrialMode }) } }, ...(['position', 'velocity', 'force', 'impedance'] as const).map(mode => React.createElement('option', { key: mode, value: mode }, mode)))),
    commandFields[parameters.mode].map(k => input(commandLabels[k], parameters.command[k], value => setParameters({ ...parameters, command: { ...parameters.command, [k]: value } }))),
    React.createElement('h3', null, '本次试验范围'),
    (Object.keys(envelopeLabels) as (keyof TrialParameters['envelope'])[]).map(k => input(envelopeLabels[k], parameters.envelope[k], value => setParameters({ ...parameters, envelope: { ...parameters.envelope, [k]: value } }))),
    input('试验时长 s', parameters.durationS, value => setParameters({ ...parameters, durationS: value })),
    React.createElement('label', null, React.createElement('input', { type: 'checkbox', 'aria-label': '启用到位条件', checked: !!parameters.reach, disabled: busy, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setParameters({ ...parameters, reach: e.target.checked ? { toleranceMm: '', settleMs: '' } : null }) }), '启用 SDK 到位条件'),
    parameters.reach && input('到位容差 mm', parameters.reach.toleranceMm, value => setParameters({ ...parameters, reach: { ...parameters.reach!, toleranceMm: value } })),
    parameters.reach && input('到位持续时间 ms', parameters.reach.settleMs, value => setParameters({ ...parameters, reach: { ...parameters.reach!, settleMs: value } })),
    reason && React.createElement('p', { role: 'status' }, reason),
    React.createElement('label', null, React.createElement('input', { type: 'checkbox', 'aria-label': '确认试验成员与原文参数', checked: confirmation === context && confirmed.current === context, disabled: busy || !!reason, onChange: (e: React.ChangeEvent<HTMLInputElement>) => { confirmed.current = e.target.checked ? context : ''; setConfirmation(confirmed.current) } }), '确认上述固定成员、目标和本次限值原文'),
    React.createElement('button', { disabled: !canStart, onClick: start }, '预检并启动试验'),
    input('更新位置原文 mm', position, setPosition), React.createElement('button', { disabled: !canUpdate, onClick: update }, '更新原试验位置'),
    receipt && !originalCurrent && React.createElement('p', { role: 'alert' }, '当前选择或身份已变化；禁止给原试验提交新目标，原始范围停止入口和结果仍保留。'),
    receipt && React.createElement('button', { disabled: busy || !receipt.trialId, onClick: release }, '释放原试验引用（不 Stop）'),
    notice && React.createElement('p', { role: 'status' }, notice),
    React.createElement('h3', null, '原始试验与逐台证据'),
    [...history, ...(receipt && !history.some(h => h.receipt === receipt) ? [{ action: props.historyReason || receipt.statusRead === 'historical' ? '历史试验' : receipt.referenceReleased && receipt.state === 'completed' && receipt.statusRead === 'available' && !unknown(receipt) ? '已完成试验记录（引用已释放）' : receipt.statusRead === 'available' ? '服务最近读取的试验' : receipt.statusRead === 'unavailable' ? '试验状态读取未完成' : '试验操作回执（当前状态未核对）', receipt }] : [])].map(({ action, receipt: r }, i) => React.createElement('div', { key: i, style: styles.card },
      React.createElement('p', null, `${action}${r === receipt ? '' : '（原动作回执，非当前试验状态）'} · 试验 ${text(r.trialId)} · ${props.historyReason || r.statusRead === 'historical' || r.statusRead === 'unavailable' ? '最后已知状态 ' : '已登记状态 '}${r.state} · 成员 ${r.members.map(t => `${t.targetId}/${t.uid}/${t.runNonce}/${t.connectionGeneration}`).join('、')}`),
      r.referenceReleased && React.createElement('p', null, '原试验引用已释放；不代表试验结束或设备停止，状态仍以 SDK 读取事实为准。'),
      (props.historyReason || r.statusReason) && React.createElement('p', { role: 'status' }, props.historyReason ?? r.statusReason),
      React.createElement('p', { role: unknown(r) ? 'alert' : undefined }, unknown(r) ? '设备效果未知；后续观测或切换身份不能清除本记录。' : '受理和提交不证明设备执行或停止。'),
      r.progress.map((p, n) => React.createElement('p', { key: n }, `预检 / 进度：${p}`)),
      r.results.map((v, n) => React.createElement('div', { key: n }, React.createElement('p', null, `${v.target.targetId} · 准备 ${v.preparation} · 受理 ${v.admission} · 操作 ${text(v.operationId)} · 本地提交 ${v.submission} · 控制效果 ${text(v.controlEffect)} · 未知来源 ${text(v.unknownSource)} · 后续观测 ${text(v.observation)} · 未知 ${v.unknown ? '是' : '否'}`), v.nativeJsonText && React.createElement('pre', { style: styles.mono }, v.nativeJsonText))),
      r.coalescedExisting && React.createElement('p', null, '沿用已有停止请求；没有再次提交。'),
      r.newSubmission === false && React.createElement('p', null, '本次响应未新增提交（查询或沿用记录也会如此）；原操作的本地提交事实见逐台记录。'),
      React.createElement('p', null, `关联记录：${r.recordingIds.join('、') || '服务尚未提供记录编号'}`),
      (props.stopGateReason || !r.stopAvailable) && React.createElement('p', { role: 'status' }, props.stopGateReason ?? '服务未允许此原试验范围请求 Stop。'),
      React.createElement('button', { disabled: !!props.stopGateReason || !r.stopAvailable || stopping.includes(scopeKey(r.members)), onClick: () => stop(r) }, r.trialId ? '显式停止原试验' : '按原设备范围请求停止（试验结果未知）'))))
}
