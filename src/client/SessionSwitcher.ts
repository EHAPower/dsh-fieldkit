import React, { useRef, useState } from 'react'
import type { FieldkitSessionChoices, FieldkitSessions } from './fieldkit-sessions.js'
import { errorText, panelStyles } from './shared.js'

export function SessionSwitcher({ sessions, manager, currentSessionId, onSelected }: { sessions: any; manager: FieldkitSessions; currentSessionId: string | null; onSelected: () => void }) {
  const [choices, setChoices] = useState<FieldkitSessionChoices | null>(null)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const flight = useRef(false)
  const styles = panelStyles(busy)
  const act = async (work: () => Promise<void>) => {
    if (flight.current) return
    flight.current = true; setBusy(true)
    try { await work() } catch (error) { setNotice(`会话未切换：${errorText(error)}`) }
    finally { flight.current = false; setBusy(false) }
  }
  return React.createElement('details', { style: styles.card },
    React.createElement('summary', null, '返回既有 Fieldkit 对话 / 会话'),
    React.createElement('p', null, `当前会话：${currentSessionId ?? '准备中'}。新窗口默认独立；只有明确返回后才读取原会话历史与对话。`),
    React.createElement('p', null, '返回会清空本页临时参数和确认，只读取既有事实；不会自动连接、授权、提交目标或 Stop。'),
    React.createElement('button', { style: styles.button, disabled: busy || !currentSessionId, onClick: () => act(async () => { const value = await manager.list(sessions); setChoices(value); setSelected(''); setNotice(value.warning ?? '目录已核对。请选择原会话后明确返回。') }) }, '读取既有 Fieldkit 会话'),
    choices && React.createElement('select', { 'aria-label': '既有 Fieldkit 会话', value: selected, disabled: busy, onChange: (event: any) => setSelected(event.target.value) },
      React.createElement('option', { value: '' }, '请选择会话'),
      choices.items.map(entry => React.createElement('option', { key: entry.id, value: entry.id }, `Fieldkit 对话 · ${entry.visitedAt === null ? '旧证据迁移（时间未知）' : new Date(entry.visitedAt).toLocaleString()} · ${entry.id.slice(0, 8)}…${entry.id.slice(-6)}${entry.id === currentSessionId ? '（当前）' : ''}`))),
    React.createElement('button', { style: styles.button, disabled: busy || !selected || selected === currentSessionId, onClick: () => act(async () => { if (!selected || selected === currentSessionId) return; await manager.select(sessions, selected); onSelected() }) }, '明确返回所选会话'),
    choices?.truncated && React.createElement('p', { role: 'alert' }, '复访选项达到 128 项上限；现有历史证据未删除。'),
    choices?.items.length === 0 && React.createElement('p', null, '未找到仍在官方目录中的 Fieldkit 登记。旧空会话若没有本地登记或历史证据，无法可靠识别。'),
    notice && React.createElement('p', { role: 'status' }, notice),
  )
}
