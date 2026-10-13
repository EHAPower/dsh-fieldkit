import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const first = { instanceId: 'instance', bindingId: 'b1', targetId: 'can:1', uid: 'a'.repeat(24), runNonce: 'b'.repeat(32), connectionGeneration: '9007199254740993' }
const second = { ...first, bindingId: 'b2', targetId: 'can:2', uid: 'c'.repeat(24) }
const candidates = [first, second].map((target, i) => ({ candidateId: `c${i + 1}`, label: target.targetId, ...target }))
const scope = (members = [first]) => ({ scopeId: 'fixed', instanceId: 'instance', members: members.map(target => ({ target, grantId: `grant-${target.bindingId}`, controlEpoch: 'epoch-2', stopRequestId: `canonical-${target.bindingId}` })), kind: members.length === 1 ? 'single' : 'group', state: 'active', controlReady: true, reason: null, stopAvailable: true, stopReason: null, latest: null, trial: null })
const success = value => ({ ok: true, value })
const result = (fixed, action, extra = {}) => ({ scopeId: fixed.scopeId, action, results: fixed.members.map(({ target }) => ({ target, operationId: 'op', admission: 'finished', submission: 'locally_submitted', controlEffect: 'not_applicable', observation: 'unconfirmed', phase: 'submission', unknown: false, unknownSource: null, nativeJsonText: null, error: null })), unknown: false, ...extra })
const caps = ['control', 'control_groups', 'trials', 'recording_write']
function baseRemote(fixed = null, extra = {}) {
  return { controlContext: async () => success({ scopes: fixed ? [fixed] : [], activeScopeId: fixed?.scopeId ?? null, capabilities: caps }), controlCandidates: async () => success({ candidates }), ...extra }
}
function storage() { const values = new Map(); return { get length() { return values.size }, key: index => [...values.keys()][index] ?? null, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } }
function mount(remote, options = {}) {
  const path = new URL('../src/client/ControlWorkbench.ts', import.meta.url), hooks = new Map(), modules = new Map(), effects = [], timers = new Map()
  let current, cursor, tree, timerId = 0
  const localStorage = options.storage ?? storage(), listeners = new Map()
  const props = { remote, sessionId: 'chat', currentBinding: null, busy: false, visible: true, currentInstanceId: 'instance', ...options }
  const react = {
    createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false) } },
    useState(initial) { const slots = hooks.get(current), i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] },
    useRef(initial) { const slots = hooks.get(current), i = cursor++; return slots[i] ??= { current: initial } },
    useEffect(effect, deps) { const slots = hooks.get(current), i = cursor++, old = slots[i]; if (!old || deps?.some((x, j) => x !== old.deps?.[j])) { const entry = { deps, cleanup: old?.cleanup }; slots[i] = entry; effects.push(() => { entry.cleanup?.(); entry.cleanup = effect() }) } },
  }
  function load(name) {
    if (modules.has(name)) return modules.get(name)
    const module = { exports: {} }; modules.set(name, module.exports)
    const js = ts.transpileModule(readFileSync(new URL(name, path), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    vm.runInNewContext(js, { module, exports: module.exports, Blob, URL, localStorage, window: { addEventListener: (name, fn) => { const set = listeners.get(name) ?? new Set(); set.add(fn); listeners.set(name, set) }, removeEventListener: (name, fn) => listeners.get(name)?.delete(fn) }, document: { visibilityState: 'visible' }, setTimeout: callback => { timers.set(++timerId, callback); return timerId }, clearTimeout: id => timers.delete(id), require: name => name === 'react' ? react : load(name.replace(/\.js$/, '.ts')) })
    return module.exports
  }
  const component = load('./ControlWorkbench.ts')
  const resolve = (node, location) => {
    if (!node || typeof node !== 'object') return node
    if (typeof node.type === 'function') { current = `${location}:${node.props.key ?? ''}`; if (!hooks.has(current)) hooks.set(current, []); cursor = 0; return resolve(node.type(node.props), `${location}/child`) }
    return { ...node, children: node.children.map((child, i) => resolve(child, `${location}/${i}`)) }
  }
  const render = () => { current = 'root'; if (!hooks.has(current)) hooks.set(current, []); cursor = 0; tree = resolve(options.originalStop ? component.OriginalScopeStop(props) : options.stopBar ? component.ScopeStopBar(props) : react.createElement('div', null, react.createElement(component.ControlWorkbench, props), react.createElement(load('./RecoveryHistory.ts').RecoveryHistory, { remote, sessionId: props.sessionId, currentInstanceId: props.currentInstanceId })), 'tree'); for (const effect of effects.splice(0)) effect() }
  const nodes = () => { const output = []; const visit = node => { if (!node || typeof node !== 'object') return; output.push(node); node.children?.forEach(visit) }; visit(tree); return output }
  render()
  return { props, render, nodes, storageChanged() { for (const fn of listeners.get('storage') ?? []) fn({ key: null }); render() }, button: name => nodes().find(n => n.type === 'button' && n.children.includes(name)), named: name => nodes().find(n => n.props['aria-label'] === name), change(name, value) { this.named(name).props.onChange({ target: typeof value === 'boolean' ? { checked: value } : { value } }); render() }, async settle() { await new Promise(resolve => setImmediate(resolve)); render() }, async tick() { const entry = timers.entries().next().value; assert.ok(entry); timers.delete(entry[0]); await entry[1](); await this.settle() } }
}
const allText = ui => ui.nodes().flatMap(n => n.children.filter(x => typeof x === 'string')).join('\n')
const raw = ' 1.000000059604644775390625e-999 '

test('scope creation requires explicit exact members and whole-scope human confirmation', async () => {
  const calls = [], fixed = scope([first, second])
  const remote = baseRemote(null, { createControlScope: async (_, request) => { calls.push(request); remote.controlContext = async () => success({ scopes: [fixed], activeScopeId: fixed.scopeId, capabilities: caps }); return success(fixed) } })
  const ui = mount(remote); await ui.settle()
  assert.equal(ui.button('建立固定控制范围').props.disabled, true)
  ui.change('控制候选 c1', true); ui.change('控制候选 c2', true)
  assert.equal(ui.button('建立固定控制范围').props.disabled, true)
  ui.change('确认全部所选成员并授权固定控制范围', true)
  const click = ui.button('建立固定控制范围').props.onClick
  await click(); await click(); ui.render()
  assert.equal(calls.length, 1); assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { candidateIds: ['c1', 'c2'] })
  assert.match(allText(ui), /固定范围.*can:1.*can:2/)
})

test('single control uses its fixed original scope and preserves raw decimals when observation changes', async () => {
  const fixed = scope(), calls = []
  const ui = mount(baseRemote(fixed, { submitControl: async (_, request) => { calls.push(request); return success(result(fixed, request.command.action)) } })); await ui.settle()
  ui.change('目标位置（mm）', raw); ui.change('确认当前身份、目标模式及全部原始参数', true)
  ui.props.currentBinding = { targetId: 'usb:observer' }; ui.render()
  await ui.button('提交持续目标').props.onClick(); ui.render()
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ scopeId: 'fixed', command: { action: 'position', mm: raw } }])
  assert.match(allText(ui), /can:1/); assert.match(allText(ui), /usb:observer/)
})

test('group targets require independent whole-member confirmation and show each failure honestly', async () => {
  const fixed = scope([first, second]), calls = []
  const failed = result(fixed, 'position'); failed.results[1] = { ...failed.results[1], submission: 'not_submitted', error: { code: 'not_ready', message: 'second not ready' } }
  const ui = mount(baseRemote(fixed, { submitControl: async (_, request) => { calls.push(request); return success(failed) } })); await ui.settle()
  assert.equal(ui.button('提交持续目标'), undefined)
  ui.change('群组目标位置（mm）', raw)
  assert.equal(ui.button('提交群组持续目标').props.disabled, true)
  ui.change('确认全部固定成员、群组目标模式及原文参数', true)
  await ui.button('提交群组持续目标').props.onClick(); ui.render()
  assert.equal(calls.length, 1); assert.equal(calls[0].command.mm, raw)
  assert.match(allText(ui), /can:2.*not_submitted/); assert.match(allText(ui), /not_ready.*second not ready/)
})

test('top Stop bar ignores ordinary busy and protects fixed original members with a separate single flight', async () => {
  const fixed = scope([first, second]); let release, calls = 0
  const ui = mount(null, { stopBar: true, fixedScope: fixed, status: null, busy: true, onStop: async id => { assert.equal(id, 'fixed'); calls++; return new Promise(resolve => { release = () => resolve(success(result(fixed, 'stop'))) }) } })
  assert.equal(ui.button('停止固定控制范围').props.disabled, false)
  const click = ui.button('停止固定控制范围').props.onClick, pending = click()
  await click(); ui.render(); assert.equal(calls, 1)
  assert.equal(ui.button('停止固定控制范围').props.disabled, true)
  release(); await pending; ui.render()
  assert.match(allText(ui), /can:1/); assert.match(allText(ui), /can:2/); assert.match(allText(ui), /本地提交.*locally_submitted/)
})

test('a late old Stop receipt never becomes a new scope success', async () => {
  const fixed = scope(); let release
  const ui = mount(null, { stopBar: true, fixedScope: fixed, status: null, onStop: async () => new Promise(resolve => { release = () => resolve(success(result(fixed, 'stop'))) }) })
  const pending = ui.button('停止固定控制范围').props.onClick()
  ui.props.fixedScope = { ...scope([second]), scopeId: 'new' }; ui.render()
  release(); await pending; ui.render()
  assert.doesNotMatch(allText(ui), /本地提交：locally_submitted/)
  assert.equal(ui.button('停止固定控制范围').props.disabled, false)
})

test('released fixed scopes retain Stop while ordinary control remains blocked', async () => {
  const fixed = { ...scope(), state: 'released', controlReady: false, reason: 'released' }
  const ui = mount(baseRemote(fixed)); await ui.settle()
  ui.change('目标位置（mm）', raw); ui.change('确认当前身份、目标模式及全部原始参数', true)
  assert.equal(ui.button('提交持续目标').props.disabled, true)
  assert.equal(ui.button('请求普通 Stop').props.disabled, false)
})

test('hidden documents pause context polling and observation changes do not replace active scope', async () => {
  let contexts = 0
  const fixed = scope(), remote = baseRemote(fixed, { controlContext: async () => { contexts++; return success({ scopes: [fixed], activeScopeId: 'fixed', capabilities: caps }) } })
  const ui = mount(remote, { visible: false }); await ui.settle(); assert.equal(contexts, 0)
  ui.props.visible = true; ui.render(); await ui.settle(); assert.equal(contexts, 1)
  ui.props.currentBinding = { targetId: 'can:99' }; ui.render(); await ui.tick()
  assert.equal(contexts, 2); assert.match(allText(ui), /固定范围.*can:1/)
})

function trialReceipt(members, extra = {}) {
  return { members, trialId: 'registered-trial', mode: 'position', state: 'active', progress: ['SDK preflight'], results: members.map(target => ({ target, preparation: 'ready', admission: 'finished', submission: 'locally_submitted', observation: 'unconfirmed', unknown: false })), unknown: false, stopAvailable: true, recordingIds: ['record'], ...extra }
}
function fillTrial(ui, members) {
  for (const member of members) ui.change(`试验成员 ${member.targetId}`, true)
  for (const label of ['位置 mm', '位置下限 mm', '位置上限 mm', '速度绝对上限 mm/s', '力绝对上限 N', '刚度上限 N/mm', '阻尼上限 Ns/mm', '最长试验时长 s', '试验时长 s']) ui.change(label, raw)
  ui.change('启用到位条件', true); ui.change('到位容差 mm', raw); ui.change('到位持续时间 ms', '18446744073709551615')
  ui.change('确认试验成员与原文参数', true)
}

test('group trial requires all fixed members and forwards raw parameters without SDK numeric conversion', async () => {
  const fixed = scope([first, second]), calls = []
  const remote = baseRemote(fixed, { startControlTrial: async (_, request) => { calls.push(request); fixed.trial = trialReceipt([first, second]); return success(fixed.trial) } })
  const ui = mount(remote); await ui.settle(); fillTrial(ui, [first])
  assert.equal(ui.button('预检并启动试验').props.disabled, true)
  ui.change('试验成员 can:2', true); ui.change('确认试验成员与原文参数', true)
  await ui.button('预检并启动试验').props.onClick(); ui.render()
  assert.equal(calls.length, 1); assert.equal(calls[0].scopeId, 'fixed'); assert.equal(calls[0].parameters.command.positionMm, raw)
  assert.equal(calls[0].parameters.reach.settleMs, '18446744073709551615')
  assert.deepEqual(Object.keys(calls[0]).sort(), ['parameters', 'scopeId'])
})

test('trial Stop retains canonical member submission facts if later trial GET fails and does not resend', async () => {
  const fixed = scope([first, second]); fixed.trial = trialReceipt([first, second]); let stops = 0, queries = 0
  const ui = mount(baseRemote(fixed, { stopControlScope: async (_, id) => { assert.equal(id, 'fixed'); stops++; return success(result(fixed, 'stop')) }, getControlTrial: async (_, id) => { queries++; assert.equal(id, 'registered-trial'); return { ok: false, error: { message: 'trial read timeout', details: { code: 'sdk_timeout' } } } } })); await ui.settle()
  await ui.button('显式停止原试验').props.onClick(); ui.render()
  assert.equal(stops, 1); assert.equal(queries, 1)
  assert.match(allText(ui), /只读查询失败.*sdk_timeout/); assert.match(allText(ui), /can:2.*本地提交.*locally_submitted/)
  assert.doesNotMatch(allText(ui), /停止结果未知|本地提交 submission_unknown/)
})

test('releasing trial reference does not release the control scope or send Stop', async () => {
  const fixed = scope(); fixed.trial = trialReceipt([first]); let releases = 0, scopeReleases = 0, stops = 0
  const ui = mount(baseRemote(fixed, { releaseControlTrial: async (_, id) => { releases++; assert.equal(id, 'registered-trial'); fixed.trial = { ...fixed.trial, referenceReleased: true }; return success(fixed.trial) }, releaseControlScope: async () => { scopeReleases++ }, stopControlScope: async () => { stops++ } })); await ui.settle()
  await ui.button('释放原试验引用（不 Stop）').props.onClick(); ui.render()
  assert.equal(releases, 1); assert.equal(scopeReleases, 0); assert.equal(stops, 0)
  assert.match(allText(ui), /原试验引用已释放/)
  assert.equal(ui.button('请求普通 Stop').props.disabled, false)
})

test('resolved Remote control failure remains visible and never claims a successful mutation', async () => {
  const fixed = scope([first, second]); let calls = 0
  const ui = mount(baseRemote(fixed, { submitControl: async () => { calls++; return { ok: false, error: { message: 'blocked owner', details: { code: 'owner_busy' } } } } })); await ui.settle()
  ui.change('群组目标位置（mm）', raw); ui.change('确认全部固定成员、群组目标模式及原文参数', true)
  await ui.button('提交群组持续目标').props.onClick(); ui.render()
  assert.equal(calls, 1); assert.match(allText(ui), /owner_busy.*blocked owner/)
  assert.doesNotMatch(allText(ui), /群组逐台记录已返回/)
})

test('fixed scope release and recording each require distinct explicit full-member intent', async () => {
  const fixed = scope([first, second]), records = [], releases = []
  const ui = mount(baseRemote(fixed, { recordControl: async (_, request) => { records.push(request); return success(result(fixed, 'recording_start')) }, releaseControlScope: async (_, id) => { releases.push(id); fixed.state = 'released'; fixed.controlReady = false; return success(fixed) } })); await ui.settle()
  assert.equal(ui.button('执行固定范围录制动作').props.disabled, true); assert.equal(ui.button('解除整个固定范围（不 Stop）').props.disabled, true)
  ui.change('确认全部固定成员的录制动作', true)
  await ui.button('执行固定范围录制动作').props.onClick(); ui.render()
  assert.deepEqual(JSON.parse(JSON.stringify(records)), [{ scopeId: 'fixed', action: 'start' }])
  assert.equal(ui.button('解除整个固定范围（不 Stop）').props.disabled, true)
  ui.change('确认解除整个固定范围引用', true)
  await ui.button('解除整个固定范围（不 Stop）').props.onClick(); ui.render()
  assert.deepEqual(releases, ['fixed'])
})

test('workbench and Stop bar typecheck under strict TypeScript without a bundle build', () => {
  const filename = new URL('../src/client/ControlWorkbench.ts', import.meta.url).pathname, stub = '/virtual/workbench-react.d.ts'
  const options = { strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2022 }
  const host = ts.createCompilerHost(options), getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => file === stub ? ts.createSourceFile(file, `declare module 'react' { namespace React { interface ChangeEvent<T> { target:T }; function createElement(...args:any[]):any; function useEffect(effect:()=>void|(()=>void),deps?:readonly unknown[]):void; function useRef<T>(initial:T):{current:T}; function useState<T>(initial:T|(()=>T)):[T,(value:T|((previous:T)=>T))=>void] } export=React }`, languageVersion) : getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile)
  const program = ts.createProgram([filename, new URL('../src/client/RecoveryHistory.ts', import.meta.url).pathname, stub], options, host)
  assert.equal(ts.getPreEmitDiagnostics(program).map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'), '')
})

const originalScope = (extra = {}) => ({ referenceId: 'original', targetId: first.targetId, uid: first.uid, runNonce: first.runNonce, connectionGeneration: first.connectionGeneration, controlEpoch: '9007199254740997', instanceId: first.instanceId, current: false, controlGranted: true, stopRequestId: 'original-stop', ...extra })
const originalResult = original => ({ referenceId: original.referenceId, scope: original, operationId: original.stopRequestId, admission: 'finished', submission: 'locally_submitted', controlEffect: 'not_applicable', observation: 'unconfirmed', unknown: false, unknownSource: null, nativeJsonText: null, error: null })

test('original execution Stop requires explicit GET and reference choice without alias, first-item default or automatic grant', async () => {
  const original = originalScope({ current: true }), noGrant = originalScope({ current: true, referenceId: 'readonly', controlGranted: false }); let lists = 0, stops = 0
  const remote = { listOriginalStopScopes: async () => { lists++; return success({ scopes: [original, noGrant] }) }, stopOriginalScope: async (_, id) => { stops++; assert.equal(id, 'original'); return success(originalResult(original)) } }
  const ui = mount(remote, { originalStop: true, busy: true }); await ui.settle()
  assert.equal(lists, 0); assert.equal(ui.button('请求所选原执行范围 Stop').props.disabled, true)
  await ui.button('读取原执行范围').props.onClick(); ui.render()
  assert.equal(lists, 1); assert.equal(ui.named('明确选择原执行范围').props.value, '')
  ui.change('明确选择原执行范围', 'readonly'); assert.equal(ui.button('请求所选原执行范围 Stop').props.disabled, true)
  assert.match(allText(ui), /原范围.*人工.*授权/)
  ui.change('明确选择原执行范围', 'original'); assert.equal(ui.button('请求所选原执行范围 Stop').props.disabled, false)
  assert.match(allText(ui), /9007199254740997/)
  await ui.button('请求所选原执行范围 Stop').props.onClick(); ui.render()
  assert.equal(stops, 1); assert.match(allText(ui), /locally_submitted/)
})

test('original Stop result must match the full selected execution epoch and canonical Stop ID', async () => {
  const original = originalScope({ current: true }); let calls = 0
  const remote = { listOriginalStopScopes: async () => success({ scopes: [original] }), stopOriginalScope: async () => { calls++; return success({ ...originalResult(original), scope: { ...original, controlEpoch: 'different' } }) } }
  const ui = mount(remote, { originalStop: true }); await ui.button('读取原执行范围').props.onClick(); ui.render()
  ui.change('明确选择原执行范围', 'original'); await ui.button('请求所选原执行范围 Stop').props.onClick(); ui.render()
  assert.equal(calls, 1); assert.match(allText(ui), /原执行范围.*不一致/)
  assert.doesNotMatch(allText(ui), /本地提交：locally_submitted/)
})

test('old original-scope list response cannot select or disable another session', async () => {
  let release
  const original = originalScope(), remote = { listOriginalStopScopes: async () => new Promise(resolve => { release = () => resolve(success({ scopes: [original] })) }) }
  const ui = mount(remote, { originalStop: true })
  const pending = ui.button('读取原执行范围').props.onClick(); ui.render()
  ui.props.sessionId = 'different-chat'; ui.render()
  assert.equal(ui.button('读取原执行范围').props.disabled, false)
  release(); await pending; ui.render()
  assert.equal(ui.named('明确选择原执行范围').props.value, '')
  assert.doesNotMatch(allText(ui), /9007199254740997/)
})

test('expired original scope disables Stop and cleanup without replacing its route', async () => {
  const original = originalScope(), ui = mount({ listOriginalStopScopes: async () => success({ scopes: [original] }) }, { originalStop: true })
  await ui.button('读取原执行范围').props.onClick(); ui.render(); ui.change('明确选择原执行范围', 'original')
  assert.equal(ui.button('请求所选原执行范围 Stop').props.disabled, true)
  assert.equal(ui.button('停止原范围持续心跳').props.disabled, true); assert.match(allText(ui), /原执行范围已过期/)
})

test('original cleanup requires distinct intent, never sends Stop and unknown receipt only GETs its accepted ID', async () => {
  const original = originalScope({ current: true }); let cleanups = 0, stops = 0, queries = 0
  const receipt = { ...originalResult(original), action: 'heartbeat_stop', operationId: 'cleanup-original', unknown: true, unknownSource: 'transport', admission: 'attempting', submission: 'unknown' }
  const remote = { listOriginalStopScopes: async () => success({ scopes: [original] }), stopOriginalScope: async () => { stops++; return success(originalResult(original)) }, cleanupOriginalScope: async (_, request) => { cleanups++; assert.deepEqual(JSON.parse(JSON.stringify(request)), { referenceId: 'original', action: 'heartbeat_stop' }); return success(receipt) }, getOriginalScopeOperation: async (_, request) => { queries++; assert.deepEqual(JSON.parse(JSON.stringify(request)), { referenceId: 'original', operationId: 'cleanup-original', action: 'heartbeat_stop' }); return { ok: false, error: { message: 'temporary read timeout', details: { code: 'sdk_timeout' } } } } }
  const ui = mount(remote, { originalStop: true }); await ui.button('读取原执行范围').props.onClick(); ui.render(); ui.change('明确选择原执行范围', 'original')
  assert.equal(ui.button('停止原范围持续心跳').props.disabled, true)
  await ui.button('请求所选原执行范围 Stop').props.onClick(); ui.render()
  assert.equal(ui.button('停止原范围持续心跳').props.disabled, true)
  ui.change('确认停止原范围持续心跳（不发送 Stop）', true)
  assert.equal(ui.button('停止原范围记录').props.disabled, true)
  const click = ui.button('停止原范围持续心跳').props.onClick; await click(); await click(); ui.render()
  assert.equal(cleanups, 1); assert.equal(stops, 1); assert.equal(ui.button('停止原范围持续心跳').props.disabled, true)
  assert.match(allText(ui), /原动作 stop/); assert.match(allText(ui), /cleanup-original/)
  await ui.button('只读查询原操作 cleanup-original').props.onClick(); ui.render()
  assert.equal(queries, 1); assert.equal(cleanups, 1); assert.match(allText(ui), /只读查询失败.*sdk_timeout/)
  assert.match(allText(ui), /本地提交：unknown/); assert.match(allText(ui), /原动作 stop/)
})

test('original cleanup validates epoch and query ID, discards late old-session replies', async () => {
  const original = originalScope({ current: true }); let release, calls = 0
  const ui = mount({ listOriginalStopScopes: async () => success({ scopes: [original] }), cleanupOriginalScope: async () => { calls++; return new Promise(resolve => { release = () => resolve(success({ ...originalResult(original), action: 'recording_stop', operationId: 'cleanup-record' })) }) } }, { originalStop: true })
  await ui.button('读取原执行范围').props.onClick(); ui.render(); ui.change('明确选择原执行范围', 'original'); ui.change('确认停止原范围记录（不发送 Stop）', true)
  const pending = ui.button('停止原范围记录').props.onClick(); ui.render()
  assert.equal(ui.button('请求所选原执行范围 Stop').props.disabled, false)
  ui.props.sessionId = 'new-chat'; ui.render(); release(); await pending; ui.render()
  assert.equal(calls, 1); assert.doesNotMatch(allText(ui), /cleanup-record|本地提交：locally_submitted/)
  const bad = mount({ listOriginalStopScopes: async () => success({ scopes: [original] }), cleanupOriginalScope: async () => success({ ...originalResult(original), action: 'recording_stop', operationId: 'cleanup-record', scope: { ...original, controlEpoch: 'new' } }) }, { originalStop: true })
  await bad.button('读取原执行范围').props.onClick(); bad.render(); bad.change('明确选择原执行范围', 'original'); bad.change('确认停止原范围记录（不发送 Stop）', true)
  await bad.button('停止原范围记录').props.onClick(); bad.render(); assert.match(allText(bad), /不一致/); assert.doesNotMatch(allText(bad), /本地提交：locally_submitted/)
})

test('original operation GET must retain its accepted ID and can resolve a transport unknown without re-submission', async () => {
  const original = originalScope({ current: true }), receipt = { ...originalResult(original), action: 'recording_stop', operationId: 'record-cleanup', unknown: true, unknownSource: 'transport', admission: 'attempting', submission: 'unknown' }; let queries = 0, submissions = 0
  const ui = mount({ listOriginalStopScopes: async () => success({ scopes: [original] }), cleanupOriginalScope: async () => { submissions++; return success(receipt) }, getOriginalScopeOperation: async () => { queries++; return success({ ...receipt, operationId: queries === 1 ? 'wrong-id' : receipt.operationId, admission: 'finished', submission: 'locally_submitted', unknown: false, unknownSource: null }) } }, { originalStop: true })
  await ui.button('读取原执行范围').props.onClick(); ui.render(); ui.change('明确选择原执行范围', 'original'); ui.change('确认停止原范围记录（不发送 Stop）', true)
  await ui.button('停止原范围记录').props.onClick(); ui.render()
  await ui.button('只读查询原操作 record-cleanup').props.onClick(); ui.render()
  assert.match(allText(ui), /不一致/); assert.match(allText(ui), /本地提交：unknown/); assert.doesNotMatch(allText(ui), /wrong-id/)
  await ui.button('只读查询原操作 record-cleanup').props.onClick(); ui.render()
  assert.match(allText(ui), /本地提交：locally_submitted/); assert.equal(submissions, 1); assert.equal(queries, 2)
  assert.equal(ui.button('停止原范围记录').props.disabled, true)
})

test('anonymous group transport uncertainty survives scope changes and blocks every ordinary mutation, not Stop', async () => {
  const fixed = scope([first, second]), other = { ...scope(), scopeId: 'other' }; let current = fixed, submits = 0, stops = 0
  const remote = baseRemote(fixed, { controlContext: async () => success({ scopes: [fixed, other], activeScopeId: current.scopeId, capabilities: caps }), submitControl: async () => { submits++; return { ok: false, error: { message: 'lost reply', details: { code: 'sdk_timeout', unknown: true } } } }, stopControlScope: async () => { stops++; return success(result(fixed, 'stop')) } })
  const ui = mount(remote); await ui.settle()
  ui.change('群组目标位置（mm）', raw); ui.change('确认全部固定成员、群组目标模式及原文参数', true)
  await ui.button('提交群组持续目标').props.onClick(); ui.render()
  ui.change('确认全部固定成员、群组目标模式及原文参数', true)
  assert.equal(ui.button('提交群组持续目标').props.disabled, true)
  current = other; await ui.tick(); current = fixed; fixed.latest = result(fixed, 'position'); await ui.tick()
  ui.change('确认全部固定成员、群组目标模式及原文参数', true)
  await ui.button('提交群组持续目标').props.onClick(); ui.render()
  assert.equal(submits, 1)
  assert.equal(ui.button('执行群组心跳动作').props.disabled, true)
  assert.equal(ui.button('执行固定范围录制动作').props.disabled, true)
  fillTrial(ui, [first, second]); assert.equal(ui.button('预检并启动试验').props.disabled, true)
  const stopUi = mount(null, { stopBar: true, fixedScope: fixed, onStop: id => remote.stopControlScope('chat', id) })
  assert.equal(stopUi.button('停止固定控制范围').props.disabled, false)
  await stopUi.button('停止固定控制范围').props.onClick(); ui.render()
  assert.equal(stops, 1)
  assert.match(allText(ui), /UI 尚未取得本次请求的可关联回执/)
})

test('anonymous cleanup uncertainty survives reread and selection while another original scope Stop stays available', async () => {
  const original = originalScope({ current: true }), other = originalScope({ current: true, referenceId: 'other', targetId: 'can:2', uid: second.uid, stopRequestId: 'stop-other' }); let submissions = 0, stops = 0
  const ui = mount({ listOriginalStopScopes: async () => success({ scopes: [original, other] }), cleanupOriginalScope: async () => { submissions++; return { ok: false, error: { message: 'lost cleanup reply', details: { code: 'sdk_timeout', unknown: true } } } }, stopOriginalScope: async (_, id) => { stops++; return success(originalResult(id === 'other' ? other : original)) } }, { originalStop: true })
  await ui.button('读取原执行范围').props.onClick(); ui.render(); ui.change('明确选择原执行范围', 'original')
  ui.change('确认停止原范围持续心跳（不发送 Stop）', true)
  await ui.button('停止原范围持续心跳').props.onClick(); ui.render()
  ui.change('确认停止原范围持续心跳（不发送 Stop）', true)
  assert.equal(ui.button('停止原范围持续心跳').props.disabled, true)
  await ui.button('停止原范围持续心跳').props.onClick(); ui.render()
  assert.equal(submissions, 1)
  assert.equal(ui.button('读取原执行范围').props.disabled, false)
  assert.equal(ui.named('明确选择原执行范围').props.disabled, false)
  await ui.button('读取原执行范围').props.onClick(); ui.render(); ui.change('明确选择原执行范围', 'other')
  await ui.button('请求所选原执行范围 Stop').props.onClick(); ui.render(); assert.equal(stops, 1)
  ui.change('明确选择原执行范围', 'original')
  assert.equal(ui.button('停止原范围记录').props.disabled, true)
  assert.equal(ui.button('请求所选原执行范围 Stop').props.disabled, false)
  await ui.button('请求所选原执行范围 Stop').props.onClick(); ui.render(); assert.equal(stops, 2)
  assert.equal(ui.button('停止原范围持续心跳').props.disabled, true)
})

test('single, recording and trial anonymous failures stay at the parent scope after child remount', async () => {
  for (const action of ['single', 'recording', 'trial']) {
    const fixed = scope(), other = { ...scope([second]), scopeId: 'different' }; let current = fixed, submissions = 0
    const lost = async () => { submissions++; return { ok: false, error: { message: 'reply lost', details: { code: 'sdk_timeout', unknown: true } } } }
    const ui = mount(baseRemote(fixed, { controlContext: async () => success({ scopes: [fixed, other], activeScopeId: current.scopeId, capabilities: caps }), submitControl: lost, recordControl: lost, startControlTrial: lost })); await ui.settle()
    if (action === 'single') { ui.change('目标位置（mm）', raw); ui.change('确认当前身份、目标模式及全部原始参数', true); await ui.button('提交持续目标').props.onClick() }
    if (action === 'recording') { ui.change('确认全部固定成员的录制动作', true); await ui.button('执行固定范围录制动作').props.onClick() }
    if (action === 'trial') { fillTrial(ui, [first]); await ui.button('预检并启动试验').props.onClick() }
    ui.render(); current = other; await ui.tick(); current = fixed; await ui.tick()
    ui.change('目标位置（mm）', raw); ui.change('确认当前身份、目标模式及全部原始参数', true)
    assert.equal(ui.button('提交持续目标').props.disabled, true, action)
    assert.equal(ui.button('执行固定范围录制动作').props.disabled, true, action)
    assert.equal(ui.button('预检并启动试验').props.disabled, true, action)
    assert.equal(ui.button('请求普通 Stop').props.disabled, false, action)
    assert.equal(submissions, 1)
  }
})

test('registered unknown cleanup remains with original A while B Stop is explicitly selected', async () => {
  const a = originalScope({ current: true }), b = originalScope({ current: true, referenceId: 'B', uid: second.uid, stopRequestId: 'stop-B' }); let stops = 0, cleanups = 0
  const unknown = { ...originalResult(a), operationId: 'cleanup-A', action: 'heartbeat_stop', admission: 'finished', submission: 'unknown', controlEffect: 'unresolved', unknown: true, unknownSource: 'sdk' }
  const ui = mount({ listOriginalStopScopes: async () => success({ scopes: [a, b] }), cleanupOriginalScope: async () => { cleanups++; return success(unknown) }, stopOriginalScope: async (_, id) => { assert.equal(id, 'B'); stops++; return success(originalResult(b)) } }, { originalStop: true })
  await ui.button('读取原执行范围').props.onClick(); ui.render(); ui.change('明确选择原执行范围', a.referenceId)
  ui.change('确认停止原范围持续心跳（不发送 Stop）', true); await ui.button('停止原范围持续心跳').props.onClick(); ui.render()
  assert.equal(ui.named('明确选择原执行范围').props.disabled, false)
  ui.change('明确选择原执行范围', 'B'); assert.equal(ui.button('请求所选原执行范围 Stop').props.disabled, false)
  await ui.button('请求所选原执行范围 Stop').props.onClick(); ui.render(); ui.change('明确选择原执行范围', a.referenceId)
  assert.match(allText(ui), /cleanup-A/); assert.match(allText(ui), /来源 sdk/)
  assert.equal(ui.button('停止原范围持续心跳').props.disabled, true)
  assert.equal(stops, 1); assert.equal(cleanups, 1)
})

test('pending browser journal survives reload before a reply and synchronizes tabs without applying to a different instance', async () => {
  const fixed = scope([first, second]), saved = storage(); let complete, submissions = 0
  const remote = baseRemote(fixed, { submitControl: async () => { submissions++; return new Promise(resolve => { complete = () => resolve(success(result(fixed, 'position'))) }) } })
  const firstUi = mount(remote, { storage: saved }), secondUi = mount(remote, { storage: saved }); await firstUi.settle(); await secondUi.settle()
  firstUi.change('群组目标位置（mm）', raw); firstUi.change('确认全部固定成员、群组目标模式及原文参数', true)
  const pending = firstUi.button('提交群组持续目标').props.onClick()
  assert.equal(saved.length, 1)
  secondUi.storageChanged(); assert.equal(secondUi.named('群组目标位置（mm）').props.disabled, true)
  const reloaded = mount(remote, { storage: saved }); await reloaded.settle()
  assert.equal(reloaded.named('群组目标位置（mm）').props.disabled, true)
  assert.match(allText(reloaded), /这不是设备结果/)
  const otherInstance = { ...fixed, instanceId: 'new-instance', members: fixed.members.map(m => ({ ...m, target: { ...m.target, instanceId: 'new-instance' } })) }
  const different = mount(baseRemote(otherInstance), { storage: saved }); await different.settle()
  assert.equal(different.named('群组目标位置（mm）').props.disabled, false)
  complete(); await pending; assert.equal(submissions, 1); assert.equal(saved.length, 0)
  secondUi.storageChanged(); assert.equal(secondUi.named('群组目标位置（mm）').props.disabled, false)
})

test('anonymous cleanup receipt journal survives component reload and storage failure prevents a new mutation', async () => {
  const original = originalScope({ current: true }), saved = storage(); let calls = 0, stops = 0
  const remote = { listOriginalStopScopes: async () => success({ scopes: [original] }), cleanupOriginalScope: async () => { calls++; return { ok: false, error: { message: 'lost', details: { code: 'sdk_timeout', unknown: true } } } }, stopOriginalScope: async () => { stops++; return success(originalResult(original)) } }
  const firstUi = mount(remote, { originalStop: true, storage: saved }); await firstUi.button('读取原执行范围').props.onClick(); firstUi.render(); firstUi.change('明确选择原执行范围', 'original'); firstUi.change('确认停止原范围持续心跳（不发送 Stop）', true)
  await firstUi.button('停止原范围持续心跳').props.onClick(); firstUi.render()
  const reloaded = mount(remote, { originalStop: true, storage: saved }); await reloaded.button('读取原执行范围').props.onClick(); reloaded.render(); reloaded.change('明确选择原执行范围', 'original')
  assert.equal(reloaded.button('停止原范围持续心跳').props.disabled, true)
  assert.match(allText(reloaded), /UI 尚未取得/)
  await reloaded.button('请求所选原执行范围 Stop').props.onClick(); assert.equal(stops, 1); assert.equal(calls, 1)
  const failing = storage(); failing.setItem = () => { throw new Error('quota') }
  const fixed = scope([first, second]), ui = mount(baseRemote(fixed, { submitControl: async () => { calls++; return success(result(fixed, 'position')) } }), { storage: failing }); await ui.settle()
  ui.change('群组目标位置（mm）', raw); ui.change('确认全部固定成员、群组目标模式及原文参数', true); await ui.button('提交群组持续目标').props.onClick(); ui.render()
  assert.equal(calls, 1); assert.match(allText(ui), /不可写.*未发送/)
})

test('registered SDK unknown cleanup survives reload with its exact query ID and cannot clear through another scope', async () => {
  const original = originalScope({ current: true }), saved = storage(); let cleanupCalls = 0, queries = 0
  const unknown = { ...originalResult(original), action: 'heartbeat_stop', operationId: 'registered-cleanup', admission: 'finished', submission: 'unknown', controlEffect: 'unresolved', unknown: true, unknownSource: 'sdk', nativeJsonText: 'must not persist native' }
  const remote = { listOriginalStopScopes: async () => success({ scopes: [original] }), cleanupOriginalScope: async () => { cleanupCalls++; return success(unknown) }, getOriginalScopeOperation: async (_, request) => { queries++; assert.equal(request.operationId, 'registered-cleanup'); return success(unknown) } }
  const initial = mount(remote, { originalStop: true, storage: saved }); await initial.button('读取原执行范围').props.onClick(); initial.render(); initial.change('明确选择原执行范围', 'original'); initial.change('确认停止原范围持续心跳（不发送 Stop）', true); await initial.button('停止原范围持续心跳').props.onClick()
  const reloaded = mount(remote, { originalStop: true, storage: saved }); await reloaded.button('读取原执行范围').props.onClick(); reloaded.render(); reloaded.change('明确选择原执行范围', 'original')
  assert.match(allText(reloaded), /registered-cleanup/); assert.match(allText(reloaded), /来源 sdk/)
  assert.equal(reloaded.button('停止原范围持续心跳').props.disabled, true)
  assert.doesNotMatch(saved.getItem(saved.key(0)), /must not persist native/)
  await reloaded.button('只读查询原操作 registered-cleanup').props.onClick(); reloaded.render()
  assert.equal(queries, 1); assert.equal(cleanupCalls, 1); assert.equal(reloaded.button('停止原范围持续心跳').props.disabled, true)
})

test('bad_request before SDK admission clears only its own journal and permits corrected input', async () => {
  const fixed = scope([first, second]), saved = storage(); let calls = 0
  const ui = mount(baseRemote(fixed, { submitControl: async (_, request) => { calls++; return request.command.mm === 'abc' ? { ok: false, error: { message: 'invalid decimal', details: { code: 'bad_request', unknown: null } } } : success(result(fixed, 'position')) } }), { storage: saved }); await ui.settle()
  ui.change('群组目标位置（mm）', 'abc'); ui.change('确认全部固定成员、群组目标模式及原文参数', true); await ui.button('提交群组持续目标').props.onClick(); ui.render()
  assert.equal(saved.length, 0)
  ui.change('群组目标位置（mm）', '1'); ui.change('确认全部固定成员、群组目标模式及原文参数', true)
  assert.equal(ui.button('提交群组持续目标').props.disabled, false)
  await ui.button('提交群组持续目标').props.onClick(); assert.equal(calls, 2)
})

test('Host reference renewal does not clear a journal for the same SDK execution scope', async () => {
  for (const known of [false, true]) {
    const saved = storage(), original = originalScope({ current: true }), renewed = { ...original, referenceId: 'new-host-reference' }
    const unknown = { ...originalResult(original), action: 'heartbeat_stop', operationId: 'original-cleanup', admission: 'finished', submission: 'unknown', controlEffect: 'unresolved', unknown: true, unknownSource: 'sdk' }
    const firstUi = mount({ listOriginalStopScopes: async () => success({ scopes: [original] }), cleanupOriginalScope: async () => known ? success(unknown) : { ok: false, error: { message: 'lost', details: { code: 'sdk_timeout', unknown: true } } } }, { originalStop: true, storage: saved })
    await firstUi.button('读取原执行范围').props.onClick(); firstUi.render(); firstUi.change('明确选择原执行范围', original.referenceId); firstUi.change('确认停止原范围持续心跳（不发送 Stop）', true); await firstUi.button('停止原范围持续心跳').props.onClick()
    let queries = 0
    const ui = mount({ listOriginalStopScopes: async () => success({ scopes: [renewed] }), getOriginalScopeOperation: async (_, request) => { queries++; assert.equal(request.referenceId, renewed.referenceId); assert.equal(request.operationId, 'original-cleanup'); assert.equal(request.action, 'heartbeat_stop'); return success({ ...unknown, referenceId: renewed.referenceId, scope: renewed }) } }, { originalStop: true, storage: saved }); await ui.button('读取原执行范围').props.onClick(); ui.render(); ui.change('明确选择原执行范围', renewed.referenceId)
    assert.equal(ui.button('停止原范围持续心跳').props.disabled, true)
    assert.equal(ui.button('请求所选原执行范围 Stop').props.disabled, false)
    if (known) { assert.match(allText(ui), /original-cleanup/); assert.match(allText(ui), /先前 Host 引用/); assert.equal(ui.button('只读查询原操作 original-cleanup').props.disabled, false); await ui.button('只读查询原操作 original-cleanup').props.onClick(); ui.render(); assert.equal(queries, 1); assert.equal(ui.button('停止原范围持续心跳').props.disabled, true) }
  }
})

test('successful metadata refresh clears its stale failure while preserving mutation uncertainty', async () => {
  const fixed = scope(); let unavailable = true
  const ui = mount(baseRemote(fixed, { controlContext: async () => unavailable ? { ok: false, error: { message: 'service not started', details: { code: 'service_missing' } } } : success({ scopes: [fixed], activeScopeId: fixed.scopeId, capabilities: caps }), recordControl: async () => ({ ok: false, error: { message: 'record reply lost', details: { code: 'sdk_timeout', unknown: true } } }) })); await ui.settle()
  assert.match(allText(ui), /控制元数据读取失败.*service_missing/)
  unavailable = false; await ui.tick()
  assert.ok(ui.named('控制候选 c1')); assert.ok(ui.named('控制候选 c2'))
  assert.doesNotMatch(allText(ui), /控制元数据读取失败/)
  unavailable = true; ui.change('确认全部固定成员的录制动作', true)
  await ui.button('执行固定范围录制动作').props.onClick(); ui.render()
  assert.match(allText(ui), /控制元数据读取失败/); assert.match(allText(ui), /录制响应未确认.*record reply lost/)
  unavailable = false; await ui.tick()
  assert.doesNotMatch(allText(ui), /控制元数据读取失败/)
  assert.match(allText(ui), /录制响应未确认.*record reply lost/)
  assert.match(allText(ui), /UI 尚未取得本次请求的可关联回执/)
})

test('trial history follows explicit original scope Stop availability rather than old receipt or ordinary busy', async () => {
  const fixed = scope(); fixed.trial = trialReceipt([first]); let stops = 0
  const ui = mount(baseRemote(fixed, { stopControlScope: async () => { stops++; return success(result(fixed, 'stop')) }, getControlTrial: async () => success(fixed.trial) })); await ui.settle()
  const previousClick = ui.button('显式停止原试验').props.onClick
  fixed.state = 'expired'; fixed.stopAvailable = false; fixed.stopReason = '原范围属于旧服务实例；不可请求 Stop。'; await ui.tick()
  assert.equal(ui.button('显式停止原试验').props.disabled, true)
  assert.match(allText(ui), /原范围属于旧服务实例；不可请求 Stop/)
  await previousClick(); assert.equal(stops, 0)
  fixed.state = 'active'; fixed.stopAvailable = true; fixed.stopReason = null; fixed.controlReady = false; fixed.reason = '普通操作结果未知'; ui.props.busy = true; await ui.tick()
  assert.equal(ui.button('显式停止原试验').props.disabled, false)
  await ui.button('显式停止原试验').props.onClick(); assert.equal(stops, 1)
})

test('complete candidate refresh prunes invisible old selections without replacing original scopes', async () => {
  const original = scope(), sent = []; let currentCandidates = candidates
  const ui = mount(baseRemote(original, { controlCandidates: async () => success({ candidates: currentCandidates }), createControlScope: async (_, request) => { sent.push(request); return success({ ...scope(), scopeId: 'new-scope' }) } })); await ui.settle()
  ui.change('控制候选 c1', true)
  currentCandidates = candidates.map(candidate => ({ ...candidate, candidateId: `new-${candidate.candidateId}`, instanceId: 'next-instance' }))
  await ui.button('刷新控制候选与范围').props.onClick(); ui.render()
  assert.equal(ui.named('控制候选 c1'), undefined)
  ui.change('控制候选 new-c1', true)
  assert.equal(ui.named('确认全部所选成员并授权固定控制范围').props.disabled, false)
  assert.equal(ui.named('确认全部所选成员并授权固定控制范围').props.checked, false)
  assert.match(allText(ui), /固定范围 fixed/)
  ui.change('确认全部所选成员并授权固定控制范围', true)
  await ui.button('建立固定控制范围').props.onClick(); ui.render()
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ candidateIds: ['new-c1'] }])
})

test('received ordinary and trial SDK unknown remain read-only evidence after a new Host loses scopes', async () => {
  for (const kind of ['control', 'trial']) {
    const fixed = scope(), saved = storage(); let submits = 0, reads = 0
    const unknown = result(fixed, 'position', { unknown: true }); unknown.results[0] = { ...unknown.results[0], operationId: 'request5', unknown: true, unknownSource: 'sdk', submission: 'unknown', controlEffect: 'unresolved' }
    const trial = { ...trialReceipt([first]), action: 'trial_start', trialId: 'trial-unknown', unknown: true, results: unknown.results.map(member => ({ ...member, preparation: 'attempted' })) }
    const remote = baseRemote(fixed, { submitControl: async () => { submits++; return success(unknown) }, startControlTrial: async () => { submits++; return success(trial) } })
    const ui = mount(remote, { storage: saved }); await ui.settle()
    if (kind === 'control') { ui.change('目标位置（mm）', '1'); ui.change('确认当前身份、目标模式及全部原始参数', true); await ui.button('提交持续目标').props.onClick() }
    else { fillTrial(ui, [first]); await ui.button('预检并启动试验').props.onClick() }
    const reopened = mount(baseRemote(null, { controlContext: async () => { reads++; return success({ scopes: [], activeScopeId: null, capabilities: caps }) } }), { storage: saved }); await reopened.settle()
    assert.match(allText(reopened), /历史未决证据/); assert.match(allText(reopened), /request5/)
    assert.match(allText(reopened), /epoch-2/); assert.match(allText(reopened), /canonical-b1/)
    assert.match(allText(reopened), /instance/); assert.match(allText(reopened), /来源 SDK/)
    assert.match(allText(reopened), /历史不是当前授权/); assert.equal(reopened.button('提交持续目标'), undefined)
    assert.equal(submits, 1); assert.equal(reads, 1)
    const otherChat = mount(baseRemote(null), { storage: saved, sessionId: 'other-chat' }); await otherChat.settle(); assert.doesNotMatch(allText(otherChat), /request5/)
  }
})

test('context evidence retains earlier unknown after Stop and does not apply it to a different SDK instance', async () => {
  const fixed = scope(), saved = storage(), previous = result(fixed, 'force', { unknown: true })
  previous.results[0] = { ...previous.results[0], operationId: 'unknown-force', unknown: true, unknownSource: 'sdk', submission: 'unknown', controlEffect: 'unresolved' }
  fixed.lastOrdinary = previous; fixed.latest = result(fixed, 'stop')
  const ui = mount(baseRemote(fixed), { storage: saved }); await ui.settle()
  const next = { ...scope(), instanceId: 'next-instance', members: scope().members.map(member => ({ ...member, target: { ...member.target, instanceId: 'next-instance' } })) }
  const reopened = mount(baseRemote(next), { storage: saved }); await reopened.settle()
  assert.match(allText(reopened), /unknown-force/); assert.match(allText(reopened), /来源 SDK/)
  reopened.change('目标位置（mm）', '1'); reopened.change('确认当前身份、目标模式及全部原始参数', true)
  assert.equal(reopened.button('提交持续目标').props.disabled, false)
})

test('structured recording failure gives recovery guidance without claiming mechanical stop', async () => {
  const fixed = scope(), failed = result(fixed, 'recording_start')
  failed.results[0] = { ...failed.results[0], phase: 'recording', submission: 'not_submitted', controlEffect: 'not_attempted', error: { code: 'recording_failed', message: 'original failure' } }
  fixed.latest = failed
  const ui = mount(baseRemote(fixed)); await ui.settle()
  assert.match(allText(ui), /可用空间与写权限/); assert.match(allText(ui), /仅本操作明确未提交/)
  assert.match(allText(ui), /不证明机械停止/); assert.match(allText(ui), /original failure/)
})

test('anonymous ordinary pending retains readable full scope after remount without latest association', async () => {
  const fixed = scope(), saved = storage(); let submits = 0
  const remote = baseRemote(fixed, { submitControl: async () => { submits++; return { ok: false, error: { message: 'lost reply', details: { code: 'sdk_timeout', unknown: true } } } } })
  const ui = mount(remote, { storage: saved }); await ui.settle()
  ui.change('目标位置（mm）', raw); ui.change('确认当前身份、目标模式及全部原始参数', true)
  await ui.button('提交持续目标').props.onClick()
  const reopened = mount(baseRemote(null), { storage: saved }); await reopened.settle()
  assert.match(allText(reopened), /尚未取得，不能猜配最近操作/); assert.match(allText(reopened), /canonical-b1/)
  assert.match(allText(reopened), /position/); assert.match(allText(reopened), /epoch-2/)
  assert.doesNotMatch([...Array(saved.length)].map((_, i) => saved.getItem(saved.key(i))).join(''), /1\.000000059/)
  assert.equal(submits, 1)
})

test('history write failure preserves pre-POST browser pending and does not fake an unsubmitted receipt', async () => {
  const fixed = scope(), backing = storage(), saved = { ...backing, get length() { return backing.length }, setItem(key, value) { if (key.includes('received-history')) throw new Error('quota'); backing.setItem(key, value) } }
  const receipt = result(fixed, 'position', { unknown: true }); receipt.results[0] = { ...receipt.results[0], unknown: true, unknownSource: 'sdk', submission: 'unknown' }
  const ui = mount(baseRemote(fixed, { submitControl: async () => success(receipt) }), { storage: saved }); await ui.settle()
  ui.change('目标位置（mm）', '1'); ui.change('确认当前身份、目标模式及全部原始参数', true)
  await ui.button('提交持续目标').props.onClick(); ui.render()
  assert.ok([...Array(saved.length)].some((_, i) => saved.key(i).includes('ui-pending')))
  assert.match(allText(ui), /保存失败/); assert.match(allText(ui), /未知/)
  const reopened = mount(baseRemote(fixed), { storage: saved }); await reopened.settle()
  reopened.change('目标位置（mm）', '2'); reopened.change('确认当前身份、目标模式及全部原始参数', true)
  assert.equal(reopened.button('提交持续目标').props.disabled, true)
})

test('Host history is listed locally and only explicit original-ID query reads service; it never creates scope', async () => {
  const fixed = scope(), receipt = result(fixed, 'position', { unknown: true }); receipt.results[0] = { ...receipt.results[0], unknown: true, unknownSource: 'sdk', submission: 'unknown' }
  const record = { recordId: 'durable', source: 'host', kind: 'control', action: 'position', instanceId: fixed.instanceId, members: fixed.members, operationIds: ['op'], result: null, pending: true, recoveryError: null }
  let gets = 0, mutations = 0
  const ui = mount(baseRemote(null, { listRecoveryHistory: async () => success({ records: [record] }), readRecoveryRecord: async (_, request) => { gets++; assert.deepEqual(JSON.parse(JSON.stringify(request)), { recordId: 'durable' }); return success({ ...record, result: receipt }) }, createControlScope: async () => { mutations++ } })); await ui.settle()
  assert.equal(gets, 0); assert.match(allText(ui), /Host 持久索引/)
  await ui.button('只读核对原操作编号').props.onClick(); ui.render()
  assert.equal(gets, 1); assert.equal(mutations, 0); assert.match(allText(ui), /来源 SDK/)
  assert.equal(ui.button('提交持续目标'), undefined)
})

test('history resolves only exact transport never-submitted evidence and keeps SDK unknown across later Stop', async () => {
  for (const source of ['transport', 'sdk']) {
    const fixed = scope(), saved = storage(), pending = result(fixed, 'position', { unknown: true })
    pending.results[0] = { ...pending.results[0], unknown: true, unknownSource: source, submission: 'unknown', controlEffect: 'unresolved' }
    fixed.latest = pending
    const ui = mount(baseRemote(fixed), { storage: saved }); await ui.settle()
    const resolved = result(fixed, 'position'); resolved.results[0] = { ...resolved.results[0], submission: 'not_submitted', controlEffect: 'not_attempted' }
    fixed.lastOrdinary = resolved; fixed.latest = result(fixed, 'stop')
    await ui.tick()
    const reopened = mount(baseRemote(null), { storage: saved }); await reopened.settle()
    assert.equal(/position · 浏览器收到的证据/.test(allText(reopened)), source === 'sdk')
  }
})

test('only explicit known-history index removal frees capacity and unknown entries offer no removal', async () => {
  const fixed = scope(), known = result(fixed, 'position'), unknown = result(fixed, 'force', { unknown: true })
  unknown.results[0] = { ...unknown.results[0], unknown: true, unknownSource: 'sdk' }
  const make = (recordId, value) => ({ recordId, source: 'host', kind: 'control', action: value.action, instanceId: fixed.instanceId, members: fixed.members, operationIds: ['op'], result: value, pending: false, recoveryError: null })
  let removed = 0
  const ui = mount(baseRemote(null, { listRecoveryHistory: async () => success({ records: [make('known', known), make('unknown', unknown)] }), forgetRecoveryRecord: async (_, request) => { removed++; return success({ recordId: request.recordId, forgotten: true }) } })); await ui.settle()
  assert.equal(ui.button('移除已知历史索引').props.disabled, true)
  assert.equal(ui.named('确认仅移除历史索引 unknown'), undefined)
  ui.change('确认仅移除历史索引 known', true); await ui.button('移除已知历史索引').props.onClick(); ui.render()
  assert.equal(removed, 1); assert.match(allText(ui), /SDK 账本与记录文件保持原状/)
  assert.match(allText(ui), /来源 SDK/)
})

test('context history storage failure never prevents live scope Stop from being displayed or called', async () => {
  const fixed = scope(), saved = storage(), receipt = result(fixed, 'position', { unknown: true }); let stops = 0
  receipt.results[0] = { ...receipt.results[0], unknown: true, unknownSource: 'sdk', submission: 'unknown' }; fixed.latest = receipt
  saved.setItem = () => { throw new Error('quota') }
  const ui = mount(baseRemote(fixed, { stopControlScope: async () => { stops++; return success(result(fixed, 'stop')) } }), { storage: saved }); await ui.settle()
  assert.equal(ui.button('请求普通 Stop').props.disabled, false)
  await ui.button('请求普通 Stop').props.onClick(); ui.render()
  assert.equal(stops, 1); assert.match(allText(ui), /Stop 不受此存储失败阻挡/)
})

test('context trial and group previous unknown IDs persist independently of a newer Stop', async () => {
  const fixed = scope([first, second]), saved = storage(), partial = result(fixed, 'velocity', { unknown: true })
  partial.results[1] = { ...partial.results[1], admission: 'finished', submission: 'not_submitted', previousOperationId: 'prior-unknown', previousSubmission: 'unknown', previousUnknown: true }
  fixed.lastOrdinary = partial; fixed.latest = result(fixed, 'stop')
  fixed.trial = { ...trialReceipt([first, second]), action: 'trial_start', unknown: true, results: partial.results.map(member => ({ ...member, operationId: `trial-${member.target.bindingId}`, unknown: true, unknownSource: 'sdk', preparation: 'submission' })) }
  const ui = mount(baseRemote(fixed), { storage: saved }); await ui.settle()
  const reopened = mount(baseRemote(null), { storage: saved }); await reopened.settle()
  assert.match(allText(reopened), /prior-unknown/); assert.match(allText(reopened), /trial-b1/); assert.match(allText(reopened), /trial-b2/)
  assert.match(allText(reopened), /trial_start/); assert.match(allText(reopened), /canonical-b2/)
})

test('new Host recovery displays exact failure phase, IDs and explicit-GET original evidence without persisting native text', async () => {
  const fixed = scope(), saved = storage(), receipt = result(fixed, 'recording_start')
  receipt.results[0] = { ...receipt.results[0], phase: 'recording', submission: 'not_submitted', controlEffect: 'not_attempted', recordingId: 'record-failed', trialId: 'trial-original', error: { code: 'recording_failed', message: 'disk full original cause' }, nativeJsonText: 'RAW_ORIGINAL_FAILURE' }
  let record = { recordId: 'original-record', source: 'host', kind: 'control', action: 'recording_start', instanceId: fixed.instanceId, members: fixed.members, operationIds: ['op'], result: null, pending: true, recoveryError: null }
  const remote = baseRemote(null, { listRecoveryHistory: async () => success({ records: [record] }), readRecoveryRecord: async () => { record = { ...record, pending: false, result: { ...receipt, results: receipt.results.map(member => ({ ...member, nativeJsonText: null, error: { code: member.error.code, message: 'not persisted' } })) } }; return success({ ...record, result: receipt }) } })
  const ui = mount(remote, { storage: saved }); await ui.settle(); await ui.button('只读核对原操作编号').props.onClick(); ui.render()
  for (const value of ['recording_failed', 'disk full original cause', 'phase recording', 'record-failed', 'trial-original', 'RAW_ORIGINAL_FAILURE']) assert.ok(allText(ui).includes(value), value)
  assert.match(allText(ui), /可用空间与写权限/)
  await ui.tick(); await ui.tick()
  assert.match(allText(ui), /RAW_ORIGINAL_FAILURE/)
  assert.doesNotMatch([...Array(saved.length)].map((_, i) => saved.getItem(saved.key(i))).join(''), /RAW_ORIGINAL_FAILURE/)
})

test('service instance switch immediately expires old original-scope actions including stale callbacks while keeping evidence', async () => {
  const original = originalScope({ current: true }); let posts = 0
  const ui = mount({ listOriginalStopScopes: async () => success({ scopes: [original] }), stopOriginalScope: async () => { posts++; return success(originalResult(original)) }, cleanupOriginalScope: async () => { posts++; return success({ ...originalResult(original), action: 'heartbeat_stop' }) } }, { originalStop: true })
  await ui.button('读取原执行范围').props.onClick(); ui.render(); ui.change('明确选择原执行范围', 'original')
  ui.change('确认停止原范围持续心跳（不发送 Stop）', true)
  const oldStop = ui.button('请求所选原执行范围 Stop').props.onClick, oldCleanup = ui.button('停止原范围持续心跳').props.onClick
  ui.props.currentInstanceId = 'new-instance'; ui.render()
  assert.equal(ui.button('请求所选原执行范围 Stop').props.disabled, true)
  assert.equal(ui.button('停止原范围持续心跳').props.disabled, true)
  assert.match(allText(ui), /旧服务实例/); assert.match(allText(ui), /当前范围 否/)
  await oldStop(); await oldCleanup(); assert.equal(posts, 0)
  ui.props.currentInstanceId = 'instance'; ui.render()
  assert.equal(ui.button('停止原范围持续心跳').props.disabled, true, 'old confirmation must not revive after A-B-A')
})

test('history old instance disables exact GET but retains original evidence and local known-index removal', async () => {
  const fixed = scope(), receipt = result(fixed, 'position'), record = { recordId: 'historical', source: 'host', kind: 'control', action: 'position', instanceId: fixed.instanceId, members: fixed.members, operationIds: ['op'], result: receipt, pending: false, recoveryError: null }; let gets = 0
  const ui = mount(baseRemote(null, { listRecoveryHistory: async () => success({ records: [record] }), readRecoveryRecord: async () => { gets++; return success(record) } })); await ui.settle()
  const oldQuery = ui.button('只读核对原操作编号').props.onClick
  ui.props.currentInstanceId = 'new-instance'; ui.render()
  assert.equal(ui.button('只读核对原操作编号').props.disabled, true)
  assert.match(allText(ui), /旧服务实例/); assert.match(allText(ui), /historical|原编号：op/)
  assert.ok(ui.named('确认仅移除历史索引 historical'))
  await oldQuery(); assert.equal(gets, 0)
  ui.props.currentInstanceId = null; ui.render(); assert.equal(ui.button('只读核对原操作编号').props.disabled, true)
})

test('late original-scope list from an old instance cannot replace newly read current scopes', async () => {
  let release; const old = originalScope({ current: true }), next = originalScope({ current: true, referenceId: 'new-ref', instanceId: 'new-instance' }); let calls = 0
  const ui = mount({ listOriginalStopScopes: async () => { if (++calls === 1) return new Promise(resolve => { release = () => resolve(success({ scopes: [old] })) }); return success({ scopes: [next] }) } }, { originalStop: true })
  const pending = ui.button('读取原执行范围').props.onClick()
  ui.props.currentInstanceId = 'new-instance'; ui.render(); release(); await pending; ui.render()
  assert.doesNotMatch(allText(ui), /epoch 9007199254740997/)
  await ui.button('读取原执行范围').props.onClick(); ui.render(); ui.change('明确选择原执行范围', 'new-ref')
  assert.equal(ui.button('请求所选原执行范围 Stop').props.disabled, false)
  assert.match(allText(ui), /实例 new-instance.*当前范围 是/)
})


test('trial Stop successful metadata GET keeps canonical Stop receipt separate from original trial operation proof', async () => {
  const fixed = scope(); fixed.trial = trialReceipt([first])
  const stopped = result(fixed, 'stop'); stopped.results[0].operationId = 'canonical-stop'
  const original = { ...fixed.trial, results: [{ ...fixed.trial.results[0], operationId: 'original-trial', submission: 'not_submitted', controlEffect: 'not_attempted' }] }
  const ui = mount(baseRemote(fixed, { stopControlScope: async () => success(stopped), getControlTrial: async () => success(original) })); await ui.settle()
  await ui.button('显式停止原试验').props.onClick(); ui.render()
  assert.match(allText(ui), /操作 canonical-stop.*本地提交 locally_submitted/)
  assert.equal(fixed.trial.results[0].operationId === 'canonical-stop', false)
})

test('native recording error guidance uses structured action or phase in current and recovered evidence', async () => {
  for (const [action, phase, guidance] of [['recording_start', 'submission', true], ['recording_stop', 'recording', true], ['trial_start', 'recording', true], ['position', 'submission', false]]) {
    const fixed = scope(), failed = result(fixed, action)
    failed.results[0] = { ...failed.results[0], phase, submission: 'not_submitted', controlEffect: 'not_attempted', error: { code: 'recording', message: 'Permission denied (os error 13)' } }
    fixed.latest = failed
    const current = mount(baseRemote(fixed)); await current.settle()
    assert.equal(allText(current).includes('可用空间与写权限'), guidance, `current ${action}/${phase}`)
    assert.match(allText(current), /Permission denied \(os error 13\)/)
    const record = { recordId: 'native-recording', source: 'host', kind: 'control', action, instanceId: fixed.instanceId, members: fixed.members, operationIds: ['op'], result: failed, pending: false, recoveryError: null }
    const history = mount(baseRemote(null, { listRecoveryHistory: async () => success({ records: [record] }) })); await history.settle()
    assert.equal(allText(history).includes('可用空间与写权限'), guidance, `history ${action}/${phase}`)
    assert.match(allText(history), /Permission denied \(os error 13\)/)
  }
})

test('group Busy creation distinguishes registered observers from ordinary control readiness and keeps Stop available', async () => {
  const fixed = { ...scope([first, second]), controlReady: false, reason: '普通控制占用未取得：busy；保留原成员，不自动重试。' }
  const remote = baseRemote(null, { createControlScope: async () => { remote.controlContext = async () => success({ scopes: [fixed], activeScopeId: fixed.scopeId, capabilities: caps }); return success(fixed) } })
  const ui = mount(remote); await ui.settle()
  ui.change('控制候选 c1', true); ui.change('控制候选 c2', true); ui.change('确认全部所选成员并授权固定控制范围', true)
  await ui.button('建立固定控制范围').props.onClick(); ui.render()
  assert.doesNotMatch(allText(ui), /固定控制范围已建立/)
  assert.match(allText(ui), /普通控制占用未取得/); assert.match(allText(ui), /busy/)
  assert.match(allText(ui), /观察引用 active/)
  assert.equal(ui.button('提交群组持续目标').props.disabled, true)
  const bar = mount(null, { stopBar: true, fixedScope: fixed, busy: true, onStop: async () => success(result(fixed, 'stop')) })
  assert.equal(bar.button('停止固定控制范围').props.disabled, false)
})
