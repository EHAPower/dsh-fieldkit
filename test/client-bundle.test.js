import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('built browser client imports without Node process or a process polyfill', () => {
  let loaded
  const react = { createElement() {}, useEffect() {}, useRef() {}, useState() {}, useMemo() {}, useCallback() {} }
  const context = { console, setTimeout, clearTimeout, navigator: { userAgent: 'Browser' }, document: { documentElement: { style: {} }, createElement: () => ({ getContext: () => null }) } }
  context.window = { __ModuleLoader__: { load({ id, factory }) {
    assert.equal(id, '@ehapower/dsh-fieldkit')
    loaded = factory(name => { assert.equal(name, 'react'); return react })
  } } }
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), context)
  assert.equal(typeof loaded.apply, 'function')
  assert.equal(loaded.name, '@ehapower/dsh-fieldkit')
  assert.equal('process' in context, false)
  assert.equal('process' in context.window, false)
})
