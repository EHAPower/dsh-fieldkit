import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/index.js'

function install() {
  const tools = []
  const skills = []
  let service
  apply({
    provide(name, value) { assert.equal(name, 'fieldkit'); service = value },
    plugin() {}, on() {}, skills: { register: value => skills.push(value) },
    tools: { register: value => tools.push(value) },
  })
  return { tools, skills, service }
}

test('plugin exposes only context, fixed command, and offline configuration tools', async () => {
  const { tools, skills, service } = install()
  assert.deepEqual(tools.map(tool => tool.name), ['fieldkit_context', 'fieldkit_command', 'fieldkit_check_configuration'])
  assert.deepEqual(skills.map(skill => skill.name), ['connect-check', 'state-triage', 'configuration-review'])
  service.context = async id => ({ target: { transport: 'usb', node: null, label: id } })
  const context = await tools[0].execute({}, { agent: { id: 'chat-a' } })
  assert.deepEqual(context.target, { transport: 'usb', node: null, label: 'chat-a' })
  assert.equal(context.guide.length, 20)
  assert.match(context.guide.find(item => item.command === 'action').body, /transport/)
  let received
  service.executeCommand = async (id, request) => { received = { id, request }; return { command: request.command, method: 'POST', path: '/api/action', status: 409, ok: false, bodyText: '{"unknown":true}', receivedAt: 'now' } }
  await tools[1].execute({ command: 'action', bodyText: '{"action":"stop"}', queryText: '' }, { agent: { id: 'chat-a' } })
  assert.deepEqual(received, { id: 'chat-a', request: { command: 'action', bodyText: '{"action":"stop"}', queryText: '' } })
})
