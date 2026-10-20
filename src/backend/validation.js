import { MAX_LIST_ITEMS, PATIENT_ROLES } from './constants.js';
import { HttpError } from './errors.js';
import { newId } from './security.js';

export function allowedKeys(value, keys) {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new HttpError(400, 'UNKNOWN_FIELD', `Unknown field: ${key}.`);
  }
}

export function stringValue(value, field, { required = false, max = 500, min = 0 } = {}) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') throw new HttpError(400, 'INVALID_FIELD', `${field} must be a string.`);
  const normalized = value.trim();
  if (required && !normalized) throw new HttpError(400, 'INVALID_FIELD', `${field} is required.`);
  if (normalized.length < min || normalized.length > max) {
    throw new HttpError(400, 'INVALID_FIELD', `${field} has an invalid length.`);
  }
  return normalized;
}

export function emailValue(value) {
  const email = stringValue(value, 'email', { required: true, min: 3, max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'INVALID_FIELD', 'email is invalid.');
  return email;
}

export function passwordValue(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) {
    throw new HttpError(400, 'INVALID_FIELD', 'password must be 12 to 128 characters.');
  }
  return value;
}

export function dateValue(value, field) {
  const date = stringValue(value, field, { max: 10 });
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) {
    throw new HttpError(400, 'INVALID_FIELD', `${field} must use a valid YYYY-MM-DD date.`);
  }
  return date;
}

export function profileValue(input = {}) {
  allowedKeys(input, ['fullName', 'dateOfBirth', 'allergies', 'conditions']);
  return {
    fullName: stringValue(input.fullName, 'fullName', { max: 120 }),
    dateOfBirth: dateValue(input.dateOfBirth, 'dateOfBirth'),
    allergies: stringValue(input.allergies, 'allergies', { max: 1_000 }),
    conditions: stringValue(input.conditions, 'conditions', { max: 1_000 }),
  };
}

export function roleValue(value) {
  const role = stringValue(value === undefined ? 'patient' : value, 'role', { max: 20 }).toLowerCase();
  if (!PATIENT_ROLES.has(role)) throw new HttpError(400, 'INVALID_FIELD', 'role must be patient or doctor.');
  return role;
}

export function doctorRegistrationValue(input = {}) {
  allowedKeys(input, ['displayName', 'specialty', 'registrationId', 'organization']);
  return {
    displayName: stringValue(input.displayName, 'displayName', { required: true, max: 160 }),
    specialty: stringValue(input.specialty, 'specialty', { required: true, max: 160 }),
    registrationId: stringValue(input.registrationId, 'registrationId', { required: true, max: 200 }),
    organization: stringValue(input.organization, 'organization', { required: true, max: 200 }),
    verificationStatus: 'pending',
    verified: false,
  };
}

export function medicineValue(input, index = 0) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'INVALID_FIELD', `medicines[${index}] must be an object.`);
  allowedKeys(input, ['id', 'name', 'strength', 'dose', 'route', 'timing', 'notes', 'status', 'startedAt', 'stoppedAt', 'reason', 'prescriber']);
  const status = stringValue(input.status || 'active', `medicines[${index}].status`, { max: 20 }).toLowerCase();
  if (!['active', 'discontinued', 'completed'].includes(status)) throw new HttpError(400, 'INVALID_FIELD', `medicines[${index}].status must be active, discontinued, or completed.`);
  return {
    id: typeof input.id === 'string' && input.id ? input.id : newId(),
    name: stringValue(input.name, `medicines[${index}].name`, { required: true, max: 160 }),
    strength: stringValue(input.strength, `medicines[${index}].strength`, { max: 80 }),
    dose: stringValue(input.dose, `medicines[${index}].dose`, { max: 120 }),
    route: stringValue(input.route, `medicines[${index}].route`, { max: 80 }),
    timing: stringValue(input.timing, `medicines[${index}].timing`, { max: 160 }),
    notes: stringValue(input.notes, `medicines[${index}].notes`, { max: 500 }),
    status,
    startedAt: dateValue(input.startedAt || '', `medicines[${index}].startedAt`),
    stoppedAt: dateValue(input.stoppedAt || '', `medicines[${index}].stoppedAt`),
    reason: stringValue(input.reason || '', `medicines[${index}].reason`, { max: 500 }),
    prescriber: stringValue(input.prescriber || '', `medicines[${index}].prescriber`, { max: 160 }),
  };
}

export function medicineListValue(value) {
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) throw new HttpError(400, 'INVALID_FIELD', `medicines must be an array of up to ${MAX_LIST_ITEMS} items.`);
  return value.map((item, index) => medicineValue(typeof item === 'string' ? { name: item } : item, index));
}

export function prescriptionValue(input) {
  allowedKeys(input, ['medicationName', 'strength', 'dose', 'route', 'frequency', 'startDate', 'endDate', 'instructions', 'prescriber']);
  return {
    medicationName: stringValue(input.medicationName, 'medicationName', { required: true, max: 160 }),
    strength: stringValue(input.strength, 'strength', { max: 80 }),
    dose: stringValue(input.dose, 'dose', { max: 120 }),
    route: stringValue(input.route, 'route', { max: 80 }),
    frequency: stringValue(input.frequency, 'frequency', { max: 120 }),
    startDate: dateValue(input.startDate, 'startDate'),
    endDate: dateValue(input.endDate, 'endDate'),
    instructions: stringValue(input.instructions, 'instructions', { max: 1_000 }),
    prescriber: stringValue(input.prescriber, 'prescriber', { max: 160 }),
  };
}

export function listValue(value, field) {
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) throw new HttpError(400, 'INVALID_FIELD', `${field} must be an array of up to ${MAX_LIST_ITEMS} items.`);
  return value.map((item, index) => stringValue(item, `${field}[${index}]`, { required: true, max: 240 }));
}

export const RECORD_TYPES = Object.freeze([
  'prescription', 'lab_report', 'imaging', 'clinical_note',
  'discharge_summary', 'vaccination', 'other',
]);

export const RECORD_FIELDS = Object.freeze([
  'type', 'title', 'date', 'description', 'tags', 'source',
  'fileRef', 'mimeType', 'sizeBytes',
]);

export function recordType(value) {
  const type = stringValue(value, 'type', { required: true, max: 40 });
  if (!RECORD_TYPES.includes(type)) throw new HttpError(400, 'INVALID_FIELD', 'type must be a supported medical record type.');
  return type;
}

export function fileRefValue(value) {
  const fileRef = stringValue(value, 'fileRef', { max: 2_048 });
  if (!fileRef) return '';
  let url;
  try { url = new URL(fileRef); } catch {
    throw new HttpError(400, 'INVALID_FIELD', 'fileRef must be an HTTPS URL without credentials.');
  }
  if (url.protocol !== 'https:' || !/^https:\/\//i.test(fileRef) || !url.hostname || url.username || url.password || /[\s\u0000-\u001f\u007f]/.test(fileRef)) {
    throw new HttpError(400, 'INVALID_FIELD', 'fileRef must be an HTTPS URL without credentials.');
  }
  return fileRef;
}

export function recordValue(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'INVALID_FIELD', 'record must be an object.');
  allowedKeys(input, RECORD_FIELDS);
  const mimeType = stringValue(input.mimeType, 'mimeType', { max: 127 });
  if (mimeType && !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mimeType)) {
    throw new HttpError(400, 'INVALID_FIELD', 'mimeType must be a valid MIME type.');
  }
  if (input.sizeBytes !== undefined && (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0 || input.sizeBytes > 4_500_000)) {
    throw new HttpError(400, 'INVALID_FIELD', 'sizeBytes must be a nonnegative safe integer up to 4500000 bytes.');
  }
  const source = stringValue(input.source === undefined ? 'self' : input.source, 'source', { required: true, max: 20 });
  if (!['self', 'clinic', 'lab'].includes(source)) throw new HttpError(400, 'INVALID_FIELD', 'source must be self, clinic, or lab.');
  return {
    type: recordType(input.type),
    title: stringValue(input.title, 'title', { required: true, max: 200 }),
    date: dateValue(stringValue(input.date, 'date', { required: true, max: 10 }), 'date'),
    description: stringValue(input.description, 'description', { max: 5_000 }),
    tags: listValue(input.tags === undefined ? [] : input.tags, 'tags'),
    source,
    fileRef: fileRefValue(input.fileRef),
    mimeType,
    ...(input.sizeBytes === undefined ? {} : { sizeBytes: input.sizeBytes }),
  };
}

export function recordListValue(value) {
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) throw new HttpError(400, 'INVALID_FIELD', `records must be an array of up to ${MAX_LIST_ITEMS} items.`);
  return value.map((item) => recordValue(item));
}
