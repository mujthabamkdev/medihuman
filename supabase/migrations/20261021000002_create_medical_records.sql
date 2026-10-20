-- Canonical medical records, with prescriptions retained as a legacy mirror.
begin;

create table if not exists public.medical_records (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  type text not null,
  title text not null default '',
  date date,
  description text not null default '',
  file_ref text not null default '',
  mime_type text not null default '',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  tags jsonb not null default '[]'::jsonb check (jsonb_typeof(tags) = 'array'),
  source text not null default 'self',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  data jsonb not null default '{}'::jsonb
);

create index if not exists medical_records_user_date_idx on public.medical_records (user_id, date desc);
create index if not exists medical_records_user_type_idx on public.medical_records (user_id, type);
create index if not exists medical_records_tags_idx on public.medical_records using gin (tags);

alter table public.medical_records enable row level security;
revoke all on table public.medical_records from public, anon, authenticated;
grant select, insert, update, delete on table public.medical_records to service_role;

-- Match JS hydration: canonical columns overlay the old payload. Keep unknown
-- prescription fields inside the record's structured data, not just SQL columns.
-- Preserve original timestamp strings when present; UTC fallback is deterministic.
with prescriptions as (
  select p.*, p.data || jsonb_strip_nulls(jsonb_build_object(
    'id', p.id, 'userId', p.user_id, 'medicationName', p.medication_name,
    'strength', p.strength, 'dose', p.dose, 'route', p.route,
    'frequency', p.frequency, 'startDate', p.start_date, 'endDate', p.end_date,
    'instructions', p.instructions, 'prescriber', p.prescriber,
    'createdAt', coalesce(nullif(p.data->>'createdAt', ''), to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'updatedAt', coalesce(nullif(p.data->>'updatedAt', ''), to_char(p.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  )) as payload
  from public.prescriptions p
), records as (
  select p.*, jsonb_build_object(
    'id', p.id, 'userId', p.user_id, 'type', 'prescription',
    'title', p.medication_name, 'date', left(p.payload->>'createdAt', 10),
    'description', p.instructions, 'fileRef', '', 'mimeType', '', 'sizeBytes', 0,
    'tags', '[]'::jsonb, 'source', 'self',
    'createdAt', p.payload->>'createdAt', 'updatedAt', p.payload->>'updatedAt',
    'data', p.payload - 'id' - 'userId' - 'createdAt' - 'updatedAt'
  ) as record
  from prescriptions p
)
insert into public.medical_records (
  id, user_id, type, title, date, description, file_ref, mime_type, size_bytes,
  tags, source, created_at, updated_at, data
)
select id, user_id, 'prescription', medication_name, (record->>'date')::date,
  instructions, '', '', 0, '[]'::jsonb, 'self', created_at, updated_at, record
from records
on conflict (id) do nothing;

-- Snapshot replacement remains one advisory-locked transaction for all 12 collections.
create or replace function public.medihuman_commit_normalized_state(next_state jsonb)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  item jsonb;
begin
  if jsonb_typeof(next_state) is distinct from 'object' then
    raise exception 'next_state must be a JSON object';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('medihuman.normalized.state', 0));

  delete from public.oauth_states where true;
  delete from public.sessions where true;
  delete from public.audit_logs where true;
  delete from public.notifications where true;
  delete from public.indications where true;
  delete from public.access_requests where true;
  delete from public.reconciliations where true;
  delete from public.medical_records where true;
  delete from public.prescriptions where true;
  delete from public.medicines where true;
  delete from public.profiles where true;
  delete from public.users where true;

  for item in select value from jsonb_array_elements(coalesce(next_state->'users', '[]'::jsonb)) loop
    insert into public.users (
      id, email, role, patient_id, password_hash, supabase_user_id, google_sub,
      doctor_profile, email_confirmed_at, created_at, updated_at, data
    ) values (
      item->>'id', item->>'email', item->>'role', item->>'patientId', item->'passwordHash',
      item->>'supabaseUserId', item->>'googleSub', item->'doctorProfile',
      nullif(item->>'emailConfirmedAt', '')::timestamptz,
      coalesce(nullif(item->>'createdAt', '')::timestamptz, timezone('utc', now())),
      coalesce(nullif(item->>'updatedAt', '')::timestamptz, timezone('utc', now())), item
    );
  end loop;

  for item in select value from jsonb_array_elements(coalesce(next_state->'profiles', '[]'::jsonb)) loop
    insert into public.profiles (
      user_id, full_name, date_of_birth, allergies, conditions, consent, updated_at, data
    ) values (
      item->>'userId', coalesce(item->>'fullName', ''), nullif(item->>'dateOfBirth', '')::date,
      coalesce(item->>'allergies', ''), coalesce(item->>'conditions', ''), item->'consent',
      coalesce(nullif(item->>'updatedAt', '')::timestamptz, timezone('utc', now())), item
    );
  end loop;

  for item in select value from jsonb_array_elements(coalesce(next_state->'medicines', '[]'::jsonb)) loop
    insert into public.medicines (user_id, items, updated_at, data) values (
      item->>'userId', coalesce(item->'items', '[]'::jsonb),
      coalesce(nullif(item->>'updatedAt', '')::timestamptz, timezone('utc', now())), item
    );
  end loop;

  for item in select value from jsonb_array_elements(coalesce(next_state->'prescriptions', '[]'::jsonb)) loop
    insert into public.prescriptions (
      id, user_id, medication_name, strength, dose, route, frequency, start_date, end_date,
      instructions, prescriber, created_at, updated_at, data
    ) values (
      item->>'id', item->>'userId', coalesce(item->>'medicationName', ''), coalesce(item->>'strength', ''),
      coalesce(item->>'dose', ''), coalesce(item->>'route', ''), coalesce(item->>'frequency', ''),
      nullif(item->>'startDate', '')::date, nullif(item->>'endDate', '')::date,
      coalesce(item->>'instructions', ''), coalesce(item->>'prescriber', ''),
      coalesce(nullif(item->>'createdAt', '')::timestamptz, timezone('utc', now())),
      coalesce(nullif(item->>'updatedAt', '')::timestamptz, timezone('utc', now())), item
    );
  end loop;

  for item in select value from jsonb_array_elements(coalesce(next_state->'medicalRecords', '[]'::jsonb)) loop
    insert into public.medical_records (
      id, user_id, type, title, date, description, file_ref, mime_type, size_bytes,
      tags, source, created_at, updated_at, data
    ) values (
      item->>'id', item->>'userId', item->>'type', coalesce(item->>'title', ''),
      nullif(item->>'date', '')::date, coalesce(item->>'description', ''),
      coalesce(item->>'fileRef', ''), coalesce(item->>'mimeType', ''), coalesce((item->>'sizeBytes')::bigint, 0),
      coalesce(item->'tags', '[]'::jsonb), coalesce(item->>'source', 'self'),
      coalesce(nullif(item->>'createdAt', '')::timestamptz, timezone('utc', now())),
      coalesce(nullif(item->>'updatedAt', '')::timestamptz, timezone('utc', now())), item
    );
  end loop;

  for item in select value from jsonb_array_elements(coalesce(next_state->'reconciliations', '[]'::jsonb)) loop
    insert into public.reconciliations (
      id, user_id, prescription_medicines, dispensed_medicines, matched, missing, unexpected,
      is_exact_match, notes, created_at, updated_at, data
    ) values (
      item->>'id', item->>'userId', coalesce(item->'prescriptionMedicines', '[]'::jsonb),
      coalesce(item->'dispensedMedicines', '[]'::jsonb), coalesce(item->'matched', '[]'::jsonb),
      coalesce(item->'missing', '[]'::jsonb), coalesce(item->'unexpected', '[]'::jsonb),
      coalesce((item->>'isExactMatch')::boolean, false), coalesce(item->>'notes', ''),
      coalesce(nullif(item->>'createdAt', '')::timestamptz, timezone('utc', now())),
      coalesce(nullif(item->>'updatedAt', '')::timestamptz, timezone('utc', now())), item
    );
  end loop;

  for item in select value from jsonb_array_elements(coalesce(next_state->'accessRequests', '[]'::jsonb)) loop
    insert into public.access_requests (
      id, doctor_user_id, patient_user_id, status, requested_at, responded_at, revoked_at, data
    ) values (
      item->>'id', item->>'doctorUserId', item->>'patientUserId', item->>'status',
      coalesce(nullif(item->>'requestedAt', '')::timestamptz, timezone('utc', now())),
      nullif(item->>'respondedAt', '')::timestamptz, nullif(item->>'revokedAt', '')::timestamptz, item
    );
  end loop;

  for item in select value from jsonb_array_elements(coalesce(next_state->'indications', '[]'::jsonb)) loop
    insert into public.indications (
      id, doctor_user_id, patient_user_id, title, detail, severity, created_at, updated_at, data
    ) values (
      item->>'id', item->>'doctorUserId', item->>'patientUserId', coalesce(item->>'title', ''),
      coalesce(item->>'detail', ''), coalesce(item->>'severity', 'info'),
      coalesce(nullif(item->>'createdAt', '')::timestamptz, timezone('utc', now())),
      coalesce(nullif(item->>'updatedAt', '')::timestamptz, timezone('utc', now())), item
    );
  end loop;

  for item in select value from jsonb_array_elements(coalesce(next_state->'notifications', '[]'::jsonb)) loop
    insert into public.notifications (
      id, recipient_user_id, actor_user_id, type, title, message, entity_type, entity_id,
      read_at, created_at, data
    ) values (
      item->>'id', item->>'recipientUserId', nullif(item->>'actorUserId', ''), coalesce(item->>'type', ''),
      coalesce(item->>'title', ''), coalesce(item->>'message', ''), item->'entityType', item->'entityId',
      nullif(item->>'readAt', '')::timestamptz,
      coalesce(nullif(item->>'createdAt', '')::timestamptz, timezone('utc', now())), item
    );
  end loop;

  for item in select value from jsonb_array_elements(coalesce(next_state->'auditLogs', '[]'::jsonb)) loop
    insert into public.audit_logs (
      id, actor_user_id, action, entity_type, entity_id, outcome, created_at, data
    ) values (
      item->>'id', nullif(item->>'actorUserId', ''), item->>'action', item->>'entityType',
      item->>'entityId', coalesce(item->>'outcome', 'success'),
      coalesce(nullif(item->>'createdAt', '')::timestamptz, timezone('utc', now())), item
    );
  end loop;

  for item in select value from jsonb_array_elements(coalesce(next_state->'sessions', '[]'::jsonb)) loop
    insert into public.sessions (
      id, user_id, token_hash, csrf_token_hash, created_at, expires_at, recovery_only, mfa_pending,
      mfa_pending_factor_id, mfa_factor_id, mfa_challenge_id, upstream_tokens, data
    ) values (
      item->>'id', item->>'userId', item->>'tokenHash', item->>'csrfTokenHash',
      coalesce(nullif(item->>'createdAt', '')::timestamptz, timezone('utc', now())),
      nullif(item->>'expiresAt', '')::timestamptz, coalesce((item->>'recoveryOnly')::boolean, false),
      coalesce((item->>'mfaPending')::boolean, false), item->>'mfaPendingFactorId', item->>'mfaFactorId',
      item->>'mfaChallengeId', item->>'upstreamTokens', item
    );
  end loop;

  for item in select value from jsonb_array_elements(coalesce(next_state->'oauthStates', '[]'::jsonb)) loop
    insert into public.oauth_states (state_hash, role, created_at, expires_at, data) values (
      item->>'stateHash', item->>'role',
      coalesce(nullif(item->>'createdAt', '')::timestamptz, timezone('utc', now())),
      nullif(item->>'expiresAt', '')::timestamptz, item
    );
  end loop;

  return true;
end;
$$;

revoke all on function public.medihuman_commit_normalized_state(jsonb) from public, anon, authenticated;
grant execute on function public.medihuman_commit_normalized_state(jsonb) to service_role;

commit;
