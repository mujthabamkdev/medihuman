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
import { MAX_UPLOAD_BYTES, uploadToBlob, validateUpload } from '../blob.js';

/** Parse a multipart/form-data body into fields plus the uploaded file. */
async function readMultipart(request) {
  const contentType = String(request.headers['content-type'] || '');
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Uploads must use multipart/form-data.');
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_UPLOAD_BYTES + 64 * 1024) {
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Files must be 4 MB or smaller.');
    }
    chunks.push(chunk);
  }
  const parsed = await new Response(Buffer.concat(chunks), { headers: { 'content-type': contentType } }).formData();
  const fields = {};
  for (const [key, value] of parsed.entries()) {
    if (typeof value === 'string') fields[key] = value;
  }
  const file = parsed.get('file');
  return { file, fields };
}

function typeFilter(url) {
  const values = url.searchParams.getAll('type');
  if (values.length > 1) throw new HttpError(400, 'INVALID_FIELD', 'Only one type filter is allowed.');
  return values.length ? recordType(values[0]) : undefined;
}

function searchFilter(url) {
  const value = url.searchParams.get('q');
  if (value === null) return '';
  if (value.length > 200) throw new HttpError(400, 'INVALID_FIELD', 'Search query is too long.');
  return value.trim().toLowerCase();
}

function dateRangeFilter(url) {
  const from = url.searchParams.get('from') || '';
  const to = url.searchParams.get('to') || '';
  for (const [field, value] of [['from', from], ['to', to]]) {
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, 'INVALID_FIELD', `${field} must use a valid YYYY-MM-DD date.`);
  }
  if (from && to && from > to) throw new HttpError(400, 'INVALID_FIELD', 'from must not be after to.');
  return { from, to };
}

function matchesRecord(record, query, { from, to }) {
  const date = String(record.date || record.createdAt || '').slice(0, 10);
  if (from && date < from) return false;
  if (to && date > to) return false;
  if (!query) return true;
  const haystack = [record.title, record.type, record.description, ...(Array.isArray(record.tags) ? record.tags : [])]
    .filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(query);
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
    const query = searchFilter(url);
    const range = dateRangeFilter(url);
    // Check approval and obtain the payload in the same store operation.
    const payload = await dataStore.transact((state) => {
      const patient = findPatientByPublicId(state, patientId);
      if (!patient) throw new HttpError(404, 'PATIENT_NOT_FOUND', 'Patient not found.');
      if (!hasApprovedAccess(state, current.user.id, patient.id)) {
        throw new HttpError(403, 'PATIENT_ACCESS_REQUIRED', 'Patient approval is required.');
      }
      const result = id
        ? { record: publicRecord(ownedRecord(state, id, patient.id)) }
        : { records: sortedPatientRecords(state, patient.id, type).filter((record) => matchesRecord(record, query, range)).map(publicRecord) };
      addAuditEvent(state, {
        actorUserId: current.user.id, action: 'record.medical_read',
        entityType: id ? 'medical-record' : 'patient', entityId: id || patient.id,
      }, now);
      return result;
    });
    sendJson(response, 200, payload);
    return true;
  }

  const patientUploadMatch = pathname.match(/^\/api\/patient\/records\/upload$/);
  if (patientUploadMatch && method === 'POST') {
    requireRole(current, 'patient');
    const { file, fields } = await readMultipart(request);
    const { size, mimeType } = validateUpload(file);
    const stored = await uploadToBlob({
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType,
      fileName: fields.fileName || file.name || 'record',
    });
    const value = recordValue({
      type: fields.type || 'other',
      title: fields.title || file.name || 'Uploaded record',
      date: fields.date || new Date(now).toISOString().slice(0, 10),
      description: fields.description || '',
      tags: fields.tags ? String(fields.tags).split(',').map((tag) => tag.trim()).filter(Boolean) : [],
      source: fields.source || 'self',
      fileRef: stored.url,
      mimeType,
      sizeBytes: size,
    });
    const timestamp = new Date(now).toISOString();
    const record = { id: newId(), userId: current.user.id, ...value, sizeBytes: size, createdAt: timestamp, updatedAt: timestamp };
    await dataStore.transact((state) => {
      state.medicalRecords.push(record);
      recordChanged(state, current.user.id, current.user.id, 'create', record.id, now);
    });
    sendJson(response, 201, { record: publicRecord(record) });
    return true;
  }

  const patientMatch = pathname.match(/^\/api\/patient\/records(?:\/([^/]+))?$/);
  if (!patientMatch) return false;
  requireRole(current, 'patient');
  const id = patientMatch[1] ? decodePathValue(patientMatch[1], 'recordId') : null;
  const userId = current.user.id;
  if (method === 'GET') {
    const type = typeFilter(url);
    const query = searchFilter(url);
    const range = dateRangeFilter(url);
    const payload = await dataStore.read((state) => id
      ? { record: publicRecord(ownedRecord(state, id, userId)) }
      : { records: sortedPatientRecords(state, userId, type).filter((record) => matchesRecord(record, query, range)).map(publicRecord) });
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
