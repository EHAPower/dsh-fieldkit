import test from 'node:test'
import assert from 'node:assert/strict'
import { TYPERT_REMOTE } from '../lib/typert.remote-client.js'
const descriptor = method => TYPERT_REMOTE.descriptors.find(d => d.method === method)
const parse = (name, value) => descriptor(name).result.create().parse(value)
const target = { instanceId: 'i', bindingId: 'b', targetId: 'usb', uid: 'a'.repeat(24), runNonce: 'b'.repeat(32), connectionGeneration: '18446744073709551615' }
const native = '{"n":18446744073709551615,"v":0.12345678901234567890123456789,"v":1e-999}'
const member = { target, operationId: 'op', admission: 'finished', submission: 'unknown', controlEffect: 'unresolved', observation: 'unconfirmed', phase: 'submission', unknown: true, unknownSource: 'sdk', nativeJsonText: native, error: { code: 'unknown', message: 'preserved' }, stopAttemptDelayMs: '18446744073709551615', trialId: 'trial', recordingId: 'record', previousOperationId: 'old', previousSubmission: 'unknown', previousUnknown: true, previousNativeJsonText: native }
const result = { scopeId: 'scope', action: 'position', results: [member], unknown: true, newSubmission: false, coalescedExisting: false }
const trialMember = { target, operationId: 'op', unknownSource: 'sdk', controlEffect: 'unresolved', preparation: 'submission', admission: 'finished', submission: 'unknown', observation: 'unconfirmed', unknown: true, nativeJsonText: native, trialState: 'active', stopObserved: false, stopConfirmationOverdue: true, elapsedMs: '18446744073709551615', trialNativeJsonText: native }
const trial = { trialId: 'host-trial', members: [target], mode: 'position', state: 'active', progress: ['SDK'], results: [trialMember], unknown: true, stopAvailable: true, recordingIds: ['rec'], newSubmission: false, coalescedExisting: true }
const scope = { scopeId: 'scope', instanceId: 'i', members: [{ target, grantId: 'grant' }], kind: 'single', state: 'active', controlReady: false, reason: 'unknown', stopAvailable: true, stopReason: null, latest: result, lastOrdinary: result, trial, recordings: [{ target, active: true, failed: false, recordingId: 'rec', nativeJsonText: native, error: null }] }
test('generated P4 codecs retain fixed membership, partial previous evidence, precise trial/recording and unknown provenance', () => {
  for (const name of ['submitControl', 'recordControl', 'stopControlScope']) assert.deepEqual(parse(name, result), result)
  for (const name of ['createControlScope', 'releaseControlScope', 'revokeControlScope']) assert.deepEqual(parse(name, scope), scope)
  const context = { scopes: [scope], activeScopeId: 'scope', capabilities: ['control'] }
  for (const name of ['controlContext', 'selectControlScope']) assert.deepEqual(parse(name, context), context)
  for (const name of ['startControlTrial', 'updateControlTrial', 'getControlTrial', 'releaseControlTrial']) assert.deepEqual(parse(name, trial), trial)
})
test('generated original Stop and cleanup codecs keep canonical full scope without fabricated binding', () => {
  const original = { referenceId: 'ref', instanceId: 'i', targetId: target.targetId, uid: target.uid, runNonce: target.runNonce, connectionGeneration: target.connectionGeneration, controlEpoch: '18446744073709551615', current: true, controlGranted: true, stopRequestId: 'canonical' }
  assert.deepEqual(parse('listOriginalStopScopes', { scopes: [original] }), { scopes: [original] })
  const receipt = { referenceId: 'ref', scope: original, operationId: 'canonical', action: 'stop', admission: 'finished', submission: 'unknown', controlEffect: 'unresolved', observation: 'unconfirmed', unknown: true, unknownSource: 'transport', nativeJsonText: native, error: { code: 'sdk_timeout', message: 'not confirmed' }, newSubmission: false }
  for (const name of ['stopOriginalScope', 'cleanupOriginalScope', 'getOriginalScopeOperation']) assert.deepEqual(parse(name, receipt), receipt)
})
test('generated P4 arguments require raw string numbers and fixed actions', () => {
  const codec = descriptor('submitControl').parameters[1].codec.create()
  assert.equal(codec.safeParse({ scopeId: 's', command: { action: 'position', mm: '0.12345678901234567890123456789' } }).success, true)
  assert.equal(codec.safeParse({ scopeId: 's', command: { action: 'position', mm: 1 } }).success, false)
  assert.equal(codec.safeParse({ scopeId: 's', command: { action: 'shell', command: 'rm' } }).success, false)
  const query = descriptor('getOriginalScopeOperation').parameters[1].codec.create()
  const original = { referenceId: 'new-ref', operationId: 'persisted-op', action: 'heartbeat_stop' }
  assert.deepEqual(query.parse(original), original)
  assert.equal(query.safeParse({ ...original, action: 'position' }).success, false)
  const cleanup = descriptor('cleanupOriginalScope').parameters[1].codec.create()
  assert.equal(cleanup.safeParse({ referenceId: 'r', action: 'recording_stop' }).success, true)
  assert.equal(cleanup.safeParse({ referenceId: 'r', action: 'heartbeat_start' }).success, false)
})
