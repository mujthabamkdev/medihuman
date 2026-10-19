import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseAuthProvider } from '../src/backend/supabase-auth.js';
import { decryptSecret, encryptSecret } from '../src/backend/security.js';

test('Supabase Auth provider uses fixed same-origin redirects and server-only key', async () => {
  const calls = [];
  const provider = new SupabaseAuthProvider({
    url: 'https://example.supabase.co',
    publishableKey: 'publishable-key',
    publicUrl: 'https://app.example.com',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ user: { id: 'supabase-user-1' }, session: null }), { status: 200 });
    },
  });

  const result = await provider.signUp('person@example.com', 'correct horse battery staple', 'patient');
  assert.equal(result.session, null);
  assert.match(calls[0].url, /\/auth\/v1\/signup\?redirect_to=https%3A%2F%2Fapp\.example\.com%2Fapi%2Fauth%2Fconfirm/);
  assert.equal(calls[0].options.headers.apikey, 'publishable-key');
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(calls[0].options.body).data, { medihuman_role: 'patient' });
});

test('upstream session encryption round-trips without plaintext token storage', () => {
  const previous = process.env.MEDIHUMAN_AUTH_ENCRYPTION_KEY;
  process.env.MEDIHUMAN_AUTH_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  try {
    const token = 'sensitive-access-token';
    const encrypted = encryptSecret(token);
    assert.doesNotMatch(encrypted, /sensitive-access-token/);
    assert.equal(decryptSecret(encrypted), token);
  } finally {
    if (previous === undefined) delete process.env.MEDIHUMAN_AUTH_ENCRYPTION_KEY;
    else process.env.MEDIHUMAN_AUTH_ENCRYPTION_KEY = previous;
  }
});
