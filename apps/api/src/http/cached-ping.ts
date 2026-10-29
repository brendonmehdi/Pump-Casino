/**
 * Shares one database ping among all health checks within `ttlMs`, including a ping that is
 * still in flight. Health checks are exempt from rate limiting (Render polls them), so without
 * this a flood of them could take the pooled connections away from gameplay.
 */
export function cachedPing(
  ping: () => Promise<void>,
  ttlMs: number,
  now: () => number = Date.now,
): () => Promise<void> {
  let last: { readonly at: number; readonly result: Promise<void> } | null = null;
  return () => {
    const time = now();
    if (last === null || time - last.at >= ttlMs) last = { at: time, result: ping() };
    return last.result;
  };
}
