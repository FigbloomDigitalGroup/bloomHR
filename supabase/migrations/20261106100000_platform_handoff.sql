-- Figbloom Schools -> HR one-click sign-in ("handoff"): ERP/SCHOOLS_HR_HANDOFF_CONTRACT.md section 2.
--
-- A school's admin clicks "HR & Payroll" in Figbloom Schools; the platform gives the browser a one-time code for HR's
-- GET /api/platform/handoff (platform_handoff_routes.js). The backend redeems it on the platform and calls the
-- functions below with the service role. Nothing here changes anything for an existing company: every table is new,
-- and the functions only run behind PLATFORM_HANDOFF_ENABLED on the backend.
--
--   external_logins              which HR login a person of another product is, per company: (company, source
--                                'schools', the person's id there) -> auth user. Made only after that person signed in
--                                to HR themselves once (never by email). Each person sees their own; only the backend
--                                writes. Audited (audit_log).
--   platform_handoff_pending     a handoff for someone not linked yet: the redeemed claims, kept 10 minutes, used once,
--                                found by the hash of a random id the browser carries and bound to that browser (the
--                                hash of a second random value kept in an HttpOnly cookie). Backend only.
--   platform_handoff_log         every handoff and what came of it (signed in, not linked, no access, invalid, off,
--                                linked, unlinked, ...). Never the code. Backend only.
--
--   platform_handoff_begin()     a redeemed handoff: the linked user, switched into the company when they still have
--                                access ('linked' / 'no_access'), else a pending record ('pending').
--   platform_handoff_complete()  a signed-in person finishing a pending handoff: checks it (this browser, unused, not
--                                expired) and that they are an active member of that same company; then links them,
--                                uses the record up and switches them into the company. p_confirm false only looks.
--   platform_handoff_unlink()    a person removes their own link (Settings).
--
-- Safe to run again.

-- ---------------------------------------------------------------------------------------------
-- 1. HR logins of people from other products
-- ---------------------------------------------------------------------------------------------
create table if not exists public.external_logins (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source text not null check (source ~ '^[a-z][a-z0-9_]{0,31}$'),
  external_id text not null check (char_length(external_id) between 1 and 200),
  user_id uuid not null references auth.users(id) on delete cascade,
  linked_at timestamptz not null default now(),
  -- one person of a product is one HR login in a company, and the other way round
  unique (tenant_id, source, external_id),
  unique (tenant_id, source, user_id)
);
create index if not exists external_logins_user_idx on public.external_logins (user_id);

alter table public.external_logins enable row level security;
drop policy if exists tenant_isolation on public.external_logins;
create policy tenant_isolation on public.external_logins as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
-- each person reads their own link(s); nobody else's, and nobody writes but the backend
drop policy if exists own_select on public.external_logins;
create policy own_select on public.external_logins for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.external_logins from anon;
revoke insert, update, delete, truncate on public.external_logins from authenticated;
grant select on public.external_logins to authenticated;

drop trigger if exists audit_external_logins on public.external_logins;
create trigger audit_external_logins after insert or update or delete on public.external_logins
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------------------------
-- 2. handoffs waiting for the person to sign in once
-- ---------------------------------------------------------------------------------------------
create table if not exists public.platform_handoff_pending (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  browser_hash text not null check (browser_hash ~ '^[0-9a-f]{64}$'),
  source text not null check (source ~ '^[a-z][a-z0-9_]{0,31}$'),
  platform_tenant_id uuid not null,
  external_id text not null check (char_length(external_id) between 1 and 200),
  person jsonb not null default '{}'::jsonb,
  return_to text check (return_to is null or char_length(return_to) <= 512),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid
);
alter table public.platform_handoff_pending enable row level security;
drop policy if exists tenant_isolation on public.platform_handoff_pending;
create policy tenant_isolation on public.platform_handoff_pending as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
revoke all on public.platform_handoff_pending from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. what came of every handoff (an invalid one may have no company, so this is not a company's table)
-- ---------------------------------------------------------------------------------------------
create table if not exists public.platform_handoff_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  outcome text not null check (outcome ~ '^[a-z_]{1,40}$'),
  source text,
  platform_tenant_id uuid,
  tenant_id uuid references public.tenants(id) on delete set null,
  external_id text,
  user_id uuid,
  detail text check (detail is null or char_length(detail) <= 500)
);
create index if not exists platform_handoff_log_at_idx on public.platform_handoff_log (at);
alter table public.platform_handoff_log enable row level security;
revoke all on public.platform_handoff_log from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. functions (backend only)
-- ---------------------------------------------------------------------------------------------
/**
 * switch_company() for p_user, run by the backend: when they are an active member of p_tenant and that company is
 * active, it becomes the company they work in and true is returned; otherwise nothing changes and false. Internal.
 */
create or replace function public.platform_handoff_enter(p_tenant uuid, p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_member public.memberships;
begin
  select m.* into v_member
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id and t.status = 'active'
  where m.user_id = p_user and m.tenant_id = p_tenant and m.account_status = 'ACTIVE';
  if not found then
    return false;
  end if;
  update public.user_profiles
    set tenant_id = v_member.tenant_id, role = v_member.role, account_status = v_member.account_status
    where user_id = p_user;
  return found;
end $$;
revoke all on function public.platform_handoff_enter(uuid, uuid) from public, anon, authenticated;
grant execute on function public.platform_handoff_enter(uuid, uuid) to service_role;

/**
 * A handoff the platform just redeemed. p_tenant is the HR company the platform has linked for the school; it must be
 * the company of that platform tenant here too. Outcomes:
 *   unknown_company   no such HR company for that school
 *   linked            the person's HR login (external_logins), now switched into the company: sign them in
 *   no_access         linked, but not (any more) an active member of an active company: sign nothing in
 *   pending           not linked yet: a pending record for p_token_hash / p_browser_hash, 10 minutes
 * Pending records over a day old are deleted on the way. Server only.
 */
create or replace function public.platform_handoff_begin(
  p_tenant uuid, p_platform_tenant uuid, p_source text, p_external_id text, p_person jsonb,
  p_return_to text, p_token_hash text, p_browser_hash text)
returns table (outcome text, tenant_id uuid, user_id uuid)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_tenant uuid;
  v_user uuid;
begin
  select t.id into v_tenant from public.tenants t
  where t.id = p_tenant and t.platform_tenant_id is not null and t.platform_tenant_id = p_platform_tenant;
  if v_tenant is null then
    return query select 'unknown_company'::text, null::uuid, null::uuid;
    return;
  end if;

  select l.user_id into v_user from public.external_logins l
  where l.tenant_id = v_tenant and l.source = p_source and l.external_id = p_external_id;
  if v_user is not null then
    if public.platform_handoff_enter(v_tenant, v_user) then
      return query select 'linked'::text, v_tenant, v_user;
    else
      return query select 'no_access'::text, v_tenant, v_user;
    end if;
    return;
  end if;

  delete from public.platform_handoff_pending x where x.created_at < now() - interval '1 day';
  insert into public.platform_handoff_pending (tenant_id, token_hash, browser_hash, source, platform_tenant_id, external_id,
                                               person, return_to, expires_at)
  values (v_tenant, p_token_hash, p_browser_hash, p_source, p_platform_tenant, p_external_id,
          case when jsonb_typeof(p_person) = 'object' then p_person else '{}'::jsonb end,
          left(p_return_to, 512), now() + interval '10 minutes');
  return query select 'pending'::text, v_tenant, null::uuid;
end $$;
revoke all on function public.platform_handoff_begin(uuid, uuid, text, text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.platform_handoff_begin(uuid, uuid, text, text, jsonb, text, text, text) to service_role;

/**
 * A signed-in person (p_user) finishing a pending handoff. With p_confirm false nothing is written (the app shows who
 * would be connected first). Outcomes:
 *   invalid          no such record
 *   other_browser    it was started in another browser
 *   used / expired   used already, or more than 10 minutes old
 *   wrong_company    p_user is not an active member of that company (the record stays, for the right login)
 *   taken            another HR login of that company is already linked to this person
 *   user_has_other   p_user is already linked to another person of that product in that company
 *   ready            (p_confirm false) everything is in order
 *   linked           linked now; the record is used up and p_user switched into the company
 *   already_linked   this very link already existed; the record is used up and p_user switched into the company
 * Server only.
 */
create or replace function public.platform_handoff_complete(p_token_hash text, p_browser_hash text, p_user uuid, p_confirm boolean default false)
returns table (outcome text, tenant_id uuid, return_to text, source text, external_id text, person_name text, company_name text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  r public.platform_handoff_pending;
  v_company text;
  v_linked uuid;
  v_other text;
begin
  if coalesce(p_confirm, false) then
    select * into r from public.platform_handoff_pending x where x.token_hash = p_token_hash for update;
  else
    select * into r from public.platform_handoff_pending x where x.token_hash = p_token_hash;
  end if;
  if r.id is null then
    return query select 'invalid'::text, null::uuid, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;
  if r.browser_hash is distinct from p_browser_hash then
    return query select 'other_browser'::text, null::uuid, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  select t.name into v_company from public.tenants t where t.id = r.tenant_id;
  if r.used_at is not null or r.expires_at <= now() then
    return query select (case when r.used_at is not null then 'used' else 'expired' end)::text, r.tenant_id, null::text,
                        r.source, null::text, null::text, v_company;
    return;
  end if;

  if p_user is null or not exists (
    select 1 from public.memberships m join public.tenants t on t.id = m.tenant_id and t.status = 'active'
    where m.user_id = p_user and m.tenant_id = r.tenant_id and m.account_status = 'ACTIVE') then
    return query select 'wrong_company'::text, r.tenant_id, null::text, r.source, null::text, null::text, v_company;
    return;
  end if;

  select l.user_id into v_linked from public.external_logins l
  where l.tenant_id = r.tenant_id and l.source = r.source and l.external_id = r.external_id;
  if v_linked is not null and v_linked <> p_user then
    return query select 'taken'::text, r.tenant_id, null::text, r.source, null::text, null::text, v_company;
    return;
  end if;
  select l.external_id into v_other from public.external_logins l
  where l.tenant_id = r.tenant_id and l.source = r.source and l.user_id = p_user and l.external_id <> r.external_id;
  if v_other is not null then
    return query select 'user_has_other'::text, r.tenant_id, null::text, r.source, null::text, null::text, v_company;
    return;
  end if;

  if not coalesce(p_confirm, false) then
    return query select 'ready'::text, r.tenant_id, r.return_to, r.source, r.external_id,
                        nullif(left(btrim(coalesce(r.person->>'name', '')), 120), ''), v_company;
    return;
  end if;

  if v_linked is null then
    insert into public.external_logins (tenant_id, source, external_id, user_id)
    values (r.tenant_id, r.source, r.external_id, p_user);
  end if;
  update public.platform_handoff_pending x set used_at = now(), used_by = p_user where x.id = r.id;
  perform public.platform_handoff_enter(r.tenant_id, p_user);
  return query select (case when v_linked is null then 'linked' else 'already_linked' end)::text, r.tenant_id, r.return_to,
                      r.source, r.external_id, nullif(left(btrim(coalesce(r.person->>'name', '')), 120), ''), v_company;
end $$;
revoke all on function public.platform_handoff_complete(text, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.platform_handoff_complete(text, text, uuid, boolean) to service_role;

/** p_user removes their own link to p_source in company p_tenant (Settings). Returns how many were removed. Server only. */
create or replace function public.platform_handoff_unlink(p_user uuid, p_tenant uuid, p_source text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  delete from public.external_logins l where l.user_id = p_user and l.tenant_id = p_tenant and l.source = p_source;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.platform_handoff_unlink(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.platform_handoff_unlink(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
