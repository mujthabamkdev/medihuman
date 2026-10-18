import { requireRole } from '../auth.js';
import { HttpError } from '../errors.js';
import { sendJson } from '../http.js';
import {
  decodePathValue, findPatientByPublicId, hasApprovedAccess, patientRecords,
} from '../records.js';
import { buildSummary } from '../summary.js';

export async function handleDoctorRoute(ctx) {
  const { pathname, method, response, dataStore, current } = ctx;
  const doctorPatientMatch = pathname.match(/^\/api\/doctor\/patients\/([^/]+)(?:\/(profile|medicines|prescriptions|reconciliations|summary))?$/);
  if (doctorPatientMatch && method === 'GET') {
    requireRole(current, 'doctor');
    const patientId = decodePathValue(doctorPatientMatch[1], 'patientId');
    const patient = await dataStore.read((state) => findPatientByPublicId(state, patientId));
    if (!patient) throw new HttpError(404, 'PATIENT_NOT_FOUND', 'Patient not found.');
    const approved = await dataStore.read((state) => hasApprovedAccess(state, current.user.id, patient.id));
    if (!approved) throw new HttpError(403, 'PATIENT_ACCESS_REQUIRED', 'Patient approval is required.');
    const records = await dataStore.read((state) => patientRecords(state, patient));
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
