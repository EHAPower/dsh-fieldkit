import test from 'node:test'
import assert from 'node:assert/strict'
import { takeOpenedBinding } from '../src/observation.js'

test('unmounted view releases a binding that arrives after openTarget', async () => {
  let resolve, mounted = true
  const pending = new Promise(done => { resolve = done })
  const released = []
  const opening = takeOpenedBinding(pending, () => mounted, async binding => { released.push(binding.bindingId) })
  mounted = false
  resolve({ bindingId: 'late' })
  assert.equal(await opening, null)
  assert.deepEqual(released, ['late'])
})

test('mounted view retains its successful selection without releasing it', async () => {
  const binding = { bindingId: 'current' }
  const result = await takeOpenedBinding(Promise.resolve(binding), () => true, () => { assert.fail('must retain current binding') })
  assert.equal(result, binding)
})
