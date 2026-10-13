import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const shared = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/client/shared.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: shared, exports: shared.exports })
test('Remote explicit unknown survives unwrap and is visible; absent/false never invent unknown', () => {
  for (const unknown of [true, false, undefined, 'true']) {
    let caught
    try { shared.exports.valueOf({ ok: false, error: { code: 'fieldkit/service', message: 'synthetic failure', details: { code: 'sdk_timeout', unknown } } }) } catch (error) { caught = error }
    assert.equal(caught.code, 'sdk_timeout')
    assert.equal(caught.unknown, typeof unknown === 'boolean' ? unknown : undefined)
    if (unknown === true) assert.match(shared.exports.errorText(caught), /结果未知/)
    else assert.doesNotMatch(shared.exports.errorText(caught), /结果未知/)
  }
})
