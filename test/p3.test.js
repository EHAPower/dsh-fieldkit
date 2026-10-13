import test from 'node:test'
import assert from 'node:assert/strict'
import { createP3Client } from '../src/p3-client.js'
import { createP3Service } from '../src/p3-service.js'
const uid = 'a'.repeat(24), nonce = 'b'.repeat(32)
const owner = { instance_id: 'instance', binding_id: 'sdk-binding', target_id: 'usb', identity: { uid, run_nonce: nonce }, connection_generation: '1' }
const member = { bindingId: 'sdk-binding', targetId: 'usb', identity: { uid, runNonce: nonce }, connectionGeneration: '1', grantId: 'sdk-grant' }
function fixture(overrides = {}) {
  let postCount = 0
  const sessions = new Map(), b = { id: 'local-binding', owner, target: { targetId: 'usb' }, expired: false }
  const value = { operationId: 'issued-1', reservationId: 'reservation', claimantId: 'chat', action: 'reset_application', controlEpoch: '2', members: [member], admission: 'attempting', submission: 'not_attempted', controlEffect: 'not_attempted', observation: 'unconfirmed', phase: 'submission', nativeJsonText: null, followUp: { reconnectRequired: false, readbackViews: [] }, error: null, newSubmission: true }
  const client = { maintenancePermission: async (_b, enabled) => ({ ...member, grantId: enabled ? 'sdk-grant' : null, maintenance: enabled }), maintenanceReservation: async () => ({ reservationId: 'reservation', controlEpoch: '2', members: [member] }), maintenanceTicket: async () => ({ operationId: 'issued-1', controlEpoch: '2' }), submitMaintenance: async () => { postCount++; return value }, maintenanceOperation: async () => value, releaseMaintenanceReservation: async () => ({}), validateConfiguration: async () => ({ valid: true }), ...overrides }
  b.client = client
  const service = createP3Service({ mode: 'service-v2', session: s => { if (!sessions.has(s)) sessions.set(s, { selectedBindingId: b.id }); return sessions.get(s) }, selected: s => { if (s !== 'chat' || b.expired) throw new Error('stale'); return b }, attach: async () => ({ instance_id: 'instance', capabilities: ['maintenance', 'maintenance_permissions', 'operation_read', 'config_validate'] }), http: () => client })
  const target = { instanceId: 'instance', bindingId: b.id, targetId: 'usb', uid, runNonce: nonce, connectionGeneration: '1' }
  return { service, target, b, value, client, posts: () => postCount, grant: () => service.setMaintenancePermission('chat', { target, enabled: true }) }
}
test('human SDK grant and exact member required; model/session cannot invent grant or reclaim pending submission', async () => {
  const f = fixture()
  await assert.rejects(f.service.submitMaintenance('chat', { grantId: 'invented', action: 'reset_application' }), { code: 'permission_denied' })
  assert.equal((await f.grant()).grantId, 'sdk-grant')
  const receipt = await f.service.submitMaintenance('chat', { grantId: 'sdk-grant', action: 'reset_application' })
  assert.equal(receipt.operationId, 'issued-1'); assert.equal(f.posts(), 1)
  await assert.rejects(f.service.submitMaintenance('chat', { grantId: 'sdk-grant', action: 'reset_application' }), { code: 'maintenance_busy' })
  await assert.rejects(f.service.getMaintenanceOperation('other-chat', receipt.operationId), { code: 'not_found' })
  f.b.expired = true
  assert.equal((await f.service.getMaintenanceOperation('chat', receipt.operationId)).operationId, receipt.operationId)
})
test('POST timeout retains issued ID and unknown block, only original receipt lookup recovers without retry', async () => {
  let submissions = 0
  const f = fixture({ submitMaintenance: async () => { submissions++; throw Object.assign(new Error('lost response'), { code: 'sdk_timeout' }) } })
  await f.grant()
  const receipt = await f.service.submitMaintenance('chat', { grantId: 'sdk-grant', action: 'reset_application' })
  assert.equal(receipt.unknown, true); assert.equal(receipt.unknownSource, 'transport'); assert.equal(receipt.operationId, 'issued-1')
  await assert.rejects(f.service.submitMaintenance('chat', { grantId: 'sdk-grant', action: 'reset_application' }), { code: 'maintenance_busy' })
  f.value.admission = 'finished'; f.value.submission = 'unknown'; f.value.controlEffect = 'unresolved'
  const recovered = await f.service.getMaintenanceOperation('chat', 'issued-1')
  assert.equal(recovered.unknown, true); assert.equal(recovered.unknownSource, 'sdk')
  assert.equal(submissions, 1)
})
test('configuration wire preserves duplicate keys, exact large numbers and whitespace', async () => {
  const raw = '{\n"x":18446744073709551615,"x":1e-30\n}\n', calls = []
  const client = createP3Client(async (path, request) => { calls.push({ path, request }); return { valid: true } })
  await client.validateConfiguration('instance', raw)
  assert.equal(calls[0].request.body.config_text, raw); assert.equal(calls[0].path, '/config/validate')
})
test('SDK receipt projection preserves native evidence and separates unknown from local submission', async () => {
  const native = '{"integer":18446744073709551615,"fraction":1e-30}'
  const op = { request_id: 'issued-1', reservation_id: 'reservation', claimant_id: 'chat', action: 'reset_application', control_epoch: '2', members: [{ target_id: 'usb', expected_identity: owner.identity, connection_generation: '1' }], admission: 'finished', submission: 'locally_submitted', control_effect: 'not_applicable', observation: 'unconfirmed', phase: null, native_json_text: native, follow_up: { reconnect_required: true, readback_views: ['user', 'startup'] }, error: null }
  const client = createP3Client(async () => ({ operation: op }))
  const result = await client.maintenanceOperation('instance', 'issued-1')
  assert.equal(result.nativeJsonText, native); assert.equal(result.submission, 'locally_submitted'); assert.equal(result.observation, 'unconfirmed')
})
test('revocation rejects old grant and definite pre-admission rejection is never called unknown', async () => {
  const f = fixture({ submitMaintenance: async () => { throw Object.assign(new Error('grant revoked'), { code: 'permission_denied' }) } })
  await f.grant()
  await f.service.setMaintenancePermission('chat', { target: f.target, enabled: false })
  await assert.rejects(f.service.submitMaintenance('chat', { grantId: 'sdk-grant', action: 'reset_application' }), { code: 'permission_denied' })
  await f.grant()
  const receipt = await f.service.submitMaintenance('chat', { grantId: 'sdk-grant', action: 'reset_application' })
  assert.equal(receipt.unknown, false); assert.equal(receipt.submission, 'not_submitted')
})
test('async grant preparation cannot migrate into a changed selection', async () => {
  let release
  const f = fixture({ maintenancePermission: () => new Promise(resolve => { release = resolve }) })
  const pending = f.grant()
  await new Promise(resolve => setImmediate(resolve))
  f.b.expired = true; release({ ...member, maintenance: true })
  await assert.rejects(pending, { code: 'binding_stale' })
  assert.equal((await f.service.maintenanceContext('chat')).grant, null)
})
test('failed human revoke immediately removes the host grant and cannot permit later model submission', async () => {
  const f = fixture()
  await f.grant()
  f.client.maintenancePermission = async () => { throw Object.assign(new Error('lost revoke'), { code: 'sdk_timeout' }) }
  await assert.rejects(f.service.setMaintenancePermission('chat', { target: f.target, enabled: false }), { code: 'sdk_timeout' })
  assert.equal((await f.service.maintenanceContext('chat')).grant, null)
  await assert.rejects(f.service.submitMaintenance('chat', { grantId: 'sdk-grant', action: 'reset_application' }), { code: 'permission_denied' })
  assert.equal(f.posts(), 0)
})
test('known never-submitted terminal releases only its own reservation; unknown never releases', async () => {
  let releases = 0
  const f = fixture({ releaseMaintenanceReservation: async () => { releases++; return { released: ['usb'], blocked: [] } } })
  await f.grant(); f.value.admission = 'finished'; f.value.submission = 'not_submitted'
  await f.service.submitMaintenance('chat', { grantId: 'sdk-grant', action: 'reset_application' })
  assert.equal(releases, 1)
  const g = fixture({ releaseMaintenanceReservation: async () => { releases++; return {} } })
  await g.grant(); g.value.admission = 'finished'; g.value.submission = 'unknown'; g.value.controlEffect = 'unresolved'
  await g.service.submitMaintenance('chat', { grantId: 'sdk-grant', action: 'reset_application' })
  assert.equal(releases, 1)
})
test('maintenance permission preserves control with SDK grant CAS and never retries a conflict', async () => {
  const calls = []
  const metadata = { binding_id: owner.binding_id, target_id: 'usb', expected_identity: owner.identity, connection_generation: '1', grant_id: 'shared-grant', permissions: { maintenance: false, control: true } }
  const client = createP3Client(async (path, options) => { calls.push({ path, options }); if (!options.method) return metadata; throw Object.assign(new Error('permission changed elsewhere'), { code: 'permission_conflict' }) })
  await assert.rejects(client.maintenancePermission(owner, true), { code: 'permission_conflict' })
  assert.equal(calls.length, 2); assert.deepEqual(calls[1].options.body.permissions, { maintenance: true, control: true }); assert.equal(calls[1].options.body.expected_grant_id, 'shared-grant')
})
for (const code of ['identity_changed', 'binding_stale', 'permission_denied']) test(`maintenance receipt ${code} invalidates only its appropriate binding or grant`, async () => {
  const f = fixture(); await f.grant()
  Object.assign(f.value, { admission: 'finished', submission: 'not_submitted', controlEffect: 'not_attempted', error: { code, message: 'synthetic gate rejection' } })
  const result = await f.service.submitMaintenance('chat', { grantId: 'sdk-grant', action: 'reset_application' })
  assert.equal(result.error.code, code); assert.equal(result.unknown, false)
  const context = await f.service.maintenanceContext('chat'); assert.equal(context.grant, null)
  assert.equal(f.b.expired, code !== 'permission_denied'); assert.equal(context.target === null, code !== 'permission_denied')
})
test('querying an old revoked-grant receipt cannot revoke a newer explicit human grant', async () => {
  const f = fixture(); await f.grant(); Object.assign(f.value, { admission: 'finished', submission: 'not_submitted', controlEffect: 'not_attempted', error: { code: 'permission_denied', message: 'old grant rejected' } })
  await f.service.submitMaintenance('chat', { grantId: 'sdk-grant', action: 'reset_application' })
  f.client.maintenancePermission = async () => ({ ...member, grantId: 'new-human-grant', maintenance: true })
  await f.grant(); await f.service.getMaintenanceOperation('chat', 'issued-1')
  assert.equal((await f.service.maintenanceContext('chat')).grant.grantId, 'new-human-grant')
})
