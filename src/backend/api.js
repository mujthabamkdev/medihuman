import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareMedicines } from '../medication-logic.js';
import { JsonDataStore } from './store.js';
import { buildSummary } from './summary.js';
import {
  SESSION_TTL_MS,
  createToken,
  hashPassword,
  newId,
  safeEqualText,
  tokenHash,
  verifyPassword,
} from './security.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEFAULT_DATA_FILE = resolve(process.env.DATA_FILE || join(ROOT, '.data', 'medihuman.json'));
const MAX_BODY_BYTES = 256 * 1024;
const MAX_LIST_ITEMS = 100;
const COOKIE_SESSION = 'mh_session';
const COOKIE_CSRF = 'mh_csrf';
const PATIENT_ROLES = new Set(['patient', 'doctor']);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

class RateLimiter {
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

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = value;
  }
  return cookies;
}

function cookieOptions({ httpOnly = false, maxAge = 8 * 60 * 60, secure }) {
  const attributes = [`Path=/`, `SameSite=${httpOnly ? 'Lax' : 'Strict'}`, `Max-Age=${maxAge}`];
  if (httpOnly) attributes.push('HttpOnly');
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

function setAuthCookies(response, sessionToken, csrfToken, secure) {
  response.setHeader('Set-Cookie', [
    `${COOKIE_SESSION}=${sessionToken}; ${cookieOptions({ httpOnly: true, secure })}`,
    `${COOKIE_CSRF}=${csrfToken}; ${cookieOptions({ secure })}`,
  ]);
}

function clearAuthCookies(response, secure) {
  response.setHeader('Set-Cookie', [
    `${COOKIE_SESSION}=; ${cookieOptions({ httpOnly: true, maxAge: 0, secure })}`,
    `${COOKIE_CSRF}=; ${cookieOptions({ maxAge: 0, secure })}`,
  ]);
}

function sendJson(response, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...headers,
  });
  response.end(payload);
}

function sendError(response, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
  const message = error instanceof HttpError ? error.message : 'An unexpected server error occurred.';
  sendJson(response, status, { error: { code, message } });
}

async function readJson(request) {
  if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Request must use application/json.');
  }
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    chunks.push(chunk);
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'INVALID_JSON', 'Request body must be a JSON object.');
  }
  return parsed;
}

function allowedKeys(value, keys) {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new HttpError(400, 'UNKNOWN_FIELD', `Unknown field: ${key}.`);
  }
}

function stringValue(value, field, { required = false, max = 500, min = 0 } = {}) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') throw new HttpError(400, 'INVALID_FIELD', `${field} must be a string.`);
  const normalized = value.trim();
  if (required && !normalized) throw new HttpError(400, 'INVALID_FIELD', `${field} is required.`);
  if (normalized.length < min || normalized.length > max) {
    throw new HttpError(400, 'INVALID_FIELD', `${field} has an invalid length.`);
  }
  return normalized;
}

function emailValue(value) {
  const email = stringValue(value, 'email', { required: true, min: 3, max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'INVALID_FIELD', 'email is invalid.');
  return email;
}

function passwordValue(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) {
    throw new HttpError(400, 'INVALID_FIELD', 'password must be 12 to 128 characters.');
  }
  return value;
}

function dateValue(value, field) {
  const date = stringValue(value, field, { max: 10 });
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) {
    throw new HttpError(400, 'INVALID_FIELD', `${field} must use a valid YYYY-MM-DD date.`);
  }
  return date;
}

function profileValue(input = {}) {
  allowedKeys(input, ['fullName', 'dateOfBirth', 'allergies', 'conditions']);
  return {
    fullName: stringValue(input.fullName, 'fullName', { max: 120 }),
    dateOfBirth: dateValue(input.dateOfBirth, 'dateOfBirth'),
    allergies: stringValue(input.allergies, 'allergies', { max: 1_000 }),
    conditions: stringValue(input.conditions, 'conditions', { max: 1_000 }),
  };
}

function roleValue(value) {
  const role = stringValue(value === undefined ? 'patient' : value, 'role', { max: 20 }).toLowerCase();
  if (!PATIENT_ROLES.has(role)) throw new HttpError(400, 'INVALID_FIELD', 'role must be patient or doctor.');
  return role;
}

function doctorRegistrationValue(input = {}) {
  allowedKeys(input, ['displayName', 'specialty', 'registrationId', 'organization']);
  return {
    displayName: stringValue(input.displayName, 'displayName', { required: true, max: 160 }),
    specialty: stringValue(input.specialty, 'specialty', { required: true, max: 160 }),
    registrationId: stringValue(input.registrationId, 'registrationId', { required: true, max: 200 }),
    organization: stringValue(input.organization, 'organization', { required: true, max: 200 }),
    verificationStatus: 'pending',
    verified: false,
  };
}

function medicineValue(input, index = 0) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'INVALID_FIELD', `medicines[${index}] must be an object.`);
  allowedKeys(input, ['id', 'name', 'strength', 'dose', 'route', 'timing', 'notes']);
  return {
    id: typeof input.id === 'string' && input.id ? input.id : newId(),
    name: stringValue(input.name, `medicines[${index}].name`, { required: true, max: 160 }),
    strength: stringValue(input.strength, `medicines[${index}].strength`, { max: 80 }),
    dose: stringValue(input.dose, `medicines[${index}].dose`, { max: 120 }),
    route: stringValue(input.route, `medicines[${index}].route`, { max: 80 }),
    timing: stringValue(input.timing, `medicines[${index}].timing`, { max: 160 }),
    notes: stringValue(input.notes, `medicines[${index}].notes`, { max: 500 }),
  };
}

function medicineListValue(value) {
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) throw new HttpError(400, 'INVALID_FIELD', `medicines must be an array of up to ${MAX_LIST_ITEMS} items.`);
  return value.map((item, index) => medicineValue(typeof item === 'string' ? { name: item } : item, index));
}

function prescriptionValue(input) {
  allowedKeys(input, ['medicationName', 'strength', 'dose', 'route', 'frequency', 'startDate', 'endDate', 'instructions', 'prescriber']);
  return {
    medicationName: stringValue(input.medicationName, 'medicationName', { required: true, max: 160 }),
    strength: stringValue(input.strength, 'strength', { max: 80 }),
    dose: stringValue(input.dose, 'dose', { max: 120 }),
    route: stringValue(input.route, 'route', { max: 80 }),
    frequency: stringValue(input.frequency, 'frequency', { max: 120 }),
    startDate: dateValue(input.startDate, 'startDate'),
    endDate: dateValue(input.endDate, 'endDate'),
    instructions: stringValue(input.instructions, 'instructions', { max: 1_000 }),
    prescriber: stringValue(input.prescriber, 'prescriber', { max: 160 }),
  };
}

function listValue(value, field) {
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) throw new HttpError(400, 'INVALID_FIELD', `${field} must be an array of up to ${MAX_LIST_ITEMS} items.`);
  return value.map((item, index) => stringValue(item, `${field}[${index}]`, { required: true, max: 240 }));
}

function publicDoctor(doctor = {}) {
  return {
    displayName: doctor.displayName,
    specialty: doctor.specialty,
    organization: doctor.organization,
    verificationStatus: 'pending',
    status: 'pending',
    verified: false,
  };
}

function publicUser(user) {
  const result = { id: user.id, email: user.email, role: user.role || 'patient', createdAt: user.createdAt };
  if (result.role === 'patient') result.patientId = user.patientId;
  if (result.role === 'doctor') {
    result.doctor = publicDoctor(user.doctorProfile);
    result.doctorProfile = result.doctor;
    result.verificationStatus = 'pending';
    result.verified = false;
  }
  return result;
}

function publicProfile(profile, user = null) {
  const result = {
    fullName: profile.fullName,
    dateOfBirth: profile.dateOfBirth,
    allergies: profile.allergies,
    conditions: profile.conditions,
    updatedAt: profile.updatedAt,
  };
  if (user?.role === 'patient') result.patientId = user.patientId;
  return result;
}

function publicPrescription(prescription) {
  const { userId, ...safePrescription } = prescription;
  return safePrescription;
}

function publicReconciliation(reconciliation) {
  const { userId, ...safeReconciliation } = reconciliation;
  return safeReconciliation;
}

function publicAccessRequest(request, patient, doctor) {
  return {
    id: request.id,
    patientId: patient?.patientId,
    doctor: doctor ? publicDoctor(doctor.doctorProfile) : undefined,
    doctorId: doctor?.id,
    status: request.status,
    requestedAt: request.requestedAt,
    respondedAt: request.respondedAt,
    revokedAt: request.revokedAt,
  };
}

function clientIp(request) {
  return request.socket?.remoteAddress || 'unknown';
}

async function createSession(store, userId, now) {
  const sessionToken = createToken();
  const csrfToken = createToken(24);
  const session = {
    id: newId(),
    userId,
    tokenHash: tokenHash(sessionToken),
    csrfTokenHash: tokenHash(csrfToken),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  };
  await store.transact((state) => {
    state.sessions = state.sessions.filter((item) => item.userId !== userId && new Date(item.expiresAt).getTime() > now);
    state.sessions.push(session);
  });
  return { sessionToken, csrfToken };
}

async function getAuth(store, request, now) {
  const cookies = parseCookies(request.headers.cookie);
  const rawToken = cookies[COOKIE_SESSION];
  if (!rawToken) return null;
  const session = await store.read((state) => state.sessions.find((item) => item.tokenHash === tokenHash(rawToken)));
  if (!session || new Date(session.expiresAt).getTime() <= now) return null;
  const user = await store.read((state) => state.users.find((item) => item.id === session.userId));
  return user ? { session, user, cookies } : null;
}

function requireAuth(auth) {
  if (!auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required.');
  return auth;
}

function requireRole(auth, role) {
  const current = requireAuth(auth);
  if ((current.user.role || 'patient') !== role) throw new HttpError(403, 'FORBIDDEN', `${role} access required.`);
  return current;
}

function decodePathValue(value, field) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, 'INVALID_FIELD', `${field} is invalid.`);
  }
}

function findPatientByPublicId(state, patientId) {
  return state.users.find((user) => user.role === 'patient' && user.patientId === patientId);
}

function hasApprovedAccess(state, doctorId, patientId) {
  return state.accessRequests.some((request) => request.doctorUserId === doctorId && request.patientUserId === patientId && request.status === 'approved');
}

function patientRecords(state, patient, { includeSensitive = true } = {}) {
  const profile = state.profiles.find((item) => item.userId === patient.id) || profileValue();
  const medicines = state.medicines.find((item) => item.userId === patient.id)?.items || [];
  const prescriptions = state.prescriptions.filter((item) => item.userId === patient.id).map(publicPrescription);
  const reconciliations = state.reconciliations.filter((item) => item.userId === patient.id).map(publicReconciliation);
  if (!includeSensitive) return { profile: publicProfile(profile, patient) };
  return { profile: publicProfile(profile, patient), medicines, prescriptions, reconciliations };
}

function requireCsrf(request, auth) {
  const cookies = parseCookies(request.headers.cookie);
  const headerToken = request.headers['x-csrf-token'];
  if (!safeEqualText(headerToken, cookies[COOKIE_CSRF])) throw new HttpError(403, 'CSRF_INVALID', 'CSRF validation failed.');
  if (auth && !safeEqualText(tokenHash(headerToken), auth.session.csrfTokenHash)) throw new HttpError(403, 'CSRF_INVALID', 'CSRF validation failed.');
}

async function staticResponse(request, response, publicRoot, pathname, protectedDataFile, protectedDataDirectory) {
  if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'INVALID_PATH', 'Invalid path.');
  }
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.slice(1);
  const filePath = normalize(join(publicRoot, relativePath));
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}/`)) throw new HttpError(403, 'FORBIDDEN', 'Forbidden.');
  if (filePath === protectedDataFile || (protectedDataDirectory !== publicRoot && filePath.startsWith(`${protectedDataDirectory}/`))) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    throw new HttpError(404, 'NOT_FOUND', 'Not found.');
  }
}

export async function createApp({ dataFile = DEFAULT_DATA_FILE, publicRoot = ROOT, secureCookies = process.env.NODE_ENV === 'production', clock = () => Date.now(), rateLimiter = new RateLimiter(), store = null } = {}) {
  const dataStore = store || await new JsonDataStore(dataFile).init();
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

      rateLimiter.check(clientIp(request), pathname === '/api/auth/login' || pathname === '/api/auth/register' || pathname === '/api/login' || pathname === '/api/register', now);
      const auth = await getAuth(dataStore, request, now);
      const method = request.method || 'GET';
      const stateChanging = !['GET', 'HEAD', 'OPTIONS'].includes(method);
      if (stateChanging) requireCsrf(request, auth);

      if (method === 'OPTIONS') {
        response.writeHead(204, { Allow: 'GET, HEAD, POST, PUT, DELETE, OPTIONS' });
        response.end();
        return;
      }
      if (pathname === '/api/health' && method === 'GET') {
        sendJson(response, 200, { ok: true });
        return;
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
        return;
      }

      const isRegister = pathname === '/api/auth/register' || pathname === '/api/register';
      const isLogin = pathname === '/api/auth/login' || pathname === '/api/login';
      const isLogout = pathname === '/api/auth/logout' || pathname === '/api/logout';
      if (isRegister && method === 'POST') {
        const body = await readJson(request);
        allowedKeys(body, ['email', 'password', 'profile', 'role', 'displayName', 'specialty', 'registrationId', 'organization', 'doctor', 'doctorProfile']);
        const email = emailValue(body.email);
        const password = passwordValue(body.password);
        const role = roleValue(body.role);
        const profile = body.profile === undefined ? profileValue() : profileValue(body.profile);
        let doctorProfile = null;
        if (role === 'doctor') {
          const nestedDoctor = body.doctor ?? body.doctorProfile;
          if (nestedDoctor !== undefined) {
            if (body.doctor !== undefined && body.doctorProfile !== undefined) throw new HttpError(400, 'INVALID_FIELD', 'Use one doctor registration object.');
            if (!nestedDoctor || typeof nestedDoctor !== 'object' || Array.isArray(nestedDoctor)) throw new HttpError(400, 'INVALID_FIELD', 'doctor must be an object.');
            allowedKeys(body, ['email', 'password', 'profile', 'role', 'doctor', 'doctorProfile']);
            doctorProfile = doctorRegistrationValue(nestedDoctor);
          } else {
            doctorProfile = doctorRegistrationValue({
              displayName: body.displayName,
              specialty: body.specialty,
              registrationId: body.registrationId,
              organization: body.organization,
            });
          }
        } else if (['displayName', 'specialty', 'registrationId', 'organization', 'doctor', 'doctorProfile'].some((key) => body[key] !== undefined)) {
          throw new HttpError(400, 'INVALID_FIELD', 'Doctor registration fields require role doctor.');
        }
        const existing = await dataStore.read((state) => state.users.some((user) => user.email === email));
        if (existing) throw new HttpError(409, 'ACCOUNT_EXISTS', 'Account already exists.');
        const user = {
          id: newId(),
          email,
          role,
          ...(role === 'patient' ? { patientId: newId() } : { doctorProfile }),
          passwordHash: await hashPassword(password),
          createdAt: new Date(now).toISOString(),
        };
        await dataStore.transact((state) => {
          state.users.push(user);
          state.profiles.push({ userId: user.id, ...profile, updatedAt: new Date(now).toISOString() });
        });
        const session = await createSession(dataStore, user.id, now);
        setAuthCookies(response, session.sessionToken, session.csrfToken, secureCookies);
        sendJson(response, 201, { user: publicUser(user), profile: publicProfile(profile, user) });
        return;
      }
      if (isLogin && method === 'POST') {
        const body = await readJson(request);
        allowedKeys(body, ['email', 'password']);
        const email = emailValue(body.email);
        const password = passwordValue(body.password);
        const user = await dataStore.read((state) => state.users.find((item) => item.email === email));
        const valid = await verifyPassword(password, user?.passwordHash);
        if (!user || !valid) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
        const session = await createSession(dataStore, user.id, now);
        setAuthCookies(response, session.sessionToken, session.csrfToken, secureCookies);
        sendJson(response, 200, { user: publicUser(user) });
        return;
      }
      if (isLogout && method === 'POST') {
        if (auth) await dataStore.transact((state) => { state.sessions = state.sessions.filter((item) => item.id !== auth.session.id); });
        clearAuthCookies(response, secureCookies);
        sendJson(response, 200, { ok: true });
        return;
      }
      if (pathname === '/api/me' && method === 'GET') {
        const current = requireAuth(auth);
        const data = await dataStore.read((state) => ({
          profile: publicProfile(state.profiles.find((item) => item.userId === current.user.id) || profileValue(), current.user),
          medicines: state.medicines.find((item) => item.userId === current.user.id)?.items || [],
        }));
        sendJson(response, 200, { user: publicUser(current.user), ...data });
        return;
      }

      const current = requireAuth(auth);
      const doctorRequestPath = pathname.match(/^\/api\/doctor\/access-requests(?:\/([^/]+))?$/);
      if (doctorRequestPath && method === 'POST') {
        requireRole(current, 'doctor');
        const body = doctorRequestPath[1] ? {} : await readJson(request);
        if (!doctorRequestPath[1]) allowedKeys(body, ['patientId']);
        const patientId = stringValue(doctorRequestPath[1] ? decodePathValue(doctorRequestPath[1], 'patientId') : body.patientId, 'patientId', { required: true, max: 200 });
        const patient = await dataStore.read((state) => findPatientByPublicId(state, patientId));
        if (!patient) throw new HttpError(404, 'PATIENT_NOT_FOUND', 'Patient not found.');
        const existing = await dataStore.read((state) => state.accessRequests.find((request) =>
          request.doctorUserId === current.user.id && request.patientUserId === patient.id && ['pending', 'approved'].includes(request.status)));
        if (existing) throw new HttpError(409, 'ACCESS_REQUEST_EXISTS', 'An active access request already exists for this patient.');
        const requestRecord = {
          id: newId(),
          doctorUserId: current.user.id,
          patientUserId: patient.id,
          status: 'pending',
          requestedAt: new Date(now).toISOString(),
        };
        await dataStore.transact((state) => state.accessRequests.push(requestRecord));
        sendJson(response, 201, { request: publicAccessRequest(requestRecord, patient, current.user) });
        return;
      }
      if (pathname === '/api/doctor/access-requests' && method === 'GET') {
        requireRole(current, 'doctor');
        const requests = await dataStore.read((state) => state.accessRequests
          .filter((request) => request.doctorUserId === current.user.id)
          .map((request) => publicAccessRequest(request, state.users.find((user) => user.id === request.patientUserId), current.user)));
        sendJson(response, 200, { requests });
        return;
      }

      const patientAccessAction = pathname.match(/^\/api\/patient\/access-requests\/([^/]+)(?:\/(approve|reject|revoke))?$/);
      if (patientAccessAction && (method === 'PUT' || (method === 'POST' && patientAccessAction[2]))) {
        requireRole(current, 'patient');
        const requestId = decodePathValue(patientAccessAction[1], 'requestId');
        let action = patientAccessAction[2];
        if (method === 'PUT') {
          const body = await readJson(request);
          allowedKeys(body, ['status']);
          action = stringValue(body.status, 'status', { required: true, max: 20 }).toLowerCase();
          action = { approved: 'approve', rejected: 'reject', revoked: 'revoke' }[action] || action;
          if (!['approve', 'reject', 'revoke'].includes(action)) throw new HttpError(400, 'INVALID_FIELD', 'status must be approve, reject, or revoke.');
        }
        const existing = await dataStore.read((state) => state.accessRequests.find((request) => request.id === requestId && request.patientUserId === current.user.id));
        if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Access request not found.');
        const requiredStatus = action === 'revoke' ? 'approved' : 'pending';
        const actionLabel = { approve: 'approved', reject: 'rejected', revoke: 'revoked' }[action];
        if (existing.status !== requiredStatus) throw new HttpError(409, 'INVALID_REQUEST_STATUS', `Only ${requiredStatus} access requests can be ${actionLabel}.`);
        const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'revoked';
        const updated = { ...existing, status, respondedAt: new Date(now).toISOString(), ...(status === 'revoked' ? { revokedAt: new Date(now).toISOString() } : {}) };
        await dataStore.transact((state) => {
          const item = state.accessRequests.find((request) => request.id === requestId && request.patientUserId === current.user.id);
          if (!item || item.status !== requiredStatus) throw new HttpError(409, 'INVALID_REQUEST_STATUS', `Only ${requiredStatus} access requests can be ${actionLabel}.`);
          Object.assign(item, updated);
        });
        const doctor = await dataStore.read((state) => state.users.find((user) => user.id === existing.doctorUserId));
        sendJson(response, 200, { request: publicAccessRequest(updated, current.user, doctor) });
        return;
      }
      if (pathname === '/api/patient/access-requests' && method === 'GET') {
        requireRole(current, 'patient');
        const requests = await dataStore.read((state) => state.accessRequests
          .filter((request) => request.patientUserId === current.user.id)
          .map((request) => publicAccessRequest(request, current.user, state.users.find((user) => user.id === request.doctorUserId))));
        sendJson(response, 200, { requests });
        return;
      }

      const doctorPatientMatch = pathname.match(/^\/api\/doctor\/patients\/([^/]+)(?:\/(profile|medicines|prescriptions|reconciliations|summary))?$/);
      if (doctorPatientMatch && method === 'GET') {
        requireRole(current, 'doctor');
        const patientId = decodePathValue(doctorPatientMatch[1], 'patientId');
        const patient = await dataStore.read((state) => findPatientByPublicId(state, patientId));
        if (!patient) throw new HttpError(404, 'PATIENT_NOT_FOUND', 'Patient not found.');
        const approved = await dataStore.read((state) => hasApprovedAccess(state, current.user.id, patient.id));
        if (!approved) throw new HttpError(403, 'PATIENT_ACCESS_REQUIRED', 'Patient approval is required.');
        const records = await dataStore.read((state) => patientRecords(state, patient));
        const resource = doctorPatientMatch[2];
        if (resource === 'summary') {
          sendJson(response, 200, { summary: await buildSummary(records) });
        } else if (resource) {
          sendJson(response, 200, { [resource]: records[resource] });
        } else {
          sendJson(response, 200, records);
        }
        return;
      }

      if ((pathname === '/api/summary' || pathname === '/api/patient/summary') && method === 'GET') {
        requireRole(current, 'patient');
        const records = await dataStore.read((state) => patientRecords(state, current.user));
        sendJson(response, 200, { summary: await buildSummary(records) });
        return;
      }

      if ((pathname === '/api/patient/profile' || pathname === '/api/profile') && method === 'GET') {
        requireRole(current, 'patient');
        const profile = await dataStore.read((state) => publicProfile(state.profiles.find((item) => item.userId === current.user.id) || profileValue(), current.user));
        sendJson(response, 200, { profile });
        return;
      }
      if ((pathname === '/api/patient/profile' || pathname === '/api/profile') && method === 'PUT') {
        requireRole(current, 'patient');
        const input = await readJson(request);
        allowedKeys(input, ['fullName', 'dateOfBirth', 'allergies', 'conditions']);
        const existingProfile = await dataStore.read((state) => state.profiles.find((item) => item.userId === current.user.id) || {});
        const profile = profileValue({
          fullName: input.fullName ?? existingProfile.fullName,
          dateOfBirth: input.dateOfBirth ?? existingProfile.dateOfBirth,
          allergies: input.allergies ?? existingProfile.allergies,
          conditions: input.conditions ?? existingProfile.conditions,
        });
        await dataStore.transact((state) => {
          const existing = state.profiles.find((item) => item.userId === current.user.id);
          if (existing) Object.assign(existing, profile, { updatedAt: new Date(now).toISOString() });
          else state.profiles.push({ userId: current.user.id, ...profile, updatedAt: new Date(now).toISOString() });
        });
        sendJson(response, 200, { profile: publicProfile(profile, current.user) });
        return;
      }
      if ((pathname === '/api/patient/medicines' || pathname === '/api/medicines') && method === 'GET') {
        requireRole(current, 'patient');
        const medicines = await dataStore.read((state) => state.medicines.find((item) => item.userId === current.user.id)?.items || []);
        sendJson(response, 200, { medicines });
        return;
      }
      if ((pathname === '/api/patient/medicines' || pathname === '/api/medicines') && method === 'PUT') {
        requireRole(current, 'patient');
        const body = await readJson(request);
        allowedKeys(body, ['medicines']);
        const medicines = medicineListValue(body.medicines);
        await dataStore.transact((state) => {
          const existing = state.medicines.find((item) => item.userId === current.user.id);
          if (existing) Object.assign(existing, { items: medicines, updatedAt: new Date(now).toISOString() });
          else state.medicines.push({ userId: current.user.id, items: medicines, updatedAt: new Date(now).toISOString() });
        });
        sendJson(response, 200, { medicines });
        return;
      }

      if (pathname === '/api/prescriptions' && method === 'GET') {
        requireRole(current, 'patient');
        const prescriptions = await dataStore.read((state) => state.prescriptions.filter((item) => item.userId === current.user.id).map(publicPrescription));
        sendJson(response, 200, { prescriptions });
        return;
      }
      if (pathname === '/api/prescriptions' && method === 'POST') {
        requireRole(current, 'patient');
        const prescription = prescriptionValue(await readJson(request));
        const record = { id: newId(), userId: current.user.id, ...prescription, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
        await dataStore.transact((state) => state.prescriptions.push(record));
        sendJson(response, 201, { prescription: publicPrescription(record) });
        return;
      }
      const prescriptionMatch = pathname.match(/^\/api\/prescriptions\/([^/]+)$/);
      if (prescriptionMatch) {
        requireRole(current, 'patient');
        const id = decodeURIComponent(prescriptionMatch[1]);
        const existing = await dataStore.read((state) => state.prescriptions.find((item) => item.id === id && item.userId === current.user.id));
        if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Prescription not found.');
        if (method === 'GET') {
          sendJson(response, 200, { prescription: publicPrescription(existing) });
          return;
        }
        if (method === 'PUT') {
          const prescription = prescriptionValue(await readJson(request));
          const updated = { ...existing, ...prescription, updatedAt: new Date(now).toISOString() };
          await dataStore.transact((state) => { const item = state.prescriptions.find((entry) => entry.id === id && entry.userId === current.user.id); Object.assign(item, updated); });
          sendJson(response, 200, { prescription: publicPrescription(updated) });
          return;
        }
        if (method === 'DELETE') {
          await dataStore.transact((state) => { state.prescriptions = state.prescriptions.filter((item) => item.id !== id || item.userId !== current.user.id); });
          sendJson(response, 200, { ok: true });
          return;
        }
      }

      if (pathname === '/api/reconciliations' && method === 'GET') {
        requireRole(current, 'patient');
        const reconciliations = await dataStore.read((state) => state.reconciliations.filter((item) => item.userId === current.user.id).map(publicReconciliation));
        sendJson(response, 200, { reconciliations });
        return;
      }
      if (pathname === '/api/reconciliations' && method === 'POST') {
        requireRole(current, 'patient');
        const body = await readJson(request);
        allowedKeys(body, ['prescriptionMedicines', 'dispensedMedicines', 'notes']);
        const prescriptionMedicines = listValue(body.prescriptionMedicines, 'prescriptionMedicines');
        const dispensedMedicines = listValue(body.dispensedMedicines, 'dispensedMedicines');
        const comparison = compareMedicines(prescriptionMedicines.join('\n'), dispensedMedicines.join('\n'));
        const record = {
          id: newId(), userId: current.user.id, prescriptionMedicines, dispensedMedicines,
          matched: comparison.matched, missing: comparison.missing, unexpected: comparison.unexpected,
          isExactMatch: comparison.isExactMatch, notes: stringValue(body.notes, 'notes', { max: 1_000 }),
          createdAt: new Date(now).toISOString(),
        };
        await dataStore.transact((state) => state.reconciliations.push(record));
        sendJson(response, 201, { reconciliation: publicReconciliation(record) });
        return;
      }
      const reconciliationMatch = pathname.match(/^\/api\/reconciliations\/([^/]+)$/);
      if (reconciliationMatch && method === 'GET') {
        requireRole(current, 'patient');
        const id = decodeURIComponent(reconciliationMatch[1]);
        const reconciliation = await dataStore.read((state) => state.reconciliations.find((item) => item.id === id && item.userId === current.user.id));
        if (!reconciliation) throw new HttpError(404, 'NOT_FOUND', 'Reconciliation not found.');
        sendJson(response, 200, { reconciliation: publicReconciliation(reconciliation) });
        return;
      }
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
