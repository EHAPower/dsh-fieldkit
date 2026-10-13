import test from 'node:test'
import assert from 'node:assert/strict'
import { TYPERT_REMOTE } from '../lib/typert.remote-client.js'
const result = method => TYPERT_REMOTE.descriptors.find(d => d.method === method).result.create()
const target = { instanceId: 'i', bindingId: 'b', targetId: 'usb', uid: 'a'.repeat(24), runNonce: 'b'.repeat(32), connectionGeneration: '18446744073709551615' }
const native = ' {"x":18446744073709551615,"v":0.000000000000000001,"v":1e-30}\n'
const receipt = { operationId: 'issued', grantId: 'service-grant', target, action: 'save_and_restart', admission: 'finished', submission: 'unknown', controlEffect: 'unresolved', observation: 'unconfirmed', phase: null, unknown: true, unknownSource: 'sdk', nativeJsonText: native, followUp: { reconnectRequired: true, readbackViews: ['user', 'startup'] }, error: { code: 'result_unknown', message: 'SDK evidence' }, newSubmission: false }
test('actual generated P3 codecs retain original config, service grants and complete unknown receipt', () => {
  assert.deepEqual(result('submitMaintenance').parse(receipt), receipt)
  assert.deepEqual(result('getMaintenanceOperation').parse(receipt), receipt)
  const context = { target, grant: { grantId: 'service-grant', target, maintenance: true }, latestOperation: receipt }
  assert.deepEqual(result('maintenanceContext').parse(context), context)
  assert.deepEqual(result('setMaintenancePermission').parse(context.grant), context.grant)
  assert.equal(result('setMaintenancePermission').parse(null), null)
  const read = { view: 'factory', target, nativeJsonText: native, dataUtf8: native, dataHex: '007fff' }
  assert.deepEqual(result('readConfiguration').parse(read), read)
  assert.deepEqual(result('configurationSchema').parse({ nativeJsonText: native, configFormatVersion: 7 }), { nativeJsonText: native, configFormatVersion: 7 })
  assert.equal(result('validateConfiguration').parse({ valid: true }).valid, true)
})
test('generated maintenance parameters require full target scope, fixed action and raw string', () => {
  const method = name => TYPERT_REMOTE.descriptors.find(d => d.method === name)
  const permission = method('setMaintenancePermission').parameters[1].codec.create()
  assert.equal(permission.safeParse({ target, enabled: true }).success, true)
  assert.equal(permission.safeParse({ target: { ...target, connectionGeneration: 1 }, enabled: true }).success, false)
  const request = method('submitMaintenance').parameters[1].codec.create()
  assert.equal(request.safeParse({ grantId: 'g', action: 'save_and_restart', rawRecordText: native }).success, true)
  assert.equal(request.safeParse({ grantId: 'g', action: 'save_and_restart', rawRecordText: { x: 1 } }).success, false)
  assert.equal(request.safeParse({ grantId: 'g', action: 'start_motor' }).success, false)
})
