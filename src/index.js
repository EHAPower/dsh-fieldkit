import { readFileSync } from 'node:fs'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FieldkitRemote } from '../lib/remote.js'
import { createFieldkitService } from './service.js'

export const name = 'dsh-fieldkit'
export const inject = ['tools', 'skills']
export const Config = Schema.object({
  deviceMode: Schema.union(['integration', 'legacy-cli']).default('integration').description('Use the persistent official eha-tool owner, or explicitly opt into separate legacy CLI snapshots. No automatic fallback.'),
  integrationUrl: Schema.string().description('Explicit HTTP loopback origin of the official eha-tool webui, for example http://127.0.0.1:8080.'),
  integrationTokenFile: Schema.string().description('Absolute local mode-0600 token file; credentials stay in the host process.'),
  toolPath: Schema.string().description('Absolute public eha-tool executable path for offline config-check and explicit legacy mode.'),
  reportsDir: Schema.string().description('Absolute user-data directory for local reports.'),
})
const skillNames = ['connect-check', 'state-triage', 'configuration-review']
const output = { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
const currentSession = exec => {
  const id = exec?.agent?.id
  if (typeof id !== 'string' || !id) throw new Error('A trusted DSH agent session is required for device access')
  return id
}
function excerpt(text, budget) {
  const bytes = Buffer.from(text)
  if (bytes.length <= budget) return { text, bytes: bytes.length, truncated: false }
  let end = budget
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--
  return { text: bytes.subarray(0, end).toString('utf8'), bytes: end, truncated: true }
}
function toolRun(run) {
  let remaining = 32 * 1024
  const evidence = run.evidence.map(item => {
    const raw = item.nativeJsonText ?? item.stdout ?? ''
    const native = excerpt(raw, Math.min(8 * 1024, remaining))
    remaining -= native.bytes
    const stderr = excerpt(item.stderr ?? '', Math.min(8 * 1024 - native.bytes, remaining))
    remaining -= stderr.bytes
    return { action: item.action, origin: item.origin ?? 'legacy_cli', receivedAt: item.receivedAt, identity: item.identity ?? null, sourceTimestamp: item.sourceTimestamp ?? null, error: item.error ? { ...item.error, message: excerpt(item.error.message ?? '', 1024).text } : null, nativeJsonText: native.text, stderr: stderr.text, truncated: native.truncated || stderr.truncated, nativeTextBytes: Buffer.byteLength(raw) }
  })
  return { ...run, error: run.error ? { ...run.error, message: excerpt(run.error.message ?? '', 1024).text } : null, evidence, evidenceBudgetBytes: 32 * 1024, evidenceIsExcerpt: evidence.some(item => item.truncated), fullEvidenceReports: run.reports ?? null }
}

export function apply(ctx, config = {}) {
  const service = createFieldkitService(config)
  ctx.provide('fieldkit', service)
  ctx.plugin(FieldkitRemote)
  ctx.on('dispose', () => service.dispose())
  const legacy = (config.deviceMode ?? 'integration') === 'legacy-cli'
  const diagnosisName = legacy ? 'fieldkit_diagnose_usb' : 'fieldkit_diagnose'
  const allowedTools = new Set(['fieldkit_devices', diagnosisName, 'fieldkit_check_configuration', 'skill', 'ask_user_question', 'present'])
  ctx.tools.guard(execution => {
    if (!allowedTools.has(execution.name)) return 'Fieldkit permits only its public read-only workflows'
    if (['fieldkit_devices', diagnosisName].includes(execution.name) && !execution.agent?.id) return 'Device tools require a trusted current DSH session'
    if (execution.name === 'skill' && !skillNames.includes(execution.arguments?.name)) return 'Only bundled Fieldkit skills are permitted'
    if (execution.name === 'present' && (!Array.isArray(execution.arguments?.files) || execution.arguments.files.some(file => !service.hasReport(execution.agent?.id, file?.path)))) return 'Only reports belonging to this DSH session may be presented'
  })
  for (const skillName of skillNames) {
    const raw = readFileSync(new URL(`../skills/${skillName}/SKILL.md`, import.meta.url), 'utf8')
    const description = raw.match(/^description: (.+)$/m)?.[1] ?? skillName
    ctx.skills.register({ name: skillName, description, source: 'bundled', content: raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '') })
  }
  ctx.tools.register(defineTool({
    name: 'fieldkit_devices',
    description: 'List official eha-tool targets and this chat selected binding. Enumeration does not select or verify a device. In integration mode the user selects the target in the workbench.',
    parameters: {}, output,
    async execute(_args, exec) { return service.listTargets(currentSession(exec)) },
  }))
  ctx.tools.register(defineTool({
    name: diagnosisName,
    description: legacy ? 'Collect the original six separate read-only CLI snapshots for the full USB serial explicitly selected by the user. Stops at the first failed read or identity change.' : 'Diagnose only the immutable binding explicitly selected for this chat. Collect verified connection identity and five owner-gated reads, save complete or partial evidence. Completeness does not establish device safety.',
    parameters: legacy ? { serial: { type: 'string', required: true, description: 'Full USB serial explicitly selected by the user.' } } : { bindingId: { type: 'string', required: true, description: 'Exact bindingId selected for this chat in the workbench; cannot select a different target.' } }, output,
    async execute(args, exec) {
      const sessionId = currentSession(exec)
      let bindingId = args.bindingId
      if (legacy) {
        let binding = service.selectedBinding(sessionId)
        if (binding && binding.targetId !== args.serial) throw new Error('USB serial does not match this session selected binding')
        if (!binding) {
          await service.listTargets(sessionId)
          binding = await service.openTarget(sessionId, { targetId: args.serial, intent: 'connect' })
        }
        bindingId = binding.bindingId
      }
      return toolRun(await service.diagnose(sessionId, { bindingId }, exec.signal))
    },
  }))
  ctx.tools.register(defineTool({
    name: 'fieldkit_check_configuration',
    description: 'Run official offline config-check on a full configuration record. Supply original JSON text to preserve large numbers and formatting. Static validity does not certify safe motion.',
    parameters: { record: { type: 'json', required: true, description: 'Complete original JSON text (preferred), or a JSON record. No patch or arbitrary file path.' } }, output,
    async execute(args, exec) { return service.checkConfiguration(args.record, exec?.signal) },
  }))
}
