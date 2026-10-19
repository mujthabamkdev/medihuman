import { publicUser } from '../auth.js';
import { addAuditEvent } from '../audit.js';
import { HttpError } from '../errors.js';
import { readJson, sendJson } from '../http.js';
import { decodePathValue } from '../records.js';
import { safeEqualText } from '../security.js';
import { allowedKeys, stringValue } from '../validation.js';

function requireClinicianAdmin(request, configuredKey = process.env.MEDIHUMAN_CLINICIAN_ADMIN_KEY) {
  if (!configuredKey || !safeEqualText(request.headers['x-admin-key'], configuredKey)) {
    throw new HttpError(403, 'ADMIN_ACCESS_REQUIRED', 'Clinician administration access is required.');
  }
}

export async function handleAdminRoute(ctx) {
  const { pathname, method, request, response, dataStore, now, clinicianAdminKey } = ctx;
  const verificationMatch = pathname.match(/^\/api\/admin\/clinicians\/([^/]+)\/verification$/);
  if (!verificationMatch || method !== 'POST') return false;

  requireClinicianAdmin(request, clinicianAdminKey);
  const userId = decodePathValue(verificationMatch[1], 'userId');
  const body = await readJson(request);
  allowedKeys(body, ['status']);
  const status = stringValue(body.status, 'status', { required: true, max: 20 }).toLowerCase();
  if (!['pending', 'verified', 'rejected'].includes(status)) {
    throw new HttpError(400, 'INVALID_FIELD', 'status must be pending, verified, or rejected.');
  }

  const updatedUser = await dataStore.transact((state) => {
    const user = state.users.find((item) => item.id === userId && item.role === 'doctor');
    if (!user) throw new HttpError(404, 'CLINICIAN_NOT_FOUND', 'Clinician not found.');
    user.doctorProfile ||= {};
    user.doctorProfile.verificationStatus = status;
    user.doctorProfile.verified = status === 'verified';
    user.doctorProfile.verifiedAt = status === 'verified' ? new Date(now).toISOString() : undefined;
    user.doctorProfile.updatedAt = new Date(now).toISOString();
    addAuditEvent(state, { action: `clinician.${status}`, entityType: 'clinician', entityId: user.id }, now);
    return publicUser(user);
  });

  sendJson(response, 200, { user: updatedUser });
  return true;
}
