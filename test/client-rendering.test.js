import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createState } from '../src/client/state.js';
import { brandIcon, googleIcon, svgIcon } from '../src/client/ui.js';
import { createViewRenderer } from '../src/client/views.js';
import { api, ApiError, googleAuthErrorMessage } from '../src/api-client.js';
import { createController } from '../src/client/controller.js';

// Templates use explicit closing tags. Reject malformed output before a browser
// can silently repair it and move the footer outside its flex-column shell.
function inspectMarkup(markup) {
  const root = { tag: '#fragment', children: [] };
  const stack = [root];
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const tags = /<\/?([a-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  for (const match of markup.matchAll(tags)) {
    const tag = match[1].toLowerCase();
    if (match[0].startsWith('</')) {
      assert.equal(stack.at(-1).tag, tag, `Unexpected ${match[0]} at offset ${match.index}`);
      stack.pop();
      continue;
    }
    const node = { tag, markup: match[0], parent: stack.at(-1), children: [] };
    node.parent.children.push(node);
    if (!voidTags.has(tag) && !match[0].endsWith('/>')) stack.push(node);
  }
  assert.equal(stack.length, 1, `Unclosed ${stack.at(-1).tag}`);
  return root;
}

function findClass(node, className) {
  const classes = node.markup?.match(/\bclass="([^"]*)"/)?.[1].split(/\s+/) || [];
  if (classes.includes(className)) return node;
  for (const child of node.children) {
    const found = findClass(child, className);
    if (found) return found;
  }
}

function populatedState() {
  const state = createState();
  state.profile = { fullName: 'Synthetic <patient>', patientId: 'fixture-patient-id', dateOfBirth: '1980-01-01', allergies: 'penicillin', conditions: 'kidney disease' };
  state.medicines = [{ id: 'fixture-med', name: 'Ibuprofen', strength: '200 mg', dose: '', timing: 'As labelled' }];
  state.prescriptionText = 'Ibuprofen\nParacetamol';
  state.dispensedText = 'Ibuprofen\nAspirin';
  state.questions = [{ title: 'Synthetic <question> & reminder', meta: 'Test fixture' }];
  const requests = ['pending', 'approved', 'rejected', 'revoked'].map((status) => ({
    id: `fixture-${status}`, patientId: `fixture-patient-${status}`, status,
    doctor: { displayName: 'Synthetic <clinician>' }, requestedAt: '2026-01-01T12:00:00Z',
  }));
  state.patientRequests = requests;
  state.doctorRequests = requests;
  state.doctorRecords['fixture-patient-approved'] = {
    profile: state.profile, medicines: state.medicines,
    prescriptions: [{ medicationName: 'Ibuprofen', strength: '200 mg', frequency: 'As labelled', instructions: 'Synthetic fixture' }],
    reconciliations: [{ isExactMatch: false, createdAt: '2026-01-01T12:00:00Z', prescribedText: state.prescriptionText, dispensedText: state.dispensedText }],
  };
  return state;
}

test('client UI primitives render accessible SVG markup', () => {
  assert.match(svgIcon('home'), /<svg /);
  assert.match(svgIcon('home'), /aria-hidden="true"/);
  assert.doesNotMatch(svgIcon('home'), /ui-[a-z-]+/);
  assert.match(brandIcon(), /class="brand-svg"/);
  assert.match(brandIcon(), /stroke="#9fdcd0"/);
  assert.doesNotMatch(brandIcon(), /M16 8v16M8 16h16/);
  assert.match(googleIcon(), /class="auth-google-icon"/);
  assert.match(googleIcon(), /fill="#4285F4"/);
});

test('patient shell renders stable navigation and event hooks', () => {
  const state = createState();
  state.screen = 'shell';
  state.localOnly = true;
  const views = createViewRenderer({ state });
  const markup = views.renderShell();

  assert.match(markup, /class="app-shell"/);
  assert.match(markup, /<header class="sidebar workspace-header workspace-nav" id="sidebar">/);
  assert.match(markup, /<nav class="main-nav primary-nav section-nav" aria-label="Main navigation">/);
  assert.doesNotMatch(markup, /workspace-context|workspace-card/);
  assert.match(markup, /data-action="privacy"/);
  assert.match(markup, /data-action="toggle-profile-menu"/);
  assert.match(markup, /class="mobile-sidebar-logout nav-item" data-action="logout"/);
  assert.match(markup, /data-action="nav" data-view="care-team"/);
  assert.match(markup, /data-action="nav" data-view="medicines"/);
  assert.match(markup, /data-action="go-scan"/);
  assert.match(markup, /class="app-footer"/);
  assert.doesNotMatch(markup, /<span class="nav-icon">home<\/span>/);
  assert.doesNotMatch(markup, /<aside class="sidebar"/);
});

test('dashboard surfaces expose patient and doctor workspace hooks', () => {
  const patientState = { ...createState(), screen: 'shell', localOnly: true, view: 'dashboard' };
  const patientMarkup = createViewRenderer({ state: patientState }).renderShell();
  assert.match(patientMarkup, /class="dashboard-hero-layout workspace-hero" data-dashboard-layout="patient"/);
  assert.match(patientMarkup, /id="patient-dashboard-hero-heading"/);
  assert.match(patientMarkup, /id="patient-dashboard-hero-cta"/);
  assert.match(patientMarkup, /class="[^"]*dashboard-appointment-summary[^"]*floating-summary[^"]*"/);
  assert.match(patientMarkup, /class="metric-chips"/);
  assert.match(patientMarkup, /<div class="today-orb" aria-hidden="true"><\/div>/);
  assert.doesNotMatch(patientMarkup, /class="today-orb"[^>]*>\s*<svg/);

  const doctorState = { ...createState(), screen: 'shell', role: 'doctor', localOnly: true, view: 'dashboard' };
  const doctorMarkup = createViewRenderer({ state: doctorState }).renderShell();
  assert.match(doctorMarkup, /class="dashboard-hero-layout workspace-hero" data-dashboard-layout="doctor"/);
  assert.match(doctorMarkup, /data-surface="dashboard-hero"/);
  assert.match(doctorMarkup, /class="[^"]*dashboard-appointment-summary[^"]*floating-summary[^"]*"/);
  assert.match(doctorMarkup, /class="metric-chips"/);
});

test('doctor shell keeps doctor-only navigation and access controls', () => {
  const state = createState();
  state.screen = 'shell';
  state.role = 'doctor';
  state.localOnly = true;
  const views = createViewRenderer({ state });
  const markup = views.renderShell();

  assert.match(markup, /Doctor dashboard/);
  assert.match(markup, /data-view="doctor-patients"/);
  assert.match(markup, /Request access to a patient record/);
  assert.doesNotMatch(markup, /data-view="medicines"/);
});

test('dashboards expose Oriel workspace hero and floating summary surfaces', () => {
  for (const role of ['patient', 'doctor']) {
    const state = { ...createState(), role, screen: 'shell', view: 'dashboard', localOnly: true };
    const markup = createViewRenderer({ state }).renderShell();
    assert.match(markup, /class="sidebar workspace-header workspace-nav"/);
    assert.match(markup, /class="dashboard-hero-layout workspace-hero"/);
    assert.match(markup, /data-surface="dashboard-hero"/);
    assert.match(markup, /class="card dashboard-appointment-summary workspace-float-card floating-summary"/);
    assert.match(markup, /data-surface="metric-chips"/);
    assert.match(markup, new RegExp(`${role === 'patient' ? 'patient' : 'doctor'}-dashboard-hero-heading`));
    inspectMarkup(markup);
  }
});

test('card heading surfaces keep copy and icon alignment hooks', () => {
  const state = { ...createState(), screen: 'shell', localOnly: true, view: 'patient' };
  const markup = createViewRenderer({ state }).renderShell();
  const supportMarkup = createViewRenderer({ state: { ...state, view: 'care-team' } }).renderShell();

  assert.match(markup, /class="card-heading"[\s\S]*class="soft-icon"/);
  assert.match(supportMarkup, /class="[^"]*inline-intro[^"]*"/);
  assert.match(supportMarkup, /class="soft-icon large-soft"/);
});

test('patient dashboard overview exposes complete record categories and indicators', () => {
  const state = { ...populatedState(), screen: 'shell', view: 'dashboard', localOnly: true };
  state.prescriptions = [{ medicationName: 'Ibuprofen', instructions: 'Take with food', createdAt: '2026-01-02T12:00:00Z' }];
  state.reconciliations = [{ isExactMatch: false, missing: [{ name: 'Paracetamol' }], unexpected: [{ name: 'Aspirin' }], createdAt: '2026-01-03T12:00:00Z' }];
  const markup = createViewRenderer({ state }).renderShell();

  assert.match(markup, /data-surface="profile-overview"/);
  assert.match(markup, /PROFILE COMPLETENESS/);
  assert.match(markup, /RECORDS BY CATEGORY/);
  assert.match(markup, /RECORDED INDICATORS/);
  assert.match(markup, /Ibuprofen/);
  assert.match(markup, /Questions/);
  assert.match(markup, /Care access/);
  assert.match(markup, /not a diagnosis/);
});

test('privacy section contains care team access after navbar removal', () => {
  const state = { ...createState(), screen: 'shell', view: 'privacy', localOnly: true };
  const markup = createViewRenderer({ state }).renderShell();

  assert.match(markup, /Manage care team access/);
  assert.match(markup, /data-action="nav"[^>]*data-view="care-team"/);
});

test('notification panel and doctor indication form expose stable hooks', () => {
  const patientState = { ...createState(), screen: 'shell', localOnly: false, notificationsOpen: true, notifications: [{ id: 'notification-1', title: 'Patient profile updated', message: 'A patient profile record was added or updated.', createdAt: '2026-01-01T12:00:00Z', readAt: null }] };
  const patientMarkup = createViewRenderer({ state: patientState }).renderShell();
  assert.match(patientMarkup, /data-action="toggle-notifications"/);
  assert.match(patientMarkup, /data-action="mark-notification-read"/);
  assert.match(patientMarkup, /Patient profile updated/);

  const doctorState = { ...populatedState(), role: 'doctor', screen: 'shell', view: 'doctor-patients', localOnly: true };
  doctorState.selectedPatientId = 'fixture-patient-approved';
  const doctorMarkup = createViewRenderer({ state: doctorState }).renderShell();
  assert.match(doctorMarkup, /data-form="doctor-indication"/);
  assert.match(doctorMarkup, /Add an indication/);
});

test('patient navigation nests Profile and Support under Patient', () => {
  const state = { ...createState(), screen: 'shell', localOnly: true, patientMenuOpen: true };
  const markup = createViewRenderer({ state }).renderShell();

  assert.match(markup, /data-action="toggle-patient-menu"/);
  assert.match(markup, /data-view="patient" data-submenu="patient"/);
  assert.match(markup, /data-view="lifestyle" data-submenu="patient"/);
  assert.match(markup, />Profile<\/span>/);
  assert.match(markup, />Support<\/span>/);
  assert.match(markup, /class="nav-chevron"><svg/);
  assert.doesNotMatch(markup, /class="nav-chevron">⌄/);
  assert.doesNotMatch(markup, />Daily support<\/span>/);
});

test('patient submenu exposes overlay dropdown hook', () => {
  const state = { ...createState(), screen: 'shell', localOnly: true, patientMenuOpen: true };
  const markup = createViewRenderer({ state }).renderShell();

  assert.match(markup, /class="nav-group open"[\s\S]*class="nav-submenu"/);
  assert.match(markup, /class="nav-subitem/);
});

test('patient submenu toggle preserves mobile drawer-open intent', async () => {
  const state = { ...createState(), screen: 'shell', localOnly: true, mobileMenuOpen: true };
  const views = createViewRenderer({ state });
  const listeners = {};
  const root = { innerHTML: '', addEventListener(type, handler) { listeners[type] = handler; } };
  const previousDocument = globalThis.document;
  globalThis.document = { querySelector() { return null; } };
  try {
    const controller = createController({ root, state, views, ocr: {} });
    void controller;
    await listeners.click({ target: { closest() { return { dataset: { action: 'toggle-patient-menu' } }; } } });
    assert.equal(state.patientMenuOpen, true);
    assert.equal(state.mobileMenuOpen, true);
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

test('mobile drawer closes from hamburger and patient submenu collapses after selection', async () => {
  const state = { ...createState(), screen: 'shell', localOnly: true, mobileMenuOpen: true, patientMenuOpen: true };
  const views = createViewRenderer({ state });
  const listeners = {};
  const root = { innerHTML: '', addEventListener(type, handler) { listeners[type] = handler; } };
  const previousDocument = globalThis.document;
  globalThis.document = { querySelector() { return null; } };
  try {
    const controller = createController({ root, state, views, ocr: {} });
    void controller;

    await listeners.click({ target: { closest() { return { dataset: { action: 'toggle-menu' } }; } } });
    assert.equal(state.mobileMenuOpen, false);
    assert.doesNotMatch(root.innerHTML, /class="mobile-nav-scrim"/);
    assert.doesNotMatch(root.innerHTML, /class="sidebar[^" ]* open/);

    state.mobileMenuOpen = true;
    state.patientMenuOpen = true;
    await listeners.click({ target: { closest() { return { dataset: { action: 'nav', view: 'patient', submenu: 'patient' } }; } } });
    assert.equal(state.patientMenuOpen, false);
    assert.equal(state.mobileMenuOpen, false);
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

test('shell exposes mobile navigation trigger and complete drawer hooks', () => {
  const state = { ...createState(), screen: 'shell', localOnly: true, patientMenuOpen: true };
  const markup = createViewRenderer({ state }).renderShell();

  assert.match(markup, /class="mobile-nav-trigger" data-action="toggle-menu"/);
  assert.equal((markup.match(/class="mobile-menu"/g) || []).length, 0);
  assert.match(markup, /data-view="dashboard"/);
  assert.match(markup, /data-view="medicines"/);
  assert.match(markup, /data-view="scan"/);
  assert.match(markup, /data-view="doctors"/);
  assert.match(markup, /class="mobile-sidebar-logout nav-item" data-action="logout"/);
});

test('open mobile drawer hides hamburger trigger while keeping mobile exit outside profile menu', () => {
  const state = { ...createState(), screen: 'shell', localOnly: true, mobileMenuOpen: true, profileMenuOpen: true };
  const markup = createViewRenderer({ state }).renderShell();

  assert.doesNotMatch(markup, /class="mobile-nav-trigger"/);
  assert.match(markup, /class="mobile-sidebar-logout nav-item" data-action="logout"/);
  assert.match(markup, /class="profile-menu"/);
  assert.doesNotMatch(markup, /class="profile-menu"[\s\S]*data-action="logout"/);
});

test('mobile sidebar exit is hidden on desktop and restored at mobile breakpoint', () => {
  const layoutCss = readFileSync(new URL('../styles/03-layout.css', import.meta.url), 'utf8');
  const responsiveCss = readFileSync(new URL('../styles/08-responsive.css', import.meta.url), 'utf8');

  assert.match(layoutCss, /\.sidebar \.mobile-sidebar-logout\s*\{\s*display:\s*none;/);
  assert.match(responsiveCss, /\.sidebar \.mobile-sidebar-logout\s*\{\s*display:\s*flex;/);
});

test('pending doctor workspace blocks patient access request controls', () => {
  const state = { ...createState(), screen: 'shell', role: 'doctor', view: 'dashboard', localOnly: false };
  const markup = createViewRenderer({ state }).renderShell();

  assert.match(markup, /Verification required/);
  assert.match(markup, /disabled aria-disabled="true"/);
  assert.match(markup, /organisation must verify this clinician account/);
});

test('authenticator setup is available from privacy settings', () => {
  const state = { ...createState(), screen: 'shell', view: 'privacy', localOnly: false, mfaFactors: [] };
  const markup = createViewRenderer({ state }).renderShell();

  assert.match(markup, /Protect sign-in/);
  assert.match(markup, /data-action="mfa-enroll"/);
});

test('prescription records expose edit and delete controls', () => {
  const state = { ...createState(), screen: 'shell', view: 'scan', localOnly: true, prescriptions: [{ id: 'rx-1', medicationName: 'Warfarin', strength: '5 mg', frequency: 'daily', instructions: 'Take in evening' }] };
  const markup = createViewRenderer({ state }).renderShell();

  assert.match(markup, /data-action="edit-prescription" data-id="rx-1"/);
  assert.match(markup, /data-action="delete-prescription" data-id="rx-1"/);
});

test('urgent notices use assertive announcement semantics', () => {
  const state = { ...createState(), screen: 'shell', view: 'composition', localOnly: true };
  const markup = createViewRenderer({ state }).renderShell();
  assert.match(markup, /role="alert" aria-live="assertive"/);
});

test('camera card exposes mobile-safe action controls', () => {
  const state = { ...createState(), screen: 'shell', localOnly: true, view: 'scan' };
  const markup = createViewRenderer({ state }).renderShell();

  assert.match(markup, /class="card camera-card"/);
  assert.match(markup, /class="camera-actions"/);
  assert.match(markup, /class="button button-primary"[^>]*data-action="camera-start"/);
  assert.match(markup, /class="button button-secondary file-button"/);
});

test('medicine editor exposes clinical detail fields', () => {
  const state = { ...createState(), screen: 'shell', localOnly: true, view: 'medicines' };
  state.medicines = [{ name: 'Warfarin', strength: '5 mg', dose: '1 tablet', route: 'oral', timing: 'evening', notes: 'Keep consistent' }];
  const markup = createViewRenderer({ state }).renderShell();

  for (const field of ['name', 'strength', 'dose', 'route', 'timing', 'notes']) {
    assert.match(markup, new RegExp(`data-med-key="${field}"`));
  }
});

test('safety card keeps icon and copy in aligned heading wrapper', () => {
  const state = { ...createState(), screen: 'shell', localOnly: true, view: 'dashboard' };
  const markup = createViewRenderer({ state }).renderShell();

  assert.match(markup, /class="safety-heading"><span class="safety-symbol">[\s\S]*<div><p class="card-kicker">SAFETY FIRST<\/p><h3>/);
});

test('local mode renders Exit local mode in mobile sidebar and profile menu', () => {
  const state = { ...createState(), screen: 'shell', localOnly: true, view: 'privacy' };
  const closedMarkup = createViewRenderer({ state }).renderShell();
  assert.equal((closedMarkup.match(/Exit local mode/g) || []).length, 1);
  state.profileMenuOpen = true;
  const openMarkup = createViewRenderer({ state }).renderShell();
  assert.equal((openMarkup.match(/Exit local mode/g) || []).length, 2);
  assert.match(openMarkup, /class="profile-menu"[\s\S]*data-action="logout"/);
  assert.match(openMarkup, /Local workspace/);
});

test('stored-browser exit dialog keeps aligned action hooks', () => {
  const state = { ...createState(), screen: 'shell', localOnly: true, localExitPrompt: true };
  const markup = createViewRenderer({ state }).renderShell();

  assert.match(markup, /class="card local-exit-dialog"/);
  assert.match(markup, /class="modal-actions"/);
  assert.equal((markup.match(/data-action="local-exit-(?:preserve|clear|cancel)"/g) || []).length, 3);
  assert.match(markup, /data-action="local-exit-preserve"/);
  assert.match(markup, /data-action="local-exit-clear"/);
  assert.match(markup, /data-action="local-exit-cancel"/);
});

const patientViews = ['dashboard', 'patient', 'medicines', 'scan', 'review', 'reconcile', 'composition', 'doctors', 'care-team', 'lifestyle', 'privacy'];
for (const role of ['patient', 'doctor']) {
  const viewNames = role === 'patient' ? patientViews : ['dashboard', 'doctor-patients', 'privacy'];
  for (const view of viewNames) {
    test(`${role} ${view} keeps balanced markup and footer inside shell`, () => {
      for (const populated of [false, true]) {
        for (const localOnly of [false, true]) {
          const state = populated ? populatedState() : createState();
          Object.assign(state, { role, view, localOnly, screen: 'shell', localExitPrompt: localOnly });
          const tree = inspectMarkup(createViewRenderer({ state }).renderShell());
          const shell = findClass(tree, 'shell-content');
          const main = findClass(tree, 'content-page');
          const footer = findClass(tree, 'app-footer');
          assert.equal(main.tag, 'main');
          assert.equal(footer.tag, 'footer');
          assert.equal(main.parent, shell);
          assert.equal(footer.parent, shell);
          assert.deepEqual(shell.children.map((node) => node.tag), ['main', 'footer']);
          const modal = findClass(tree, 'modal-backdrop');
          assert.equal(Boolean(modal), localOnly);
          if (modal) assert.equal(modal.parent, tree);
        }
      }
    });
  }
}

test('auth templates have balanced markup for both roles and account modes', () => {
  for (const authRole of ['patient', 'doctor']) {
    for (const authMode of ['login', 'register']) {
      const state = { ...createState(), authRole, authMode, authError: 'Synthetic <error>' };
      const tree = inspectMarkup(createViewRenderer({ state }).renderAuth());
      assert.equal(tree.children.length, 1);
      assert.equal(tree.children[0].tag, 'main');
    }
  }
});

test('auth templates offer Google sign-in for selected role', () => {
  for (const authRole of ['patient', 'doctor']) {
    for (const authMode of ['login', 'register']) {
      const state = { ...createState(), authRole, authMode, googleConfigured: true };
      const markup = createViewRenderer({ state }).renderAuth();
      assert.match(markup, new RegExp(`href="/api/auth/google\\?role=${authRole}"`));
      assert.match(markup, /class="auth-google-icon"/);
      assert.match(markup, new RegExp(`<span>${authMode === 'register' ? 'Create' : 'Sign in'} with Google<\\/span><\\/a>`));
      assert.match(markup, new RegExp(`${authMode === 'register' ? 'Create' : 'Sign in'} with Google for ${authRole} account`));
      if (authRole === 'doctor') {
        assert.match(markup, /doctor role/);
        assert.match(markup, /pending clinician workspace/);
        assert.match(markup, /Verification remains pending until your organisation reviews registration details/);
        assert.doesNotMatch(markup, /patient account/);
      } else {
        assert.match(markup, /patient account/);
        assert.doesNotMatch(markup, /clinician workspace/);
      }
    }
  }
});

test('Google callback errors become safe auth UI copy and OAuth query is cleared', async () => {
  assert.equal(googleAuthErrorMessage('?error=access_denied&error_description=raw-token-value'), 'Google sign-in was cancelled. You can try again or use email and password.');
  assert.equal(googleAuthErrorMessage('?error=google_role_mismatch'), 'This Google account is already registered with a different role. Choose that role to continue.');
  assert.doesNotMatch(googleAuthErrorMessage('?error=provider-secret'), /provider-secret/);

  const state = createState();
  const views = createViewRenderer({ state });
  const root = { innerHTML: '', addEventListener() {} };
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousMe = api.me;
  let replacedUrl = '';
  globalThis.window = {
    location: { search: '?error=GOOGLE_AUTH_FAILED&error_description=raw-token-value', pathname: '/', hash: '' },
    history: { replaceState(_state, _title, url) { replacedUrl = url; } },
  };
  globalThis.document = { querySelector() { return null; } };
  api.me = async () => { throw new ApiError('Authentication required.', 401); };
  try {
    await createController({ root, state, views, ocr: {} }).hydrateRemote();
    assert.equal(state.authError, 'Google sign-in could not be completed. Try again or use email and password.');
    assert.equal(replacedUrl, '/');
    assert.doesNotMatch(root.innerHTML, /raw-token-value|GOOGLE_AUTH_FAILED/);
  } finally {
    api.me = previousMe;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

test('doctor records stay balanced when loading, empty, or AI-assisted', () => {
  for (const records of [undefined, {}, { summary: { isAiGenerated: true, headline: 'Synthetic <draft>', findings: [{ severity: 'review', title: 'Verify <source>', detail: 'Synthetic & test only' }] } }]) {
    const state = populatedState();
    Object.assign(state, { role: 'doctor', view: 'doctor-patients' });
    state.doctorRecords['fixture-patient-approved'] = records;
    inspectMarkup(createViewRenderer({ state }).renderShell());
  }
});

test('camera error and review source cannot inject markup into the layout', () => {
  const state = createState();
  const source = '</span></div><img src=x onerror=alert(1)>';
  Object.assign(state, { view: 'scan', cameraError: source });
  const views = createViewRenderer({ state });
  assert.doesNotMatch(views.renderShell(), /<img /);
  inspectMarkup(views.renderShell());
  Object.assign(state, { view: 'review', scanSource: source });
  const markup = views.renderShell();
  assert.doesNotMatch(markup, /<img /);
  assert.match(markup, /&lt;img src=x/);
  inspectMarkup(markup);
});

test('structural regression check rejects extra page closing tags', () => {
  const state = { ...createState(), view: 'medicines' };
  const markup = createViewRenderer({ state }).renderShell();
  assert.throws(() => inspectMarkup(markup.replace('</main>', '</div></main>')), /Unexpected <\/div>/);
});
