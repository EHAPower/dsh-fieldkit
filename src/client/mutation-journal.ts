import { useEffect, useState } from 'react'
import type { FieldkitOriginalStopResult } from '../remote-types.js'

const prefix = 'eha-fieldkit.ui-pending.v1:'
const message = 'UI 尚未取得本次请求的可关联回执；这不是设备结果。保留原会话与完整范围，不重复提交；原范围 Stop 仍可用。'
const persistedReceipt = (r: FieldkitOriginalStopResult): FieldkitOriginalStopResult => ({
  referenceId: r.referenceId, scope: { referenceId: r.scope.referenceId, instanceId: r.scope.instanceId, targetId: r.scope.targetId, uid: r.scope.uid, runNonce: r.scope.runNonce, connectionGeneration: r.scope.connectionGeneration, controlEpoch: r.scope.controlEpoch, stopRequestId: r.scope.stopRequestId, current: r.scope.current, controlGranted: r.scope.controlGranted },
  operationId: r.operationId, action: r.action, admission: r.admission, submission: r.submission, controlEffect: r.controlEffect, observation: r.observation, unknown: r.unknown, unknownSource: r.unknownSource, nativeJsonText: null, error: null, newSubmission: r.newSubmission,
})
type Entry = { sessionId: string; scopeKey: string; action: string; receipt?: FieldkitOriginalStopResult }

/** Browser receipt journal only; SDK owns all device state and operation identities. */
export function useMutationJournal() {
  const [, render] = useState(0)
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key === null || event.key.startsWith(prefix)) render(value => value + 1) }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [])
  const entries = (): (Entry & { key: string })[] => {
    const result: (Entry & { key: string })[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(prefix)) continue
      const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
      if (!value || typeof value !== 'object' || !('sessionId' in value) || typeof value.sessionId !== 'string' || !('scopeKey' in value) || typeof value.scopeKey !== 'string' || !('action' in value) || typeof value.action !== 'string') throw new Error('回执登记格式不可读取；保留原记录。')
      result.push({ ...(value as Entry), key })
    }
    return result
  }
  const reason = (sessionId: string, scopeKey: string): string | null => {
    try { const entry = entries().find(entry => entry.sessionId === sessionId && entry.scopeKey === scopeKey); return entry ? entry.receipt ? '原操作尚未完成或结果未知；保留原编号，只读查询，不重新提交。' : message : null }
    catch { return '浏览器回执登记不可读取；不能发起普通提交。原范围 Stop 仍独立可用。' }
  }
  const begin = (sessionId: string, scopeKey: string, action: string) => {
    const blocked = reason(sessionId, scopeKey)
    if (blocked) throw new Error(blocked)
    // This ID only names a browser journal entry, never an SDK operation or ticket.
    const key = `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`
    try { localStorage.setItem(key, JSON.stringify({ sessionId, scopeKey, action })) }
    catch { throw new Error('浏览器回执登记不可写；本次未发送普通请求，原范围 Stop 仍可用。') }
    render(value => value + 1)
    return (receipt?: FieldkitOriginalStopResult) => {
      // Only the exact in-flight call owning this key may acknowledge it.
      try {
        if (receipt && (receipt.unknown || receipt.admission !== 'finished')) localStorage.setItem(key, JSON.stringify({ sessionId, scopeKey, action, receipt: persistedReceipt(receipt) }))
        else localStorage.removeItem(key)
        render(value => value + 1)
      }
      catch { /* Keep the conservative barrier if persistence is unavailable. */ }
    }
  }
  const receipts = (sessionId: string, scopeKey: string) => {
    try { return entries().filter(entry => entry.sessionId === sessionId && entry.scopeKey === scopeKey && entry.receipt).map(entry => entry.receipt!) } catch { return [] }
  }
  const reconcile = (sessionId: string, scopeKey: string, receipt: FieldkitOriginalStopResult) => {
    try {
      for (const entry of entries()) {
        const previous = entry.receipt
        if (entry.sessionId !== sessionId || entry.scopeKey !== scopeKey || !previous || previous.operationId !== receipt.operationId || previous.action !== receipt.action) continue
        if (previous.unknown && (previous.unknownSource !== 'transport' || receipt.admission !== 'finished' || receipt.submission !== 'not_submitted' || receipt.controlEffect !== 'not_attempted' || receipt.unknown)) continue
        if (!receipt.unknown && receipt.admission === 'finished') localStorage.removeItem(entry.key)
        else localStorage.setItem(entry.key, JSON.stringify({ sessionId, scopeKey, action: entry.action, receipt: persistedReceipt(receipt) }))
      }
      render(value => value + 1)
    } catch { /* Persistence failure never clears the original barrier. */ }
  }
  return { reason, begin, receipts, reconcile }
}
