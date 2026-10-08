/**
 * Fixed-window rate limiter, kept in memory for one process. It bounds how fast any single
 * client can write. A multi-instance deployment would need a shared store instead.
 */
export function fixedWindowLimiter(limit: number, windowMs = 60_000, now: () => number = Date.now) {
  const buckets = new Map<string, { count: number; start: number }>();
  return (key: string): boolean => {
    const t = now();
    let bucket = buckets.get(key);
    if (!bucket || t - bucket.start >= windowMs) {
      // Bound memory: drop everything when the table grows large. Limits only loosen briefly.
      if (buckets.size > 10_000) buckets.clear();
      bucket = { count: 0, start: t };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    return bucket.count <= limit;
  };
}
