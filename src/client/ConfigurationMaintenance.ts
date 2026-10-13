import React, { useEffect, useRef, useState } from 'react'
import type { FieldkitBinding, FieldkitConfigurationRead, FieldkitConfigurationSchema, FieldkitMaintenanceContext, FieldkitMaintenanceReceipt, FieldkitMaintenanceTarget } from '../remote-types.js'
import { Configuration, type ConfigurationView } from './Configuration.js'
import { Maintenance, type MaintenanceReceipt, type MaintenanceRequest } from './Maintenance.js'
import { errorText, panelStyles, valueOf } from './shared.js'

interface Props {
  remote: any
  sessionId: string
  binding: FieldkitBinding | null
  busy: boolean
  onRefresh(): Promise<void>
  onBindingInvalidated?(target: FieldkitMaintenanceTarget, reason: string): void
  capabilities?: readonly string[]
  visible?: boolean
}
type Receipt = MaintenanceReceipt & Partial<Pick<FieldkitMaintenanceReceipt, 'grantId' | 'followUp' | 'error' | 'phase' | 'newSubmission'>>
interface State {
  key: string
  raw: string
  records: Partial<Record<ConfigurationView, string | null>>
  evidence: Partial<Record<ConfigurationView, FieldkitConfigurationRead>>
  schema: FieldkitConfigurationSchema | null
  validation: { rawText: string; valid: boolean; summary: string } | null
  context: FieldkitMaintenanceContext | null
  receipt: Receipt | null
  recoveryPath: string
}
const empty = (key: string): State => ({ key, raw: '', records: {}, evidence: {}, schema: null, validation: null, context: null, receipt: null, recoveryPath: '' })
const scope = (target: FieldkitMaintenanceTarget | null) => target ? JSON.stringify([target.instanceId, target.bindingId, target.targetId, target.uid, target.runNonce, target.connectionGeneration]) : ''
const selectedTarget = (binding: FieldkitBinding | null): FieldkitMaintenanceTarget | null => binding && !binding.expired && binding.instanceId && binding.connectionGeneration && binding.identity
  ? { instanceId: binding.instanceId, bindingId: binding.bindingId, targetId: binding.targetId, uid: binding.identity.uid, runNonce: binding.identity.runNonce, connectionGeneration: binding.connectionGeneration } : null

/** 仅组合UI；权限、动作身份与完整原文采用由Remote/SDK负责。 */
export function ConfigurationMaintenance({ remote, sessionId, binding, busy, onRefresh, onBindingInvalidated, capabilities = [], visible = true }: Props) {
  const target = selectedTarget(binding), key = JSON.stringify([sessionId, scope(target), binding?.expired ?? true])
  const [stored, setState] = useState<State>(() => empty(key)), [working, setWorking] = useState(false), [notice, setNotice] = useState('')
  const state = stored.key === key ? stored : empty(key)
  const live = useRef({ key, generation: 0, alive: true }), mutation = useRef(false), rawRevision = useRef(0), reads = useRef(Promise.resolve()), reloadLatest = useRef<(() => Promise<void>) | null>(null)
  const invalidationSeen = useRef(new Set<string>())
  const accepted = useRef<{ sessionId: string; receipt: Receipt } | null>(null)
  const unresolved = useRef(new Map<string, { sessionId: string; receipt: Receipt }>())
  const retainUnresolved = (receipt: Receipt) => {
    const id = JSON.stringify([sessionId, scope(receipt.target), receipt.action, receipt.operationId ?? null])
    const prior = unresolved.current.get(id)?.receipt
    if (receipt.unknown) {
      if (!prior || prior.unknownSource === 'transport') unresolved.current.set(id, { sessionId, receipt })
    } else if (prior?.unknownSource === 'transport' && receipt.operationId && receipt.admission === 'finished' && receipt.submission === 'not_submitted' && receipt.controlEffect === 'not_attempted') unresolved.current.delete(id)
  }
  const pendingForTarget = () => [...unresolved.current.values()].find(item => item.sessionId === sessionId && item.receipt.target.uid === target?.uid)?.receipt
  if (live.current.key !== key) live.current = { ...live.current, key, generation: live.current.generation + 1 }
  const generation = live.current.generation, childKey = `${key}:${generation}`
  const active = () => live.current.alive && live.current.generation === generation
  const supports = (capability: string) => capabilities.includes(capability)
  const display = (update: (current: State) => State) => { if (active()) setState(current => update(current.key === key ? current : empty(key))) }
  const remember = (receipt: Receipt) => {
    // 迟到的mutation回执仍保留会话归属；当前目标显示由最新context恢复。
    retainUnresolved(receipt)
    accepted.current = { sessionId, receipt }
    const code = receipt.error?.code, identityInvalid = ['identity_changed', 'binding_stale', 'instance_mismatch', 'not_found'].includes(code ?? ''), grantInvalid = identityInvalid || ['permission_denied', 'permission_revoked', 'permission_conflict'].includes(code ?? '')
    display(current => ({ ...current, receipt: pendingForTarget() ?? receipt, ...(grantInvalid && scope(receipt.target) === scope(target) && current.context && (identityInvalid || current.context.grant?.grantId === receipt.grantId) ? { context: { ...current.context, grant: null } } : {}) }))
    const invalidationKey = JSON.stringify([sessionId, scope(receipt.target), receipt.operationId, code])
    if (grantInvalid && active() && !invalidationSeen.current.has(invalidationKey)) { invalidationSeen.current.add(invalidationKey); const reason = identityInvalid ? '身份或连接代次已变化，原观察与授权已过期；请重新选择并核对目标。' : '维护授权已撤销或变化；有效观察仍可读取，请重新人工授权后再明确请求动作。'; setNotice(reason); if (identityInvalid) onBindingInvalidated?.(receipt.target, reason) }
  }
  const readContext = () => {
    const run = reads.current.catch(() => {}).then(async () => {
      if (!active() || !sessionId || !supports('maintenance') || mutation.current) return
      const context: FieldkitMaintenanceContext = valueOf(await remote.maintenanceContext(sessionId))
      if (!active()) return
      const local = accepted.current?.sessionId === sessionId ? accepted.current.receipt : null
      const recovered = context.latestOperation
      if (recovered) { remember(recovered) }
      if (recovered) retainUnresolved(recovered)
      // 没有本次服务 request_id，就没有证据把任何 latestOperation 认作本次请求。
      // 同目标、动作、grant 或较新的编号均不建立请求同一性；保留匿名未知，不降格。
      const receipt = pendingForTarget() ?? recovered ?? local
      display(current => ({ ...current, context: recovered?.error && ['identity_changed', 'binding_stale', 'instance_mismatch', 'not_found', 'permission_denied', 'permission_revoked', 'permission_conflict'].includes(recovered.error.code) && scope(recovered.target) === scope(target) && (['identity_changed', 'binding_stale', 'instance_mismatch', 'not_found'].includes(recovered.error.code) || context.grant?.grantId === recovered.grantId) ? { ...context, grant: null } : context, receipt }))
      if (receipt?.operationId && receipt.admission !== 'finished' && supports('operation_read')) {
        // 查询失败不改变原受理/提交事实，也不制造设备结果未知。
        const next: FieldkitMaintenanceReceipt = valueOf(await remote.getMaintenanceOperation(sessionId, receipt.operationId))
        if (active()) remember(next)
      }
    })
    reads.current = run.catch(() => {})
    return run
  }
  reloadLatest.current = async () => { try { await readContext() } catch (error) { if (active()) setNotice(`维护记录读取失败：${errorText(error)}；保留原记录，不重发。`) } }
  useEffect(() => { live.current.alive = true; return () => { live.current.alive = false } }, [])
  useEffect(() => { setState(empty(key)); setNotice('') }, [key])
  useEffect(() => {
    if (!sessionId || !supports('maintenance') || !visible) return
    let cancelled = false, timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      if (cancelled || !active()) return
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') await reloadLatest.current?.()
      if (!cancelled && active()) timer = setTimeout(poll, 1000)
    }
    void poll()
    return () => { cancelled = true; if (timer !== undefined) clearTimeout(timer) }
  }, [key, visible, capabilities.join(',')])
  const foreground = async <T,>(work: () => Promise<T>) => {
    if (mutation.current || busy) throw new Error('当前操作尚在处理中。')
    mutation.current = true; setWorking(true)
    try { return await work() }
    finally { mutation.current = false; if (live.current.alive) setWorking(false) }
  }
  const readRecord = async (view: ConfigurationView) => {
    if (!target || !supports(`read_config_${view}`)) throw new Error(`请先选择有效绑定，且服务须发布 read_config_${view}。`)
    const result: FieldkitConfigurationRead = valueOf(await remote.readConfiguration(sessionId, { bindingId: target.bindingId, view }))
    if (!active()) return
    if (scope(result.target) !== scope(target) || result.view !== view) throw new Error('配置读取证据与当前目标或视图不匹配。')
    display(current => ({ ...current, records: { ...current.records, [view]: result.dataUtf8 }, evidence: { ...current.evidence, [view]: result } }))
  }
  const changePermission = async (permissionTarget: FieldkitMaintenanceTarget, enabled: boolean) => {
    if (mutation.current || busy || !supports('maintenance_permissions')) throw new Error('维护权限操作当前不可用。')
    mutation.current = true; setWorking(true)
    try {
      const grant = valueOf(await remote.setMaintenancePermission(sessionId, { target: permissionTarget, enabled }))
      display(current => ({ ...current, context: { target: current.context?.target ?? target, grant, latestOperation: current.context?.latestOperation ?? null } }))
    } finally {
      mutation.current = false; if (live.current.alive) setWorking(false)
      if (active()) await reloadLatest.current?.()
    }
  }
  const submit = async (request: MaintenanceRequest) => {
    if (mutation.current || busy || !supports('maintenance')) throw new Error('维护操作当前不可用。')
    mutation.current = true; setWorking(true)
    try {
      const receipt: FieldkitMaintenanceReceipt = valueOf(await remote.submitMaintenance(sessionId, { grantId: request.grantId, action: request.action, ...(request.action === 'save_and_restart' ? { rawRecordText: request.rawRecordText } : {}) }))
      remember(receipt)
      return receipt
    } catch (error: any) {
      const rejected = error.unknown !== true && ['bad_request', 'permission_denied', 'unsupported', 'busy', 'maintenance_busy', 'binding_stale', 'identity_changed', 'instance_mismatch', 'permission_revoked', 'permission_conflict', 'permission_unconfirmed'].includes(error.code)
      // UI记录没有伪造SDK operationId；确定提交前拒绝与传输不明分开。
      const receipt: Receipt = { grantId: request.grantId, error: { code: typeof error.code === 'string' ? error.code : 'backend_error', message: errorText(error) }, target: request.target, action: request.action, admission: rejected ? 'rejected_before_submission' : 'unknown', submission: rejected ? 'not_submitted' : 'submission_unknown', controlEffect: rejected ? 'not_attempted' : 'unresolved', unknown: !rejected, unknownSource: rejected ? null : 'transport', nativeJsonText: errorText(error) }
      remember(receipt)
      if (active()) setNotice(rejected ? `维护提交前拒绝：${errorText(error)}；没有登记设备操作。` : `维护提交响应未确认：${errorText(error)}；未取得本次操作编号，无法关联服务最新记录；保留未知，不重新提交。`)
      return receipt
    } finally {
      mutation.current = false; if (live.current.alive) setWorking(false)
      // 包含已登记但HTTP回执丢失的情况；只读恢复，不重放动作。
      await reloadLatest.current?.()
    }
  }
  const gateReason = !supports('maintenance') ? '当前服务未发布 maintenance 能力。' : !target ? '请选择有效目标绑定。' : scope(state.context?.target ?? null) !== scope(target) ? '当前维护context尚未核对所选目标。'
    : state.receipt?.target.uid === target.uid && ['queued', 'attempting'].includes(state.receipt.admission) ? '原维护动作尚在处理中；只查询原记录，不重新提交。'
    : state.receipt?.submission === 'locally_submitted' && scope(state.receipt.target) === scope(target) ? '原维护动作已本地提交；请前往“连接”页 显式重连并核对同 UID，再读回 User/Startup。' : null
  const styles = panelStyles(busy || working)
  let schema: unknown
  if (state.schema) { try { schema = JSON.parse(state.schema.nativeJsonText) } catch { /* Schema原文仍完整展示；解析只用于字段提示。 */ } }
  return React.createElement('div', null,
    React.createElement('section', { style: styles.card },
      React.createElement('button', { style: styles.button, disabled: busy || working || !supports('maintenance'), onClick: async () => { await reloadLatest.current?.(); if (active()) await onRefresh() } }, '刷新维护记录'),
      notice && React.createElement('p', { role: 'status' }, notice),
      gateReason && React.createElement('p', { role: 'status' }, gateReason),
      state.context?.permissionError && React.createElement('p', { role: 'status' }, state.context.permissionError.message)),
    React.createElement(Configuration, { key: `configuration:${childKey}`, rawText: state.raw, records: state.records, schema, nativeSchemaText: state.schema?.nativeJsonText, busy: busy || working,
      onChange: (rawText: string) => { rawRevision.current++; display(current => ({ ...current, raw: rawText, validation: null })) },
      onValidate: (rawText: string) => foreground(async () => {
        const revision = rawRevision.current
        if (!supports('config_validate')) throw new Error('当前服务未发布 config_validate。')
        const result = valueOf(await remote.validateConfiguration(sessionId, rawText))
        display(current => current.raw === rawText && revision === rawRevision.current ? { ...current, validation: { rawText, valid: result.valid === true, summary: 'SDK 静态校验返回；不证明设备采用。' } } : current)
        return result
      }),
      onRead: (view: ConfigurationView) => foreground(() => readRecord(view)),
      onLoadSchema: () => foreground(async () => {
        if (!supports('config_schema')) throw new Error('当前服务未发布 config_schema。')
        const result: FieldkitConfigurationSchema = valueOf(await remote.configurationSchema(sessionId))
        display(current => ({ ...current, schema: result }))
      }) }),
    ...Object.values(state.evidence).map(record => React.createElement('details', { key: record.view }, React.createElement('summary', null, `${record.view} SDK 读取证据`),
      record.dataUtf8 === null && React.createElement('p', null, 'SDK 未返回配置 UTF-8 原文；证据不能作为候选配置。'), React.createElement('pre', { style: styles.mono }, record.nativeJsonText), React.createElement('pre', { style: styles.mono }, `dataHex: ${record.dataHex}`))),
    React.createElement('label', null, '已交付的更新恢复路径 ', React.createElement('input', { value: state.recoveryPath, disabled: busy || working, onChange: (event: React.ChangeEvent<HTMLInputElement>) => display(current => ({ ...current, recoveryPath: event.target.value })) })),
    React.createElement(Maintenance, { key: `maintenance:${childKey}`, target, permission: state.context?.grant, actionReasons: state.context?.permissionError ? { save_and_restart: state.context.permissionError.message, restore_factory_and_restart: state.context.permissionError.message, reset_application: state.context.permissionError.message, enter_update: state.context.permissionError.message } : undefined, rawText: state.raw, validation: state.validation, gateReason, recoveryPath: state.recoveryPath, receipt: state.receipt, busy: busy || working,
      onEnable: (permissionTarget: FieldkitMaintenanceTarget) => changePermission(permissionTarget, true), onDisable: (grant: { target: FieldkitMaintenanceTarget }) => changePermission(grant.target, false), onSubmit: submit,
      onReadback: (readTarget: FieldkitMaintenanceTarget, view: 'user' | 'startup') => foreground(async () => { if (scope(readTarget) !== scope(target)) throw new Error('当前读回目标已变化。'); await readRecord(view) }) }),
    state.receipt && React.createElement('section', { style: styles.card },
      state.receipt.newSubmission === false && React.createElement('p', null, '服务记录：本次没有新提交。'),
      state.receipt.error && React.createElement('p', { role: 'alert' }, `${state.receipt.error.code}：${state.receipt.error.message}`),
      state.receipt.followUp?.reconnectRequired && React.createElement('p', null, '请前往“连接”页，对原 UID 显式重连并核对身份；之后分别读取 User、Startup 与启动来源。不自动重连或读回。'),
      state.receipt.followUp && React.createElement('p', null, `SDK 后续读回视图：${state.receipt.followUp.readbackViews.join(', ') || '无'}；phase ${state.receipt.phase ?? '无'}。`),
      state.receipt.operationId && React.createElement('button', { style: styles.button, disabled: busy || working || !supports('operation_read'), onClick: async () => {
        try { const result: FieldkitMaintenanceReceipt = valueOf(await remote.getMaintenanceOperation(sessionId, state.receipt!.operationId)); if (active()) { remember(result); setNotice('原操作记录已读取；没有重新提交。') } }
        catch (error) { if (active()) setNotice(`原操作查询失败：${errorText(error)}；保留原记录，不重发。`) }
      } }, '查询原维护操作')))
}
