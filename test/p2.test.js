import test from 'node:test'
import assert from 'node:assert/strict'
import { createP2Client } from '../src/p2-client.js'
import { createP2Service } from '../src/p2-service.js'
import { appendEvents, chartSeries } from '../src/client/event-history.js'
import { TYPERT_REMOTE } from '../lib/typert.remote-client.js'
const parse = (method, v) => TYPERT_REMOTE.descriptors.find(d => d.method === method).result.create().parse(v)
const identity = { uid: 'a'.repeat(24), run_nonce: 'b'.repeat(32) }
const publicIdentity = { uid: identity.uid, runNonce: identity.run_nonce }
const native = ' {"time_us":18446744073709551615,"position":{"value":0.12345678901234567890,"result":1,"quality":1,"stale":false}} '
const rawConnection = { connection_id: 'can:1', target_id: 'can:1', identity, connection_generation: '9007199254740993', connected: true, snapshot_json_text: native }
const profile = { id: 'can1', name: 'CAN 1', adapter: { kind: 'canable2', serial: 'adapter1' }, node: 1, mode: 'fd', expected_uid: null }
const event = { cursor: '9007199254740993', kind: 'telemetry', source_id: 'source', source_timestamp: { clock: 'device_monotonic_us', value: '18446744073709551615' }, received_at: '1780000000000', payload: { target_id: 'can:1', identity, connection_generation: rawConnection.connection_generation, native_json_text: native }, gap: true, source_gap: { reason: 'sequence_gap', dropped: '9007199254740993' } }
const batch = { cursor: event.cursor, events: [event], gap: true, gap_reasons: ['cache_loss'], lost_ranges: [{ first_cursor: '1', last_cursor: '2', count: '2' }], truncated: false }

test('generated P2 codecs retain native evidence, u64 source time, metadata, scan error and every completed job shape', async () => {
  let reply
  const calls = [], client = createP2Client(async (path, request) => { calls.push({ path, request }); return reply })
  reply = batch
  const events = parse('getEvents', await client.events('instance', '0'))
  assert.equal(events.events[0].nativeJsonText, native)
  assert.equal(events.events[0].sourceTimestamp.value, event.source_timestamp.value)
  assert.equal(events.events[0].sourceGap.dropped, '9007199254740993')
  assert.equal(events.lostRanges[0].count, '2')
  reply = { connections: [rawConnection] }
  const connection = parse('listConnections', { connections: await client.connections('instance') }).connections[0]
  assert.equal(connection.snapshotJsonText, native)
  reply = rawConnection
  assert.deepEqual(parse('changeConnection', await client.changeConnection('instance', connection, 'disconnect')), connection)
  assert.deepEqual(calls.at(-1).request.body.expected_identity, identity)
  reply = { profiles: [profile], load_error: null, busy: false }
  assert.equal(parse('listProfiles', await client.profiles('instance')).profiles[0].adapter.serial, 'adapter1')
  const jobCases = [
    ['adapters', { adapters: [{ kind: 'canable2', serial: 's', description: 'adapter', vid: 123, pid: null }] }],
    ['recordings', { runs: [{ id: 'r', metadata_json_text: native, files: ['metadata.json', 'telemetry.csv'] }], truncated: true }],
    ['download', { run_id: 'r', file: 'metadata.json', offset: '9007199254740993', next_offset: '9007199254740994', eof: true, content_base64: 'YQ==' }],
    ['profileSave', { profile }], ['profileDelete', { id: profile.id, deleted: true }],
    ['odriveDevices', { source: 'odrive_usb', native_json_text: native }], ['odriveRead', { source: 'odrive_usb', native_json_text: native }],
  ]
  for (const [kind, data] of jobCases) {
    reply = { job_id: 'j', state: 'completed', data, error: null }
    const projected = await client.readJob('instance', 'j', kind)
    assert.deepEqual(parse('getJob', projected), projected)
  }
  reply = { job_id: 'j', state: 'failed', data: null, error: 'Python interpreter unavailable' }
  assert.equal(parse('listOdriveDevices', await client.odriveDevices('instance')).error, reply.error)
  reply = { scan_id: 's', state: 'completed', nodes: [{ node: 1, identity }], errors: [{ node: 2, message: 'timeout', unknown: true, error_json_text: native }] }
  const scan = parse('getScan', await client.readScan('instance', 's'))
  assert.equal(scan.nodes.length, 1); assert.equal(scan.errors[0].errorJsonText, native)
  await assert.rejects(client.events('instance', '-1'), /cursor/)
  await assert.rejects(client.recordingChunk('instance', { runId: 'r', file: '../../token', offset: '0' }), /download request/)
})

test('P2 registries bind jobs, records and connection actions to session and authenticated instance', async () => {
  let instance = 'one', called = 0
  const connection = { connectionId: 'can:1', targetId: 'can:1', identity: publicIdentity, connectionGeneration: '1', connected: true }
  const client = { recordings: async () => ({ jobId: 'job', kind: 'recordings', state: 'completed', error: null, recordings: [{ id: 'r', files: ['telemetry.csv'], metadataJsonText: native }] }), readJob: async () => ({ jobId: 'job', kind: 'recordings', state: 'failed', error: 'expired' }), recordingChunk: async () => { called++; return { jobId: 'chunk', kind: 'download', state: 'queued', error: null } }, connections: async () => [connection], changeConnection: async () => ({ ...connection, connected: false }) }
  const service = createP2Service({ mode: 'service-v2', session() {}, attach: async () => ({ instance_id: instance, capabilities: ['recordings_read', 'read_jobs', 'connections'] }), http: () => client, invalidateConnection() {} })
  await service.listRecordings('a')
  await assert.rejects(service.getJob('b', 'job'), /当前对话/)
  await assert.rejects(service.downloadRecording('b', { runId: 'r', file: 'telemetry.csv', offset: '0' }), /当前对话/)
  await assert.rejects(service.downloadRecording('a', { runId: 'r', file: 'token', offset: '0' }), /列举/)
  await service.downloadRecording('a', { runId: 'r', file: 'telemetry.csv', offset: '0' }); assert.equal(called, 1)
  await service.listConnections('a')
  await assert.rejects(service.changeConnection('a', { connectionId: 'can:1', identity: publicIdentity, connectionGeneration: '2', action: 'disconnect' }), /代次/)
  instance = 'two'
  await assert.rejects(service.getJob('a', 'job'), /当前对话/)
})

test('display history rejects other identities, preserves raw values and inserts gaps without zero-filling', () => {
  const selected = { targetId: 'can:1', identity: publicIdentity, connectionGeneration: '1' }
  const e = { targetId: 'can:1', identity: publicIdentity, connectionGeneration: '1', kind: 'telemetry', sourceTimestamp: { clock: 'device_monotonic_us', value: '18446744073709551614' }, nativeJsonText: native }
  const history = appendEvents([], { gap: true, events: [e, { ...e, connectionGeneration: '2' }] }, selected)
  assert.equal(history.length, 2); assert.equal(history[1].event.nativeJsonText, native)
  assert.deepEqual(chartSeries(history, 'velocity'), [[null, null], [0, null]])
  assert.equal(chartSeries(history, 'position')[1][1], 0.12345678901234568)
})

test('Remote preserves business failure code and owner recovery guidance without exposing native error payload', async () => {
  const { fieldkitRemoteFailure } = await import('../lib/remote.js')
  const { remoteErrorOf } = await import('@deepseek-ai/dsh-typert-protocol')
  assert.throws(() => fieldkitRemoteFailure({ code: 'owner_busy', message: 'native private location', nativeErrorJsonText: 'private', unknown: true }), error => {
    assert.equal(remoteErrorOf(error).code, 'fieldkit/service')
    assert.equal(error.details.code, 'owner_busy'); assert.equal(error.details.unknown, true)
    assert.match(error.message, /附着已有服务/); assert.ok(!error.message.includes('private'))
    return true
  })
})

test('failed handshake connection keeps null identity and allows only explicit same-generation reconnect', async () => {
  let request
  const client = createP2Client(async (_path, options) => { request = options; return { ...rawConnection, connected: false, identity: null } })
  const connection = parse('changeConnection', await client.changeConnection('i', { connectionId: 'usb:s', connectionGeneration: '7', identity: null }, 'reconnect'))
  assert.equal(connection.identity, null)
  assert.equal(request.body.expected_identity, null)
  assert.equal(request.body.connection_generation, '7')
  const cached = { connectionId: 'usb:s', targetId: 'usb:s', identity: null, connectionGeneration: '7', connected: false, snapshotJsonText: '{}', telemetryReceivedAgeMs: null }
  let calls = 0
  const service = createP2Service({ mode: 'service-v2', session() {}, attach: async () => ({ instance_id: 'i', capabilities: ['connections'] }), http: () => ({ connections: async () => [cached], changeConnection: async () => { calls++; return cached } }), invalidateConnection() {} })
  await service.listConnections('s')
  await service.changeConnection('s', { connectionId: 'usb:s', identity: null, connectionGeneration: '7', action: 'reconnect' })
  assert.equal(calls, 1)
  await assert.rejects(service.changeConnection('s', { connectionId: 'usb:s', identity: null, connectionGeneration: '7', action: 'disconnect' }), /代次/)
  await assert.rejects(service.changeConnection('s', { connectionId: 'usb:s', identity: publicIdentity, connectionGeneration: '7', action: 'reconnect' }), /代次/)
})
