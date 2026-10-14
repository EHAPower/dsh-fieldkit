import React, { useEffect, useMemo, useRef, useState } from 'react'
import { errorText, valueOf } from './shared.js'

type Target = { transport: 'usb' | 'can'; node: string; label: string }
type Result = { command: string; method: string; path: string; status: number; ok: boolean; bodyText: string; receivedAt: string }

const number = (value: string, name: string) => {
  const source = value.trim()
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(source)) throw new Error(`${name} 必须是合法 JSON 数字（例如 0.5）。`)
  return source
}
const integer = (value: string, name: string, min = 0, max = 127) => {
  const source = value.trim()
  if (!/^\d+$/.test(source) || Number(source) < min || Number(source) > max) throw new Error(`${name} 必须是 ${min}–${max} 的整数。`)
  return String(Number(source))
}
const obj = (fields: Array<[string, string, 'number' | 'string' | 'raw' | 'optional-number']>) => {
  const parts = fields.flatMap(([key, value, kind]) => {
    if (kind === 'optional-number' && !value.trim()) return []
    const encoded = kind === 'number' || kind === 'optional-number' ? number(value, key) : kind === 'raw' ? value : JSON.stringify(value)
    return [`${JSON.stringify(key)}:${encoded}`]
  })
  return `{${parts.join(',')}}`
}
const query = (target: Target, extra: Record<string, string> = {}) => {
  const values = new URLSearchParams({ transport: target.transport, ...extra })
  if (target.transport === 'can' && target.node.trim()) values.set('node', integer(target.node, 'CAN 节点'))
  return values.toString()
}
const bodyTarget = (target: Target) => target.transport === 'can'
  ? [['transport', 'can', 'string'] as const, ['node', integer(target.node, 'CAN 节点'), 'number'] as const]
  : [['transport', 'usb', 'string'] as const]
const nativeOk = (response: Result, node?: string) => {
  if (!response.ok) return false
  try {
    const body = JSON.parse(response.bodyText)
    if (body?.ok !== true) return false
    if (node && Array.isArray(body.results)) return body.results.some((item: any) => String(item?.node) === node && item?.ok === true)
    return true
  } catch { return false }
}

function Field({ label, value, onChange, type = 'text', hint, disabled = false }: any) {
  return React.createElement('label', { className: 'fieldkit-field' },
    React.createElement('span', null, label),
    React.createElement('input', { type, value, disabled, onChange: (event: any) => onChange(event.target.value) }),
    hint && React.createElement('small', null, hint),
  )
}

function Button({ children, onClick, disabled, kind = 'default' }: any) {
  return React.createElement('button', { className: `fieldkit-button fieldkit-button-${kind}`, type: 'button', disabled, onClick }, children)
}

function displayValue(value: any) {
  if (!value || typeof value !== 'object') return value === undefined || value === null ? null : String(value)
  const rendered = value.value === undefined || value.value === null ? '—' : String(value.value)
  const quality = [value.result_label, value.quality_label].filter(Boolean).join(' / ')
  return quality ? `${rendered} (${quality})` : rendered
}

function SnapshotSummary({ result }: { result: Result }) {
  let data: any
  try { data = JSON.parse(result.bodyText) } catch { return null }
  const state = data?.state ?? data?.snapshot ?? data
  const telemetry = state?.telemetry ?? state?.result?.telemetry ?? state?.session?.telemetry ?? state
  const measurements = state?.last_measurements ?? state?.result?.last_measurements
  const main = Array.isArray(telemetry?.main_values) ? telemetry.main_values : []
  const entries = [
    ['消息', data?.message], ['模式', telemetry?.target_mode_label], ['轴状态', telemetry?.axis_state_label ?? telemetry?.axis_state_raw],
    ['位置 mm', displayValue(main[0] ?? measurements?.position_mm)], ['速度 mm/s', displayValue(main[1] ?? measurements?.velocity_mm_s)], ['力 N', displayValue(main[4] ?? measurements?.main_force_n)],
  ].filter(([, entry]) => entry !== undefined && entry !== null)
  if (!entries.length) return null
  return React.createElement('div', { className: 'fieldkit-summary', 'aria-label': '返回摘要' }, entries.map(([label, entry]) => React.createElement('span', { key: String(label) }, React.createElement('b', null, `${label}：`), String(entry))))
}

function ResultPanel({ result, notice, onCopy }: { result: Result | null; notice: string; onCopy(): void }) {
  return React.createElement('section', { className: 'fieldkit-result', 'aria-label': '命令结果' },
    React.createElement('div', { className: 'fieldkit-section-title' }, React.createElement('div', null, React.createElement('h2', null, '命令结果'), React.createElement('p', { role: 'status', 'aria-live': 'polite' }, notice)), result && React.createElement(Button, { onClick: onCopy }, '复制原始返回')),
    result ? React.createElement(React.Fragment, null,
      React.createElement('p', { className: result.ok ? 'fieldkit-ok' : 'fieldkit-error' }, `${result.ok ? '已收到返回' : '返回错误'} · HTTP ${result.status} · ${result.method} ${result.path}`),
      React.createElement('p', { className: 'fieldkit-meta' }, `收到于 ${result.receivedAt}`),
      React.createElement(SnapshotSummary, { result }),
      React.createElement('details', { className: 'fieldkit-raw-result' }, React.createElement('summary', null, '原始返回'), React.createElement('pre', null, result.bodyText || '（空响应）')),
    ) : React.createElement('p', { className: 'fieldkit-empty' }, '执行命令后，这里会保留 eha-tool 的原始返回。'),
  )
}

export function CommandWorkbench({ remote, sessionId }: any) {
  const [target, setTarget] = useState<Target>({ transport: 'usb', node: '', label: 'USB（未填写）' })
  const [usbSerial, setUsbSerial] = useState('')
  const [usbDevices, setUsbDevices] = useState<Array<{ serial: string; description?: string }>>([])
  const [can, setCan] = useState({ channel: '', mode: 'fd', node: '1', start: '1', end: '4' })
  const [command, setCommand] = useState('status')
  const [value, setValue] = useState({ mm: '', mmS: '', n: '', equilibrium: '', stiffness: '', damping: '', view: 'startup', record: '' })
  const [trial, setTrial] = useState({ action: 'position', position: '', velocity: '', force: '', equilibrium: '', stiffness: '', damping: '', duration: '', min: '', max: '', velocityMax: '', forceMax: '', stiffnessMax: '', dampingMax: '', durationMax: '', tolerance: '', settle: '' })
  const [recording, setRecording] = useState({ action: 'start', run: '', file: 'metadata.json' })
  const [odriveSerial, setOdriveSerial] = useState('')
  const [groupText, setGroupText] = useState('{"nodes":[1],"action":"heartbeat_start"}')
  const [advanced, setAdvanced] = useState({ command: 'connection_save', bodyText: '{}', queryText: '' })
  const [result, setResult] = useState<Result | null>(null)
  const [notice, setNotice] = useState('选择连接方式，执行命令后在这里查看 eha-tool 原始返回。')
  const [busy, setBusy] = useState(false)
  const [connectionOpen, setConnectionOpen] = useState(true)
  const mounted = useRef(true)
  const pending = useRef(0)
  const selectionVersion = useRef(0)
  useEffect(() => () => { mounted.current = false }, [])
  useEffect(() => {
    let active = true
    const observedVersion = selectionVersion.current
    void remote.context(sessionId).then(valueOf).then((context: any) => {
      const saved = context?.target
      if (active && observedVersion === selectionVersion.current && saved && (saved.transport === 'usb' || saved.transport === 'can')) {
        setTarget({ transport: saved.transport, node: saved.node === null || saved.node === undefined ? '' : String(saved.node), label: saved.label || saved.transport })
        setConnectionOpen(false)
      }
    }).catch(() => {})
    return () => { active = false }
  }, [remote, sessionId])

  const selectedTitle = useMemo(() => target.transport === 'can' ? `命令参数：CAN · 节点 ${target.node || '未填写'}` : `命令参数：${target.label}`, [target])
  const run = async (name: string, bodyText = '', queryText = '', parallel = false) => {
    if (!sessionId || (pending.current > 0 && !parallel)) return null
    pending.current++; setBusy(true); setNotice(`正在执行 ${name}…`)
    try {
      const response = valueOf(await remote.executeCommand(sessionId, { command: name, bodyText, queryText })) as Result
      if (!mounted.current) return response
      setResult(response)
      if (name === 'devices' && response.ok) {
        try { const devices = JSON.parse(response.bodyText)?.devices; if (Array.isArray(devices)) setUsbDevices(devices.filter((item: any) => typeof item?.serial === 'string')) } catch { /* raw result remains available */ }
      }
      if (name === 'recording_download' && response.ok) {
        try {
          const file = new URLSearchParams(queryText).get('file') || 'recording.txt'
          const url = URL.createObjectURL(new Blob([response.bodyText], { type: 'text/plain;charset=utf-8' }))
          const anchor = document.createElement('a'); anchor.href = url; anchor.download = file; anchor.click(); URL.revokeObjectURL(url)
          setNotice('记录内容已返回，已请求浏览器下载。')
        } catch { setNotice('记录内容已返回；浏览器未能启动下载，可复制原始返回。') }
      }
      if (name !== 'recording_download' || !response.ok) setNotice(response.ok ? `${name} 已返回。` : `${name} 返回了错误；原始内容保留在右侧。`)
      return response
    } catch (error) { if (mounted.current) setNotice(`命令未完成：${errorText(error)}`) }
    finally { pending.current--; if (mounted.current) setBusy(pending.current > 0) }
  }
  const choose = async (next: Target) => {
    selectionVersion.current++
    setTarget(next)
    try {
      valueOf(await remote.selectTarget(sessionId, { transport: next.transport, node: next.transport === 'can' ? Number(next.node) : null, label: next.label }))
      setConnectionOpen(false)
    }
    catch (error) { setNotice(`对话上下文未同步：${errorText(error)}；本次设备命令结果仍保留。`) }
  }
  const actionBody = () => {
    const fields: any[] = [...bodyTarget(target), ['action', command, 'string']]
    if (command === 'position') fields.push(['mm', value.mm, 'number'])
    if (command === 'velocity') fields.push(['mm_s', value.mmS, 'number'])
    if (command === 'force') fields.push(['n', value.n, 'number'])
    if (command === 'impedance') fields.push(['equilibrium_mm', value.equilibrium, 'number'], ['stiffness_n_per_mm', value.stiffness, 'number'], ['damping_ns_per_mm', value.damping, 'number'])
    if (command === 'config_read') fields.push(['view', value.view, 'string'])
    if (command === 'config_validate' || command === 'config_save_and_restart') fields.push(['record', value.record, 'string'])
    return obj(fields)
  }
  const trialBody = () => {
    const commandFields: any[] = [['action', trial.action, 'string']]
    if (trial.action === 'position') commandFields.push(['mm', trial.position, 'number'])
    if (trial.action === 'velocity') commandFields.push(['mm_s', trial.velocity, 'number'])
    if (trial.action === 'force') commandFields.push(['n', trial.force, 'number'])
    if (trial.action === 'impedance') commandFields.push(['equilibrium_mm', trial.equilibrium, 'number'], ['stiffness_n_per_mm', trial.stiffness, 'number'], ['damping_ns_per_mm', trial.damping, 'number'])
    const commandText = obj(commandFields)
    const envelope = obj([
      ['position_min_mm', trial.min, 'number'], ['position_max_mm', trial.max, 'number'], ['velocity_abs_max_mm_s', trial.velocityMax, 'number'], ['force_abs_max_n', trial.forceMax, 'number'], ['stiffness_max_n_per_mm', trial.stiffnessMax, 'number'], ['damping_max_ns_per_mm', trial.dampingMax, 'number'], ['duration_max_s', trial.durationMax, 'number'],
    ])
    const settle = trial.settle.trim()
    if (settle && !/^(?:0|[1-9]\d*)$/.test(settle)) throw new Error('settle_ms 必须是合法 JSON 整数。')
    const reach = trial.tolerance.trim() || settle ? `{"tolerance_mm":${number(trial.tolerance, 'tolerance_mm')},"settle_ms":${settle || '0'}}` : 'null'
    const trialText = `{"command":${commandText},"envelope":${envelope},"duration_s":${trial.duration.trim() ? number(trial.duration, 'duration_s') : 'null'},"reach":${reach}}`
    const parts = [...bodyTarget(target).map(([key, field, kind]: any) => `${JSON.stringify(key)}:${kind === 'number' ? field : JSON.stringify(field)}`), '"action":"start"', `"trial":${trialText}`]
    return `{${parts.join(',')}}`
  }
  const copy = () => { if (result?.bodyText) void navigator.clipboard?.writeText(result.bodyText).then(() => setNotice('已复制原始返回。')).catch(() => setNotice('浏览器未允许复制；可从文本框手动复制。')) }
  const invoke = (name: string, body: () => string, queryText = '', parallel = false) => { try { void run(name, body(), queryText, parallel) } catch (error) { setNotice(`参数无效：${errorText(error)}`) } }
  const directStop = () => invoke('action', () => obj([...bodyTarget(target), ['action', 'stop', 'string']] as any), '', true)
  const field = (label: string, key: keyof typeof value, hint?: string) => React.createElement(Field, { label, value: value[key], hint, disabled: busy, onChange: (next: string) => setValue({ ...value, [key]: next }) })
  const trialField = (label: string, key: keyof typeof trial, hint?: string) => React.createElement(Field, { label, value: trial[key], hint, disabled: busy, onChange: (next: string) => setTrial({ ...trial, [key]: next }) })

  return React.createElement('main', { className: 'fieldkit-command' },
    React.createElement('section', { className: 'fieldkit-connection' },
      React.createElement('div', { className: 'fieldkit-section-title' }, React.createElement('div', null, React.createElement('h1', null, 'EHA Fieldkit'), React.createElement('p', null, '连接设备，选择命令，查看 eha-tool 返回。')), React.createElement('div', { className: 'fieldkit-actions' }, React.createElement('span', { className: 'fieldkit-target' }, selectedTitle), React.createElement(Button, { kind: 'danger', disabled: !sessionId, onClick: directStop }, '直接 Stop'))),
      React.createElement('details', { className: 'fieldkit-connect-details', open: connectionOpen, onToggle: (event: any) => setConnectionOpen(event.currentTarget.open) },
        React.createElement('summary', null, '连接设备'),
        React.createElement('div', { className: 'fieldkit-grid' },
        React.createElement('fieldset', null, React.createElement('legend', null, 'USB'),
          React.createElement(Field, { label: '设备序列号', value: usbSerial, disabled: busy, hint: '从系统枚举或设备标签填写。', onChange: setUsbSerial }),
          React.createElement('div', { className: 'fieldkit-actions' }, React.createElement(Button, { disabled: busy, onClick: () => run('devices') }, '枚举 USB'), React.createElement(Button, { onClick: () => { void choose({ transport: 'usb', node: '', label: 'USB（现有会话）' }) } }, '使用现有 USB'), React.createElement(Button, { kind: 'primary', disabled: busy || !usbSerial.trim(), onClick: async () => { const response = await run('connect', obj([['transport', 'usb', 'string'], ['serial', usbSerial, 'string']])); if (response && nativeOk(response)) await choose({ transport: 'usb', node: '', label: `USB · ${usbSerial}` }) } }, '连接 USB')),
          usbDevices.length > 0 && React.createElement('label', { className: 'fieldkit-field' }, React.createElement('span', null, '已枚举 USB 设备'), React.createElement('select', { value: usbDevices.some(device => device.serial === usbSerial) ? usbSerial : '', disabled: busy, onChange: (event: any) => setUsbSerial(event.target.value) }, React.createElement('option', { value: '' }, '选择设备（仅填入序列号）'), usbDevices.map(device => React.createElement('option', { key: device.serial, value: device.serial }, `${device.description ?? 'USB 设备'} · ${device.serial}`)))),
        ),
        React.createElement('fieldset', null, React.createElement('legend', null, 'CAN'),
          React.createElement('div', { className: 'fieldkit-mini-grid' },
            React.createElement(Field, { label: '通道', value: can.channel, disabled: busy, onChange: (next: string) => setCan({ ...can, channel: next }) }),
            React.createElement('label', { className: 'fieldkit-field' }, React.createElement('span', null, '帧格式'), React.createElement('select', { value: can.mode, disabled: busy, onChange: (event: any) => setCan({ ...can, mode: event.target.value }) }, React.createElement('option', { value: 'fd' }, 'FD'), React.createElement('option', { value: 'classic' }, 'classic'))),
            React.createElement(Field, { label: '节点', value: can.node, disabled: busy, onChange: (next: string) => setCan({ ...can, node: next }) }),
          ),
          React.createElement('div', { className: 'fieldkit-actions' }, React.createElement(Button, { onClick: async () => { try { const node = integer(can.node, 'CAN 节点'); await choose({ transport: 'can', node, label: `CAN · 节点 ${node}（现有会话）` }) } catch (error) { setNotice(`参数无效：${errorText(error)}`) } } }, '使用现有 CAN'), React.createElement(Button, { kind: 'primary', disabled: busy || !can.channel.trim(), onClick: async () => { try { const node = integer(can.node, 'CAN 节点'); const response = await run('can_connect', obj([['channel', can.channel, 'string'], ['mode', can.mode, 'string'], ['nodes', `[${node}]`, 'raw']])); if (response && nativeOk(response, node)) await choose({ transport: 'can', node, label: `CAN · ${can.channel} · 节点 ${node}` }) } catch (error) { setNotice(`参数无效：${errorText(error)}`) } } }, '连接 CAN'), React.createElement(Button, { disabled: busy || !can.channel.trim(), onClick: () => invoke('can_scan', () => obj([['channel', can.channel, 'string'], ['mode', can.mode, 'string'], ['start_node', integer(can.start, '起始节点'), 'number'], ['end_node', integer(can.end, '结束节点'), 'number']])) }, '扫描节点')),
          React.createElement('details', null, React.createElement('summary', null, '扫描范围'), React.createElement('div', { className: 'fieldkit-mini-grid' }, React.createElement(Field, { label: '起始节点', value: can.start, disabled: busy, onChange: (next: string) => setCan({ ...can, start: next }) }), React.createElement(Field, { label: '结束节点', value: can.end, disabled: busy, onChange: (next: string) => setCan({ ...can, end: next }) }))),
        ),
        ),
        React.createElement('div', { className: 'fieldkit-actions' }, React.createElement(Button, { disabled: busy, onClick: () => run('connections') }, '查看连接'), React.createElement(Button, { disabled: busy, onClick: () => run('adapters') }, '查看 CAN 适配器'), React.createElement(Button, { disabled: busy, onClick: () => run('disconnect', obj(bodyTarget(target) as any)) }, '断开当前目标'), React.createElement(Button, { disabled: busy, onClick: () => run('reconnect', obj(bodyTarget(target) as any)) }, '重新连接')),
      ),
    ),
    React.createElement('section', { className: 'fieldkit-work-area' },
      React.createElement('section', { className: 'fieldkit-commands' },
        React.createElement('div', { className: 'fieldkit-section-title' }, React.createElement('div', null, React.createElement('h2', null, '执行命令'), React.createElement('p', null, `当前目标：${selectedTitle}`))),
        React.createElement('div', { className: 'fieldkit-quick-actions' }, React.createElement(Button, { disabled: busy, onClick: () => run('snapshot', '', query(target)) }, '读取快照'), React.createElement(Button, { disabled: busy, onClick: () => run('config_schema') }, '读取配置 schema'), React.createElement(Button, { disabled: busy, onClick: () => run('recordings') }, '列出记录'), React.createElement(Button, { disabled: busy, onClick: () => run('odrive_devices') }, '列出 ODrive')),
        React.createElement('fieldset', null, React.createElement('legend', null, '直接命令'),
          React.createElement('label', { className: 'fieldkit-field' }, React.createElement('span', null, '命令'), React.createElement('select', { value: command, disabled: busy, onChange: (event: any) => setCommand(event.target.value) },
            [['status', '状态'], ['measurements', '测量'], ['diagnostics', '诊断'], ['telemetry', '缓存遥测'], ['heartbeat_start', '启动心跳'], ['heartbeat_stop', '停止心跳'], ['heartbeat_once', '发送一次心跳'], ['position', '位置（mm）'], ['velocity', '速度（mm/s）'], ['force', '力（N）'], ['impedance', '阻抗'], ['stop', 'Stop'], ['config_read', '读取配置'], ['config_validate', '校验配置文本'], ['config_save_and_restart', '保存配置并重启'], ['restore_factory_and_restart', '恢复出厂并重启'], ['reset_application', '重置应用'], ['enter_update', '进入更新模式']].map(([id, label]) => React.createElement('option', { key: id, value: id }, label)))),
          command === 'position' && field('位置（mm）', 'mm'), command === 'velocity' && field('速度（mm/s）', 'mmS'), command === 'force' && field('力（N）', 'n'),
          command === 'impedance' && React.createElement('div', { className: 'fieldkit-mini-grid' }, field('平衡位置（mm）', 'equilibrium'), field('刚度（N/mm）', 'stiffness'), field('阻尼（Ns/mm）', 'damping')),
          command === 'config_read' && React.createElement('label', { className: 'fieldkit-field' }, React.createElement('span', null, '配置视图'), React.createElement('select', { value: value.view, disabled: busy, onChange: (event: any) => setValue({ ...value, view: event.target.value }) }, React.createElement('option', { value: 'factory' }, 'factory'), React.createElement('option', { value: 'startup' }, 'startup'), React.createElement('option', { value: 'user' }, 'user'))),
          (command === 'config_validate' || command === 'config_save_and_restart') && React.createElement('label', { className: 'fieldkit-field' }, React.createElement('span', null, '配置 JSON 原文'), React.createElement('textarea', { value: value.record, disabled: busy, onChange: (event: any) => setValue({ ...value, record: event.target.value }) })),
          React.createElement('div', { className: 'fieldkit-actions' }, React.createElement(Button, { kind: command === 'stop' ? 'danger' : 'primary', disabled: command === 'stop' ? false : busy, onClick: () => invoke('action', actionBody, '', command === 'stop') }, command === 'stop' ? '发送 Stop' : '执行命令')),
        ),
        React.createElement('details', { className: 'fieldkit-advanced' }, React.createElement('summary', null, '有界 trial（使用 eha-tool 原生字段）'),
          React.createElement('p', null, '字段直接交给 eha-tool。示例留空，按你的试验参数填写。'),
          React.createElement('label', { className: 'fieldkit-field' }, React.createElement('span', null, '试验动作'), React.createElement('select', { value: trial.action, disabled: busy, onChange: (event: any) => setTrial({ ...trial, action: event.target.value }) }, React.createElement('option', { value: 'position' }, '位置'), React.createElement('option', { value: 'velocity' }, '速度'), React.createElement('option', { value: 'force' }, '力'), React.createElement('option', { value: 'impedance' }, '阻抗'))),
          trial.action === 'position' && trialField('目标位置（mm）', 'position'), trial.action === 'velocity' && trialField('目标速度（mm/s）', 'velocity'), trial.action === 'force' && trialField('目标力（N）', 'force'), trial.action === 'impedance' && React.createElement('div', { className: 'fieldkit-mini-grid' }, trialField('平衡位置（mm）', 'equilibrium'), trialField('刚度（N/mm）', 'stiffness'), trialField('阻尼（Ns/mm）', 'damping')),
          React.createElement('div', { className: 'fieldkit-mini-grid' }, trialField('位置下限（mm）', 'min'), trialField('位置上限（mm）', 'max'), trialField('速度绝对上限（mm/s）', 'velocityMax'), trialField('力绝对上限（N）', 'forceMax'), trialField('刚度上限（N/mm）', 'stiffnessMax'), trialField('阻尼上限（Ns/mm）', 'dampingMax'), trialField('最大时长（s）', 'durationMax'), trialField('本次时长（s，可留空）', 'duration'), trialField('到达容差（mm，可留空）', 'tolerance'), trialField('稳定时长（ms，可留空）', 'settle')),
          React.createElement('div', { className: 'fieldkit-actions' }, React.createElement(Button, { kind: 'primary', disabled: busy, onClick: () => invoke('trial', trialBody) }, '开始 trial'), React.createElement(Button, { disabled: busy, onClick: () => invoke('trial', () => obj([...bodyTarget(target), ['action', 'target', 'string'], ['mm', trial.position, 'number']] as any)) }, '更新试验位置'), React.createElement(Button, { kind: 'danger', disabled: false, onClick: () => invoke('trial', () => obj([...bodyTarget(target), ['action', 'stop', 'string']] as any), '', true) }, '停止 trial')),
        ),
        React.createElement('details', { className: 'fieldkit-advanced' }, React.createElement('summary', null, '记录、ODrive 与群组'),
          React.createElement('div', { className: 'fieldkit-mini-grid' },
            React.createElement('label', { className: 'fieldkit-field' }, React.createElement('span', null, '记录'), React.createElement('select', { value: recording.action, disabled: busy, onChange: (event: any) => setRecording({ ...recording, action: event.target.value }) }, React.createElement('option', { value: 'start' }, '开始'), React.createElement('option', { value: 'stop' }, '停止'))),
            React.createElement(Field, { label: '记录 ID', value: recording.run, disabled: busy, onChange: (next: string) => setRecording({ ...recording, run: next }) }), React.createElement(Field, { label: '记录文件', value: recording.file, disabled: busy, onChange: (next: string) => setRecording({ ...recording, file: next }) }), React.createElement(Field, { label: 'ODrive 序列号', value: odriveSerial, disabled: busy, onChange: setOdriveSerial }),
          ),
          React.createElement('div', { className: 'fieldkit-actions' }, React.createElement(Button, { disabled: busy, onClick: () => run('recording', obj([...bodyTarget(target), ['action', recording.action, 'string']] as any)) }, `${recording.action === 'start' ? '开始' : '停止'}记录`), React.createElement(Button, { disabled: busy || !recording.run.trim(), onClick: () => run('recording_download', '', new URLSearchParams({ run: recording.run, file: recording.file }).toString()) }, '下载记录文件'), React.createElement(Button, { disabled: busy || !odriveSerial.trim(), onClick: () => run('odrive_read', obj([['serial', odriveSerial, 'string']])) }, '读取 ODrive')),
          React.createElement('label', { className: 'fieldkit-field' }, React.createElement('span', null, '群组原始 JSON'), React.createElement('textarea', { value: groupText, disabled: busy, onChange: (event: any) => setGroupText(event.target.value) })), React.createElement('div', { className: 'fieldkit-actions' }, React.createElement(Button, { disabled: busy, onClick: () => invoke('group', () => { JSON.parse(groupText); return groupText }) }, '执行群组 JSON'), React.createElement(Button, { kind: 'danger', disabled: false, onClick: () => invoke('group', () => { const nodes = JSON.parse(groupText)?.nodes; if (!Array.isArray(nodes)) throw new Error('群组 JSON 必须包含 nodes 数组。'); return JSON.stringify({ action: 'stop', nodes }) }, '', true) }, '停止群组')),
          React.createElement('details', { className: 'fieldkit-advanced' }, React.createElement('summary', null, '全部原生命令（高级 JSON）'),
            React.createElement('label', { className: 'fieldkit-field' }, React.createElement('span', null, '固定命令'), React.createElement('select', { value: advanced.command, disabled: busy, onChange: (event: any) => setAdvanced({ ...advanced, command: event.target.value }) }, ['devices', 'adapters', 'connections', 'connect', 'disconnect', 'reconnect', 'can_connect', 'can_scan', 'snapshot', 'config_schema', 'action', 'trial', 'group', 'recording', 'recordings', 'recording_download', 'odrive_devices', 'odrive_read', 'connection_save', 'connection_delete'].map(item => React.createElement('option', { key: item, value: item }, item)))),
            React.createElement('label', { className: 'fieldkit-field' }, React.createElement('span', null, '请求 JSON 原文（GET 留空）'), React.createElement('textarea', { value: advanced.bodyText, disabled: busy, onChange: (event: any) => setAdvanced({ ...advanced, bodyText: event.target.value }) })),
            React.createElement('label', { className: 'fieldkit-field' }, React.createElement('span', null, 'queryText（URLSearchParams）'), React.createElement('input', { value: advanced.queryText, disabled: busy, onChange: (event: any) => setAdvanced({ ...advanced, queryText: event.target.value }) })),
            React.createElement(Button, { disabled: busy, onClick: () => invoke(advanced.command, () => { const needsBody = !['devices', 'adapters', 'connections', 'snapshot', 'config_schema', 'recordings', 'odrive_devices', 'recording_download'].includes(advanced.command); if (needsBody) JSON.parse(advanced.bodyText); return advanced.bodyText }, advanced.queryText) }, '执行原生命令'),
          ),
        ),
      ),
      React.createElement(ResultPanel, { result, notice, onCopy: copy }),
    )
  )
}
