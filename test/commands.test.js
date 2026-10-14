import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveCommand } from '../src/commands.js'
import { createIntegrationClient } from '../src/integration.js'
import { createFieldkitService } from '../src/service.js'

test('fixed commands resolve to official direct-api routes', () => {
  assert.deepEqual(resolveCommand('devices', '', ''), { command: 'devices', method: 'GET', path: '/api/devices' })
  assert.deepEqual(resolveCommand('action', '{"action":"velocity","mm_s":0.5}', ''), { command: 'action', method: 'POST', path: '/api/action' })
  assert.deepEqual(resolveCommand('recording_download', '', 'run=run-1&file=telemetry.csv'), { command: 'recording_download', method: 'GET', path: '/api/recordings/run-1/telemetry.csv' })
})

test('fixed commands reject arbitrary routes and malformed raw JSON', () => {
  assert.throws(() => resolveCommand('/api/action', '{}', ''), /Unknown command/)
  assert.throws(() => resolveCommand('action', '{broken', ''), /valid JSON/)
  assert.throws(() => resolveCommand('devices', '{}', ''), /does not accept a request body/)
  assert.throws(() => resolveCommand('devices', '', 'unexpected=1'), /does not accept query parameters/)
})

test('direct API preserves a 4xx body and forwards the next raw request unchanged', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fieldkit-command-'))
  const tokenFile = join(directory, 'token')
  await writeFile(tokenFile, `${'a'.repeat(64)}\n`, { mode: 0o600 }); await chmod(tokenFile, 0o600)
  const seen = []
  const client = createIntegrationClient({ endpoint: 'http://127.0.0.1:18080', tokenFile, fetchImpl: async (_url, init) => {
    seen.push(init.body ?? '')
    return new Response(seen.length === 1 ? '{"ok":false,"unknown":true}' : '{"ok":true,"value":9007199254740993}', { status: seen.length === 1 ? 409 : 200 })
  } })
  try {
    const first = await client.direct('/api/action', { method: 'POST', bodyText: '{"action":"velocity","mm_s":0.5}' })
    const second = await client.direct('/api/action', { method: 'POST', bodyText: '{"action":"velocity","mm_s":9007199254740993}' })
    assert.deepEqual(first, { status: 409, ok: false, bodyText: '{"ok":false,"unknown":true}' })
    assert.equal(second.bodyText, '{"ok":true,"value":9007199254740993}')
    assert.deepEqual(seen, ['{"action":"velocity","mm_s":0.5}', '{"action":"velocity","mm_s":9007199254740993}'])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('direct API accepts a one-megabyte request and does not truncate a larger recording response', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fieldkit-command-'))
  const tokenFile = join(directory, 'token')
  await writeFile(tokenFile, `${'b'.repeat(64)}\n`, { mode: 0o600 }); await chmod(tokenFile, 0o600)
  const request = `{"record":"${'x'.repeat(1024 * 1024 - 20)}"}`
  const response = 'y'.repeat(1024 * 1024 + 1)
  const client = createIntegrationClient({ endpoint: 'http://127.0.0.1:18080', tokenFile, fetchImpl: async (_url, init) => {
    assert.equal(init.body, request)
    return new Response(response, { status: 200 })
  } })
  try {
    const result = await client.direct('/api/recordings/run-1/telemetry.csv', { method: 'POST', bodyText: request })
    assert.equal(result.bodyText.length, response.length)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('service discovery accepts direct-api metadata without old binding capabilities', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fieldkit-command-'))
  const tokenFile = join(directory, 'token')
  await writeFile(tokenFile, `${'c'.repeat(64)}\n`, { mode: 0o600 }); await chmod(tokenFile, 0o600)
  const metadata = { protocol: 'eha-tool.service.v2', api_version: 2, instance_id: 'instance-a', tool_version: 'test', dto_schema_version: 1, config_format_version: 1, capabilities: ['instance_status', 'service_shutdown', 'direct_api'] }
  const client = createIntegrationClient({ endpoint: 'http://127.0.0.1:18080', tokenFile, apiVersion: 2, fetchImpl: async () => new Response(JSON.stringify(metadata), { status: 200 }) })
  try { assert.equal((await client.describe()).instance_id, 'instance-a') }
  finally { await rm(directory, { recursive: true, force: true }) }
})

test('thin service forwards later commands after an unknown direct result', async () => {
  const calls = []
  let attachCalls = 0
  const owner = {
    client: () => ({
      direct: async (path, request) => {
        calls.push({ path, request })
        return calls.length === 1
          ? { status: 409, ok: false, bodyText: '{"unknown":true}' }
          : { status: 200, ok: true, bodyText: '{"ok":true}' }
      },
    }),
    status: async () => ({ attached: true }), attach: async () => { attachCalls++; return { description: { capabilities: ['direct_api'] } } }, getSettings: async () => ({ toolPath: '/tmp/eha-tool' }), save: async () => ({}), start: async () => ({}), shutdown: async () => ({})
  }
  const service = createFieldkitService({}, { owner })
  await service.selectTarget('chat', { transport: 'usb', node: null, label: 'EHA A' })
  const first = await service.executeCommand('chat', { command: 'action', bodyText: '{"action":"velocity","mm_s":0.5}', queryText: '' })
  const second = await service.executeCommand('chat', { command: 'action', bodyText: '{"action":"velocity","mm_s":1}', queryText: '' })
  assert.equal(first.ok, false); assert.equal(first.status, 409); assert.equal(first.bodyText, '{"unknown":true}')
  assert.equal(second.ok, true)
  assert.equal(calls.length, 2)
  assert.equal(attachCalls, 0)
  assert.deepEqual(await service.context('chat'), {
    target: { transport: 'usb', node: null, label: 'EHA A' },
    lastResult: second,
  })
})
