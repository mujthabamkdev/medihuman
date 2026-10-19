import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseDataStore } from '../src/backend/store.js';

function fakeSupabaseFetch({ conflictOnce = false } = {}) {
  let row = null;
  const calls = [];
  let shouldConflict = conflictOnce;
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    const method = options.method || 'GET';
    calls.push({ path: parsed.pathname, method, select: parsed.searchParams.get('select') || '' });

    if (parsed.pathname.endsWith('/medihuman_state') && method === 'GET') {
      if (!row) return new Response('[]', { status: 200 });
      const body = parsed.searchParams.get('select') === 'revision'
        ? [{ revision: row.revision }]
        : [{ id: row.id, revision: row.revision, state: row.state }];
      return new Response(JSON.stringify(body), { status: 200 });
    }

    if (parsed.pathname.endsWith('/medihuman_state') && method === 'POST') {
      if (!row) row = JSON.parse(options.body);
      return new Response('', { status: 201 });
    }

    if (parsed.pathname.endsWith('/rpc/medihuman_commit_state') && method === 'POST') {
      const body = JSON.parse(options.body);
      if (shouldConflict) {
        shouldConflict = false;
        row.revision += 1;
        return new Response('false', { status: 200 });
      }
      if (body.expected_revision !== row.revision) return new Response('false', { status: 200 });
      row.revision += 1;
      row.state = body.next_state;
      return new Response('true', { status: 200 });
    }

    return new Response('not found', { status: 404 });
  };
  return { calls, fetchImpl };
}

function storeWith(fetchImpl) {
  return new SupabaseDataStore({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'test-service-role-key',
    fetchImpl,
  });
}

test('Supabase store creates singleton, refreshes revision only, and persists transactions', async () => {
  const fake = fakeSupabaseFetch();
  const store = storeWith(fake.fetchImpl);
  await store.init();
  const fullReadsAfterInit = fake.calls.filter((call) => call.method === 'GET' && call.select === 'id,revision,state').length;

  await store.refresh();
  assert.equal(fake.calls.at(-1).select, 'revision');
  assert.equal(fake.calls.filter((call) => call.method === 'GET' && call.select === 'id,revision,state').length, fullReadsAfterInit);

  const result = await store.transact((state) => {
    state.notifications.push({ id: 'notification-1' });
    return 'saved';
  });
  assert.equal(result, 'saved');
  assert.equal(store.revision, 2);
  assert.equal(store.state.notifications[0].id, 'notification-1');
});

test('Supabase store retries one revision conflict without falling back to JSON', async () => {
  const fake = fakeSupabaseFetch({ conflictOnce: true });
  const store = storeWith(fake.fetchImpl);
  await store.init();

  await store.transact((state) => {
    state.profiles.push({ userId: 'patient-1', fullName: 'Patient' });
  });

  assert.equal(store.state.profiles[0].userId, 'patient-1');
  assert.equal(store.revision, 3);
  assert.equal(fake.calls.filter((call) => call.path.endsWith('/rpc/medihuman_commit_state')).length, 2);
});
