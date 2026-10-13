import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
function mount(run, legacy = false) {
  const path = new URL('../src/client/Diagnostics.ts', import.meta.url), slots = [], cache = new Map()
  let cursor = 0, tree, downloads = 0
  const react = { createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat(Infinity).filter(v => v !== false && v !== null && v !== undefined) } }, useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }] }, useRef(value) { const i = cursor++; return slots[i] ??= { current: value } } }
  const load = name => {
    if (cache.has(name)) return cache.get(name)
    const output = { exports: {} }; cache.set(name, output.exports)
    const js = ts.transpileModule(readFileSync(new URL(name, path), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    vm.runInNewContext(js, { module: output, exports: output.exports, Blob, setTimeout() {}, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, document: { createElement: () => ({ click() { downloads++ } }) }, require: name => name === 'react' ? react : load(name.replace(/\.js$/, '.ts')) })
    return output.exports
  }
  const component = load('./Diagnostics.ts'), props = { readRun: run, legacy, sessionId: 's', remote: { downloadReport: async () => ({ ok: true, value: { filename: 'report.json', mime: 'application/json', content: '{}' } }) } }
  const render = () => { cursor = 0; tree = component.Diagnostics(props) }
  const nodes = () => { const all = []; const visit = n => { if (!n || typeof n !== 'object') return; all.push(n); n.children?.forEach(visit) }; visit(tree); return all }
  render(); return { props, render, nodes, labels: () => nodes().filter(n => n.type === 'li').map(n => n.children.join('')), downloads: () => downloads }
}
const base = { readRunId: 'r', status: 'incomplete', phase: 'finished', step: 'diagnostics', evidence: [{ action: 'connection_identity' }, { action: 'status' }, { action: 'measurements' }, { action: 'diagnostics', error: { code: 'read_failed', message: 'failed' } }], error: { code: 'read_failed', action: 'diagnostics', message: 'failed' }, reports: { json: 'registered', markdown: 'registered' } }
test('diagnostic failure is not acquired, and first-error-stopped steps are not waiting', () => {
  const labels = mount(base).labels()
  assert.equal(labels[0], '已取得：连接与身份'); assert.equal(labels[3], '失败：diagnostics')
  assert.match(labels[4], /^未执行/); assert.match(labels[5], /^未执行/)
})
test('legacy exit and parse failures are failed steps, with correct config view identity', () => {
  for (const failure of [{ exitCode: 1 }, { parseError: 'invalid JSON' }]) {
    const labels = mount({ ...base, step: 'config-read', error: { code: 'process_failed', action: 'config-read' }, evidence: [{ action: 'inspect' }, { action: 'status' }, { action: 'measurements' }, { action: 'diagnostics' }, { action: 'config-read', ...failure }] }, true).labels()
    assert.equal(labels[4], '失败：config-read --view startup'); assert.match(labels[5], /^未执行/)
  }
})
test('running step is distinct and cancellation does not relabel acquired previous evidence as failed', () => {
  const running = mount({ ...base, status: 'running', phase: 'reading', step: 'diagnostics', evidence: base.evidence.slice(0, 3), error: null }).labels()
  assert.equal(running[3], '进行中：diagnostics'); assert.match(running[4], /^等待/)
  const cancelled = mount({ ...base, step: 'measurements', evidence: base.evidence.slice(0, 3), error: { code: 'cancelled', action: 'measurements', message: 'cancelled' } }).labels()
  assert.equal(cancelled[2], '已取得：measurements'); assert.match(cancelled[3], /^未执行/)
})
test('partial report download notice describes file handoff without claiming complete acquisition', async () => {
  const ui = mount(base)
  await ui.nodes().find(n => n.type === 'button' && n.children.includes('下载 JSON 报告')).props.onClick(); ui.render()
  assert.equal(ui.downloads(), 1)
  const notice = ui.nodes().filter(n => n.props.role === 'status').map(n => n.children.join('')).join('')
  assert.match(notice, /采集完整性请查看报告/); assert.doesNotMatch(notice, /完整报告|采集完成/)
})

for (const change of [{ readRunId: 'new-can-run', targetId: 'can:7' }, { targetId: 'can:7' }, { instanceId: 'new-instance' }]) test(`report download notice belongs only to its current run scope ${JSON.stringify(change)}`, async () => {
  const ui = mount(base)
  await ui.nodes().find(n => n.type === 'button' && n.children.includes('下载 JSON 报告')).props.onClick(); ui.render()
  ui.props.readRun = { ...base, ...change }; ui.render()
  assert.equal(ui.nodes().filter(n => n.props.role === 'status').length, 0)
  assert.equal(ui.downloads(), 1)
})

for (const failed of [false, true]) test(`late old download ${failed ? 'failure' : 'handoff'} cannot overwrite a newer run download state`, async () => {
  let release
  const ui = mount(base)
  ui.props.remote.downloadReport = async () => new Promise(resolve => { release = () => resolve(failed ? { ok: false, error: { message: 'old download failed' } } : { ok: true, value: { filename: 'old.json', mime: 'application/json', content: '{}' } }) })
  const old = ui.nodes().find(n => n.type === 'button' && n.children.includes('下载 JSON 报告')).props.onClick(); ui.render()
  ui.props.readRun = { ...base, readRunId: 'new-can-run', targetId: 'can:7' }; ui.render()
  assert.equal(ui.nodes().find(n => n.type === 'button').props.disabled, false)
  release(); await old; ui.render()
  assert.equal(ui.nodes().filter(n => n.props.role === 'status').length, 0)
  assert.equal(ui.downloads(), failed ? 0 : 1)
})

test('an old download completion cannot release the newer run download in progress', async () => {
  const releases = []
  const ui = mount(base)
  ui.props.remote.downloadReport = async (_, request) => new Promise(resolve => { releases.push(() => resolve({ ok: true, value: { filename: `${request.readRunId}.json`, mime: 'application/json', content: request.readRunId } })) })
  const click = () => ui.nodes().find(n => n.type === 'button' && n.children.includes('下载 JSON 报告')).props.onClick()
  const old = click(); ui.render()
  ui.props.readRun = { ...base, readRunId: 'new-can-run', targetId: 'can:7' }; ui.render()
  const current = click(); ui.render()
  releases[0](); await old; ui.render()
  assert.equal(ui.nodes().find(n => n.type === 'button').props.disabled, true)
  assert.equal(ui.nodes().filter(n => n.props.role === 'status').length, 0)
  releases[1](); await current; ui.render()
  assert.equal(ui.nodes().find(n => n.type === 'button').props.disabled, false)
  assert.equal(ui.nodes().filter(n => n.props.role === 'status').length, 1)
  assert.equal(ui.downloads(), 2)
})
