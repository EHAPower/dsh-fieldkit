export const SESSION_STORAGE_KEY = 'ehapower.dsh-fieldkit.session.v1'
export const FIELDKIT_SESSION_PREFIX = 'ehapower.dsh-fieldkit.known-session.v1:'
const evidencePrefixes = ['eha-fieldkit.ui-pending.v1:', 'eha-fieldkit.received-history.v1:']
const limit = 128
export type FieldkitSessionChoice = { id: string; visitedAt: number | null }
export type FieldkitSessionChoices = { items: FieldkitSessionChoice[]; truncated: boolean; warning: string | null }

function readySessionCatalog(sessions: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let settled = false
    let unsubscribe = () => {}
    let timeout: ReturnType<typeof setTimeout> | undefined
    const finish = (catalog?: any, error?: unknown) => {
      if (settled) return
      settled = true; unsubscribe(); if (timeout) clearTimeout(timeout)
      if (error) reject(error); else resolve(catalog)
    }
    const check = () => { const catalog = sessions.list.getSnapshot(); if (catalog.phase === 'ready') finish(catalog) }
    unsubscribe = sessions.list.subscribe(check)
    timeout = setTimeout(() => finish(undefined, new Error('官方会话目录尚未就绪；保留当前 Fieldkit 会话。')), 15000)
    check()
    if (settled) unsubscribe()
    else void sessions.refresh().then(check, (error: unknown) => finish(undefined, error))
  })
}

/** Only browser Fieldkit provenance plus the official catalog can offer a return target. */
export function createFieldkitSessions() {
  let current: string | null = null
  let creating: Promise<string> | null = null
  let warning: string | null = null
  const candidates = () => {
    const entries = new Map<string, FieldkitSessionChoice>()
    const saved = sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (saved) entries.set(saved, { id: saved, visitedAt: null })
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !(key.startsWith(FIELDKIT_SESSION_PREFIX) || evidencePrefixes.some(prefix => key.startsWith(prefix)))) continue
      let entry: any
      try { entry = JSON.parse(localStorage.getItem(key) ?? 'null') } catch { continue }
      const id = key.startsWith(FIELDKIT_SESSION_PREFIX) ? entry?.id : entry?.sessionId
      if (typeof id !== 'string' || !id || id.length > 512) continue
      const visitedAt = key.startsWith(FIELDKIT_SESSION_PREFIX) && Number.isFinite(entry.visitedAt) ? entry.visitedAt : null
      if (!entries.has(id) || visitedAt !== null) entries.set(id, { id, visitedAt })
    }
    if (current && !entries.has(current)) entries.set(current, { id: current, visitedAt: null })
    return entries
  }
  const remember = (id: string) => {
    warning = null
    try {
      let count = 0
      for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)?.startsWith(FIELDKIT_SESSION_PREFIX)) count++
      const key = FIELDKIT_SESSION_PREFIX + encodeURIComponent(id)
      if (!localStorage.getItem(key) && count >= limit) throw new Error('登记已满')
      localStorage.setItem(key, JSON.stringify({ id, visitedAt: Date.now() }))
    } catch { warning = '会话复访登记不可写或已满；当前会话可用，但关闭窗口后的复访可能不完整。' }
    try { sessionStorage.setItem(SESSION_STORAGE_KEY, id) } catch { warning = '当前页会话登记不可写；刷新后可能需要再次明确选择。' }
  }
  return {
    ensure(sessions: any): Promise<string> {
      if (current) return Promise.resolve(current)
      if (!creating) creating = (async () => {
        let saved: string | null = null
        try { saved = sessionStorage.getItem(SESSION_STORAGE_KEY) } catch { /* Current mount can still create a dedicated chat. */ }
        if (saved && (await readySessionCatalog(sessions)).ids.includes(saved)) current = saved
        else current = await sessions.create({})
        remember(current!)
        return current!
      })().finally(() => { creating = null })
      return creating
    },
    async list(sessions: any): Promise<FieldkitSessionChoices> {
      await sessions.refresh()
      const catalog = await readySessionCatalog(sessions)
      const ids = new Set<string>(catalog.ids)
      const items = [...candidates().values()].filter(entry => ids.has(entry.id)).sort((a, b) => (b.visitedAt ?? 0) - (a.visitedAt ?? 0) || a.id.localeCompare(b.id))
      return { items: items.slice(0, limit), truncated: items.length > limit, warning }
    },
    async select(sessions: any, id: string): Promise<string> {
      // Recheck both provenances at the explicit click, never trust a stale option or a caller-supplied ID.
      if (!candidates().has(id)) throw new Error('该会话没有 Fieldkit 登记；未切换会话。')
      await sessions.refresh()
      const catalog = await readySessionCatalog(sessions)
      if (!catalog.ids.includes(id)) throw new Error('该会话已不在官方目录中；保留当前会话。')
      current = id; remember(id)
      return id
    },
  }
}
export type FieldkitSessions = ReturnType<typeof createFieldkitSessions>
