import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const source = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
const shared = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/client/shared.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: shared, exports: shared.exports })
async function invoke(name, code) {
  const binding = { bindingId: 'b', expired: false }, ref = { current: binding }, notices = []
  const remote = { describe: async () => ({ ok: true, value: { available: true, mode: 'integration' } }), listTargets: async () => ({ ok: true, value: { targets: [], selectedBinding: binding } }), getSnapshot: async () => ({ ok: false, error: { code: 'fieldkit/service', details: { code }, message: 'synthetic mismatch' } }) }
  const start = source.indexOf(`  const ${name} = async`), end = source.indexOf(name === 'refresh' ? '\n  useEffect(() => { void refresh()' : '\n  const diagnose = async', start)
  const context = { ...shared.exports, remote, bindingRef: ref, sessionId: 's', begin: () => true, end() {}, invalidate: () => 0, current: () => true, epoch: { current: 0 }, setDescribe() {}, setServiceStatus() {}, setServiceSettings() {}, setTargets() {}, setDiscovery() {}, setSnapshot() {}, setReadRun() {}, setNotice: v => notices.push(v), selectBinding: v => { ref.current = v }, readRun: null }
  const js = ts.transpileModule(`${source.slice(start, end)}\nglobalThis.action=${name}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(js, context); await context.action()
  return { binding: ref.current, notice: notices.join(' ') }
}
for (const name of ['readSnapshot', 'refresh']) test(`${name} expires only trusted identity/instance errors and explains explicit reselection`, async () => {
  for (const code of ['identity_changed', 'binding_stale', 'not_found', 'instance_mismatch']) {
    const result = await invoke(name, code)
    assert.equal(result.binding.expired, true, code); assert.match(result.notice, /重新选择目标/)
  }
  const ordinary = await invoke(name, 'sdk_timeout')
  assert.equal(ordinary.binding.expired, false); assert.doesNotMatch(ordinary.notice, /观察已过期/)
})
test('successful open followed by trusted snapshot identity error expires the newly selected binding', async () => {
  for (const code of ['identity_changed', 'binding_stale', 'sdk_timeout']) {
    const next = { bindingId: 'new', expired: false }, ref = { current: null }, notices = []
    const remote = { openTarget: async () => ({ ok: true, value: next }), listTargets: async () => ({ ok: true, value: { targets: [], selectedBinding: next } }), getSnapshot: async () => ({ ok: false, error: { code: 'fieldkit/service', details: { code }, message: 'synthetic mismatch' } }) }
    const start = source.indexOf('  const openTarget = async'), end = source.indexOf('\n  const detach = async', start)
    const context = { ...shared.exports, remote, sessionId: 's', begin: () => true, end() {}, invalidate: () => 0, current: () => true, bindingRef: ref, takeOpenedBinding: promise => promise, setTargets() {}, setSnapshot() {}, setReadRun() {}, describe: null, selectBinding: value => { ref.current = value }, setNotice: value => notices.push(value) }
    vm.runInNewContext(ts.transpileModule(`${source.slice(start, end)}\nglobalThis.action=openTarget`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
    await context.action({ targetId: 'usb', label: 'USB', connected: false })
    assert.equal(ref.current.expired, code !== 'sdk_timeout')
    if (code !== 'sdk_timeout') assert.match(notices.join(' '), /重新选择目标/)
  }
})
