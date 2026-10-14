export function text(value: unknown) {
  return value === null || value === undefined || value === '' ? '—' : String(value)
}

export function errorText(error: any) {
  const code = error?.code ?? error?.kind ?? error?.error?.code
  const message = error?.message ?? error?.error?.message ?? String(error)
  const summary = code ? `${code}：${message}` : message
  return error?.unknown === true ? `${summary}（结果未知）` : summary
}

export function valueOf(result: any) {
  if (result?.ok === true) return result.value
  const error = new Error(result?.error?.message ?? 'Remote request failed') as Error & { code?: string; unknown?: boolean }
  error.code = result?.error?.details?.code ?? result?.error?.code
  if (typeof result?.error?.details?.unknown === 'boolean') error.unknown = result.error.details.unknown
  throw error
}


export function panelStyles(busy = false) {
  return {
    card: { minWidth: 0, maxWidth: '100%', boxSizing: 'border-box' as const, overflowWrap: 'anywhere' as const, border: '1px solid var(--dsh-border, #3d4653)', borderRadius: 10, padding: 14, background: 'var(--dsh-bg-elevated, rgba(127,127,127,.08))' },
    row: { display: 'flex', flexWrap: 'wrap' as const, gap: 8, alignItems: 'center' },
    button: { padding: '7px 10px', borderRadius: 7, border: '1px solid var(--dsh-border, #667)', background: 'transparent', color: 'inherit', cursor: busy ? 'wait' : 'pointer' },
    mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'pre-wrap' as const, overflowWrap: 'anywhere' as const, maxHeight: 170, overflow: 'auto' as const },
  }
}
