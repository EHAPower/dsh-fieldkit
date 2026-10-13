import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const source = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
function action(name, context) {
  const start = source.indexOf(`  const ${name} = async`), end = source.indexOf(name === 'manageService' ? '\n  const openTarget' : name === 'openTarget' ? '\n  const detach' : '\n  useEffect(() => { void refresh()', start)
  vm.runInNewContext(ts.transpileModule(`${source.slice(start, end)}\nglobalThis.action=${name}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return context.action
}
function context(remote) { const state = { binding: { bindingId: 'old', expired: false } }; return { state, remote, sessionId: 's', serviceSettings: {}, serviceStatus: {}, shutdownConfirmed: false, bindingRef: { current: state.binding }, begin: () => true, end() {}, invalidate: () => 1, current: () => true, valueOf: v => v.value, text: String, errorText: e => e.message, isExpiredBindingError: () => false, setDescribe: v => { state.description = typeof v === 'function' ? v(state.description) : v }, setServiceStatus: v => { state.status = v }, setServiceSettings() {}, setShutdownConfirmed() {}, setTargets: v => { state.targets = v }, setSnapshot() {}, setReadRun() {}, setDiscovery() {}, selectBinding: v => { state.binding = v }, setNotice: v => { state.notice = v } } }
test('service start refreshes new instance capabilities and targets without a second manual refresh', async () => {
  const c = context({ startService: async () => ({ value: { settings: {}, instance: { instance_id: 'B' } } }), describe: async () => ({ value: { mode: 'service-v2', instanceId: 'B', available: true, capabilities: ['managed_profiles'] } }), listTargets: async () => ({ value: { targets: [{ targetId: 'B' }], selectedBinding: null } }), serviceStatus: async () => ({ value: { instance: { instance_id: 'B' }, settings: {} } }) })
  await action('manageService', c)('start')
  assert.equal(c.state.description.instanceId, 'B'); assert.deepEqual(c.state.description.capabilities, ['managed_profiles']); assert.equal(c.state.targets[0].targetId, 'B'); assert.equal(c.state.binding, null)
})
test('target refresh obtains service overview after discovery updates a passively disconnected connection', async () => {
  let connected = true
  const c = context({ describe: async () => ({ value: { mode: 'service-v2', available: true } }), listTargets: async () => { connected = false; return { value: { targets: [{ connected: false }], selectedBinding: null } } }, serviceStatus: async () => ({ value: { settings: {}, connected } }) })
  await action('refresh', c)()
  assert.equal(c.state.status.connected, false); assert.equal(c.state.targets[0].connected, false)
})

test('explicit shutdown retains configured service mode and restart settings while clearing live capabilities', async () => {
  const c = context({ shutdownService: async () => ({ value: { settings: {}, attached: false } }) })
  c.state.description = { mode: 'service-v2', available: true, capabilities: ['maintenance'], instanceId: 'old' }
  await action('manageService', c)('shutdown')
  assert.equal(c.state.description.mode, 'service-v2'); assert.equal(c.state.description.available, false)
  assert.equal(c.state.description.capabilities.length, 0); assert.equal(c.state.description.instanceId, null)
  assert.match(source, /serviceSettings !== null\) && React.createElement\(ServiceSettings/)
})

for (const step of ['describe', 'serviceStatus', 'listTargets']) test(`refresh invalidates instance authority only when ${step} is authentication`, async () => {
  const description = { mode: 'service-v2', available: true, instanceId: 'A', capabilities: [] }
  const remote = { describe: async () => ({ value: description }), serviceStatus: async () => ({ value: { attached: true, instance: { instance_id: 'A', service_state: 'running' } } }), listTargets: async () => ({ value: { targets: [], selectedBinding: null } }) }
  remote[step] = async () => { throw new Error('sdk_timeout') }
  const c = context(remote); c.state.description = description
  await action('refresh', c)()
  assert.equal(c.state.description.available, step === 'listTargets')
  assert.equal(c.state.description.instanceId, step === 'listTargets' ? 'A' : null)
})
test('lost shutdown response revokes current instance before awaiting the lifecycle operation and keeps settings', async () => {
  let release
  const c = context({ shutdownService: async () => new Promise((_, reject) => { release = () => reject(new Error('reply lost')) }) })
  c.state.description = { mode: 'service-v2', available: true, instanceId: 'A', capabilities: [] }
  const pending = action('manageService', c)('shutdown')
  assert.equal(c.state.description.available, false)
  release(); await pending
  assert.equal(c.state.description.instanceId, null); assert.equal(c.state.description.mode, 'service-v2')
})

test('post-selection service authentication failure revokes authority for thrown and resolved Remote errors', async () => {
  for (const resolved of [false, true]) {
    const binding = { bindingId: 'new', expired: false }
    const c = context({ openTarget: async () => ({ value: binding }), listTargets: async () => ({ value: { targets: [], selectedBinding: binding } }), getSnapshot: async () => ({ value: {} }), serviceStatus: async () => { if (resolved) return { error: new Error('unauthorized') }; throw new Error('sdk_timeout') } })
    c.state.description = { mode: 'service-v2', available: true, instanceId: 'A' }; c.describe = c.state.description
    c.takeOpenedBinding = promise => promise; c.valueOf = value => { if (value.error) throw value.error; return value.value }
    await action('openTarget', c)({ targetId: 'usb', connected: true })
    assert.equal(c.state.description.available, false); assert.equal(c.state.description.instanceId, null)
  }
})

test('explicit service overview refresh reads only instance metadata and clears stale shutdown confirmation', async () => {
  let reads = 0, confirmation = true
  const c = context({ serviceStatus: async () => { reads++; return { value: { settings: {}, attached: true, instance: { instance_id: 'A', sessions: [{ heartbeat_active: true, recording_active: true }] } } } } })
  c.setShutdownConfirmed = value => { confirmation = value }
  const start = source.indexOf('  const refreshServiceStatus = async'), end = source.indexOf('\n  const manageService', start)
  assert.ok(start >= 0)
  vm.runInNewContext(ts.transpileModule(`${source.slice(start, end)}\nglobalThis.action=refreshServiceStatus`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, c)
  await c.action()
  assert.equal(reads, 1); assert.equal(confirmation, false)
  assert.equal(c.state.status.instance.sessions[0].heartbeat_active, true)
  c.remote.serviceStatus = async () => { throw new Error('sdk_timeout') }; c.state.description = { available: true, instanceId: 'A' }
  await c.action(); assert.equal(c.state.description.available, false); assert.equal(c.state.description.instanceId, null)
})

test('service overview visibly names a received snapshot and exposes an explicit metadata refresh', () => {
  const module = { exports: {} }, calls = []
  const react = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter(Boolean) }), useRef: value => ({ current: value }) }
  const source = readFileSync(new URL('../src/client/ServiceSettings.ts', import.meta.url), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, { module, exports: module.exports, require: name => name === 'react' ? react : { text: String, errorText: String, panelStyles: () => ({}) } })
  const tree = module.exports.ServiceSettings({ serviceStatus: { instance: { service_state: 'running', tool_version: 'tool', instance_id: 'i', pid: '1', control_effect: { state: 'unknown' }, activity: {}, sessions: [] } }, serviceSettings: {}, busy: false, refreshServiceStatus: () => calls.push('metadata') })
  const nodes = []; const visit = node => { if (!node || typeof node !== 'object') return; nodes.push(node); node.children?.forEach(visit) }; visit(tree)
  assert.match(JSON.stringify(tree), /上次概要（非实时）/); assert.match(JSON.stringify(tree), /本页收到时刻/)
  nodes.find(node => node.type === 'button' && node.children.includes('刷新服务概要')).props.onClick()
  assert.deepEqual(calls, ['metadata'])
})
