import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
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
