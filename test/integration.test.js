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

async function fixture(t, respond) {
  const root = await mkdtemp(join(tmpdir(), 'fieldkit-http-'))
  const tokenFile = join(root, 'token')
  await writeFile(tokenFile, 'a'.repeat(64) + '\n', { mode: 0o600 })
  t.after(() => rm(root, { recursive: true, force: true }))
  const calls = []
  const client = createIntegrationClient({ endpoint: 'http://127.0.0.1:18080', tokenFile, fetchImpl: async (url, init) => {
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
