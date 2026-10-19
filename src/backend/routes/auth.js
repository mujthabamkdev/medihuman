import {
  consumeGoogleState, createGoogleState, createSession, googleAuthConfigured, googleDisplayName, googleIdentity, publicUser,
} from '../auth.js';
import { COOKIE_GOOGLE_STATE } from '../constants.js';
import { HttpError } from '../errors.js';
import {
  clearAuthCookies, clearGoogleStateCookie, parseCookies, readJson, redirect, sendJson,
  setAuthCookies, setGoogleStateCookie,
} from '../http.js';
import { publicProfile } from '../records.js';
import { addAuditEvent } from '../audit.js';
import { hashPassword, newId, safeEqualText, verifyPassword } from '../security.js';
import {
  allowedKeys, doctorRegistrationValue, emailValue, passwordValue, profileValue, roleValue,
} from '../validation.js';

export async function handleAuthRoute(ctx) {
  const {
    pathname, method, request, response, dataStore, now, secureCookies, auth, url,
    googleConfig, fetchImpl,
  } = ctx;
  const isRegister = pathname === '/api/auth/register' || pathname === '/api/register';
  const isLogin = pathname === '/api/auth/login' || pathname === '/api/login';
  const isLogout = pathname === '/api/auth/logout' || pathname === '/api/logout';
  const isGoogleStart = pathname === '/api/auth/google';
  const isGoogleCallback = pathname === '/api/auth/google/callback';
  const redirectGoogleError = (code) => {
    clearGoogleStateCookie(response, secureCookies);
    redirect(response, `/?error=${encodeURIComponent(code)}`);
    return true;
  };

  if (isGoogleStart && method === 'GET') {
    if (!googleAuthConfigured(googleConfig)) {
      sendJson(response, 404, { error: { code: 'GOOGLE_AUTH_UNAVAILABLE', message: 'Google sign-in is not configured.' } });
      return true;
    }
    const role = roleValue(url.searchParams.get('role') ?? undefined);
    const state = await createGoogleState(dataStore, now, role);
    const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorization.searchParams.set('client_id', googleConfig.clientId);
    authorization.searchParams.set('redirect_uri', googleConfig.redirectUri);
    authorization.searchParams.set('response_type', 'code');
    authorization.searchParams.set('scope', 'openid email profile');
    authorization.searchParams.set('state', state);
    setGoogleStateCookie(response, state, secureCookies);
    redirect(response, authorization.toString());
    return true;
  }

  if (isGoogleCallback && method === 'GET') {
    if (!googleAuthConfigured(googleConfig)) {
      sendJson(response, 404, { error: { code: 'GOOGLE_AUTH_UNAVAILABLE', message: 'Google sign-in is not configured.' } });
      return true;
    }
    const cookies = parseCookies(request.headers.cookie);
    const state = url.searchParams.get('state');
    const cookieState = cookies[COOKIE_GOOGLE_STATE];
    if (!state || !cookieState || !safeEqualText(state, cookieState)) return redirectGoogleError('google_state_invalid');
    const consumedState = await consumeGoogleState(dataStore, state, now);
    if (!consumedState) return redirectGoogleError('google_state_invalid');
    const role = roleValue(consumedState.role ?? undefined);
    const providerError = url.searchParams.get('error');
    if (providerError) {
      return redirectGoogleError(providerError === 'access_denied' ? 'google_auth_cancelled' : 'google_auth_failed');
    }
    const code = url.searchParams.get('code');
    if (!code || typeof fetchImpl !== 'function') return redirectGoogleError('google_auth_failed');

    let tokenResponse;
    try {
      tokenResponse = await fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: googleConfig.clientId,
          redirect_uri: googleConfig.redirectUri,
          grant_type: 'authorization_code',
          ...(googleConfig.clientSecret ? { client_secret: googleConfig.clientSecret } : {}),
        }),
      });
      if (tokenResponse?.ok === false || (typeof tokenResponse?.status === 'number' && tokenResponse.status >= 400)) {
        throw new Error('token endpoint rejected request');
      }
      tokenResponse = await tokenResponse.json();
    } catch {
      return redirectGoogleError('google_auth_failed');
    }
    if (!tokenResponse || typeof tokenResponse.access_token !== 'string' || !tokenResponse.access_token) return redirectGoogleError('google_auth_failed');

    let identityResponse;
    try {
      identityResponse = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
      });
      if (identityResponse?.ok === false || (typeof identityResponse?.status === 'number' && identityResponse.status >= 400)) {
        throw new Error('userinfo endpoint rejected request');
      }
      identityResponse = await identityResponse.json();
    } catch {
      return redirectGoogleError('google_auth_failed');
    }
    let identity;
    try {
      identity = googleIdentity(identityResponse, googleConfig.clientId);
    } catch (error) {
      if (error instanceof HttpError && error.code === 'GOOGLE_IDENTITY_INVALID') return redirectGoogleError('google_identity_invalid');
      throw error;
    }
    let user = await dataStore.transact((data) => {
      const existing = data.users.find((item) => String(item.email || '').trim().toLowerCase() === identity.email);
      if (existing) {
        if ((existing.role || 'patient') !== role) return null;
        if (existing.googleSub && existing.googleSub !== identity.sub) throw new HttpError(409, 'GOOGLE_IDENTITY_CONFLICT', 'Google sign-in could not be completed.');
        existing.email = identity.email;
        existing.googleSub ||= identity.sub;
        addAuditEvent(data, { actorUserId: existing.id, action: 'auth.google_sign_in', entityType: 'session', outcome: 'success' }, now);
        return existing;
      }
      const created = {
        id: newId(),
        email: identity.email,
        role,
        ...(role === 'patient' ? {
          patientId: newId(),
        } : {
          doctorProfile: {
            displayName: googleDisplayName(identityResponse, identity.email),
            specialty: '',
            registrationId: '',
            organization: '',
            verificationStatus: 'pending',
            verified: false,
          },
        }),
        googleSub: identity.sub,
        createdAt: new Date(now).toISOString(),
      };
      data.users.push(created);
      data.profiles.push({ userId: created.id, ...profileValue(), updatedAt: new Date(now).toISOString() });
      addAuditEvent(data, { actorUserId: created.id, action: 'auth.google_register', entityType: 'account', entityId: created.id, outcome: 'success' }, now);
      return created;
    });
    if (!user) return redirectGoogleError('google_role_mismatch');
    const session = await createSession(dataStore, user.id, now);
    setAuthCookies(response, session.sessionToken, session.csrfToken, secureCookies);
    clearGoogleStateCookie(response, secureCookies);
    redirect(response, '/');
    return true;
  }

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
    if (existing) {
      await dataStore.transact((state) => addAuditEvent(state, { action: 'auth.register', entityType: 'account', outcome: 'failure' }, now));
      throw new HttpError(409, 'ACCOUNT_EXISTS', 'Account already exists.');
    }
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
      addAuditEvent(state, { actorUserId: user.id, action: 'auth.register', entityType: 'account', entityId: user.id, outcome: 'success' }, now);
    });
    const session = await createSession(dataStore, user.id, now);
    setAuthCookies(response, session.sessionToken, session.csrfToken, secureCookies);
    sendJson(response, 201, { user: publicUser(user), profile: publicProfile(profile, user) });
    return true;
  }
  if (isLogin && method === 'POST') {
    const body = await readJson(request);
    allowedKeys(body, ['email', 'password']);
    const email = emailValue(body.email);
    const password = passwordValue(body.password);
    const user = await dataStore.read((state) => state.users.find((item) => item.email === email));
    const valid = await verifyPassword(password, user?.passwordHash);
    if (!user || !valid) {
      await dataStore.transact((state) => addAuditEvent(state, { action: 'auth.login', entityType: 'session', outcome: 'failure' }, now));
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    }
    const session = await createSession(dataStore, user.id, now);
    await dataStore.transact((state) => addAuditEvent(state, { actorUserId: user.id, action: 'auth.login', entityType: 'session', outcome: 'success' }, now));
    setAuthCookies(response, session.sessionToken, session.csrfToken, secureCookies);
    sendJson(response, 200, { user: publicUser(user) });
    return true;
  }
  if (isLogout && method === 'POST') {
    if (auth) await dataStore.transact((state) => {
      state.sessions = state.sessions.filter((item) => item.id !== auth.session.id);
      addAuditEvent(state, { actorUserId: auth.user.id, action: 'auth.logout', entityType: 'session', entityId: auth.session.id, outcome: 'success' }, now);
    });
    clearAuthCookies(response, secureCookies);
    sendJson(response, 200, { ok: true });
    return true;
  }
  return false;
}
