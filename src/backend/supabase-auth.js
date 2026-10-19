export class SupabaseAuthProvider {
  constructor({ url = process.env.SUPABASE_URL, publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY, publicUrl = process.env.MEDIHUMAN_PUBLIC_URL, fetchImpl = globalThis.fetch } = {}) {
    this.url = String(url || '').replace(/\/+$/, '');
    this.publishableKey = publishableKey || '';
    this.publicUrl = String(publicUrl || '').replace(/\/+$/, '');
    this.fetchImpl = fetchImpl;
  }

  get enabled() { return Boolean(this.url && this.publishableKey && this.publicUrl); }

  assertEnabled() {
    if (!this.enabled) throw new Error('Supabase Auth requires SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and MEDIHUMAN_PUBLIC_URL.');
  }

  async request(path, options = {}) {
    this.assertEnabled();
    let response;
    try {
      response = await this.fetchImpl(`${this.url}/auth/v1${path}`, {
        ...options,
        headers: {
          Accept: 'application/json',
          apikey: this.publishableKey,
          ...(options.headers || {}),
        },
      });
    } catch {
      throw new Error('Supabase Auth is unavailable.');
    }
    let body = {};
    try { body = await response.json(); } catch { /* empty response */ }
    if (!response.ok) {
      const error = new Error(body.msg || body.error_description || body.message || 'Supabase Auth request failed.');
      error.status = response.status;
      error.code = body.error_code || body.code || 'SUPABASE_AUTH_ERROR';
      throw error;
    }
    return body;
  }

  json(method, path, body) {
    return this.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  signUp(email, password, role) {
    return this.json('POST', `/signup?redirect_to=${encodeURIComponent(`${this.publicUrl}/api/auth/confirm`)}`, { email, password, data: { medihuman_role: role } });
  }

  signIn(email, password) { return this.json('POST', '/token?grant_type=password', { email, password }); }

  recover(email) { return this.json('POST', `/recover?redirect_to=${encodeURIComponent(`${this.publicUrl}/api/auth/confirm`)}`, { email }); }

  resendConfirmation(email) { return this.json('POST', '/resend', { type: 'signup', email, redirect_to: `${this.publicUrl}/api/auth/confirm` }); }

  verify(tokenHash, type) { return this.json('POST', '/verify', { token_hash: tokenHash, type }); }

  updatePassword(accessToken, password) {
    return this.request('/user', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ password }) });
  }

  factors(accessToken) { return this.request('/factors', { headers: { Authorization: `Bearer ${accessToken}` } }); }

  enrollFactor(accessToken) { return this.jsonWithAuth('POST', '/factors', { factor_type: 'totp', friendly_name: 'MediHuman authenticator', issuer: 'MediHuman' }, accessToken); }

  challengeFactor(accessToken, factorId) { return this.request(`/factors/${encodeURIComponent(factorId)}/challenge`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }); }

  verifyFactor(accessToken, factorId, challengeId, code) { return this.jsonWithAuth('POST', `/factors/${encodeURIComponent(factorId)}/verify`, { challenge_id: challengeId, code }, accessToken); }

  unenrollFactor(accessToken, factorId) { return this.request(`/factors/${encodeURIComponent(factorId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }); }

  jsonWithAuth(method, path, body, accessToken) { return this.request(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify(body) }); }

  signOut(accessToken) {
    if (!accessToken) return Promise.resolve({});
    return this.request('/logout', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
  }
}
