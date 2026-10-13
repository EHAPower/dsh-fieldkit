import { randomUUID } from 'node:crypto'
const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }
const fields = (value, required, optional = []) => { if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(k => value[k] === undefined) || Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) fail('bad_request', 'Invalid fixed control request') }
const decimal = value => typeof value === 'string' && value.length <= 128 && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(value)
const commandKeys = { position: ['mm'], velocity: ['mm_s'], force: ['n'], impedance: ['equilibrium_mm', 'stiffness_n_per_mm', 'damping_ns_per_mm'], heartbeat_start: [], heartbeat_stop: [], heartbeat_once: [] }
function command(value) { if (!value || !Object.hasOwn(commandKeys, value.action)) fail('bad_request', 'Unknown fixed control action'); fields(value, ['action', ...commandKeys[value.action]]); for (const key of commandKeys[value.action]) if (!decimal(value[key])) fail('bad_request', '控制参数须为完整 JSON 数值原文；范围由 SDK 校验。'); return value }
function trialInput(p) {
  fields(p, ['mode', 'command', 'envelope', 'durationS', 'reach'])
  fields(p.command, ['positionMm', 'velocityMmS', 'forceN', 'equilibriumMm', 'stiffnessNPerMm', 'dampingNsPerMm'])
  const envelopeKeys = { positionMinMm: 'position_min_mm', positionMaxMm: 'position_max_mm', velocityAbsMaxMmS: 'velocity_abs_max_mm_s', forceAbsMaxN: 'force_abs_max_n', stiffnessMaxNPerMm: 'stiffness_max_n_per_mm', dampingMaxNsPerMm: 'damping_max_ns_per_mm', durationMaxS: 'duration_max_s' }
  fields(p.envelope, Object.keys(envelopeKeys))
  const keys = { position: { mm: 'positionMm' }, velocity: { mm_s: 'velocityMmS' }, force: { n: 'forceN' }, impedance: { equilibrium_mm: 'equilibriumMm', stiffness_n_per_mm: 'stiffnessNPerMm', damping_ns_per_mm: 'dampingNsPerMm' } }
  if (!Object.hasOwn(keys, p.mode)) fail('bad_request', '未知试验模式。')
  const c = command({ action: p.mode, ...Object.fromEntries(Object.entries(keys[p.mode]).map(([wire, source]) => [wire, p.command[source]])) })
  for (const value of Object.values(p.envelope)) if (!decimal(value)) fail('bad_request', '试验范围须为原始 JSON 数值文字。')
  if (p.durationS !== '' && !decimal(p.durationS)) fail('bad_request', '试验时长须为原始 JSON 数值或留空。')
  if (p.reach !== null) { fields(p.reach, ['toleranceMm', 'settleMs']); if (!decimal(p.reach.toleranceMm) || !/^(0|[1-9][0-9]*)$/.test(p.reach.settleMs) || p.reach.settleMs.length > 20 || BigInt(p.reach.settleMs) > 18446744073709551615n) fail('bad_request', '到位条件需完整原始数值和 u64 毫秒。') }
  return { command: c, envelope: Object.fromEntries(Object.entries(envelopeKeys).map(([source, wire]) => [wire, p.envelope[source]])), duration_s: p.durationS || null, reach: p.reach && { tolerance_mm: p.reach.toleranceMm, settle_ms: p.reach.settleMs } }
}
const sameIdentity = (a, b) => a && b && a.uid === b.uid && a.run_nonce === b.run_nonce
const target = (instanceId, b) => ({ instanceId, bindingId: b.binding_id, targetId: b.target_id, uid: b.identity.uid, runNonce: b.identity.run_nonce, connectionGeneration: b.connection_generation })
const err = e => ({ code: typeof e.code === 'string' ? e.code : 'backend_error', message: e.message })
const knownRejection = new Set(['permission_denied', 'invalid_request', 'binding_stale', 'identity_changed', 'instance_mismatch', 'request_id_expired', 'reservation_busy', 'operation_capacity', 'unsupported', 'busy', 'not_found', 'permission_conflict'])
/** Fixed scopes have their own observer leases; ordinary selection never replaces their members. */
export function createP4Service({ mode, session, attach, http, currentInstance = () => undefined, busy = () => false, schedule = setTimeout, clear = clearTimeout, recoveryJournal }) {
  const contexts = new Map(), scopes = new Map(), trials = new Map(), originals = new Map()
  let disposed = false
  const requireActive = () => { if (disposed) fail('disposed', '插件引用已释放，不提交新的授权或控制操作。') }
  function context(s) { session(s); if (!contexts.has(s)) contexts.set(s, { candidates: new Map(), scopes: [], activeScopeId: null }); return contexts.get(s) }
  async function ready(s, capability) { context(s); if (disposed) fail('disposed', '控制引用已释放。'); if (mode !== 'service-v2') fail('unsupported', '控制需要 service-v2。'); const d = await attach(); requireActive(); if (capability && !d.capabilities.includes(capability)) fail('unsupported', `服务未发布 ${capability}；不执行设备动作。`); return d }
  function registered(s, id) { const value = scopes.get(id); if (!value || value.sessionId !== s) fail('not_found', '当前对话未登记该固定控制范围。'); return value }
  function view(value) { return structuredClone({ scopeId: value.id, instanceId: value.instanceId, members: value.members.map(m => ({ target: target(value.instanceId, m.binding), grantId: m.grantId, controlEpoch: m.controlEpoch, stopRequestId: m.stopRequestId })), kind: value.members.length === 1 ? 'single' : 'group', state: value.state, controlReady: value.controlReady, controlGranted: value.controlGranted !== false, reason: value.reason, stopAvailable: value.stopAvailable, stopReason: value.stopReason, latest: value.latest, lastOrdinary: value.lastOrdinary ?? null, trial: value.trial && value.state === 'expired' ? { ...value.trial, statusRead: 'historical', statusReason: value.reason, stopAvailable: false } : value.trial, recordings: value.recordings }) }
  function renew(scope, delay = 30000) {
    if (disposed || scope.observerReleased || scope.state === 'expired') return
    scope.timer = schedule(async () => {
      const started = Date.now()
      try { const outcomes = await Promise.allSettled(scope.members.map(m => scope.client.renew(m.binding))); const failed = outcomes.find(v => v.status === 'rejected'); if (failed) throw failed.reason }
      catch (e) { await expireScope(scope, `原观察租约未确认：${e.message}；不重连或恢复目标。`) }
      finally { scope.timer = null; if (!disposed && scope.state !== 'expired') renew(scope, Math.max(0, 30000 - (Date.now() - started))) }
    }, delay); scope.timer.unref?.()
  }
  async function expireScope(scope, reason) {
    scope.state = 'expired'; scope.controlReady = false; scope.reason = reason; scope.stopAvailable = false; scope.stopReason = '原观察范围已过期；请显式读取原执行范围并核对服务实例。'
    if (scope.timer) clear(scope.timer); scope.timer = null
    if (!scope.detaching) scope.detaching = Promise.allSettled(scope.members.map(m => scope.client.detach(m.binding)))
    await scope.detaching
  }
  async function scopeReady(s, scopeId, capability = 'control', stop = false) {
    const scope = registered(s, scopeId)
    if (disposed) fail('disposed', '控制引用已释放。')
    const instanceId = stop ? currentInstance() ?? scope.instanceId : (await ready(s, capability)).instance_id
    if (scope.instanceId !== instanceId) { await expireScope(scope, '原控制范围属于旧服务实例，不能向新实例重发。'); fail('instance_mismatch', scope.reason) }
    if (!stop && (scope.stopRequested || !scope.controlReady || scope.state !== 'active')) fail('permission_denied', scope.reason ?? '原控制范围不可提交新目标。')
    return scope
  }
  function project(scope, member, operation, error = null) {
    if (!operation) return { target: target(scope.instanceId, member.binding), operationId: null, admission: 'finished', submission: 'not_submitted', controlEffect: 'not_attempted', observation: 'unconfirmed', phase: null, unknown: false, unknownSource: null, nativeJsonText: null, error }
    const expected = target(scope.instanceId, member.binding)
    if (operation.controlEpoch !== member.controlEpoch || operation.action === 'stop' && operation.operationId !== member.stopRequestId || operation.action !== 'stop' && operation.claimantId !== scope.sessionId || operation.members.length !== 1 || !operation.members.some(m => m.targetId === expected.targetId && m.identity.uid === expected.uid && m.identity.runNonce === expected.runNonce && m.connectionGeneration === expected.connectionGeneration)) fail('invalid_response', '操作回执不属于原固定成员。')
    const unknown = operation.submission === 'unknown' || operation.controlEffect === 'unresolved'
    return { target: expected, operationId: operation.operationId, admission: operation.admission, submission: operation.submission, controlEffect: operation.controlEffect, observation: operation.observation, phase: operation.phase, unknown, unknownSource: unknown ? 'sdk' : null, nativeJsonText: operation.nativeJsonText, error: error ?? operation.error, ...(operation.stopAttemptDelayMs !== undefined ? { stopAttemptDelayMs: operation.stopAttemptDelayMs } : {}), ...(operation.trialId !== undefined ? { trialId: operation.trialId } : {}), ...(operation.recordingId !== undefined ? { recordingId: operation.recordingId } : {}) }
  }
  function projectAttempt(scope, member, item, ticket, expectedAction) {
    if (!item) fail('invalid_response', '群组回执遗漏原成员。')
    if (item.operation && item.operation.operationId !== ticket.operationId) {
      if (!item.error) fail('invalid_response', '当前群组回执编号不匹配。')
      const previous = project(scope, member, item.operation)
      return { ...project(scope, member, null, item.error), operationId: ticket.operationId, previousOperationId: previous.operationId, previousSubmission: previous.submission, previousUnknown: previous.unknown, previousNativeJsonText: previous.nativeJsonText }
    }
    if (item.operation && item.operation.action !== expectedAction) fail('invalid_response', '当前群组回执动作不匹配。')
    return { ...project(scope, member, item.operation, item.error), operationId: ticket.operationId }
  }
  function result(scope, action, results, extra = {}) { const v = { scopeId: scope.id, action, results, unknown: results.some(r => r.unknown || r.previousUnknown), ...extra }; if (action === 'stop' || !scope.stopRequested) scope.latest = v; if (action !== 'stop') scope.lastOrdinary = v; if (v.unknown && action !== 'stop') { scope.controlReady = false; scope.reason = '原范围存在未知操作，只核对原记录或明确 Stop，不重发目标。' } return structuredClone(v) }
  function provisional(scope, action, tickets) { return result(scope, action, scope.members.map((m, i) => ({ target: target(scope.instanceId, m.binding), operationId: tickets[i].operationId, admission: 'queued', submission: 'not_attempted', controlEffect: 'not_attempted', observation: 'unconfirmed', phase: 'queued', unknown: false, unknownSource: null, nativeJsonText: null, error: null }))) }
  function lost(scope, action, tickets, error) { const rejected = knownRejection.has(error.code); return result(scope, action, scope.members.map((m, i) => ({ target: target(scope.instanceId, m.binding), operationId: tickets[i].operationId, admission: rejected ? 'finished' : 'unknown', submission: rejected ? 'not_submitted' : 'unknown', controlEffect: rejected ? 'not_attempted' : 'unresolved', observation: 'unconfirmed', phase: null, unknown: !rejected, unknownSource: rejected ? null : 'transport', nativeJsonText: null, error: err(error) }))) }
  async function issue(scope) {
    if (scope.groupId) { const value = await scope.client.groupTickets(scope.instanceId, scope.groupId, scope.sessionId); return scope.members.map(m => { const ticket = value.requests.find(t => t.bindingId === m.binding.binding_id); if (!ticket || ticket.controlEpoch !== m.controlEpoch) fail('invalid_response', '群组票据缺失原成员或代次不匹配。'); return ticket }) }
    const ticket = await scope.client.controlTicket(scope.instanceId, scope.reservationId, scope.sessionId)
    if (ticket.controlEpoch !== scope.members[0].controlEpoch) fail('invalid_response', '控制票据代次变化。')
    return [ticket]
  }
  async function ordinary(s, scopeId, action, wireAction, data) {
    const scope = registered(s, scopeId)
    const notSent = e => ({ scopeId: scope.id, action, results: scope.members.map(m => project(scope, m, null, err(e))), unknown: false, newSubmission: false })
    try { await scopeReady(s, scopeId, wireAction === 'trials' || wireAction === 'trials/target' ? 'trials' : wireAction.startsWith('recording/') ? 'recording_write' : 'control'); if (scope.flight || busy()) fail('busy', '普通操作正在处理；固定范围 Stop 不受此门禁影响。') }
    catch (e) { return notSent(e) }
    scope.flight = true
    let recoveryRecordId = null
    const finish = async value => {
      if (recoveryRecordId) try { await recoveryJournal.complete(s, recoveryRecordId, value) } catch { /* The durable intent remains pending; history reports the receipt update error. */ }
      return value
    }
    try {
      let tickets
      try { tickets = await issue(scope); if (disposed) fail('disposed', '插件引用已释放，不提交新操作。') }
      catch (e) { return notSent(e) }
      try {
        if (!recoveryJournal) fail('recovery_unavailable', 'Host 持久恢复索引不可用；普通操作未提交。')
        const members = scope.members.map((m, i) => ({ target: target(scope.instanceId, m.binding), controlEpoch: m.controlEpoch, stopRequestId: m.stopRequestId, grantId: m.grantId, reservationId: scope.reservationId, operationId: tickets[i].operationId }))
        const original = JSON.stringify(members)
        recoveryRecordId = await recoveryJournal.prepare(s, { kind: 'control', action, instanceId: scope.instanceId, members })
        scope.recoveryRecords ??= new Map(); scope.recoveryRecords.set(tickets[0].operationId, recoveryRecordId)
        requireActive(); await scopeReady(s, scopeId, wireAction === 'trials' || wireAction === 'trials/target' ? 'trials' : wireAction.startsWith('recording/') ? 'recording_write' : 'control')
        if (original !== JSON.stringify(scope.members.map((m, i) => ({ target: target(scope.instanceId, m.binding), controlEpoch: m.controlEpoch, stopRequestId: m.stopRequestId, grantId: m.grantId, reservationId: scope.reservationId, operationId: tickets[i].operationId })))) fail('binding_stale', '持久登记期间原固定范围身份或授权变化；普通操作未提交。')
      } catch (e) {
        const value = notSent(e)
        if (recoveryRecordId) await finish({ ...value, results: value.results.map((r, i) => ({ ...r, operationId: tickets[i].operationId })) })
        return value
      }
      provisional(scope, action, tickets)
      let value
      try {
        if (scope.groupId) {
          value = await scope.client.groupSubmit(scope.instanceId, scope.groupId, { claimantId: s, action: wireAction, requests: scope.members.map((m, i) => ({ bindingId: m.binding.binding_id, operationId: tickets[i].operationId, ...data(m, i) })) })
          return finish(result(scope, action, scope.members.map((m, i) => projectAttempt(scope, m, value.members.find(item => item.bindingId === m.binding.binding_id), tickets[i], action))))
        }
        const m = scope.members[0], intent = { claimantId: s, reservationId: scope.reservationId, operationId: tickets[0].operationId, controlEpoch: m.controlEpoch, ...data(m, 0) }
        value = wireAction === 'controls' ? await scope.client.controlCommand(m.binding, intent) : wireAction === 'trials' ? await scope.client.startTrial(m.binding, intent) : wireAction === 'trials/target' ? await scope.client.updateTrial(m.binding, intent) : await scope.client.recordingAction(m.binding, { ...intent, action: wireAction.split('/')[1] })
        return finish(result(scope, action, [project(scope, m, value)], { newSubmission: value.newSubmission }))
      } catch (e) { return finish(lost(scope, action, tickets, e)) }
    } finally { scope.flight = false }
  }
  async function refreshScope(scope) {
    if (scope.flight || scope.stopFlight || !scope.latest) return
    const original = scope.latest, refreshed = []
    for (let i = 0; i < original.results.length; i++) {
      const previous = original.results[i]
      if (previous.previousOperationId || !previous.operationId || previous.admission === 'finished' && !previous.unknown) { refreshed.push(previous); continue }
      try {
        const operation = await scope.client.controlOperation(scope.instanceId, previous.operationId)
        if (operation.operationId !== previous.operationId) fail('invalid_response', '原操作编号变化。')
        const next = project(scope, scope.members[i], operation)
        if (previous.unknownSource === 'sdk' && !next.unknown) fail('invalid_response', '真实 SDK 未知记录不得被清除。')
        refreshed.push(next)
      } catch (e) { refreshed.push({ ...previous, error: err(e) }) }
    }
    if (scope.latest !== original) return
    const next = result(scope, original.action, refreshed, { newSubmission: false })
    const recoveryRecordId = original.action !== 'stop' && scope.recoveryRecords?.get(original.results[0]?.operationId)
    if (recoveryRecordId) try { await recoveryJournal.complete(scope.sessionId, recoveryRecordId, next) } catch { /* History retains the original intent and reports update failure. */ }
    if (scope.stopResult?.results.every((r, i) => r.operationId === original.results[i]?.operationId)) scope.stopResult = next
    if (original.results.some(r => r.unknownSource === 'transport') && refreshed.every(r => r.admission === 'finished' && r.submission === 'not_submitted' && !r.unknown) && !scope.stopRequested && scope.state === 'active' && scope.reservationId) { scope.controlReady = true; scope.reason = null }
  }
  function originalOperation(record, op, action, operationId) {
    const m = op.members[0], scope = record.scope
    if (op.operationId !== operationId || action === 'stop' && operationId !== scope.stopRequestId || op.action !== action || action !== 'stop' && op.claimantId !== record.sessionId || op.controlEpoch !== scope.controlEpoch || op.members.length !== 1 || m.targetId !== scope.targetId || m.identity.uid !== scope.uid || m.identity.runNonce !== scope.runNonce || m.connectionGeneration !== scope.connectionGeneration) fail('invalid_response', '回执不属于原执行范围与已登记动作。')
    const unknown = op.submission === 'unknown' || op.controlEffect === 'unresolved'
    return { referenceId: scope.referenceId, scope: structuredClone(scope), operationId, action, admission: op.admission, submission: op.submission, controlEffect: op.controlEffect, observation: op.observation, unknown, unknownSource: unknown ? 'sdk' : null, nativeJsonText: op.nativeJsonText, error: op.error, ...(typeof op.newSubmission === 'boolean' ? { newSubmission: op.newSubmission } : {}) }
  }
  const api = {
    async listOriginalStopScopes(s) {
      const d = await ready(s, 'control_scopes'), client = http(), entries = await client.controlScopes(d.instance_id)
      const values = []
      for (const entry of entries) {
        const key = JSON.stringify([s, d.instance_id, entry.stopRequestId, entry.scope])
        let record = [...originals.values()].find(v => v.key === key)
        if (!record) { record = { key, sessionId: s, client, expectedScope: entry.scope, result: null, flight: null, cleanupFlight: false, operations: new Map(), scope: { referenceId: randomUUID(), instanceId: d.instance_id, targetId: entry.scope.targetId, uid: entry.scope.identity.uid, runNonce: entry.scope.identity.runNonce, connectionGeneration: entry.scope.connectionGeneration, controlEpoch: entry.scope.controlEpoch, stopRequestId: entry.stopRequestId, current: entry.current, controlGranted: entry.controlGranted } }; originals.set(record.scope.referenceId, record) }
        record.scope.current = entry.current; record.scope.controlGranted = entry.controlGranted
        values.push(structuredClone(record.scope))
      }
      return { scopes: values }
    },
    async stopOriginalScope(s, referenceId) {
      context(s); if (disposed) fail('disposed', '控制引用已释放。')
      const record = originals.get(referenceId)
      if (!record || record.sessionId !== s) fail('not_found', '请先显式读取并选择当前对话的原执行范围。')
      const d = { instance_id: currentInstance() ?? record.scope.instanceId }
      if (record.scope.instanceId !== d.instance_id) fail('instance_mismatch', '原执行范围属于旧实例。')
      if (record.result) return structuredClone({ ...record.result, newSubmission: false })
      if (record.flight) return record.flight
      if (!record.scope.current || !record.scope.controlGranted) fail('permission_denied', '原执行范围未获人工控制授权或已经过期。')
      for (const scope of scopes.values()) if (scope.instanceId === d.instance_id && scope.members.some(m => m.binding.identity.uid === record.scope.uid)) { scope.stopRequested = true; scope.controlReady = false; scope.reason = '已对原 UID 请求 Stop；不恢复原目标，新控制需明确建立范围。' }
      record.flight = (async () => {
        let receipt
        try {
          const op = await record.client.stopControlOriginalScope(d.instance_id, record.scope.stopRequestId, { claimantId: s, expectedScope: record.expectedScope })
          const member = op.members[0], scope = record.scope
          if (op.operationId !== scope.stopRequestId || op.action !== 'stop' || op.controlEpoch !== scope.controlEpoch || op.members.length !== 1 || member.targetId !== scope.targetId || member.identity.uid !== scope.uid || member.identity.runNonce !== scope.runNonce || member.connectionGeneration !== scope.connectionGeneration) fail('invalid_response', 'Stop 回执不属于明确选择的原执行范围。')
          const unknown = op.submission === 'unknown' || op.controlEffect === 'unresolved'
          receipt = { admission: op.admission, submission: op.submission, controlEffect: op.controlEffect, observation: op.observation, unknown, unknownSource: unknown ? 'sdk' : null, nativeJsonText: op.nativeJsonText, error: op.error, newSubmission: op.newSubmission }
        } catch (e) { const rejected = knownRejection.has(e.code); receipt = { admission: rejected ? 'finished' : 'unknown', submission: rejected ? 'not_submitted' : 'unknown', controlEffect: rejected ? 'not_attempted' : 'unresolved', observation: 'unconfirmed', unknown: !rejected, unknownSource: rejected ? null : 'transport', nativeJsonText: null, error: err(e) } }
        record.result = { referenceId, scope: structuredClone(record.scope), operationId: record.scope.stopRequestId, ...receipt }; return structuredClone(record.result)
      })()
      try { return await record.flight } finally { record.flight = null }
    },
    async cleanupOriginalScope(s, request) {
      fields(request, ['referenceId', 'action'])
      if (!['heartbeat_stop', 'recording_stop'].includes(request.action)) fail('bad_request', '仅允许原范围停止持续心跳或停止记录。')
      const d = await ready(s, 'control_scopes'), record = originals.get(request.referenceId)
      if (!record || record.sessionId !== s) fail('not_found', '原范围未登记。')
      if (record.scope.instanceId !== d.instance_id) fail('instance_mismatch', '原范围属于旧实例。')
      if (record.cleanupFlight || [...record.operations.values()].some(v => v.unknown || v.admission !== 'finished')) fail('busy', '原范围本地收尾仍未决；仅查询原编号，不重发。')
      record.cleanupFlight = true
      try {
        const ticket = await record.client.originalCleanupTicket(d.instance_id, record.scope.stopRequestId, { claimantId: s, expectedScope: record.expectedScope })
        requireActive()
        const base = { referenceId: request.referenceId, scope: structuredClone(record.scope), operationId: ticket.operationId, action: request.action, admission: 'queued', submission: 'not_attempted', controlEffect: 'not_attempted', observation: 'unconfirmed', unknown: false, unknownSource: null, nativeJsonText: null, error: null }
        record.operations.set(ticket.operationId, base)
        try { const op = await record.client.cleanupOriginalScope(d.instance_id, record.scope.stopRequestId, { claimantId: s, expectedScope: record.expectedScope, operationId: ticket.operationId, action: request.action }); const result = originalOperation(record, op, request.action, ticket.operationId); record.operations.set(ticket.operationId, result); return structuredClone(result) }
        catch (e) { const rejected = knownRejection.has(e.code), result = { ...base, admission: rejected ? 'finished' : 'unknown', submission: rejected ? 'not_submitted' : 'unknown', controlEffect: rejected ? 'not_attempted' : 'unresolved', unknown: !rejected, unknownSource: rejected ? null : 'transport', error: err(e) }; record.operations.set(ticket.operationId, result); return structuredClone(result) }
      } finally { record.cleanupFlight = false }
    },
    async getOriginalScopeOperation(s, request) {
      fields(request, ['referenceId', 'operationId'], ['action'])
      if (request.action !== undefined && !['stop', 'heartbeat_stop', 'recording_stop'].includes(request.action)) fail('bad_request', '只查询原 Stop 或本地收尾动作。')
      const d = await ready(s, 'control_scopes'), record = originals.get(request.referenceId)
      if (!record || record.sessionId !== s) fail('not_found', '原范围未登记。')
      if (record.scope.instanceId !== d.instance_id) fail('instance_mismatch', '原范围属于旧实例。')
      const previous = request.operationId === record.result?.operationId ? record.result : record.operations.get(request.operationId)
      if (!previous && !request.action) fail('not_found', '恢复旧 Host 回执需明确原编号和动作，并核对当前人工所选原范围。')
      if ((previous?.action ?? request.action) === 'stop' && request.operationId !== record.scope.stopRequestId) fail('bad_request', 'Stop 查询只接受原范围 canonical 编号。')
      if (previous && request.action && (previous.action ?? 'stop') !== request.action) fail('bad_request', '原操作动作不匹配。')
      const op = await record.client.controlOperation(d.instance_id, request.operationId), result = originalOperation(record, op, previous?.action ?? request.action ?? 'stop', request.operationId)
      if (previous?.unknownSource === 'sdk' && !result.unknown) fail('invalid_response', '真实 SDK 未知记录不可清除。')
      if (result.action === 'stop') record.result = result; else record.operations.set(request.operationId, result)
      return structuredClone(result)
    },
    async controlCandidates(s) {
      const d = await ready(s, 'control'), c = context(s), value = await http().targets(d.instance_id)
      if (value.instance_id !== d.instance_id) fail('instance_mismatch', '候选所属实例变化。')
      c.candidates.clear()
      for (const t of value.targets) if (t.connected && t.can_attach && t.identity) { const id = randomUUID(); c.candidates.set(id, { candidateId: id, label: t.label ?? t.target_id, targetId: t.target_id, instanceId: d.instance_id, uid: t.identity.uid, runNonce: t.identity.run_nonce, connectionGeneration: t.connection_generation }) }
      return { candidates: [...c.candidates.values()] }
    },
    async createControlScope(s, request) {
      fields(request, ['candidateIds'])
      if (!Array.isArray(request.candidateIds) || !request.candidateIds.length || request.candidateIds.length > 16 || new Set(request.candidateIds).size !== request.candidateIds.length) fail('bad_request', '明确选择 1–16 个不重复成员。')
      const d = await ready(s, request.candidateIds.length > 1 ? 'control_groups' : 'control'), c = context(s)
      const selected = request.candidateIds.map(id => c.candidates.get(id))
      if (selected.some(v => !v || v.instanceId !== d.instance_id) || new Set(selected.map(v => v.uid)).size !== selected.length) fail('binding_stale', '候选不属于当前对话实例，或含同一物理 UID。请刷新。')
      const scope = { id: randomUUID(), sessionId: s, instanceId: d.instance_id, client: http(), members: [], state: 'active', controlReady: false, reason: null, stopAvailable: false, stopReason: '等待完整固定范围的服务 Stop 编号。', latest: null, trial: null, recordings: [], groupId: null, reservationId: null, stopRequestId: null, flight: false, stopFlight: null, stopResult: null, timer: null }
      try {
        for (const candidate of selected) {
          requireActive()
          const b = await scope.client.bind({ instance_id: d.instance_id, target_id: candidate.targetId, intent: 'attach', expected_identity: { uid: candidate.uid, run_nonce: candidate.runNonce }, connection_generation: candidate.connectionGeneration, lease_ms: 120000 })
          if (!sameIdentity(b.identity, { uid: candidate.uid, run_nonce: candidate.runNonce }) || b.connection_generation !== candidate.connectionGeneration) fail('identity_changed', '控制成员身份变化；不连接替代设备。')
          scope.members.push({ binding: b, grantId: null, controlEpoch: null, stopRequestId: null })
          if (disposed) fail('disposed', '插件引用已释放，不申请授权。')
          const permissions = await scope.client.permissionView(b)
          requireActive()
          const grant = await scope.client.controlPermission(b, { maintenance: permissions.maintenance, control: true }, permissions.grantId)
          Object.assign(scope.members.at(-1), { grantId: grant.grantId, controlEpoch: grant.controlEpoch, stopRequestId: grant.stopRequestId })
          requireActive()
        }
        if (disposed) fail('disposed', '插件引用已释放，不创建控制范围。')
        scopes.set(scope.id, scope); c.scopes.push(scope.id); c.activeScopeId = scope.id
        scope.stopAvailable = scope.members.every(m => m.grantId && m.controlEpoch && m.stopRequestId)
        scope.stopReason = scope.stopAvailable ? null : scope.stopReason
        if (scope.members.length === 1) {
          scope.stopRequestId = scope.members[0].stopRequestId; scope.stopAvailable = !!scope.stopRequestId; scope.stopReason = scope.stopAvailable ? null : scope.stopReason
          try { const r = await scope.client.controlReservation(scope.members[0].binding, s); scope.reservationId = r.reservationId; scope.members[0].controlEpoch = r.controlEpoch; requireActive(); scope.controlReady = !scope.stopRequested }
          catch (e) { if (disposed) throw e; scope.reason = `普通控制占用未取得：${e.message}；已授权的原范围 Stop 独立可用。` }
        } else {
          const group = await scope.client.createControlGroup(scope.instanceId, scope.members.map(m => m.binding), s)
          scope.groupId = group.groupId; scope.reservationId = group.reservationId; scope.stopRequestId = group.stopRequestId
          for (const m of scope.members) { const saved = group.members.find(v => v.bindingId === m.binding.binding_id); if (!saved) fail('invalid_response', '服务群组遗漏原成员。'); m.controlEpoch = saved.controlEpoch; m.stopRequestId = saved.stopRequestId }
          requireActive(); scope.controlReady = !scope.stopRequested; scope.stopAvailable = true; scope.stopReason = null
        }
        renew(scope); return view(scope)
      } catch (e) {
        if (scopes.has(scope.id)) { if (disposed) { await expireScope(scope, '插件已解除观察引用；保留已返回授权和占用事实，不发送新动作。'); throw e } scope.reason = `普通控制占用未取得：${e.code ?? 'backend_error'} ${e.message}；保留原成员，不自动重试。${scope.stopAvailable ? '已授权的全部原成员 Stop 独立可用。' : ''}`; renew(scope); return view(scope) }
        await Promise.allSettled(scope.members.map(m => scope.client.detach(m.binding)))
        if (scope.members.some(m => m.grantId)) e.message = `完整控制范围未建立；${scope.members.filter(m => m.grantId).map(m => m.binding.target_id).join('、')} 已取得 control 授权，可显式读取原执行范围核对；没有提交目标或 Stop。${e.message}`
        throw e
      }
    },
    async controlContext(s) { const d = await ready(s, null), c = context(s); for (const id of c.scopes) { const scope = scopes.get(id); if (scope.instanceId === d.instance_id) { await refreshScope(scope); if (scope.trial?.trialId && !scope.flight && !scope.stopFlight) await api.getControlTrial(s, scope.trial.trialId); if (d.capabilities.includes('recording_write') && !scope.flight) scope.recordings = await Promise.all(scope.members.map(async m => { try { return { target: target(scope.instanceId, m.binding), ...await scope.client.recordingStatus(m.binding), error: null } } catch (e) { return { target: target(scope.instanceId, m.binding), active: null, failed: null, recordingId: null, nativeJsonText: null, error: err(e) } } })) } else await expireScope(scope, '控制范围属于旧实例；不能恢复目标。') } return { capabilities: d.capabilities, scopes: c.scopes.map(id => view(scopes.get(id))), activeScopeId: c.activeScopeId } },
    async selectControlScope(s, scopeId) { registered(s, scopeId); context(s).activeScopeId = scopeId; return api.controlContext(s) },
    async submitControl(s, request) { fields(request, ['scopeId', 'command']); command(request.command); return ordinary(s, request.scopeId, request.command.action, 'controls', () => ({ command: request.command })) },
    async recordControl(s, request) { fields(request, ['scopeId', 'action']); if (!['start', 'stop'].includes(request.action)) fail('bad_request', '未知记录动作。'); return ordinary(s, request.scopeId, `recording_${request.action}`, `recording/${request.action}`, () => ({})) },
    async stopControlScope(s, scopeId) {
      const scope = await scopeReady(s, scopeId, 'control', true)
      if (!scope.stopAvailable) fail('permission_denied', scope.stopReason ?? '原范围没有已授权的 Stop 编号。')
      if (scope.stopResult) return structuredClone({ ...scope.stopResult, newSubmission: false, coalescedExisting: true })
      if (scope.stopFlight) return scope.stopFlight
      scope.stopRequested = true; scope.controlReady = false; scope.reason = '已请求原范围 Stop；不恢复原目标，新控制需重新明确建立范围。'
      const tickets = scope.members.map(m => ({ operationId: m.stopRequestId }))
      scope.stopFlight = (async () => {
        provisional(scope, 'stop', tickets)
        try {
          if (scope.groupId) { const v = await scope.client.stopGroup(scope.instanceId, scope.groupId, { claimantId: s, operationId: scope.stopRequestId, controlEpoch: scope.members[0].controlEpoch }); scope.stopResult = result(scope, 'stop', scope.members.map(m => { const item = v.members.find(v => v.bindingId === m.binding.binding_id); if (!item) fail('invalid_response', 'Stop 回执遗漏固定成员。'); return projectAttempt(scope, m, item, { operationId: m.stopRequestId }, 'stop') })) }
          else if (scope.members.length > 1) {
            // A refused group reservation has no SDK group ID. Stop still covers
            // every originally confirmed member using its preallocated ID.
            const results = await Promise.all(scope.members.map(async m => {
              try {
                const value = scope.observerReleased
                  ? await scope.client.stopControlOriginalScope(scope.instanceId, m.stopRequestId, { claimantId: s, expectedScope: { targetId: m.binding.target_id, identity: { uid: m.binding.identity.uid, runNonce: m.binding.identity.run_nonce }, connectionGeneration: m.binding.connection_generation, controlEpoch: m.controlEpoch } })
                  : await scope.client.stop(m.binding, { claimantId: s, operationId: m.stopRequestId, controlEpoch: m.controlEpoch })
                return project(scope, m, value)
              } catch (e) {
                const rejected = knownRejection.has(e.code)
                return { ...project(scope, m, null, err(e)), operationId: m.stopRequestId, admission: rejected ? 'finished' : 'unknown', submission: rejected ? 'not_submitted' : 'unknown', controlEffect: rejected ? 'not_attempted' : 'unresolved', unknown: !rejected, unknownSource: rejected ? null : 'transport' }
              }
            }))
            scope.stopResult = result(scope, 'stop', results)
          }
          else { const m = scope.members[0]; const value = scope.observerReleased ? await scope.client.stopControlOriginalScope(scope.instanceId, scope.stopRequestId, { claimantId: s, expectedScope: { targetId: m.binding.target_id, identity: { uid: m.binding.identity.uid, runNonce: m.binding.identity.run_nonce }, connectionGeneration: m.binding.connection_generation, controlEpoch: m.controlEpoch } }) : await scope.client.stop(m.binding, { claimantId: s, operationId: scope.stopRequestId, controlEpoch: m.controlEpoch }); scope.stopResult = result(scope, 'stop', [project(scope, scope.members[0], value)], { newSubmission: value.newSubmission }) }
        } catch (e) { scope.stopResult = lost(scope, 'stop', tickets, e) }
        return structuredClone(scope.stopResult)
      })()
      try { return await scope.stopFlight } finally { scope.stopFlight = null }
    },
    async revokeControlScope(s, scopeId) {
      const scope = await scopeReady(s, scopeId, 'control', true)
      if (scope.flight) fail('busy', '当前授权/普通操作仍在处理；Stop 独立可用。')
      scope.flight = true; scope.controlReady = false
      const notes = []; let revoked = 0
      try {
        for (const m of scope.members) {
          let temporary = null
          try {
            requireActive()
            if (scope.observerReleased) {
              const d = await ready(s, 'control')
              if (d.instance_id !== scope.instanceId) fail('instance_mismatch', '原范围属于旧服务实例；不撤销新实例授权。')
              temporary = await scope.client.bind({ instance_id: scope.instanceId, target_id: m.binding.target_id, intent: 'attach', expected_identity: { ...m.binding.identity }, connection_generation: m.binding.connection_generation, lease_ms: 120000 })
              requireActive()
              if (temporary.instance_id !== scope.instanceId || temporary.target_id !== m.binding.target_id || !sameIdentity(temporary.identity, m.binding.identity) || temporary.connection_generation !== m.binding.connection_generation) fail('identity_changed', '临时观察不属于原完整成员；未撤销授权。')
            }
            const binding = temporary ?? m.binding
            const current = await scope.client.permissionView(binding)
            requireActive()
            if (temporary && (current.control !== true || current.grantId !== m.grantId || current.controlEpoch !== m.controlEpoch || current.stopRequestId !== m.stopRequestId)) fail('permission_conflict', '原成员的授权或控制代次已变化；请重新人工核对，未覆盖新授权。')
            await scope.client.controlPermission(binding, { maintenance: current.maintenance, control: false }, current.grantId)
            revoked++; notes.push(`${m.binding.target_id} control 授权已撤销`)
          }
          catch (e) { notes.push(`${m.binding.target_id} 授权撤销未确认：${e.code ?? 'backend_error'} ${e.message}`) }
          finally { if (temporary) try { await scope.client.detach(temporary) } catch (e) { notes.push(`${m.binding.target_id} 临时观察解除未确认：${e.code ?? 'backend_error'} ${e.message}；等待租约回收`) } }
        }
        scope.reason = `${notes.join('；')}。没有请求 Stop 或断连，旧普通范围不会恢复。`
        if (revoked === scope.members.length) { scope.controlGranted = false; scope.stopAvailable = false; scope.stopReason = '此范围 control 授权已撤销；Stop 需要重新明确人工授权原范围。' }
        return view(scope)
      } finally { scope.flight = false }
    },
    async releaseControlScope(s, scopeId) {
      const scope = await scopeReady(s, scopeId, 'control', true)
      const result = scope.groupId ? await scope.client.releaseControlGroup(scope.instanceId, scope.groupId, s) : scope.reservationId ? await scope.client.releaseControlReservation(scope.instanceId, scope.reservationId, s) : { blocked: [] }
      if (result.blocked?.length) { scope.reason = '原范围仍有未决占用，释放被服务阻挡；保留原范围。'; return view(scope) }
      scope.state = 'released'; scope.controlReady = false; scope.observerReleased = true; if (scope.timer) clear(scope.timer); scope.timer = null; if (!scope.detaching) scope.detaching = Promise.allSettled(scope.members.map(m => scope.client.detach(m.binding))); const detached = await scope.detaching; const unconfirmed = detached.filter(v => v.status === 'rejected').length; scope.reason = `普通写入占用已释放；${unconfirmed ? `${unconfirmed} 项观察引用解除未确认，停止续约后等待租约回收` : '观察引用已解除'}。保留原完整执行范围的 canonical Stop，不等于 Stop。`; return view(scope)
    },
    async startControlTrial(s, request) {
      fields(request, ['scopeId', 'parameters']); const input = trialInput(request.parameters)
      const scope = registered(s, request.scopeId), trialId = randomUUID()
      const record = { id: trialId, sessionId: s, scopeId: scope.id, mode: request.parameters.mode, memberIds: [], latest: null, previousTrial: scope.trial }
      const run = await ordinary(s, scope.id, 'trial_start', 'trials', () => ({ trial: input }))
      record.memberIds = run.results.map(r => r.operationId); record.latest = run; pinTrialUnknown(record, run); trials.set(trialId, record)
      return trialView(scope, record)
    },
    async updateControlTrial(s, request) {
      fields(request, ['trialId', 'positionRaw']); if (!decimal(request.positionRaw)) fail('bad_request', '位置需原始 JSON 数值文字。')
      const record = trials.get(request.trialId); if (!record || record.sessionId !== s || record.memberIds.some(id => !id)) fail('not_found', '没有当前对话登记的原始完整试验。')
      const run = await ordinary(s, record.scopeId, 'trial_target', 'trials/target', (_m, i) => ({ trialId: record.memberIds[i], mm: request.positionRaw })); record.latest = run; pinTrialUnknown(record, run)
      return trialView(registered(s, record.scopeId), record)
    },
    async releaseControlTrial(s, trialId) { const record = trials.get(trialId); if (!record || record.sessionId !== s) fail('not_found', '当前对话未登记原试验。'); record.released = true; return trialView(registered(s, record.scopeId), record) },
    async getControlTrial(s, trialId) {
      const record = trials.get(trialId); if (!record || record.sessionId !== s) fail('not_found', '当前对话未登记原试验。')
      const scope = await scopeReady(s, record.scopeId, 'trials', true), statuses = [], recordingIds = [], states = [], evidence = [...(record.evidence ?? [])]
      if (completedReference(scope, record)) return trialView(scope, record)
      await refreshScope(scope)
      if (scope.latest?.results.every((r, i) => r.operationId === record.latest?.results[i]?.operationId)) record.latest = scope.latest
      pinTrialUnknown(record, record.latest)
      await refreshTrialUnknown(scope, record, statuses)
      if (initialTrialNotSubmitted(scope, record)) return trialView(scope, record)
      for (let i = 0; i < scope.members.length; i++) {
        const id = record.memberIds[i]
        if (!id) { statuses.push('not_admitted'); continue }
        try { const v = await scope.client.trialStatus(scope.members[i].binding, id); states.push(v.trial.state); evidence[i] = { trialState: v.trial.state, stopObserved: v.trial.stopObserved, stopConfirmationOverdue: v.trial.stopConfirmationOverdue, elapsedMs: v.trial.elapsedMs, trialNativeJsonText: v.trial.nativeJsonText }; statuses.push(`${v.trial.state} · Stop观测 ${v.trial.stopObserved ? '是' : '否'} · 确认超时 ${v.trial.stopConfirmationOverdue ? '是' : '否'} · elapsed_ms ${v.trial.elapsedMs ?? '无'}`); const recording = await scope.client.recordingStatus(scope.members[i].binding); if (recording.recordingId) recordingIds.push(recording.recordingId) }
        catch (e) { statuses.push(`${err(e).code}: ${e.message}`) }
      }
      record.statusRead = states.length === scope.members.length ? 'available' : 'unavailable'
      if (record.statusRead === 'available') record.states = states
      record.evidence = evidence
      record.statuses = statuses; record.recordingIds = recordingIds
      return trialView(scope, record, statuses, recordingIds)
    },
    async disposeControlScopes() { disposed = true; for (const scope of scopes.values()) { await expireScope(scope, '插件已解除观察引用，不代表设备停止。') } },
  }
  function pinTrialUnknown(record, run) {
    if (!record.pinnedUnknown && run?.results.some(result => result.previousUnknown || result.unknown || result.submission === 'unknown' || result.controlEffect === 'unresolved')) record.pinnedUnknown = structuredClone(run)
  }
  async function refreshTrialUnknown(scope, record, statuses) {
    const original = record.pinnedUnknown
    if (!original) return
    const results = []
    for (let i = 0; i < original.results.length; i++) {
      const previous = original.results[i]
      if (previous.unknownSource !== 'transport' || previous.previousUnknown || !previous.operationId) { results.push(previous); continue }
      try {
        const operation = await scope.client.controlOperation(scope.instanceId, previous.operationId)
        if (operation.operationId !== previous.operationId || operation.action !== original.action) fail('invalid_response', '试验原操作编号或动作变化。')
        const next = project(scope, scope.members[i], operation)
        results.push(next.unknown || next.admission === 'finished' && next.submission === 'not_submitted' && next.controlEffect === 'not_attempted' ? next : previous)
      } catch (error) { results.push(previous); statuses.push(`原试验操作核对：${err(error).code}: ${error.message}`) }
    }
    if (record.pinnedUnknown !== original) return
    const value = { ...original, results, unknown: results.some(result => result.unknown || result.previousUnknown), newSubmission: false }
    if (value.unknown) record.pinnedUnknown = value
    else { record.pinnedUnknown = null; record.latest = value }
  }
  function initialTrialNotSubmitted(scope, record) {
    const run = record.latest
    return !record.pinnedUnknown && !record.evidence?.some(Boolean) && run?.action === 'trial_start' && run.unknown === false && run.results.length === scope.members.length && run.results.every((r, i) => r.operationId === record.memberIds[i] && Object.entries(target(scope.instanceId, scope.members[i].binding)).every(([key, value]) => r.target[key] === value) && r.admission === 'finished' && r.submission === 'not_submitted' && r.controlEffect === 'not_attempted' && r.unknown === false && !r.previousUnknown)
  }
  function completedReference(scope, record) {
    // Stop polling only a human-released reference with positive complete SDK evidence for every original member.
    return !record.pinnedUnknown && record.released === true && record.statusRead === 'available' && record.states?.length === scope.members.length && record.states.every(state => state === 'completed') && record.latest?.unknown === false && record.latest.results.length === scope.members.length && record.latest.results.every(result => !result.unknown && !result.previousUnknown && result.submission !== 'unknown' && result.controlEffect !== 'unresolved')
  }
  function trialView(scope, record, statuses = record.statuses ?? [], recordingIds = record.recordingIds ?? []) {
    const run = record.pinnedUnknown ?? record.latest ?? scope.latest
    const rejectedStart = initialTrialNotSubmitted(scope, record)
    const rejectionReason = '原启动操作已明确未提交；没有本次已启动试验可查询。' + (run.results.some(r => ['recording', 'recording_failed'].includes(r.error?.code)) ? '请核对服务记录目录的可用空间与写权限，并保留原错误。' : '请核对原错误和本次参数。') + `未自动重试；${scope.stopAvailable ? '固定原设备范围 Stop 仍独立可用。' : scope.stopReason ?? '原设备范围 Stop 当前不可用，请核对原范围。'}`
    if (rejectedStart) statuses = run.results.map(r => `${r.target.targetId} · ${r.phase ?? r.admission}${r.error ? ` · ${r.error.code}: ${r.error.message}` : ''}`)
    const value = { statusRead: rejectedStart ? 'not_read' : record.statusRead ?? 'not_read', statusReason: rejectedStart ? rejectionReason : record.statusRead === 'unavailable' ? '最近试验状态读取未完成；显示最后已知状态，原错误见进度。' : null, trialId: record.id, action: run.action, members: scope.members.map(m => target(scope.instanceId, m.binding)), mode: record.mode, referenceReleased: record.released === true, state: rejectedStart ? 'not_submitted' : record.states?.length ? [...new Set(record.states)].join(' / ') : run.results.map(r => r.admission).join(' / '), progress: statuses.length ? statuses : run.results.map(r => r.phase ?? r.admission), results: run.results.map((r, i) => ({ ...record.evidence?.[i], target: r.target, preparation: r.phase ?? r.admission, admission: r.admission, submission: r.submission, observation: r.observation, unknown: r.unknown, nativeJsonText: r.nativeJsonText, operationId: r.operationId, unknownSource: r.unknownSource, controlEffect: r.controlEffect })), unknown: run.unknown, stopAvailable: !rejectedStart && scope.stopAvailable, recordingIds, ...(typeof run.newSubmission === 'boolean' ? { newSubmission: run.newSubmission } : {}), ...(run.coalescedExisting ? { coalescedExisting: true } : {}) }
    if (!record.published || scope.trial?.trialId === record.id) {
      const previous = record.previousTrial
      scope.trial = rejectedStart && previous && (previous.unknown || ['unavailable', 'historical'].includes(previous.statusRead) || !['idle', 'completed', 'failed', 'not_submitted'].includes(previous.state)) ? previous : value
    }
    record.published = true
    return structuredClone(value)
  }
  return api
}
