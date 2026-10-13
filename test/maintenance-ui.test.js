import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const path = new URL('../src/client/Maintenance.ts', import.meta.url)
const target = { instanceId: 'instance', bindingId: 'binding', targetId: 'usb:fixture', uid: 'UID-1', runNonce: 'nonce', connectionGeneration: '7' }
const rawText = '{ "wide":18446744073709551615,"gain":1.000000059604644775390625 }'
function fixture(extra = {}) {
  return { target, permission: { grantId: 'grant', target, maintenance: true }, rawText, validation: { rawText, valid: true, summary: 'SDK valid' }, onEnable: async () => {}, onSubmit: async request => ({ ...request, admission: 'accepted', submission: 'locally_submitted', unknown: false }), ...extra }
}
function mount(props) {
  assert.ok(existsSync(path), 'Maintenance must provide the explicit scoped workflow')
  const slots = []; let cursor = 0, tree
  const react = { createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false) } }, useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] }, useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial } } }
  const load = filename => {
    const module = { exports: {} }
    const js = ts.transpileModule(readFileSync(new URL(filename, path), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    vm.runInNewContext(js, { module, exports: module.exports, require: name => name === 'react' ? react : load(name.replace(/\.js$/, '.ts')) })
    return module.exports
  }
  const module = load('./Maintenance.ts')
  const render = () => { cursor = 0; tree = module.Maintenance(props) }
  const nodes = () => { const list = []; const visit = n => { if (typeof n !== 'object' || !n) return; list.push(n); n.children?.forEach(visit) }; visit(tree); return list }
  render()
  return { module, props, render, nodes, button: name => nodes().find(n => n.type === 'button' && n.children.includes(name)), checkbox: label => nodes().find(n => n.type === 'input' && n.props['aria-label'] === label), select: () => nodes().find(n => n.type === 'select') }
}
function confirm(ui) { ui.checkbox('确认当前目标和具体维护动作').props.onChange({ target: { checked: true } }); ui.render() }

test('maintenance defaults to read-only and enables only after explicit current-target opt-in', async () => {
  let enabled = null
  const ui = mount(fixture({ permission: null, onEnable: async value => { enabled = value } }))
  assert.equal(ui.button('执行维护动作').props.disabled, true)
  assert.equal(ui.button('启用当前目标维护权限').props.disabled, true)
  ui.checkbox('明确启用当前目标维护权限').props.onChange({ target: { checked: true } }); ui.render()
  await ui.button('启用当前目标维护权限').props.onClick()
  assert.equal(enabled.uid, 'UID-1'); assert.equal(enabled.connectionGeneration, '7')
})

test('save sends the complete original candidate once and never performs implicit reconnect or readback', async () => {
  const requests = []; let reconnects = 0, reads = 0
  const ui = mount(fixture({ onSubmit: async request => { requests.push(request); return { ...request, admission: 'accepted', submission: 'locally_submitted', unknown: false } }, onReconnect: async () => { reconnects++ }, onReadback: async () => { reads++ } }))
  confirm(ui)
  const submit = ui.button('执行维护动作').props.onClick
  await submit(); await submit()
  assert.equal(requests.length, 1); assert.equal(requests[0].rawRecordText, rawText)
  assert.equal(requests[0].action, 'save_and_restart'); assert.equal(reconnects, 0); assert.equal(reads, 0)
})

test('identity, generation, permission and candidate changes invalidate old confirmation permanently', () => {
  for (const update of [{ target: { ...target, runNonce: 'new' } }, { target: { ...target, uid: 'UID-2' } }, { target: { ...target, connectionGeneration: '8' } }, { permission: { grantId: 'new', target, maintenance: true } }, { rawText: '{}' }]) {
    const ui = mount(fixture()); confirm(ui); assert.equal(ui.button('执行维护动作').props.disabled, false)
    const original = { ...ui.props }; Object.assign(ui.props, update); ui.render()
    assert.equal(ui.button('执行维护动作').props.disabled, true)
    Object.assign(ui.props, original); ui.render(); assert.equal(ui.button('执行维护动作').props.disabled, true)
  }
})

test('save rejects unmatched SDK validation and all actions retain explicit backend gate reasons', () => {
  const ui = mount(fixture({ validation: { rawText: '{}', valid: true, summary: 'older result' } })); confirm(ui)
  assert.equal(ui.button('执行维护动作').props.disabled, true)
  ui.props.gateReason = 'owner_busy'; ui.select().props.onChange({ target: { value: 'reset_application' } }); ui.render(); confirm(ui)
  assert.equal(ui.button('执行维护动作').props.disabled, true)
  assert.ok(ui.nodes().some(n => n.children.some(x => String(x).includes('owner_busy'))))
})

test('enter_update requires a delivered recovery path plus explicit acknowledgment and does not send candidate bytes', async () => {
  let request
  const ui = mount(fixture({ onSubmit: async value => { request = value; return { ...value, admission: 'accepted', submission: 'locally_submitted', unknown: false } } }))
  ui.select().props.onChange({ target: { value: 'enter_update' } }); ui.render(); confirm(ui)
  assert.equal(ui.button('执行维护动作').props.disabled, true)
  ui.props.recoveryPath = 'documented recovery'; ui.render()
  ui.checkbox('确认已明确更新恢复路径').props.onChange({ target: { checked: true } }); ui.render(); confirm(ui)
  await ui.button('执行维护动作').props.onClick()
  assert.equal(request.action, 'enter_update'); assert.equal(request.rawRecordText, undefined)
})

test('ResultUnknown is retained across nonce and permission changes, without retrying or claiming failure', async () => {
  let calls = 0
  const ui = mount(fixture({ onSubmit: async value => { calls++; return { ...value, admission: 'accepted', submission: 'submission_unknown', unknown: true, observation: 'later Idle' } } }))
  confirm(ui); await ui.button('执行维护动作').props.onClick(); ui.render()
  ui.props.target = { ...target, runNonce: 'restarted' }; ui.props.permission = { grantId: 'second', target: ui.props.target, maintenance: true }; ui.render(); confirm(ui)
  assert.equal(ui.button('执行维护动作').props.disabled, true); assert.equal(calls, 1)
  const visible = JSON.stringify(ui.nodes().map(n => n.children))
  assert.ok(visible.includes('submission_unknown')); assert.ok(visible.includes('later Idle')); assert.ok(visible.includes('设备效果未知'))
})

test('lost submission response is unknown and remains blocked; post-action verification requires explicit buttons', async () => {
  let reads = 0, reconnects = 0
  const ui = mount(fixture({ onSubmit: async () => { throw new Error('response lost') }, onReconnect: async () => { reconnects++ }, onReadback: async () => { reads++ } }))
  confirm(ui); await ui.button('执行维护动作').props.onClick(); ui.render(); confirm(ui)
  assert.equal(ui.button('执行维护动作').props.disabled, true); assert.equal(reads, 0); assert.equal(reconnects, 0)
  await ui.button('显式重连并核对同 UID').props.onClick(); ui.render()
  await ui.button('读回 User').props.onClick(); ui.render()
  assert.equal(reads, 1); assert.equal(reconnects, 1)
})

test('an inherited object member cannot become a fifth maintenance action', async () => {
  let request
  const ui = mount(fixture({ onSubmit: async value => { request = value; return { ...value, admission: 'accepted', submission: 'locally_submitted', unknown: false } } }))
  ui.select().props.onChange({ target: { value: 'toString' } }); ui.render(); confirm(ui)
  await ui.button('执行维护动作').props.onClick()
  assert.equal(request.action, 'save_and_restart')
})

test('the component typechecks with strict props and DOM event types', () => {
  const filename = path.pathname, stub = '/virtual/maintenance-react.d.ts'
  const options = { strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2022 }
  const host = ts.createCompilerHost(options), getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => file === stub ? ts.createSourceFile(file, `declare module 'react' { namespace React { interface ChangeEvent<T> { target: T }; function createElement(...args: any[]): any; function useRef<T>(initial: T): {current:T}; function useState<T>(initial:T): [T,(value:T | ((previous:T)=>T))=>void] } export = React }`, languageVersion) : getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile)
  const program = ts.createProgram([filename, stub], options, host)
  assert.equal(ts.getPreEmitDiagnostics(program).map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'), '')
})
