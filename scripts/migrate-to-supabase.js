import { JsonDataStore, SupabaseDataStore } from '../src/backend/store.js';
import { DEFAULT_DATA_FILE } from '../src/backend/constants.js';

const sourceFile = process.env.DATA_FILE || DEFAULT_DATA_FILE;
const overwrite = process.env.SUPABASE_MIGRATE_OVERWRITE === '1';

const source = await new JsonDataStore(sourceFile).init();
const state = await source.read((value) => structuredClone(value));
const target = await new SupabaseDataStore().init();
await target.importState(state, { overwrite });
console.log(`Migrated MediHuman state to Supabase from ${sourceFile}.`);
