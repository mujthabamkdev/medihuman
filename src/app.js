import { compareMedicines, lifestyleGuidance } from './medication-logic.js';
import { analyzeMedicationSafety, medicationCompositionSummary } from './clinical-logic.js';
import { api, ApiError } from './api-client.js';
import { createOcrAdapter } from './ocr-adapter.js';

const LOCAL_KEY = 'medihuman.frontend.v2';
const root = document.querySelector('#app');
const ocr = createOcrAdapter();
const state = {
  screen: 'auth', authMode: 'login', view: 'dashboard', localOnly: false, user: null,
  profile: { fullName: '', dateOfBirth: '', allergies: '', conditions: '' }, medicines: [],
  prescriptionText: '', dispensedText: '', ocrText: '', scanSource: '', consent: false,
  cameraStream: null, cameraError: '', questions: [
    { title: 'What should I ask before changing a dose?', meta: 'Starter question · not medical advice' },
    { title: 'How can I make my medication routine easier?', meta: 'Starter question · not medical advice' },
  ],
};

const navItems = [
  ['dashboard', '⌂', 'Today'], ['patient', '♡', 'Patient'], ['medicines', '▣', 'Medicines'],
  ['scan', '⌁', 'Scan prescription'], ['doctors', '◌', 'Doctor discussion'], ['lifestyle', '✦', 'Daily support'],
];

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function saveLocal() {
  const copy = { profile: state.profile, medicines: state.medicines, prescriptionText: state.prescriptionText, dispensedText: state.dispensedText, questions: state.questions, consent: state.consent };
  localStorage.setItem(LOCAL_KEY, JSON.stringify(copy));
}

function loadLocal() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}');
    if (saved.profile) state.profile = { ...state.profile, ...saved.profile };
    if (Array.isArray(saved.medicines)) state.medicines = saved.medicines;
    if (typeof saved.prescriptionText === 'string') state.prescriptionText = saved.prescriptionText;
    if (typeof saved.dispensedText === 'string') state.dispensedText = saved.dispensedText;
    if (Array.isArray(saved.questions)) state.questions = saved.questions;
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
  return `<main class="auth-layout">
    <section class="auth-brand-panel"><a class="brand brand-light" href="/" aria-label="MediHuman home"><span class="brand-mark">+</span>MediHuman</a>
      <div class="auth-intro"><p class="eyebrow eyebrow-light">A calmer medicine routine</p><h1>Care that keeps the human in view.</h1><p>Review prescriptions, capture what matters, and bring clearer questions to your care team.</p></div>
      <div class="auth-quote"><span class="quote-mark">“</span><p>Organized information helps conversations. It never replaces them.</p></div>
    </section>
    <section class="auth-card-wrap"><div class="auth-card"><div class="auth-card-head"><span class="mini-mark">+</span><span class="privacy-chip">Private by default</span></div>
      <div class="auth-tabs" role="tablist"><button class="auth-tab ${!register ? 'active' : ''}" data-action="auth-login" role="tab" aria-selected="${!register}">Sign in</button><button class="auth-tab ${register ? 'active' : ''}" data-action="auth-register" role="tab" aria-selected="${register}">Create account</button></div>
      <h2>${register ? 'Start your care workspace' : 'Welcome back'}</h2><p class="auth-subtitle">${register ? 'Use an account when you want your data available through this server.' : 'Sign in to continue your medication review.'}</p>${state.authError ? notice(escapeHtml(state.authError), 'info') : ''}
      <form class="stack-form" data-form="auth"><label>Email address<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label><label>Password<input name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" minlength="12" required placeholder="12+ characters"></label>
      ${register ? `<label class="check-row"><input name="consent" type="checkbox" required><span>I understand MediHuman is an organizational aid, not medical advice, and agree to review sensitive information carefully.</span></label>` : ''}<div id="auth-error"></div><button class="button button-primary button-wide" type="submit">${register ? 'Create account' : 'Sign in'} <span>→</span></button></form>
      <div class="auth-divider"><span>or</span></div>${button('Continue without account', 'local-mode', 'button button-secondary button-wide')}
      <p class="form-footnote">Local-only mode keeps workspace data in this browser. No API key or secret is needed.</p>
    </div><p class="auth-disclaimer">MediHuman does not diagnose, prescribe, or verify handwriting. For urgent symptoms, call local emergency services.</p></section>
  </main>`;
}

function renderTopbar(title) {
  return `<header class="topbar"><button class="mobile-menu" data-action="toggle-menu" aria-label="Open navigation">☰</button><div><p class="topbar-kicker">${state.localOnly ? 'Local workspace' : 'Care workspace'}</p><h1>${title}</h1></div><div class="topbar-actions"><span class="secure-label"><span class="status-dot"></span>${state.localOnly ? 'On this device' : 'Encrypted session'}</span><button class="avatar" data-action="patient" aria-label="Open patient profile">${escapeHtml(initials())}</button></div></header>`;
}

function renderSidebar() {
  return `<aside class="sidebar" id="sidebar"><div class="sidebar-head"><a class="brand" href="/" aria-label="MediHuman home"><span class="brand-mark">+</span>MediHuman</a><button class="close-menu" data-action="toggle-menu" aria-label="Close navigation">×</button></div><div class="workspace-card"><span class="workspace-avatar">${escapeHtml(initials())}</span><div><strong>${escapeHtml(state.profile.fullName || 'Your workspace')}</strong><span>${state.localOnly ? 'Local-only mode' : escapeHtml(state.user?.email || 'Signed in')}</span></div></div><nav class="main-nav" aria-label="Main navigation">${navItems.map(([id, icon, label]) => `<button class="nav-item ${state.view === id ? 'active' : ''}" data-action="nav" data-view="${id}"><span class="nav-icon">${icon}</span><span>${label}</span>${id === 'scan' ? '<span class="nav-badge">New</span>' : ''}</button>`).join('')}</nav><div class="sidebar-bottom"><button class="nav-item" data-action="privacy"><span class="nav-icon">◈</span><span>Privacy & consent</span></button><button class="nav-item" data-action="logout"><span class="nav-icon">↪</span><span>${state.localOnly ? 'Exit local mode' : 'Sign out'}</span></button></div></aside>`;
}

function renderShell() {
  const titles = { dashboard: 'Good morning', patient: 'Patient profile', medicines: 'Current medicines', scan: 'Scan a prescription', review: 'Review captured text', reconcile: 'Reconciliation', composition: 'Composition & risk review', doctors: 'Doctor discussion', lifestyle: 'Daily support', privacy: 'Privacy & consent' };
  return `<div class="app-shell">${renderSidebar()}<div class="shell-content">${renderTopbar(titles[state.view] || 'MediHuman')}<main class="content-page">${renderView()}</main><footer class="app-footer"><span>MediHuman is an organizational aid, not medical advice.</span><button data-action="privacy" class="footer-link">Privacy & consent</button></footer></div></div>`;
}

function renderView() {
  if (state.view === 'patient') return renderPatient();
  if (state.view === 'medicines') return renderMedicines();
  if (state.view === 'scan') return renderScan();
  if (state.view === 'review') return renderReview();
  if (state.view === 'reconcile') return renderReconcile();
  if (state.view === 'composition') return renderComposition();
  if (state.view === 'doctors') return renderDoctors();
  if (state.view === 'lifestyle') return renderLifestyle();
  if (state.view === 'privacy') return renderPrivacy();
  return renderDashboard();
}

function renderDashboard() {
  const comparison = compareMedicines(state.prescriptionText, state.dispensedText);
  const hasList = comparison.prescribed.length > 0 || comparison.dispensed.length > 0;
  const reviewCount = comparison.missing.length + comparison.unexpected.length;
  return `<div class="welcome-row"><div><p class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p><h2 class="page-title">${escapeHtml(state.profile.fullName ? `How is ${state.profile.fullName.split(' ')[0]} doing?` : 'A clear next step starts here.')}</h2><p class="page-lede">Keep medicine details together, then take your questions to a pharmacist or clinician.</p></div><div class="today-orb">✦</div></div>
  <div class="dashboard-grid"><section class="feature-card feature-scan"><div class="feature-copy"><span class="card-kicker">QUICK CAPTURE</span><h3>Have a new prescription?</h3><p>Use your camera or upload a photo. You will review every word before it is used.</p>${button('Scan prescription <span>→</span>', 'go-scan', 'button button-light')}</div><div class="scan-illustration"><span>✣</span><i></i><i></i><i></i></div></section>
    <section class="card medication-summary"><div class="card-heading"><div><p class="card-kicker">YOUR LIST</p><h3>Current medicines</h3></div><button class="icon-button" data-action="nav" data-view="medicines" aria-label="View medicines">→</button></div>${state.medicines.length ? `<div class="medicine-preview">${state.medicines.slice(0, 3).map((medicine) => `<div class="medicine-row"><span class="medicine-dot"></span><div><strong>${escapeHtml(medicine.name)}</strong><span>${escapeHtml([medicine.strength, medicine.timing].filter(Boolean).join(' · ') || 'Details to review')}</span></div></div>`).join('')}</div><button class="text-link" data-action="nav" data-view="medicines">View all medicines →</button>` : `<div class="empty-state compact"><span class="empty-icon">＋</span><p>No medicines added yet.</p><button class="text-link" data-action="nav" data-view="medicines">Add your current list →</button></div>`}</section>
    <section class="card check-card"><div class="card-heading"><div><p class="card-kicker">LAST CHECK</p><h3>${hasList ? (reviewCount ? 'Review recommended' : 'List looks aligned') : 'No reconciliation yet'}</h3></div><span class="status-pill ${reviewCount ? 'pill-warn' : 'pill-green'}">${hasList ? (reviewCount ? `${reviewCount} to review` : 'Ready') : 'Start'}</span></div><p>${hasList ? (reviewCount ? 'Some names do not line up. Confirm with your pharmacy or prescriber.' : 'Exact names match between your two lists.') : 'Compare what was prescribed with what was dispensed.'}</p>${button(hasList ? 'Open reconciliation' : 'Start a check', 'go-reconcile', 'button button-outline')}</section>
    <section class="card safety-card"><div class="safety-heading"><span class="safety-symbol">♥</span><div><p class="card-kicker">SAFETY FIRST</p><h3>Pause when something feels off</h3></div></div><p>Never start, stop, or double a dose based only on this app. Ask a pharmacist or clinician.</p><button class="text-link" data-action="nav" data-view="composition">Review safety notes →</button></section>
  </div><section class="section-intro"><p class="eyebrow">Your care companion</p><h3>Small details, better conversations.</h3><p>Choose a path when you are ready. Your notes are yours to edit and clear.</p></section>`;
}

function renderPatient() {
  const p = state.profile;
  return `<div class="section-intro"><p class="eyebrow">PATIENT PROFILE</p><h2 class="page-title">Keep the person in view.</h2><p>These details help you prepare questions. Share them with care teams only when you choose.</p></div><div class="two-column"><section class="card form-card"><div class="card-heading"><div><h3>About the patient</h3><p class="muted">Optional details. Edit anytime.</p></div><span class="soft-icon">♡</span></div><form class="stack-form" data-form="profile"><label>Full name<input name="fullName" value="${escapeHtml(p.fullName)}" autocomplete="name" placeholder="e.g. Maya Johnson"></label><label>Date of birth<input name="dateOfBirth" value="${escapeHtml(p.dateOfBirth)}" type="date"></label><label>Known conditions or diagnosis<textarea name="conditions" rows="3" placeholder="Only what you are comfortable recording">${escapeHtml(p.conditions)}</textarea></label><label>Allergies<textarea name="allergies" rows="3" placeholder="e.g. penicillin, or none known">${escapeHtml(p.allergies)}</textarea></label><div class="form-actions">${button('Save profile', 'save-profile', 'button button-primary')}<span class="save-note">Saved ${state.localOnly ? 'on this device' : 'to your account'}</span></div></form></section><aside class="card side-note">${notice('<strong>Privacy tip.</strong> Use only details needed for your care conversation. Clear this workspace from Privacy & consent when you are finished.', 'info')}<h3>What this does</h3><p>MediHuman surfaces your own notes beside medicine reviews. It does not determine whether a medicine is right for you.</p></aside></div>`;
}

function medicineObject(name, extra = {}) { return { id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, name, strength: '', dose: '', route: '', timing: '', notes: '', ...extra }; }

function renderMedicines() {
  return `<div class="section-intro inline-intro"><div><p class="eyebrow">MEDICINE CABINET</p><h2 class="page-title">What are you taking now?</h2><p>Keep the label details close. Exact names matter; this list is not a substitute for a medication record from your care team.</p></div>${button('Scan new prescription', 'go-scan', 'button button-primary')}</div><section class="card medicine-editor"><div class="card-heading"><div><h3>Current medicines</h3><p class="muted">${state.medicines.length} item${state.medicines.length === 1 ? '' : 's'} saved</p></div><span class="soft-icon">▣</span></div>${state.medicines.length ? `<div class="medicine-list">${state.medicines.map((m, index) => `<article class="medicine-detail"><div class="medicine-number">${String(index + 1).padStart(2, '0')}</div><div class="medicine-fields"><label>Medicine name<input data-med-index="${index}" data-med-key="name" value="${escapeHtml(m.name)}"></label><label>Strength<input data-med-index="${index}" data-med-key="strength" value="${escapeHtml(m.strength)}" placeholder="e.g. 500 mg"></label><label>When / how often<input data-med-index="${index}" data-med-key="timing" value="${escapeHtml(m.timing)}" placeholder="e.g. morning with food"></label></div><button class="remove-button" data-action="remove-medicine" data-index="${index}" aria-label="Remove ${escapeHtml(m.name)}">×</button></article>`).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">▣</span><h3>Your list is empty</h3><p>Add medicines manually or capture a prescription to start a review.</p></div>`}<div class="medicine-actions">${button('＋ Add medicine', 'add-medicine', 'button button-secondary')}${button('Save medicine list', 'save-medicines', 'button button-primary')}<span class="save-note" id="medicine-save-note"></span></div></section>${notice('<strong>Check the label.</strong> Include strength and formulation when they are shown. A name match here is not proof that a medicine is safe for you.', 'warning')}</div>`;
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

function renderLifestyle() {
  const notes = lifestyleGuidance;
  return `<div class="section-intro"><p class="eyebrow">DAILY SUPPORT</p><h2 class="page-title">Routines that leave room for life.</h2><p>General reminders can support a routine. Follow your own care team’s instructions first.</p></div><div class="lifestyle-grid">${notes.map((note, index) => `<article class="card lifestyle-tile"><span class="lifestyle-number">0${index + 1}</span><h3>${escapeHtml(note.split('. ')[0])}</h3><p>${escapeHtml(note.includes('. ') ? note.slice(note.indexOf('. ') + 2) : '')}</p></article>`).join('')}</div>${notice('<strong>Listen to your body.</strong> New or worsening symptoms deserve a conversation with a clinician. Seek urgent help for trouble breathing, facial swelling, fainting, or severe rash.', 'warning')}</div>`;
}

function renderPrivacy() {
  return `<div class="section-intro"><p class="eyebrow">YOUR CONTROL</p><h2 class="page-title">Privacy that is easy to understand.</h2><p>Choose where your workspace lives and clear it when you are done.</p></div><div class="privacy-grid"><section class="card privacy-card"><div class="privacy-hero"><span class="privacy-lock">◈</span><div><p class="card-kicker">CURRENT STORAGE</p><h3>${state.localOnly ? 'This browser only' : 'Your MediHuman account'}</h3></div></div><p>${state.localOnly ? 'Profile, medicine lists, questions, and reviews are stored in this browser’s local storage. They are not sent to the MediHuman API in local-only mode.' : 'Your account workspace uses the MediHuman API over this session. Camera images stay in the browser flow and are not uploaded by this interface.'}</p>${notice('Do not enter information you do not need. Review any shared device before storing sensitive details.', 'info')}<button class="button button-outline" data-action="clear-data">Clear local workspace</button></section><section class="card consent-card"><p class="card-kicker">CONSENT CHECKPOINT</p><h3>Before you rely on a result</h3><label class="consent-toggle"><input id="consent-toggle" type="checkbox" ${state.consent ? 'checked' : ''}><span class="toggle-ui"></span><span>I understand this app organizes information; it does not diagnose, prescribe, verify handwriting, or replace a pharmacist or clinician.</span></label><p class="muted">${state.consent ? 'Acknowledged for this browser.' : 'Please acknowledge before saving a new local review.'}</p><button class="button button-primary" data-action="save-consent">Save preference</button></section></div>`;
}

function render() {
  root.innerHTML = state.screen === 'auth' ? renderAuth() : renderShell();
  bindCamera();
}

function enterLocal() { state.authError = ''; state.localOnly = true; state.screen = 'shell'; loadLocal(); render(); }

async function hydrateRemote() {
  try {
    const data = await api.me();
    state.user = data.user; state.profile = data.profile || state.profile; state.medicines = data.medicines || [];
    state.localOnly = false; state.screen = 'shell';
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
    const result = isRegister ? await api.register({ email: data.email, password: data.password, profile: {} }) : await api.login({ email: data.email, password: data.password });
    state.authError = ''; state.user = result.user; state.profile = result.profile || state.profile; state.screen = 'shell'; state.localOnly = false;
    try { const [profile, medicines] = await Promise.all([api.profile(), api.medicines()]); state.profile = profile.profile || state.profile; state.medicines = medicines.medicines || []; } catch { /* auth succeeded; empty workspace is valid */ }
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
  if (!navigator.mediaDevices?.getUserMedia) { state.cameraError = 'This browser does not offer camera access. Use Upload photo or Manual entry instead.'; render(); return; }
  try { state.cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); render(); const video = document.querySelector('#camera-video'); if (video) { video.srcObject = state.cameraStream; await video.play(); } }
  catch (error) { state.cameraStream = null; state.cameraError = error.name === 'NotAllowedError' ? 'Camera permission was denied. You can still upload a photo or enter details manually.' : 'Camera could not start. Check browser permissions or use another capture option.'; render(); }
}

function stopCamera() { state.cameraStream?.getTracks().forEach((track) => track.stop()); state.cameraStream = null; render(); }

async function captureCamera() {
  const video = document.querySelector('#camera-video'); if (!video || video.readyState < 2) return;
  const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; canvas.getContext('2d').drawImage(video, 0, 0); state.scanSource = 'Camera capture · manual confirmation required';
  const result = await ocr.recognize(canvas); state.ocrText = result.text || ''; state.view = 'review'; stopCamera();
}

async function readPhoto(file) { if (!file) return; state.scanSource = 'Uploaded photo · manual confirmation required'; const result = await ocr.recognize(file); state.ocrText = result.text || ''; state.view = 'review'; render(); }

function submitQuestion(form) { const values = formValues(form); if (values.question?.trim()) { state.questions.push({ title: values.question.trim(), meta: 'Personal note · stored locally' }); saveLocal(); render(); } }

root.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]'); if (!target) return; const action = target.dataset.action;
  if (action === 'auth-login' || action === 'auth-register') { state.authMode = action === 'auth-register' ? 'register' : 'login'; render(); return; }
  if (action === 'local-mode') { enterLocal(); return; }
  if (action === 'toggle-menu') { document.querySelector('#sidebar')?.classList.toggle('open'); return; }
  if (action === 'nav') { state.view = target.dataset.view; document.querySelector('#sidebar')?.classList.remove('open'); render(); return; }
  if (action === 'privacy') { state.view = 'privacy'; render(); return; }
  if (action === 'logout') { stopCamera(); if (!state.localOnly) { try { await api.logout(); } catch { /* clear UI regardless */ } } state.screen = 'auth'; state.user = null; state.localOnly = false; state.view = 'dashboard'; render(); return; }
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
  if (action === 'remove-question') { state.questions.splice(Number(target.dataset.index), 1); saveLocal(); render(); return; }
  if (action === 'save-consent') { state.consent = Boolean(document.querySelector('#consent-toggle')?.checked); saveLocal(); render(); return; }
  if (action === 'clear-data') { if (window.confirm('Clear this browser’s MediHuman workspace?')) { localStorage.removeItem(LOCAL_KEY); state.profile = { fullName: '', dateOfBirth: '', allergies: '', conditions: '' }; state.medicines = []; state.prescriptionText = ''; state.dispensedText = ''; state.questions = []; state.consent = false; render(); } }
});

root.addEventListener('submit', async (event) => { event.preventDefault(); const form = event.target; if (form.dataset.form === 'auth') await submitAuth(form); if (form.dataset.form === 'profile') await saveProfile(); if (form.dataset.form === 'question') submitQuestion(form); });
root.addEventListener('input', (event) => { if (event.target.matches('[data-med-index]')) updateMedicineField(event.target); });
root.addEventListener('change', (event) => { if (event.target.id === 'prescription-file') readPhoto(event.target.files?.[0]); });

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => undefined));
hydrateRemote();
