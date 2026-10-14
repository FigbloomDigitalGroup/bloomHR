-- Rate limits shared by every server (FIG-820). The API's per-user budgets (AI questions per hour, email recipients
-- per hour, a company's email recipients per day) were counted in each server process's memory; on Vercel every
-- instance has its own memory, so the real limit was the budget times however many instances were running. They are
-- counted here instead, so all instances share one count.
--   * rate_limit_events: one row per use (who, which budget, how much, when). Only the server reads or writes it.
--   * take_rate_limit(): uses p_cost of a budget if what was used in the last p_window_seconds leaves room for it.
--     Atomic: concurrent calls for the same budget queue on a lock, so two servers cannot both take the last unit.
-- Rows older than the window are deleted as the budget is used, so the table stays small.

create table if not exists public.rate_limit_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  bucket text not null,
  cost integer not null check (cost > 0),
  at timestamptz not null default now()
);

create index if not exists rate_limit_events_bucket_idx on public.rate_limit_events (tenant_id, bucket, at);

alter table public.rate_limit_events enable row level security;
drop policy if exists tenant_isolation on public.rate_limit_events;
create policy tenant_isolation on public.rate_limit_events as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
-- no permissive policy, so signed-in users see and change nothing here; only the service role (which bypasses RLS)
-- uses it
revoke all on public.rate_limit_events from anon;

/**
 * Takes p_cost from the budget p_bucket of company p_tenant (at most p_limit in any p_window_seconds) and returns
 * true, or returns false and takes nothing if that would go over. Windows of up to 2 days. For the server only.
 */
create or replace function public.take_rate_limit(
  p_tenant uuid, p_bucket text, p_cost integer, p_limit integer, p_window_seconds integer
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_used bigint;
begin
  if p_tenant is null or coalesce(p_bucket, '') = '' or length(p_bucket) > 200
     or coalesce(p_cost, 0) < 1 or coalesce(p_limit, 0) < 1
     or coalesce(p_window_seconds, 0) < 1 or p_window_seconds > 2 * 86400 then
    raise exception 'take_rate_limit: invalid arguments';
  end if;

  -- one caller at a time per budget, until the end of this transaction
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || '/' || p_bucket, 0));

  -- what has dropped out of this window, and anything of this company's older than the longest window
  delete from public.rate_limit_events
  where tenant_id = p_tenant
    and (at < now() - interval '2 days'
         or (bucket = p_bucket and at <= now() - make_interval(secs => p_window_seconds)));

  select coalesce(sum(cost), 0) into v_used
  from public.rate_limit_events
  where tenant_id = p_tenant and bucket = p_bucket;

  if v_used + p_cost > p_limit then
    return false;
  end if;

  insert into public.rate_limit_events (tenant_id, bucket, cost) values (p_tenant, p_bucket, p_cost);
  return true;
end $$;
revoke all on function public.take_rate_limit(uuid, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.take_rate_limit(uuid, text, integer, integer, integer) to service_role;

notify pgrst, 'reload schema';
