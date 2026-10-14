import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createIntegrationClient, IntegrationError } from '../src/integration.js'
import { createOwnerProcess } from '../src/owner-process.js'

test('service settings persist across a new owner process', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fieldkit-settings-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const requested = { toolPath: '/opt/eha-tool', port: 18180, dataDir: join(root, 'service'), runsDir: join(root, 'runs'), odrivePython: '' }
  const first = createOwnerProcess({}, { settingsRoot: root })
  const saved = await first.save(requested)
  assert.deepEqual(saved.settings, requested)
  const second = createOwnerProcess({}, { settingsRoot: root })
  assert.deepEqual(await second.getSettings(), requested)
})

test('one failed start does not retry itself and dispose never kills the owned child', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fieldkit-start-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let spawns = 0, kills = 0
  const owner = createOwnerProcess({ toolPath: '/opt/eha-tool', serviceDataDir: join(root, 'service') }, {
    settingsRoot: root,
    execFileImpl: (_path, _args, _options, done) => done(null, '', ''),
    spawnImpl: () => {
      spawns++
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stdout.destroy = () => {}
      child.unref = () => {}
      child.kill = () => { kills++ }
      queueMicrotask(() => child.emit('error', new Error('missing executable')))
      return child
    },
  })
  await assert.rejects(owner.start(), /无法启动服务/)
  assert.equal(spawns, 1)
  owner.dispose()
  assert.equal(kills, 0)
})

test('direct transport sends bearer only to the configured loopback endpoint and rejects redirects', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fieldkit-redirect-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const token = 'd'.repeat(64), tokenFile = join(root, 'token')
  await writeFile(tokenFile, `${token}\n`, { mode: 0o600 }); await chmod(tokenFile, 0o600)
  let seenUrl, seenInit
  const client = createIntegrationClient({ endpoint: 'http://127.0.0.1:18180', tokenFile, fetchImpl: async (url, init) => {
    seenUrl = url; seenInit = init
    return new Response('', { status: 302, headers: { location: 'https://elsewhere.invalid/api/devices' } })
  } })
  await assert.rejects(client.direct('/api/devices'), error => {
    assert.ok(error instanceof IntegrationError)
    assert.equal(error.code, 'redirect_rejected')
    assert.doesNotMatch(error.message, new RegExp(token))
    return true
  })
  assert.equal(seenUrl.origin, 'http://127.0.0.1:18180')
  assert.equal(seenInit.redirect, 'manual')
  assert.equal(seenInit.headers.Authorization, `Bearer ${token}`)
})

test('direct API has no plugin deadline while service metadata retains its bounded deadline', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fieldkit-timeout-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const tokenFile = join(root, 'token')
  await writeFile(tokenFile, `${'e'.repeat(64)}\n`, { mode: 0o600 }); await chmod(tokenFile, 0o600)
  const delayed = (url, init) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(new Response(url.pathname === '/api/devices' ? 'native reply' : JSON.stringify({ protocol: 'eha-tool.service.v2', api_version: 2, instance_id: 'instance-a', tool_version: 'test', dto_schema_version: 1, config_format_version: 1, capabilities: ['instance_status', 'service_shutdown', 'direct_api'] }), { status: 200 })), 20)
    init.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal.reason) }, { once: true })
  })
  const client = createIntegrationClient({ endpoint: 'http://127.0.0.1:18180', tokenFile, timeoutMs: 1, fetchImpl: delayed })
  assert.deepEqual(await client.direct('/api/devices'), { status: 200, ok: true, bodyText: 'native reply' })
  await assert.rejects(client.describe(), error => error instanceof IntegrationError && error.code === 'sdk_timeout')
})
