// Fixed public SDK maintenance routes. Native configuration/evidence remain opaque text.
const fail = message => { throw Object.assign(new Error(message), { code: 'invalid_response' }) }
const check = (condition, message) => { if (!condition) fail(message) }
const identifier = value => { check(typeof value === 'string' && value.length > 0 && value.length <= 256, 'Invalid maintenance identifier'); return encodeURIComponent(value) }
const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 20 && BigInt(value) <= 18446744073709551615n
const actions = new Set(['save_and_restart', 'restore_factory_and_restart', 'reset_application', 'enter_update'])
const identity = value => { check(value && /^[a-f0-9]{24}$/.test(value.uid) && /^[a-f0-9]{32}$/.test(value.run_nonce), 'Invalid maintenance identity'); return { uid: value.uid, runNonce: value.run_nonce } }
const member = value => {
  check(typeof value.target_id === 'string' && decimal(value.connection_generation), 'Invalid maintenance member')
  return { ...(value.binding_id ? { bindingId: value.binding_id } : {}), ...(value.grant_id ? { grantId: value.grant_id } : {}), targetId: value.target_id, identity: identity(value.expected_identity), connectionGeneration: value.connection_generation }
}
const gate = binding => ({ expected_identity: binding.identity, connection_generation: binding.connection_generation })
function operation(value) {
  check(value && actions.has(value.action) && ['queued', 'attempting', 'finished'].includes(value.admission)
    && ['not_attempted', 'not_submitted', 'locally_submitted', 'unknown'].includes(value.submission)
    && ['not_attempted', 'not_applicable', 'unresolved'].includes(value.control_effect)
    && value.observation === 'unconfirmed' && [null, 'factory_read', 'submission'].includes(value.phase)
    && decimal(value.control_epoch) && Array.isArray(value.members) && value.members.length === 1
    && (value.native_json_text === null || typeof value.native_json_text === 'string')
    && typeof value.follow_up?.reconnect_required === 'boolean' && Array.isArray(value.follow_up?.readback_views)
    && value.follow_up.readback_views.every(v => ['user', 'startup'].includes(v))
    && (value.error === null || typeof value.error?.code === 'string' && typeof value.error?.message === 'string'), 'Invalid maintenance operation')
  identifier(value.request_id); identifier(value.reservation_id); identifier(value.claimant_id)
  return { operationId: value.request_id, reservationId: value.reservation_id, claimantId: value.claimant_id,
    action: value.action, controlEpoch: value.control_epoch, members: value.members.map(member),
    admission: value.admission, submission: value.submission, controlEffect: value.control_effect,
    observation: value.observation, phase: value.phase, nativeJsonText: value.native_json_text,
    followUp: { reconnectRequired: value.follow_up.reconnect_required, readbackViews: value.follow_up.readback_views }, error: value.error }
}
export function createP3Client(request) {
  const post = (path, instanceId, body, method = 'POST') => request(path, { instanceId, method, body: { instance_id: instanceId, ...body } })
  return {
    async configurationSchema(instanceId) {
      const value = await request('/config/schema', { instanceId })
      check(typeof value.native_json_text === 'string' && Number.isInteger(value.config_format_version), 'Invalid configuration schema')
      return { nativeJsonText: value.native_json_text, configFormatVersion: value.config_format_version }
    },
    async validateConfiguration(instanceId, rawText) {
      const value = await post('/config/validate', instanceId, { config_text: rawText })
      check(value.valid === true, 'Invalid configuration validation result'); return { valid: true }
    },
    async maintenancePermission(binding, enabled) {
      const path = `/bindings/${identifier(binding.binding_id)}/permissions`
      const current = await request(path, { instanceId: binding.instance_id })
      check(current.binding_id === binding.binding_id && current.expected_identity?.uid === binding.identity.uid && current.expected_identity?.run_nonce === binding.identity.run_nonce && current.connection_generation === binding.connection_generation && typeof current.permissions?.control === 'boolean' && (current.grant_id === null || typeof current.grant_id === 'string'), 'Invalid current permission metadata')
      const value = await post(path, binding.instance_id, { ...gate(binding), permissions: { maintenance: enabled, control: current.permissions.control }, expected_grant_id: current.grant_id })
      check(value.binding_id === binding.binding_id && value.permissions?.maintenance === enabled && value.permissions?.control === current.permissions.control, 'Invalid permission response')
      check(enabled || current.permissions.control ? typeof value.grant_id === 'string' && value.grant_id.length > 0 : value.grant_id === null, 'Invalid permission grant')
      return { ...member(value), grantId: value.grant_id, maintenance: enabled }
    },
    async maintenanceReservation(binding, claimantId) {
      const value = await post('/control-reservations', binding.instance_id, { claimant_id: claimantId, permission: 'maintenance', members: [{ binding_id: binding.binding_id, ...gate(binding) }] })
      check(value.claimant_id === claimantId && value.permission === 'maintenance' && decimal(value.control_epoch) && Array.isArray(value.members) && value.members.length === 1, 'Invalid maintenance reservation')
      identifier(value.reservation_id)
      return { reservationId: value.reservation_id, claimantId, controlEpoch: value.control_epoch, members: value.members.map(member) }
    },
    async releaseMaintenanceReservation(instanceId, reservationId, claimantId) {
      const value = await post(`/control-reservations/${identifier(reservationId)}`, instanceId, { claimant_id: claimantId }, 'DELETE')
      check(value.reservation_id === reservationId && Array.isArray(value.released) && Array.isArray(value.blocked), 'Invalid maintenance release')
      return { reservationId, released: value.released, blocked: value.blocked }
    },
    async maintenanceTicket(instanceId, reservationId, claimantId) {
      const value = await post('/operation-ids', instanceId, { reservation_id: reservationId, claimant_id: claimantId })
      check(value.reservation_id === reservationId && decimal(value.control_epoch) && value.expires_in_ms === 30000, 'Invalid maintenance ticket')
      identifier(value.request_id)
      return { operationId: value.request_id, reservationId, controlEpoch: value.control_epoch, expiresInMs: value.expires_in_ms }
    },
    async submitMaintenance(binding, intent) {
      check(actions.has(intent.action), 'Invalid maintenance action')
      const value = await post(`/bindings/${identifier(binding.binding_id)}/maintenance`, binding.instance_id, { ...gate(binding), reservation_id: intent.reservationId, claimant_id: intent.claimantId, request_id: intent.operationId, action: intent.action, ...(intent.action === 'save_and_restart' ? { config_text: intent.rawRecordText } : {}) })
      const result = operation(value.operation)
      check(result.operationId === intent.operationId && result.reservationId === intent.reservationId && result.claimantId === intent.claimantId && typeof value.new_submission === 'boolean', 'Maintenance receipt identity mismatch')
      return { ...result, newSubmission: value.new_submission }
    },
    async maintenanceOperation(instanceId, operationId) {
      const value = operation((await request(`/operations/${identifier(operationId)}`, { instanceId })).operation)
      check(value.operationId === operationId, 'Maintenance receipt identity mismatch'); return value
    },
  }
}
