import React, { useEffect, useRef, useState } from 'react'
import type { FieldkitRecoveryRecord } from '../remote-types.js'
import { useMutationJournal } from './mutation-journal.js'
import { reconcileReceivedHistory, sdkScopeKey } from './recovery-history.js'
import { errorText, panelStyles, valueOf } from './shared.js'

const evidenceKey = (record: FieldkitRecoveryRecord) => JSON.stringify([sdkScopeKey(record), record.action, [...record.operationIds].sort()])
const facts = (record: FieldkitRecoveryRecord) => JSON.stringify(record.result?.results.map(member => [member.target, member.operationId, member.admission, member.submission, member.controlEffect, member.observation, member.phase, member.unknown, member.unknownSource, member.previousOperationId, member.previousUnknown, member.trialId, member.recordingId]))
export function RecoveryHistory({ remote, sessionId, currentInstanceId }: { remote: any; sessionId: string; currentInstanceId: string | null }) {
  const instance = useRef(currentInstanceId)
  instance.current = currentInstanceId
  const journal = useMutationJournal(), styles = panelStyles()
  const [stored, setStored] = useState<{ sessionId: string; records: readonly FieldkitRecoveryRecord[] }>({ sessionId, records: [] })
  const [confirmation, setConfirmation] = useState(''), confirmed = useRef('')
  const [metadataNotice, setMetadataNotice] = useState('')
  const [notice, setNotice] = useState(''), [querying, setQuerying] = useState<string | null>(null)
  const live = useRef({ sessionId, epoch: 0 }), flight = useRef(false)
  if (live.current.sessionId !== sessionId) live.current = { sessionId, epoch: live.current.epoch + 1 }
  const epoch = live.current.epoch, active = () => live.current.epoch === epoch
  useEffect(() => {
    if (typeof remote.listRecoveryHistory !== 'function') return
    let cancelled = false, timer: ReturnType<typeof setTimeout>
    const readLocal = async () => {
      try {
        if (typeof remote.listRecoveryHistory !== 'function') return
        const result = valueOf(await remote.listRecoveryHistory(sessionId))
        if (!cancelled && active()) { setStored(previous => ({ sessionId, records: result.records.map((record: FieldkitRecoveryRecord) => { const prior = previous.sessionId === sessionId ? previous.records.find(item => item.recordId === record.recordId && evidenceKey(item) === evidenceKey(record) && facts(item) === facts(record)) : null; return prior?.result ? { ...record, result: prior.result } : record }) })); setMetadataNotice('') }
      } catch (error) { if (!cancelled && active()) setMetadataNotice(`Host 历史索引读取失败：${errorText(error)}；浏览器证据仍保留。`) }
      finally { if (!cancelled && active()) timer = setTimeout(readLocal, 3000) }
    }
    void readLocal()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [sessionId])
  let browser: FieldkitRecoveryRecord[] = [], storageError = ''
  try { browser = journal.history(sessionId) } catch (error) { storageError = errorText(error) }
  const host = stored.sessionId === sessionId ? stored.records : []
  // Only numbered, full-scope evidence can share a display card. Anonymous UI pending is never guessed from a latest result.
  const records = [...host, ...browser.filter(record => !record.operationIds.length || !host.some(item => evidenceKey(item) === evidenceKey(record) && JSON.stringify(item.result?.results.map(member => [member.operationId, member.admission, member.submission, member.unknown, member.unknownSource, member.previousUnknown])) === JSON.stringify(record.result?.results.map(member => [member.operationId, member.admission, member.submission, member.unknown, member.unknownSource, member.previousUnknown]))))]
  const forgettable = (record: FieldkitRecoveryRecord) => record.source === 'host' && !record.pending && !record.recoveryError && !!record.result && !record.result.unknown && record.result.results.length === record.members.length && record.result.results.every(member => member.admission === 'finished' && !member.unknown && !member.previousUnknown)
  const forget = async (record: FieldkitRecoveryRecord) => {
    if (flight.current || confirmed.current !== `${sessionId}:${record.recordId}` || !forgettable(record)) return
    confirmed.current = ''; setConfirmation(''); flight.current = true; setQuerying(record.recordId)
    try {
      const result = valueOf(await remote.forgetRecoveryRecord(sessionId, { recordId: record.recordId }))
      if (result.forgotten !== true || result.recordId !== record.recordId) throw new Error('索引移除回执身份不匹配。')
      if (active()) { setStored(previous => ({ sessionId, records: previous.records.filter(item => item.recordId !== record.recordId) })); setNotice('已移除本地已知历史索引；SDK 账本与记录文件保持原状。') }
    } catch (error) { if (active()) setNotice(`历史索引移除失败：${errorText(error)}；保留原记录。`) }
    finally { flight.current = false; if (active()) setQuerying(null) }
  }
  const query = async (record: FieldkitRecoveryRecord) => {
    if (flight.current || record.source !== 'host' || !instance.current || record.instanceId !== instance.current) return
    flight.current = true; setQuerying(record.recordId)
    try {
      const result: FieldkitRecoveryRecord = valueOf(await remote.readRecoveryRecord(sessionId, { recordId: record.recordId }))
      if (result.recordId !== record.recordId || evidenceKey(result) !== evidenceKey(record)) throw new Error('恢复记录身份不匹配；保留原证据。')
      if (active()) { reconcileReceivedHistory(sessionId, result); setStored(previous => ({ sessionId, records: previous.records.map(item => item.recordId === result.recordId ? result : item) })) }
    } catch (error) { if (active()) setNotice(`原编号只读核对失败：${errorText(error)}；不重发动作。`) }
    finally { flight.current = false; if (active()) setQuerying(null) }
  }
  return React.createElement('details', { style: styles.card, open: records.length > 0 }, React.createElement('summary', null, '历史未决证据 / 原编号核对'),
    React.createElement('p', null, '历史不是当前授权，也不是可继续执行的控制范围。仅展示本会话原始事实；旧服务实例不适用于当前实例。不恢复连接、授权、目标或心跳。原范围 Stop 请使用独立的原执行范围入口。'),
    React.createElement('p', null, 'Host 恢复索引最多保留 128 条；满额时普通操作不会提交。可明确移除已知完成的本地索引以释放容量，未决或未知记录不能移除。'),
    (notice || metadataNotice || storageError) && React.createElement('p', { role: 'alert' }, [notice, metadataNotice, storageError].filter(Boolean).join(' ')),
    !records.length && React.createElement('p', null, '本会话尚无已登记历史证据。'),
    records.map(record => React.createElement('section', { key: `${record.source}:${record.recordId}` },
      React.createElement('h3', null, `${record.action} · ${record.source === 'host' ? 'Host 持久索引' : '浏览器收到的证据'} · 原服务 ${record.instanceId}`),
      React.createElement('p', null, `原编号：${record.operationIds.join('、') || '尚未取得，不能猜配最近操作'}；${record.pending ? '未决 / 等待原编号核对' : '已收到原记录'}`),
      (!currentInstanceId || record.instanceId !== currentInstanceId) && React.createElement('p', { role: 'status' }, currentInstanceId ? '旧服务实例的历史：当前实例不能查询此编号，也不能据此恢复执行范围。' : '当前没有已认证运行的服务实例；保留历史，暂不查询 SDK。'),
      record.members.map(member => React.createElement('p', { key: JSON.stringify(member) }, `${member.target.targetId} · UID ${member.target.uid} · run_nonce ${member.target.runNonce} · generation ${member.target.connectionGeneration} · instance ${member.target.instanceId} · 原 binding ${member.target.bindingId} · epoch ${member.controlEpoch ?? '无'} · canonical Stop ${member.stopRequestId ?? '无'}`)),
      !record.result && React.createElement('p', null, record.source === 'browser' ? 'UI 尚未取得可关联回执；这不是设备结果，不重复提交。' : 'Host 已登记原服务票据；是否提交须显式只读核对原编号。'),
      record.result?.results.map(member => React.createElement('div', { key: `${member.target.targetId}:${member.operationId}` },
        React.createElement('p', null, `${member.target.targetId} · ${record.result!.action} · ${member.operationId ?? '无编号'} · ${member.admission} / ${member.submission} / ${member.controlEffect} · 观测 ${member.observation} · phase ${member.phase ?? '无'} · 未知 ${member.unknown ? '是' : '否'} · 来源 ${member.unknownSource === 'sdk' ? 'SDK' : member.unknownSource ?? '原服务回执'}${member.previousUnknown ? ` · 先前未知 ${member.previousOperationId}` : ''}`),
        (member.recordingId || member.trialId) && React.createElement('p', null, `记录编号 ${member.recordingId ?? '无'} · 试验编号 ${member.trialId ?? '无'}`),
        member.error && React.createElement('p', { role: 'alert' }, `${member.error.code}：${member.error.message}`),
        member.error?.code === 'recording_failed' && React.createElement('p', null, '录制失败：请核对服务记录目录的可用空间与写权限，并保留原错误。仅按原回执判断本操作是否提交；此结果不证明机械停止，原范围 Stop 独立可用。'),
        member.nativeJsonText ? React.createElement('details', null, React.createElement('summary', null, '本次显式查询的 SDK 原始证据'), React.createElement('pre', { style: styles.mono }, member.nativeJsonText)) : React.createElement('p', null, '本地持久索引未保存 SDK 原文；可在原服务仍可用时显式只读核对原编号。'))),
      record.recoveryError && React.createElement('p', { role: 'alert' }, `恢复索引：${record.recoveryError.code}：${record.recoveryError.message}`),
      record.source === 'host' && React.createElement('button', { disabled: querying !== null || !currentInstanceId || record.instanceId !== currentInstanceId, onClick: () => query(record) }, '只读核对原操作编号'),
      forgettable(record) && React.createElement('label', null, React.createElement('input', { type: 'checkbox', 'aria-label': `确认仅移除历史索引 ${record.recordId}`, checked: confirmation === `${sessionId}:${record.recordId}`, disabled: querying !== null, onChange: (event: React.ChangeEvent<HTMLInputElement>) => { confirmed.current = event.target.checked ? `${sessionId}:${record.recordId}` : ''; setConfirmation(confirmed.current) } }), '仅移除这条已知历史索引；不删除 SDK 账本或记录文件，不发送设备动作。'),
      forgettable(record) && React.createElement('button', { disabled: querying !== null || confirmation !== `${sessionId}:${record.recordId}`, onClick: () => forget(record) }, '移除已知历史索引'))))
}
