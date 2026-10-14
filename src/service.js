import { createOwnerProcess } from './owner-process.js'
import { createEhaTool } from './eha-tool.js'
import { resolveCommand } from './commands.js'

function sessionId(value) {
  if (typeof value !== 'string' || !value || value.length > 256) throw new TypeError('A trusted DSH session is required')
  return value
}

function target(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['transport', 'node', 'label'].includes(key))) throw new TypeError('Invalid target context')
  if (!['usb', 'can'].includes(value.transport) || (value.node !== null && (!Number.isInteger(value.node) || value.node < 0 || value.node > 127)) || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 256) throw new TypeError('Invalid target context')
  if (value.transport === 'usb' && value.node !== null) throw new TypeError('USB target context has no node')
  if (value.transport === 'can' && value.node === null) throw new TypeError('CAN target context requires a node')
  return { transport: value.transport, node: value.node, label: value.label }
}

function commandRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['command', 'bodyText', 'queryText'].includes(key)) || typeof value.command !== 'string' || typeof value.bodyText !== 'string' || typeof value.queryText !== 'string') throw new TypeError('Invalid command request')
  return value
}

function requireDirect(status) {
  if (!status?.description?.capabilities?.includes('direct_api')) throw Object.assign(new Error('Attached eha-tool service does not publish direct_api'), { code: 'unsupported' })
  return status
}

/** Thin DSH bridge: it retains only chat-local display context, with no device workflow state. */
export function createFieldkitService(config = {}, dependencies = {}) {
  const owner = dependencies.owner ?? createOwnerProcess(config, dependencies.ownerOptions)
  const contexts = new Map()
  let disposed = false
  const current = id => {
    sessionId(id)
    if (disposed) throw Object.assign(new Error('Fieldkit service is disposed'), { code: 'disposed' })
    if (!contexts.has(id)) contexts.set(id, { target: null, lastResult: null })
    return contexts.get(id)
  }
  const attached = async () => requireDirect(await owner.attach())
  return {
    async serviceStatus() { current('service-status'); return owner.status() },
    async saveServiceSettings(request) { current('service-settings'); return owner.save(request) },
    async startService() { current('service-start'); return requireDirect(await owner.start()) },
    async attachService() { current('service-attach'); return attached() },
    async shutdownService(request) {
      current('service-shutdown')
      if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some(key => key !== 'instanceId') || typeof request.instanceId !== 'string' || !request.instanceId) throw new TypeError('Invalid service shutdown request')
      return owner.shutdown({ instanceId: request.instanceId })
    },
    async describe() {
      current('service-describe')
      const status = await owner.status()
      return { available: status.attached, capabilities: status.description?.capabilities ?? [], instanceId: status.description?.instance_id ?? null }
    },
    async selectTarget(id, request) {
      const context = current(id)
      context.target = target(request)
      return { target: context.target, lastResult: context.lastResult }
    },
    async context(id) {
      const value = current(id)
      return { target: value.target, lastResult: value.lastResult }
    },
    async executeCommand(id, request, signal) {
      current(id)
      const input = commandRequest(request)
      const resolved = resolveCommand(input.command, input.bodyText, input.queryText)
      const response = await owner.client().direct(resolved.path, { method: resolved.method, bodyText: input.bodyText, signal })
      const result = { ...resolved, ...response, receivedAt: new Date().toISOString() }
      current(id).lastResult = result
      return result
    },
    async checkConfiguration(rawRecordText, signal) {
      current('configuration-check')
      if (typeof rawRecordText !== 'string') throw new TypeError('Complete original configuration text is required')
      const settings = await owner.getSettings()
      if (!settings.toolPath) throw Object.assign(new Error('Configure eha-tool before checking configuration'), { code: 'tool_missing' })
      return (dependencies.cli ?? createEhaTool({ binaryPath: settings.toolPath })).checkConfiguration(rawRecordText, signal)
    },
    async dispose() { disposed = true; contexts.clear(); owner.dispose?.(); return { disposed: true } },
  }
}
