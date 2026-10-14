import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const path = new URL('../src/client/fieldkit-sessions.ts', import.meta.url)
function storage() { const map = new Map(); return { get length() { return map.size }, key: i => [...map.keys()][i] ?? null, getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) } }
function load(localStorage = storage(), sessionStorage = storage()) {
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module, exports: module.exports, localStorage, sessionStorage, setTimeout, clearTimeout })
  return { ...module.exports, localStorage, sessionStorage }
}
function official(ids = []) {
  const calls = []; const sessions = { ids, calls, list: { getSnapshot: () => ({ phase: 'ready', ids: [...sessions.ids] }), subscribe: () => () => {} }, refresh: async () => calls.push('refresh'), create: async () => { calls.push('create'); const id = `new-${sessions.ids.length}`; sessions.ids.push(id); return id } }
  return sessions
}
test('new tab remains isolated; explicit catalog-validated return recovers only Fieldkit evidence sessions', async () => {
  const x = load(); x.localStorage.setItem('eha-fieldkit.ui-pending.v1:old', JSON.stringify({ sessionId: 'old-empty', action: 'position' }))
  x.localStorage.setItem('eha-fieldkit.received-history.v1:old', JSON.stringify({ sessionId: 'old-received', record: {} }))
  x.localStorage.setItem('unrelated', JSON.stringify({ sessionId: 'ordinary-chat' }))
  const sessions = official(['old-empty', 'old-received', 'ordinary-chat']); const manager = x.createFieldkitSessions()
  const current = await manager.ensure(sessions); assert.match(current, /^new-/)
  const list = await manager.list(sessions)
  assert.deepEqual(Array.from(list.items, i => i.id).sort(), [current, 'old-empty', 'old-received'].sort())
  await manager.select(sessions, 'old-empty'); assert.equal(await manager.ensure(sessions), 'old-empty')
  assert.equal(x.sessionStorage.getItem(x.SESSION_STORAGE_KEY), 'old-empty')
  assert.equal(sessions.calls.filter(x => x === 'create').length, 1)
})
test('arbitrary IDs and catalog-deleted stale choices cannot replace the active session', async () => {
  const x = load(); const sessions = official(['ordinary']); const manager = x.createFieldkitSessions(); const current = await manager.ensure(sessions)
  await assert.rejects(manager.select(sessions, 'ordinary'), /Fieldkit/)
  x.localStorage.setItem('eha-fieldkit.ui-pending.v1:stale', JSON.stringify({ sessionId: 'deleted' }))
  sessions.ids.push('deleted'); assert.ok((await manager.list(sessions)).items.some(i => i.id === 'deleted'))
  sessions.ids = sessions.ids.filter(i => i !== 'deleted')
  await assert.rejects(manager.select(sessions, 'deleted'), /目录/)
  assert.equal(await manager.ensure(sessions), current)
})
test('existing current-tab saved ID is migrated but a failed official refresh never creates a replacement', async () => {
  const x = load(); x.sessionStorage.setItem(x.SESSION_STORAGE_KEY, 'old-tab')
  const sessions = official(['old-tab']); const manager = x.createFieldkitSessions()
  assert.equal(await manager.ensure(sessions), 'old-tab'); assert.ok((await manager.list(sessions)).items.some(i => i.id === 'old-tab'))
  sessions.refresh = async () => { throw new Error('catalog offline') }
  await assert.rejects(manager.select(sessions, 'old-tab'), /catalog offline/)
  assert.equal(sessions.calls.includes('create'), false)
})
test('registry is bounded and stores only ID and visit time, never receipt content', async () => {
  const x = load(); const sessions = official();
  for (let i = 0; i < 130; i++) { sessions.ids.push(`old-${i}`); x.localStorage.setItem(`eha-fieldkit.ui-pending.v1:${i}`, JSON.stringify({ sessionId: `old-${i}`, token: 'DO_NOT_COPY', history: { raw: 'DO_NOT_COPY' } })) }
  const manager = x.createFieldkitSessions(); await manager.ensure(sessions); const list = await manager.list(sessions)
  assert.equal(list.items.length, 128); assert.equal(list.truncated, true)
  for (let i = 0; i < x.localStorage.length; i++) { const key = x.localStorage.key(i); if (key.startsWith(x.FIELDKIT_SESSION_PREFIX)) assert.doesNotMatch(x.localStorage.getItem(key), /DO_NOT_COPY|token|raw/) }
})

function mountSwitcher(manager, sessions = {}) {
  const slots = []; let cursor = 0; let tree; let switched = 0
  const react = { createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false) } }, useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }] }, useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial } } }
  const module = { exports: {} }
  const source = readFileSync(new URL('../src/client/SessionSwitcher.ts', import.meta.url), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, { module, exports: module.exports, require: name => name === 'react' ? react : { errorText: e => e.message, panelStyles: () => ({}) } })
  const render = () => { cursor = 0; tree = module.exports.SessionSwitcher({ manager, sessions, currentSessionId: 'current', onSelected: () => switched++ }) }
  const nodes = () => { const result = []; const visit = n => { if (!n || typeof n !== 'object') return; result.push(n); n.children?.forEach(visit) }; visit(tree); return result }
  render()
  return { render, nodes, switched: () => switched, button: label => nodes().find(n => n.type === 'button' && n.children.includes(label)), choose(id) { nodes().find(n => n.type === 'select').props.onChange({ target: { value: id } }); render() } }
}
test('actual chooser only switches on explicit return, serializes clicks, and preserves current session on catalog failure', async () => {
  let finish, selects = 0
  const manager = { list: async () => ({ items: [{ id: 'old', visitedAt: null }], warning: null, truncated: false }), select: async (_, id) => { assert.equal(id, 'old'); selects++; await new Promise(resolve => { finish = resolve }) } }
  const ui = mountSwitcher(manager)
  await ui.button('查看已有对话').props.onClick(); ui.render(); assert.equal(ui.switched(), 0)
  ui.choose('old'); assert.equal(ui.switched(), 0)
  const click = ui.button('打开所选对话').props.onClick; const pending = click(); await click(); assert.equal(selects, 1); assert.equal(ui.switched(), 0)
  finish(); await pending; assert.equal(ui.switched(), 1)
  manager.select = async () => { throw new Error('catalog unavailable') }
  await ui.button('打开所选对话').props.onClick(); ui.render()
  assert.equal(ui.switched(), 1); assert.match(JSON.stringify(ui.nodes()), /catalog unavailable/)
})
test('actual parent replaces the whole panel key on explicit selection and retains official provider lifecycle', async () => {
  const source = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
  const parent = source.slice(source.indexOf('function FieldkitSessionPanel('), source.indexOf('export async function apply'))
  let generation = 0
  const context = { useState: () => [generation, update => { generation = update(generation) }], React: { createElement: (type, props) => ({ type, props }) }, FieldkitPanel: function FieldkitPanel() {} }
  vm.runInNewContext(ts.transpileModule(parent + '\nglobalThis.renderParent=FieldkitSessionPanel', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  const before = context.renderParent({ manager: 'same' }); before.props.onSessionSelected(); const after = context.renderParent({ manager: 'same' })
  assert.notEqual(before.props.key, after.props.key); assert.equal(before.type, after.type)
  // FieldkitPanel retains only the official conversation reference and releases it on teardown.
  assert.match(source, /held = sessions\.retain\(id, \{ source: 'fieldkit' \}\)/)
  assert.match(source, /held\?\.release\(\)/)
  assert.doesNotMatch(source, /detachTarget|bindingId|mounted\.current/)
  assert.match(source, /SessionProvider, \{ session: reference \}/)
})
test('session manager and chooser typecheck under strict TypeScript', () => {
  const filename = new URL('../src/client/SessionSwitcher.ts', import.meta.url).pathname
  const options = { strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2022 }
  const host = ts.createCompilerHost(options)
  const stub = '/tmp/fieldkit-session-react.d.ts'
  const declarations = "declare module 'react' { const React: {createElement(...args:any[]):any}; export default React; export function useState<T>(initial:T|(()=>T)):[T,(value:T|((old:T)=>T))=>void]; export function useRef<T>(value:T):{current:T}; }"
  const oldRead = host.readFile.bind(host), oldExists = host.fileExists.bind(host)
  host.readFile = path => path === stub ? declarations : oldRead(path); host.fileExists = path => path === stub || oldExists(path)
  const program = ts.createProgram([filename, stub], options, host)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: p => p, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' }))
})
