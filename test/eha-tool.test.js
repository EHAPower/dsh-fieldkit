import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEhaTool } from '../src/eha-tool.js'

async function fixture(t, mode = 'success') {
  const root = await mkdtemp(join(tmpdir(), 'fieldkit-eha-tool-'))
  const binaryPath = join(root, 'fake-eha-tool.mjs'), logPath = join(root, 'invocation.json')
  await writeFile(binaryPath, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const record = readFileSync(args[1], 'utf8')
writeFileSync(${JSON.stringify(logPath)}, JSON.stringify({ args, record }))
if (${JSON.stringify(mode)} === 'failure') { process.stdout.write('partial output'); process.stderr.write('fixture failure'); process.exit(7) }
process.stdout.write('validated')
`, { mode: 0o755 })
  t.after(() => rm(root, { recursive: true, force: true }))
  return { tool: createEhaTool({ binaryPath, timeoutMs: 1000 }), logPath }
}

test('only exposes config-check and forwards original configuration text through a temporary file', async t => {
  const { tool, logPath } = await fixture(t)
  assert.equal(tool.devices, undefined)
  assert.equal(tool.diagnoseUsb, undefined)
  const raw = '{"monotonic":18446744073709551615,"decimal":0.12345678901234567890}\n'
  const result = await tool.checkConfiguration(raw)
  assert.deepEqual(result, { exitCode: 0, stdout: 'validated', stderr: '', error: null })
  const invocation = JSON.parse(await readFile(logPath, 'utf8'))
  assert.deepEqual(invocation.args.slice(0, 1), ['config-check'])
  assert.equal(invocation.record, raw)
  await assert.rejects(access(invocation.args[1], constants.F_OK))
})

test('returns config-check failure evidence without hiding stdout or stderr', async t => {
  const { tool } = await fixture(t, 'failure')
  const result = await tool.checkConfiguration('{"protection":{}}')
  assert.equal(result.exitCode, 7)
  assert.equal(result.stdout, 'partial output')
  assert.equal(result.stderr, 'fixture failure')
  assert.equal(result.error?.code, 7)
})
