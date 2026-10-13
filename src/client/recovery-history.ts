import type { FieldkitControlResult, FieldkitRecoveryMember, FieldkitRecoveryRecord } from '../remote-types.js'

export const recoveryPrefix = 'eha-fieldkit.received-history.v1:'
export const recoveryListeners = new Set<() => void>()
export const historyChanged = () => { for (const listener of recoveryListeners) listener() }
type HistoryScope = { instanceId: string; members: readonly FieldkitRecoveryMember[] }
const members = (scope: HistoryScope): readonly FieldkitRecoveryMember[] => scope.members.map(member => ({ target: { ...member.target }, controlEpoch: member.controlEpoch, stopRequestId: member.stopRequestId }))
export const sdkScopeKey = (scope: { instanceId: string; members: readonly FieldkitRecoveryMember[] }) => JSON.stringify([scope.instanceId, scope.members.map(member => JSON.stringify([member.target.targetId, member.target.uid, member.target.runNonce, member.target.connectionGeneration, member.controlEpoch, member.stopRequestId])).sort()])
export const unresolved = (result: FieldkitControlResult) => result.unknown || result.results.some(member => member.unknown || member.previousUnknown || member.admission !== 'finished')
export function pendingHistory(scope: HistoryScope, action: string): FieldkitRecoveryRecord {
  return { recordId: '', source: 'browser', kind: 'control', action, instanceId: scope.instanceId, members: members(scope), operationIds: [], result: null, pending: true, recoveryError: null }
}
function safeResult(result: FieldkitControlResult): FieldkitControlResult {
  return { scopeId: result.scopeId, action: result.action, unknown: result.unknown, results: result.results.map(member => ({
    target: { ...member.target }, operationId: member.operationId, admission: member.admission, submission: member.submission,
    controlEffect: member.controlEffect, observation: member.observation, phase: member.phase, unknown: member.unknown, unknownSource: member.unknownSource,
    nativeJsonText: null, error: member.error ? { code: member.error.code, message: member.error.message.slice(0, 512) } : null,
    ...(member.previousOperationId ? { previousOperationId: member.previousOperationId, previousSubmission: member.previousSubmission, previousUnknown: member.previousUnknown } : {}),
    ...(member.trialId ? { trialId: member.trialId } : {}), ...(member.recordingId ? { recordingId: member.recordingId } : {}),
  })) }
}
export function browserHistory(sessionId: string): FieldkitRecoveryRecord[] {
  const output: FieldkitRecoveryRecord[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith(recoveryPrefix)) continue
    const entry = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (!entry || typeof entry.sessionId !== 'string' || !entry.record || !Array.isArray(entry.record.members)) throw new Error('浏览器历史证据不可读取；保留原记录。')
    if (entry.sessionId === sessionId) output.push(entry.record)
  }
  return output
}
export function saveReceivedHistory(sessionId: string, scope: HistoryScope, result: FieldkitControlResult): void {
  const operationIds = [...new Set(result.results.flatMap(member => [member.operationId, member.previousUnknown ? member.previousOperationId : null].filter((id): id is string => !!id)))].sort()
  const record: FieldkitRecoveryRecord = { ...pendingHistory(scope, result.action), operationIds, result: safeResult(result), pending: result.results.some(member => member.admission !== 'finished') }
  const recordId = `${recoveryPrefix}${encodeURIComponent(JSON.stringify([sessionId, sdkScopeKey(record), result.action, operationIds]))}`
  const previous = localStorage.getItem(recordId)
  if (previous) {
    const old = JSON.parse(previous).record as FieldkitRecoveryRecord
    // SDK unknown and previous-operation unknown evidence is never weakened by a later view.
    if (old.result?.results.some(member => member.previousUnknown || member.unknown && (member.unknownSource !== 'transport' || !result.results.some(next => next.operationId === member.operationId && next.admission === 'finished' && next.submission === 'not_submitted' && next.controlEffect === 'not_attempted' && !next.unknown)))) return
    if (!unresolved(result)) {
      const canResolve = old.result?.results.every(member => !member.unknown || member.unknownSource === 'transport' && result.results.some(next => next.operationId === member.operationId && next.admission === 'finished' && next.submission === 'not_submitted' && next.controlEffect === 'not_attempted' && !next.unknown))
      if (canResolve) { localStorage.removeItem(recordId); historyChanged() }
      return
    }
  } else if (!unresolved(result)) return
  else if (browserHistory(sessionId).length >= 128) throw new Error('浏览器历史证据已满；保留未取得回执登记，不再提交。')
  const serialized = JSON.stringify({ sessionId, record: { ...record, recordId } })
  if (serialized.length > 65536) throw new Error('历史证据超过登记上限；保留原请求登记。')
  if (previous !== serialized) { localStorage.setItem(recordId, serialized); historyChanged() }
}

export function reconcileReceivedHistory(sessionId: string, record: FieldkitRecoveryRecord) {
  if (!record.result) return
  saveReceivedHistory(sessionId, record, record.result)
}
