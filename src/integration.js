import { open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute } from 'node:path'

const serviceProtocol = 'eha-tool.service.v2'
const directRequestLimit = 1024 * 1024
const directResponseLimit = 64 * 1024 * 1024

export class IntegrationError extends Error {
  constructor(code, message) { super(message); this.name = 'IntegrationError'; this.code = code }
}

const text = value => typeof value === 'string' && value.length > 0
const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
const requireValue = (value, message) => { if (!value) throw new IntegrationError('invalid_response', message) }

async function tokenFrom(tokenFile) {
  let file
  try {
    file = await open(tokenFile, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const info = await file.stat()
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o7777) !== 0o600 || (typeof process.getuid === 'function' && info.uid !== process.getuid()) || ![64, 65].includes(info.size)) throw new Error('invalid credential file')
    const buffer = Buffer.alloc(66)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    const value = buffer.subarray(0, bytesRead).toString('utf8')
    if (!/^[0-9a-f]{64}\n?$/.test(value)) throw new Error('invalid credential format')
    return value.slice(0, 64)
  } catch { throw new IntegrationError('credential_invalid', 'Integration token must be a small regular non-symlink file owned by this user with mode 0600') }
  finally { await file?.close() }
}

async function responseText(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new IntegrationError('response_too_large', 'Integration response exceeds response limit') }
  const chunks = []
  let bytes = 0
  if (response.body) {
    const reader = response.body.getReader()
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > limit) { await reader.cancel(); throw new IntegrationError('response_too_large', 'Integration response exceeds response limit') }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Authenticated local transport for eha-tool lifecycle metadata and its direct /api commands. */
export function createIntegrationClient({ endpoint, tokenFile, fetchImpl = globalThis.fetch, timeoutMs = 6500, apiVersion = 2 }) {
  if (apiVersion !== 2) throw new TypeError('Only eha-tool service v2 is supported')
  let origin
  try { origin = new URL(endpoint) } catch { throw new TypeError('endpoint must be an HTTP loopback URL') }
  if (origin.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(origin.hostname) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new TypeError('endpoint must be an HTTP loopback origin without credentials or a path')
  if (typeof tokenFile !== 'string' || !isAbsolute(tokenFile)) throw new TypeError('tokenFile must be an absolute path')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('timeoutMs must be a positive integer')

  async function fetchResponse(path, { method = 'GET', bodyText = undefined, signal, limit, withTimeout = true }) {
    const token = await tokenFrom(tokenFile)
    const headers = { Authorization: `Bearer ${token}` }
    if (bodyText !== undefined) headers['Content-Type'] = 'application/json'
    try {
      const timeout = withTimeout ? AbortSignal.timeout(timeoutMs) : null
      const requestSignal = timeout ? (signal ? AbortSignal.any([signal, timeout]) : timeout) : signal
      const response = await fetchImpl(new URL(path, origin), { method, headers, body: bodyText, redirect: 'manual', signal: requestSignal })
      if (response.status >= 300 && response.status < 400) throw new IntegrationError('redirect_rejected', 'Integration redirects are rejected')
      return { response, bodyText: await responseText(response, limit) }
    } catch (error) {
      if (error instanceof IntegrationError) throw error
      if (signal?.aborted) throw new IntegrationError('cancelled', 'Integration request cancelled')
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new IntegrationError('sdk_timeout', 'Integration request timed out')
      throw new IntegrationError('backend_error', 'Integration transport failed')
    }
  }

  async function service(path, options = {}) {
    const bodyText = options.body === undefined ? undefined : JSON.stringify({ ...options.body, api_version: 2 })
    const { response, bodyText: raw } = await fetchResponse(`/service/v2${path}`, { ...options, bodyText, limit: directRequestLimit })
    let value
    try { value = JSON.parse(raw) } catch { throw new IntegrationError('invalid_response', 'Service response is not valid JSON') }
    requireValue(value && typeof value === 'object' && !Array.isArray(value) && value.protocol === serviceProtocol && value.api_version === 2 && text(value.instance_id), 'Incompatible service response')
    if (!response.ok) throw new IntegrationError(text(value.code) ? value.code : 'backend_error', typeof value.message === 'string' ? value.message : `Service request failed (${response.status})`)
    if (options.instanceId && value.instance_id !== options.instanceId) throw new IntegrationError('instance_mismatch', 'eha-tool instance changed')
    return value
  }

  return {
    async describe(signal) {
      const value = await service('/describe', { signal })
      requireValue(value.dto_schema_version === 1 && value.config_format_version === 1 && text(value.tool_version) && Array.isArray(value.capabilities) && value.capabilities.every(text) && ['instance_status', 'service_shutdown', 'direct_api'].every(capability => value.capabilities.includes(capability)), 'Incompatible direct-api capabilities')
      return { protocol: serviceProtocol, api_version: 2, instance_id: value.instance_id, tool_version: value.tool_version, dto_schema_version: 1, config_format_version: 1, capabilities: [...value.capabilities] }
    },
    async instance(instanceId, signal) {
      const value = await service('/instance', { instanceId, signal })
      requireValue(text(value.tool_version) && decimal(value.pid) && decimal(value.started_at_unix_ms) && text(value.endpoint) && ['running', 'shutting_down'].includes(value.service_state), 'Invalid service instance summary')
      return { instance_id: value.instance_id, tool_version: value.tool_version, pid: value.pid, started_at_unix_ms: value.started_at_unix_ms, endpoint: value.endpoint, service_state: value.service_state }
    },
    async shutdown(instanceId, confirmation) {
      if (confirmation !== 'shutdown_service_without_stopping_devices') throw new IntegrationError('invalid_request', 'Invalid service shutdown request')
      const value = await service('/shutdown', { method: 'POST', instanceId, body: { instance_id: instanceId, confirmation } })
      requireValue(value.accepted === true && value.service_state === 'shutting_down', 'Invalid shutdown acknowledgement')
      return { instance_id: value.instance_id, tool_version: value.tool_version, pid: value.pid, started_at_unix_ms: value.started_at_unix_ms, endpoint: value.endpoint, service_state: value.service_state, accepted: true }
    },
    async direct(path, { method = 'GET', bodyText = '', signal } = {}) {
      let directUrl
      try { directUrl = new URL(path, origin) } catch { throw new IntegrationError('invalid_request', 'Invalid direct API path') }
      if (directUrl.origin !== origin.origin || !directUrl.pathname.startsWith('/api/') || directUrl.hash || !['GET', 'POST'].includes(method) || typeof bodyText !== 'string' || Buffer.byteLength(bodyText) > directRequestLimit) throw new IntegrationError('invalid_request', 'Invalid direct API request')
      const { response, bodyText: raw } = await fetchResponse(directUrl.pathname + directUrl.search, { method, bodyText: method === 'POST' ? bodyText : undefined, signal, limit: directResponseLimit, withTimeout: false })
      return { status: response.status, ok: response.ok, bodyText: raw }
    },
  }
}
