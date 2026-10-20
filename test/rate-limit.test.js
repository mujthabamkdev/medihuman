import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseRateLimiter } from '../src/backend/rate-limit.js';

test('Supabase rate limiter sends compact atomic bucket request', async () => {
  let call;
  const limiter = new SupabaseRateLimiter({
    url: 'https://example.supabase.co', serviceRoleKey: 'service-role',
    fetchImpl: async (url, options) => { call = { url, options }; return new Response('true', { status: 200 }); },
  });
  await limiter.check('127.0.0.1', true, Date.parse('2026-01-01T00:00:00Z'));
  assert.equal(call.url, 'https://example.supabase.co/rest/v1/rpc/medihuman_rate_limit_hit');
  assert.equal(JSON.parse(call.options.body).max_count, 30);
  assert.equal(JSON.parse(call.options.body).window_seconds, 900);
  assert.equal(call.options.headers.Authorization, 'Bearer service-role');
});
