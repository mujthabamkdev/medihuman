import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoState, demoAccounts, DEMO_PASSWORD } from '../scripts/demo-data.js';
import { compareMedicines } from '../src/medication-logic.js';
import { analyzeMedicationSafety } from '../src/clinical-logic.js';

const state = buildDemoState(Date.parse('2026-10-20T09:00:00.000Z'));

test('demo dataset creates patients and clinicians with sign-in details', () => {
  const patients = state.users.filter((user) => user.role === 'patient');
  const doctors = state.users.filter((user) => user.role === 'doctor');
  assert.equal(patients.length, 8);
  assert.equal(doctors.length, 4);
  assert.equal(new Set(state.users.map((user) => user.email)).size, state.users.length);
  assert.equal(demoAccounts.length, state.users.length);
  assert.ok(DEMO_PASSWORD.length >= 12);
  assert.equal(state.users.every((user) => user.email.endsWith('example.com')), true);
});

test('every demo record points at an existing user', () => {
  const userIds = new Set(state.users.map((user) => user.id));
  assert.equal(state.profiles.every((profile) => userIds.has(profile.userId)), true);
  assert.equal(state.medicines.every((record) => userIds.has(record.userId)), true);
  assert.equal(state.prescriptions.every((record) => userIds.has(record.userId)), true);
  assert.equal(state.reconciliations.every((record) => userIds.has(record.userId)), true);
  assert.equal(state.accessRequests.every((request) => userIds.has(request.doctorUserId) && userIds.has(request.patientUserId)), true);
  assert.equal(state.indications.every((item) => userIds.has(item.doctorUserId) && userIds.has(item.patientUserId)), true);
  assert.equal(state.notifications.every((item) => userIds.has(item.recipientUserId)), true);
  assert.equal(state.notifications.every((item) => !item.actorUserId || userIds.has(item.actorUserId)), true);
});

test('saved comparisons match the shared medicine comparison rules', () => {
  for (const record of state.reconciliations) {
    const expected = compareMedicines(record.prescriptionMedicines.join('\n'), record.dispensedMedicines.join('\n'));
    assert.deepEqual(record.matched, expected.matched);
    assert.deepEqual(record.missing, expected.missing);
    assert.deepEqual(record.unexpected, expected.unexpected);
    assert.equal(record.isExactMatch, expected.isExactMatch);
  }
});

test('demo comparisons cover the interesting reconciliation outcomes', () => {
  const outcomes = state.reconciliations.map((record) => ({
    missing: record.missing.length,
    unexpected: record.unexpected.length,
    exact: record.isExactMatch,
  }));
  assert.equal(outcomes.some((outcome) => outcome.missing > 0), true, 'expected a missing medicine scenario');
  assert.equal(outcomes.some((outcome) => outcome.unexpected > 0), true, 'expected an unexpected medicine scenario');
  assert.equal(outcomes.some((outcome) => outcome.exact), true, 'expected an exact match scenario');
});

test('clinician access states cover approve, pending, and revoked', () => {
  const statuses = new Set(state.accessRequests.map((request) => request.status));
  assert.equal(statuses.has('approved'), true);
  assert.equal(statuses.has('pending'), true);
  assert.equal(statuses.has('revoked'), true);
  assert.equal(state.accessRequests.every((request) => request.requestedAt), true);
});

test('the allergy scenario surfaces a rule-based safety finding', () => {
  const patient = state.users.find((user) => user.id === 'demo-patient-anjali-sharma');
  const profile = state.profiles.find((item) => item.userId === patient.id);
  const medicines = state.medicines.find((item) => item.userId === patient.id).items;
  const findings = analyzeMedicationSafety(medicines, profile);
  assert.equal(findings.some((finding) => finding.severity === 'high'), true);
});

test('dates in the demo dataset are valid and ordered', () => {
  for (const prescription of state.prescriptions) {
    assert.match(prescription.startDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(prescription.endDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(new Date(prescription.startDate) <= new Date(prescription.endDate));
  }
  for (const profile of state.profiles) {
    if (profile.dateOfBirth) assert.match(profile.dateOfBirth, /^\d{4}-\d{2}-\d{2}$/);
  }
});
