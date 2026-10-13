import test from 'node:test'
import assert from 'node:assert/strict'
import { createMaintenanceTools } from '../src/maintenance-tools.js'

const exec = { agent: { id: 'chat-a' } }
const target = { instanceId: 'instance', bindingId: 'binding', targetId: 'usb:fixture', uid: '0123456789abcdef01234567', runNonce: '0123456789abcdef0123456789abcdef', connectionGeneration: '18446744073709551615' }
const rawRecordText = '{ "wide":18446744073709551615,"gain":1.000000059604644775390625 }'
const receipt = { operationId: 'operation', grantId: 'grant', target, action: 'save_and_restart', admission: 'attempting', submission: 'unknown', unknown: true, controlEffect: 'unresolved', observation: 'unconfirmed', phase: 'submission', newSubmission: true, followUp: { reconnectRequired: true, readbackViews: ['user', 'startup'] }, error: { code: 'result_unknown', message: '原请求结果未知' }, nativeJsonText: rawRecordText }
function fixture(extra = {}) {
  const calls = []
  const service = {
    async maintenanceContext(id) { calls.push(['context', id]); return { target, grant: { grantId: 'grant', target, maintenance: true }, latestOperation: receipt } },
    async submitMaintenance(id, request) { calls.push(['submit', id, request]); return receipt },
    async getMaintenanceOperation(id, operationId) { calls.push(['operation', id, operationId]); return receipt },
    ...extra,
  }
  const [context, maintenance, operation] = createMaintenanceTools(service)
  return { calls, context, maintenance, operation }
}

test('maintenance factory exposes only fixed consuming tools and separates human intent from grants', () => {
  const tools = createMaintenanceTools({})
  assert.deepEqual(tools.map(tool => tool.name), ['fieldkit_maintenance_context', 'fieldkit_maintenance', 'fieldkit_maintenance_operation'])
  assert.match(tools[1].description, /用户.*明确请求/)
  assert.match(tools[1].description, /grant 不替代用户意图/)
  assert.match(tools[1].description, /不可由模型自动生成/)
  assert.deepEqual(Object.keys(tools[1].parameters.properties), ['grantId', 'action', 'rawRecordText'])
})

test('all maintenance tools derive their session exclusively from exec.agent.id', async () => {
  const f = fixture()
  await f.context.execute({}, exec)
  await f.maintenance.execute({ grantId: 'grant', action: 'reset_application' }, exec)
  await f.operation.execute({ operationId: 'old-operation' }, exec)
  assert.deepEqual(f.calls, [['context', 'chat-a'], ['submit', 'chat-a', { grantId: 'grant', action: 'reset_application' }], ['operation', 'chat-a', 'old-operation']])
  for (const [tool, args] of [[f.context, {}], [f.maintenance, { grantId: 'grant', action: 'reset_application' }], [f.operation, { operationId: 'operation' }]]) {
    await assert.rejects(tool.execute(args, {}), /可信 exec.agent.id/)
  }
  assert.equal(f.calls.length, 3)
})

test('self reported identities, paths, commands, and unknown arguments never reach the host', async () => {
  const f = fixture()
  for (const key of ['sessionId', 'claimantId', 'claimant_id', 'targetId', 'path', 'command', 'requestId', 'permission']) {
    await assert.rejects(f.maintenance.execute({ grantId: 'grant', action: 'reset_application', [key]: 'forged' }, exec), /不接受参数/)
  }
  await assert.rejects(f.context.execute({ sessionId: 'chat-b' }, exec), /不接受参数/)
  await assert.rejects(f.operation.execute({ operationId: 'operation', sessionId: 'chat-b' }, exec), /不接受参数/)
  assert.deepEqual(f.calls, [])
})

test('exactly four actions are allowed and save preserves the complete original string once', async () => {
  const f = fixture()
  for (const action of ['save_and_restart', 'restore_factory_and_restart', 'reset_application', 'enter_update']) {
    await f.maintenance.execute({ grantId: 'grant', action, ...(action === 'save_and_restart' ? { rawRecordText } : {}) }, exec)
  }
  assert.equal(f.calls.length, 4)
  assert.deepEqual(f.calls[0], ['submit', 'chat-a', { grantId: 'grant', action: 'save_and_restart', rawRecordText }])
  assert.ok(f.calls.slice(1).every(call => !Object.hasOwn(call[2], 'rawRecordText')))
  for (const action of ['heartbeat_start', 'target', 'stop', 'toString', 'save']) await assert.rejects(f.maintenance.execute({ grantId: 'grant', action }, exec), /维护动作|must be one of/)
  for (const rawRecordText of [undefined, {}, 18446744073709551615n]) await assert.rejects(f.maintenance.execute({ grantId: 'grant', action: 'save_and_restart', rawRecordText }, exec))
  for (const action of ['restore_factory_and_restart', 'reset_application', 'enter_update']) await assert.rejects(f.maintenance.execute({ grantId: 'grant', action, rawRecordText }, exec), /禁止配置文本/)
  await assert.rejects(f.maintenance.execute({ action: 'reset_application' }, exec), /grantId/)
  assert.equal(f.calls.length, 4)
})

test('permission failures and lost submission results propagate once without grants or retry', async () => {
  for (const code of ['permission_denied', 'grant_stale', 'result_unknown']) {
    let calls = 0
    const error = Object.assign(new Error(code), { code })
    const f = fixture({ async submitMaintenance() { calls++; throw error } })
    await assert.rejects(f.maintenance.execute({ grantId: 'grant', action: 'reset_application' }, exec), value => value === error)
    assert.equal(calls, 1)
  }
})

test('receipt projection preserves uncertain stages and original operation lookup without side effects', async () => {
  const f = fixture()
  const result = await f.operation.execute({ operationId: 'old-operation' }, exec)
  assert.equal(result.operationId, receipt.operationId)
  assert.equal(result.target.connectionGeneration, '18446744073709551615')
  for (const field of ['admission', 'submission', 'unknown', 'controlEffect', 'observation', 'phase']) assert.equal(result[field], receipt[field])
  assert.equal(result.nativeJsonText, rawRecordText)
  assert.deepEqual(result.followUp, receipt.followUp)
  assert.deepEqual(f.calls, [['operation', 'chat-a', 'old-operation']])
})

test('model projection whitelists context and receipt fields and bounds final escaped JSON to eight KiB', async () => {
  const nativeJsonText = ('中\n"\\\u0000' + rawRecordText).repeat(2000)
  const full = { ...receipt, nativeJsonText, token: 'secret', tokenFile: '/private/token', command: 'shell', error: { ...receipt.error, message: '中'.repeat(10000), secret: 'credential' }, target: { ...target, token: 'secret' }, followUp: { ...receipt.followUp, readbackViews: ['user', 'startup', 'arbitrary', 'user'], path: '/private' } }
  const f = fixture({ async maintenanceContext() { return { target: { ...target, token: 'secret' }, grant: { grantId: 'grant', target, maintenance: true, token: 'secret' }, latestOperation: full, token: 'secret' } }, async submitMaintenance() { return full } })
  for (const [tool, args] of [[f.context, {}], [f.maintenance, { grantId: 'grant', action: 'reset_application' }]]) {
    const value = await tool.execute(args, exec)
    const rendered = tool.output.render(args, value)[0].text
    assert.ok(Buffer.byteLength(rendered) <= 8192)
    assert.equal(value.evidenceBudgetBytes, 8192)
    assert.equal(value.evidenceIsExcerpt, true)
    assert.ok(!rendered.includes('secret') && !rendered.includes('/private') && !rendered.includes('shell'))
    const operation = value.latestOperation ?? value
    assert.ok(!operation.nativeJsonText.includes('�'))
    assert.ok(nativeJsonText.startsWith(operation.nativeJsonText))
    assert.equal(operation.nativeTextBytes, Buffer.byteLength(nativeJsonText))
    assert.deepEqual(operation.followUp.readbackViews, ['user', 'startup'])
    assert.equal(operation.observation, 'unconfirmed')
  }
})
