import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const source = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
function action(name, context) {
  const start = source.indexOf(`  const ${name} = async`), end = source.indexOf(name === 'manageService' ? '\n  const openTarget' : '\n  useEffect(() => { void refresh()', start)
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
