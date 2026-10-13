import React, { useRef, useState } from 'react'
import { errorText, panelStyles, text } from './shared.js'

export type MaintenanceAction = 'save_and_restart' | 'restore_factory_and_restart' | 'reset_application' | 'enter_update'
export interface MaintenanceTarget {
  instanceId: string
  bindingId: string
  targetId: string
  uid: string
  runNonce: string
  connectionGeneration: string
}
export interface MaintenancePermission { grantId: string; target: MaintenanceTarget; maintenance: true }
export interface MaintenanceRequest { target: MaintenanceTarget; grantId: string; action: MaintenanceAction; rawRecordText?: string }
/** UI projection only; the service owns wire DTOs, request IDs and mutation semantics. */
export interface MaintenanceReceipt {
  target: MaintenanceTarget
  action: MaintenanceAction
  operationId?: string
  admission: string
  submission: string
  observation?: string | null
  controlEffect?: string | null
  unknown: boolean
  unknownSource?: 'transport' | 'sdk' | null
  nativeJsonText?: string | null
}
export interface MaintenanceProps {
  target: MaintenanceTarget | null
  permission?: MaintenancePermission | null
  rawText: string
  validation?: { rawText: string; valid: boolean; summary: string } | null
  gateReason?: string | null
  actionReasons?: Partial<Record<MaintenanceAction, string | null>>
  recoveryPath?: string
  receipt?: MaintenanceReceipt | null
  busy?: boolean
  onEnable(target: MaintenanceTarget): Promise<void>
  onDisable?(permission: MaintenancePermission): Promise<void>
  onSubmit(request: MaintenanceRequest): Promise<MaintenanceReceipt>
  onReconnect?(target: MaintenanceTarget): Promise<void>
  onReadback?(target: MaintenanceTarget, view: 'user' | 'startup'): Promise<void>
}

const actions: Record<MaintenanceAction, string> = {
  save_and_restart: '保存完整配置并重启', restore_factory_and_restart: '恢复出厂配置并重启',
  reset_application: '复位应用', enter_update: '进入更新入口',
}
const scope = (target: MaintenanceTarget | null) => target ? JSON.stringify([target.instanceId, target.bindingId, target.targetId, target.uid, target.runNonce, target.connectionGeneration]) : ''
const knownTarget = (target: MaintenanceTarget | null) => !!target && ['instanceId', 'bindingId', 'targetId', 'uid', 'runNonce', 'connectionGeneration'].every(key => typeof target[key as keyof MaintenanceTarget] === 'string' && target[key as keyof MaintenanceTarget] !== '')
const unknownReceipt = (receipt: MaintenanceReceipt | null | undefined) => !!receipt && (receipt.unknown || receipt.submission === 'submission_unknown' || receipt.controlEffect === 'unresolved')
export function maintenanceDisabledReason(props: MaintenanceProps, action: MaintenanceAction) {
  if (!knownTarget(props.target)) return '缺少当前目标的完整实例、身份或连接代次。'
  if (props.busy) return '当前操作正在处理。'
  if (props.gateReason) return props.gateReason
  if (props.actionReasons?.[action]) return props.actionReasons[action]!
  if (unknownReceipt(props.receipt) && props.receipt!.target.uid === props.target!.uid) return '该 UID 的设备效果未知；保留原记录并人工核对，不重试。'
  if (!props.permission?.maintenance || !props.permission.grantId || scope(props.permission.target) !== scope(props.target)) return '默认只读；须为当前完整身份明确启用维护权限。'
  if (action === 'save_and_restart' && (!props.rawText || props.validation?.valid !== true || props.validation.rawText !== props.rawText)) return '当前完整候选原文尚未通过 SDK 校验。'
  if (action === 'enter_update' && !props.recoveryPath?.trim()) return '进入更新入口前须明确已交付的恢复路径。'
  return null
}

export function Maintenance(props: MaintenanceProps) {
  const [action, setAction] = useState<MaintenanceAction>('save_and_restart')
  const context = JSON.stringify([scope(props.target), props.permission?.grantId ?? '', scope(props.permission?.target ?? null), props.permission?.maintenance ?? false, action, props.rawText, props.validation?.rawText, props.validation?.valid, props.gateReason, props.actionReasons?.[action], props.recoveryPath])
  const emptyIntent = { context, enable: false, recovery: false, confirmed: false }
  const [intent, setIntent] = useState(emptyIntent)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState('')
  const [localReceipt, setLocalReceipt] = useState<MaintenanceReceipt | null>(null)
  const live = useRef({ context, confirmed: false, busy: false })
  const unknownRecords = useRef(new Map<string, MaintenanceReceipt>())
  const trackUnknown = (value: MaintenanceReceipt) => {
    const key = JSON.stringify([scope(value.target), value.action, value.operationId ?? null])
    const previous = unknownRecords.current.get(key)
    if (unknownReceipt(value)) {
      if (!previous || previous.unknownSource === 'transport') unknownRecords.current.set(key, value)
    } else if (previous?.unknownSource === 'transport' && value.operationId && value.admission === 'finished' && value.submission === 'not_submitted' && value.controlEffect === 'not_attempted' && value.unknown === false) {
      unknownRecords.current.delete(key)
    }
  }
  const active = intent.context === context ? intent : emptyIntent
  if (intent.context !== context) setIntent(emptyIntent)
  if (live.current.context !== context) live.current = { context, confirmed: false, busy: live.current.busy }
  const receipt = props.receipt ?? localReceipt
  if (receipt) trackUnknown(receipt)
  const busy = props.busy === true || pending
  const styles = panelStyles(busy)
  const disabledReason = maintenanceDisabledReason({ ...props, busy }, action)
    ?? (props.target && [...unknownRecords.current.values()].some(record => record.target.uid === props.target!.uid) ? '该 UID 的设备效果未知；原未决事实不会因重连、重新授权或后续观测而清除。' : null)
  const checked = active.confirmed && live.current.confirmed
  const canSubmit = !disabledReason && checked && (action !== 'enter_update' || active.recovery)
  const updateIntent = (field: 'enable' | 'recovery' | 'confirmed', value: boolean) => {
    if (field === 'confirmed') live.current.confirmed = value
    setIntent({ ...active, [field]: value })
  }
  const humanAction = async (work: () => Promise<void>) => {
    if (busy || live.current.busy) return
    live.current.busy = true; setPending(true)
    try { await work(); setNotice('操作已返回；请查看当前身份与来源证据。') }
    catch (error) { setNotice(`核对操作未完成：${errorText(error)}`) }
    finally { live.current.busy = false; setPending(false) }
  }
  const submit = async () => {
    if (!canSubmit || !props.target || !props.permission || live.current.context !== context || !live.current.confirmed || live.current.busy) return
    const target = { ...props.target }, grantId = props.permission.grantId
    live.current.confirmed = false; live.current.busy = true
    setIntent({ ...active, confirmed: false }); setPending(true); setNotice('正在提交已明确确认的动作；不会自动重试。')
    try {
      const result = await props.onSubmit({ target, grantId, action, ...(action === 'save_and_restart' ? { rawRecordText: props.rawText } : {}) })
      if (scope(result.target) !== scope(target) || result.action !== action) throw new Error('返回记录与本次已确认目标或动作不一致。')
      trackUnknown(result)
      setLocalReceipt(result)
      setNotice(unknownReceipt(result) ? '设备效果未知；保留原操作，不重试，请人工核对。' : '操作记录已返回；受理与本地提交不证明设备采用或启动完成。')
    } catch (error) {
      const failed: MaintenanceReceipt = { target, action, admission: 'unknown', submission: 'submission_unknown', unknown: true, unknownSource: 'transport', nativeJsonText: errorText(error) }
      trackUnknown(failed); setLocalReceipt(failed)
      setNotice('提交结果未知；保留原操作，不重试，请人工核对。')
    } finally { live.current.busy = false; setPending(false) }
  }
  const targetSummary = props.target ? `${props.target.targetId}；UID ${props.target.uid}；run_nonce ${props.target.runNonce}；代次 ${props.target.connectionGeneration}；实例 ${props.target.instanceId}` : '尚未选择已核对目标。'
  return React.createElement('section', { style: styles.card, 'aria-label': '维护权限与动作' },
    React.createElement('h2', null, '维护'),
    React.createElement('p', null, targetSummary),
    React.createElement('p', null, '默认只读。维护权限仅用于当前完整身份；关闭界面、解除权限与服务退出均不表示设备停止。'),
    React.createElement('label', { style: { display: 'block' } }, React.createElement('input', { type: 'checkbox', 'aria-label': '明确启用当前目标维护权限', checked: active.enable, disabled: busy || !knownTarget(props.target), onChange: (event: React.ChangeEvent<HTMLInputElement>) => updateIntent('enable', event.target.checked) }), ` 明确为 ${targetSummary} 启用 maintenance 权限`),
    React.createElement('div', { style: styles.row },
      React.createElement('button', { style: styles.button, disabled: busy || !knownTarget(props.target) || !active.enable || !!props.gateReason, onClick: () => humanAction(() => props.onEnable({ ...props.target! })) }, '启用当前目标维护权限'),
      props.onDisable && React.createElement('button', { style: styles.button, disabled: busy || !props.permission, onClick: () => humanAction(() => props.onDisable!(props.permission!)) }, '解除当前维护权限')),
    React.createElement('p', null, `权限：${props.permission?.maintenance && scope(props.permission.target) === scope(props.target) ? '当前完整身份已获 maintenance 授权' : '只读或授权与当前身份不匹配'}`),
    React.createElement('details', null, React.createElement('summary', null, '本次完整候选原文'), React.createElement('pre', { style: styles.mono }, props.rawText || '尚无完整候选原文。')),
    React.createElement('p', null, `SDK 校验：${props.validation?.rawText === props.rawText ? `${props.validation.valid ? '通过' : '未通过'}；${props.validation.summary}` : '尚无当前候选原文的校验结果'}`),
    React.createElement('label', { style: { display: 'block' } }, '具体维护动作 ', React.createElement('select', { value: action, disabled: busy, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => { const selected = event.target.value; if (Object.hasOwn(actions, selected)) setAction(selected as MaintenanceAction) } }, ...Object.entries(actions).map(([value, label]) => React.createElement('option', { key: value, value }, label)))),
    action === 'enter_update' && React.createElement('div', null, React.createElement('p', null, `已交付恢复路径：${text(props.recoveryPath)}。进入更新入口不传输镜像，也不验证新应用或证明完整刷写成功。`),
      React.createElement('label', null, React.createElement('input', { type: 'checkbox', 'aria-label': '确认已明确更新恢复路径', checked: active.recovery, disabled: busy || !props.recoveryPath?.trim(), onChange: (event: React.ChangeEvent<HTMLInputElement>) => updateIntent('recovery', event.target.checked) }), ' 我已明确上述恢复路径并确认可以在进入更新入口后恢复。')),
    disabledReason && React.createElement('p', { role: 'status' }, `动作门禁：${disabledReason}`),
    React.createElement('label', { style: { display: 'block', marginTop: 12 } }, React.createElement('input', { type: 'checkbox', 'aria-label': '确认当前目标和具体维护动作', checked, disabled: busy || !!disabledReason || (action === 'enter_update' && !active.recovery), onChange: (event: React.ChangeEvent<HTMLInputElement>) => updateIntent('confirmed', event.target.checked) }), ` 我确认对 ${targetSummary} 执行“${actions[action]}”${action === 'save_and_restart' ? '，提交上述完整候选原文' : ''}。`),
    React.createElement('button', { style: styles.button, disabled: !canSubmit, onClick: submit }, '执行维护动作'),
    notice && React.createElement('p', { role: 'status', 'aria-live': 'polite' }, notice),
    receipt && React.createElement('div', null,
      React.createElement('h3', null, '维护结果证据'),
      React.createElement('p', null, `记录目标：${receipt.target.targetId}；UID ${receipt.target.uid}；run_nonce ${receipt.target.runNonce}；代次 ${receipt.target.connectionGeneration}；动作 ${receipt.action}；操作编号 ${text(receipt.operationId)}`),
      React.createElement('p', null, `受理：${receipt.admission}`),
      React.createElement('p', null, `本地提交：${receipt.submission}`),
      React.createElement('p', null, `后续观测：${text(receipt.observation)}`),
      React.createElement('p', { role: unknownReceipt(receipt) ? 'alert' : undefined }, `设备效果${unknownReceipt(receipt) ? '未知' : '未由本记录证明'}；${text(receipt.controlEffect)}。观测、受理与本地提交是独立事实。`),
      receipt.nativeJsonText && React.createElement('details', null, React.createElement('summary', null, 'SDK 原始证据'), React.createElement('pre', { style: styles.mono }, receipt.nativeJsonText))),
    React.createElement('h3', null, '显式重连与采用核对'),
    React.createElement('p', null, '重连后核对同 UID，再分别读回 User、Startup 和启动来源；新 run_nonce、断连或本地提交均不证明保存成功。不会自动重连、读回或重放动作。'),
    React.createElement('div', { style: styles.row },
      props.onReconnect && React.createElement('button', { style: styles.button, disabled: busy || !knownTarget(props.target), onClick: () => humanAction(() => props.onReconnect!({ ...props.target! })) }, '显式重连并核对同 UID'),
      ...(['user', 'startup'] as const).map(view => props.onReadback && React.createElement('button', { key: view, style: styles.button, disabled: busy || !knownTarget(props.target), onClick: () => humanAction(() => props.onReadback!({ ...props.target! }, view)) }, `读回 ${view === 'user' ? 'User' : 'Startup'}`))))
}
