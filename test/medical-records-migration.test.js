import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prescriptionToRecord, recordToPrescription, migratePrescriptionRecords } from '../src/backend/medical-records.js';
import { JsonDataStore, normalizeState } from '../src/backend/store.js';
import { migrateMedicalRecords } from '../scripts/migrate-medical-records.js';

const prescription = {
  id: 'rx-1', userId: 'patient-1', medicationName: 'Test medication', strength: '10 mg', dose: '1 tablet',
  route: 'oral', frequency: 'daily', startDate: '2026-10-01', endDate: '2026-10-31',
  instructions: 'With food', prescriber: 'Test prescriber',
  createdAt: '2026-10-20T23:15:00-07:00', updatedAt: '2026-10-21T08:00:00.000Z',
  extension: { preserve: ['unknown', 1, null] },
};

test('legacy prescription conversion preserves full structured payload, identity, dates and timestamps', () => {
  const original = structuredClone(prescription);
  const record = prescriptionToRecord(prescription);
  const { id, userId, createdAt, updatedAt, ...data } = prescription;
  assert.deepEqual(record, {
    id, userId, type: 'prescription', title: prescription.medicationName, date: '2026-10-20',
    description: prescription.instructions, tags: [], source: 'self', fileRef: '', mimeType: '', sizeBytes: 0,
    createdAt, updatedAt, data,
  });
  assert.deepEqual(recordToPrescription(record), prescription);
  record.data.extension.preserve.push('new');
  assert.deepEqual(prescription, original);
});

test('prescription dates use creation calendar date, never startDate or current time', () => {
  for (const [createdAt, expected] of [
    ['2024-02-29T23:59:59-10:00', '2024-02-29'],
    ['2026-01-01', '2026-01-01'],
    ['2026-02-29T00:00:00Z', ''], ['2026-02-30', ''], ['not-a-date', ''], ['', ''], [undefined, ''],
  ]) {
    assert.equal(prescriptionToRecord({ ...prescription, createdAt }).date, expected);
  }
});

test('record flattening uses structured fields and fallbacks with canonical identity and timestamps', () => {
  const record = {
    id: 'canonical', userId: 'owner', title: 'Title fallback', description: 'Description fallback',
    createdAt: 'created', updatedAt: 'updated',
    data: { id: 'wrong', userId: 'wrong', createdAt: 'wrong', updatedAt: 'wrong', dose: '2' },
  };
  assert.deepEqual(recordToPrescription(record), {
    id: 'canonical', userId: 'owner', createdAt: 'created', updatedAt: 'updated', dose: '2',
    medicationName: 'Title fallback', instructions: 'Description fallback',
  });
  assert.equal(recordToPrescription({ ...record, data: { medicationName: 'Structured', instructions: 'Structured instructions' } }).medicationName, 'Structured');
  assert.equal(recordToPrescription({ ...record, data: { instructions: 'Structured instructions' } }).instructions, 'Structured instructions');
  assert.equal(recordToPrescription({ ...record, data: [] }).medicationName, 'Title fallback');
});

test('migration mutates idempotently, canonical records win, mirror follows edits and removes type collisions', () => {
  const canonical = prescriptionToRecord({ ...prescription, medicationName: 'Canonical' });
  const other = { id: 'collision', userId: 'patient-1', type: 'lab', data: { result: 'retained' } };
  const state = {
    medicalRecords: [canonical, other],
    prescriptions: [prescription, { ...prescription, id: 'rx-2' }, { ...prescription, id: 'rx-2' }, { ...prescription, id: 'collision' }],
  };
  assert.equal(migratePrescriptionRecords(state), state);
  assert.equal(state.medicalRecords[0], canonical);
  assert.equal(state.medicalRecords[1], other);
  assert.deepEqual(state.medicalRecords.map((item) => item.id), ['rx-1', 'collision', 'rx-2']);
  assert.deepEqual(state.prescriptions.map((item) => item.id), ['rx-1', 'rx-2']);
  assert.equal(state.prescriptions[0].medicationName, 'Canonical');
  const once = structuredClone(state);
  migratePrescriptionRecords(state);
  assert.deepEqual(state, once);
  canonical.data.dose = 'Updated dose';
  migratePrescriptionRecords(state);
  assert.equal(state.prescriptions[0].dose, 'Updated dose');
  state.medicalRecords = state.medicalRecords.filter((item) => item.id !== 'rx-1');
  state.prescriptions = state.prescriptions.filter((item) => item.id !== 'rx-1');
  migratePrescriptionRecords(state);
  assert.deepEqual(state.prescriptions.map((item) => item.id), ['rx-2']);
});

test('normalization upgrades old backups without mutating input and rejects malformed canonical collections', () => {
  const input = { version: 1, prescriptions: [prescription], extension: { kept: true } };
  const original = structuredClone(input);
  const state = normalizeState(input);
  assert.equal(state.version, 2);
  assert.deepEqual(state.medicalRecords, [prescriptionToRecord(prescription)]);
  assert.deepEqual(state.prescriptions, [prescription]);
  assert.deepEqual(state.extension, { kept: true });
  assert.deepEqual(normalizeState(state), state);
  assert.deepEqual(input, original);
  assert.throws(() => normalizeState({ version: 2, medicalRecords: {} }), /Invalid data store collection: medicalRecords/);
  assert.deepEqual(normalizeState({ version: 2 }).medicalRecords, []);
});

test('JSON migration explicitly targets an existing fixture, persists idempotently and survives reopen', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'medihuman-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'fixture.json');
  await writeFile(file, JSON.stringify({ version: 1, prescriptions: [prescription] }));
  const env = { DATA_FILE: file };
  assert.deepEqual(await migrateMedicalRecords({ env }), { medicalRecords: 1, prescriptions: 1 });
  const first = await readFile(file, 'utf8');
  assert.deepEqual(await migrateMedicalRecords({ env }), { medicalRecords: 1, prescriptions: 1 });
  assert.equal(await readFile(file, 'utf8'), first);
  const reopened = await new JsonDataStore(file).init();
  assert.deepEqual(reopened.state.medicalRecords, [prescriptionToRecord(prescription)]);
  assert.deepEqual(reopened.state.prescriptions, [prescription]);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  await assert.rejects(migrateMedicalRecords({ env: {} }), /Set DATA_FILE/);
  await assert.rejects(migrateMedicalRecords({ env: { DATA_FILE: join(directory, 'missing.json') } }), /ENOENT/);
  await assert.rejects(stat(join(directory, 'missing.json')), /ENOENT/);
  await assert.rejects(migrateMedicalRecords({ env: { STORE_BACKEND: 'unknown' } }), /Unsupported/);
});

test('migration CLI errors never log patient data or source paths and leave invalid input intact', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'medihuman-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'fixture.json');
  const invalid = '{patient-secret-not-json';
  await writeFile(file, invalid);
  await assert.rejects(promisify(execFile)(process.execPath, ['scripts/migrate-medical-records.js'], {
    env: { ...process.env, STORE_BACKEND: 'json', DATA_FILE: file },
  }), (error) => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, '');
    assert.match(error.stderr, /Medical records migration failed/);
    assert.ok(!error.stderr.includes('patient-secret'));
    assert.ok(!error.stderr.includes(file));
    return true;
  });
  assert.equal(await readFile(file, 'utf8'), invalid);
});

test('Supabase migration persists once per run through full-state RPC and remains idempotent', async () => {
  let state = { version: 2, prescriptions: [prescription] };
  const tables = {
    users: 'users', profiles: 'profiles', medicines: 'medicines', prescriptions: 'prescriptions',
    medical_records: 'medicalRecords', reconciliations: 'reconciliations', access_requests: 'accessRequests',
    indications: 'indications', notifications: 'notifications', audit_logs: 'auditLogs', sessions: 'sessions', oauth_states: 'oauthStates',
  };
  let commits = 0;
  const fetchImpl = async (url, options) => {
    const table = new URL(url).pathname.split('/').at(-1);
    if (options.method === 'POST') {
      assert.equal(table, 'medihuman_commit_normalized_state');
      state = JSON.parse(options.body).next_state;
      commits += 1;
      return new Response('true');
    }
    assert.ok(table in tables);
    return new Response(JSON.stringify((state[tables[table]] || []).map((data) => ({ data }))));
  };
  const env = { STORE_BACKEND: 'supabase', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-key' };
  assert.deepEqual(await migrateMedicalRecords({ env, fetchImpl }), { medicalRecords: 1, prescriptions: 1 });
  const first = structuredClone(state);
  await migrateMedicalRecords({ env, fetchImpl });
  assert.equal(commits, 2);
  assert.deepEqual(state, first);
  assert.deepEqual(state.medicalRecords, [prescriptionToRecord(prescription)]);
});

test('SQL migration retains canonical schema, three indexes, payload backfill and service-role-only protections', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261021000002_create_medical_records.sql', import.meta.url), 'utf8');
  const schema = sql.match(/create table if not exists public\.medical_records \(([\s\S]*?)\n\);/)[1];
  for (const column of ['id', 'user_id', 'type', 'title', 'date', 'description', 'file_ref', 'mime_type', 'size_bytes', 'tags', 'source', 'created_at', 'updated_at', 'data']) {
    assert.match(schema, new RegExp(`\\n  ${column} `));
  }
  assert.match(schema, /references public\.users\(id\) on delete cascade/);
  assert.equal([...sql.matchAll(/create index if not exists medical_records_/g)].length, 3);
  assert.match(sql, /\(user_id, date desc\)/);
  assert.match(sql, /\(user_id, type\)/);
  for (const name of ['user_id', 'type', 'date']) assert.match(sql, new RegExp(`medical_records_${name}_idx`));
  assert.match(sql, /alter table public\.medical_records enable row level security/);
  assert.match(sql, /revoke all on table public\.medical_records from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update, delete on table public\.medical_records to service_role/);
  assert.doesNotMatch(sql, /create policy/i);
  const backfill = sql.slice(0, sql.indexOf('create or replace function'));
  assert.match(backfill, /p\.data \|\| jsonb_strip_nulls\(jsonb_build_object/);
  assert.match(backfill, /'data', p\.payload - 'id' - 'userId' - 'createdAt' - 'updatedAt'/);
  assert.match(backfill, /updated_at, record\s+from records\s+on conflict \(id\) do nothing/);
  assert.match(backfill, /'date', left\(p\.payload->>'createdAt', 10\)/);
  assert.match(sql, /^--[^\n]*\nbegin;/);
  assert.match(sql, /commit;\s*$/);
});

test('SQL replacement RPC writes all 12 collections atomically and preserves security and WHERE fixes', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261021000002_create_medical_records.sql', import.meta.url), 'utf8');
  const rpc = sql.slice(sql.indexOf('create or replace function'));
  assert.match(rpc, /security definer\s+set search_path = pg_catalog, public/);
  assert.match(rpc, /pg_advisory_xact_lock\(hashtextextended\('medihuman\.normalized\.state', 0\)\)/);
  const deletes = [...rpc.matchAll(/delete from public\.(\w+) where true;/g)].map((match) => match[1]);
  const inserts = [...rpc.matchAll(/insert into public\.(\w+)/g)].map((match) => match[1]);
  assert.equal(deletes.length, 12);
  assert.equal(inserts.length, 12);
  assert.deepEqual([...deletes].sort(), [...inserts].sort());
  assert.equal(deletes.at(-1), 'users');
  assert.equal(inserts[0], 'users');
  assert.doesNotMatch(rpc, /delete from public\.\w+\s*;/);
  assert.match(rpc, /next_state->'medicalRecords'/);
  assert.match(rpc, /coalesce\(nullif\(item->>'updatedAt', ''\)::timestamptz, timezone\('utc', now\(\)\)\), item/);
  assert.match(rpc, /revoke all on function public\.medihuman_commit_normalized_state\(jsonb\) from public, anon, authenticated/);
  assert.match(rpc, /grant execute on function public\.medihuman_commit_normalized_state\(jsonb\) to service_role/);
});
