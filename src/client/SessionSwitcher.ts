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
    React.createElement('summary', null, '切换 Fieldkit 对话'),
    React.createElement('p', null, `当前对话：${currentSessionId ?? '准备中'}。切换后显示所选对话的历史与目标，表单参数重新填写。`),
    React.createElement('button', { style: styles.button, disabled: busy || !currentSessionId, onClick: () => act(async () => { const value = await manager.list(sessions); setChoices(value); setSelected(''); setNotice(value.warning ?? '请选择要打开的对话。') }) }, '查看已有对话'),
    choices && React.createElement('select', { 'aria-label': '既有 Fieldkit 会话', value: selected, disabled: busy, onChange: (event: any) => setSelected(event.target.value) },
      React.createElement('option', { value: '' }, '请选择会话'),
      choices.items.map(entry => React.createElement('option', { key: entry.id, value: entry.id }, `Fieldkit 对话 · ${entry.visitedAt === null ? '时间未知' : new Date(entry.visitedAt).toLocaleString()} · ${entry.id.slice(0, 8)}…${entry.id.slice(-6)}${entry.id === currentSessionId ? '（当前）' : ''}`))),
    React.createElement('button', { style: styles.button, disabled: busy || !selected || selected === currentSessionId, onClick: () => act(async () => { if (!selected || selected === currentSessionId) return; await manager.select(sessions, selected); onSelected() }) }, '打开所选对话'),
    choices?.truncated && React.createElement('p', { role: 'status' }, '这里只显示最近 128 个 Fieldkit 对话。'),
    choices?.items.length === 0 && React.createElement('p', null, '没有找到已登记的 Fieldkit 对话。'),
    notice && React.createElement('p', { role: 'status' }, notice),
  )
}
