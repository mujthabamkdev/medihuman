import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestServer } from '../src/backend/api.js';

async function startServer(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'medihuman-test-'));
  const server = await createTestServer({ dataFile: join(directory, 'data.json'), secureCookies: false, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}`, dataFile: join(directory, 'data.json') };
}

function cookieHeader(setCookie) {
  return [...String(setCookie || '').matchAll(/(?:^|, )([^=;,]+)=([^;,]*)/g)]
    .map((match) => `${match[1]}=${match[2]}`)
    .join('; ');
}

async function request(baseUrl, path, { cookie = '', csrf = '', ...options } = {}) {
  const headers = new Headers(options.headers);
  if (cookie) headers.set('cookie', cookie);
  if (csrf) headers.set('x-csrf-token', csrf);
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null, setCookie: response.headers.get('set-cookie') || '' };
}

async function registerAccount(baseUrl, email, registration) {
  const csrfResponse = await request(baseUrl, '/api/csrf');
  const preAuthCookie = cookieHeader(csrfResponse.setCookie);
  const registered = await request(baseUrl, '/api/auth/register', {
    cookie: preAuthCookie,
    csrf: csrfResponse.body.csrfToken,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct horse battery staple', ...registration }),
  });
  assert.equal(registered.response.status, 201);
  const cookie = cookieHeader(registered.setCookie);
  const rotated = await request(baseUrl, '/api/csrf', { cookie });
  const csrf = rotated.body.csrfToken;
  return { body: registered.body, csrf, cookie: cookie.replace(/mh_csrf=[^;]+/, `mh_csrf=${csrf}`) };
}

test('auth uses scrypt, HttpOnly cookies, CSRF, and stores no raw password', async (t) => {
  const context = await startServer();
  t.after(() => context.server.close());

  const csrfResponse = await request(context.baseUrl, '/api/csrf');
  const csrf = csrfResponse.body.csrfToken;
  const preAuthCookie = cookieHeader(csrfResponse.setCookie);
  assert.match(csrfResponse.setCookie, /mh_csrf=/);

  const blocked = await request(context.baseUrl, '/api/auth/register', {
    cookie: preAuthCookie,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'person@example.com', password: 'correct horse battery staple' }),
  });
  assert.equal(blocked.response.status, 403);

  const registered = await request(context.baseUrl, '/api/auth/register', {
    cookie: preAuthCookie,
    csrf,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'Person@Example.com',
      password: 'correct horse battery staple',
      profile: { fullName: 'Test Patient', allergies: 'penicillin' },
    }),
  });
  assert.equal(registered.response.status, 201);
  assert.match(registered.setCookie, /mh_session=.*HttpOnly/);
  const cookie = cookieHeader(registered.setCookie);

  const rotatedCsrfResponse = await request(context.baseUrl, '/api/csrf', { cookie });
  const rotatedCsrf = rotatedCsrfResponse.body.csrfToken;
  const rotatedCookie = cookie.replace(/mh_csrf=[^;]+/, `mh_csrf=${rotatedCsrf}`);
  const profileUpdate = await request(context.baseUrl, '/api/patient/profile', {
    cookie: rotatedCookie,
    csrf: rotatedCsrf,
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: 'Rotated Token Patient' }),
  });
  assert.equal(profileUpdate.response.status, 200);

  const me = await request(context.baseUrl, '/api/me', { cookie: rotatedCookie });
  assert.equal(me.response.status, 200);
  assert.equal(me.body.user.email, 'person@example.com');
  assert.equal(me.body.profile.allergies, 'penicillin');

  const noCsrf = await request(context.baseUrl, '/api/patient/medicines', {
    cookie: rotatedCookie,
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ medicines: ['Metformin 500 mg'] }),
  });
  assert.equal(noCsrf.response.status, 403);

  const authenticatedCsrf = rotatedCsrf;
  const medicines = await request(context.baseUrl, '/api/patient/medicines', {
    cookie: rotatedCookie,
    csrf: authenticatedCsrf,
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ medicines: ['Metformin 500 mg', 'Lisinopril 10 mg'] }),
  });
  assert.equal(medicines.response.status, 200);
  assert.equal(medicines.body.medicines.length, 2);

  const prescription = await request(context.baseUrl, '/api/prescriptions', {
    cookie: rotatedCookie,
    csrf: authenticatedCsrf,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ medicationName: 'Metformin', strength: '500 mg', frequency: 'daily' }),
  });
  assert.equal(prescription.response.status, 201);

  const updatedPrescription = await request(context.baseUrl, `/api/prescriptions/${prescription.body.prescription.id}`, {
    cookie: rotatedCookie,
    csrf: authenticatedCsrf,
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instructions: 'Take with food.' }),
  });
  assert.equal(updatedPrescription.response.status, 200);
  assert.equal(updatedPrescription.body.prescription.medicationName, 'Metformin');
  assert.equal(updatedPrescription.body.prescription.instructions, 'Take with food.');

  const reconciliation = await request(context.baseUrl, '/api/reconciliations', {
    cookie: rotatedCookie,
    csrf: authenticatedCsrf,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prescriptionMedicines: ['Metformin 500 mg'], dispensedMedicines: ['Ibuprofen 200 mg'] }),
  });
  assert.equal(reconciliation.response.status, 201);
  assert.equal(reconciliation.body.reconciliation.missing[0].name, 'Metformin 500 mg');

  const updatedReconciliation = await request(context.baseUrl, `/api/reconciliations/${reconciliation.body.reconciliation.id}`, {
    cookie: rotatedCookie,
    csrf: authenticatedCsrf,
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dispensedMedicines: ['Metformin 500 mg'] }),
  });
  assert.equal(updatedReconciliation.response.status, 200);
  assert.equal(updatedReconciliation.body.reconciliation.isExactMatch, true);

  const deletedReconciliation = await request(context.baseUrl, `/api/reconciliations/${reconciliation.body.reconciliation.id}`, {
    cookie: rotatedCookie,
    csrf: authenticatedCsrf,
    method: 'DELETE',
  });
  assert.equal(deletedReconciliation.response.status, 200);
  const deletedReconciliationRead = await request(context.baseUrl, `/api/reconciliations/${reconciliation.body.reconciliation.id}`, { cookie: rotatedCookie });
  assert.equal(deletedReconciliationRead.response.status, 404);

  const consent = await request(context.baseUrl, '/api/patient/consent', {
    cookie: rotatedCookie,
    csrf: authenticatedCsrf,
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accepted: true, version: 'v1' }),
  });
  assert.equal(consent.response.status, 200);
  const exported = await request(context.baseUrl, '/api/account/export', { cookie: rotatedCookie });
  assert.equal(exported.response.status, 200);
  assert.equal(exported.body.user.email, 'person@example.com');

  const storedBeforeAccountDelete = JSON.parse(await readFile(context.dataFile, 'utf8'));
  assert.equal(storedBeforeAccountDelete.users[0].passwordHash.algorithm, 'scrypt');
  assert.equal(JSON.stringify(storedBeforeAccountDelete).includes('correct horse battery staple'), false);
  assert.equal(JSON.stringify(storedBeforeAccountDelete).includes(cookie), false);
  assert.ok(storedBeforeAccountDelete.auditLogs.some((event) => event.action === 'auth.register' && event.outcome === 'success'));
  assert.ok(storedBeforeAccountDelete.auditLogs.some((event) => event.action === 'record.profile_update'));
  assert.ok(storedBeforeAccountDelete.auditLogs.some((event) => event.action === 'record.reconciliation_create'));

  const deletedAccount = await request(context.baseUrl, '/api/account', {
    cookie: rotatedCookie,
    csrf: authenticatedCsrf,
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmation: 'DELETE MY ACCOUNT' }),
  });
  assert.equal(deletedAccount.response.status, 200);
  const afterAccountDelete = await request(context.baseUrl, '/api/me', { cookie: rotatedCookie });
  assert.equal(afterAccountDelete.response.status, 401);

  const storedAfterAccountDelete = JSON.parse(await readFile(context.dataFile, 'utf8'));
  assert.equal(storedAfterAccountDelete.users.length, 0);
});

test('invalid JSON and login failures return safe JSON errors', async (t) => {
  const context = await startServer();
  t.after(() => context.server.close());
  const csrfResponse = await request(context.baseUrl, '/api/csrf');
  const csrf = csrfResponse.body.csrfToken;
  const cookie = cookieHeader(csrfResponse.setCookie);
  const invalid = await request(context.baseUrl, '/api/auth/login', {
    cookie,
    csrf,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not-json',
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error.code, 'INVALID_JSON');
  assert.equal(invalid.body.stack, undefined);

  const login = await request(context.baseUrl, '/api/auth/login', {
    cookie,
    csrf,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'nobody@example.com', password: 'correct horse battery staple' }),
  });
  assert.equal(login.response.status, 401);
  assert.equal(login.body.error.message, 'Invalid email or password.');
});

test('Google OAuth stays disabled without configuration and rejects mismatched or expired state', async (t) => {
  const disabled = await startServer({ google: { clientId: '', redirectUri: '' } });
  t.after(() => disabled.server.close());
  const unavailable = await request(disabled.baseUrl, '/api/auth/google', { redirect: 'manual' });
  assert.equal(unavailable.response.status, 404);
  assert.equal(unavailable.body.error.code, 'GOOGLE_AUTH_UNAVAILABLE');

  let now = Date.now();
  const context = await startServer({
    clock: () => now,
    google: { clientId: 'client-id', clientSecret: 'client-secret', redirectUri: 'http://localhost/api/auth/google/callback' },
  });
  t.after(() => context.server.close());
  const started = await request(context.baseUrl, '/api/auth/google', { redirect: 'manual' });
  assert.equal(started.response.status, 302);
  const authorization = new URL(started.response.headers.get('location'));
  const cookie = cookieHeader(started.setCookie);
  assert.match(started.setCookie, /mh_google_state=.*HttpOnly/);
  assert.match(started.setCookie, /SameSite=Lax/);
  const startedState = JSON.parse(await readFile(context.dataFile, 'utf8'));
  assert.equal(startedState.oauthStates[0].role, 'patient');

  const invalidRole = await request(context.baseUrl, '/api/auth/google?role=admin', { redirect: 'manual' });
  assert.equal(invalidRole.response.status, 400);
  assert.equal(invalidRole.body.error.code, 'INVALID_FIELD');

  const mismatch = await request(context.baseUrl, `/api/auth/google/callback?code=code&state=wrong`, {
    cookie,
    redirect: 'manual',
  });
  assert.equal(mismatch.response.status, 302);
  assert.equal(mismatch.response.headers.get('location'), '/?error=google_state_invalid');

  const secondStart = await request(context.baseUrl, '/api/auth/google', { redirect: 'manual' });
  const secondAuthorization = new URL(secondStart.response.headers.get('location'));
  const secondCookie = cookieHeader(secondStart.setCookie);
  now += 10 * 60 * 1000;
  const expired = await request(context.baseUrl, `/api/auth/google/callback?code=code&state=${secondAuthorization.searchParams.get('state')}`, {
    cookie: secondCookie,
    redirect: 'manual',
  });
  assert.equal(expired.response.status, 302);
  assert.equal(expired.response.headers.get('location'), '/?error=google_state_invalid');
  assert.equal(authorization.searchParams.get('client_id'), 'client-id');
});

test('Google OAuth handles provider failures, creates passwordless patients, and links normalized emails', async (t) => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/token')) return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant', access_token: 'provider-token' }) };
    throw new Error('userinfo should not be called after token failure');
  };
  const context = await startServer({
    google: { clientId: 'client-id', clientSecret: 'client-secret', redirectUri: 'http://localhost/api/auth/google/callback' },
    fetchImpl,
  });
  t.after(() => context.server.close());

  const started = await request(context.baseUrl, '/api/auth/google', { redirect: 'manual' });
  const authorization = new URL(started.response.headers.get('location'));
  const cookie = cookieHeader(started.setCookie);
  const failed = await request(context.baseUrl, `/api/auth/google/callback?code=provider-code&state=${authorization.searchParams.get('state')}`, {
    cookie,
    redirect: 'manual',
  });
  assert.equal(failed.response.status, 302);
  assert.equal(failed.response.headers.get('location'), '/?error=google_auth_failed');
  assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token');

  const successfulCalls = [];
  let providerIdentityEmail = ' New.User@Example.com ';
  let providerIdentityVerified = true;
  const successfulFetch = async (url, options) => {
    successfulCalls.push({ url, options });
    if (url.endsWith('/token')) return { ok: true, json: async () => ({ access_token: 'raw-access-token', id_token: 'raw-id-token' }) };
    return {
      ok: true,
      json: async () => ({ sub: 'google-sub-1', email: providerIdentityEmail, email_verified: providerIdentityVerified }),
    };
  };
  const configured = await startServer({
    google: { clientId: 'client-id', clientSecret: 'client-secret', redirectUri: 'http://localhost/api/auth/google/callback' },
    fetchImpl: successfulFetch,
  });
  t.after(() => configured.server.close());

  const oauthStart = await request(configured.baseUrl, '/api/auth/google', { redirect: 'manual' });
  const oauthUrl = new URL(oauthStart.response.headers.get('location'));
  const oauthCookie = cookieHeader(oauthStart.setCookie);
  const callback = await request(configured.baseUrl, `/api/auth/google/callback?code=provider-code&state=${oauthUrl.searchParams.get('state')}`, {
    cookie: oauthCookie,
    redirect: 'manual',
  });
  assert.equal(callback.response.status, 302);
  assert.equal(callback.response.headers.get('location'), '/');
  assert.match(callback.setCookie, /mh_session=.*HttpOnly/);
  assert.match(callback.setCookie, /mh_csrf=/);
  assert.match(callback.setCookie, /mh_google_state=;.*Max-Age=0/);
  const patientMe = await request(configured.baseUrl, '/api/me', { cookie: cookieHeader(callback.setCookie) });
  assert.equal(patientMe.response.status, 200);
  assert.equal(patientMe.body.user.email, 'new.user@example.com');
  assert.equal(successfulCalls[1].url, 'https://openidconnect.googleapis.com/v1/userinfo');
  assert.equal(successfulCalls[1].options.headers.Authorization, 'Bearer raw-access-token');
  const replay = await request(configured.baseUrl, `/api/auth/google/callback?code=provider-code&state=${oauthUrl.searchParams.get('state')}`, {
    cookie: oauthCookie,
    redirect: 'manual',
  });
  assert.equal(replay.response.status, 302);
  assert.equal(replay.response.headers.get('location'), '/?error=google_state_invalid');

  const stored = JSON.parse(await readFile(configured.dataFile, 'utf8'));
  assert.equal(stored.users.length, 1);
  assert.equal(stored.users[0].email, 'new.user@example.com');
  assert.equal(stored.users[0].googleSub, 'google-sub-1');
  assert.match(stored.users[0].patientId, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(stored.profiles[0], {
    userId: stored.users[0].id,
    fullName: '',
    dateOfBirth: '',
    allergies: '',
    conditions: '',
    updatedAt: stored.profiles[0].updatedAt,
  });
  assert.equal(stored.users[0].passwordHash, undefined);
  assert.equal(JSON.stringify(stored).includes('raw-access-token'), false);
  assert.equal(JSON.stringify(stored).includes('raw-id-token'), false);

  const loginCsrf = await request(configured.baseUrl, '/api/csrf');
  const login = await request(configured.baseUrl, '/api/auth/login', {
    cookie: cookieHeader(loginCsrf.setCookie),
    csrf: loginCsrf.body.csrfToken,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'new.user@example.com', password: 'correct horse battery staple' }),
  });
  assert.equal(login.response.status, 401);

  const existing = await registerAccount(configured.baseUrl, 'Existing@Example.com');
  const before = JSON.parse(await readFile(configured.dataFile, 'utf8'));
  const existingPasswordHash = before.users.find((user) => user.email === 'existing@example.com').passwordHash;
  providerIdentityEmail = 'EXISTING@example.com';
  const linkedStart = await request(configured.baseUrl, '/api/auth/google', { redirect: 'manual' });
  const linkedUrl = new URL(linkedStart.response.headers.get('location'));
  const linked = await request(configured.baseUrl, `/api/auth/google/callback?code=provider-code&state=${linkedUrl.searchParams.get('state')}`, {
    cookie: cookieHeader(linkedStart.setCookie),
    redirect: 'manual',
  });
  assert.equal(linked.response.status, 302);
  assert.equal(linked.response.headers.get('location'), '/');
  const afterLink = JSON.parse(await readFile(configured.dataFile, 'utf8'));
  assert.equal(afterLink.users.length, 2);
  assert.equal(afterLink.users.find((user) => user.email === 'existing@example.com').passwordHash.hash, existingPasswordHash.hash);
  assert.equal(afterLink.users.find((user) => user.email === 'existing@example.com').googleSub, 'google-sub-1');
  assert.equal(existing.body.user.email, 'existing@example.com');

  providerIdentityVerified = false;
  const invalidIdentityStart = await request(configured.baseUrl, '/api/auth/google', { redirect: 'manual' });
  const invalidIdentityUrl = new URL(invalidIdentityStart.response.headers.get('location'));
  const invalidIdentity = await request(configured.baseUrl, `/api/auth/google/callback?code=provider-code&state=${invalidIdentityUrl.searchParams.get('state')}`, {
    cookie: cookieHeader(invalidIdentityStart.setCookie),
    redirect: 'manual',
  });
  assert.equal(invalidIdentity.response.status, 302);
  assert.equal(invalidIdentity.response.headers.get('location'), '/?error=google_identity_invalid');
});

test('Google OAuth creates doctor accounts from stored role state and ignores callback role', async (t) => {
  const calls = [];
  let providerIdentityEmail = 'doctor@example.com';
  const context = await startServer({
    google: { clientId: 'client-id', clientSecret: 'client-secret', redirectUri: 'http://localhost/api/auth/google/callback' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/token')) return { ok: true, json: async () => ({ access_token: 'doctor-access-token', id_token: 'doctor-id-token' }) };
      return {
        ok: true,
        json: async () => ({
          sub: 'doctor-google-sub',
          email: providerIdentityEmail,
          email_verified: true,
          name: 'Dr Google Example',
        }),
      };
    },
  });
  t.after(() => context.server.close());

  const started = await request(context.baseUrl, '/api/auth/google?role=doctor', { redirect: 'manual' });
  const authorization = new URL(started.response.headers.get('location'));
  const state = authorization.searchParams.get('state');
  const storedStart = JSON.parse(await readFile(context.dataFile, 'utf8'));
  assert.equal(storedStart.oauthStates[0].role, 'doctor');
  assert.equal(authorization.searchParams.get('role'), null);

  const callback = await request(context.baseUrl, `/api/auth/google/callback?code=provider-code&state=${state}&role=patient`, {
    cookie: cookieHeader(started.setCookie),
    redirect: 'manual',
  });
  assert.equal(callback.response.status, 302);
  assert.equal(callback.response.headers.get('location'), '/');
  const doctorMe = await request(context.baseUrl, '/api/me', { cookie: cookieHeader(callback.setCookie) });
  assert.equal(doctorMe.response.status, 200);
  assert.equal(doctorMe.body.user.email, 'doctor@example.com');
  assert.equal(doctorMe.body.user.role, 'doctor');

  const stored = JSON.parse(await readFile(context.dataFile, 'utf8'));
  assert.equal(stored.users.length, 1);
  assert.deepEqual(stored.users[0].doctorProfile, {
    displayName: 'Dr Google Example',
    specialty: '',
    registrationId: '',
    organization: '',
    verificationStatus: 'pending',
    verified: false,
  });
  assert.equal(stored.users[0].role, 'doctor');
  assert.equal(stored.users[0].patientId, undefined);
  assert.equal(stored.users[0].passwordHash, undefined);
  assert.equal(JSON.stringify(stored).includes('doctor-access-token'), false);
  assert.equal(JSON.stringify(stored).includes('doctor-id-token'), false);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer doctor-access-token');

  const mismatchStart = await request(context.baseUrl, '/api/auth/google?role=patient', { redirect: 'manual' });
  const mismatchUrl = new URL(mismatchStart.response.headers.get('location'));
  const mismatch = await request(context.baseUrl, `/api/auth/google/callback?code=provider-code&state=${mismatchUrl.searchParams.get('state')}&role=doctor`, {
    cookie: cookieHeader(mismatchStart.setCookie),
    redirect: 'manual',
  });
  assert.equal(mismatch.response.status, 302);
  assert.equal(mismatch.response.headers.get('location'), '/?error=google_role_mismatch');
  assert.equal(providerIdentityEmail, 'doctor@example.com');
  const afterMismatch = JSON.parse(await readFile(context.dataFile, 'utf8'));
  assert.equal(afterMismatch.users.length, 1);
  assert.equal(afterMismatch.users[0].googleSub, 'doctor-google-sub');
});

test('role-scoped access requests require patient approval before doctor reads records', async (t) => {
  const context = await startServer({ clinicianAdminKey: 'test-clinician-admin-key' });
  t.after(() => context.server.close());
  const patient = await registerAccount(context.baseUrl, 'patient@example.com', {
    profile: { fullName: 'Scoped Patient', allergies: 'penicillin' },
  });
  const doctor = await registerAccount(context.baseUrl, 'doctor@example.com', {
    role: 'doctor',
    displayName: 'Dr. Example',
    specialty: 'Pharmacy',
    registrationId: 'REG-123',
    organization: 'Example Clinic',
  });

  assert.equal(patient.body.user.role, 'patient');
  assert.match(patient.body.user.patientId, /^[0-9a-f-]{36}$/i);
  assert.equal(patient.body.profile.patientId, patient.body.user.patientId);
  assert.equal(doctor.body.user.role, 'doctor');
  assert.equal(doctor.body.user.doctor.verificationStatus, 'pending');
  assert.equal(doctor.body.user.doctor.verified, false);
  assert.equal(doctor.body.user.doctor.registrationId, undefined);

  const forbiddenPatientRoute = await request(context.baseUrl, '/api/patient/profile', { cookie: doctor.cookie });
  assert.equal(forbiddenPatientRoute.response.status, 403);

  const blockedRequest = await request(context.baseUrl, '/api/doctor/access-requests', {
    cookie: doctor.cookie,
    csrf: doctor.csrf,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ patientId: patient.body.user.patientId }),
  });
  assert.equal(blockedRequest.response.status, 403);
  assert.equal(blockedRequest.body.error.code, 'CLINICIAN_VERIFICATION_REQUIRED');

  const adminCsrfResponse = await request(context.baseUrl, '/api/csrf');
  const adminCookie = cookieHeader(adminCsrfResponse.setCookie);
  const verifyDoctor = await request(context.baseUrl, `/api/admin/clinicians/${doctor.body.user.id}/verification`, {
    cookie: adminCookie,
    csrf: adminCsrfResponse.body.csrfToken,
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-key': 'test-clinician-admin-key' },
    body: JSON.stringify({ status: 'verified' }),
  });
  assert.equal(verifyDoctor.response.status, 200);
  assert.equal(verifyDoctor.body.user.doctor.verificationStatus, 'verified');

  const requestAccess = await request(context.baseUrl, '/api/doctor/access-requests', {
    cookie: doctor.cookie,
    csrf: doctor.csrf,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ patientId: patient.body.user.patientId }),
  });
  assert.equal(requestAccess.response.status, 201);
  const requestId = requestAccess.body.request.id;

  const beforeApproval = await request(context.baseUrl, `/api/doctor/patients/${patient.body.user.patientId}/profile`, { cookie: doctor.cookie });
  assert.equal(beforeApproval.response.status, 403);
  assert.equal(beforeApproval.body.error.code, 'PATIENT_ACCESS_REQUIRED');

  const saveMedicines = await request(context.baseUrl, '/api/patient/medicines', {
    cookie: patient.cookie,
    csrf: patient.csrf,
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ medicines: ['Metformin 500 mg'] }),
  });
  assert.equal(saveMedicines.response.status, 200);
  const savePrescription = await request(context.baseUrl, '/api/prescriptions', {
    cookie: patient.cookie,
    csrf: patient.csrf,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ medicationName: 'Metformin', strength: '500 mg', frequency: 'daily' }),
  });
  assert.equal(savePrescription.response.status, 201);
  const saveReconciliation = await request(context.baseUrl, '/api/reconciliations', {
    cookie: patient.cookie,
    csrf: patient.csrf,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prescriptionMedicines: ['Metformin 500 mg'], dispensedMedicines: ['Metformin 500 mg'] }),
  });
  assert.equal(saveReconciliation.response.status, 201);

  const patientRequests = await request(context.baseUrl, '/api/patient/access-requests', { cookie: patient.cookie });
  assert.equal(patientRequests.response.status, 200);
  assert.equal(patientRequests.body.requests[0].status, 'pending');

  const approve = await request(context.baseUrl, `/api/patient/access-requests/${requestId}/approve`, {
    cookie: patient.cookie,
    csrf: patient.csrf,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(approve.response.status, 200);
  assert.equal(approve.body.request.status, 'approved');

  const updateAfterApproval = await request(context.baseUrl, '/api/patient/profile', {
    cookie: patient.cookie,
    csrf: patient.csrf,
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: 'Scoped Patient Updated', allergies: 'penicillin' }),
  });
  assert.equal(updateAfterApproval.response.status, 200);
  const doctorNotifications = await request(context.baseUrl, '/api/notifications', { cookie: doctor.cookie });
  assert.equal(doctorNotifications.response.status, 200);
  assert.equal(doctorNotifications.body.notifications[0].title, 'Patient profile updated');
  const markRead = await request(context.baseUrl, `/api/notifications/${doctorNotifications.body.notifications[0].id}/read`, {
    cookie: doctor.cookie,
    csrf: doctor.csrf,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(markRead.response.status, 200);
  assert.ok(markRead.body.notification.readAt);

  const addIndication = await request(context.baseUrl, `/api/doctor/patients/${patient.body.user.patientId}/indications`, {
    cookie: doctor.cookie,
    csrf: doctor.csrf,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Confirm timing with pharmacist', detail: 'Review timing against the dispensing label.', severity: 'review' }),
  });
  assert.equal(addIndication.response.status, 201);
  assert.equal(addIndication.body.indication.title, 'Confirm timing with pharmacist');
  const patientIndications = await request(context.baseUrl, '/api/indications', { cookie: patient.cookie });
  assert.equal(patientIndications.response.status, 200);
  assert.equal(patientIndications.body.indications[0].doctor.displayName, 'Dr. Example');
  const patientNotifications = await request(context.baseUrl, '/api/notifications', { cookie: patient.cookie });
  assert.equal(patientNotifications.response.status, 200);
  assert.equal(patientNotifications.body.notifications[0].title, 'New clinician indication');

  const doctorRequests = await request(context.baseUrl, '/api/doctor/access-requests', { cookie: doctor.cookie });
  assert.equal(doctorRequests.body.requests[0].status, 'approved');
  const approvedProfile = await request(context.baseUrl, `/api/doctor/patients/${patient.body.user.patientId}/profile`, { cookie: doctor.cookie });
  assert.equal(approvedProfile.response.status, 200);
  assert.equal(approvedProfile.body.profile.fullName, 'Scoped Patient Updated');
  const approvedMedicines = await request(context.baseUrl, `/api/doctor/patients/${patient.body.user.patientId}/medicines`, { cookie: doctor.cookie });
  assert.deepEqual(approvedMedicines.body.medicines.map((medicine) => medicine.name), ['Metformin 500 mg']);
  const approvedPrescriptions = await request(context.baseUrl, `/api/doctor/patients/${patient.body.user.patientId}/prescriptions`, { cookie: doctor.cookie });
  assert.equal(approvedPrescriptions.body.prescriptions[0].medicationName, 'Metformin');
  const approvedReconciliations = await request(context.baseUrl, `/api/doctor/patients/${patient.body.user.patientId}/reconciliations`, { cookie: doctor.cookie });
  assert.equal(approvedReconciliations.body.reconciliations[0].isExactMatch, true);

  const summary = await request(context.baseUrl, '/api/summary', { cookie: patient.cookie });
  assert.equal(summary.response.status, 200);
  assert.equal(summary.body.summary.method, 'rule-based');
  assert.equal(summary.body.summary.isAiGenerated, false);
  assert.match(summary.body.summary.disclaimer, /not AI/i);
  assert.match(summary.body.summary.disclaimer, /not.*diagnos/i);

  const revoke = await request(context.baseUrl, `/api/patient/access-requests/${requestId}/revoke`, {
    cookie: patient.cookie,
    csrf: patient.csrf,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(revoke.response.status, 200);
  const afterRevoke = await request(context.baseUrl, `/api/doctor/patients/${patient.body.user.patientId}/profile`, { cookie: doctor.cookie });
  assert.equal(afterRevoke.response.status, 403);

  const repeatRequest = await request(context.baseUrl, `/api/doctor/access-requests/${patient.body.user.patientId}`, {
    cookie: doctor.cookie,
    csrf: doctor.csrf,
    method: 'POST',
  });
  assert.equal(repeatRequest.response.status, 201);
  const reject = await request(context.baseUrl, `/api/patient/access-requests/${repeatRequest.body.request.id}`, {
    cookie: patient.cookie,
    csrf: patient.csrf,
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'rejected' }),
  });
  assert.equal(reject.response.status, 200);
  assert.equal(reject.body.request.status, 'rejected');
});

test('normalizes version 1 state with patient defaults and access request collection', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'medihuman-migration-test-'));
  const dataFile = join(directory, 'data.json');
  await writeFile(dataFile, JSON.stringify({
    version: 1,
    users: [{ id: 'legacy-user', email: 'legacy@example.com', createdAt: '2025-01-01T00:00:00.000Z' }],
    sessions: [],
    profiles: [{ userId: 'legacy-user', fullName: 'Legacy Patient' }],
    medicines: [],
    prescriptions: [],
    reconciliations: [],
  }));
  const server = await createTestServer({ dataFile, secureCookies: false });
  t.after(() => server.close());
  const migrated = JSON.parse(await readFile(dataFile, 'utf8'));
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.accessRequests, []);
  assert.equal(migrated.users[0].role, 'patient');
  assert.match(migrated.users[0].patientId, /^[0-9a-f-]{36}$/i);
});
