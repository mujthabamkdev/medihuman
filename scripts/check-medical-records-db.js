// Optional integration check. Uses only a new, disposable database inside an
// explicitly selected local PostgreSQL container; never resets the app database.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const container = process.env.POSTGRES_CONTAINER;
if (!container || !/^[a-zA-Z0-9_.-]+$/.test(container)) throw new Error('Set POSTGRES_CONTAINER to a running local Supabase PostgreSQL container.');
const database = `medihuman_records_check_${randomUUID().replaceAll('-', '')}`;
function sql(query, target = database) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', target, '-v', 'ON_ERROR_STOP=1', '-q'], {
    input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
}
async function migration(name) {
  sql(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
}

let created = false;
try {
  sql(`create database ${database};`, 'postgres');
  created = true;
  await migration('20261019000001_create_rate_limit.sql');
  await migration('20261020000000_normalize_medihuman_state.sql');
  await migration('20261021000000_fix_commit_rpc_delete_where.sql');
  await migration('20261021000001_fix_rate_limit_rpc_ambiguous_column.sql');
  sql(`
    insert into public.users (id,email,role) values ('fixture-patient','fixture@example.test','patient');
    insert into public.prescriptions (id,user_id,medication_name,instructions,created_at,updated_at,data)
    values ('fixture-rx','fixture-patient','Fixture medication','Fixture instructions','2026-10-20T10:00:00Z','2026-10-20T11:00:00Z',
      '{"strength":"10 mg","extension":{"retained":true},"createdAt":"2026-10-20T10:00:00Z"}');
  `);
  await migration('20261021000002_create_medical_records.sql');
  await migration('20261021000002_create_medical_records.sql');
  sql(`
    do $$ begin
      if (select count(*) from public.medical_records) <> 1 then raise exception 'Backfill must be idempotent'; end if;
      if not exists (select 1 from public.medical_records where id='fixture-rx' and date='2026-10-20'
        and data->'data'->'extension'->>'retained'='true') then raise exception 'Backfill payload lost'; end if;
      if not (select relrowsecurity from pg_class where oid='public.medical_records'::regclass) then raise exception 'RLS missing'; end if;
      if has_table_privilege('anon','public.medical_records','SELECT')
        or has_table_privilege('authenticated','public.medical_records','SELECT')
        or has_function_privilege('anon','public.medihuman_commit_normalized_state(jsonb)','EXECUTE')
        or has_function_privilege('authenticated','public.medihuman_commit_normalized_state(jsonb)','EXECUTE')
        then raise exception 'Non-service-role privilege leak'; end if;
      if not has_table_privilege('service_role','public.medical_records','SELECT,INSERT,UPDATE,DELETE')
        or not has_function_privilege('service_role','public.medihuman_commit_normalized_state(jsonb)','EXECUTE')
        then raise exception 'Service-role privilege missing'; end if;
    end $$;
    set role service_role;
    select public.medihuman_commit_normalized_state('{
      "version":2,"users":[{"id":"fixture-patient","email":"fixture@example.test","role":"patient"}],
      "medicalRecords":[{"id":"fixture-lab","userId":"fixture-patient","type":"lab_report","title":"Fixture lab",
        "date":"2026-10-19","fileRef":"https://storage.example.test/fixture.pdf","mimeType":"application/pdf",
        "sizeBytes":512,"tags":["fixture"],"source":"lab","description":"Fixture only"}]
    }'::jsonb);
    reset role;
    do $$ begin
      if not exists (select 1 from public.medical_records where id='fixture-lab' and date='2026-10-19'
        and size_bytes=512 and data->>'title'='Fixture lab') then raise exception 'RPC did not roundtrip record'; end if;
      if exists (select 1 from public.medical_records where id='fixture-rx') then raise exception 'RPC replacement retained old record'; end if;
      begin
        perform public.medihuman_commit_normalized_state('{
          "users":[{"id":"fixture-patient","email":"fixture@example.test","role":"patient"}],
          "medicalRecords":[{"id":"invalid","userId":"missing-owner","type":"other"}]
        }'::jsonb);
        raise exception 'Expected foreign key failure';
      exception when foreign_key_violation then null;
      end;
      if not exists (select 1 from public.medical_records where id='fixture-lab') then raise exception 'Failed RPC was not atomic'; end if;
    end $$;
  `);
  console.log('PostgreSQL checks passed: backfill, idempotence, RLS/grants, service-role RPC, rollback.');
} catch (error) {
  // All SQL input contains synthetic fixtures, never private patient data.
  process.stderr.write(error.stderr?.toString() || `${error.message}\n`);
  process.exitCode = 1;
} finally {
  if (created) sql(`drop database ${database};`, 'postgres');
}
