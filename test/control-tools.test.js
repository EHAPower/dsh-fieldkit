import test from 'node:test'
import assert from 'node:assert/strict'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { createControlTools } from '../src/control-tools.js'

const exec = { agent: { id: 'chat' } }, raw = ' 1.000000059604644775390625e-999 '
const target = { instanceId: 'instance', bindingId: 'binding', targetId: 'can:1', uid: 'a'.repeat(24), runNonce: 'b'.repeat(32), connectionGeneration: '18446744073709551615' }
const member = { target, operationId: 'operation', admission: 'attempting', submission: 'unknown', controlEffect: 'unresolved', observation: 'unconfirmed', phase: 'submission', unknown: true, unknownSource: 'sdk', nativeJsonText: '{"wide":18446744073709551615}', previousOperationId: 'old', previousSubmission: 'unknown', previousUnknown: true, previousNativeJsonText: '{"previous":true}' }
const result = { scopeId: 'scope', action: 'position', results: [member], unknown: true, newSubmission: true }
const trial = { trialId: 'trial', members: [target], mode: 'position', state: 'active', progress: ['preflight'], results: [{ ...member, preparation: 'ready', trialState: 'active', stopObserved: false, stopConfirmationOverdue: true, elapsedMs: '9007199254740997', trialNativeJsonText: '{"trial":true}' }], unknown: true, stopAvailable: true, recordingIds: ['record'] }
const fixed = { scopeId: 'scope', instanceId: 'instance', kind: 'single', members: [{ target, grantId: 'grant' }], state: 'active', controlReady: true, reason: null, stopAvailable: true, stopReason: null, latest: { ...result, action: 'stop', unknown: false, results: [{ ...member, unknown: false, previousUnknown: false, submission: 'locally_submitted' }] }, lastOrdinary: result, trial, recordings: [{ target, active: true, failed: false, recordingId: 'record', nativeJsonText: '{}', error: null }] }
const parameters = { mode: 'position', command: Object.fromEntries(['positionMm', 'velocityMmS', 'forceN', 'equilibriumMm', 'stiffnessNPerMm', 'dampingNsPerMm'].map(key => [key, raw])), envelope: Object.fromEntries(['positionMinMm', 'positionMaxMm', 'velocityAbsMaxMmS', 'forceAbsMaxN', 'stiffnessMaxNPerMm', 'dampingMaxNsPerMm', 'durationMaxS'].map(key => [key, raw])), durationS: raw, reach: { toleranceMm: raw, settleMs: '18446744073709551615' } }
function fixture(overrides = {}) {
  const calls = [], service = Object.fromEntries(['controlContext', 'submitControl', 'stopControlScope', 'startControlTrial', 'getControlTrial', 'updateControlTrial', 'recordControl'].map(name => [name, async (...args) => { calls.push([name, ...args]); return name === 'controlContext' ? { scopes: [fixed], activeScopeId: 'scope', capabilities: ['control_scopes'] } : name.includes('Trial') ? trial : result }]))
  return { calls, tools: createControlTools({ ...service, ...overrides }) }
}
const requests = [{}, { scopeId: 'scope', command: { action: 'position', mm: raw } }, { scopeId: 'scope' }, { scopeId: 'scope', parameters }, { trialId: 'trial' }, { trialId: 'trial', positionRaw: raw }, { scopeId: 'scope', action: 'start' }]

test('seven fixed tools consume human scopes and use only trusted exec session', async () => {
  const { tools, calls } = fixture()
  assert.deepEqual(tools.map(tool => tool.name), ['fieldkit_control_context', 'fieldkit_control', 'fieldkit_stop', 'fieldkit_trial', 'fieldkit_trial_status', 'fieldkit_trial_target', 'fieldkit_recording'])
  for (let i = 0; i < tools.length; i++) { await tools[i].execute(requests[i], exec); await assert.rejects(tools[i].execute(requests[i], {}), /可信 exec.agent.id/) }
  assert.equal(calls.length, 7); assert.ok(calls.every(call => call[1] === 'chat'))
  assert.deepEqual(calls[1][2], requests[1]); assert.deepEqual(calls[3][2], requests[3]); assert.equal(calls[5][2].positionRaw, raw)
  assert.match(tools[1].description, /用户明确请求/)
})

test('every SDK command forwards raw strings once without numeric roundtrip', async () => {
  const { tools, calls } = fixture()
  for (const command of [{ action: 'position', mm: raw }, { action: 'velocity', mm_s: raw }, { action: 'force', n: raw }, { action: 'impedance', equilibrium_mm: raw, stiffness_n_per_mm: raw, damping_ns_per_mm: raw }, ...['start', 'stop', 'once'].map(action => ({ action: `heartbeat_${action}` }))]) await tools[1].execute({ scopeId: 'scope', command }, exec)
  assert.equal(calls.length, 7); assert.equal(calls[3][2].command.stiffness_n_per_mm, raw)
})

test('unknown arguments and nested fields or non-string values never reach service', async () => {
  const { tools, calls } = fixture()
  for (let i = 0; i < tools.length; i++) await assert.rejects(tools[i].execute({ ...requests[i], sessionId: 'forged' }, exec))
  for (const command of [{ action: 'position', mm: raw, targetId: 'forged' }, { action: 'position', mm: 1 }, { action: 'toString' }, { action: 'heartbeat_start', mm: raw }]) await assert.rejects(tools[1].execute({ scopeId: 'scope', command }, exec))
  for (const changed of [{ ...parameters, extra: true }, { ...parameters, command: { ...parameters.command, token: 'x' } }, { ...parameters, envelope: { ...parameters.envelope, forceAbsMaxN: 1 } }, { ...parameters, reach: { ...parameters.reach, extra: true } }]) await assert.rejects(tools[3].execute({ scopeId: 'scope', parameters: changed }, exec))
  await assert.rejects(tools[5].execute({ trialId: 'trial', positionRaw: 1 }, exec)); await assert.rejects(tools[6].execute({ scopeId: 'scope', action: 'stop_control' }, exec))
  assert.equal(calls.length, 0)
})

test('mutation transport or admission failure propagates without retry', async () => {
  for (const [index, method] of [[1, 'submitControl'], [2, 'stopControlScope'], [3, 'startControlTrial'], [5, 'updateControlTrial'], [6, 'recordControl']]) {
    let calls = 0; const error = new Error('result_unknown'), { tools } = fixture({ [method]: async () => { calls++; throw error } })
    await assert.rejects(tools[index].execute(requests[index], exec), value => value === error); assert.equal(calls, 1)
  }
})

test('whitelist preserves stages, last ordinary unknown, previous operations and trial metadata', async () => {
  const { tools } = fixture()
  const context = await tools[0].execute({}, exec), scope = context.scopes[0]
  assert.equal(scope.lastOrdinary.results[0].previousUnknown, true); assert.equal(context.containsUnknown, true); assert.equal(context.containsPreviousUnknown, true)
  assert.equal(scope.lastOrdinary.results[0].previousNativeJsonText, '{"previous":true}')
  assert.equal(scope.trial.results[0].stopConfirmationOverdue, true); assert.equal(scope.trial.results[0].stopObserved, false)
  assert.equal(scope.trial.results[0].elapsedMs, '9007199254740997'); assert.equal(scope.trial.results[0].trialNativeJsonText, '{"trial":true}')
  assert.equal(scope.recordings[0].active, true); assert.equal(scope.members[0].target.connectionGeneration, '18446744073709551615')
})

test('escaped native evidence and large scope metadata share final eight KiB with explicit omissions', async () => {
  const nativeJsonText = '中\n"\\\u0000'.repeat(10000), poisoned = { ...member, nativeJsonText, token: 'secret', target: { ...target, tokenFile: '/secret' } }
  const { tools } = fixture({ submitControl: async () => ({ ...result, results: [poisoned], token: 'secret' }), controlContext: async () => ({ activeScopeId: 'scope', capabilities: ['control_scopes'], scopes: Array.from({ length: 100 }, (_, i) => ({ ...fixed, scopeId: `scope-${i}`, latest: { ...result, results: Array.from({ length: 50 }, () => poisoned) }, lastOrdinary: result })) }) })
  for (const [tool, request] of [[tools[0], {}], [tools[1], requests[1]]]) {
    const value = await tool.execute(request, exec), rendered = tool.output.render(request, value)[0].text
    assert.ok(Buffer.byteLength(rendered) <= 8192); assert.equal(value.evidenceIsExcerpt, true); assert.equal(value.containsUnknown, true); assert.equal(value.containsPreviousUnknown, true)
    assert.doesNotMatch(rendered, /secret|�/)
    if (value.results) { assert.ok(nativeJsonText.startsWith(value.results[0].nativeJsonText)); assert.equal(value.results[0].nativeJsonTextBytes, Buffer.byteLength(nativeJsonText)) }
    else assert.ok(value.scopesOmittedCount > 0 || value.scopes.some(scope => scope.latest.resultsOmittedCount > 0))
  }
})

test('context excerpts prioritize the explicit active scope rather than substituting the first scope', async () => {
  const { tools } = fixture({ controlContext: async () => ({ scopes: [...Array.from({ length: 40 }, (_, index) => ({ ...fixed, scopeId: `history-${index}` })), { ...fixed, scopeId: 'chosen' }], activeScopeId: 'chosen', capabilities: [] }) })
  const value = await tools[0].execute({}, exec)
  assert.equal(value.activeScopeId, 'chosen'); assert.equal(value.scopes[0].scopeId, 'chosen'); assert.ok(value.scopesOmittedCount > 0)
})

test('official defineTool converts fixed oneOf branches and nested required fields into valid model JSON Schema', () => {
  const tools = createControlTools({}), controlSchema = tools[1].parameters, trialSchema = tools[3].parameters
  assert.deepEqual(controlSchema.required, ['scopeId', 'command'])
  const branches = controlSchema.properties.command.oneOf
  assert.equal(branches.length, 7)
  assert.deepEqual(branches.map(branch => branch.properties.action.const), ['position', 'velocity', 'force', 'impedance', 'heartbeat_start', 'heartbeat_stop', 'heartbeat_once'])
  for (const branch of branches) { assert.equal(branch.additionalProperties, false); assert.ok(branch.required.includes('action')) }
  for (const action of ['heartbeat_start', 'heartbeat_stop', 'heartbeat_once']) assert.deepEqual(validateJsonSchemaValue(controlSchema, { scopeId: 'scope', command: { action } }), [])
  assert.deepEqual(validateJsonSchemaValue(controlSchema, requests[1]), [])
  for (const command of [{}, { mm: raw }, { action: 'position' }, { action: 'heartbeat_once', mm: raw }, { action: 'unknown' }]) assert.ok(validateJsonSchemaValue(controlSchema, { scopeId: 'scope', command }).length > 0)
  assert.deepEqual(validateJsonSchemaValue(trialSchema, { scopeId: 'scope', parameters }), [])
  assert.deepEqual(validateJsonSchemaValue(trialSchema, { scopeId: 'scope', parameters: { ...parameters, reach: null } }), [])
  const incomplete = { ...parameters.command }; delete incomplete.positionMm
  for (const changed of [{ ...parameters, command: incomplete }, { ...parameters, reach: {} }, { ...parameters, durationS: 1 }]) assert.ok(validateJsonSchemaValue(trialSchema, { scopeId: 'scope', parameters: changed }).length > 0)
})

test('trial model projection distinguishes unavailable state reads and released references from SDK state', async () => {
  const value = { ...trial, statusRead: 'unavailable', statusReason: 'original status read failed', referenceReleased: true }
  const { tools } = fixture({ getControlTrial: async () => value })
  const projected = await tools[4].execute({ trialId: 'trial' }, exec)
  assert.equal(projected.state, 'active'); assert.equal(projected.statusRead, 'unavailable')
  assert.equal(projected.statusReason, value.statusReason); assert.equal(projected.referenceReleased, true)
  assert.equal(projected.unknown, true)
})
