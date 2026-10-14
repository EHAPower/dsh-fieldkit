import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { readFileSync } from 'node:fs'
import { FieldkitRemote } from '../lib/remote.js'
import { createFieldkitService } from './service.js'
import { directCommandGuide, directCommands } from './commands.js'

export const name = 'dsh-fieldkit'
export const inject = ['tools', 'skills']
export const Config = Schema.object({
  servicePort: Schema.number().default(18080).description('本地 eha-tool service 端口。'),
  serviceDataDir: Schema.string().description('eha-tool 服务私有数据目录。'),
  runsDir: Schema.string().description('可选记录目录。'),
  odrivePython: Schema.string().description('可选 ODrive Python 解释器。'),
  toolPath: Schema.string().description('官方 eha-tool 可执行文件绝对路径。'),
})

const output = { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
function currentSession(exec) {
  const id = exec?.agent?.id
  if (typeof id !== 'string' || !id) throw new Error('A trusted DSH agent session is required for eha-tool access')
  return id
}

export function apply(ctx, config = {}) {
  const service = createFieldkitService(config)
  ctx.provide('fieldkit', service)
  ctx.plugin(FieldkitRemote)
  ctx.on('dispose', () => service.dispose())
  for (const skillName of ['connect-check', 'state-triage', 'configuration-review']) {
    const raw = readFileSync(new URL(`../skills/${skillName}/SKILL.md`, import.meta.url), 'utf8')
    const description = raw.match(/^description: (.+)$/m)?.[1] ?? skillName
    ctx.skills.register({ name: skillName, description, source: 'bundled', content: raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '') })
  }
  ctx.tools.register(defineTool({
    name: 'fieldkit_context',
    description: 'Return this chat\'s target label, latest raw command result (lastResult), and the static eha-tool command catalogue. This reads display context only and sends no device request.',
    parameters: {}, output,
    async execute(_args, exec) {
      return { ...(await service.context(currentSession(exec))), guide: directCommandGuide }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'fieldkit_command',
    description: 'Run one fixed official eha-tool direct-api command and return its raw HTTP response. Use action with bodyText such as {"transport":"usb","action":"status"}, {"transport":"usb","action":"position","mm":0.5}, or {"transport":"can","node":1,"action":"status"}; use trial, group, recording, connect, disconnect, reconnect, can_connect or can_scan with their official /api JSON body. snapshot accepts queryText such as transport=usb or transport=can&node=1; recording_download requires run=RUN_ID&file=metadata.json|events.jsonl|telemetry.csv. bodyText remains original JSON text and is not rewritten.',
    parameters: {
      command: { type: 'string', required: true, enum: directCommands },
      bodyText: { type: 'string', required: true, description: 'Original JSON object text for POST commands; empty string for GET commands.' },
      queryText: { type: 'string', required: true, description: 'URLSearchParams text for GET command query; empty string when unused.' },
    }, output,
    async execute(args, exec) { return service.executeCommand(currentSession(exec), args, exec?.signal) },
  }))
  ctx.tools.register(defineTool({
    name: 'fieldkit_check_configuration',
    description: 'Run official eha-tool config-check on complete original configuration JSON text.',
    parameters: { record: { type: 'string', required: true } }, output,
    async execute(args, exec) { return service.checkConfiguration(args.record, exec?.signal) },
  }))
}
