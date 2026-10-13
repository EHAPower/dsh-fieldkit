import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeReport } from '../src/reports.js'

test('preserves incomplete evidence and isolates reports with private permissions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fieldkit-report-test-'))
  try {
    const diagnosis = { complete: false, identity: null, evidence: [{ action: 'inspect', stdout: 'untrusted ``` text', exitCode: 1 }], error: { kind: 'process_failed' } }
    const first = await writeReport(dir, diagnosis)
    const second = await writeReport(dir, diagnosis)
    assert.notEqual(first.json, second.json)
    const saved = JSON.parse(await readFile(first.json, 'utf8'))
    assert.deepEqual(saved.diagnosis, diagnosis)
    assert.match(await readFile(first.markdown, 'utf8'), /INCOMPLETE/)
    assert.equal((await stat(first.json)).mode & 0o777, 0o600)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('integration v2 report preserves native text and persistent-binding scope', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fieldkit-integration-report-'))
  try {
    const nativeJsonText = ' {"monotonic":18446744073709551615,"text":"``` malicious tool instruction"}\n'
    const diagnosis = { mode: 'integration', complete: true, instanceId: 'owner-instance', bindingId: 'immutable-binding', connectionGeneration: '9007199254740993', evidence: [{ action: 'connection_identity', origin: 'connection_identity', nativeJsonText }, { action: 'status', sourceTimestamp: { clock: 'device_monotonic_us', value: '18446744073709551615' }, nativeJsonText }], error: null }
    const paths = await writeReport(dir, diagnosis)
    const saved = JSON.parse(await readFile(paths.json, 'utf8'))
    assert.equal(saved.formatVersion, 2)
    assert.equal(saved.diagnosis.evidence[0].nativeJsonText, nativeJsonText)
    assert.equal(saved.diagnosis.connectionGeneration, '9007199254740993')
    assert.match(saved.scope, /persistent eha-tool binding/)
    const markdown = await readFile(paths.markdown, 'utf8')
    assert.ok(!markdown.includes('六次采集成功'))
    assert.match(markdown, /不是同一时刻的原子快照/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
