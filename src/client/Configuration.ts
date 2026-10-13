import React, { useRef, useState } from 'react'
import { errorText, panelStyles } from './shared.js'
import { downloadBlob } from './async.js'

export type ConfigurationView = 'factory' | 'startup' | 'user'
export interface ConfigurationProps {
  rawText: string
  onChange(rawText: string): void
  records?: Partial<Record<ConfigurationView, string | null>>
  schema?: unknown
  nativeSchemaText?: string
  onValidate(rawText: string): Promise<unknown>
  busy?: boolean
  onRead?(view: ConfigurationView): Promise<void>
  onLoadSchema?(): Promise<void>
}

const views: readonly ConfigurationView[] = ['factory', 'startup', 'user']
const labels = { factory: 'Factory', startup: 'Startup', user: 'User' }

export function configurationDiff(baseline: string, candidate: string) {
  const before = baseline.split('\n'), after = candidate.split('\n')
  return Array.from({ length: Math.max(before.length, after.length) }, (_, index) => ({
    line: index + 1, before: before[index] ?? null, after: after[index] ?? null,
  })).filter(row => row.before !== row.after)
}

interface SchemaHint { path: string; description: string; constraints: string }
export function configurationSchemaHints(schema: unknown): SchemaHint[] {
  if (!schema || typeof schema !== 'object') return []
  const root = schema as Record<string, any>, output: SchemaHint[] = []
  const visit = (node: any, path: string, parents: Set<object>) => {
    if (!node || typeof node !== 'object' || parents.has(node)) return
    const nextParents = new Set(parents).add(node)
    if (typeof node.$ref === 'string' && node.$ref.startsWith('#/$defs/')) {
      const definition = root.$defs?.[node.$ref.slice('#/$defs/'.length)]
      if (definition && typeof definition === 'object') node = { ...definition, ...node, $ref: undefined }
    }
    const constraints = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'const', 'enum']
      .filter(key => node[key] !== undefined).map(key => `${key}: ${JSON.stringify(node[key])}`).join('；')
    if (node.description || constraints) output.push({ path: path || '/', description: String(node.description ?? ''), constraints })
    if (node.properties && typeof node.properties === 'object') for (const [key, child] of Object.entries(node.properties)) {
      visit(child, `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, nextParents)
    }
  }
  visit(root, '', new Set())
  return output
}

export function Configuration(props: ConfigurationProps) {
  const [baseline, setBaseline] = useState<ConfigurationView>('startup')
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState('')
  const [validation, setValidation] = useState<{ raw: string; result: unknown } | null>(null)
  const latest = useRef(props.rawText)
  const operation = useRef(0)
  latest.current = props.rawText
  const busy = props.busy === true || pending
  const styles = panelStyles(busy)
  const inputStyle = { width: '100%', boxSizing: 'border-box' as const, color: 'inherit', background: 'var(--dsh-bg, transparent)', border: '1px solid var(--dsh-border, #667)', borderRadius: 7, padding: 8 }
  const source = props.records?.[baseline]
  const changes = source === null || source === undefined ? null : configurationDiff(source, props.rawText)
  const hints = configurationSchemaHints(props.schema)
  const action = async (work: () => Promise<unknown>, validating = false) => {
    if (busy) return
    const ticket = ++operation.current, raw = props.rawText
    setPending(true); setNotice(validating ? 'SDK 正在校验完整原文。' : '正在读取 SDK 配置资料。')
    try {
      const result = await work()
      if (ticket !== operation.current || latest.current !== raw) return
      if (validating) setValidation({ raw, result })
      setNotice(validating ? 'SDK 校验已返回；请查看结果。静态有效不证明设备已采用或安全。' : '配置资料读取完成。')
    } catch (error) {
      if (ticket === operation.current && latest.current === raw) setNotice(`操作失败：${errorText(error)}`)
    } finally { if (ticket === operation.current) setPending(false) }
  }
  const importFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target, file = input.files?.[0]
    if (!file || busy) return
    const ticket = ++operation.current, raw = props.rawText
    setPending(true)
    try {
      const imported = await file.text()
      if (ticket !== operation.current || latest.current !== raw) return
      props.onChange(imported); setValidation(null); setNotice('完整原文已导入；尚未由 SDK 校验。')
    } catch (error) { if (ticket === operation.current) setNotice(`导入失败：${errorText(error)}`) }
    finally { input.value = ''; if (ticket === operation.current) setPending(false) }
  }
  return React.createElement('section', { style: styles.card, 'aria-label': '配置原文编辑' },
    React.createElement('h2', null, '配置原文'),
    React.createElement('p', null, '完整原文是提交依据。导入、编辑和导出保留数值文字与未编辑内容；本页不会写入设备。'),
    React.createElement('div', { style: styles.row },
      React.createElement('label', null, '导入完整配置文件 ', React.createElement('input', { type: 'file', accept: '.json,application/json', disabled: busy, onChange: importFile })),
      React.createElement('button', { style: styles.button, disabled: busy || !props.rawText, onClick: () => downloadBlob('eha-config-candidate.json', new Blob([props.rawText], { type: 'application/json;charset=utf-8' })) }, '导出候选原文'),
      React.createElement('button', { style: styles.button, disabled: busy || !props.rawText, onClick: () => action(() => props.onValidate(props.rawText), true) }, 'SDK 静态校验')),
    React.createElement('label', { style: { display: 'block', marginTop: 12 } }, '候选完整配置原文',
      React.createElement('textarea', { value: props.rawText, rows: 14, spellCheck: false, disabled: busy, style: { ...inputStyle, fontFamily: styles.mono.fontFamily }, onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => { operation.current++; props.onChange(event.target.value); setValidation(null); setNotice('候选原文已编辑；尚未由 SDK 校验。') } })),
    notice && React.createElement('p', { role: 'status', 'aria-live': 'polite' }, notice),
    validation?.raw === props.rawText && React.createElement('details', { open: true }, React.createElement('summary', null, 'SDK 校验结果'), React.createElement('pre', { style: styles.mono }, typeof validation.result === 'string' ? validation.result : JSON.stringify(validation.result, null, 2))),
    React.createElement('h3', null, '设备配置原文与候选差异'),
    React.createElement('p', null, '各视图只表示对应读取证据。Startup 是本次启动配置，User 是持久记录；候选不代表已经采用。'),
    ...views.map(view => React.createElement('details', { key: view },
      React.createElement('summary', null, labels[view]),
      React.createElement('div', { style: styles.row },
        props.onRead && React.createElement('button', { style: styles.button, disabled: busy, onClick: () => action(() => props.onRead!(view)) }, `读取 ${labels[view]}`),
        React.createElement('button', { style: styles.button, disabled: busy || props.records?.[view] === null || props.records?.[view] === undefined, onClick: () => { operation.current++; props.onChange(props.records![view]!); setValidation(null); setNotice(`已使用 ${labels[view]} 完整原文；尚未校验候选。`) } }, `使用 ${labels[view]} 原文`)),
      React.createElement('pre', { style: styles.mono }, props.records?.[view] ?? '尚无该视图的读取证据。'))),
    React.createElement('label', { style: { display: 'block', marginTop: 12 } }, '对比基线 ', React.createElement('select', { value: baseline, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => setBaseline(event.target.value as ConfigurationView), style: { ...inputStyle, width: 'auto' } }, ...views.map(view => React.createElement('option', { key: view, value: view }, labels[view])))),
    React.createElement('p', null, changes === null ? '尚无所选基线原文。' : changes.length ? `与 ${labels[baseline]} 有 ${changes.length} 行原文差异（包含格式差异）。` : `与 ${labels[baseline]} 原文一致。`),
    changes !== null && changes.length > 0 && React.createElement('details', null, React.createElement('summary', null, '查看原文差异'),
      ...changes.map(change => React.createElement('div', { key: change.line }, React.createElement('strong', null, `行 ${change.line}`), React.createElement('pre', { style: styles.mono }, `${labels[baseline]}：${change.before ?? '（缺失行）'}\n候选：${change.after ?? '（缺失行）'}`)))),
    React.createElement('h3', null, 'SDK 字段与单位说明'),
    props.onLoadSchema && React.createElement('button', { style: styles.button, disabled: busy, onClick: () => action(() => props.onLoadSchema!()) }, '读取 SDK Schema'),
    React.createElement('p', null, '以下单位、范围和说明来自 SDK Schema，仅作提示；是否合法仍由 SDK 静态校验判断。'),
    hints.length ? React.createElement('details', null, React.createElement('summary', null, '查看字段说明'), ...hints.map(hint => React.createElement('p', { key: hint.path }, React.createElement('code', null, hint.path), ` ${hint.description} ${hint.constraints}`))) : React.createElement('p', null, '尚未取得可展示的 SDK Schema。'),
    (props.nativeSchemaText !== undefined || props.schema !== undefined) && React.createElement('details', null, React.createElement('summary', null, '查看 SDK Schema'), React.createElement('pre', { style: styles.mono }, props.nativeSchemaText ?? (typeof props.schema === 'string' ? props.schema : JSON.stringify(props.schema, null, 2)))))
}
