import { COOKIE_CSRF } from '../constants.js';
import { createToken, tokenHash } from '../security.js';
import { cookieOptions, sendJson } from '../http.js';
import { googleAuthConfigured } from '../auth.js';

export async function handleSystemRoute(ctx) {
  const { pathname, method, response, dataStore, auth, secureCookies, googleConfig } = ctx;
  if (pathname === '/api/config' && method === 'GET') {
    sendJson(response, 200, { googleConfigured: googleAuthConfigured(googleConfig) });
    return true;
  }
  if (pathname === '/api/health' && method === 'GET') {
    let storeStatus = 'ok';
    try {
      await dataStore.read((state) => state.users);
    } catch {
      storeStatus = 'unreachable';
    }
    sendJson(response, 200, { ok: storeStatus === 'ok', backend: process.env.STORE_BACKEND || 'json', store: storeStatus, timestamp: new Date().toISOString() });
    return true;
  }
  if (pathname === '/api/csrf' && method === 'GET') {
    const csrfToken = createToken(24);
    if (auth) {
      await dataStore.transact((state) => {
        const session = state.sessions.find((item) => item.id === auth.session.id);
        if (session) session.csrfTokenHash = tokenHash(csrfToken);
      });
    }
    response.setHeader('Set-Cookie', `${COOKIE_CSRF}=${csrfToken}; ${cookieOptions({ secure: secureCookies })}`);
    sendJson(response, 200, { csrfToken });
    return true;
  }
  return false;
}
