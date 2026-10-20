import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LIST_ITEMS } from '../src/backend/constants.js';
import { RECORD_FIELDS, RECORD_TYPES, fileRefValue, recordListValue, recordType, recordValue } from '../src/backend/validation.js';
import { findRecordByPublicId, patientRecords, publicRecord, sortedPatientRecords } from '../src/backend/records.js';
import { AI_SUMMARY_DISCLAIMER, RULE_BASED_SUMMARY_DISCLAIMER, buildRuleBasedSummary, buildSummary } from '../src/backend/summary.js';

const validRecord = (changes = {}) => ({ type: 'lab_report', title: 'Blood panel', date: '2024-02-29', ...changes });
const invalid = (callback) => assert.throws(callback, (error) => error.status === 400 && ['INVALID_FIELD', 'UNKNOWN_FIELD'].includes(error.code));
const stateWith = (medicalRecords = []) => ({
  users: [{ id: 'patient', role: 'patient', patientId: 'public-patient' }],
  profiles: [], medicines: [], prescriptions: [], reconciliations: [], indications: [], medicalRecords,
});

test('record validation exposes the complete enum and file metadata input contract', () => {
  assert.deepEqual(RECORD_TYPES, ['prescription', 'lab_report', 'imaging', 'clinical_note', 'discharge_summary', 'vaccination', 'other']);
  for (const type of RECORD_TYPES) assert.equal(recordType(type), type);
  for (const field of ['fileRef', 'mimeType', 'sizeBytes']) assert.ok(RECORD_FIELDS.includes(field));
  assert.deepEqual(recordValue(validRecord()), {
    ...validRecord(), description: '', tags: [], source: 'self', fileRef: '', mimeType: '',
  });
  const result = recordValue(validRecord({ title: ' Blood panel ', description: ' Filed ', tags: [' annual '], source: 'lab', fileRef: 'https://files.example/report.pdf', mimeType: 'application/pdf', sizeBytes: 42 }));
  assert.equal(result.title, 'Blood panel');
  assert.equal(result.description, 'Filed');
  assert.deepEqual(result.tags, ['annual']);
  assert.equal(result.source, 'lab');
  assert.equal(result.sizeBytes, 42);
  assert.equal(recordValue(validRecord({ source: 'clinic' })).source, 'clinic');
});

test('records reject nonobjects, missing fields, unsupported enum values, and impossible dates', () => {
  for (const input of [null, undefined, [], true, 'record']) invalid(() => recordValue(input));
  for (const field of ['type', 'title', 'date']) {
    for (const value of [undefined, '', ' ', null, 3]) invalid(() => recordValue(validRecord({ [field]: value })));
  }
  for (const type of ['LAB_REPORT', 'lab', '__proto__']) invalid(() => recordValue(validRecord({ type })));
  for (const date of ['2023-02-29', '2024-04-31', '2024-13-01', '2024-00-10', '2024-2-01', '01/01/2024', '2024-01-01T00:00:00Z']) invalid(() => recordValue(validRecord({ date })));
  assert.equal(recordValue(validRecord({ date: '2000-02-29' })).date, '2000-02-29');
  for (const source of ['doctor', '', null, 1]) invalid(() => recordValue(validRecord({ source })));
});

test('records reject arbitrary data, ownership, identity, and server timestamps', () => {
  for (const field of ['data', 'userId', 'patientId', 'id', 'createdAt', 'updatedAt', 'owner', 'extra']) {
    invalid(() => recordValue(validRecord({ [field]: 'server-only' })));
    assert.ok(!RECORD_FIELDS.includes(field));
  }
  invalid(() => recordValue(JSON.parse('{"type":"other","title":"Note","date":"2024-01-01","__proto__":{"userId":"other"}}')));
});

test('record tags and text remain bounded and correctly typed', () => {
  for (const tags of ['tag', null, [null], [1], [''], ['  '], ['x'.repeat(241)], Array(MAX_LIST_ITEMS + 1).fill('tag')]) invalid(() => recordValue(validRecord({ tags })));
  assert.equal(recordValue(validRecord({ tags: Array(MAX_LIST_ITEMS).fill('tag') })).tags.length, MAX_LIST_ITEMS);
  invalid(() => recordValue(validRecord({ title: 'x'.repeat(201) })));
  invalid(() => recordValue(validRecord({ description: 'x'.repeat(5_001) })));
  invalid(() => recordValue(validRecord({ description: {} })));
});

test('file references allow empty or bounded absolute HTTPS URLs without credentials', () => {
  assert.equal(fileRefValue(), '');
  assert.equal(fileRefValue(''), '');
  assert.equal(fileRefValue(' https://files.example/report.pdf?version=2#page=1 '), 'https://files.example/report.pdf?version=2#page=1');
  const boundary = `https://files.example/${'x'.repeat(2_048 - 'https://files.example/'.length)}`;
  assert.equal(fileRefValue(boundary).length, 2_048);
  for (const value of [null, {}, 42, '/report.pdf', '//files.example/report.pdf', 'http://files.example/report.pdf', 'javascript:alert(1)', 'data:application/pdf;base64,abc', 'https:files.example', 'https://user@files.example/report.pdf', 'https://user:password@files.example', 'https://files.example/a\nb', `${boundary}x`]) invalid(() => fileRefValue(value));
});

test('file metadata enforces MIME syntax and safe integer size through 4.5 MB', () => {
  for (const mimeType of ['application/pdf', 'image/jpeg', 'application/vnd.example+json', 'text/plain', '']) assert.equal(recordValue(validRecord({ mimeType })).mimeType, mimeType);
  for (const mimeType of [null, 1, 'pdf', '/pdf', 'application/', 'application/pdf; charset=utf-8', 'application/a b', `application/${'a'.repeat(128)}`]) invalid(() => recordValue(validRecord({ mimeType })));
  for (const sizeBytes of [0, 1, 4_500_000]) assert.equal(recordValue(validRecord({ sizeBytes })).sizeBytes, sizeBytes);
  for (const sizeBytes of [-1, 0.5, '10', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 4_500_001]) invalid(() => recordValue(validRecord({ sizeBytes })));
});

test('record lists accept empty and bounded collections and validate every member', () => {
  assert.deepEqual(recordListValue([]), []);
  assert.equal(recordListValue(Array.from({ length: MAX_LIST_ITEMS }, () => validRecord())).length, MAX_LIST_ITEMS);
  for (const records of [null, {}, '', Array(MAX_LIST_ITEMS + 1).fill(validRecord()), [validRecord(), { title: 'Incomplete' }]]) invalid(() => recordListValue(records));
});

test('public record serialization excludes arbitrary fields and nested ownership data', () => {
  const record = { ...validRecord({ type: 'prescription' }), id: 'rx', userId: 'patient', source: 'self', description: 'Recorded', tags: ['annual'], fileRef: '', mimeType: '', sizeBytes: 0, createdAt: '2024-01-01', updatedAt: '2024-01-02', secret: 'private', data: { medicationName: 'Example', dose: '1 tablet', userId: 'other', createdAt: 'private', extra: { secret: true }, prescriber: { userId: 'hidden' } } };
  const safe = publicRecord(record);
  assert.deepEqual(safe.data, { medicationName: 'Example', dose: '1 tablet' });
  assert.equal(safe.userId, undefined);
  assert.equal(safe.secret, undefined);
  assert.equal(safe.sizeBytes, 0);
  safe.tags.push('changed');
  assert.deepEqual(record.tags, ['annual']);
  assert.equal(publicRecord({ ...record, type: 'lab_report' }).data, undefined);
  assert.equal(publicRecord({ ...record, data: [] }).data, undefined);
  const malformed = publicRecord({ ...record, title: { userId: 'hidden' }, tags: [{ userId: 'hidden' }], sizeBytes: 'private' });
  assert.equal(malformed.title, undefined);
  assert.deepEqual(malformed.tags, []);
  assert.equal(malformed.sizeBytes, undefined);
});

test('record lookup is owner scoped even when public IDs collide', () => {
  const own = { ...validRecord(), id: 'shared', userId: 'patient' };
  const state = stateWith([{ ...own, userId: 'other' }, own]);
  assert.equal(findRecordByPublicId(state, 'shared', 'patient'), own);
  assert.equal(findRecordByPublicId(state, 'shared', 'stranger'), undefined);
  assert.equal(findRecordByPublicId(state, 'missing', 'patient'), undefined);
  assert.equal(findRecordByPublicId(state, 'shared'), undefined);
  assert.equal(findRecordByPublicId({}, 'shared', 'patient'), undefined);
});

test('patient record ordering uses descending dates and creation times, then stable IDs without mutating state', () => {
  const record = (id, date, createdAt, changes = {}) => ({ ...validRecord(), id, userId: 'patient', date, createdAt, ...changes });
  const state = stateWith([
    record('b', '2024-04-01', '2024-04-02'), record('old', '2023-01-01', '2025-01-01'),
    record('foreign', '2030-01-01', '', { userId: 'other' }), record('a', '2024-04-01', '2024-04-02'),
    record('new', '2024-04-01', '2024-04-03', { type: 'imaging' }),
  ]);
  const original = [...state.medicalRecords];
  assert.deepEqual(sortedPatientRecords(state, 'patient').map((item) => item.id), ['new', 'a', 'b', 'old']);
  assert.deepEqual(sortedPatientRecords(state, 'patient', 'imaging').map((item) => item.id), ['new']);
  assert.deepEqual(state.medicalRecords, original);
  assert.deepEqual(sortedPatientRecords({}, 'patient'), []);
});

test('patient records use canonical prescriptions and safely expose owned medical records', () => {
  const state = stateWith([
    { ...validRecord({ type: 'prescription', title: 'Canonical medicine' }), id: 'rx', userId: 'patient', data: { medicationName: 'Canonical medicine', dose: '1 tablet', userId: 'other', secret: 'hidden' } },
    { ...validRecord(), id: 'foreign', userId: 'other' },
  ]);
  state.prescriptions = [{ id: 'legacy', userId: 'patient', medicationName: 'Stale medicine' }];
  const result = patientRecords(state, state.users[0]);
  assert.deepEqual(result.medicalRecords.map((record) => record.id), ['rx']);
  assert.equal(result.prescriptions.length, 1);
  assert.equal(result.prescriptions[0].medicationName, 'Canonical medicine');
  assert.equal(result.prescriptions[0].dose, '1 tablet');
  assert.equal(result.prescriptions[0].secret, undefined);
  assert.equal(JSON.stringify(result).includes('userId'), false);
  assert.deepEqual(Object.keys(patientRecords(state, state.users[0], { includeSensitive: false })), ['profile']);
  state.medicalRecords = [];
  assert.deepEqual(patientRecords(state, state.users[0]).prescriptions, []);
  delete state.medicalRecords;
  const legacy = patientRecords(state, state.users[0]);
  assert.equal(legacy.prescriptions[0].medicationName, 'Stale medicine');
  assert.deepEqual(legacy.medicalRecords, []);
});

test('summary counts canonical records once, separately from the prescription projection', () => {
  const medicalRecords = RECORD_TYPES.map((type, index) => ({ id: `record-${index}`, type, title: 'Private title', description: 'Private diagnosis text', data: { secret: true } }));
  medicalRecords.push({ id: 'second-lab', type: 'lab_report' });
  const summary = buildRuleBasedSummary({ medicalRecords, prescriptions: [{ id: 'record-0' }], medicines: [{ name: 'Example' }], profile: { fullName: 'Patient', allergies: 'Recorded' }, reconciliations: [{ isExactMatch: true }] });
  assert.equal(summary.sourceCounts.records, 8);
  assert.equal(summary.sourceCounts.prescriptions, 1);
  assert.equal(summary.sourceCounts.medicines, 1);
  assert.equal(summary.sourceCounts.profile, 2);
  assert.equal(summary.sourceCounts.reconciliations, 1);
  assert.equal(summary.recordCountsByType.lab_report, 2);
  assert.equal(summary.recordCountsByType.prescription, 1);
  assert.equal(Object.values(summary.recordCountsByType).reduce((sum, count) => sum + count, 0), 8);
  for (const type of RECORD_TYPES) assert.equal(summary.findings.filter((finding) => finding.type === type && finding.severity === 'info').length, 1);
  assert.equal(summary.method, 'rule-based');
  assert.equal(summary.isAiGenerated, false);
  assert.equal(summary.disclaimer, RULE_BASED_SUMMARY_DISCLAIMER);
  assert.equal(summary.profileSignals.hasName, true);
  assert.equal(JSON.stringify(summary).includes('Private'), false);
});

test('empty summaries preserve original fields and provide zero record counters', () => {
  const summary = buildRuleBasedSummary();
  assert.deepEqual(summary.sourceCounts, { profile: 0, medicines: 0, prescriptions: 0, reconciliations: 0, records: 0 });
  assert.deepEqual(summary.recordCountsByType, Object.fromEntries(RECORD_TYPES.map((type) => [type, 0])));
  assert.ok(summary.findings.some((finding) => finding.message === 'No medicine reconciliation is recorded.'));
  assert.equal(summary.findings.some((finding) => RECORD_TYPES.includes(finding.type)), false);
});

test('adapter summaries retain authoritative record and legacy source counters', async () => {
  const input = { medicalRecords: [{ type: 'imaging' }], prescriptions: [{ id: 'rx' }] };
  const summary = await buildSummary(input, async () => ({ method: 'ai-assisted', disclaimer: AI_SUMMARY_DISCLAIMER, findings: [], sourceCounts: { records: 99 }, recordCountsByType: { imaging: 99 } }));
  assert.equal(summary.method, 'ai-assisted');
  assert.equal(summary.disclaimer, AI_SUMMARY_DISCLAIMER);
  assert.equal(summary.sourceCounts.records, 1);
  assert.equal(summary.sourceCounts.prescriptions, 1);
  assert.equal(summary.recordCountsByType.imaging, 1);
});

test('configured AI summaries retain locally computed counters without network access', async (t) => {
  for (const [name, value] of Object.entries({ MEDIHUMAN_SUMMARY_URL: 'https://summary.example/v1', MEDIHUMAN_SUMMARY_API_KEY: 'test-only', MEDIHUMAN_SUMMARY_APPROVED_HOSTS: 'summary.example', MEDIHUMAN_SUMMARY_ALLOW_PHI: '1' })) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ output_text: JSON.stringify({ headline: 'Recorded documents', findings: [] }) }), { status: 200 }));
  const summary = await buildSummary({ medicalRecords: [{ type: 'vaccination' }] });
  assert.equal(summary.method, 'ai-assisted');
  assert.equal(summary.sourceCounts.records, 1);
  assert.equal(summary.recordCountsByType.vaccination, 1);
  assert.equal(summary.disclaimer, AI_SUMMARY_DISCLAIMER);
});
