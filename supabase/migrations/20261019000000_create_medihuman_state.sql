create table if not exists public.medihuman_state (
  id text primary key check (id = 'singleton'),
  revision bigint not null check (revision > 0),
  state jsonb not null,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.medihuman_state enable row level security;

revoke all on table public.medihuman_state from public, anon, authenticated;
grant select, insert, update on table public.medihuman_state to service_role;

create or replace function public.medihuman_commit_state(
  expected_revision bigint,
  next_state jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.medihuman_state
  set revision = expected_revision + 1,
      state = next_state,
      updated_at = timezone('utc', now())
  where id = 'singleton'
    and revision = expected_revision;

  return found;
end;
$$;

revoke all on function public.medihuman_commit_state(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.medihuman_commit_state(bigint, jsonb) to service_role;
