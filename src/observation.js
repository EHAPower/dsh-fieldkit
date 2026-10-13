/** Resolve a pending selection for this mounted view. */
export async function takeOpenedBinding(pending, isCurrent, release) {
  const binding = await pending
  if (!isCurrent()) { await release(binding); return null }
  return binding
}
