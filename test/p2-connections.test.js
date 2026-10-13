import test from 'node:test'
import assert from 'node:assert/strict'
import { createP2Client } from '../src/p2-client.js'
import { createP2Service } from '../src/p2-service.js'
import { TYPERT_REMOTE } from '../lib/typert.remote-client.js'
const codec = (name, value) => TYPERT_REMOTE.descriptors.find(d => d.method === name).result.create().parse(value)
const identity = { uid: 'a'.repeat(24), run_nonce: 'b'.repeat(32) }
const raw = '{"value":18446744073709551615,"decimal":0.12345678901234567890}'
const connection = { connection_id: 'can:1', target_id: 'can:1', identity, connection_generation: '9007199254740993', connected: true, snapshot_json_text: raw, telemetry_received_age_ms: '0', profile_job_id: 'profile-job' }
const usb = { transport: 'usb', id: 'usb-s', name: 'USB', serial: 'S', expected_uid: null }
const can = { transport: 'can', id: 'can-s', name: 'CAN', adapter: { kind: 'canable2', serial: 'A' }, node: 1, mode: 'fd', expected_uid: null }
const scan = { scan_id: 'scan', state: 'completed', nodes: [{ node: 1, identity }, { node: 2, identity }], errors: [] }

test('generated codecs preserve mixed profiles, advanced input, UID persistence and batch partial evidence', async () => {
  let response
  const calls = [], client = createP2Client(async (path, request) => { calls.push({ path, request }); return response })
  response = { profiles: [usb, can], load_error: null, busy: false }
  const listed = codec('listProfiles', await client.profiles('i'))
  assert.equal(listed.profiles[0].serial, 'S'); assert.equal(listed.profiles[1].adapter.serial, 'A')
  response = { job_id: 'save', state: 'completed', data: { profile: usb }, error: null }
  assert.equal(codec('saveProfile', await client.saveProfile('i', listed.profiles[0])).profile.transport, 'usb')
  assert.deepEqual(calls.at(-1).request.body, { instance_id: 'i', profile: usb })
  response = { job_id: 'connect', state: 'queued', data: null, error: null }
  const input = { channel: 'frozen-context', mode: 'classic', python: '/path with space/python3', node: 1 }
  const queued = codec('connectAdvanced', await client.connectAdvanced('i', input))
  assert.equal(queued.kind, 'connect')
  assert.deepEqual(calls.at(-1), { path: '/connections', request: { method: 'POST', instanceId: 'i', body: { instance_id: 'i', transport: 'can', advanced: { channel: input.channel, mode: input.mode, python: input.python }, node: 1 } } })
  response = { job_id: 'connect', state: 'completed', data: { connection }, error: null }
  const connected = codec('getJob', await client.readJob('i', 'connect', 'connect')).connection
  assert.equal(connected.profileJobId, 'profile-job'); assert.equal(connected.snapshotJsonText, raw)
  response = scan
  codec('scanAdvanced', await client.scanAdvanced('i', { advanced: { channel: 'ctx', mode: 'fd', python: null }, nodes: [1, 2] }))
  assert.deepEqual(calls.at(-1).request.body, { instance_id: 'i', advanced: { channel: 'ctx', mode: 'fd', python: null }, nodes: [1, 2] })
  codec('scanProfile', await client.scanProfile('i', { profileId: 'can-s', nodes: [1, 2] }))
  assert.deepEqual(calls.at(-1).request.body, { instance_id: 'i', profile_id: 'can-s', nodes: [1, 2] })
  response = { job_id: 'batch', state: 'queued', data: null, error: null }
  codec('connectScannedNodes', await client.connectScannedNodes('i', { scanId: 'scan', nodes: [1, 2] }))
  assert.deepEqual(calls.at(-1).request.body, { instance_id: 'i', scan_id: 'scan', nodes: [1, 2] })
  response = { job_id: 'batch', state: 'completed', data: { connections: [connection], errors: [{ node: 2, target_id: 'can:2', code: 'identity_changed', message: 'mismatch', unknown: true, error_json_text: raw }] }, error: null }
  const result = codec('getJob', await client.readJob('i', 'batch', 'batchConnect'))
  assert.equal(result.batch.connections[0].connectionGeneration, '9007199254740993')
  assert.equal(result.batch.errors[0].errorJsonText, raw); assert.equal(result.batch.errors[0].unknown, true)
})

test('connection completion service permits only registered completed scan nodes and current profile jobs', async () => {
  const calls = [], caps = ['managed_profiles', 'usb_profiles', 'connections', 'advanced_can', 'can_scan', 'selected_node_connections', 'read_jobs']
  let instance = 'i', loadError = null
  const usbPublic = { ...usb, expectedUid: null }; delete usbPublic.expected_uid
  const client = {
    profiles: async () => ({ profiles: [usbPublic, { ...can, expectedUid: null }], loadError, busy: false }),
    saveProfile: async (_i, p) => { calls.push(['save', p]); return { jobId: 'save', kind: 'profileSave', state: 'completed', error: null, profile: p } },
    connectProfile: async () => ({ connectionId: 'usb:S', targetId: 'usb:S', profileJobId: 'persist' }),
    readJob: async (_i, id, kind) => { calls.push(['job', id, kind]); return { jobId: id, kind, state: 'failed', error: 'disk full' } },
    scanAdvanced: async () => ({ scanId: 's', state: 'running', nodes: [], errors: [] }),
    readScan: async () => ({ scanId: 's', state: 'completed', nodes: [{ node: 1, identity: { uid: identity.uid, runNonce: identity.run_nonce } }], errors: [{ node: 2, message: 'no response', unknown: false, errorJsonText: raw }] }),
    connectScannedNodes: async (_i, r) => { calls.push(['batch', r]); return { jobId: 'batch', kind: 'batchConnect', state: 'queued', error: null } },
  }
  const service = createP2Service({ mode: 'service-v2', session() {}, attach: async () => ({ instance_id: instance, capabilities: caps }), http: () => client, invalidateConnection() {} })
  await service.saveProfile('a', usbPublic)
  await service.listProfiles('a'); await service.connectProfile('a', usb.id)
  assert.equal((await service.getJob('a', 'persist')).error, 'disk full')
  assert.deepEqual(calls.at(-1), ['job', 'persist', 'profileSave'])
  await assert.rejects(service.getJob('b', 'persist'), /当前对话/)
  await service.scanAdvanced('a', { advanced: { channel: 'ctx', mode: 'classic', python: null }, nodes: [1, 2] })
  await assert.rejects(service.connectScannedNodes('a', { scanId: 's', nodes: [1] }), /已完成/)
  await service.getScan('a', 's')
  await assert.rejects(service.connectScannedNodes('a', { scanId: 's', nodes: [2] }), /核对成功/)
  await assert.rejects(service.connectScannedNodes('b', { scanId: 's', nodes: [1] }), /当前对话/)
  await service.connectScannedNodes('a', { scanId: 's', nodes: [1] })
  assert.deepEqual(calls.at(-1), ['batch', { scanId: 's', nodes: [1] }])
  for (const request of [{ advanced: { channel: 'ctx', mode: 'fd', python: null, argv: [] }, nodes: [1] }, { advanced: { channel: 'ctx', mode: 'fd', python: null }, nodes: [1, 1] }]) await assert.rejects(service.scanAdvanced('a', request))
  loadError = 'USB/CAN id collision'; await service.listProfiles('a')
  await assert.rejects(service.connectProfile('a', usb.id), /冲突/)
  instance = 'new'
  await assert.rejects(service.connectScannedNodes('a', { scanId: 's', nodes: [1] }), /当前对话/)
})
