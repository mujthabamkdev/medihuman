import { compareMedicines, lifestyleGuidance } from '../medication-logic.js';
import { analyzeMedicationSafety, medicationCompositionSummary } from '../clinical-logic.js';
import { googleAuthUrl } from '../api-client.js';
import { doctorNavGroups, patientNavGroups } from './state.js';
import { brandIcon, button, escapeHtml, googleIcon, initials, notice, svgIcon } from './ui.js';

function findingSeverityLabel(severity) {
  return { high: 'Priority review', medium: 'Review', info: 'Information' }[severity] || escapeHtml(severity);
}

function nameInitials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

/** Render all screens from current state. No DOM writes or event wiring live here. */
export function createViewRenderer({ state }) {
  const viewTitles = {
    dashboard: 'Today',
    medicines: 'Medicines',
    scan: 'Scan prescription',
    review: 'Review prescription',
    reconcile: 'Reconciliation',
    composition: 'Safety review',
    doctors: 'Doctor discussion',
    'care-team': 'Care team access',
    lifestyle: 'Daily support',
    patient: 'Patient profile',
    privacy: 'Privacy and acknowledgments',
    'doctor-patients': 'Approved patients',
  };
  function currentViewTitle() {
    if (state.role === 'doctor' && state.view === 'dashboard') return 'Doctor dashboard';
    return viewTitles[state.view] || 'MediHuman workspace';
  }
  function profileLabel() {
    return state.role === 'doctor'
      ? (state.doctorProfile.displayName || state.user?.email || 'Doctor workspace')
      : (state.profile.fullName || state.user?.email || 'Patient workspace');
  }

  function saving(key) { return state.saveStatus[key] === 'Saving…'; }

  function renderAuth() {
    const register = state.authMode === 'register';
    const doctor = state.authRole === 'doctor';
    if (state.authMode === 'recover') {
      return `<main class="auth-layout"><section class="auth-brand-panel"><a class="brand brand-light" href="/" aria-label="MediHuman home"><span class="brand-mark">${brandIcon()}</span>MediHuman</a><div class="auth-intro"><p class="eyebrow eyebrow-light">ACCOUNT RECOVERY</p><h1>Get back into your care workspace.</h1><p>Enter your email. If an account exists, Supabase Auth will send recovery instructions.</p></div></section><section class="auth-card-wrap"><div class="auth-card"><div class="auth-card-head"><span class="mini-mark">${brandIcon()}</span><span class="privacy-chip">Privacy-focused workspace</span></div><h2>Reset your password</h2>${state.authError ? notice(escapeHtml(state.authError), 'info') : ''}<form class="stack-form" data-form="auth"><label>Email address<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label><button class="button button-primary button-wide" type="submit">Send recovery email ${svgIcon('arrow')}</button></form><button class="button button-secondary button-wide" data-action="auth-login">Back to sign in</button></div><p class="auth-disclaimer">Never share recovery links. MediHuman does not diagnose, prescribe, or replace clinician advice.</p></section></main>`;
    }
    if (state.authMode === 'reset') {
      return `<main class="auth-layout"><section class="auth-brand-panel"><a class="brand brand-light" href="/" aria-label="MediHuman home"><span class="brand-mark">${brandIcon()}</span>MediHuman</a><div class="auth-intro"><p class="eyebrow eyebrow-light">PASSWORD RESET</p><h1>Choose a new password.</h1><p>Use a unique password, then sign in again.</p></div></section><section class="auth-card-wrap"><div class="auth-card"><div class="auth-card-head"><span class="mini-mark">${brandIcon()}</span><span class="privacy-chip">Recovery session</span></div><h2>Set new password</h2>${state.authError ? notice(escapeHtml(state.authError), 'info') : ''}<form class="stack-form" data-form="password-reset"><label>New password<input name="password" type="password" autocomplete="new-password" minlength="12" required></label><label>Confirm new password<input name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required></label><button class="button button-primary button-wide" type="submit">Update password ${svgIcon('arrow')}</button></form></div><p class="auth-disclaimer">Recovery sessions cannot access patient records until password reset completes.</p></section></main>`;
    }
    if (state.authMode === 'mfa') {
      return `<main class="auth-layout"><section class="auth-brand-panel"><a class="brand brand-light" href="/" aria-label="MediHuman home"><span class="brand-mark">${brandIcon()}</span>MediHuman</a><div class="auth-intro"><p class="eyebrow eyebrow-light">MULTI-FACTOR SECURITY</p><h1>Confirm your identity.</h1><p>Enter six digits from your authenticator app to continue.</p></div></section><section class="auth-card-wrap"><div class="auth-card"><div class="auth-card-head"><span class="mini-mark">${brandIcon()}</span><span class="privacy-chip">Additional verification</span></div><h2>Authenticator code</h2>${state.authError ? notice(escapeHtml(state.authError), 'warning') : ''}<form class="stack-form" data-form="mfa"><label>6-digit code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required></label><button class="button button-primary button-wide" type="submit">Verify and continue ${svgIcon('arrow')}</button></form></div><p class="auth-disclaimer">MediHuman will not show patient records until verification succeeds.</p></section></main>`;
    }
    const googleRole = doctor ? 'doctor' : 'patient';
    const googleCopy = doctor
      ? 'Google sign-in creates or links a pending clinician workspace for your doctor role. Verification remains pending until your organisation reviews registration details.'
      : 'Google sign-in creates or links a patient account.';
    const googleAction = register ? 'Create with Google' : 'Sign in with Google';
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
           ${register ? `<label class="check-row"><input name="consent" type="checkbox" required><span>I understand that MediHuman organises information; it does not diagnose, prescribe, or replace advice from a clinician or pharmacist.</span></label>` : ''}<div id="auth-error"></div><button class="button button-primary button-wide" type="submit">${register ? 'Create account' : 'Sign in'} ${svgIcon('arrow')}</button>${!register ? '<button type="button" class="text-link auth-recovery-link" data-action="auth-recover">Forgot password?</button>' : ''}</form>
           ${state.googleConfigured ? `<div class="auth-divider"><span>or</span></div><a class="button button-secondary button-wide auth-google" href="${googleAuthUrl(googleRole)}" aria-label="${googleAction} for ${googleRole} account">${googleIcon()}<span>${googleAction}</span></a><p class="form-footnote auth-google-note">${googleCopy}</p>` : ''}${state.googleConfigured ? '<div class="auth-divider"><span>or</span></div>' : ''}${button('Use without an account', 'local-mode', 'button button-secondary button-wide')}
         <p class="form-footnote">Your information stays in this browser and is not synced to an account.</p>
       </div><p class="auth-disclaimer">MediHuman does not diagnose, prescribe, or validate handwriting. For emergency symptoms, call your local emergency number now.</p></section>
    </main>`;
  }

  function renderSidebar() {
    const navGroups = state.role === 'doctor' ? doctorNavGroups : patientNavGroups;
    const label = profileLabel();
    const profileMeta = state.localOnly ? 'Local workspace' : (state.user?.email || 'Account');
    const roleCaption = state.role === 'doctor' ? 'Clinician workspace' : 'Patient workspace';
    const unreadCount = state.notifications.filter((notification) => !notification.readAt).length;
    function viewForNotification(notification) {
      const { type } = notification;
      if (state.role === 'doctor') return 'doctor-patients';
      if (type === 'access-request') return 'care-team';
      if (type === 'doctor-indication') return 'doctors';
      return 'patient';
    }
    const notificationPanel = state.notificationsOpen ? `<div class="notification-panel" id="notification-panel" role="region" aria-label="Notifications"><div class="notification-panel-heading"><strong>Notifications</strong><span>${unreadCount ? `${unreadCount} unread` : 'All caught up'}</span></div>${state.notifications.length ? `<div class="notification-list">${state.notifications.slice(0, 20).map((notification) => `<button class="notification-item ${notification.readAt ? '' : 'unread'}" data-action="mark-notification-read" data-id="${escapeHtml(notification.id)}" data-view="${viewForNotification(notification)}"><strong>${escapeHtml(notification.title)}</strong><span>${escapeHtml(notification.message)}</span><small>${escapeHtml(notification.createdAt ? new Date(notification.createdAt).toLocaleDateString() : 'Just now')}</small></button>`).join('')}</div>` : '<p class="notification-empty">No notifications yet.</p>'}</div>` : '';
     const profileMenu = state.profileMenuOpen ? `<div class="profile-menu" id="profile-menu" role="menu"><div class="profile-menu-identity"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(profileMeta)}</small></div>${state.mobileMenuOpen ? '' : `<button class="profile-menu-item" data-action="logout" role="menuitem"><span class="nav-icon">${svgIcon('signout')}</span><span>${state.localOnly ? 'Exit local mode' : 'Sign out'}</span></button>`}</div>` : '';
    const navItem = ([id, icon, itemLabel], extra = '') => `<button class="nav-item ${state.view === id ? 'active' : ''}" data-action="nav" data-view="${id}" ${extra} aria-current="${state.view === id ? 'page' : 'false'}"><span class="nav-icon">${svgIcon(icon)}</span><span>${itemLabel}</span>${id === 'scan' && !state.scanSeen ? '<span class="nav-badge">New</span>' : ''}</button>`;
    const patientSubmenuOpen = state.patientMenuOpen;
    const patientActive = state.view === 'patient' || state.view === 'lifestyle';
    const patientGroup = state.role === 'patient' ? `<div class="nav-group ${patientSubmenuOpen ? 'open' : ''}"><button class="nav-item nav-parent ${patientActive ? 'active' : ''}" data-action="toggle-patient-menu" aria-expanded="${patientSubmenuOpen}"><span class="nav-icon">${svgIcon('profile')}</span><span>Patient</span><span class="nav-chevron">${svgIcon('chevron-down')}</span></button>${patientSubmenuOpen ? `<div class="nav-submenu"><button class="nav-subitem ${state.view === 'patient' ? 'active' : ''}" data-action="nav" data-view="patient" data-submenu="patient" aria-current="${state.view === 'patient' ? 'page' : 'false'}"><span class="nav-icon">${svgIcon('profile')}</span><span>Profile</span></button><button class="nav-subitem ${state.view === 'lifestyle' ? 'active' : ''}" data-action="nav" data-view="lifestyle" data-submenu="patient" aria-current="${state.view === 'lifestyle' ? 'page' : 'false'}"><span class="nav-icon">${svgIcon('support')}</span><span>Support</span></button></div>` : ''}</div>` : '';
    const navSection = (group) => {
      const body = group.disclosure === 'patient' ? patientGroup : group.items.map((item) => navItem(item)).join('');
      if (!body) return '';
      return `<div class="nav-section"><p class="nav-section-label">${escapeHtml(group.label)}</p>${body}</div>`;
    };
    const navMarkup = navGroups.map(navSection).join('');
    const brandBlock = `<div class="sidebar-head workspace-brand"><a class="brand" href="/" aria-label="MediHuman home"><span class="brand-mark">${brandIcon()}</span>MediHuman</a><p class="workspace-brand-caption">${escapeHtml(roleCaption)}</p><button class="close-menu" data-action="toggle-menu" aria-label="Close navigation">×</button></div>`;
    const controls = `<div class="sidebar-bottom workspace-controls"><div class="notification-menu-wrap"><button class="notification-trigger" data-action="toggle-notifications" aria-label="Open notifications" aria-expanded="${state.notificationsOpen}" aria-controls="notification-panel"><span class="nav-icon">${svgIcon('bell')}</span><span class="notification-label">Notifications</span>${unreadCount ? `<span class="notification-count">${unreadCount > 99 ? '99+' : unreadCount}</span>` : ''}</button>${notificationPanel}</div><button class="nav-item" data-action="privacy" aria-label="Privacy and acknowledgments"><span class="nav-icon">${svgIcon('privacy')}</span><span>Privacy</span></button><button class="mobile-sidebar-logout nav-item" data-action="logout"><span class="nav-icon">${svgIcon('signout')}</span><span>${state.localOnly ? 'Exit local mode' : 'Sign out'}</span></button><div class="profile-menu-wrap workspace-account"><button class="profile-trigger" data-action="toggle-profile-menu" aria-label="${escapeHtml(`${label} ${profileMeta}`)}" aria-expanded="${state.profileMenuOpen}" aria-controls="profile-menu"><span class="avatar" aria-hidden="true" data-initials="${escapeHtml(initials(state))}"></span><span class="workspace-account-copy" aria-hidden="true"><strong>${escapeHtml(label)}</strong> <small>${escapeHtml(profileMeta)}</small></span></button>${profileMenu}</div></div>`;
    return `<header class="sidebar workspace-header workspace-nav${state.mobileMenuOpen ? ' open' : ''}" id="sidebar">${brandBlock}<nav class="main-nav primary-nav section-nav" aria-label="Main navigation">${navMarkup}</nav>${controls}</header>`;
  }

  function renderShell() {
    const exitPrompt = state.localExitPrompt ? `<div class="modal-backdrop"><section class="card local-exit-dialog" role="dialog" aria-modal="true" aria-labelledby="local-exit-title"><button class="exit-close" data-action="local-exit-cancel" aria-label="Close"><span aria-hidden="true">×</span></button><h3 id="local-exit-title">Exit stored-browser mode?</h3><p>Choose whether this browser keeps your workspace for next time.</p><div class="modal-actions">${button('Keep data and exit', 'local-exit-preserve', 'button button-primary', 'id="local-exit-keep"')}${button('Clear data and exit', 'local-exit-clear', 'button button-outline')}</div></section></div>` : '';
    const mobileScrim = state.mobileMenuOpen ? '<div class="mobile-nav-scrim" data-action="toggle-menu" aria-hidden="true"></div>' : '';
     const mobileTrigger = state.mobileMenuOpen ? '' : `<button class="mobile-nav-trigger" data-action="toggle-menu" aria-label="Open navigation" aria-expanded="false" aria-controls="sidebar">☰</button>`;
     return `<div class="app-shell"><a class="skip-link" href="#main-content">Skip to main content</a>${mobileTrigger}${mobileScrim}${renderSidebar()}<div class="shell-content">${state.errorMessage ? `<div class="notice notice-error" role="alert" aria-live="assertive"><button class="text-link notice-dismiss" data-action="clear-error">Dismiss</button><span>${state.errorMessage}</span></div>` : ''}<main class="content-page" id="main-content" data-role="${state.role}" data-view="${state.view}"><h1 class="sr-only" tabindex="-1">${escapeHtml(currentViewTitle())}</h1>${renderView()}</main><footer class="app-footer"><span>MediHuman organises information for care conversations. It does not diagnose, prescribe, or replace a clinician or pharmacist.</span><button data-action="privacy" class="footer-link">Privacy and acknowledgments</button></footer></div></div>${exitPrompt}`;
  }

  function renderView() {
    if (state.role === 'doctor' && state.view === 'dashboard') return renderDoctorDashboard();
    if (state.role === 'doctor' && state.view === 'doctor-patients') return renderDoctorPatients();
    if (state.view === 'patient') return renderPatient();
    if (state.view === 'medicines') return renderMedicines();
     if (state.view === 'scan') return renderScanWithPrescriptions();
    if (state.view === 'review') return renderReview();
     if (state.view === 'reconcile') return renderReconcileWithHistory();
    if (state.view === 'composition') return renderComposition();
    if (state.view === 'doctors') return renderDoctors();
    if (state.view === 'care-team') return renderCareTeam();
    if (state.view === 'lifestyle') return renderLifestyle();
    if (state.view === 'privacy') return renderPrivacy();
    return renderDashboard();
  }

  function renderMetricChips(metrics) {
    return `<div class="metric-chips" data-surface="metric-chips" aria-label="Workspace metrics">${metrics.map(([value, label]) => `<span class="metric-chip"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></span>`).join('')}</div>`;
  }

  function renderAppointmentSummary({ title, detail, metrics }) {
    return `<aside class="card dashboard-appointment-summary workspace-float-card floating-summary" data-surface="appointment-summary" aria-label="Workspace summary"><div class="summary-topline"><span class="card-kicker">WORKSPACE SUMMARY</span><span class="summary-status">${state.localOnly ? 'Private' : 'Ready'}</span></div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(detail)}</p>${renderMetricChips(metrics)}</aside>`;
  }

  function overviewDate(value) {
    if (!value) return 'Not dated';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Recorded' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function overviewEmpty(label) {
    return `<p class="overview-empty">No ${escapeHtml(label)} recorded yet.</p>`;
  }

  function renderProfileOverview() {
    const profile = state.profile || {};
    const profileFields = [profile.fullName, profile.dateOfBirth, profile.allergies, profile.conditions];
    const filledProfileFields = profileFields.filter(Boolean).length;
    const prescriptions = state.prescriptions.length ? state.prescriptions : state.prescriptionText.split(/[\n,]+/).map((medicationName, index) => medicationName.trim() ? ({ id: `draft-${index}`, medicationName: medicationName.trim(), instructions: 'Current capture' }) : null).filter(Boolean);
    const categories = [
      ['Profile', filledProfileFields, 'profile'],
      ['Medicines', state.medicines.length, 'medicines'],
      ['Prescriptions', prescriptions.length, 'prescriptions'],
      ['Comparisons', state.reconciliations.length, 'reconciliations'],
      ['Questions', state.questions.length, 'questions'],
      ['Care access', state.patientRequests.length, 'access'],
      ['Indications', state.indications.length, 'indications'],
    ];
    const maxCategoryCount = Math.max(...categories.map(([, count]) => count), 1);
    const profileCompletion = Math.round((filledProfileFields / profileFields.length) * 100);
    const findings = analyzeMedicationSafety(state.medicines, profile);
    const indicators = [
      profile.allergies ? 'Allergy context recorded for clinician review.' : 'No allergy information recorded yet.',
      profile.conditions ? 'Condition context recorded for care conversations.' : 'No condition context recorded yet.',
      state.medicines.length ? `${state.medicines.length} medicine${state.medicines.length === 1 ? '' : 's'} recorded for review.` : 'Add medicines to generate medication indicators.',
      ...findings.slice(0, 3).map((finding) => finding.detail || finding.title),
      ...state.indications.slice(0, 3).map((indication) => `Clinician indication: ${indication.title || 'Review recorded information'}.`),
    ];
    const profileRecords = [
      ['Full name', profile.fullName],
      ['Date of birth', profile.dateOfBirth],
      ['Allergies', profile.allergies],
      ['Conditions', profile.conditions],
    ].filter(([, value]) => value);
    const medicineRecords = state.medicines.map((medicine) => `<li><strong>${escapeHtml(medicine.name || 'Unnamed medicine')}</strong><span>${escapeHtml([medicine.strength, medicine.dose, medicine.route, medicine.timing].filter(Boolean).join(' · ') || 'Details not recorded')}</span></li>`).join('');
    const prescriptionRecords = prescriptions.map((prescription) => `<li><strong>${escapeHtml(prescription.medicationName || 'Prescription record')}</strong><span>${escapeHtml(prescription.instructions || 'Captured medicine detail')} · ${overviewDate(prescription.createdAt)}</span></li>`).join('');
    const reconciliationRecords = state.reconciliations.map((record) => `<li><strong>${record.isExactMatch ? 'Medicine names match' : 'Difference requires review'}</strong><span>${escapeHtml(`${record.missing?.length || 0} missing · ${record.unexpected?.length || 0} unexpected`)} · ${overviewDate(record.createdAt)}</span></li>`).join('');
    const questionRecords = state.questions.map((question) => `<li><strong>${escapeHtml(question.title)}</strong><span>${escapeHtml(question.meta || 'Personal note')}</span></li>`).join('');
    const accessRecords = state.patientRequests.map((request) => `<li><strong>${escapeHtml(request.doctor?.displayName || 'Clinician')}</strong><span>${escapeHtml(request.status || 'pending')} · ${overviewDate(request.requestedAt)}</span></li>`).join('');
    const indicationRecords = state.indications.map((indication) => `<li><strong>${escapeHtml(indication.title || 'Clinician indication')}</strong><span>${escapeHtml(indication.detail || 'Review with your care team.')} · ${overviewDate(indication.createdAt)}</span></li>`).join('');
    const categoryCards = [
      ['Profile', 'profile', profileRecords.map(([label, value]) => `<li><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></li>`).join('')],
      ['Medicines', 'medicines', medicineRecords],
      ['Prescriptions', 'prescriptions', prescriptionRecords],
      ['Comparisons', 'reconciliations', reconciliationRecords],
      ['Questions', 'questions', questionRecords],
      ['Care access', 'access', accessRecords],
      ['Indications', 'indications', indicationRecords],
    ].map(([title, icon, records]) => `<section class="card overview-category-card${records ? '' : ' is-empty'}"><div class="card-heading"><div><p class="card-kicker">RECORD CATEGORY</p><h3>${title}</h3></div><span class="soft-icon">${svgIcon(icon === 'access' ? 'care-team' : icon === 'reconciliations' ? 'compare' : icon === 'prescriptions' ? 'document' : icon === 'questions' ? 'questions' : icon === 'indications' ? 'info' : icon)}</span></div>${records ? `<ul class="overview-record-list">${records}</ul>` : overviewEmpty(title.toLowerCase())}</section>`).join('');
    const timelineItems = [];
    if (state.profile.fullName || state.profile.conditions || state.profile.allergies) timelineItems.push({ type: 'profile', label: 'Profile updated', date: state.profile.updatedAt || '' });
    state.medicines.forEach((m, i) => timelineItems.push({ type: 'medicine', label: `Medicine: ${m.name || 'Unnamed'}`, date: m.updatedAt || m.createdAt || '' }));
    state.prescriptions.forEach((rx) => timelineItems.push({ type: 'prescription', label: `Prescription: ${rx.condition || (Array.isArray(rx.medicines) && rx.medicines[0]?.medicationName) || 'Record'}`, date: rx.createdAt || '' }));
    state.reconciliations.forEach((r) => timelineItems.push({ type: 'reconciliation', label: r.isExactMatch ? 'Medicine names matched' : 'Difference requires review', date: r.createdAt || '' }));
    state.indications.forEach((ind) => timelineItems.push({ type: 'indication', label: `Indication: ${ind.title || 'Note'}`, date: ind.createdAt || '' }));
    const sortedTimeline = timelineItems.filter((t) => t.date).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8);
    const timelineMarkup = sortedTimeline.length ? `<ul class="timeline-list">${sortedTimeline.map((item) => `<li class="timeline-item"><span class="timeline-dot timeline-${escapeHtml(item.type)}"></span><span class="timeline-label">${escapeHtml(item.label)}</span><span class="timeline-date">${escapeHtml(overviewDate(item.date))}</span></li>`).join('')}</ul>` : `<p class="overview-empty">No records with dates yet.</p>`;
    return `<section class="profile-overview" data-surface="profile-overview" aria-labelledby="profile-overview-heading"><div class="profile-overview-heading"><div><p class="eyebrow">PROFILE OVERVIEW</p><h2 id="profile-overview-heading">Your records, organised by category.</h2><p>See every record currently saved in this workspace. Indicators summarise recorded information only; they are not a diagnosis.</p>${button('View all records', 'nav', 'button button-outline button-small', 'data-view="medicines"')}</div><span class="overview-total"><strong>${categories.reduce((total, [, count]) => total + count, 0)}</strong><span>records tracked</span></span></div><div class="profile-overview-summary"><section class="card overview-completion"><div class="overview-card-heading"><div><p class="card-kicker">PROFILE COMPLETENESS</p><h3>${profileCompletion}% complete</h3></div><span class="overview-progress-value">${filledProfileFields}/${profileFields.length}</span></div><div class="overview-progress" role="progressbar" aria-label="Profile completeness" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${profileCompletion}"><span data-progress-width="${profileCompletion}"></span></div><p>Complete profile fields to make care conversations easier.</p></section><section class="card overview-graph-card"><div class="overview-card-heading"><div><p class="card-kicker">RECORDS BY CATEGORY</p><h3>Workspace activity</h3></div><span class="soft-icon">${svgIcon('document')}</span></div><div class="overview-bars" role="img" aria-label="Saved records by category">${categories.map(([label, count]) => { const barWidth = Math.max((count / maxCategoryCount) * 100, count ? 12 : 4); return `<div class="overview-bar-item"><span class="overview-bar-value">${count}</span><span class="overview-bar" data-bar-width="${barWidth}"></span><span class="overview-bar-label">${escapeHtml(label)}</span></div>`; }).join('')}</div></section><section class="card overview-indications"><div class="overview-card-heading"><div><p class="card-kicker">RECORDED INDICATORS</p><h3>Points to discuss</h3></div><span class="soft-icon">${svgIcon('info')}</span></div><ul class="indication-list">${indicators.map((indicator) => `<li><span class="indication-dot"></span><span>${escapeHtml(indicator)}</span></li>`).join('')}</ul><p class="overview-disclaimer">Confirm these points with a clinician or pharmacist. MediHuman does not diagnose or recommend treatment.</p></section></div><section class="card overview-timeline"><div class="overview-card-heading"><div><p class="card-kicker">RECENT ACTIVITY</p><h3>Records by date</h3></div><span class="soft-icon">${svgIcon('document')}</span></div>${timelineMarkup}<p class="overview-disclaimer">Most recent records first. Confirm details with your care team.</p></section><div class="overview-category-grid">${categoryCards}</div></section>`;
  }

  function renderDashboard() {
    const comparison = compareMedicines(state.prescriptionText, state.dispensedText);
    const hasList = comparison.prescribed.length > 0 || comparison.dispensed.length > 0;
    const reviewCount = comparison.missing.length + comparison.unexpected.length;
    return `<div class="welcome-row"><div><p class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p><h2 class="page-title" data-dashboard-heading="patient-dashboard-heading">${escapeHtml(state.profile.fullName ? `How is ${state.profile.fullName.split(' ')[0]} doing?` : 'Review your medication information.')}</h2><p class="page-lede">Keep medicine details together, then take clear questions to your pharmacist or clinician.</p></div><div class="today-orb" aria-hidden="true"></div></div>
        <div class="dashboard-hero-layout workspace-hero" data-dashboard-layout="patient" data-surface="dashboard-hero" aria-labelledby="patient-dashboard-hero-heading"><div class="workspace-hero-copy feature-copy"><span class="card-kicker">QUICK CAPTURE</span><h2 id="patient-dashboard-hero-heading" class="dashboard-hero-heading">Review a new prescription</h2><p>Use your camera or choose a photo. Compare every captured detail with the original before saving.</p>${button(`Capture prescription ${svgIcon('arrow')}`, 'go-scan', 'button button-light', 'id="patient-dashboard-hero-cta"')}</div><div class="workspace-hero-panel"><div class="scan-illustration"><span>${svgIcon('document')}</span><i></i><i></i><i></i></div>${renderAppointmentSummary({ title: 'Prepare for a care conversation', detail: 'Keep medicine details and questions together so you can review them with your pharmacist or clinician.', metrics: [[state.medicines.length, 'medicines recorded'], [state.questions.length, 'questions saved'], [reviewCount, 'items to review']] })}</div></div><div class="dashboard-grid"><section class="card medication-summary"><div class="card-heading"><div><p class="card-kicker">YOUR LIST</p><h3>Current medicines</h3></div><button class="icon-button" data-action="nav" data-view="medicines" aria-label="View medicines">${svgIcon('arrow')}</button></div>${state.medicines.length ? `<div class="medicine-preview">${state.medicines.slice(0, 3).map((medicine) => `<div class="medicine-row"><span class="medicine-dot"></span><div><strong>${escapeHtml(medicine.name)}</strong><span>${escapeHtml([medicine.strength, medicine.timing].filter(Boolean).join(' · ') || 'Details to review')}</span></div></div>`).join('')}</div><button class="text-link" data-action="nav" data-view="medicines">View all medicines →</button>` : `<div class="empty-state compact"><span class="empty-icon">${svgIcon('add')}</span><p>No medicines added yet.</p><button class="text-link" data-action="nav" data-view="medicines">Add your current list →</button></div>`}</section>
       <section class="card check-card"><div class="card-heading"><div><p class="card-kicker">LAST COMPARISON</p><h3>${hasList ? (reviewCount ? 'Difference requires review' : 'Medicine names match') : 'No comparison yet'}</h3></div><span class="status-pill ${reviewCount ? 'pill-warn' : 'pill-green'}">${hasList ? (reviewCount ? `${reviewCount} to review` : 'Complete') : 'Start'}</span></div><p>${hasList ? (reviewCount ? 'The lists differ. Confirm the difference with your pharmacy or prescriber.' : 'Medicine names and strengths match after text comparison; directions are ignored. This does not confirm formulation, substitutions, or safety.') : 'Compare prescribed and dispensed medicine names.'}</p>${button(hasList ? 'Open comparison' : 'Start comparison', 'go-reconcile', 'button button-outline')}</section>
       <section class="card safety-card"><div class="safety-heading"><span class="safety-symbol">${svgIcon('safety')}</span><div><p class="card-kicker">SAFETY FIRST</p><h3>Pause when information does not match</h3></div></div><p>Do not start, stop, or change a dose based only on this app. Ask a pharmacist or clinician.</p><button class="text-link" data-action="nav" data-view="composition">Open limited safety review →</button></section>
     </div>${renderProfileOverview()}<section class="section-intro"><p class="eyebrow">Your care workspace</p><h3>Organised information supports better conversations.</h3><p>Choose a task when you are ready. Your notes remain yours to edit and clear.</p></section>`;
  }

  function renderPatient() {
    const p = state.profile;
    const patientId = p.patientId || state.user?.patientId || 'Generated after account setup';
     return `<div class="section-intro"><p class="eyebrow">PATIENT PROFILE</p><h2 class="page-title">Record information for care conversations.</h2><p>These details help you prepare questions. Share them only when you choose.</p></div><div class="two-column"><section class="card form-card"><div class="card-heading"><div><h3>Patient information</h3><p class="muted">Optional details. Edit anytime.</p></div><span class="soft-icon">${svgIcon('profile')}</span></div><form class="stack-form" data-form="profile"><label>Full name<input name="fullName" value="${escapeHtml(p.fullName)}" autocomplete="name" placeholder="e.g. Maya Johnson"></label><label>Date of birth<input name="dateOfBirth" value="${escapeHtml(p.dateOfBirth)}" type="date"></label><label>Known health conditions or diagnoses<textarea name="conditions" rows="3" placeholder="Only what you are comfortable recording">${escapeHtml(p.conditions)}</textarea></label><label>Allergies<textarea name="allergies" rows="3" placeholder="e.g. penicillin, or none known">${escapeHtml(p.allergies)}</textarea></label><div class="form-actions">${button('Save profile', 'save-profile', 'button button-primary', saving('profile') ? 'disabled' : '')}<span class="save-note" role="status">${escapeHtml(state.saveStatus.profile || 'Not saved yet')}</span></div></form></section><aside class="card side-note">${notice('<strong>Privacy tip.</strong> Record only what you need for a care conversation. Clear this workspace from Privacy and acknowledgments when you are finished.', 'info')}<div class="patient-id-card"><p class="card-kicker">PRIVATE PATIENT ID</p><code>${escapeHtml(patientId)}</code><p>Share this ID only with a clinician you intend to authorise. It does not include your name.</p></div><h3>What this does</h3><p>MediHuman displays your notes alongside medication information. It does not determine whether a medicine is appropriate or safe for you.</p>${button('Manage clinician access', 'nav', 'button button-outline', 'data-view="care-team"')}</aside></div>`;
  }



  function renderMedicines() {
    const medicineFields = (medicine, index) => `<label>Medicine name<input data-med-index="${index}" data-med-key="name" value="${escapeHtml(medicine.name)}"></label><label>Strength<input data-med-index="${index}" data-med-key="strength" value="${escapeHtml(medicine.strength)}" placeholder="e.g. 500 mg"></label><label>Dose<input data-med-index="${index}" data-med-key="dose" value="${escapeHtml(medicine.dose)}" placeholder="e.g. 1 tablet"></label><label>Route<input data-med-index="${index}" data-med-key="route" value="${escapeHtml(medicine.route)}" placeholder="e.g. oral"></label><label>Directions: when and how often<input data-med-index="${index}" data-med-key="timing" value="${escapeHtml(medicine.timing)}" placeholder="e.g. morning with food"></label><label>Notes<input data-med-index="${index}" data-med-key="notes" value="${escapeHtml(medicine.notes)}" placeholder="e.g. with food"></label><label>Status<select data-med-index="${index}" data-med-key="status"><option value="active" ${medicine.status === 'active' || !medicine.status ? 'selected' : ''}>Currently taking</option><option value="discontinued" ${medicine.status === 'discontinued' ? 'selected' : ''}>Discontinued</option><option value="completed" ${medicine.status === 'completed' ? 'selected' : ''}>Completed</option></select></label><label>Started<input data-med-index="${index}" data-med-key="startedAt" type="date" value="${escapeHtml(medicine.startedAt || '')}"></label>${medicine.status === 'discontinued' || medicine.status === 'completed' ? `<label>Stopped<input data-med-index="${index}" data-med-key="stoppedAt" type="date" value="${escapeHtml(medicine.stoppedAt || '')}"></label><label>Reason<textarea data-med-index="${index}" data-med-key="reason" rows="2" placeholder="Why discontinued">${escapeHtml(medicine.reason || '')}</textarea></label>` : ''}<label>Prescriber<input data-med-index="${index}" data-med-key="prescriber" value="${escapeHtml(medicine.prescriber || '')}" placeholder="Prescribing clinician"></label>`;
    const query = (state.medicineFilter || '').toLowerCase();
    const indexed = state.medicines.map((medicine, index) => ({ medicine, index })).filter(({ medicine }) => !query || medicine.name.toLowerCase().includes(query));
    const active = indexed.filter(({ medicine }) => !medicine.status || medicine.status === 'active');
    const historical = indexed.filter(({ medicine }) => medicine.status === 'discontinued' || medicine.status === 'completed');
    const renderList = (items, emptyLabel) => items.length ? `<div class="medicine-list">${items.map(({ medicine, index }) => `<article class="medicine-detail" data-status="${escapeHtml(medicine.status || 'active')}"><div class="medicine-number">${String(index + 1).padStart(2, '0')}<span class="medicine-status-badge ${medicine.status === 'active' || !medicine.status ? 'status-active' : medicine.status === 'discontinued' ? 'status-discontinued' : 'status-completed'}">${escapeHtml(medicine.status || 'active')}</span></div><div class="medicine-fields">${medicineFields(medicine, index)}</div><div class="medicine-row-actions">${medicine.status === 'active' || !medicine.status ? `<button class="text-link" data-action="discontinue-medicine" data-index="${index}">Mark discontinued</button> <button class="text-link" data-action="complete-medicine" data-index="${index}">Mark completed</button>` : `<button class="text-link" data-action="reactivate-medicine" data-index="${index}">Reactivate</button>`}${button('×', 'remove-medicine', 'remove-button', `data-index="${index}" aria-label="Remove ${escapeHtml(medicine.name)}"`)}</div></article>`).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">${svgIcon('medicines')}</span><h3>${escapeHtml(emptyLabel)}</h3><p>Add medicines manually or review prescription details to start.</p></div>`;
    const editMode = Boolean(state.medicineEditMode);
    const statusLabel = (status) => ({ active: 'Active', discontinued: 'Discontinued', completed: 'Completed' }[status] || 'Active');
    const statusClass = (status) => (status === 'discontinued' ? 'status-discontinued' : status === 'completed' ? 'status-completed' : 'status-active');
    const viewRow = ({ medicine, index }) => {
      const status = medicine.status || 'active';
      const details = [medicine.strength, medicine.dose, medicine.route, medicine.timing].filter(Boolean).join(' · ');
      const notes = medicine.notes ? `<span>Notes: ${escapeHtml(medicine.notes)}</span>` : '';
      const prescriber = medicine.prescriber ? `<span>Prescriber: ${escapeHtml(medicine.prescriber)}</span>` : '';
      const dates = [medicine.startedAt ? `Started ${escapeHtml(medicine.startedAt)}` : '', medicine.stoppedAt ? `Stopped ${escapeHtml(medicine.stoppedAt)}` : ''].filter(Boolean).join(' · ');
      const history = dates ? `<span>${dates}</span>` : '';
      return `<div class="medicine-view-row"><div class="medicine-view-cell"><strong>${escapeHtml(medicine.name || 'Medicine')}</strong>${prescriber}${history}</div><div class="medicine-view-cell"><span>${escapeHtml(details || 'Details not recorded')}</span>${notes}</div><span class="medicine-status-badge ${statusClass(status)}">${escapeHtml(statusLabel(status))}</span><div class="form-actions medicine-view-actions">${button('Edit', 'edit-medicine', 'button button-outline button-small', `data-index="${index}"`)}${button('Remove', 'remove-medicine', 'button button-outline button-small', `data-index="${index}"`)}</div></div>`;
    };
    const viewTable = indexed.length
      ? `<div class="medicine-view-table"><div class="medicine-view-head"><span>Medicine</span><span>Dose and timing</span><span>Status</span><span>Actions</span></div>${indexed.map(viewRow).join('')}</div>`
      : `<div class="empty-state"><span class="empty-icon">${svgIcon('medicines')}</span><h3>No medicines recorded</h3><p>Add medicines manually or review prescription details to start.</p>${button('Add your first medicine', 'edit-medicines', 'button button-outline')}</div>`;
    const activeSection = `<section class="medicine-section"><h3 class="medicine-section-title">Currently taking</h3><p class="medicine-section-meta">${active.length} medicine${active.length === 1 ? '' : 's'}</p>${renderList(active, 'No active medicines recorded')}</section>`;
    const historicalSection = historical.length ? `<section class="medicine-section"><h3 class="medicine-section-title">Previously taken</h3><p class="medicine-section-meta">${historical.length} medicine${historical.length === 1 ? '' : 's'}</p>${renderList(historical, 'No previous medicines')}</section>` : '';
    const filter = `<label class="filter-label"><span class="sr-only">Filter medicines</span><input id="medicine-filter" value="${escapeHtml(state.medicineFilter || '')}" placeholder="Filter medicines…"></label>`;
    const body = editMode ? `${filter}${activeSection}${historicalSection}` : `${filter}${viewTable}`;
    const actions = editMode
      ? `<div class="medicine-actions">${button('＋ Add medicine', 'add-medicine', 'button button-secondary')}${button('Save medication list', 'save-medicines', 'button button-primary', saving('medicines') ? 'disabled' : '')}${button('View list', 'view-medicines', 'button button-outline')}<span class="save-note" role="status" id="medicine-save-note">${escapeHtml(state.saveStatus.medicines || 'Not saved yet')}</span></div>`
      : `<div class="medicine-actions">${button('Edit list', 'edit-medicines', 'button button-secondary')}<span class="save-note" role="status" id="medicine-save-note">${escapeHtml(state.saveStatus.medicines || '')}</span></div>`;
    return `<div class="section-intro inline-intro"><div><p class="eyebrow">MEDICATION LIST</p><h2 class="page-title">${editMode ? 'Update your medication list.' : 'Your recorded medicines.'}</h2><p>${editMode ? 'Record medicine name, strength, dose, route, and directions exactly as shown.' : 'Review what you have recorded, then edit the list when details change.'} This list does not replace your official medication record.</p></div>${button('Capture prescription details', 'go-scan', 'button button-primary')}</div><section class="card medicine-editor"><div class="card-heading"><div><h3>${editMode ? 'Edit medicines' : 'Medicines'}</h3><p class="muted">${state.medicines.length} item${state.medicines.length === 1 ? '' : 's'} recorded${state.medicines.filter((m) => !m.status || m.status === 'active').length > 0 ? ` · ${state.medicines.filter((m) => !m.status || m.status === 'active').length} active` : ''}</p></div><span class="soft-icon">${svgIcon('medicines')}</span></div>${body}${actions}</section>${notice('<strong>Check the label.</strong> Include strength, formulation, dose, route, and timing when shown. A medicine list is a conversation aid, not a prescribing record.', 'info')}`;
  }

  function renderScan() {
    return `<div class="section-intro"><p class="eyebrow">STEP 1 OF 3 · CAPTURE</p><h2 class="page-title">Bring the page into focus.</h2><p>Use good lighting, then compare every captured field with the original. OCR may misread printed or handwritten text.</p></div><div class="scan-grid"><section class="card camera-card"><div class="card-heading"><div><h3>Prescription photo</h3><p class="muted">Images are processed in your browser and are not uploaded here.</p></div><span class="soft-icon">${svgIcon('scan')}</span></div><div class="camera-stage ${state.cameraError ? 'has-error' : ''}">${state.cameraError ? `<div class="camera-error"><span class="error-symbol">!</span><h4>Camera needs attention</h4><p>${escapeHtml(state.cameraError)}</p><button class="text-link" data-action="camera-start">Try camera again →</button></div>` : `<video id="camera-video" playsinline muted aria-label="Camera preview"></video><div class="camera-guide"><span></span></div><p class="camera-placeholder">${state.cameraStream ? 'Center the prescription inside the frame' : 'Camera preview appears after you allow access'}</p>`}</div><div class="camera-actions">${state.cameraStream ? `${button('Capture frame', 'camera-capture', 'button button-primary')}${button('Stop camera', 'camera-stop', 'button button-secondary')}` : button('Enable camera', 'camera-start', 'button button-primary')}<label class="button button-secondary file-button">Choose prescription photo<input id="prescription-file" type="file" accept="image/*" capture="environment"></label></div><p class="privacy-caption">Allow camera access only if you want to capture an image. You can also choose a photo or enter details manually.</p></section><section class="card manual-card"><div class="card-heading"><div><h3>Manual details</h3><p class="muted">Enter details manually if the image cannot be read.</p></div><span class="soft-icon">${svgIcon('edit')}</span></div><label class="large-label">Prescription text to verify<textarea id="manual-prescription" rows="10" placeholder="Medicine name · strength · directions\nOne item per line">${escapeHtml(state.prescriptionText)}</textarea></label>${notice('MediHuman does not claim handwriting OCR is clinically reliable. Confirm every name, strength, and direction against the original and your pharmacist.', 'warning')}<div class="form-actions">${button('Continue to review', 'manual-review', 'button button-primary')}<span class="save-note" role="status">You edit before anything is saved.</span></div></section></div>`;
  }

  function renderPrescriptionManager() {
    if (!state.prescriptions.length) return `<section class="card prescription-manager"><div class="card-heading"><div><p class="card-kicker">SAVED PRESCRIPTIONS</p><h3>Prescription records</h3><p class="muted">No prescriptions recorded yet.</p></div><span class="soft-icon">${svgIcon('document')}</span></div><div class="empty-state"><span class="empty-icon">${svgIcon('document')}</span><h3>Add your first prescription</h3><p>Scan a prescription photo or enter details manually to get started.</p><button class="text-link" data-action="go-scan">Capture prescription →</button></div></section>`;
    const editing = state.prescriptions.find((item) => item.id === state.editingPrescriptionId);
    if (editing) return `<section class="card prescription-manager"><div class="card-heading"><div><p class="card-kicker">PRESCRIPTION RECORD</p><h3>Edit saved prescription</h3><p class="muted">Keep details aligned with the current source label.</p></div><span class="soft-icon">${svgIcon('edit')}</span></div><form class="stack-form" data-form="prescription-edit" data-id="${escapeHtml(editing.id)}"><label>Condition / Disease<input name="condition" value="${escapeHtml(editing.condition || '')}" placeholder="e.g. Type 2 diabetes"></label><label>Date<input name="date" type="date" value="${escapeHtml(editing.date || '')}"></label><label>Doctor / Prescriber<input name="doctor" value="${escapeHtml(editing.doctor || '')}" placeholder="Dr. Name"></label><label>Instructions<textarea name="instructions" rows="3">${escapeHtml(editing.instructions || '')}</textarea></label><label>Notes<textarea name="notes" rows="2">${escapeHtml(editing.notes || '')}</textarea></label><div class="form-actions"><button class="button button-primary" type="submit">Save prescription</button>${button('Cancel', 'cancel-prescription-edit', 'button button-secondary')}</div></form></section>`;
    const sortedPrescriptions = [...state.prescriptions].sort((a, b) => String(b.createdAt || b.updatedAt || '').localeCompare(String(a.createdAt || a.updatedAt || '')));
    // Group by month/year
    const groups = {};
    for (const rx of sortedPrescriptions) {
      const date = rx.createdAt || rx.updatedAt;
      const key = date ? new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'long' }) : 'Undated';
      if (!groups[key]) groups[key] = [];
      groups[key].push(rx);
    }
    const groupMarkup = Object.entries(groups).map(([month, items]) => `<div class="record-group"><h4 class="record-group-title">${escapeHtml(month)}</h4><div class="overview-record-list">${items.map((prescription) => {
      const medicines = Array.isArray(prescription.medicines) ? prescription.medicines : [];
      const medicineNames = medicines.map((m) => m.medicationName || m.name || 'Medicine').join(', ');
      const tests = Array.isArray(prescription.tests) ? prescription.tests : [];
      return `<div class="overview-record"><div><strong>${escapeHtml(prescription.condition || medicineNames || 'Prescription')}</strong><span>${escapeHtml([prescription.doctor, prescription.date].filter(Boolean).join(' · ') || 'Details not recorded')}${medicines.length ? ` · ${medicines.length} medicine${medicines.length === 1 ? '' : 's'}` : ''}${tests.length ? ` · ${tests.length} test${tests.length === 1 ? '' : 's'}` : ''}${prescription.createdAt ? ` · ${escapeHtml(new Date(prescription.createdAt).toLocaleDateString())}` : ''}</span></div><div class="form-actions">${button('View', 'view-prescription', 'button button-outline button-small', `data-id="${escapeHtml(prescription.id)}"`)}${button('Edit', 'edit-prescription', 'button button-outline button-small', `data-id="${escapeHtml(prescription.id)}"`)}${button('Remove', 'delete-prescription', 'button button-outline button-small', `data-id="${escapeHtml(prescription.id)}"`)}</div></div>`;
    }).join('')}</div></div>`).join('');
    return `<section class="card prescription-manager"><div class="card-heading"><div><p class="card-kicker">SAVED PRESCRIPTIONS</p><h3>Prescription records</h3><p class="muted">Edit or remove records after checking the original source.</p></div><span class="soft-icon">${svgIcon('document')}</span></div>${groupMarkup}</section>`;
  }

  function renderPrescriptionDetail() {
    const prescription = state.prescriptions.find((item) => item.id === state.viewingPrescriptionId);
    if (!prescription) return '';
    const medicines = Array.isArray(prescription.medicines) ? prescription.medicines : [];
    const tests = Array.isArray(prescription.tests) ? prescription.tests : [];
    const medicineRows = medicines.map((medicine) => `<li><strong>${escapeHtml(medicine.medicationName || 'Medicine')}</strong><span>${escapeHtml([medicine.strength, medicine.dose, medicine.route, medicine.frequency, medicine.instructions].filter(Boolean).join(' · ') || 'Details not recorded')}</span></li>`).join('');
    const testRows = tests.map((test) => `<li><strong>${escapeHtml(test.name)}</strong><span>${escapeHtml([test.result, test.date].filter(Boolean).join(' · ') || 'No result')}</span></li>`).join('');
    return `<section class="card prescription-detail"><div class="card-heading"><div><p class="card-kicker">PRESCRIPTION RECORD</p><h3>${escapeHtml(prescription.condition || 'Prescription')}</h3><p class="muted">Full details of this prescription record.</p></div><span class="soft-icon">${svgIcon('document')}</span></div><dl class="record-list">
      <div><dt>Condition</dt><dd>${escapeHtml(prescription.condition || 'Not recorded')}</dd></div>
      <div><dt>Date</dt><dd>${escapeHtml(prescription.date || (prescription.createdAt ? new Date(prescription.createdAt).toLocaleDateString() : 'Not recorded'))}</dd></div>
      <div><dt>Doctor / Prescriber</dt><dd>${escapeHtml(prescription.doctor || 'Not recorded')}</dd></div>
      <div><dt>General instructions</dt><dd>${escapeHtml(prescription.instructions || 'Not recorded')}</dd></div>
      <div><dt>Notes</dt><dd>${escapeHtml(prescription.notes || 'Not recorded')}</dd></div>
      ${prescription.fileRef ? `<div><dt>Report</dt><dd><a href="${escapeHtml(prescription.fileRef)}" target="_blank" rel="noopener">View report</a></dd></div>` : ''}
    </dl>
    <h4>Medicines (${medicines.length})</h4>
    ${medicines.length ? `<ul class="record-items">${medicineRows}</ul>` : '<p class="result-empty">No medicines recorded.</p>'}
    <h4>Tests (${tests.length})</h4>
    ${tests.length ? `<ul class="record-items">${testRows}</ul>` : '<p class="result-empty">No tests recorded.</p>'}
    <div class="form-actions">${button('Close', 'cancel-prescription-view', 'button button-secondary')}</div>
    </section>`;
  }

  function renderScanWithPrescriptions() {
    if (state.viewingPrescriptionId) return `${renderScan()}${renderPrescriptionDetail()}`;
    return `${renderScan()}${renderPrescriptionManager()}`;
  }

  function renderReview() {
    return `<div class="section-intro"><p class="eyebrow">STEP 2 OF 3 · VERIFY DETAILS</p><h2 class="page-title">Does this match the original prescription?</h2><p>Correct names, strengths, and directions before continuing. Blank or uncertain text should be entered manually.</p></div><section class="card review-card"><div class="review-toolbar"><div><span class="review-status">${escapeHtml(state.scanSource || 'Manual details')}</span><h3>Prescription text to verify</h3></div><button class="text-link" data-action="nav" data-view="scan">← Capture again</button></div><label class="large-label">Review and edit<textarea id="review-text" rows="12">${escapeHtml(state.ocrText || state.prescriptionText)}</textarea></label><div class="review-checks"><div><span class="check-icon">✓</span><span>Compare each line with the source</span></div><div><span class="check-icon">✓</span><span>Include strength and formulation</span></div><div><span class="check-icon">✓</span><span>Ask a pharmacist about uncertainty</span></div></div><div class="form-actions">${button('Save this list for comparison', 'save-review', 'button button-primary', saving('prescription') ? 'disabled' : '')}<span class="save-note" role="status">This app does not interpret or validate clinical instructions. Confirm uncertainty with a pharmacist or clinician.</span></div></section>`;
  }

  function renderReconcile() {
    const comparison = compareMedicines(state.prescriptionText, state.dispensedText);
    const has = comparison.prescribed.length || comparison.dispensed.length;
    const list = (items, empty) => items.length ? `<ul class="result-list">${items.map((item) => `<li>${escapeHtml(item.name)}${item.count > 1 ? ` <small>×${item.count}</small>` : ''}</li>`).join('')}</ul>` : `<p class="result-empty">${empty}</p>`;
    return `<div class="section-intro inline-intro"><div><p class="eyebrow">STEP 3 OF 3 · RECONCILIATION</p><h2 class="page-title">Compare prescribed and dispensed medicines.</h2><p>This compares the medicine name and strength written before an em dash, dot, or semicolon. It does not assess directions, formulation changes, substitutions, or clinical appropriateness.</p></div><span class="status-pill ${has && comparison.isExactMatch ? 'pill-green' : has ? 'pill-warn' : 'pill-neutral'}">${has ? (comparison.isExactMatch ? 'Medicine names match' : 'Difference requires review') : 'Enter both lists to compare'}</span></div><section class="card reconciliation-card"><div class="list-input-grid"><label class="large-label">Prescribed<textarea id="prescribed-list" rows="8" placeholder="One medicine per line">${escapeHtml(state.prescriptionText)}</textarea></label><label class="large-label">Dispensed<textarea id="dispensed-list" rows="8" placeholder="What the pharmacy provided">${escapeHtml(state.dispensedText)}</textarea></label></div><div class="reconcile-actions">${button('Compare lists', 'run-reconcile', 'button button-primary')}<span class="save-note" role="status">Comparison ignores case, repeated spaces, and directions after an em dash, dot, or semicolon.</span></div></section>${has ? `<section class="result-board"><div class="result-board-head"><div><p class="card-kicker">RESULT</p><h3>${comparison.isExactMatch ? 'Medicine names match; confirm details with your care team.' : 'Please clarify this difference with the pharmacy or prescriber.'}</h3></div>${button('Review safety notes', 'go-composition', 'button button-outline')}</div><div class="result-columns"><div class="result-col good"><span class="result-label">IN BOTH LISTS</span>${list(comparison.matched, 'No matching medicine names')}</div><div class="result-col warn"><span class="result-label">PRESCRIBED, NOT IN DISPENSED LIST</span>${list(comparison.missing, 'None')}</div><div class="result-col alert"><span class="result-label">DISPENSED, NOT IN PRESCRIBED LIST</span>${list(comparison.unexpected, 'None')}</div></div></section>` : notice('Enter both lists to compare them. Any difference requires confirmation with the pharmacy or prescriber.', 'info')}`;
  }

  function renderReconcileWithHistory() {
    const comparison = compareMedicines(state.prescriptionText, state.dispensedText);
    const has = comparison.prescribed.length > 0 || comparison.dispensed.length > 0;
    const list = (items, empty) => items.length ? `<ul class="result-list">${items.map((item) => `<li>${escapeHtml(item.name)}${item.count > 1 ? ` <small>×${item.count}</small>` : ''}</li>`).join('')}</ul>` : `<p class="result-empty">${empty}</p>`;
    const sortedReconciliations = [...state.reconciliations].sort((a, b) => String(b.createdAt || b.updatedAt || '').localeCompare(String(a.createdAt || a.updatedAt || '')));
    const reconGroups = {};
    for (const record of sortedReconciliations) {
      const date = record.createdAt || record.updatedAt;
      const key = date ? new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'long' }) : 'Undated';
      if (!reconGroups[key]) reconGroups[key] = [];
      reconGroups[key].push(record);
    }
    const reconGroupMarkup = Object.entries(reconGroups).map(([month, items]) => `<div class="record-group"><h4 class="record-group-title">${escapeHtml(month)}</h4><div class="overview-record-list">${items.map((record) => `<div class="overview-record"><div><strong>${record.isExactMatch ? 'Medicine names match' : 'Difference requires review'}</strong><span>${escapeHtml(`${record.missing?.length || 0} missing · ${record.unexpected?.length || 0} unexpected`)}${record.prescriptionMedicines?.length ? ` · ${escapeHtml(record.prescriptionMedicines.join(', '))}` : ''} · ${overviewDate(record.updatedAt || record.createdAt)}</span></div><div class="form-actions">${button('Reopen', 'reopen-reconciliation', 'button button-outline button-small', `data-id="${escapeHtml(record.id)}"`)}${button('Remove', 'delete-reconciliation', 'button button-outline button-small', `data-id="${escapeHtml(record.id)}"`)}</div></div>`).join('')}</div></div>`).join('');
    const history = sortedReconciliations.length ? `<section class="card saved-reconciliations"><div class="card-heading"><div><p class="card-kicker">SAVED COMPARISONS</p><h3>Previous reconciliation checks</h3><p class="muted">Reopen or remove older comparisons.</p></div><span class="soft-icon">${svgIcon('compare')}</span></div>${reconGroupMarkup}</section>` : '';
    return `<div class="section-intro inline-intro"><div><p class="eyebrow">STEP 3 OF 3 · RECONCILIATION</p><h2 class="page-title">Compare prescribed and dispensed medicines.</h2><p>This compares the medicine name and strength written before an em dash, dot, or semicolon. It does not assess directions, formulation changes, substitutions, or clinical appropriateness.</p></div><span class="status-pill ${has && comparison.isExactMatch ? 'pill-green' : has ? 'pill-warn' : 'pill-neutral'}">${has ? (comparison.isExactMatch ? 'Medicine names match' : 'Difference requires review') : 'Enter both lists to compare'}</span></div><section class="card reconciliation-card"><div class="list-input-grid"><label class="large-label">Prescribed<textarea id="prescribed-list" rows="8" placeholder="One medicine per line">${escapeHtml(state.prescriptionText)}</textarea></label><label class="large-label">Dispensed<textarea id="dispensed-list" rows="8" placeholder="What the pharmacy provided">${escapeHtml(state.dispensedText)}</textarea></label></div><div class="reconcile-actions">${button('Compare lists', 'run-reconcile', 'button button-primary')}<span class="save-note" role="status">${escapeHtml(state.saveStatus.reconciliation || 'Not saved yet')} · Comparison checks name and strength only.</span></div></section>${has ? `<section class="result-board"><div class="result-board-head"><div><p class="card-kicker">RESULT</p><h3>${comparison.isExactMatch ? 'Medicine names match; confirm details with your care team.' : 'Please clarify this difference with the pharmacy or prescriber.'}</h3></div>${button('Review safety notes', 'go-composition', 'button button-outline')}</div><div class="result-columns"><div class="result-col good"><span class="result-label">IN BOTH LISTS</span>${list(comparison.matched, 'No matching medicine names')}</div><div class="result-col warn"><span class="result-label">PRESCRIBED, NOT IN DISPENSED LIST</span>${list(comparison.missing, 'None')}</div><div class="result-col alert"><span class="result-label">DISPENSED, NOT IN PRESCRIBED LIST</span>${list(comparison.unexpected, 'None')}</div></div></section>` : ''}${history}`;
  }

  function renderComposition() {
    const findings = analyzeMedicationSafety(state.medicines, state.profile);
    const composition = medicationCompositionSummary(state.medicines);
    const hasFindings = findings.length > 0;
    const findingMarkup = findings.map((finding) => `<li class="clinical-finding finding-${escapeHtml(finding.severity)}"><span class="finding-severity">${findingSeverityLabel(finding.severity)}</span><div><strong>${escapeHtml(finding.title)}</strong><p>${escapeHtml(finding.detail)}</p></div></li>`).join('');
    const compositionMarkup = composition.length ? composition.map((medicine) => `<li class="composition-row"><div><strong>${escapeHtml(medicine.name)}</strong><span>${escapeHtml([medicine.strength, medicine.dose].filter(Boolean).join(' · ') || 'Strength not recorded')}</span></div><span class="composition-chip">${escapeHtml(medicine.ingredient)} · ${escapeHtml(medicine.className)}</span></li>`).join('') : '<li class="result-empty">Add current medicines to see reference-list matches.</li>';
    const hasHighRisk = findings.some((finding) => finding.severity === 'high');
    const riskTitle = hasHighRisk ? 'Pause and contact a clinician promptly' : hasFindings ? 'Items to discuss with a clinician' : 'No rule-based flags found';
    const riskDetail = hasFindings
      ? `${findings.length} rule-based note${findings.length === 1 ? '' : 's'} from the recorded profile and current list.`
      : 'This is a limited check, not a safety clearance.';
    const findingsMarkup = hasFindings
      ? `<ul class="clinical-findings">${findingMarkup}</ul>`
      : '<div class="empty-state compact"><p>No rule-based flags from the recorded information. A pharmacist or clinician should still review the complete medicine, supplement, allergy, and diagnosis history.</p></div>';
    return `<div class="section-intro"><p class="eyebrow">SAFETY REVIEW</p><h2 class="page-title">Review medication information with a clinician.</h2><p>This limited, rule-based check covers only a small reference list. It is not a complete interaction checker and does not diagnose or recommend treatment.</p></div><div class="risk-grid"><section class="card risk-overview${hasFindings ? '' : ' is-clear'}"><div class="risk-score"><div class="risk-ring ${hasHighRisk ? 'risk-ring-high' : ''}"><span>${hasHighRisk ? '!' : hasFindings ? 'i' : '✓'}</span></div><div><p class="card-kicker">REVIEW STATUS</p><h3>${riskTitle}</h3><p>${riskDetail}</p></div></div>${findingsMarkup}${notice('<strong>Do not start, stop, or change a medicine without advice from a clinician or pharmacist.</strong> Bring this list to a pharmacist or clinician, especially after a hospital visit or new prescription.', 'warning')}<button class="button button-primary" data-action="nav" data-view="doctors">Prepare a question for your clinician</button></section><section class="card checklist-card"><div class="card-heading"><div><p class="card-kicker">ACTIVE INGREDIENT VIEW</p><h3>What MediHuman matched in its reference list</h3></div><span class="soft-icon">${svgIcon('info')}</span></div><ul class="composition-list">${compositionMarkup}</ul><ul class="safety-checklist"><li><span>01</span><div><strong>Confirm every label and strength</strong><p>Brand names, formulations, supplements, and handwriting can change the result.</p></div></li><li><span>02</span><div><strong>Include non-prescription products</strong><p>Tell your clinician about vitamins, herbal products, and over-the-counter medicines.</p></div></li><li><span>03</span><div><strong>Know urgent warning signs</strong><p>Trouble breathing, facial swelling, fainting, or severe rash need urgent care.</p></div></li></ul></section></div>`;
  }

  function renderDoctors() {
    return `<div class="section-intro inline-intro"><div><p class="eyebrow">CONVERSATION PREP</p><h2 class="page-title">Prepare questions for your care team.</h2><p>Keep a short list for your clinician or pharmacist. MediHuman does not send messages.</p></div><span class="soft-icon large-soft">${svgIcon('questions')}</span></div><section class="card question-card"><div class="card-heading"><div><h3>Questions for your care team</h3><p class="muted">Stored ${state.localOnly ? 'on this device' : 'in this workspace'}.</p></div></div><div class="question-list">${state.questions.map((question, index) => `<article class="question-item"><span class="question-number">${String(index + 1).padStart(2, '0')}</span><div><strong>${escapeHtml(question.title)}</strong><span>${escapeHtml(question.meta || 'Personal note')}</span></div><button class="remove-button" data-action="remove-question" data-index="${index}" aria-label="Remove question">×</button></article>`).join('')}</div><form class="add-question" data-form="question"><label class="sr-only" for="question-input">Add a question</label><input id="question-input" name="question" required placeholder="e.g. What should I do if I miss a dose?"><button class="button button-primary" type="submit">Add question</button></form></section>${notice('For emergency symptoms or a medication emergency, call your local emergency number or contact a pharmacist directly. This list is not monitored.', 'warning')}`;
  }

  function requestStatusPill(status) { const labels = { approved: 'Approved', pending: 'Pending', rejected: 'Rejected', revoked: 'Revoked' }; return `<span class="status-pill ${status === 'approved' ? 'pill-green' : status === 'pending' ? 'pill-warn' : 'pill-neutral'}">${escapeHtml(labels[status] || status)}</span>`; }
  function requestRows(requests, perspective = 'patient') {
    if (!requests.length) return `<div class="empty-state compact"><span class="empty-icon">${svgIcon('care-team')}</span><p>No access requests yet.</p></div>`;
    return `<div class="access-request-list">${requests.map((request) => {
      const doctorView = perspective === 'doctor';
      const patientName = doctorView ? (request.patientName || '') : '';
      const label = doctorView ? (patientName || request.patientId || 'Patient') : (request.doctor?.displayName || 'Doctor');
      const openable = doctorView && request.status === 'approved' && Boolean(request.patientId);
      const title = openable
        ? `<button type="button" class="access-request-link" data-action="doctor-select-patient" data-patient-id="${escapeHtml(request.patientId)}" data-view="doctor-patients">${escapeHtml(label)}</button>`
        : `<strong>${escapeHtml(label)}</strong>`;
      const detail = doctorView
        ? `${patientName ? `${request.patientId} · ` : ''}${request.requestedAt ? new Date(request.requestedAt).toLocaleDateString() : 'Local request'}`
        : (request.requestedAt ? new Date(request.requestedAt).toLocaleDateString() : 'Local request');
      return `<article class="access-request ${openable ? 'is-openable' : ''}"><div class="access-request-identity">${openable ? `<span class="access-request-avatar" aria-hidden="true">${escapeHtml(nameInitials(patientName))}</span>` : ''}<div>${title}<span>${detail}</span></div></div><div class="access-request-actions">${requestStatusPill(request.status)}${perspective === 'doctor' && request.status === 'pending' ? button('Cancel', 'cancel-request', 'button button-outline button-small', `data-id="${escapeHtml(request.id)}"`) : ''}${perspective === 'patient' && request.status === 'pending' ? `${button('Approve', 'care-request', 'button button-primary button-small', `data-id="${escapeHtml(request.id)}" data-status="approved"`)}${button('Reject', 'care-request', 'button button-outline button-small', `data-id="${escapeHtml(request.id)}" data-status="rejected"`)}` : ''}${perspective === 'patient' && request.status === 'approved' ? button('Revoke', 'care-request', 'button button-outline button-small', `data-id="${escapeHtml(request.id)}" data-status="revoked"`) : ''}</div></article>`;
    }).join('')}</div>`;
  }

  function renderCareTeam() {
    return `<div class="section-intro inline-intro"><div><p class="eyebrow">SHARED ACCESS</p><h2 class="page-title">Choose who can access your records.</h2><p>Requests stay pending until you decide. Approved access can be revoked anytime.</p></div><span class="soft-icon large-soft">${svgIcon('care-team')}</span></div><section class="card care-team-card"><div class="card-heading"><div><h3>Clinician access requests</h3><p class="muted">Your private patient ID is shared instead of your name.</p></div>${requestStatusPill(`${state.patientRequests.filter((request) => request.status === 'pending').length} pending`)}</div>${requestRows(state.patientRequests)}</section>${notice('<strong>Control stays with you.</strong> Approving access lets this clinician view your profile, medicines, prescriptions, and reconciliation records. This app does not send messages.', 'info')}`;
  }


  function ruleSummary(records) {
    const medicines = records?.medicines || [];
    const findings = analyzeMedicationSafety(medicines, records?.profile || {}).map((finding) => ({ ...finding, source: 'Local rule set' }));
    const mismatches = (records?.reconciliations || []).filter((item) => item.isExactMatch === false);
    if (mismatches.length) findings.push({ severity: 'medium', title: 'Reconciliation needs follow-up', detail: `${mismatches.length} saved comparison${mismatches.length === 1 ? '' : 's'} contains a missing or unexpected medicine name.`, source: 'Reconciliation rule' });
    return { headline: findings.some((finding) => finding.severity === 'high') ? 'Pause and review promptly' : findings.length ? 'Items to discuss with a clinician' : 'No rule-based flags recorded', findings };
  }

  function renderRuleSummary(records) {
    const summary = records?.summary || ruleSummary(records);
    const findings = summary.findings || [];
    const aiAssisted = summary.isAiGenerated === true;
    const normalizedFindings = findings.map((finding) => ({ severity: finding.severity === 'review' ? 'medium' : finding.severity || 'info', title: finding.title || `${finding.type || 'Record'} finding`, detail: finding.detail || finding.message || 'Recorded information is available for review.', source: finding.source || 'Rule-based record summary' }));
    return `<section class="card doctor-summary"><div class="card-heading"><div><p class="card-kicker">${aiAssisted ? 'AI-ASSISTED DRAFT' : 'STRUCTURED REVIEW'}</p><h3>${escapeHtml(summary.headline || (aiAssisted ? 'AI-assisted record draft' : 'Rule-based review'))}</h3><p class="muted">${escapeHtml(summary.disclaimer || 'Rule-based, non-AI information organization. Not diagnostic and not a treatment recommendation.')}</p></div><span class="soft-icon">${svgIcon('info')}</span></div>${normalizedFindings.length ? `<ul class="clinical-findings">${normalizedFindings.map((finding) => `<li class="clinical-finding finding-${escapeHtml(finding.severity)}"><span class="finding-severity">${findingSeverityLabel(finding.severity)}</span><div><strong>${escapeHtml(finding.title)}</strong><p>${escapeHtml(finding.detail)}</p><small>${escapeHtml(finding.source)}</small></div></li>`).join('')}</ul>` : `<div class="empty-state compact"><p>No ${aiAssisted ? 'AI-assisted' : 'rule-based'} findings from available records.</p></div>`}${notice(aiAssisted ? 'AI output is an assistive draft. Verify every finding against source records and clinical judgment.' : 'This summary organizes recorded information for a care conversation. It does not diagnose, prescribe, or replace clinical judgment.', 'warning')}</section>`;
  }

  function renderDoctorDashboardLegacy(verified) {
    const pending = state.doctorRequests.filter((request) => request.status === 'pending');
    const approved = state.doctorRequests.filter((request) => request.status === 'approved');
    const doctor = state.doctorProfile || {};
    const verifiedNotice = verified ? `<strong>Clinician account verified.</strong> Your organisation has approved this workspace.` : `<strong>Clinician account pending verification.</strong> ${escapeHtml(doctor.organization || 'Registration details are awaiting verification by your organisation.')}`;
    const requestButton = verified ? `<button class="button button-primary" type="submit" ${state.requesting ? 'disabled' : ''}>${state.requesting ? 'Requesting…' : 'Request access'}</button>` : '<button class="button button-primary" type="button" disabled aria-disabled="true">Verification required</button>';
    const footnote = verified ? 'The patient must approve before any health information is shown.' : 'Your organisation must verify this clinician account before access requests can be submitted.';
    return `<div class="dashboard-hero-layout workspace-hero" data-dashboard-layout="doctor" data-surface="dashboard-hero" aria-labelledby="doctor-dashboard-hero-heading"><div class="workspace-hero-copy feature-copy"><span class="card-kicker">DOCTOR WORKSPACE</span><h2 id="doctor-dashboard-hero-heading" class="dashboard-hero-heading">Coordinate care with patient-controlled access.</h2><p>Request records by opaque patient ID, then review approved information in one place.</p>${button('Open approved patient records', 'nav', 'button button-light', 'data-view="doctor-patients"')}</div><div class="workspace-hero-panel"><div class="scan-illustration"><span>${svgIcon('care-team')}</span><i></i><i></i><i></i></div>${renderAppointmentSummary({ title: 'Access overview', detail: 'Review request status and patient-approved records from this workspace.', metrics: [[pending.length, 'requests pending'], [approved.length, 'patients approved'], [state.doctorRequests.length, 'requests recorded']] })}</div></div>${notice(verifiedNotice, verified ? 'info' : 'warning')}<div class="doctor-dashboard-grid"><section class="card"><div class="card-heading"><div><h3>Request access to a patient record</h3><p class="muted">Enter the patient’s private ID to request access.</p></div><span class="soft-icon">${svgIcon('add')}</span></div><form class="stack-form" data-form="doctor-request"><label>Opaque patient ID<input name="patientId" required maxlength="200" placeholder="Paste patient ID"></label>${requestButton}<p class="form-footnote">${escapeHtml(footnote)}</p></form></section><section class="card"><div class="card-heading"><div><h3>Pending requests</h3><p class="muted">${pending.length} awaiting patient decision</p></div>${requestStatusPill(String(pending.length))}</div>${requestRows(pending, 'doctor')}</section></div><section class="card approved-patients-card"><div class="card-heading"><div><h3>Patients with approved access</h3><p class="muted">${approved.length} patient${approved.length === 1 ? '' : 's'} available to review</p></div><button class="text-link" data-action="nav" data-view="doctor-patients">Open patient records →</button></div>${approved.length ? requestRows(approved, 'doctor') : '<div class="empty-state compact"><p>Patients with approved access appear here after consent.</p></div>'}</section>`;
  }

  function renderDoctorDashboard() {
    const verified = state.localOnly || state.doctorProfile?.verified === true;
    return renderDoctorDashboardLegacy(verified);
  }

  function renderDoctorPatientsLegacy() {
    const approved = state.doctorRequests.filter((request) => request.status === 'approved');
    const query = (state.patientSearch || '').toLowerCase();
    const filtered = approved.filter((request) => {
      const record = state.doctorRecords[request.patientId];
      const name = (request.patientName || record?.profile?.fullName || '').toLowerCase();
      const id = request.patientId.toLowerCase();
      return !query || name.includes(query) || id.includes(query);
    });
    const selected = state.selectedPatientId ? approved.find((request) => request.patientId === state.selectedPatientId) : null;
    const records = selected ? state.doctorRecords[selected.patientId] : null;
    const pickerOpen = Boolean(state.doctorPatientMenuOpen);
    const displayId = (patientId) => patientId.length > 34 ? `${patientId.slice(0, 16)}…${patientId.slice(-12)}` : patientId;
    const patientOptions = filtered.map((request) => {
      const isSelected = request.patientId === selected?.patientId;
      const name = request.patientName || state.doctorRecords[request.patientId]?.profile?.fullName || '';
      const optionLabel = `${name ? `${name}, ` : ''}${displayId(request.patientId)}`;
      return `<button type="button" class="patient-picker-option${isSelected ? ' is-selected' : ''}" role="option" aria-selected="${isSelected}" aria-label="${escapeHtml(optionLabel)}" data-action="doctor-select-patient" data-patient-id="${escapeHtml(request.patientId)}">${name ? `<span class="patient-picker-name">${escapeHtml(name)}</span> ` : ''}<span class="patient-picker-code" title="${escapeHtml(request.patientId)}">${escapeHtml(displayId(request.patientId))}</span>${isSelected ? `<span class="patient-picker-check">${svgIcon('check')}</span>` : ''}</button>`;
    }).join('');
    const selectedName = selected ? (selected.patientName || state.doctorRecords[selected.patientId]?.profile?.fullName || '') : '';
    const triggerLabel = selected ? `Approved patient: ${selectedName ? `${selectedName}, ` : ''}${displayId(selected.patientId)}` : 'Select an approved patient';
    const picker = approved.length ? `<div class="patient-picker"><span class="patient-picker-label" id="doctor-patient-label">Approved patient</span><button type="button" class="patient-picker-trigger" data-action="toggle-doctor-patient-menu" aria-label="${escapeHtml(triggerLabel)}" aria-haspopup="listbox" aria-expanded="${pickerOpen}" aria-controls="doctor-patient-list">${selectedName ? `<span class="patient-picker-name">${escapeHtml(selectedName)}</span> ` : ''}${selected ? `<span class="patient-picker-value" title="${escapeHtml(selected.patientId)}">${escapeHtml(displayId(selected.patientId))}</span>` : ''}<span class="patient-picker-chevron">${svgIcon('chevron-down')}</span></button>${pickerOpen ? `<div class="patient-picker-menu" id="doctor-patient-list" role="listbox" aria-labelledby="doctor-patient-label">${patientOptions || '<p class="patient-picker-empty">No patients match your search.</p>'}</div>` : ''}</div>` : '';
    const selector = `<section class="card patient-selector"><div class="card-heading"><div><p class="card-kicker">APPROVED ACCESS</p><h3>Patients with approved access</h3><p class="muted">Select a patient to open their approved record.</p></div></div><div class="patient-selector-controls"><label class="filter-label"><span class="sr-only">Search patients</span><input id="patient-search" value="${escapeHtml(state.patientSearch || '')}" placeholder="Search by name or patient ID"></label>${picker}</div></section>`;
    return `<div class="section-intro"><p class="eyebrow">APPROVED RECORDS</p><h2 class="page-title">Patient records</h2><p>Only records approved by the patient are shown. Confirm each section with the patient before using it in clinical care.</p></div>${approved.length ? `${selector}${records ? renderDoctorRecord(records, selected.patientId) : `<section class="card empty-state"><p>Select a patient to load their approved record.</p></section>`}` : `<section class="card empty-state"><span class="empty-icon">${svgIcon('care-team')}</span><h3>No approved patients</h3><p>Send an access request from your dashboard. Patient approval is required before records can be viewed.</p>${button('Back to dashboard', 'nav', 'button button-primary', 'data-view="dashboard"')}</section>`}`;
  }

  function renderDoctorPatients() {
    if (!state.localOnly && state.doctorProfile?.verified !== true) {
      return `<div class="section-intro"><p class="eyebrow">APPROVED RECORDS</p><h2 class="page-title">Clinician verification required.</h2><p>Patient records are unavailable until your organisation verifies this clinician account.</p></div>${notice('<strong>Access blocked.</strong> Verification protects patient records and must be completed before viewing approved data.', 'warning')}`;
    }
    return renderDoctorPatientsLegacy();
  }

  function renderBaseDoctorRecord(records, patientId) {
    const profile = records.profile || {};
    const medicines = records.medicines || [];
    const prescriptions = records.prescriptions || [];
    const reconciliations = records.reconciliations || [];
    const medicalRecords = records.medicalRecords || [];
    return `<section class="doctor-record-stack"><div class="doctor-record-header"><div><p class="card-kicker">PATIENT ${escapeHtml(patientId)}</p><h3>${escapeHtml(profile.fullName || 'Patient record')}</h3><p class="muted">Patient-approved record view · confirm details with the patient.</p></div>${requestStatusPill('approved')}</div><div class="doctor-record-grid"><section class="card"><div class="card-heading"><h3>Profile</h3><span class="soft-icon">${svgIcon('profile')}</span></div><dl class="record-list"><div><dt>Date of birth</dt><dd>${escapeHtml(profile.dateOfBirth || 'Not recorded')}</dd></div><div><dt>Allergies</dt><dd>${escapeHtml(profile.allergies || 'Not recorded')}</dd></div><div><dt>Conditions</dt><dd>${escapeHtml(profile.conditions || 'Not recorded')}</dd></div></dl></section><section class="card"><div class="card-heading"><h3>Medicines</h3><span class="soft-icon">${svgIcon('medicines')}</span></div>${medicines.length ? `<ul class="record-items">${medicines.map((medicine) => `<li class="medicine-record-item ${medicine.status && medicine.status !== 'active' ? 'is-inactive' : ''}"><strong>${escapeHtml(medicine.name)}</strong><span>${escapeHtml([medicine.strength, medicine.dose, medicine.timing].filter(Boolean).join(' · ') || 'Details not recorded')}${medicine.status && medicine.status !== 'active' ? ` · <em>${escapeHtml(medicine.status)}</em>` : ''}${medicine.startedAt ? ` · started ${escapeHtml(medicine.startedAt)}` : ''}${medicine.stoppedAt ? ` · stopped ${escapeHtml(medicine.stoppedAt)}` : ''}</span></li>`).join('')}</ul>` : '<p class="result-empty">No current medicines recorded.</p>'}</section><section class="card"><div class="card-heading"><h3>Prescriptions</h3><span class="soft-icon">${svgIcon('edit')}</span></div>${prescriptions.length ? `<ul class="record-items">${prescriptions.map((prescription) => {
      const meds = Array.isArray(prescription.medicines) ? prescription.medicines : [];
      const names = meds.map((m) => m.medicationName || m.name || 'Medicine').join(', ');
      const tests = Array.isArray(prescription.tests) ? prescription.tests : [];
      return `<li><strong>${escapeHtml(prescription.condition || names || 'Prescription')}</strong><span>${escapeHtml([prescription.doctor, prescription.date].filter(Boolean).join(' · ') || 'Details not recorded')}${meds.length ? ` · ${meds.length} medicine${meds.length === 1 ? '' : 's'}` : ''}${tests.length ? ` · ${tests.length} test${tests.length === 1 ? '' : 's'}` : ''}${prescription.createdAt ? ` · ${escapeHtml(new Date(prescription.createdAt).toLocaleDateString())}` : ''}</span></li>`;
    }).join('')}</ul>` : '<p class="result-empty">No prescriptions recorded.</p>'}</section><section class="card"><div class="card-heading"><h3>Reconciliation</h3><span class="soft-icon">${svgIcon('compare')}</span></div>${reconciliations.length ? `<ul class="record-items">${reconciliations.map((item) => `<li><strong>${item.isExactMatch ? 'Medicine names matched' : 'Difference requires review'}</strong><span>${escapeHtml(new Date(item.createdAt || Date.now()).toLocaleDateString())} · ${escapeHtml(item.notes || 'No notes')}</span></li>`).join('')}</ul>` : '<p class="result-empty">No medicine reconciliation recorded.</p>'}</section>${medicalRecords.length ? `<section class="card"><div class="card-heading"><h3>Medical records</h3><span class="soft-icon">${svgIcon('document')}</span></div><label class="filter-label"><span class="sr-only">Filter by type</span><select id="record-type-filter"><option value="">All types</option>${[...new Set(medicalRecords.map((r) => r.type))].map((t) => `<option value="${escapeHtml(t)}" ${state.recordTypeFilter === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select></label><ul class="record-items">${medicalRecords.filter((r) => !state.recordTypeFilter || r.type === state.recordTypeFilter).map((record) => `<li><strong>${escapeHtml(record.title || record.type)}</strong><span>${escapeHtml(record.type)} · ${escapeHtml(record.date || (record.createdAt ? new Date(record.createdAt).toLocaleDateString() : ''))}${record.description ? ` · ${escapeHtml(record.description.slice(0, 60))}` : ''}</span></li>`).join('')}</ul></section>` : ''}</div>${renderRuleSummary(records)}</section>`;
  }

  function renderLifestyle() {
    const notes = lifestyleGuidance;
    return `<div class="section-intro"><p class="eyebrow">DAILY SUPPORT</p><h2 class="page-title">Medication routines and general reminders</h2><p>General reminders can support a routine. Follow your own care team’s instructions first.</p></div><div class="lifestyle-grid">${notes.map((note, index) => `<article class="card lifestyle-tile"><span class="lifestyle-number">0${index + 1}</span><h3>${escapeHtml(note.split('. ')[0])}</h3><p>${escapeHtml(note.includes('. ') ? note.slice(note.indexOf('. ') + 2) : '')}</p></article>`).join('')}</div>${notice('<strong>Seek help for new or worsening symptoms.</strong> New or worsening symptoms deserve a conversation with a clinician. Seek urgent help for trouble breathing, facial swelling, fainting, or severe rash.', 'warning')}`;
  }

  function renderIndicationEditor(patientId) {
    const indications = state.doctorRecords[patientId]?.indications || [];
    const editing = indications.find((item) => item.id === state.editingIndicationId);
    const form = editing ? `<form class="stack-form" data-form="indication-edit" data-patient-id="${escapeHtml(patientId)}" data-id="${escapeHtml(editing.id)}"><label>Title<input name="title" value="${escapeHtml(editing.title || '')}" required maxlength="200"></label><label>Details<textarea name="detail" required maxlength="1200" rows="4">${escapeHtml(editing.detail || '')}</textarea></label><label>Priority<select name="severity"><option value="info" ${editing.severity === 'info' ? 'selected' : ''}>Information</option><option value="review" ${editing.severity === 'review' ? 'selected' : ''}>Review</option><option value="high" ${editing.severity === 'high' ? 'selected' : ''}>High priority</option></select></label><div class="form-actions"><button class="button button-primary" type="submit">Save indication</button>${button('Cancel', 'cancel-indication-edit', 'button button-secondary')}</div></form>` : `<form class="stack-form" data-form="doctor-indication" data-patient-id="${escapeHtml(patientId)}"><label>Title<input name="title" required maxlength="200" placeholder="e.g. Confirm medicine timing with pharmacist"></label><label>Details<textarea name="detail" required maxlength="1200" rows="4" placeholder="Describe what the patient should review."></textarea></label><label>Priority<select name="severity"><option value="info">Information</option><option value="review">Review</option><option value="high">High priority</option></select></label><button class="button button-primary" type="submit">Add indication</button></form>`;
    const history = indications.length ? `<div class="overview-record-list">${indications.map((item) => `<div class="overview-record"><div><strong>${escapeHtml(item.title || 'Clinician indication')}</strong><span>${escapeHtml(item.detail || 'Review with your care team.')}</span></div><div class="form-actions">${button('Edit', 'edit-indication', 'button button-outline button-small', `data-id="${escapeHtml(item.id)}"`)}${button('Remove', 'delete-indication', 'button button-outline button-small', `data-id="${escapeHtml(item.id)}" data-patient-id="${escapeHtml(patientId)}"`)}</div></div>`).join('')}</div>` : '';
    return `<section class="card indication-editor"><div class="card-heading"><div><p class="card-kicker">CLINICIAN NOTE</p><h3>${editing ? 'Edit indication' : 'Add an indication'}</h3><p class="muted">Notes are visible to this patient and this clinician only after approved access.</p></div><span class="soft-icon">${svgIcon('info')}</span></div>${form}${history}</section>`;
  }

  function renderDoctorRecord(records, patientId) {
    return `${renderBaseDoctorRecord(records, patientId)}${renderIndicationEditor(patientId)}`;
  }

  function renderMfaSettings() {
    if (state.localOnly) return '';
    if (state.mfaEnrollment) {
      const uri = state.mfaEnrollment.totp?.uri || '';
      return `<section class="card consent-card"><p class="card-kicker">MULTI-FACTOR AUTHENTICATION</p><h3>Finish authenticator setup</h3><p>Scan this URI with your authenticator app, then enter the current six-digit code.</p><code class="mfa-uri">${escapeHtml(uri)}</code><form class="stack-form" data-form="mfa-enrollment"><label>Authenticator code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required></label><button class="button button-primary" type="submit">Verify authenticator</button></form></section>`;
    }
    const factors = (state.mfaFactors || []).filter((factor) => factor.status === 'verified');
    return `<section class="card consent-card"><p class="card-kicker">MULTI-FACTOR AUTHENTICATION</p><h3>${factors.length ? 'Authenticator enabled' : 'Protect sign-in'}</h3><p>${factors.length ? 'Your account requires an authenticator code after password sign-in.' : 'Add an authenticator app for an additional sign-in check.'}</p>${factors.length ? factors.map((factor) => `<div class="form-actions"><span class="save-note" role="status">${escapeHtml(factor.friendly_name || 'Authenticator')}</span><button class="button button-outline" data-action="mfa-remove" data-id="${escapeHtml(factor.id)}">Remove</button></div>`).join('') : button('Set up authenticator', 'mfa-enroll', 'button button-primary')}</section>`;
  }

  function renderPrivacy() {
     return `<div class="section-intro"><p class="eyebrow">YOUR CONTROL</p><h2 class="page-title">Privacy that is easy to understand.</h2><p>Choose where your workspace lives and clear it when you are done.</p></div><div class="privacy-grid"><section class="card privacy-card"><div class="privacy-hero"><span class="privacy-lock">${svgIcon('lock')}</span><div><p class="card-kicker">CURRENT STORAGE</p><h3>${state.localOnly ? 'Local workspace' : 'Your MediHuman account'}</h3></div></div><p>${state.localOnly ? 'Profile, medicine lists, questions, and local care requests remain on this device. Remote account data is never copied into this storage.' : 'Your information is stored in your MediHuman account while you are signed in. Camera images are processed in your browser and are not uploaded by this screen.'}</p>${notice('Only enter information needed for your care conversation. Check shared devices before storing sensitive information.', 'info')}<div class="privacy-actions">${button('Clear data stored in this browser', 'clear-data', 'button button-outline')}${button('Manage care team access', 'nav', 'button button-outline', 'data-view="care-team"')}${!state.localOnly ? button('Download account data', 'export-account', 'button button-outline') : ''}${!state.localOnly ? button('Delete account', 'delete-account', 'button button-outline') : ''}</div></section><section class="card consent-card"><p class="card-kicker">CONSENT CHECKPOINT</p><h3>Before you use this information</h3><label class="consent-toggle"><input id="consent-toggle" type="checkbox" ${state.consent ? 'checked' : ''}><span class="toggle-ui"></span><span>I understand that this app organises information. It does not confirm safety, diagnose, prescribe, validate handwriting, or replace a pharmacist or clinician.</span></label><p class="muted">${state.consent ? 'Acknowledgment saved for this browser.' : 'Select this acknowledgment before saving a local review.'}</p><button class="button button-primary" data-action="save-consent">Save preference</button></section>${renderMfaSettings()}</div>`;
  }
  return { renderAuth, renderShell, renderView };
}
