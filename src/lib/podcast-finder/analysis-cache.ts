// A tiny time-to-live cache for feed reports.
//
// Feed pulls are the slow part of this app: each one is a third-party host, and
// the same popular shows come back for every search. Caching a report for a few
// minutes keeps repeated searches fast and keeps the app from hammering hosts
// that never agreed to serve it. The cache is per-process and deliberately not
// shared between instances: it is a politeness measure, not a store.

/** A read-through cache with an expiry per entry. */
export interface TtlCache<Value> {
  /** The cached value, or undefined when missing or expired. */
  get(key: string): Value | undefined;
  /** Store a value under a key. */
  set(key: string, value: Value): void;
  /** Number of live entries, used by tests and the route's own stats. */
  size(): number;
  /** Drop everything, used by tests. */
  clear(): void;
}

/** Milliseconds a feed report stays fresh; long enough for one search session. */
export const PODCAST_REPORT_TTL_MS = 10 * 60 * 1000;

/**
 * Build a TTL cache. `now` is injectable so expiry can be tested without
 * waiting, and expired entries are dropped on read rather than swept in a timer
 * the way a long-lived server process would.
 */
export function createTtlCache<Value>(
  ttlMs: number = PODCAST_REPORT_TTL_MS,
  now: () => number = Date.now
): TtlCache<Value> {
  const entries = new Map<string, { value: Value; expiresAt: number }>();

  return {
    get(key) {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      entries.set(key, { value, expiresAt: now() + ttlMs });
    },
    size() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
  };
}
