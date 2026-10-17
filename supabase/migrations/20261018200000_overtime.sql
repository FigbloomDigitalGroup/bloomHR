-- Overtime recorded per day, rated by the kind of day, approved, and paid through the monthly payroll (FIG-889).
--
-- Payroll used to multiply employees.overtime (hours, typed on the employee record each month) by an "Overtime Rate"
-- that was never a column, so it paid nothing and someone had to remember to clear the hours. Now:
--
--   overtime_entries                     one employee's overtime hours on one day (at most one entry a day)
--     day_type                           worked out from the employee's work week and the company's holidays:
--                                        'holiday' (a company holiday), 'rest' (a day off in their week), 'normal'
--                                        (a working day; a half day such as a half-day Saturday counts as working)
--     status                             'submitted' (waiting), 'approved' (paid) or 'rejected' (with a reason)
--     source                             'payroll', 'upload', 'supervisor' or 'self'
--   employees."Overtime Rate"            an explicit hourly rate for this employee's overtime (before the
--                                        multiplier); empty = basic salary / the company's monthly hours
--   company_payroll_settings.overtime_*  on/off, the multipliers (1.5 on a working day, 2.0 on a rest day or public
--                                        holiday), the monthly hours (225: 45 hours a week), an optional monthly cap
--                                        on paid hours, and departments / job groups that don't get overtime
--   overtime_people()                    who the signed-in user may record overtime for, and whether they get it
--   overtime_month('YYYY-MM')            per employee, the month's approved hours by kind of day (after the cap),
--                                        hours over the cap, and the entries behind them (payroll)
--   set_overtime_rate(employee, rate)    payroll sets or clears an employee's explicit hourly rate
--   salary_history.overtime_pay / overtime_items   what the payslip paid for overtime, and its lines
--
-- Who does what (enforced by the trigger, not only by the screens):
--   payroll ('payroll' or 'work-records' module)   everything; what they enter or upload is approved
--   supervisor (the employee's manager_email or regional_manager)   enters and approves their team's overtime
--   the employee                                   sees their own and requests overtime, which waits for approval
-- Casual workers (paid by the day on their own page) and excluded departments / job groups get no overtime.
-- Nothing changes in a month whose payroll run is approved or paid.
--
-- Payroll works the payslip out in the browser (src/lib/overtimePay.ts): hours x hourly rate x the day's multiplier,
-- one line per kind of day, added to gross pay so PAYE, NSSF, SHIF and the housing levy include it. A month with no
-- approved entries in the company still reads the old employees.overtime field (this release only).

-- ---------------------------------------------------------------------------------------------
-- 1. settings and the explicit rate
-- ---------------------------------------------------------------------------------------------
alter table public.company_payroll_settings
  add column if not exists overtime_enabled boolean not null default true,
  add column if not exists overtime_normal_multiplier numeric(4, 2) not null default 1.5,
  add column if not exists overtime_rest_multiplier numeric(4, 2) not null default 2.0,
  add column if not exists overtime_holiday_multiplier numeric(4, 2) not null default 2.0,
  add column if not exists overtime_monthly_hours numeric(6, 2) not null default 225,
  add column if not exists overtime_monthly_cap numeric(6, 2),
  add column if not exists overtime_excluded_departments uuid[] not null default '{}',
  add column if not exists overtime_excluded_job_groups uuid[] not null default '{}';

alter table public.company_payroll_settings drop constraint if exists company_payroll_settings_overtime_check;
alter table public.company_payroll_settings add constraint company_payroll_settings_overtime_check check (
  overtime_normal_multiplier between 1 and 5
  and overtime_rest_multiplier between 1 and 5
  and overtime_holiday_multiplier between 1 and 5
  and overtime_monthly_hours > 0 and overtime_monthly_hours <= 400
  and (overtime_monthly_cap is null or (overtime_monthly_cap > 0 and overtime_monthly_cap <= 400))
);

alter table public.employees add column if not exists "Overtime Rate" numeric;
alter table public.employees drop constraint if exists employees_overtime_rate_check;
alter table public.employees add constraint employees_overtime_rate_check check ("Overtime Rate" is null or "Overtime Rate" > 0);

alter table public.salary_history add column if not exists overtime_pay numeric not null default 0;
alter table public.salary_history add column if not exists overtime_items jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------------------------
-- 2. helpers
-- ---------------------------------------------------------------------------------------------
-- the company's overtime settings (the defaults when it has no settings row yet)
create or replace function public.overtime_settings(p_tenant uuid)
returns table (
  enabled boolean, normal_multiplier numeric, rest_multiplier numeric, holiday_multiplier numeric,
  monthly_hours numeric, monthly_cap numeric, excluded_departments uuid[], excluded_job_groups uuid[]
)
language sql stable security definer set search_path = public as $$
  select coalesce(s.overtime_enabled, true), coalesce(s.overtime_normal_multiplier, 1.5), coalesce(s.overtime_rest_multiplier, 2.0),
         coalesce(s.overtime_holiday_multiplier, 2.0), coalesce(s.overtime_monthly_hours, 225), s.overtime_monthly_cap,
         coalesce(s.overtime_excluded_departments, '{}'), coalesce(s.overtime_excluded_job_groups, '{}')
  from (select 1) one
  left join public.company_payroll_settings s on s.tenant_id = p_tenant
$$;

-- the kind of day for one employee: a company holiday, a day off in their work week, or a working day (a half day
-- counts as working)
create or replace function public.overtime_day_type(p_tenant uuid, p_employee text, p_day date) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (
      select 1 from public.holidays h
      where h.tenant_id = p_tenant and h.date is not null
        and (h.date = p_day or (coalesce(h.recurring, false) and to_char(h.date, 'MM-DD') = to_char(p_day, 'MM-DD')))) then 'holiday'
    when (public.work_week_for(p_tenant, p_employee))[extract(isodow from p_day)::int] > 0 then 'normal'
    else 'rest'
  end
$$;

-- why an employee gets no overtime (null when they do): casual workers, excluded departments (or a department under
-- one) and excluded job groups
create or replace function public.overtime_excluded_reason(p_tenant uuid, p_employee text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  e record;
  s record;
begin
  select emp.worker_kind, emp.department_id, emp.job_group_id into e
  from public.employees emp where emp.tenant_id = p_tenant and emp."Employee Number" = p_employee;
  if not found then
    return 'Unknown employee';
  end if;
  if e.worker_kind = 'casual' then
    return 'Casual workers are paid by the day, not overtime';
  end if;
  select * into s from public.overtime_settings(p_tenant);
  if e.job_group_id is not null and e.job_group_id = any(s.excluded_job_groups) then
    return 'Their job group doesn''t get overtime';
  end if;
  if e.department_id is not null and cardinality(s.excluded_departments) > 0 and exists (
    with recursive up as (
      select d.id, d.parent_id, 0 as depth from public.departments d where d.id = e.department_id
      union all
      select d.id, d.parent_id, up.depth + 1 from up join public.departments d on d.id = up.parent_id where up.depth < 20
    )
    select 1 from up where up.id = any(s.excluded_departments)) then
    return 'Their department doesn''t get overtime';
  end if;
  return null;
end $$;

revoke all on function public.overtime_settings(uuid) from public, anon;
revoke all on function public.overtime_day_type(uuid, text, date) from public, anon;
revoke all on function public.overtime_excluded_reason(uuid, text) from public, anon;
grant execute on function public.overtime_settings(uuid) to authenticated;
grant execute on function public.overtime_day_type(uuid, text, date) to authenticated;
grant execute on function public.overtime_excluded_reason(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. the entries
-- ---------------------------------------------------------------------------------------------
create table if not exists public.overtime_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  -- an employee requesting their own overtime need not say who they are
  employee_number text not null default public.current_employee_number(),
  work_date date not null,
  hours numeric(5, 2) not null check (hours > 0 and hours <= 24),
  day_type text not null default 'normal' check (day_type in ('normal', 'rest', 'holiday')),
  note text,
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected')),
  source text not null default 'self' check (source in ('payroll', 'upload', 'supervisor', 'self')),
  rejection_reason text,
  entered_by uuid default auth.uid() references auth.users(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'rejected' or nullif(btrim(rejection_reason), '') is not null)
);
create unique index if not exists overtime_entries_one_a_day on public.overtime_entries (tenant_id, employee_number, work_date);
create index if not exists overtime_entries_tenant_date on public.overtime_entries (tenant_id, work_date);

alter table public.overtime_entries enable row level security;
drop policy if exists tenant_isolation on public.overtime_entries;
create policy tenant_isolation on public.overtime_entries as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
-- payroll, the employee's supervisor and the employee; the trigger decides what each may do
drop policy if exists involved on public.overtime_entries;
create policy involved on public.overtime_entries for all to authenticated
  using ((select public.manages_work()) or employee_number in (select public.supervised_employee_numbers())
         or employee_number = (select public.current_employee_number()))
  with check ((select public.manages_work()) or employee_number in (select public.supervised_employee_numbers())
         or employee_number = (select public.current_employee_number()));
revoke all on public.overtime_entries from anon;

-- ---------------------------------------------------------------------------------------------
-- 4. rules
-- ---------------------------------------------------------------------------------------------
create or replace function public.overtime_entry_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_payroll boolean := public.manages_work();
  v_self boolean;
  v_supervisor boolean;
  v_reason text;
begin
  -- an employee renumbered, or the kind of day worked out again after a holiday or work week changed
  if tg_op = 'UPDATE' and current_setting('app.overtime_system', true) = 'on'
     and (to_jsonb(new) - 'employee_number' - 'day_type' - 'updated_at') = (to_jsonb(old) - 'employee_number' - 'day_type' - 'updated_at') then
    return new;
  end if;

  if tg_op = 'DELETE' then
    if public.pay_month_closed(old.tenant_id, old.work_date) then
      raise exception 'Payroll for % is approved; this overtime can''t be removed', to_char(old.work_date, 'Mon YYYY');
    end if;
    if auth.uid() is not null and not v_payroll and not public.supervises(old.employee_number)
       and not (old.employee_number = public.current_employee_number() and old.status <> 'approved') then
      raise exception 'Only payroll or the supervisor can remove approved overtime';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if public.pay_month_closed(old.tenant_id, old.work_date) then
      raise exception 'Payroll for % is approved; this overtime can''t be changed', to_char(old.work_date, 'Mon YYYY');
    end if;
    if new.employee_number is distinct from old.employee_number then
      raise exception 'Remove the overtime and record it for the other person instead';
    end if;
  end if;

  if new.work_date is null then raise exception 'Choose the day the overtime was worked'; end if;
  if public.pay_month_closed(new.tenant_id, new.work_date) then
    raise exception 'Payroll for % is approved; record this overtime in an open month', to_char(new.work_date, 'Mon YYYY');
  end if;
  if new.work_date > current_date + 1 then raise exception 'Overtime can''t be recorded for a day still to come'; end if;
  if nullif(btrim(new.employee_number), '') is null then raise exception 'Choose who worked the overtime'; end if;

  if tg_op = 'INSERT' or new.work_date is distinct from old.work_date or new.hours is distinct from old.hours then
    if not (select enabled from public.overtime_settings(new.tenant_id)) then
      raise exception 'Overtime is turned off for this company (payroll settings)';
    end if;
    v_reason := public.overtime_excluded_reason(new.tenant_id, new.employee_number);
    if v_reason = 'Unknown employee' then
      raise exception 'Unknown employee %', new.employee_number;
    elsif v_reason is not null then
      raise exception '%: %', new.employee_number, v_reason;
    end if;
  end if;

  new.day_type := public.overtime_day_type(new.tenant_id, new.employee_number, new.work_date);
  new.note := nullif(btrim(new.note), '');
  new.updated_at := now();

  -- the server and SQL scripts (no signed-in user) are trusted
  if auth.uid() is null then return new; end if;

  v_self := coalesce(new.employee_number = public.current_employee_number(), false);
  v_supervisor := not v_self and public.supervises(new.employee_number);

  if tg_op = 'INSERT' then
    new.entered_by := auth.uid();
    if v_payroll and not v_self then
      new.source := case when new.source = 'upload' then 'upload' else 'payroll' end;
    elsif v_supervisor then
      new.source := 'supervisor';
    elsif v_self then
      new.source := 'self';
    else
      raise exception 'You can only record overtime for your team, or request your own';
    end if;
    -- payroll and supervisors check overtime as they enter it; an employee's own request waits for approval
    new.rejection_reason := null;
    if new.source = 'self' then
      new.status := 'submitted';
      new.decided_by := null; new.decided_at := null;
    else
      new.status := 'approved';
      new.decided_by := auth.uid(); new.decided_at := now();
    end if;
    return new;
  end if;

  -- UPDATE
  new.source := old.source;
  new.entered_by := old.entered_by;
  if v_self and not v_payroll then
    -- the employee: only their own request that isn't approved, and changing it sends it back for approval
    if old.status = 'approved' then raise exception 'Approved overtime can only be changed by payroll or the supervisor'; end if;
    if new.status = 'approved' then raise exception 'Someone else must approve your overtime'; end if;
    new.status := 'submitted';
    new.decided_by := null; new.decided_at := null; new.rejection_reason := null;
    return new;
  end if;
  if not (v_payroll or v_supervisor) then
    raise exception 'Only payroll or the supervisor can change this overtime';
  end if;
  if v_self and new.status = 'approved' and old.status <> 'approved' then
    raise exception 'Someone else must approve your overtime';
  end if;
  if new.status is distinct from old.status then
    if new.status = 'submitted' then
      new.decided_by := null; new.decided_at := null; new.rejection_reason := null;
    else
      new.decided_by := auth.uid(); new.decided_at := now();
      if new.status = 'approved' then new.rejection_reason := null; end if;
    end if;
  elsif new.hours is distinct from old.hours or new.work_date is distinct from old.work_date then
    -- payroll or the supervisor correcting the hours: what they enter is approved (their own waits for someone else)
    if v_self then
      new.status := 'submitted';
      new.decided_by := null; new.decided_at := null;
    else
      new.status := 'approved';
      new.decided_by := auth.uid(); new.decided_at := now();
    end if;
    new.rejection_reason := null;
  else
    new.decided_by := old.decided_by; new.decided_at := old.decided_at;
  end if;
  return new;
end $$;

drop trigger if exists overtime_entry_rules on public.overtime_entries;
create trigger overtime_entry_rules before insert or update or delete on public.overtime_entries
  for each row execute function public.overtime_entry_rules();

-- the employee hears when their request is approved or not (the employee-facing type, not a new one)
create or replace function public.notify_overtime_decision() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_what text;
begin
  if new.source <> 'self' or new.status is not distinct from old.status or new.status not in ('approved', 'rejected') then
    return new;
  end if;
  v_what := trim_scale(new.hours) || ' hour' || case when new.hours = 1 then '' else 's' end || ' on ' || to_char(new.work_date, 'DD Mon YYYY');
  if new.status = 'approved' then
    perform public.notify_employee_number(new.tenant_id, new.employee_number, 'approval_progress', 'Overtime approved',
      'Your overtime request (' || v_what || ') was approved. It will be paid with that month''s salary.');
  else
    perform public.notify_employee_number(new.tenant_id, new.employee_number, 'approval_progress', 'Overtime not approved',
      'Your overtime request (' || v_what || ') was not approved.' || public.with_note('Reason', new.rejection_reason));
  end if;
  return new;
end $$;

drop trigger if exists notify_overtime_decision on public.overtime_entries;
create trigger notify_overtime_decision after update of status on public.overtime_entries
  for each row execute function public.notify_overtime_decision();

-- ---------------------------------------------------------------------------------------------
-- 5. keeping the kind of day and the employee number right
-- ---------------------------------------------------------------------------------------------
-- a holiday added or removed, or a work week changed: open months' entries are classified again
create or replace function public.overtime_reclassify(p_tenant uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_tenant is null or not exists (select 1 from public.overtime_entries where tenant_id = p_tenant) then
    return;
  end if;
  perform set_config('app.overtime_system', 'on', true);
  update public.overtime_entries o
     set day_type = public.overtime_day_type(o.tenant_id, o.employee_number, o.work_date)
   where o.tenant_id = p_tenant
     and not public.pay_month_closed(o.tenant_id, o.work_date)
     and o.day_type is distinct from public.overtime_day_type(o.tenant_id, o.employee_number, o.work_date);
  perform set_config('app.overtime_system', 'off', true);
end $$;
revoke all on function public.overtime_reclassify(uuid) from public, anon, authenticated;

create or replace function public.overtime_reclassify_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.overtime_reclassify(old.tenant_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.tenant_id is distinct from old.tenant_id) then
    perform public.overtime_reclassify(new.tenant_id);
  end if;
  return null;
end $$;

drop trigger if exists overtime_reclassify on public.holidays;
create trigger overtime_reclassify after insert or update or delete on public.holidays
  for each row execute function public.overtime_reclassify_trigger();
drop trigger if exists overtime_reclassify on public.company_work_week;
create trigger overtime_reclassify after insert or update or delete on public.company_work_week
  for each row execute function public.overtime_reclassify_trigger();
drop trigger if exists overtime_reclassify on public.departments;
create trigger overtime_reclassify after update of work_week, parent_id on public.departments
  for each row execute function public.overtime_reclassify_trigger();

-- an employee moved to another department may have another work week
create or replace function public.overtime_follow_employee() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.overtime_system', 'on', true);
  if new."Employee Number" is distinct from old."Employee Number" then
    update public.overtime_entries set employee_number = new."Employee Number"
    where tenant_id = new.tenant_id and employee_number = old."Employee Number";
  end if;
  perform set_config('app.overtime_system', 'off', true);
  if new.department_id is distinct from old.department_id then
    perform public.overtime_reclassify(new.tenant_id);
  end if;
  return new;
end $$;

drop trigger if exists overtime_follow_employee on public.employees;
create trigger overtime_follow_employee
  after update of "Employee Number", department_id on public.employees
  for each row when (old."Employee Number" is distinct from new."Employee Number" or old.department_id is distinct from new.department_id)
  execute function public.overtime_follow_employee();

drop trigger if exists audit_overtime_entries on public.overtime_entries;
create trigger audit_overtime_entries after insert or update or delete on public.overtime_entries
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------------------------
-- 6. who the signed-in user records overtime for
-- ---------------------------------------------------------------------------------------------
-- payroll: everyone in the company; a supervisor: their team. Casual workers are left out; excluded people are listed
-- with why, so the page can say so.
create or replace function public.overtime_people()
returns table (employee_number text, name text, department text, job_group text, excluded_reason text)
language sql stable security definer set search_path = public as $$
  select e."Employee Number",
         nullif(btrim(concat_ws(' ', nullif(btrim(e."First Name"), ''), nullif(btrim(e."Last Name"), ''))), ''),
         nullif(btrim(e."Job Level"), ''),
         nullif(btrim(e."Job Group"), ''),
         public.overtime_excluded_reason(e.tenant_id, e."Employee Number")
  from public.employees e
  where e.tenant_id = public.current_tenant_id()
    and nullif(btrim(e."Employee Number"), '') is not null
    and e.worker_kind <> 'casual'
    and (public.manages_work() or e."Employee Number" in (select public.supervised_employee_numbers()))
    and e."Employee Number" is distinct from public.current_employee_number()
    and (public.employee_start_date(e."Termination Date") is null
         or public.employee_start_date(e."Termination Date") >= current_date - 62)
  order by 2 nulls last, 1
$$;
revoke all on function public.overtime_people() from public, anon;
grant execute on function public.overtime_people() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. the month's figures for payroll
-- ---------------------------------------------------------------------------------------------
-- Approved entries in the month, for employees who get overtime, with overtime turned on. The cap is applied in date
-- order: the first hours of the month are paid until the cap is reached; the rest show as over the cap.
create or replace function public.overtime_month(p_period text)
returns table (
  employee_number text,
  normal_hours numeric,
  rest_hours numeric,
  holiday_hours numeric,
  over_cap_hours numeric,
  entries jsonb
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_first date;
  v_last date;
  s record;
begin
  if v_tenant is null or not public.manages_work() then
    raise exception 'Only payroll can see the month''s overtime' using errcode = '42501';
  end if;
  if p_period is null or p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Pay period "%" should look like 2026-09 (year-month)', coalesce(p_period, '') using errcode = '22023';
  end if;
  v_first := to_date(p_period || '-01', 'YYYY-MM-DD');
  v_last := (v_first + interval '1 month' - interval '1 day')::date;
  select * into s from public.overtime_settings(v_tenant);
  if not s.enabled then
    return;
  end if;

  return query
  with approved as (
    select o.id, o.employee_number as emp, o.work_date, o.day_type, o.hours,
           sum(o.hours) over (partition by o.employee_number order by o.work_date, o.created_at, o.id) as running
    from public.overtime_entries o
    join public.employees e on e.tenant_id = o.tenant_id and e."Employee Number" = o.employee_number
    where o.tenant_id = v_tenant and o.status = 'approved'
      and o.work_date between v_first and v_last
      and public.overtime_excluded_reason(v_tenant, o.employee_number) is null
  ), paid as (
    select approved.*,
           case when s.monthly_cap is null then approved.hours
                else greatest(0, least(approved.hours, s.monthly_cap - (approved.running - approved.hours))) end as paid_hours
    from approved
  )
  select paid.emp,
         trim_scale(coalesce(sum(paid.paid_hours) filter (where paid.day_type = 'normal'), 0)),
         trim_scale(coalesce(sum(paid.paid_hours) filter (where paid.day_type = 'rest'), 0)),
         trim_scale(coalesce(sum(paid.paid_hours) filter (where paid.day_type = 'holiday'), 0)),
         trim_scale(sum(paid.hours - paid.paid_hours)),
         jsonb_agg(jsonb_build_object(
           'id', paid.id, 'work_date', to_char(paid.work_date, 'YYYY-MM-DD'), 'day_type', paid.day_type,
           'hours', trim_scale(paid.hours), 'paid_hours', trim_scale(paid.paid_hours)) order by paid.work_date, paid.id)
  from paid
  group by paid.emp
  order by paid.emp;
end $$;
revoke all on function public.overtime_month(text) from public, anon;
grant execute on function public.overtime_month(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 8. an employee's explicit hourly rate (payroll, who may not otherwise edit employee records)
-- ---------------------------------------------------------------------------------------------
create or replace function public.set_overtime_rate(p_employee text, p_rate numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_any_module('payroll', 'employees') then
    raise exception 'Only payroll can set an overtime rate' using errcode = '42501';
  end if;
  if p_rate is not null and p_rate <= 0 then
    raise exception 'An hourly rate is more than 0 (leave it empty to work it out from the basic salary)' using errcode = '22023';
  end if;
  update public.employees set "Overtime Rate" = round(p_rate, 2)
  where tenant_id = public.current_tenant_id() and "Employee Number" = p_employee;
  if not found then
    raise exception 'Unknown employee %', p_employee using errcode = '22023';
  end if;
end $$;
revoke all on function public.set_overtime_rate(text, numeric) from public, anon;
grant execute on function public.set_overtime_rate(text, numeric) to authenticated;

notify pgrst, 'reload schema';
