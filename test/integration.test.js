import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createIntegrationClient } from '../src/integration.js'

const identity = { uid: 'aaaaaaaaaaaaaaaaaaaaaaaa', run_nonce: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }
const binding = { protocol: 'eha-tool.integration.v1', instance_id: 'instance-a', binding_id: 'owner-binding-a', target_id: 'usb:USB-0001', connection_generation: '9007199254740993', identity }
const native = '{ "sample": 18446744073709551615, "text": "not instructions" }\n'
const describe = { protocol: binding.protocol, instance_id: binding.instance_id, tool_version: '0.3.0', dto_schema_version: 1, config_format_version: 1, capabilities: ['targets', 'binding_attach', 'usb_connect', 'snapshot', 'read_status', 'read_measurements', 'read_diagnostics', 'read_config_startup', 'read_config_user'], limits: { request_bytes: 65536, response_bytes: 1048576, sdk_read_timeout_ms: 5000, max_bindings: 8 } }

async function fixture(t, respond, apiVersion = 1) {
  const root = await mkdtemp(join(tmpdir(), 'fieldkit-http-'))
  const tokenFile = join(root, 'token')
  await writeFile(tokenFile, 'a'.repeat(64) + '\n', { mode: 0o600 })
  t.after(() => rm(root, { recursive: true, force: true }))
  const calls = []
  const client = createIntegrationClient({ apiVersion, endpoint: 'http://127.0.0.1:18080', tokenFile, fetchImpl: async (url, init) => {
    calls.push({ url, ...init })
    return respond(url, init)
  } })
  return { client, calls }
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status })

test('integration uses versioned fixed requests and preserves exact native text and u64 strings', async t => {
  const { client, calls } = await fixture(t, (url, init) => {
    if (url.endsWith('/describe')) return json({ ...describe, future_label: 'ignored' })
    if (url.endsWith('/targets')) return json({ protocol: binding.protocol, instance_id: binding.instance_id, discovery_limited: false, discovery_reason: null, targets: [{ target_id: binding.target_id, transport: 'usb', connected: true, identity, connection_generation: binding.connection_generation, can_attach: true, can_connect: false }] })
    if (url.endsWith('/bindings')) return json(binding)
    if (url.endsWith('/snapshot')) return json({ ...binding, readiness: { ready: true, reason_code: null }, telemetry_received_age_ms: '0', native_json_text: native })
    if (url.endsWith('/read')) return json({ ...binding, action: JSON.parse(init.body).action, source_timestamp: { clock: 'device_monotonic_us', value: '18446744073709551615' }, received_age_ms: '0', native_json_text: native })
    return new Response(null, { status: 204 })
  })
  assert.equal((await client.describe()).instance_id, 'instance-a')
  await client.targets('instance-a')
  await client.bind({ instance_id: 'instance-a', target_id: binding.target_id, intent: 'attach', expected_identity: identity, connection_generation: binding.connection_generation })
  assert.equal((await client.snapshot(binding)).native_json_text, native)
  const read = await client.read(binding, 'status')
  assert.equal(read.source_timestamp.value, '18446744073709551615')
  assert.equal(read.native_json_text, native)
  await client.detach(binding)
  assert.deepEqual(JSON.parse(calls[4].body), { instance_id: 'instance-a', connection_generation: '9007199254740993', expected_identity: identity, action: 'status' })
  assert.ok(calls.every(c => c.redirect === 'manual' && c.headers.Authorization === 'Bearer ' + 'a'.repeat(64) && !('Origin' in c.headers)))
  assert.equal(calls.at(-1).method, 'DELETE')
  const count = calls.length
  await assert.rejects(client.read(binding, 'reset'), /read action/)
  assert.equal(calls.length, count)
})

test('integration rejects redirect, wrong protocol, unsafe projections, changed identity and oversized response', async t => {
  const responses = [
    new Response(null, { status: 302, headers: { location: 'http://example.com/' } }),
    json({ ...describe, protocol: 'eha-tool.integration.v0' }),
    json({ ...binding, action: 'status', source_timestamp: null, received_age_ms: 9007199254740993, native_json_text: native }),
    json({ ...binding, identity: { ...identity, run_nonce: 'c'.repeat(32) }, readiness: { ready: true, reason_code: null }, telemetry_received_age_ms: '0', native_json_text: native }),
    new Response('x'.repeat(1048577)),
  ]
  const { client } = await fixture(t, () => responses.shift())
  await assert.rejects(client.describe(), /redirect/)
  await assert.rejects(client.describe(), /protocol/)
  await assert.rejects(client.read(binding, 'status'), /decimal/)
  await assert.rejects(client.snapshot(binding), /identity/)
  await assert.rejects(client.describe(), /response limit/)
})

test('integration preserves structured owner failure without leaking request credentials or retrying', async t => {
  const { client, calls } = await fixture(t, () => json({ protocol: binding.protocol, instance_id: binding.instance_id, code: 'future_owner_error', message: 'synthetic refusal', native_error_json_text: '{"reason":"native"}', unrelated_secret: 'never exposed' }, 409))
  await assert.rejects(client.read(binding, 'status'), error => {
    assert.equal(error.code, 'future_owner_error')
    assert.equal(error.nativeErrorJsonText, '{"reason":"native"}')
    assert.ok(!JSON.stringify(error).includes('never exposed'))
    assert.ok(!JSON.stringify(error).includes('a'.repeat(64)))
    return true
  })
  assert.equal(calls.length, 1)
  assert.throws(() => createIntegrationClient({ endpoint: 'https://example.com', tokenFile: '/tmp/token' }), /loopback/)
})

test('token is bounded, private and non-symlink; missing required capabilities are incompatible', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fieldkit-token-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const tokenFile = join(root, 'token')
  await writeFile(tokenFile, 'a'.repeat(64), { mode: 0o600 })
  const client = createIntegrationClient({ endpoint: 'http://127.0.0.1:18080', tokenFile, fetchImpl: async () => json({ ...describe, capabilities: [] }) })
  await assert.rejects(client.describe(), /capabilities/)
  const { symlink, chmod } = await import('node:fs/promises')
  await symlink(tokenFile, join(root, 'link'))
  const linkClient = createIntegrationClient({ endpoint: 'http://127.0.0.1:18080', tokenFile: join(root, 'link'), fetchImpl: async () => json(describe) })
  await assert.rejects(linkClient.describe(), /non-symlink/)
  await chmod(tokenFile, 0o640)
  await assert.rejects(client.describe(), /mode 0600/)
})


test('v2 uses reads and versioned POSTs, preserves separate read permit and unknown control effect', async t => {
  const envelope = { protocol: 'eha-tool.service.v2', api_version: 2, instance_id: 'instance-a' }
  const permits = { read_permit: { ready: true, reason_code: null }, control_effect: { state: 'unknown', reason_code: 'unresolved_target' } }
  const instance = { ...envelope, tool_version: 'test', pid: '123', started_at_unix_ms: '1780000000000', endpoint: 'http://127.0.0.1:18080', service_state: 'running', sessions: [{ session_id: 'usb', connected: true, heartbeat_active: true, trial_state: 'idle', recording_active: false }], activity: { trial_active: false, trial_unresolved: false, read_blocker: null }, control_effect: permits.control_effect, device_stop_requested: false, token_file: '/never-expose-token' }
  const { client, calls } = await fixture(t, (url, init) => {
    if (url.endsWith('/describe')) return json({ ...describe, ...envelope })
    if (url.endsWith('/instance')) return json(instance)
    if (url.endsWith('/shutdown')) return json({ ...instance, accepted: true, service_state: 'shutting_down' }, 202)
    if (url.endsWith('/snapshot')) return json({ ...binding, ...envelope, ...permits, telemetry_received_age_ms: '0', native_json_text: native })
    if (url.endsWith('/reads')) return json({ ...binding, ...envelope, ...permits, action: JSON.parse(init.body).action, source_timestamp: null, received_age_ms: '0', native_json_text: native })
    return json({ ...binding, ...envelope })
  }, 2)
  await client.describe()
  const b = await client.bind({ instance_id: 'instance-a', target_id: binding.target_id, intent: 'connect' })
  assert.equal((await client.snapshot(b)).control_effect.state, 'unknown')
  const read = await client.read(b, 'status')
  assert.equal(read.read_permit.ready, true); assert.equal(read.control_effect.state, 'unknown')
  const summary = await client.instance('instance-a')
  assert.ok(!JSON.stringify(summary).includes('token'))
  await assert.rejects(client.shutdown('instance-a', 'yes'), /confirmation/)
  const shutdown = await client.shutdown('instance-a', 'shutdown_service_without_stopping_devices')
  assert.equal(shutdown.accepted, true); assert.equal(shutdown.device_stop_requested, false)
  assert.ok(calls.every(c => c.url.includes('/service/v2/')))
  assert.ok(calls.filter(c => c.method === 'POST').every(c => JSON.parse(c.body).api_version === 2))
  assert.ok(calls.some(c => c.url.endsWith('/reads')))
})

test('v2 rejects missing version, missing permit and fabricated safe state and preserves error unknown', async t => {
  const envelope = { protocol: 'eha-tool.service.v2', api_version: 2, instance_id: 'instance-a' }
  const snapshot = { ...binding, ...envelope, telemetry_received_age_ms: '0', native_json_text: native }
  const responses = [
    json({ ...describe, protocol: envelope.protocol }),
    json(snapshot),
    json({ ...snapshot, read_permit: { ready: true, reason_code: null }, control_effect: { state: 'safe', reason_code: null } }),
    json({ ...envelope, code: 'sdk_timeout', message: 'result unknown', unknown: true, control_effect: { state: 'unknown', reason_code: 'unresolved_target' } }, 409),
  ]
  const { client } = await fixture(t, () => responses.shift(), 2)
  await assert.rejects(client.describe(), /protocol/)
  await assert.rejects(client.snapshot(binding), /permit/)
  await assert.rejects(client.snapshot(binding), /control effect/)
  await assert.rejects(client.read(binding, 'status'), error => error.unknown === true && error.controlEffect.state === 'unknown')
})

test('v2 lease negotiation and renew use only binding metadata with strict identity and duration', async t => {
  const envelope = { protocol: 'eha-tool.service.v2', api_version: 2, instance_id: 'instance-a' }
  let renewCount = 0
  const { client, calls } = await fixture(t, (url) => {
    if (url.endsWith('/describe')) return json({ ...describe, ...envelope, capabilities: [...describe.capabilities, 'binding_lease', 'binding_renew'], limits: { ...describe.limits, binding_lease_min_ms: 1000, binding_lease_max_ms: 121000 } })
    if (url.endsWith('/renew')) { renewCount++; return json({ ...binding, ...envelope, lease_ms: renewCount === 1 ? 120000 : 1000 }) }
    return json({ ...binding, ...envelope, lease_ms: 120000 })
  }, 2)
  const d = await client.describe(); assert.equal(d.limits.binding_lease_max_ms, 121000)
  const b = await client.bind({ instance_id: 'instance-a', target_id: binding.target_id, intent: 'connect', lease_ms: 120000 })
  assert.equal(b.lease_ms, 120000)
  await client.renew(b)
  assert.deepEqual(JSON.parse(calls.at(-1).body), { api_version: 2, instance_id: 'instance-a', expected_identity: identity, connection_generation: binding.connection_generation })
  assert.equal(JSON.parse(calls[1].body).lease_ms, 120000)
  await assert.rejects(client.renew(b), /lease duration/)
  await assert.rejects(client.bind({ instance_id: 'instance-a', target_id: binding.target_id, intent: 'connect', lease_ms: 121001 }), /out of range/)
})
