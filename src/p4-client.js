// Fixed P4 routes. Business numbers enter as strings and retain their JSON token spelling.
const check = (ok, message, code = 'invalid_response') => { if (!ok) throw Object.assign(new Error(message), { code }) }
const isId = v => typeof v === 'string' && v.length > 0 && v.length <= 256
const id = v => { check(isId(v), 'Invalid identifier', 'invalid_request'); return encodeURIComponent(v) }
const decimal = v => typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v) && v.length <= 20 && BigInt(v) <= 18446744073709551615n
const json = JSON.stringify
const object = fields => `{${Object.entries(fields).map(([key, text]) => `${json(key)}:${text}`).join(',')}}`
const number = v => { check(typeof v === 'string' && v.length <= 128 && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(v), 'Business values must be JSON number token strings', 'invalid_request'); return v }
const integer = v => { check(decimal(v), 'Expected u64 decimal string', 'invalid_request'); return v }
const exact = (value, keys) => check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key)), 'Unexpected or missing fixed fields', 'invalid_request')
const nullableText = v => v === null || typeof v === 'string'
const error = v => { check(v === null || v && typeof v.code === 'string' && typeof v.message === 'string', 'Invalid per-member error'); return v === null ? null : { code: v.code, message: v.message } }
const identity = v => { check(v && /^[0-9a-f]{24}$/.test(v.uid) && /^[0-9a-f]{32}$/.test(v.run_nonce), 'Invalid identity'); return { uid: v.uid, runNonce: v.run_nonce } }
const member = v => {
  check(v && isId(v.target_id) && decimal(v.connection_generation), 'Invalid fixed member')
  const result = { targetId: v.target_id, identity: identity(v.expected_identity), connectionGeneration: v.connection_generation }
  for (const [wire, camel] of [['binding_id', 'bindingId'], ['grant_id', 'grantId'], ['stop_request_id', 'stopRequestId']]) if (v[wire] !== undefined) { check(isId(v[wire]), `Invalid ${wire}`); result[camel] = v[wire] }
  if (v.control_epoch !== undefined) { check(decimal(v.control_epoch), 'Invalid member epoch'); result.controlEpoch = v.control_epoch }
  return result
}
const gate = b => {
  id(b?.instance_id); id(b?.binding_id); id(b?.target_id)
  identity(b.identity); integer(b.connection_generation)
  return { expected_identity: json(b.identity), connection_generation: json(b.connection_generation) }
}
const sameMember = (v, b) => v.targetId === b.target_id && v.connectionGeneration === b.connection_generation && v.identity.uid === b.identity.uid && v.identity.runNonce === b.identity.run_nonce
function permission(v, binding) {
  check(v?.binding_id === binding.binding_id && typeof v.permissions?.maintenance === 'boolean' && typeof v.permissions?.control === 'boolean'
    && ((v.permissions.maintenance || v.permissions.control) ? isId(v.grant_id) : v.grant_id === null)
    && (v.permissions.control ? decimal(v.control_epoch) && isId(v.stop_request_id) : v.control_epoch === null && v.stop_request_id === null), 'Invalid permission metadata')
  const result = member({ ...v, grant_id: undefined, control_epoch: undefined, stop_request_id: undefined })
  check(sameMember(result, binding), 'Permission identity changed')
  return { ...result, grantId: v.grant_id, maintenance: v.permissions.maintenance, control: v.permissions.control, controlEpoch: v.control_epoch, stopRequestId: v.stop_request_id }
}
function originalScope(v) {
  check(v && decimal(v.control_epoch), 'Invalid original control epoch')
  return { ...member(v), controlEpoch: v.control_epoch }
}
function scopeText(v) {
  exact(v, ['targetId', 'identity', 'connectionGeneration', 'controlEpoch'])
  id(v.targetId); integer(v.connectionGeneration); integer(v.controlEpoch)
  exact(v.identity, ['uid', 'runNonce'])
  const expected = { uid: v.identity.uid, run_nonce: v.identity.runNonce }; identity(expected)
  return object({ target_id: json(v.targetId), expected_identity: json(expected), connection_generation: json(v.connectionGeneration), control_epoch: json(v.controlEpoch) })
}
const sameScope = (a, b) => a.targetId === b.targetId && a.connectionGeneration === b.connectionGeneration && a.controlEpoch === b.controlEpoch && a.identity.uid === b.identity.uid && a.identity.runNonce === b.identity.runNonce
const commandFields = {
  heartbeat_start: [], heartbeat_stop: [], heartbeat_once: [], position: ['mm'], velocity: ['mm_s'], force: ['n'],
  impedance: ['equilibrium_mm', 'stiffness_n_per_mm', 'damping_ns_per_mm'],
}
function command(v) {
  const fields = commandFields[v?.action]
  check(Array.isArray(fields), 'Unsupported fixed control command', 'invalid_request')
  exact(v, ['action', ...fields])
  return object({ action: json(v.action), ...Object.fromEntries(fields.map(key => [key, number(v[key])])) })
}
function trial(v) {
  const fields = ['position_min_mm', 'position_max_mm', 'velocity_abs_max_mm_s', 'force_abs_max_n', 'stiffness_max_n_per_mm', 'damping_max_ns_per_mm', 'duration_max_s']
  exact(v, ['command', 'envelope', 'duration_s', 'reach'])
  exact(v.envelope, fields)
  let reach = 'null'
  if (v.reach !== null) { exact(v.reach, ['tolerance_mm', 'settle_ms']); reach = object({ tolerance_mm: number(v.reach.tolerance_mm), settle_ms: integer(v.reach.settle_ms) }) }
  return object({ command: command(v.command), envelope: object(Object.fromEntries(fields.map(key => [key, number(v.envelope[key])]))), duration_s: v.duration_s === null ? 'null' : number(v.duration_s), reach })
}
const actions = new Set([...Object.keys(commandFields), 'trial_start', 'trial_target', 'recording_start', 'recording_stop', 'stop'])
function operation(v) {
  check(v && actions.has(v.action) && isId(v.request_id) && (v.reservation_id === null || isId(v.reservation_id)) && isId(v.claimant_id)
    && decimal(v.control_epoch) && Array.isArray(v.members) && v.members.length === 1
    && ['queued', 'attempting', 'finished'].includes(v.admission)
    && ['not_attempted', 'not_submitted', 'locally_submitted', 'unknown'].includes(v.submission)
    && ['not_attempted', 'not_applicable', 'known', 'unresolved'].includes(v.control_effect)
    && v.observation === 'unconfirmed' && [null, 'queued', 'preflight', 'recording', 'submission', 'confirmation'].includes(v.phase)
    && nullableText(v.native_json_text) && typeof v.follow_up?.reconnect_required === 'boolean'
    && Array.isArray(v.follow_up.readback_views) && v.follow_up.readback_views.every(view => ['user', 'startup'].includes(view)), 'Invalid control operation')
  const result = { operationId: v.request_id, reservationId: v.reservation_id, claimantId: v.claimant_id, action: v.action, controlEpoch: v.control_epoch,
    members: v.members.map(member), admission: v.admission, submission: v.submission, controlEffect: v.control_effect, observation: v.observation,
    phase: v.phase, nativeJsonText: v.native_json_text, error: error(v.error), followUp: { reconnectRequired: v.follow_up.reconnect_required, readbackViews: [...v.follow_up.readback_views] } }
  if (v.stop_attempt_delay_ms !== undefined) { check(v.stop_attempt_delay_ms === null || decimal(v.stop_attempt_delay_ms), 'Invalid Stop delay'); result.stopAttemptDelayMs = v.stop_attempt_delay_ms }
  for (const [wire, camel] of [['trial_id', 'trialId'], ['recording_id', 'recordingId']]) if (v[wire] !== undefined) { check(v[wire] === null || isId(v[wire]), `Invalid ${wire}`); result[camel] = v[wire] }
  return result
}
function group(v, full = true) {
  check(v && isId(v.group_id) && Array.isArray(v.members) && v.members.length >= 1 && v.members.length <= 16 && v.device_atomicity === false, 'Invalid group result')
  const bindings = new Set(), uids = new Set()
  const members = v.members.map(value => {
    check(isId(value.binding_id) && !bindings.has(value.binding_id), 'Invalid group member binding'); bindings.add(value.binding_id)
    const result = full ? member(value) : { bindingId: value.binding_id }
    if (full) { check(decimal(value.control_epoch) && isId(value.stop_request_id) && !uids.has(result.identity.uid), 'Invalid group fixed scope'); uids.add(result.identity.uid) }
    result.operation = value.operation === null ? null : operation(value.operation)
    result.error = error(value.error)
    return result
  })
  const result = { groupId: v.group_id, members, deviceAtomicity: false }
  if (full) { check(isId(v.reservation_id) && isId(v.claimant_id) && isId(v.stop_request_id) && typeof v.released === 'boolean', 'Invalid group ownership'); Object.assign(result, { reservationId: v.reservation_id, claimantId: v.claimant_id, stopRequestId: v.stop_request_id, released: v.released }) }
  return result
}
export function createP4Client(request) {
  const post = (path, instanceId, fields, method = 'POST') => { id(instanceId); return request(path, { instanceId, method, bodyText: object({ api_version: '2', instance_id: json(instanceId), ...fields }) }) }
  const owner = intent => { id(intent.claimantId); id(intent.operationId); return { claimant_id: json(intent.claimantId), request_id: json(intent.operationId) } }
  const submit = async (binding, intent, suffix, fields, expectedAction, stop = false) => {
    const scope = { ...gate(binding), ...owner(intent) }
    if (!stop) { id(intent.reservationId); scope.reservation_id = json(intent.reservationId) }
    const value = await post(`/bindings/${id(binding.binding_id)}/${suffix}`, binding.instance_id, { ...scope, ...fields })
    const result = operation(value.operation)
    check(result.operationId === intent.operationId && (stop || result.claimantId === intent.claimantId) && result.action === expectedAction
      && result.reservationId === (stop ? null : intent.reservationId) && sameMember(result.members[0], binding)
      && (intent.controlEpoch === undefined || result.controlEpoch === intent.controlEpoch) && typeof value.new_submission === 'boolean', 'Control receipt does not match original scope')
    return { ...result, newSubmission: value.new_submission }
  }
  return {
    async permissionView(binding) {
      gate(binding)
      return permission(await request(`/bindings/${id(binding.binding_id)}/permissions`, { instanceId: binding.instance_id }), binding)
    },
    async controlPermission(binding, permissions, expectedGrantId) {
      exact(permissions, ['maintenance', 'control']); check(typeof permissions.maintenance === 'boolean' && typeof permissions.control === 'boolean', 'Expected complete permission flags', 'invalid_request')
      check(expectedGrantId === null || isId(expectedGrantId), 'Expected explicit prior grant or null', 'invalid_request')
      const v = await post(`/bindings/${id(binding.binding_id)}/permissions`, binding.instance_id, { ...gate(binding), permissions: json(permissions), expected_grant_id: json(expectedGrantId) })
      const result = permission(v, binding)
      check(result.maintenance === permissions.maintenance && result.control === permissions.control, 'Permission response does not match desired flags')
      return result
    },
    async controlReservation(binding, claimantId) {
      id(claimantId)
      const v = await post('/control-reservations', binding.instance_id, { claimant_id: json(claimantId), permission: json('control'), members: `[${object({ binding_id: json(binding.binding_id), ...gate(binding) })}]` })
      check(v.claimant_id === claimantId && v.permission === 'control' && isId(v.reservation_id) && decimal(v.control_epoch) && isId(v.stop_request_id) && Array.isArray(v.members) && v.members.length === 1, 'Invalid control reservation')
      const members = v.members.map(member); check(members[0].bindingId === binding.binding_id && sameMember(members[0], binding), 'Reservation identity changed')
      return { reservationId: v.reservation_id, claimantId, controlEpoch: v.control_epoch, stopRequestId: v.stop_request_id, members }
    },
    async controlTicket(instanceId, reservationId, claimantId) {
      id(reservationId); id(claimantId)
      const v = await post('/operation-ids', instanceId, { reservation_id: json(reservationId), claimant_id: json(claimantId) })
      check(v.reservation_id === reservationId && isId(v.request_id) && decimal(v.control_epoch) && v.expires_in_ms === 30000, 'Invalid control ticket')
      return { operationId: v.request_id, reservationId, controlEpoch: v.control_epoch, expiresInMs: v.expires_in_ms }
    },
    async releaseControlReservation(instanceId, reservationId, claimantId) {
      id(claimantId)
      const v = await post(`/control-reservations/${id(reservationId)}`, instanceId, { claimant_id: json(claimantId) }, 'DELETE')
      check(v.reservation_id === reservationId && Array.isArray(v.released) && Array.isArray(v.blocked), 'Invalid control release')
      return { reservationId, released: v.released.map(v => { check(isId(v), "Invalid released target"); return v }), blocked: v.blocked.map(v => { check(isId(v), "Invalid blocked target"); return v }) }
    },
    controlCommand: (binding, intent) => submit(binding, intent, 'controls', { command: command(intent.command) }, intent.command.action),
    startTrial: (binding, intent) => submit(binding, intent, 'trials', { trial: trial(intent.trial) }, 'trial_start'),
    updateTrial: (binding, intent) => submit(binding, intent, `trials/${id(intent.trialId)}/target`, { mm: number(intent.mm) }, 'trial_target'),
    recordingAction: (binding, intent) => { check(['start', 'stop'].includes(intent.action), 'Invalid recording action', 'invalid_request'); return submit(binding, intent, `recording/${intent.action}`, {}, `recording_${intent.action}`) },
    stop: (binding, intent) => submit(binding, intent, intent.trialId === undefined ? 'stop' : `trials/${id(intent.trialId)}/stop`, {}, 'stop', true),
    async controlOperation(instanceId, operationId) { const v = operation((await request(`/operations/${id(operationId)}`, { instanceId })).operation); check(v.operationId === operationId, 'Operation identity changed'); return v },
    async controlScopes(instanceId) {
      id(instanceId)
      const v = await request('/control-scopes', { instanceId })
      check(Array.isArray(v.scopes), 'Missing original control scopes')
      const ids = new Set()
      return v.scopes.map(value => { check(isId(value.stop_request_id) && !ids.has(value.stop_request_id) && typeof value.current === 'boolean' && typeof value.control_granted === 'boolean', 'Invalid original Stop scope'); ids.add(value.stop_request_id); return { stopRequestId: value.stop_request_id, scope: originalScope(value.scope), current: value.current, controlGranted: value.control_granted } })
    },
    async stopControlOriginalScope(instanceId, stopRequestId, intent) {
      id(intent.claimantId)
      const expected = scopeText(intent.expectedScope)
      const v = await post(`/control-scopes/${id(stopRequestId)}/stop`, instanceId, { claimant_id: json(intent.claimantId), expected_scope: expected })
      const result = operation(v.operation)
      check(result.operationId === stopRequestId && result.action === 'stop' && result.reservationId === null && result.members.length === 1 && typeof v.new_submission === 'boolean'
        && sameScope({ ...result.members[0], controlEpoch: result.controlEpoch }, intent.expectedScope), 'Original Stop receipt scope changed')
      return { ...result, newSubmission: v.new_submission }
    },
    async originalCleanupTicket(instanceId, stopRequestId, intent) {
      id(intent.claimantId)
      const v = await post(`/control-scopes/${id(stopRequestId)}/cleanup-ids`, instanceId, { claimant_id: json(intent.claimantId), expected_scope: scopeText(intent.expectedScope) })
      check(isId(v.request_id) && isId(v.grant_id) && v.expires_in_ms === 30000, 'Invalid original cleanup ticket')
      return { operationId: v.request_id, grantId: v.grant_id }
    },
    async cleanupOriginalScope(instanceId, stopRequestId, intent) {
      check(['heartbeat_stop', 'recording_stop'].includes(intent.action), 'Unsupported original cleanup action', 'invalid_request')
      const v = await post(`/control-scopes/${id(stopRequestId)}/cleanup`, instanceId, { ...owner(intent), expected_scope: scopeText(intent.expectedScope), action: json(intent.action) })
      const result = operation(v.operation)
      check(result.operationId === intent.operationId && result.action === intent.action && result.claimantId === intent.claimantId && result.reservationId === null && sameScope({ ...result.members[0], controlEpoch: result.controlEpoch }, intent.expectedScope) && typeof v.new_submission === 'boolean', 'Original cleanup receipt scope changed')
      return { ...result, newSubmission: v.new_submission }
    },
    async trialStatus(binding, trialId) {
      gate(binding)
      const v = await request(`/bindings/${id(binding.binding_id)}/trials/${id(trialId)}`, { instanceId: binding.instance_id })
      check(v.trial_id === trialId && typeof v.trial?.native_json_text === 'string' && typeof v.trial.state === 'string' && typeof v.trial.stop_observed === 'boolean' && typeof v.trial.stop_confirmation_overdue === 'boolean' && (v.trial.elapsed_ms === null || decimal(v.trial.elapsed_ms)), 'Invalid trial state')
      const receipt = operation(v.operation); check(receipt.operationId === trialId && sameMember(receipt.members[0], binding), 'Trial identity changed')
      return { trialId, operation: receipt, trial: { nativeJsonText: v.trial.native_json_text, state: v.trial.state, stopObserved: v.trial.stop_observed, stopConfirmationOverdue: v.trial.stop_confirmation_overdue, elapsedMs: v.trial.elapsed_ms } }
    },
    async recordingStatus(binding) {
      gate(binding)
      const v = await request(`/bindings/${id(binding.binding_id)}/recording`, { instanceId: binding.instance_id })
      check(typeof v.native_json_text === 'string' && typeof v.active === 'boolean' && typeof v.failed === 'boolean' && (v.recording_id === null || isId(v.recording_id)), 'Invalid recording state')
      return { nativeJsonText: v.native_json_text, active: v.active, failed: v.failed, recordingId: v.recording_id }
    },
    async createControlGroup(instanceId, bindings, claimantId) {
      id(claimantId); check(Array.isArray(bindings) && bindings.length >= 1 && bindings.length <= 16, 'Expected 1..16 explicit members', 'invalid_request')
      const refs = bindings.map(binding => { check(binding.instance_id === instanceId, 'Group instance mismatch', 'invalid_request'); return object({ binding_id: json(binding.binding_id), ...gate(binding) }) })
      check(new Set(bindings.map(b => b.binding_id)).size === bindings.length && new Set(bindings.map(b => b.identity.uid)).size === bindings.length, 'Duplicate binding or physical UID alias', 'invalid_request')
      const v = group(await post('/groups', instanceId, { claimant_id: json(claimantId), members: `[${refs.join(',')}]` }))
      check(v.claimantId === claimantId && v.members.length === bindings.length && v.members.every((m,i) => m.bindingId === bindings[i].binding_id && sameMember(m, bindings[i])), 'Group original scope changed'); return v
    },
    async groupTickets(instanceId, groupId, claimantId) {
      id(claimantId)
      const v = await post(`/groups/${id(groupId)}/operation-ids`, instanceId, { claimant_id: json(claimantId) })
      check(v.group_id === groupId && v.expires_in_ms === 30000 && Array.isArray(v.requests) && v.requests.length >= 1 && v.requests.length <= 16, 'Invalid group tickets')
      const bindings = new Set(), operations = new Set()
      return { groupId, expiresInMs: v.expires_in_ms, requests: v.requests.map(r => { check(isId(r.binding_id) && isId(r.request_id) && decimal(r.control_epoch) && !bindings.has(r.binding_id) && !operations.has(r.request_id), 'Invalid independent member ticket'); bindings.add(r.binding_id); operations.add(r.request_id); return { bindingId: r.binding_id, operationId: r.request_id, controlEpoch: r.control_epoch } }) }
    },
    async groupStatus(instanceId, groupId) { const v = group(await request(`/groups/${id(groupId)}`, { instanceId })); check(v.groupId === groupId, 'Group identity changed'); return v },
    async releaseControlGroup(instanceId, groupId, claimantId) { id(claimantId); const v = group(await post(`/groups/${id(groupId)}`, instanceId, { claimant_id: json(claimantId) }, 'DELETE')); check(v.groupId === groupId && v.claimantId === claimantId && v.released, 'Invalid group release'); return v },
    async groupSubmit(instanceId, groupId, intent) {
      check(['controls', 'trials', 'trials/target', 'recording/start', 'recording/stop'].includes(intent.action), 'Invalid group action', 'invalid_request')
      id(intent.claimantId); check(Array.isArray(intent.requests) && intent.requests.length >= 1 && intent.requests.length <= 16, 'Expected explicit member requests', 'invalid_request')
      const requests = intent.requests.map(r => { id(r.bindingId); id(r.operationId); const fields = { binding_id: json(r.bindingId), request_id: json(r.operationId) }; if (intent.action === 'controls') fields.command = command(r.command); if (intent.action === 'trials') fields.trial = trial(r.trial); if (intent.action === 'trials/target') { id(r.trialId); fields.trial_id = json(r.trialId); fields.mm = number(r.mm) } return object(fields) })
      check(new Set(intent.requests.map(r => r.bindingId)).size === requests.length && new Set(intent.requests.map(r => r.operationId)).size === requests.length, 'Duplicate member request', 'invalid_request')
      const v = group(await post(`/groups/${id(groupId)}/${intent.action}`, instanceId, { claimant_id: json(intent.claimantId), requests: `[${requests.join(',')}]` }), false)
      check(v.groupId === groupId && v.members.length === intent.requests.length && v.members.every(m => intent.requests.some(r => r.bindingId === m.bindingId && (m.operation === null || (m.error !== null || m.operation.operationId === r.operationId) && m.operation.claimantId === intent.claimantId))), 'Group result scope changed'); return v
    },
    async stopGroup(instanceId, groupId, intent) { const v = group(await post(`/groups/${id(groupId)}/stop`, instanceId, owner(intent)), false); check(v.groupId === groupId, 'Group Stop scope changed'); return v },
  }
}
