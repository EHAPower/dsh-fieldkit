import test from 'node:test'
import assert from 'node:assert/strict'
import { createFieldkitService } from '../src/service.js'

const identity = { uid: 'aaaaaaaaaaaaaaaaaaaaaaaa', run_nonce: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }
const target = { target_id: 'usb:USB-0001', transport: 'usb', connected: true, identity, connection_generation: '9007199254740993', can_attach: true, can_connect: false }
const binding = { protocol: 'eha-tool.integration.v1', instance_id: 'instance-a', binding_id: 'owner-binding-a', target_id: target.target_id, connection_generation: target.connection_generation, identity }
function setup({ failAction, readImpl, mode = 'integration' } = {}) {
  const calls = [], saved = []
  let nextBinding = 0
  const integration = {
    async describe() { calls.push('describe'); return { protocol: binding.protocol, instance_id: binding.instance_id, tool_version: '0.3.0', capabilities: ['targets', 'binding_attach', 'usb_connect', 'snapshot', 'read_status', 'read_measurements', 'read_diagnostics', 'read_config_startup', 'read_config_user'] } },
    async targets() { calls.push('targets'); return { instance_id: binding.instance_id, discovery_limited: false, discovery_reason: null, targets: [target, { ...target, target_id: 'usb:USB-0002' }] } },
    async bind(request) { calls.push(['bind', request]); return { ...binding, target_id: request.target_id, binding_id: 'owner-binding-' + ++nextBinding } },
    async snapshot(b) { calls.push(['snapshot', b.binding_id]); return { ...b, readiness: { ready: true, reason_code: null }, telemetry_received_age_ms: '0', native_json_text: ' {"identity":"connection evidence"}\n' } },
    async read(b, action) { calls.push(['read', b.binding_id, action]); if (readImpl) return readImpl(b, action); if (action === failAction) throw Object.assign(new Error('synthetic refusal'), { code: 'read_not_ready', nativeErrorJsonText: '{"reason":"control active"}' }); return { ...b, action, source_timestamp: { clock: 'device_monotonic_us', value: '18446744073709551615' }, received_age_ms: '0', native_json_text: ' {"clock":18446744073709551615}\n', ...(action.startsWith('config_') ? { data_utf8: '{ "original": true }\n', data_hex: '7b7d' } : {}) } },
    async detach(b) { calls.push(['detach', b.binding_id]); return null },
  }
  const cli = { async devices() { calls.push('cli devices'); return [{ serial: 'USB-0001' }] }, async diagnoseUsb(serial) { calls.push(['cli diagnose', serial]); return { serial, complete: true, status: 'complete', identity: { uid: identity.uid, runNonce: identity.run_nonce }, evidence: [], error: null } }, async checkConfiguration(text) { calls.push(['config-check', text]); return { exitCode: 0, stdout: 'validated', stderr: '', error: null } } }
  const service = createFieldkitService({ deviceMode: mode, integrationUrl: 'http://127.0.0.1:18080', integrationTokenFile: '/tmp/synthetic-token', toolPath: '/tmp/synthetic-tool', reportsDir: '/tmp/synthetic-reports' }, { integration, cli, reportWriter: async (_dir, run) => { saved.push(structuredClone(run)); return { markdown: '/tmp/report-' + run.readRunId + '.md', json: '/tmp/report-' + run.readRunId + '.json' } } })
  return { service, calls, saved, integration, cli }
}
async function select(service, session = 'chat-a', targetId = target.target_id) { await service.listTargets(session); return service.openTarget(session, { targetId, intent: 'attach', expectedIdentity: { uid: identity.uid, runNonce: identity.run_nonce }, connectionGeneration: target.connection_generation }) }

test('same service runs six integration steps and gives reports only to the owning chat', async () => {
  const { service, calls, saved } = setup()
  const selected = await select(service)
  const run = await service.diagnose('chat-a', { bindingId: selected.bindingId })
  assert.equal(run.complete, true)
  assert.deepEqual(run.evidence.map(e => e.action), ['connection_identity', 'status', 'measurements', 'diagnostics', 'config_startup', 'config_user'])
  assert.equal(run.evidence[1].sourceTimestamp.value, '18446744073709551615')
  assert.equal(saved[0].evidence[1].nativeJsonText, ' {"clock":18446744073709551615}\n')
  assert.equal(service.hasReport('chat-a', run.reports.json), true)
  assert.equal(service.hasReport('chat-b', run.reports.json), false)
  await assert.rejects(service.getReadRun('chat-b', { readRunId: run.readRunId }), /session/)
  await assert.rejects(service.diagnose('chat-b', { bindingId: selected.bindingId }), /selected binding/)
  assert.ok(!calls.includes('cli devices'))
})

test('first read failure keeps prefix and native failure evidence without fallback', async () => {
  const { service, calls, saved } = setup({ failAction: 'diagnostics' })
  const selected = await select(service)
  const run = await service.diagnose('chat-a', { bindingId: selected.bindingId })
  assert.equal(run.status, 'incomplete')
  assert.equal(run.error.code, 'read_not_ready')
  assert.equal(run.evidence.at(-1).nativeJsonText, '{"reason":"control active"}')
  assert.deepEqual(calls.filter(c => Array.isArray(c) && c[0] === 'read').map(c => c[2]), ['status', 'measurements', 'diagnostics'])
  assert.equal(saved.length, 1)
  assert.ok(!calls.some(c => Array.isArray(c) && c[0] === 'cli diagnose'))
})

test('run keeps immutable original binding while selection changes, exposes progress, and refuses old-view replay', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  let entered
  const firstRead = new Promise(resolve => { entered = resolve })
  const { service, calls } = setup({ readImpl: async (b, action) => { if (action === 'status') { entered(); await gate } return { ...b, action, source_timestamp: null, received_age_ms: '0', native_json_text: '{}' } } })
  const original = await select(service)
  const pending = service.diagnose('chat-a', { bindingId: original.bindingId })
  await firstRead
  assert.equal((await service.getReadRun('chat-a')).status, 'running')
  await assert.rejects(service.diagnose('chat-a', { bindingId: original.bindingId }), /running/)
  const switching = select(service, 'chat-a', 'usb:USB-0002')
  release()
  const newer = await switching
  await assert.rejects(service.diagnose('chat-a', { bindingId: original.bindingId }), /selected binding/)
  const run = await pending
  assert.equal(run.status, 'incomplete')
  assert.equal(run.error.code, 'cancelled')
  assert.equal(run.bindingId, original.bindingId)
  assert.equal(run.targetId, 'usb:USB-0001')
  assert.notEqual(newer.bindingId, original.bindingId)
  const readBindings = calls.filter(c => Array.isArray(c) && c[0] === 'read').map(c => c[1])
  assert.deepEqual(new Set(readBindings), new Set(['owner-binding-1']))
})

test('detach removes only observation; stale instance/identity ends diagnosis and offline config preserves supplied text', async () => {
  const { service, calls, integration } = setup()
  const selected = await select(service)
  integration.read = async b => { throw Object.assign(new Error('owner restarted'), { code: 'instance_mismatch' }) }
  const run = await service.diagnose('chat-a', { bindingId: selected.bindingId })
  assert.equal(run.complete, false)
  assert.equal(run.error.code, 'instance_mismatch')
  await assert.rejects(service.getSnapshot('chat-a', { bindingId: selected.bindingId }), /expired/)
  const text = '{ "counter": 18446744073709551615 }\n'
  await service.checkConfiguration(text)
  assert.ok(calls.some(c => Array.isArray(c) && c[0] === 'config-check' && c[1] === text))
  const other = await select(service, 'chat-b')
  await service.detachTarget('chat-b', { bindingId: other.bindingId })
  assert.ok(calls.some(c => Array.isArray(c) && c[0] === 'detach'))
  assert.ok(!calls.some(c => Array.isArray(c) && ['disconnect', 'stop'].includes(c[0])))
})

test('explicit legacy mode uses existing CLI and integration failure never invokes CLI', async () => {
  const legacy = setup({ mode: 'legacy-cli' })
  await legacy.service.listTargets('chat-a')
  const selected = await legacy.service.openTarget('chat-a', { targetId: 'USB-0001', intent: 'connect' })
  await legacy.service.diagnose('chat-a', { bindingId: selected.bindingId })
  assert.ok(legacy.calls.some(c => Array.isArray(c) && c[0] === 'cli diagnose'))
  const current = setup()
  current.integration.targets = async () => { throw new Error('integration unavailable') }
  await assert.rejects(current.service.listTargets('chat-a'), /integration unavailable/)
  assert.ok(!current.calls.includes('cli devices'))
  await assert.rejects(current.service.listTargets(''), /session/)
})

test('cancellation waits for the in-flight read and prevents remaining steps', async () => {
  let release, entered
  const gate = new Promise(resolve => { release = resolve })
  const firstRead = new Promise(resolve => { entered = resolve })
  const { service, calls } = setup({ readImpl: async (b, action) => { entered(); await gate; return { ...b, action, source_timestamp: null, received_age_ms: '0', native_json_text: '{"kept":true}' } } })
  const selected = await select(service)
  const pending = service.diagnose('chat-a', { bindingId: selected.bindingId })
  await firstRead
  const current = await service.getReadRun('chat-a')
  await service.cancelReadRun('chat-a', { readRunId: current.readRunId })
  release()
  const run = await pending
  assert.equal(run.status, 'incomplete')
  assert.equal(run.error.code, 'cancelled')
  assert.deepEqual(run.evidence.map(e => e.action), ['connection_identity', 'status'])
  assert.equal(calls.filter(c => Array.isArray(c) && c[0] === 'read').length, 1)
})

test('diagnosis is exclusive across chats and different targets, and repeated selection releases owner refs', async () => {
  let release, entered
  const gate = new Promise(resolve => { release = resolve })
  const firstRead = new Promise(resolve => { entered = resolve })
  const { service, integration } = setup({ readImpl: async (b, action) => { if (action === 'status') { entered(); await gate } return { ...b, action, source_timestamp: null, received_age_ms: '0', native_json_text: '{}' } } })
  const a = await select(service, 'chat-a')
  const b = await select(service, 'chat-b', 'usb:USB-0002')
  const pending = service.diagnose('chat-a', { bindingId: a.bindingId })
  await firstRead
  await assert.rejects(service.diagnose('chat-b', { bindingId: b.bindingId }), /already running/)
  release(); await pending
  const activeRefs = new Set()
  const originalBind = integration.bind
  integration.bind = async request => { if (activeRefs.size === 8) throw new Error('owner binding limit'); const value = await originalBind(request); activeRefs.add(value.binding_id); return value }
  integration.detach = async value => { activeRefs.delete(value.binding_id) }
  for (let i = 0; i < 12; i++) await select(service, 'chat-c', i % 2 ? 'usb:USB-0002' : 'usb:USB-0001')
  assert.equal(activeRefs.size, 1)
})

test('failed observation cleanup does not hide a successful new selection and is retried on explicit next selection', async () => {
  const { service, integration } = setup()
  const original = await select(service)
  let failDelete = true
  integration.detach = async () => { if (failDelete) throw Object.assign(new Error('temporary cleanup failure'), { code: 'backend_error' }) }
  const replacement = await select(service, 'chat-a', 'usb:USB-0002')
  assert.equal(service.selectedBinding('chat-a').bindingId, replacement.bindingId)
  assert.equal(replacement.observationWarnings[0].code, 'backend_error')
  await assert.rejects(service.getSnapshot('chat-a', { bindingId: original.bindingId }), /selected binding/)
  failDelete = false
  const final = await select(service)
  assert.equal(final.observationWarnings.length, 0)
})

test('dispose stops later steps, waits for in-flight evidence, and revokes only owned observation refs', async () => {
  let release, entered
  const gate = new Promise(resolve => { release = resolve })
  const firstRead = new Promise(resolve => { entered = resolve })
  const { service, calls } = setup({ readImpl: async (b, action) => { entered(); await gate; return { ...b, action, source_timestamp: null, received_age_ms: '0', native_json_text: '{"finished":true}' } } })
  const selected = await select(service)
  const pending = service.diagnose('chat-a', { bindingId: selected.bindingId })
  await firstRead
  const disposal = service.dispose()
  await assert.rejects(service.listTargets('chat-b'), /disposed/)
  release()
  const run = await pending
  assert.equal(run.status, 'incomplete')
  assert.equal(run.evidence.at(-1).nativeJsonText, '{"finished":true}')
  assert.equal((await disposal).disposed, true)
  assert.equal(calls.filter(c => Array.isArray(c) && c[0] === 'detach').length, 1)
  assert.ok(!calls.some(c => Array.isArray(c) && ['disconnect', 'stop'].includes(c[0])))
})

test('dispose also waits for an in-flight connect and revokes its late returned binding', async () => {
  const { service, integration, calls } = setup()
  await service.listTargets('chat-a')
  let finishBind, entered
  const bindGate = new Promise(resolve => { finishBind = resolve })
  const started = new Promise(resolve => { entered = resolve })
  integration.bind = async () => { entered(); await bindGate; return binding }
  const pending = service.openTarget('chat-a', { targetId: target.target_id, intent: 'attach', expectedIdentity: { uid: identity.uid, runNonce: identity.run_nonce }, connectionGeneration: target.connection_generation })
  await started
  let completed = false
  const disposal = service.dispose().then(result => { completed = true; return result })
  await Promise.resolve()
  assert.equal(completed, false)
  finishBind()
  await assert.rejects(pending, /newer target selection/)
  await disposal
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'detach' && call[1] === binding.binding_id))
})

test('concurrent selections serialize owner connect and revoke the superseded late binding', async () => {
  const { service, integration, calls } = setup()
  await service.listTargets('chat-a')
  let finishBind, entered
  const gate = new Promise(resolve => { finishBind = resolve })
  const firstBind = new Promise(resolve => { entered = resolve })
  const originalBind = integration.bind
  let count = 0
  integration.bind = async request => { count++; if (count === 1) { entered(); await gate } return originalBind(request) }
  const request = { targetId: target.target_id, intent: 'attach', expectedIdentity: { uid: identity.uid, runNonce: identity.run_nonce }, connectionGeneration: target.connection_generation }
  const first = service.openTarget('chat-a', request)
  await firstBind
  const second = service.openTarget('chat-a', { ...request, targetId: 'usb:USB-0002' })
  await Promise.resolve()
  assert.equal(count, 1)
  finishBind()
  await assert.rejects(first, /newer target selection/)
  const selected = await second
  assert.equal(selected.targetId, 'usb:USB-0002')
  assert.equal(service.selectedBinding('chat-a').bindingId, selected.bindingId)
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'detach' && call[1] === 'owner-binding-1'))
})

test('legacy omits USB candidates without a full serial instead of coercing null into a target', async () => {
  const { service, cli } = setup({ mode: 'legacy-cli' })
  cli.devices = async () => [{ serial: null, description: 'unidentified USB device' }, { serial: 'USB-0001', description: 'identified fixture' }]
  const list = await service.listTargets('chat-a')
  assert.deepEqual(list.targets.map(target => target.targetId), ['USB-0001'])
  assert.equal(list.discoveryLimited, true)
  assert.match(list.discoveryReason, /without a full serial/)
  await assert.rejects(service.openTarget('chat-a', { targetId: 'null', intent: 'connect' }), /select a target/)
})
