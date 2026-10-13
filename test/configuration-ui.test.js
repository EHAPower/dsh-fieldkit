import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const componentPath = new URL('../src/client/Configuration.ts', import.meta.url)
const raw = '{\r\n "counter":18446744073709551615, "gain":1.000000059604644775390625, "gain":1e-999\r\n}\n'
function mount(props) {
  assert.ok(existsSync(componentPath), 'Configuration must provide the raw document workflow')
  const slots = []; let cursor = 0; let tree; const downloads = []
  const react = {
    createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false) } },
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial } },
  }
  const cache = new Map()
  const load = path => {
    if (cache.has(path)) return cache.get(path)
    const output = { exports: {} }; cache.set(path, output.exports)
    const js = ts.transpileModule(readFileSync(new URL(path, componentPath), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    vm.runInNewContext(js, {
      module: output, exports: output.exports, Blob, setTimeout: () => 0,
      URL: { createObjectURL(blob) { downloads.push(blob); return 'blob:test' }, revokeObjectURL() {} },
      document: { createElement() { return { click() {} } } },
      require(name) { return name === 'react' ? react : load(name.replace(/\.js$/, '.ts')) },
    })
    return output.exports
  }
  const module = load('./Configuration.ts')
  const render = () => { cursor = 0; tree = module.Configuration(props); return tree }
  const nodes = () => { const result = []; const visit = node => { if (!node || typeof node !== 'object') return; result.push(node); node.children?.forEach(visit) }; visit(tree); return result }
  render()
  return { module, downloads, props, render, nodes, button: title => nodes().find(n => n.type === 'button' && n.children.includes(title)) }
}

test('import, edit and export retain duplicate keys, physical decimals and wide integers as original text', async () => {
  const props = { rawText: '', onChange(value) { props.rawText = value }, onValidate: async () => ({ valid: true }) }
  const ui = mount(props)
  await ui.nodes().find(n => n.type === 'input' && n.props.type === 'file').props.onChange({ target: { files: [{ text: async () => raw }], value: 'fixture.json' } })
  assert.equal(props.rawText, raw)
  ui.render(); ui.button('导出候选原文').props.onClick()
  assert.equal(await ui.downloads[0].text(), raw)
  const edited = raw.replace('1e-999', '-0.000000000000000000000001')
  ui.nodes().find(n => n.type === 'textarea').props.onChange({ target: { value: edited } })
  assert.equal(props.rawText, edited)
})

test('Factory, Startup and User copy only the explicitly selected original record', () => {
  const records = { factory: raw, startup: ' {"u64":9007199254740993} ', user: '{"u64":9007199254740992}' }
  const props = { rawText: '', records, onChange(value) { props.rawText = value }, onValidate: async () => null }
  const ui = mount(props)
  ui.button('使用 Startup 原文').props.onClick(); assert.equal(props.rawText, records.startup)
  ui.render(); ui.button('使用 User 原文').props.onClick(); assert.equal(props.rawText, records.user)
  assert.equal(records.factory, raw)
})

test('literal differences preserve large integer and underflow tokens, and show missing lines', () => {
  const ui = mount({ rawText: '', onChange() {}, onValidate: async () => null })
  const diff = ui.module.configurationDiff('{"n":9007199254740992}\n1e-999', '{"n":9007199254740993}\n1e-1000\nextra')
  assert.equal(diff.length, 3)
  assert.equal(diff[0].before, '{"n":9007199254740992}'); assert.equal(diff[0].after, '{"n":9007199254740993}')
  assert.equal(diff[2].before, null); assert.equal(diff[2].after, 'extra')
})

test('SDK schema descriptions and reference ranges are displayed without validating the candidate', () => {
  const ui = mount({ rawText: 'not JSON', onChange() {}, onValidate: async () => null, schema: { properties: { gain: { $ref: '#/$defs/gain' } }, $defs: { gain: { type: 'number', minimum: 0, description: '单位 rpm/mm' } } } })
  const hints = ui.module.configurationSchemaHints(ui.props.schema)
  assert.equal(hints[0].path, '/gain'); assert.match(hints[0].description, /rpm\/mm/); assert.match(hints[0].constraints, /0/)
  assert.equal(ui.nodes().find(n => n.type === 'textarea').props.value, 'not JSON')
})

test('SDK validation receives the unchanged candidate and stale results are not shown for a new draft', async () => {
  let finish; let received
  const props = { rawText: raw, onChange(value) { props.rawText = value }, onValidate(value) { received = value; return new Promise(resolve => { finish = resolve }) } }
  const ui = mount(props)
  const checking = ui.button('SDK 静态校验').props.onClick()
  assert.equal(received, raw)
  props.rawText = '{}'; ui.render(); finish({ marker: 'stale-result' }); await checking; ui.render()
  assert.ok(!JSON.stringify(ui.nodes().map(n => n.children)).includes('stale-result'))
})

test('a late file import cannot replace a newer controlled candidate', async () => {
  let finish
  const props = { rawText: raw, onChange(value) { props.rawText = value }, onValidate: async () => null }
  const ui = mount(props)
  const importing = ui.nodes().find(n => n.type === 'input' && n.props.type === 'file').props.onChange({ target: { files: [{ text: () => new Promise(resolve => { finish = resolve }) }], value: 'fixture.json' } })
  props.rawText = '{"newer":9007199254740993}'; ui.render(); finish('{"old":1}'); await importing
  assert.equal(props.rawText, '{"newer":9007199254740993}')
  ui.render(); assert.equal(ui.nodes().find(n => n.type === 'textarea').props.disabled, false)
})

test('SDK rejection is shown while preserving the invalid original candidate', async () => {
  const props = { rawText: raw, onChange() {}, onValidate: async () => { throw new Error('duplicate field') } }
  const ui = mount(props)
  await ui.button('SDK 静态校验').props.onClick(); ui.render()
  assert.equal(ui.nodes().find(n => n.type === 'textarea').props.value, raw)
  assert.ok(ui.nodes().some(n => n.props.role === 'status' && n.children.some(child => String(child).includes('duplicate field'))))
})
