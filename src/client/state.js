export const LOCAL_KEY = 'medihuman.local-workspace.v3';
export const LOCAL_MODE_KEY = 'medihuman.mode';
export const LOCAL_TTL_MS = 30 * 60 * 1000;

// Navigation is grouped so the desktop rail can present labelled sections
// while the compact bar keeps the same items in one row.
export const patientNavGroups = [
  {
    label: 'Workspace',
    items: [['dashboard', 'home', 'Today'], ['medicines', 'medicines', 'Medicines'], ['scan', 'scan', 'Scan prescription'], ['records', 'document', 'Medical records']],
  },
  { label: 'My record', items: [], disclosure: 'patient' },
  {
    label: 'Care',
    items: [['care-team', 'care-team', 'Clinician access'], ['doctors', 'questions', 'Doctor discussion']],
  },
];

export const doctorNavGroups = [
  {
    label: 'Workspace',
    items: [['dashboard', 'home', 'Doctor dashboard'], ['doctor-patients', 'care-team', 'Approved patients']],
  },
];

export const patientNavItems = patientNavGroups.flatMap((group) => group.items);
export const doctorNavItems = doctorNavGroups.flatMap((group) => group.items);

export function emptyProfile() { return { fullName: '', dateOfBirth: '', allergies: '', conditions: '' }; }

export function createState() {
  return {
    screen: 'auth', authMode: 'login', authRole: 'patient', authRoleExplicit: false, role: 'patient', view: 'dashboard', localOnly: false, user: null, googleConfigured: false,
    profile: emptyProfile(), medicines: [], prescriptions: [], reconciliations: [], indications: [], notifications: [],
    prescriptionText: '', dispensedText: '', ocrText: '', scanSource: '', consent: false,
    doctorProfile: { displayName: '', specialty: '', registrationId: '', organization: '', verificationStatus: 'pending', verified: false },
    patientRequests: [], doctorRequests: [], doctorRecords: {}, selectedPatientId: '', localExitPrompt: false, profileMenuOpen: false, notificationsOpen: false, patientMenuOpen: false, doctorPatientMenuOpen: false, mobileMenuOpen: false, requesting: false,
    cameraStream: null, cameraError: '', questions: [
      { title: 'What should I ask before my dose is changed?', meta: 'Starter question · not medical advice' },
      { title: 'How can I make my medication routine easier?', meta: 'Starter question · not medical advice' },
    ],
    mfaFactors: [], mfaEnrollment: null, editingPrescriptionId: '', viewingPrescriptionId: '', viewingRecordId: '', editingIndicationId: '', saveStatus: { profile: '', medicines: '', prescription: '', reconciliation: '' }, errorMessage: '', dirty: false, scanSeen: false, medicineFilter: '', medicineDialog: null, patientSearch: '', recordTypeFilter: '', records: [], recordsFilter: '', recordsTypeFilter: '', recordsSort: 'desc', recordsFromDate: '', recordsToDate: '', recordUpload: { file: null, preview: '', progress: 0, error: '', busy: false }, requesting: false, ocrResult: null, ocrAnalysis: null, ocrConfirmed: false,  };
}

export function medicineObject(name, extra = {}) {
  return { id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, name, strength: '', dose: '', route: '', timing: '', notes: '', status: 'active', startedAt: '', stoppedAt: '', ...extra };
}

export function saveLocal(state) {
  if (!state.localOnly) return;
  const copy = {
    role: state.role, profile: state.profile, patientId: state.profile.patientId || state.user?.patientId || '', medicines: state.medicines,
    prescriptions: state.prescriptions, medicalRecords: state.records, reconciliations: state.reconciliations, indications: state.indications, notifications: state.notifications, prescriptionText: state.prescriptionText, dispensedText: state.dispensedText, ocrText: state.ocrText, scanSource: state.scanSource, questions: state.questions, consent: state.consent, recordsFilter: state.recordsFilter, recordsTypeFilter: state.recordsTypeFilter, recordsSort: state.recordsSort, recordsFromDate: state.recordsFromDate, recordsToDate: state.recordsToDate,
    doctorProfile: state.doctorProfile, accessRequests: state.patientRequests,
  };
    sessionStorage.setItem(LOCAL_KEY, JSON.stringify({ ...copy, expiresAt: Date.now() + LOCAL_TTL_MS }));
}

export function loadLocal(state) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(LOCAL_KEY) || '{}');
    if (saved.expiresAt && Number(saved.expiresAt) <= Date.now()) { sessionStorage.removeItem(LOCAL_KEY); return; }
    if (saved.profile) state.profile = { ...state.profile, ...saved.profile };
    if (saved.role === 'doctor' || saved.role === 'patient') state.role = state.authRole = saved.role;
    if (Array.isArray(saved.medicines)) state.medicines = saved.medicines;
    if (Array.isArray(saved.prescriptions)) state.prescriptions = saved.prescriptions;
    if (Array.isArray(saved.reconciliations)) state.reconciliations = saved.reconciliations;
    if (Array.isArray(saved.medicalRecords)) state.records = saved.medicalRecords;
    if (typeof saved.recordsFilter === 'string') state.recordsFilter = saved.recordsFilter;
    if (typeof saved.recordsTypeFilter === 'string') state.recordsTypeFilter = saved.recordsTypeFilter;
    if (saved.recordsSort === 'asc' || saved.recordsSort === 'desc') state.recordsSort = saved.recordsSort;
    if (typeof saved.recordsFromDate === 'string') state.recordsFromDate = saved.recordsFromDate;
    if (typeof saved.recordsToDate === 'string') state.recordsToDate = saved.recordsToDate;
    if (Array.isArray(saved.indications)) state.indications = saved.indications;
    if (Array.isArray(saved.notifications)) state.notifications = saved.notifications;
    if (typeof saved.prescriptionText === 'string') state.prescriptionText = saved.prescriptionText;
    if (typeof saved.dispensedText === 'string') state.dispensedText = saved.dispensedText;
    if (typeof saved.ocrText === 'string') state.ocrText = saved.ocrText;
    if (typeof saved.scanSource === 'string') state.scanSource = saved.scanSource;
    if (Array.isArray(saved.questions)) state.questions = saved.questions;
    if (Array.isArray(saved.accessRequests)) { state.patientRequests = saved.accessRequests; state.doctorRequests = saved.accessRequests; }
    if (saved.doctorProfile) state.doctorProfile = { ...state.doctorProfile, ...saved.doctorProfile };
    state.consent = Boolean(saved.consent);
  } catch { sessionStorage.removeItem(LOCAL_KEY); }
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
