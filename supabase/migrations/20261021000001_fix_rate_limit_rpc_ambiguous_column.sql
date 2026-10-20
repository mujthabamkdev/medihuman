-- The rate limit RPC declared a parameter named bucket_key, which is also a
-- column of public.medihuman_rate_limits. PL/pgSQL could not tell the
-- variable and the column apart, so every call failed with
-- "column reference bucket_key is ambiguous" (42702) and the request
-- limiter turned into a hard 500 on every API route.
--
-- Aliasing the insert target and naming the conflict constraint keeps the
-- public signature unchanged, so the server keeps calling the same RPC with
-- the same argument names.

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

  insert into public.medihuman_rate_limits as limits (bucket_key, window_started, hit_count, updated_at)
  values (bucket_key, now_iso, 1, now_iso)
  on conflict on constraint medihuman_rate_limits_pkey do update
  set window_started = case
        when limits.window_started <= now_iso - make_interval(secs => window_seconds)
          then now_iso
        else limits.window_started
      end,
      hit_count = case
        when limits.window_started <= now_iso - make_interval(secs => window_seconds)
          then 1
        else limits.hit_count + 1
      end,
      updated_at = now_iso
  returning * into current_row;

  return current_row.hit_count <= max_count;
end;
$$;

revoke all on function public.medihuman_rate_limit_hit(text, integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.medihuman_rate_limit_hit(text, integer, integer, timestamptz) to service_role;
