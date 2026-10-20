import { requireRole, requireVerifiedDoctor } from '../auth.js';
import { addAuditEvent } from '../audit.js';
import { HttpError } from '../errors.js';
import { readJson, sendJson } from '../http.js';
import {
  decodePathValue, findPatientByPublicId, hasApprovedAccess, patientRecords, publicRecord,
} from '../records.js';
import { addNotification, publicIndication } from '../notifications.js';
import { newId } from '../security.js';
import { buildSummary } from '../summary.js';
import { allowedKeys, stringValue } from '../validation.js';
import { publicDoctor } from '../auth.js';

export async function handleDoctorRoute(ctx) {
  const { pathname, method, response, dataStore, current } = ctx;
  const indicationPath = pathname.match(/^\/api\/doctor\/patients\/([^/]+)\/indications(?:\/([^/]+))?$/);
  if (indicationPath && ['POST', 'PUT', 'DELETE'].includes(method)) {
    requireVerifiedDoctor(current);
    const patientId = decodePathValue(indicationPath[1], 'patientId');
    const indicationId = indicationPath[2] ? decodePathValue(indicationPath[2], 'indicationId') : null;
    const patient = await dataStore.read((state) => findPatientByPublicId(state, patientId));
    if (!patient) throw new HttpError(404, 'PATIENT_NOT_FOUND', 'Patient not found.');
    const approved = await dataStore.read((state) => hasApprovedAccess(state, current.user.id, patient.id));
    if (!approved) throw new HttpError(403, 'PATIENT_ACCESS_REQUIRED', 'Patient approval is required.');
    const body = method === 'DELETE' ? {} : await readJson(ctx.request);
    allowedKeys(body, ['title', 'detail', 'severity']);
    if (method !== 'POST') {
      const existing = await dataStore.read((state) => state.indications.find((item) => item.id === indicationId && item.patientUserId === patient.id && item.doctorUserId === current.user.id));
      if (!existing) throw new HttpError(404, 'INDICATION_NOT_FOUND', 'Clinician indication not found.');
      if (method === 'DELETE') {
        await dataStore.transact((state) => { state.indications = state.indications.filter((item) => item.id !== indicationId); });
        sendJson(response, 200, { ok: true });
        return true;
      }
      const updated = { ...existing, title: body.title === undefined ? existing.title : stringValue(body.title, 'title', { required: true, max: 200 }), detail: body.detail === undefined ? existing.detail : stringValue(body.detail, 'detail', { required: true, max: 1_200 }), severity: body.severity === undefined ? existing.severity : stringValue(body.severity, 'severity', { max: 20 }).toLowerCase(), updatedAt: new Date(ctx.now).toISOString() };
      if (!['info', 'review', 'high'].includes(updated.severity)) throw new HttpError(400, 'INVALID_FIELD', 'severity must be info, review, or high.');
      await dataStore.transact((state) => { const item = state.indications.find((entry) => entry.id === indicationId); Object.assign(item, updated); });
      sendJson(response, 200, { indication: publicIndication(updated, current.user) });
      return true;
    }
    const title = stringValue(body.title, 'title', { required: true, max: 200 });
    const detail = stringValue(body.detail, 'detail', { required: true, max: 1_200 });
    const severity = stringValue(body.severity || 'info', 'severity', { max: 20 }).toLowerCase();
    if (!['info', 'review', 'high'].includes(severity)) throw new HttpError(400, 'INVALID_FIELD', 'severity must be info, review, or high.');
    const indication = { id: newId(), doctorUserId: current.user.id, patientUserId: patient.id, title, detail, severity, createdAt: new Date(ctx.now).toISOString() };
    await dataStore.transact((state) => {
      state.indications.push(indication);
      addNotification(state, patient.id, { type: 'doctor-indication', title: 'New clinician indication', message: `${current.user.doctorProfile?.displayName || 'Your clinician'} added an indication to your record.`, entityType: 'indication', entityId: indication.id }, ctx.now);
      addAuditEvent(state, { actorUserId: current.user.id, action: 'record.indication_create', entityType: 'indication', entityId: indication.id }, ctx.now);
    });
    sendJson(response, 201, { indication: publicIndication(indication, current.user) });
    return true;
  }
  const doctorPatientMatch = pathname.match(/^\/api\/doctor\/patients\/([^/]+)(?:\/(profile|medicines|prescriptions|reconciliations|records|summary))?$/);
  if (doctorPatientMatch && method === 'GET') {
    requireVerifiedDoctor(current);
    const patientId = decodePathValue(doctorPatientMatch[1], 'patientId');
    const patient = await dataStore.read((state) => findPatientByPublicId(state, patientId));
    if (!patient) throw new HttpError(404, 'PATIENT_NOT_FOUND', 'Patient not found.');
    const approved = await dataStore.read((state) => hasApprovedAccess(state, current.user.id, patient.id));
    if (!approved) throw new HttpError(403, 'PATIENT_ACCESS_REQUIRED', 'Patient approval is required.');
    const records = await dataStore.read((state) => patientRecords(state, patient, { indicationDoctorId: current.user.id }));
    await dataStore.transact((state) => addAuditEvent(state, { actorUserId: current.user.id, action: 'record.patient_read', entityType: 'patient', entityId: patient.id }, ctx.now));
    const resource = doctorPatientMatch[2];
    if (resource === 'summary') {
      sendJson(response, 200, { summary: await buildSummary(records) });
    } else if (resource === 'records') {
      sendJson(response, 200, { records: records.medicalRecords || [] });
    } else if (resource) {
      sendJson(response, 200, { [resource]: records[resource] });
    } else {
      sendJson(response, 200, records);
    }
    return true;
  }
  const doctorRecordMatch = pathname.match(/^\/api\/doctor\/patients\/([^/]+)\/records\/([^/]+)$/);
  if (doctorRecordMatch && method === 'GET') {
    requireVerifiedDoctor(current);
    const patientId = decodePathValue(doctorRecordMatch[1], 'patientId');
    const recordId = decodePathValue(doctorRecordMatch[2], 'recordId');
    const patient = await dataStore.read((state) => findPatientByPublicId(state, patientId));
    if (!patient) throw new HttpError(404, 'PATIENT_NOT_FOUND', 'Patient not found.');
    const approved = await dataStore.read((state) => hasApprovedAccess(state, current.user.id, patient.id));
    if (!approved) throw new HttpError(403, 'PATIENT_ACCESS_REQUIRED', 'Patient approval is required.');
    const record = await dataStore.read((state) => {
      const rec = (state.medicalRecords || []).find((r) => r.id === recordId && r.userId === patient.id);
      return rec ? publicRecord(rec) : null;
    });
    if (!record) throw new HttpError(404, 'NOT_FOUND', 'Record not found.');
    await dataStore.transact((state) => addAuditEvent(state, { actorUserId: current.user.id, action: 'record.patient_record_read', entityType: 'medical_record', entityId: recordId }, ctx.now));
    sendJson(response, 200, { record });
    return true;
  }
  if (pathname === '/api/doctor/profile' && method === 'PUT') {
    requireRole(current, 'doctor');
    const input = await readJson(ctx.request);
    allowedKeys(input, ['displayName', 'specialty', 'registrationId', 'organization']);
    const existing = current.user.doctorProfile || {};
    const doctorProfile = {
      displayName: stringValue(input.displayName ?? existing.displayName, 'displayName', { required: true, max: 160 }),
      specialty: stringValue(input.specialty ?? existing.specialty, 'specialty', { max: 160 }),
      registrationId: stringValue(input.registrationId ?? existing.registrationId, 'registrationId', { max: 200 }),
      organization: stringValue(input.organization ?? existing.organization, 'organization', { max: 200 }),
      verificationStatus: existing.verificationStatus || 'pending',
      verified: existing.verified === true,
      ...(typeof existing.updatedAt === 'string' ? { updatedAt: existing.updatedAt } : {}),
    };
    await dataStore.transact((state) => {
      const user = state.users.find((item) => item.id === current.user.id && item.role === 'doctor');
      if (!user) throw new HttpError(404, 'CLINICIAN_NOT_FOUND', 'Clinician not found.');
      user.doctorProfile = doctorProfile;
      user.doctorProfile.updatedAt = new Date(ctx.now).toISOString();
      addAuditEvent(state, { actorUserId: current.user.id, action: 'record.doctor_profile_update', entityType: 'doctor_profile', entityId: current.user.id }, ctx.now);
    });
    sendJson(response, 200, { doctor: publicDoctor(doctorProfile) });
    return true;
  }
  return false;
}
