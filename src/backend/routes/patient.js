import { publicUser, requireRole } from '../auth.js';
import { HttpError } from '../errors.js';
import { readJson, sendJson } from '../http.js';
import {
  patientRecords, publicProfile, publicPrescription, publicReconciliation,
} from '../records.js';
import { newId } from '../security.js';
import { buildSummary } from '../summary.js';
import {
  allowedKeys, listValue, medicineListValue, prescriptionValue, profileValue, stringValue,
} from '../validation.js';
import { compareMedicines } from '../../medication-logic.js';

export async function handlePatientRoute(ctx) {
  const { pathname, method, request, response, dataStore, now, current } = ctx;
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
  if ((pathname === '/api/patient/medicines' || pathname === '/api/medicines') && method === 'PUT') {
    requireRole(current, 'patient');
    const body = await readJson(request);
    allowedKeys(body, ['medicines']);
    const medicines = medicineListValue(body.medicines);
    await dataStore.transact((state) => {
      const existing = state.medicines.find((item) => item.userId === current.user.id);
      if (existing) Object.assign(existing, { items: medicines, updatedAt: new Date(now).toISOString() });
      else state.medicines.push({ userId: current.user.id, items: medicines, updatedAt: new Date(now).toISOString() });
    });
    sendJson(response, 200, { medicines });
    return true;
  }

  if (pathname === '/api/prescriptions' && method === 'GET') {
    requireRole(current, 'patient');
    const prescriptions = await dataStore.read((state) => state.prescriptions.filter((item) => item.userId === current.user.id).map(publicPrescription));
    sendJson(response, 200, { prescriptions });
    return true;
  }
  if (pathname === '/api/prescriptions' && method === 'POST') {
    requireRole(current, 'patient');
    const prescription = prescriptionValue(await readJson(request));
    const record = { id: newId(), userId: current.user.id, ...prescription, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
    await dataStore.transact((state) => state.prescriptions.push(record));
    sendJson(response, 201, { prescription: publicPrescription(record) });
    return true;
  }
  const prescriptionMatch = pathname.match(/^\/api\/prescriptions\/([^/]+)$/);
  if (prescriptionMatch) {
    requireRole(current, 'patient');
    const id = decodeURIComponent(prescriptionMatch[1]);
    const existing = await dataStore.read((state) => state.prescriptions.find((item) => item.id === id && item.userId === current.user.id));
    if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Prescription not found.');
    if (method === 'GET') {
      sendJson(response, 200, { prescription: publicPrescription(existing) });
      return true;
    }
    if (method === 'PUT') {
      const prescription = prescriptionValue(await readJson(request));
      const updated = { ...existing, ...prescription, updatedAt: new Date(now).toISOString() };
      await dataStore.transact((state) => { const item = state.prescriptions.find((entry) => entry.id === id && entry.userId === current.user.id); Object.assign(item, updated); });
      sendJson(response, 200, { prescription: publicPrescription(updated) });
      return true;
    }
    if (method === 'DELETE') {
      await dataStore.transact((state) => { state.prescriptions = state.prescriptions.filter((item) => item.id !== id || item.userId !== current.user.id); });
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
    await dataStore.transact((state) => state.reconciliations.push(record));
    sendJson(response, 201, { reconciliation: publicReconciliation(record) });
    return true;
  }
  const reconciliationMatch = pathname.match(/^\/api\/reconciliations\/([^/]+)$/);
  if (reconciliationMatch && method === 'GET') {
    requireRole(current, 'patient');
    const id = decodeURIComponent(reconciliationMatch[1]);
    const reconciliation = await dataStore.read((state) => state.reconciliations.find((item) => item.id === id && item.userId === current.user.id));
    if (!reconciliation) throw new HttpError(404, 'NOT_FOUND', 'Reconciliation not found.');
    sendJson(response, 200, { reconciliation: publicReconciliation(reconciliation) });
    return true;
  }
  return false;
}
