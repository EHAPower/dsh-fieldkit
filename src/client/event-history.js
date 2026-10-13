// Display-only conversion: these numbers never feed a request or saved native evidence.
export function appendEvents(history, batch, selected) {
  const next = [...history]
  if (batch.gap) next.push({ gap: true })
  for (const event of batch.events) {
    if (event.targetId !== selected?.targetId || event.connectionGeneration !== selected?.connectionGeneration || event.identity?.uid !== selected?.identity?.uid || event.identity?.runNonce !== selected?.identity?.runNonce) continue
    if (event.gap || event.sourceGap) next.push({ gap: true })
    if (event.kind !== 'telemetry' || event.sourceTimestamp.clock !== 'device_monotonic_us' || !event.nativeJsonText) continue
    try {
      const point = JSON.parse(event.nativeJsonText)
      if (point.gap) next.push({ gap: true })
      next.push({ event, point })
    } catch { next.push({ gap: true }) }
  }
  return next.slice(-1500)
}
export function chartSeries(history, channel) {
  const origin = history.find(v => v.event)?.event.sourceTimestamp.value
  if (!origin) return []
  return history.map(v => {
    if (v.gap) return [null, null]
    const sample = v.point[channel]
    const valid = sample?.result === 1 && sample.quality === 1 && sample.stale === false && typeof sample.value === 'number' && Number.isFinite(sample.value)
    return [Number(BigInt(v.event.sourceTimestamp.value) - BigInt(origin)) / 1e6, valid ? sample.value : null]
  })
}
