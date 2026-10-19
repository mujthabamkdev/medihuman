create table if not exists public.medihuman_rate_limits (
  bucket_key text primary key,
  window_started timestamptz not null,
  hit_count integer not null check (hit_count > 0),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.medihuman_rate_limits enable row level security;
revoke all on table public.medihuman_rate_limits from public, anon, authenticated;
grant select, insert, update on table public.medihuman_rate_limits to service_role;

create or replace function public.medihuman_rate_limit_hit(
  bucket_key text,
  window_seconds integer,
  max_count integer,
  now_iso timestamptz default timezone('utc', now())
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.medihuman_rate_limits%rowtype;
begin
  if length(bucket_key) = 0 or length(bucket_key) > 300 or window_seconds < 1 or max_count < 1 then
    return false;
  end if;

  insert into public.medihuman_rate_limits(bucket_key, window_started, hit_count, updated_at)
  values (bucket_key, now_iso, 1, now_iso)
  on conflict (bucket_key) do update
  set window_started = case
        when public.medihuman_rate_limits.window_started <= now_iso - make_interval(secs => window_seconds)
          then now_iso
        else public.medihuman_rate_limits.window_started
      end,
      hit_count = case
        when public.medihuman_rate_limits.window_started <= now_iso - make_interval(secs => window_seconds)
          then 1
        else public.medihuman_rate_limits.hit_count + 1
      end,
      updated_at = now_iso
  returning * into current_row;

  return current_row.hit_count <= max_count;
end;
$$;

revoke all on function public.medihuman_rate_limit_hit(text, integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.medihuman_rate_limit_hit(text, integer, integer, timestamptz) to service_role;
