import { requireRole, requireVerifiedDoctor } from '../auth.js';
import { addAuditEvent } from '../audit.js';
import { HttpError } from '../errors.js';
import { readJson, sendJson } from '../http.js';
import {
  decodePathValue, findPatientByPublicId, hasApprovedAccess, publicAccessRequest,
} from '../records.js';
import { newId } from '../security.js';
import { allowedKeys, stringValue } from '../validation.js';
import { addNotification } from '../notifications.js';

export async function handleAccessRoute(ctx) {
  const { pathname, method, request, response, dataStore, now, current } = ctx;
  const doctorRequestPath = pathname.match(/^\/api\/doctor\/access-requests(?:\/([^/]+))?$/);
  if (doctorRequestPath && method === 'POST') {
    requireVerifiedDoctor(current);
    const body = doctorRequestPath[1] ? {} : await readJson(request);
    if (!doctorRequestPath[1]) allowedKeys(body, ['patientId']);
    const patientId = stringValue(doctorRequestPath[1] ? decodePathValue(doctorRequestPath[1], 'patientId') : body.patientId, 'patientId', { required: true, max: 200 });
    const patient = await dataStore.read((state) => findPatientByPublicId(state, patientId));
    if (!patient) throw new HttpError(404, 'PATIENT_NOT_FOUND', 'Patient not found.');
    const existing = await dataStore.read((state) => state.accessRequests.find((item) =>
      item.doctorUserId === current.user.id && item.patientUserId === patient.id && ['pending', 'approved'].includes(item.status)));
    if (existing) throw new HttpError(409, 'ACCESS_REQUEST_EXISTS', 'An active access request already exists for this patient.');
    const requestRecord = {
      id: newId(), doctorUserId: current.user.id, patientUserId: patient.id, status: 'pending', requestedAt: new Date(now).toISOString(),
    };
    await dataStore.transact((state) => {
      state.accessRequests.push(requestRecord);
      addNotification(state, patient.id, { type: 'access-request', title: 'Access request', message: `${current.user.doctorProfile?.displayName || 'A clinician'} requested access to your records.`, entityType: 'access_request', entityId: requestRecord.id }, now);
      addAuditEvent(state, { actorUserId: current.user.id, action: 'access.request', entityType: 'access_request', entityId: requestRecord.id }, now);
    });
    sendJson(response, 201, { request: publicAccessRequest(requestRecord, patient, current.user) });
    return true;
  }
  if (pathname === '/api/doctor/access-requests' && method === 'GET') {
    requireVerifiedDoctor(current);
    const requests = await dataStore.read((state) => state.accessRequests
      .filter((item) => item.doctorUserId === current.user.id)
      .map((item) => publicAccessRequest(item, state.users.find((user) => user.id === item.patientUserId), current.user)));
    sendJson(response, 200, { requests });
    return true;
  }

  const patientAccessAction = pathname.match(/^\/api\/patient\/access-requests\/([^/]+)(?:\/(approve|reject|revoke))?$/);
  if (patientAccessAction && (method === 'PUT' || (method === 'POST' && patientAccessAction[2]))) {
    requireRole(current, 'patient');
    const requestId = decodePathValue(patientAccessAction[1], 'requestId');
    let action = patientAccessAction[2];
    if (method === 'PUT') {
      const body = await readJson(request);
      allowedKeys(body, ['status']);
      action = stringValue(body.status, 'status', { required: true, max: 20 }).toLowerCase();
      action = { approved: 'approve', rejected: 'reject', revoked: 'revoke' }[action] || action;
      if (!['approve', 'reject', 'revoke'].includes(action)) throw new HttpError(400, 'INVALID_FIELD', 'status must be approve, reject, or revoke.');
    }
    const existing = await dataStore.read((state) => state.accessRequests.find((item) => item.id === requestId && item.patientUserId === current.user.id));
    if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Access request not found.');
    const requiredStatus = action === 'revoke' ? 'approved' : 'pending';
    const actionLabel = { approve: 'approved', reject: 'rejected', revoke: 'revoked' }[action];
    if (existing.status !== requiredStatus) throw new HttpError(409, 'INVALID_REQUEST_STATUS', `Only ${requiredStatus} access requests can be ${actionLabel}.`);
    const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'revoked';
    const updated = { ...existing, status, respondedAt: new Date(now).toISOString(), ...(status === 'revoked' ? { revokedAt: new Date(now).toISOString() } : {}) };
    await dataStore.transact((state) => {
      const item = state.accessRequests.find((entry) => entry.id === requestId && entry.patientUserId === current.user.id);
      if (!item || item.status !== requiredStatus) throw new HttpError(409, 'INVALID_REQUEST_STATUS', `Only ${requiredStatus} access requests can be ${actionLabel}.`);
      Object.assign(item, updated);
      addAuditEvent(state, { actorUserId: current.user.id, action: `access.${action}`, entityType: 'access_request', entityId: requestId }, now);
    });
    const doctor = await dataStore.read((state) => state.users.find((user) => user.id === existing.doctorUserId));
    sendJson(response, 200, { request: publicAccessRequest(updated, current.user, doctor) });
    return true;
  }
  if (pathname === '/api/patient/access-requests' && method === 'GET') {
    requireRole(current, 'patient');
    const requests = await dataStore.read((state) => state.accessRequests
      .filter((item) => item.patientUserId === current.user.id)
      .map((item) => publicAccessRequest(item, current.user, state.users.find((user) => user.id === item.doctorUserId))));
    sendJson(response, 200, { requests });
    return true;
  }
  return false;
}
