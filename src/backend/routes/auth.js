import { createSession, publicUser } from '../auth.js';
import { HttpError } from '../errors.js';
import { clearAuthCookies, readJson, sendJson, setAuthCookies } from '../http.js';
import { publicProfile } from '../records.js';
import { hashPassword, newId, verifyPassword } from '../security.js';
import {
  allowedKeys, doctorRegistrationValue, emailValue, passwordValue, profileValue, roleValue,
} from '../validation.js';

export async function handleAuthRoute(ctx) {
  const { pathname, method, request, response, dataStore, now, secureCookies, auth } = ctx;
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
    return true;
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
    return true;
  }
  if (isLogout && method === 'POST') {
    if (auth) await dataStore.transact((state) => { state.sessions = state.sessions.filter((item) => item.id !== auth.session.id); });
    clearAuthCookies(response, secureCookies);
    sendJson(response, 200, { ok: true });
    return true;
  }
  return false;
}
