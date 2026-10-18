/**
 * In-memory fixed-window limiter for login attempts. Per server instance only
 * (on Vercel each instance has its own window) — enough to make online
 * guessing slow, not a distributed limiter.
 */
export interface RateLimiter {
  /** Whether another attempt from `key` is allowed right now. */
  allowed(key: string, now?: number): boolean;
  /** Record a failed attempt. */
  fail(key: string, now?: number): void;
  /** Clear a key after a successful login. */
  reset(key: string): void;
  /** Seconds until `key` may try again (0 if allowed). */
  retryAfter(key: string, now?: number): number;
}

export function createRateLimiter({ max, windowMs, globalMax }: { max: number; windowMs: number; globalMax?: number }): RateLimiter {
  const hits = new Map<string, { count: number; start: number }>();
  const GLOBAL = "\0global";
  const entry = (key: string, now: number) => {
    const e = hits.get(key);
    if (!e || now - e.start >= windowMs) return undefined;
    return e;
  };
  const bump = (key: string, now: number) => {
    const e = entry(key, now);
    if (e) e.count++;
    else hits.set(key, { count: 1, start: now });
  };
  const blockedUntil = (key: string, limit: number, now: number) => {
    const e = entry(key, now);
    return e && e.count >= limit ? e.start + windowMs : 0;
  };
  return {
    allowed(key, now = Date.now()) {
      return this.retryAfter(key, now) === 0;
    },
    fail(key, now = Date.now()) {
      bump(key, now);
      if (globalMax) bump(GLOBAL, now);
      if (hits.size > 10_000) for (const [k, e] of hits) if (now - e.start >= windowMs) hits.delete(k);
    },
    reset(key) {
      hits.delete(key);
    },
    retryAfter(key, now = Date.now()) {
      const until = Math.max(blockedUntil(key, max, now), globalMax ? blockedUntil(GLOBAL, globalMax, now) : 0);
      return until ? Math.ceil((until - now) / 1000) : 0;
    },
  };
}

/** 5 failed attempts per IP per 15 minutes; 100 failures across all IPs. */
export const loginLimiter = createRateLimiter({ max: 5, windowMs: 15 * 60 * 1000, globalMax: 100 });

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] || req.headers.get("x-real-ip") || "unknown").trim();
}
