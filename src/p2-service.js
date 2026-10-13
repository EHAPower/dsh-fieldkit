const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }
const fields = (v, keys) => { if (!v || typeof v !== 'object' || Object.keys(v).some(k => !keys.includes(k)) || keys.some(k => v[k] === undefined)) fail('bad_request', 'Invalid request fields') }
const boundedText = (value, max) => typeof value === 'string' && value.trim().length > 0 && !value.includes('\0') && Buffer.byteLength(value) <= max
function nodes(value) { if (!Array.isArray(value) || !value.length || value.length > 16 || new Set(value).size !== value.length || value.some(n => !Number.isInteger(n) || n < 0 || n > 127)) fail('bad_request', '扫描或连接需 1–16 个不重复的 0–127 节点。') }
function advanced(value) { fields(value, ['channel', 'mode', 'python']); if (!boundedText(value.channel, 1024) || !['classic', 'fd'].includes(value.mode) || !(value.python === null || boundedText(value.python, 4096))) fail('bad_request', '高级 CAN 需命名配置 context、classic/fd 和明确的 Python 覆盖或 null。') }
const same = (a, b) => a && b && a.connectionId === b.connectionId && a.connectionGeneration === b.connectionGeneration && (a.identity === null && b.identity === null || a.identity && b.identity && a.identity.uid === b.identity.uid && a.identity.runNonce === b.identity.runNonce)
const remember = (map, key, value) => { map.set(key, value); if (map.size > 64) map.delete(map.keys().next().value) }
/** Session registries authorize opaque IDs; callers never supply paths or backend routes. */
export function createP2Service({ mode, session, attach, http, invalidateConnection }) {
  const contexts = new Map()
  async function ready(sessionId, capability) {
    session(sessionId)
    if (mode !== 'service-v2') fail('unsupported', '此功能需要 service-v2。')
    const description = await attach()
    if (!description.capabilities.includes(capability)) fail('unsupported', `服务未发布 ${capability}；请升级 eha-tool。`)
    let c = contexts.get(sessionId)
    if (!c || c.instanceId !== description.instance_id) { c = { instanceId: description.instance_id, client: http(), jobs: new Map(), scans: new Map(), recordings: new Map(), profiles: new Map(), connections: new Map() }; contexts.set(sessionId, c) }
    c.capabilities = description.capabilities
    return c
  }
  function profileAllowed(c) { if (c.profileError) fail('invalid_profiles', `档案加载或名称空间冲突：${c.profileError}`) }
  function registered(map, id) { const v = map.get(id); if (!v) fail('not_found', '请先在当前对话刷新并明确选择已列举项目。'); return v }
  function track(c, value) { remember(c.jobs, value.jobId, value.kind); collect(c, value); return value }
  function keepConnection(c, value) { c.connections.set(value.connectionId, value); if (value.profileJobId) remember(c.jobs, value.profileJobId, 'profileSave'); return value }
  function connectionResult(c, value) { return value.jobId ? track(c, value) : keepConnection(c, value) }
  function keepScan(c, value) { remember(c.scans, value.scanId, value); return value }
  function collect(c, value) {
    if (value.recordings) c.recordings = new Map(value.recordings.map(r => [r.id, r]))
    if (value.connection) keepConnection(c, value.connection)
    if (value.batch) value.batch.connections.forEach(connection => keepConnection(c, connection))
    if (value.profile) c.profiles.set(value.profile.id, value.profile)
    if (value.deletedId) c.profiles.delete(value.deletedId)
    return value
  }
  async function start(s, capability, method) { const c = await ready(s, capability); return track(c, await c.client[method](c.instanceId)) }
  return {
    async listProfiles(s) { const c = await ready(s, 'managed_profiles'); const v = await c.client.profiles(c.instanceId); c.profiles = new Map(v.profiles.map(p => [p.id, p])); c.profileError = v.loadError; return v },
    async saveProfile(s, p) {
      const usb = p?.transport === 'usb'
      if (usb) fields(p, ['transport', 'id', 'name', 'serial', 'expectedUid'])
      else { const { transport, ...rest } = p ?? {}; if (transport !== undefined && transport !== 'can') fail('bad_request', '未知档案类型。'); fields(rest, ['id', 'name', 'adapter', 'node', 'mode', 'expectedUid']); fields(p.adapter, ['kind', 'serial']) }
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(p.id) || !boundedText(p.name, 256) || !(p.expectedUid === null || typeof p.expectedUid === 'string' && /^[a-fA-F0-9]{24}$/.test(p.expectedUid))) fail('bad_request', '档案需稳定 ID、名称及完整 UID 或 null。')
      if (usb ? !boundedText(p.serial, 1024) : p.adapter.kind !== 'canable2' || !boundedText(p.adapter.serial, 1024) || !Number.isInteger(p.node) || p.node < 0 || p.node > 127 || p.mode !== 'fd') fail('bad_request', 'USB 需完整序列号；受管 CAN 需 CANable2 序列号、0–127 节点及 fd。')
      const c = await ready(s, usb ? 'usb_profiles' : 'managed_profiles'); return track(c, await c.client.saveProfile(c.instanceId, p))
    },
    async deleteProfile(s, profileId) { const c = await ready(s, 'managed_profiles'); profileAllowed(c); registered(c.profiles, profileId); return track(c, await c.client.deleteProfile(c.instanceId, profileId)) },
    listAdapters(s) { return start(s, 'adapter_discovery', 'adapters') },
    listRecordings(s) { return start(s, 'recordings_read', 'recordings') },
    listOdriveDevices(s) { return start(s, 'odrive_read', 'odriveDevices') },
    async readOdrive(s, serial) { if (typeof serial !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(serial)) fail('bad_request', '需要完整 ODrive 序列号。'); const c = await ready(s, 'odrive_read'); return track(c, await c.client.odriveRead(c.instanceId, serial)) },
    async getJob(s, jobId) { const c = await ready(s, 'read_jobs'); return collect(c, await c.client.readJob(c.instanceId, jobId, registered(c.jobs, jobId))) },
    async downloadRecording(s, r) { fields(r, ['runId', 'file', 'offset']); const c = await ready(s, 'recordings_read'); const record = registered(c.recordings, r.runId); if (!record.files.includes(r.file)) fail('bad_request', '文件未由服务列举。'); return track(c, await c.client.recordingChunk(c.instanceId, r)) },
    async listConnections(s) { const c = await ready(s, 'connections'); const values = await c.client.connections(c.instanceId); c.connections = new Map(); values.forEach(v => keepConnection(c, v)); return { connections: values } },
    async connectProfile(s, profileId) { const c = await ready(s, 'connections'); profileAllowed(c); const p = registered(c.profiles, profileId); if (p.transport === 'usb' && !c.capabilities.includes('usb_profiles')) fail('unsupported', '服务未发布 USB 档案能力。'); return connectionResult(c, await c.client.connectProfile(c.instanceId, profileId)) },
    async changeConnection(s, request) {
      fields(request, ['connectionId', 'connectionGeneration', 'identity', 'action']); if (request.identity !== null) fields(request.identity, ['uid', 'runNonce'])
      if (!['disconnect', 'reconnect'].includes(request.action)) fail('bad_request', '未知连接动作。')
      const c = await ready(s, 'connections'), previous = registered(c.connections, request.connectionId)
      if (!same(previous, request) || (request.identity === null && request.action !== 'reconnect')) fail('identity_changed', '连接身份或代次已变化；请刷新。')
      try { const v = await c.client.changeConnection(c.instanceId, previous, request.action); return keepConnection(c, v) }
      finally { invalidateConnection(previous.targetId) }
    },
    async startScan(s, request) {
      fields(request, ['connectionId', 'connectionGeneration', 'identity', 'nodes']); fields(request.identity, ['uid', 'runNonce'])
      const c = await ready(s, 'can_scan'), connection = registered(c.connections, request.connectionId)
      if (!same(connection, request) || !connection.connected || !connection.identity || !connection.targetId.startsWith('can:')) fail('identity_changed', '扫描需当前已连接的 CAN 身份和代次。')
      nodes(request.nodes)
      return keepScan(c, await c.client.scan(c.instanceId, connection, request.nodes))
    },
    async getScan(s, scanId) { const c = await ready(s, 'can_scan'); registered(c.scans, scanId); return keepScan(c, await c.client.readScan(c.instanceId, scanId)) },
    async connectAdvanced(s, request) {
      fields(request, ['channel', 'mode', 'python', 'node']); const { node, ...input } = request; advanced(input); nodes([node])
      const c = await ready(s, 'advanced_can'); return connectionResult(c, await c.client.connectAdvanced(c.instanceId, request))
    },
    async scanAdvanced(s, request) {
      fields(request, ['advanced', 'nodes']); advanced(request.advanced); nodes(request.nodes)
      const c = await ready(s, 'advanced_can'); return keepScan(c, await c.client.scanAdvanced(c.instanceId, request))
    },
    async scanProfile(s, request) {
      fields(request, ['profileId', 'nodes']); nodes(request.nodes)
      const c = await ready(s, 'can_scan'); profileAllowed(c); const p = registered(c.profiles, request.profileId)
      if (p.transport === 'usb') fail('bad_request', 'CAN 扫描不能使用 USB 档案。')
      return keepScan(c, await c.client.scanProfile(c.instanceId, request))
    },
    async connectScannedNodes(s, request) {
      fields(request, ['scanId', 'nodes']); nodes(request.nodes)
      const c = await ready(s, 'selected_node_connections'), scan = registered(c.scans, request.scanId)
      if (scan.state !== 'completed' || request.nodes.some(node => !scan.nodes.some(found => found.node === node))) fail('bad_request', '只能选择当前对话已完成扫描中核对成功的节点。')
      return track(c, await c.client.connectScannedNodes(c.instanceId, request))
    },
    async getEvents(s, after) { const c = await ready(s, 'events'); return c.client.events(c.instanceId, after) },
  }
}
