import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/index.js'

function install(config = {}) {
  const tools = [], skills = [], plugins = []
  let guard, service
  apply({
    provide(name, value) { assert.equal(name, 'fieldkit'); service = value },
    plugin(value) { plugins.push(value) },
    on(event, callback) { assert.equal(event, 'dispose') },
    tools: { register: value => tools.push(value), guard: value => { guard = value } },
    skills: { register: value => skills.push(value) },
  }, config)
  return { tools, skills, plugins, guard, service }
}
test('default integration tools share a plugin-owned service and require trusted sessions', async () => {
  const { tools, skills, plugins, guard, service } = install()
  assert.deepEqual(tools.map(t => t.name), ['fieldkit_devices', 'fieldkit_diagnose', 'fieldkit_check_configuration'])
  assert.deepEqual(skills.map(s => s.name), ['connect-check', 'state-triage', 'configuration-review'])
  assert.equal(plugins.length, 1)
  assert.ok(guard({ name: 'bash', arguments: {} }))
  assert.ok(guard({ name: 'present', arguments: { files: [{ path: '/tmp/unrelated.txt' }] } }))
  assert.ok(guard({ name: 'skill', arguments: { name: 'other' } }))
  assert.equal(guard({ name: 'skill', arguments: { name: 'connect-check' } }), undefined)
  await assert.rejects(tools[0].execute({ sessionId: 'forged' }, {}), /trusted DSH/)
  assert.equal((await service.describe()).available, false)
  assert.notEqual(install().service, service)
})
test('tools use exec.agent.id and report guard cannot authorize another chat', async () => {
  const { tools, guard, service } = install()
  let receivedSession
  service.listTargets = async id => { receivedSession = id; return { targets: [] } }
  await tools[0].execute({ sessionId: 'chat-b' }, { agent: { id: 'chat-a' } })
  assert.equal(receivedSession, 'chat-a')
  service.hasReport = (id, path) => id === 'chat-a' && path === '/tmp/own.md'
  assert.equal(guard({ name: 'present', agent: { id: 'chat-a' }, arguments: { files: [{ path: '/tmp/own.md' }] } }), undefined)
  assert.ok(guard({ name: 'present', agent: { id: 'chat-b' }, arguments: { files: [{ path: '/tmp/own.md' }] } }))
  service.diagnose = async (id, request) => ({ readRunId: 'run', evidence: [{ action: 'status', nativeJsonText: '{"huge":18446744073709551615}', receivedAt: 'now' }], id, request })
  const value = await tools[1].execute({ bindingId: 'selected', sessionId: 'chat-b' }, { agent: { id: 'chat-a' } })
  assert.equal(value.id, 'chat-a')
  assert.deepEqual(value.request, { bindingId: 'selected' })
  assert.equal(value.evidence[0].nativeJsonText, '{"huge":18446744073709551615}')
  assert.equal(value.evidence[0].truncated, false)
  service.diagnose = async () => ({ evidence: Array.from({ length: 6 }, () => ({ action: 'status', nativeJsonText: '中'.repeat(9000) })), reports: { json: '/tmp/full.json', markdown: '/tmp/full.md' } })
  const large = await tools[1].execute({ bindingId: 'selected' }, { agent: { id: 'chat-a' } })
  assert.ok(large.evidenceIsExcerpt)
  assert.ok(large.evidence.every(item => Buffer.byteLength(item.nativeJsonText) <= 8192 && !item.nativeJsonText.includes('�')))
  assert.ok(large.evidence.reduce((sum, item) => sum + Buffer.byteLength(item.nativeJsonText), 0) <= 32768)
  assert.equal(large.fullEvidenceReports.json, '/tmp/full.json')
})
test('legacy USB name is available only in explicit legacy CLI mode', () => {
  assert.deepEqual(install({ deviceMode: 'legacy-cli' }).tools.map(t => t.name), ['fieldkit_devices', 'fieldkit_diagnose_usb', 'fieldkit_check_configuration'])
})

test('model evidence preserves read quality and distinct process facts within existing text budget', async () => {
  const { tools, service } = install()
  const permit = { ready: true, reason_code: null }
  service.diagnose = async () => ({ evidence: [{ action: 'status', nativeJsonText: 'x'.repeat(12000), readPermit: permit, controlEffect: { state: 'unknown', reason_code: 'unresolved_target' }, sourceTimestamp: { clock: 'device_monotonic_us', value: '18446744073709551615' }, receivedAgeMs: '42', connectionGeneration: '9007199254740993', nativeQuality: null, exitCode: 2, processError: { name: 'Error', code: 2, message: 'e'.repeat(2000), signal: null, killed: false } }], reportError: { code: 'report_write_failed', message: 'ENOSPC' }, reports: null })
  const run = await tools[1].execute({ bindingId: 'selected' }, { agent: { id: 'chat' } })
  assert.deepEqual(run.evidence[0].readPermit, permit)
  assert.equal(run.evidence[0].controlEffect.state, 'unknown')
  assert.equal(run.evidence[0].receivedAgeMs, '42')
  assert.equal(run.evidence[0].connectionGeneration, '9007199254740993')
  assert.equal(run.evidence[0].exitCode, 2)
  assert.equal(run.evidence[0].processError.code, 2)
  assert.equal(run.reportError.code, 'report_write_failed')
  assert.ok(Buffer.byteLength(run.evidence[0].processError.message) <= 1024)
  assert.ok(Buffer.byteLength(run.evidence[0].nativeJsonText) <= 8192)
  assert.equal(run.evidenceBudgetBytes, 32768)
})
