import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFieldkitService } from '../src/service.js'
import { TYPERT_REMOTE } from '../lib/typert.remote-client.js'
test('report download is registered by session/readRun/format and persistence excludes transient saving phase', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fieldkit-download-')); t.after(() => rm(root, { recursive: true, force: true }))
  const native = '{"n":18446744073709551615}'
  const service = createFieldkitService({ deviceMode: 'legacy-cli', toolPath: '/synthetic/tool', reportsDir: root }, { cli: { devices: async () => [{ serial: 's' }], diagnoseUsb: async () => ({ complete: false, identity: null, evidence: [{ action: 'status', stdout: native }], error: { kind: 'process_failed', message: 'failed', action: 'status' } }) } })
  await service.listTargets('chat'); const b = await service.openTarget('chat', { targetId: 's', intent: 'connect' }); const r = await service.diagnose('chat', { bindingId: b.bindingId })
  const value = await service.downloadReport('chat', { readRunId: r.readRunId, format: 'json' })
  const parsed = TYPERT_REMOTE.descriptors.find(d => d.method === 'downloadReport').result.create().parse(value)
  const report = JSON.parse(parsed.content)
  assert.equal(report.diagnosis.phase, undefined); assert.equal(report.snapshotKind, 'collection_result_before_report_write'); assert.equal(report.diagnosis.status, 'incomplete'); assert.equal(report.diagnosis.evidence[0].stdout, native)
  assert.equal(parsed.content, await readFile(r.reports.json, 'utf8'))
  await assert.rejects(service.downloadReport('other', { readRunId: r.readRunId, format: 'json' }), /another session/)
  await assert.rejects(service.downloadReport('chat', { readRunId: r.readRunId, format: '../../token' }), /format/)
  await assert.rejects(service.downloadReport('chat', { readRunId: r.readRunId, format: 'json', path: '/etc/passwd' }), /fields/)
})
