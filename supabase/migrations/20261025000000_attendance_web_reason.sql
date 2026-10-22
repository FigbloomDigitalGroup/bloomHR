-- Why a person clocks in or out via the web app, not the biometric scanner (FIG-XXXX).
--
-- Attendance is normally recorded at a door scanner. When someone uses the staff portal instead, they now
-- have to say why (e.g. "Working remotely today", "Scanner unavailable"). The reason is passed from the
-- browser through the backend (attendance_routes.js) and stored in attendance_logs.web_reason. Scanner
-- punches and HR corrections leave it null.
--
-- attendance_app_punch, attendance_clock_in, attendance_clock_out and attendance_clock_for_user each gain
-- an optional p_reason parameter. The old four-arg attendance_clock_for_user is dropped and replaced with a
-- five-arg version; the others gain a default so callers that omit the reason still work.
--
-- On clock-in the reason is stored immediately. On clock-out it is stored only when the row has no reason
-- yet (clock-in was via scanner), so a remote worker's clock-in reason is never overwritten.
--
-- Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. the column
-- ---------------------------------------------------------------------------------------------
alter table public.attendance_logs add column if not exists web_reason text;
alter table public.attendance_logs drop constraint if exists attendance_logs_web_reason_check;
alter table public.attendance_logs add constraint attendance_logs_web_reason_check
  check (web_reason is null or (length(btrim(web_reason)) >= 1 and length(web_reason) <= 300));

-- ---------------------------------------------------------------------------------------------
-- 2. the punch function (20261024100000's; gains p_reason)
-- ---------------------------------------------------------------------------------------------
-- drop the old signature so create-or-replace doesn't create a second overload
drop function if exists public.attendance_app_punch(uuid, text, text, jsonb, text, timestamptz);

create or replace function public.attendance_app_punch(
  p_tenant uuid, p_employee text, p_kind text, p_location jsonb, p_ip text, p_at timestamptz,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb := public.attendance_clock_check(p_tenant, p_employee, p_kind, p_location, p_ip, p_at);
  v_day date := (p_at at time zone 'Africa/Nairobi')::date;
  v_loc jsonb := public.attendance_location(p_location);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  r public.attendance_logs;
begin
  if not coalesce((v ->> 'ok')::boolean, false) then
    raise exception '%', v ->> 'message' using errcode = 'P0001', hint = 'clock_policy';
  end if;

  if p_kind = 'out' then
    -- the person presses Clock out after the scanner's latest scan: their clock-out, at the later time
    select * into r from public.attendance_logs a
    where a.tenant_id = p_tenant and a.employee_number = p_employee and a.work_date = v_day and a.source <> 'legacy'
    for update;
    if r.id is not null and r.source <> 'hr' and r.logout_time is not null and p_at > r.logout_time
       and exists (select 1 from public.attendance_scanner_punches x
                   where x.tenant_id = p_tenant and x.employee_number = p_employee and x.punched_at = r.logout_time
                     and x.applied_at is not null and x.skipped_reason is null) then
      update public.attendance_logs
      set logout_time = p_at, status = 'clocked_out',
          geolocation = case when v_loc is not null then coalesce(geolocation, '{}'::jsonb) || jsonb_build_object('out', v_loc) else geolocation end,
          web_reason = coalesce(web_reason, v_reason)
      where id = r.id;
      return public.attendance_today_for(p_tenant, p_employee, p_at);
    end if;
  end if;

  perform public.attendance_punch(p_tenant, p_employee, p_kind, p_location, p_at);
  if p_kind = 'in' then
    -- only when this punch made the clock-in (not a clock-in again after clocking out, or a scanner's day)
    update public.attendance_logs a
    set place = v ->> 'place', place_detail = v ->> 'detail', web_reason = v_reason
    where a.tenant_id = p_tenant and a.employee_number = p_employee and a.work_date = v_day and a.source = 'app'
      and a.login_time = p_at;
  elsif p_kind = 'out' and v_reason is not null then
    -- clock-out via web when clock-in was via scanner: store the reason on the day's record
    update public.attendance_logs a
    set web_reason = coalesce(a.web_reason, v_reason)
    where a.tenant_id = p_tenant and a.employee_number = p_employee and a.work_date = v_day and a.source <> 'legacy';
  end if;
  return public.attendance_today_for(p_tenant, p_employee, p_at);
end $$;
revoke all on function public.attendance_app_punch(uuid, text, text, jsonb, text, timestamptz, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. the public clock functions (20261024100000's; gain p_reason)
-- ---------------------------------------------------------------------------------------------
drop function if exists public.attendance_clock_in(jsonb);
create or replace function public.attendance_clock_in(p_location jsonb default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me record;
begin
  select * into me from public.attendance_me();
  return public.attendance_app_punch(me.tenant_id, me.employee_number, 'in', p_location, null, now(), p_reason);
end $$;
revoke all on function public.attendance_clock_in(jsonb, text) from public, anon;
grant execute on function public.attendance_clock_in(jsonb, text) to authenticated;

drop function if exists public.attendance_clock_out(jsonb);
create or replace function public.attendance_clock_out(p_location jsonb default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me record;
begin
  select * into me from public.attendance_me();
  return public.attendance_app_punch(me.tenant_id, me.employee_number, 'out', p_location, null, now(), p_reason);
end $$;
revoke all on function public.attendance_clock_out(jsonb, text) from public, anon;
grant execute on function public.attendance_clock_out(jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. the backend clock (20261024100000's; gains p_reason)
-- ---------------------------------------------------------------------------------------------
drop function if exists public.attendance_clock_for_user(uuid, text, jsonb, text);
create or replace function public.attendance_clock_for_user(
  p_user uuid, p_kind text, p_location jsonb, p_ip text, p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_emp text;
begin
  select p.tenant_id into v_tenant
  from public.user_profiles p join public.tenants t on t.id = p.tenant_id
  where p.user_id = p_user and t.status = 'active';
  if p_user is null or v_tenant is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select e."Employee Number" into v_emp
  from public.employees e join auth.users u on u.id = p_user
  where e.tenant_id = v_tenant and e."Work Email" = u.email
  limit 1;
  if v_emp is null then
    raise exception 'Your account isn''t linked to an employee record, so attendance can''t be recorded. Please contact HR.'
      using errcode = '42501';
  end if;
  if p_kind not in ('in', 'out') then
    raise exception 'Unknown clock action' using errcode = '22023';
  end if;
  return public.attendance_app_punch(v_tenant, v_emp, p_kind, p_location, p_ip, now(), p_reason);
end $$;
revoke all on function public.attendance_clock_for_user(uuid, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.attendance_clock_for_user(uuid, text, jsonb, text, text) to service_role;

notify pgrst, 'reload schema';
