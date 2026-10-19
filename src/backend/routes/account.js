import { requireRole } from '../auth.js';
import { addAuditEvent } from '../audit.js';
import { HttpError } from '../errors.js';
import { readJson, sendJson } from '../http.js';
import { patientRecords } from '../records.js';
import { publicUser } from '../auth.js';
import { allowedKeys, stringValue } from '../validation.js';

export async function handleAccountRoute(ctx) {
  const { pathname, method, request, response, dataStore, current, now } = ctx;
  if (pathname === '/api/account/export' && method === 'GET') {
    const exported = await dataStore.read((state) => {
      const user = state.users.find((item) => item.id === current.user.id);
      if (!user) throw new HttpError(404, 'ACCOUNT_NOT_FOUND', 'Account not found.');
      const records = user.role === 'patient' ? patientRecords(state, user) : {
        profile: state.profiles.find((item) => item.userId === user.id) || {},
        accessRequests: state.accessRequests.filter((item) => item.doctorUserId === user.id),
      };
      return { exportedAt: new Date(now).toISOString(), user: publicUser(user), records };
    });
    await dataStore.transact((state) => addAuditEvent(state, { actorUserId: current.user.id, action: 'account.export', entityType: 'account', entityId: current.user.id }, now));
    sendJson(response, 200, exported, { 'Content-Disposition': 'attachment; filename="medihuman-account-export.json"' });
    return true;
  }
  if (pathname === '/api/account' && method === 'DELETE') {
    const body = await readJson(request);
    allowedKeys(body, ['confirmation']);
    if (stringValue(body.confirmation, 'confirmation', { required: true, max: 40 }) !== 'DELETE MY ACCOUNT') {
      throw new HttpError(400, 'CONFIRMATION_REQUIRED', 'Type DELETE MY ACCOUNT to permanently delete this account.');
    }
    await dataStore.transact((state) => {
      const userId = current.user.id;
      addAuditEvent(state, { actorUserId: userId, action: 'account.delete', entityType: 'account', entityId: userId }, now);
      state.users = state.users.filter((item) => item.id !== userId);
      state.sessions = state.sessions.filter((item) => item.userId !== userId);
      state.profiles = state.profiles.filter((item) => item.userId !== userId);
      state.medicines = state.medicines.filter((item) => item.userId !== userId);
      state.prescriptions = state.prescriptions.filter((item) => item.userId !== userId);
      state.reconciliations = state.reconciliations.filter((item) => item.userId !== userId);
      state.accessRequests = state.accessRequests.filter((item) => item.patientUserId !== userId && item.doctorUserId !== userId);
      state.indications = state.indications.filter((item) => item.patientUserId !== userId && item.doctorUserId !== userId);
      state.notifications = state.notifications.filter((item) => item.recipientUserId !== userId);
    });
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (pathname === '/api/patient/consent' && method === 'GET') {
    requireRole(current, 'patient');
    const consent = await dataStore.read((state) => state.profiles.find((item) => item.userId === current.user.id)?.consent || null);
    sendJson(response, 200, { consent });
    return true;
  }
  if (pathname === '/api/patient/consent' && method === 'PUT') {
    requireRole(current, 'patient');
    const body = await readJson(request);
    allowedKeys(body, ['accepted', 'version']);
    const accepted = body.accepted === true;
    const version = stringValue(body.version ?? 'v1', 'version', { required: true, max: 40 });
    await dataStore.transact((state) => {
      const profile = state.profiles.find((item) => item.userId === current.user.id);
      if (!profile) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
      profile.consent = accepted ? { accepted: true, version, acceptedAt: new Date(now).toISOString() } : { accepted: false, version, withdrawnAt: new Date(now).toISOString() };
      addAuditEvent(state, { actorUserId: current.user.id, action: accepted ? 'consent.accept' : 'consent.withdraw', entityType: 'consent', entityId: current.user.id }, now);
    });
    sendJson(response, 200, { consent: { accepted, version } });
    return true;
  }
  return false;
}
