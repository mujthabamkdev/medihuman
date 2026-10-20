/**
 * Seed MediHuman with a realistic demo dataset.
 *
 * The dataset lives in scripts/demo-data.js. This script applies it to a
 * Supabase project: it creates the matching Supabase Auth accounts (so the
 * demo logins work end to end) and upserts the application rows into the
 * normalized tables used by the backend.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-demo-data.js
 *   node scripts/seed-demo-data.js --project-ref hagplohwjudzbenftljk
 *   node scripts/seed-demo-data.js --local
 *   node scripts/seed-demo-data.js --dry-run
 *   node scripts/seed-demo-data.js --sql supabase/seed.sql
 *   node scripts/seed-demo-data.js --purge
 */
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { buildDemoState, demoAccounts, DEMO_PASSWORD } from './demo-data.js';
import { hashPassword } from '../src/backend/security.js';
import { DEFAULT_DATA_FILE } from '../src/backend/constants.js';
import { JsonDataStore } from '../src/backend/store.js';

const DEFAULT_PROJECT_REF = 'hagplohwjudzbenftljk';

function parseArgs(argv) {
  const options = { dryRun: false, purge: false, sql: '', projectRef: '', url: '', key: '', local: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--purge') options.purge = true;
    else if (arg === '--local') options.local = true;
    else if (arg === '--sql') options.sql = argv[++index] || '';
    else if (arg === '--project-ref') options.projectRef = argv[++index] || '';
    else if (arg === '--url') options.url = argv[++index] || '';
    else if (arg === '--key') options.key = argv[++index] || '';
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Seed MediHuman with realistic demo patients, clinicians, and records.

Options:
  --local                   Write the demo state to the local JSON store instead of Supabase
  --dry-run                 Show what would be written without touching the project
  --purge                   Remove the demo rows and demo auth accounts first
  --sql <file>              Also write a plain SQL seed file (for local supabase db reset)
  --project-ref <ref>       Read the service role key from the Supabase CLI
  --url <url>               Supabase project URL (overrides SUPABASE_URL)
  --key <key>               Supabase service role key (overrides SUPABASE_SERVICE_ROLE_KEY)

Environment:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATA_FILE
`);
}

/** Read the project secret key through the Supabase CLI when no key is exported. */
function serviceKeyFromCli(projectRef) {
  const result = spawnSync('supabase', ['projects', 'api-keys', '--project-ref', projectRef, '--reveal', '--output', 'json'], { encoding: 'utf8' });
  if (result.status !== 0) return '';
  try {
    const keys = JSON.parse(result.stdout);
    return keys.find((item) => item.type === 'secret')?.api_key || keys.find((item) => item.id === 'service_role')?.api_key || '';
  } catch {
    return '';
  }
}

function resolveCredentials(options) {
  const url = (options.url || process.env.SUPABASE_URL || (options.projectRef ? `https://${options.projectRef}.supabase.co` : '')).replace(/\/+$/, '');
  let key = options.key || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!key && options.projectRef) key = serviceKeyFromCli(options.projectRef);
  if (!url || !key) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or pass --url/--key, or use --project-ref with the Supabase CLI installed.');
  }
  if (!/^https:\/\/[^/]+$/.test(url)) throw new Error('SUPABASE_URL must be an HTTPS project URL.');
  return { url, key };
}

class SupabaseAdmin {
  constructor({ url, key }) {
    this.url = url;
    this.key = key;
  }

  async request(path, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(`${this.url}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    if (!response.ok) {
      const detail = payload?.message || payload?.msg || payload?.error_description || response.statusText;
      throw new Error(`${method} ${path} failed (${response.status}): ${detail}`);
    }
    return payload;
  }

  listAuthUsers() {
    return this.request('/auth/v1/admin/users?per_page=1000');
  }

  createAuthUser(user) {
    return this.request('/auth/v1/admin/users', { method: 'POST', body: user });
  }

  updateAuthUser(id, user) {
    return this.request(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', body: user });
  }

  deleteAuthUser(id) {
    return this.request(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  upsert(table, rows, onConflict) {
    if (!rows.length) return Promise.resolve([]);
    return this.request(`/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: rows,
    });
  }

  remove(table, filter) {
    return this.request(`/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  }
}

function usersTableRows(state) {
  return state.users.map((user) => ({
    id: user.id,
    email: user.email,
    role: user.role,
    patient_id: user.patientId || null,
    password_hash: user.passwordHash || null,
    supabase_user_id: user.supabaseUserId || null,
    google_sub: user.googleSub || null,
    doctor_profile: user.doctorProfile || null,
    email_confirmed_at: user.emailConfirmedAt || null,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
    data: user,
  }));
}

function profilesTableRows(state) {
  return state.profiles.map((profile) => ({
    user_id: profile.userId,
    full_name: profile.fullName,
    date_of_birth: profile.dateOfBirth || null,
    allergies: profile.allergies || '',
    conditions: profile.conditions || '',
    consent: profile.consent || null,
    updated_at: profile.updatedAt,
    data: profile,
  }));
}

function medicinesTableRows(state) {
  return state.medicines.map((record) => ({
    user_id: record.userId,
    items: record.items,
    updated_at: record.updatedAt,
    data: record,
  }));
}

function prescriptionsTableRows(state) {
  return state.prescriptions.map((record) => ({
    id: record.id,
    user_id: record.userId,
    medication_name: record.medicationName,
    strength: record.strength,
    dose: record.dose,
    route: record.route,
    frequency: record.frequency,
    start_date: record.startDate || null,
    end_date: record.endDate || null,
    instructions: record.instructions,
    prescriber: record.prescriber,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    data: record,
  }));
}

function reconciliationsTableRows(state) {
  return state.reconciliations.map((record) => ({
    id: record.id,
    user_id: record.userId,
    prescription_medicines: record.prescriptionMedicines,
    dispensed_medicines: record.dispensedMedicines,
    matched: record.matched,
    missing: record.missing,
    unexpected: record.unexpected,
    is_exact_match: record.isExactMatch,
    notes: record.notes,
    created_at: record.createdAt,
    updated_at: record.updatedAt || record.createdAt,
    data: record,
  }));
}

function accessRequestsTableRows(state) {
  return state.accessRequests.map((record) => ({
    id: record.id,
    doctor_user_id: record.doctorUserId,
    patient_user_id: record.patientUserId,
    status: record.status,
    requested_at: record.requestedAt,
    responded_at: record.respondedAt || null,
    revoked_at: record.revokedAt || null,
    data: record,
  }));
}

function indicationsTableRows(state) {
  return state.indications.map((record) => ({
    id: record.id,
    doctor_user_id: record.doctorUserId,
    patient_user_id: record.patientUserId,
    title: record.title,
    detail: record.detail,
    severity: record.severity,
    created_at: record.createdAt,
    updated_at: record.updatedAt || record.createdAt,
    data: record,
  }));
}

function notificationsTableRows(state) {
  return state.notifications.map((record) => ({
    id: record.id,
    recipient_user_id: record.recipientUserId,
    actor_user_id: record.actorUserId || null,
    type: record.type,
    title: record.title,
    message: record.message,
    entity_type: record.entityType || null,
    entity_id: record.entityId || null,
    read_at: record.readAt || null,
    created_at: record.createdAt,
    data: record,
  }));
}

function auditLogsTableRows(state) {
  return state.auditLogs.map((record) => ({
    id: record.id,
    actor_user_id: record.actorUserId || null,
    action: record.action,
    entity_type: record.entityType,
    entity_id: record.entityId || null,
    outcome: record.outcome,
    created_at: record.createdAt,
    data: record,
  }));
}

const TABLE_PLAN = [
  { table: 'users', onConflict: 'id', build: usersTableRows },
  { table: 'profiles', onConflict: 'user_id', build: profilesTableRows },
  { table: 'medicines', onConflict: 'user_id', build: medicinesTableRows },
  { table: 'prescriptions', onConflict: 'id', build: prescriptionsTableRows },
  { table: 'reconciliations', onConflict: 'id', build: reconciliationsTableRows },
  { table: 'access_requests', onConflict: 'id', build: accessRequestsTableRows },
  { table: 'indications', onConflict: 'id', build: indicationsTableRows },
  { table: 'notifications', onConflict: 'id', build: notificationsTableRows },
  { table: 'audit_logs', onConflict: 'id', build: auditLogsTableRows },
];

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value) || typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Build a plain SQL seed file so `supabase db reset` can load the same demo data locally. */
function buildSql(state, authIds) {
  const lines = [
    '-- MediHuman demo data. Generated by scripts/seed-demo-data.js --sql.',
    '-- Fictional accounts on example.com addresses. Demo password: ' + DEMO_PASSWORD,
    'set search_path = public, extensions;',
    '',
  ];
  const sections = [
    ['users', 'users', 'id'],
    ['profiles', 'profiles', 'user_id'],
    ['medicines', 'medicines', 'user_id'],
    ['prescriptions', 'prescriptions', 'id'],
    ['reconciliations', 'reconciliations', 'id'],
    ['access_requests', 'access_requests', 'id'],
    ['indications', 'indications', 'id'],
    ['notifications', 'notifications', 'id'],
    ['audit_logs', 'audit_logs', 'id'],
  ];
  for (const [table, key, conflict] of sections) {
    const rows = TABLE_PLAN.find((entry) => entry.table === table).build(state);
    if (!rows.length) continue;
    const columns = Object.keys(rows[0]);
    lines.push(`insert into public.${table} (${columns.join(', ')}) values`);
    lines.push(rows.map((row) => `  (${columns.map((column) => sqlLiteral(row[column])).join(', ')})`).join(',\n'));
    lines.push(`on conflict (${conflict}) do update set ${columns.filter((column) => column !== conflict).map((column) => `${column} = excluded.${column}`).join(', ')};`);
    lines.push('');
  }
  lines.push('-- Supabase Auth accounts for the demo logins.');
  lines.push('create extension if not exists pgcrypto;');
  lines.push('create or replace function public.medihuman_demo_hash(password text) returns text');
  lines.push('language plpgsql as $$');
  lines.push('declare');
  lines.push('  crypto_schema text;');
  lines.push('begin');
  lines.push("  select n.nspname into crypto_schema from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'crypt' and p.pronargs = 2 limit 1;");
  lines.push("  if crypto_schema is null then raise exception 'pgcrypto is required to seed the demo accounts'; end if;");
  lines.push("  return execute format('select %I.crypt($1, %I.gen_salt(''bf''))', crypto_schema, crypto_schema);");
  lines.push('end;');
  lines.push('$$;');
  lines.push('');
  lines.push('do $$');
  lines.push('declare');
  lines.push('  demo record;');
  lines.push('  demo_id uuid;');
  lines.push('begin');
  lines.push(`  for demo in select * from jsonb_to_recordset(${sqlLiteral(demoAccounts.map((account) => ({ email: account.email, role: account.role })))}) as demo(email text, role text) loop`);
  lines.push('    select id into demo_id from auth.users where email = demo.email;');
  lines.push('    if demo_id is null then');
  lines.push('      demo_id := gen_random_uuid();');
  lines.push('      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)');
  lines.push("      values (demo_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', demo.email, public.medihuman_demo_hash('" + DEMO_PASSWORD + "'), now(), jsonb_build_object('provider', 'email', 'providers', array['email']), jsonb_build_object('medihuman_role', demo.role, 'medihuman_demo', true), now(), now());");
  lines.push('      insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)');
  lines.push("      values (gen_random_uuid(), demo_id, demo_id, jsonb_build_object('sub', demo_id::text, 'email', demo.email, 'email_verified', true), 'email', now(), now(), now());");
  lines.push('    else');
  lines.push("      update auth.users set encrypted_password = public.medihuman_demo_hash('" + DEMO_PASSWORD + "'), email_confirmed_at = now(), raw_user_meta_data = jsonb_build_object('medihuman_role', demo.role, 'medihuman_demo', true) where id = demo_id;");
  lines.push('    end if;');
  lines.push('  end loop;');
  lines.push('end $$;');
  lines.push('');
  return lines.join('\n');
}

async function ensureAuthAccounts(admin, state, options) {
  const authIds = new Map();
  if (options.dryRun) {
    for (const account of demoAccounts) {
      process.stdout.write(`would create or update auth account ${account.email}\n`);
      authIds.set(account.email, `dry-run-${account.id}`);
    }
    return authIds;
  }
  const existing = await admin.listAuthUsers();
  const byEmail = new Map((existing?.users || []).map((user) => [String(user.email || '').toLowerCase(), user]));
  for (const account of demoAccounts) {
    const current = byEmail.get(account.email);
    const payload = {
      email: account.email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { medihuman_role: account.role, medihuman_demo: true },
    };
    if (current) {
      await admin.updateAuthUser(current.id, payload);
      authIds.set(account.email, current.id);
    } else {
      const created = await admin.createAuthUser(payload);
      authIds.set(account.email, created.id);
    }
  }
  for (const user of state.users) {
    const authId = authIds.get(user.email);
    if (authId) user.supabaseUserId = authId;
  }
  return authIds;
}

async function purgeDemoData(admin) {
  const byDemoId = { 'audit_logs': 'id', 'notifications': 'id', 'indications': 'id', 'access_requests': 'id', 'reconciliations': 'id', 'prescriptions': 'id', 'users': 'id' };
  for (const [table, column] of Object.entries(byDemoId)) {
    await admin.remove(table, `${column}=like.demo-*`);
  }
  await admin.remove('medicines', 'user_id=like.demo-*');
  await admin.remove('profiles', 'user_id=like.demo-*');
  const authUsers = await admin.listAuthUsers();
  for (const user of authUsers?.users || []) {
    if (user.user_metadata?.medihuman_demo === true) await admin.deleteAuthUser(user.id);
  }
  process.stdout.write('Removed existing demo rows and demo auth accounts.\n');
}

/** Write the demo state into the local JSON store used by `npm start`. */
async function seedLocalStore(state, options) {
  const dataFile = process.env.DATA_FILE || DEFAULT_DATA_FILE;
  const store = new JsonDataStore(dataFile);
  await store.init();
  if (options.dryRun) {
    process.stdout.write(`would write the demo state to ${dataFile}\n`);
    return;
  }
  await store.transact((current) => {
    for (const key of Object.keys(current)) {
      if (key === 'version') continue;
      if (Array.isArray(state[key])) current[key] = state[key];
    }
    current.version = state.version;
  });
  process.stdout.write(`wrote the demo state to ${dataFile}\n`);
  printDemoAccounts();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const state = buildDemoState();

  // The local JSON backend verifies its own scrypt hash, so the same demo
  // accounts can sign in there as well as through Supabase Auth.
  for (const user of state.users) user.passwordHash = await hashPassword(DEMO_PASSWORD);

  if (options.local) {
    await seedLocalStore(state, options);
    return;
  }

  const { url, key } = resolveCredentials(options);
  const admin = new SupabaseAdmin({ url, key });

  process.stdout.write(`MediHuman demo seed → ${url}\n`);
  process.stdout.write(`${demoAccounts.length} demo accounts, ${state.prescriptions.length} prescriptions, ${state.reconciliations.length} comparisons, ${state.indications.length} indications.\n\n`);

  if (options.purge && !options.dryRun) await purgeDemoData(admin);

  const authIds = await ensureAuthAccounts(admin, state, options);

  for (const { table, onConflict, build } of TABLE_PLAN) {
    const rows = build(state);
    if (!rows.length) continue;
    if (options.dryRun) {
      process.stdout.write(`would write ${rows.length} rows to ${table}\n`);
      continue;
    }
    await admin.upsert(table, rows, onConflict);
    process.stdout.write(`wrote ${rows.length} rows to ${table}\n`);
  }

  if (options.sql) {
    await writeFile(options.sql, buildSql(state, authIds), 'utf8');
    process.stdout.write(`\nwrote SQL seed file ${options.sql}\n`);
  }

  if (!options.dryRun) printDemoAccounts();
}

function printDemoAccounts() {
  process.stdout.write('\nDemo sign-in details (password for every account: ' + DEMO_PASSWORD + ')\n');
  for (const account of demoAccounts) {
    const detail = account.role === 'doctor'
      ? `${account.specialty} · ${account.verificationStatus}`
      : `${account.condition} · patient ID ${account.patientId}`;
    process.stdout.write(`  ${account.role.padEnd(7)} ${account.email.padEnd(38)} ${detail}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
