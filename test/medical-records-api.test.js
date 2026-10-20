import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestServer } from '../src/backend/api.js';
import { JsonDataStore } from '../src/backend/store.js';

const sample = { type: 'lab_report', title: 'Blood panel', date: '2026-10-20', description: 'Reviewed document', tags: ['annual'], source: 'lab' };

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'medihuman-records-api-'));
  const store = await new JsonDataStore(join(directory, 'test.json')).init();
  const server = await createTestServer({ store, secureCookies: false, rateLimiter: { check() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, account = {}, method = 'GET', body, csrf = account.csrf) {
    const headers = { ...(account.cookie ? { cookie: account.cookie } : {}) };
    if (csrf) headers['x-csrf-token'] = csrf;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json(), cookie: response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ') };
  }
  async function register(email, role = 'patient') {
    const pre = await request('/api/csrf');
    const registration = await request('/api/auth/register', { cookie: pre.cookie, csrf: pre.body.csrfToken }, 'POST', {
      email, password: 'test password long enough', role,
      ...(role === 'doctor' ? { doctor: { displayName: 'Test Doctor', specialty: 'General', registrationId: 'TEST', organization: 'Test Clinic' } } : {}),
    });
    assert.equal(registration.status, 201, JSON.stringify(registration.body));
    const token = await request('/api/csrf', { cookie: registration.cookie });
    return { cookie: registration.cookie.replace(/mh_csrf=[^;]+/, `mh_csrf=${token.body.csrfToken}`), csrf: token.body.csrfToken, user: registration.body.user };
  }
  return { store, request, register, directory };
}

test('medical record CRUD, isolation, persistence and prescription aliases', async (t) => {
  const { store, request, register, directory } = await fixture(t);
  const patient = await register('records-patient@example.test');
  const other = await register('records-other@example.test');
  let lab;
  let prescription;
  await t.test('anonymous list requires authentication', async () => {
    assert.equal((await request('/api/patient/records')).status, 401);
  });
  await t.test('empty records list is explicit', async () => {
    assert.deepEqual((await request('/api/patient/records', patient)).body, { records: [] });
  });
  await t.test('creation requires CSRF and leaves no record on failure', async () => {
    assert.equal((await request('/api/patient/records', patient, 'POST', sample, '')).status, 403);
    assert.equal(store.state.medicalRecords.length, 0);
  });
  await t.test('creates record and preserves validated file metadata', async () => {
    const result = await request('/api/patient/records', patient, 'POST', {
      ...sample, fileRef: 'https://storage.example.test/report.pdf', mimeType: 'application/pdf', sizeBytes: 1024,
    });
    assert.equal(result.status, 201);
    lab = result.body.record;
    assert.equal(lab.userId, undefined);
    assert.equal(lab.title, sample.title);
    assert.equal(lab.sizeBytes, 1024);
    assert.ok(lab.createdAt);
    assert.equal((await request(`/api/patient/records/${lab.id}`, patient)).body.record.fileRef, lab.fileRef);
  });
  await t.test('all supported record types can be created', async () => {
    for (const type of ['prescription', 'imaging', 'clinical_note', 'discharge_summary', 'vaccination', 'other']) {
      const result = await request('/api/patient/records', patient, 'POST', { ...sample, type, title: `${type} record`, date: '2026-01-01' });
      assert.equal(result.status, 201);
      if (type === 'prescription') prescription = result.body.record;
    }
  });
  await t.test('list sorts by clinical date newest first and filters by type', async () => {
    const all = await request('/api/patient/records', patient);
    assert.equal(all.body.records.length, 7);
    assert.equal(all.body.records[0].id, lab.id);
    const labs = await request('/api/patient/records?type=lab_report', patient);
    assert.deepEqual(labs.body.records.map((record) => record.id), [lab.id]);
    assert.equal((await request('/api/patient/records?type=invalid', patient)).status, 400);
    assert.equal((await request('/api/patient/records?type=', patient)).status, 400);
    assert.equal((await request('/api/patient/records?type=lab_report&type=other', patient)).status, 400);
  });
  await t.test('invalid bodies cannot inject ownership, payloads or timestamps', async () => {
    for (const body of [null, [], { ...sample, date: '2026-02-30' }, { ...sample, type: 'wrong' },
      { ...sample, title: '' }, { ...sample, tags: [1] }, { ...sample, userId: other.user.id },
      { ...sample, data: { secret: true } }, { ...sample, createdAt: '2020' },
      { ...sample, fileRef: 'javascript:alert(1)' }, { ...sample, sizeBytes: -1 }]) {
      assert.equal((await request('/api/patient/records', patient, 'POST', body)).status, 400);
    }
    assert.equal(store.state.medicalRecords.length, 7);
  });
  await t.test('other patient cannot list, fetch, edit or delete owned records', async () => {
    assert.deepEqual((await request('/api/patient/records', other)).body.records, []);
    for (const method of ['GET', 'PUT', 'DELETE']) {
      assert.equal((await request(`/api/patient/records/${lab.id}`, other, method, method === 'PUT' ? { title: 'Stolen' } : undefined)).status, 404);
    }
  });
  await t.test('partial update preserves metadata, creation time and identity', async () => {
    const result = await request(`/api/patient/records/${lab.id}`, patient, 'PUT', { title: 'Updated panel', tags: [] });
    assert.equal(result.status, 200);
    assert.equal(result.body.record.title, 'Updated panel');
    assert.equal(result.body.record.createdAt, lab.createdAt);
    assert.equal(result.body.record.fileRef, lab.fileRef);
    assert.deepEqual(result.body.record.tags, []);
    const invalid = await request(`/api/patient/records/${lab.id}`, patient, 'PUT', { date: 'bad' });
    assert.equal(invalid.status, 400);
    assert.equal((await request(`/api/patient/records/${lab.id}`, patient)).body.record.date, sample.date);
  });
  await t.test('summary and account export include generic records without duplicate counts', async () => {
    const summary = (await request('/api/patient/summary', patient)).body.summary;
    assert.equal(summary.sourceCounts.records, 7);
    assert.equal(summary.recordCountsByType.lab_report, 1);
    assert.equal(summary.sourceCounts.prescriptions, 1);
    const exported = (await request('/api/account/export', patient)).body;
    assert.equal(exported.records.medicalRecords.length, 7);
    assert.equal(exported.records.medicalRecords.some((record) => 'userId' in record), false);
  });
  await t.test('generic prescription is visible through legacy endpoint', async () => {
    const result = await request(`/api/prescriptions/${prescription.id}`, patient);
    assert.equal(result.status, 200);
    assert.equal(result.body.prescription.medicationName, prescription.title);
    assert.equal((await request('/api/prescriptions', patient)).body.prescriptions.length, 1);
    assert.equal((await request(`/api/prescriptions/${lab.id}`, patient)).status, 404);
  });
  await t.test('legacy creation/update preserves structured data and generic metadata', async () => {
    const created = await request('/api/prescriptions', patient, 'POST', { medicationName: 'Example medication', strength: '10 mg', dose: 'One tablet' });
    assert.equal(created.status, 201);
    const id = created.body.prescription.id;
    const canonical = (await request(`/api/patient/records/${id}`, patient)).body.record;
    assert.equal(canonical.data.strength, '10 mg');
    assert.equal(canonical.date, canonical.createdAt.slice(0, 10));
    await request(`/api/patient/records/${id}`, patient, 'PUT', { tags: ['retain'], source: 'clinic', title: 'Renamed medication', description: 'Revised instructions' });
    const updated = await request(`/api/prescriptions/${id}`, patient, 'PUT', { dose: 'Two tablets' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.prescription.medicationName, 'Renamed medication');
    assert.equal(updated.body.prescription.instructions, 'Revised instructions');
    const record = (await request(`/api/patient/records/${id}`, patient)).body.record;
    assert.equal(record.data.dose, 'Two tablets');
    assert.deepEqual(record.tags, ['retain']);
    assert.equal(record.source, 'clinic');
    assert.equal((await request(`/api/prescriptions/${id}`, other)).status, 404);
    assert.equal((await request(`/api/prescriptions/${id}`, patient, 'DELETE')).status, 200);
    assert.equal((await request(`/api/patient/records/${id}`, patient)).status, 404);
  });
  await t.test('deletion removes canonical and legacy records without resurrection on reopen', async () => {
    assert.equal((await request(`/api/patient/records/${prescription.id}`, patient, 'DELETE')).status, 200);
    assert.equal((await request(`/api/prescriptions/${prescription.id}`, patient)).status, 404);
    const reopened = await new JsonDataStore(join(directory, 'test.json')).init();
    assert.equal(reopened.state.medicalRecords.some((record) => record.id === prescription.id), false);
    assert.equal(reopened.state.prescriptions.some((record) => record.id === prescription.id), false);
    assert.equal(reopened.state.medicalRecords.find((record) => record.id === lab.id).title, 'Updated panel');
    assert.equal((await request(`/api/patient/records/${prescription.id}`, patient, 'DELETE')).status, 404);
  });
  await t.test('record CRUD has audit events without document content', async () => {
    const events = store.state.auditLogs.filter((event) => event.entityType === 'medical-record');
    for (const action of ['create', 'update', 'delete']) assert.ok(events.some((event) => event.action === `record.medical_${action}`));
    assert.equal(JSON.stringify(events).includes(sample.description), false);
  });
  await t.test('account deletion removes all medical records but preserves other patients', async () => {
    const otherRecord = await request('/api/patient/records', other, 'POST', sample);
    assert.equal((await request('/api/account', patient, 'DELETE', { confirmation: 'DELETE MY ACCOUNT' })).status, 200);
    assert.equal(store.state.medicalRecords.some((record) => record.userId === patient.user.id), false);
    assert.equal(store.state.medicalRecords.some((record) => record.id === otherRecord.body.record.id), true);
  });
});

test('doctor records require verification and active patient approval', async (t) => {
  const { store, request, register } = await fixture(t);
  const patient = await register('doctor-records-patient@example.test');
  const other = await register('doctor-records-other@example.test');
  const doctor = await register('doctor-records-clinician@example.test', 'doctor');
  const doctorPath = `/api/doctor/patients/${patient.user.patientId}/records`;
  const created = await request('/api/patient/records', patient, 'POST', { ...sample, fileRef: 'https://storage.example.test/private.pdf' });
  const id = created.body.record.id;
  const foreign = await request('/api/patient/records', other, 'POST', sample);
  await t.test('unverified doctor cannot list or read single record', async () => {
    for (const path of [doctorPath, `${doctorPath}/${id}`]) {
      const denied = await request(path, doctor);
      assert.equal(denied.status, 403);
      assert.equal(denied.body.error.code, 'CLINICIAN_VERIFICATION_REQUIRED');
      assert.equal(JSON.stringify(denied.body).includes('storage.example.test'), false);
    }
  });
  // Admin verification itself is exercised through its real API in server.test.js.
  await store.transact((state) => {
    Object.assign(state.users.find((user) => user.id === doctor.user.id).doctorProfile, { verified: true, verificationStatus: 'verified' });
  });
  const access = await request('/api/doctor/access-requests', doctor, 'POST', { patientId: patient.user.patientId });
  assert.equal(access.status, 201);
  const accessPath = `/api/patient/access-requests/${access.body.request.id}`;
  await t.test('pending approval blocks both endpoints', async () => {
    for (const path of [doctorPath, `${doctorPath}/${id}`]) assert.equal((await request(path, doctor)).status, 403);
  });
  assert.equal((await request(`${accessPath}/approve`, patient, 'POST', {})).status, 200);
  await t.test('approved doctor can filter and fetch owned records including file references', async () => {
    assert.deepEqual((await request(`${doctorPath}?type=lab_report`, doctor)).body.records.map((record) => record.id), [id]);
    assert.deepEqual((await request(`${doctorPath}?type=imaging`, doctor)).body.records, []);
    const single = await request(`${doctorPath}/${id}`, doctor);
    assert.equal(single.status, 200);
    assert.equal(single.body.record.fileRef, created.body.record.fileRef);
    assert.equal(single.body.record.userId, undefined);
    assert.equal((await request(`${doctorPath}/${foreign.body.record.id}`, doctor)).status, 404);
    assert.equal((await request(`${doctorPath}?type=wrong`, doctor)).status, 400);
    const all = await request(`/api/doctor/patients/${patient.user.patientId}`, doctor);
    assert.equal(all.body.medicalRecords.length, 1);
    const summary = await request(`/api/doctor/patients/${patient.user.patientId}/summary`, doctor);
    assert.equal(summary.body.summary.sourceCounts.records, 1);
  });
  await t.test('patient role cannot call doctor reads and doctor cannot mutate patient records', async () => {
    assert.equal((await request(doctorPath, patient)).status, 403);
    assert.equal((await request('/api/patient/records', doctor, 'POST', sample)).status, 403);
    assert.equal((await request(`/api/patient/records/${id}`, doctor, 'PUT', { title: 'Unauthorized' })).status, 403);
  });
  await t.test('updates notify approved doctors with opaque entity references', async () => {
    await request(`/api/patient/records/${id}`, patient, 'PUT', { description: 'Updated report' });
    const notifications = (await request('/api/notifications', doctor)).body.notifications;
    assert.ok(notifications.some((item) => item.entityType === 'medical-record' && item.entityId === id));
    assert.equal(JSON.stringify(notifications).includes('Updated report'), false);
    assert.ok(store.state.auditLogs.some((event) => event.action === 'record.medical_read'));
  });
  assert.equal((await request(`${accessPath}/revoke`, patient, 'POST', {})).status, 200);
  await t.test('revocation immediately blocks lists and files and stops notifications', async () => {
    for (const path of [doctorPath, `${doctorPath}/${id}`]) assert.equal((await request(path, doctor)).status, 403);
    const before = store.state.notifications.filter((item) => item.recipientUserId === doctor.user.id).length;
    await request(`/api/patient/records/${id}`, patient, 'PUT', { title: 'After revoke' });
    assert.equal(store.state.notifications.filter((item) => item.recipientUserId === doctor.user.id).length, before);
  });
});
