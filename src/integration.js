import { createP2Client } from './p2-client.js'
import { open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute } from 'node:path'

const legacyProtocol = 'eha-tool.integration.v1'
const requestLimit = 65536
const responseLimit = 1048576
const actions = new Set(['status', 'measurements', 'diagnostics', 'config_startup', 'config_user'])

export class IntegrationError extends Error {
  constructor(code, message, nativeErrorJsonText = null) {
    super(message)
    this.name = 'IntegrationError'
    this.code = code
    this.nativeErrorJsonText = nativeErrorJsonText
  }
}
function requireValue(ok, message) { if (!ok) throw new IntegrationError('invalid_response', message) }
function text(value) { return typeof value === 'string' && value.length > 0 }
function decimal(value) { return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 20 && BigInt(value) <= 18446744073709551615n }
function identity(value) { return value && typeof value.uid === 'string' && typeof value.run_nonce === 'string' && /^[0-9a-f]{24}$/.test(value.uid) && /^[0-9a-f]{32}$/.test(value.run_nonce) }
function sameIdentity(a, b) { return a.uid === b.uid && a.run_nonce === b.run_nonce }
function bindingFields(value) {
  requireValue(text(value.binding_id) && text(value.target_id) && decimal(value.connection_generation) && identity(value.identity), 'Invalid binding identity or decimal connection generation')
  return { protocol: value.protocol, instance_id: value.instance_id, binding_id: value.binding_id, target_id: value.target_id, connection_generation: value.connection_generation, identity: { uid: value.identity.uid, run_nonce: value.identity.run_nonce }, ...(value.lease_ms !== undefined ? { lease_ms: value.lease_ms } : {}) }
}
function checkBinding(value, expected) {
  const result = bindingFields(value)
  if (result.binding_id !== expected.binding_id || result.target_id !== expected.target_id || result.connection_generation !== expected.connection_generation || !sameIdentity(result.identity, expected.identity)) throw new IntegrationError('identity_changed', 'Binding identity or connection generation changed')
  return result
}
function optionalAge(value) { requireValue(value === null || decimal(value), 'Age must be null or a canonical decimal string'); return value }

/** Only the owner integration DTO is decoded; embedded native JSON text remains opaque. */
export function createIntegrationClient({ endpoint, tokenFile, fetchImpl = globalThis.fetch, timeoutMs = 6500, apiVersion = 1 }) {
  if (![1, 2].includes(apiVersion)) throw new TypeError('Unsupported service API version')
  const protocol = apiVersion === 2 ? 'eha-tool.service.v2' : legacyProtocol
  const prefix = apiVersion === 2 ? '/service/v2' : '/integration/v1'
  let leaseLimits = null
  let url
  try { url = new URL(endpoint) } catch { throw new TypeError('integrationUrl must be an HTTP loopback URL') }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new TypeError('integrationUrl must be an HTTP loopback origin without credentials or a path')
  if (typeof tokenFile !== 'string' || !isAbsolute(tokenFile)) throw new TypeError('integrationTokenFile must be an absolute path')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('HTTP timeout must be a positive integer')

  async function request(path, { method = 'GET', body, instanceId, signal } = {}) {
    const encoded = body === undefined ? undefined : JSON.stringify(apiVersion === 2 ? { ...body, api_version: 2 } : body)
    if (encoded !== undefined && Buffer.byteLength(encoded) > requestLimit) throw new IntegrationError('request_too_large', 'Integration request exceeds request limit')
    let token
    let file
    try {
      file = await open(tokenFile, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      const info = await file.stat()
      if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o7777) !== 0o600 || (typeof process.getuid === 'function' && info.uid !== process.getuid()) || ![64, 65].includes(info.size)) throw new Error('invalid credential file')
      const buffer = Buffer.alloc(66)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      const tokenText = buffer.subarray(0, bytesRead).toString('utf8')
      if (!/^[0-9a-f]{64}\n?$/.test(tokenText)) throw new Error('invalid credential format')
      token = tokenText.slice(0, 64)
    } catch { throw new IntegrationError('credential_invalid', 'Integration token must be a small regular non-symlink file owned by this user with mode 0600') }
    finally { await file?.close() }
    const headers = { Authorization: `Bearer ${token}` }
    if (encoded !== undefined) headers['Content-Type'] = 'application/json'
    let response
    try {
      const timeout = AbortSignal.timeout(timeoutMs)
      response = await fetchImpl(`${url.origin}${prefix}${path}`, { method, headers, body: encoded, redirect: 'manual', signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
      if (response.status >= 300 && response.status < 400) throw new IntegrationError('redirect_rejected', 'Integration redirects are rejected')
      if (Number(response.headers.get('content-length')) > responseLimit) { await response.body?.cancel(); throw new IntegrationError('response_too_large', 'Integration response exceeds response limit') }
      const chunks = []
      let bytes = 0
      if (response.body) {
        const reader = response.body.getReader()
        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            bytes += value.byteLength
            if (bytes > responseLimit) { await reader.cancel(); throw new IntegrationError('response_too_large', 'Integration response exceeds response limit') }
            chunks.push(value)
          }
        } finally { reader.releaseLock() }
      }
      if (method === 'DELETE' && response.ok && bytes === 0) return null
      let value
      try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new IntegrationError('invalid_response', 'Integration response is not valid JSON') }
      requireValue(value && typeof value === 'object' && !Array.isArray(value) && value.protocol === protocol && (apiVersion === 1 || value.api_version === 2) && text(value.instance_id), 'Incompatible integration protocol or instance')
      if (!response.ok) {
        const error = new IntegrationError(text(value.code) ? value.code : 'backend_error', typeof value.message === 'string' ? value.message : `Integration request failed (${response.status})`, typeof value.native_error_json_text === 'string' ? value.native_error_json_text : null)
        if (typeof value.unknown === 'boolean') error.unknown = value.unknown
        if (value.control_effect) error.controlEffect = controlEffect(value.control_effect)
        throw error
      }
      if (instanceId && value.instance_id !== instanceId) throw new IntegrationError('instance_mismatch', 'Integration owner instance changed')
      return value
    } catch (error) {
      if (error instanceof IntegrationError) throw error
      if (signal?.aborted) throw new IntegrationError('cancelled', 'Integration request cancelled')
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new IntegrationError('sdk_timeout', 'Integration request timed out')
      throw new IntegrationError('backend_error', 'Integration transport failed')
    }
  }
  const bindingPath = b => `/bindings/${encodeURIComponent(b.binding_id)}`
  return {
    ...(apiVersion === 2 ? createP2Client(request) : {}),
    async describe(signal) {
      const value = await request('/describe', { signal })
      requireValue(value.dto_schema_version === 1 && value.config_format_version === 1 && text(value.tool_version), 'Incompatible DTO or configuration format version')
      requireValue(Array.isArray(value.capabilities) && ['targets', 'binding_attach', 'usb_connect', 'snapshot', ...[...actions].map(action => `read_${action}`)].every(capability => value.capabilities.includes(capability)) && value.capabilities.every(text) && value.limits && value.limits.request_bytes === requestLimit && value.limits.response_bytes === responseLimit && value.limits.sdk_read_timeout_ms === 5000 && Number.isSafeInteger(value.limits.max_bindings) && value.limits.max_bindings > 0, 'Incompatible capabilities or integration limits')
      leaseLimits = null
      if (apiVersion === 2 && value.capabilities.includes('binding_lease')) {
        requireValue(value.capabilities.includes('binding_renew') && Number.isInteger(value.limits.binding_lease_min_ms) && Number.isInteger(value.limits.binding_lease_max_ms) && value.limits.binding_lease_min_ms > 0 && value.limits.binding_lease_max_ms >= value.limits.binding_lease_min_ms, 'Invalid binding lease capabilities or limits')
        leaseLimits = { binding_lease_min_ms: value.limits.binding_lease_min_ms, binding_lease_max_ms: value.limits.binding_lease_max_ms }
      }
      return { protocol, ...(apiVersion === 2 ? { api_version: 2 } : {}), instance_id: value.instance_id, tool_version: value.tool_version, dto_schema_version: 1, config_format_version: 1, capabilities: [...value.capabilities], limits: { request_bytes: requestLimit, response_bytes: responseLimit, sdk_read_timeout_ms: 5000, max_bindings: value.limits.max_bindings, ...(leaseLimits ?? {}) } }
    },
    async targets(instanceId, signal) {
      const value = await request('/targets', { instanceId, signal })
      requireValue(Array.isArray(value.targets), 'Integration target list is missing')
      requireValue(typeof value.discovery_limited === 'boolean' && (value.discovery_reason === null || text(value.discovery_reason)), 'Integration discovery completeness is missing')
      const targets = value.targets.map(t => {
        requireValue(text(t.target_id) && ['usb', 'can'].includes(t.transport) && typeof t.connected === 'boolean' && typeof t.can_attach === 'boolean' && typeof t.can_connect === 'boolean', 'Invalid integration target')
        requireValue((t.identity === null || identity(t.identity)) && (t.connection_generation === null || decimal(t.connection_generation)), 'Invalid target identity or decimal generation')
        requireValue(!t.can_attach || (t.connected && identity(t.identity) && decimal(t.connection_generation)), 'Attach target lacks a verified owner connection')
        requireValue(!t.can_connect || (t.transport === 'usb' && !t.connected), 'Only unconnected USB candidates allow connect')
        return { target_id: t.target_id, transport: t.transport, connected: t.connected, identity: t.identity ? { uid: t.identity.uid, run_nonce: t.identity.run_nonce } : null, connection_generation: t.connection_generation, can_attach: t.can_attach, can_connect: t.can_connect }
      })
      return { protocol, instance_id: value.instance_id, targets, discovery_limited: value.discovery_limited, discovery_reason: value.discovery_reason }
    },
    async bind(body, signal) {
      requireValue(['attach', 'connect'].includes(body.intent) && text(body.instance_id) && text(body.target_id), 'Invalid binding request')
      const requestBody = { instance_id: body.instance_id, target_id: body.target_id, intent: body.intent }
      if (body.lease_ms !== undefined) { requireValue(apiVersion === 2 && leaseLimits && Number.isInteger(body.lease_ms) && body.lease_ms >= leaseLimits.binding_lease_min_ms && body.lease_ms <= leaseLimits.binding_lease_max_ms, 'Binding lease is unsupported or out of range'); requestBody.lease_ms = body.lease_ms }
      if (body.expected_identity !== undefined) { requireValue(identity(body.expected_identity), 'Invalid expected identity'); requestBody.expected_identity = { uid: body.expected_identity.uid, run_nonce: body.expected_identity.run_nonce } }
      if (body.connection_generation !== undefined) { requireValue(decimal(body.connection_generation), 'Invalid decimal connection generation'); requestBody.connection_generation = body.connection_generation }
      requireValue(body.intent !== 'attach' || (requestBody.expected_identity && requestBody.connection_generation), 'Attach requires verified identity and generation')
      const value = bindingFields(await request('/bindings', { method: 'POST', body: requestBody, instanceId: body.instance_id, signal }))
      if (body.lease_ms !== undefined) requireValue(value.lease_ms === body.lease_ms, 'Binding lease response differs from request')
      if (value.target_id !== body.target_id || (body.intent === 'attach' && (value.connection_generation !== body.connection_generation || !sameIdentity(value.identity, body.expected_identity)))) throw new IntegrationError('identity_changed', 'Binding response differs from the selected target identity')
      return value
    },
    async snapshot(b, signal) {
      const value = await request(`${bindingPath(b)}/snapshot`, { instanceId: b.instance_id, signal })
      const result = checkBinding(value, b)
      if (apiVersion === 2) value.readiness = readPermit(value.read_permit)
      requireValue(value.readiness && typeof value.readiness.ready === 'boolean' && (value.readiness.reason_code === null || text(value.readiness.reason_code)) && (!value.readiness.ready || value.readiness.reason_code === null), 'Invalid owner readiness')
      requireValue(typeof value.native_json_text === 'string', 'Snapshot native JSON text is missing')
      return { ...result, ...(apiVersion === 2 ? { read_permit: readPermit(value.read_permit), control_effect: controlEffect(value.control_effect) } : {}), readiness: { ready: value.readiness.ready, reason_code: value.readiness.reason_code }, telemetry_received_age_ms: optionalAge(value.telemetry_received_age_ms), native_json_text: value.native_json_text }
    },
    async read(b, action, signal) {
      if (!actions.has(action)) throw new TypeError('Unsupported integration read action')
      const value = await request(`${bindingPath(b)}/${apiVersion === 2 ? 'reads' : 'read'}`, { method: 'POST', instanceId: b.instance_id, signal, body: { instance_id: b.instance_id, connection_generation: b.connection_generation, expected_identity: b.identity, action } })
      const result = checkBinding(value, b)
      requireValue(value.action === action && typeof value.native_json_text === 'string', 'Invalid read action or native JSON text')
      requireValue(value.source_timestamp === null || (value.source_timestamp?.clock === 'device_monotonic_us' && decimal(value.source_timestamp.value)), 'Source timestamp must contain a canonical decimal string')
      const source = value.source_timestamp === null ? null : { clock: value.source_timestamp.clock, value: value.source_timestamp.value }
      const extra = {}
      if (action.startsWith('config_')) {
        requireValue((typeof value.data_utf8 === 'string' || value.data_utf8 === null) && typeof value.data_hex === 'string' && /^([0-9a-f]{2})*$/.test(value.data_hex), 'Configuration read lacks original text/hex')
        extra.data_utf8 = value.data_utf8; extra.data_hex = value.data_hex
      }
      return { ...result, ...(apiVersion === 2 ? { read_permit: readPermit(value.read_permit), control_effect: controlEffect(value.control_effect) } : {}), action, source_timestamp: source, received_age_ms: optionalAge(value.received_age_ms), native_json_text: value.native_json_text, ...extra }
    },
    async renew(b) {
      requireValue(apiVersion === 2 && leaseLimits && Number.isInteger(b.lease_ms) && b.lease_ms > 0, 'Binding renewal requires a supported lease')
      const value = await request(`${bindingPath(b)}/renew`, { method: 'POST', instanceId: b.instance_id, body: { instance_id: b.instance_id, expected_identity: b.identity, connection_generation: b.connection_generation } })
      const result = checkBinding(value, b)
      requireValue(value.lease_ms === b.lease_ms, 'Binding renewal changed the lease duration')
      return result
    },
    async instance(instanceId, signal) {
      requireValue(apiVersion === 2, 'Instance status requires v2')
      return instanceSummary(await request('/instance', { instanceId, signal }))
    },
    async shutdown(instanceId, confirmation) {
      requireValue(apiVersion === 2 && confirmation === 'shutdown_service_without_stopping_devices', 'Explicit service shutdown confirmation is required')
      const value = await request('/shutdown', { method: 'POST', instanceId, body: { instance_id: instanceId, confirmation } })
      requireValue(value.accepted === true && value.service_state === 'shutting_down', 'Invalid shutdown acknowledgement')
      return { ...instanceSummary(value), accepted: true }
    },
    async detach(b, signal) { await request(bindingPath(b), { method: 'DELETE', instanceId: b.instance_id, signal }); return null },
  }
}

function readPermit(value) {
  requireValue(value && typeof value.ready === 'boolean' && (value.reason_code === null || text(value.reason_code)) && (!value.ready || value.reason_code === null), 'Invalid service read permit')
  return { ready: value.ready, reason_code: value.reason_code }
}
function controlEffect(value) {
  requireValue(value && ['unknown', 'not_observed'].includes(value.state) && (value.reason_code === null || text(value.reason_code)), 'Invalid service control effect')
  return { state: value.state, reason_code: value.reason_code }
}
function instanceSummary(value) {
  requireValue(text(value.tool_version) && decimal(value.pid) && decimal(value.started_at_unix_ms) && text(value.endpoint) && ['running', 'shutting_down'].includes(value.service_state) && value.device_stop_requested === false, 'Invalid service instance summary')
  requireValue(value.activity && typeof value.activity.trial_active === 'boolean' && typeof value.activity.trial_unresolved === 'boolean' && (value.activity.read_blocker === null || text(value.activity.read_blocker)) && Array.isArray(value.sessions), 'Invalid service activity')
  const sessions = value.sessions.map(s => {
    requireValue(text(s.session_id) && typeof s.connected === 'boolean' && typeof s.heartbeat_active === 'boolean' && typeof s.recording_active === 'boolean' && (s.trial_state === null || typeof s.trial_state === 'string'), 'Invalid service session summary')
    return { session_id: s.session_id, connected: s.connected, heartbeat_active: s.heartbeat_active, recording_active: s.recording_active, trial_state: s.trial_state }
  })
  return { instance_id: value.instance_id, tool_version: value.tool_version, pid: value.pid, started_at_unix_ms: value.started_at_unix_ms, endpoint: value.endpoint, service_state: value.service_state, sessions, activity: { trial_active: value.activity.trial_active, trial_unresolved: value.activity.trial_unresolved, read_blocker: value.activity.read_blocker }, control_effect: controlEffect(value.control_effect), device_stop_requested: false }
}
