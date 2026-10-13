const actions = new Set(['save_and_restart', 'restore_factory_and_restart', 'reset_application', 'enter_update'])
const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }
const fields = (value, required, optional = []) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(k => value[k] === undefined) || Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) fail('bad_request', 'Invalid maintenance request fields')
}
const same = (a, b) => a && b && ['instanceId', 'bindingId', 'targetId', 'uid', 'runNonce', 'connectionGeneration'].every(k => a[k] === b[k])
const targetOf = b => ({ instanceId: b.owner.instance_id, bindingId: b.id, targetId: b.target.targetId, uid: b.owner.identity.uid, runNonce: b.owner.identity.run_nonce, connectionGeneration: b.owner.connection_generation })
const matchesMember = (member, target) => member && member.targetId === target.targetId && member.identity?.uid === target.uid && member.identity?.runNonce === target.runNonce && member.connectionGeneration === target.connectionGeneration
const clone = value => structuredClone(value)
const rejected = new Set(['invalid_config', 'unsupported_permission', 'permission_denied', 'permission_revoked', 'permission_conflict', 'claimant_mismatch', 'reservation_busy', 'reservation_unknown', 'operation_capacity', 'request_id_expired', 'maintenance_busy', 'not_connected', 'binding_stale', 'identity_changed', 'invalid_request', 'instance_mismatch'])
const raw = value => { if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 60000) fail('bad_request', '请提供不超过 60000 UTF-8 字节的完整配置原文。') }
/** Grants come only from the SDK; per-session registries never accept model-selected claimant IDs. */
export function createP3Service({ mode, session, selected, attach, http, invalidateTarget = () => {}, busy = () => false }) {
  const contexts = new Map(), operations = new Map(), uidClaims = new Map()
  function context(s) { session(s); if (!contexts.has(s)) contexts.set(s, { grant: null, latestOperationId: null }); return contexts.get(s) }
  async function ready(s, capability) {
    context(s)
    if (mode !== 'service-v2') fail('unsupported', '配置和维护需要 service-v2。')
    const description = await attach()
    if (!description.capabilities.includes(capability)) fail('unsupported', `服务未发布 ${capability}；请升级 eha-tool。`)
    return description
  }
  function binding(s) {
    const b = selected(s, session(s).selectedBindingId)
    if (!b.owner?.identity) fail('binding_stale', '请先明确选择并绑定当前目标。')
    return b
  }
  function target(s) { try { return targetOf(binding(s)) } catch { return null } }
  function registered(s, id) { context(s); const record = operations.get(id); if (!record || record.sessionId !== s) fail('not_found', '当前对话未登记该维护记录。'); return record }
  function receipt(record) { return clone(record.receipt) }
  function invalidateReceipt(record) {
    const code = record.receipt.error?.code
    const identityInvalid = ['identity_changed', 'binding_stale', 'instance_mismatch', 'not_found'].includes(code)
    if (!identityInvalid && !['permission_denied', 'permission_revoked', 'permission_conflict'].includes(code)) return
    const c = context(record.sessionId)
    if (c.grant && same(c.grant.target, record.receipt.target) && (identityInvalid || c.grant.grantId === record.receipt.grantId)) c.grant = null
    if (identityInvalid) { if (record.binding) record.binding.expired = true; invalidateTarget(record.receipt.target, { code }) }
  }
  async function collect(record, value) {
    if (value.operationId !== record.receipt.operationId || value.reservationId !== record.reservationId || value.claimantId !== record.sessionId || value.action !== record.receipt.action || value.controlEpoch !== record.controlEpoch || value.members.length !== 1 || !matchesMember(value.members[0], record.receipt.target)) fail('invalid_response', '维护回执与原请求身份不一致。')
    if (record.sdkUnknown && value.submission !== 'unknown') fail('invalid_response', 'SDK 未知记录不得被后续快照清除。')
    if (value.submission === 'unknown') record.sdkUnknown = true
    record.receipt = { ...record.receipt, admission: value.admission, submission: value.submission, controlEffect: value.controlEffect, observation: value.observation, phase: value.phase, followUp: value.followUp, error: value.error, nativeJsonText: value.nativeJsonText, unknown: value.submission === 'unknown' || value.controlEffect === 'unresolved', unknownSource: value.submission === 'unknown' || value.controlEffect === 'unresolved' ? 'sdk' : null, ...(typeof value.newSubmission === 'boolean' ? { newSubmission: value.newSubmission } : {}) }
    invalidateReceipt(record)
    // Only a definite never-submitted terminal record permits a fresh explicit action.
    if (value.admission === 'finished' && value.submission === 'not_submitted') await releaseKnown(record)
    return receipt(record)
  }
  async function releaseKnown(record) {
    if (record.reservationReleased) return
    try {
      const result = await record.client.releaseMaintenanceReservation(record.receipt.target.instanceId, record.reservationId, record.sessionId)
      if (result.blocked?.length) fail('reservation_busy', '原占用仍被服务阻挡。')
      record.reservationReleased = true
      if (uidClaims.get(record.receipt.target.uid) === record) uidClaims.delete(record.receipt.target.uid)
    } catch (error) {
      if (error.code === 'not_found') { record.reservationReleased = true; if (uidClaims.get(record.receipt.target.uid) === record) uidClaims.delete(record.receipt.target.uid); return }
      const original = record.receipt.error
      record.receipt.error = { code: original?.code ?? 'reservation_release_failed', message: `${original?.message ?? ''} 维护占用释放未完成：${error.message}；请查询原记录。` }
    }
  }
  return {
    maintenanceBusy() { return [...uidClaims.values()].some(v => !v.receipt || v.receipt.admission !== 'finished') },
    async configurationSchema(s) { const d = await ready(s, 'config_schema'); return http().configurationSchema(d.instance_id) },
    async validateConfiguration(s, rawText) { raw(rawText); const d = await ready(s, 'config_validate'); return http().validateConfiguration(d.instance_id, rawText) },
    async readConfiguration(s, request) {
      fields(request, ['bindingId', 'view'])
      if (!['factory', 'startup', 'user'].includes(request.view)) fail('bad_request', '未知配置视图。')
      await ready(s, `read_config_${request.view}`)
      const b = selected(s, request.bindingId)
      if (busy() || uidClaims.get(b.owner.identity.uid)?.receipt?.admission !== 'finished' && uidClaims.has(b.owner.identity.uid)) fail('busy', '当前设备动作尚在处理中；请先核对原记录。')
      const previous = uidClaims.get(b.owner.identity.uid)
      if (previous?.receipt?.submission === 'locally_submitted' && same(previous.receipt.target, targetOf(b))) fail('reconnect_required', '维护已本地提交；请先明确重连同 UID，再读回新代次的配置。')
      const value = await b.client.read(b.owner, `config_${request.view}`)
      return { view: request.view, target: targetOf(b), nativeJsonText: value.native_json_text, dataUtf8: value.data_utf8 ?? null, dataHex: value.data_hex ?? '' }
    },
    async maintenanceContext(s) {
      await ready(s, 'maintenance')
      const c = context(s), current = target(s)
      if (c.grant && !same(c.grant.target, current)) c.grant = null
      return { target: current, grant: clone(c.grant), latestOperation: c.latestOperationId ? receipt(registered(s, c.latestOperationId)) : null }
    },
    async setMaintenancePermission(s, request) {
      fields(request, ['target', 'enabled'])
      if (typeof request.enabled !== 'boolean') fail('bad_request', '权限必须明确启用或撤销。')
      await ready(s, 'maintenance_permissions')
      const b = binding(s), current = targetOf(b), c = context(s)
      if (!same(request.target, current)) fail('binding_stale', '授权目标身份已变化；请重新核对。')
      const previous = uidClaims.get(current.uid)
      if (request.enabled && previous && (previous.receipt?.unknown || same(previous.receipt?.target, current))) fail('maintenance_busy', '原维护已提交或结果未知；请核对原记录并明确重连，不重新提交。')
      const revision = c.permissionRevision = (c.permissionRevision ?? 0) + 1
      c.grant = null
      const value = await b.client.maintenancePermission(b.owner, request.enabled)
      if (!matchesMember(value, current) || value.bindingId !== b.owner.binding_id) fail('invalid_response', '权限回执身份不匹配。')
      // Recheck selection after async permission response; no stale grant is exposed.
      if (revision !== c.permissionRevision || !same(target(s), current)) { if (revision === c.permissionRevision) c.grant = null; fail('binding_stale', '授权期间目标或权限已变化；旧授权不可用于新目标。') }
      c.grant = request.enabled ? { grantId: value.grantId, target: current, maintenance: true } : null
      return clone(c.grant)
    },
    async submitMaintenance(s, request) {
      fields(request, ['grantId', 'action'], ['rawRecordText'])
      if (!actions.has(request.action)) fail('bad_request', '未知维护动作。')
      if (request.action === 'save_and_restart') raw(request.rawRecordText)
      else if (request.rawRecordText !== undefined) fail('bad_request', '只有保存动作可带配置原文。')
      await ready(s, 'maintenance')
      const b = binding(s), current = targetOf(b), c = context(s), grant = c.grant
      if (!grant || grant.grantId !== request.grantId || !same(grant.target, current)) fail('permission_denied', '需要人类为当前完整身份明确启用维护权限。')
      if (busy()) fail('busy', '读取或连接操作尚在处理。')
      const prior = uidClaims.get(current.uid)
      if (prior && (prior.receipt?.unknown || prior.receipt?.admission !== 'finished' || same(prior.receipt?.target, current))) fail('maintenance_busy', '该 UID 已有维护提交或未知记录；请核对原记录，不重试。')
      const preparing = { receipt: null }; uidClaims.set(current.uid, preparing)
      let reservation, posted = false, record
      try {
        const client = b.client
        if (request.action === 'save_and_restart') await client.validateConfiguration(current.instanceId, request.rawRecordText)
        if (!same(target(s), current) || c.grant !== grant) fail('binding_stale', '请求准备期间身份或授权已变化。')
        reservation = await client.maintenanceReservation(b.owner, s)
        if (reservation.members.length !== 1 || !matchesMember(reservation.members[0], current) || reservation.members[0].bindingId !== b.owner.binding_id || reservation.members[0].grantId !== grant.grantId) fail('invalid_response', '维护占用与当前授权不匹配。')
        const ticket = await client.maintenanceTicket(current.instanceId, reservation.reservationId, s)
        if (ticket.controlEpoch !== reservation.controlEpoch) fail('invalid_response', '维护票据代次不匹配。')
        if (!same(target(s), current) || c.grant !== grant) fail('binding_stale', '提交前身份或授权已变化。')
        record = { sessionId: s, binding: b, client, reservationId: reservation.reservationId, controlEpoch: ticket.controlEpoch, receipt: { operationId: ticket.operationId, grantId: grant.grantId, target: current, action: request.action, admission: 'queued', submission: 'not_attempted', controlEffect: 'not_attempted', observation: 'unconfirmed', phase: null, unknown: false, unknownSource: null, nativeJsonText: null, followUp: { reconnectRequired: false, readbackViews: [] }, error: null } }
        operations.set(ticket.operationId, record); c.latestOperationId = ticket.operationId; uidClaims.set(current.uid, record)
        posted = true
        const value = await client.submitMaintenance(b.owner, { ...request, operationId: ticket.operationId, reservationId: reservation.reservationId, claimantId: s })
        return collect(record, value)
      } catch (error) {
        if (!posted) { invalidateReceipt({ sessionId: s, binding: b, receipt: { target: current, grantId: grant.grantId, error } }); throw error }
        if (rejected.has(error.code)) {
          record.receipt = { ...record.receipt, admission: 'finished', submission: 'not_submitted', controlEffect: 'not_attempted', unknown: false, error: { code: error.code, message: error.message } }
          invalidateReceipt(record)
          await releaseKnown(record)
          return receipt(record)
        }
        // An HTTP failure is not evidence that bytes were never submitted. Keep the issued ID for read-only recovery.
        record.receipt = { ...record.receipt, submission: 'unknown', controlEffect: 'unresolved', unknown: true, unknownSource: 'transport', error: { code: typeof error.code === 'string' ? error.code : 'backend_error', message: error.message } }
        return receipt(record)
      } finally {
        if (!posted) {
          if (uidClaims.get(current.uid) === preparing) uidClaims.delete(current.uid)
          if (reservation) await b.client.releaseMaintenanceReservation(current.instanceId, reservation.reservationId, s).catch(() => {})
        }
      }
    },
    async getMaintenanceOperation(s, operationId) {
      const record = registered(s, operationId), d = await ready(s, 'operation_read')
      if (d.instance_id !== record.receipt.target.instanceId) fail('instance_mismatch', '原维护记录属于旧服务实例；保留审计，不向新实例重发。')
      return collect(record, await record.client.maintenanceOperation(d.instance_id, operationId))
    },
  }
}
