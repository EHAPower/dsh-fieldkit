import test from 'node:test'
import assert from 'node:assert/strict'
import { createSnapshotTool } from '../src/snapshot-tools.js'
import { createFieldkitService } from '../src/service.js'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { readFileSync } from 'node:fs'

const exec = { agent: { id: 'chat-a' } }, identity = { uid: 'a'.repeat(24), runNonce: 'b'.repeat(32) }
const binding = { bindingId: 'human-binding', targetId: 'can:1', transport: 'can', instanceId: 'instance', identity, connectionGeneration: '9007199254740993', expired: false }
const nativeJsonText = ' {"identity":{"received_age_ms":2367512},"counter":18446744073709551615,"gain":1.000000059604644775390625}\n'
const snapshot = { ...binding, observationWarnings: [], controlEffect: { state: 'unknown', reason_code: 'unresolved_target' }, readPermit: { ready: false, reason_code: 'control_active' }, readiness: { ready: false, reasonCode: 'control_active' }, telemetryReceivedAgeMs: '42', nativeJsonText, receivedAt: '2026-10-14T00:00:00.000Z', readRun: null }
function fixture(extra = {}, mode) {
  const calls = [], service = { selectedBinding: id => { calls.push(['selectedBinding', id]); return binding }, getSnapshot: async (id, request) => { calls.push(['getSnapshot', id, request]); return snapshot }, ...extra }
  return { calls, tool: createSnapshotTool(service, mode) }
}

test('snapshot has no model target parameters and consumes only the trusted session human binding', async () => {
  const { tool, calls } = fixture(), value = await tool.execute({}, exec)
  assert.equal(tool.name, 'fieldkit_snapshot'); assert.deepEqual(Object.keys(tool.parameters.properties), [])
  assert.deepEqual(validateJsonSchemaValue(tool.parameters, {}), [])
  assert.deepEqual(calls, [['selectedBinding', 'chat-a'], ['getSnapshot', 'chat-a', { bindingId: 'human-binding' }], ['selectedBinding', 'chat-a']])
  assert.equal(value.nativeJsonText, nativeJsonText); assert.deepEqual(value.identity, identity)
  assert.equal(value.connectionGeneration, binding.connectionGeneration); assert.deepEqual(value.controlEffect, snapshot.controlEffect)
  assert.deepEqual(value.readPermit, snapshot.readPermit); assert.equal(value.telemetryReceivedAgeMs, '42')
  assert.equal(value.evidenceIsExcerpt, false)
})

test('forged session, target, binding, paths and absent trusted identity never reach the cache route', async () => {
  const { tool, calls } = fixture()
  for (const key of ['sessionId', 'bindingId', 'targetId', 'serial', 'action', 'path']) await assert.rejects(tool.execute({ [key]: 'forged' }, exec), /不接受参数/)
  for (const agent of [undefined, {}, { id: '' }, { id: 1 }, { id: 'x'.repeat(257) }]) await assert.rejects(tool.execute({}, { agent }), /可信 exec.agent.id/)
  assert.deepEqual(calls, [])
})

test('missing/expired human bindings and explicit legacy mode reject without diagnosis fallback', async () => {
  for (const selected of [null, { ...binding, expired: true }]) {
    const f = fixture({ selectedBinding: () => selected })
    await assert.rejects(f.tool.execute({}, exec), error => ['selection_required', 'binding_stale'].includes(error.code)); assert.deepEqual(f.calls, [])
  }
  const legacy = fixture({}, 'legacy-cli')
  await assert.rejects(legacy.tool.execute({}, exec), error => error.code === 'unsupported'); assert.deepEqual(legacy.calls, [])
})

test('cache failure or selection change is reported once without active reads or retries', async () => {
  let calls = 0
  const { tool } = fixture({ getSnapshot: async () => { calls++; throw Object.assign(new Error('cache timeout'), { code: 'sdk_timeout' }) } })
  await assert.rejects(tool.execute({}, exec), error => error.code === 'sdk_timeout'); assert.equal(calls, 1)
  let current = binding
  const changed = fixture({ selectedBinding: () => current, getSnapshot: async () => { current = { ...binding, bindingId: 'new-human-binding' }; return snapshot } })
  await assert.rejects(changed.tool.execute({}, exec), error => error.code === 'stale_selection')
})

test('bounded snapshot evidence preserves unknown gate facts and excludes credentials/old diagnosis evidence', async () => {
  const large = '中\n"\\\u0000'.repeat(10000), warnings = Array.from({ length: 10 }, (_, index) => ({ code: 'warning', message: '中'.repeat(1000), unknown: index === 9, token: 'secret' }))
  const { tool } = fixture({ getSnapshot: async () => ({ ...snapshot, token: 'secret', identity: { ...identity, token: 'secret' }, nativeJsonText: large, observationWarnings: warnings, readRun: { readRunId: 'previous', bindingId: binding.bindingId, status: 'complete', complete: true, evidence: [{ nativeJsonText: 'do not expose old active read' }] } }) })
  const value = await tool.execute({}, exec), rendered = tool.output.render({}, value)[0].text
  assert.ok(Buffer.byteLength(rendered) <= 8192); assert.equal(value.evidenceIsExcerpt, true); assert.equal(value.nativeTextBytes, Buffer.byteLength(large))
  assert.ok(large.startsWith(value.nativeJsonText)); assert.doesNotMatch(rendered, /secret|�|do not expose/)
  assert.equal(value.observationWarningsOmittedCount, 6); assert.equal(value.observationWarningsContainUnknown, true)
  assert.equal(value.controlEffect.state, 'unknown'); assert.equal(value.readPermit.ready, false)
  assert.equal(value.readRun.evidenceOmitted, true)
})

test('real service cache journey calls only snapshot after explicit human selection, with no read/bind/CLI fallback', async () => {
  const calls = [], ownerIdentity = { uid: identity.uid, run_nonce: identity.runNonce }, ownerTarget = { target_id: 'can:1', transport: 'can', connected: true, identity: ownerIdentity, connection_generation: binding.connectionGeneration, can_attach: true, can_connect: false }
  const service = createFieldkitService({ deviceMode: 'integration', integrationUrl: 'http://127.0.0.1:18080', integrationTokenFile: '/tmp/synthetic-token' }, { integration: {
    describe: async () => { calls.push('describe'); return { instance_id: 'instance', capabilities: [] } },
    targets: async () => { calls.push('targets'); return { instance_id: 'instance', targets: [ownerTarget] } },
    bind: async () => { calls.push('bind'); return { instance_id: 'instance', binding_id: 'owner-binding', target_id: 'can:1', identity: ownerIdentity, connection_generation: binding.connectionGeneration } },
    snapshot: async original => { calls.push(['snapshot', original.binding_id]); return { ...original, native_json_text: nativeJsonText, telemetry_received_age_ms: '42', readiness: { ready: false, reason_code: 'control_active' }, read_permit: snapshot.readPermit, control_effect: snapshot.controlEffect } },
    read: async () => { calls.push('active_read'); throw new Error('active read must not happen') },
  }, cli: { diagnoseUsb: async () => { calls.push('cli'); throw new Error('CLI must not happen') } } })
  await service.listTargets('chat-a'); const chosen = await service.openTarget('chat-a', { targetId: 'can:1', intent: 'attach', expectedIdentity: identity, connectionGeneration: binding.connectionGeneration })
  calls.length = 0
  const tool = createSnapshotTool(service, 'integration'), value = await tool.execute({}, exec)
  assert.deepEqual(calls, [['snapshot', 'owner-binding']]); assert.equal(value.bindingId, chosen.bindingId); assert.equal(value.nativeJsonText, nativeJsonText)
  await assert.rejects(tool.execute({}, { agent: { id: 'chat-b' } }), error => error.code === 'selection_required')
  assert.equal(calls.length, 1)
})

test('both bundled skills honor cache-only intent before diagnostic steps and distinguish Identity cache age', () => {
  for (const name of ['connect-check', 'state-triage']) {
    const skill = readFileSync(new URL(`../skills/${name}/SKILL.md`, import.meta.url), 'utf8')
    assert.ok(skill.indexOf('fieldkit_snapshot({})') < skill.indexOf('1. 运行 `fieldkit_devices`'))
    assert.match(skill, /不运行 `fieldkit_devices`、`fieldkit_diagnose` 或 `fieldkit_diagnose_usb`/)
    assert.match(skill, /不得为了补齐状态改做主动读取/); assert.match(skill, /Identity 缓存的接收年龄，不能称为遥测样本年龄/)
  }
})

test('escaped detach warnings cannot exceed the total snapshot JSON budget before native allocation', async () => {
  const warnings = Array.from({ length: 4 }, (_, index) => ({ code: 'detach_unconfirmed', message: '\u0001'.repeat(384), action: null, unknown: index === 3 }))
  const { tool } = fixture({ getSnapshot: async () => ({ ...snapshot, observationWarnings: warnings, nativeJsonText: '{}' }) })
  const value = await tool.execute({}, exec), rendered = tool.output.render({}, value)[0].text
  assert.ok(Buffer.byteLength(rendered) <= 8192, `final bytes=${Buffer.byteLength(rendered)}`)
  assert.equal(value.observationWarningsContainUnknown, true); assert.equal(value.observationWarnings[3].unknown, true)
  assert.equal(value.evidenceIsExcerpt, true); assert.equal(value.observationWarningsOmittedCount, 0)
  assert.equal(value.controlEffect.state, 'unknown'); assert.equal(value.bindingId, binding.bindingId)
})
