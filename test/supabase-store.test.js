import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseDataStore } from '../src/backend/store.js';

const normalizedTables = [
  ['users', 'users'],
  ['profiles', 'profiles'],
  ['medicines', 'medicines'],
  ['prescriptions', 'prescriptions'],
  ['medicalRecords', 'medical_records'],
  ['reconciliations', 'reconciliations'],
  ['accessRequests', 'access_requests'],
  ['indications', 'indications'],
  ['notifications', 'notifications'],
  ['auditLogs', 'audit_logs'],
  ['sessions', 'sessions'],
  ['oauthStates', 'oauth_states'],
];

function rowsFromState(state) {
  return Object.fromEntries(normalizedTables.map(([key, table]) => [
    table,
    (state[key] || []).map((item) => ({ data: item })),
  ]));
}

function fakeSupabaseFetch({ rows = {} } = {}) {
  const rowsByTable = { ...rows };
  const calls = [];
  const commits = [];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    const method = options.method || 'GET';
    const table = parsed.pathname.split('/').at(-1);
    calls.push({
      path: parsed.pathname,
      method,
      table,
      select: parsed.searchParams.get('select') || '',
      body: options.body ? JSON.parse(options.body) : undefined,
    });

    if (method === 'GET' && normalizedTables.some(([, name]) => name === table)) {
      return new Response(JSON.stringify(rowsByTable[table] || []), { status: 200 });
    }

    if (parsed.pathname.endsWith('/rpc/medihuman_commit_normalized_state') && method === 'POST') {
      const body = JSON.parse(options.body);
      commits.push(body);
      Object.assign(rowsByTable, rowsFromState(body.next_state));
      return new Response('true', { status: 200 });
    }

    return new Response('not found', { status: 404 });
  };
  return { calls, commits, fetchImpl };
}

function storeWith(fetchImpl) {
  return new SupabaseDataStore({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'test-service-role-key',
    fetchImpl,
  });
}

test('Supabase store hydrates route state from normalized rows and overlays canonical fields', async () => {
  const fake = fakeSupabaseFetch({
    rows: {
      users: [{
        data: { id: 'from-data', email: 'data@example.test', role: 'patient', custom: 'preserved' },
        id: 'user-1',
        email: 'canonical@example.test',
        role: 'doctor',
        doctor_profile: { displayName: 'Dr Canonical', verificationStatus: 'verified', verified: true },
        created_at: '2026-01-01T00:00:00.000Z',
      }],
      profiles: [{
        data: { userId: 'data-user', fullName: 'Data Name', custom: 'preserved' },
        user_id: 'user-1',
        full_name: 'Canonical Name',
      }],
      medicines: [{
        data: { userId: 'user-1', items: [{ name: 'Data medicine' }] },
        user_id: 'user-1',
        items: [{ name: 'Canonical medicine' }],
      }],
      prescriptions: [{
        data: { id: 'rx-1', userId: 'data-user', medicationName: 'Data medicine' },
        id: 'rx-1',
        user_id: 'user-1',
        medication_name: 'Canonical medicine',
      }],
      reconciliations: [{
        data: { id: 'recon-1' },
        id: 'recon-1',
        user_id: 'user-1',
        is_exact_match: true,
      }],
      access_requests: [{
        data: { id: 'request-1' },
        id: 'request-1',
        doctor_user_id: 'doctor-1',
        patient_user_id: 'user-1',
        status: 'approved',
      }],
      indications: [{
        data: { id: 'indication-1' },
        id: 'indication-1',
        doctor_user_id: 'doctor-1',
        patient_user_id: 'user-1',
        title: 'Canonical indication',
      }],
      notifications: [{
        data: { id: 'notification-1' },
        id: 'notification-1',
        recipient_user_id: 'user-1',
        actor_user_id: 'doctor-1',
        entity_type: 'prescription',
        entity_id: 'rx-1',
      }],
      audit_logs: [{
        data: { id: 'audit-1' },
        id: 'audit-1',
        actor_user_id: 'doctor-1',
        action: 'reviewed',
        entity_type: 'prescription',
      }],
      sessions: [{
        data: { id: 'session-1' },
        id: 'session-1',
        user_id: 'user-1',
        token_hash: 'token-hash',
        csrf_token_hash: 'csrf-hash',
        expires_at: '2026-01-02T00:00:00.000Z',
        mfa_pending: true,
      }],
      oauth_states: [{
        data: { stateHash: 'state-1' },
        state_hash: 'state-1',
        role: 'doctor',
        expires_at: '2026-01-02T00:00:00.000Z',
      }],
    },
  });
  const store = storeWith(fake.fetchImpl);

  await store.init();

  assert.equal(store.state.users[0].id, 'user-1');
  assert.equal(store.state.users[0].email, 'canonical@example.test');
  assert.equal(store.state.users[0].custom, 'preserved');
  assert.equal(store.state.users[0].doctorProfile.displayName, 'Dr Canonical');
  assert.equal(store.state.profiles[0].fullName, 'Canonical Name');
  assert.equal(store.state.profiles[0].custom, 'preserved');
  assert.deepEqual(store.state.medicines[0].items, [{ name: 'Canonical medicine' }]);
  assert.equal(store.state.prescriptions[0].medicationName, 'Canonical medicine');
  assert.equal(store.state.medicalRecords[0].id, 'rx-1');
  assert.equal(store.state.medicalRecords[0].data.medicationName, 'Canonical medicine');
  assert.equal(store.state.reconciliations[0].isExactMatch, true);
  assert.equal(store.state.accessRequests[0].doctorUserId, 'doctor-1');
  assert.equal(store.state.indications[0].title, 'Canonical indication');
  assert.equal(store.state.notifications[0].entityId, 'rx-1');
  assert.equal(store.state.auditLogs[0].entityType, 'prescription');
  assert.equal(store.state.sessions[0].mfaPending, true);
  assert.equal(store.state.oauthStates[0].stateHash, 'state-1');
  assert.deepEqual(
    fake.calls.filter((call) => call.method === 'GET').map((call) => call.table).sort(),
    normalizedTables.map(([, table]) => table).sort(),
  );
  assert.ok(fake.calls.filter((call) => call.method === 'GET').every((call) => call.select === '*'));
});

test('Supabase store refreshes full normalized snapshot before serialized transaction and persists full state through RPC', async () => {
  const fake = fakeSupabaseFetch();
  const store = storeWith(fake.fetchImpl);
  await store.init();
  fake.calls.length = 0;

  const result = await store.transact((state) => {
    state.notifications.push({ id: 'notification-1', recipientUserId: 'patient-1', message: 'Saved' });
    return 'saved';
  });

  assert.equal(result, 'saved');
  assert.equal(fake.calls.filter((call) => call.method === 'GET').length, normalizedTables.length);
  assert.equal(fake.commits.length, 1);
  assert.deepEqual(fake.commits[0].next_state.notifications, [
    { id: 'notification-1', recipientUserId: 'patient-1', message: 'Saved' },
  ]);
  assert.equal(fake.calls.at(-1).path, '/rest/v1/rpc/medihuman_commit_normalized_state');
  assert.deepEqual(Object.keys(fake.commits[0]), ['next_state']);
  assert.equal(store.state.notifications[0].id, 'notification-1');
});

test('Supabase medical records overlay canonical columns, preserve nested data, and own the prescription mirror', async () => {
  const fake = fakeSupabaseFetch({ rows: {
    prescriptions: [{ data: { id: 'rx-1', userId: 'user-1', medicationName: 'Stale name' } }],
    medical_records: [{
      data: {
        id: 'stale-id', userId: 'stale-user', type: 'other', title: 'Stale title',
        data: { strength: '10 mg', dose: '1', custom: { retained: true } },
        customEnvelope: ['preserved'],
      },
      id: 'rx-1', user_id: 'user-1', type: 'prescription', title: 'Canonical name',
      date: '2026-10-20', description: 'Canonical instructions', file_ref: 'uploads/reference',
      mime_type: 'application/pdf', size_bytes: 1234, tags: ['ongoing'], source: 'self',
      created_at: '2026-10-20T10:00:00.000Z', updated_at: '2026-10-20T11:00:00.000Z',
    }],
  } });
  const store = await storeWith(fake.fetchImpl).init();
  const record = store.state.medicalRecords[0];
  assert.deepEqual(record, {
    id: 'rx-1', userId: 'user-1', type: 'prescription', title: 'Canonical name',
    date: '2026-10-20', description: 'Canonical instructions', fileRef: 'uploads/reference',
    mimeType: 'application/pdf', sizeBytes: 1234, tags: ['ongoing'], source: 'self',
    createdAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-10-20T11:00:00.000Z',
    data: { strength: '10 mg', dose: '1', custom: { retained: true } },
    customEnvelope: ['preserved'],
  });
  assert.deepEqual(store.state.prescriptions, [{
    strength: '10 mg', dose: '1', custom: { retained: true }, medicationName: 'Canonical name',
    instructions: 'Canonical instructions', id: 'rx-1', userId: 'user-1',
    createdAt: record.createdAt, updatedAt: record.updatedAt,
  }]);
});

test('Supabase RPC roundtrip preserves all medical record fields and legacy mirror across refresh', async () => {
  const fake = fakeSupabaseFetch();
  const store = await storeWith(fake.fetchImpl).init();
  const record = {
    id: 'rx-1', userId: 'user-1', type: 'prescription', title: 'Medication', date: '2026-10-20',
    description: 'Instructions', tags: ['current'], source: 'self', fileRef: '', mimeType: '', sizeBytes: 0,
    createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T01:00:00.000Z',
    data: { medicationName: 'Medication', instructions: 'Instructions', dose: '1', extension: { list: [1, 2] } },
  };
  const lab = { ...record, id: 'lab-1', type: 'lab', title: 'Lab report', data: { values: [4, 5] } };
  await store.transact((state) => state.medicalRecords.push(record, lab));
  assert.deepEqual(fake.commits[0].next_state.medicalRecords, [record, lab]);
  assert.equal(fake.commits[0].next_state.prescriptions.length, 1);
  assert.equal(Object.keys(fake.commits[0].next_state).filter((key) => key !== 'version').length, 12);
  await store.refresh();
  assert.deepEqual(store.state.medicalRecords, [record, lab]);
  assert.deepEqual(store.state.prescriptions[0].extension, { list: [1, 2] });
  await store.transact((state) => {
    state.medicalRecords = state.medicalRecords.filter((item) => item.id !== 'rx-1');
    state.prescriptions = state.prescriptions.filter((item) => item.id !== 'rx-1');
  });
  await store.refresh();
  assert.deepEqual(store.state.medicalRecords, [lab]);
  assert.deepEqual(store.state.prescriptions, []);
});

test('Supabase medical records migration retains prior snapshot when atomic RPC rejects commit', async () => {
  const fake = fakeSupabaseFetch();
  const store = await storeWith(async (url, options) => {
    if (options?.method === 'POST') return new Response('false', { status: 200 });
    return fake.fetchImpl(url, options);
  }).init();
  await assert.rejects(store.transact((state) => {
    state.medicalRecords.push({ id: 'failed', type: 'prescription', title: 'Unsaved' });
  }), /commit failed/);
  assert.deepEqual(store.state.medicalRecords, []);
  assert.deepEqual(store.state.prescriptions, []);
});
