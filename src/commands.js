const routes = Object.freeze({
  devices: ['GET', '/api/devices'],
  adapters: ['GET', '/api/adapters'],
  connections: ['GET', '/api/connections'],
  snapshot: ['GET', '/api/snapshot'],
  config_schema: ['GET', '/api/config/schema'],
  recordings: ['GET', '/api/recordings'],
  odrive_devices: ['GET', '/api/odrive/devices'],
  connection_save: ['POST', '/api/connections'],
  connection_delete: ['POST', '/api/connections/delete'],
  connect: ['POST', '/api/connect'],
  disconnect: ['POST', '/api/disconnect'],
  reconnect: ['POST', '/api/reconnect'],
  can_connect: ['POST', '/api/can/connect'],
  can_scan: ['POST', '/api/can/scan'],
  action: ['POST', '/api/action'],
  trial: ['POST', '/api/trial'],
  group: ['POST', '/api/group'],
  recording: ['POST', '/api/recording'],
  odrive_read: ['POST', '/api/odrive/read'],
})

const recordingFiles = new Set(['metadata.json', 'events.jsonl', 'telemetry.csv'])

function rawObject(text, command) {
  if (typeof text !== 'string' || !text.length) throw new TypeError(`${command} requires a JSON request body`)
  let value
  try { value = JSON.parse(text) } catch { throw new TypeError(`${command} body must be valid JSON`) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${command} body must be a JSON object`)
}

function emptyBody(text, command) {
  if (typeof text !== 'string' || text.length !== 0) throw new TypeError(`${command} does not accept a request body`)
}

function query(text, command) {
  if (typeof text !== 'string') throw new TypeError(`${command} queryText must be a URLSearchParams string`)
  try { return new URLSearchParams(text) } catch { throw new TypeError(`${command} queryText must be a URLSearchParams string`) }
}

/** Resolve a fixed official direct-api command without serialising request JSON again. */
export function resolveCommand(command, bodyText = '', queryText = '') {
  if (typeof command !== 'string' || !command.length || command.length > 64) throw new TypeError('Unknown command')
  if (command === 'recording_download') {
    emptyBody(bodyText, command)
    const parameters = query(queryText, command)
    if ([...parameters.keys()].some(key => key !== 'run' && key !== 'file') || parameters.getAll('run').length !== 1 || parameters.getAll('file').length !== 1) throw new TypeError('recording_download requires exactly run and file query parameters')
    const run = parameters.get('run'), file = parameters.get('file')
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(run) || !recordingFiles.has(file)) throw new TypeError('Invalid recording download query')
    return { command, method: 'GET', path: `/api/recordings/${encodeURIComponent(run)}/${file}` }
  }
  const route = routes[command]
  if (!route) throw new TypeError('Unknown command')
  const [method, basePath] = route
  const parameters = query(queryText, command)
  if (method === 'POST') {
    if ([...parameters].length) throw new TypeError(`${command} does not accept query parameters`)
    rawObject(bodyText, command)
  } else {
    emptyBody(bodyText, command)
    if (command !== 'snapshot' && [...parameters].length) throw new TypeError(`${command} does not accept query parameters`)
  }
  const suffix = method === 'GET' && queryText ? `?${queryText}` : ''
  return { command, method, path: `${basePath}${suffix}` }
}

export const directCommands = Object.freeze([...Object.keys(routes), 'recording_download'])

/** Static direct-api DTO catalogue for both the model tool and the workbench. It does not cause I/O. */
export const directCommandGuide = Object.freeze([
  { command: 'devices', method: 'GET', body: '', query: '', note: 'List USB devices.' },
  { command: 'adapters', method: 'GET', body: '', query: '', note: 'List CAN adapters.' },
  { command: 'connections', method: 'GET', body: '', query: '', note: 'List saved connection profiles and current connections.' },
  { command: 'snapshot', method: 'GET', body: '', query: 'transport=usb | transport=can&node=0..127 [&after=<u64>]', note: 'Read one selected session snapshot.' },
  { command: 'config_schema', method: 'GET', body: '', query: '', note: 'Read official configuration schema.' },
  { command: 'recordings', method: 'GET', body: '', query: '', note: 'List recording runs.' },
  { command: 'recording_download', method: 'GET', body: '', query: 'run=<run-id>&file=metadata.json|events.jsonl|telemetry.csv', note: 'Download one fixed recording file.' },
  { command: 'odrive_devices', method: 'GET', body: '', query: '', note: 'List ODrive USB devices.' },
  { command: 'connection_save', method: 'POST', body: '{"profile":{"id":"...","name":"...","adapter":{"kind":"canable2","serial":"..."},"node":0,"mode":"fd","autoconnect":false,"default":false}}', query: '', note: 'Save a managed CAN connection profile.' },
  { command: 'connection_delete', method: 'POST', body: '{"id":"profile-id"}', query: '', note: 'Delete a saved connection profile.' },
  { command: 'connect', method: 'POST', body: '{"transport":"usb","serial":"..."} | {"transport":"can","channel":"...","node":0,"mode":"classic|fd","python":null}', query: '', note: 'Connect one USB or CAN session; profile_id or managed forms are also official connect inputs.' },
  { command: 'disconnect', method: 'POST', body: '{"transport":"usb"} | {"transport":"can","node":0}', query: '', note: 'Disconnect one session.' },
  { command: 'reconnect', method: 'POST', body: '{"transport":"usb"} | {"transport":"can","node":0}', query: '', note: 'Reconnect one session.' },
  { command: 'can_connect', method: 'POST', body: '{"channel":"...","mode":"classic|fd","python":null,"nodes":[0]}', query: '', note: 'Connect one or more nodes through an existing python-can context.' },
  { command: 'can_scan', method: 'POST', body: '{"channel":"...","mode":"classic|fd","python":null,"start_node":0,"end_node":127}', query: '', note: 'Start a CAN scan range.' },
  { command: 'action', method: 'POST', body: '{"transport":"usb","action":"status|measurements|diagnostics|telemetry|heartbeat_start|heartbeat_stop|heartbeat_once|stop|config_read|config_validate|config_save_and_restart|restore_factory_and_restart|reset_application|enter_update"} | {"transport":"can","node":0,"action":"position|velocity|force|impedance",...}', query: '', note: 'For position use mm; velocity mm_s; force n; impedance equilibrium_mm, stiffness_n_per_mm, damping_ns_per_mm; config_read adds view; config_validate/config_save_and_restart add record.' },
  { command: 'trial', method: 'POST', body: '{"transport":"usb|can","node":0,"action":"start|stop|target","trial":{"command":<action-body>,"envelope":{"position_min_mm":0,"position_max_mm":0,"velocity_abs_max_mm_s":0,"force_abs_max_n":0,"stiffness_max_n_per_mm":0,"damping_max_ns_per_mm":0,"duration_max_s":0},"duration_s":0,"reach":{"tolerance_mm":0,"settle_ms":0}|null},"mm":0}', query: '', note: 'start uses trial; target uses mm; stop has no trial.' },
  { command: 'group', method: 'POST', body: '{"action":"trial_start|stop|heartbeat_start|heartbeat_stop","nodes":[0],"trial":<trial-request>}', query: '', note: 'trial_start uses trial and nodes; stop may omit nodes.' },
  { command: 'recording', method: 'POST', body: '{"transport":"usb|can","node":0,"action":"start|stop"}', query: '', note: 'Start or stop recording for one session.' },
  { command: 'odrive_read', method: 'POST', body: '{"serial":"..."}', query: '', note: 'Read one explicitly selected ODrive USB serial.' },
])
