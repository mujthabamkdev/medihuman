import { HttpError } from './errors.js';

export class RateLimiter {
  constructor({ windowMs = 60_000, max = 120, authWindowMs = 15 * 60_000, authMax = 30 } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.authWindowMs = authWindowMs;
    this.authMax = authMax;
    this.buckets = new Map();
  }

  check(key, isAuthRoute = false, now = Date.now()) {
    const windowMs = isAuthRoute ? this.authWindowMs : this.windowMs;
    const max = isAuthRoute ? this.authMax : this.max;
    const bucketKey = `${isAuthRoute ? 'auth' : 'api'}:${key}`;
    const current = this.buckets.get(bucketKey);
    if (!current || current.resetAt <= now) {
      this.buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
      this.prune(now);
      return;
    }
    current.count += 1;
    if (current.count > max) {
      throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Try again later.');
    }
  }

  prune(now) {
    if (this.buckets.size < 1_000) return;
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
  }
}

/**
 * Distributed limiter backed by a tiny Supabase counter row and atomic RPC.
 * The auth bucket allows 30 sign-in attempts per 15 minutes per IP: enough for
 * a demo room sharing one address, still bounded against password guessing.
 */
export class SupabaseRateLimiter {
  constructor({ url = process.env.SUPABASE_URL, serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY, fetchImpl = globalThis.fetch, windowMs = 60_000, max = 120, authWindowMs = 15 * 60_000, authMax = 30 } = {}) {
    this.url = String(url || '').replace(/\/+$/, '');
    this.serviceRoleKey = serviceRoleKey || '';
    this.fetchImpl = fetchImpl;
    this.windowMs = windowMs;
    this.max = max;
    this.authWindowMs = authWindowMs;
    this.authMax = authMax;
  }

  async check(key, isAuthRoute = false, now = Date.now()) {
    const response = await this.fetchImpl(`${this.url}/rest/v1/rpc/medihuman_rate_limit_hit`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', apikey: this.serviceRoleKey, Authorization: `Bearer ${this.serviceRoleKey}` },
      body: JSON.stringify({ bucket_key: `${isAuthRoute ? 'auth' : 'api'}:${key}`, window_seconds: Math.ceil((isAuthRoute ? this.authWindowMs : this.windowMs) / 1000), max_count: isAuthRoute ? this.authMax : this.max, now_iso: new Date(now).toISOString() }),
    });
    if (!response.ok) throw new Error('Distributed rate limiter is unavailable.');
    const allowed = await response.json();
    if (allowed !== true && !(Array.isArray(allowed) && allowed[0] === true)) throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Try again later.');
  }
}
