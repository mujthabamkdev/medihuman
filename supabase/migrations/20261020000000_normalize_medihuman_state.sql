-- Replace singleton JSONB persistence with one normalized row per record.
-- Every table keeps the original JSON object in data so fields can be migrated
-- independently from the backend's JSON contract.

create table if not exists public.users (
  id text primary key,
  email text not null unique,
  role text not null check (role in ('patient', 'doctor')),
  patient_id text,
  password_hash jsonb,
  supabase_user_id text,
  google_sub text,
  doctor_profile jsonb,
  email_confirmed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.profiles (
  user_id text primary key references public.users(id) on delete cascade,
  full_name text not null default '',
  date_of_birth date,
  allergies text not null default '',
  conditions text not null default '',
  consent jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.medicines (
  user_id text primary key references public.users(id) on delete cascade,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  updated_at timestamptz not null default timezone('utc', now()),
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.prescriptions (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  medication_name text not null default '',
  strength text not null default '',
  dose text not null default '',
  route text not null default '',
  frequency text not null default '',
  start_date date,
  end_date date,
  instructions text not null default '',
  prescriber text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.reconciliations (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  prescription_medicines jsonb not null default '[]'::jsonb check (jsonb_typeof(prescription_medicines) = 'array'),
  dispensed_medicines jsonb not null default '[]'::jsonb check (jsonb_typeof(dispensed_medicines) = 'array'),
  matched jsonb not null default '[]'::jsonb check (jsonb_typeof(matched) = 'array'),
  missing jsonb not null default '[]'::jsonb check (jsonb_typeof(missing) = 'array'),
  unexpected jsonb not null default '[]'::jsonb check (jsonb_typeof(unexpected) = 'array'),
  is_exact_match boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.access_requests (
  id text primary key,
  doctor_user_id text not null references public.users(id) on delete cascade,
  patient_user_id text not null references public.users(id) on delete cascade,
  status text not null check (status in ('pending', 'approved', 'rejected', 'revoked')),
  requested_at timestamptz not null default timezone('utc', now()),
  responded_at timestamptz,
  revoked_at timestamptz,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.indications (
  id text primary key,
  doctor_user_id text not null references public.users(id) on delete cascade,
  patient_user_id text not null references public.users(id) on delete cascade,
  title text not null default '',
  detail text not null default '',
  severity text not null default 'info' check (severity in ('info', 'review', 'high')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.notifications (
  id text primary key,
  recipient_user_id text not null references public.users(id) on delete cascade,
  actor_user_id text references public.users(id) on delete set null,
  type text not null default '',
  title text not null default '',
  message text not null default '',
  entity_type text,
  entity_id text,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.audit_logs (
  id text primary key,
  actor_user_id text references public.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  outcome text not null default 'success',
  created_at timestamptz not null default timezone('utc', now()),
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.sessions (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  csrf_token_hash text not null,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  recovery_only boolean not null default false,
  mfa_pending boolean not null default false,
  mfa_pending_factor_id text,
  mfa_factor_id text,
  mfa_challenge_id text,
  upstream_tokens text,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.oauth_states (
  state_hash text primary key,
  role text not null check (role in ('patient', 'doctor')),
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  data jsonb not null default '{}'::jsonb
);

create index if not exists users_patient_id_idx on public.users (patient_id);
create index if not exists users_supabase_user_id_idx on public.users (supabase_user_id);
create index if not exists users_google_sub_idx on public.users (google_sub);
create index if not exists prescriptions_user_id_idx on public.prescriptions (user_id);
create index if not exists prescriptions_created_at_idx on public.prescriptions (created_at desc);
create index if not exists reconciliations_user_id_idx on public.reconciliations (user_id);
create index if not exists reconciliations_created_at_idx on public.reconciliations (created_at desc);
create index if not exists access_requests_doctor_user_id_idx on public.access_requests (doctor_user_id);
create index if not exists access_requests_patient_user_id_idx on public.access_requests (patient_user_id);
create index if not exists access_requests_status_idx on public.access_requests (status);
create index if not exists indications_doctor_user_id_idx on public.indications (doctor_user_id);
create index if not exists indications_patient_user_id_idx on public.indications (patient_user_id);
create index if not exists notifications_recipient_user_id_idx on public.notifications (recipient_user_id);
create index if not exists notifications_created_at_idx on public.notifications (created_at desc);
create index if not exists audit_logs_actor_user_id_idx on public.audit_logs (actor_user_id);
create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index if not exists sessions_user_id_idx on public.sessions (user_id);
create index if not exists sessions_expires_at_idx on public.sessions (expires_at);
create index if not exists oauth_states_expires_at_idx on public.oauth_states (expires_at);

alter table public.users enable row level security;
alter table public.profiles enable row level security;
alter table public.medicines enable row level security;
alter table public.prescriptions enable row level security;
alter table public.reconciliations enable row level security;
alter table public.access_requests enable row level security;
alter table public.indications enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.sessions enable row level security;
alter table public.oauth_states enable row level security;

revoke all on table public.users, public.profiles, public.medicines, public.prescriptions,
  public.reconciliations, public.access_requests, public.indications, public.notifications,
  public.audit_logs, public.sessions, public.oauth_states
from public, anon, authenticated;
grant select, insert, update, delete on table public.users, public.profiles, public.medicines,
  public.prescriptions, public.reconciliations, public.access_requests, public.indications,
  public.notifications, public.audit_logs, public.sessions, public.oauth_states to service_role;

-- Re-assert protection on the existing rate-limit table without replacing it.
alter table public.medihuman_rate_limits enable row level security;
revoke all on table public.medihuman_rate_limits from public, anon, authenticated;
grant select, insert, update on table public.medihuman_rate_limits to service_role;

create or replace function public.medihuman_commit_normalized_state(next_state jsonb)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  item jsonb;
begin
  if jsonb_typeof(next_state) <> 'object' then
    raise exception 'next_state must be a JSON object';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('medihuman.normalized.state', 0));

  delete from public.oauth_states;
  delete from public.sessions;
  delete from public.audit_logs;
  delete from public.notifications;
  delete from public.indications;
  delete from public.access_requests;
  delete from public.reconciliations;
  delete from public.prescriptions;
  delete from public.medicines;
  delete from public.profiles;
  delete from public.users;

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
      coalesce(item->>'title', ''), coalesce(item->>'message', ''), item->>'entityType', item->>'entityId',
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

-- Existing installations have one JSONB snapshot. Unpack it before removing
-- the legacy table/function; rerunning this migration is safe after removal.
do $$
declare
  legacy_state jsonb;
begin
  if to_regclass('public.medihuman_state') is not null then
    execute 'select state from public.medihuman_state where id = $1 limit 1'
      into legacy_state using 'singleton';
    if legacy_state is not null then
      perform public.medihuman_commit_normalized_state(legacy_state);
    end if;
  end if;
end;
$$;

drop function if exists public.medihuman_commit_state(bigint, jsonb);
drop table if exists public.medihuman_commit_state;
drop table if exists public.medihuman_state;
