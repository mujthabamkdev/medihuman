import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { SupabaseDataStore } from '../src/backend/store.js';

const backupDirectory = resolve(process.env.SUPABASE_BACKUP_DIR || '.supabase-backups');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = resolve(backupDirectory, `medihuman-${timestamp}.json`);

const store = await new SupabaseDataStore().init();
const state = await store.read((value) => structuredClone(value));
await mkdir(dirname(backupFile), { recursive: true, mode: 0o700 });
await writeFile(backupFile, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 });
console.log(`Supabase backup written to ${backupFile}.`);
