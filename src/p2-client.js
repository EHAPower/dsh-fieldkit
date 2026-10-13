// Fixed authenticated v2 routes only. Opaque native texts never become business input.
const files = new Set(['metadata.json', 'events.jsonl', 'telemetry.csv'])
const decimal = v => typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v) && v.length <= 20 && BigInt(v) <= 18446744073709551615n
const check = (ok, message) => { if (!ok) throw Object.assign(new Error(message), { code: 'invalid_response' }) }
const id = v => { check(typeof v === 'string' && v.length > 0 && v.length <= 256, 'Invalid identifier'); return encodeURIComponent(v) }
const identity = v => { check(v && /^[a-f0-9]{24}$/.test(v.uid) && /^[a-f0-9]{32}$/.test(v.run_nonce), 'Invalid identity'); return { uid: v.uid, runNonce: v.run_nonce } }
const context = v => { check(decimal(v.connection_generation), 'Invalid connection generation'); return { targetId: v.target_id, identity: v.identity === null ? null : identity(v.identity), connectionGeneration: v.connection_generation } }
const connection = v => { check(typeof v.connected === 'boolean' && typeof v.snapshot_json_text === 'string', 'Invalid connection'); return { ...context(v), connectionId: v.connection_id, connected: v.connected, snapshotJsonText: v.snapshot_json_text, telemetryReceivedAgeMs: v.telemetry_received_age_ms ?? null, profileJobId: v.profile_job_id ?? null } }
const profile = v => v.transport === 'usb'
  ? { transport: 'usb', id: v.id, name: v.name, serial: v.serial, expectedUid: v.expected_uid }
  : { transport: 'can', id: v.id, name: v.name, adapter: { kind: v.adapter.kind, serial: v.adapter.serial }, node: v.node, mode: v.mode, expectedUid: v.expected_uid }
const profileInput = p => p.transport === 'usb'
  ? { transport: 'usb', id: p.id, name: p.name, serial: p.serial, expected_uid: p.expectedUid }
  : { transport: 'can', id: p.id, name: p.name, adapter: p.adapter, node: p.node, mode: p.mode, expected_uid: p.expectedUid }
const job = (v, kind) => {
  check(['queued', 'running', 'completed', 'failed'].includes(v.state) && typeof v.job_id === 'string' && (v.error === null || typeof v.error === 'string'), 'Invalid read job')
  const result = { jobId: v.job_id, kind, state: v.state, error: v.error }
  const d = v.data
  if (v.state === 'completed') {
    check(d && typeof d === 'object', 'Completed job missing data')
    if (kind === 'adapters') result.adapters = d.adapters.map(a => ({ kind: a.kind, serial: a.serial, description: a.description, vid: a.vid, pid: a.pid }))
    if (kind === 'recordings') { result.recordings = d.runs.map(r => ({ id: r.id, metadataJsonText: r.metadata_json_text, files: r.files.filter(f => files.has(f)) })); result.truncated = d.truncated }
    if (kind === 'download') {
      check(files.has(d.file) && decimal(d.offset) && decimal(d.next_offset) && typeof d.eof === 'boolean' && typeof d.content_base64 === 'string' && d.content_base64.length <= 87384 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(d.content_base64), 'Invalid recording chunk')
      result.download = { runId: d.run_id, file: d.file, offset: d.offset, nextOffset: d.next_offset, eof: d.eof, contentBase64: d.content_base64 }
    }
    if (kind === 'odriveDevices' || kind === 'odriveRead') { check(d.source === 'odrive_usb' && typeof d.native_json_text === 'string', 'Invalid ODrive source'); result.nativeJsonText = d.native_json_text }
    if (kind === 'connect') result.connection = connection(d.connection)
    if (kind === 'batchConnect') result.batch = { connections: d.connections.map(connection), errors: d.errors.map(e => ({ node: e.node, targetId: e.target_id, code: e.code, message: e.message, unknown: e.unknown, errorJsonText: e.error_json_text })) }
    if (kind === 'profileSave') result.profile = profile(d.profile)
    if (kind === 'profileDelete') result.deletedId = d.id
  }
  return result
}
export function createP2Client(request) {
  const get = (path, instanceId) => request(path, { instanceId })
  const post = (path, instanceId, body, method = 'POST') => request(path, { method, instanceId, body: { instance_id: instanceId, ...body } })
  const gate = c => ({ expected_identity: c.identity === null ? null : { uid: c.identity.uid, run_nonce: c.identity.runNonce }, connection_generation: c.connectionGeneration })
  return {
    async profiles(instanceId) { const v = await get('/profiles', instanceId); return { profiles: v.profiles.map(profile), loadError: v.load_error, busy: v.busy } },
    async saveProfile(instanceId, p) { return job(await post('/profiles', instanceId, { profile: profileInput(p) }), 'profileSave') },
    async deleteProfile(instanceId, profileId) { return job(await post(`/profiles/${id(profileId)}`, instanceId, {}, 'DELETE'), 'profileDelete') },
    async adapters(instanceId) { return job(await get('/adapters', instanceId), 'adapters') },
    async recordings(instanceId) { return job(await get('/recordings', instanceId), 'recordings') },
    async recordingChunk(instanceId, r) { check(files.has(r.file) && decimal(r.offset), 'Invalid recording download request'); return job(await get(`/recordings/${id(r.runId)}?file=${encodeURIComponent(r.file)}&offset=${r.offset}`, instanceId), 'download') },
    async odriveDevices(instanceId) { return job(await get('/odrive/devices', instanceId), 'odriveDevices') },
    async odriveRead(instanceId, serial) { return job(await post('/odrive/read', instanceId, { serial }), 'odriveRead') },
    async readJob(instanceId, jobId, kind) { const v = job(await get(`/jobs/${id(jobId)}`, instanceId), kind); check(v.jobId === jobId, 'Read job identity mismatch'); return v },
    async connections(instanceId) { return (await get('/connections', instanceId)).connections.map(connection) },
    async connectProfile(instanceId, profileId) { const v = await post('/connections', instanceId, { profile_id: profileId }); return v.job_id ? job(v, 'connect') : connection(v) },
    async connectAdvanced(instanceId, value) { const { node, ...advanced } = value; return job(await post('/connections', instanceId, { transport: 'can', advanced, node }), 'connect') },
    async scanAdvanced(instanceId, value) { return scan(await post('/scans', instanceId, { advanced: value.advanced, nodes: value.nodes })) },
    async scanProfile(instanceId, value) { return scan(await post('/scans', instanceId, { profile_id: value.profileId, nodes: value.nodes })) },
    async connectScannedNodes(instanceId, value) { return job(await post('/connections/batch', instanceId, { scan_id: value.scanId, nodes: value.nodes }), 'batchConnect') },
    async changeConnection(instanceId, c, action) { check(['reconnect', 'disconnect'].includes(action), 'Invalid connection action'); return connection(await post(`/connections/${id(c.connectionId)}/${action}`, instanceId, gate(c))) },
    async scan(instanceId, c, nodes) { return scan(await post('/scans', instanceId, { connection_id: c.connectionId, ...gate(c), nodes })) },
    async readScan(instanceId, scanId) { const value = scan(await get(`/scans/${id(scanId)}`, instanceId)); check(value.scanId === scanId, 'Scan identity mismatch'); return value },
    async events(instanceId, after) {
      check(decimal(after), 'Invalid event cursor')
      const v = await get(`/events?after=${after}&limit=100`, instanceId)
      check(decimal(v.cursor) && Array.isArray(v.events) && v.events.length <= 100, 'Invalid event batch')
      return { cursor: v.cursor, gap: v.gap, gapReasons: v.gap_reasons, lostRanges: v.lost_ranges.map(r => ({ firstCursor: r.first_cursor, lastCursor: r.last_cursor, count: r.count })), truncated: v.truncated, events: v.events.map(e => {
        check(decimal(e.cursor) && decimal(e.received_at) && decimal(e.source_timestamp?.value), 'Invalid event timestamps')
        const p = e.payload
        return { cursor: e.cursor, kind: e.kind, sourceId: e.source_id, sourceTimestamp: e.source_timestamp, receivedAt: e.received_at, gap: e.gap, sourceGap: e.source_gap, ...(p.target_id ? context(p) : {}), ...(typeof p.connected === 'boolean' ? { connected: p.connected } : {}), ...(typeof p.native_json_text === 'string' ? { nativeJsonText: p.native_json_text } : {}), ...(p.scan_id ? { scanId: p.scan_id } : {}), ...(p.job_id ? { jobId: p.job_id } : {}), ...(p.state ? { state: p.state } : {}) }
      }) }
    },
  }
}
function scan(v) { return { scanId: v.scan_id, state: v.state, nodes: v.nodes.map(n => ({ node: n.node, identity: identity(n.identity) })), errors: v.errors.map(e => ({ node: e.node, message: e.message, unknown: e.unknown, errorJsonText: e.error_json_text })) } }
