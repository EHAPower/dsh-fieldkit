import { valueOf } from './shared.js'
import type { FieldkitJob } from '../remote-types.js'
export async function finishJob(remote: any, sessionId: string, initial: any, active: () => boolean = () => true): Promise<FieldkitJob> {
  let job: FieldkitJob = valueOf(await initial)
  while (job.state === 'running' || job.state === 'queued') {
    await new Promise(resolve => setTimeout(resolve, 400))
    if (!active()) throw new Error('页面已关闭；服务侧任务未取消。')
    job = valueOf(await remote.getJob(sessionId, job.jobId))
  }
  if (job.state === 'failed') throw new Error(job.error ?? '服务任务失败')
  return job
}
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
