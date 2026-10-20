import { profileValue } from './validation.js';
import { publicDoctor } from './auth.js';
import { HttpError } from './errors.js';
import { publicIndication } from './notifications.js';
import { recordToPrescription } from './medical-records.js';

const PUBLIC_RECORD_FIELDS = [
  'id', 'type', 'title', 'date', 'description', 'fileRef', 'mimeType',
  'sizeBytes', 'tags', 'source', 'createdAt', 'updatedAt',
];
const PRESCRIPTION_DATA_FIELDS = [
  'medicationName', 'strength', 'dose', 'route', 'frequency',
  'startDate', 'endDate', 'instructions', 'prescriber',
];

export function publicRecord(record) {
  const result = {};
  for (const field of PUBLIC_RECORD_FIELDS) {
    const value = record[field];
    if (field === 'tags') {
      if (Array.isArray(value)) result.tags = value.filter((tag) => typeof tag === 'string');
    } else if (field === 'sizeBytes') {
      if (Number.isSafeInteger(value) && value >= 0) result[field] = value;
    } else if (typeof value === 'string') result[field] = value;
  }
  if (record.type === 'prescription' && record.data && typeof record.data === 'object' && !Array.isArray(record.data)) {
    result.data = {};
    for (const field of PRESCRIPTION_DATA_FIELDS) {
      if (typeof record.data[field] === 'string') result.data[field] = record.data[field];
    }
  }
  return result;
}

export function findRecordByPublicId(state, recordId, userId) {
  if (typeof recordId !== 'string' || !recordId || typeof userId !== 'string' || !userId) return undefined;
  return (state.medicalRecords || []).find((record) => record.id === recordId && record.userId === userId);
}

export function sortedPatientRecords(state, userId, type) {
  return (state.medicalRecords || [])
    .filter((record) => record.userId === userId && (!type || record.type === type))
    .sort((left, right) => String(right.date || '').localeCompare(String(left.date || ''))
      || String(right.createdAt || '').localeCompare(String(left.createdAt || ''))
      || String(left.id || '').localeCompare(String(right.id || '')));
}

export function publicProfile(profile, user = null) {
  const result = {
    fullName: profile.fullName,
    dateOfBirth: profile.dateOfBirth,
    allergies: profile.allergies,
    conditions: profile.conditions,
    updatedAt: profile.updatedAt,
  };
  if (user?.role === 'patient') result.patientId = user.patientId;
  return result;
}

export function publicPrescription(prescription) {
  const { userId, ...safePrescription } = prescription;
  return safePrescription;
}

export function publicReconciliation(reconciliation) {
  const { userId, ...safeReconciliation } = reconciliation;
  return safeReconciliation;
}

export function publicAccessRequest(request, patient, doctor, profile = null) {
  return {
    id: request.id,
    patientId: patient?.patientId,
    // A patient is only named once access is approved. Pending and revoked
    // requests stay anonymous and are handled through the opaque patient ID.
    patientName: request.status === 'approved' ? (profile?.fullName || '') : '',
    doctor: doctor ? publicDoctor(doctor.doctorProfile) : undefined,
    doctorId: doctor?.id,
    status: request.status,
    requestedAt: request.requestedAt,
    respondedAt: request.respondedAt,
    revokedAt: request.revokedAt,
  };
}

export function decodePathValue(value, field) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, 'INVALID_FIELD', `${field} is invalid.`);
  }
}

export function findPatientByPublicId(state, patientId) {
  return state.users.find((user) => user.role === 'patient' && user.patientId === patientId);
}

export function hasApprovedAccess(state, doctorId, patientId) {
  return state.accessRequests.some((request) => request.doctorUserId === doctorId && request.patientUserId === patientId && request.status === 'approved');
}

export function patientRecords(state, patient, { includeSensitive = true, indicationDoctorId = null } = {}) {
  const profile = state.profiles.find((item) => item.userId === patient.id) || profileValue();
  const medicines = state.medicines.find((item) => item.userId === patient.id)?.items || [];
  const medicalRecords = sortedPatientRecords(state, patient.id).map(publicRecord);
  const prescriptions = Array.isArray(state.medicalRecords)
    ? sortedPatientRecords(state, patient.id, 'prescription').map((record) => publicPrescription(recordToPrescription(publicRecord(record))))
    : (state.prescriptions || []).filter((item) => item.userId === patient.id).map(publicPrescription);
  const reconciliations = state.reconciliations.filter((item) => item.userId === patient.id).map(publicReconciliation);
  const indications = state.indications.filter((item) => item.patientUserId === patient.id && (!indicationDoctorId || item.doctorUserId === indicationDoctorId)).map((item) => publicIndication(item, state.users.find((user) => user.id === item.doctorUserId)));
  if (!includeSensitive) return { profile: publicProfile(profile, patient) };
  return { profile: publicProfile(profile, patient), medicines, prescriptions, medicalRecords, reconciliations, indications };
}
