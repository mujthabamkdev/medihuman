import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/client/state.js';
import { brandIcon, svgIcon } from '../src/client/ui.js';
import { createViewRenderer } from '../src/client/views.js';

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
});

test('patient shell renders stable navigation and event hooks', () => {
  const state = createState();
  state.screen = 'shell';
  state.localOnly = true;
  const views = createViewRenderer({ state });
  const markup = views.renderShell();

  assert.match(markup, /class="app-shell"/);
  assert.match(markup, /data-action="nav" data-view="medicines"/);
  assert.match(markup, /data-action="go-scan"/);
  assert.match(markup, /class="app-footer"/);
  assert.doesNotMatch(markup, /<span class="nav-icon">home<\/span>/);
});

test('doctor shell keeps doctor-only navigation and access controls', () => {
  const state = createState();
  state.screen = 'shell';
  state.role = 'doctor';
  state.localOnly = true;
  const views = createViewRenderer({ state });
  const markup = views.renderShell();

  assert.match(markup, /Clinician dashboard/);
  assert.match(markup, /data-view="doctor-patients"/);
  assert.match(markup, /Request access to a patient record/);
  assert.doesNotMatch(markup, /data-view="medicines"/);
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
          assert.deepEqual(shell.children.map((node) => node.tag), ['header', 'main', 'footer']);
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
