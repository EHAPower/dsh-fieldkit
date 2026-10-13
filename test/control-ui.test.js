import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const path = new URL('../src/client/Control.ts', import.meta.url)
const target = { instanceId: 'i', bindingId: 'b', targetId: 'usb:test', uid: 'uid', runNonce: 'nonce', connectionGeneration: '7' }
const receipt = (request, action) => ({ target: request.target, action, admission: 'accepted', submission: 'locally_submitted', unknown: false })
const defaults = extra => ({ target, permission: { grantId: 'g', target, control: true }, onGrant: async () => {}, onTarget: async r => receipt(r, 'target'), onHeartbeat: async r => receipt(r, `heartbeat_${r.action}`), onStop: async r => receipt(r, 'stop'), ...extra })
function mount(props) {
  const slots = []; let cursor = 0, tree
  const react = { createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false) } }, useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] }, useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial } } }
  const load = filename => {
    const module = { exports: {} }
    const js = ts.transpileModule(readFileSync(new URL(filename, path), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    vm.runInNewContext(js, { module, exports: module.exports, require: name => name === 'react' ? react : load(name.replace(/\.js$/, '.ts')) })
    return module.exports
  }
  const component = load('./Control.ts')
  const render = () => { cursor = 0; tree = component.Control(props) }
  const nodes = () => { const out = []; const visit = n => { if (typeof n !== 'object' || !n) return; out.push(n); n.children?.forEach(visit) }; visit(tree); return out }
  render()
  const named = label => nodes().find(n => n.props['aria-label'] === label)
  return { props, render, nodes, named, button: label => nodes().find(n => n.type === 'button' && n.children.includes(label)), change(label, value) { named(label).props.onChange({ target: typeof value === 'boolean' ? { checked: value } : { value } }); render() } }
}
const confirm = ui => ui.change('确认当前身份、目标模式及全部原始参数', true)
const raw = '1.000000059604644775390625'

test('control grants require explicit target opt-in; callbacks do not auto-submit targets or heartbeats', async () => {
  const grants = []; let targets = 0
  const ui = mount(defaults({ permission: null, onGrant: async t => grants.push(t), onTarget: async r => { targets++; return receipt(r, 'target') } }))
  assert.equal(ui.button('申请控制权限').props.disabled, true)
  assert.equal(ui.button('提交持续目标').props.disabled, true)
  ui.change('明确申请当前目标控制权限', true)
  const click = ui.button('申请控制权限').props.onClick; await click(); await click()
  assert.equal(grants.length, 1); assert.equal(grants[0].runNonce, target.runNonce); assert.equal(targets, 0)
})

test('four SDK target modes preserve original decimal strings, units, and exact grant scope', async () => {
  const cases = [
    ['position', [['目标位置（mm）', 'mm']]], ['velocity', [['目标速度（mm/s）', 'mm_s']]], ['force', [['目标力（N）', 'n']]],
    ['impedance', [['平衡位置（mm）', 'equilibrium_mm'], ['刚度（N/mm）', 'stiffness_n_per_mm'], ['阻尼（N·s/mm）', 'damping_ns_per_mm']]],
  ]
  for (const [mode, fields] of cases) {
    const calls = []; const ui = mount(defaults({ onTarget: async r => { calls.push(r); return receipt(r, 'target') } }))
    ui.change('目标模式', mode)
    for (const [label] of fields) ui.change(label, raw)
    confirm(ui); const click = ui.button('提交持续目标').props.onClick; await click(); await click()
    assert.equal(calls.length, 1); assert.equal(calls[0].demand.mode, mode); assert.equal(calls[0].grantId, 'g')
    for (const [, key] of fields) assert.equal(calls[0].demand[key], raw)
  }
})

test('identity, mode, raw input, or grant changes permanently discard confirmation and stale handlers', async () => {
  for (const change of [{ target: { ...target, uid: 'new' } }, { target: { ...target, runNonce: 'new' } }, { target: { ...target, connectionGeneration: '8' } }, { permission: { grantId: 'new', target, control: true } }]) {
    let calls = 0; const ui = mount(defaults({ onTarget: async r => { calls++; return receipt(r, 'target') } }))
    ui.change('目标位置（mm）', raw); confirm(ui); const oldClick = ui.button('提交持续目标').props.onClick
    const original = { ...ui.props }; Object.assign(ui.props, change); ui.render(); await oldClick()
    assert.equal(calls, 0); assert.equal(ui.button('提交持续目标').props.disabled, true)
    Object.assign(ui.props, original); ui.render(); assert.equal(ui.button('提交持续目标').props.disabled, true)
  }
  const ui = mount(defaults()); ui.change('目标位置（mm）', raw); confirm(ui); ui.change('目标位置（mm）', ' 2.000 ')
  assert.equal(ui.button('提交持续目标').props.disabled, true)
  confirm(ui); ui.change('目标模式', 'force'); assert.equal(ui.button('提交持续目标').props.disabled, true)
})

test('normal Stop remains callable while target is pending and ordinary gates/model work are busy', async () => {
  let release; const gate = new Promise(r => { release = r }); let targets = 0, stops = 0
  const ui = mount(defaults({ onTarget: async r => { targets++; await gate; return receipt(r, 'target') }, onStop: async r => { stops++; assert.equal(r.grantId, undefined); return receipt(r, 'stop') } }))
  ui.change('目标位置（mm）', raw); confirm(ui)
  const pending = ui.button('提交持续目标').props.onClick(); ui.render()
  ui.props.busy = true; ui.props.gateReason = 'ordinary_owner_busy'; ui.props.permission = null; ui.render()
  assert.equal(ui.button('请求普通 Stop').props.disabled, false)
  await ui.button('请求普通 Stop').props.onClick(); assert.equal(stops, 1); assert.equal(targets, 1)
  release(); await pending; ui.render()
  assert.ok(JSON.stringify(ui.nodes()).includes('普通停止请求，不是急停'))
})

test('Stop has independent single-flight and identity checks, with no retry after unknown response', async () => {
  let release; const gate = new Promise(r => { release = r }); let calls = 0
  const ui = mount(defaults({ onStop: async () => { calls++; await gate; throw new Error('lost response') } }))
  const click = ui.button('请求普通 Stop').props.onClick
  const pending = click(); await click(); ui.render(); assert.equal(ui.button('请求普通 Stop').props.disabled, true)
  release(); await pending; await click(); ui.render()
  assert.equal(calls, 1); assert.equal(ui.button('请求普通 Stop').props.disabled, true)
  assert.ok(JSON.stringify(ui.nodes()).includes('submission_unknown'))
  ui.props.target = { ...target, runNonce: 'new' }; ui.render(); await click(); assert.equal(calls, 1)
})

test('unknown target is retained across regrant/reconnect and clean observations; explicit Stop is still available', async () => {
  let calls = 0
  const ui = mount(defaults({ onTarget: async r => { calls++; return { ...receipt(r, 'target'), submission: 'submission_unknown', unknown: true } } }))
  ui.change('目标位置（mm）', raw); confirm(ui); await ui.button('提交持续目标').props.onClick(); ui.render()
  ui.props.target = { ...target, runNonce: 'new' }; ui.props.permission = { grantId: 'new', target: ui.props.target, control: true }; ui.props.receipt = { ...receipt({ target: ui.props.target }, 'target'), observation: 'later Idle' }; ui.render(); confirm(ui)
  assert.equal(ui.button('提交持续目标').props.disabled, true); assert.equal(ui.button('请求普通 Stop').props.disabled, false); assert.equal(calls, 1)
})

test('heartbeat start stop and once require distinct confirmations and do not invoke target or Stop', async () => {
  const calls = []; const ui = mount(defaults({ onHeartbeat: async r => { calls.push(r.action); return receipt(r, `heartbeat_${r.action}`) }, onTarget: async () => assert.fail('target'), onStop: async () => assert.fail('Stop') }))
  for (const [action, label] of [['start', '启动持续心跳'], ['stop', '停止持续心跳'], ['once', '发送单次心跳']]) {
    ui.change('心跳动作', action); assert.equal(ui.button('执行心跳动作').props.disabled, true)
    ui.change('确认当前身份并' + label, true); await ui.button('执行心跳动作').props.onClick(); ui.render()
  }
  assert.deepEqual(calls, ['start', 'stop', 'once'])
})

test('strict component props and DOM event types compile', () => {
  const stub = '/virtual/control-react.d.ts'
  const options = { strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2022 }
  const host = ts.createCompilerHost(options), source = host.getSourceFile.bind(host)
  host.getSourceFile = (file, languageVersion, onError, fresh) => file === stub ? ts.createSourceFile(file, `declare module 'react' { namespace React { interface ChangeEvent<T> { target: T }; function createElement(...args: any[]): any; function useRef<T>(initial: T): {current:T}; function useState<T>(initial:T): [T,(value:T | ((previous:T)=>T))=>void] } export = React }`, languageVersion) : source(file, languageVersion, onError, fresh)
  const program = ts.createProgram([path.pathname, stub], options, host)
  assert.equal(ts.getPreEmitDiagnostics(program).map(e => ts.flattenDiagnosticMessageText(e.messageText, '\n')).join('\n'), '')
})


test('same operation transport uncertainty clears only on explicit never-submitted evidence', async () => {
  for (const action of ['target', 'heartbeat_once']) {
    const pending = { target, action, operationId: 'op-1', admission: 'queued', submission: 'unknown', controlEffect: 'unresolved', unknown: true, unknownSource: 'transport' }
    const ui = mount(defaults({ onTarget: async () => pending, onHeartbeat: async () => pending }))
    ui.change('目标位置（mm）', raw)
    if (action === 'target') { confirm(ui); await ui.button('提交持续目标').props.onClick() }
    else { ui.change('确认当前身份并发送单次心跳', true); await ui.button('执行心跳动作').props.onClick() }
    ui.render(); assert.equal(ui.named('确认当前身份、目标模式及全部原始参数').props.disabled, true)
    ui.props.receipt = { ...pending, admission: 'finished', submission: 'not_submitted', controlEffect: 'not_attempted', unknown: false, unknownSource: null }
    ui.render(); ui.render() // The stale local receipt must not re-latch the resolved operation.
    assert.equal(ui.named('确认当前身份、目标模式及全部原始参数').props.disabled, false)
    confirm(ui); assert.equal(ui.button('提交持续目标').props.disabled, false)
    ui.props.receipt = receipt({ target }, 'stop'); ui.render(); ui.render()
    assert.equal(ui.named('确认当前身份、目标模式及全部原始参数').props.disabled, false)
  }
})

test('unknown correlation does not clear SDK, anonymous, unsourced, different operation/action/identity or unresolved evidence', () => {
  const pending = { target, action: 'target', operationId: 'op-1', admission: 'queued', submission: 'unknown', controlEffect: 'unresolved', unknown: true, unknownSource: 'transport' }
  const resolved = { ...pending, admission: 'finished', submission: 'not_submitted', controlEffect: 'not_attempted', unknown: false, unknownSource: null }
  for (const [original, update] of [
    [{ ...pending, unknownSource: 'sdk' }, resolved], [{ ...pending, unknownSource: undefined }, resolved],
    [{ ...pending, operationId: undefined }, { ...resolved, operationId: undefined }],
    [pending, { ...resolved, operationId: 'op-2' }], [pending, { ...resolved, action: 'heartbeat_once' }],
    [pending, { ...resolved, target: { ...target, runNonce: 'new' } }],
    [pending, { ...resolved, target: { ...target, instanceId: 'new' } }],
    [pending, { ...resolved, submission: 'locally_submitted' }], [pending, { ...resolved, controlEffect: 'unresolved' }],
    [pending, { ...resolved, admission: 'attempting' }],
  ]) {
    const ui = mount(defaults({ receipt: original })); ui.change('目标位置（mm）', raw)
    ui.props.receipt = update; ui.render(); confirm(ui)
    assert.equal(ui.button('提交持续目标').props.disabled, true)
    assert.equal(ui.button('请求普通 Stop').props.disabled, false)
  }
  const ui = mount(defaults({ receipt: { ...pending, unknownSource: 'sdk' } }))
  ui.props.receipt = pending; ui.render(); ui.props.receipt = resolved; ui.render()
  assert.equal(ui.named('确认当前身份、目标模式及全部原始参数').props.disabled, true)
})

test('resolved transport Stop receipt never re-enables POST of the same Stop scope', () => {
  const pending = { target, action: 'stop', operationId: 'stop-1', admission: 'queued', submission: 'unknown', controlEffect: 'unresolved', unknown: true, unknownSource: 'transport' }
  const ui = mount(defaults({ receipt: pending }))
  assert.equal(ui.button('请求普通 Stop').props.disabled, true)
  ui.props.receipt = { ...pending, admission: 'finished', submission: 'not_submitted', controlEffect: 'not_attempted', unknown: false, unknownSource: null }; ui.render()
  assert.equal(ui.button('请求普通 Stop').props.disabled, true)
  assert.equal(ui.named('确认当前身份并发送单次心跳').props.disabled, false)
})
