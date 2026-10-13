import { defineTool } from '@deepseek-ai/dsh-tools'

const budget = 8192
const output = { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
const raw = { type: 'string', required: true }
const object = properties => ({ type: 'object', additionalProperties: false, properties })
const commandFields = { position: ['mm'], velocity: ['mm_s'], force: ['n'], impedance: ['equilibrium_mm', 'stiffness_n_per_mm', 'damping_ns_per_mm'], heartbeat_start: [], heartbeat_stop: [], heartbeat_once: [] }
const commandSchema = { required: true, oneOf: Object.entries(commandFields).map(([action, fields]) => object({ action: { ...raw, const: action }, ...Object.fromEntries(fields.map(field => [field, raw])) })) }
const trialCommand = ['positionMm', 'velocityMmS', 'forceN', 'equilibriumMm', 'stiffnessNPerMm', 'dampingNsPerMm']
const envelope = ['positionMinMm', 'positionMaxMm', 'velocityAbsMaxMmS', 'forceAbsMaxN', 'stiffnessMaxNPerMm', 'dampingMaxNsPerMm', 'durationMaxS']
const strings = names => Object.fromEntries(names.map(name => [name, raw]))
const parametersSchema = { ...object({ mode: { ...raw, enum: ['position', 'velocity', 'force', 'impedance'] }, command: { ...object(strings(trialCommand)), required: true }, envelope: { ...object(strings(envelope)), required: true }, durationS: raw, reach: { required: true, oneOf: [{ type: 'null' }, object(strings(['toleranceMm', 'settleMs']))] } }), required: true }
function session(exec) {
  const id = exec?.agent?.id
  if (typeof id !== 'string' || !id || id.length > 256) throw new Error('控制工具需要可信 exec.agent.id 会话')
  return id
}
function fields(args, allowed) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new TypeError('控制工具参数必须是对象')
  for (const key of Object.keys(args)) if (!allowed.includes(key)) throw new TypeError(`控制工具不接受参数 ${key}`)
}
function identifier(value, name) {
  if (typeof value !== 'string' || !value || value.length > 256) throw new TypeError(`${name} 必须是完整的既有标识`)
  return value
}
function rawFields(value, names) {
  fields(value, names)
  for (const name of names) if (typeof value[name] !== 'string') throw new TypeError(`${name} 必须是 SDK 原始字符串`)
}
function command(value) {
  if (!value || !Object.hasOwn(commandFields, value.action)) throw new TypeError('不支持的控制动作')
  rawFields(value, ['action', ...commandFields[value.action]])
  return value
}
function trial(value) {
  fields(value, ['mode', 'command', 'envelope', 'durationS', 'reach'])
  if (!['position', 'velocity', 'force', 'impedance'].includes(value.mode) || typeof value.durationS !== 'string') throw new TypeError('试验模式与时长必须完整')
  rawFields(value.command, trialCommand); rawFields(value.envelope, envelope)
  if (value.reach !== null) rawFields(value.reach, ['toleranceMm', 'settleMs'])
  return value
}
const target = { instanceId: 256, bindingId: 256, targetId: 256, uid: 64, runNonce: 64, connectionGeneration: 64 }
const error = { code: 128, message: 512 }
const member = { target, operationId: 256, admission: 64, submission: 64, controlEffect: 64, observation: 64, phase: 64, unknown: true, unknownSource: 32, nativeJsonText: 'native', error, stopAttemptDelayMs: 64, trialId: 256, recordingId: 256, previousOperationId: 256, previousSubmission: 64, previousUnknown: true, previousNativeJsonText: 'native' }
const result = { scopeId: 256, action: 64, results: [member], unknown: true, newSubmission: true, coalescedExisting: true }
const trialResult = { ...member, preparation: 64, trialState: 64, stopObserved: true, stopConfirmationOverdue: true, elapsedMs: 64, trialNativeJsonText: 'native' }
const trialReceipt = { statusRead: 32, statusReason: 256, referenceReleased: true, trialId: 256, members: [target], mode: 32, state: 64, progress: [256], results: [trialResult], unknown: true, stopAvailable: true, recordingIds: [256], newSubmission: true, coalescedExisting: true }
const scope = { scopeId: 256, instanceId: 256, members: [{ target, grantId: 256 }], kind: 32, state: 32, controlGranted: true, controlReady: true, reason: 256, stopAvailable: true, stopReason: 256, latest: result, lastOrdinary: result, trial: trialReceipt, recordings: [{ target, active: true, failed: true, recordingId: 256, nativeJsonText: 'native', error }] }
const context = { scopes: [scope], activeScopeId: 256, capabilities: [128] }
function prefix(bytes, end) {
  while (end > 0 && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--
  return bytes.subarray(0, end).toString('utf8')
}
// Whitelist DTO facts. SDK native text is evidence only; its final escaped JSON bytes share one budget.
function project(source, schema) {
  if (schema === context && Array.isArray(source?.scopes)) source = { ...source, scopes: [...source.scopes.filter(scope => scope.scopeId === source.activeScopeId), ...source.scopes.filter(scope => scope.scopeId !== source.activeScopeId)] }
  let excerpt = false, containsUnknown = false, containsPreviousUnknown = false
  function scan(value, spec) {
    if (!value || typeof value !== 'object') return
    if (spec.unknown && (value.unknown === true || value.submission === 'unknown')) containsUnknown = true
    if (spec.previousUnknown && value.previousUnknown === true) containsPreviousUnknown = true
    if (Array.isArray(spec)) { if (Array.isArray(value)) for (const child of value) scan(child, spec[0]); return }
    for (const [key, child] of Object.entries(spec)) if (typeof child === 'object') scan(value[key], child)
  }
  scan(source, schema)
  function copy(value, spec) {
    if (value === null) return null
    if (Array.isArray(spec)) {
      if (!Array.isArray(value)) return []
      if (value.length > 32) excerpt = true
      return value.slice(0, 32).map(child => copy(child, spec[0]))
    }
    if (typeof spec === 'object') {
      const out = {}
      for (const [key, child] of Object.entries(spec)) if (value && Object.hasOwn(value, key)) {
        out[key] = copy(value[key], child)
        if (Array.isArray(child) && Array.isArray(value[key])) out[`${key}OmittedCount`] = Math.max(0, value[key].length - out[key].length)
        if (child === 'native' && typeof value[key] === 'string') out[`${key}Bytes`] = Buffer.byteLength(value[key])
      }
      return out
    }
    if (spec === true) return typeof value === 'boolean' ? value : null
    if (typeof value !== 'string') return null
    if (spec === 'native') return ''
    const bytes = Buffer.from(value), clipped = prefix(bytes, spec)
    if (clipped !== value) excerpt = true
    return clipped
  }
  const projected = copy(source, schema)
  const out = { ...projected, containsUnknown, containsPreviousUnknown, evidenceBudgetBytes: budget, evidenceIsExcerpt: true }
  const size = () => Buffer.byteLength(JSON.stringify(out))
  function arrays(value, list = []) {
    for (const [key, child] of Object.entries(value ?? {})) if (Array.isArray(child)) { if (child.length) list.push({ owner: value, key, bytes: Buffer.byteLength(JSON.stringify(child)) }); for (const item of child) if (item && typeof item === 'object') arrays(item, list) } else if (child && typeof child === 'object') arrays(child, list)
    return list
  }
  while (size() >= budget) {
    const largest = arrays(out).sort((a, b) => b.bytes - a.bytes)[0]
    if (!largest) throw new Error('控制证据元数据超出预算')
    largest.owner[largest.key].pop(); largest.owner[`${largest.key}OmittedCount`]++
    excerpt = true
  }
  function native(value, original, spec) {
    if (!value || !original) return
    if (Array.isArray(spec)) { value.forEach((child, index) => native(child, original[index], spec[0])); return }
    for (const [key, child] of Object.entries(spec)) if (child === 'native' && typeof original[key] === 'string') {
      const bytes = Buffer.from(original[key]); let low = 0, high = Math.min(bytes.length, budget)
      while (low < high) { const middle = Math.ceil((low + high) / 2); value[key] = prefix(bytes, middle); if (size() < budget) low = middle; else high = middle - 1 }
      value[key] = prefix(bytes, low); if (Buffer.byteLength(value[key]) !== bytes.length) excerpt = true
    } else if (typeof child === 'object') native(value[key], original[key], child)
  }
  native(out, source, schema); out.evidenceIsExcerpt = excerpt
  return out
}

export function createControlTools(service) {
  const define = (name, description, parameters, validate, invoke, schema) => defineTool({ name, description, parameters, output, async execute(args, exec) { const id = session(exec); const request = validate(args); return project(await invoke(id, request), schema) } })
  const scopeOnly = args => { fields(args, ['scopeId']); return identifier(args.scopeId, 'scopeId') }
  const trialOnly = args => { fields(args, ['trialId']); return identifier(args.trialId, 'trialId') }
  const intent = '仅在用户明确请求此具体动作时使用人工已有固定范围。不得创建范围、生成授权或切换成员。原始字符串直接交 SDK；单次提交、不重试。受理和本地提交不证明设备效果，未知结果保留原编号。'
  return [
    define('fieldkit_control_context', '只读人工已建立的固定控制范围和逐成员事实；保留先前普通请求未知证据，不能创建或扩大授权。', {}, args => { fields(args, []); return null }, id => service.controlContext(id), context),
    define('fieldkit_control', intent, { scopeId: raw, command: commandSchema }, args => { fields(args, ['scopeId', 'command']); return { scopeId: identifier(args.scopeId, 'scopeId'), command: command(args.command) } }, (id, args) => service.submitControl(id, args), result),
    define('fieldkit_stop', `${intent} 普通 Stop 不是急停；只请求原固定范围 canonical Stop。`, { scopeId: raw }, scopeOnly, (id, scopeId) => service.stopControlScope(id, scopeId), result),
    define('fieldkit_trial', intent, { scopeId: raw, parameters: parametersSchema }, args => { fields(args, ['scopeId', 'parameters']); return { scopeId: identifier(args.scopeId, 'scopeId'), parameters: trial(args.parameters) } }, (id, args) => service.startControlTrial(id, args), trialReceipt),
    define('fieldkit_trial_status', '只读本对话已有原试验编号；不提交、恢复或自动停止。', { trialId: raw }, trialOnly, (id, trialId) => service.getControlTrial(id, trialId), trialReceipt),
    define('fieldkit_trial_target', intent, { trialId: raw, positionRaw: raw }, args => { fields(args, ['trialId', 'positionRaw']); if (typeof args.positionRaw !== 'string') throw new TypeError('positionRaw 必须是 SDK 原始字符串'); return { trialId: identifier(args.trialId, 'trialId'), positionRaw: args.positionRaw } }, (id, args) => service.updateControlTrial(id, args), trialReceipt),
    define('fieldkit_recording', `${intent} 录制动作不等同于控制 Stop。`, { scopeId: raw, action: { ...raw, enum: ['start', 'stop'] } }, args => { fields(args, ['scopeId', 'action']); if (!['start', 'stop'].includes(args.action)) throw new TypeError('不支持的录制动作'); return { scopeId: identifier(args.scopeId, 'scopeId'), action: args.action } }, (id, args) => service.recordControl(id, args), result),
  ]
}
