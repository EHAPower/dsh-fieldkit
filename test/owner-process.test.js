import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtemp, writeFile, readFile, stat, rm, chmod, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createOwnerProcess, userDataDirectory } from '../src/owner-process.js'
import { createFieldkitService } from '../src/service.js'

const capabilities = ['instance_status', 'service_shutdown', 'targets', 'binding_lease', 'binding_renew']
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'fieldkit-owner-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const config = { toolPath: '/opt/eha-tool', servicePort: 18080 }
  const settings = { toolPath: config.toolPath, port: 18080, dataDir: join(root, 'service'), runsDir: '', odrivePython: '' }
  const record = { protocol: 'eha-tool.service.v2', api_version: 2, tool_version: 'test', instance_id: 'instance-a', pid: '123', started_at_unix_ms: '1780000000000', endpoint: 'http://127.0.0.1:18080', token_file: join(settings.dataDir, 'port-18080.token') }
  let invalidations = 0
  const calls = []
  const client = {
    async describe() { return { protocol: record.protocol, api_version: 2, tool_version: record.tool_version, instance_id: record.instance_id, capabilities, limits: { binding_lease_min_ms: 1000, binding_lease_max_ms: 121000 } } },
    async instance() { return { ...record, service_state: 'running', control_effect: { state: 'unknown', reason_code: 'unresolved_target' }, activity: { trial_active: true, trial_unresolved: false, read_blocker: 'unresolved_target' }, sessions: [], device_stop_requested: false, token_file: undefined } },
    async shutdown(id, confirmation) { calls.push(['shutdown', id, confirmation]); return { ...await this.instance(), accepted: true, service_state: 'shutting_down' } },
  }
  const publish = () => writeFile(join(settings.dataDir, 'port-18080.json'), JSON.stringify(record), { mode: 0o600 })
  const dependencies = { execFileImpl: (_path, _args, _options, done) => done(null, '', ''), settingsRoot: root, onInvalidate: () => invalidations++, createClient: args => { calls.push(['client', args]); return client }, spawnImpl: (path, args, opts) => {
    calls.push(['spawn', path, args, opts])
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.unref = () => calls.push(['unref']); child.kill = () => { throw new Error('must never kill') }
    void publish().then(() => child.stdout.write(JSON.stringify({ ...record, event: 'ready', instance_file: join(settings.dataDir, 'port-18080.json') }) + '\n'))
    return child
  }, ...options }
  const manager = createOwnerProcess(config, dependencies)
  await manager.getSettings()
  return { root, settings, record, manager, calls, client, publish, dependencies, config, invalidations: () => invalidations }
}
test('system data directory prefers XDG and otherwise macOS Application Support', () => {
  assert.equal(userDataDirectory({ XDG_DATA_HOME: '/private/data' }, 'darwin', '/Users/test'), '/private/data/ehapower/dsh-fieldkit')
  assert.equal(userDataDirectory({}, 'darwin', '/Users/test'), '/Users/test/Library/Application Support/ehapower/dsh-fieldkit')
  assert.throws(() => userDataDirectory({ XDG_DATA_HOME: 'relative' }), /绝对/)
})
test('settings are private, atomic, allowlisted and persistent without arbitrary file read', async t => {
  const f = await fixture(t)
  await f.manager.save({ ...f.settings, runsDir: '/private/runs' })
  assert.equal((await stat(join(f.root, 'settings.json'))).mode & 0o777, 0o600)
  assert.equal((await stat(f.settings.dataDir)).mode & 0o777, 0o700)
  const next = createOwnerProcess({}, { settingsRoot: f.root })
  assert.equal((await next.getSettings()).runsDir, '/private/runs')
  await assert.rejects(f.manager.save({ ...f.settings, argv: ['reset'] }), /未知/)
  await assert.rejects(f.manager.save({ ...f.settings, toolPath: '/tmp/../tool' }), /绝对/)
  await assert.rejects(f.manager.save({ ...f.settings, port: 0 }), /端口/)
})
test('explicit concurrent starts serialize, authenticate and never kill on dispose', async t => {
  const f = await fixture(t)
  const [one, two] = await Promise.all([f.manager.start(), f.manager.start()])
  assert.equal(one.instance.control_effect.state, 'unknown')
  assert.equal(two.attached, true)
  assert.equal(f.calls.filter(c => c[0] === 'spawn').length, 1)
  const spawn = f.calls.find(c => c[0] === 'spawn')
  assert.equal(spawn[1], '/opt/eha-tool')
  assert.deepEqual(spawn[2], ['serve', '--port', '18080', '--token-file', f.record.token_file, '--instance-file', join(f.settings.dataDir, 'port-18080.json')])
  assert.equal(spawn[3].shell, false); assert.equal(spawn[3].detached, true)
  assert.ok(!JSON.stringify(one).includes('token_file'))
  f.manager.dispose()
  assert.equal(f.calls.filter(c => c[0] === 'shutdown').length, 0)
})
test('discovery refuses unsafe files, wrong versions and mismatched authenticated instance', async t => {
  const f = await fixture(t)
  await f.manager.save(f.settings); await f.publish()
  const instanceFile = join(f.settings.dataDir, 'port-18080.json')
  await chmod(instanceFile, 0o644)
  assert.equal((await f.manager.status()).error.code, 'unsafe_file')
  await chmod(instanceFile, 0o600)
  f.record.api_version = 1; await f.publish()
  assert.equal((await f.manager.status()).error.code, 'protocol_mismatch')
  f.record.api_version = 2; await f.publish()
  f.client.describe = async () => ({ instance_id: 'other', tool_version: 'test', capabilities })
  await assert.rejects(f.manager.attach(), /实例/)
  await assert.rejects(f.manager.start(), /无法认证/)
  assert.equal(f.calls.filter(c => c[0] === 'spawn').length, 0)
  await rm(instanceFile); await symlink('/etc/passwd', instanceFile)
  await assert.rejects(f.manager.attach())
})
test('explicit shutdown checks instance and confirmation, preserves unknown effects and invalidates', async t => {
  const f = await fixture(t)
  await f.manager.start()
  await assert.rejects(f.manager.shutdown({ instanceId: 'instance-a', confirmation: 'yes' }), /确认/)
  await assert.rejects(f.manager.shutdown({ instanceId: 'other', confirmation: 'shutdown_service_without_stopping_devices' }), /确认/)
  const result = await f.manager.shutdown({ instanceId: 'instance-a', confirmation: 'shutdown_service_without_stopping_devices' })
  assert.equal(result.attached, false); assert.equal(result.instance.accepted, true)
  assert.equal(result.instance.device_stop_requested, false); assert.equal(result.instance.control_effect.state, 'unknown')
  assert.throws(() => f.manager.client(), /尚未附着/)
  assert.equal(f.calls.filter(c => c[0] === 'shutdown').length, 1)
})
test('port conflict spawn failure preserves existing credential and never retries automatically', async t => {
  const f = await fixture(t, { spawnImpl: () => { const child = new EventEmitter(); child.stdout = new PassThrough(); child.unref = () => {}; queueMicrotask(() => child.emit('exit', 1)); return child } })
  await f.manager.save(f.settings)
  await writeFile(f.record.token_file, 'unchanged', { mode: 0o600 })
  await assert.rejects(f.manager.start(), /端口占用/)
  assert.equal(await readFile(f.record.token_file, 'utf8'), 'unchanged')
})
test('unknown startup result prevents a queued duplicate launch and never kills the child', async t => {
  let launches = 0
  const f = await fixture(t, { startTimeoutMs: 10, spawnImpl: () => { launches++; const child = new EventEmitter(); child.stdout = new PassThrough(); child.unref = () => {}; return child } })
  const results = await Promise.allSettled([f.manager.start(), f.manager.start()])
  assert.equal(results[0].reason.code, 'start_unknown'); assert.equal(results[1].reason.code, 'start_unknown')
  assert.equal(launches, 1)
})
test('endpoint settings invalidate bindings in every chat and config-check stays offline', async t => {
  const f = await fixture(t)
  await f.manager.start()
  const identity = { uid: 'a'.repeat(24), run_nonce: 'b'.repeat(32) }
  const target = { target_id: 'usb:test', transport: 'usb', connected: true, identity, connection_generation: '1', can_attach: true, can_connect: false }
  f.client.targets = async () => ({ instance_id: f.record.instance_id, targets: [target], discovery_limited: false, discovery_reason: null })
  f.client.bind = async body => ({ ...body, identity, connection_generation: '1', binding_id: 'b' })
  f.client.detach = async () => { f.calls.push(['detach']) }
  const service = createFieldkitService(f.config, { owner: f.dependencies, cli: { checkConfiguration: async text => ({ exitCode: 0, stdout: text, stderr: '', error: null }) } })
  for (const session of ['a', 'b']) { await service.listTargets(session); await service.openTarget(session, { targetId: target.target_id, intent: 'attach', expectedIdentity: { uid: identity.uid, runNonce: identity.run_nonce }, connectionGeneration: '1' }) }
  await service.saveServiceSettings({ ...f.settings, port: 18081 })
  for (const session of ['a', 'b']) {
    const b = service.selectedBinding(session); assert.equal(b.expired, true)
    await assert.rejects(service.getSnapshot(session, { bindingId: b.bindingId }), /expired/)
  }
  assert.equal((await service.checkConfiguration('original')).stdout, 'original')
  await service.dispose()
  assert.equal(f.calls.filter(c => c[0] === 'shutdown').length, 0)
})

test('private service directories reject symlinks and public permissions', async t => {
  const f = await fixture(t)
  await f.manager.save(f.settings)
  await chmod(f.settings.dataDir, 0o755)
  await assert.rejects(f.manager.attach(), /0700/)
  await chmod(f.settings.dataDir, 0o700)
  const alias = join(f.root, 'alias')
  await symlink(f.settings.dataDir, alias)
  await assert.rejects(f.manager.save({ ...f.settings, dataDir: alias }), /0700/)
})

test('settings change during connect revokes late binding through original authenticated client', async t => {
  const f = await fixture(t)
  await f.manager.start()
  const identity = { uid: 'a'.repeat(24), run_nonce: 'b'.repeat(32) }
  let enter, release
  const entered = new Promise(resolve => { enter = resolve })
  const gate = new Promise(resolve => { release = resolve })
  f.client.targets = async () => ({ instance_id: f.record.instance_id, targets: [{ target_id: 'usb:test', transport: 'usb', connected: false, identity: null, connection_generation: null, can_attach: false, can_connect: true }], discovery_limited: false, discovery_reason: null })
  f.client.bind = async body => { enter(); await gate; return { ...body, identity, connection_generation: '1', binding_id: 'late' } }
  f.client.detach = async b => { f.calls.push(['detach', b.binding_id]) }
  const service = createFieldkitService(f.config, { owner: f.dependencies })
  await service.listTargets('a')
  const pending = service.openTarget('a', { targetId: 'usb:test', intent: 'connect' })
  await entered
  await service.saveServiceSettings({ ...f.settings, port: 18081 })
  release()
  await assert.rejects(pending, /newer target selection/)
  assert.deepEqual(f.calls.filter(c => c[0] === 'detach'), [['detach', 'late']])
  assert.equal(service.selectedBinding('a'), null)
})

test('expired selection can still detach through the original client after settings change', async t => {
  const f = await fixture(t)
  await f.manager.start()
  const identity = { uid: 'a'.repeat(24), run_nonce: 'b'.repeat(32) }
  f.client.targets = async () => ({ instance_id: f.record.instance_id, targets: [{ target_id: 'usb:test', transport: 'usb', connected: false, identity: null, connection_generation: null, can_attach: false, can_connect: true }], discovery_limited: false, discovery_reason: null })
  f.client.bind = async body => ({ ...body, identity, connection_generation: '1', binding_id: 'original' })
  f.client.detach = async b => { f.calls.push(['detach', b.binding_id]) }
  const service = createFieldkitService(f.config, { owner: f.dependencies })
  await service.listTargets('a')
  const binding = await service.openTarget('a', { targetId: 'usb:test', intent: 'connect' })
  await service.saveServiceSettings({ ...f.settings, port: 18081 })
  await assert.rejects(service.getSnapshot('a', { bindingId: binding.bindingId }), /expired/)
  await assert.rejects(service.detachTarget('b', { bindingId: binding.bindingId }), /selected binding/)
  await service.detachTarget('a', { bindingId: binding.bindingId })
  assert.deepEqual(f.calls.filter(c => c[0] === 'detach'), [['detach', 'original']])
  assert.equal(service.selectedBinding('a'), null)
})

test('private directory ancestors reject foreign ownership and non-root sticky exceptions', async t => {
  if (process.getuid?.() !== 0) return t.skip('Synthetic ownership fixtures require root in devbox')
  const { mkdir, chown } = await import('node:fs/promises')
  const f = await fixture(t)
  for (const mode of [0o755, 0o1777]) {
    const ancestor = join(f.root, `foreign-${mode}`)
    const child = join(ancestor, 'private')
    await mkdir(ancestor, { mode }); await chmod(ancestor, mode)
    await mkdir(child, { mode: 0o700 }); await chown(ancestor, 12345, 12345)
    await assert.rejects(f.manager.save({ ...f.settings, dataDir: child }), /祖先/)
  }
})

test('unsupported serve is classified without publishing raw stderr or credentials', async t => {
  const f = await fixture(t, { execFileImpl: (_path, _args, _options, done) => done(Object.assign(new Error('private native error'), { code: 2 }), '', "error: unrecognized subcommand 'serve'\nSECRET token /private/token\n"), spawnImpl: () => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.unref = () => {}
    queueMicrotask(() => child.emit('exit', 2))
    return child
  } })
  await assert.rejects(f.manager.start(), error => error.code === 'tool_version_unsupported' && /新版/.test(error.message) && !error.message.includes('SECRET'))
})

test('human lifecycle Remote returns a stable error DTO for a failed startup', async t => {
  const f = await fixture(t, { spawnImpl: () => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.unref = () => {}
    queueMicrotask(() => child.emit('error', new Error('private native error')))
    return child
  } })
  const service = createFieldkitService(f.config, { owner: f.dependencies })
  const result = await service.startService()
  assert.equal(result.error.code, 'start_failed')
  assert.ok(!JSON.stringify(result).includes('private native error'))
})

test('offline config-check uses the executable saved in user settings', async t => {
  const f = await fixture(t)
  const executable = join(f.root, 'configured-tool')
  await writeFile(executable, '#!/usr/bin/env node\nprocess.stdout.write(process.argv[1])\n', { mode: 0o700 })
  const service = createFieldkitService({ toolPath: '/missing-original-tool' }, { owner: f.dependencies })
  await service.saveServiceSettings({ ...f.settings, toolPath: executable })
  const result = await service.checkConfiguration('{}')
  assert.equal(result.exitCode, 0)
  assert.equal(result.stdout, executable)
})

async function leasedService(t, renew) {
  const f = await fixture(t); await f.manager.start()
  const identity = { uid: 'a'.repeat(24), run_nonce: 'b'.repeat(32) }
  f.client.targets = async () => ({ instance_id: f.record.instance_id, targets: [{ target_id: 'usb:lease', transport: 'usb', connected: false, identity: null, connection_generation: null, can_attach: false, can_connect: true }], discovery_limited: false, discovery_reason: null })
  f.client.bind = async request => { f.calls.push(['bind', request]); return { ...request, identity, connection_generation: '1', binding_id: 'leased' } }
  f.client.renew = async binding => { f.calls.push(['renew', binding]); return renew ? renew(binding) : binding }
  f.client.detach = async binding => { f.calls.push(['detach', binding.binding_id]) }
  const timers = []
  const service = createFieldkitService(f.config, { owner: f.dependencies, scheduleRenewal: (tick, delay) => { const timer = { tick, delay, unref() { this.unreferenced = true } }; timers.push(timer); return timer }, clearRenewal: timer => { timer.cleared = true } })
  await service.listTargets('lease-chat')
  const binding = await service.openTarget('lease-chat', { targetId: 'usb:lease', intent: 'connect' })
  return { ...f, service, timers, binding }
}

test('v2 leases renew on an unreferenced 30s host timer and never overlap', async t => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const f = await leasedService(t, async binding => { await gate; return binding })
  assert.equal(f.calls.find(c => c[0] === 'bind')[1].lease_ms, 120000)
  assert.equal(f.timers[0].delay, 30000); assert.equal(f.timers[0].unreferenced, true)
  const pending = f.timers[0].tick()
  assert.equal(f.timers.length, 1)
  assert.equal(f.calls.filter(c => c[0] === 'renew').length, 1)
  release(); await pending
  assert.equal(f.timers.length, 2)
  await f.service.detachTarget('lease-chat', { bindingId: f.binding.bindingId })
  assert.equal(f.timers[1].cleared, true)
  await f.timers[1].tick()
  assert.equal(f.calls.filter(c => c[0] === 'renew').length, 1)
  assert.deepEqual(f.calls.filter(c => c[0] === 'detach'), [['detach', 'leased']])
})

test('lease renewal failure expires observation without reconnect or further renewal', async t => {
  const f = await leasedService(t, async () => { throw Object.assign(new Error('lease expired'), { code: 'not_found' }) })
  await f.timers[0].tick()
  assert.equal(f.service.selectedBinding('lease-chat').expired, true)
  assert.deepEqual(f.service.selectedBinding('lease-chat').observationWarnings[0].observationSource, { phase: 'renewal', instanceId: f.record.instance_id, bindingId: f.binding.bindingId, sdkBindingId: 'leased', targetId: 'usb:lease' })
  assert.equal(f.timers.length, 1)
  assert.equal(f.calls.filter(c => c[0] === 'bind').length, 1)
  assert.deepEqual(f.calls.filter(c => c[0] === 'detach'), [['detach', 'leased']])
  await assert.rejects(f.service.getSnapshot('lease-chat', { bindingId: f.binding.bindingId }), /expired/)
})

test('settings switch stops renewal and best-effort detaches using the original client', async t => {
  const f = await leasedService(t)
  await f.service.saveServiceSettings({ ...f.settings, port: 18081 })
  assert.equal(f.timers[0].cleared, true)
  await f.service.detachTarget('lease-chat', { bindingId: f.binding.bindingId })
  assert.deepEqual(f.calls.filter(c => c[0] === 'detach'), [['detach', 'leased']])
  assert.equal(f.calls.filter(c => c[0] === 'renew').length, 0)
})

test('renew failure during diagnosis waits for in-flight evidence before observation cleanup', async t => {
  const f = await leasedService(t, async () => { throw Object.assign(new Error('lease expired'), { code: 'not_found' }) })
  let entered, release
  const entering = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  f.client.snapshot = async b => ({ ...b, readiness: { ready: true, reason_code: null }, telemetry_received_age_ms: '0', native_json_text: '{}' })
  f.client.read = async (b, action) => { f.calls.push(['read', action]); entered(); await gate; return { ...b, action, source_timestamp: null, received_age_ms: '0', native_json_text: ' {"partial":true}\n' } }
  const pending = f.service.diagnose('lease-chat', { bindingId: f.binding.bindingId })
  await entering
  await f.timers[0].tick()
  assert.equal(f.calls.filter(c => c[0] === 'detach').length, 0)
  release()
  const run = await pending
  assert.equal(run.complete, false)
  assert.equal(run.error.code, 'binding_stale')
  assert.equal(run.evidence[1].nativeJsonText, ' {"partial":true}\n')
  assert.equal(f.calls.filter(c => c[0] === 'read').length, 1)
  assert.deepEqual(f.calls.filter(c => c[0] === 'detach'), [['detach', 'leased']])
})

test('dispose waits for an in-flight renew, then detaches once without scheduling again', async t => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const f = await leasedService(t, async binding => { await gate; return binding })
  const renewing = f.timers[0].tick()
  const disposing = f.service.dispose()
  assert.equal(f.calls.filter(c => c[0] === 'detach').length, 0)
  release()
  await Promise.all([renewing, disposing])
  assert.equal(f.timers.length, 1)
  assert.deepEqual(f.calls.filter(c => c[0] === 'detach'), [['detach', 'leased']])
})

test('v2 without lease capability cannot fall back to a persistent binding', async t => {
  const f = await fixture(t); await f.manager.start()
  f.client.describe = async () => ({ protocol: f.record.protocol, api_version: 2, instance_id: f.record.instance_id, tool_version: f.record.tool_version, capabilities: ['instance_status', 'service_shutdown'] })
  f.client.targets = async () => assert.fail('must refuse before target access')
  const service = createFieldkitService(f.config, { owner: f.dependencies })
  await assert.rejects(service.listTargets('lease-chat'), /观察租约/)
})

test('HTTP unauthorized discovery gives actionable credential recovery without replacing credentials', async t => {
  const f = await fixture(t)
  await f.manager.save(f.settings); await f.publish()
  f.client.describe = async () => { throw Object.assign(new Error('unauthorized'), { code: 'unauthorized' }) }
  const result = await f.manager.status()
  assert.equal(result.error.code, 'unauthorized')
  assert.match(result.error.message, /dataDir/)
  assert.match(result.error.message, /0600/)
  assert.match(result.error.message, /勿覆盖/)
  assert.equal(f.calls.filter(c => c[0] === 'spawn').length, 0)
})
