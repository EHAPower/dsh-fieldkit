import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const target = { instanceId: 'instance', bindingId: 'binding', targetId: 'usb:S', uid: 'a'.repeat(24), runNonce: 'b'.repeat(32), connectionGeneration: '1' }
const binding = { bindingId: target.bindingId, targetId: target.targetId, instanceId: target.instanceId, connectionGeneration: target.connectionGeneration, identity: { uid: target.uid, runNonce: target.runNonce }, expired: false }
const raw = '{ "counter":18446744073709551615,"gain":1.000000059604644775390625,"gain":1e-999 }'
const success = value => ({ ok: true, value })
const receipt = (extra = {}) => ({ operationId: 'op', grantId: 'grant', target, action: 'save_and_restart', admission: 'finished', submission: 'locally_submitted', controlEffect: 'not_applicable', observation: 'unconfirmed', phase: 'submission', unknown: false, nativeJsonText: 'SDK evidence', followUp: { reconnectRequired: true, readbackViews: ['user', 'startup'] }, error: null, ...extra })
function baseRemote(extra = {}) {
  return { maintenanceContext: async () => success({ target, grant: { grantId: 'grant', target, maintenance: true }, latestOperation: null }), validateConfiguration: async () => success({ valid: true }), ...extra }
}
// 执行真实组合组件和纯子组件，按组件位置隔离hooks；只替代React调度与定时器。
function mount(remote, extra = {}) {
  const path = new URL('../src/client/ConfigurationMaintenance.ts', import.meta.url), hooks = new Map(), modules = new Map(), effects = [], timers = new Map()
  let current, cursor, tree, timerId = 0
  const props = { remote, sessionId: 'chat', binding, busy: false, onRefresh: async () => {}, capabilities: ['maintenance', 'maintenance_permissions', 'operation_read', 'config_schema', 'config_validate', 'read_config_factory', 'read_config_user', 'read_config_startup'], visible: true, ...extra }
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
    vm.runInNewContext(js, { module, exports: module.exports, Blob, URL, document: { visibilityState: 'visible' }, setTimeout: callback => { timers.set(++timerId, callback); return timerId }, clearTimeout: id => timers.delete(id), require: name => name === 'react' ? react : load(name.replace(/\.js$/, '.ts')) })
    return module.exports
  }
  const component = load('./ConfigurationMaintenance.ts')
  const resolve = (node, location) => {
    if (!node || typeof node !== 'object') return node
    if (typeof node.type === 'function') { current = `${location}:${node.props.key ?? ''}`; if (!hooks.has(current)) hooks.set(current, []); cursor = 0; return resolve(node.type(node.props), `${location}/child`) }
    return { ...node, children: node.children.map((child, i) => resolve(child, `${location}/${i}`)) }
  }
  const render = () => { current = 'root'; if (!hooks.has(current)) hooks.set(current, []); cursor = 0; tree = resolve(component.ConfigurationMaintenance(props), 'tree'); for (const effect of effects.splice(0)) effect() }
  const nodes = () => { const result = []; const visit = node => { if (!node || typeof node !== 'object') return; result.push(node); node.children?.forEach(visit) }; visit(tree); return result }
  render()
  return { props, render, nodes, timers, button: label => nodes().find(n => n.type === 'button' && n.children.includes(label)), checkbox: label => nodes().find(n => n.type === 'input' && n.props['aria-label'] === label), async settle() { await new Promise(resolve => setImmediate(resolve)); render() }, async tick() { const entry = timers.entries().next().value; assert.ok(entry); timers.delete(entry[0]); await entry[1](); await this.settle() } }
}
const allText = ui => ui.nodes().flatMap(n => n.children.filter(x => typeof x === 'string')).join('\n')
async function candidate(ui) {
  ui.nodes().find(n => n.type === 'textarea').props.onChange({ target: { value: raw } }); ui.render()
  await ui.button('SDK 静态校验').props.onClick(); ui.render()
  ui.checkbox('确认当前目标和具体维护动作').props.onChange({ target: { checked: true } }); ui.render()
}

test('glue submits the SDK-validated complete original text once and requires explicit reconnect/readback', async () => {
  const requests = [], validations = [], reads = []
  const ui = mount(baseRemote({ validateConfiguration: async (_, value) => { validations.push(value); return success({ valid: true }) }, submitMaintenance: async (_, value) => { requests.push(value); return success(receipt()) }, readConfiguration: async (_, value) => { reads.push(value); return success({ view: value.view, target, dataUtf8: raw, dataHex: '', nativeJsonText: '{}' }) } }))
  await ui.settle(); await candidate(ui)
  assert.equal(ui.button('执行维护动作').props.disabled, false)
  await ui.button('执行维护动作').props.onClick(); ui.render()
  assert.equal(requests.length, 1); assert.equal(requests[0].rawRecordText, raw); assert.equal(validations[0], raw)
  assert.equal(reads.length, 0)
  assert.match(allText(ui), /连接.*显式重连/)
  await ui.button('读回 User').props.onClick(); ui.render()
  assert.equal(reads[0].view, 'user'); assert.equal(requests.length, 1)
})

test('configuration read adopts dataUtf8 only and native evidence never becomes a candidate record', async () => {
  const native = '{"data":9007199254740993}', ui = mount(baseRemote({ readConfiguration: async (_, request) => success({ view: request.view, target, dataUtf8: null, dataHex: 'ff00', nativeJsonText: native }) }))
  await ui.settle(); await ui.button('读取 User').props.onClick(); ui.render()
  assert.equal(ui.button('使用 User 原文').props.disabled, true)
  assert.match(allText(ui), /ff00/); assert.ok(allText(ui).includes(native))
  assert.equal(ui.nodes().find(n => n.type === 'textarea').props.value, '')
})

test('known queued maintenance polls only its registered operation and preserves receipt on read failure', async () => {
  let latest = receipt({ admission: 'queued', submission: 'not_attempted', followUp: { reconnectRequired: false, readbackViews: [] } }), submits = 0, queries = 0
  const remote = baseRemote({ maintenanceContext: async () => success({ target, grant: null, latestOperation: latest }), getMaintenanceOperation: async (_, id) => { queries++; assert.equal(id, 'op'); return { ok: false, error: { message: 'read timeout', details: { code: 'sdk_timeout' } } } }, submitMaintenance: async () => { submits++; return success(latest) } })
  const ui = mount(remote); await ui.settle()
  assert.equal(queries, 1); assert.match(allText(ui), /sdk_timeout/); assert.match(allText(ui), /not_attempted/)
  assert.doesNotMatch(allText(ui), /本地提交：unknown/)
  latest = receipt(); remote.getMaintenanceOperation = async () => { queries++; return success(latest) }
  await ui.tick(); assert.equal(submits, 0); assert.match(allText(ui), /locally_submitted/)
})

test('target epoch change rejects a delayed configuration record and clears old candidate validation', async () => {
  let release
  const ui = mount(baseRemote({ readConfiguration: async (_, request) => new Promise(resolve => { release = () => resolve(success({ view: request.view, target, dataUtf8: raw, dataHex: '', nativeJsonText: '{}' })) }) }))
  await ui.settle(); await candidate(ui)
  const pending = ui.button('读取 Startup').props.onClick()
  ui.props.binding = { ...binding, connectionGeneration: '2' }; ui.render(); await ui.settle()
  release(); await pending; ui.render()
  assert.equal(ui.nodes().find(n => n.type === 'textarea').props.value, '')
  assert.equal(ui.button('使用 Startup 原文').props.disabled, true)
  assert.equal(ui.button('执行维护动作').props.disabled, true)
})

test('late mutation receipt survives target change through the session context without replay', async () => {
  let release, latest = null, submits = 0
  const second = { ...target, bindingId: 'binding2', targetId: 'usb:T', uid: 'c'.repeat(24) }
  const remote = baseRemote({ maintenanceContext: async () => success({ target: latest ? second : target, grant: latest ? null : { grantId: 'grant', target, maintenance: true }, latestOperation: latest }), submitMaintenance: async () => { submits++; return new Promise(resolve => { release = () => { latest = receipt(); resolve(success(latest)) } }) } })
  const ui = mount(remote); await ui.settle(); await candidate(ui)
  const pending = ui.button('执行维护动作').props.onClick()
  ui.props.binding = { ...binding, bindingId: second.bindingId, targetId: second.targetId, identity: { uid: second.uid, runNonce: second.runNonce } }; ui.render()
  release(); await pending; await ui.settle()
  assert.equal(submits, 1); assert.match(allText(ui), /记录目标：usb:S/); assert.match(allText(ui), /locally_submitted/)
  assert.equal(ui.nodes().find(n => n.type === 'textarea').props.value, '')
})

test('unpublished capabilities and hidden pages do not issue maintenance context polls', async () => {
  let calls = 0
  const remote = baseRemote({ maintenanceContext: async () => { calls++; throw new Error('unavailable') } })
  const unavailable = mount(remote, { capabilities: [] }); await unavailable.settle()
  assert.equal(calls, 0); assert.match(allText(unavailable), /未发布.*maintenance/)
  const hidden = mount(remote, { visible: false }); await hidden.settle()
  assert.equal(calls, 0)
})

test('returning to an earlier target epoch cannot adopt its delayed configuration reply', async () => {
  let release
  const ui = mount(baseRemote({ readConfiguration: async (_, request) => new Promise(resolve => { release = () => resolve(success({ view: request.view, target, dataUtf8: raw, dataHex: '', nativeJsonText: '{}' })) }) }))
  await ui.settle()
  const pending = ui.button('读取 User').props.onClick()
  ui.props.binding = { ...binding, connectionGeneration: '2' }; ui.render()
  ui.props.binding = binding; ui.render()
  release(); await pending; await ui.settle()
  assert.equal(ui.button('使用 User 原文').props.disabled, true)
})

test('a pending configuration read shares the maintenance submission gate', async () => {
  let release, submits = 0
  const ui = mount(baseRemote({ readConfiguration: async (_, request) => new Promise(resolve => { release = () => resolve(success({ view: request.view, target, dataUtf8: raw, dataHex: '', nativeJsonText: '{}' })) }), submitMaintenance: async () => { submits++; return success(receipt()) } }))
  await ui.settle(); await candidate(ui)
  const pending = ui.button('读取 User').props.onClick(); ui.render()
  assert.equal(ui.button('执行维护动作').props.disabled, true)
  release(); await pending; ui.render()
  assert.equal(submits, 0)
})

test('SDK schema remains exact evidence and a resolved Remote validation rejection does not authorize save', async () => {
  const schemaText = '{ "properties": { "gain": { "description":"SDK unit","maximum":9007199254740993 } } }'
  const ui = mount(baseRemote({ configurationSchema: async () => success({ nativeJsonText: schemaText, configFormatVersion: 1 }), validateConfiguration: async () => ({ ok: false, error: { message: 'duplicate field', details: { code: 'bad_configuration' } } }) }))
  await ui.settle()
  await ui.button('读取 SDK Schema').props.onClick(); ui.render()
  assert.ok(allText(ui).includes(schemaText))
  await candidate(ui)
  assert.match(allText(ui), /bad_configuration.*duplicate field/)
  assert.equal(ui.button('执行维护动作').props.disabled, true)
  assert.equal(ui.nodes().find(n => n.type === 'textarea').props.value, raw)
})

test('glue typechecks under strict TypeScript without a bundle build', () => {
  const filename = new URL('../src/client/ConfigurationMaintenance.ts', import.meta.url).pathname, stub = '/virtual/config-maintenance-react.d.ts'
  const options = { strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2022 }
  const host = ts.createCompilerHost(options), getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => file === stub ? ts.createSourceFile(file, `declare module 'react' { namespace React { interface ChangeEvent<T> { target:T }; function createElement(...args:any[]):any; function useEffect(effect:()=>void|(()=>void),deps?:readonly unknown[]):void; function useRef<T>(initial:T):{current:T}; function useState<T>(initial:T|(()=>T)):[T,(value:T|((previous:T)=>T))=>void] } export=React }`, languageVersion) : getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile)
  const program = ts.createProgram([filename, stub], options, host)
  assert.equal(ts.getPreEmitDiagnostics(program).map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'), '')
})

for (const [code, unknown] of [['permission_denied', false], ['sdk_timeout', true]]) test(`submission ${code} remains a ${unknown ? 'conservative unknown' : 'known preflight rejection'} without fabricated operation ID`, async () => {
  let submits = 0
  const ui = mount(baseRemote({ submitMaintenance: async () => { submits++; return { ok: false, error: { message: 'fixture response', details: { code } } } } }))
  await ui.settle(); await candidate(ui)
  await ui.button('执行维护动作').props.onClick(); ui.render()
  assert.equal(submits, 1)
  assert.match(allText(ui), unknown ? /本地提交：submission_unknown/ : /本地提交：not_submitted/)
  if (!unknown) {
    assert.doesNotMatch(allText(ui), /设备效果未知/)
    ui.checkbox('确认当前目标和具体维护动作').props.onChange({ target: { checked: true } }); ui.render()
    assert.equal(ui.button('执行维护动作').props.disabled, false)
  }
  assert.equal(ui.button('查询原维护操作'), undefined)
  if (unknown) {
    ui.props.binding = { ...binding, connectionGeneration: '2' }; ui.render(); await ui.settle()
    assert.match(allText(ui), /本地提交：submission_unknown/)
    assert.equal(ui.button('执行维护动作').props.disabled, true)
  }
})

test('an earlier service run cannot erase a newer unconfirmed submission without an operation ID', async () => {
  const previous = receipt({ target: { ...target, runNonce: 'c'.repeat(32) } })
  const ui = mount(baseRemote({ maintenanceContext: async () => success({ target, grant: { grantId: 'grant', target, maintenance: true }, latestOperation: previous }), submitMaintenance: async () => ({ ok: false, error: { message: 'lost new response', details: { code: 'sdk_timeout' } } }) }))
  await ui.settle(); await candidate(ui)
  await ui.button('执行维护动作').props.onClick(); ui.render()
  assert.match(allText(ui), /本地提交：submission_unknown/)
  await ui.tick()
  assert.match(allText(ui), /本地提交：submission_unknown/)
  assert.equal(ui.button('查询原维护操作'), undefined)
})

test('anonymous new timeout never adopts a same-target same-action context receipt without proven request identity', async () => {
  for (const operationId of ['previous-op', 'another-op']) {
    const previous = receipt({ operationId, grantId: 'old-grant', admission: 'finished', submission: 'not_submitted', controlEffect: 'not_attempted', followUp: { reconnectRequired: false, readbackViews: [] } })
    let queries = 0, submits = 0
    const ui = mount(baseRemote({
      maintenanceContext: async () => success({ target, grant: { grantId: 'new-grant', target, maintenance: true }, latestOperation: previous }),
      submitMaintenance: async () => { submits++; return { ok: false, error: { message: 'new request timeout', details: { code: 'sdk_timeout' } } } },
      getMaintenanceOperation: async () => { queries++; return success(previous) },
    }))
    await ui.settle(); await candidate(ui)
    await ui.button('执行维护动作').props.onClick(); ui.render()
    assert.match(allText(ui), /submission_unknown/)
    assert.equal(ui.button('查询原维护操作'), undefined)
    await ui.tick()
    assert.match(allText(ui), /submission_unknown/)
    assert.equal(ui.button('查询原维护操作'), undefined)
    assert.equal(queries, 0); assert.equal(submits, 1)
  }
})

test('only the exact transport-unknown operation can be cleared by a definite never-submitted receipt', async () => {
  for (const kind of ['transport', 'sdk', 'other-operation', 'changed-generation']) {
    const initial = receipt({ admission: 'queued', submission: 'unknown', controlEffect: 'unresolved', unknown: true, unknownSource: kind === 'sdk' ? 'sdk' : 'transport', followUp: { reconnectRequired: false, readbackViews: [] } })
    const final = receipt({ operationId: kind === 'other-operation' ? 'another-op' : 'op', target: kind === 'changed-generation' ? { ...target, connectionGeneration: '2' } : target, admission: 'finished', submission: 'not_submitted', controlEffect: 'not_attempted', unknown: false, unknownSource: null, followUp: { reconnectRequired: false, readbackViews: [] } })
    let queries = 0
    const ui = mount(baseRemote({ maintenanceContext: async () => success({ target, grant: { grantId: 'grant', target, maintenance: true }, latestOperation: initial }), getMaintenanceOperation: async () => ++queries === 1 ? { ok: false, error: { message: 'temporary query failure', details: { code: 'sdk_timeout' } } } : success(final) }))
    await ui.settle()
    assert.match(allText(ui), /unknown/)
    await ui.button('查询原维护操作').props.onClick(); ui.render()
    await candidate(ui)
    assert.equal(ui.button('执行维护动作').props.disabled, kind !== 'transport', kind)
  }
})

test('anonymous unknown for A survives selecting and completing B then returning to A in the same session', async () => {
  const bTarget = { ...target, bindingId: 'binding-B', targetId: 'usb:B', uid: 'c'.repeat(24) }
  let currentTarget = target, latest = null, submissions = 0
  const ui = mount(baseRemote({
    maintenanceContext: async () => success({ target: currentTarget, grant: { grantId: `grant-${currentTarget.uid}`, target: currentTarget, maintenance: true }, latestOperation: latest }),
    submitMaintenance: async () => ++submissions === 1 ? { ok: false, error: { message: 'A response lost', details: { code: 'sdk_timeout' } } } : success(latest = receipt({ target: bTarget, operationId: 'operation-B', admission: 'finished', submission: 'not_submitted', controlEffect: 'not_attempted', unknown: false, followUp: { reconnectRequired: false, readbackViews: [] } })),
  }))
  await ui.settle(); await candidate(ui); await ui.button('执行维护动作').props.onClick(); ui.render()
  assert.match(allText(ui), /submission_unknown/)
  currentTarget = bTarget; ui.props.binding = { ...binding, bindingId: bTarget.bindingId, targetId: bTarget.targetId, identity: { uid: bTarget.uid, runNonce: bTarget.runNonce } }; ui.render(); await ui.settle()
  await candidate(ui); await ui.button('执行维护动作').props.onClick(); ui.render()
  assert.equal(submissions, 2)
  currentTarget = target; ui.props.binding = binding; ui.render(); await ui.settle(); await candidate(ui)
  assert.match(allText(ui), /submission_unknown/)
  assert.match(allText(ui), /A response lost/)
  assert.equal(ui.button('执行维护动作').props.disabled, true)
  assert.equal(ui.button('查询原维护操作'), undefined)
})
for (const code of ['identity_changed', 'permission_denied']) test(`terminal ${code} receipt clears stale grant and gives the specific recovery action`, async () => {
  const invalidated = [], value = receipt({ admission: 'finished', submission: 'not_submitted', controlEffect: 'not_attempted', error: { code, message: 'synthetic refusal' }, followUp: { reconnectRequired: false, readbackViews: [] } })
  let latest = null
  const ui = mount(baseRemote({ maintenanceContext: async () => success({ target, grant: { grantId: 'grant', target, maintenance: true }, latestOperation: latest }), submitMaintenance: async () => { latest = value; return success(value) } }), { onBindingInvalidated: (...args) => invalidated.push(args) })
  await ui.settle(); await candidate(ui); await ui.button('执行维护动作').props.onClick(); ui.render()
  assert.doesNotMatch(allText(ui), /当前完整身份已获 maintenance 授权/)
  assert.equal(ui.button('执行维护动作').props.disabled, true)
  assert.equal(invalidated.length, code === 'identity_changed' ? 1 : 0)
  assert.match(allText(ui), code === 'identity_changed' ? /重新选择并核对目标/ : /有效观察仍可读取.*重新人工授权/)
})
for (const code of ['permission_denied', 'identity_changed']) test(`pre-registration ${code} clears authorization even when the following context query fails`, async () => {
  let refused = false
  const invalidated = []
  const ui = mount(baseRemote({ maintenanceContext: async () => refused ? { ok: false, error: { message: 'context unavailable', details: { code: 'sdk_timeout' } } } : success({ target, grant: { grantId: 'grant', target, maintenance: true }, latestOperation: null }), submitMaintenance: async () => { refused = true; return { ok: false, error: { message: 'pre-registration refusal', details: { code, unknown: false } } } } }), { onBindingInvalidated: (...args) => invalidated.push(args) })
  await ui.settle(); await candidate(ui); await ui.button('执行维护动作').props.onClick(); ui.render()
  assert.doesNotMatch(allText(ui), /当前完整身份已获 maintenance 授权/)
  assert.match(allText(ui), /not_submitted/); assert.match(allText(ui), /context unavailable/)
  assert.equal(ui.button('执行维护动作').props.disabled, true); assert.equal(invalidated.length, code === 'identity_changed' ? 1 : 0)
})
