-- Two-step sign-in, checked on the server (FIG-834, FIG-658).
--
-- Before: the browser made the 6-digit code itself, wrote it into mfa_codes and read it back to check it, so anyone
-- signed in could read or write their own code (or skip the page) and the "verified" state lived in sessionStorage.
-- Now:
--   * The server (mfa_routes.js) makes the code, sends it by email or SMS and keeps only a keyed hash of it, valid for
--     10 minutes, at most 5 tries, used once (mfa_issue_code / mfa_check_code, for the server only).
--   * mfa_codes is closed to the browser entirely: no policy, no grants.
--   * A correct code is recorded in mfa_sessions against this sign-in (the user and the session id in their login
--     token, auth.jwt() ->> 'session_id'). Only the server writes it. mfa_required() reads it, so the app can ask the
--     database whether this sign-in still needs a code, and mfa_satisfied() is there for policies that should hold
--     only after the second step. A new sign-in has a new session id and asks again; refreshing the token does not.
--   * Each company chooses (company_security_settings, ADMIN only): two-step sign-in off, on for admins, HR and
--     checkers (payroll), or on for everyone; codes by email (the default) or SMS (to the number in mfa_numbers).
--     It replaces the single system_settings.mfa_enabled switch, which is copied over and still read for a company
--     that has no row yet.

-- 1. The company's setting

create table if not exists public.company_security_settings (
  tenant_id uuid primary key default public.current_tenant_id() references public.tenants(id) on delete cascade,
  two_step text not null default 'off',
  two_step_method text not null default 'email',
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.company_security_settings drop constraint if exists company_security_settings_two_step_check;
alter table public.company_security_settings add constraint company_security_settings_two_step_check
  check (two_step in ('off', 'privileged', 'everyone'));
alter table public.company_security_settings drop constraint if exists company_security_settings_two_step_method_check;
alter table public.company_security_settings add constraint company_security_settings_two_step_method_check
  check (two_step_method in ('email', 'sms'));

alter table public.company_security_settings enable row level security;
drop policy if exists tenant_isolation on public.company_security_settings;
create policy tenant_isolation on public.company_security_settings as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
-- read and changed only through the functions below
revoke all on public.company_security_settings from anon, authenticated;

-- a company that had the old switch on keeps two-step sign-in for its admins and checkers (now with HR too), by SMS
-- where it had registered numbers (the old flow only sent SMS), otherwise by email
do $$
begin
  if to_regclass('public.system_settings') is not null then
    insert into public.company_security_settings (tenant_id, two_step, two_step_method)
    select s.tenant_id, 'privileged',
           case when exists (select 1 from public.mfa_numbers n where n.tenant_id = s.tenant_id) then 'sms' else 'email' end
    from public.system_settings s
    where s.id = 1 and coalesce(s.mfa_enabled, false)
    on conflict (tenant_id) do nothing;
  end if;
end $$;

-- 2. Codes: a hash only, for the server only

-- every row so far holds a code in plain text written by the browser; none is worth keeping
delete from public.mfa_codes;
alter table public.mfa_codes drop column if exists code;
alter table public.mfa_codes alter column phone_number drop not null;
alter table public.mfa_codes add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.mfa_codes add column if not exists session_id text;
alter table public.mfa_codes add column if not exists code_hash text;
alter table public.mfa_codes add column if not exists method text;
alter table public.mfa_codes add column if not exists sent_to text;
alter table public.mfa_codes add column if not exists attempts integer not null default 0;
create index if not exists mfa_codes_user_session_idx on public.mfa_codes (user_id, session_id, created_at desc);

drop policy if exists own_codes on public.mfa_codes;
-- tenant_isolation (restrictive) stays; with no permissive policy and no grants, signed-in users see and change nothing
revoke all on public.mfa_codes from anon, authenticated;
-- nobody signed out needs the MFA phone numbers either (the settings page manages them while signed in)
revoke all on public.mfa_numbers from anon;

-- 3. Sign-ins that passed the second step

create table if not exists public.mfa_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  method text not null,
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (user_id, session_id)
);
alter table public.mfa_sessions enable row level security;
drop policy if exists tenant_isolation on public.mfa_sessions;
create policy tenant_isolation on public.mfa_sessions as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
-- only the server records a pass; the browser cannot mark itself verified
revoke all on public.mfa_sessions from anon, authenticated;

-- 4. Who needs the second step

-- does a company's setting ask this role for a code? ('privileged': admins, HR and checkers, who approve pay)
create or replace function public.two_step_applies(p_mode text, p_role text) returns boolean
language sql immutable set search_path = public as $$
  select case coalesce(p_mode, 'off')
    when 'everyone' then true
    when 'privileged' then coalesce(p_role, '') in ('ADMIN', 'HR', 'CHECKER')
    else false
  end
$$;
grant execute on function public.two_step_applies(text, text) to authenticated, service_role;

-- a company's setting; one with no row yet falls back to the old system_settings.mfa_enabled switch
create or replace function public.two_step_policy(p_tenant uuid)
returns table (mode text, method text)
language plpgsql stable security definer set search_path = public as $$
declare
  legacy boolean := false;
begin
  select s.two_step, s.two_step_method into mode, method
  from public.company_security_settings s where s.tenant_id = p_tenant;
  if found then
    return next;
    return;
  end if;
  begin
    select coalesce(s.mfa_enabled, false) into legacy from public.system_settings s where s.tenant_id = p_tenant and s.id = 1;
  exception when undefined_table then
    legacy := false;
  end;
  mode := case when coalesce(legacy, false) then 'privileged' else 'off' end;
  method := 'email';
  return next;
end $$;
revoke all on function public.two_step_policy(uuid) from public, anon, authenticated;
grant execute on function public.two_step_policy(uuid) to service_role;

-- has this sign-in (the session id in the caller's login token) passed the second step, and not long ago?
create or replace function public.mfa_passed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.mfa_sessions m
    where m.user_id = auth.uid()
      and m.session_id = (auth.jwt() ->> 'session_id')
      and m.expires_at > now()
  )
$$;
revoke all on function public.mfa_passed() from public, anon;
grant execute on function public.mfa_passed() to authenticated, service_role;

-- does this sign-in still need a code? True when the caller's company asks it of their role and this session has not
-- passed yet. The app asks after the password and on each page until it is false.
create or replace function public.mfa_required() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  t uuid := public.current_tenant_id();
  p record;
begin
  if t is null then
    return false;
  end if;
  select * into p from public.two_step_policy(t);
  if not public.two_step_applies(p.mode, public.current_user_role()) then
    return false;
  end if;
  return not public.mfa_passed();
end $$;
revoke all on function public.mfa_required() from public, anon;
grant execute on function public.mfa_required() to authenticated, service_role;

-- for policies that should hold only once the second step is done (or is not asked of this person):
-- use it as (select public.mfa_satisfied())
create or replace function public.mfa_satisfied() returns boolean
language sql stable security definer set search_path = public as $$
  select not public.mfa_required()
$$;
revoke all on function public.mfa_satisfied() from public, anon;
grant execute on function public.mfa_satisfied() to authenticated, service_role;

-- 5. The setting, for the settings page

-- the caller's company's setting; can_edit says whether they may change it (ADMIN)
create or replace function public.two_step_settings()
returns table (mode text, method text, can_edit boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  t uuid := public.current_tenant_id();
begin
  if t is null then
    raise exception 'You are not signed in to a company' using errcode = '42501';
  end if;
  select p.mode, p.method into mode, method from public.two_step_policy(t) p;
  can_edit := coalesce(public.current_user_role() = 'ADMIN', false);
  return next;
end $$;
revoke all on function public.two_step_settings() from public, anon;
grant execute on function public.two_step_settings() to authenticated;

create or replace function public.set_two_step_settings(p_mode text, p_method text)
returns table (mode text, method text, can_edit boolean)
language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.current_tenant_id();
begin
  if t is null or coalesce(public.current_user_role(), '') <> 'ADMIN' then
    raise exception 'Only an administrator can change two-step sign-in' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('off', 'privileged', 'everyone') then
    raise exception 'Choose off, admins HR and payroll, or everyone' using errcode = '22023';
  end if;
  if p_method is null or p_method not in ('email', 'sms') then
    raise exception 'Choose email or SMS' using errcode = '22023';
  end if;
  insert into public.company_security_settings as s (tenant_id, two_step, two_step_method, updated_by)
    values (t, p_mode, p_method, auth.uid())
    on conflict (tenant_id) do update set two_step = excluded.two_step, two_step_method = excluded.two_step_method,
      updated_by = excluded.updated_by, updated_at = now();
  return query select * from public.two_step_settings();
end $$;
revoke all on function public.set_two_step_settings(text, text) from public, anon;
grant execute on function public.set_two_step_settings(text, text) to authenticated;

-- 6. Making and checking codes (the server only)

/**
 * Records a new code for this sign-in (its hash only) and returns when it expires. Any earlier unused code of the same
 * sign-in stops working, so only the newest code counts.
 */
create or replace function public.mfa_issue_code(
  p_tenant uuid, p_user uuid, p_session text, p_email text, p_method text, p_sent_to text, p_code_hash text,
  p_ttl_seconds integer default 600
) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_expires timestamptz := now() + make_interval(secs => p_ttl_seconds);
begin
  if p_tenant is null or p_user is null or coalesce(p_session, '') = '' or coalesce(p_code_hash, '') = ''
     or p_method not in ('email', 'sms') or coalesce(p_ttl_seconds, 0) not between 60 and 3600 then
    raise exception 'mfa_issue_code: invalid arguments';
  end if;
  update public.mfa_codes set used = true where user_id = p_user and session_id = p_session and not coalesce(used, false);
  insert into public.mfa_codes (tenant_id, user_id, session_id, email, method, sent_to, phone_number, code_hash, expires_at)
    values (p_tenant, p_user, p_session, coalesce(p_email, ''), p_method, p_sent_to,
            case when p_method = 'sms' then p_sent_to end, p_code_hash, v_expires);
  return v_expires;
end $$;
revoke all on function public.mfa_issue_code(uuid, uuid, text, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.mfa_issue_code(uuid, uuid, text, text, text, text, text, integer) to service_role;

/**
 * Checks a code for this sign-in against its newest unused code. Each check uses one of p_max_attempts tries; a right
 * code is used up and records the pass in mfa_sessions for p_pass_hours. outcome: 'ok', 'wrong' (attempts_left says
 * how many are left), 'too_many', 'expired' or 'none' (no code to check: ask for one).
 */
create or replace function public.mfa_check_code(
  p_user uuid, p_session text, p_code_hash text, p_max_attempts integer default 5, p_pass_hours integer default 12
) returns table (outcome text, attempts_left integer)
language plpgsql security definer set search_path = public as $$
declare
  c record;
  n integer;
begin
  if p_user is null or coalesce(p_session, '') = '' or coalesce(p_code_hash, '') = ''
     or coalesce(p_max_attempts, 0) < 1 or coalesce(p_pass_hours, 0) not between 1 and 24 then
    raise exception 'mfa_check_code: invalid arguments';
  end if;

  -- one check at a time per code, so parallel guesses cannot get past the limit
  select m.id, m.tenant_id, m.method, m.code_hash, m.expires_at, m.attempts into c
  from public.mfa_codes m
  where m.user_id = p_user and m.session_id = p_session and not coalesce(m.used, false)
  order by m.created_at desc
  limit 1
  for update;

  if not found then
    outcome := 'none'; attempts_left := 0;
  elsif c.expires_at <= now() then
    outcome := 'expired'; attempts_left := 0;
  elsif c.attempts >= p_max_attempts then
    outcome := 'too_many'; attempts_left := 0;
  elsif c.code_hash = p_code_hash then
    update public.mfa_codes set used = true, attempts = attempts + 1 where id = c.id;
    insert into public.mfa_sessions (user_id, session_id, tenant_id, method, verified_at, expires_at)
      values (p_user, p_session, c.tenant_id, c.method, now(), now() + make_interval(hours => p_pass_hours))
      on conflict (user_id, session_id) do update set tenant_id = excluded.tenant_id, method = excluded.method,
        verified_at = excluded.verified_at, expires_at = excluded.expires_at;
    -- old passes are of no use to anyone
    delete from public.mfa_sessions where user_id = p_user and expires_at < now() - interval '1 day';
    outcome := 'ok'; attempts_left := p_max_attempts - c.attempts - 1;
  else
    update public.mfa_codes set attempts = attempts + 1 where id = c.id returning attempts into n;
    attempts_left := greatest(p_max_attempts - n, 0);
    outcome := case when attempts_left = 0 then 'too_many' else 'wrong' end;
  end if;
  return next;
end $$;
revoke all on function public.mfa_check_code(uuid, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.mfa_check_code(uuid, text, text, integer, integer) to service_role;

notify pgrst, 'reload schema';
