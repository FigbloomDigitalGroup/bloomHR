-- Clock in / clock out, work schedules and the days HR sees (FIG-986, first half).
--
-- attendance_logs got a "login" row every time someone opened the staff portal and a logout when they signed out, and
-- its policies quietly refused ordinary staff, so it said nothing about attendance. Attendance is about to feed KPIs
-- (attendance rate, punctuality), so it becomes a deliberate Clock in / Clock out, measured against a schedule:
--
--   work_schedules               when the company works: the days (ISO 1 = Monday ... 7 = Sunday), the start and end
--                                time and the minutes of grace before someone counts as late. One company default
--                                (branch_id null) and at most one per branch, which overrides it for that branch's
--                                staff. No row at all = Monday to Friday, 08:00 to 17:00, 30 minutes' grace (late =
--                                clocked in after 08:30). Everyone in the company reads them; HR (the Employees or HR
--                                Lifecycle module) and Settings change them.
--   work_schedule_for(t, emp)    the schedule one employee works to: their branch's (no branch = the default branch),
--                                else the company's, else the built-in one.
--   attendance_logs              one record per employee per working day (work_date, the Africa/Nairobi day):
--                                login_time = clock in, logout_time = clock out, where it came from (source: 'app',
--                                'hr' for a correction, 'scanner' for a door scanner later, 'legacy' for the old
--                                portal-open rows, which are kept but never counted), HR's note and who edited it last.
--                                Nobody writes it directly any more: staff clock in and out, and HR corrects, through
--                                the functions below. Staff read their own, managers their reports', HR everyone's.
--   attendance_clock_in(loc)     the signed-in employee clocks in for today (again after clocking out: the clock-out is
--                                cleared, the first clock-in kept). attendance_clock_out(loc) clocks them out; refused
--                                before they clocked in. Both return what attendance_today() returns.
--   attendance_today()           the signed-in employee's record for today and today's schedule, for the portal card.
--   attendance_set_day(...)      HR records or corrects one day (a note is required); attendance_remove_day(...) removes
--                                it.
--   attendance_days(from, to, emp)
--                                one row per employee per day: present, late, absent, leave, holiday or off, with the
--                                clock in and out, hours and minutes late. For HR (everyone), managers (their reports)
--                                and each employee (themselves). attendance_days_for(tenant, ...) is the same without
--                                the access check, for the system (calculated KPIs).
--
-- How a day is classed, in this order:
--   off       not one of the employee's working days
--   holiday   a public holiday for the employee's country (holidays with no country are everyone's; is_holiday)
--   leave     approved leave covering the day (a half day counts as leave)
--   late      clocked in after the start time plus the grace minutes (to the minute: 08:30 is on time, 08:31 late)
--   present   clocked in
--   absent    a past working day with no clock-in
--   (null)    today (until the day is over) or a future day with no clock-in yet: not known
-- Days before the employee's Start Date, or after their Termination Date, are left out; so are casual workers (their
-- days are kept in the casual register). Times are Africa/Nairobi, like the rest of the app (Tanzania and Uganda are
-- on the same time).
--
-- Written to run again safely (if not exists / or replace / drop ... if exists).

-- ---------------------------------------------------------------------------------------------
-- 1. who sees and who changes attendance
-- ---------------------------------------------------------------------------------------------
-- reads everyone's: the modules that read attendance_logs before
create or replace function public.sees_attendance() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and coalesce(public.has_any_module('employees', 'hr-lifecycle', 'reports'), false)
$$;
revoke all on function public.sees_attendance() from public, anon;
grant execute on function public.sees_attendance() to authenticated, service_role;

-- corrects days and sets schedules: HR
create or replace function public.manages_attendance() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and coalesce(public.has_any_module('employees', 'hr-lifecycle'), false)
$$;
revoke all on function public.manages_attendance() from public, anon;
grant execute on function public.manages_attendance() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. work schedules
-- ---------------------------------------------------------------------------------------------
-- 1 to 7 distinct ISO days (1 = Monday), at least one
create or replace function public.valid_work_days(p smallint[]) returns boolean
language sql immutable as $$
  select p is not null and array_ndims(p) = 1 and cardinality(p) between 1 and 7
     and p <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
     and cardinality(p) = (select count(distinct d) from unnest(p) d)
$$;

create table if not exists public.work_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  work_days smallint[] not null default array[1, 2, 3, 4, 5]::smallint[],
  start_time time not null default '08:00',
  end_time time not null default '17:00',
  grace_minutes integer not null default 30,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.work_schedules drop constraint if exists work_schedules_days_check;
alter table public.work_schedules add constraint work_schedules_days_check check (public.valid_work_days(work_days));
alter table public.work_schedules drop constraint if exists work_schedules_grace_check;
alter table public.work_schedules add constraint work_schedules_grace_check check (grace_minutes between 0 and 240);
alter table public.work_schedules drop constraint if exists work_schedules_times_check;
alter table public.work_schedules add constraint work_schedules_times_check check (end_time > start_time);
-- one company default, one per branch
create unique index if not exists work_schedules_company_key on public.work_schedules (tenant_id) where branch_id is null;
create unique index if not exists work_schedules_branch_key on public.work_schedules (tenant_id, branch_id) where branch_id is not null;

create or replace function public.work_schedules_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.tenant_id := old.tenant_id;
  end if;
  if new.branch_id is not null
     and not exists (select 1 from public.branches b where b.id = new.branch_id and b.tenant_id = new.tenant_id) then
    raise exception 'Unknown branch' using errcode = '23503';
  end if;
  -- the days in order, each once
  if new.work_days is not null and array_ndims(new.work_days) = 1 then
    select array_agg(distinct d order by d) into new.work_days from unnest(new.work_days) d where d is not null;
  end if;
  if new.work_days is null or cardinality(new.work_days) = 0 then
    raise exception 'Choose at least one working day' using errcode = '23514';
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.work_schedules_rules() from public, anon, authenticated;
drop trigger if exists work_schedules_rules on public.work_schedules;
create trigger work_schedules_rules before insert or update on public.work_schedules
  for each row execute function public.work_schedules_rules();

alter table public.work_schedules enable row level security;
drop policy if exists tenant_isolation on public.work_schedules;
create policy tenant_isolation on public.work_schedules as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists members_read on public.work_schedules;
create policy members_read on public.work_schedules for select to authenticated using (true);
drop policy if exists hr_write on public.work_schedules;
create policy hr_write on public.work_schedules for all to authenticated
  using ((select public.manages_attendance()) or (select public.has_module('settings')))
  with check ((select public.manages_attendance()) or (select public.has_module('settings')));
revoke all on public.work_schedules from anon;
revoke truncate on public.work_schedules from authenticated;
grant select, insert, update, delete on public.work_schedules to authenticated;

-- the schedule one employee works to: their branch's (no branch = the default branch), the company's, the built-in one
create or replace function public.work_schedule_for(p_tenant uuid, p_employee text)
returns table (work_days smallint[], start_time time, end_time time, grace_minutes integer, branch_id uuid)
language sql stable security definer set search_path = public as $$
  with mine as (
    select coalesce(
      (select e.branch_id from public.employees e where e.tenant_id = p_tenant and e."Employee Number" = p_employee limit 1),
      (select b.id from public.branches b where b.tenant_id = p_tenant and b.is_default limit 1)) as branch_id
  )
  select x.work_days, x.start_time, x.end_time, x.grace_minutes, x.branch_id
  from (
    select s.work_days, s.start_time, s.end_time, s.grace_minutes, s.branch_id, 1 as pick
    from public.work_schedules s, mine
    where s.tenant_id = p_tenant and s.branch_id = mine.branch_id
    union all
    select s.work_days, s.start_time, s.end_time, s.grace_minutes, null, 2
    from public.work_schedules s
    where s.tenant_id = p_tenant and s.branch_id is null
    union all
    select array[1, 2, 3, 4, 5]::smallint[], '08:00'::time, '17:00'::time, 30, null, 3
  ) x
  order by x.pick
  limit 1
$$;
revoke all on function public.work_schedule_for(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. attendance_logs: one record per employee per day
-- ---------------------------------------------------------------------------------------------
alter table public.attendance_logs add column if not exists work_date date;
alter table public.attendance_logs add column if not exists source text;
alter table public.attendance_logs add column if not exists note text;
alter table public.attendance_logs add column if not exists edited_by uuid references auth.users(id) on delete set null;
alter table public.attendance_logs add column if not exists edited_at timestamptz;

-- the rows written so far were portal-open logins: kept, never counted
update public.attendance_logs set source = 'legacy' where source is null;
update public.attendance_logs set work_date = (login_time at time zone 'Africa/Nairobi')::date
where work_date is null and login_time is not null;

alter table public.attendance_logs alter column source set default 'app';
alter table public.attendance_logs alter column source set not null;
alter table public.attendance_logs drop constraint if exists attendance_logs_source_check;
alter table public.attendance_logs add constraint attendance_logs_source_check
  check (source in ('app', 'hr', 'scanner', 'legacy'));
alter table public.attendance_logs drop constraint if exists attendance_logs_note_check;
alter table public.attendance_logs add constraint attendance_logs_note_check check (note is null or length(note) <= 500);

create unique index if not exists attendance_logs_one_per_day
  on public.attendance_logs (tenant_id, employee_number, work_date) where source <> 'legacy';
create index if not exists attendance_logs_tenant_day_idx on public.attendance_logs (tenant_id, work_date);

-- another writer (a door scanner) may give only the clock-in: the day follows from it
create or replace function public.attendance_logs_fill_day() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.work_date is null and new.login_time is not null then
    new.work_date := (new.login_time at time zone 'Africa/Nairobi')::date;
  end if;
  return new;
end $$;
revoke all on function public.attendance_logs_fill_day() from public, anon, authenticated;
drop trigger if exists attendance_logs_fill_day on public.attendance_logs;
create trigger attendance_logs_fill_day before insert or update of login_time, work_date on public.attendance_logs
  for each row execute function public.attendance_logs_fill_day();

-- reading: staff their own, managers their reports', HR everyone's. Writing only through the functions below.
alter table public.attendance_logs enable row level security;
drop policy if exists module_access on public.attendance_logs;
drop policy if exists own_insert on public.attendance_logs;
drop policy if exists own_update on public.attendance_logs;
drop policy if exists own_select on public.attendance_logs;
create policy own_select on public.attendance_logs for select to authenticated
  using (employee_number = (select public.current_employee_number()));
drop policy if exists hr_read on public.attendance_logs;
create policy hr_read on public.attendance_logs for select to authenticated
  using ((select public.sees_attendance()));
drop policy if exists team_read on public.attendance_logs;
create policy team_read on public.attendance_logs for select to authenticated
  using (employee_number in (select public.supervised_employee_numbers()));
revoke all on public.attendance_logs from anon;
revoke all on sequence public.attendance_logs_id_seq from anon;
revoke insert, update, delete, truncate on public.attendance_logs from authenticated;
grant select on public.attendance_logs to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. the days: present, late, absent, leave, holiday, off
-- ---------------------------------------------------------------------------------------------
-- For the system (no access check): p_today is the day counted up to (absent only before it), today in Nairobi when
-- left out.
create or replace function public.attendance_days_for(
  p_tenant uuid, p_from date, p_to date, p_employee text default null, p_today date default null
) returns table (
  employee_number text, day date, status text, clock_in timestamptz, clock_out timestamptz, hours numeric,
  late_minutes integer, source text, note text
)
language sql stable security definer set search_path = public as $$
  with people as (
    select e."Employee Number" as emp,
           public.employee_start_date(e."Start Date") as hired,
           public.employee_start_date(e."Termination Date") as left_on,
           public.employee_country(p_tenant, e."Employee Number") as country,
           s.work_days, s.start_time, s.grace_minutes
    from public.employees e
    cross join lateral public.work_schedule_for(p_tenant, e."Employee Number") s
    where e.tenant_id = p_tenant
      and (p_employee is null or e."Employee Number" = p_employee)
      and coalesce(e.worker_kind, 'employee') <> 'casual'
      -- still here, or left during (or after) the range
      and (lower(coalesce(e."Status", 'active')) not in ('terminated', 'inactive')
           or public.employee_start_date(e."Termination Date") >= p_from)
  ),
  days as (
    select g::date as day from generate_series(p_from, p_to, interval '1 day') g
  ),
  grid as (
    select p.*, d.day,
           (extract(isodow from d.day)::smallint = any (p.work_days)) as working,
           public.is_holiday(p_tenant, p.country, d.day) as holiday,
           exists (
             select 1 from public.leave_application l
             where l.tenant_id = p_tenant and l."Employee Number" = p.emp
               and lower(coalesce(l.status, '')) = 'approved'
               and public.leave_parse_date(l."Start Date") <= d.day
               and public.leave_parse_date(l."End Date") >= d.day
           ) as on_leave,
           a.login_time, a.logout_time, a.source, a.note,
           date_trunc('minute', a.login_time at time zone 'Africa/Nairobi') as in_local
    from people p
    cross join days d
    left join public.attendance_logs a
      on a.tenant_id = p_tenant and a.employee_number = p.emp and a.work_date = d.day and a.source <> 'legacy'
    where (p.hired is null or d.day >= p.hired)
      and (p.left_on is null or d.day <= p.left_on)
  )
  select g.emp,
         g.day,
         case
           when not g.working then 'off'
           when g.holiday then 'holiday'
           when g.on_leave then 'leave'
           when g.login_time is not null then
             case when g.in_local > g.day + g.start_time + make_interval(mins => g.grace_minutes) then 'late' else 'present' end
           when g.day < coalesce(p_today, (now() at time zone 'Africa/Nairobi')::date) then 'absent'
           else null
         end,
         g.login_time,
         g.logout_time,
         case when g.login_time is not null and g.logout_time is not null
              then round((extract(epoch from (g.logout_time - g.login_time)) / 3600.0)::numeric, 2) end,
         case
           when g.login_time is null then null
           when g.working and not g.holiday and not g.on_leave
                and g.in_local > g.day + g.start_time + make_interval(mins => g.grace_minutes)
             then (extract(epoch from (g.in_local - (g.day + g.start_time))) / 60)::integer
           else 0
         end,
         g.source,
         g.note
  from grid g
  order by g.emp, g.day
$$;
revoke all on function public.attendance_days_for(uuid, date, date, text, date) from public, anon, authenticated;

-- For people: HR sees everyone, a manager their reports, everyone themselves. Run by the system (no signed-in user,
-- e.g. from a security definer job) the check is skipped; the system should call attendance_days_for with a company.
create or replace function public.attendance_days(p_from date, p_to date, p_employee text default null)
returns table (
  employee_number text, day date, status text, clock_in timestamptz, clock_out timestamptz, hours numeric,
  late_minutes integer, source text, note text
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.current_tenant_id();
  v_all boolean := true;
  v_me text;
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Choose a start date on or before the end date' using errcode = '22023';
  end if;
  if p_to - p_from > 366 then
    raise exception 'Choose a range of a year or less' using errcode = '22023';
  end if;
  if auth.uid() is not null then
    if v_tenant is null then
      raise exception 'Sign in first' using errcode = '42501';
    end if;
    v_all := public.sees_attendance();
    if not v_all then
      v_me := public.current_employee_number();
      if p_employee is not null and p_employee is distinct from v_me
         and p_employee not in (select public.supervised_employee_numbers()) then
        raise exception 'You can see your own attendance and your team''s only' using errcode = '42501';
      end if;
    end if;
  end if;
  return query
    select d.employee_number, d.day, d.status, d.clock_in, d.clock_out, d.hours, d.late_minutes, d.source, d.note
    from public.attendance_days_for(v_tenant, p_from, p_to, p_employee, null) d
    where v_all
       or d.employee_number = v_me
       or d.employee_number in (select public.supervised_employee_numbers());
end $$;
revoke all on function public.attendance_days(date, date, text) from public, anon;
grant execute on function public.attendance_days(date, date, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. clocking in and out
-- ---------------------------------------------------------------------------------------------
-- a location the browser gave (latitude, longitude, accuracy...): kept when it is a small object, otherwise dropped
create or replace function public.attendance_location(p jsonb) returns jsonb
language sql immutable as $$
  select case when p is not null and jsonb_typeof(p) = 'object' and length(p::text) <= 500 then p end
$$;

-- One employee's day as of p_at, for the portal card: the record, the schedule and how the day stands.
create or replace function public.attendance_today_for(p_tenant uuid, p_employee text, p_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_day date := (p_at at time zone 'Africa/Nairobi')::date;
  s record;
  d record;
  r public.attendance_logs;
begin
  select * into s from public.work_schedule_for(p_tenant, p_employee);
  select * into d from public.attendance_days_for(p_tenant, v_day, v_day, p_employee, v_day);
  select * into r from public.attendance_logs a
  where a.tenant_id = p_tenant and a.employee_number = p_employee and a.work_date = v_day and a.source <> 'legacy';
  return jsonb_build_object(
    'date', v_day,
    'employee_number', p_employee,
    'status', d.status,
    'clock_in', r.login_time,
    'clock_out', r.logout_time,
    'late_minutes', d.late_minutes,
    'source', r.source,
    'note', r.note,
    'working_day', extract(isodow from v_day)::smallint = any (s.work_days),
    'work_days', to_jsonb(s.work_days),
    'start_time', to_char(s.start_time, 'HH24:MI'),
    'end_time', to_char(s.end_time, 'HH24:MI'),
    'grace_minutes', s.grace_minutes,
    'late_after', to_char(s.start_time + make_interval(mins => s.grace_minutes), 'HH24:MI'));
end $$;
revoke all on function public.attendance_today_for(uuid, text, timestamptz) from public, anon, authenticated;

-- Clocks one employee in ('in') or out ('out') at p_at. For the system and tests; people use the functions below.
create or replace function public.attendance_punch(p_tenant uuid, p_employee text, p_kind text, p_location jsonb, p_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_day date := (p_at at time zone 'Africa/Nairobi')::date;
  v_loc jsonb := public.attendance_location(p_location);
  r public.attendance_logs;
begin
  if p_kind not in ('in', 'out') then
    raise exception 'Unknown clock action' using errcode = '22023';
  end if;
  select * into r from public.attendance_logs a
  where a.tenant_id = p_tenant and a.employee_number = p_employee and a.work_date = v_day and a.source <> 'legacy'
  for update;

  if p_kind = 'in' then
    if r.id is null then
      insert into public.attendance_logs (tenant_id, employee_number, work_date, login_time, geolocation, status, source)
      values (p_tenant, p_employee, v_day, p_at,
              case when v_loc is not null then jsonb_build_object('in', v_loc) end, 'clocked_in', 'app');
    elsif r.login_time is null then
      -- a record without a clock-in (e.g. made by another writer): this is it
      update public.attendance_logs
      set login_time = p_at, logout_time = null, status = 'clocked_in',
          geolocation = case when v_loc is not null then coalesce(geolocation, '{}'::jsonb) || jsonb_build_object('in', v_loc) else geolocation end
      where id = r.id;
    elsif r.logout_time is not null then
      -- back after clocking out: still at work, the first clock-in kept
      update public.attendance_logs set logout_time = null, status = 'clocked_in' where id = r.id;
    end if;
    -- already clocked in: nothing changes
  else
    if r.id is null or r.login_time is null then
      raise exception 'You haven''t clocked in today' using errcode = 'P0001';
    end if;
    if r.logout_time is null then
      update public.attendance_logs
      set logout_time = greatest(p_at, r.login_time), status = 'clocked_out',
          geolocation = case when v_loc is not null then coalesce(geolocation, '{}'::jsonb) || jsonb_build_object('out', v_loc) else geolocation end
      where id = r.id;
    end if;
    -- already clocked out: nothing changes
  end if;
  return public.attendance_today_for(p_tenant, p_employee, p_at);
end $$;
revoke all on function public.attendance_punch(uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;

-- the signed-in employee: their company and employee number, or a plain refusal
create or replace function public.attendance_me() returns table (tenant_id uuid, employee_number text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_emp text := public.current_employee_number();
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if v_emp is null then
    raise exception 'Your account isn''t linked to an employee record, so attendance can''t be recorded. Please contact HR.'
      using errcode = '42501';
  end if;
  return query select v_tenant, v_emp;
end $$;
revoke all on function public.attendance_me() from public, anon, authenticated;

create or replace function public.attendance_clock_in(p_location jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me record;
begin
  select * into me from public.attendance_me();
  return public.attendance_punch(me.tenant_id, me.employee_number, 'in', p_location, now());
end $$;
revoke all on function public.attendance_clock_in(jsonb) from public, anon;
grant execute on function public.attendance_clock_in(jsonb) to authenticated;

create or replace function public.attendance_clock_out(p_location jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me record;
begin
  select * into me from public.attendance_me();
  return public.attendance_punch(me.tenant_id, me.employee_number, 'out', p_location, now());
end $$;
revoke all on function public.attendance_clock_out(jsonb) from public, anon;
grant execute on function public.attendance_clock_out(jsonb) to authenticated;

create or replace function public.attendance_today() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me record;
begin
  select * into me from public.attendance_me();
  return public.attendance_today_for(me.tenant_id, me.employee_number, now());
end $$;
revoke all on function public.attendance_today() from public, anon;
grant execute on function public.attendance_today() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. HR corrections
-- ---------------------------------------------------------------------------------------------
-- Records or corrects one employee's day: the clock-in (on that day), the clock-out (after it, or none yet) and a note
-- saying why. The record becomes HR's (source 'hr').
create or replace function public.attendance_set_day(
  p_employee text, p_date date, p_in timestamptz, p_out timestamptz, p_note text
) returns public.attendance_logs
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  r public.attendance_logs;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.manages_attendance() then
    raise exception 'Only HR can correct attendance' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees e where e.tenant_id = v_tenant and e."Employee Number" = p_employee) then
    raise exception 'Unknown employee' using errcode = '23503';
  end if;
  if p_date is null or p_in is null then
    raise exception 'Enter the clock-in time (to clear the day, remove it instead)' using errcode = '22023';
  end if;
  if v_note is null then
    raise exception 'Add a note saying why the day is being corrected' using errcode = '22023';
  end if;
  if length(v_note) > 500 then
    raise exception 'Keep the note to 500 characters' using errcode = '22023';
  end if;
  if (p_in at time zone 'Africa/Nairobi')::date <> p_date then
    raise exception 'The clock-in time must be on %', to_char(p_date, 'DD Mon YYYY') using errcode = '22023';
  end if;
  if p_out is not null and p_out <= p_in then
    raise exception 'The clock-out time must be after the clock-in time' using errcode = '22023';
  end if;
  if p_in > now() or p_out > now() then
    raise exception 'A time that hasn''t happened yet can''t be recorded' using errcode = '22023';
  end if;

  select * into r from public.attendance_logs a
  where a.tenant_id = v_tenant and a.employee_number = p_employee and a.work_date = p_date and a.source <> 'legacy'
  for update;
  if r.id is null then
    insert into public.attendance_logs (tenant_id, employee_number, work_date, login_time, logout_time, status, source, note,
                                        edited_by, edited_at)
    values (v_tenant, p_employee, p_date, p_in, p_out, case when p_out is null then 'clocked_in' else 'clocked_out' end,
            'hr', v_note, auth.uid(), now())
    returning * into r;
  else
    update public.attendance_logs
    set login_time = p_in, logout_time = p_out, work_date = p_date,
        status = case when p_out is null then 'clocked_in' else 'clocked_out' end,
        source = 'hr', note = v_note, edited_by = auth.uid(), edited_at = now()
    where id = r.id
    returning * into r;
  end if;
  return r;
end $$;
revoke all on function public.attendance_set_day(text, date, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.attendance_set_day(text, date, timestamptz, timestamptz, text) to authenticated;

-- Removes one employee's record for a day (the old portal-open rows are left alone). True when there was one.
create or replace function public.attendance_remove_day(p_employee text, p_date date) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_n integer;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.manages_attendance() then
    raise exception 'Only HR can correct attendance' using errcode = '42501';
  end if;
  delete from public.attendance_logs a
  where a.tenant_id = v_tenant and a.employee_number = p_employee and a.work_date = p_date and a.source <> 'legacy';
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.attendance_remove_day(text, date) from public, anon;
grant execute on function public.attendance_remove_day(text, date) to authenticated;

-- What the Attendance screens offer the signed-in person: everyone's days (HR, Reports), corrections and schedules
-- (HR), their reports' days (a manager) and their own.
create or replace function public.attendance_my_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'sees_all', public.sees_attendance(),
    'manages', public.manages_attendance(),
    'schedules', public.manages_attendance() or coalesce(public.has_module('settings'), false),
    'employee_number', public.current_employee_number(),
    'team', coalesce((select jsonb_agg(n order by n) from public.supervised_employee_numbers() n), '[]'::jsonb))
  where auth.uid() is not null
$$;
revoke all on function public.attendance_my_access() from public, anon;
grant execute on function public.attendance_my_access() to authenticated;

notify pgrst, 'reload schema';
