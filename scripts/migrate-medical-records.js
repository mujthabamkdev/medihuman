import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { JsonDataStore, SupabaseDataStore, normalizeState } from '../src/backend/store.js';
import { migratePrescriptionRecords } from '../src/backend/medical-records.js';

export async function migrateMedicalRecords({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const backend = env.STORE_BACKEND || 'json';
  if (!['json', 'supabase'].includes(backend)) throw new Error('Unsupported migration backend.');
  let store;
  if (backend === 'supabase') {
    store = await new SupabaseDataStore({
      url: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      rpc: env.SUPABASE_NORMALIZED_STATE_RPC,
      fetchImpl,
    }).init();
    await store.transact(migratePrescriptionRecords);
  } else {
    if (!env.DATA_FILE?.trim()) throw new Error('Set DATA_FILE to an existing JSON snapshot.');
    // Validate before init: a typo must not create an empty store or replace an invalid backup.
    normalizeState(JSON.parse(await readFile(env.DATA_FILE, 'utf8')));
    store = await new JsonDataStore(env.DATA_FILE).init();
  }
  return store.read((state) => ({
    medicalRecords: state.medicalRecords.length,
    prescriptions: state.prescriptions.length,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const counts = await migrateMedicalRecords();
    console.log(`Medical records migration complete (${counts.medicalRecords} records, ${counts.prescriptions} prescriptions).`);
  } catch {
    // Never print source paths, database responses, or parsing errors containing patient data.
    console.error('Medical records migration failed. Check explicit DATA_FILE or Supabase configuration and applied migrations.');
    process.exitCode = 1;
  }
}
