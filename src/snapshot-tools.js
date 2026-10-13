import { defineTool } from '@deepseek-ai/dsh-tools'

const budget = 8192
const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }
function prefix(bytes, end) {
  while (end > 0 && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--
  return bytes.subarray(0, end).toString('utf8')
}
// Cache DTO facts only; native SDK text is never parsed into business values.
function project(snapshot) {
  let excerpt = false
  const text = (value, limit = 256) => {
    if (typeof value !== 'string') return null
    const bytes = Buffer.from(value); let low = 0, high = Math.min(bytes.length, limit)
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (Buffer.byteLength(JSON.stringify(prefix(bytes, middle))) <= limit) low = middle
      else high = middle - 1
    }
    const clipped = prefix(bytes, low)
    if (clipped !== value) excerpt = true
    return clipped
  }
  const effect = value => value ? { state: text(value.state, 64), reason_code: text(value.reason_code) } : null
  const warnings = snapshot.observationWarnings ?? []
  const result = {
    bindingId: text(snapshot.bindingId), targetId: text(snapshot.targetId), transport: text(snapshot.transport, 32),
    instanceId: text(snapshot.instanceId), identity: snapshot.identity ? { uid: text(snapshot.identity.uid, 64), runNonce: text(snapshot.identity.runNonce, 64) } : null,
    connectionGeneration: text(snapshot.connectionGeneration, 64), expired: snapshot.expired,
    observationWarnings: warnings.slice(0, 4).map(warning => ({ code: text(warning.code, 128), message: text(warning.message, 384), action: text(warning.action, 64), ...(typeof warning.unknown === 'boolean' ? { unknown: warning.unknown } : {}), ...(warning.controlEffect ? { controlEffect: effect(warning.controlEffect) } : {}) })),
    observationWarningsOmittedCount: Math.max(0, warnings.length - 4), observationWarningsContainUnknown: warnings.some(warning => warning.unknown === true),
    ...(snapshot.controlEffect ? { controlEffect: effect(snapshot.controlEffect) } : {}),
    ...(snapshot.readPermit ? { readPermit: { ready: snapshot.readPermit.ready, reason_code: text(snapshot.readPermit.reason_code) } } : {}),
    readiness: snapshot.readiness ? { ready: snapshot.readiness.ready, reasonCode: text(snapshot.readiness.reasonCode) } : null,
    telemetryReceivedAgeMs: text(snapshot.telemetryReceivedAgeMs, 64), receivedAt: text(snapshot.receivedAt, 64),
    readRun: snapshot.readRun ? { readRunId: text(snapshot.readRun.readRunId), bindingId: text(snapshot.readRun.bindingId), status: text(snapshot.readRun.status, 64), complete: snapshot.readRun.complete, evidenceOmitted: true } : null,
    nativeJsonText: typeof snapshot.nativeJsonText === 'string' ? '' : null,
    nativeTextBytes: typeof snapshot.nativeJsonText === 'string' ? Buffer.byteLength(snapshot.nativeJsonText) : 0,
    evidenceBudgetBytes: budget, evidenceIsExcerpt: true,
  }
  if (warnings.length > 4 || snapshot.readRun) excerpt = true
  // Reserve the complete escaped metadata before allocating any native evidence.
  while (Buffer.byteLength(JSON.stringify(result)) >= budget && result.observationWarnings.length) {
    result.observationWarnings.pop(); result.observationWarningsOmittedCount++; excerpt = true
  }
  if (typeof snapshot.nativeJsonText === 'string') {
    const bytes = Buffer.from(snapshot.nativeJsonText); let low = 0, high = Math.min(bytes.length, budget)
    while (low < high) {
      const middle = Math.ceil((low + high) / 2); result.nativeJsonText = prefix(bytes, middle)
      if (Buffer.byteLength(JSON.stringify(result)) < budget) low = middle
      else high = middle - 1
    }
    result.nativeJsonText = prefix(bytes, low)
    if (Buffer.byteLength(result.nativeJsonText) < bytes.length) excerpt = true
  }
  result.evidenceIsExcerpt = excerpt
  return result
}

export function createSnapshotTool(service, mode = 'service-v2') {
  return defineTool({
    name: 'fieldkit_snapshot',
    description: '只读取当前对话人工已选观察绑定的官方服务缓存，不发设备主动查询、心跳、诊断、控制或配置读取。无人工绑定、旧绑定或 legacy-cli 不支持时明确拒绝，不自动选择、重连、诊断或回落。原文是缓存证据；身份缓存年龄与遥测年龄分开，不证明设备停止或安全。',
    parameters: {},
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const sessionId = exec?.agent?.id
      if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256) fail('invalid_session', '缓存工具需要可信 exec.agent.id 会话')
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) throw new TypeError('缓存工具不接受参数；目标只能来自本对话人工已选绑定')
      if (mode === 'legacy-cli') fail('unsupported', 'legacy-cli 不支持只读服务缓存；不会以主动诊断替代')
      const binding = service.selectedBinding(sessionId)
      if (!binding) fail('selection_required', '本对话尚无人工选定观察绑定；请在工作台明确选择')
      if (binding.expired) fail('binding_stale', '本对话人工观察绑定已过期；不会自动重连或诊断')
      const snapshot = await service.getSnapshot(sessionId, { bindingId: binding.bindingId })
      if (service.selectedBinding(sessionId)?.bindingId !== binding.bindingId) fail('stale_selection', '缓存读取期间人工观察绑定已改变；不将旧缓存归到新目标')
      return project(snapshot)
    },
  })
}
