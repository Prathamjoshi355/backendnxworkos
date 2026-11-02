import { env } from "../config/env";
import { error } from "../utils/response";

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitRecord>();

// Periodic cleanup every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of store.entries()) {
    if (record.resetAt <= now) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  keyPrefix?: string;
  skipInTest?: boolean;
}

export function checkRateLimit(
  key: string,
  options: RateLimitOptions = {}
): { allowed: boolean; limit: number; remaining: number; resetTime: number } {
  if (options.skipInTest && env.NODE_ENV === "test") {
    return { allowed: true, limit: 9999, remaining: 9999, resetTime: Date.now() + 60000 };
  }

  const windowMs = options.windowMs || env.RATE_LIMIT_WINDOW_MS;
  const max = options.max || env.RATE_LIMIT_MAX;
  const prefix = options.keyPrefix || "global";
  const storeKey = `${prefix}:${key}`;
  const now = Date.now();

  let record = store.get(storeKey);
  if (!record || record.resetAt <= now) {
    record = { count: 1, resetAt: now + windowMs };
    store.set(storeKey, record);
    return {
      allowed: true,
      limit: max,
      remaining: max - 1,
      resetTime: record.resetAt,
    };
  }

  record.count += 1;
  const remaining = Math.max(0, max - record.count);
  const allowed = record.count <= max;

  return {
    allowed,
    limit: max,
    remaining,
    resetTime: record.resetAt,
  };
}

export function rateLimitResponse(limit: number, resetTime: number) {
  const retryAfterSec = Math.ceil((resetTime - Date.now()) / 1000);
  const res = error("RATE_LIMIT_EXCEEDED", "Too many requests. Please slow down and try again.", 429);
  res.headers.set("Retry-After", String(Math.max(1, retryAfterSec)));
  res.headers.set("X-RateLimit-Limit", String(limit));
  res.headers.set("X-RateLimit-Remaining", "0");
  res.headers.set("X-RateLimit-Reset", String(Math.floor(resetTime / 1000)));
  return res;
}

export function resetRateLimitStore() {
  store.clear();
}
