import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/client/state.js';
import { brandIcon, svgIcon } from '../src/client/ui.js';
import { createViewRenderer } from '../src/client/views.js';

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
