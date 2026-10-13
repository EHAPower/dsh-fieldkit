import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFieldkitService } from '../src/service.js'
import { TYPERT_REMOTE } from '../lib/typert.remote-client.js'

const codec = method => TYPERT_REMOTE.descriptors.find(d => d.method === method).result.create()
const identity = { uid: 'a'.repeat(24), runNonce: 'b'.repeat(32) }
const nativeJsonText = ' {"value":18446744073709551615,"decimal":0.123456789} \n'

for (const kind of ['process_failed', 'identity_changed', 'malformed_json']) test(`generated Remote codecs retain legacy ${kind} partial results`, async () => {
  const processError = { name: 'Error', message: 'synthetic SDK failure', code: 1, signal: null, killed: false }
  const failure = { action: 'status', kind, message: 'synthetic first failure' }
  const original = { action: 'status', receivedAt: '2026-10-13T00:00:00.000Z', stdout: nativeJsonText, stderr: 'SDK details', exitCode: kind === 'process_failed' ? 1 : 0, error: kind === 'process_failed' ? processError : null, ...(kind === 'malformed_json' ? { parseError: 'synthetic parser error' } : {}) }
  let saved
  const service = createFieldkitService({ deviceMode: 'legacy-cli', toolPath: '/synthetic/eha-tool', reportsDir: '/synthetic/reports' }, {
    cli: { devices: async () => [{ serial: 'USB-1' }], diagnoseUsb: async () => ({ complete: false, identity, evidence: [original], error: failure }) },
    reportWriter: async (_dir, run) => { saved = run; return { markdown: '/synthetic/partial.md', json: '/synthetic/partial.json' } },
  })
  await service.listTargets('chat')
  const binding = await service.openTarget('chat', { targetId: 'USB-1', intent: 'connect' })
  const run = await service.diagnose('chat', { bindingId: binding.bindingId })
  const replies = [codec('diagnose').parse(run), codec('getReadRun').parse(await service.getReadRun('chat')), codec('getSnapshot').parse(await service.getSnapshot('chat', { bindingId: binding.bindingId })).readRun]
  for (const reply of replies) {
    assert.equal(reply.error.code, kind)
    assert.equal(reply.error.action, 'status')
    assert.equal(reply.complete, false)
    assert.equal(reply.evidence[0].stdout, nativeJsonText)
    assert.equal(reply.evidence[0].stderr, 'SDK details')
    assert.equal(reply.evidence[0].exitCode, original.exitCode)
    assert.equal(reply.reports.json, '/synthetic/partial.json')
    if (kind === 'process_failed') {
      assert.equal(reply.evidence[0].error.code, 'process_failed')
      assert.deepEqual(reply.evidence[0].processError, processError)
    }
    if (kind === 'malformed_json') assert.equal(reply.evidence[0].parseError, original.parseError)
  }
  assert.equal(saved.evidence[0].stdout, original.stdout)
})

for (const reportFails of [false, true]) test(`generated Remote codecs preserve v2 evidence and ${reportFails ? 'report failure' : 'reports'}`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'fieldkit-codec-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dataDir = join(root, 'service'); await mkdir(dataDir, { mode: 0o700 })
  const record = { protocol: 'eha-tool.service.v2', api_version: 2, instance_id: 'instance', tool_version: 'test', pid: '123', started_at_unix_ms: '1780000000000', endpoint: 'http://127.0.0.1:18080', token_file: join(dataDir, 'port-18080.token') }
  await writeFile(join(dataDir, 'port-18080.json'), JSON.stringify(record), { mode: 0o600 })
  const ownerIdentity = { uid: identity.uid, run_nonce: identity.runNonce }
  const permit = { ready: true, reason_code: null }
  const effect = { state: 'unknown', reason_code: 'unresolved_target' }
  const client = {
    describe: async () => ({ ...record, capabilities: ['instance_status', 'service_shutdown', 'binding_lease', 'binding_renew'], limits: { binding_lease_min_ms: 1000, binding_lease_max_ms: 121000 } }),
    instance: async () => ({ ...record, service_state: 'running' }),
    targets: async () => ({ instance_id: record.instance_id, discovery_limited: false, discovery_reason: null, targets: [{ target_id: 'usb:1', transport: 'usb', connected: false, identity: null, connection_generation: null, can_attach: false, can_connect: true }] }),
    bind: async () => ({ instance_id: record.instance_id, binding_id: 'owner-binding', target_id: 'usb:1', connection_generation: '9007199254740993', identity: ownerIdentity, lease_ms: 120000 }),
    snapshot: async b => ({ ...b, readiness: permit, read_permit: permit, control_effect: effect, telemetry_received_age_ms: '12', native_json_text: nativeJsonText }),
    read: async (b, action) => ({ ...b, action, read_permit: permit, control_effect: effect, source_timestamp: { clock: 'device_monotonic_us', value: '18446744073709551615' }, received_age_ms: '12', native_json_text: nativeJsonText, ...(action.startsWith('config_') ? { data_utf8: ' {"raw":0.123456789}\n', data_hex: '007fff' } : {}) }),
  }
  let saved
  const service = createFieldkitService({ serviceDataDir: dataDir, reportsDir: '/synthetic/reports' }, {
    owner: { settingsRoot: root, createClient: () => client },
    reportWriter: async (_dir, run) => { saved = run; if (reportFails) throw new Error('ENOSPC synthetic'); return { markdown: '/synthetic/report.md', json: '/synthetic/report.json' } },
  })
  await service.listTargets('chat')
  const binding = await service.openTarget('chat', { targetId: 'usb:1', intent: 'connect' })
  const run = await service.diagnose('chat', { bindingId: binding.bindingId })
  const replies = [codec('diagnose').parse(run), codec('getReadRun').parse(await service.getReadRun('chat')), codec('getSnapshot').parse(await service.getSnapshot('chat', { bindingId: binding.bindingId })).readRun]
  for (const reply of replies) {
    const item = reply.evidence[1]
    assert.deepEqual(item.readPermit, permit)
    assert.deepEqual(item.controlEffect, effect)
    assert.deepEqual(item.sourceTimestamp, { clock: 'device_monotonic_us', value: '18446744073709551615' })
    assert.equal(item.receivedAgeMs, '12')
    assert.equal(item.connectionGeneration, '9007199254740993')
    assert.equal(item.nativeJsonText, nativeJsonText)
    assert.equal(item.nativeQuality, null)
    assert.equal(reply.evidence[4].dataUtf8, ' {"raw":0.123456789}\n')
    assert.equal(reply.evidence[4].dataHex, '007fff')
    assert.equal(reply.mode, 'service-v2')
    assert.equal(reply.instanceId, 'instance')
    assert.deepEqual(reply.identity, identity)
    assert.equal(reply.complete, true)
    if (reportFails) {
      assert.equal(reply.phase, 'report_failed')
      assert.deepEqual(reply.reportError, { code: 'report_write_failed', message: 'ENOSPC synthetic' })
      assert.equal(reply.reports, null)
    } else assert.equal(reply.reports.json, '/synthetic/report.json')
  }
  assert.equal(saved.evidence[1].nativeJsonText, nativeJsonText)
})
