import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, chmod, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRecoveryJournal } from '../src/recovery-journal.js'

const target = { instanceId: 'instance', bindingId: 'original-binding', targetId: 'can:1', uid: 'a'.repeat(24), runNonce: 'b'.repeat(32), connectionGeneration: '9007199254740993' }
const member = { target, controlEpoch: '9007199254740997', stopRequestId: 'canonical-stop', grantId: 'human-grant', reservationId: 'reservation', operationId: 'instance-normal-1' }
const intent = { kind: 'control', action: 'position', instanceId: 'instance', members: [member] }
const operation = { operationId: member.operationId, action: 'position', claimantId: 'chat', reservationId: member.reservationId, controlEpoch: member.controlEpoch, members: [{ targetId: target.targetId, identity: { uid: target.uid, runNonce: target.runNonce }, connectionGeneration: target.connectionGeneration }], admission: 'finished', submission: 'unknown', controlEffect: 'unresolved', observation: 'unconfirmed', phase: 'submission', nativeJsonText: '{"config":"must not persist"}', error: null }
const result = { scopeId: 'old-host-scope', action: 'position', results: [{ target, operationId: member.operationId, admission: 'finished', submission: 'unknown', controlEffect: 'unresolved', observation: 'unconfirmed', phase: 'submission', unknown: true, unknownSource: 'sdk', nativeJsonText: operation.nativeJsonText, error: null }], unknown: true }
async function fixture(t, capacity = 4) {
  const directory = await mkdtemp(join(tmpdir(), 'fieldkit-recovery-')); await chmod(directory, 0o700)
  t.after(() => rm(directory, { recursive: true, force: true }))
  return { directory, journal: createRecoveryJournal({ directory, capacity }) }
}

test('unseen model intent survives a new Host object and recovers only exact SDK GET facts', async t => {
  const { directory, journal } = await fixture(t), recordId = await journal.prepare('chat', intent)
  const fresh = createRecoveryJournal({ directory, capacity: 4 }), history = await fresh.list('chat')
  assert.equal(history.records.length, 1); assert.equal(history.records[0].pending, true); assert.equal(history.records[0].result, null)
  assert.equal(history.records[0].members[0].controlEpoch, member.controlEpoch); assert.equal(history.records[0].members[0].stopRequestId, 'canonical-stop')
  let calls = 0
  const read = await fresh.recover('chat', recordId, { instanceId: 'instance', fetch: async (kind, instance, id) => { calls++; assert.deepEqual([kind, instance, id], ['control', 'instance', member.operationId]); return { ...operation, error: { code: 'sdk_test', message: 'exact SDK error must remain only in explicit response' } } } })
  assert.equal(read.result.results[0].error.message, 'exact SDK error must remain only in explicit response')
  assert.equal(calls, 1); assert.equal(read.result.results[0].unknownSource, 'sdk'); assert.equal(read.result.results[0].nativeJsonText, operation.nativeJsonText)
  assert.equal(read.result.scopeId, recordId); assert.equal(read.result.newSubmission, false)
  const stored = await readFile(join(directory, recordId.split('.')[0], 'sdk-unknown.json'), 'utf8')
  assert.doesNotMatch(stored, /must not persist|token|human-grant|exact SDK error/)
})

test('multiple Host writers cannot overbook slots, lose others intents or silently evict pending records', async t => {
  const { directory, journal } = await fixture(t, 2), other = createRecoveryJournal({ directory, capacity: 2 })
  const writes = await Promise.all([journal.prepare('chat', intent), other.prepare('chat', { ...intent, members: [{ ...member, operationId: 'instance-normal-2' }] })])
  assert.notEqual(writes[0], writes[1]); assert.equal((await journal.list('chat')).records.length, 2)
  await assert.rejects(other.prepare('chat', { ...intent, members: [{ ...member, operationId: 'instance-normal-3' }] }), { code: 'recovery_capacity' })
  assert.deepEqual((await other.list('chat')).records.flatMap(record => record.operationIds).sort(), ['instance-normal-1', 'instance-normal-2'])
})

test('session and instance mismatches reject before operation GET, source IDs cannot inject paths', async t => {
  const { journal } = await fixture(t), recordId = await journal.prepare('chat', intent); let calls = 0
  const fetch = async () => { calls++; return operation }
  await assert.rejects(journal.recover('other-chat', recordId, { instanceId: 'instance', fetch }), { code: 'recovery_forbidden' })
  await assert.rejects(journal.recover('chat', recordId, { instanceId: 'new-instance', fetch }), { code: 'instance_mismatch' })
  await assert.rejects(journal.recover('chat', '../escape', { instanceId: 'instance', fetch }), { code: 'recovery_invalid' })
  assert.equal(calls, 0); assert.deepEqual((await journal.list('other-chat')).records, [])
})

test('GET must match original operation/action/claimant/reservation/epoch/full member and cannot clear SDK unknown', async t => {
  const { journal } = await fixture(t), recordId = await journal.prepare('chat', intent)
  await journal.complete('chat', recordId, result)
  const wrong = [{ operationId: 'wrong' }, { action: 'velocity' }, { claimantId: 'other' }, { reservationId: 'other' }, { controlEpoch: 'other' }, { members: [{ ...operation.members[0], targetId: 'usb:alias' }] }, { members: [{ ...operation.members[0], identity: { ...operation.members[0].identity, runNonce: 'new-run' } }] }, { members: [{ ...operation.members[0], connectionGeneration: '2' }] }]
  for (const change of wrong) await assert.rejects(journal.recover('chat', recordId, { instanceId: 'instance', fetch: async () => ({ ...operation, ...change }) }), { code: 'recovery_identity_mismatch' })
  await assert.rejects(journal.recover('chat', recordId, { instanceId: 'instance', fetch: async () => ({ ...operation, submission: 'locally_submitted', controlEffect: 'known' }) }), { code: 'recovery_unknown_preserved' })
  const fresh = await journal.list('chat'); assert.equal(fresh.records[0].result.unknown, true)
})

test('symlink/unsafe file rejection and missing or damaged receipt keep intent visible', async t => {
  const { directory, journal } = await fixture(t), recordId = await journal.prepare('chat', intent)
  const missing = (await journal.list('chat')).records[0]; assert.equal(missing.pending, true); assert.ok(missing.recoveryError)
  await writeFile(join(directory, recordId.split('.')[0], 'receipt.json'), '{bad', { mode: 0o600 })
  const damaged = (await journal.list('chat')).records[0]; assert.equal(damaged.result, null); assert.ok(damaged.recoveryError); assert.deepEqual(damaged.operationIds, [member.operationId])
  await rm(join(directory, recordId.split('.')[0], 'receipt.json')); await symlink(join(directory, recordId.split('.')[0], 'intent.json'), join(directory, recordId.split('.')[0], 'receipt.json'))
  const unsafe = (await journal.list('chat')).records[0]; assert.ok(unsafe.recoveryError); assert.equal(unsafe.pending, true)
  const other = createRecoveryJournal({ directory: join(directory, 'linked') }); await symlink(directory, join(directory, 'linked'))
  await assert.rejects(other.prepare('chat', intent), { code: 'unsafe_path' })
})

test('journal rejects config/token/unknown intent fields and over-size metadata before publication', async t => {
  const { journal } = await fixture(t)
  await assert.rejects(journal.prepare('chat', { ...intent, rawRecordText: 'secret' }), { code: 'recovery_invalid' })
  await assert.rejects(journal.prepare('chat', { ...intent, token: 'secret' }), { code: 'recovery_invalid' })
  const members = Array.from({ length: 16 }, (_, i) => ({ ...member, target: { ...target, targetId: `${i}${'x'.repeat(250)}`, bindingId: `${i}${'b'.repeat(250)}` }, operationId: `${i}${'o'.repeat(250)}`, reservationId: 'r'.repeat(256), grantId: 'g'.repeat(256), stopRequestId: 's'.repeat(256) }))
  await assert.rejects(journal.prepare('chat', { ...intent, members }), { code: 'recovery_capacity' })
  assert.deepEqual((await journal.list('chat')).records, [])
})

test('explicit forget frees only completed known records and old nonce cannot access reused slot', async t => {
  const { journal } = await fixture(t, 1), recordId = await journal.prepare('chat', intent)
  await assert.rejects(journal.forget('chat', recordId), { code: 'recovery_unresolved' })
  await journal.complete('chat', recordId, result)
  await assert.rejects(journal.forget('chat', recordId), { code: 'recovery_unresolved' })
  const { journal: known } = await fixture(t, 1), old = await known.prepare('chat', intent)
  const finished = { ...result, unknown: false, results: result.results.map(r => ({ ...r, unknown: false, unknownSource: null, submission: 'locally_submitted', controlEffect: 'known' })) }
  await known.complete('chat', old, finished)
  assert.deepEqual(await known.forget('chat', old), { forgotten: true, recordId: old })
  const next = await known.prepare('chat', { ...intent, members: [{ ...member, operationId: 'new-op' }] })
  assert.notEqual(next, old); assert.equal(next.split('.')[0], old.split('.')[0])
  for (const call of [() => known.forget('chat', old), () => known.complete('chat', old, finished), () => known.recover('chat', old, { instanceId: 'instance', fetch: async () => { throw new Error('must not GET') } })]) await assert.rejects(call(), { code: 'recovery_stale' })
  assert.deepEqual((await known.list('chat')).records[0].operationIds, ['new-op'])
})

test('interrupted write lock keeps original SDK unknown readable, refuses forget and leaves another slot usable', async t => {
  const { directory, journal } = await fixture(t, 2), recordId = await journal.prepare('chat', intent)
  await journal.complete('chat', recordId, result)
  const { mkdir } = await import('node:fs/promises')
  await mkdir(join(directory, `${recordId.split('.')[0]}.lock`), { mode: 0o700 }) // Simulates process exit during the next write.
  const fresh = createRecoveryJournal({ directory, capacity: 2 }), history = (await fresh.list('chat')).records[0]
  assert.equal(history.result.unknown, true); assert.equal(history.recoveryError.code, 'recovery_locked')
  await assert.rejects(fresh.forget('chat', recordId), { code: 'recovery_locked' })
  const read = await fresh.recover('chat', recordId, { instanceId: 'instance', fetch: async () => operation })
  assert.equal(read.result.unknown, true); assert.equal(read.recoveryError.code, 'recovery_locked')
  const next = await fresh.prepare('chat', { ...intent, members: [{ ...member, operationId: 'other-op' }] })
  assert.equal(next.split('.')[0], 'record-001'); assert.equal((await fresh.list('chat')).records.length, 2)
})

test('failed first atomic write removes its own never-admitted slot instead of exhausting capacity', async t => {
  const { directory, journal } = await fixture(t, 1)
  const fs = (await import('node:fs/promises')).default, { syncBuiltinESMExports } = await import('node:module'), originalOpen = fs.open
  fs.open = async (...args) => {
    if (String(args[0]).includes('pending-')) throw Object.assign(new Error('synthetic disk full before POST'), { code: 'ENOSPC' })
    return originalOpen(...args)
  }
  syncBuiltinESMExports()
  try { await assert.rejects(journal.prepare('chat', intent), { code: 'ENOSPC' }) }
  finally { fs.open = originalOpen; syncBuiltinESMExports() }
  assert.deepEqual((await journal.list('chat')).records, [])
  const recordId = await journal.prepare('chat', intent)
  assert.equal(recordId.split('.')[0], 'record-000')
  assert.equal((await createRecoveryJournal({ directory, capacity: 1 }).list('chat')).records.length, 1)
})

test('new service exposes local history without SDK and authenticates only exact original GET on explicit read', async t => {
  const { directory, journal } = await fixture(t), recordId = await journal.prepare('chat', intent)
  const { createFieldkitService } = await import('../src/service.js'), sdkDir = join(directory, 'sdk'), calls = []
  const descriptor = { protocol: 'eha-tool.service.v2', api_version: 2, tool_version: 'test', instance_id: 'instance', pid: '123', started_at_unix_ms: '1780000000000', endpoint: 'http://127.0.0.1:18080', token_file: join(sdkDir, 'port-18080.token') }
  const client = { describe: async () => { calls.push('describe'); return { ...descriptor, capabilities: ['operation_read', 'instance_status', 'service_shutdown'] } }, instance: async () => ({ ...descriptor, service_state: 'running' }), controlOperation: async (instance, id) => { calls.push(['GET', instance, id]); return operation } }
  const service = createFieldkitService({}, { recoveryJournal: createRecoveryJournal({ directory, capacity: 4 }), owner: { settingsRoot: join(directory, 'owner'), createClient: () => client, execFileImpl: (_p, _a, _o, done) => done(null, '', '') } })
  assert.equal((await service.listRecoveryHistory('chat')).records[0].recordId, recordId); assert.equal(calls.length, 0)
  await service.saveServiceSettings({ toolPath: '/opt/eha-tool', port: 18080, dataDir: sdkDir, runsDir: '', odrivePython: '' })
  await writeFile(join(sdkDir, 'port-18080.json'), JSON.stringify(descriptor), { mode: 0o600 })
  const read = await service.readRecoveryRecord('chat', { recordId })
  assert.equal(read.result.unknown, true); assert.deepEqual(calls.filter(Array.isArray), [['GET', 'instance', member.operationId]])
  await assert.rejects(service.readRecoveryRecord('other-chat', { recordId }), { code: 'recovery_forbidden' })
  assert.equal(calls.filter(Array.isArray).length, 1)
  assert.deepEqual(await service.forgetRecoveryRecord('chat', { recordId }).catch(e => e.code), 'recovery_unresolved')
})

test('valid JSON receipts with missing state fields, invalid enums or false unknown flags remain damaged and cannot be forgotten', async t => {
  const { directory, journal } = await fixture(t), recordId = await journal.prepare('chat', intent)
  const sparse = { action: 'position', unknown: false, results: [{ target, operationId: member.operationId, admission: 'finished' }] }
  const known = { ...result, unknown: false, results: result.results.map(r => ({ ...r, unknown: false, unknownSource: null, submission: 'locally_submitted', controlEffect: 'known' })) }
  for (const broken of [sparse, { ...known, results: [{ ...known.results[0], submission: 'bogus' }] }, { ...known, results: [{ ...known.results[0], controlEffect: 'unresolved' }] }, { ...known, results: [{ ...known.results[0], submission: 'not_attempted', controlEffect: 'not_attempted' }] }]) {
    await writeFile(join(directory, recordId.split('.')[0], 'receipt.json'), JSON.stringify(broken), { mode: 0o600 })
    const history = (await journal.list('chat')).records[0]
    assert.equal(history.result, null); assert.equal(history.pending, true); assert.equal(history.recoveryError.code, 'recovery_invalid')
    await assert.rejects(journal.forget('chat', recordId), { code: 'recovery_unresolved' })
  }
})

test('official local heartbeat/recording cleanup success keeps not_submitted/not_applicable facts and can be forgotten', async t => {
  const { journal } = await fixture(t)
  for (const action of ['heartbeat_stop', 'recording_stop']) {
    const recordId = await journal.prepare('chat', { ...intent, action })
    const local = { ...result, action, unknown: false, results: result.results.map(r => ({ ...r, unknown: false, unknownSource: null, submission: 'not_submitted', controlEffect: 'not_applicable' })) }
    await journal.complete('chat', recordId, local)
    const read = await journal.recover('chat', recordId, { instanceId: 'instance', fetch: async () => ({ ...operation, action, submission: 'not_submitted', controlEffect: 'not_applicable' }) })
    assert.equal(read.result.unknown, false); assert.equal(read.result.results[0].submission, 'not_submitted'); assert.equal(read.result.results[0].controlEffect, 'not_applicable')
    assert.deepEqual(await journal.forget('chat', recordId), { forgotten: true, recordId })
  }
})

test('delayed earlier queued GET cannot downgrade SDK unknown persisted by another Host, including locked-write catch', async t => {
  const { directory, journal } = await fixture(t), recordId = await journal.prepare('chat', intent), other = createRecoveryJournal({ directory, capacity: 4 })
  let release, entered; const started = new Promise(r => { entered = r })
  const reading = journal.recover('chat', recordId, { instanceId: 'instance', fetch: () => { entered(); return new Promise(r => { release = () => r({ ...operation, admission: 'queued', submission: 'not_attempted', controlEffect: 'not_attempted' }) }) } })
  await started; await other.complete('chat', recordId, result); release()
  const response = await reading.catch(e => e)
  if (response instanceof Error) assert.equal(response.code, 'recovery_unknown_preserved')
  else { assert.equal(response.result.unknown, true); assert.equal(response.result.results[0].admission, 'finished') }
  assert.equal((await journal.list('chat')).records[0].result.unknown, true)
  const second = await journal.prepare('chat', { ...intent, members: [{ ...member, operationId: 'second' }] }); let release2, entered2; const started2 = new Promise(r => { entered2 = r })
  const reading2 = journal.recover('chat', second, { instanceId: 'instance', fetch: () => { entered2(); return new Promise(r => { release2 = () => r({ ...operation, operationId: 'second', admission: 'queued', submission: 'not_attempted', controlEffect: 'not_attempted' }) }) } })
  await started2; await other.complete('chat', second, { ...result, results: result.results.map(r => ({ ...r, operationId: 'second' })) })
  const { mkdir } = await import('node:fs/promises'); await mkdir(join(directory, `${second.split('.')[0]}.lock`), { mode: 0o700 })
  release2(); const locked = await reading2
  assert.equal(locked.result.unknown, true); assert.equal(locked.result.results[0].admission, 'finished'); assert.equal(locked.recoveryError.code, 'recovery_locked')
  const groupTarget = { ...target, bindingId: 'group-second', targetId: 'can:2' }, groupMember = { ...member, target: groupTarget, operationId: 'group-second-op' }
  const group = await journal.prepare('chat', { ...intent, members: [{ ...member, operationId: 'group-first-op' }, groupMember] }); let release3, entered3; const started3 = new Promise(r => { entered3 = r })
  const reading3 = journal.recover('chat', group, { instanceId: 'instance', fetch: async (_kind, _instance, id) => {
    if (id === 'group-first-op') { entered3(); return new Promise(r => { release3 = () => r({ ...operation, operationId: id, admission: 'queued', submission: 'not_attempted', controlEffect: 'not_attempted' }) }) }
    return { ...operation, operationId: id, members: [{ ...operation.members[0], targetId: 'can:2' }] }
  } })
  await started3; await other.complete('chat', group, { ...result, results: [{ ...result.results[0], operationId: 'group-first-op' }, { ...result.results[0], target: groupTarget, operationId: 'group-second-op', unknown: false, unknownSource: null, submission: 'locally_submitted', controlEffect: 'known' }] })
  release3(); await assert.rejects(reading3, { code: 'recovery_unknown_preserved' })
  const grouped = (await journal.list('chat')).records.find(r => r.recordId === group)
  assert.deepEqual(grouped.result.results.map(r => r.unknown), [true, false]) // Aggregate unknown=true cannot hide a member downgrade.
})
