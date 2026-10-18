const API_ROOT = '/api';
let csrfToken = '';

export class ApiError extends Error {
  constructor(message, status = 0, code = 'NETWORK_ERROR') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request(path, options = {}) {
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
  if (!response.ok) throw new ApiError(payload.error?.message || 'Request could not be completed.', response.status, payload.error?.code);
  return payload;
}

function json(method, path, body) { return request(path, { method, body: JSON.stringify(body) }); }

export const api = {
  me: () => request('/me'),
  login: (body) => json('POST', '/auth/login', body),
  register: (body) => json('POST', '/auth/register', body),
  logout: () => json('POST', '/auth/logout', {}),
  profile: () => request('/patient/profile'),
  saveProfile: (profile) => json('PUT', '/patient/profile', profile),
  medicines: () => request('/patient/medicines'),
  saveMedicines: (medicines) => json('PUT', '/patient/medicines', { medicines }),
  prescriptions: () => request('/prescriptions'),
  savePrescription: (prescription) => json('POST', '/prescriptions', prescription),
  saveReconciliation: (body) => json('POST', '/reconciliations', body),
  doctorAccessRequests: () => request('/doctor/access-requests'),
  requestPatient: (patientId) => json('POST', '/doctor/access-requests', { patientId }),
  patientAccessRequests: () => request('/patient/access-requests'),
  updateAccessRequest: (requestId, status) => json('PUT', `/patient/access-requests/${encodeURIComponent(requestId)}`, { status }),
  doctorPatient: (patientId, resource = '') => request(`/doctor/patients/${encodeURIComponent(patientId)}${resource ? `/${resource}` : ''}`),
};
