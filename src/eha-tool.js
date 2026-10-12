import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const maxOutputBytes = 256 * 1024
const deviceActions = [
  ['inspect'],
  ['status'],
  ['measurements'],
  ['diagnostics'],
  ['config-read', '--view', 'startup'],
  ['config-read', '--view', 'user'],
]

function requireBinaryPath(binaryPath) {
  if (typeof binaryPath !== 'string' || !isAbsolute(binaryPath)) {
    throw new TypeError('binaryPath must be an absolute path')
  }
}

function requireTimeout(timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError('timeoutMs must be a positive integer')
  }
}

function requireSerial(serial) {
  if (typeof serial !== 'string' || !/^[!-~]{1,256}$/.test(serial)) {
    throw new TypeError('serial must be a full USB serial without whitespace or control characters')
  }
}

function processError(error) {
  if (!error) return null
  return {
    name: error.name,
    message: error.message,
    code: error.code ?? null,
    signal: error.signal ?? null,
    killed: error.killed === true,
  }
}

async function run(binaryPath, args, timeoutMs, signal) {
  signal?.throwIfAborted()
  try {
    const { stdout, stderr } = await execFileAsync(binaryPath, args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: maxOutputBytes,
      signal,
      shell: false,
      windowsHide: true,
    })
    return { receivedAt: new Date().toISOString(), stdout, stderr, exitCode: 0, error: null }
  } catch (error) {
    return {
      receivedAt: new Date().toISOString(),
      stdout: typeof error.stdout === 'string' ? error.stdout : '',
      stderr: typeof error.stderr === 'string' ? error.stderr : '',
      exitCode: typeof error.code === 'number' ? error.code : null,
      error: processError(error),
    }
  }
}

function parseJson(evidence) {
  try {
    evidence.json = JSON.parse(evidence.stdout)
    return evidence.json
  } catch (error) {
    evidence.parseError = error.message
    return null
  }
}

function identityFor(action, output) {
  const identity = action === 'inspect' ? output : output?.snapshot?.identity
  const uid = identity?.uid
  const runNonce = action === 'inspect' ? identity?.run_nonce : identity?.sample?.run_nonce
  if (!/^[0-9a-f]{24}$/.test(uid) || !/^[0-9a-f]{32}$/.test(runNonce)) return null
  return { uid, runNonce }
}

function incomplete(serial, evidence, action, kind, message, identity = null) {
  return {
    serial,
    status: 'incomplete',
    complete: false,
    identity,
    evidence,
    error: { action, kind, message },
  }
}

function configText(record) {
  if (typeof record === 'string') return record
  const text = JSON.stringify(record)
  if (text === undefined) throw new TypeError('record must be JSON serializable')
  return text
}

/** Runs only documented public eha-tool commands; it never infers device execution or safety. */
export function createEhaTool({ binaryPath, timeoutMs = 15000 }) {
  requireBinaryPath(binaryPath)
  requireTimeout(timeoutMs)

  return {
    async devices(signal) {
      const evidence = await run(binaryPath, ['devices', '--json'], timeoutMs, signal)
      if (evidence.exitCode !== 0 || evidence.error) {
        throw new Error(`eha-tool devices failed: ${evidence.error?.message ?? evidence.stderr}`)
      }
      const devices = parseJson(evidence)
      if (!Array.isArray(devices)) throw new Error('eha-tool devices returned malformed JSON')
      return devices
    },

    async diagnoseUsb(serial, signal) {
      requireSerial(serial)
      const evidence = []
      let expectedIdentity = null
      for (const command of deviceActions) {
        const action = command[0]
        const result = await run(binaryPath, ['device', '--json', '--usb', serial, '--timeout-secs', '5', ...command], timeoutMs, signal)
        const item = { action, ...result }
        evidence.push(item)
        if (item.exitCode !== 0 || item.error) {
          return incomplete(serial, evidence, action, 'process_failed', item.error?.message ?? item.stderr, expectedIdentity)
        }
        const output = parseJson(item)
        if (output === null) {
          return incomplete(serial, evidence, action, 'malformed_json', item.parseError, expectedIdentity)
        }
        const identity = identityFor(action, output)
        if (!identity) {
          return incomplete(serial, evidence, action, 'identity_missing', 'action output lacks a valid UID and run_nonce', expectedIdentity)
        }
        item.identity = identity
        if (expectedIdentity && (identity.uid !== expectedIdentity.uid || identity.runNonce !== expectedIdentity.runNonce)) {
          return incomplete(serial, evidence, action, 'identity_changed', 'UID or run_nonce changed during diagnosis', expectedIdentity)
        }
        expectedIdentity = identity
      }
      return { serial, status: 'complete', complete: true, identity: expectedIdentity, evidence, error: null }
    },

    async checkConfiguration(record, signal) {
      signal?.throwIfAborted()
      const directory = await mkdtemp(join(tmpdir(), 'eha-tool-config-'))
      try {
        const file = join(directory, 'record.json')
        await writeFile(file, configText(record), { encoding: 'utf8', flag: 'wx' })
        const result = await run(binaryPath, ['config-check', file], timeoutMs, signal)
        return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, error: result.error }
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  }
}
