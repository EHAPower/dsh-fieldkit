import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Run with FIELDKIT_DOM_MODULES pointing to a devbox-only React/ReactDOM/jsdom installation.
test('real ReactDOM preserves one configuration editor across target epochs', { skip: !process.env.FIELDKIT_DOM_MODULES }, async () => {
  const require = createRequire(`${process.env.FIELDKIT_DOM_MODULES}/package.json`)
  const React = require('react'), { JSDOM } = require('jsdom')
  const dom = new JSDOM('<div id="root"></div>')
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = require('react-dom/client'), modules = new Map(), errors = [], originalError = console.error
  const load = url => {
    if (modules.has(url.href)) return modules.get(url.href)
    const module = { exports: {} }; modules.set(url.href, module.exports)
    vm.runInNewContext(ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
      { module, exports: module.exports, Blob, URL, document, setTimeout, clearTimeout, require: name => name === 'react' ? React : load(new URL(name.replace(/\.js$/, '.ts'), url)) })
    return module.exports
  }
  const { ConfigurationMaintenance } = load(new URL('../src/client/ConfigurationMaintenance.ts', import.meta.url))
  const root = createRoot(document.getElementById('root'))
  console.error = (...args) => errors.push(args.map(String).join(' '))
  try {
    const props = { remote: {}, sessionId: 's', binding: null, busy: false, visible: false, capabilities: [], onRefresh: async () => {} }
    const render = async binding => { await React.act(async () => root.render(React.createElement(ConfigurationMaintenance, { ...props, binding }))) }
    await render(null)
    for (const generation of ['1', '2', '3']) {
      await render({ bindingId: `b${generation}`, targetId: 'usb', instanceId: 'i', connectionGeneration: generation, identity: { uid: 'u', runNonce: 'n' }, expired: false })
      assert.equal(document.querySelectorAll('textarea').length, 1, 'old editor must be removed on epoch change')
    }
    await render(null)
    assert.equal(document.querySelectorAll('textarea').length, 1)
    assert.equal(errors.filter(line => /same key/.test(line)).length, 0, 'no duplicate sibling keys')
  } finally { await React.act(async () => root.unmount()); console.error = originalError; dom.window.close(); delete globalThis.window; delete globalThis.document; delete globalThis.IS_REACT_ACT_ENVIRONMENT }
})
