import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createOwnerProcess } from '../src/owner-process.js'

test('owner starts eha-tool with direct-api and rejects a service without that capability', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fieldkit-owner-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dataDir = join(root, 'service'), instanceFile = join(dataDir, 'port-18080.json'), tokenFile = join(dataDir, 'port-18080.token')
  const record = { protocol: 'eha-tool.service.v2', api_version: 2, tool_version: 'test', instance_id: 'instance-a', pid: '123', started_at_unix_ms: '1780000000000', endpoint: 'http://127.0.0.1:18080', token_file: tokenFile }
  const client = { describe: async () => ({ ...record, capabilities: ['instance_status', 'service_shutdown', 'direct_api'] }), instance: async () => ({ ...record, service_state: 'running' }) }
  const calls = []
  const manager = createOwnerProcess({ toolPath: '/opt/eha-tool', servicePort: 18080 }, {
    settingsRoot: root,
    createClient: () => client,
    execFileImpl: (_path, _args, _options, done) => done(null, '', ''),
    spawnImpl: (_path, args) => {
      calls.push(args)
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.unref = () => {}
      void (async () => {
        await writeFile(tokenFile, `${'a'.repeat(64)}\n`, { mode: 0o600 }); await chmod(tokenFile, 0o600)
        await writeFile(instanceFile, JSON.stringify(record), { mode: 0o600 }); await chmod(instanceFile, 0o600)
        child.stdout.write(JSON.stringify({ ...record, event: 'ready', instance_file: instanceFile }) + '\n')
      })()
      return child
    },
  })
  const status = await manager.start()
  assert.equal(status.attached, true)
  assert.ok(calls[0].includes('--direct-api'))
  client.describe = async () => ({ ...record, capabilities: ['instance_status', 'service_shutdown'] })
  await assert.rejects(manager.attach(), /direct_api/)
})
