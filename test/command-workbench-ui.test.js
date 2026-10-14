import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function mount(executeCommand, selectTarget = async () => ({ ok: true, value: { target: null } })) {
  const root = new URL('../src/client/CommandWorkbench.ts', import.meta.url)
  const modules = new Map(), hooks = []
  let cursor = 0, tree
  const react = {
    Fragment: Symbol('fragment'),
    createElement(type, props, ...children) { const flat = children.flat(Infinity).filter(value => value !== false && value !== null && value !== undefined); return { type, props: { ...(props ?? {}), children: flat }, children: flat } },
    useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial; return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value }] },
    useRef(initial) { const index = cursor++; return hooks[index] ??= { current: initial } }, useMemo(factory) { return factory() }, useEffect() {},
  }
  const remote = { executeCommand, selectTarget }
  const load = url => {
    const key = String(url); if (modules.has(key)) return modules.get(key)
    const module = { exports: {} }; modules.set(key, module.exports)
    const js = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    vm.runInNewContext(js, { module, exports: module.exports, URLSearchParams, URL, Blob, navigator: { clipboard: { writeText: async () => {} } }, document: { createElement: () => ({ click() {} }) }, require: name => name === 'react' ? react : load(new URL(name.replace(/\.js$/, '.ts'), url)) })
    return module.exports
  }
  const component = load(root)
  const resolve = node => !node || typeof node !== 'object' ? node : typeof node.type === 'function' ? resolve(node.type(node.props)) : { ...node, children: node.children.map(resolve) }
  const render = () => { cursor = 0; tree = resolve(react.createElement(component.CommandWorkbench, { remote, sessionId: 'session' })) }
  const nodes = () => { const result = []; const visit = node => { if (!node || typeof node !== 'object') return; result.push(node); node.children?.forEach(visit) }; visit(tree); return result }
  const button = label => nodes().find(node => node.type === 'button' && node.children.includes(label))
  const detailsWith = label => nodes().find(node => node.type === 'details' && node.children.some(child => child?.type === 'summary' && child.children.includes(label)))
  const selectWith = label => nodes().find(node => node.type === 'select' && node.children.some(option => option?.children?.includes(label)))
  const labelInput = label => nodes().find(node => node.type === 'label' && node.children.some(child => child?.type === 'span' && child.children.includes(label)))?.children.find(node => node?.type === 'input')
  render()
  return { render, button, detailsWith, selectWith, labelInput, labels: () => nodes().filter(node => node.type === 'button').map(node => node.children.join('')), options: () => nodes().filter(node => node.type === 'select').flatMap(node => node.children.flatMap(option => option?.children ?? [])) }
}

const response = (command, bodyText = '{"ok":true}') => ({ ok: true, value: { command, method: 'GET', path: '/api/test', status: 200, ok: true, bodyText, receivedAt: 'now' } })

test('connection forms begin expanded and can be folded', () => {
  const ui = mount(async (_, request) => response(request.command))
  assert.equal(ui.detailsWith('连接设备').props.open, true)
  ui.detailsWith('连接设备').props.onToggle({ currentTarget: { open: false } }); ui.render()
  assert.equal(ui.detailsWith('连接设备').props.open, false)
})

test('GET commands send an empty body and USB discovery populates a selector without connecting', async () => {
  const calls = []
  const ui = mount(async (_, request) => { calls.push(request); return response(request.command, '{"ok":true,"devices":[{"serial":"usb-1","description":"EHA"}]}') })
  assert.ok(ui.button('枚举 USB'), ui.labels().join(',')); await ui.button('枚举 USB').props.onClick(); ui.render()
  assert.equal(JSON.stringify(calls[0]), JSON.stringify({ command: 'devices', bodyText: '', queryText: '' }))
  assert.ok(ui.selectWith('EHA · usb-1')); assert.equal(calls.length, 1)
})

test('using an existing USB session only selects the target without issuing an eha-tool command', async () => {
  const calls = [], selections = []
  const ui = mount(async (_, request) => { calls.push(request); return response(request.command) }, async (_, target) => { selections.push(target); return { ok: true, value: { target } } })
  await ui.button('使用现有 USB').props.onClick(); ui.render()
  assert.equal(calls.length, 0)
  assert.equal(JSON.stringify(selections), JSON.stringify([{ transport: 'usb', node: null, label: 'USB（现有会话）' }]))
})

test('position input preserves its JSON token and an error does not block the next command', async () => {
  const calls = []; let count = 0
  const ui = mount(async (_, request) => { calls.push(request); count++; return count === 1 ? { ok: true, value: { ...response(request.command).value, ok: false, status: 409, bodyText: '{"ok":false,"message":"native error"}' } } : response(request.command) })
  assert.ok(ui.selectWith('位置（mm）'), ui.options().join(',')); ui.selectWith('位置（mm）').props.onChange({ target: { value: 'position' } }); ui.render()
  ui.labelInput('位置（mm）').props.onChange({ target: { value: '1.000000059604644775390625e-20' } }); ui.render()
  ui.button('执行命令').props.onClick(); await new Promise(resolve => setImmediate(resolve)); ui.render(); ui.button('执行命令').props.onClick(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 2); assert.match(calls[0].bodyText, /"mm":1\.000000059604644775390625e-20/); assert.equal(calls[1].bodyText, calls[0].bodyText)
})

test('direct Stop dispatches while an ordinary command is still pending', async () => {
  const calls = []; let release
  const ui = mount(async (_, request) => { calls.push(request); if (request.command === 'action' && request.bodyText.includes('"status"')) return new Promise(resolve => { release = () => resolve(response('action')) }); return response(request.command) })
  void ui.button('执行命令').props.onClick(); await new Promise(resolve => setImmediate(resolve)); ui.render(); ui.button('直接 Stop').props.onClick(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 2); assert.match(calls[1].bodyText, /"action":"stop"/); release()
})
