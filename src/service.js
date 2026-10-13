import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { createIntegrationClient } from './integration.js'
import { createOwnerProcess } from './owner-process.js'
import { createEhaTool } from './eha-tool.js'
import { writeReport } from './reports.js'

const activeActions = ['status', 'measurements', 'diagnostics', 'config_startup', 'config_user']
const staleCodes = new Set(['instance_mismatch', 'binding_stale', 'identity_changed', 'not_found'])
const clone = value => structuredClone(value)
function requireSession(sessionId) { if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256) throw new TypeError('A trusted session ID is required') }
function requestFields(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => value[key] === undefined)) throw new TypeError('Invalid or unknown request fields')
}
function fail(code, message) { throw Object.assign(new Error(message), { code }) }
function errorDTO(error, action = null) { return { code: typeof error.code === 'string' ? error.code : typeof error.kind === 'string' ? error.kind : 'backend_error', message: error.message, action, ...(typeof error.unknown === 'boolean' ? { unknown: error.unknown } : {}), ...(error.controlEffect ? { controlEffect: clone(error.controlEffect) } : {}) } }
function publicIdentity(identity) { return identity ? { uid: identity.uid, runNonce: identity.run_nonce } : null }
function sameIdentity(a, b) { return a && b && a.uid === b.uid && a.runNonce === b.runNonce }

/** A plugin-owned instance shared by UI and tools; selection belongs to each DSH chat. */
export function createFieldkitService(config = {}, dependencies = {}) {
  const mode = config.deviceMode ?? 'service-v2'
  if (!['service-v2', 'integration', 'legacy-cli'].includes(mode)) throw new TypeError('deviceMode must be service-v2, integration or legacy-cli')
  const sessions = new Map(), bindings = new Map(), runs = new Map(), completions = new Map(), pendingRelease = new Set(), opening = new Set()
  const reportWriter = dependencies.reportWriter ?? writeReport
  let integration = dependencies.integration, disposed = false, disposal = null
  const stopRenewal = b => { if (b.renewTimer) (dependencies.clearRenewal ?? clearTimeout)(b.renewTimer); b.renewTimer = null }
  const invalidateOwner = () => {
    for (const b of bindings.values()) { b.expired = true; stopRenewal(b); pendingRelease.add(b); void releaseBinding(b, false) }
    for (const context of sessions.values()) { context.targets.clear(); context.instanceId = null; context.selectionRevision++ }
    for (const run of runs.values()) if (run.status === 'running') run.cancelled = true
  }
  const owner = mode === 'service-v2' ? createOwnerProcess(config, { ...dependencies.owner, onInvalidate: invalidateOwner }) : null
  const http = () => owner ? owner.client() : integration ??= createIntegrationClient({ endpoint: config.integrationUrl, tokenFile: config.integrationTokenFile })
  const command = async () => {
    const toolPath = owner ? (await owner.getSettings()).toolPath : config.toolPath
    if (!toolPath) throw new Error('Configure fieldkit.toolPath with the absolute public eha-tool executable path')
    return dependencies.cli ?? createEhaTool({ binaryPath: toolPath })
  }
  const session = sessionId => {
    if (disposed) fail('disposed', 'Fieldkit service is disposed')
    requireSession(sessionId)
    if (!sessions.has(sessionId)) sessions.set(sessionId, { selectedBindingId: null, targets: new Map(), instanceId: null, latestRunId: null, selectionRevision: 0 })
    return sessions.get(sessionId)
  }
  const bindingDTO = b => ({ bindingId: b.id, targetId: b.target.targetId, transport: b.target.transport, instanceId: b.owner?.instance_id ?? null, connectionGeneration: b.owner?.connection_generation ?? null, identity: b.owner ? publicIdentity(b.owner.identity) : null, expired: b.expired, observationWarnings: clone(b.observationWarnings ?? []) })
  const selected = (sessionId, bindingId, allowExpired = false) => {
    const context = session(sessionId), b = bindings.get(bindingId)
    if (!b || b.sessionId !== sessionId || context.selectedBindingId !== bindingId) fail('stale_selection', 'Request does not match the session selected binding')
    if (b.expired && !allowExpired) fail('binding_stale', 'The selected binding has expired; explicitly select again')
    return b
  }
  const getRun = (sessionId, readRunId) => {
    const context = session(sessionId), run = runs.get(readRunId ?? context.latestRunId)
    if (!run) { if (readRunId) fail('not_found', 'Read run is not registered in this session'); return null }
    if (run.sessionId !== sessionId) fail('forbidden', 'Read run belongs to another session')
    return run
  }
  const publicRun = run => { if (!run) return null; const { sessionId, cancelled, ...dto } = run; return clone(dto) }
  const expire = (b, error) => {
    if (staleCodes.has(error.code)) { b.expired = true; stopRenewal(b); void releaseBinding(b, false) }
    if (owner && ['instance_mismatch', 'service_unavailable', 'backend_error', 'sdk_timeout', 'credential_invalid'].includes(error.code)) invalidateOwner()
  }
  const runFor = b => [...runs.values()].find(r => r.bindingId === b.id && r.status === 'running')
  const releaseBinding = async (b, forget = true) => {
    if (!b) return null
    stopRenewal(b)
    if (b.released) { if (forget) bindings.delete(b.id); return null }
    if (runFor(b)) return null
    if (b.releaseRequest) { const result = await b.releaseRequest; if (forget && b.released) bindings.delete(b.id); return result }
    b.expired = true
    b.releaseRequest = (async () => {
      try {
        await b.renewal?.catch(() => {})
        if (mode !== 'legacy-cli') await (b.client ?? http()).detach(b.owner)
        b.released = true
        pendingRelease.delete(b)
        if (forget) bindings.delete(b.id)
        return null
      } catch (error) { pendingRelease.add(b); return errorDTO(error) }
    })()
    try { return await b.releaseRequest } finally { b.releaseRequest = null }
  }
  const scheduleRenewal = (b, delay = 30000) => {
    if (mode !== 'service-v2' || disposed || b.expired || b.released) return
    b.renewTimer = (dependencies.scheduleRenewal ?? setTimeout)(async () => {
      b.renewTimer = null
      if (disposed || b.expired || b.released) return
      const startedAt = performance.now()
      try { b.renewal = b.client.renew(b.owner); await b.renewal }
      catch (error) { b.expired = true; b.observationWarnings.push(errorDTO(error)); pendingRelease.add(b) }
      finally { b.renewal = null }
      if (b.expired || disposed) await releaseBinding(b, false)
      else scheduleRenewal(b, Math.max(0, 30000 - (performance.now() - startedAt)))
    }, delay)
    b.renewTimer.unref?.()
  }
  const trimRuns = () => {
    while (runs.size > 100) {
      const removable = [...runs].find(([, r]) => r.status !== 'running')
      if (!removable) break
      runs.delete(removable[0])
    }
  }
  const evidence = (action, value, origin) => ({ action, origin, receivedAt: new Date().toISOString(), identity: publicIdentity(value.identity), connectionGeneration: value.connection_generation, sourceTimestamp: value.source_timestamp ? { clock: value.source_timestamp.clock, value: value.source_timestamp.value } : null, receivedAgeMs: value.received_age_ms ?? value.telemetry_received_age_ms ?? null, nativeQuality: null, ...(value.control_effect ? { controlEffect: clone(value.control_effect), readPermit: clone(value.read_permit) } : {}), nativeJsonText: value.native_json_text, ...(action.startsWith('config_') ? { dataUtf8: value.data_utf8, dataHex: value.data_hex } : {}) })
  async function cachedSnapshot(b) {
    try {
      const value = await http().snapshot(b.owner)
      b.snapshot = { ...bindingDTO(b), ...(value.control_effect ? { controlEffect: clone(value.control_effect), readPermit: clone(value.read_permit) } : {}), readiness: { ready: value.readiness.ready, reasonCode: value.readiness.reason_code }, telemetryReceivedAgeMs: value.telemetry_received_age_ms, nativeJsonText: value.native_json_text, receivedAt: new Date().toISOString() }
      return value
    } catch (error) { expire(b, error); throw error }
  }
  const manage = async action => {
    if (disposed) fail('disposed', 'Fieldkit service is disposed')
    if (!owner) fail('unsupported', '服务管理仅在 service-v2 模式可用。')
    try { return await action(owner) }
    catch (error) { return { ...owner.snapshot(), error: { code: typeof error.code === 'string' ? error.code : 'service_unavailable', message: error.message } } }
  }
  const service = {
    serviceStatus() { return manage(o => o.status()) },
    saveServiceSettings(request) { return manage(o => o.save(request)) },
    startService() { return manage(o => o.start()) },
    attachService() { return manage(o => o.attach()) },
    shutdownService(request) { return manage(o => o.shutdown(request)) },
    async describe() {
      if (disposed) return { mode, readOnly: true, available: false, reason: 'Fieldkit service is disposed', protocol: null, instanceId: null, toolVersion: null }
      const base = { mode, readOnly: true, available: false, reason: null, protocol: mode === 'service-v2' ? 'eha-tool.service.v2' : mode === 'integration' ? 'eha-tool.integration.v1' : null, instanceId: null, toolVersion: null }
      if (mode === 'legacy-cli') return { ...base, available: !!config.toolPath, reason: config.toolPath ? 'Explicit legacy CLI mode: separate six-command snapshots, no persistent owner binding.' : 'Configure fieldkit.toolPath for legacy CLI mode.' }
      if (!owner && (!config.integrationUrl || !config.integrationTokenFile)) return { ...base, reason: 'Configure fieldkit.integrationUrl and fieldkit.integrationTokenFile.' }
      try {
        const value = owner ? (await owner.attach()).description : await http().describe()
        return { ...base, available: true, instanceId: value.instance_id, toolVersion: value.tool_version, capabilities: [...value.capabilities] }
      } catch (error) { return { ...base, reason: error.message } }
    },
    async listTargets(sessionId) {
      const context = session(sessionId)
      if (mode === 'legacy-cli') {
        const devices = await (await command()).devices()
        const identified = devices.filter(d => typeof d?.serial === 'string' && /^[!-~]{1,256}$/.test(d.serial))
        const targets = identified.map(d => ({ targetId: d.serial, label: d.description ?? d.serial, transport: 'usb', connected: false, identity: null, connectionGeneration: null, canAttach: false, canConnect: true }))
        context.targets = new Map(targets.map(t => [t.targetId, t]))
        const b = bindings.get(context.selectedBindingId)
        return { mode, instanceId: null, discoveryLimited: identified.length !== devices.length, discoveryReason: identified.length !== devices.length ? 'USB candidates without a full serial were omitted; they cannot be selected.' : null, targets, selectedBinding: b ? bindingDTO(b) : null }
      }
      const description = owner ? (await owner.attach()).description : await http().describe()
      if (owner && (!['binding_lease', 'binding_renew'].every(capability => description.capabilities.includes(capability)) || !(description.limits?.binding_lease_min_ms <= 120000 && description.limits?.binding_lease_max_ms >= 120000))) fail('unsupported', '请升级到支持观察租约与续约的 v2 eha-tool；不会回落到持久绑定。')
      const value = await http().targets(description.instance_id)
      if (context.instanceId && context.instanceId !== value.instance_id) for (const b of bindings.values()) if (b.sessionId === sessionId) b.expired = true
      context.instanceId = value.instance_id
      const targets = value.targets.map(t => ({ targetId: t.target_id, label: t.target_id, transport: t.transport, connected: t.connected, identity: publicIdentity(t.identity), connectionGeneration: t.connection_generation, canAttach: t.can_attach, canConnect: t.can_connect }))
      context.targets = new Map(targets.map(t => [t.targetId, t]))
      const b = bindings.get(context.selectedBindingId)
      return { mode, instanceId: value.instance_id, discoveryLimited: value.discovery_limited, discoveryReason: value.discovery_reason, targets, selectedBinding: b ? bindingDTO(b) : null }
    },
    async openTarget(sessionId, request) {
      let finishOpen
      const openDone = new Promise(resolve => { finishOpen = resolve })
      const earlierOpenings = [...opening]
      opening.add(openDone)
      try {
        requestFields(request, ['targetId', 'intent', 'expectedIdentity', 'connectionGeneration'], ['targetId', 'intent'])
        const context = session(sessionId), target = context.targets.get(request?.targetId)
        if (!target || !['attach', 'connect'].includes(request.intent)) fail('bad_request', 'Explicitly select a target from this session target list')
        if (request.intent === 'attach') requestFields(request.expectedIdentity, ['uid', 'runNonce'])
        if (request.intent === 'attach' && (!target.canAttach || request.connectionGeneration !== target.connectionGeneration || !sameIdentity(request.expectedIdentity, target.identity))) fail('identity_changed', 'Attach requires the exact displayed identity and connection generation')
        if (request.intent === 'connect' && (!target.canConnect || target.transport !== 'usb')) fail('bad_request', 'Only an explicitly selected USB candidate can connect')
        const revision = ++context.selectionRevision
        await Promise.all(earlierOpenings)
        if (disposed || revision !== context.selectionRevision) fail('stale_selection', 'A newer target selection replaced this request')
        const previous = bindings.get(context.selectedBindingId)
        const active = [...runs.values()].find(run => run.status === 'running')
        if (active) {
          if (active.bindingId !== previous?.id) fail('busy', 'A device diagnosis is already running in another session')
          active.cancelled = true
          await completions.get(active.readRunId).promise
        }
        const warnings = []
        for (const orphan of [...pendingRelease]) { const error = await releaseBinding(orphan); if (error) warnings.push(error) }
        const releaseError = await releaseBinding(previous)
        if (releaseError) warnings.push(releaseError)
        if (disposed || revision !== context.selectionRevision) fail('stale_selection', 'A newer target selection replaced this request')
        let owner = null
        const ownerClient = mode !== 'legacy-cli' ? http() : null
        if (ownerClient) owner = await ownerClient.bind({ instance_id: context.instanceId, target_id: target.targetId, intent: request.intent, ...(mode === 'service-v2' ? { lease_ms: 120000 } : {}), ...(request.intent === 'attach' ? { expected_identity: { uid: target.identity.uid, run_nonce: target.identity.runNonce }, connection_generation: target.connectionGeneration } : {}) })
        if (disposed || revision !== context.selectionRevision) { if (owner) await releaseBinding({ id: randomUUID(), owner, sessionId, client: ownerClient }); fail('stale_selection', 'A newer target selection replaced this request') }
        const b = { id: randomUUID(), sessionId, target: clone(target), owner, client: ownerClient, expired: false, snapshot: null, observationWarnings: warnings }
        bindings.set(b.id, b)
        context.selectedBindingId = b.id
        context.latestRunId = null
        scheduleRenewal(b)
        return bindingDTO(b)
      } finally { opening.delete(openDone); finishOpen() }
    },
    async getSnapshot(sessionId, request) {
      requestFields(request, ['bindingId']); const { bindingId } = request
      const b = selected(sessionId, bindingId), active = runFor(b)
      if (mode === 'legacy-cli') return { ...bindingDTO(b), readiness: null, telemetryReceivedAgeMs: null, nativeJsonText: null, receivedAt: null, readRun: publicRun(getRun(sessionId)) }
      if (!active || !b.snapshot) await cachedSnapshot(b)
      return { ...clone(b.snapshot), readRun: publicRun(active ?? getRun(sessionId)) }
    },
    async diagnose(sessionId, request, signal) {
      requestFields(request, ['bindingId']); const { bindingId } = request
      const b = selected(sessionId, bindingId), context = session(sessionId)
      const reportsDir = config.reportsDir || (owner ? (await owner.getSettings()).dataDir + '/reports' : null)
      if (b.expired) fail('binding_stale', 'Observation binding expired before diagnosis')
      if (!reportsDir || !isAbsolute(reportsDir)) throw new TypeError('Configure fieldkit.reportsDir with an absolute user-data path')
      if (opening.size || [...runs.values()].some(r => r.status === 'running')) fail('busy', 'A device diagnosis is already running')
      const run = { sessionId, cancelled: false, readRunId: randomUUID(), bindingId: b.id, targetId: b.target.targetId, mode, instanceId: b.owner?.instance_id ?? null, connectionGeneration: b.owner?.connection_generation ?? null, identity: b.owner ? publicIdentity(b.owner.identity) : null, status: 'running', phase: 'reading', step: 'connection_identity', complete: false, startedAt: new Date().toISOString(), endedAt: null, evidence: [], error: null, reports: null }
      let finish
      const promise = new Promise(resolve => { finish = resolve })
      completions.set(run.readRunId, { promise, finish })
      runs.set(run.readRunId, run); context.latestRunId = run.readRunId; trimRuns()
      try {
        if (mode === 'legacy-cli') {
          const result = await (await command()).diagnoseUsb(b.target.targetId, signal)
          run.serial = b.target.targetId; run.identity = result.identity
          run.evidence = result.evidence.map(item => ({ ...item, processError: item.error ? clone(item.error) : null, error: item.error ? { code: 'process_failed', message: item.error.message, action: item.action } : null }))
          run.complete = result.complete; run.error = result.error ? errorDTO(result.error, result.error.action ?? null) : null; run.step = result.evidence.at(-1)?.action ?? 'inspect'
        } else {
          const value = await cachedSnapshot(b)
          run.evidence.push(evidence('connection_identity', value, 'connection_identity'))
          if (!value.readiness.ready) fail('read_not_ready', `Owner read gate is not ready: ${value.readiness.reason_code ?? 'unknown'}`)
          for (const action of activeActions) {
            if (run.cancelled || signal?.aborted) fail('cancelled', 'Cancelled remaining read steps')
            if (b.expired) fail('binding_stale', 'Observation binding expired during diagnosis')
            run.step = action
            const value = await http().read(b.owner, action, signal)
            run.evidence.push(evidence(action, value, 'active_read'))
          }
          run.complete = true
        }
      } catch (error) {
        expire(b, error)
        run.error = errorDTO(error, run.step)
        if (typeof error.nativeErrorJsonText === 'string') run.evidence.push({ action: run.step, origin: 'owner_error', receivedAt: new Date().toISOString(), identity: run.identity, nativeJsonText: error.nativeErrorJsonText, error: clone(run.error) })
      }
      run.status = run.complete ? 'complete' : 'incomplete'; run.phase = 'saving'; run.endedAt = new Date().toISOString()
      try { run.reports = await reportWriter(reportsDir, publicRun(run)); run.phase = 'finished' }
      catch (error) { run.phase = 'report_failed'; run.reportError = { code: 'report_write_failed', message: error.message } }
      if (b.expired) await releaseBinding(b, false)
      else if (sessions.get(sessionId)?.selectedBindingId !== b.id) await releaseBinding(b)
      completions.get(run.readRunId).finish()
      completions.delete(run.readRunId)
      return publicRun(run)
    },
    async getReadRun(sessionId, request = {}) { requestFields(request, ['readRunId'], []); return publicRun(getRun(sessionId, request.readRunId)) },
    async cancelReadRun(sessionId, request) {
      requestFields(request, ['readRunId']); const { readRunId } = request
      const run = getRun(sessionId, readRunId)
      if (run.status === 'running') run.cancelled = true
      return publicRun(run)
    },
    async detachTarget(sessionId, request) {
      requestFields(request, ['bindingId']); const { bindingId } = request
      const b = selected(sessionId, bindingId, true)
      const active = runFor(b)
      if (active) { active.cancelled = true; await completions.get(active.readRunId).promise }
      const warning = await releaseBinding(b)
      b.observationWarnings = warning ? [warning] : []
      session(sessionId).selectedBindingId = null
      return bindingDTO(b)
    },
    async checkConfiguration(rawRecordText, signal) {
      const result = await (await command()).checkConfiguration(rawRecordText, signal)
      const missing = result.stderr?.match(/missing field [`']([^`']+)[`']/)
      const summary = result.exitCode === 0 && !result.error ? '离线配置校验通过；不代表运动或安装安全。' : missing ? `校验未通过：缺少必填字段 ${missing[1]}，请粘贴完整配置原文。` : '离线配置校验未通过；请查看 SDK 详情并修正完整配置原文。'
      return { ...result, summary, issues: result.stderr ? [result.stderr] : [] }
    },
    async dispose() {
      if (disposal) return disposal
      disposed = true
      for (const b of bindings.values()) stopRenewal(b)
      disposal = (async () => {
        for (const run of runs.values()) if (run.status === 'running') run.cancelled = true
        await Promise.all([...completions.values()].map(item => item.promise))
        await Promise.all([...opening])
        const warnings = []
        for (const b of new Set([...bindings.values(), ...pendingRelease])) { const error = await releaseBinding(b); if (error) warnings.push(error) }
        owner?.dispose()
        return { disposed: true, observationWarnings: warnings }
      })()
      return disposal
    },
    hasReport(sessionId, path) {
      if (typeof sessionId !== 'string' || !sessionId) return false
      return [...runs.values()].some(r => r.sessionId === sessionId && r.reports && Object.values(r.reports).includes(path))
    },
    selectedBinding(sessionId) {
      const context = session(sessionId), b = bindings.get(context.selectedBindingId)
      return b ? bindingDTO(b) : null
    },
  }
  return service
}
