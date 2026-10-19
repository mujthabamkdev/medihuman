import { newId } from './security.js';

export function publicNotification(notification) {
  const {
    recipientUserId, actorUserId, ...safeNotification
  } = notification;
  return safeNotification;
}

export function publicIndication(indication, doctor = null) {
  const { doctorUserId, patientUserId, ...safeIndication } = indication;
  return {
    ...safeIndication,
    doctor: doctor ? {
      displayName: doctor.doctorProfile?.displayName || 'Clinician',
      specialty: doctor.doctorProfile?.specialty || '',
      organization: doctor.doctorProfile?.organization || '',
    } : undefined,
  };
}

export function addNotification(state, recipientUserId, details, now) {
  state.notifications.unshift({
    id: newId(), recipientUserId, ...details, readAt: null, createdAt: new Date(now).toISOString(),
  });
}

export function notifyApprovedDoctors(state, patientUserId, details, now) {
  const doctorIds = new Set(state.accessRequests
    .filter((request) => request.patientUserId === patientUserId && request.status === 'approved')
    .map((request) => request.doctorUserId));
  for (const doctorId of doctorIds) addNotification(state, doctorId, details, now);
}
