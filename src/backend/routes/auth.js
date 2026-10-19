import {
  consumeGoogleState, createGoogleState, createSession, googleAuthConfigured, googleDisplayName, googleIdentity, publicUser,
} from '../auth.js';
import { COOKIE_GOOGLE_STATE } from '../constants.js';
import { HttpError } from '../errors.js';
import {
  clearAuthCookies, clearGoogleStateCookie, clearRecoveryCookie, parseCookies, readJson, redirect, sendJson,
  setAuthCookies, setGoogleStateCookie, setRecoveryCookie,
} from '../http.js';
import { publicProfile } from '../records.js';
import { addAuditEvent } from '../audit.js';
import { encryptSecret, hashPassword, newId, safeEqualText, verifyPassword } from '../security.js';
import {
  allowedKeys, doctorRegistrationValue, emailValue, passwordValue, profileValue, roleValue,
} from '../validation.js';

export async function handleAuthRoute(ctx) {
  const {
    pathname, method, request, response, dataStore, now, secureCookies, auth, url,
    googleConfig, fetchImpl, authProvider,
  } = ctx;
  const isRegister = pathname === '/api/auth/register' || pathname === '/api/register';
  const isLogin = pathname === '/api/auth/login' || pathname === '/api/login';
  const isLogout = pathname === '/api/auth/logout' || pathname === '/api/logout';
  const isGoogleStart = pathname === '/api/auth/google';
  const isGoogleCallback = pathname === '/api/auth/google/callback';
  const isRecover = pathname === '/api/auth/recover';
  const isResendConfirmation = pathname === '/api/auth/resend-confirmation';
  const isConfirm = pathname === '/api/auth/confirm';
  const isPasswordUpdate = pathname === '/api/auth/password';
  const isMfa = pathname.startsWith('/api/auth/mfa');
  const isRevokeSessions = pathname === '/api/auth/sessions/revoke';
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

  if (isConfirm && method === 'GET') {
    if (!authProvider?.enabled) return redirect(response, '/?error=email_auth_unavailable');
    const tokenHash = url.searchParams.get('token_hash');
    const type = url.searchParams.get('type');
    if (!tokenHash || !['email', 'recovery'].includes(type)) return redirect(response, '/?error=auth_link_invalid');
    try {
      const verified = await authProvider.verify(tokenHash, type);
      const supabaseUser = verified.user;
      const user = await dataStore.read((state) => state.users.find((item) => item.supabaseUserId === supabaseUser?.id || item.email === supabaseUser?.email));
      if (!user) return redirect(response, '/?error=account_not_found');
      if (type === 'recovery') {
        const session = await createSession(dataStore, user.id, now, { recoveryOnly: true });
        setAuthCookies(response, session.sessionToken, session.csrfToken, secureCookies);
        setRecoveryCookie(response, verified.access_token, secureCookies);
        return redirect(response, '/?recovery=1');
      }
      await dataStore.transact((state) => {
        const current = state.users.find((item) => item.id === user.id);
        if (current) current.emailConfirmedAt = new Date(now).toISOString();
      });
      const session = await createSession(dataStore, user.id, now);
      setAuthCookies(response, session.sessionToken, session.csrfToken, secureCookies);
      return redirect(response, '/?confirmed=1');
    } catch {
      return redirect(response, '/?error=auth_link_invalid');
    }
  }

  if (isRecover && method === 'POST') {
    const body = await readJson(request);
    allowedKeys(body, ['email']);
    const email = emailValue(body.email);
    if (authProvider?.enabled) {
      try { await authProvider.recover(email); } catch { /* generic response prevents account enumeration */ }
    }
    sendJson(response, 200, { ok: true, message: 'If an account exists, recovery instructions were sent.' });
    return true;
  }

  if (isResendConfirmation && method === 'POST') {
    const body = await readJson(request);
    allowedKeys(body, ['email']);
    const email = emailValue(body.email);
    if (authProvider?.enabled) {
      try { await authProvider.resendConfirmation(email); } catch { /* generic response */ }
    }
    sendJson(response, 200, { ok: true, message: 'If the account exists, confirmation instructions were sent.' });
    return true;
  }

  if (isPasswordUpdate && method === 'POST') {
    if (!auth?.session?.recoveryOnly) throw new HttpError(403, 'RECOVERY_REQUIRED', 'Password recovery session required.');
    const body = await readJson(request);
    allowedKeys(body, ['password']);
    const password = passwordValue(body.password);
    const recoveryToken = parseCookies(request.headers.cookie).mh_recovery;
    if (!authProvider?.enabled || !recoveryToken) throw new HttpError(403, 'RECOVERY_INVALID', 'Password recovery session is invalid.');
    await authProvider.updatePassword(recoveryToken, password);
    await dataStore.transact((state) => {
      state.sessions = state.sessions.filter((item) => item.userId !== auth.user.id);
      const user = state.users.find((item) => item.id === auth.user.id);
      if (user) user.emailConfirmedAt ||= new Date(now).toISOString();
    });
    clearAuthCookies(response, secureCookies);
    clearRecoveryCookie(response, secureCookies);
    sendJson(response, 200, { ok: true, message: 'Password updated. Sign in again to continue.' });
    return true;
  }

  if (isMfa && authProvider?.enabled) {
    if (method === 'GET' && pathname === '/api/auth/mfa') {
      if (!auth?.upstreamTokens?.access_token) throw new HttpError(403, 'MFA_SESSION_REQUIRED', 'MFA session is unavailable.');
      sendJson(response, 200, await authProvider.factors(auth.upstreamTokens.access_token));
      return true;
    }
    if (method === 'POST' && pathname === '/api/auth/mfa/enroll') {
      if (!auth || auth.session.recoveryOnly || auth.session.mfaPending || !auth.upstreamTokens?.access_token) throw new HttpError(403, 'MFA_SESSION_REQUIRED', 'A verified session is required.');
      const factor = await authProvider.enrollFactor(auth.upstreamTokens.access_token);
      await dataStore.transact((state) => { const session = state.sessions.find((item) => item.id === auth.session.id); if (session) session.mfaPendingFactorId = factor.id; });
      sendJson(response, 201, { factor: { id: factor.id, type: factor.type, totp: factor.totp } });
      return true;
    }
    if (method === 'POST' && pathname === '/api/auth/mfa/enroll/verify') {
      if (!auth || !auth.session.mfaPendingFactorId || !auth.upstreamTokens?.access_token) throw new HttpError(403, 'MFA_ENROLLMENT_REQUIRED', 'Start MFA enrollment first.');
      const body = await readJson(request); allowedKeys(body, ['code']);
      const challenge = await authProvider.challengeFactor(auth.upstreamTokens.access_token, auth.session.mfaPendingFactorId);
      const verified = await authProvider.verifyFactor(auth.upstreamTokens.access_token, auth.session.mfaPendingFactorId, challenge.id, stringValue(body.code, 'code', { required: true, min: 6, max: 8 }));
      await dataStore.transact((state) => { const session = state.sessions.find((item) => item.id === auth.session.id); if (session) { delete session.mfaPendingFactorId; session.upstreamTokens = auth.session.upstreamTokens; } });
      sendJson(response, 200, { ok: true, session: verified });
      return true;
    }
    if (method === 'POST' && pathname === '/api/auth/mfa/verify') {
      if (!auth?.session?.mfaPending || !auth.session.mfaFactorId || !auth.session.mfaChallengeId || !auth.upstreamTokens?.access_token) throw new HttpError(403, 'MFA_REQUIRED', 'MFA verification is not pending.');
      const body = await readJson(request); allowedKeys(body, ['code']);
      const verified = await authProvider.verifyFactor(auth.upstreamTokens.access_token, auth.session.mfaFactorId, auth.session.mfaChallengeId, stringValue(body.code, 'code', { required: true, min: 6, max: 8 }));
      await dataStore.transact((state) => {
        const session = state.sessions.find((item) => item.id === auth.session.id);
        if (session) { session.mfaPending = false; delete session.mfaFactorId; delete session.mfaChallengeId; if (verified.access_token && verified.refresh_token) session.upstreamTokens = encryptSecret(JSON.stringify(verified)); }
      });
      sendJson(response, 200, { ok: true });
      return true;
    }
    if (method === 'DELETE') {
      const factorId = pathname.split('/').at(-1);
      if (!auth?.upstreamTokens?.access_token || !factorId) throw new HttpError(403, 'MFA_SESSION_REQUIRED', 'A verified session is required.');
      await authProvider.unenrollFactor(auth.upstreamTokens.access_token, factorId);
      sendJson(response, 200, { ok: true });
      return true;
    }
  }

  if (isRevokeSessions && method === 'POST') {
    if (!auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required.');
    await dataStore.transact((state) => { state.sessions = state.sessions.filter((item) => item.userId !== auth.user.id); });
    clearAuthCookies(response, secureCookies);
    sendJson(response, 200, { ok: true });
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
    if (authProvider?.enabled) {
      const upstream = await authProvider.signUp(email, password, role);
      const user = {
        id: newId(), email, role, supabaseUserId: upstream.user?.id,
        ...(role === 'patient' ? { patientId: newId() } : { doctorProfile }),
        ...(upstream.user?.email_confirmed_at ? { emailConfirmedAt: upstream.user.email_confirmed_at } : {}),
        createdAt: new Date(now).toISOString(),
      };
      await dataStore.transact((state) => {
        state.users.push(user);
        state.profiles.push({ userId: user.id, ...profile, updatedAt: new Date(now).toISOString() });
      });
      if (!upstream.access_token) {
        sendJson(response, 201, { pendingEmailConfirmation: true, message: 'Check your email to confirm your account before signing in.' });
        return true;
      }
      const session = await createSession(dataStore, user.id, now, { upstreamTokens: upstream });
      setAuthCookies(response, session.sessionToken, session.csrfToken, secureCookies);
      sendJson(response, 201, { user: publicUser(user), profile: publicProfile(profile, user) });
      return true;
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
    if (authProvider?.enabled) {
      let upstream;
      try { upstream = await authProvider.signIn(email, password); } catch { throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email, password, or email confirmation.'); }
      const user = await dataStore.read((state) => state.users.find((item) => item.supabaseUserId === upstream.user?.id || item.email === email));
      if (!user) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
      const session = await createSession(dataStore, user.id, now, { upstreamTokens: upstream });
      let mfaRequired = false;
      try {
        const factors = await authProvider.factors(upstream.access_token);
        const verifiedFactor = (factors?.all || factors || []).find((factor) => factor.status === 'verified');
        if (verifiedFactor) {
          const challenge = await authProvider.challengeFactor(upstream.access_token, verifiedFactor.id);
          await dataStore.transact((state) => { const item = state.sessions.find((entry) => entry.id === session.sessionId); if (item) { item.mfaPending = true; item.mfaFactorId = verifiedFactor.id; item.mfaChallengeId = challenge.id; } });
          mfaRequired = true;
        }
      } catch { /* MFA remains optional when provider factor APIs are unavailable */ }
      setAuthCookies(response, session.sessionToken, session.csrfToken, secureCookies);
      sendJson(response, 200, { user: publicUser(user), mfaRequired });
      return true;
    }
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
    if (authProvider?.enabled && auth?.upstreamTokens?.access_token) {
      try { await authProvider.signOut(auth.upstreamTokens.access_token); } catch { /* local session is still revoked */ }
    }
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
