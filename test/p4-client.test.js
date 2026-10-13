import test from 'node:test'
import assert from 'node:assert/strict'
import { createP4Client } from '../src/p4-client.js'

const binding = { instance_id: 'instance', binding_id: 'binding/a', target_id: 'can:1', identity: { uid: '01'.repeat(12), run_nonce: '02'.repeat(16) }, connection_generation: '18446744073709551615' }
const wireMember = (b = binding) => ({ binding_id: b.binding_id, target_id: b.target_id, expected_identity: b.identity, connection_generation: b.connection_generation })
const intent = { claimantId: 'agent', reservationId: 'reservation', operationId: 'operation', controlEpoch: '7' }
const native = '{"exact":0.12345678901234567890123456789,"counter":18446744073709551615}'
const operation = (action = 'position', extra = {}) => ({ request_id: intent.operationId, reservation_id: intent.reservationId, claimant_id: intent.claimantId, action, control_epoch: '7', members: [wireMember()], admission: 'finished', submission: 'locally_submitted', control_effect: 'known', observation: 'unconfirmed', phase: 'submission', native_json_text: native, error: null, follow_up: { reconnect_required: false, readback_views: [] }, ...extra })
const receipt = (action, extra) => ({ operation: operation(action, extra), new_submission: true })
function fixture(values) {
  const calls = []
  const client = createP4Client(async (path, options) => { calls.push({ path, ...options }); const value = values.shift(); if (value instanceof Error) throw value; return value })
  return { client, calls }
}
const trial = {
  command: { action: 'position', mm: '0.12345678901234567890123456789' },
  envelope: { position_min_mm: '-1e1', position_max_mm: '10', velocity_abs_max_mm_s: '2.0', force_abs_max_n: '1E+1', stiffness_max_n_per_mm: '10', damping_max_ns_per_mm: '10', duration_max_s: '5' },
  duration_s: '5.00', reach: { tolerance_mm: '0.000000000000000000000001', settle_ms: '18446744073709551615' },
}

test('fixed control body retains exact JSON number token spelling and opaque native evidence', async () => {
  const { client, calls } = fixture([receipt('position')])
  const result = await client.controlCommand(binding, { ...intent, command: { action: 'position', mm: '-0.000000000000000000000012300' } })
  assert.equal(calls[0].path, '/bindings/binding%2Fa/controls')
  assert.match(calls[0].bodyText, /"mm":-0\.000000000000000000000012300/)
  assert.match(calls[0].bodyText, /"api_version":2/)
  assert.equal(calls[0].body, undefined)
  assert.equal(result.nativeJsonText, native)
  assert.equal(result.controlEffect, 'known')
  assert.equal(result.members[0].connectionGeneration, '18446744073709551615')
})

test('numbers, unsafe tokens, extra command fields and arbitrary actions never issue a request', async () => {
  const { client, calls } = fixture([])
  for (const mm of [1, NaN, Infinity, '', ' 1', '1 ', '+1', '01', '.1', '1.', '0x10', '1,"action":"stop"', 'null', '1\n']) {
    assert.throws(() => client.controlCommand(binding, { ...intent, command: { action: 'position', mm } }), { code: 'invalid_request' })
  }
  assert.throws(() => client.controlCommand(binding, { ...intent, command: { action: 'stop' } }), { code: 'invalid_request' })
  assert.throws(() => client.controlCommand(binding, { ...intent, command: { action: 'position', mm: '1', path: '/tmp' } }), { code: 'invalid_request' })
  assert.equal(calls.length, 0)
})

test('impedance and trial f32 inputs use fixed fields with no JS number round trip', async () => {
  const { client, calls } = fixture([receipt('impedance'), receipt('trial_start')])
  await client.controlCommand(binding, { ...intent, command: { action: 'impedance', equilibrium_mm: '-0', stiffness_n_per_mm: '1.2300e-2', damping_ns_per_mm: '2E+3' } })
  assert.match(calls[0].bodyText, /"equilibrium_mm":-0,"stiffness_n_per_mm":1\.2300e-2,"damping_ns_per_mm":2E\+3/)
  await client.startTrial(binding, { ...intent, trial })
  assert.equal(calls[1].path, '/bindings/binding%2Fa/trials')
  assert.match(calls[1].bodyText, /"mm":0\.12345678901234567890123456789/)
  assert.match(calls[1].bodyText, /"settle_ms":18446744073709551615/)
  assert.match(calls[1].bodyText, /"duration_s":5\.00/)
  assert.throws(() => client.startTrial(binding, { ...intent, trial: { ...trial, reach: { tolerance_mm: '1', settle_ms: '18446744073709551616' } } }), { code: 'invalid_request' })
})

test('trial update, recording and canonical Stop choose only their fixed routes', async () => {
  const { client, calls } = fixture([receipt('trial_target'), receipt('recording_start'), receipt('recording_stop'), receipt('stop', { reservation_id: null, stop_attempt_delay_ms: '18446744073709551615' })])
  await client.updateTrial(binding, { ...intent, trialId: 'trial/a', mm: '1e-20' })
  await client.recordingAction(binding, { ...intent, action: 'start' })
  await client.recordingAction(binding, { ...intent, action: 'stop' })
  const stopped = await client.stop(binding, { ...intent, trialId: 'trial/a' })
  assert.deepEqual(calls.map(c => c.path), ['/bindings/binding%2Fa/trials/trial%2Fa/target', '/bindings/binding%2Fa/recording/start', '/bindings/binding%2Fa/recording/stop', '/bindings/binding%2Fa/trials/trial%2Fa/stop'])
  assert.match(calls[0].bodyText, /"mm":1e-20/)
  assert.doesNotMatch(calls[3].bodyText, /reservation_id/)
  assert.equal(stopped.stopAttemptDelayMs, '18446744073709551615')
  assert.throws(() => client.recordingAction(binding, { ...intent, action: 'shell' }), { code: 'invalid_request' })
})

test('operation projection preserves unknown facts and all precise P4 evidence', async () => {
  const v = operation('trial_start', { submission: 'unknown', control_effect: 'unresolved', phase: 'recording', trial_id: 'trial', recording_id: 'recording', stop_attempt_delay_ms: null, error: { code: 'result_unknown', message: 'Original uncertain result' } })
  const { client } = fixture([{ operation: v }])
  const result = await client.controlOperation('instance', 'operation')
  assert.equal(result.submission, 'unknown')
  assert.equal(result.controlEffect, 'unresolved')
  assert.equal(result.nativeJsonText, native)
  assert.equal(result.trialId, 'trial')
  assert.equal(result.recordingId, 'recording')
  assert.equal(result.stopAttemptDelayMs, null)
  assert.deepEqual(result.error, v.error)
})

test('permission updates send complete desired flags and preserve shared grant and Stop metadata', async () => {
  const { client, calls } = fixture([
    { ...wireMember(), permissions: { maintenance: true, control: true }, grant_id: 'grant', control_epoch: '7', stop_request_id: 'stop' },
    { ...wireMember(), permissions: { maintenance: true, control: false }, grant_id: 'new-grant', control_epoch: null, stop_request_id: null },
  ])
  const enabled = await client.controlPermission(binding, { maintenance: true, control: true }, null)
  const disabled = await client.controlPermission(binding, { maintenance: true, control: false }, 'grant')
  assert.match(calls[0].bodyText, /"permissions":\{"maintenance":true,"control":true\}/)
  assert.equal(enabled.stopRequestId, 'stop')
  assert.equal(disabled.grantId, 'new-grant')
  assert.equal(disabled.maintenance, true)
  assert.equal(disabled.stopRequestId, null)
  assert.match(calls[0].bodyText, /"expected_grant_id":null/)
  assert.match(calls[1].bodyText, /"expected_grant_id":"grant"/)
  await assert.rejects(client.controlPermission(binding, true), { code: 'invalid_request' })
})

test('permission view retains current grant and CAS conflicts never retry or overwrite', async () => {
  const conflict = Object.assign(new Error('Permission grant changed'), { code: 'permission_conflict' })
  const { client, calls } = fixture([{ ...wireMember(), permissions: { maintenance: true, control: true }, grant_id: 'grant', control_epoch: '7', stop_request_id: 'stop' }, conflict])
  const current = await client.permissionView(binding)
  assert.equal(current.grantId, 'grant')
  assert.equal(current.maintenance, true)
  assert.equal(calls[0].bodyText, undefined)
  await assert.rejects(client.controlPermission(binding, { maintenance: true, control: false }, current.grantId), error => error === conflict)
  assert.equal(calls.length, 2)
  await assert.rejects(client.controlPermission(binding, { maintenance: true, control: false }), { code: 'invalid_request' })
  assert.equal(calls.length, 2)
})

test('original Stop chooses an explicit original scope and validates all fixed fields without binding fallback', async () => {
  const scope = { target_id: binding.target_id, expected_identity: binding.identity, connection_generation: binding.connection_generation, control_epoch: '7' }
  const stopped = receipt('stop', { request_id: 'original-stop', reservation_id: null })
  const { client, calls } = fixture([
    { scopes: [{ stop_request_id: 'original-stop', scope, current: false, control_granted: true }] },
    stopped,
    receipt('stop', { request_id: 'original-stop', reservation_id: null, members: [wireMember(other)] }),
  ])
  const [candidate] = await client.controlScopes('instance')
  assert.equal(candidate.current, false)
  assert.equal(candidate.scope.connectionGeneration, '18446744073709551615')
  const original = { claimantId: 'agent', expectedScope: candidate.scope }
  assert.equal((await client.stopControlOriginalScope('instance', candidate.stopRequestId, original)).operationId, candidate.stopRequestId)
  assert.equal(calls[1].path, '/control-scopes/original-stop/stop')
  assert.match(calls[1].bodyText, /"expected_scope":\{"target_id":"can:1"/)
  assert.doesNotMatch(calls[1].bodyText, /binding_id|request_id|reservation_id/)
  await assert.rejects(client.stopControlOriginalScope('instance', candidate.stopRequestId, original), { code: 'invalid_response' })
})

test('single reservation, ticket and release retain exact member grant and ownership', async () => {
  const { client, calls } = fixture([
    { reservation_id: 'reservation', claimant_id: 'agent', permission: 'control', control_epoch: '7', stop_request_id: 'stop', members: [{ ...wireMember(), grant_id: 'grant' }] },
    { reservation_id: 'reservation', request_id: 'operation', control_epoch: '7', expires_in_ms: 30000 },
    { reservation_id: 'reservation', released: [], blocked: ['can:1'] },
  ])
  const held = await client.controlReservation(binding, 'agent')
  assert.equal(held.members[0].grantId, 'grant')
  assert.equal((await client.controlTicket('instance', 'reservation', 'agent')).operationId, 'operation')
  assert.deepEqual(await client.releaseControlReservation('instance', 'reservation', 'agent'), { reservationId: 'reservation', released: [], blocked: ['can:1'] })
  assert.equal(calls[2].method, 'DELETE')
  assert.doesNotMatch(calls[2].bodyText, /stop|disconnect/)
})

const other = { ...binding, binding_id: 'binding-b', target_id: 'can:2', identity: { uid: '03'.repeat(12), run_nonce: '04'.repeat(16) } }
const fullGroup = () => ({ group_id: 'group', reservation_id: 'reservation', claimant_id: 'agent', stop_request_id: 'group-stop', released: false, device_atomicity: false, members: [binding, other].map((b, i) => ({ ...wireMember(b), control_epoch: `${7 + i}`, stop_request_id: `stop-${i}`, operation: null, error: null })) })
test('groups reject aliases locally and preserve every explicit original member and own Stop', async () => {
  const { client, calls } = fixture([fullGroup(), fullGroup(), { ...fullGroup(), released: true }])
  const group = await client.createControlGroup('instance', [binding, other], 'agent')
  assert.deepEqual(group.members.map(m => m.stopRequestId), ['stop-0', 'stop-1'])
  assert.equal(group.deviceAtomicity, false)
  await assert.rejects(client.createControlGroup('instance', [binding, { ...binding, binding_id: 'alias' }], 'agent'), { code: 'invalid_request' })
  await assert.rejects(client.createControlGroup('other-instance', [binding], 'agent'), { code: 'invalid_request' })
  assert.equal((await client.groupStatus('instance', 'group')).members.length, 2)
  const released = await client.releaseControlGroup('instance', 'group', 'agent')
  assert.equal(released.released, true)
  assert.equal(released.members.length, 2)
  assert.equal(calls[2].method, 'DELETE')
})

test('group tickets retain independent ids and reject duplicated backend tickets', async () => {
  const tickets = { group_id: 'group', expires_in_ms: 30000, requests: [{ binding_id: binding.binding_id, request_id: 'a', control_epoch: '7' }, { binding_id: other.binding_id, request_id: 'b', control_epoch: '8' }] }
  const { client } = fixture([tickets, { ...tickets, requests: [tickets.requests[0], tickets.requests[0]] }])
  assert.deepEqual((await client.groupTickets('instance', 'group', 'agent')).requests.map(r => r.operationId), ['a', 'b'])
  await assert.rejects(client.groupTickets('instance', 'group', 'agent'), { code: 'invalid_response' })
})

test('group partial error preserves prior unknown receipt; target update preserves lexical value', async () => {
  const prior = operation('trial_target', { request_id: 'prior', submission: 'unknown', control_effect: 'unresolved' })
  const response = { group_id: 'group', device_atomicity: false, members: [{ binding_id: binding.binding_id, operation: prior, error: { code: 'reservation_busy', message: 'Original member remains unknown' } }] }
  const { client, calls } = fixture([response, response])
  const result = await client.groupSubmit('instance', 'group', { claimantId: 'agent', action: 'trials/target', requests: [{ bindingId: binding.binding_id, operationId: 'new', trialId: 'trial', mm: '-0.000000000000000000000001' }] })
  assert.equal(result.members[0].operation.operationId, 'prior')
  assert.equal(result.members[0].operation.submission, 'unknown')
  assert.equal(result.members[0].error.code, 'reservation_busy')
  assert.match(calls[0].bodyText, /"mm":-0\.000000000000000000000001/)
  await client.stopGroup('instance', 'group', { claimantId: 'agent', operationId: 'group-stop' })
  assert.equal(calls[1].path, '/groups/group/stop')
  assert.doesNotMatch(calls[1].bodyText, /requests|reservation_id/)
})

test('trial and recording statuses preserve full opaque text and precise counters', async () => {
  const { client, calls } = fixture([
    { trial_id: 'operation', operation: operation('trial_start'), trial: { native_json_text: native, state: 'stopping', stop_observed: false, stop_confirmation_overdue: true, elapsed_ms: '18446744073709551615' } },
    { native_json_text: native, active: true, failed: false, recording_id: 'recording' },
    receipt('position', { members: [wireMember(other)] }),
  ])
  const value = await client.trialStatus(binding, 'operation')
  assert.equal(value.trial.elapsedMs, '18446744073709551615')
  assert.equal(value.trial.nativeJsonText, native)
  assert.equal(value.trial.stopConfirmationOverdue, true)
  assert.equal((await client.recordingStatus(binding)).nativeJsonText, native)
  assert.equal(calls[0].bodyText, undefined)
  await assert.rejects(client.controlCommand(binding, { ...intent, command: { action: 'position', mm: '1' } }), { code: 'invalid_response' })
})

test('unknown HTTP result is never automatically retried', async () => {
  const uncertain = Object.assign(new Error('Original outcome unknown'), { code: 'sdk_timeout', unknown: true })
  const { client, calls } = fixture([uncertain])
  await assert.rejects(client.controlCommand(binding, { ...intent, command: { action: 'position', mm: '1' } }), error => error === uncertain)
  assert.equal(calls.length, 1)
})
test('canonical Stop accepts the original claimant but ordinary control never does', async () => {
  const { client } = fixture([receipt('stop', { claimant_id: 'other', reservation_id: null }), receipt('position', { claimant_id: 'other' })])
  assert.equal((await client.stop(binding, intent)).claimantId, 'other')
  await assert.rejects(client.controlCommand(binding, { ...intent, command: { action: 'position', mm: '1' } }), { code: 'invalid_response' })
})
test('original cleanup uses fixed original scope tickets and never a reservation or Stop action', async () => {
  const scope = { targetId: binding.target_id, identity: { uid: binding.identity.uid, runNonce: binding.identity.run_nonce }, connectionGeneration: binding.connection_generation, controlEpoch: '7' }
  const { client, calls } = fixture([{ request_id: 'operation', grant_id: 'g', expires_in_ms: 30000 }, receipt('heartbeat_stop', { reservation_id: null })])
  assert.equal((await client.originalCleanupTicket('instance', 'canonical', { claimantId: 'agent', expectedScope: scope })).operationId, 'operation')
  await client.cleanupOriginalScope('instance', 'canonical', { ...intent, expectedScope: scope, action: 'heartbeat_stop' })
  assert.equal(calls[0].path, '/control-scopes/canonical/cleanup-ids'); assert.equal(calls[1].path, '/control-scopes/canonical/cleanup')
  assert.doesNotMatch(calls[1].bodyText, /reservation_id|binding_id/)
  await assert.rejects(client.cleanupOriginalScope('instance', 'canonical', { ...intent, expectedScope: scope, action: 'heartbeat_start' }), { code: 'invalid_request' })
  assert.equal(calls.length, 2)
})
