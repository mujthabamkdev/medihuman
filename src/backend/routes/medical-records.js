import { requireRole, requireVerifiedDoctor } from '../auth.js';
import { addAuditEvent } from '../audit.js';
import { HttpError } from '../errors.js';
import { readJson, sendJson } from '../http.js';
import { migratePrescriptionRecords } from '../medical-records.js';
import { notifyApprovedDoctors } from '../notifications.js';
import {
  decodePathValue, findPatientByPublicId, findRecordByPublicId,
  hasApprovedAccess, publicRecord, sortedPatientRecords,
} from '../records.js';
import { newId } from '../security.js';
import { allowedKeys, RECORD_FIELDS, recordType, recordValue } from '../validation.js';

function typeFilter(url) {
  const values = url.searchParams.getAll('type');
  if (values.length > 1) throw new HttpError(400, 'INVALID_FIELD', 'Only one type filter is allowed.');
  return values.length ? recordType(values[0]) : undefined;
}

function ownedRecord(state, id, userId) {
  const record = findRecordByPublicId(state, id, userId);
  if (!record) throw new HttpError(404, 'NOT_FOUND', 'Medical record not found.');
  return record;
}

function recordChanged(state, userId, actorUserId, action, id, now) {
  migratePrescriptionRecords(state);
  notifyApprovedDoctors(state, userId, {
    type: 'patient-record', title: 'Medical record updated',
    message: 'A patient medical record was added, updated, or deleted.',
    entityType: 'medical-record', entityId: id,
  }, now);
  addAuditEvent(state, { actorUserId, action: `record.medical_${action}`, entityType: 'medical-record', entityId: id }, now);
}

export async function handleMedicalRecordsRoute(ctx) {
  const { pathname, method, request, response, dataStore, now, current, url } = ctx;
  const doctorMatch = pathname.match(/^\/api\/doctor\/patients\/([^/]+)\/records(?:\/([^/]+))?$/);
  if (doctorMatch && method === 'GET') {
    requireVerifiedDoctor(current);
    const patientId = decodePathValue(doctorMatch[1], 'patientId');
    const id = doctorMatch[2] ? decodePathValue(doctorMatch[2], 'recordId') : null;
    const type = typeFilter(url);
    // Check approval and obtain the payload in the same store operation.
    const payload = await dataStore.transact((state) => {
      const patient = findPatientByPublicId(state, patientId);
      if (!patient) throw new HttpError(404, 'PATIENT_NOT_FOUND', 'Patient not found.');
      if (!hasApprovedAccess(state, current.user.id, patient.id)) {
        throw new HttpError(403, 'PATIENT_ACCESS_REQUIRED', 'Patient approval is required.');
      }
      const result = id
        ? { record: publicRecord(ownedRecord(state, id, patient.id)) }
        : { records: sortedPatientRecords(state, patient.id, type).map(publicRecord) };
      addAuditEvent(state, {
        actorUserId: current.user.id, action: 'record.medical_read',
        entityType: id ? 'medical-record' : 'patient', entityId: id || patient.id,
      }, now);
      return result;
    });
    sendJson(response, 200, payload);
    return true;
  }

  const patientMatch = pathname.match(/^\/api\/patient\/records(?:\/([^/]+))?$/);
  if (!patientMatch) return false;
  requireRole(current, 'patient');
  const id = patientMatch[1] ? decodePathValue(patientMatch[1], 'recordId') : null;
  const userId = current.user.id;
  if (method === 'GET') {
    const type = typeFilter(url);
    const payload = await dataStore.read((state) => id
      ? { record: publicRecord(ownedRecord(state, id, userId)) }
      : { records: sortedPatientRecords(state, userId, type).map(publicRecord) });
    sendJson(response, 200, payload);
    return true;
  }
  if (!id && method === 'POST') {
    const value = recordValue(await readJson(request));
    const timestamp = new Date(now).toISOString();
    const record = { id: newId(), userId, ...value, sizeBytes: value.sizeBytes ?? 0, createdAt: timestamp, updatedAt: timestamp };
    await dataStore.transact((state) => {
      state.medicalRecords.push(record);
      recordChanged(state, userId, userId, 'create', record.id, now);
    });
    sendJson(response, 201, { record: publicRecord(record) });
    return true;
  }
  if (id && method === 'PUT') {
    const input = await readJson(request);
    allowedKeys(input, RECORD_FIELDS);
    const updated = await dataStore.transact((state) => {
      const record = ownedRecord(state, id, userId);
      const existing = Object.fromEntries(RECORD_FIELDS.filter((field) => record[field] !== undefined).map((field) => [field, record[field]]));
      const value = recordValue({ ...existing, ...input });
      Object.assign(record, value, { updatedAt: new Date(now).toISOString() });
      if (record.type === 'prescription' && record.data) {
        if (input.title !== undefined) record.data.medicationName = value.title;
        if (input.description !== undefined) record.data.instructions = value.description;
      } else if (record.type !== 'prescription') delete record.data;
      recordChanged(state, userId, userId, 'update', id, now);
      return publicRecord(record);
    });
    sendJson(response, 200, { record: updated });
    return true;
  }
  if (id && method === 'DELETE') {
    await dataStore.transact((state) => {
      ownedRecord(state, id, userId);
      state.medicalRecords = state.medicalRecords.filter((record) => record.id !== id || record.userId !== userId);
      state.prescriptions = state.prescriptions.filter((record) => record.id !== id || record.userId !== userId);
      recordChanged(state, userId, userId, 'delete', id, now);
    });
    sendJson(response, 200, { ok: true });
    return true;
  }
  return false;
}
