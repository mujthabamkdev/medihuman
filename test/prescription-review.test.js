import test from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../src/client/controller.js';
import { createViewRenderer } from '../src/client/views.js';
import { createState } from '../src/client/state.js';
import { analyzePrescriptionText } from '../src/prescription-parse.js';

function stubBrowser({ confirmed = false } = {}) {
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const confirmBox = { checked: confirmed, focus() {} };
  globalThis.sessionStorage = storage;
  globalThis.document = {
    querySelector(selector) {
      if (selector === '#review-text') return { value: 'Levothyroxine 50 mcg' };
      if (selector === '#ocr-review-confirmed') return confirmBox;
      return null;
    },
    querySelectorAll() { return []; },
    getElementById() { return null; },
    activeElement: null,
  };
  return confirmBox;
}

test('a flagged reading is held for review until the lines are confirmed', async () => {
  const state = { ...createState(), screen: 'shell', localOnly: true, view: 'review' };
  const views = createViewRenderer({ state });
  const listeners = {};
  const root = { innerHTML: '', addEventListener(type, handler) { listeners[type] = handler; } };
  const previousDocument = globalThis.document;
  const previousSession = globalThis.sessionStorage;
  const confirmBox = stubBrowser();
  try {
    const controller = createController({ root, state, views, ocr: {} });
    void controller;
    state.ocrAnalysis = analyzePrescriptionText('Levothyroxine 50 mcg');
    state.ocrText = 'Levothyroxine 50 mcg';

    await listeners.click({ target: { closest() { return { dataset: { action: 'save-review' } }; } } });
    assert.equal(state.view, 'review', 'saving is blocked while a flagged line is unconfirmed');
    assert.match(state.errorMessage, /flagged lines/i);

    confirmBox.checked = true;
    await listeners.click({ target: { closest() { return { dataset: { action: 'save-review' } }; } } });
    assert.equal(state.view, 'reconcile');
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousSession === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = previousSession;
  }
});

test('a clean reading saves without an extra confirmation step', async () => {
  const state = { ...createState(), screen: 'shell', localOnly: true, view: 'review' };
  const views = createViewRenderer({ state });
  const listeners = {};
  const root = { innerHTML: '', addEventListener(type, handler) { listeners[type] = handler; } };
  const previousDocument = globalThis.document;
  const previousSession = globalThis.sessionStorage;
  stubBrowser();
  try {
    const controller = createController({ root, state, views, ocr: {} });
    void controller;
    state.ocrAnalysis = analyzePrescriptionText('Metformin 500 mg');

    await listeners.click({ target: { closest() { return { dataset: { action: 'save-review' } }; } } });
    assert.equal(state.view, 'reconcile');
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousSession === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = previousSession;
  }
});

test('the review screen shows capture quality, flags, and capture guidance', () => {
  const text = 'Levothyroxine 50 mcg\nMetformin 500 mg';
  const state = {
    ...createState(),
    screen: 'shell',
    localOnly: true,
    view: 'review',
    ocrText: text,
    ocrAnalysis: analyzePrescriptionText(text),
    ocrResult: { provider: 'test reader', confidence: 52, quality: { metrics: {}, issues: [{ code: 'blurry', title: 'Soft or shaky', detail: 'Hold the phone steady and take the photo again.' }] } },
  };
  const markup = createViewRenderer({ state }).renderShell();

  assert.match(markup, /This capture is hard to read/);
  assert.match(markup, /reported confidence 52%/);
  assert.match(markup, /Check 1 line against the original/);
  assert.match(markup, /micrograms/);
  assert.match(markup, /id="ocr-review-confirmed"/);
  assert.match(markup, /Reading a handwritten prescription/);
});
