/**
 * File upload validation and record creation with a file reference.
 * Covers both the browser-side guard and the server-side guard.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestServer } from '../src/backend/api.js';
import { JsonDataStore } from '../src/backend/store.js';
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, validateFile } from '../src/client/file-upload.js';
import { ALLOWED_UPLOAD_TYPES as SERVER_TYPES, MAX_UPLOAD_BYTES as SERVER_MAX, storageAvailable, validateUpload } from '../src/backend/blob.js';

test('client file validation rejects wrong type, empty and oversized files', () => {
  assert.equal(validateFile(null), 'Choose a file to upload.');
  assert.equal(validateFile({ size: 0, type: 'application/pdf' }), 'That file is empty.');
  assert.equal(validateFile({ size: 10, type: 'application/x-msdownload' }), 'Only PDF, JPEG, PNG, WebP, HEIC, and plain text files are accepted.');
  assert.equal(validateFile({ size: MAX_UPLOAD_BYTES + 1, type: 'application/pdf' }), 'Files must be 4 MB or smaller.');
  assert.equal(validateFile({ size: 1024, type: 'application/pdf' }), '');
  assert.equal(validateFile({ size: 1024, type: 'image/png' }), '');
});

test('client and server upload rules stay in sync', () => {
  assert.deepEqual([...ALLOWED_UPLOAD_TYPES].sort(), [...SERVER_TYPES].sort());
  assert.equal(MAX_UPLOAD_BYTES, SERVER_MAX);
});

test('server upload validation mirrors the client rules', () => {
  assert.throws(() => validateUpload(null), /file upload is required/);
  assert.throws(() => validateUpload({ size: 0, type: 'application/pdf' }), /empty/);
  assert.throws(() => validateUpload({ size: 2048, type: 'application/x-msdownload' }), /accepted/);
  assert.throws(() => validateUpload({ size: SERVER_MAX + 1, type: 'application/pdf' }), /4 MB or smaller/);
  const ok = validateUpload({ size: 2048, type: 'application/pdf' });
  assert.equal(ok.size, 2048);
  assert.equal(ok.mimeType, 'application/pdf');
});

test('upload route reports unavailable storage without a token', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'medihuman-upload-api-'));
  const store = await new JsonDataStore(join(directory, 'test.json')).init();
  const server = await createTestServer({ store, secureCookies: false, rateLimiter: { check() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const pre = await fetch(`${base}/api/csrf`);
  const preCookie = pre.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const preBody = await pre.json();

  const registration = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': preBody.csrfToken, cookie: preCookie },
    body: JSON.stringify({ email: 'upload-patient@example.test', password: 'test password long enough', role: 'patient' }),
  });
  assert.equal(registration.status, 201);
  const sessionCookie = registration.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');

  const token = await fetch(`${base}/api/csrf`, { headers: { cookie: sessionCookie } });
  const tokenBody = await token.json();
  const tokenCookie = sessionCookie.replace(/mh_csrf=[^;]+/, `mh_csrf=${tokenBody.csrfToken}`);

  const form = new FormData();
  form.append('type', 'other');
  form.append('title', 'Uploaded report');
  form.append('file', new Blob(['report body'], { type: 'application/pdf' }), 'report.pdf');

  const upload = await fetch(`${base}/api/patient/records/upload`, {
    method: 'POST',
    headers: { 'x-csrf-token': tokenBody.csrfToken, cookie: tokenCookie },
    body: form,
  });
  const payload = await upload.json();
  assert.equal(upload.status, 503);
  assert.equal(payload.error.code, 'STORAGE_UNAVAILABLE');
  assert.equal(storageAvailable(), false);
});
