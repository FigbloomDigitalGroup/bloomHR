-- Door scanners: how each scanner's punches count, and how each punch was verified (FIG-1206).
--
-- Figbloom has one scanner at one door: the first scan of the day is the clock-in and the last the clock-out
-- (20261023600000). Other companies have two devices (one at the entrance, one at the exit), or scanners whose In/Out
-- keys say what a punch is. A ZKTeco ATTLOG line carries the key pressed (status: 0 check in, 1 check out, 2 break out,
-- 3 break in, 4 overtime in, 5 overtime out) and how the person was verified (verify: fingerprint, card, face...). Both
-- were stored but not used. Now:
--
--   attendance_devices.punch_mode        how this scanner's punches count; HR sets it when adding or changing a scanner
--                                        (granted like the other editable columns):
--                                          'first_last'   (the default) first scan of the day is the clock-in, the
--                                                         last the clock-out: one shared door. As before.
--                                          'in_only'      an entrance: a punch only sets the clock-in, or moves it
--                                                         earlier; it never sets the clock-out. With no record for the
--                                                         day yet, it creates one.
--                                          'out_only'     an exit: a punch only sets the clock-out, or moves it later,
--                                                         and only after the clock-in. Never a clock-in.
--                                          'device_keys'  the scanner's keys: status 0 as in_only, 1 as out_only;
--                                                         2-5 (break, overtime) are kept and shown but not counted
--                                                         (skipped_reason 'break' / 'overtime'); any other or no
--                                                         status as first_last.
--   attendance_scanner_punches.punch_mode
--                                        the scanner's mode when the punch arrived (set by a trigger), so changing a
--                                        scanner's mode applies to punches from then on: nothing already received is
--                                        counted again. Punches from before this migration have none: first_last.
--   attendance_scanner_punches.skipped_reason
--                                        + 'no_clock_in': an exit punch with no clock-in before it that day. It waits:
--                                          when a clock-in before it arrives later (an entrance punch, a first_last
--                                          scan, or HR's correction / an approved missed scan leaving the clock-out
--                                          open), it becomes the clock-out then. It is never made a clock-in. (An app
--                                          clock-in is always made after such a punch, so it never frees one.)
--                                        + 'break', 'overtime': device_keys statuses 2-5.
--   attendance_scanner_apply(punch)      20261025100000's, by the punch's role. An 'hr' day keeps what HR fixed
--                                        (hr_fixed_in / hr_fixed_out). first_last's clock-out (the latest punch after
--                                        the clock-in) now counts only punches that may be a clock-out, so an
--                                        entrance punch after lunch never becomes someone's clock-out.
--   attendance_write_day                 20261025100000's: a corrected day with an open clock-out also counts the
--                                        waiting exit punches after the clock-in, and takes its clock-out only from
--                                        punches that may be one; with a fixed clock-out they are held as
--                                        'hr_corrected'.
--   attendance_day_scans(employee, day)  20261023800000's, plus each scanner punch's verify, status and punch_mode
--                                        (new columns, so it is dropped and created again with the same grants).
--
-- Unchanged: the clock guard ('clock_ahead' punches are never applied), scanner user 0 and ignored users (never
-- matched, so never applied), attendance_tracking_from (not stored before it), and the odd-hours flag (a trigger on
-- attendance_logs, so it flags a day however its clock-in was set).
--
-- Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. the setting
-- ---------------------------------------------------------------------------------------------
alter table public.attendance_devices add column if not exists punch_mode text not null default 'first_last';
alter table public.attendance_devices drop constraint if exists attendance_devices_punch_mode_check;
alter table public.attendance_devices add constraint attendance_devices_punch_mode_check
  check (punch_mode in ('first_last', 'in_only', 'out_only', 'device_keys'));
-- HR sets it (the hr_write policy: manages_attendance), like the name, serial, IP lock and on/off
grant insert (punch_mode) on public.attendance_devices to authenticated;
grant update (punch_mode) on public.attendance_devices to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. each punch keeps the mode it arrived under
-- ---------------------------------------------------------------------------------------------
alter table public.attendance_scanner_punches add column if not exists punch_mode text;
alter table public.attendance_scanner_punches drop constraint if exists attendance_scanner_punches_punch_mode_check;
alter table public.attendance_scanner_punches add constraint attendance_scanner_punches_punch_mode_check
  check (punch_mode is null or punch_mode in ('first_last', 'in_only', 'out_only', 'device_keys'));

alter table public.attendance_scanner_punches drop constraint if exists attendance_scanner_punches_skipped_check;
alter table public.attendance_scanner_punches add constraint attendance_scanner_punches_skipped_check
  check (skipped_reason is null or skipped_reason in ('hr_corrected', 'clock_ahead', 'no_clock_in', 'break', 'overtime'));

create or replace function public.attendance_scanner_punches_mode() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.punch_mode is null then
    select d.punch_mode into new.punch_mode from public.attendance_devices d where d.id = new.device_id;
  end if;
  return new;
end $$;
revoke all on function public.attendance_scanner_punches_mode() from public, anon, authenticated;
drop trigger if exists attendance_scanner_punches_mode on public.attendance_scanner_punches;
create trigger attendance_scanner_punches_mode before insert on public.attendance_scanner_punches
  for each row execute function public.attendance_scanner_punches_mode();

-- What a punch may do, from its mode and the key pressed: 'in' (only the clock-in), 'out' (only the clock-out), 'both'
-- (first scan in, last scan out), or 'break' / 'overtime' (kept, not counted).
create or replace function public.attendance_scanner_punch_role(p_mode text, p_status smallint) returns text
language sql immutable as $$
  select case coalesce(p_mode, 'first_last')
    when 'in_only' then 'in'
    when 'out_only' then 'out'
    when 'device_keys' then
      case p_status
        when 0 then 'in'
        when 1 then 'out'
        when 2 then 'break'
        when 3 then 'break'
        when 4 then 'overtime'
        when 5 then 'overtime'
        else 'both'
      end
    else 'both'
  end
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. applying a punch
-- ---------------------------------------------------------------------------------------------
-- The exit punches of one person's day waiting for a clock-in ('no_clock_in') that now have one before them become
-- the clock-out. The number applied.
create or replace function public.attendance_scanner_apply_waiting(p_tenant uuid, p_employee text, p_day date) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_start timestamptz := p_day::timestamp at time zone 'Africa/Nairobi';
  v_in timestamptz;
  v_id uuid;
  v_n integer := 0;
begin
  select a.login_time into v_in from public.attendance_logs a
  where a.tenant_id = p_tenant and a.employee_number = p_employee and a.work_date = p_day and a.source <> 'legacy';
  if v_in is null then
    return 0;
  end if;
  for v_id in
    select x.id from public.attendance_scanner_punches x
    where x.tenant_id = p_tenant and x.employee_number = p_employee and x.skipped_reason = 'no_clock_in'
      and x.applied_at is null and x.punched_at > v_in
      and x.punched_at >= v_start and x.punched_at < v_start + interval '1 day'
    order by x.punched_at
  loop
    if public.attendance_scanner_apply(v_id) then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.attendance_scanner_apply_waiting(uuid, text, date) from public, anon, authenticated;

-- (20261025100000's, by the punch's role)
create or replace function public.attendance_scanner_apply(p_punch uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  p public.attendance_scanner_punches;
  r public.attendance_logs;
  v_role text;
  v_day date;
  v_start timestamptz;
  v_in timestamptz;
  v_last timestamptz;
  v_out timestamptz;
begin
  select * into p from public.attendance_scanner_punches x where x.id = p_punch for update;
  if p.id is null or p.employee_number is null or p.applied_at is not null then
    return false;
  end if;
  v_day := (p.punched_at at time zone 'Africa/Nairobi')::date;
  v_start := v_day::timestamp at time zone 'Africa/Nairobi';
  v_role := public.attendance_scanner_punch_role(p.punch_mode, p.status);

  -- break and overtime keys: kept and shown, not counted
  if v_role in ('break', 'overtime') then
    update public.attendance_scanner_punches set skipped_reason = v_role where id = p.id;
    return false;
  end if;

  -- an exit punch: only the clock-out, only after the clock-in
  if v_role = 'out' then
    select * into r from public.attendance_logs a
    where a.tenant_id = p.tenant_id and a.employee_number = p.employee_number and a.work_date = v_day and a.source <> 'legacy'
    for update;
    if r.id is not null and r.source = 'hr' and r.hr_fixed_out then
      update public.attendance_scanner_punches set skipped_reason = 'hr_corrected' where id = p.id;
      return false;
    end if;
    if r.id is null or r.login_time is null or p.punched_at <= r.login_time then
      -- waits for a clock-in before it (attendance_scanner_apply_waiting)
      update public.attendance_scanner_punches set skipped_reason = 'no_clock_in' where id = p.id;
      return false;
    end if;
    v_out := greatest(coalesce(r.logout_time, p.punched_at), p.punched_at);
    update public.attendance_logs set logout_time = v_out, status = 'clocked_out' where id = r.id;
    update public.attendance_scanner_punches set applied_at = now(), skipped_reason = null where id = p.id;
    return true;
  end if;

  -- the first punch of the day: the clock-in ('in' and 'both')
  insert into public.attendance_logs (tenant_id, employee_number, work_date, login_time, status, source)
  values (p.tenant_id, p.employee_number, v_day, p.punched_at, 'clocked_in', 'scanner')
  on conflict (tenant_id, employee_number, work_date) where source <> 'legacy' do nothing
  returning * into r;
  if r.id is not null then
    update public.attendance_scanner_punches set applied_at = now(), skipped_reason = null where id = p.id;
    perform public.attendance_scanner_apply_waiting(p.tenant_id, p.employee_number, v_day);
    return true;
  end if;

  select * into r from public.attendance_logs a
  where a.tenant_id = p.tenant_id and a.employee_number = p.employee_number and a.work_date = v_day and a.source <> 'legacy'
  for update;

  -- an entrance punch: only the clock-in, moved earlier
  if v_role = 'in' then
    if r.source = 'hr' and (r.login_time is null or r.hr_fixed_in) then
      update public.attendance_scanner_punches set skipped_reason = 'hr_corrected' where id = p.id;
      return false;
    end if;
    v_in := least(coalesce(r.login_time, p.punched_at), p.punched_at);
    if v_in is distinct from r.login_time then
      update public.attendance_logs set login_time = v_in where id = r.id;
    end if;
    update public.attendance_scanner_punches set applied_at = now(), skipped_reason = null where id = p.id;
    if v_in is distinct from r.login_time then
      perform public.attendance_scanner_apply_waiting(p.tenant_id, p.employee_number, v_day);
    end if;
    return true;
  end if;

  -- one shared door (first_last), as 20261025100000
  if r.source = 'hr' then
    if r.login_time is null
       or (r.hr_fixed_in and r.hr_fixed_out)
       or (p.punched_at < r.login_time and r.hr_fixed_in)
       or (p.punched_at > r.login_time and r.hr_fixed_out) then
      update public.attendance_scanner_punches set skipped_reason = 'hr_corrected' where id = p.id;
      return false;
    end if;
    -- what HR left open: an earlier clock-in, or a later clock-out
    v_in := least(r.login_time, p.punched_at);
    v_out := case
               when r.hr_fixed_out then r.logout_time
               when p.punched_at > r.login_time then greatest(coalesce(r.logout_time, p.punched_at), p.punched_at)
               else r.logout_time
             end;
    update public.attendance_logs
    set login_time = v_in, logout_time = v_out,
        status = case when v_out is null then 'clocked_in' else 'clocked_out' end
    where id = r.id;
    update public.attendance_scanner_punches set applied_at = now(), skipped_reason = null where id = p.id;
    if v_in < r.login_time then
      perform public.attendance_scanner_apply_waiting(p.tenant_id, p.employee_number, v_day);
    end if;
    return true;
  end if;

  v_in := least(coalesce(r.login_time, p.punched_at), p.punched_at);
  -- the clock-out: the latest of this employee's scanner punches that day after the clock-in that may be a clock-out
  select max(x.punched_at) into v_last
  from public.attendance_scanner_punches x
  where x.tenant_id = p.tenant_id and x.employee_number = p.employee_number
    and x.punched_at >= v_start and x.punched_at < v_start + interval '1 day'
    and (x.applied_at is not null or x.id = p.id)
    and x.punched_at > v_in
    and public.attendance_scanner_punch_role(x.punch_mode, x.status) in ('out', 'both');
  v_out := case when v_last is null then r.logout_time else greatest(coalesce(r.logout_time, v_last), v_last) end;
  update public.attendance_logs
  set login_time = v_in, logout_time = v_out, work_date = v_day,
      status = case when v_out is null then 'clocked_in' else 'clocked_out' end
  where id = r.id;
  update public.attendance_scanner_punches set applied_at = now(), skipped_reason = null where id = p.id;
  if v_in is distinct from r.login_time then
    perform public.attendance_scanner_apply_waiting(p.tenant_id, p.employee_number, v_day);
  end if;
  return true;
end $$;
revoke all on function public.attendance_scanner_apply(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. writing a corrected day
-- ---------------------------------------------------------------------------------------------
-- (20261025100000's, plus: the exit punches waiting for a clock-in count too, and only punches that may be a clock-out
-- give the clock-out; with a fixed clock-out, waiting exit punches are held as HR's)
create or replace function public.attendance_write_day(
  p_tenant uuid, p_employee text, p_date date, p_in timestamptz, p_out timestamptz, p_out_fixed boolean, p_note text, p_by uuid
) returns public.attendance_logs
language plpgsql security definer set search_path = public as $$
declare
  v_start timestamptz := p_date::timestamp at time zone 'Africa/Nairobi';
  v_out timestamptz := p_out;
  v_scan timestamptz;
  r public.attendance_logs;
begin
  if not p_out_fixed then
    -- punches held back only because HR had corrected the day, or waiting for a clock-in, count again
    update public.attendance_scanner_punches x
    set applied_at = coalesce(x.applied_at, now()), skipped_reason = null
    where x.tenant_id = p_tenant and x.employee_number = p_employee and x.skipped_reason in ('hr_corrected', 'no_clock_in')
      and x.punched_at > p_in and x.punched_at >= v_start and x.punched_at < v_start + interval '1 day';
    select max(x.punched_at) into v_scan
    from public.attendance_scanner_punches x
    where x.tenant_id = p_tenant and x.employee_number = p_employee
      and x.applied_at is not null and x.skipped_reason is null
      and x.punched_at > p_in and x.punched_at >= v_start and x.punched_at < v_start + interval '1 day'
      and public.attendance_scanner_punch_role(x.punch_mode, x.status) in ('out', 'both');
    v_out := greatest(case when p_out > p_in then p_out end, v_scan);
  else
    update public.attendance_scanner_punches x
    set skipped_reason = 'hr_corrected'
    where x.tenant_id = p_tenant and x.employee_number = p_employee and x.skipped_reason = 'no_clock_in'
      and x.punched_at >= v_start and x.punched_at < v_start + interval '1 day';
  end if;

  select * into r from public.attendance_logs a
  where a.tenant_id = p_tenant and a.employee_number = p_employee and a.work_date = p_date and a.source <> 'legacy'
  for update;
  if r.id is null then
    insert into public.attendance_logs (tenant_id, employee_number, work_date, login_time, logout_time, status, source, note,
                                        edited_by, edited_at, hr_fixed_in, hr_fixed_out)
    values (p_tenant, p_employee, p_date, p_in, v_out, case when v_out is null then 'clocked_in' else 'clocked_out' end,
            'hr', p_note, p_by, now(), true, p_out_fixed)
    returning * into r;
  else
    update public.attendance_logs
    set login_time = p_in, logout_time = v_out, work_date = p_date,
        status = case when v_out is null then 'clocked_in' else 'clocked_out' end,
        source = 'hr', note = p_note, edited_by = p_by, edited_at = now(),
        hr_fixed_in = true, hr_fixed_out = p_out_fixed
    where id = r.id
    returning * into r;
  end if;
  return r;
end $$;
revoke all on function public.attendance_write_day(uuid, text, date, timestamptz, timestamptz, boolean, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. every scan behind one day, with how it was verified and the key pressed
-- ---------------------------------------------------------------------------------------------
-- (20261023800000's, plus verify, status and punch_mode for scanner punches; null for the app's and HR's times.
-- held reasons now also 'no_clock_in', 'break', 'overtime')
drop function if exists public.attendance_day_scans(text, date);
create function public.attendance_day_scans(p_employee text, p_date date)
returns table (punched_at timestamptz, via text, scanner_name text, kind text, reason text,
               verify smallint, status smallint, punch_mode text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.current_tenant_id();
  v_start timestamptz;
  r public.attendance_logs;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_employee is null or p_date is null then
    raise exception 'Choose a person and a day' using errcode = '22023';
  end if;
  if not public.sees_attendance() and p_employee is distinct from public.current_employee_number()
     and p_employee not in (select public.supervised_employee_numbers()) then
    raise exception 'You can see your own attendance and your team''s only' using errcode = '42501';
  end if;
  v_start := p_date::timestamp at time zone 'Africa/Nairobi';
  select * into r from public.attendance_logs a
  where a.tenant_id = v_tenant and a.employee_number = p_employee and a.work_date = p_date and a.source <> 'legacy';

  return query
  with punches as (
    select x.punched_at as t, d.name, x.applied_at, x.skipped_reason, x.verify as pv, x.status as ps,
           coalesce(x.punch_mode, 'first_last') as pm
    from public.attendance_scanner_punches x
    join public.attendance_devices d on d.id = x.device_id
    where x.tenant_id = v_tenant and x.employee_number = p_employee
      and x.punched_at >= v_start and x.punched_at < v_start + interval '1 day'
  ),
  entries as (
    select p.t, 'scanner'::text as via, p.name as scanner_name,
           case
             when p.skipped_reason is not null then 'held'
             when p.applied_at is null then 'waiting'
             when p.t = r.login_time then 'clock_in'
             when p.t = r.logout_time then 'clock_out'
             else 'between'
           end as kind,
           p.skipped_reason as reason,
           p.pv, p.ps, p.pm,
           0 as pos
    from punches p
    union all
    select r.login_time, r.source, null, 'clock_in', null, null::smallint, null::smallint, null::text, 1
    where r.login_time is not null
      and not exists (select 1 from punches p where p.applied_at is not null and p.skipped_reason is null and p.t = r.login_time)
    union all
    select r.logout_time, r.source, null, 'clock_out', null, null::smallint, null::smallint, null::text, 1
    where r.logout_time is not null
      and not exists (select 1 from punches p where p.applied_at is not null and p.skipped_reason is null and p.t = r.logout_time)
  )
  select e.t, e.via, e.scanner_name, e.kind, e.reason, e.pv, e.ps, e.pm
  from entries e
  order by e.t, e.pos, e.scanner_name;
end $$;
revoke all on function public.attendance_day_scans(text, date) from public, anon;
grant execute on function public.attendance_day_scans(text, date) to authenticated, service_role;

notify pgrst, 'reload schema';
