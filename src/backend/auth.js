import { COOKIE_CSRF, COOKIE_SESSION, GOOGLE_STATE_TTL_MS } from './constants.js';
import { HttpError } from './errors.js';
import { parseCookies } from './http.js';
import {
  RECOVERY_SESSION_TTL_MS, SESSION_TTL_MS, createToken, decryptSecret, encryptSecret, newId, safeEqualText, tokenHash,
} from './security.js';

export function googleAuthConfig(overrides = {}) {
  return {
    clientId: overrides.clientId ?? process.env.GOOGLE_CLIENT_ID,
    clientSecret: overrides.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: overrides.redirectUri ?? process.env.GOOGLE_REDIRECT_URI,
  };
}

export function googleAuthConfigured(config) {
  return typeof config?.clientId === 'string'
    && Boolean(config.clientId.trim())
    && typeof config?.clientSecret === 'string'
    && Boolean(config.clientSecret.trim())
    && typeof config?.redirectUri === 'string'
    && Boolean(config.redirectUri.trim());
}

export async function createGoogleState(store, now, role = 'patient') {
  const state = createToken(32);
  await store.transact((data) => {
    data.oauthStates = data.oauthStates.filter((item) => new Date(item.expiresAt).getTime() > now);
    data.oauthStates.push({
      stateHash: tokenHash(state),
      role,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + GOOGLE_STATE_TTL_MS).toISOString(),
    });
    if (data.oauthStates.length > 100) data.oauthStates = data.oauthStates.slice(-100);
  });
  return state;
}

export async function consumeGoogleState(store, state, now) {
  const stateHash = tokenHash(state);
  return store.transact((data) => {
    let consumed = null;
    data.oauthStates = data.oauthStates.filter((item) => {
      const expired = new Date(item.expiresAt).getTime() <= now;
      if (!consumed && !expired && safeEqualText(item.stateHash, stateHash)) {
        consumed = item;
        return false;
      }
      return !expired;
    });
    return consumed;
  });
}

export function googleIdentity(value, clientId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(502, 'GOOGLE_IDENTITY_INVALID', 'Google sign-in could not be completed.');
  }
  const sub = typeof value.sub === 'string' ? value.sub.trim() : '';
  const email = typeof value.email === 'string' ? value.email.trim().toLowerCase() : '';
  const verified = value.email_verified === true || value.email_verified === 'true';
  const audience = value.aud === undefined ? clientId : value.aud;
  if (!sub || sub.length > 255 || !verified || audience !== clientId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new HttpError(502, 'GOOGLE_IDENTITY_INVALID', 'Google sign-in could not be completed.');
  }
  return { sub, email };
}

export function googleDisplayName(value, email) {
  const providerName = typeof value?.name === 'string' ? value.name.trim() : '';
  const displayName = providerName && providerName.length <= 160 && !/[\u0000-\u001f\u007f]/.test(providerName)
    ? providerName
    : email.slice(0, email.indexOf('@'))
      .replace(/[._-]+/g, ' ')
      .replace(/[^\p{L}\p{N}\s']/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160) || 'Google user';
  return displayName;
}

export async function createSession(store, userId, now, { recoveryOnly = false, mfaPending = false, upstreamTokens = null } = {}) {
  const sessionToken = createToken();
  const csrfToken = createToken(24);
  const session = {
    id: newId(),
    userId,
    tokenHash: tokenHash(sessionToken),
    csrfTokenHash: tokenHash(csrfToken),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + (recoveryOnly ? RECOVERY_SESSION_TTL_MS : SESSION_TTL_MS)).toISOString(),
    recoveryOnly,
    mfaPending,
    ...(upstreamTokens ? { upstreamTokens: encryptSecret(JSON.stringify(upstreamTokens)) } : {}),
  };
  await store.transact((state) => {
    state.sessions = state.sessions.filter((item) => item.userId !== userId && new Date(item.expiresAt).getTime() > now);
    state.sessions.push(session);
  });
  return { sessionId: session.id, sessionToken, csrfToken };
}

export async function getAuth(store, request, now) {
  const cookies = parseCookies(request.headers.cookie);
  const rawToken = cookies[COOKIE_SESSION];
  if (!rawToken) return null;
  const session = await store.read((state) => state.sessions.find((item) => item.tokenHash === tokenHash(rawToken)));
  if (!session || new Date(session.expiresAt).getTime() <= now) return null;
  const user = await store.read((state) => state.users.find((item) => item.id === session.userId));
  let upstreamTokens = null;
  if (session?.upstreamTokens) {
    try { upstreamTokens = JSON.parse(decryptSecret(session.upstreamTokens)); } catch { return null; }
  }
  return user ? { session, user, cookies, upstreamTokens } : null;
}

export function requireAuth(auth) {
  if (!auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required.');
  return auth;
}

export function requireFullAuth(auth) {
  const current = requireAuth(auth);
  if (current.session.recoveryOnly) throw new HttpError(403, 'RECOVERY_SESSION_ONLY', 'Complete password recovery before accessing this workspace.');
  if (current.session.mfaPending) throw new HttpError(403, 'MFA_REQUIRED', 'Multi-factor verification is required.');
  return current;
}

export function requireRole(auth, role) {
  const current = requireAuth(auth);
  if ((current.user.role || 'patient') !== role) throw new HttpError(403, 'FORBIDDEN', `${role} access required.`);
  return current;
}

export function requireVerifiedDoctor(auth) {
  const current = requireRole(auth, 'doctor');
  if (current.user.doctorProfile?.verified !== true || current.user.doctorProfile?.verificationStatus !== 'verified') {
    throw new HttpError(403, 'CLINICIAN_VERIFICATION_REQUIRED', 'Clinician verification is required before patient records can be accessed.');
  }
  return current;
}

export function requireCsrf(request, auth) {
  const cookies = parseCookies(request.headers.cookie);
  const headerToken = request.headers['x-csrf-token'];
  if (!safeEqualText(headerToken, cookies[COOKIE_CSRF])) throw new HttpError(403, 'CSRF_INVALID', 'CSRF validation failed.');
  if (auth && !safeEqualText(tokenHash(headerToken), auth.session.csrfTokenHash)) throw new HttpError(403, 'CSRF_INVALID', 'CSRF validation failed.');
}

export function publicDoctor(doctor = {}) {
  const verificationStatus = ['pending', 'verified', 'rejected'].includes(doctor.verificationStatus)
    ? doctor.verificationStatus
    : 'pending';
  return {
    displayName: doctor.displayName,
    specialty: doctor.specialty,
    organization: doctor.organization,
    verificationStatus,
    status: verificationStatus,
    verified: verificationStatus === 'verified' && doctor.verified === true,
  };
}

export function publicUser(user) {
  const result = { id: user.id, email: user.email, role: user.role || 'patient', createdAt: user.createdAt };
  if (result.role === 'patient') result.patientId = user.patientId;
  if (result.role === 'doctor') {
    result.doctor = publicDoctor(user.doctorProfile);
    result.doctorProfile = result.doctor;
    result.verificationStatus = result.doctor.verificationStatus;
    result.verified = result.doctor.verified;
  }
  return result;
}
