-- How long people stay signed in: a company setting (users asked to stay signed in for a week, Oct 26).
--
-- company_security_settings.stay_signed_in_minutes: 30 minutes, 8 hours, 1 day or 7 days (the default). It is
--   * how long someone may be away from every tab before the app signs them out (App.tsx, lib/idleLogout.ts), and
--   * how long a passed sign-in code is trusted before it is asked again (mfa_check_code; never under 12 hours, as
--     before, so a short idle limit doesn't also mean a code twice a day).
-- Anyone signed in reads it (their app needs it); people whose role has Sign-in security change it.

alter table public.company_security_settings
  add column if not exists stay_signed_in_minutes integer not null default 10080;
alter table public.company_security_settings drop constraint if exists company_security_settings_stay_signed_in_check;
alter table public.company_security_settings add constraint company_security_settings_stay_signed_in_check
  check (stay_signed_in_minutes in (30, 480, 1440, 10080));

-- a company's setting (7 days for one with no row)
create or replace function public.company_stay_signed_in_minutes(p_tenant uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select s.stay_signed_in_minutes from public.company_security_settings s where s.tenant_id = p_tenant), 10080)
$$;
revoke all on function public.company_stay_signed_in_minutes(uuid) from public, anon, authenticated;
grant execute on function public.company_stay_signed_in_minutes(uuid) to service_role;

-- the caller's company's setting, and whether they may change it
create or replace function public.stay_signed_in_settings()
returns table (minutes integer, can_edit boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  t uuid := public.current_tenant_id();
begin
  if t is null then
    raise exception 'You are not signed in to a company' using errcode = '42501';
  end if;
  minutes := public.company_stay_signed_in_minutes(t);
  can_edit := coalesce(public.has_module('sign-in-security'), false);
  return next;
end $$;
revoke all on function public.stay_signed_in_settings() from public, anon;
grant execute on function public.stay_signed_in_settings() to authenticated;

create or replace function public.set_stay_signed_in(p_minutes integer)
returns table (minutes integer, can_edit boolean)
language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.current_tenant_id();
begin
  if t is null or not public.has_module('sign-in-security') then
    raise exception 'Only an administrator can change how long people stay signed in' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes not in (30, 480, 1440, 10080) then
    raise exception 'Choose 30 minutes, 8 hours, 1 day or 7 days' using errcode = '22023';
  end if;
  insert into public.company_security_settings as s (tenant_id, stay_signed_in_minutes, updated_by)
    values (t, p_minutes, auth.uid())
    on conflict (tenant_id) do update set stay_signed_in_minutes = excluded.stay_signed_in_minutes,
      updated_by = excluded.updated_by, updated_at = now();
  return query select * from public.stay_signed_in_settings();
end $$;
revoke all on function public.set_stay_signed_in(integer) from public, anon;
grant execute on function public.set_stay_signed_in(integer) to authenticated;

/**
 * Checks a sign-in code (server only), as before; a correct one records the pass in mfa_sessions. With p_pass_hours
 * null the pass lasts as long as the company keeps people signed in (at least 12 hours); a number (1 to 168) is used
 * as given.
 */
create or replace function public.mfa_check_code(
  p_user uuid, p_session text, p_code_hash text, p_max_attempts integer default 5, p_pass_hours integer default 12
) returns table (outcome text, attempts_left integer)
language plpgsql security definer set search_path = public as $$
declare
  c record;
  n integer;
  v_hours integer;
begin
  if p_user is null or coalesce(p_session, '') = '' or coalesce(p_code_hash, '') = ''
     or coalesce(p_max_attempts, 0) < 1 or (p_pass_hours is not null and p_pass_hours not between 1 and 168) then
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
    v_hours := coalesce(p_pass_hours, greatest(12, ceil(public.company_stay_signed_in_minutes(c.tenant_id) / 60.0)::integer));
    update public.mfa_codes set used = true, attempts = attempts + 1 where id = c.id;
    insert into public.mfa_sessions (user_id, session_id, tenant_id, method, verified_at, expires_at)
      values (p_user, p_session, c.tenant_id, c.method, now(), now() + make_interval(hours => v_hours))
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
