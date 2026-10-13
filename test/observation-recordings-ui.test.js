import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
function mount(component, props) {
  const path = new URL(`../src/client/${component}.ts`, import.meta.url), slots = [], effects = [], timers = [], cache = new Map()
  let cursor = 0, initial = true, tree
  const react = { createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat(Infinity).filter(v => v !== false && v !== null && v !== undefined) } }, useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }] }, useRef(value) { const i = cursor++; return slots[i] ??= { current: value } }, useEffect(effect) { if (initial) effects.push(effect) } }
  const load = name => {
    if (cache.has(name)) return cache.get(name)
    const output = { exports: {} }; cache.set(name, output.exports)
    const js = ts.transpileModule(readFileSync(new URL(name, path), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    vm.runInNewContext(js, { module: output, exports: output.exports, setTimeout: fn => { timers.push(fn); return timers.length }, clearTimeout() {}, setInterval() { return 0 }, clearInterval() {}, Blob, URL, require: name => name === 'react' ? react : name.startsWith('echarts') ? { use() {} } : load(name === './event-history.js' ? name : name.replace(/\.js$/, '.ts')) })
    return output.exports
  }
  const module = load(`./${component}.ts`), render = () => { cursor = 0; tree = module[component](props); initial = false }
  const nodes = () => { const values = []; const visit = n => { if (!n || typeof n !== 'object') return; values.push(n); n.children?.forEach(visit) }; visit(tree); return values }
  render(); effects.forEach(effect => effect())
  return { render, nodes, timers, button: label => nodes().find(n => n.type === 'button' && n.children.includes(label)) }
}
const flush = () => new Promise(resolve => setImmediate(resolve))
test('event gap retries actual cache refresh after busy, then clears pending refresh on success', async () => {
  let busy = true, snapshotRequests = 0, events = 0
  const binding = { bindingId: 'b', targetId: 'usb:1', connectionGeneration: '1', identity: { uid: 'a', runNonce: 'b' }, expired: false }
  const remote = { getSnapshot: async () => { snapshotRequests++; return { ok: true, value: { nativeJsonText: '{}' } } }, getEvents: async () => ({ ok: true, value: { cursor: String(++events), gap: events === 1, gapReasons: events === 1 ? ['cache_loss'] : [], lostRanges: [], events: [] } }) }
  const source = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
  const part = source.slice(source.indexOf('  const readSnapshot = async'), source.indexOf('  const diagnose = async'))
  const js = ts.transpileModule(`${part}\nglobalThis.callback = readSnapshot`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const context = { bindingRef: { current: binding }, sessionId: 's', begin: () => !busy, epoch: { current: 0 }, remote, valueOf: v => v.value, current: () => true, setSnapshot() {}, setReadRun() {}, setNotice() {}, selectBinding() {}, end() {}, readRun: null }
  vm.runInNewContext(js, context)
  const ui = mount('Observation', { remote, sessionId: 's', binding, enabled: true, visible: true, onGap: context.callback })
  await flush(); assert.equal(snapshotRequests, 0)
  busy = false; await ui.timers.shift()(); await flush()
  assert.equal(snapshotRequests, 1, 'busy gap must be recovered even when the next batch has no gap')
  await ui.timers.shift()(); await flush()
  assert.equal(snapshotRequests, 1, 'successful refresh must clear pending work')
})
test('recordings truncated remains visible after generic task completion, including metadata budget truncation', async () => {
  const ui = mount('Recordings', { remote: { listRecordings: async () => ({ ok: true, value: { jobId: 'j', kind: 'recordings', state: 'completed', error: null, recordings: [], truncated: true } }) }, sessionId: 's', capabilities: ['recordings_read'] })
  await ui.button('刷新记录历史').props.onClick(); ui.render()
  const rendered = JSON.stringify(ui.nodes().map(n => n.children))
  assert.match(rendered, /截断/)
  assert.match(rendered, /元数据/)
})
test('expired observation retains historical evidence but never claims active drawing or polls', async () => {
  let requests = 0
  const ui = mount('Observation', { remote: { getEvents: async () => { requests++ } }, sessionId: 's', binding: { bindingId: 'b', expired: true }, enabled: true, visible: true, onGap() {} })
  await flush(); ui.render()
  const rendered = JSON.stringify(ui.nodes().map(n => n.children))
  assert.match(rendered, /绑定已过期，所示为历史数据/); assert.doesNotMatch(rendered, /绘制中。/)
  assert.equal(requests, 0); assert.equal(ui.button('暂停绘制').props.disabled, true)
})
