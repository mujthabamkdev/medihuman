/**
 * End-to-end flows across patient, clinician, and shared store.
 * These exercise the full record lifecycle the clinical workspace depends on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestServer } from '../src/backend/api.js';
import { JsonDataStore } from '../src/backend/store.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'medihuman-e2e-'));
  const store = await new JsonDataStore(join(directory, 'test.json')).init();
  const server = await createTestServer({ store, secureCookies: false, rateLimiter: { check() {} }, clinicianAdminKey: 'e2e-clinician-admin-key' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(path, account = {}, method = 'GET', body, csrf = account.csrf, extraHeaders = {}) {
    const headers = { ...(account.cookie ? { cookie: account.cookie } : {}), ...extraHeaders };
    if (csrf) headers['x-csrf-token'] = csrf;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: response.status, body: parsed, cookie: response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ') };
  }

  async function register(email, role = 'patient') {
    const pre = await request('/api/csrf');
    const registration = await request('/api/auth/register', { cookie: pre.cookie, csrf: pre.body.csrfToken }, 'POST', {
      email, password: 'test password long enough', role,
      ...(role === 'doctor' ? { doctor: { displayName: 'E2E Doctor', specialty: 'General', registrationId: 'E2E-1', organization: 'E2E Clinic' } } : {}),
    });
    assert.equal(registration.status, 201, JSON.stringify(registration.body));
    const token = await request('/api/csrf', { cookie: registration.cookie });
    return { cookie: registration.cookie.replace(/mh_csrf=[^;]+/, `mh_csrf=${token.body.csrfToken}`), csrf: token.body.csrfToken, user: registration.body.user };
  }

  async function verifyDoctor(account) {
    const admin = await request('/api/csrf');
    const result = await request(`/api/admin/clinicians/${account.user.id}/verification`, { cookie: admin.cookie, csrf: admin.body.csrfToken }, 'POST', { status: 'verified' }, admin.body.csrfToken, { 'x-admin-key': 'e2e-clinician-admin-key' });
    assert.equal(result.status, 200, JSON.stringify(result.body));
  }
  async function approveAccess(patient, doctor, patientId) {
    const requestAccess = await request('/api/doctor/access-requests', doctor, 'POST', { patientId });
    assert.equal(requestAccess.status, 201, JSON.stringify(requestAccess.body));
    const list = await request('/api/patient/access-requests', patient);
    const pending = list.body.requests.find((item) => item.status === 'pending');
    assert.ok(pending);
    const approved = await request(`/api/patient/access-requests/${pending.id}/approve`, patient, 'PUT', { status: 'approved' });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    return pending.id;
  }

  return { store, request, register, verifyDoctor, approveAccess };
}

test('E2E: patient uploads a prescription and the approved doctor reads it', async (t) => {
  const { request, register, verifyDoctor, approveAccess } = await fixture(t);
  const patient = await register('e2e-prescription-patient@example.test');
  const doctor = await register('e2e-prescription-doctor@example.test', 'doctor');
  await verifyDoctor(doctor);
  await approveAccess(patient, doctor, patient.user.patientId);

  const created = await request('/api/patient/records', patient, 'POST', {
    type: 'prescription', title: 'Metformin 500 mg', date: '2026-04-01', source: 'clinic', fileRef: 'https://storage.example.test/rx.pdf',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.record.type, 'prescription');

  const doctorRecords = await request(`/api/doctor/patients/${patient.user.patientId}/records`, doctor);
  assert.equal(doctorRecords.status, 200);
  assert.equal(doctorRecords.body.records.length, 1);
  assert.equal(doctorRecords.body.records[0].title, 'Metformin 500 mg');
  assert.equal(doctorRecords.body.records[0].fileRef, 'https://storage.example.test/rx.pdf');

  const byType = await request(`/api/doctor/patients/${patient.user.patientId}/records?type=prescription`, doctor);
  assert.equal(byType.body.records.length, 1);
  const wrongType = await request(`/api/doctor/patients/${patient.user.patientId}/records?type=imaging`, doctor);
  assert.equal(wrongType.body.records.length, 0);
});

test('E2E: patient uploads a lab report and the approved doctor views it', async (t) => {
  const { request, register, verifyDoctor, approveAccess } = await fixture(t);
  const patient = await register('e2e-lab-patient@example.test');
  const doctor = await register('e2e-lab-doctor@example.test', 'doctor');
  await verifyDoctor(doctor);
  await approveAccess(patient, doctor, patient.user.patientId);

  const created = await request('/api/patient/records', patient, 'POST', {
    type: 'lab_report', title: 'HbA1c panel', date: '2026-05-05', description: 'HbA1c 7.4%', tags: ['diabetes'], source: 'lab',
  });
  assert.equal(created.status, 201);

  const doctorRecords = await request(`/api/doctor/patients/${patient.user.patientId}/records`, doctor);
  assert.equal(doctorRecords.body.records.length, 1);
  assert.equal(doctorRecords.body.records[0].type, 'lab_report');
  assert.deepEqual(doctorRecords.body.records[0].tags, ['diabetes']);
  assert.equal(doctorRecords.body.records[0].description, 'HbA1c 7.4%');

  const single = await request(`/api/doctor/patients/${patient.user.patientId}/records/${created.body.record.id}`, doctor);
  assert.equal(single.status, 200);
  assert.equal(single.body.record.title, 'HbA1c panel');
});

test('E2E: patient active and discontinued medicines show as a doctor timeline', async (t) => {
  const { request, register, verifyDoctor, approveAccess } = await fixture(t);
  const patient = await register('e2e-medicine-patient@example.test');
  const doctor = await register('e2e-medicine-doctor@example.test', 'doctor');
  await verifyDoctor(doctor);
  await approveAccess(patient, doctor, patient.user.patientId);

  const saved = await request('/api/patient/medicines', patient, 'PUT', {
    medicines: [
      { name: 'Metformin', strength: '500 mg', dose: '1 tablet', route: 'Oral', timing: 'Twice daily', notes: '', status: 'active', startedAt: '2026-01-10', stoppedAt: '' },
      { name: 'Ibuprofen', strength: '400 mg', dose: '1 tablet', route: 'Oral', timing: 'As needed', notes: '', status: 'discontinued', startedAt: '2025-06-01', stoppedAt: '2025-12-01' },
    ],
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  const doctorMedicines = await request(`/api/doctor/patients/${patient.user.patientId}/medicines`, doctor);
  assert.equal(doctorMedicines.status, 200);
  const names = doctorMedicines.body.medicines.map((medicine) => medicine.name);
  assert.deepEqual(names, ['Metformin', 'Ibuprofen']);
  const active = doctorMedicines.body.medicines.find((medicine) => medicine.name === 'Metformin');
  const stopped = doctorMedicines.body.medicines.find((medicine) => medicine.name === 'Ibuprofen');
  assert.equal(active.status, 'active');
  assert.equal(active.startedAt, '2026-01-10');
  assert.equal(stopped.status, 'discontinued');
  assert.equal(stopped.stoppedAt, '2025-12-01');
  assert.equal(stopped.reason, '');
});
