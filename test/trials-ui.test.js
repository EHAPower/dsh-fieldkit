import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const path = new URL('../src/client/Trials.ts', import.meta.url)
const first = { instanceId: 'instance', bindingId: 'b1', targetId: 'can:1', uid: 'uid1', runNonce: 'nonce1', connectionGeneration: '9007199254740993' }
const second = { ...first, bindingId: 'b2', targetId: 'can:2', uid: 'uid2', runNonce: 'nonce2' }
const receipt = (members = [first], extra = {}) => ({ members, trialId: 'trial-1', mode: 'position', state: 'active', progress: ['identity verified', 'preflight completed'], results: members.map(target => ({ target, preparation: 'ready', admission: 'accepted', submission: 'local_submit', observation: 'not proven', unknown: false })), unknown: false, stopAvailable: true, recordingIds: ['run-1'], ...extra })
function fixture(extra = {}) { return { candidates: [first], reservation: { reservationId: 'r', members: [first] }, onStart: async request => receipt(request.members), onUpdate: async request => receipt(request.members), onTrialStop: async request => receipt(request.members, { state: 'stopping' }), onScopeStop: async request => receipt(request.members, { state: 'stopping' }), onRelease: async () => {}, ...extra } }
function mount(props) {
  const slots = []; let cursor = 0, tree
  const react = { createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat(Infinity).filter(v => v !== null && v !== false && v !== undefined) } }, useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] }, useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial } } }
  const load = file => { const module = { exports: {} }; const js = ts.transpileModule(readFileSync(new URL(file, path), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText; vm.runInNewContext(js, { module, exports: module.exports, require: name => name === 'react' ? react : load(name.replace(/\.js$/, '.ts')) }); return module.exports }
  const component = load('./Trials.ts')
  const render = () => { cursor = 0; tree = component.Trials(props) }
  const nodes = () => { const list = []; const visit = n => { if (!n || typeof n !== 'object') return; list.push(n); n.children?.forEach(visit) }; visit(tree); return list }
  render()
  return { props, render, nodes, button: name => nodes().find(n => n.type === 'button' && n.children.includes(name)), input: label => nodes().find(n => n.props['aria-label'] === label), visible: () => JSON.stringify(nodes().map(n => n.children)) }
}
const change = (ui, label, value) => { ui.input(label).props.onChange({ target: typeof value === 'boolean' ? { checked: value } : { value } }); ui.render() }
function fill(ui, members = [first]) {
  for (const member of members) change(ui, `试验成员 ${member.targetId}`, true)
  for (const label of ['位置 mm', '位置下限 mm', '位置上限 mm', '速度绝对上限 mm/s', '力绝对上限 N', '刚度上限 N/mm', '阻尼上限 Ns/mm', '最长试验时长 s', '试验时长 s']) change(ui, label, '1.0000000596046447753906250001')
  change(ui, '确认试验成员与原文参数', true)
}

test('trial needs explicit exact members, reservation and confirmation', () => {
  const ui = mount(fixture()); assert.equal(ui.button('预检并启动试验').props.disabled, true)
  fill(ui); assert.equal(ui.button('预检并启动试验').props.disabled, false)
  ui.props.reservation = null; ui.render(); assert.equal(ui.button('预检并启动试验').props.disabled, true)
  ui.props.reservation = { reservationId: 'r', members: [first] }; ui.render(); assert.equal(ui.button('预检并启动试验').props.disabled, true)
})
test('group trial preserves all decimal text and fixed members including u64 reach time', async () => {
  const requests = [], ui = mount(fixture({ candidates: [first, second], reservation: { reservationId: 'group-r', members: [first, second] }, onStart: async request => { requests.push(request); return receipt(request.members) } }))
  fill(ui, [first]); assert.equal(ui.button('预检并启动试验').props.disabled, true)
  change(ui, '试验成员 can:2', true); change(ui, '启用到位条件', true)
  change(ui, '到位容差 mm', ' 1.234567890123456789e-4 '); change(ui, '到位持续时间 ms', '18446744073709551615'); change(ui, '确认试验成员与原文参数', true)
  const click = ui.button('预检并启动试验').props.onClick; await click(); await click(); ui.render()
  assert.equal(requests.length, 1); assert.equal(requests[0].members.length, 2)
  assert.equal(requests[0].parameters.reach.settleMs, '18446744073709551615'); assert.equal(requests[0].parameters.reach.toleranceMm, ' 1.234567890123456789e-4 ')
  assert.equal(requests[0].parameters.envelope.durationMaxS, '1.0000000596046447753906250001')
  assert.equal(requests[0].parameters.command.positionMm, '1.0000000596046447753906250001')
  assert.match(ui.visible(), /can:2/); assert.match(ui.visible(), /preflight completed/); assert.match(ui.visible(), /local_submit/); assert.match(ui.visible(), /run-1/)
})
test('all four SDK trial command modes keep their original numeric inputs', async () => {
  for (const [mode, fields] of [['velocity', ['速度 mm/s']], ['force', ['力 N']], ['impedance', ['平衡位置 mm', '刚度 N/mm', '阻尼 Ns/mm']]]) {
    let sent
    const ui = mount(fixture({ onStart: async value => { sent = value; return receipt(value.members, { mode }) } })); fill(ui)
    change(ui, '试验模式', mode); for (const field of fields) change(ui, field, '-0.0000000000000000000001'); change(ui, '确认试验成员与原文参数', true)
    await ui.button('预检并启动试验').props.onClick(); assert.equal(sent.parameters.mode, mode)
    assert.ok(Object.values(sent.parameters.command).includes('-0.0000000000000000000001'))
  }
})
test('identity change blocks position updates but Stop retains original trial members despite busy', async () => {
  const stops = [], updates = [], ui = mount(fixture({ receipt: receipt(), onTrialStop: async value => { stops.push(value); return receipt(value.members) }, onUpdate: async value => { updates.push(value); return receipt(value.members) } }))
  change(ui, '试验成员 can:1', true); change(ui, '更新位置原文 mm', '2.00000000000000001')
  const oldUpdate = ui.button('更新原试验位置').props.onClick
  ui.props.candidates = [{ ...first, runNonce: 'new-nonce' }]; ui.props.busy = true; ui.render()
  await oldUpdate(); assert.equal(updates.length, 0); assert.equal(ui.button('更新原试验位置').props.disabled, true)
  assert.equal(ui.button('显式停止原试验').props.disabled, false); await ui.button('显式停止原试验').props.onClick()
  assert.equal(stops[0].trialId, 'trial-1'); assert.equal(stops[0].members[0].runNonce, 'nonce1'); assert.equal(stops[0].members[0].connectionGeneration, '9007199254740993')
})
test('pending start has a fixed scope Stop independent of normal busy and late start cannot replace Stop result', async () => {
  let resolveStart, resolveStop; const stopped = []
  const ui = mount(fixture({ onStart: () => new Promise(resolve => { resolveStart = resolve }), onScopeStop: value => { stopped.push(value); return new Promise(resolve => { resolveStop = resolve }) } }))
  fill(ui); const starting = ui.button('预检并启动试验').props.onClick(); ui.render()
  const stop = ui.button('按原设备范围请求停止（试验结果未知）'); assert.equal(stop.props.disabled, false)
  const stopping = stop.props.onClick(); await stop.props.onClick(); assert.equal(stopped.length, 1)
  resolveStop(receipt([first], { state: 'stopping', newSubmission: false, coalescedExisting: true })); await stopping
  resolveStart(receipt()); await starting; ui.render()
  assert.equal(stopped[0].members[0].runNonce, 'nonce1'); assert.match(ui.visible(), /没有再次提交/); assert.match(ui.visible(), /本次响应未新增提交（查询或沿用记录也会如此）/); assert.match(ui.visible(), /local_submit/)
  assert.equal(ui.button('更新原试验位置').props.disabled, true)
})
test('lost start response stays unknown across identity changes and never automatically retries', async () => {
  let starts = 0, stops = 0
  const ui = mount(fixture({ onStart: async () => { starts++; throw new Error('transport response lost') }, onScopeStop: async value => { stops++; return receipt(value.members, { unknown: true }) } }))
  fill(ui); await ui.button('预检并启动试验').props.onClick(); ui.render()
  ui.props.candidates = [{ ...first, runNonce: 'new' }]; ui.props.reservation = { reservationId: 'new-r', members: ui.props.candidates }; ui.render()
  change(ui, '试验成员 can:1', true); change(ui, '确认试验成员与原文参数', true)
  assert.equal(ui.button('预检并启动试验').props.disabled, true); assert.equal(starts, 1); assert.equal(stops, 0); assert.match(ui.visible(), /transport response lost/)
  assert.doesNotMatch(ui.visible(), /启动等待|已请求预检，等待服务事实/)
  assert.equal(ui.nodes().filter(n => n.type === 'button' && n.children.includes('按原设备范围请求停止（试验结果未知）')).length, 1)
})
test('release only calls the original reference callback; position update keeps decimal text', async () => {
  const releases = [], updates = []; let stops = 0
  const ui = mount(fixture({ receipt: receipt(), onRelease: async value => releases.push(value), onTrialStop: async () => { stops++; return receipt() }, onUpdate: async value => { updates.push(value); return receipt(value.members) } }))
  change(ui, '试验成员 can:1', true); change(ui, '更新位置原文 mm', ' 2.00000000000000001 ')
  await ui.button('更新原试验位置').props.onClick(); ui.render(); assert.equal(updates[0].positionRaw, ' 2.00000000000000001 ')
  await ui.button('释放原试验引用（不 Stop）').props.onClick(); assert.equal(releases[0].trialId, 'trial-1'); assert.equal(stops, 0)
})
test('explicitly selecting a changed identity removes unreachable stale selection keys', () => {
  const ui = mount(fixture()); fill(ui)
  ui.props.candidates = [{ ...first, runNonce: 'fresh' }]; ui.props.reservation = { reservationId: 'new', members: ui.props.candidates }; ui.render()
  assert.equal(ui.button('预检并启动试验').props.disabled, true)
  change(ui, '试验成员 can:1', true); change(ui, '确认试验成员与原文参数', true)
  assert.equal(ui.button('预检并启动试验').props.disabled, false)
})
const transportUnknown = (target = first, operationId = 'op-1', extra = {}) => ({ target, operationId, preparation: 'unknown', admission: 'unknown', submission: 'unknown', controlEffect: 'unresolved', observation: null, unknown: true, unknownSource: 'transport', ...extra })
const notSubmitted = (target = first, operationId = 'op-1', extra = {}) => ({ target, operationId, preparation: 'finished', admission: 'finished', submission: 'not_submitted', controlEffect: 'not_attempted', observation: null, unknown: false, unknownSource: null, ...extra })
const showResult = (ui, results, extra = {}) => { ui.props.receipt = receipt(results.map(r => r.target), { state: 'completed', unknown: results.some(r => r.unknown), results, ...extra }); ui.render() }
test('only exact operation proof clears a transport-unknown trial without resubmitting', () => {
  let starts = 0
  const ui = mount(fixture({ onStart: async () => { starts++; return receipt() } })); fill(ui)
  showResult(ui, [transportUnknown()]); assert.equal(ui.button('预检并启动试验').props.disabled, true)
  showResult(ui, [notSubmitted()], { state: 'finished' }); change(ui, '确认试验成员与原文参数', true)
  assert.equal(ui.button('预检并启动试验').props.disabled, false); assert.equal(starts, 0)
})
test('other operations, target identities and incomplete evidence cannot clear transport unknown', () => {
  const mismatches = [notSubmitted(first, 'op-other'), ...Object.keys(first).map(field => notSubmitted({ ...first, [field]: `${first[field]}-changed` })), ...[{ admission: 'accepted' }, { submission: 'local_submit' }, { controlEffect: null }, { unknown: true }].map(fields => notSubmitted(first, 'op-1', fields))]
  for (const evidence of mismatches) {
    const ui = mount(fixture()); fill(ui); showResult(ui, [transportUnknown()]); showResult(ui, [evidence]); change(ui, '确认试验成员与原文参数', true)
    assert.equal(ui.button('预检并启动试验').props.disabled, true, JSON.stringify(evidence))
  }
})
test('SDK and anonymous unknown remain pinned even after later matching transport evidence', () => {
  for (const original of [transportUnknown(first, 'op-1', { unknownSource: 'sdk' }), transportUnknown(first, null), transportUnknown(first, 'op-1', { unknownSource: null })]) {
    const ui = mount(fixture()); fill(ui); showResult(ui, [original]); showResult(ui, [transportUnknown()]); showResult(ui, [notSubmitted()]); change(ui, '确认试验成员与原文参数', true)
    assert.equal(ui.button('预检并启动试验').props.disabled, true)
  }
  const ui = mount(fixture()); fill(ui); showResult(ui, [], { members: [first], unknown: true }); showResult(ui, [notSubmitted()]); change(ui, '确认试验成员与原文参数', true)
  assert.equal(ui.button('预检并启动试验').props.disabled, true)
})
test('each unresolved operation stays pinned independently and resolved members do not block another UID', () => {
  const ui = mount(fixture()); fill(ui)
  showResult(ui, [transportUnknown()]); showResult(ui, [transportUnknown(first, 'op-2')]); showResult(ui, [notSubmitted()]); change(ui, '确认试验成员与原文参数', true)
  assert.equal(ui.button('预检并启动试验').props.disabled, true)
  showResult(ui, [notSubmitted(first, 'op-2')]); change(ui, '确认试验成员与原文参数', true)
  assert.equal(ui.button('预检并启动试验').props.disabled, false)
  showResult(ui, [notSubmitted(), transportUnknown(second, 'op-second')]); change(ui, '确认试验成员与原文参数', true)
  assert.equal(ui.button('预检并启动试验').props.disabled, false)
})
test('all original group members need finished non-submission proof and stale start cannot bypass unknown', async () => {
  let starts = 0
  const ui = mount(fixture({ candidates: [first, second], reservation: { reservationId: 'group-r', members: [first, second] }, onStart: async () => { starts++; return receipt([first, second]) } })); fill(ui, [first, second])
  const staleStart = ui.button('预检并启动试验').props.onClick
  showResult(ui, [transportUnknown(), transportUnknown(second, 'op-2')]); await staleStart(); assert.equal(starts, 0)
  showResult(ui, [notSubmitted()], { members: [first, second], state: 'finished / finished' }); change(ui, '确认试验成员与原文参数', true)
  assert.equal(ui.button('预检并启动试验').props.disabled, true)
  showResult(ui, [notSubmitted(), notSubmitted(second, 'op-2')], { state: 'finished / finished' }); change(ui, '确认试验成员与原文参数', true)
  assert.equal(ui.button('预检并启动试验').props.disabled, false); assert.equal(starts, 0)
})
test('Trials strict TypeScript props and DOM handlers compile', () => {
  const stub = '/virtual/trials-react.d.ts', options = { strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2022 }
  const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host)
  host.getSourceFile = (file, version, onError, fresh) => file === stub ? ts.createSourceFile(file, `declare module 'react' { namespace React { interface ChangeEvent<T> { target:T }; function createElement(...args:any[]):any; function useRef<T>(initial:T):{current:T}; function useState<T>(initial:T):[T,(value:T | ((previous:T)=>T))=>void] } export = React }`, version) : original(file, version, onError, fresh)
  const program = ts.createProgram([path.pathname, stub], options, host)
  assert.equal(ts.getPreEmitDiagnostics(program).map(e => ts.flattenDiagnosticMessageText(e.messageText, '\n')).join('\n'), '')
})

test('a correlated start receipt retires only its pending placeholder and keeps original evidence', async () => {
  let finish
  const ui = mount(fixture({ onStart: () => new Promise(resolve => { finish = resolve }) })); fill(ui)
  const starting = ui.button('预检并启动试验').props.onClick(); ui.render()
  assert.match(ui.visible(), /启动等待/); assert.ok(ui.button('按原设备范围请求停止（试验结果未知）'))
  const original = receipt([first], { state: 'finished' }); finish(original); await starting
  ui.props.receipt = { ...original }; ui.render()
  assert.doesNotMatch(ui.visible(), /启动等待|已请求预检，等待服务事实/)
  assert.equal(ui.button('按原设备范围请求停止（试验结果未知）'), undefined)
  assert.match(ui.visible(), /启动试验（原动作回执，非当前试验状态） · 试验 trial-1 · 已登记状态 finished/)
  ui.props.receipt = receipt([first], { state: 'completed', statusRead: 'available' }); ui.render()
  assert.match(ui.visible(), /服务最近读取的试验/)
  assert.match(ui.visible(), /preflight completed/); assert.match(ui.visible(), /local_submit/)
  assert.ok(ui.button('显式停止原试验'))
})


test('trial display distinguishes last-known read failures and expired historical state without inventing completion', () => {
  const ui = mount(fixture({ receipt: receipt([first], { statusRead: 'unavailable', statusReason: '最近读取失败', progress: ['operation_not_found: ORIGINAL_ERROR'] }) }))
  assert.match(ui.visible(), /最后已知状态 active/)
  assert.doesNotMatch(ui.visible(), /服务当前试验/)
  assert.match(ui.visible(), /operation_not_found: ORIGINAL_ERROR/)
  ui.props.historyReason = '原范围属于旧服务实例'
  ui.props.stopGateReason = '原范围过期'
  ui.render()
  assert.match(ui.visible(), /历史试验/); assert.match(ui.visible(), /原范围属于旧服务实例/)
  assert.equal(ui.button('显式停止原试验').props.disabled, true)
  ui.props.historyReason = null; ui.props.stopGateReason = null
  ui.props.receipt = receipt([first], { state: 'completed', statusRead: 'available' }); ui.render()
  assert.match(ui.visible(), /服务最近读取的试验/); assert.match(ui.visible(), /completed/)
})


test('reference release keeps SDK completed terminal usable but cannot bypass active or unknown trial gates', () => {
  const ui = mount(fixture({ receipt: receipt([first], { referenceReleased: true, state: 'completed', statusRead: 'available' }) }))
  fill(ui)
  assert.equal(ui.button('预检并启动试验').props.disabled, false)
  assert.match(ui.visible(), /引用已释放.*不代表试验结束或设备停止/)
  assert.match(ui.visible(), /已完成试验记录（引用已释放）/)
  ui.props.receipt = receipt([first], { referenceReleased: true, state: 'active', statusRead: 'available' }); ui.render(); fill(ui)
  assert.equal(ui.button('预检并启动试验').props.disabled, true)
  ui.props.receipt = receipt([first], { referenceReleased: true, state: 'completed', statusRead: 'unavailable' }); ui.render(); fill(ui)
  assert.equal(ui.button('预检并启动试验').props.disabled, true)
  ui.props.receipt = receipt([first], { referenceReleased: true, state: 'completed', statusRead: 'available', unknown: true }); ui.render(); fill(ui)
  assert.equal(ui.button('预检并启动试验').props.disabled, true)
})
