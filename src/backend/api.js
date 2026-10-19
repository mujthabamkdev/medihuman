import { createServer as createHttpServer } from 'node:http';
import { resolve } from 'node:path';
import { DEFAULT_DATA_FILE, ROOT } from './constants.js';
import { getAuth, googleAuthConfig, requireAuth, requireCsrf } from './auth.js';
import { HttpError } from './errors.js';
import { clientIp, sendError, staticResponse } from './http.js';
import { RateLimiter } from './rate-limit.js';
import { JsonDataStore, SupabaseDataStore } from './store.js';
import { handleAccessRoute } from './routes/access.js';
import { handleAuthRoute } from './routes/auth.js';
import { handleAdminRoute } from './routes/admin.js';
import { handleDoctorRoute } from './routes/doctor.js';
import { handlePatientRoute } from './routes/patient.js';
import { handleSystemRoute } from './routes/system.js';

const AUTH_PATHS = new Set([
  '/api/auth/login', '/api/auth/register', '/api/auth/google', '/api/auth/google/callback',
  '/api/login', '/api/register',
]);

export async function createApp({
  dataFile = DEFAULT_DATA_FILE,
  publicRoot = ROOT,
  secureCookies = process.env.NODE_ENV === 'production',
  clock = () => Date.now(),
  rateLimiter = new RateLimiter(),
  store = null,
  google = {},
  googleClientId,
  googleClientSecret,
  googleRedirectUri,
  clinicianAdminKey = process.env.MEDIHUMAN_CLINICIAN_ADMIN_KEY,
  fetchImpl = globalThis.fetch,
} = {}) {
  const selectedBackend = process.env.STORE_BACKEND || (process.env.VERCEL === '1' ? 'supabase' : 'json');
  const dataStore = store || await (selectedBackend === 'supabase'
    ? new SupabaseDataStore({ fetchImpl }).init()
    : selectedBackend === 'json'
      ? new JsonDataStore(dataFile).init()
      : Promise.reject(new Error('STORE_BACKEND must be json or supabase.')));
  const protectedDataFile = resolve(dataFile);
  const protectedDataDirectory = resolve(dataFile, '..');
  if (store && !store.state) await store.init();

  return async function app(request, response) {
    const url = new URL(request.url || '/', 'http://localhost');
    const pathname = url.pathname;
    const now = clock();
    try {
      if (!pathname.startsWith('/api/')) {
        await staticResponse(request, response, resolve(publicRoot), pathname, protectedDataFile, protectedDataDirectory);
        return;
      }

      rateLimiter.check(clientIp(request), AUTH_PATHS.has(pathname), now);
      if (pathname !== '/api/health' && typeof dataStore.refresh === 'function') await dataStore.refresh();
      const auth = await getAuth(dataStore, request, now);
      const method = request.method || 'GET';
      const stateChanging = !['GET', 'HEAD', 'OPTIONS'].includes(method);
      if (stateChanging) requireCsrf(request, auth);

      if (method === 'OPTIONS') {
        response.writeHead(204, { Allow: 'GET, HEAD, POST, PUT, DELETE, OPTIONS' });
        response.end();
        return;
      }
      const context = {
        request, response, pathname, method, now, dataStore, auth, secureCookies, url,
        googleConfig: googleAuthConfig({
          clientId: google.clientId ?? googleClientId,
          clientSecret: google.clientSecret ?? googleClientSecret,
          redirectUri: google.redirectUri ?? googleRedirectUri,
        }),
        fetchImpl, clinicianAdminKey,
      };
      if (await handleSystemRoute(context)) return;
      if (await handleAuthRoute(context)) return;
      if (await handleAdminRoute(context)) return;

      const current = requireAuth(auth);
      context.current = current;
      if (await handlePatientRoute(context)) return;
      if (await handleAccessRoute(context)) return;
      if (await handleDoctorRoute(context)) return;
      throw new HttpError(404, 'NOT_FOUND', 'Not found.');
    } catch (error) {
      if (!(error instanceof HttpError) && !response.headersSent) console.error('MediHuman request failed', error?.code || error?.name || 'unknown');
      if (!response.headersSent) sendError(response, error);
    }
  };
}

export async function createTestServer(options = {}) {
  const app = await createApp(options);
  return createHttpServer(app);
}
