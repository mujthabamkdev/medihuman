export const LOCAL_KEY = 'medihuman.local-workspace.v3';
export const LOCAL_MODE_KEY = 'medihuman.mode';

export const patientNavItems = [
  ['dashboard', 'home', 'Today'], ['medicines', 'medicines', 'Medicines'],
  ['scan', 'scan', 'Scan prescription'], ['doctors', 'questions', 'Doctor discussion'],
];
export const doctorNavItems = [
  ['dashboard', 'home', 'Doctor dashboard'], ['doctor-patients', 'care-team', 'Approved patients'],
];

export function emptyProfile() { return { fullName: '', dateOfBirth: '', allergies: '', conditions: '' }; }

export function createState() {
  return {
    screen: 'auth', authMode: 'login', authRole: 'patient', authRoleExplicit: false, role: 'patient', view: 'dashboard', localOnly: false, user: null,
    profile: emptyProfile(), medicines: [], prescriptions: [], reconciliations: [], indications: [], notifications: [],
    prescriptionText: '', dispensedText: '', ocrText: '', scanSource: '', consent: false,
    doctorProfile: { displayName: '', specialty: '', registrationId: '', organization: '', verificationStatus: 'pending', verified: false },
    patientRequests: [], doctorRequests: [], doctorRecords: {}, selectedPatientId: '', localExitPrompt: false, profileMenuOpen: false, notificationsOpen: false, patientMenuOpen: false, mobileMenuOpen: false,
    cameraStream: null, cameraError: '', questions: [
      { title: 'What should I ask before my dose is changed?', meta: 'Starter question · not medical advice' },
      { title: 'How can I make my medication routine easier?', meta: 'Starter question · not medical advice' },
    ],
    mfaFactors: [], mfaEnrollment: null, editingPrescriptionId: '', editingIndicationId: '', saveStatus: { profile: '', medicines: '', reconciliation: '' },
  };
}

export function medicineObject(name, extra = {}) {
  return { id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, name, strength: '', dose: '', route: '', timing: '', notes: '', ...extra };
}

export function saveLocal(state) {
  if (!state.localOnly) return;
  const copy = {
    role: state.role, profile: state.profile, patientId: state.profile.patientId || state.user?.patientId || '', medicines: state.medicines,
    prescriptions: state.prescriptions, reconciliations: state.reconciliations, indications: state.indications, notifications: state.notifications, prescriptionText: state.prescriptionText, dispensedText: state.dispensedText, questions: state.questions, consent: state.consent,
    doctorProfile: state.doctorProfile, accessRequests: state.patientRequests,
  };
  localStorage.setItem(LOCAL_KEY, JSON.stringify(copy));
}

export function loadLocal(state) {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}');
    if (saved.profile) state.profile = { ...state.profile, ...saved.profile };
    if (saved.role === 'doctor' || saved.role === 'patient') state.role = state.authRole = saved.role;
    if (Array.isArray(saved.medicines)) state.medicines = saved.medicines;
    if (Array.isArray(saved.prescriptions)) state.prescriptions = saved.prescriptions;
    if (Array.isArray(saved.reconciliations)) state.reconciliations = saved.reconciliations;
    if (Array.isArray(saved.indications)) state.indications = saved.indications;
    if (Array.isArray(saved.notifications)) state.notifications = saved.notifications;
    if (typeof saved.prescriptionText === 'string') state.prescriptionText = saved.prescriptionText;
    if (typeof saved.dispensedText === 'string') state.dispensedText = saved.dispensedText;
    if (Array.isArray(saved.questions)) state.questions = saved.questions;
    if (Array.isArray(saved.accessRequests)) { state.patientRequests = saved.accessRequests; state.doctorRequests = saved.accessRequests; }
    if (saved.doctorProfile) state.doctorProfile = { ...state.doctorProfile, ...saved.doctorProfile };
    state.consent = Boolean(saved.consent);
  } catch { localStorage.removeItem(LOCAL_KEY); }
}

export function setLocalMode(enabled) {
  if (enabled) localStorage.setItem(LOCAL_MODE_KEY, 'local');
  else localStorage.removeItem(LOCAL_MODE_KEY);
}

export function ensureLocalIdentity(state) {
  if (state.role === 'patient') {
    const patientId = state.profile.patientId || state.user?.patientId || `local-patient-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    state.profile.patientId = patientId;
    state.user = { id: 'local-patient', email: 'local.patient@medihuman', role: 'patient', patientId };
  } else {
    state.user = { id: 'local-doctor', email: 'local.doctor@medihuman', role: 'doctor' };
  }
}
