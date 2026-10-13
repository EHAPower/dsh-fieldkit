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

test('real ReactDOM keeps original cleanup controls unique after receipts and repeated read-only updates', { skip: !process.env.FIELDKIT_DOM_MODULES }, async () => {
  const require = createRequire(`${process.env.FIELDKIT_DOM_MODULES}/package.json`)
  const React = require('react'), { JSDOM } = require('jsdom')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fieldkit.test' })
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = require('react-dom/client'), modules = new Map(), errors = [], originalError = console.error
  const load = url => {
    if (modules.has(url.href)) return modules.get(url.href)
    const module = { exports: {} }; modules.set(url.href, module.exports)
    vm.runInNewContext(ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
      { module, exports: module.exports, Blob, URL, document, window, localStorage: dom.window.localStorage, setTimeout, clearTimeout, require: name => name === 'react' ? React : load(new URL(name.replace(/\.js$/, '.ts'), url)) })
    return module.exports
  }
  const { OriginalScopeStop } = load(new URL('../src/client/ControlWorkbench.ts', import.meta.url))
  const scope = { referenceId: 'original', instanceId: 'i', targetId: 'can:2', uid: 'u', runNonce: 'n', connectionGeneration: '1', controlEpoch: '2', stopRequestId: 'canonical', current: true, controlGranted: true }
  const result = action => ({ referenceId: scope.referenceId, scope, operationId: action, action, admission: 'finished', submission: 'not_submitted', controlEffect: 'not_applicable', observation: 'unconfirmed', unknown: false, unknownSource: null, error: null, nativeJsonText: null })
  let cleanupPosts = 0, gets = 0
  const remote = { listOriginalStopScopes: async () => ({ ok: true, value: { scopes: [scope] } }), cleanupOriginalScope: async (_, request) => { cleanupPosts++; return { ok: true, value: result(request.action) } }, getOriginalScopeOperation: async (_, request) => { gets++; return { ok: true, value: result(request.action) } } }
  const root = createRoot(document.getElementById('root'))
  const buttons = label => [...document.querySelectorAll('button')].filter(button => button.textContent === label)
  const click = async label => { const button = buttons(label)[0]; assert.ok(button, label); assert.equal(button.disabled, false, label); await React.act(async () => button.click()) }
  console.error = (...args) => errors.push(args.map(String).join(' '))
  try {
    const render = async () => React.act(async () => root.render(React.createElement(OriginalScopeStop, { remote, sessionId: 'chat', currentInstanceId: 'i' })))
    await render(); await click('读取原执行范围')
    await React.act(async () => { const select = document.querySelector('select'); select.value = 'original'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    for (const [action, label] of [['recording_stop', '停止原范围记录'], ['heartbeat_stop', '停止原范围持续心跳']]) {
      await React.act(async () => document.querySelector(`[aria-label="确认${label}（不发送 Stop）"]`).click())
      await click(label)
      for (let i = 0; i < 5; i++) { await click(`只读查询原操作 ${action}`); await render() }
      assert.equal(buttons('停止原范围记录').length, 1)
      assert.equal(buttons('停止原范围持续心跳').length, 1)
      assert.equal(buttons('请求所选原执行范围 Stop').length, 1)
    }
    assert.equal(cleanupPosts, 2); assert.equal(gets, 10)
    assert.equal(errors.filter(line => /same key/.test(line)).length, 0, 'cleanup and receipt sibling keys must differ')
  } finally { await React.act(async () => root.unmount()); console.error = originalError; dom.window.close(); delete globalThis.window; delete globalThis.document; delete globalThis.IS_REACT_ACT_ENVIRONMENT }
})
