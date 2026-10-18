import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareMedicines,
  getSafetyNotes,
  parseMedicineList,
} from '../src/medication-logic.js';

test('parses one-per-line and comma-separated medicine lists', () => {
  assert.deepEqual(parseMedicineList(' Metformin 500 mg\n\nLisinopril 10 mg, Aspirin 81 mg '), [
    'Metformin 500 mg',
    'Lisinopril 10 mg',
    'Aspirin 81 mg',
  ]);
});

test('reports exact matches without fuzzy matching', () => {
  const result = compareMedicines(
    'Metformin 500 mg\nLisinopril 10 mg',
    'metformin 500 mg\nLisinopril 10 mg',
  );
  assert.equal(result.isExactMatch, true);
  assert.deepEqual(result.matched, [
    { name: 'Metformin 500 mg', count: 1 },
    { name: 'Lisinopril 10 mg', count: 1 },
  ]);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.unexpected, []);

  const formulationChange = compareMedicines('Metformin 500 mg', 'Metformin XR 500 mg');
  assert.equal(formulationChange.isExactMatch, false);
  assert.deepEqual(formulationChange.missing, [{ name: 'Metformin 500 mg', count: 1 }]);
  assert.deepEqual(formulationChange.unexpected, [{ name: 'Metformin XR 500 mg', count: 1 }]);
});

test('reports missing and unexpected medicines, including duplicate counts', () => {
  const result = compareMedicines(
    'Aspirin 81 mg\nAspirin 81 mg\nAtorvastatin 20 mg',
    'Aspirin 81 mg\nIbuprofen 200 mg\nIbuprofen 200 mg',
  );
  assert.deepEqual(result.matched, [{ name: 'Aspirin 81 mg', count: 1 }]);
  assert.deepEqual(result.missing, [
    { name: 'Aspirin 81 mg', count: 1 },
    { name: 'Atorvastatin 20 mg', count: 1 },
  ]);
  assert.deepEqual(result.unexpected, [{ name: 'Ibuprofen 200 mg', count: 2 }]);
});

test('does not call empty lists an exact match', () => {
  const result = compareMedicines('', '');
  assert.equal(result.isExactMatch, false);
  assert.deepEqual(result.matched, []);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.unexpected, []);
});

test('adds discrepancy and profile context to safety notes', () => {
  const comparison = compareMedicines('Amoxicillin 500 mg', 'Ibuprofen 200 mg');
  const notes = getSafetyNotes({ allergies: 'penicillin', conditions: 'asthma' }, comparison);
  assert.equal(notes[0].includes('missing or unexpected'), true);
  assert.equal(notes.some((note) => note.includes('penicillin')), true);
  assert.equal(notes.some((note) => note.includes('asthma')), true);
});
