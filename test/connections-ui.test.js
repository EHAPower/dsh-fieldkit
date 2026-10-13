import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function mount(remote, options = {}) {
  const path = new URL('../src/client/Connections.ts', import.meta.url), slots = [], effects = [], cache = new Map()
  let cursor = 0, initial = true, tree
  const react = {
    createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat(Infinity).filter(v => v !== null && v !== false && v !== undefined) } },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }] },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value } },
    useEffect(effect, deps) {
      const i = cursor++, previous = slots[i], changed = !previous || !deps || deps.some((value, index) => value !== previous.deps?.[index])
      if (changed) {
        const entry = { deps, cleanup: previous?.cleanup }; slots[i] = entry
        effects.push(() => { entry.cleanup?.(); entry.cleanup = effect() })
      }
    },
  }
  const load = name => {
    if (cache.has(name)) return cache.get(name)
    const module = { exports: {} }; cache.set(name, module.exports)
    const js = ts.transpileModule(readFileSync(new URL(name, path), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    vm.runInNewContext(js, { module, exports: module.exports, setTimeout: options.setTimeout ?? setTimeout, Blob, URL, require: name => name === 'react' ? react : load(name.replace(/\.js$/, '.ts')) })
    return module.exports
  }
  const component = load('./Connections.ts')
  const render = () => {
    const mounting = initial
    cursor = 0; tree = component.Connections({ remote, sessionId: 'chat', capabilities: ['connections', 'managed_profiles'], targets: [], busy: false, refresh: async () => {}, instanceId: 'i', ...options }); initial = false
    if (!mounting) for (const effect of effects.splice(0)) effect()
  }
  const nodes = () => { const all = []; const visit = node => { if (!node || typeof node !== 'object') return; all.push(node); node.children?.forEach(visit) }; visit(tree); return all }
  render(); for (const effect of effects.splice(0)) effect()
  return {
    render, nodes,
    button: label => nodes().find(n => n.type === 'button' && n.children.includes(label)),
    field: label => nodes().find(n => n.type === 'label' && n.children.includes(label))?.children.find(n => n?.type === 'input' || n?.type === 'select'),
    status: () => nodes().find(n => n.props.role === 'status')?.children.join(''),
    switchInstance: id => { options.instanceId = id; render() },
    unmount: () => { for (const slot of slots) slot?.cleanup?.() },
  }
}
for (const method of ['connectProfile', 'changeConnection']) test(`Connections surfaces ${method} resolved Remote failure and does not report success or refresh`, async () => {
  let refreshes = 0
  const identity = { uid: 'a'.repeat(24), runNonce: 'b'.repeat(32) }
  const remote = {
    listConnections: async () => { refreshes++; return { ok: true, value: { connections: [{ connectionId: 'can:1', targetId: 'can:1', identity, connectionGeneration: '1', connected: true, snapshotJsonText: '{}', telemetryReceivedAgeMs: null }] } } },
    listProfiles: async () => ({ ok: true, value: { profiles: [{ id: 'p', name: 'P', adapter: { serial: 'a', kind: 'canable2' }, node: 1, mode: 'fd', expectedUid: null }], loadError: null, busy: false } }),
    [method]: async () => ({ ok: false, error: { code: 'fieldkit/service', details: { code: 'owner_busy', unknown: false }, message: '请附着已有服务，或先在原 owner 明确释放连接。' } }),
  }
  const ui = mount(remote); await new Promise(resolve => setImmediate(resolve)); ui.render()
  const before = refreshes
  await ui.button(method === 'connectProfile' ? '连接档案' : '断开此连接').props.onClick(); ui.render()
  const status = ui.nodes().find(n => n.props.role === 'status').children.join('')
  assert.match(status, /owner_busy/); assert.match(status, /附着已有服务/)
  assert.doesNotMatch(status, /操作完成/); assert.equal(refreshes, before)
})

const identity = { uid: 'a'.repeat(24), runNonce: 'b'.repeat(32) }
const capabilities = ['connections', 'managed_profiles', 'usb_profiles', 'advanced_can', 'can_scan', 'selected_node_connections']
const success = value => ({ ok: true, value })
function baseRemote(profiles = []) {
  return {
    listConnections: async () => success({ connections: [] }),
    listProfiles: async () => success({ profiles, loadError: null, busy: false }),
  }
}
async function ready(remote, options = {}) {
  const ui = mount(remote, { capabilities, ...options })
  await new Promise(resolve => setImmediate(resolve)); ui.render()
  return ui
}
function update(ui, label, value) {
  assert.ok(ui.field(label), `field ${label}`)
  ui.field(label).props.onChange({ target: { value } }); ui.render()
}
function allText(ui) { return ui.nodes().flatMap(node => node.children.filter(child => typeof child === 'string')).join('\n') }

test('USB profile copies complete candidate serial and saves explicit USB fields without connecting', async () => {
  const serial = `full:${'stable-serial-'.repeat(10)}`, calls = []
  const remote = { ...baseRemote(), saveProfile: async (session, profile) => { calls.push({ session, profile }); return success({ jobId: 'j-save', kind: 'profileSave', state: 'completed', profile, error: null }) } }
  const ui = await ready(remote, { targets: [{ targetId: `usb:${serial}`, label: 'USB 候选', transport: 'usb', connected: false, canAttach: false, canConnect: true, identity: null }] })
  ui.button('填写 USB 档案').props.onClick(); ui.render()
  assert.equal(ui.nodes().find(n => n.type === 'details' && n.children.some(child => child?.type === 'summary' && child.children.includes('新建 / 编辑 USB 档案'))).props.open, true)
  assert.equal(ui.field('USB 完整稳定序列号').props.value, serial)
  update(ui, 'USB 档案 ID', 'usb-workbench'); update(ui, 'USB 档案名称', '工作台 USB')
  await ui.button('创建 / 更新 USB 档案').props.onClick(); ui.render()
  assert.equal(calls.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { session: 'chat', profile: { transport: 'usb', id: 'usb-workbench', name: '工作台 USB', serial, expectedUid: null } })
  assert.doesNotMatch(allText(ui), /检查清单/)
})

test('USB UID persistence failure is distinct from the successful connection and never reconnects', async () => {
  const profile = { transport: 'usb', id: 'usb', name: 'USB', serial: 'full-serial', expectedUid: null }
  const connection = { connectionId: 'usb:full-serial', targetId: 'usb:full-serial', identity, connectionGeneration: '1', connected: true, snapshotJsonText: '{}', telemetryReceivedAgeMs: null, profileJobId: 'j-uid' }
  let connects = 0, queries = 0, listCount = 0
  const remote = {
    ...baseRemote([profile]),
    listConnections: async () => { listCount++; return success({ connections: listCount === 1 ? [] : [connection] }) },
    connectProfile: async () => { connects++; return success(connection) },
    getJob: async (_, id) => { queries++; assert.equal(id, 'j-uid'); return success({ jobId: id, kind: 'profileSave', state: 'failed', error: 'disk full' }) },
  }
  const ui = await ready(remote)
  await ui.button('连接档案').props.onClick(); ui.render()
  assert.equal(connects, 1); assert.equal(queries, 1)
  assert.match(ui.status(), /服务已报告连接建立.*UID 绑定持久化失败.*disk full/)
  assert.doesNotMatch(ui.status(), /操作完成/)
  assert.match(allText(ui), /已连接 · UID/)
})

test('advanced classic connection preserves named context and Python override', async () => {
  let received
  const remote = { ...baseRemote(), connectAdvanced: async (_, request) => { received = request; return success({ connectionId: 'can:7', targetId: 'can:7', connected: true, identity, connectionGeneration: '1', snapshotJsonText: '{}', telemetryReceivedAgeMs: null, profileJobId: null }) } }
  const ui = await ready(remote)
  update(ui, 'python-can 配置 context', 'named-workbench')
  update(ui, '高级 CAN 帧格式', 'classic')
  update(ui, 'Python 解释器覆盖（可留空）', '/existing/runtime/python')
  update(ui, '高级 CAN 单节点 0–127', '7')
  await ui.button('连接高级 CAN 单节点').props.onClick(); ui.render()
  assert.deepEqual(JSON.parse(JSON.stringify(received)), { channel: 'named-workbench', mode: 'classic', python: '/existing/runtime/python', node: 7 })
})

test('empty-network advanced scan connects only explicitly selected successful nodes and preserves partial errors', async () => {
  const scanned = { scanId: 's1', state: 'completed', nodes: [{ node: 1, identity }, { node: 3, identity }], errors: [{ node: 2, message: 'no reply', unknown: false, errorJsonText: '{}' }] }
  const batch = { connections: [{ connectionId: 'can:1', targetId: 'can:1', connected: true, identity, connectionGeneration: '1', snapshotJsonText: '{}', telemetryReceivedAgeMs: null, profileJobId: null }], errors: [{ node: 3, targetId: 'can:3', code: 'identity_changed', message: '设备已替换', unknown: true, errorJsonText: '{"reason":"changed"}' }] }
  const calls = []
  const remote = {
    ...baseRemote(),
    scanAdvanced: async (_, request) => { calls.push(['scan', request]); return success(scanned) },
    connectScannedNodes: async (_, request) => { calls.push(['connect', request]); return success({ jobId: 'j-batch', kind: 'batchConnect', state: 'completed', batch, error: null }) },
  }
  const ui = await ready(remote)
  update(ui, 'python-can 配置 context', 'existing-config')
  update(ui, '高级扫描节点（逗号分隔，最多 16）', '1,2,3')
  await ui.button('扫描高级 CAN 节点').props.onClick(); ui.render()
  assert.equal(calls.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['scan', { advanced: { channel: 'existing-config', mode: 'fd', python: null }, nodes: [1, 2, 3] }])
  assert.match(ui.status(), /2 个节点返回 Identity，1 个节点失败/)
  assert.equal(ui.button('连接所选扫描节点').props.disabled, true)
  for (const node of [1, 3]) {
    const label = ui.nodes().find(n => n.type === 'label' && n.children.some(child => typeof child === 'string' && child.startsWith(`节点 ${node} · UID`)))
    label.children.find(child => child.type === 'input').props.onChange({ target: { checked: true } }); ui.render()
  }
  await ui.button('连接所选扫描节点').props.onClick(); ui.render()
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), ['connect', { scanId: 's1', nodes: [1, 3] }])
  assert.equal(calls.length, 2)
  assert.match(ui.status(), /1 个成功，1 个失败.*未自动重试/)
  assert.doesNotMatch(ui.status(), /操作完成/)
  assert.match(allText(ui), /identity_changed：设备已替换（结果未知）/)
  assert.match(allText(ui), /no reply/)
  remote.connectScannedNodes = async () => ({ ok: false, error: { message: 'owner busy', details: { code: 'owner_busy' } } })
  await ui.button('连接所选扫描节点').props.onClick(); ui.render()
  assert.match(ui.status(), /owner_busy/)
  assert.doesNotMatch(allText(ui), /所选节点连接结果/)
})

test('managed profile scans work with no connected target and malformed node input never reaches Remote', async () => {
  const profile = { transport: 'can', id: 'managed', name: 'CAN', adapter: { kind: 'canable2', serial: 'stable' }, node: 0, mode: 'fd', expectedUid: null }, calls = []
  const remote = { ...baseRemote([profile]), scanProfile: async (_, request) => { calls.push(request); return success({ scanId: 's-profile', state: 'completed', nodes: [], errors: [] }) } }
  const ui = await ready(remote)
  update(ui, '档案扫描节点（逗号分隔，最多 16）', '0,127')
  await ui.button('按档案扫描节点').props.onClick(); ui.render()
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ profileId: 'managed', nodes: [0, 127] }])
  for (const malformed of ['1,', '-1', '1,1', '128']) {
    update(ui, '档案扫描节点（逗号分隔，最多 16）', malformed)
    await ui.button('按档案扫描节点').props.onClick(); ui.render()
    assert.doesNotMatch(ui.status(), /操作完成/)
  }
  assert.equal(calls.length, 1)
})

test('missing completion capabilities remain explicit and never expose callable advanced or USB actions', async () => {
  const ui = await ready(baseRemote(), { capabilities: ['connections', 'managed_profiles'] })
  assert.equal(ui.button('创建 / 更新 USB 档案'), undefined)
  assert.equal(ui.button('连接高级 CAN 单节点'), undefined)
  assert.match(allText(ui), /尚未提供 USB 持久档案/)
  assert.match(allText(ui), /尚未提供高级 CAN/)
})

for (const change of ['instance', 'unmount']) test(`old running scan stops polling after ${change} without cancelling or connecting devices`, async () => {
  let release, polls = 0, loads = 0
  const remote = {
    ...baseRemote(),
    listConnections: async () => { loads++; return success({ connections: [] }) },
    scanAdvanced: async () => success({ scanId: 'old-scan', state: 'running', nodes: [], errors: [] }),
    getScan: async () => { polls++; throw new Error('old scan must not be polled') },
  }
  const ui = await ready(remote, { setTimeout: resolve => { release = resolve } })
  update(ui, 'python-can 配置 context', 'existing')
  const pending = ui.button('扫描高级 CAN 节点').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(typeof release, 'function')
  if (change === 'instance') ui.switchInstance('new-instance'); else ui.unmount()
  release(); await pending
  await new Promise(resolve => setImmediate(resolve)); ui.render()
  assert.equal(polls, 0)
  assert.equal(loads, change === 'instance' ? 2 : 1)
})

for (const method of ['connectAdvanced', 'connectProfile']) test(`${method} waits for queued owner job before refreshing successful connection facts`, async () => {
  const connection = { connectionId: 'can:1', targetId: 'can:1', identity, connectionGeneration: '2', connected: true, snapshotJsonText: '{}', telemetryReceivedAgeMs: null, profileJobId: null }
  const profile = { transport: 'can', id: 'managed', name: 'CAN', adapter: { kind: 'canable2', serial: 'serial' }, node: 1, mode: 'fd', expectedUid: null }, calls = []
  let complete = false
  const remote = {
    ...baseRemote([profile]),
    listConnections: async () => { calls.push('cache'); return success({ connections: complete ? [connection] : [] }) },
    [method]: async () => { calls.push('submit'); return success({ jobId: 'j-connect', kind: 'connect', state: 'queued', error: null }) },
    getJob: async (_, id) => { calls.push('job'); assert.equal(id, 'j-connect'); complete = true; return success({ jobId: id, kind: 'connect', state: 'completed', error: null, connection }) },
  }
  const ui = await ready(remote, { setTimeout: resolve => queueMicrotask(resolve) })
  if (method === 'connectAdvanced') update(ui, 'python-can 配置 context', 'named-config')
  await ui.button(method === 'connectAdvanced' ? '连接高级 CAN 单节点' : '连接档案').props.onClick(); ui.render()
  assert.deepEqual(calls, ['cache', 'submit', 'job', 'cache'])
  assert.match(allText(ui), /已连接 · UID/)
  assert.match(ui.status(), /连接状态来自服务端刷新结果/)
})

test('failed queued CAN connection job preserves failure and never retries or claims success', async () => {
  let submits = 0, polls = 0, loads = 0
  const remote = {
    ...baseRemote(),
    listConnections: async () => { loads++; return success({ connections: [] }) },
    connectAdvanced: async () => { submits++; return success({ jobId: 'j-connect', kind: 'connect', state: 'queued', error: null }) },
    getJob: async () => { polls++; return success({ jobId: 'j-connect', kind: 'connect', state: 'failed', error: 'identity_changed: 设备身份已变化；不会恢复旧连接' }) },
  }
  const ui = await ready(remote, { setTimeout: resolve => queueMicrotask(resolve) })
  update(ui, 'python-can 配置 context', 'named-config')
  await ui.button('连接高级 CAN 单节点').props.onClick(); ui.render()
  assert.match(ui.status(), /identity_changed.*设备身份已变化/)
  assert.doesNotMatch(ui.status(), /操作完成|连接事实和 UID 档案绑定均已刷新/)
  assert.equal(submits, 1); assert.equal(polls, 1); assert.equal(loads, 1)
})

test('cache timeout cannot discard accepted USB UID job or erase its failure on later refresh', async () => {
  const profile = { transport: 'usb', id: 'usb', name: 'USB', serial: 'S', expectedUid: null }
  const connection = { connectionId: 'usb:S', targetId: 'usb:S', identity, connectionGeneration: '1', connected: true, snapshotJsonText: '{}', telemetryReceivedAgeMs: null, profileJobId: 'uid-save' }
  let queries = 0, submits = 0, loads = 0
  const remote = {
    ...baseRemote([profile]),
    listConnections: async () => {
      loads++
      if (loads === 1) return success({ connections: [] })
      if (loads === 2) return { ok: false, error: { message: 'temporary cache timeout', details: { code: 'sdk_timeout' } } }
      return success({ connections: [{ ...connection, profileJobId: null }] })
    },
    connectProfile: async () => { submits++; return success(connection) },
    getJob: async (_, id) => { queries++; assert.equal(id, 'uid-save'); return success({ jobId: id, kind: 'profileSave', state: 'failed', error: 'disk full' }) },
  }
  const ui = await ready(remote)
  await ui.button('连接档案').props.onClick(); ui.render()
  assert.equal(queries, 1)
  assert.equal(submits, 1)
  assert.match(allText(ui), /已连接 · UID/)
  assert.match(ui.status(), /sdk_timeout.*temporary cache timeout/)
  assert.match(allText(ui), /UID.*持久化失败.*disk full/)
  await ui.button('刷新连接与档案').props.onClick(); ui.render()
  assert.match(allText(ui), /UID.*持久化失败.*disk full/)
  assert.equal(queries, 1); assert.equal(submits, 1)
})

test('USB UID query timeout keeps the original task for explicit readonly recovery without reconnecting', async () => {
  const profile = { transport: 'usb', id: 'usb', name: 'USB', serial: 'S', expectedUid: null }
  const connection = { connectionId: 'usb:S', targetId: 'usb:S', identity, connectionGeneration: '1', connected: true, snapshotJsonText: '{}', telemetryReceivedAgeMs: null, profileJobId: 'uid-save' }
  let queries = 0, submits = 0, loads = 0
  const remote = {
    ...baseRemote([profile]),
    listConnections: async () => { loads++; return success({ connections: loads === 1 ? [] : [{ ...connection, profileJobId: null }] }) },
    connectProfile: async () => { submits++; return success(connection) },
    getJob: async (_, id) => {
      queries++; assert.equal(id, 'uid-save')
      if (queries === 1) return { ok: false, error: { message: 'temporary task timeout', details: { code: 'sdk_timeout' } } }
      return success({ jobId: id, kind: 'profileSave', state: 'completed', profile: { ...profile, expectedUid: identity.uid }, error: null })
    },
  }
  const ui = await ready(remote)
  await ui.button('连接档案').props.onClick(); ui.render()
  assert.match(allText(ui), /UID 任务 uid-save.*结果未知.*sdk_timeout.*temporary task timeout/)
  assert.doesNotMatch(allText(ui), /UID 绑定持久化失败/)
  assert.match(allText(ui), /已连接 · UID/)
  await ui.button('刷新连接与档案').props.onClick(); ui.render()
  assert.match(allText(ui), /UID 任务 uid-save.*结果未知/)
  assert.equal(queries, 1)
  await ui.button('查询 UID 持久任务').props.onClick(); ui.render()
  assert.match(allText(ui), /UID 任务 uid-save.*持久化任务已完成/)
  assert.doesNotMatch(allText(ui), /结果未知|持久化失败/)
  assert.equal(ui.button('查询 UID 持久任务'), undefined)
  assert.equal(queries, 2); assert.equal(submits, 1)
})

for (const transport of ['usb', 'can']) test(`editing ${transport} profile expands its form and clearing it never creates or updates a profile`, async () => {
  const profile = transport === 'usb'
    ? { transport, id: 'fixture', name: 'Saved USB', serial: 'full-stable', expectedUid: identity.uid }
    : { transport, id: 'fixture', name: 'Saved CAN', adapter: { kind: 'canable2', serial: 'full-stable' }, node: 7, mode: 'fd', expectedUid: identity.uid }
  const calls = []
  const ui = await ready({ ...baseRemote([profile]), saveProfile: async (_, candidate) => { calls.push(candidate); return success({ jobId: 'save', kind: 'profileSave', state: 'completed', profile: candidate, error: null }) } })
  const kind = transport.toUpperCase(), idLabel = transport === 'usb' ? 'USB 档案 ID' : '档案 ID'
  const details = () => ui.nodes().find(n => n.type === 'details' && n.children.some(child => child?.type === 'summary' && child.children.includes(`新建 / 编辑 ${kind} 档案`)))
  assert.equal(details().props.open, false)
  await ui.button('编辑').props.onClick(); ui.render()
  assert.equal(details().props.open, true); assert.equal(ui.field(idLabel).props.value, 'fixture')
  await ui.button(`创建 / 更新 ${kind} 档案`).props.onClick(); ui.render()
  assert.equal(calls.length, 1); assert.equal(calls[0].id, 'fixture'); assert.equal(calls[0].expectedUid, identity.uid)
  await ui.button(`清空 ${kind} 表单`).props.onClick(); ui.render()
  assert.equal(ui.field(idLabel).props.value, ''); assert.equal(calls.length, 1)
  assert.match(ui.status(), /表单已清空；尚未创建或更新档案/)
  assert.equal(ui.button(`新建 ${kind} 档案`), undefined)
})

test('new disconnected connection cache invalidates an old connected target card and explicit refresh includes parent targets', async () => {
  const identity = { uid: 'a'.repeat(24), runNonce: 'b'.repeat(32) }
  let refreshed = 0, opened = 0
  const target = { targetId: 'usb:serial', label: 'usb:serial', transport: 'usb', identity, connectionGeneration: '2', connected: true, canAttach: true, canConnect: false }
  const remote = { listConnections: async () => success({ connections: [{ connectionId: target.targetId, targetId: target.targetId, identity, connectionGeneration: '3', connected: false, snapshotJsonText: '{}' }] }) }
  const ui = mount(remote, { capabilities: ['connections'], targets: [target], openTarget: async () => opened++, refresh: async () => { refreshed++; Object.assign(target, { connected: false, connectionGeneration: '3', canAttach: false, canConnect: true }) } })
  await new Promise(resolve => setImmediate(resolve)); ui.render()
  const text = () => ui.nodes().flatMap(n => n.children.filter(v => typeof v === 'string')).join('\n')
  assert.doesNotMatch(text(), /usb · 已连接/)
  assert.match(text(), /目标列表待刷新/)
  assert.equal(ui.button('先刷新目标列表').props.disabled, true)
  assert.equal(ui.button('重新连接').props.disabled, false)
  await ui.button('刷新连接与档案').props.onClick(); ui.render()
  assert.equal(refreshed, 1); assert.equal(opened, 0)
  assert.match(text(), /usb · 未连接/)
  assert.equal(ui.button('请使用下方重新连接').props.disabled, true)
})
