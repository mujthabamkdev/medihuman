const API_ROOT = '/api';
export const GOOGLE_AUTH_PATH = `${API_ROOT}/auth/google`;
let csrfToken = '';

export function googleAuthUrl(role = 'patient') {
  const selectedRole = role === 'doctor' ? 'doctor' : 'patient';
  return `${GOOGLE_AUTH_PATH}?role=${encodeURIComponent(selectedRole)}`;
}

const GOOGLE_AUTH_ERROR_MESSAGES = {
  access_denied: 'Google sign-in was cancelled. You can try again or use email and password.',
  google_auth_cancelled: 'Google sign-in was cancelled. You can try again or use email and password.',
  google_auth_failed: 'Google sign-in could not be completed. Try again or use email and password.',
  google_identity_invalid: 'Google sign-in could not be completed. Try again or use email and password.',
  google_role_mismatch: 'This Google account is already registered with a different role. Choose that role to continue.',
};

/** Convert OAuth callback errors to safe, user-facing copy without echoing query values. */
export function googleAuthErrorMessage(search = '') {
  let error = '';
  try { error = new URLSearchParams(search).get('error')?.trim().toLowerCase() || ''; } catch { /* malformed search is not user-facing */ }
  return error ? (GOOGLE_AUTH_ERROR_MESSAGES[error] || 'Google sign-in could not be completed. Try again or use email and password.') : '';
}

export class ApiError extends Error {
  constructor(message, status = 0, code = 'NETWORK_ERROR') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request(path, options = {}, retryingCsrf = false) {
  const method = options.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    if (!csrfToken) await request('/csrf');
  }
  const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = csrfToken;
  let response;
  try {
    response = await fetch(`${API_ROOT}${path}`, { credentials: 'include', ...options, method, headers });
  } catch {
    throw new ApiError('MediHuman could not reach its local server. You can continue in local-only mode.', 0);
  }
  let payload = {};
  try { payload = await response.json(); } catch { /* empty response */ }
  if (path === '/csrf' && response.ok) csrfToken = payload.csrfToken || '';
  if (response.ok && (path === '/auth/login' || path === '/auth/register')) await request('/csrf');
  if (!response.ok && payload.error?.code === 'CSRF_INVALID' && method !== 'GET' && !retryingCsrf) {
    csrfToken = '';
    return request(path, options, true);
  }
  if (!response.ok) {
    const fallback = response.status === 404
      ? 'MediHuman API endpoint was not found. Start the MediHuman server and reload this page.'
      : response.status >= 500
        ? 'MediHuman server could not complete this request. Check the server log and try again.'
        : `Request failed with status ${response.status}.`;
    throw new ApiError(payload.error?.message || fallback, response.status, payload.error?.code);
  }
  return payload;
}

function json(method, path, body) { return request(path, { method, body: JSON.stringify(body) }); }

export const api = {
  me: () => request('/me'),
  googleConfigured: () => request('/config'),
  login: (body) => json('POST', '/auth/login', body),
  register: (body) => json('POST', '/auth/register', body),
  recover: (email) => json('POST', '/auth/recover', { email }),
  resendConfirmation: (email) => json('POST', '/auth/resend-confirmation', { email }),
  updatePassword: (password) => json('POST', '/auth/password', { password }),
  verifyMfa: (code) => json('POST', '/auth/mfa/verify', { code }),
  mfaFactors: () => request('/auth/mfa'),
  mfaEnroll: () => json('POST', '/auth/mfa/enroll', {}),
  mfaEnrollVerify: (code) => json('POST', '/auth/mfa/enroll/verify', { code }),
  mfaRemove: (factorId) => request(`/auth/mfa/${encodeURIComponent(factorId)}`, { method: 'DELETE' }),
  exportAccount: () => request('/account/export'),
  exportAccountCsv: async () => {
    const response = await fetch(`${API_ROOT}/account/export?format=csv`, { credentials: 'include' });
    if (!response.ok) throw new ApiError('Could not export your account data.', response.status);
    return response.text();
  },
  deleteAccount: (confirmation) => json('DELETE', '/account', { confirmation }),
  saveConsent: (accepted, version = 'v1') => json('PUT', '/patient/consent', { accepted, version }),
  logout: async () => { const result = await json('POST', '/auth/logout', {}); csrfToken = ''; return result; },
  profile: () => request('/patient/profile'),
  saveProfile: (profile) => json('PUT', '/patient/profile', profile),
  medicines: () => request('/patient/medicines'),
  saveMedicines: (medicines) => json('PUT', '/patient/medicines', { medicines }),
  deleteMedicine: (id) => request(`/patient/medicines/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  prescriptions: () => request('/prescriptions'),
  savePrescription: (prescription) => json('POST', '/prescriptions', prescription),
  updatePrescription: (id, prescription) => json('PUT', `/prescriptions/${encodeURIComponent(id)}`, prescription),
  deletePrescription: (id) => request(`/prescriptions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  records: () => request('/patient/records'),
  saveRecord: (record) => json('POST', '/patient/records', record),
  updateRecord: (id, record) => json('PUT', `/patient/records/${encodeURIComponent(id)}`, record),
  deleteRecord: (id) => request(`/patient/records/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  reconciliations: () => request('/reconciliations'),
  saveReconciliation: (body) => json('POST', '/reconciliations', body),
  updateReconciliation: (id, body) => json('PUT', `/reconciliations/${encodeURIComponent(id)}`, body),
  deleteReconciliation: (id) => request(`/reconciliations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  doctorAccessRequests: () => request('/doctor/access-requests'),
  requestPatient: (patientId) => json('POST', '/doctor/access-requests', { patientId }),
  deleteAccessRequest: (requestId) => request(`/doctor/access-requests/${encodeURIComponent(requestId)}`, { method: 'DELETE' }),
  patientAccessRequests: () => request('/patient/access-requests'),
  updateAccessRequest: (requestId, status) => json('PUT', `/patient/access-requests/${encodeURIComponent(requestId)}`, { status }),
  notifications: () => request('/notifications'),
  markNotificationRead: (notificationId) => json('POST', `/notifications/${encodeURIComponent(notificationId)}/read`, {}),
  indications: () => request('/indications'),
  addIndication: (patientId, body) => json('POST', `/doctor/patients/${encodeURIComponent(patientId)}/indications`, body),
  updateIndication: (patientId, id, body) => json('PUT', `/doctor/patients/${encodeURIComponent(patientId)}/indications/${encodeURIComponent(id)}`, body),
  deleteIndication: (patientId, id) => request(`/doctor/patients/${encodeURIComponent(patientId)}/indications/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  doctorPatient: (patientId, resource = '') => request(`/doctor/patients/${encodeURIComponent(patientId)}${resource ? `/${resource}` : ''}`),
};
