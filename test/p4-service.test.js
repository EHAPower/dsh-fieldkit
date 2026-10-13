import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRecoveryJournal } from '../src/recovery-journal.js'
import { createControlTools } from '../src/control-tools.js'
import { createP4Service } from '../src/p4-service.js'
const error = code => Object.assign(new Error(code), { code })
function setup(recoveryJournal = { prepare: async () => 'synthetic-record', complete: async () => {} }) {
  const gate = { hold: false }, calls = [], timers = [], bindings = [], descriptions = { instance_id: 'i', capabilities: ['control', 'control_groups', 'trials', 'recording_write', 'control_scopes'] }
  let serial = 0
  const receipt = (binding, intent, action) => ({ operationId: intent.operationId, claimantId: intent.claimantId, action, controlEpoch: '1', members: [{ targetId: binding.target_id, identity: { uid: binding.identity.uid, runNonce: binding.identity.run_nonce }, connectionGeneration: '1' }], admission: 'finished', submission: 'locally_submitted', controlEffect: 'known', observation: 'unconfirmed', phase: 'submission', nativeJsonText: '{"n":18446744073709551615}', error: null, newSubmission: true })
  const client = {
    targets: async () => ({ instance_id: descriptions.instance_id, targets: ['usb', 'can:1'].map((target_id, i) => ({ target_id, connected: true, can_attach: true, identity: { uid: `u${i}`, run_nonce: 'n' }, connection_generation: '1' })) }),
    bind: async request => { calls.push(['bind', request]); const b = { ...request, binding_id: `b${bindings.length}`, identity: request.expected_identity }; bindings.push(b); return b },
    permissionView: async () => ({ maintenance: true, control: false, grantId: 'old' }),
    controlPermission: async (b, p, cas) => { calls.push(['permission', p, cas]); return { grantId: 'g', controlEpoch: '1', stopRequestId: `stop-${b.binding_id}` } },
    controlReservation: async () => ({ reservationId: 'r', controlEpoch: '1' }),
    controlTicket: async () => ({ operationId: `op${++serial}`, controlEpoch: '1' }),
    controlCommand: async (b, intent) => { calls.push(['command', intent]); return receipt(b, intent, intent.command.action) },
    stop: async (b, intent) => { calls.push(['stop', intent]); return receipt(b, { ...intent, claimantId: 'another-chat' }, 'stop') },
    renew: async b => calls.push(['renew', b]), detach: async b => calls.push(['detach', b]),
    releaseControlReservation: async () => ({ blocked: [] }),
    controlOperation: async () => { throw error('sdk_timeout') },
    controlScopes: async () => [{ stopRequestId: 'canonical', scope: { targetId: 'can:1', identity: { uid: 'u1', runNonce: 'n' }, connectionGeneration: '1', controlEpoch: '1' }, current: true, controlGranted: true }],
    stopControlOriginalScope: async (_i, id, intent) => { calls.push(['original', intent]); return receipt({ target_id: intent.expectedScope.targetId, identity: { uid: intent.expectedScope.identity.uid, run_nonce: intent.expectedScope.identity.runNonce } }, { operationId: id, claimantId: 'other' }, 'stop') },
  }
  const service = createP4Service({ mode: 'service-v2', recoveryJournal, session: s => assert.ok(s), attach: async () => gate.hold ? new Promise(() => {}) : descriptions, currentInstance: () => descriptions.instance_id, http: () => client, schedule: callback => { timers.push(callback); return { unref() {} } }, clear() {} })
  const scope = async () => { const { candidates } = await service.controlCandidates('chat'); return service.createControlScope('chat', { candidateIds: [candidates[0].candidateId] }) }
  return { service, client, calls, timers, descriptions, scope, receipt, bindings, gate }
}
test('human scope attaches without connecting, preserves maintenance CAS and raw decimal command', async () => {
  const x = setup(), s = await x.scope()
  assert.equal(x.calls[0][1].intent, 'attach'); assert.equal(x.calls[0][1].lease_ms, 120000)
  assert.deepEqual(x.calls[1], ['permission', { maintenance: true, control: true }, 'old'])
  const raw = '1.00000000000000000000000000000000000000001'
  const result = await x.service.submitControl('chat', { scopeId: s.scopeId, command: { action: 'position', mm: raw } })
  assert.equal(x.calls.at(-1)[1].command.mm, raw); assert.equal(result.results[0].nativeJsonText, '{"n":18446744073709551615}')
  await assert.rejects(x.service.submitControl('other', { scopeId: s.scopeId, command: { action: 'position', mm: raw } }), { code: 'not_found' })
})
test('transport unknown is retained and forbids another mutation while canonical Stop stays independent and coalesces', async () => {
  const x = setup(), s = await x.scope(); x.client.controlCommand = async () => { x.calls.push(['unknown']); throw error('sdk_timeout') }
  const result = await x.service.submitControl('chat', { scopeId: s.scopeId, command: { action: 'heartbeat_once' } })
  assert.equal(result.results[0].unknownSource, 'transport')
  assert.equal((await x.service.submitControl('chat', { scopeId: s.scopeId, command: { action: 'heartbeat_once' } })).results[0].error.code, 'permission_denied')
  const stopped = await x.service.stopControlScope('chat', s.scopeId); assert.equal(stopped.unknown, false)
  await x.service.stopControlScope('chat', s.scopeId); assert.equal(x.calls.filter(v => v[0] === 'stop').length, 1)
})
test('known release detaches observer yet original canonical Stop remains available without alias replacement', async () => {
  const x = setup(), s = await x.scope()
  const released = await x.service.releaseControlScope('chat', s.scopeId); assert.equal(released.stopAvailable, true); assert.equal(released.controlReady, false)
  assert.equal(x.calls.filter(v => v[0] === 'detach').length, 1)
  const stopped = await x.service.stopControlScope('chat', s.scopeId); assert.equal(stopped.unknown, false); assert.equal(x.calls.at(-1)[0], 'original'); assert.equal(x.calls.at(-1)[1].expectedScope.targetId, 'usb')
  await x.service.disposeControlScopes(); assert.equal(x.calls.filter(v => v[0] === 'detach').length, 1); assert.equal(x.calls.filter(v => v[0] === 'stop').length, 0)
})
test('original execution Stop requires an explicit registered reference and accepts only exact canonical scope', async () => {
  const x = setup(); await assert.rejects(x.service.stopOriginalScope('chat', 'canonical'), { code: 'not_found' })
  const listed = await x.service.listOriginalStopScopes('chat'), ref = listed.scopes[0]
  assert.equal(ref.targetId, 'can:1'); assert.equal('bindingId' in ref, false)
  await assert.rejects(x.service.stopOriginalScope('other', ref.referenceId), { code: 'not_found' })
  const result = await x.service.stopOriginalScope('chat', ref.referenceId); assert.equal(result.unknown, false); assert.equal(result.operationId, 'canonical')
  await x.service.stopOriginalScope('chat', ref.referenceId); assert.equal(x.calls.filter(v => v[0] === 'original').length, 1)
})
test('instance change cannot replay an old scope; late attach after disposal is detached without granting', async () => {
  const x = setup(), s = await x.scope(); x.descriptions.instance_id = 'new'
  await assert.rejects(x.service.stopControlScope('chat', s.scopeId), { code: 'instance_mismatch' })
  const y = setup(); let resolve; y.client.bind = request => new Promise(r => { resolve = () => r({ ...request, binding_id: 'late', identity: request.expected_identity }) })
  const opening = y.scope(); await new Promise(r => setImmediate(r)); await y.service.disposeControlScopes(); resolve()
  await assert.rejects(opening, { code: 'disposed' }); assert.equal(y.calls.filter(v => v[0] === 'detach').length, 1); assert.equal(y.calls.filter(v => v[0] === 'permission').length, 0)
})
test('group partial failure preserves prior unknown separately from the new never-submitted request', async () => {
  const x = setup()
  x.client.createControlGroup = async (_i, bindings) => ({ groupId: 'group', reservationId: 'group-r', stopRequestId: 'group-stop', members: bindings.map(b => ({ bindingId: b.binding_id, controlEpoch: '1', stopRequestId: `stop-${b.binding_id}` })) })
  x.client.groupTickets = async () => ({ requests: x.bindings.map((b, i) => ({ bindingId: b.binding_id, operationId: `new${i}`, controlEpoch: '1' })) })
  x.client.groupSubmit = async (_i, _g, intent) => ({ members: x.bindings.map((b, i) => ({ bindingId: b.binding_id, operation: x.receipt(b, { claimantId: 'chat', operationId: i === 0 ? 'previous' : intent.requests[i].operationId }, 'position'), error: i === 0 ? { code: 'busy', message: 'new request rejected' } : null })) })
  const originalSubmit = x.client.groupSubmit
  x.client.groupSubmit = async (...args) => { const v = await originalSubmit(...args); v.members[0].operation.submission = 'unknown'; v.members[0].operation.controlEffect = 'unresolved'; return v }
  const { candidates } = await x.service.controlCandidates('chat'), scope = await x.service.createControlScope('chat', { candidateIds: candidates.map(c => c.candidateId) })
  const run = await x.service.submitControl('chat', { scopeId: scope.scopeId, command: { action: 'position', mm: '0.1234567890123456789' } })
  assert.equal(run.results.length, 2); assert.equal(run.results[0].operationId, 'new0'); assert.equal(run.results[0].submission, 'not_submitted')
  assert.equal(run.results[0].previousOperationId, 'previous'); assert.equal(run.results[0].previousUnknown, true); assert.equal(run.unknown, true)
  assert.equal((await x.service.submitControl('chat', { scopeId: scope.scopeId, command: { action: 'heartbeat_once' } })).results[0].error.code, 'permission_denied')
})
test('original cleanup has its own ticket and unknown is queried without mutation replay', async () => {
  const x = setup(), [{ referenceId }] = (await x.service.listOriginalStopScopes('chat')).scopes
  x.client.originalCleanupTicket = async () => { x.calls.push(['cleanup-ticket']); return { operationId: 'cleanup', grantId: 'g' } }
  x.client.cleanupOriginalScope = async () => { x.calls.push(['cleanup']); throw error('sdk_timeout') }
  const first = await x.service.cleanupOriginalScope('chat', { referenceId, action: 'heartbeat_stop' }); assert.equal(first.unknownSource, 'transport')
  await assert.rejects(x.service.cleanupOriginalScope('chat', { referenceId, action: 'heartbeat_stop' }), { code: 'busy' })
  await assert.rejects(x.service.getOriginalScopeOperation('chat', { referenceId, operationId: 'forged' }), { code: 'not_found' })
  x.client.controlOperation = async () => ({ ...x.receipt({ target_id: 'can:1', identity: { uid: 'u1', run_nonce: 'n' } }, { operationId: 'cleanup', claimantId: 'chat' }, 'heartbeat_stop'), submission: 'not_submitted', controlEffect: 'not_attempted' })
  const known = await x.service.getOriginalScopeOperation('chat', { referenceId, operationId: 'cleanup' }); assert.equal(known.unknown, false); assert.equal(known.submission, 'not_submitted')
  assert.equal(x.calls.filter(c => c[0] === 'cleanup').length, 1); assert.equal(x.calls.filter(c => c[0] === 'stop').length, 0)
})
test('trial metadata preserves SDK active state, Stop observation and native text without deriving business state', async () => {
  const x = setup(), scope = await x.scope()
  x.client.startTrial = async (b, intent) => x.receipt(b, intent, 'trial_start')
  const readIds = []
  x.client.trialStatus = async (b, id) => { readIds.push(id); return ({ trialId: id, operation: x.receipt(b, { claimantId: 'chat', operationId: id }, 'trial_start'), trial: { state: 'active', stopObserved: false, stopConfirmationOverdue: false, elapsedMs: '18446744073709551615', nativeJsonText: '{"elapsed":18446744073709551615}' } }) }
  x.client.recordingStatus = async () => ({ recordingId: 'rec', active: true, failed: false, nativeJsonText: '{"active":true}' })
  const parameters = { mode: 'position', command: { positionMm: '1e-20', velocityMmS: '', forceN: '', equilibriumMm: '', stiffnessNPerMm: '', dampingNsPerMm: '' }, envelope: { positionMinMm: '0', positionMaxMm: '10', velocityAbsMaxMmS: '1', forceAbsMaxN: '1', stiffnessMaxNPerMm: '1', dampingMaxNsPerMm: '1', durationMaxS: '1' }, durationS: '1', reach: null }
  const start = await x.service.startControlTrial('chat', { scopeId: scope.scopeId, parameters })
  const context = await x.service.controlContext('chat'), trial = context.scopes[0].trial
  assert.equal(trial.trialId, start.trialId); assert.equal(trial.state, 'active'); assert.equal(trial.results[0].elapsedMs, '18446744073709551615'); assert.equal(trial.results[0].trialNativeJsonText, '{"elapsed":18446744073709551615}')
  assert.equal(context.scopes[0].recordings[0].active, true)
  assert.notEqual(start.trialId, 'op1'); assert.deepEqual(readIds, ['op1'])
  assert.equal(start.statusRead, 'not_read'); assert.equal(trial.statusRead, 'available')
  const releasedActive = await x.service.releaseControlTrial('chat', start.trialId)
  assert.equal(releasedActive.state, 'active'); assert.equal(releasedActive.referenceReleased, true)
  x.client.trialStatus = async (_b, id) => { assert.equal(id, 'op1'); throw error('operation_not_found') }
  const failed = await x.service.getControlTrial('chat', start.trialId)
  assert.equal(failed.state, 'active'); assert.equal(failed.statusRead, 'unavailable')
  assert.match(failed.progress.join(' '), /operation_not_found/)
  const releaseAfterFailure = await x.service.releaseControlTrial('chat', start.trialId)
  assert.deepEqual(releaseAfterFailure.progress, failed.progress)
  assert.deepEqual(releaseAfterFailure.recordingIds, failed.recordingIds)
  assert.equal(releaseAfterFailure.statusRead, 'unavailable')
  assert.equal(failed.results[0].trialNativeJsonText, trial.results[0].trialNativeJsonText)
  x.client.trialStatus = async (_b, id) => ({ trialId: id, trial: { state: 'completed', stopObserved: true, stopConfirmationOverdue: false, elapsedMs: '20', nativeJsonText: 'COMPLETED_ORIGINAL' } })
  const completed = await x.service.getControlTrial('chat', start.trialId)
  assert.equal(completed.state, 'completed'); assert.equal(completed.statusRead, 'available')
  const releasedDone = await x.service.releaseControlTrial('chat', start.trialId)
  assert.equal(releasedDone.state, 'completed'); assert.equal(releasedDone.referenceReleased, true)
  x.descriptions.instance_id = 'new-instance'
  const old = (await x.service.controlContext('chat')).scopes[0]
  assert.equal(old.state, 'expired'); assert.equal(old.trial.state, 'completed'); assert.equal(old.trial.statusRead, 'historical')
  assert.equal(old.trial.stopAvailable, false)

})
test('Stop remains callable while a target POST is unresolved and later target completion cannot replace Stop record', async () => {
  const x = setup(), scope = await x.scope(); let resolve
  x.client.controlCommand = (b, intent) => new Promise(r => { resolve = () => r(x.receipt(b, intent, 'position')) })
  const submitting = x.service.submitControl('chat', { scopeId: scope.scopeId, command: { action: 'position', mm: '1' } })
  await new Promise(r => setImmediate(r))
  const stopped = await x.service.stopControlScope('chat', scope.scopeId); assert.equal(stopped.action, 'stop')
  resolve(); await submitting
  assert.equal((await x.service.controlContext('chat')).scopes[0].latest.action, 'stop')
})
test('blocked release retains leases and explicit revoke preserves maintenance without Stop', async () => {
  const x = setup(), scope = await x.scope()
  x.client.releaseControlReservation = async () => ({ blocked: ['usb'] })
  const blocked = await x.service.releaseControlScope('chat', scope.scopeId); assert.equal(blocked.state, 'active'); assert.equal(x.calls.filter(v => v[0] === 'detach').length, 0)
  await x.timers.shift()(); assert.equal(x.calls.filter(v => v[0] === 'renew').length, 1)
  const revoked = await x.service.revokeControlScope('chat', scope.scopeId)
  assert.equal(revoked.controlReady, false); assert.equal(revoked.stopAvailable, false)
  assert.deepEqual(x.calls.filter(v => v[0] === 'permission').at(-1), ['permission', { maintenance: true, control: false }, 'old'])
  assert.equal(x.calls.filter(v => v[0] === 'stop').length, 0)
})

test('ticket preparation timeout is known never-submitted and does not fabricate an operation ID', async () => {
  const x = setup(), scope = await x.scope(); x.client.controlTicket = async () => { throw error('sdk_timeout') }
  const result = await x.service.submitControl('chat', { scopeId: scope.scopeId, command: { action: 'heartbeat_once' } })
  assert.equal(result.unknown, false); assert.equal(result.results[0].operationId, null); assert.equal(result.results[0].submission, 'not_submitted'); assert.equal(x.calls.filter(v => v[0] === 'command').length, 0)
})

test('canonical Stop bypasses a stalled lifecycle/metadata attachment queue', async () => {
  const x = setup(), scope = await x.scope(); x.gate.hold = true
  const stopped = await x.service.stopControlScope('chat', scope.scopeId)
  assert.equal(stopped.action, 'stop'); assert.equal(x.calls.filter(v => v[0] === 'stop').length, 1)
})

test('disposal after permission GET prevents granting and after grant prevents the next member or reservation', async () => {
  for (const pause of ['view', 'grant']) {
    const x = setup(); let resume
    if (pause === 'view') x.client.permissionView = () => new Promise(resolve => { resume = () => resolve({ maintenance: true, control: false, grantId: 'old' }) })
    else x.client.controlPermission = () => new Promise(resolve => { x.calls.push(['permission']); resume = () => resolve({ grantId: 'g', controlEpoch: '1', stopRequestId: 'stop-b0' }) })
    x.client.createControlGroup = async () => { x.calls.push(['group']); throw error('unexpected') }
    const { candidates } = await x.service.controlCandidates('chat')
    const opening = x.service.createControlScope('chat', { candidateIds: candidates.map(c => c.candidateId) })
    await new Promise(resolve => setImmediate(resolve)); await x.service.disposeControlScopes(); resume()
    await assert.rejects(opening, { code: 'disposed' })
    assert.equal(x.calls.filter(v => v[0] === 'permission').length, pause === 'view' ? 0 : 1)
    assert.equal(x.calls.filter(v => v[0] === 'bind').length, 1)
    assert.equal(x.calls.filter(v => v[0] === 'group').length, 0)
    assert.equal(x.calls.filter(v => v[0] === 'detach').length, 1)
  }
})

test('fresh Host can only recover old cleanup by GET with exact original scope action claimant and ID', async () => {
  const x = setup(), [scope] = (await x.service.listOriginalStopScopes('chat')).scopes
  const b = { target_id: scope.targetId, identity: { uid: scope.uid, run_nonce: scope.runNonce } }
  let gets = 0, variant = 'valid'
  x.client.controlOperation = async (_instance, id) => {
    gets++; const op = x.receipt(b, { operationId: id, claimantId: variant === 'claimant' ? 'other' : 'chat' }, variant === 'action' ? 'position' : 'heartbeat_stop')
    if (variant === 'identity') op.members[0].identity.uid = 'wrong'
    if (variant === 'id') op.operationId = 'other'
    if (variant === 'epoch') op.controlEpoch = 'other'
    return op
  }
  const request = { referenceId: scope.referenceId, operationId: 'old-op', action: 'heartbeat_stop' }
  for (variant of ['claimant', 'action', 'identity', 'id', 'epoch']) await assert.rejects(x.service.getOriginalScopeOperation('chat', request), { code: 'invalid_response' })
  variant = 'valid'; const recovered = await x.service.getOriginalScopeOperation('chat', request)
  assert.equal(recovered.operationId, 'old-op'); assert.equal(recovered.referenceId, scope.referenceId)
  assert.equal(gets, 6); assert.equal(x.calls.length, 0)
  await assert.rejects(x.service.getOriginalScopeOperation('chat', { ...request, operationId: 'not-canonical', action: 'stop' }), { code: 'bad_request' }); assert.equal(gets, 6)
  await assert.rejects(x.service.getOriginalScopeOperation('other', request), { code: 'not_found' })
})

test('read-only canonical Stop recovery seeds the same Stop cache and never repeats POST', async () => {
  const x = setup(), [scope] = (await x.service.listOriginalStopScopes('chat')).scopes
  x.client.controlOperation = async () => ({ ...x.receipt({ target_id: scope.targetId, identity: { uid: scope.uid, run_nonce: scope.runNonce } }, { operationId: scope.stopRequestId, claimantId: 'earlier-chat' }, 'stop'), submission: 'unknown', controlEffect: 'unresolved' })
  const recovered = await x.service.getOriginalScopeOperation('chat', { referenceId: scope.referenceId, operationId: scope.stopRequestId, action: 'stop' })
  assert.equal(recovered.unknownSource, 'sdk')
  const repeated = await x.service.stopOriginalScope('chat', scope.referenceId)
  assert.equal(repeated.unknownSource, 'sdk'); assert.equal(repeated.newSubmission, false)
  assert.equal(x.calls.filter(call => call[0] === 'original').length, 0)
})

test('ordinary control journal failure is definitely never POSTed while canonical Stop bypasses persistence', async () => {
  let prepares = 0
  const x = setup({ prepare: async () => { prepares++; throw error('recovery_capacity') }, complete: async () => { throw new Error('must not archive unprepared request') } }), scope = await x.scope()
  const receipt = await x.service.submitControl('chat', { scopeId: scope.scopeId, command: { action: 'position', mm: '1' } })
  assert.equal(receipt.unknown, false); assert.equal(receipt.results[0].submission, 'not_submitted'); assert.equal(receipt.results[0].operationId, null)
  assert.equal(x.calls.filter(call => call[0] === 'command').length, 0)
  await x.service.stopControlScope('chat', scope.scopeId); assert.equal(prepares, 1); assert.equal(x.calls.filter(call => call[0] === 'stop').length, 1)
})

test('Stop does not wait for ordinary journal I/O and persistence completion cannot POST into a stopped scope', async () => {
  let release, begun
  const entered = new Promise(resolve => { begun = resolve }), completed = []
  const x = setup({ prepare: async (_s, value) => { assert.equal(value.members[0].stopRequestId, 'stop-b0'); begun(); await new Promise(resolve => { release = resolve }); return 'accepted-index' }, complete: async (_s, id, value) => completed.push([id, value]) }), scope = await x.scope()
  const ordinary = x.service.submitControl('chat', { scopeId: scope.scopeId, command: { action: 'heartbeat_once' } }); await entered
  await x.service.stopControlScope('chat', scope.scopeId)
  assert.equal(x.calls.filter(call => call[0] === 'stop').length, 1); assert.equal(x.calls.filter(call => call[0] === 'command').length, 0)
  release(); const receipt = await ordinary
  assert.equal(receipt.unknown, false); assert.equal(receipt.results[0].submission, 'not_submitted'); assert.equal(completed[0][1].results[0].operationId, 'op1')
  assert.equal(completed[0][1].unknown, false); assert.equal(x.calls.filter(call => call[0] === 'command').length, 0)
})

test('disposal during the durable journal await prevents the late ordinary POST', async () => {
  let release, begun; const entered = new Promise(resolve => { begun = resolve })
  const x = setup({ prepare: async () => { begun(); await new Promise(resolve => { release = resolve }); return 'accepted-index' }, complete: async () => {} }), scope = await x.scope()
  const ordinary = x.service.submitControl('chat', { scopeId: scope.scopeId, command: { action: 'force', n: '1' } }); await entered
  await x.service.disposeControlScopes(); release(); const receipt = await ordinary
  assert.equal(receipt.unknown, false); assert.equal(receipt.results[0].error.code, 'disposed'); assert.equal(x.calls.filter(call => call[0] === 'command').length, 0)
})

test('group writes register all original SDK tickets in one durable admission before any POST', async () => {
  let intents = [], posts = 0
  const x = setup({ prepare: async (_s, intent) => { intents.push(intent); throw error('recovery_write_failed') }, complete: async () => {} })
  x.client.createControlGroup = async (_i, bindings) => ({ groupId: 'group', reservationId: 'group-r', stopRequestId: 'group-stop', members: bindings.map(b => ({ bindingId: b.binding_id, controlEpoch: '1', stopRequestId: `stop-${b.binding_id}` })) })
  x.client.groupTickets = async () => ({ requests: x.bindings.map((b, i) => ({ bindingId: b.binding_id, operationId: `group-op-${i}`, controlEpoch: '1' })) })
  x.client.groupSubmit = async () => { posts++; throw new Error('must not submit') }
  const { candidates } = await x.service.controlCandidates('chat'), scope = await x.service.createControlScope('chat', { candidateIds: candidates.map(c => c.candidateId) })
  const receipt = await x.service.submitControl('chat', { scopeId: scope.scopeId, command: { action: 'velocity', mm_s: '1' } })
  assert.equal(intents.length, 1); assert.deepEqual(intents[0].members.map(member => member.operationId), ['group-op-0', 'group-op-1'])
  assert.equal(posts, 0); assert.equal(receipt.unknown, false)
})

test('model control/trial receipt survives Host recreation with exact original IDs and no restored execution scope', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fieldkit-model-control-')); await chmod(directory, 0o700)
  t.after(() => rm(directory, { recursive: true, force: true }))
  const journal = createRecoveryJournal({ directory }), x = setup(journal), scope = await x.scope(), receipts = new Map()
  x.client.controlCommand = async (binding, request) => { const value = { ...x.receipt(binding, request, request.command.action), reservationId: 'r', submission: 'unknown', controlEffect: 'unresolved' }; receipts.set(value.operationId, value); x.calls.push(['command']); return value }
  const tool = createControlTools(x.service).find(tool => tool.name === 'fieldkit_control')
  await tool.execute({ scopeId: scope.scopeId, command: { action: 'position', mm: '1e-30' } }, { agent: { id: 'chat' } }) // Browser never receives context or reply.
  const fresh = createRecoveryJournal({ directory }), record = (await fresh.list('chat')).records[0]
  assert.equal(record.result.unknown, true); assert.equal(record.members[0].stopRequestId, 'stop-b0')
  const reopened = setup(fresh); assert.deepEqual((await reopened.service.controlContext('chat')).scopes, [])
  let gets = 0
  const read = await fresh.recover('chat', record.recordId, { instanceId: 'i', fetch: async (_kind, _instance, id) => { gets++; return receipts.get(id) } })
  assert.equal(read.result.results[0].unknownSource, 'sdk'); assert.equal(gets, 1); assert.equal(x.calls.filter(c => c[0] === 'command').length, 1)
  assert.equal(reopened.calls.length, 0)
  const trialDir = join(directory, 'trial'), y = setup(createRecoveryJournal({ directory: trialDir })), trialScope = await y.scope()
  y.client.startTrial = async (binding, request) => ({ ...y.receipt(binding, request, 'trial_start'), reservationId: 'r', submission: 'unknown', controlEffect: 'unresolved' })
  const parameters = { mode: 'position', command: Object.fromEntries(['positionMm', 'velocityMmS', 'forceN', 'equilibriumMm', 'stiffnessNPerMm', 'dampingNsPerMm'].map(k => [k, '0'])), envelope: Object.fromEntries(['positionMinMm', 'positionMaxMm', 'velocityAbsMaxMmS', 'forceAbsMaxN', 'stiffnessMaxNPerMm', 'dampingMaxNsPerMm', 'durationMaxS'].map(k => [k, '1'])), durationS: '1', reach: null }
  await createControlTools(y.service).find(tool => tool.name === 'fieldkit_trial').execute({ scopeId: trialScope.scopeId, parameters }, { agent: { id: 'chat' } })
  const trialRecord = (await createRecoveryJournal({ directory: trialDir }).list('chat')).records[0]
  assert.equal(trialRecord.action, 'trial_start'); assert.equal(trialRecord.result.unknown, true)
})

test('post-POST receipt persistence failure preserves the actual result and durable original intent', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fieldkit-post-storage-')); await chmod(directory, 0o700)
  t.after(() => rm(directory, { recursive: true, force: true }))
  const journal = createRecoveryJournal({ directory }), x = setup(journal), scope = await x.scope()
  x.client.controlCommand = async (binding, request) => { x.calls.push(['command']); await chmod(join(directory, 'record-000'), 0o755); return { ...x.receipt(binding, request, request.command.action), reservationId: 'r' } }
  const value = await x.service.submitControl('chat', { scopeId: scope.scopeId, command: { action: 'position', mm: '0' } })
  assert.equal(value.unknown, false); assert.equal(value.results[0].submission, 'locally_submitted'); assert.equal(value.results[0].operationId, 'op1')
  await chmod(join(directory, 'record-000'), 0o700)
  const history = (await journal.list('chat')).records[0]
  assert.equal(history.pending, true); assert.equal(history.result, null); assert.ok(history.recoveryError); assert.deepEqual(history.operationIds, ['op1'])
  const reopened = createRecoveryJournal({ directory }); assert.equal((await reopened.list('chat')).records[0].pending, true)
  assert.equal(x.calls.filter(c => c[0] === 'command').length, 1)
})

test('released positively completed trial keeps final evidence after SDK operation retention expires without requery or resubmission', async () => {
  const x = setup(), scope = await x.scope(); let reads = 0, starts = 0
  x.client.startTrial = async (b, intent) => { starts++; return x.receipt(b, intent, 'trial_start') }
  x.client.trialStatus = async () => { reads++; return { trial: { state: 'completed', stopObserved: true, stopConfirmationOverdue: false, elapsedMs: '1000', nativeJsonText: 'FINAL_SDK_COMPLETED' } } }
  x.client.recordingStatus = async () => ({ recordingId: 'rec', active: false, failed: false, nativeJsonText: '{}' })
  const parameters = { mode: 'position', command: { positionMm: '1', velocityMmS: '', forceN: '', equilibriumMm: '', stiffnessNPerMm: '', dampingNsPerMm: '' }, envelope: { positionMinMm: '0', positionMaxMm: '10', velocityAbsMaxMmS: '1', forceAbsMaxN: '1', stiffnessMaxNPerMm: '1', dampingMaxNsPerMm: '1', durationMaxS: '1' }, durationS: '1', reach: null }
  const start = await x.service.startControlTrial('chat', { scopeId: scope.scopeId, parameters })
  const final = await x.service.getControlTrial('chat', start.trialId)
  await x.service.releaseControlTrial('chat', start.trialId)
  x.client.trialStatus = async () => { reads++; throw error('operation_not_found') }
  const context = await x.service.controlContext('chat')
  const retained = await x.service.getControlTrial('chat', start.trialId)
  assert.equal(reads, 1); assert.equal(starts, 1)
  assert.equal(retained.state, 'completed'); assert.equal(retained.statusRead, 'available'); assert.equal(retained.referenceReleased, true)
  assert.deepEqual(retained.progress, final.progress); assert.equal(retained.results[0].trialNativeJsonText, 'FINAL_SDK_COMPLETED')
  assert.equal(context.scopes[0].trial.statusRead, 'available')
})

test('releasing active or SDK-unknown trial references cannot freeze status polling as completed', async () => {
  for (const unknown of [false, true]) {
    const x = setup(), scope = await x.scope(); let reads = 0
    x.client.startTrial = async (b, intent) => ({ ...x.receipt(b, intent, 'trial_start'), ...(unknown ? { submission: 'unknown', controlEffect: 'unresolved' } : {}) })
    x.client.trialStatus = async () => { reads++; return { trial: { state: unknown ? 'completed' : 'active', stopObserved: false, stopConfirmationOverdue: false, elapsedMs: '1000', nativeJsonText: 'ORIGINAL_STATE' } } }
    x.client.recordingStatus = async () => ({ recordingId: null, active: false, failed: false, nativeJsonText: '{}' })
    const parameters = { mode: 'position', command: { positionMm: '1', velocityMmS: '', forceN: '', equilibriumMm: '', stiffnessNPerMm: '', dampingNsPerMm: '' }, envelope: { positionMinMm: '0', positionMaxMm: '10', velocityAbsMaxMmS: '1', forceAbsMaxN: '1', stiffnessMaxNPerMm: '1', dampingMaxNsPerMm: '1', durationMaxS: '1' }, durationS: '1', reach: null }
    const start = await x.service.startControlTrial('chat', { scopeId: scope.scopeId, parameters })
    await x.service.getControlTrial('chat', start.trialId); await x.service.releaseControlTrial('chat', start.trialId)
    x.client.trialStatus = async () => { reads++; throw error('operation_not_found') }
    const result = await x.service.getControlTrial('chat', start.trialId)
    assert.equal(reads, 2); assert.equal(result.statusRead, 'unavailable'); assert.equal(result.unknown, unknown)
    assert.match(result.progress.join(' '), /operation_not_found/)
  }
})

test('known Stop cannot freeze or replace an original SDK-unknown trial mutation after completed observation and release', async () => {
  for (const source of ['sdk', 'transport']) {
  const x = setup(), scope = await x.scope(); let reads = 0
  x.client.startTrial = async (b, intent) => { if (source === 'transport') throw error('sdk_timeout'); return { ...x.receipt(b, intent, 'trial_start'), submission: 'unknown', controlEffect: 'unresolved' } }
  x.client.trialStatus = async () => { reads++; return { trial: { state: 'completed', stopObserved: true, stopConfirmationOverdue: false, elapsedMs: '1000', nativeJsonText: 'OBSERVATION_ONLY' } } }
  x.client.recordingStatus = async () => ({ recordingId: null, active: false, failed: false, nativeJsonText: '{}' })
  const parameters = { mode: 'position', command: { positionMm: '1', velocityMmS: '', forceN: '', equilibriumMm: '', stiffnessNPerMm: '', dampingNsPerMm: '' }, envelope: { positionMinMm: '0', positionMaxMm: '10', velocityAbsMaxMmS: '1', forceAbsMaxN: '1', stiffnessMaxNPerMm: '1', dampingMaxNsPerMm: '1', durationMaxS: '1' }, durationS: '1', reach: null }
  const start = await x.service.startControlTrial('chat', { scopeId: scope.scopeId, parameters })
  await x.service.getControlTrial('chat', start.trialId); await x.service.stopControlScope('chat', scope.scopeId)
  await x.service.getControlTrial('chat', start.trialId); await x.service.releaseControlTrial('chat', start.trialId)
  const before = reads; x.client.trialStatus = async () => { reads++; throw error('operation_not_found') }
  const result = await x.service.getControlTrial('chat', start.trialId)
  assert.equal(reads, before + 1); assert.equal(result.statusRead, 'unavailable'); assert.equal(result.unknown, true)
  assert.equal(result.action, 'trial_start'); assert.equal(result.results[0].operationId, 'op1')
  assert.equal(result.results[0].submission, 'unknown'); assert.equal(result.results[0].unknownSource, source)
  if (source === 'transport') {
    x.client.controlOperation = async (_instance, id) => ({ ...x.receipt(x.bindings[0], { operationId: id, claimantId: 'chat' }, 'position'), submission: 'not_submitted', controlEffect: 'not_attempted' })
    assert.equal((await x.service.getControlTrial('chat', start.trialId)).unknown, true)
    x.client.controlOperation = async (_instance, id) => { assert.equal(id, 'op1'); return { ...x.receipt(x.bindings[0], { operationId: id, claimantId: 'chat' }, 'trial_start'), submission: 'not_submitted', controlEffect: 'not_attempted' } }
    const proof = await x.service.getControlTrial('chat', start.trialId)
    assert.equal(proof.unknown, false); assert.equal(proof.statusRead, 'unavailable')
    assert.equal(proof.action, 'trial_start'); assert.equal(proof.results[0].operationId, 'op1')
    assert.equal(proof.results[0].submission, 'not_submitted'); assert.equal(proof.results[0].controlEffect, 'not_attempted')
    const again = await x.service.getControlTrial('chat', start.trialId)
    assert.equal(again.action, 'trial_start'); assert.equal(again.results[0].operationId, 'op1'); assert.equal(again.results[0].submission, 'not_submitted')
  }
  }
})

test('released scope revoke temporarily attaches only the exact original member and preserves maintenance CAS', async () => {
  const x = setup(), scope = await x.scope()
  await x.service.releaseControlScope('chat', scope.scopeId)
  const original = scope.members[0], detached = new Set(['b0'])
  x.client.permissionView = async b => {
    if (detached.has(b.binding_id)) throw error('not_found')
    return { maintenance: true, control: true, grantId: original.grantId, controlEpoch: original.controlEpoch, stopRequestId: original.stopRequestId }
  }
  const result = await x.service.revokeControlScope('chat', scope.scopeId)
  assert.equal(result.controlGranted, false)
  assert.equal(result.state, 'released'); assert.equal(result.controlReady, false)
  assert.equal(result.members[0].target.bindingId, original.target.bindingId)
  const binds = x.calls.filter(c => c[0] === 'bind')
  assert.equal(binds.length, 2)
  assert.deepEqual(binds[1][1], { instance_id: 'i', target_id: 'usb', intent: 'attach', expected_identity: { uid: 'u0', run_nonce: 'n' }, connection_generation: '1', lease_ms: 120000 })
  assert.deepEqual(x.calls.filter(c => c[0] === 'permission').at(-1), ['permission', { maintenance: true, control: false }, 'g'])
  assert.equal(x.calls.filter(c => c[0] === 'detach').length, 2)
  assert.equal(x.calls.some(c => ['command', 'stop', 'original'].includes(c[0])), false)
})

test('released scope revoke refuses changed identity grant epoch or canonical Stop and detaches temporary observers', async () => {
  for (const fault of ['identity', 'grant', 'epoch', 'stop', 'disposed']) {
    const x = setup(), scope = await x.scope(); await x.service.releaseControlScope('chat', scope.scopeId)
    const bind = x.client.bind
    x.client.bind = async request => { const b = await bind(request); return fault === 'identity' ? { ...b, identity: { ...b.identity, uid: 'other' } } : b }
    x.client.permissionView = async () => {
      if (fault === 'disposed') await x.service.disposeControlScopes()
      return { maintenance: true, control: true, grantId: fault === 'grant' ? 'new-grant' : 'g', controlEpoch: fault === 'epoch' ? '2' : '1', stopRequestId: fault === 'stop' ? 'other-stop' : 'stop-b0' }
    }
    const result = await x.service.revokeControlScope('chat', scope.scopeId)
    assert.equal(result.controlGranted, true, fault)
    assert.match(result.reason, /授权撤销未确认/)
    assert.equal(x.calls.filter(c => c[0] === 'permission').length, 1, fault)
    assert.equal(x.calls.filter(c => c[0] === 'detach').length, 2, fault)
  }
})

test('group reservation Busy keeps every granted canonical Stop usable and retains per-member failure without re-POST', async () => {
  for (const released of [false, true]) {
    const x = setup(); x.client.createControlGroup = async () => { throw error('busy') }
    const { candidates } = await x.service.controlCandidates('chat')
    const fixed = await x.service.createControlScope('chat', { candidateIds: candidates.map(c => c.candidateId) })
    assert.equal(fixed.controlReady, false); assert.equal(fixed.stopAvailable, true)
    assert.equal(fixed.members.length, 2); assert.match(fixed.reason, /busy/)
    const denied = await x.service.submitControl('chat', { scopeId: fixed.scopeId, command: { action: 'heartbeat_once' } })
    assert.equal(denied.results.every(r => r.submission === 'not_submitted'), true)
    if (released) await x.service.releaseControlScope('chat', fixed.scopeId)
    const attempts = []
    const operation = async (b, intent) => { attempts.push({ target: b.target_id, id: intent.operationId }); if (b.target_id === 'usb') throw error('sdk_timeout'); return x.receipt(b, { ...intent, claimantId: 'other-chat' }, 'stop') }
    x.client.stop = operation
    x.client.stopControlOriginalScope = async (_instance, id, intent) => operation({ target_id: intent.expectedScope.targetId, identity: { uid: intent.expectedScope.identity.uid, run_nonce: intent.expectedScope.identity.runNonce } }, { operationId: id, claimantId: intent.claimantId })
    const stopped = await x.service.stopControlScope('chat', fixed.scopeId)
    assert.deepEqual(attempts, [{ target: 'usb', id: 'stop-b0' }, { target: 'can:1', id: 'stop-b1' }])
    assert.equal(stopped.results.length, 2)
    assert.equal(stopped.results[0].unknownSource, 'transport'); assert.equal(stopped.results[0].operationId, 'stop-b0')
    assert.equal(stopped.results[1].submission, 'locally_submitted'); assert.equal(stopped.results[1].operationId, 'stop-b1')
    assert.equal(stopped.unknown, true)
    await x.service.stopControlScope('chat', fixed.scopeId)
    assert.equal(attempts.length, 2, 'known original canonical requests are never POSTed again')
    assert.equal(x.calls.some(call => call[0] === 'command'), false)
  }
})

test('late single or group reservation success cannot reopen ordinary control after an independent Stop', async () => {
  for (const grouped of [false, true]) {
    const x = setup(); let complete
    if (grouped) x.client.createControlGroup = async (_instance, bindings) => new Promise(resolve => { complete = () => resolve({ groupId: 'late-group', reservationId: 'late-r', stopRequestId: 'late-group-stop', members: bindings.map(b => ({ bindingId: b.binding_id, controlEpoch: '1', stopRequestId: `stop-${b.binding_id}` })) }) })
    else x.client.controlReservation = async () => new Promise(resolve => { complete = () => resolve({ reservationId: 'late-r', controlEpoch: '1' }) })
    const { candidates } = await x.service.controlCandidates('chat')
    const opening = x.service.createControlScope('chat', { candidateIds: candidates.slice(0, grouped ? 2 : 1).map(c => c.candidateId) })
    await new Promise(resolve => setImmediate(resolve))
    const during = (await x.service.controlContext('chat')).scopes[0]
    assert.equal(during.stopAvailable, true)
    await x.service.stopControlScope('chat', during.scopeId)
    complete(); const finished = await opening
    assert.equal(finished.controlReady, false)
    assert.match(finished.reason, /已请求原范围 Stop/)
    assert.equal(finished.latest.action, 'stop')
    const refused = await x.service.submitControl('chat', { scopeId: during.scopeId, command: { action: 'heartbeat_once' } })
    assert.equal(refused.results.every(member => member.error.code === 'permission_denied' && member.submission === 'not_submitted'), true)
    assert.equal(x.calls.some(call => call[0] === 'command'), false)
    await x.service.stopControlScope('chat', during.scopeId)
    assert.equal(x.calls.filter(call => call[0] === 'stop').length, grouped ? 2 : 1)
  }
})

test('known initial trial rejection preserves the original audit failure without polling a nonexistent trial', async () => {
  const x = setup(), fixed = await x.scope(); let trialReads = 0
  const parameters = { mode: 'position', command: { positionMm: '1', velocityMmS: '', forceN: '', equilibriumMm: '', stiffnessNPerMm: '', dampingNsPerMm: '' }, envelope: { positionMinMm: '0', positionMaxMm: '10', velocityAbsMaxMmS: '1', forceAbsMaxN: '1', stiffnessMaxNPerMm: '1', dampingMaxNsPerMm: '1', durationMaxS: '1' }, durationS: '1', reach: null }
  x.client.startTrial = async (b, intent) => ({ ...x.receipt(b, intent, 'trial_start'), admission: 'queued', submission: 'not_attempted', controlEffect: 'not_attempted' })
  x.client.controlOperation = async (_i, id) => ({ ...x.receipt(x.bindings[0], { claimantId: 'chat', operationId: id }, 'trial_start'), submission: 'not_submitted', controlEffect: 'not_attempted', error: { code: 'recording', message: 'Bad file descriptor (os error 9)' }, nativeJsonText: 'ORIGINAL_RECORDING_FAILURE' })
  x.client.trialStatus = async () => { trialReads++; throw error('trial_stale') }
  const start = await x.service.startControlTrial('chat', { scopeId: fixed.scopeId, parameters })
  const rejected = await x.service.getControlTrial('chat', start.trialId)
  assert.equal(trialReads, 0)
  assert.equal(rejected.state, 'not_submitted'); assert.equal(rejected.statusRead, 'not_read'); assert.equal(rejected.unknown, false); assert.equal(rejected.stopAvailable, false)
  assert.match(rejected.progress.join(' '), /recording.*Bad file descriptor/)
  assert.match(rejected.statusReason, /可用空间与写权限/)
  assert.equal(rejected.results[0].operationId, 'op1'); assert.equal(rejected.results[0].nativeJsonText, 'ORIGINAL_RECORDING_FAILURE')
  const current = (await x.service.controlContext('chat')).scopes[0]
  assert.equal(current.stopAvailable, true); assert.equal(current.trial.state, 'not_submitted'); assert.equal(trialReads, 0)
  await x.service.revokeControlScope('chat', fixed.scopeId)
  const revoked = await x.service.getControlTrial('chat', start.trialId)
  assert.match(revoked.statusReason, /授权已撤销/); assert.doesNotMatch(revoked.statusReason, /Stop 仍独立可用/)
  assert.equal(x.calls.some(call => ['stop', 'original'].includes(call[0])), false)
})

test('known startup refusal never replaces a prior active or SDK-unknown trial and target refusal still reads the original trial', async () => {
  const parameters = { mode: 'position', command: { positionMm: '1', velocityMmS: '', forceN: '', equilibriumMm: '', stiffnessNPerMm: '', dampingNsPerMm: '' }, envelope: { positionMinMm: '0', positionMaxMm: '10', velocityAbsMaxMmS: '1', forceAbsMaxN: '1', stiffnessMaxNPerMm: '1', dampingMaxNsPerMm: '1', durationMaxS: '1' }, durationS: '1', reach: null }
  for (const unknown of [false, true]) {
    const x = setup(), fixed = await x.scope(); let starts = 0, reads = 0
    x.client.startTrial = async (b, intent) => { starts++; return { ...x.receipt(b, intent, 'trial_start'), ...(unknown ? { submission: 'unknown', controlEffect: 'unresolved' } : {}) } }
    x.client.trialStatus = async (_b, id) => { reads++; assert.equal(id, 'op1'); return { trial: { state: 'active', stopObserved: false, stopConfirmationOverdue: false, elapsedMs: '20', nativeJsonText: 'ORIGINAL_ACTIVE' } } }
    x.client.recordingStatus = async () => ({ recordingId: null })
    const first = await x.service.startControlTrial('chat', { scopeId: fixed.scopeId, parameters }); await x.service.getControlTrial('chat', first.trialId)
    x.client.startTrial = async (b, intent) => { starts++; return { ...x.receipt(b, intent, 'trial_start'), submission: 'not_submitted', controlEffect: 'not_attempted', error: { code: 'busy', message: 'prior trial still active' } } }
    const refused = await x.service.startControlTrial('chat', { scopeId: fixed.scopeId, parameters })
    assert.equal(refused.state, 'not_submitted')
    const retained = (await x.service.controlContext('chat')).scopes[0].trial
    assert.equal(retained.trialId, first.trialId); assert.equal(retained.state, 'active'); assert.equal(retained.unknown, unknown)
    await x.service.getControlTrial('chat', refused.trialId)
    assert.equal((await x.service.controlContext('chat')).scopes[0].trial.trialId, first.trialId)
    if (!unknown) {
      x.client.updateTrial = async (b, intent) => ({ ...x.receipt(b, intent, 'trial_target'), submission: 'not_submitted', controlEffect: 'not_attempted', error: { code: 'recording', message: 'Bad file descriptor' } })
      await x.service.updateControlTrial('chat', { trialId: first.trialId, positionRaw: '2' })
      const before = reads, update = await x.service.getControlTrial('chat', first.trialId)
      assert.equal(reads, before + 1); assert.equal(update.state, 'active'); assert.equal(update.stopAvailable, true)
      assert.equal(update.action, 'trial_target'); assert.equal(update.results[0].admission, 'finished')
      assert.equal(update.results[0].submission, 'not_submitted'); assert.equal(update.results[0].controlEffect, 'not_attempted'); assert.equal(update.unknown, false)
    }
    assert.equal(starts, unknown ? 1 : 2)
  }
})

test('a partially refused group trial still reads every original member and retains the active-member Stop gate', async () => {
  const x = setup()
  x.client.createControlGroup = async (_i, bindings) => ({ groupId: 'g', reservationId: 'r', stopRequestId: 'group-stop', members: bindings.map(b => ({ bindingId: b.binding_id, controlEpoch: '1', stopRequestId: `stop-${b.binding_id}` })) })
  x.client.groupTickets = async () => ({ requests: x.bindings.map((b, i) => ({ bindingId: b.binding_id, operationId: `trial-${i}`, controlEpoch: '1' })) })
  x.client.groupSubmit = async () => ({ members: x.bindings.map((b, i) => ({ bindingId: b.binding_id, operation: { ...x.receipt(b, { operationId: `trial-${i}`, claimantId: 'chat' }, 'trial_start'), ...(i === 0 ? { submission: 'not_submitted', controlEffect: 'not_attempted', error: { code: 'recording', message: 'Bad file descriptor' } } : {}) }, error: null })) })
  const readIds = []
  x.client.trialStatus = async (_b, id) => { readIds.push(id); if (id === 'trial-0') throw error('trial_stale'); return { trial: { state: 'active', stopObserved: false, stopConfirmationOverdue: false, elapsedMs: '2', nativeJsonText: 'ACTIVE_SECOND_MEMBER' } } }
  x.client.recordingStatus = async () => ({ recordingId: null })
  const { candidates } = await x.service.controlCandidates('chat'), fixed = await x.service.createControlScope('chat', { candidateIds: candidates.map(c => c.candidateId) })
  const parameters = { mode: 'position', command: { positionMm: '1', velocityMmS: '', forceN: '', equilibriumMm: '', stiffnessNPerMm: '', dampingNsPerMm: '' }, envelope: { positionMinMm: '0', positionMaxMm: '10', velocityAbsMaxMmS: '1', forceAbsMaxN: '1', stiffnessMaxNPerMm: '1', dampingMaxNsPerMm: '1', durationMaxS: '1' }, durationS: '1', reach: null }
  const start = await x.service.startControlTrial('chat', { scopeId: fixed.scopeId, parameters }), observed = await x.service.getControlTrial('chat', start.trialId)
  assert.deepEqual(readIds, ['trial-0', 'trial-1']); assert.notEqual(observed.state, 'not_submitted')
  assert.equal(observed.stopAvailable, true); assert.equal(observed.statusRead, 'unavailable')
  assert.equal(observed.results[1].trialState, 'active'); assert.equal(observed.results[1].trialNativeJsonText, 'ACTIVE_SECOND_MEMBER')
})
