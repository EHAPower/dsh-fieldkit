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
