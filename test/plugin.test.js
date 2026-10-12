import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/index.js'

test('exposes read-only tools and bundled skills; blocks general access', async () => {
  const tools = [], skills = []
  let guard
  apply({
    tools: { register: value => tools.push(value), guard: value => { guard = value } },
    skills: { register: value => skills.push(value) },
  })
  assert.deepEqual(tools.map(t => t.name), ['fieldkit_devices', 'fieldkit_diagnose_usb', 'fieldkit_check_configuration'])
  assert.deepEqual(skills.map(s => s.name), ['connect-check', 'state-triage', 'configuration-review'])
  assert.ok(guard({ name: 'bash', arguments: {} }))
  assert.ok(guard({ name: 'present', arguments: { files: [{ path: '/tmp/unrelated.txt' }] } }))
  assert.ok(guard({ name: 'skill', arguments: { name: 'other' } }))
  assert.equal(guard({ name: 'skill', arguments: { name: 'connect-check' } }), undefined)
  await assert.rejects(tools[0].execute({}, {}), /toolPath/)
})
