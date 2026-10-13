import { defineTool } from '@deepseek-ai/dsh-tools'

const actions = new Set(['save_and_restart', 'restore_factory_and_restart', 'reset_application', 'enter_update'])
const budget = 8 * 1024
const output = { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }

function session(exec) {
  const id = exec?.agent?.id
  if (typeof id !== 'string' || !id || id.length > 256) throw new Error('维护工具需要可信 exec.agent.id 会话')
  return id
}
function fields(args, allowed) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new TypeError('维护工具参数必须是对象')
  for (const key of Object.keys(args)) if (!allowed.includes(key)) throw new TypeError(`维护工具不接受参数 ${key}`)
}
function identifier(value, name) {
  if (typeof value !== 'string' || !value || value.length > 256) throw new TypeError(`${name} 必须是完整的既有标识`)
  return value
}
function prefix(bytes, end) {
  while (end > 0 && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--
  return bytes.subarray(0, end).toString('utf8')
}
// 以最终 JSON 字节计预算，换行和引号的转义也计入；不解析 SDK 原文。
function text(value, limit) {
  if (typeof value !== 'string') return null
  const bytes = Buffer.from(value)
  let low = 0, high = Math.min(bytes.length, limit)
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(JSON.stringify(prefix(bytes, middle))) <= limit) low = middle
    else high = middle - 1
  }
  return prefix(bytes, low)
}
const target = value => value ? {
  instanceId: text(value.instanceId, 128), bindingId: text(value.bindingId, 128), targetId: text(value.targetId, 256),
  uid: text(value.uid, 32), runNonce: text(value.runNonce, 64), connectionGeneration: text(value.connectionGeneration, 32),
} : null
const grant = value => value ? { grantId: text(value.grantId, 128), target: target(value.target), maintenance: value.maintenance === true } : null
function operation(value) {
  if (!value) return null
  return {
    operationId: text(value.operationId, 256), grantId: text(value.grantId, 128), target: target(value.target), action: text(value.action, 32),
    admission: text(value.admission, 64), submission: text(value.submission, 64), unknown: value.unknown === true || value.submission === 'unknown', unknownSource: ['transport', 'sdk'].includes(value.unknownSource) ? value.unknownSource : null,
    controlEffect: text(value.controlEffect, 64), observation: text(value.observation, 64), phase: text(value.phase, 32),
    newSubmission: typeof value.newSubmission === 'boolean' ? value.newSubmission : null,
    followUp: value.followUp ? { reconnectRequired: value.followUp.reconnectRequired === true, readbackViews: [...new Set((Array.isArray(value.followUp.readbackViews) ? value.followUp.readbackViews : []).filter(view => view === 'user' || view === 'startup'))] } : null,
    error: value.error ? { code: text(value.error.code, 128), message: text(value.error.message, 512) } : null,
  }
}
function project(value, context = false) {
  const native = context ? value?.latestOperation?.nativeJsonText : value?.nativeJsonText
  const receipt = operation(context ? value?.latestOperation : value)
  const result = context ? { target: target(value?.target), grant: grant(value?.grant), latestOperation: receipt } : receipt
  if (!result) return null
  result.evidenceBudgetBytes = budget
  result.evidenceIsExcerpt = false
  if (receipt && typeof native === 'string') {
    const bytes = Buffer.from(native)
    receipt.nativeJsonText = ''
    receipt.nativeTextBytes = bytes.length
    // false 比 true 多一字节，预留该差额，保证完整原文时也不超过预算。
    result.evidenceIsExcerpt = true
    let low = 0, high = Math.min(bytes.length, budget)
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      receipt.nativeJsonText = prefix(bytes, middle)
      if (Buffer.byteLength(JSON.stringify(result)) < budget) low = middle
      else high = middle - 1
    }
    receipt.nativeJsonText = prefix(bytes, low)
    result.evidenceIsExcerpt = Buffer.byteLength(receipt.nativeJsonText) < bytes.length
  }
  return result
}

export function createMaintenanceTools(service) {
  return [
    defineTool({
      name: 'fieldkit_maintenance_context',
      description: '只读查看当前对话由人工选定的目标、人工已授权的维护 grant 和最近维护记录。grant 是权限边界，不代表用户已请求某个具体动作；本工具不能生成或扩大授权。',
      parameters: {}, output,
      async execute(args, exec) {
        const id = session(exec)
        fields(args, [])
        return project(await service.maintenanceContext(id), true)
      },
    }),
    defineTool({
      name: 'fieldkit_maintenance',
      description: '仅当用户在当前对话明确请求具体维护动作，且人工已授权当前目标 grant 时调用。四项动作固定；grant 不替代用户意图，不可由模型自动生成。保存必须传完整原始配置字符串。只提交一次，不自动重试、重连或读回；受理、本地提交和设备效果必须区分，未知结果只查询原 operation。',
      parameters: {
        grantId: { type: 'string', required: true, description: 'maintenance_context 返回的当前人工 grant，不能自签或跨会话复用。' },
        action: { type: 'string', required: true, enum: [...actions], description: '用户明确请求的固定动作：save_and_restart、restore_factory_and_restart、reset_application 或 enter_update。' },
        rawRecordText: { type: 'string', description: '仅 save_and_restart 必须提供完整原始配置文本；不得 parse/重序列化大整数或物理量。其他动作禁止此字段。' },
      }, output,
      async execute(args, exec) {
        const id = session(exec)
        fields(args, ['grantId', 'action', 'rawRecordText'])
        const grantId = identifier(args.grantId, 'grantId')
        if (!actions.has(args.action)) throw new TypeError('不支持的维护动作')
        const request = { grantId, action: args.action }
        if (args.action === 'save_and_restart') {
          if (typeof args.rawRecordText !== 'string') throw new TypeError('保存配置必须提供完整原始配置字符串')
          request.rawRecordText = args.rawRecordText
        } else if (Object.hasOwn(args, 'rawRecordText')) throw new TypeError('此维护动作禁止配置文本')
        return project(await service.submitMaintenance(id, request))
      },
    }),
    defineTool({
      name: 'fieldkit_maintenance_operation',
      description: '只读查询当前对话已登记的原维护 operation。可查询旧目标的历史记录；不提交、重发、重连或用新 grant 恢复未知动作。',
      parameters: { operationId: { type: 'string', required: true, description: '本对话已有维护回执中的完整 operationId。' } }, output,
      async execute(args, exec) {
        const id = session(exec)
        fields(args, ['operationId'])
        return project(await service.getMaintenanceOperation(id, identifier(args.operationId, 'operationId')))
      },
    }),
  ]
}
