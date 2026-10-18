import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestServer } from '../src/backend/api.js';

async function startServer() {
  const directory = await mkdtemp(join(tmpdir(), 'medihuman-test-'));
  const server = await createTestServer({ dataFile: join(directory, 'data.json'), secureCookies: false });
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

  const reconciliation = await request(context.baseUrl, '/api/reconciliations', {
    cookie: rotatedCookie,
    csrf: authenticatedCsrf,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prescriptionMedicines: ['Metformin 500 mg'], dispensedMedicines: ['Ibuprofen 200 mg'] }),
  });
  assert.equal(reconciliation.response.status, 201);
  assert.equal(reconciliation.body.reconciliation.missing[0].name, 'Metformin 500 mg');

  const stored = JSON.parse(await readFile(context.dataFile, 'utf8'));
  assert.equal(stored.users[0].passwordHash.algorithm, 'scrypt');
  assert.equal(JSON.stringify(stored).includes('correct horse battery staple'), false);
  assert.equal(JSON.stringify(stored).includes(cookie), false);
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

test('role-scoped access requests require patient approval before doctor reads records', async (t) => {
  const context = await startServer();
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

  const doctorRequests = await request(context.baseUrl, '/api/doctor/access-requests', { cookie: doctor.cookie });
  assert.equal(doctorRequests.body.requests[0].status, 'approved');
  const approvedProfile = await request(context.baseUrl, `/api/doctor/patients/${patient.body.user.patientId}/profile`, { cookie: doctor.cookie });
  assert.equal(approvedProfile.response.status, 200);
  assert.equal(approvedProfile.body.profile.fullName, 'Scoped Patient');
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
