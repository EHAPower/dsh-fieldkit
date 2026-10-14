import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const maxOutputBytes = 256 * 1024

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

function configText(record) {
  if (typeof record === 'string') return record
  const text = JSON.stringify(record)
  if (text === undefined) throw new TypeError('record must be JSON serializable')
  return text
}

/** Offline configuration check adapter. Device commands always use the direct-api service. */
export function createEhaTool({ binaryPath, timeoutMs = 15000 }) {
  requireBinaryPath(binaryPath)
  requireTimeout(timeoutMs)

  return {
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
