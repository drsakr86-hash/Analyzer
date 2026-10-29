-- Rate-limit storage for the nafsilog-ai Edge Function.
-- Stores only a SHA-256 hash of the access code and a counter. No journal content.
create table if not exists public.nl_ai_rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

alter table public.nl_ai_rate_limits enable row level security;
-- No policies: only the service role (used server-side by the function) can read/write.

create or replace function public.nl_ai_rate_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.nl_ai_rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.count + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;

revoke all on function public.nl_ai_rate_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.nl_ai_rate_hit(text, integer, integer) to service_role;
