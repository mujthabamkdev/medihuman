import { compareMedicines, lifestyleGuidance } from './medication-logic.js';
import { analyzeMedicationSafety, medicationCompositionSummary } from './clinical-logic.js';
import { api, ApiError } from './api-client.js';
import { createOcrAdapter } from './ocr-adapter.js';

const LOCAL_KEY = 'medihuman.local-workspace.v3';
const LOCAL_MODE_KEY = 'medihuman.mode';
const root = document.querySelector('#app');
const ocr = createOcrAdapter();
const state = {
  screen: 'auth', authMode: 'login', authRole: 'patient', authRoleExplicit: false, role: 'patient', view: 'dashboard', localOnly: false, user: null,
  profile: { fullName: '', dateOfBirth: '', allergies: '', conditions: '' }, medicines: [],
  prescriptionText: '', dispensedText: '', ocrText: '', scanSource: '', consent: false,
  doctorProfile: { displayName: '', specialty: '', registrationId: '', organization: '', verificationStatus: 'pending', verified: false },
  patientRequests: [], doctorRequests: [], doctorRecords: {}, selectedPatientId: '', localExitPrompt: false,
  cameraStream: null, cameraError: '', questions: [
    { title: 'What should I ask before my dose is changed?', meta: 'Starter question · not medical advice' },
    { title: 'How can I make my medication routine easier?', meta: 'Starter question · not medical advice' },
  ],
};

const patientNavItems = [
  ['dashboard', 'home', 'Today'], ['patient', 'profile', 'Patient'], ['medicines', 'medicines', 'Medicines'],
  ['scan', 'scan', 'Scan prescription'], ['care-team', 'care-team', 'Care team'], ['doctors', 'questions', 'Doctor discussion'], ['lifestyle', 'support', 'Daily support'],
];
const doctorNavItems = [
  ['dashboard', 'home', 'Doctor dashboard'], ['doctor-patients', 'care-team', 'Approved patients'],
];

function emptyProfile() { return { fullName: '', dateOfBirth: '', allergies: '', conditions: '' }; }

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

const ICON_PATHS = {
  home: '<path d="m3.5 10 8.5-6.5 8.5 6.5v9.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/><path d="M9 20.5v-6h6v6"/>',
  profile: '<circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c.8-3.4 3.3-5 7.5-5s6.7 1.6 7.5 5"/>',
  medicines: '<path d="M8.5 4.5a4 4 0 0 1 5.7 0l5.3 5.3a4 4 0 0 1-5.7 5.7l-5.3-5.3a4 4 0 0 1 0-5.7Z"/><path d="m10.5 6.5 7 7"/>',
  scan: '<rect x="5" y="6" width="14" height="12" rx="2"/><path d="M8 4v2M16 4v2M8 18v2M16 18v2M8 10h8M8 13h5"/>',
  'care-team': '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3.5 20c.5-3.2 2.3-5 5.5-5s5 1.8 5.5 5M15 15c2.8 0 4.6 1.5 5 4"/>',
  questions: '<path d="M5 5.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4 3v-3H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"/><path d="M8 10h8M8 13h5"/>',
  support: '<path d="M12 20s-7-4.3-7-10a4 4 0 0 1 7-2.4A4 4 0 0 1 19 10c0 5.7-7 10-7 10Z"/><path d="M12 10v4M10 12h4"/>',
  privacy: '<path d="M12 3.5 19 6v5.2c0 4.6-2.8 7.7-7 9.3-4.2-1.6-7-4.7-7-9.3V6z"/><path d="m8.8 12 2.1 2.1 4.3-4.3"/>',
  signout: '<path d="M10 5H5.5a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 0 5.5 19H10"/><path d="M14 8l4 4-4 4M9 12h9"/>',
  spark: '<path d="m12 3 1.5 6.5L20 12l-6.5 2.5L12 21l-1.5-6.5L4 12l6.5-2.5z"/>',
  document: '<path d="M7 3.5h7l4 4V20.5H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z"/><path d="M14 3.5v4h4M8.5 12h5M8.5 15h5"/>',
  arrow: '<path d="M5 12h13M13 7l5 5-5 5"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  safety: '<path d="M12 3.5 19 6v5.2c0 4.6-2.8 7.7-7 9.3-4.2-1.6-7-4.7-7-9.3V6z"/><path d="m8.5 12 2.2 2.2 4.8-4.8"/>',
  edit: '<path d="m5 16.5-.8 3.3 3.3-.8L18 8.5 15.5 6z"/><path d="m14.5 7 2.5 2.5"/>',
  compare: '<path d="M6 5v14M18 5v14M3.5 8.5H8.5M15.5 15.5h5M8 6.5l2-1.5-2-1.5M16 16.5l-2 1.5 2 1.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 10.5v5M12 7.5h.01"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2"/>',
};

function svgIcon(name, className = '') {
  return `<svg class="ui-icon ${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON_PATHS[name] || ICON_PATHS.info}</svg>`;
}

function brandIcon() {
  return '<svg class="brand-svg" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect x="1" y="1" width="30" height="30" rx="10" fill="currentColor"/><path d="M16 8v16M8 16h16" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/><circle cx="25" cy="7" r="3" fill="#9fdcd0"/></svg>';
}

function saveLocal() {
  if (!state.localOnly) return;
  const copy = {
    role: state.role, profile: state.profile, patientId: state.profile.patientId || state.user?.patientId || '', medicines: state.medicines,
    prescriptionText: state.prescriptionText, dispensedText: state.dispensedText, questions: state.questions, consent: state.consent,
    doctorProfile: state.doctorProfile, accessRequests: state.patientRequests,
  };
  localStorage.setItem(LOCAL_KEY, JSON.stringify(copy));
}

function loadLocal() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}');
    if (saved.profile) state.profile = { ...state.profile, ...saved.profile };
    if (saved.role === 'doctor' || saved.role === 'patient') state.role = state.authRole = saved.role;
    if (Array.isArray(saved.medicines)) state.medicines = saved.medicines;
    if (typeof saved.prescriptionText === 'string') state.prescriptionText = saved.prescriptionText;
    if (typeof saved.dispensedText === 'string') state.dispensedText = saved.dispensedText;
    if (Array.isArray(saved.questions)) state.questions = saved.questions;
    if (Array.isArray(saved.accessRequests)) { state.patientRequests = saved.accessRequests; state.doctorRequests = saved.accessRequests; }
    if (saved.doctorProfile) state.doctorProfile = { ...state.doctorProfile, ...saved.doctorProfile };
    state.consent = Boolean(saved.consent);
  } catch { localStorage.removeItem(LOCAL_KEY); }
}

function initials() {
  const name = state.profile.fullName || state.user?.email || 'MH';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function notice(text, kind = 'info') { return `<div class="notice notice-${kind}" role="status"><span class="notice-icon">${kind === 'warning' ? '!' : 'i'}</span><span>${text}</span></div>`; }
function button(label, action, className = 'button button-primary', extra = '') { return `<button type="button" class="${className}" data-action="${action}" ${extra}>${label}</button>`; }

function renderAuth() {
  const register = state.authMode === 'register';
  const doctor = state.authRole === 'doctor';
  return `<main class="auth-layout">
     <section class="auth-brand-panel"><a class="brand brand-light" href="/" aria-label="MediHuman home"><span class="brand-mark">${brandIcon()}</span>MediHuman</a>
       <div class="auth-intro"><p class="eyebrow eyebrow-light">Medication information, organised</p><h1>Prepare for better care conversations.</h1><p>Review prescriptions, organise medicine details, and bring clearer questions to your care team.</p></div>
      <div class="auth-quote"><span class="quote-mark">“</span><p>Organized information helps conversations. It never replaces them.</p></div>
    </section>
     <section class="auth-card-wrap"><div class="auth-card"><div class="auth-card-head"><span class="mini-mark">${brandIcon()}</span><span class="privacy-chip">Privacy-focused workspace</span></div>
      <div class="auth-tabs" role="tablist"><button class="auth-tab ${!register ? 'active' : ''}" data-action="auth-login" role="tab" aria-selected="${!register}">Sign in</button><button class="auth-tab ${register ? 'active' : ''}" data-action="auth-register" role="tab" aria-selected="${register}">Create account</button></div>
       <div class="role-picker" aria-label="Choose workspace role"><span class="role-picker-label">I am signing in as</span><div class="role-picker-buttons"><button type="button" class="role-choice ${!doctor ? 'active' : ''}" data-action="auth-role" data-role="patient">Patient</button><button type="button" class="role-choice ${doctor ? 'active' : ''}" data-action="auth-role" data-role="doctor">Doctor</button></div></div>
        <h2>${register ? (doctor ? 'Create a clinician workspace' : 'Create your care workspace') : 'Welcome back'}</h2><p class="auth-subtitle">${register ? 'Create an account to save your information to your MediHuman workspace.' : 'Sign in to continue organising your medication information.'}</p>${doctor && register ? notice('<strong>Verification pending.</strong> Clinician accounts remain unverified until registration details are reviewed by your organisation.', 'warning') : ''}${state.authError ? notice(escapeHtml(state.authError), 'info') : ''}
        <form class="stack-form" data-form="auth"><label>Email address<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label><label>Password<input name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" minlength="12" required placeholder="At least 12 characters"></label>
        ${register && doctor ? `<label>Name<input name="name" required autocomplete="name" placeholder="Dr Maya Johnson"></label><label>Specialty<input name="specialty" required placeholder="e.g. Family medicine"></label><label>Registration ID<input name="registrationId" required placeholder="Professional registration number"></label><label>Organisation<input name="organization" required placeholder="Clinic or health system"></label>` : ''}${register && !doctor ? '<label>Name (optional)<input name="fullName" autocomplete="name" placeholder="Your name"></label>' : ''}
        ${register ? `<label class="check-row"><input name="consent" type="checkbox" required><span>I understand that MediHuman organises information; it does not diagnose, prescribe, or replace advice from a clinician or pharmacist.</span></label>` : ''}<div id="auth-error"></div><button class="button button-primary button-wide" type="submit">${register ? 'Create account' : 'Sign in'} <span>→</span></button></form>
       <div class="auth-divider"><span>or</span></div>${button('Use without an account', 'local-mode', 'button button-secondary button-wide')}
       <p class="form-footnote">Your information stays in this browser and is not synced to an account.</p>
     </div><p class="auth-disclaimer">MediHuman does not diagnose, prescribe, or validate handwriting. For emergency symptoms, call your local emergency number now.</p></section>
  </main>`;
}

function renderTopbar(title) {
  return `<header class="topbar"><button class="mobile-menu" data-action="toggle-menu" aria-label="Open navigation">☰</button><div><p class="topbar-kicker">${state.localOnly ? 'Stored only in this browser' : 'Care workspace'}</p><h1>${title}</h1></div><div class="topbar-actions"><span class="secure-label"><span class="status-dot"></span>${state.localOnly ? 'Stored on this device' : 'Signed-in session'}</span><button class="avatar" data-action="patient" aria-label="Open profile">${escapeHtml(initials())}</button></div></header>`;
}

function renderSidebar() {
  const navItems = state.role === 'doctor' ? doctorNavItems : patientNavItems;
  return `<aside class="sidebar" id="sidebar"><div class="sidebar-head"><a class="brand" href="/" aria-label="MediHuman home"><span class="brand-mark">+</span>MediHuman</a><button class="close-menu" data-action="toggle-menu" aria-label="Close navigation">×</button></div><div class="workspace-card"><span class="workspace-avatar">${escapeHtml(initials())}</span><div><strong>${escapeHtml(state.role === 'doctor' ? (state.doctorProfile.displayName || 'Clinician workspace') : (state.profile.fullName || 'Your workspace'))}</strong><span>${state.localOnly ? 'Stored only in this browser' : escapeHtml(state.user?.email || 'Signed in')}</span></div></div><nav class="main-nav" aria-label="Main navigation">${navItems.map(([id, icon, label]) => `<button class="nav-item ${state.view === id ? 'active' : ''}" data-action="nav" data-view="${id}"><span class="nav-icon">${icon}</span><span>${label}</span>${id === 'scan' ? '<span class="nav-badge">New</span>' : ''}</button>`).join('')}</nav><div class="sidebar-bottom"><button class="nav-item" data-action="privacy"><span class="nav-icon">◈</span><span>Privacy and acknowledgments</span></button><button class="nav-item" data-action="logout"><span class="nav-icon">↪</span><span>${state.localOnly ? 'Exit local mode' : 'Sign out'}</span></button></div></aside>`;
}

function renderShell() {
  const titles = { dashboard: state.role === 'doctor' ? 'Clinician dashboard' : 'Today', patient: 'Patient profile', medicines: 'Current medicines', scan: 'Capture prescription details', review: 'Verify prescription details', reconcile: 'Compare medicine lists', composition: 'Medication safety review', doctors: 'Questions for your care team', 'care-team': 'Clinician access', 'doctor-patients': 'Approved patient records', lifestyle: 'Daily support', privacy: 'Privacy and acknowledgments' };
  const exitPrompt = state.localExitPrompt ? `<div class="modal-backdrop"><section class="card local-exit-dialog" role="dialog" aria-modal="true" aria-labelledby="local-exit-title"><h3 id="local-exit-title">Exit stored-browser mode?</h3><p>Choose whether this browser keeps your workspace for next time.</p><div class="modal-actions">${button('Keep data and exit', 'local-exit-preserve', 'button button-primary')}${button('Clear data and exit', 'local-exit-clear', 'button button-outline')}${button('Cancel', 'local-exit-cancel', 'button button-secondary')}</div></section></div>` : '';
  return `<div class="app-shell">${renderSidebar()}<div class="shell-content">${renderTopbar(titles[state.view] || 'MediHuman')}<main class="content-page">${renderView()}</main><footer class="app-footer"><span>MediHuman organises information for care conversations. It does not diagnose, prescribe, or replace a clinician or pharmacist.</span><button data-action="privacy" class="footer-link">Privacy and acknowledgments</button></footer></div></div>${exitPrompt}`;
}

function renderView() {
  if (state.role === 'doctor' && state.view === 'dashboard') return renderDoctorDashboard();
  if (state.role === 'doctor' && state.view === 'doctor-patients') return renderDoctorPatients();
  if (state.view === 'patient') return renderPatient();
  if (state.view === 'medicines') return renderMedicines();
  if (state.view === 'scan') return renderScan();
  if (state.view === 'review') return renderReview();
  if (state.view === 'reconcile') return renderReconcile();
  if (state.view === 'composition') return renderComposition();
  if (state.view === 'doctors') return renderDoctors();
  if (state.view === 'care-team') return renderCareTeam();
  if (state.view === 'lifestyle') return renderLifestyle();
  if (state.view === 'privacy') return renderPrivacy();
  return renderDashboard();
}

function renderDashboard() {
  const comparison = compareMedicines(state.prescriptionText, state.dispensedText);
  const hasList = comparison.prescribed.length > 0 || comparison.dispensed.length > 0;
  const reviewCount = comparison.missing.length + comparison.unexpected.length;
  return `<div class="welcome-row"><div><p class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p><h2 class="page-title">${escapeHtml(state.profile.fullName ? `How is ${state.profile.fullName.split(' ')[0]} doing?` : 'Review your medication information.')}</h2><p class="page-lede">Keep medicine details together, then take clear questions to your pharmacist or clinician.</p></div><div class="today-orb">✦</div></div>
   <div class="dashboard-grid"><section class="feature-card feature-scan"><div class="feature-copy"><span class="card-kicker">QUICK CAPTURE</span><h3>Review a new prescription</h3><p>Use your camera or choose a photo. Compare every captured detail with the original before saving.</p>${button('Capture prescription <span>→</span>', 'go-scan', 'button button-light')}</div><div class="scan-illustration"><span>✣</span><i></i><i></i><i></i></div></section>
    <section class="card medication-summary"><div class="card-heading"><div><p class="card-kicker">YOUR LIST</p><h3>Current medicines</h3></div><button class="icon-button" data-action="nav" data-view="medicines" aria-label="View medicines">→</button></div>${state.medicines.length ? `<div class="medicine-preview">${state.medicines.slice(0, 3).map((medicine) => `<div class="medicine-row"><span class="medicine-dot"></span><div><strong>${escapeHtml(medicine.name)}</strong><span>${escapeHtml([medicine.strength, medicine.timing].filter(Boolean).join(' · ') || 'Details to review')}</span></div></div>`).join('')}</div><button class="text-link" data-action="nav" data-view="medicines">View all medicines →</button>` : `<div class="empty-state compact"><span class="empty-icon">＋</span><p>No medicines added yet.</p><button class="text-link" data-action="nav" data-view="medicines">Add your current list →</button></div>`}</section>
     <section class="card check-card"><div class="card-heading"><div><p class="card-kicker">LAST COMPARISON</p><h3>${hasList ? (reviewCount ? 'Difference requires review' : 'Medicine names match') : 'No comparison yet'}</h3></div><span class="status-pill ${reviewCount ? 'pill-warn' : 'pill-green'}">${hasList ? (reviewCount ? `${reviewCount} to review` : 'Complete') : 'Start'}</span></div><p>${hasList ? (reviewCount ? 'The lists differ. Confirm the difference with your pharmacy or prescriber.' : 'Medicine names match after text comparison. This does not confirm dose, formulation, substitutions, or safety.') : 'Compare prescribed and dispensed medicine names.'}</p>${button(hasList ? 'Open comparison' : 'Start comparison', 'go-reconcile', 'button button-outline')}</section>
     <section class="card safety-card"><div class="safety-heading"><span class="safety-symbol">♥</span><div><p class="card-kicker">SAFETY FIRST</p><h3>Pause when information does not match</h3></div></div><p>Do not start, stop, or change a dose based only on this app. Ask a pharmacist or clinician.</p><button class="text-link" data-action="nav" data-view="composition">Open limited safety review →</button></section>
   </div><section class="section-intro"><p class="eyebrow">Your care workspace</p><h3>Organised information supports better conversations.</h3><p>Choose a task when you are ready. Your notes remain yours to edit and clear.</p></section>`;
}

function renderPatient() {
  const p = state.profile;
  const patientId = p.patientId || state.user?.patientId || 'Generated after account setup';
  return `<div class="section-intro"><p class="eyebrow">PATIENT PROFILE</p><h2 class="page-title">Record information for care conversations.</h2><p>These details help you prepare questions. Share them only when you choose.</p></div><div class="two-column"><section class="card form-card"><div class="card-heading"><div><h3>Patient information</h3><p class="muted">Optional details. Edit anytime.</p></div><span class="soft-icon">♡</span></div><form class="stack-form" data-form="profile"><label>Full name<input name="fullName" value="${escapeHtml(p.fullName)}" autocomplete="name" placeholder="e.g. Maya Johnson"></label><label>Date of birth<input name="dateOfBirth" value="${escapeHtml(p.dateOfBirth)}" type="date"></label><label>Known health conditions or diagnoses<textarea name="conditions" rows="3" placeholder="Only what you are comfortable recording">${escapeHtml(p.conditions)}</textarea></label><label>Allergies<textarea name="allergies" rows="3" placeholder="e.g. penicillin, or none known">${escapeHtml(p.allergies)}</textarea></label><div class="form-actions">${button('Save profile', 'save-profile', 'button button-primary')}<span class="save-note">Saved ${state.localOnly ? 'on this device' : 'to your account'}</span></div></form></section><aside class="card side-note">${notice('<strong>Privacy tip.</strong> Record only what you need for a care conversation. Clear this workspace from Privacy and acknowledgments when you are finished.', 'info')}<div class="patient-id-card"><p class="card-kicker">PRIVATE PATIENT ID</p><code>${escapeHtml(patientId)}</code><p>Share this ID only with a clinician you intend to authorise. It does not include your name.</p></div><h3>What this does</h3><p>MediHuman displays your notes alongside medication information. It does not determine whether a medicine is appropriate or safe for you.</p>${button('Manage clinician access', 'nav', 'button button-outline', 'data-view="care-team"')}</aside></div>`;
}

function medicineObject(name, extra = {}) { return { id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, name, strength: '', dose: '', route: '', timing: '', notes: '', ...extra }; }

function renderMedicines() {
  return `<div class="section-intro inline-intro"><div><p class="eyebrow">MEDICATION LIST</p><h2 class="page-title">Record your current medicines.</h2><p>Record the medicine name, strength, dose, and directions exactly as shown. This list does not replace your official medication record.</p></div>${button('Capture prescription details', 'go-scan', 'button button-primary')}</div><section class="card medicine-editor"><div class="card-heading"><div><h3>Current medicines</h3><p class="muted">${state.medicines.length} item${state.medicines.length === 1 ? '' : 's'} recorded</p></div><span class="soft-icon">▣</span></div>${state.medicines.length ? `<div class="medicine-list">${state.medicines.map((m, index) => `<article class="medicine-detail"><div class="medicine-number">${String(index + 1).padStart(2, '0')}</div><div class="medicine-fields"><label>Medicine name<input data-med-index="${index}" data-med-key="name" value="${escapeHtml(m.name)}"></label><label>Strength<input data-med-index="${index}" data-med-key="strength" value="${escapeHtml(m.strength)}" placeholder="e.g. 500 mg"></label><label>Directions: when and how often<input data-med-index="${index}" data-med-key="timing" value="${escapeHtml(m.timing)}" placeholder="e.g. morning with food"></label></div><button class="remove-button" data-action="remove-medicine" data-index="${index}" aria-label="Remove ${escapeHtml(m.name)}">×</button></article>`).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">▣</span><h3>No current medicines recorded</h3><p>Add medicines manually or review prescription details to start.</p></div>`}<div class="medicine-actions">${button('＋ Add medicine', 'add-medicine', 'button button-secondary')}${button('Save medication list', 'save-medicines', 'button button-primary')}<span class="save-note" id="medicine-save-note"></span></div></section>${notice('<strong>Check the label.</strong> Include strength and formulation when shown. A matching name does not confirm that the medicine is appropriate or safe for you.', 'warning')}</div>`;
}

function renderScan() {
  return `<div class="section-intro"><p class="eyebrow">PRESCRIPTION CAPTURE</p><h2 class="page-title">Bring the page into focus.</h2><p>Take a clear photo in good light, then review the captured text yourself. Handwriting and OCR can be wrong.</p></div><div class="scan-grid"><section class="card camera-card"><div class="card-heading"><div><h3>Camera capture</h3><p class="muted">Nothing is uploaded by this screen.</p></div><span class="soft-icon">⌁</span></div><div class="camera-stage ${state.cameraError ? 'has-error' : ''}">${state.cameraError ? `<div class="camera-error"><span class="error-symbol">!</span><h4>Camera needs attention</h4><p>${escapeHtml(state.cameraError)}</p><button class="text-link" data-action="camera-start">Try camera again →</button></div>` : `<video id="camera-video" playsinline muted aria-label="Camera preview"></video><div class="camera-guide"><span></span></div><p class="camera-placeholder">${state.cameraStream ? 'Center the prescription inside the frame' : 'Camera preview appears after permission'}</p>`}</div><div class="camera-actions">${state.cameraStream ? `${button('Capture frame', 'camera-capture', 'button button-primary')}${button('Stop camera', 'camera-stop', 'button button-secondary')}` : button('Allow camera', 'camera-start', 'button button-primary')}<label class="button button-secondary file-button">Upload photo<input id="prescription-file" type="file" accept="image/*" capture="environment"></label></div><p class="privacy-caption">Your browser will ask for camera permission. You can deny it and enter the prescription manually.</p></section><section class="card manual-card"><div class="card-heading"><div><h3>Manual entry</h3><p class="muted">Best fallback when text is unclear.</p></div><span class="soft-icon">✎</span></div><label class="large-label">Prescription details<textarea id="manual-prescription" rows="10" placeholder="Medicine name · strength · directions\nOne item per line">${escapeHtml(state.prescriptionText)}</textarea></label>${notice('MediHuman does not claim handwriting OCR is clinically reliable. Confirm every name, strength, and direction against the original and your pharmacist.', 'warning')}<div class="form-actions">${button('Continue to review', 'manual-review', 'button button-primary')}<span class="save-note">You edit before anything is saved.</span></div></section></div>`;
}

function renderReview() {
  return `<div class="section-intro"><p class="eyebrow">STEP 2 OF 3 · YOUR REVIEW</p><h2 class="page-title">Does this match the page?</h2><p>Correct names, strengths, and directions before continuing. Blank or uncertain text should be entered manually.</p></div><section class="card review-card"><div class="review-toolbar"><div><span class="review-status">${state.scanSource || 'Manual entry'}</span><h3>Captured prescription</h3></div><button class="text-link" data-action="nav" data-view="scan">← Capture again</button></div><label class="large-label">Review and edit<textarea id="review-text" rows="12">${escapeHtml(state.ocrText || state.prescriptionText)}</textarea></label><div class="review-checks"><div><span class="check-icon">✓</span><span>Compare each line with the source</span></div><div><span class="check-icon">✓</span><span>Include strength and formulation</span></div><div><span class="check-icon">✓</span><span>Ask a pharmacist about uncertainty</span></div></div><div class="form-actions">${button('Use this list', 'save-review', 'button button-primary')}<span class="save-note">No clinical interpretation is performed.</span></div></section>`;
}

function renderReconcile() {
  const comparison = compareMedicines(state.prescriptionText, state.dispensedText);
  const has = comparison.prescribed.length || comparison.dispensed.length;
  const list = (items, empty) => items.length ? `<ul class="result-list">${items.map((item) => `<li>${escapeHtml(item.name)}${item.count > 1 ? ` <small>×${item.count}</small>` : ''}</li>`).join('')}</ul>` : `<p class="result-empty">${empty}</p>`;
  return `<div class="section-intro inline-intro"><div><p class="eyebrow">STEP 3 · RECONCILIATION</p><h2 class="page-title">Compare, then clarify.</h2><p>Exact-name comparison only. It cannot verify dose safety, substitutions, or clinical appropriateness.</p></div><span class="status-pill ${has && comparison.isExactMatch ? 'pill-green' : has ? 'pill-warn' : 'pill-neutral'}">${has ? (comparison.isExactMatch ? 'Exact names match' : 'Review needed') : 'Waiting for lists'}</span></div><section class="card reconciliation-card"><div class="list-input-grid"><label class="large-label">Prescribed<textarea id="prescribed-list" rows="8" placeholder="One medicine per line">${escapeHtml(state.prescriptionText)}</textarea></label><label class="large-label">Dispensed<textarea id="dispensed-list" rows="8" placeholder="What the pharmacy provided">${escapeHtml(state.dispensedText)}</textarea></label></div><div class="reconcile-actions">${button('Run comparison', 'run-reconcile', 'button button-primary')}<span class="save-note">Names are compared after trimming spaces and letter case.</span></div></section>${has ? `<section class="result-board"><div class="result-board-head"><div><p class="card-kicker">RESULT</p><h3>${comparison.isExactMatch ? 'Your lists line up by name.' : 'A conversation is recommended.'}</h3></div>${button('Review safety notes', 'go-composition', 'button button-outline')}</div><div class="result-columns"><div class="result-col good"><span class="result-label">MATCHED</span>${list(comparison.matched, 'No exact matches')}</div><div class="result-col warn"><span class="result-label">MISSING</span>${list(comparison.missing, 'None')}</div><div class="result-col alert"><span class="result-label">UNEXPECTED</span>${list(comparison.unexpected, 'None')}</div></div></section>` : notice('Add both lists to see a reconciliation. A missing or unexpected name is a reason to pause and contact the pharmacy or prescriber.', 'info')}</div>`;
}

function renderComposition() {
  const names = state.medicines.map((m) => m.name).filter(Boolean);
  const findings = analyzeMedicationSafety(state.medicines, state.profile);
  const composition = medicationCompositionSummary(state.medicines);
  const findingMarkup = findings.map((finding) => `<li class="clinical-finding finding-${escapeHtml(finding.severity)}"><span class="finding-severity">${escapeHtml(finding.severity)}</span><div><strong>${escapeHtml(finding.title)}</strong><p>${escapeHtml(finding.detail)}</p></div></li>`).join('');
  const compositionMarkup = composition.length ? composition.map((medicine) => `<li class="composition-row"><div><strong>${escapeHtml(medicine.name)}</strong><span>${escapeHtml([medicine.strength, medicine.dose].filter(Boolean).join(' · ') || 'Strength not recorded')}</span></div><span class="composition-chip">${escapeHtml(medicine.ingredient)} · ${escapeHtml(medicine.className)}</span></li>`).join('') : '<li class="result-empty">Add current medicines to see composition clues.</li>';
  const hasHighRisk = findings.some((finding) => finding.severity === 'high');
  return `<div class="section-intro"><p class="eyebrow">SAFETY REVIEW</p><h2 class="page-title">Look closer, with a clinician.</h2><p>This is a transparent rule-based screen for a small reference set. It is not a complete interaction checker, diagnosis, or prescribing tool.</p></div><div class="risk-grid"><section class="card risk-overview"><div class="risk-score"><div class="risk-ring ${hasHighRisk ? 'risk-ring-high' : ''}"><span>${hasHighRisk ? '!' : 'i'}</span></div><div><p class="card-kicker">REVIEW STATUS</p><h3>${hasHighRisk ? 'Pause and ask promptly' : 'Questions to review'}</h3><p>${findings.length} rule-based note${findings.length === 1 ? '' : 's'} from the recorded profile and current list.</p></div></div><ul class="clinical-findings">${findingMarkup}</ul>${notice('<strong>Never change a medicine on your own.</strong> Bring this list to a pharmacist or clinician, especially after a hospital visit or new prescription.', 'warning')}<button class="button button-primary" data-action="nav" data-view="doctors">Prepare a question</button></section><section class="card checklist-card"><div class="card-heading"><div><p class="card-kicker">ACTIVE INGREDIENT VIEW</p><h3>What MediHuman can identify</h3></div><span class="soft-icon">?</span></div><ul class="composition-list">${compositionMarkup}</ul><ul class="safety-checklist"><li><span>01</span><div><strong>Confirm every label and strength</strong><p>Brand names, formulations, supplements, and handwriting can change the result.</p></div></li><li><span>02</span><div><strong>Include non-prescription products</strong><p>Tell your clinician about vitamins, herbal products, and over-the-counter medicines.</p></div></li><li><span>03</span><div><strong>Know urgent warning signs</strong><p>Trouble breathing, facial swelling, fainting, or severe rash need urgent care.</p></div></li></ul></section></div>`;
}

function renderDoctors() {
  return `<div class="section-intro inline-intro"><div><p class="eyebrow">CONVERSATION PREP</p><h2 class="page-title">Bring better questions.</h2><p>Keep a short list for your clinician or pharmacist. MediHuman does not send messages.</p></div><span class="soft-icon large-soft">◌</span></div><section class="card question-card"><div class="card-heading"><div><h3>Questions for your care team</h3><p class="muted">Stored ${state.localOnly ? 'on this device' : 'in this workspace'}.</p></div></div><div class="question-list">${state.questions.map((question, index) => `<article class="question-item"><span class="question-number">${String(index + 1).padStart(2, '0')}</span><div><strong>${escapeHtml(question.title)}</strong><span>${escapeHtml(question.meta || 'Personal note')}</span></div><button class="remove-button" data-action="remove-question" data-index="${index}" aria-label="Remove question">×</button></article>`).join('')}</div><form class="add-question" data-form="question"><label class="sr-only" for="question-input">Add a question</label><input id="question-input" name="question" required placeholder="e.g. What should I do if I miss a dose?"><button class="button button-primary" type="submit">Add question</button></form></section>${notice('For urgent symptoms or a medication emergency, use local emergency services or contact a pharmacist directly. This list is not monitored.', 'warning')}</div>`;
}

function requestStatusPill(status) { const labels = { approved: 'Approved', pending: 'Pending', rejected: 'Rejected', revoked: 'Revoked' }; return `<span class="status-pill ${status === 'approved' ? 'pill-green' : status === 'pending' ? 'pill-warn' : 'pill-neutral'}">${escapeHtml(labels[status] || status)}</span>`; }
function requestRows(requests, perspective = 'patient') {
  if (!requests.length) return '<div class="empty-state compact"><span class="empty-icon">♧</span><p>No access requests yet.</p></div>';
  return `<div class="access-request-list">${requests.map((request) => `<article class="access-request"><div><strong>${escapeHtml(perspective === 'doctor' ? (request.patientId || 'Patient') : (request.doctor?.displayName || 'Doctor'))}</strong><span>${perspective === 'doctor' ? 'Opaque patient ID · ' : ''}${request.requestedAt ? new Date(request.requestedAt).toLocaleDateString() : 'Local request'}</span></div><div class="access-request-actions">${requestStatusPill(request.status)}${perspective === 'patient' && request.status === 'pending' ? `${button('Approve', 'care-request', 'button button-primary button-small', `data-id="${escapeHtml(request.id)}" data-status="approved"`)}${button('Reject', 'care-request', 'button button-outline button-small', `data-id="${escapeHtml(request.id)}" data-status="rejected"`)}` : ''}${perspective === 'patient' && request.status === 'approved' ? button('Revoke', 'care-request', 'button button-outline button-small', `data-id="${escapeHtml(request.id)}" data-status="revoked"`) : ''}</div></article>`).join('')}</div>`;
}

function renderCareTeam() {
  return `<div class="section-intro inline-intro"><div><p class="eyebrow">SHARED CARE</p><h2 class="page-title">Choose who can see your records.</h2><p>Requests stay pending until you decide. Approved access can be revoked anytime.</p></div><span class="soft-icon large-soft">♧</span></div><section class="card care-team-card"><div class="card-heading"><div><h3>Doctor requests</h3><p class="muted">Your opaque patient ID is shared instead of your name.</p></div>${requestStatusPill(`${state.patientRequests.filter((request) => request.status === 'pending').length} pending`)}</div>${requestRows(state.patientRequests)}</section>${notice('<strong>Control stays with you.</strong> Approving access lets this doctor view profile, medicines, prescriptions, and reconciliation records. This app does not send messages.', 'info')}</div>`;
}

function localPatientRecords() {
  return { profile: { ...state.profile, patientId: state.profile.patientId || state.user?.patientId }, medicines: state.medicines, prescriptions: [], reconciliations: [] };
}

function ruleSummary(records) {
  const medicines = records?.medicines || [];
  const findings = analyzeMedicationSafety(medicines, records?.profile || {}).map((finding) => ({ ...finding, source: 'Local rule set' }));
  const mismatches = (records?.reconciliations || []).filter((item) => item.isExactMatch === false);
  if (mismatches.length) findings.push({ severity: 'medium', title: 'Reconciliation needs follow-up', detail: `${mismatches.length} saved comparison${mismatches.length === 1 ? '' : 's'} contains a missing or unexpected medicine name.`, source: 'Reconciliation rule' });
  return { headline: findings.some((finding) => finding.severity === 'high') ? 'Pause and review promptly' : findings.length ? 'Questions to review' : 'No rule-based flags recorded', findings };
}

function renderRuleSummary(records) {
  const summary = records?.summary || ruleSummary(records);
  const findings = summary.findings || [];
  const aiAssisted = summary.isAiGenerated === true;
  const normalizedFindings = findings.map((finding) => ({ severity: finding.severity === 'review' ? 'medium' : finding.severity || 'info', title: finding.title || `${finding.type || 'Record'} finding`, detail: finding.detail || finding.message || 'Recorded information is available for review.', source: finding.source || 'Rule-based record summary' }));
  return `<section class="card doctor-summary"><div class="card-heading"><div><p class="card-kicker">${aiAssisted ? 'AI-ASSISTED DRAFT' : 'STRUCTURED REVIEW'}</p><h3>${escapeHtml(summary.headline || (aiAssisted ? 'AI-assisted record draft' : 'Rule-based review'))}</h3><p class="muted">${escapeHtml(summary.disclaimer || 'Rule-based, non-AI information organization. Not diagnostic and not a treatment recommendation.')}</p></div><span class="soft-icon">i</span></div>${normalizedFindings.length ? `<ul class="clinical-findings">${normalizedFindings.map((finding) => `<li class="clinical-finding finding-${escapeHtml(finding.severity)}"><span class="finding-severity">${escapeHtml(finding.severity)}</span><div><strong>${escapeHtml(finding.title)}</strong><p>${escapeHtml(finding.detail)}</p><small>${escapeHtml(finding.source)}</small></div></li>`).join('')}</ul>` : `<div class="empty-state compact"><p>No ${aiAssisted ? 'AI-assisted' : 'rule-based'} findings from available records.</p></div>`}${notice(aiAssisted ? 'AI output is an assistive draft. Verify every finding against source records and clinical judgment.' : 'This summary organizes recorded information for a care conversation. It does not diagnose, prescribe, or replace clinical judgment.', 'warning')}</section>`;
}

function renderDoctorDashboard() {
  const pending = state.doctorRequests.filter((request) => request.status === 'pending');
  const approved = state.doctorRequests.filter((request) => request.status === 'approved');
  const doctor = state.doctorProfile || {};
  return `<div class="section-intro"><p class="eyebrow">DOCTOR WORKSPACE</p><h2 class="page-title">Coordinate care with patient-controlled access.</h2><p>Request records by opaque patient ID, then review approved information in one place.</p></div>${notice(`<strong>Unverified doctor account · pending review.</strong> ${escapeHtml(doctor.organization || 'Registration details are awaiting organization verification.')}`, 'warning')}<div class="doctor-dashboard-grid"><section class="card"><div class="card-heading"><div><h3>Request a patient</h3><p class="muted">Ask for access using the patient’s opaque ID.</p></div><span class="soft-icon">＋</span></div><form class="stack-form" data-form="doctor-request"><label>Opaque patient ID<input name="patientId" required maxlength="200" placeholder="Paste patient ID"></label><button class="button button-primary" type="submit">Send access request</button><p class="form-footnote">Patient must approve before any health information is visible.</p></form></section><section class="card"><div class="card-heading"><div><h3>Pending requests</h3><p class="muted">${pending.length} awaiting patient decision</p></div>${requestStatusPill(String(pending.length))}</div>${requestRows(pending, 'doctor')}</section></div><section class="card approved-patients-card"><div class="card-heading"><div><h3>Approved patients</h3><p class="muted">${approved.length} patient${approved.length === 1 ? '' : 's'} available to review</p></div><button class="text-link" data-action="nav" data-view="doctor-patients">Open patient records →</button></div>${approved.length ? requestRows(approved, 'doctor') : '<div class="empty-state compact"><p>Approved patients appear here after consent.</p></div>'}</section>`;
}

function renderDoctorPatients() {
  const approved = state.doctorRequests.filter((request) => request.status === 'approved');
  const selected = approved.find((request) => request.patientId === state.selectedPatientId) || approved[0];
  if (selected && state.selectedPatientId !== selected.patientId) state.selectedPatientId = selected.patientId;
  const records = selected ? state.doctorRecords[selected.patientId] : null;
  return `<div class="section-intro"><p class="eyebrow">APPROVED RECORDS</p><h2 class="page-title">Patient information, organized.</h2><p>Only approved patient records are shown. Review each section with the patient and your clinical workflow.</p></div>${approved.length ? `<section class="card patient-selector"><label>Approved patient<select id="doctor-patient-select" data-action="doctor-select-patient">${approved.map((request) => `<option value="${escapeHtml(request.patientId)}" ${request.patientId === state.selectedPatientId ? 'selected' : ''}>${escapeHtml(request.patientId)}</option>`).join('')}</select></label>${button('Refresh record', 'doctor-refresh-patient', 'button button-outline')}</section>${records ? renderDoctorRecord(records, selected.patientId) : `<section class="card empty-state"><p>Choose a patient to load approved records.</p></section>`}` : `<section class="card empty-state"><span class="empty-icon">♧</span><h3>No approved patients</h3><p>Send an access request from your dashboard. Patient approval is required before records can be viewed.</p>${button('Back to dashboard', 'nav', 'button button-primary', 'data-view="dashboard"')}</section>`}</div>`;
}

function renderDoctorRecord(records, patientId) {
  const profile = records.profile || {};
  const medicines = records.medicines || [];
  const prescriptions = records.prescriptions || [];
  const reconciliations = records.reconciliations || [];
  return `<section class="doctor-record-stack"><div class="doctor-record-header"><div><p class="card-kicker">PATIENT ${escapeHtml(patientId)}</p><h3>${escapeHtml(profile.fullName || 'Patient record')}</h3><p class="muted">Approved record view · confirm details with patient.</p></div>${requestStatusPill('approved')}</div><div class="doctor-record-grid"><section class="card"><div class="card-heading"><h3>Profile</h3><span class="soft-icon">♡</span></div><dl class="record-list"><div><dt>Date of birth</dt><dd>${escapeHtml(profile.dateOfBirth || 'Not recorded')}</dd></div><div><dt>Allergies</dt><dd>${escapeHtml(profile.allergies || 'Not recorded')}</dd></div><div><dt>Conditions</dt><dd>${escapeHtml(profile.conditions || 'Not recorded')}</dd></div></dl></section><section class="card"><div class="card-heading"><h3>Medicines</h3><span class="soft-icon">▣</span></div>${medicines.length ? `<ul class="record-items">${medicines.map((medicine) => `<li><strong>${escapeHtml(medicine.name)}</strong><span>${escapeHtml([medicine.strength, medicine.dose, medicine.timing].filter(Boolean).join(' · ') || 'Details not recorded')}</span></li>`).join('')}</ul>` : '<p class="result-empty">No medicines recorded.</p>'}</section><section class="card"><div class="card-heading"><h3>Prescriptions</h3><span class="soft-icon">✎</span></div>${prescriptions.length ? `<ul class="record-items">${prescriptions.map((prescription) => `<li><strong>${escapeHtml(prescription.medicationName)}</strong><span>${escapeHtml([prescription.strength, prescription.frequency, prescription.instructions].filter(Boolean).join(' · ') || 'Details not recorded')}</span></li>`).join('')}</ul>` : '<p class="result-empty">No prescriptions recorded.</p>'}</section><section class="card"><div class="card-heading"><h3>Reconciliation</h3><span class="soft-icon">↔</span></div>${reconciliations.length ? `<ul class="record-items">${reconciliations.map((item) => `<li><strong>${item.isExactMatch ? 'Names matched' : 'Review needed'}</strong><span>${escapeHtml(new Date(item.createdAt || Date.now()).toLocaleDateString())} · ${escapeHtml(item.notes || 'No notes')}</span></li>`).join('')}</ul>` : '<p class="result-empty">No reconciliation recorded.</p>'}</section></div>${renderRuleSummary(records)}</section>`;
}

function renderLifestyle() {
  const notes = lifestyleGuidance;
  return `<div class="section-intro"><p class="eyebrow">DAILY SUPPORT</p><h2 class="page-title">Routines that leave room for life.</h2><p>General reminders can support a routine. Follow your own care team’s instructions first.</p></div><div class="lifestyle-grid">${notes.map((note, index) => `<article class="card lifestyle-tile"><span class="lifestyle-number">0${index + 1}</span><h3>${escapeHtml(note.split('. ')[0])}</h3><p>${escapeHtml(note.includes('. ') ? note.slice(note.indexOf('. ') + 2) : '')}</p></article>`).join('')}</div>${notice('<strong>Listen to your body.</strong> New or worsening symptoms deserve a conversation with a clinician. Seek urgent help for trouble breathing, facial swelling, fainting, or severe rash.', 'warning')}</div>`;
}

function renderPrivacy() {
  return `<div class="section-intro"><p class="eyebrow">YOUR CONTROL</p><h2 class="page-title">Privacy that is easy to understand.</h2><p>Choose where your workspace lives and clear it when you are done.</p></div><div class="privacy-grid"><section class="card privacy-card"><div class="privacy-hero"><span class="privacy-lock">◈</span><div><p class="card-kicker">CURRENT STORAGE</p><h3>${state.localOnly ? 'This browser only' : 'Your MediHuman account'}</h3></div></div><p>${state.localOnly ? 'Profile, medicine lists, questions, and local care requests are stored in this browser’s local workspace. Remote account data is never copied into this storage.' : 'Your account workspace uses the MediHuman API over this session. Camera images stay in the browser flow and are not uploaded by this interface.'}</p>${notice('Do not enter information you do not need. Review any shared device before storing sensitive details.', 'info')}${button('Clear local workspace', 'clear-data', 'button button-outline')}${state.localOnly ? `<div class="privacy-actions">${button('Exit local mode', 'logout', 'button button-secondary')}<span class="save-note">You will choose whether to keep or clear local data.</span></div>` : ''}</section><section class="card consent-card"><p class="card-kicker">CONSENT CHECKPOINT</p><h3>Before you rely on a result</h3><label class="consent-toggle"><input id="consent-toggle" type="checkbox" ${state.consent ? 'checked' : ''}><span class="toggle-ui"></span><span>I understand this app organizes information; it does not diagnose, prescribe, verify handwriting, or replace a pharmacist or clinician.</span></label><p class="muted">${state.consent ? 'Acknowledged for this browser.' : 'Please acknowledge before saving a new local review.'}</p><button class="button button-primary" data-action="save-consent">Save preference</button></section></div>`;
}

const UI_COPY_REPLACEMENTS = [
  ['Camera capture', 'Prescription photo'],
  ['Nothing is uploaded by this screen.', 'Images are processed in your browser and are not uploaded here.'],
  ['Best fallback when text is unclear.', 'Enter details manually if the image cannot be read.'],
  ['Allow camera', 'Enable camera'],
  ['Upload photo', 'Choose prescription photo'],
  ['Camera preview appears after permission', 'Camera preview appears after you allow access'],
  ['Take a clear photo in good light, then review the captured text yourself. Handwriting and OCR can be wrong.', 'Use good lighting, then compare every captured field with the original. OCR may misread printed or handwritten text.'],
  ['Prescription details', 'Prescription text to verify'],
  ['Manual entry', 'Manual details'],
  ['Your browser will ask for camera permission. You can deny it and enter the prescription manually.', 'Allow camera access only if you want to capture an image. You can also choose a photo or enter details manually.'],
  ['STEP 2 OF 3 · YOUR REVIEW', 'STEP 2 OF 3 · VERIFY DETAILS'],
  ['Does this match the page?', 'Does this match the original prescription?'],
  ['Captured prescription', 'Prescription text to verify'],
  ['Use this list', 'Save this list for comparison'],
  ['No clinical interpretation is performed.', 'This app does not interpret or validate clinical instructions. Confirm uncertainty with a pharmacist or clinician.'],
  ['Compare, then clarify.', 'Compare prescribed and dispensed medicines.'],
  ['Exact-name comparison only. It cannot verify dose safety, substitutions, or clinical appropriateness.', 'This compares medicine names only. It does not confirm dose, formulation, substitutions, or clinical appropriateness.'],
  ['Exact names match', 'Medicine names match'],
  ['Review needed', 'Difference requires review'],
  ['Waiting for lists', 'Enter both lists to compare'],
  ['Run comparison', 'Compare lists'],
  ['Names are compared after trimming spaces and letter case.', 'Comparison ignores letter case and repeated spaces. It does not assess clinical suitability.'],
  ['Your lists line up by name.', 'Medicine names match; confirm details with your care team.'],
  ['A conversation is recommended.', 'Please clarify this difference with the pharmacy or prescriber.'],
  ['MATCHED', 'IN BOTH LISTS'],
  ['MISSING', 'PRESCRIBED, NOT IN DISPENSED LIST'],
  ['UNEXPECTED', 'DISPENSED, NOT IN PRESCRIBED LIST'],
  ['No exact matches', 'No matching medicine names'],
  ['Add both lists to see a reconciliation. A missing or unexpected name is a reason to pause and contact the pharmacy or prescriber.', 'Enter both lists to compare them. Any difference requires confirmation with the pharmacy or prescriber.'],
  ['Composition & risk review', 'Medication safety review'],
  ['Look closer, with a clinician.', 'Review medication information with a clinician.'],
  ['This is a transparent rule-based screen for a small reference set. It is not a complete interaction checker, diagnosis, or prescribing tool.', 'This limited, rule-based check covers only a small reference list. It is not a complete interaction checker and does not diagnose or recommend treatment.'],
  ['Pause and ask promptly', 'Pause and contact a clinician promptly'],
  ['Questions to review', 'Items to discuss with a clinician'],
  ['Doctor discussion', 'Care team questions'],
  ['What MediHuman can identify', 'What MediHuman matched in its reference list'],
  ['Add current medicines to see composition clues.', 'Add current medicines to see reference-list matches.'],
  ['No rule matched in this limited check', 'No matching rule was found in this limited check. This does not indicate safety.'],
  ['Prepare a question', 'Prepare a question for your clinician'],
  ['Never change a medicine on your own.', 'Do not start, stop, or change a medicine without advice from a clinician or pharmacist.'],
  ['Bring better questions.', 'Prepare questions for your care team.'],
  ['Personal note · stored locally', 'Personal note · saved in this workspace'],
  ['For urgent symptoms or a medication emergency, use local emergency services or contact a pharmacist directly. This list is not monitored.', 'For emergency symptoms or a medication emergency, call your local emergency number or contact a pharmacist directly. This list is not monitored.'],
  ['SHARED CARE', 'SHARED ACCESS'],
  ['Choose who can see your records.', 'Choose who can access your records.'],
  ['Doctor requests', 'Clinician access requests'],
  ['Your opaque patient ID is shared instead of your name.', 'Your private patient ID is shared instead of your name.'],
  ['Approving access lets this doctor view profile, medicines, prescriptions, and reconciliation records.', 'Approving access lets this clinician view your profile, medicines, prescriptions, and reconciliation records.'],
  ['Opaque patient ID · ', 'Private patient ID · '],
  ['No access requests yet.', 'No access requests yet.'],
  ['Unverified doctor account · pending review.', 'Clinician account pending verification.'],
  ['Registration details are awaiting organization verification.', 'Registration details are awaiting verification by your organisation.'],
  ['Request a patient', 'Request access to a patient record'],
  ['Ask for access using the patient’s opaque ID.', 'Enter the patient’s private ID to request access.'],
  ['Send access request', 'Request access'],
  ['Patient must approve before any health information is visible.', 'The patient must approve before any health information is shown.'],
  ['Approved patients', 'Patients with approved access'],
  ['Approved patients appear here after consent.', 'Patients appear here after they approve access.'],
  ['Patient information, organized.', 'Approved patient records'],
  ['Only approved patient records are shown. Review each section with the patient and your clinical workflow.', 'Only records approved by the patient are shown. Confirm each section with the patient before using it in clinical care.'],
  ['Approved patient', 'Patient ID'],
  ['Refresh record', 'Refresh patient record'],
  ['Approved record view · confirm details with patient.', 'Patient-approved record view · confirm details with the patient.'],
  ['Names matched', 'Medicine names matched'],
  ['No medicines recorded.', 'No current medicines recorded.'],
  ['No prescriptions recorded.', 'No prescriptions recorded.'],
  ['No reconciliation recorded.', 'No medicine reconciliation recorded.'],
  ['Routines that leave room for life.', 'Medication routines and general reminders'],
  ['Listen to your body.', 'Seek help for new or worsening symptoms.'],
  ['This browser only', 'Stored only in this browser'],
  ['Your account workspace uses the MediHuman API over this session. Camera images stay in the browser flow and are not uploaded by this interface.', 'Your information is stored in your MediHuman account while you are signed in. Camera images are processed in your browser and are not uploaded by this screen.'],
  ['Clear local workspace', 'Clear data stored in this browser'],
  ['Do not enter information you do not need. Review any shared device before storing sensitive details.', 'Only enter information needed for your care conversation. Check shared devices before storing sensitive information.'],
  ['Before you rely on a result', 'Before you use this information'],
  ['I understand this app organizes information; it does not diagnose, prescribe, verify handwriting, or replace a pharmacist or clinician.', 'I understand that this app organises information. It does not confirm safety, diagnose, prescribe, validate handwriting, or replace a pharmacist or clinician.'],
  ['Acknowledged for this browser.', 'Acknowledgment saved for this browser.'],
  ['Please acknowledge before saving a new local review.', 'Select this acknowledgment before saving a local review.'],
  ['<span class="finding-severity">high</span>', '<span class="finding-severity">Priority review</span>'],
  ['<span class="finding-severity">medium</span>', '<span class="finding-severity">Review</span>'],
  ['<span class="finding-severity">info</span>', '<span class="finding-severity">Information</span>'],
];

function improveUiCopy(markup) {
  return UI_COPY_REPLACEMENTS.reduce((output, [from, to]) => output.replaceAll(from, to), markup);
}

function improveUiIcons(markup) {
  const replacements = [
    ['<span class="brand-mark">+</span>', `<span class="brand-mark">${brandIcon()}</span>`],
    ['<span class="mini-mark">+</span>', `<span class="mini-mark">${brandIcon()}</span>`],
    ['<span class="nav-icon">home</span>', `<span class="nav-icon">${svgIcon('home')}</span>`],
    ['<span class="nav-icon">profile</span>', `<span class="nav-icon">${svgIcon('profile')}</span>`],
    ['<span class="nav-icon">medicines</span>', `<span class="nav-icon">${svgIcon('medicines')}</span>`],
    ['<span class="nav-icon">scan</span>', `<span class="nav-icon">${svgIcon('scan')}</span>`],
    ['<span class="nav-icon">care-team</span>', `<span class="nav-icon">${svgIcon('care-team')}</span>`],
    ['<span class="nav-icon">questions</span>', `<span class="nav-icon">${svgIcon('questions')}</span>`],
    ['<span class="nav-icon">support</span>', `<span class="nav-icon">${svgIcon('support')}</span>`],
    ['<span class="nav-icon">◈</span>', `<span class="nav-icon">${svgIcon('privacy')}</span>`],
    ['<span class="nav-icon">↪</span>', `<span class="nav-icon">${svgIcon('signout')}</span>`],
    ['<span class="today-orb">✦</span>', `<span class="today-orb">${svgIcon('spark')}</span>`],
    ['<div class="scan-illustration"><span>✣</span>', `<div class="scan-illustration"><span>${svgIcon('document')}</span>`],
    ['aria-label="View medicines">→</button>', `aria-label="View medicines">${svgIcon('arrow')}</button>`],
    ['<span>→</span>', svgIcon('arrow')],
    ['<span class="empty-icon">＋</span>', `<span class="empty-icon">${svgIcon('add')}</span>`],
    ['<span class="empty-icon">▣</span>', `<span class="empty-icon">${svgIcon('medicines')}</span>`],
    ['<span class="empty-icon">♧</span>', `<span class="empty-icon">${svgIcon('care-team')}</span>`],
    ['<span class="safety-symbol">♥</span>', `<span class="safety-symbol">${svgIcon('safety')}</span>`],
    ['<span class="soft-icon">♡</span>', `<span class="soft-icon">${svgIcon('profile')}</span>`],
    ['<span class="soft-icon">▣</span>', `<span class="soft-icon">${svgIcon('medicines')}</span>`],
    ['<span class="soft-icon">⌁</span>', `<span class="soft-icon">${svgIcon('scan')}</span>`],
    ['<span class="soft-icon">✎</span>', `<span class="soft-icon">${svgIcon('edit')}</span>`],
    ['<span class="soft-icon">↔</span>', `<span class="soft-icon">${svgIcon('compare')}</span>`],
    ['<span class="soft-icon">?</span>', `<span class="soft-icon">${svgIcon('info')}</span>`],
    ['<span class="soft-icon">◌</span>', `<span class="soft-icon">${svgIcon('questions')}</span>`],
    ['<span class="soft-icon">♧</span>', `<span class="soft-icon">${svgIcon('care-team')}</span>`],
    ['<span class="soft-icon">i</span>', `<span class="soft-icon">${svgIcon('info')}</span>`],
    ['<span class="privacy-lock">◈</span>', `<span class="privacy-lock">${svgIcon('lock')}</span>`],
  ];
  return replacements.reduce((output, [from, to]) => output.replaceAll(from, to), markup);
}

function render() {
  root.innerHTML = improveUiIcons(improveUiCopy(state.screen === 'auth' ? renderAuth() : renderShell()));
  bindCamera();
}

function bindCamera() {
  const video = document.querySelector('#camera-video');
  if (!video || !state.cameraStream) return;
  if (video.srcObject !== state.cameraStream) video.srcObject = state.cameraStream;
  video.play().catch(() => {
    state.cameraError = 'Camera preview could not play. Tap Try camera again or use Upload photo.';
  });
}

function setLocalMode(enabled) {
  if (enabled) localStorage.setItem(LOCAL_MODE_KEY, 'local');
  else localStorage.removeItem(LOCAL_MODE_KEY);
}

function ensureLocalIdentity() {
  if (state.role === 'patient') {
    const patientId = state.profile.patientId || state.user?.patientId || `local-patient-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    state.profile.patientId = patientId;
    state.user = { id: 'local-patient', email: 'local.patient@medihuman', role: 'patient', patientId };
  } else {
    state.user = { id: 'local-doctor', email: 'local.doctor@medihuman', role: 'doctor' };
  }
}

function enterLocal() { const requestedRole = state.authRoleExplicit ? state.authRole : ''; state.authError = ''; state.localOnly = true; state.screen = 'shell'; loadLocal(); state.role = requestedRole || state.role || 'patient'; state.authRole = state.role; state.authRoleExplicit = false; ensureLocalIdentity(); setLocalMode(true); saveLocal(); render(); }

async function loadRoleData() {
  if (state.localOnly) return;
  try {
    if (state.role === 'patient') {
      const response = await api.patientAccessRequests();
      state.patientRequests = response.requests || [];
    } else {
      const response = await api.doctorAccessRequests();
      state.doctorRequests = response.requests || [];
    }
  } catch (error) {
    state.authError = error.message;
  }
}

async function hydrateRemote() {
  try {
    const data = await api.me();
    state.user = data.user; state.role = data.user.role || 'patient'; state.authRole = state.role; state.profile = data.profile || state.profile; state.medicines = data.medicines || [];
    state.doctorProfile = data.user.doctorProfile || data.user.doctor || state.doctorProfile;
    state.localOnly = false; state.screen = 'shell';
    await loadRoleData();
    render();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) state.authError = error.message;
    render();
  }
}

async function submitAuth(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const isRegister = state.authMode === 'register';
  if (isRegister && data.consent !== 'on') return showAuthError('Please acknowledge the safety and privacy statement.');
  const submit = form.querySelector('button[type="submit"]'); submit.disabled = true;
  try {
    const role = state.authRole;
    const result = isRegister ? await api.register({ email: data.email, password: data.password, role, profile: role === 'patient' ? { fullName: data.fullName || '' } : {}, ...(role === 'doctor' ? { doctor: { displayName: data.name, specialty: data.specialty, registrationId: data.registrationId, organization: data.organization } } : {}) }) : await api.login({ email: data.email, password: data.password });
    if (!isRegister && result.user.role !== role) {
      try { await api.logout(); } catch { /* credentials remain untouched */ }
      throw new Error(`This account is registered as ${result.user.role}. Choose that role to sign in.`);
    }
    state.authError = ''; state.user = result.user; state.role = result.user.role || role; state.doctorProfile = result.user.doctorProfile || result.user.doctor || state.doctorProfile; state.profile = result.profile || state.profile; state.screen = 'shell'; state.localOnly = false; setLocalMode(false);
    if (state.role === 'patient') {
      try { const [profile, medicines] = await Promise.all([api.profile(), api.medicines()]); state.profile = profile.profile || state.profile; state.medicines = medicines.medicines || []; } catch { /* auth succeeded; empty workspace is valid */ }
    }
    await loadRoleData();
    render();
  } catch (error) { showAuthError(error.message); submit.disabled = false; }
}

function showAuthError(message) { const target = document.querySelector('#auth-error'); if (target) target.innerHTML = notice(escapeHtml(message), 'warning'); }

function formValues(form) { return Object.fromEntries(new FormData(form).entries()); }

async function saveProfile() {
  const form = document.querySelector('[data-form="profile"]'); state.profile = formValues(form); saveLocal();
  if (!state.localOnly) { try { const response = await api.saveProfile(state.profile); state.profile = response.profile || state.profile; } catch (error) { alert(error.message); } }
  render();
}

function updateMedicineField(target) { const item = state.medicines[Number(target.dataset.medIndex)]; if (item) { item[target.dataset.medKey] = target.value; saveLocal(); } }

async function saveMedicines() {
  state.medicines = state.medicines.filter((item) => item.name.trim()); saveLocal();
  if (!state.localOnly) { try { const response = await api.saveMedicines(state.medicines); state.medicines = response.medicines || state.medicines; } catch (error) { alert(error.message); } }
  render();
}

function goReconcile() { const fields = { prescribed: document.querySelector('#prescribed-list'), dispensed: document.querySelector('#dispensed-list') }; if (fields.prescribed) { state.prescriptionText = fields.prescribed.value; state.dispensedText = fields.dispensed.value; saveLocal(); } }

async function persistPrescriptionReview() {
  if (state.localOnly) return;
  const lines = state.prescriptionText.split(/[\n,]+/).map((line) => line.trim()).filter(Boolean);
  for (const medicationName of lines.slice(0, 100)) {
    try { await api.savePrescription({ medicationName, instructions: 'Captured and reviewed by patient.' }); } catch { break; }
  }
}

async function saveReconciliation() {
  goReconcile();
  const comparison = compareMedicines(state.prescriptionText, state.dispensedText);
  if (!state.localOnly && (comparison.prescribed.length || comparison.dispensed.length)) { try { await api.saveReconciliation({ prescriptionMedicines: comparison.prescribed, dispensedMedicines: comparison.dispensed, notes: 'Reviewed in MediHuman.' }); } catch { /* local result remains useful if persistence is unavailable */ } }
  state.view = 'reconcile'; render();
}

async function startCamera() {
  state.cameraError = '';
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  if (!window.isSecureContext && !isLocal) {
    state.cameraError = 'Camera access requires HTTPS. Open this app through its HTTPS deployment, or use Upload photo / Manual entry.';
    render();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    state.cameraError = 'This browser does not expose camera access. Check browser support, then use Upload photo or Manual entry.';
    render();
    return;
  }
  const constraints = [
    { video: { facingMode: { ideal: 'environment' } }, audio: false },
    { video: true, audio: false },
  ];
  let lastError;
  for (const constraint of constraints) {
    try {
      state.cameraStream = await navigator.mediaDevices.getUserMedia(constraint);
      render();
      return;
    } catch (error) {
      lastError = error;
      if (error.name === 'NotAllowedError' || error.name === 'SecurityError') break;
    }
  }
  state.cameraStream = null;
  const errorMessages = {
    NotAllowedError: 'Camera permission is blocked. Allow camera access for this site in browser settings, then try again.',
    NotFoundError: 'No camera was found. Check that a camera is connected, then use Upload photo or Manual entry.',
    NotReadableError: 'The camera is busy in another app. Close that app and try again.',
    SecurityError: 'Camera access is blocked by browser security. Use HTTPS and check site permissions.',
    OverconstrainedError: 'This camera does not support the requested mode. Try again or use Upload photo.',
  };
  state.cameraError = errorMessages[lastError?.name] || 'Camera could not start. Check HTTPS, browser permissions, and whether another app is using the camera.';
  render();
}

function stopCamera() { state.cameraStream?.getTracks().forEach((track) => track.stop()); state.cameraStream = null; render(); }

async function captureCamera() {
  const video = document.querySelector('#camera-video'); if (!video || video.readyState < 2) return;
  const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; canvas.getContext('2d').drawImage(video, 0, 0); state.scanSource = 'Camera capture · manual confirmation required';
  try {
    const result = await ocr.recognize(canvas); state.ocrText = result.text || ''; state.view = 'review';
  } catch {
    state.cameraError = 'OCR could not read this frame. Review the prescription manually or capture a clearer image.';
    state.view = 'scan';
  }
  stopCamera();
}

async function readPhoto(file) {
  if (!file) return;
  state.scanSource = 'Uploaded photo · manual confirmation required';
  try {
    const result = await ocr.recognize(file);
    state.ocrText = result.text || '';
    state.view = 'review';
  } catch {
    state.ocrText = '';
    state.cameraError = 'OCR could not read this image. Review it manually or try a clearer, well-lit photo.';
    state.view = 'scan';
  }
  render();
}

function submitQuestion(form) { const values = formValues(form); if (values.question?.trim()) { state.questions.push({ title: values.question.trim(), meta: 'Personal note · stored locally' }); saveLocal(); render(); } }

async function requestPatient(form) {
  const patientId = formValues(form).patientId?.trim();
  if (!patientId) return;
  try {
    if (state.localOnly) {
      const existing = state.patientRequests.find((request) => request.patientId === patientId && ['pending', 'approved'].includes(request.status));
      if (existing) throw new Error('An active request already exists for this patient.');
      state.doctorRequests.push({ id: `local-request-${Date.now()}`, patientId, status: 'pending', requestedAt: new Date().toISOString(), doctor: state.doctorProfile });
      state.patientRequests.push({ id: state.doctorRequests.at(-1).id, patientId, status: 'pending', requestedAt: new Date().toISOString(), doctor: state.doctorProfile });
      saveLocal();
    } else {
      const response = await api.requestPatient(patientId);
      state.doctorRequests = [response.request, ...state.doctorRequests];
    }
    render();
  } catch (error) { alert(error.message); }
}

async function updateCareRequest(requestId, status) {
  try {
    if (state.localOnly) {
      const request = state.patientRequests.find((item) => item.id === requestId);
      if (!request) return;
      request.status = status;
      request.respondedAt = new Date().toISOString();
      if (status === 'revoked') request.revokedAt = request.respondedAt;
      const doctorRequest = state.doctorRequests.find((item) => item.id === requestId);
      if (doctorRequest) Object.assign(doctorRequest, request);
      saveLocal();
    } else {
      const response = await api.updateAccessRequest(requestId, status);
      state.patientRequests = state.patientRequests.map((request) => request.id === requestId ? response.request : request);
    }
    render();
  } catch (error) { alert(error.message); }
}

async function loadDoctorPatient(patientId = state.selectedPatientId) {
  if (!patientId) return;
  try {
    state.selectedPatientId = patientId;
    state.doctorRecords[patientId] = state.localOnly ? localPatientRecords() : await api.doctorPatient(patientId);
    if (!state.localOnly) {
      try { const summary = await api.doctorPatient(patientId, 'summary'); state.doctorRecords[patientId].summary = summary.summary; } catch { /* record remains useful without summary endpoint */ }
    }
    render();
  } catch (error) { alert(error.message); }
}

function clearLocalWorkspace() {
  localStorage.removeItem(LOCAL_KEY);
  state.profile = emptyProfile(); state.medicines = []; state.prescriptionText = ''; state.dispensedText = ''; state.questions = [];
  state.patientRequests = []; state.doctorRequests = []; state.doctorRecords = {}; state.consent = false; state.profile.patientId = '';
}

function exitLocal(clear = false) {
  stopCamera();
  if (clear) clearLocalWorkspace();
  setLocalMode(false);
  state.localExitPrompt = false; state.screen = 'auth'; state.localOnly = false; state.user = null; state.role = state.authRole = 'patient'; state.view = 'dashboard';
  render();
}

root.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]'); if (!target) return; const action = target.dataset.action;
  if (action === 'auth-login' || action === 'auth-register') { state.authMode = action === 'auth-register' ? 'register' : 'login'; render(); return; }
  if (action === 'auth-role') { state.authRole = target.dataset.role === 'doctor' ? 'doctor' : 'patient'; state.authRoleExplicit = true; render(); return; }
  if (action === 'local-mode') { enterLocal(); return; }
  if (action === 'toggle-menu') { document.querySelector('#sidebar')?.classList.toggle('open'); return; }
  if (action === 'nav') { state.view = target.dataset.view; document.querySelector('#sidebar')?.classList.remove('open'); render(); return; }
  if (action === 'privacy') { state.view = 'privacy'; render(); return; }
  if (action === 'logout') { if (state.localOnly) { state.localExitPrompt = true; render(); return; } stopCamera(); try { await api.logout(); } catch { /* clear UI regardless */ } setLocalMode(false); state.screen = 'auth'; state.user = null; state.localOnly = false; state.view = 'dashboard'; render(); return; }
  if (action === 'local-exit-preserve') { exitLocal(false); return; }
  if (action === 'local-exit-clear') { exitLocal(true); return; }
  if (action === 'local-exit-cancel') { state.localExitPrompt = false; render(); return; }
  if (action === 'go-scan') { state.view = 'scan'; render(); return; }
  if (action === 'go-reconcile') { state.view = 'reconcile'; render(); return; }
  if (action === 'go-composition') { state.view = 'composition'; render(); return; }
  if (action === 'save-profile') { await saveProfile(); return; }
  if (action === 'add-medicine') { state.medicines.push(medicineObject('')); render(); return; }
  if (action === 'remove-medicine') { state.medicines.splice(Number(target.dataset.index), 1); saveLocal(); render(); return; }
  if (action === 'save-medicines') { await saveMedicines(); return; }
  if (action === 'camera-start') { await startCamera(); return; }
  if (action === 'camera-stop') { stopCamera(); return; }
  if (action === 'camera-capture') { await captureCamera(); return; }
  if (action === 'manual-review') { state.prescriptionText = document.querySelector('#manual-prescription')?.value || ''; state.ocrText = state.prescriptionText; state.scanSource = 'Manual entry'; state.view = 'review'; saveLocal(); render(); return; }
   if (action === 'save-review') { state.prescriptionText = document.querySelector('#review-text')?.value || ''; state.view = 'reconcile'; saveLocal(); await persistPrescriptionReview(); render(); return; }
  if (action === 'run-reconcile') { await saveReconciliation(); return; }
  if (action === 'care-request') { await updateCareRequest(target.dataset.id, target.dataset.status); return; }
  if (action === 'doctor-refresh-patient') { await loadDoctorPatient(); return; }
  if (action === 'remove-question') { state.questions.splice(Number(target.dataset.index), 1); saveLocal(); render(); return; }
  if (action === 'save-consent') { state.consent = Boolean(document.querySelector('#consent-toggle')?.checked); saveLocal(); render(); return; }
  if (action === 'clear-data') { if (window.confirm('Clear this browser’s MediHuman workspace?')) { clearLocalWorkspace(); saveLocal(); render(); } }
});

root.addEventListener('submit', async (event) => { event.preventDefault(); const form = event.target; if (form.dataset.form === 'auth') await submitAuth(form); if (form.dataset.form === 'profile') await saveProfile(); if (form.dataset.form === 'question') submitQuestion(form); if (form.dataset.form === 'doctor-request') await requestPatient(form); });
root.addEventListener('input', (event) => { if (event.target.matches('[data-med-index]')) updateMedicineField(event.target); });
root.addEventListener('change', (event) => { if (event.target.id === 'prescription-file') readPhoto(event.target.files?.[0]); if (event.target.id === 'doctor-patient-select') loadDoctorPatient(event.target.value); });

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => undefined));
if (localStorage.getItem(LOCAL_MODE_KEY) === 'local') enterLocal(); else hydrateRemote();
