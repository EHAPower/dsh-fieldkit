import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, unlink, lstat, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { privateDirectory, readPrivate, userDataDirectory } from './owner-process.js'

const maxBytes = 16384, defaultCapacity = 128
const controlActions = new Set(['position', 'velocity', 'force', 'impedance', 'heartbeat_start', 'heartbeat_stop', 'heartbeat_once', 'trial_start', 'trial_target', 'recording_start', 'recording_stop'])
const maintenanceActions = new Set(['save_and_restart', 'restore_factory_and_restart', 'reset_application', 'enter_update'])
const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }
const fields = (v, names) => { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !names.includes(k)) || names.some(k => v[k] === undefined)) fail('recovery_invalid', '恢复索引字段不完整或含未知字段。') }
const id = value => { if (typeof value !== 'string' || !value || value.length > 256 || value.includes('\0')) fail('recovery_invalid', '恢复标识不完整。'); return value }
const nullableId = value => value === null ? null : id(value)
const targetFields = ['instanceId', 'bindingId', 'targetId', 'uid', 'runNonce', 'connectionGeneration']
const targetKey = target => JSON.stringify(targetFields.map(key => target[key]))
function intentOf(s, v) {
  id(s); fields(v, ['kind', 'action', 'instanceId', 'members'])
  if (!(v.kind === 'maintenance' ? maintenanceActions : v.kind === 'control' ? controlActions : new Set()).has(v.action)) fail('recovery_invalid', '恢复动作不受支持。')
  id(v.instanceId)
  if (!Array.isArray(v.members) || !v.members.length || v.members.length > 16) fail('recovery_invalid', '恢复成员数量无效。')
  const members = v.members.map(member => {
    fields(member, ['target', 'controlEpoch', 'stopRequestId', 'grantId', 'reservationId', 'operationId']); fields(member.target, targetFields)
    for (const name of targetFields) id(member.target[name])
    if (member.target.instanceId !== v.instanceId) fail('recovery_invalid', '恢复成员属于不同实例。')
    id(member.controlEpoch); nullableId(member.stopRequestId); id(member.grantId); id(member.reservationId); id(member.operationId)
    return structuredClone(member)
  })
  if (new Set(members.map(member => member.operationId)).size !== members.length || new Set(members.map(member => targetKey(member.target))).size !== members.length) fail('recovery_invalid', '恢复成员或操作号重复。')
  return { version: 1, sessionId: s, kind: v.kind, action: v.action, instanceId: v.instanceId, members }
}
const error = value => ({ code: typeof value?.code === 'string' ? value.code.slice(0, 128) : 'recovery_read_failed', message: typeof value?.message === 'string' ? value.message.slice(0, 512) : '原恢复记录读取失败。' })
function resultOf(intent, recordId, value) {
  if (!value || typeof value.unknown !== 'boolean' || value.action !== intent.action || !Array.isArray(value.results) || value.results.length !== intent.members.length) fail('recovery_invalid', '恢复结果动作或成员不匹配。')
  const results = intent.members.map(member => {
    const matches = value.results.filter(result => targetKey(result.target) === targetKey(member.target))
    if (matches.length !== 1 || matches[0].operationId !== member.operationId) fail('recovery_invalid', '恢复结果身份或原操作号不匹配。')
    const r = matches[0]
    const state = (name, allowed) => { if (!allowed.includes(r[name])) fail('recovery_invalid', '持久回执状态缺失或不受支持。') }
    state('admission', ['queued', 'attempting', 'finished', 'unknown']); state('submission', ['not_attempted', 'not_submitted', 'locally_submitted', 'unknown']); state('controlEffect', ['not_attempted', 'not_applicable', 'known', 'unresolved']); state('observation', ['unconfirmed'])
    const unresolved = r.submission === 'unknown' || r.controlEffect === 'unresolved'
    if (typeof r.unknown !== 'boolean' || r.unknown !== unresolved || ![null, 'sdk', 'transport'].includes(r.unknownSource) || (r.unknown ? r.unknownSource === null : r.unknownSource !== null) || (r.phase !== null && (typeof r.phase !== 'string' || r.phase.length > 128)) || (r.nativeJsonText !== null && typeof r.nativeJsonText !== 'string') || (r.error !== null && (!r.error || typeof r.error.code !== 'string' || typeof r.error.message !== 'string')) || (r.previousOperationId !== undefined && (typeof r.previousUnknown !== 'boolean' || !['not_attempted', 'not_submitted', 'locally_submitted', 'unknown'].includes(r.previousSubmission))) || ((r.unknown || r.previousUnknown === true) && !value.unknown)) fail('recovery_invalid', '持久回执字段缺损或未知事实不一致。')
    const localCleanup = ['heartbeat_stop', 'recording_stop'].includes(intent.action) && r.submission === 'not_submitted' && r.controlEffect === 'not_applicable'
    if ((r.admission === 'unknown' && (!r.unknown || r.unknownSource !== 'transport')) || (r.admission === 'finished' && r.submission === 'not_attempted') || (r.submission === 'unknown' && r.controlEffect !== 'unresolved') || (r.submission === 'not_attempted' && r.controlEffect !== 'not_attempted') || (r.submission === 'not_submitted' && r.controlEffect !== 'not_attempted' && !localCleanup) || (r.submission === 'locally_submitted' && r.controlEffect === 'not_attempted')) fail('recovery_invalid', '持久回执提交/效果状态矛盾。')
    const scalar = name => typeof r[name] === 'string' ? r[name].slice(0, 128) : null
    return { target: structuredClone(member.target), operationId: member.operationId, admission: scalar('admission'), submission: scalar('submission'), controlEffect: scalar('controlEffect'), observation: scalar('observation'), phase: scalar('phase'), unknown: r.unknown === true, unknownSource: ['transport', 'sdk'].includes(r.unknownSource) ? r.unknownSource : null, nativeJsonText: null,
      error: r.error ? { code: error(r.error).code, message: '原操作错误原文仅从 SDK 只读查询取得。' } : null,
      ...(r.previousOperationId ? { previousOperationId: id(r.previousOperationId), previousSubmission: scalar('previousSubmission'), previousUnknown: r.previousUnknown === true, previousNativeJsonText: null } : {}),
      ...(r.trialId ? { trialId: id(r.trialId) } : {}), ...(r.recordingId ? { recordingId: id(r.recordingId) } : {}),
    }
  })
  return { scopeId: recordId, action: intent.action, results, unknown: value.unknown === true || results.some(r => r.unknown || r.previousUnknown), ...(typeof value.newSubmission === 'boolean' ? { newSubmission: value.newSubmission } : {}) }
}
function validateOperation(intent, member, operation) {
  const m = operation?.members?.[0]
  if (operation?.operationId !== member.operationId || operation.action !== intent.action || operation.claimantId !== intent.sessionId || operation.reservationId !== member.reservationId || operation.controlEpoch !== member.controlEpoch || operation.members.length !== 1 || m?.targetId !== member.target.targetId || m.identity?.uid !== member.target.uid || m.identity?.runNonce !== member.target.runNonce || m.connectionGeneration !== member.target.connectionGeneration) fail('recovery_identity_mismatch', '原操作回执编号、动作、会话、占用或完整成员/epoch 不匹配。')
  const unknown = operation.submission === 'unknown' || operation.controlEffect === 'unresolved'
  return { target: structuredClone(member.target), operationId: member.operationId, admission: operation.admission, submission: operation.submission, controlEffect: operation.controlEffect, observation: operation.observation, phase: operation.phase, unknown, unknownSource: unknown ? 'sdk' : null, nativeJsonText: operation.nativeJsonText, error: operation.error, ...(operation.trialId ? { trialId: operation.trialId } : {}), ...(operation.recordingId ? { recordingId: operation.recordingId } : {}) }
}

/** Host evidence index only. SDK remains the sole operation and permission authority. */
export function createRecoveryJournal({ directory = join(userDataDirectory(), 'recovery-v1'), capacity = defaultCapacity } = {}) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > defaultCapacity) throw new TypeError('恢复索引容量须为 1–128。')
  const slot = index => `record-${index.toString().padStart(3, '0')}`
  const slotOf = recordId => { const match = /^record-(0[0-9]{2}|1[01][0-9]|12[0-7])\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.exec(recordId); if (!match || Number(match[1]) >= capacity) fail('recovery_invalid', '恢复索引编号无效。'); return `record-${match[1]}` }
  const path = recordId => join(directory, slotOf(recordId))
  const updateErrors = new Map()
  const updateError = recordId => { const value = updateErrors.get(slotOf(recordId)); return value?.recordId === recordId ? value.error : null }
  const clearError = recordId => { if (updateErrors.get(slotOf(recordId))?.recordId === recordId) updateErrors.delete(slotOf(recordId)) }
  const root = () => privateDirectory(directory)
  async function locked(slotName, callback) {
    await root(); const lock = join(directory, `${slotName}.lock`)
    try { await mkdir(lock, { mode: 0o700 }) } catch (e) {
      if (e.code !== 'EEXIST') throw e
      await privateDirectory(lock)
      fail('recovery_locked', '原恢复索引被另一 Host 写入或留有中断锁；仅只读查看，不会自动移除锁或重发。确认所有 Host 已退出后，由人工维护该私有锁目录。')
    }
    try { return await callback() } finally { await rm(lock, { recursive: true }) }
  }
  async function atomic(base, name, value) {
    const bytes = Buffer.from(JSON.stringify(value) + '\n')
    if (bytes.length > maxBytes) fail('recovery_capacity', '单条恢复索引超过 16 KiB；普通操作未取得持久准入。')
    await privateDirectory(base)
    const temp = join(base, `pending-${randomUUID()}.tmp`), file = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try { await file.writeFile(bytes); await file.sync() } catch (e) { await file.close(); await unlink(temp).catch(() => {}); throw e }
    await file.close()
    try { await rename(temp, join(base, name)); const dir = await open(base, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { await dir.sync() } finally { await dir.close() } }
    catch (e) { await unlink(temp).catch(() => {}); throw e }
  }
  async function readIntent(s, recordId) {
    const base = path(recordId); await root(); await lstat(base); await privateDirectory(base)
    const value = await readPrivate(join(base, 'intent.json'))
    if (value.version !== 1 || value.sessionId !== s) fail('recovery_forbidden', '恢复记录不属于当前可信会话。')
    if (value.recordId !== recordId) fail('recovery_stale', '原本地恢复索引已移除或槽已复用；旧引用不能用于新记录。')
    const { version, sessionId, recordId: storedRecordId, ...intent } = value
    return { base, intent: intentOf(sessionId, intent) }
  }
  async function view(recordId, intent, base) {
    let result = null, recoveryError = updateError(recordId) ?? null
    try { await lstat(join(directory, `${slotOf(recordId)}.lock`)); recoveryError ??= { code: 'recovery_locked', message: '原索引存在写入锁或中断锁；历史仍可读。确认所有 Host 已退出后，由人工维护私有锁目录；不重发操作。' } } catch (e) { if (e.code !== 'ENOENT') throw e }
    try { result = resultOf(intent, recordId, await readPrivate(join(base, 'receipt.json'))) } catch (e) { if (e.code !== 'ENOENT') recoveryError = error(e); else recoveryError ??= { code: 'recovery_receipt_unconfirmed', message: '只持有首次 POST 前的恢复索引；尚无已持久的结果，不证明曾提交或设备执行。' } }
    try { result = resultOf(intent, recordId, await readPrivate(join(base, 'sdk-unknown.json'))) } catch (e) { if (e.code !== 'ENOENT') { recoveryError = error(e); result = null } }
    return { recordId, source: 'host', kind: intent.kind, action: intent.action, instanceId: intent.instanceId, members: intent.members.map(({ target, controlEpoch, stopRequestId }) => ({ target: structuredClone(target), controlEpoch, stopRequestId })), operationIds: intent.members.map(m => m.operationId), result, pending: !result || result.results.some(r => r.admission !== 'finished'), recoveryError }
  }
  return {
    async prepare(s, value) {
      const intent = intentOf(s, value)
      if (Buffer.byteLength(JSON.stringify(intent)) + 1 > maxBytes) fail('recovery_capacity', '单条恢复索引超过 16 KiB；普通操作未提交。')
      await root()
      // Kernel-exclusive per-slot mkdir locks cover prepare/update/forget across Hosts.
      for (let index = 0; index < capacity; index++) {
        const slotName = slot(index), base = join(directory, slotName)
        try {
          const prepared = await locked(slotName, async () => {
            try { await lstat(base); await privateDirectory(base); return null } catch (e) { if (e.code !== 'ENOENT') throw e }
            const recordId = `${slotName}.${randomUUID()}`
            await mkdir(base, { mode: 0o700 })
            try {
              const parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
              try { await parent.sync() } finally { await parent.close() }
              await atomic(base, 'intent.json', { ...intent, recordId })
            }
            catch (e) { await rm(base, { recursive: true }); throw e } // This owned intent has never admitted a POST.
            return recordId
          })
          if (prepared) return prepared
        } catch (e) { if (e.code === 'recovery_locked') continue; throw e }
      }
      fail('recovery_capacity', '恢复索引已满；不会删除未决记录或提交普通操作。')
    },
    async complete(s, recordId, value) {
      await readIntent(s, recordId) // Reject stale or fabricated references before recording a local write error.
      try {
        await locked(slotOf(recordId), async () => {
          const { base, intent } = await readIntent(s, recordId), result = resultOf(intent, recordId, value)
          let sticky = null
          try { sticky = resultOf(intent, recordId, await readPrivate(join(base, 'sdk-unknown.json'))) } catch (e) { if (e.code !== 'ENOENT') throw e }
          for (const previous of sticky?.results ?? []) if (previous.unknownSource === 'sdk' && previous.unknown && !(result.results.find(r => r.operationId === previous.operationId)?.unknown && result.results.find(r => r.operationId === previous.operationId)?.unknownSource === 'sdk')) fail('recovery_unknown_preserved', '并发持久的 SDK 未知不可被较早已知回执降格。')
          if (result.results.some(r => r.unknownSource === 'sdk' && r.unknown)) await atomic(base, 'sdk-unknown.json', result)
          await atomic(base, 'receipt.json', result)
        })
        clearError(recordId)
      } catch (e) { updateErrors.set(slotOf(recordId), { recordId, error: error(e) }); throw e }
      const { base, intent } = await readIntent(s, recordId)
      return view(recordId, intent, base)
    },
    async forget(s, recordId) {
      return locked(slotOf(recordId), async () => {
        const { base, intent } = await readIntent(s, recordId), record = await view(recordId, intent, base)
        // Our own lock is expected. Other storage/read errors and every unresolved fact forbid removal.
        if (record.recoveryError?.code === 'recovery_locked') record.recoveryError = updateError(recordId) ?? null
        if (record.recoveryError || !record.result || record.pending || record.result.unknown || record.result.results.some(r => r.unknown || r.previousUnknown || r.submission === 'unknown')) fail('recovery_unresolved', '仅可移除已持久完成且无未知或存储错误的本地索引；未决记录必须保留。')
        await rm(base, { recursive: true }); clearError(recordId)
        return { forgotten: true, recordId }
      })
    },
    async list(s) {
      id(s); await root(); const records = []
      for (let index = 0; index < capacity; index++) {
        const base = join(directory, slot(index))
        try {
          await lstat(base); await privateDirectory(base)
          let stored
          try { stored = await readPrivate(join(base, 'intent.json')) } catch (e) { if (e.code === 'ENOENT') fail('recovery_index_incomplete', '本地恢复索引槽缺少原 intent；不会当作空历史或自动删除。'); throw e }
          const recordId = stored.recordId, { intent } = await readIntent(s, recordId); records.push(await view(recordId, intent, base))
        }
        catch (e) { if (['ENOENT', 'recovery_forbidden'].includes(e.code)) continue; throw e }
      }
      return { records }
    },
    async recover(s, recordId, { instanceId, fetch }) {
      const { base, intent } = await readIntent(s, recordId)
      if (intent.instanceId !== instanceId) fail('instance_mismatch', '恢复记录属于旧 SDK 实例；仅显示原历史，不向新实例查询或重发。')
      const original = await view(recordId, intent, base), results = []
      for (const member of intent.members) results.push(validateOperation(intent, member, await fetch(intent.kind, intent.instanceId, member.operationId)))
      for (const previous of original.result?.results ?? []) {
        const next = results.find(r => r.operationId === previous.operationId)
        if (next && previous.previousOperationId) Object.assign(next, { previousOperationId: previous.previousOperationId, previousSubmission: previous.previousSubmission, previousUnknown: previous.previousUnknown, previousNativeJsonText: null })
      }
      const value = { scopeId: recordId, action: intent.action, results, unknown: results.some(r => r.unknown || r.previousUnknown), newSubmission: false }
      for (const previous of original.result?.results ?? []) if (previous.unknownSource === 'sdk' && previous.unknown && !results.find(r => r.operationId === previous.operationId)?.unknown) fail('recovery_unknown_preserved', '原 SDK 未知证据不可被已知读取降格。')
      const projected = resultOf(intent, recordId, value) // Validate all states before returning any explicit GET evidence.
      try { await this.complete(s, recordId, value) } catch (e) {
        if (e.code === 'recovery_unknown_preserved') throw e
        const current = await readIntent(s, recordId)
        return { ...await view(recordId, current.intent, current.base), recoveryError: error(e) }
      }
      const current = await readIntent(s, recordId), stored = await view(recordId, current.intent, current.base)
      if (!stored.result || JSON.stringify(stored.result.results) !== JSON.stringify(projected.results) || stored.result.unknown !== projected.unknown) return { ...stored, recoveryError: stored.recoveryError ?? { code: 'recovery_state_changed', message: '本次 GET 与随后持久的逐成员状态不一致；仅显示最终原证据，可再显式只读查询。' } }
      return { ...stored, result: value } // SDK native/error text is returned only for this explicit GET, never persisted.
    },
  }
}
