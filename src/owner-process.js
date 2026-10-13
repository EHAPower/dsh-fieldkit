import { spawn, execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, normalize, parse } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createIntegrationClient } from './integration.js'

const fields = ['toolPath', 'port', 'dataDir', 'runsDir', 'odrivePython']
const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }
export function userDataDirectory(env = process.env, platform = process.platform, home = homedir()) {
  const base = env.XDG_DATA_HOME || (platform === 'darwin' ? join(home, 'Library', 'Application Support') : join(home, '.local', 'share'))
  validPath(base)
  return join(base, 'ehapower', 'dsh-fieldkit')
}
function validPath(value, optional = false) {
  if (optional && value === '') return
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0') || normalize(value) !== value || value === parse(value).root) throw new TypeError('路径须为无跳转的绝对路径；可选路径可留空。')
}
function settings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !fields.includes(k))) throw new TypeError('设置含未知字段。')
  for (const key of fields.filter(k => k !== 'port')) validPath(value[key], key !== 'dataDir')
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new TypeError('端口须为 1–65535 的整数。')
  return Object.fromEntries(fields.map(k => [k, value[k]]))
}
async function privateDirectory(path) {
  validPath(path)
  const parent = dirname(path)
  if (parent !== parse(path).root) {
    try {
      const info = await lstat(parent)
      if (!info.isDirectory() || info.isSymbolicLink()) fail('unsafe_path', '数据路径包含符号链接或非目录。')
    } catch (error) { if (error.code !== 'ENOENT') throw error; await privateDirectory(parent) }
  }
  // Check every existing ancestor; do not follow directory symlinks.
  for (let p = parent; p !== parse(p).root; p = dirname(p)) {
    const info = await lstat(p)
    const uid = process.getuid?.()
    const foreignOwner = uid !== undefined && info.uid !== uid && info.uid !== 0
    const unsafeWrite = (info.mode & 0o022) && !(info.uid === 0 && (info.mode & 0o1000))
    if (!info.isDirectory() || info.isSymbolicLink() || foreignOwner || unsafeWrite) fail('unsafe_path', '数据目录祖先须属于当前用户或 root，且不可被其他用户修改；仅 root 的 sticky 目录允许公共写入。')
  }
  await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error })
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o7777) !== 0o700 || (process.getuid && info.uid !== process.getuid())) fail('unsafe_path', '数据目录须由当前用户拥有且权限为 0700；请选用私有目录。')
}
async function readPrivate(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o7777) !== 0o600 || (process.getuid && info.uid !== process.getuid()) || info.size > 16384) fail('unsafe_file', '服务文件须为当前用户的 0600 普通单链接文件。')
    const buffer = Buffer.alloc(16385)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead > 16384) fail('unsafe_file', '服务文件过大。')
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))
  } finally { await file.close() }
}

/** Human-only local lifecycle. No device commands and no process kill on disposal. */
export function createOwnerProcess(config = {}, dependencies = {}) {
  const root = dependencies.settingsRoot ?? userDataDirectory()
  const configFile = join(root, 'settings.json')
  const defaults = settings({ toolPath: config.toolPath ?? '', port: config.servicePort ?? 18080, dataDir: config.serviceDataDir || join(root, 'service'), runsDir: config.runsDir ?? '', odrivePython: config.odrivePython ?? '' })
  let configured = null, attached = null, queue = Promise.resolve(), disposed = false, startUnresolved = false
  const serial = fn => { const task = queue.then(() => { if (disposed) fail('disposed', '插件已卸载。'); return fn() }); queue = task.catch(() => {}); return task }
  const invalidate = () => { attached = null; dependencies.onInvalidate?.() }
  const load = async () => {
    if (configured) return configured
    await privateDirectory(root)
    try { configured = settings(await readPrivate(configFile)) }
    catch (error) {
      if (error.code !== 'ENOENT') throw error
      configured = { ...defaults }
    }
    return configured
  }
  const paths = value => ({ instanceFile: join(value.dataDir, `port-${value.port}.json`), tokenFile: join(value.dataDir, `port-${value.port}.token`) })
  const connect = async () => {
    const value = await load()
    await privateDirectory(value.dataDir)
    const expected = paths(value)
    let record
    try { record = await readPrivate(expected.instanceFile) }
    catch (error) { if (error.code === 'ENOENT') fail('service_missing', '未发现服务；请检查设置后点击“启动服务”。'); throw error }
    if (record.protocol !== 'eha-tool.service.v2' || record.api_version !== 2 || typeof record.instance_id !== 'string' || !record.instance_id || !/^[1-9][0-9]*$/.test(record.pid) || !/^[0-9]+$/.test(record.started_at_unix_ms) || typeof record.pid !== 'string' || typeof record.started_at_unix_ms !== 'string') fail('protocol_mismatch', '发现记录不是受支持的 v2；请升级 eha-tool 或显式使用兼容模式。')
    if (record.endpoint !== `http://127.0.0.1:${value.port}` || record.token_file !== expected.tokenFile) fail('instance_mismatch', '发现记录的端点或凭据位置与配置不同；请核对端口和私有数据目录。')
    const client = (dependencies.createClient ?? createIntegrationClient)({ endpoint: record.endpoint, tokenFile: expected.tokenFile, apiVersion: 2 })
    const description = await client.describe()
    if (description.instance_id !== record.instance_id || description.tool_version !== record.tool_version || !['instance_status', 'service_shutdown'].every(c => description.capabilities.includes(c))) fail('instance_mismatch', '认证后的服务实例或版本与发现记录不同；请重新发现。')
    const summary = await client.instance(record.instance_id)
    if (summary.endpoint !== record.endpoint || summary.pid !== record.pid || summary.started_at_unix_ms !== record.started_at_unix_ms || summary.tool_version !== record.tool_version || summary.service_state !== 'running') fail('instance_mismatch', '服务概要与发现记录不同或服务正在退出；请重新发现。')
    if (attached && attached.description.instance_id !== description.instance_id) invalidate()
    attached = { client, description, summary }; startUnresolved = false
    return status()
  }
  const status = () => ({ settings: { ...(configured ?? defaults) }, attached: !!attached, description: attached?.description ?? null, instance: attached?.summary ?? null, error: null })
  const discover = async () => { try { return await connect() } catch (error) { invalidate(); return { ...status(), error: { code: error.code ?? 'service_unavailable', message: error.code === 'credential_invalid' ? '凭据无效；请检查私有目录和 0600 凭据文件，勿覆盖运行中服务凭据。' : error.message } } } }
  return {
    snapshot: status,
    status: () => serial(async () => { await load(); return discover() }),
    attach: () => serial(async () => { try { return await connect() } catch (error) { invalidate(); throw error } }),
    getSettings: () => serial(load),
    save: request => serial(async () => {
      const next = settings(request)
      await load(); await privateDirectory(next.dataDir)
      const temp = join(root, `settings-${randomUUID()}.tmp`)
      const file = await open(temp, 'wx', 0o600)
      try { await file.writeFile(JSON.stringify(next) + '\n'); await file.sync() } finally { await file.close() }
      try { await rename(temp, configFile) } catch (error) { await unlink(temp); throw error }
      configured = next; invalidate()
      return status()
    }),
    start: () => serial(async () => {
      const value = await load()
      if (!value.toolPath) fail('tool_missing', '请先设置 eha-tool 可执行文件的绝对路径。')
      const existing = await discover()
      if (existing.attached) return existing
      // Only absence permits starting: never overwrite a stale, foreign, or unauthenticated record.
      if (existing.error?.code !== 'service_missing') fail('start_blocked', '已有服务记录无法认证；请检查进程、端口、版本和私有目录后人工处理。不会覆盖或终止现有实例。')
      if (startUnresolved) fail('start_unknown', '上次启动结果仍未知；请先发现服务并人工核对进程和端口，不重复启动。')
      // Probe only help with bounded output; the independent service must not inherit a DSH stderr pipe.
      await new Promise((resolve, reject) => {
        const done = (error, _stdout, stderr = '') => {
          if (!error) return resolve()
          const unsupported = /(?:unrecognized subcommand|unexpected argument)[^\n]*[\x22'`]serve[\x22'`]/i.test(String(stderr).slice(0, 65536))
          const exit = Number.isInteger(error.code) ? `（退出码 ${error.code}）` : ''
          reject(Object.assign(new Error(unsupported ? '此 eha-tool 不支持 serve；请配置支持 /service/v2 的新版 eha-tool。' : `工具启动预检失败${exit}；请检查可执行路径、执行权限和版本。`), { code: unsupported ? 'tool_version_unsupported' : 'start_failed' }))
        }
        try { (dependencies.execFileImpl ?? execFile)(value.toolPath, ['serve', '--help'], { shell: false, encoding: 'utf8', maxBuffer: 65536, timeout: 5000, windowsHide: true }, done) }
        catch { done({ code: null }) }
      })
      const { instanceFile, tokenFile } = paths(value)
      const args = ['serve', '--port', String(value.port), '--token-file', tokenFile, '--instance-file', instanceFile]
      if (value.runsDir) args.push('--runs-dir', value.runsDir)
      if (value.odrivePython) args.push('--odrive-python', value.odrivePython)
      startUnresolved = true
      let readyInstance
      await new Promise((resolve, reject) => {
        let child, buffer = '', settled = false
        const finish = (error) => {
          if (settled) return; settled = true; clearTimeout(timer)
          child?.stdout?.destroy(); child?.unref()
          if (error) { if (error.code === 'start_failed') startUnresolved = false; reject(error) } else resolve()
        }
        const timer = setTimeout(() => finish(Object.assign(new Error('启动等待超时；结果未知，请点击发现服务核对，不自动重试。'), { code: 'start_unknown' })), dependencies.startTimeoutMs ?? 10000)
        try { child = (dependencies.spawnImpl ?? spawn)(value.toolPath, args, { shell: false, detached: true, stdio: ['ignore', 'pipe', 'ignore'] }) }
        catch { finish(Object.assign(new Error('无法启动可执行文件；请检查绝对路径和执行权限。'), { code: 'start_failed' })); return }
        child.once('error', () => finish(Object.assign(new Error('无法启动服务；请检查可执行文件路径和执行权限。'), { code: 'start_failed' })))
        child.once('exit', (code, signal) => finish(Object.assign(new Error(`服务在就绪前退出（${Number.isInteger(code) ? `退出码 ${code}` : `信号 ${typeof signal === 'string' && /^[A-Z0-9]+$/.test(signal) ? signal : '未知'}`}）；请检查端口占用、版本及私有目录。`), { code: 'start_failed' })))
        child.stdout.on('data', chunk => {
          buffer += chunk.toString()
          if (Buffer.byteLength(buffer) > 65536) return finish(Object.assign(new Error('服务启动输出超限；请发现服务核对当前状态。'), { code: 'start_unknown' }))
          let newline
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
            let ready; try { ready = JSON.parse(line) } catch { continue }
            if (ready.event !== 'ready') continue
            if (ready.protocol !== 'eha-tool.service.v2' || ready.api_version !== 2 || ready.endpoint !== `http://127.0.0.1:${value.port}` || ready.instance_file !== instanceFile || !ready.instance_id) return finish(Object.assign(new Error('启动返回不兼容的服务描述；请检查 eha-tool 版本。'), { code: 'protocol_mismatch' }))
            readyInstance = ready.instance_id; finish(); return
          }
        })
      })
      const connected = await connect()
      if (connected.instance.instance_id !== readyInstance) { invalidate(); fail('instance_mismatch', '启动就绪实例与认证实例不同；请人工核对。') }
      return connected
    }),
    shutdown: request => serial(async () => {
      if (!request || Object.keys(request).some(k => !['instanceId', 'confirmation'].includes(k)) || request.confirmation !== 'shutdown_service_without_stopping_devices' || !attached || request.instanceId !== attached.description.instance_id) fail('confirmation_required', '请核对当前实例，并人工明确确认仅退出服务、不停止设备。')
      const current = attached
      try { const result = await current.client.shutdown(request.instanceId, request.confirmation); return { ...status(), attached: false, instance: result } }
      finally { invalidate() }
    }),
    client() { if (!attached) fail('service_unavailable', '服务尚未附着；请发现或启动服务。'); return attached.client },
    dispose() { disposed = true; invalidate() },
  }
}
