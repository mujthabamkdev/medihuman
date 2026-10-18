import { HttpError } from './errors.js';

export class RateLimiter {
  constructor({ windowMs = 60_000, max = 120, authWindowMs = 15 * 60_000, authMax = 10 } = {}) {
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
