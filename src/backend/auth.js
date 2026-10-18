import { COOKIE_CSRF, COOKIE_SESSION } from './constants.js';
import { HttpError } from './errors.js';
import { parseCookies } from './http.js';
import { SESSION_TTL_MS, createToken, newId, safeEqualText, tokenHash } from './security.js';

export async function createSession(store, userId, now) {
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

export async function getAuth(store, request, now) {
  const cookies = parseCookies(request.headers.cookie);
  const rawToken = cookies[COOKIE_SESSION];
  if (!rawToken) return null;
  const session = await store.read((state) => state.sessions.find((item) => item.tokenHash === tokenHash(rawToken)));
  if (!session || new Date(session.expiresAt).getTime() <= now) return null;
  const user = await store.read((state) => state.users.find((item) => item.id === session.userId));
  return user ? { session, user, cookies } : null;
}

export function requireAuth(auth) {
  if (!auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required.');
  return auth;
}

export function requireRole(auth, role) {
  const current = requireAuth(auth);
  if ((current.user.role || 'patient') !== role) throw new HttpError(403, 'FORBIDDEN', `${role} access required.`);
  return current;
}

export function requireCsrf(request, auth) {
  const cookies = parseCookies(request.headers.cookie);
  const headerToken = request.headers['x-csrf-token'];
  if (!safeEqualText(headerToken, cookies[COOKIE_CSRF])) throw new HttpError(403, 'CSRF_INVALID', 'CSRF validation failed.');
  if (auth && !safeEqualText(tokenHash(headerToken), auth.session.csrfTokenHash)) throw new HttpError(403, 'CSRF_INVALID', 'CSRF validation failed.');
}

export function publicDoctor(doctor = {}) {
  return {
    displayName: doctor.displayName,
    specialty: doctor.specialty,
    organization: doctor.organization,
    verificationStatus: 'pending',
    status: 'pending',
    verified: false,
  };
}

export function publicUser(user) {
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
