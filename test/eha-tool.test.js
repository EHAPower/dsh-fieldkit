import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEhaTool } from '../src/eha-tool.js'

async function fixture(t, mode = '') {
  const root = await mkdtemp(join(tmpdir(), 'fieldkit-eha-tool-'))
  const binaryPath = join(root, 'fake-eha-tool.mjs')
  const logPath = join(root, 'argv.jsonl')
  await writeFile(binaryPath, `#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs'
const args = process.argv.slice(2)
appendFileSync(new URL('./argv.jsonl', import.meta.url), JSON.stringify(args) + '\\n')
const mode = ${JSON.stringify(mode)}
const action = args.includes('config-read') ? 'config-read' : args.at(-1)
const identity = action === 'inspect' ? { uid: 'aaaaaaaaaaaaaaaaaaaaaaaa', run_nonce: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' } : { uid: mode === 'changed' && action === 'status' ? 'cccccccccccccccccccccccc' : 'aaaaaaaaaaaaaaaaaaaaaaaa', sample: { run_nonce: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' } }
if (args[0] === 'devices') process.stdout.write(JSON.stringify([{ serial: 'USB-0001', description: 'fixture' }]))
else if (args[0] === 'config-check') { readFileSync(args[1], 'utf8'); process.stdout.write('validated') }
else if (mode === 'failure' && action === 'diagnostics') { process.stdout.write(JSON.stringify({ snapshot: { identity } })); process.stderr.write('fixture failure'); process.exit(7) }
else if (mode === 'malformed' && action === 'measurements') process.stdout.write('{not json')
else if (action === 'inspect') process.stdout.write(JSON.stringify(identity))
else process.stdout.write(JSON.stringify({ action, data: {}, snapshot: { identity } }))
`, { mode: 0o755 })
  t.after(() => rm(root, { recursive: true, force: true }))
  return {
    tool: createEhaTool({ binaryPath, timeoutMs: 1000 }),
    async calls() {
      return (await readFile(logPath, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)
    },
  }
}

test('uses only the documented fixed argument vectors', async t => {
  const { tool, calls } = await fixture(t)
  assert.deepEqual(await tool.devices(), [{ serial: 'USB-0001', description: 'fixture' }])
  const check = await tool.checkConfiguration({ protection: {} })
  assert.equal(check.exitCode, 0)
  assert.equal(check.stdout, 'validated')
  const diagnosis = await tool.diagnoseUsb('USB-0001')
  assert.equal(diagnosis.complete, true)
  assert.equal(diagnosis.status, 'complete')
  assert.deepEqual(diagnosis.identity, { uid: 'aaaaaaaaaaaaaaaaaaaaaaaa', runNonce: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' })
  assert.match(diagnosis.evidence[0].receivedAt, /^\d{4}-\d\d-\d\dT/)
  const entries = await calls()
  assert.match(entries[1][1], /record\.json$/)
  assert.deepEqual(entries.slice(0, 1).concat(entries.slice(2)), [
    ['devices', '--json'],
    ['device', '--json', '--usb', 'USB-0001', '--timeout-secs', '5', 'inspect'],
    ['device', '--json', '--usb', 'USB-0001', '--timeout-secs', '5', 'status'],
    ['device', '--json', '--usb', 'USB-0001', '--timeout-secs', '5', 'measurements'],
    ['device', '--json', '--usb', 'USB-0001', '--timeout-secs', '5', 'diagnostics'],
    ['device', '--json', '--usb', 'USB-0001', '--timeout-secs', '5', 'config-read', '--view', 'startup'],
    ['device', '--json', '--usb', 'USB-0001', '--timeout-secs', '5', 'config-read', '--view', 'user'],
  ])
})

test('keeps partial raw evidence when an action process fails', async t => {
  const { tool, calls } = await fixture(t, 'failure')
  const result = await tool.diagnoseUsb('USB-0001')
  assert.equal(result.complete, false)
  assert.equal(result.status, 'incomplete')
  assert.equal(result.error.action, 'diagnostics')
  assert.equal(result.evidence.at(-1).exitCode, 7)
  assert.equal(result.evidence.at(-1).stderr, 'fixture failure')
  assert.deepEqual((await calls()).map(args => args.at(-1)), ['inspect', 'status', 'measurements', 'diagnostics'])
})

test('marks malformed JSON and changed identity incomplete without merging evidence', async t => {
  const malformed = await fixture(t, 'malformed')
  const malformedResult = await malformed.tool.diagnoseUsb('USB-0001')
  assert.equal(malformedResult.status, 'incomplete')
  assert.equal(malformedResult.error.kind, 'malformed_json')
  assert.deepEqual((await malformed.calls()).map(args => args.at(-1)), ['inspect', 'status', 'measurements'])

  const changed = await fixture(t, 'changed')
  const changedResult = await changed.tool.diagnoseUsb('USB-0001')
  assert.equal(changedResult.status, 'incomplete')
  assert.equal(changedResult.error.kind, 'identity_changed')
  assert.equal(changedResult.evidence.length, 2)
})

test('rejects non-full USB serials before executing a program', async t => {
  const { tool, calls } = await fixture(t)
  await assert.rejects(tool.diagnoseUsb(''), /full USB serial/)
  await assert.rejects(tool.diagnoseUsb(' USB-0001'), /full USB serial/)
  await assert.rejects(tool.diagnoseUsb('USB-0001\nextra'), /full USB serial/)
  await assert.rejects(tool.diagnoseUsb('x'.repeat(257)), /full USB serial/)
  await assert.rejects(async () => calls(), /ENOENT/)
})
