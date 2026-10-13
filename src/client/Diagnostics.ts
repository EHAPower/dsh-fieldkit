import React, { useRef, useState } from 'react'
import { downloadBlob } from './async.js'
import { valueOf } from './shared.js'
import type { FieldkitReadRun } from '../remote-types.js'
import { text, errorText, panelStyles } from './shared.js'
const INTEGRATION_STEPS = ['connection_identity', 'status', 'measurements', 'diagnostics', 'config_startup', 'config_user']
const LEGACY_STEPS = ['inspect', 'status', 'measurements', 'diagnostics', 'config_startup', 'config_user']
const STEP_LABELS: Record<string, string> = { connection_identity: '连接与身份', inspect: 'inspect', status: 'status', measurements: 'measurements', diagnostics: 'diagnostics', config_startup: 'config-read --view startup', config_user: 'config-read --view user' }
function evidenceStep(item: any, index: number, evidence: readonly any[], legacy: boolean) {
  if (!legacy || item.action !== 'config-read') return item.action
  return evidence.slice(0, index).filter(entry => entry.action === 'config-read').length === 0 ? 'config_startup' : 'config_user'
}
function currentStep(run: any, legacy: boolean) {
  if (!run || !legacy || run.step !== 'config-read') return run?.step
  return (run.evidence ?? []).filter((item: any) => item.action === 'config-read').length <= 1 ? 'config_startup' : 'config_user'
}

export function Diagnostics({ readRun, legacy, remote, sessionId }: { readRun: FieldkitReadRun | null; legacy: boolean; remote: any; sessionId: string | null }) {
  const key = JSON.stringify([sessionId, readRun?.readRunId, readRun?.bindingId, readRun?.targetId, readRun?.instanceId, readRun?.connectionGeneration, readRun?.identity?.uid, readRun?.identity?.runNonce])
  const scope = useRef({ key, generation: 0, pending: false })
  if (scope.current.key !== key) scope.current = { key, generation: scope.current.generation + 1, pending: false }
  const generation = scope.current.generation
  const [state, setState] = useState({ generation, notice: '', busy: false })
  const { notice, busy } = state.generation === generation ? state : { notice: '', busy: false }
  const active = () => scope.current.generation === generation
  const download = async (format: 'markdown' | 'json') => {
    if (!readRun || !sessionId || !active() || scope.current.pending) return
    scope.current.pending = true; setState({ generation, notice: '', busy: true })
    try {
      const result = valueOf(await remote.downloadReport(sessionId, { readRunId: readRun.readRunId, format }))
      downloadBlob(result.filename, new Blob([result.content], { type: result.mime }))
      if (active()) setState({ generation, notice: '报告文件已交给浏览器下载；采集完整性请查看报告。', busy: true })
    } catch (e) { if (active()) setState({ generation, notice: errorText(e), busy: true }) }
    finally { if (active()) { scope.current.pending = false; setState(current => ({ ...current, busy: false })) } }
  }
  const styles = panelStyles()
  const steps = legacy ? LEGACY_STEPS : INTEGRATION_STEPS
  const evidence = readRun?.evidence ?? []
  const evidenceSteps = evidence.map((item, index) => evidenceStep(item, index, evidence, legacy))
  const captureEnded = !!readRun && readRun.status !== 'running'
  const stepState = (step: string) => {
    const entries = evidence.filter((_item, index) => evidenceSteps[index] === step)
    const failed = entries.some(item => item.error || item.parseError || item.processError || typeof item.exitCode === 'number' && item.exitCode !== 0)
      || readRun?.error && readRun.error.code !== 'cancelled' && currentStep(readRun, legacy) === step
    if (failed) return '失败'
    if (entries.length) return '已取得'
    if (captureEnded) return '未执行（首错或取消后停止）'
    if (readRun?.status === 'running' && currentStep(readRun, legacy) === step) return '进行中'
    return '等待'
  }
  return React.createElement('div', { style: styles.card }, React.createElement('h2', null, '诊断进度'),
        React.createElement('p', null, readRun ? `${readRun.status} · ${text(readRun.phase)} · 当前步骤：${text(STEP_LABELS[currentStep(readRun, legacy)] ?? currentStep(readRun, legacy))}` : '尚未开始。'),
        React.createElement('ol', null, steps.map(step => React.createElement('li', { key: step }, `${stepState(step)}：${STEP_LABELS[step]}`))),
        evidence.map((item: any, index: number) => React.createElement('details', { key: `${item.action}-${index}` },
          React.createElement('summary', null, `${STEP_LABELS[evidenceSteps[index]] ?? item.action} · ${text(item.receivedAt)}${item.error ? ` · ${errorText(item.error)}` : ''}`),
          React.createElement('p', null, `连接代次：${text(item.connectionGeneration)}；来源时钟：${text(item.sourceTimestamp?.clock)} / ${text(item.sourceTimestamp?.value)}；接收年龄 ms：${text(item.receivedAgeMs)}`),
          item.readPermit && React.createElement('p', null, `本步读取许可：${item.readPermit.ready ? '可读取' : '阻止'}（${text(item.readPermit.reason_code)}）；设备效果：${text(item.controlEffect?.state)}（${text(item.controlEffect?.reason_code)}）`),
          item.exitCode !== undefined && React.createElement('p', null, `进程退出码：${text(item.exitCode)}；信号：${text(item.processError?.signal)}`),
          item.parseError && React.createElement('p', { role: 'alert' }, `解析失败：${item.parseError}`),
          item.dataUtf8 !== undefined && React.createElement('details', null, React.createElement('summary', null, '配置原始载荷'), React.createElement('pre', { style: styles.mono }, item.dataUtf8 ?? item.dataHex)),
          React.createElement('pre', { style: styles.mono }, item.nativeJsonText ?? item.stdout ?? ''),
          item.stderr && React.createElement('pre', { style: styles.mono }, item.stderr))),
        readRun?.error && React.createElement('p', { role: 'alert' }, `首个错误：${errorText(readRun.error)}`),
        readRun?.reports?.markdown && React.createElement('button', { disabled: busy, onClick: () => download('markdown') }, '下载 Markdown 报告'),
        readRun?.reports?.json && React.createElement('button', { disabled: busy, onClick: () => download('json') }, '下载 JSON 报告'),
        notice && React.createElement('p', { role: 'status' }, notice),
        readRun?.reportError && React.createElement('p', { role: 'alert' }, `报告写入失败：${errorText(readRun.reportError)}`),
      )
}
