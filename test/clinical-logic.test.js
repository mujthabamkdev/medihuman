import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMedicationSafety, medicationCompositionSummary } from '../src/clinical-logic.js';

test('flags known warfarin and aspirin combination for clinician review', () => {
  const findings = analyzeMedicationSafety([{ name: 'Warfarin' }, { name: 'Aspirin 81 mg' }], {});
  assert.equal(findings.some((finding) => finding.severity === 'high' && finding.title.includes('Bleeding')), true);
});

test('uses allergy and condition context without diagnosing', () => {
  const findings = analyzeMedicationSafety([{ name: 'Ibuprofen 200 mg' }], { allergies: 'ibuprofen', conditions: 'renal disease' });
  assert.equal(findings.some((finding) => finding.title.includes('allergy')), true);
  assert.equal(findings.some((finding) => finding.title.includes('Kidney')), true);
});

test('marks unknown composition as unverified', () => {
  const summary = medicationCompositionSummary([{ name: 'Mystery tablet', strength: '10 mg' }]);
  assert.deepEqual(summary[0].ingredient, 'Not verified');
  assert.deepEqual(summary[0].className, 'Unknown');
});
