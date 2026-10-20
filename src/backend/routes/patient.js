import { publicUser, requireRole } from '../auth.js';
import { HttpError } from '../errors.js';
import { readJson, sendJson } from '../http.js';
import {
  decodePathValue, findRecordByPublicId, patientRecords, publicProfile,
  publicPrescription, publicReconciliation, publicRecord, sortedPatientRecords,
} from '../records.js';
import { addNotification, notifyApprovedDoctors, publicIndication, publicNotification } from '../notifications.js';
import { newId } from '../security.js';
import { buildSummary } from '../summary.js';
import {
  allowedKeys, listValue, medicineListValue, prescriptionValue, profileValue, stringValue,
} from '../validation.js';
import { compareMedicines } from '../../medication-logic.js';
import { addAuditEvent } from '../audit.js';
import { migratePrescriptionRecords, prescriptionToRecord, recordToPrescription } from '../medical-records.js';

export async function handlePatientRoute(ctx) {
  const { pathname, method, request, response, dataStore, now, current } = ctx;
  if (pathname === '/api/notifications' && method === 'GET') {
    const notifications = await dataStore.read((state) => state.notifications
      .filter((item) => item.recipientUserId === current.user.id)
      .map(publicNotification));
    sendJson(response, 200, { notifications });
    return true;
  }
  const notificationReadMatch = pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
  if (notificationReadMatch && method === 'POST') {
    const id = notificationReadMatch[1];
    const updated = await dataStore.transact((state) => {
      const item = state.notifications.find((entry) => entry.id === id && entry.recipientUserId === current.user.id);
      if (!item) throw new HttpError(404, 'NOT_FOUND', 'Notification not found.');
      item.readAt = new Date(now).toISOString();
      addAuditEvent(state, { actorUserId: current.user.id, action: 'notification.read', entityType: 'notification', entityId: id }, now);
      return publicNotification(item);
    });
    sendJson(response, 200, { notification: updated });
    return true;
  }
  if (pathname === '/api/me' && method === 'GET') {
    const data = await dataStore.read((state) => ({
      profile: publicProfile(state.profiles.find((item) => item.userId === current.user.id) || profileValue(), current.user),
      medicines: state.medicines.find((item) => item.userId === current.user.id)?.items || [],
    }));
    sendJson(response, 200, { user: publicUser(current.user), ...data });
    return true;
  }

  if ((pathname === '/api/summary' || pathname === '/api/patient/summary') && method === 'GET') {
    requireRole(current, 'patient');
    const records = await dataStore.read((state) => patientRecords(state, current.user));
    sendJson(response, 200, { summary: await buildSummary(records) });
    return true;
  }
  if ((pathname === '/api/patient/profile' || pathname === '/api/profile') && method === 'GET') {
    requireRole(current, 'patient');
    const profile = await dataStore.read((state) => publicProfile(state.profiles.find((item) => item.userId === current.user.id) || profileValue(), current.user));
    sendJson(response, 200, { profile });
    return true;
  }
  if ((pathname === '/api/patient/profile' || pathname === '/api/profile') && method === 'PUT') {
    requireRole(current, 'patient');
    const input = await readJson(request);
    allowedKeys(input, ['fullName', 'dateOfBirth', 'allergies', 'conditions']);
    const existingProfile = await dataStore.read((state) => state.profiles.find((item) => item.userId === current.user.id) || {});
    const profile = profileValue({
      fullName: input.fullName ?? existingProfile.fullName,
      dateOfBirth: input.dateOfBirth ?? existingProfile.dateOfBirth,
      allergies: input.allergies ?? existingProfile.allergies,
      conditions: input.conditions ?? existingProfile.conditions,
    });
    await dataStore.transact((state) => {
      const existing = state.profiles.find((item) => item.userId === current.user.id);
       if (existing) Object.assign(existing, profile, { updatedAt: new Date(now).toISOString() });
       else state.profiles.push({ userId: current.user.id, ...profile, updatedAt: new Date(now).toISOString() });
        notifyApprovedDoctors(state, current.user.id, { type: 'patient-record', title: 'Patient profile updated', message: 'A patient profile record was added or updated.', entityType: 'profile', entityId: current.user.id }, now);
        addAuditEvent(state, { actorUserId: current.user.id, action: 'record.profile_update', entityType: 'profile', entityId: current.user.id }, now);
    });
    sendJson(response, 200, { profile: publicProfile(profile, current.user) });
    return true;
  }
  if ((pathname === '/api/patient/medicines' || pathname === '/api/medicines') && method === 'GET') {
    requireRole(current, 'patient');
    const medicines = await dataStore.read((state) => state.medicines.find((item) => item.userId === current.user.id)?.items || []);
    sendJson(response, 200, { medicines });
    return true;
  }
  // Medicines are replaced as a whole list (no per-item POST/PUT/DELETE yet).
  // Concurrent edits by the same client are last-write-wins via the client PUT.
  if ((pathname === '/api/patient/medicines' || pathname === '/api/medicines') && method === 'PUT') {    requireRole(current, 'patient');
    const body = await readJson(request);
    allowedKeys(body, ['medicines']);
    const medicines = medicineListValue(body.medicines);
    await dataStore.transact((state) => {
      const existing = state.medicines.find((item) => item.userId === current.user.id);
       if (existing) Object.assign(existing, { items: medicines, updatedAt: new Date(now).toISOString() });
       else state.medicines.push({ userId: current.user.id, items: medicines, updatedAt: new Date(now).toISOString() });
        notifyApprovedDoctors(state, current.user.id, { type: 'patient-record', title: 'Medicine list updated', message: 'A patient medicine record was added or updated.', entityType: 'medicines', entityId: current.user.id }, now);
        addAuditEvent(state, { actorUserId: current.user.id, action: 'record.medicines_update', entityType: 'medicines', entityId: current.user.id }, now);
    });
    sendJson(response, 200, { medicines });
    return true;
  }

  // Add a single medicine to the patient's list.
  if (pathname === '/api/patient/medicines' && method === 'POST') {
    requireRole(current, 'patient');
    const input = await readJson(request);
    allowedKeys(input, ['name', 'strength', 'dose', 'route', 'timing', 'notes', 'status', 'startedAt', 'stoppedAt', 'reason', 'prescriber']);
    const medicine = medicineValue(input);
    const record = { id: newId(), ...medicine, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
    await dataStore.transact((state) => {
      let rec = state.medicines.find((item) => item.userId === current.user.id);
      if (!rec) { rec = { userId: current.user.id, items: [], updatedAt: new Date(now).toISOString() }; state.medicines.push(rec); }
      rec.items.push(record);
      rec.updatedAt = new Date(now).toISOString();
      notifyApprovedDoctors(state, current.user.id, { type: 'patient-record', title: 'Medicine added', message: 'A patient medicine was added.', entityType: 'medicine', entityId: record.id }, now);
      addAuditEvent(state, { actorUserId: current.user.id, action: 'record.medicine_create', entityType: 'medicine', entityId: record.id }, now);
    });
    sendJson(response, 201, { medicine: record });
    return true;
  }

  // Get / update / delete a single medicine item.
  const medicineItemMatch = pathname.match(/^\/api\/patient\/medicines\/([^/]+)$/);
  if (medicineItemMatch) {
    requireRole(current, 'patient');
    const id = decodeURIComponent(medicineItemMatch[1]);
    const existing = await dataStore.read((state) => {
      const rec = state.medicines.find((item) => item.userId === current.user.id);
      return rec ? rec.items.find((m) => m.id === id) : null;
    });
    if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Medicine not found.');
    if (method === 'GET') {
      sendJson(response, 200, { medicine: existing });
      return true;
    }
    if (method === 'PUT') {
      const input = await readJson(request);
      allowedKeys(input, ['name', 'strength', 'dose', 'route', 'timing', 'notes', 'status', 'startedAt', 'stoppedAt', 'reason', 'prescriber']);
      const medicine = medicineValue(input);
      await dataStore.transact((state) => {
        const rec = state.medicines.find((item) => item.userId === current.user.id);
        const item = rec.items.find((m) => m.id === id);
        Object.assign(item, medicine, { updatedAt: new Date(now).toISOString() });
        rec.updatedAt = new Date(now).toISOString();
        notifyApprovedDoctors(state, current.user.id, { type: 'patient-record', title: 'Medicine updated', message: 'A patient medicine was updated.', entityType: 'medicine', entityId: id }, now);
        addAuditEvent(state, { actorUserId: current.user.id, action: 'record.medicine_update', entityType: 'medicine', entityId: id }, now);
      });
      sendJson(response, 200, { medicine: { ...existing, ...medicine, updatedAt: new Date(now).toISOString() } });
      return true;
    }
    if (method === 'DELETE') {
      await dataStore.transact((state) => {
        const rec = state.medicines.find((item) => item.userId === current.user.id);
        if (rec) rec.items = rec.items.filter((m) => m.id !== id);
        rec.updatedAt = new Date(now).toISOString();
        addAuditEvent(state, { actorUserId: current.user.id, action: 'record.medicine_delete', entityType: 'medicine', entityId: id }, now);
      });
      sendJson(response, 200, { ok: true });
      return true;
    }
  }

  if (pathname === '/api/prescriptions' && method === 'GET') {
    requireRole(current, 'patient');
    const prescriptions = await dataStore.read((state) => sortedPatientRecords(state, current.user.id, 'prescription')
      .map((record) => publicPrescription(recordToPrescription(publicRecord(record)))));
    sendJson(response, 200, { prescriptions });
    return true;
  }
  if (pathname === '/api/prescriptions' && method === 'POST') {
    requireRole(current, 'patient');
    const prescription = prescriptionValue(await readJson(request));
    const record = { id: newId(), userId: current.user.id, ...prescription, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
      await dataStore.transact((state) => {
        state.medicalRecords.push(prescriptionToRecord(record));
        migratePrescriptionRecords(state);
        notifyApprovedDoctors(state, current.user.id, { type: 'patient-record', title: 'Prescription record added', message: 'A patient prescription record was added.', entityType: 'prescription', entityId: record.id }, now);
        addAuditEvent(state, { actorUserId: current.user.id, action: 'record.prescription_create', entityType: 'prescription', entityId: record.id }, now);
      });
    sendJson(response, 201, { prescription: publicPrescription(record) });
    return true;
  }
  const prescriptionMatch = pathname.match(/^\/api\/prescriptions\/([^/]+)$/);
  if (prescriptionMatch) {
    requireRole(current, 'patient');
    const id = decodePathValue(prescriptionMatch[1], 'prescriptionId');
    const existingRecord = await dataStore.read((state) => findRecordByPublicId(state, id, current.user.id));
    if (!existingRecord || existingRecord.type !== 'prescription') throw new HttpError(404, 'NOT_FOUND', 'Prescription not found.');
    const existing = recordToPrescription(publicRecord(existingRecord));
    if (method === 'GET') {
      sendJson(response, 200, { prescription: publicPrescription(existing) });
      return true;
    }
    if (method === 'PUT') {
      const input = await readJson(request);
      allowedKeys(input, ['medicationName', 'strength', 'dose', 'route', 'frequency', 'startDate', 'endDate', 'instructions', 'prescriber']);
      const updated = await dataStore.transact((state) => {
        const item = findRecordByPublicId(state, id, current.user.id);
        if (!item || item.type !== 'prescription') throw new HttpError(404, 'NOT_FOUND', 'Prescription not found.');
        const previous = recordToPrescription(publicRecord(item));
        const fields = ['medicationName', 'strength', 'dose', 'route', 'frequency', 'startDate', 'endDate', 'instructions', 'prescriber'];
        const prescription = prescriptionValue({ ...Object.fromEntries(fields.map((field) => [field, previous[field]])), ...input });
        Object.assign(item, {
          title: prescription.medicationName, description: prescription.instructions,
          data: { ...item.data, ...prescription }, updatedAt: new Date(now).toISOString(),
        });
        migratePrescriptionRecords(state);
        notifyApprovedDoctors(state, current.user.id, { type: 'patient-record', title: 'Prescription record updated', message: 'A patient prescription record was updated.', entityType: 'prescription', entityId: id }, now);
        addAuditEvent(state, { actorUserId: current.user.id, action: 'record.prescription_update', entityType: 'prescription', entityId: id }, now);
        return recordToPrescription(publicRecord(item));
      });
      sendJson(response, 200, { prescription: publicPrescription(updated) });
      return true;
    }
    if (method === 'DELETE') {
      await dataStore.transact((state) => {
        const item = findRecordByPublicId(state, id, current.user.id);
        if (!item || item.type !== 'prescription') throw new HttpError(404, 'NOT_FOUND', 'Prescription not found.');
        state.medicalRecords = state.medicalRecords.filter((record) => record.id !== id || record.userId !== current.user.id);
        state.prescriptions = state.prescriptions.filter((item) => item.id !== id || item.userId !== current.user.id);
        notifyApprovedDoctors(state, current.user.id, { type: 'patient-record', title: 'Prescription record deleted', message: 'A patient prescription record was deleted.', entityType: 'prescription', entityId: id }, now);
        addAuditEvent(state, { actorUserId: current.user.id, action: 'record.prescription_delete', entityType: 'prescription', entityId: id }, now);
      });
      sendJson(response, 200, { ok: true });
      return true;
    }
  }

  if (pathname === '/api/reconciliations' && method === 'GET') {
    requireRole(current, 'patient');
     const reconciliations = await dataStore.read((state) => state.reconciliations.filter((item) => item.userId === current.user.id).map(publicReconciliation));
     sendJson(response, 200, { reconciliations });
     return true;
   }
  if (pathname === '/api/indications' && method === 'GET') {
    requireRole(current, 'patient');
    const indications = await dataStore.read((state) => state.indications
      .filter((item) => item.patientUserId === current.user.id)
      .map((item) => publicIndication(item, state.users.find((user) => user.id === item.doctorUserId))));
    sendJson(response, 200, { indications });
    return true;
  }
  if (pathname === '/api/reconciliations' && method === 'POST') {
    requireRole(current, 'patient');
    const body = await readJson(request);
    allowedKeys(body, ['prescriptionMedicines', 'dispensedMedicines', 'notes']);
    const prescriptionMedicines = listValue(body.prescriptionMedicines, 'prescriptionMedicines');
    const dispensedMedicines = listValue(body.dispensedMedicines, 'dispensedMedicines');
    const comparison = compareMedicines(prescriptionMedicines.join('\n'), dispensedMedicines.join('\n'));
    const record = {
      id: newId(), userId: current.user.id, prescriptionMedicines, dispensedMedicines,
      matched: comparison.matched, missing: comparison.missing, unexpected: comparison.unexpected,
      isExactMatch: comparison.isExactMatch, notes: stringValue(body.notes, 'notes', { max: 1_000 }),
      createdAt: new Date(now).toISOString(),
    };
      await dataStore.transact((state) => {
        state.reconciliations.push(record);
        notifyApprovedDoctors(state, current.user.id, { type: 'patient-record', title: 'Medicine comparison added', message: 'A patient medicine comparison was added.', entityType: 'reconciliation', entityId: record.id }, now);
        addAuditEvent(state, { actorUserId: current.user.id, action: 'record.reconciliation_create', entityType: 'reconciliation', entityId: record.id }, now);
      });
    sendJson(response, 201, { reconciliation: publicReconciliation(record) });
    return true;
  }
  const reconciliationMatch = pathname.match(/^\/api\/reconciliations\/([^/]+)$/);
  if (reconciliationMatch) {
    requireRole(current, 'patient');
    const id = decodeURIComponent(reconciliationMatch[1]);
    const reconciliation = await dataStore.read((state) => state.reconciliations.find((item) => item.id === id && item.userId === current.user.id));
    if (!reconciliation) throw new HttpError(404, 'NOT_FOUND', 'Reconciliation not found.');
    if (method === 'GET') {
      sendJson(response, 200, { reconciliation: publicReconciliation(reconciliation) });
      return true;
    }
    if (method === 'PUT') {
      const body = await readJson(request);
      allowedKeys(body, ['prescriptionMedicines', 'dispensedMedicines', 'notes']);
      const prescriptionMedicines = body.prescriptionMedicines === undefined ? reconciliation.prescriptionMedicines : listValue(body.prescriptionMedicines, 'prescriptionMedicines');
      const dispensedMedicines = body.dispensedMedicines === undefined ? reconciliation.dispensedMedicines : listValue(body.dispensedMedicines, 'dispensedMedicines');
      const comparison = compareMedicines(prescriptionMedicines.join('\n'), dispensedMedicines.join('\n'));
      const updated = { ...reconciliation, prescriptionMedicines, dispensedMedicines, matched: comparison.matched, missing: comparison.missing, unexpected: comparison.unexpected, isExactMatch: comparison.isExactMatch, notes: body.notes === undefined ? reconciliation.notes : stringValue(body.notes, 'notes', { max: 1_000 }), updatedAt: new Date(now).toISOString() };
      await dataStore.transact((state) => { const item = state.reconciliations.find((entry) => entry.id === id && entry.userId === current.user.id); Object.assign(item, updated); addAuditEvent(state, { actorUserId: current.user.id, action: 'record.reconciliation_update', entityType: 'reconciliation', entityId: id }, now); });
      sendJson(response, 200, { reconciliation: publicReconciliation(updated) });
      return true;
    }
    if (method === 'DELETE') {
      await dataStore.transact((state) => { state.reconciliations = state.reconciliations.filter((item) => item.id !== id || item.userId !== current.user.id); addAuditEvent(state, { actorUserId: current.user.id, action: 'record.reconciliation_delete', entityType: 'reconciliation', entityId: id }, now); });
      sendJson(response, 200, { ok: true });
      return true;
    }
  }
  return false;
}
