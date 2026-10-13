import React, { useEffect, useRef, useState } from 'react'
import type { FieldkitRecording } from '../remote-types.js'
import { panelStyles, errorText } from './shared.js'
import { finishJob, downloadBlob } from './async.js'
export function Recordings({ remote, sessionId, capabilities, onOpenControl }: any) {
  const [truncated, setTruncated] = useState(false)
  const [records, setRecords] = useState<readonly FieldkitRecording[]>([]), [notice, setNotice] = useState('服务侧记录独立于页面绘图。'), [busy, setBusy] = useState(false), [serial, setSerial] = useState(''), [devices, setDevices] = useState<string[]>([]), [odrive, setOdrive] = useState('')
  const alive = useRef(false), flight = useRef(false), styles = panelStyles(busy)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const act = async (label: string, action: () => Promise<void>) => { if (flight.current) return; flight.current = true; setBusy(true); setNotice(label); try { await action(); if (alive.current) setNotice('任务完成。') } catch (e) { if (alive.current) setNotice(errorText(e)) } finally { flight.current = false; if (alive.current) setBusy(false) } }
  const button = (label: string, fn: () => Promise<void>, disabled = false) => React.createElement('button', { style: styles.button, disabled: busy || disabled, onClick: () => act(`正在${label}…`, fn) }, label)
  const download = async (r: FieldkitRecording, file: string) => {
    let offset = '0', bytes = 0
    const chunks: Uint8Array[] = []
    while (alive.current) {
      const job = await finishJob(remote, sessionId, remote.downloadRecording(sessionId, { runId: r.id, file, offset }), () => alive.current).catch(error => { throw new Error(`下载未完成，未导出部分文件；可重新下载。${errorText(error)}`) })
      const c = job.download
      if (!c || c.runId !== r.id || c.file !== file || c.offset !== offset) throw new Error('记录分块身份不匹配；未导出。')
      const raw = Uint8Array.from(atob(c.contentBase64), ch => ch.charCodeAt(0)); bytes += raw.length
      if (BigInt(c.nextOffset) !== BigInt(offset) + BigInt(raw.length) || (!c.eof && !raw.length)) throw new Error('记录分块偏移不连续；未导出。')
      if (bytes > 64 * 1024 * 1024) throw new Error('记录超过浏览器 64 MiB 下载上限；未保存部分文件。请在服务主机查看完整记录。')
      chunks.push(raw); offset = c.nextOffset
      if (alive.current) setNotice(`已读取 ${bytes} 字节；${c.eof ? '完整文件' : '继续读取…'}`)
      if (c.eof) { if (!alive.current) return; downloadBlob(`${r.id.replace(/[^a-zA-Z0-9_-]/g, '_')}-${file}`, new Blob(chunks as BlobPart[], { type: 'application/octet-stream' })); return }
    }
  }
  return React.createElement('section', { style: styles.card }, React.createElement('h2', null, '记录与独立 ODrive'), React.createElement('p', { role: 'status' }, notice),
    React.createElement('h3', null, '服务侧记录'),
    React.createElement('p', null, capabilities?.includes('recording_write') ? '开始 / 结束录制位于控制 / 试验页，使用已明确授权的固定范围。暂停绘图、切页或解除观察均不结束记录。' : '当前服务未发布 recording_write，不能从本服务开始 / 结束录制；已有历史仍可按读取能力查看。'),
    capabilities?.includes('recording_write') && React.createElement('button', { onClick: onOpenControl, disabled: typeof onOpenControl !== 'function' }, '前往控制 / 试验'),
    button('刷新记录历史', async () => { const j = await finishJob(remote, sessionId, remote.listRecordings(sessionId), () => alive.current); if (alive.current) { setRecords(j.recordings ?? []); setTruncated(j.truncated === true) } }, !capabilities?.includes('recordings_read')),
    truncated && React.createElement('p', { role: 'alert' }, '历史或元数据已截断：可能达到条目数量、目录扫描或元数据总预算。当前列表不代表完整历史，缺失元数据不代表没有记录。'),
    records.map(r => React.createElement('details', { key: r.id }, React.createElement('summary', null, r.id), r.metadataJsonText === null ? React.createElement('p', null, '元数据不可读。') : React.createElement('pre', { style: styles.mono }, r.metadataJsonText), r.files.map(f => React.createElement(React.Fragment, { key: f }, button(`下载 ${f}`, () => download(r, f)), ' ')))),
    React.createElement('h3', null, 'ODrive USB 只读'), React.createElement('p', null, '独立 Python / ODrive worker；结果不证明 H723 通路、身份、停止或安全。'),
    button('枚举 ODrive', async () => { const j = await finishJob(remote, sessionId, remote.listOdriveDevices(sessionId), () => alive.current).catch(error => { throw new Error(`ODrive 枚举未完成；检查服务启动时的 Python 路径及依赖，修复后重试。${errorText(error)}`) }); if (alive.current) { setOdrive(j.nativeJsonText ?? ''); const data = JSON.parse(j.nativeJsonText ?? '{}'); setDevices((data.devices ?? []).map((d: any) => d.serial_number).filter((s: any) => typeof s === 'string')) } }, !capabilities?.includes('odrive_read')),
    React.createElement('label', null, '完整序列号', React.createElement('select', { value: serial, onChange: (e: any) => setSerial(e.target.value), disabled: busy }, React.createElement('option', { value: '' }, '明确选择设备'), devices.map(s => React.createElement('option', { key: s, value: s }, s)))),
    button('读取 ODrive', async () => { const j = await finishJob(remote, sessionId, remote.readOdrive(sessionId, serial), () => alive.current).catch(error => { throw new Error(`ODrive 读取未完成；检查所选完整序列号以及服务 Python 路径及依赖，修复后重试。${errorText(error)}`) }); if (alive.current) setOdrive(j.nativeJsonText ?? '') }, !serial),
    odrive && React.createElement('details', { open: true }, React.createElement('summary', null, 'ODrive 原始证据'), React.createElement('pre', { style: styles.mono }, odrive)))
}
