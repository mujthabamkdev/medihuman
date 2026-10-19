import { COOKIE_CSRF } from '../constants.js';
import { createToken, tokenHash } from '../security.js';
import { cookieOptions, sendJson } from '../http.js';

export async function handleSystemRoute(ctx) {
  const { pathname, method, response, dataStore, auth, secureCookies } = ctx;
  if (pathname === '/api/health' && method === 'GET') {
    sendJson(response, 200, { ok: true, backend: process.env.STORE_BACKEND || 'json', timestamp: new Date().toISOString() });
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
