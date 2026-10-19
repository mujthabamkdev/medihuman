import { requireVerifiedDoctor } from '../auth.js';
import { addAuditEvent } from '../audit.js';
import { HttpError } from '../errors.js';
import { readJson, sendJson } from '../http.js';
import {
  decodePathValue, findPatientByPublicId, hasApprovedAccess, patientRecords,
} from '../records.js';
import { addNotification, publicIndication } from '../notifications.js';
import { newId } from '../security.js';
import { buildSummary } from '../summary.js';
import { allowedKeys, stringValue } from '../validation.js';

export async function handleDoctorRoute(ctx) {
  const { pathname, method, response, dataStore, current } = ctx;
  const indicationPath = pathname.match(/^\/api\/doctor\/patients\/([^/]+)\/indications$/);
  if (indicationPath && method === 'POST') {
    requireVerifiedDoctor(current);
    const patientId = decodePathValue(indicationPath[1], 'patientId');
    const body = await readJson(ctx.request);
    allowedKeys(body, ['title', 'detail', 'severity']);
    const title = stringValue(body.title, 'title', { required: true, max: 200 });
    const detail = stringValue(body.detail, 'detail', { required: true, max: 1_200 });
    const severity = stringValue(body.severity || 'info', 'severity', { max: 20 }).toLowerCase();
    if (!['info', 'review', 'high'].includes(severity)) throw new HttpError(400, 'INVALID_FIELD', 'severity must be info, review, or high.');
    const patient = await dataStore.read((state) => findPatientByPublicId(state, patientId));
    if (!patient) throw new HttpError(404, 'PATIENT_NOT_FOUND', 'Patient not found.');
    const approved = await dataStore.read((state) => hasApprovedAccess(state, current.user.id, patient.id));
    if (!approved) throw new HttpError(403, 'PATIENT_ACCESS_REQUIRED', 'Patient approval is required.');
    const indication = { id: newId(), doctorUserId: current.user.id, patientUserId: patient.id, title, detail, severity, createdAt: new Date(ctx.now).toISOString() };
    await dataStore.transact((state) => {
      state.indications.push(indication);
      addNotification(state, patient.id, { type: 'doctor-indication', title: 'New clinician indication', message: `${current.user.doctorProfile?.displayName || 'Your clinician'} added an indication to your record.`, entityType: 'indication', entityId: indication.id }, ctx.now);
      addAuditEvent(state, { actorUserId: current.user.id, action: 'record.indication_create', entityType: 'indication', entityId: indication.id }, ctx.now);
    });
    sendJson(response, 201, { indication: publicIndication(indication, current.user) });
    return true;
  }
  const doctorPatientMatch = pathname.match(/^\/api\/doctor\/patients\/([^/]+)(?:\/(profile|medicines|prescriptions|reconciliations|summary))?$/);
  if (doctorPatientMatch && method === 'GET') {
    requireVerifiedDoctor(current);
    const patientId = decodePathValue(doctorPatientMatch[1], 'patientId');
    const patient = await dataStore.read((state) => findPatientByPublicId(state, patientId));
    if (!patient) throw new HttpError(404, 'PATIENT_NOT_FOUND', 'Patient not found.');
    const approved = await dataStore.read((state) => hasApprovedAccess(state, current.user.id, patient.id));
    if (!approved) throw new HttpError(403, 'PATIENT_ACCESS_REQUIRED', 'Patient approval is required.');
    const records = await dataStore.read((state) => patientRecords(state, patient));
    await dataStore.transact((state) => addAuditEvent(state, { actorUserId: current.user.id, action: 'record.patient_read', entityType: 'patient', entityId: patient.id }, ctx.now));
    const resource = doctorPatientMatch[2];
    if (resource === 'summary') {
      sendJson(response, 200, { summary: await buildSummary(records) });
    } else if (resource) {
      sendJson(response, 200, { [resource]: records[resource] });
    } else {
      sendJson(response, 200, records);
    }
    return true;
  }
  return false;
}
