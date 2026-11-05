-- "My HR" for Figbloom Schools staff, step 1 (view only): ERP/SCHOOLS_HR_PHASE2_CONTRACT.md section 2.
--
-- Figbloom Schools calls HR's backend (my_hr_routes.js, GET /api/integrations/my-hr/*) for one of its staff. The
-- backend verifies Schools' platform token and that the school is linked to this HR company, then calls the functions
-- below with the service role. Every function is for ONE company and ONE employee, both given by the backend (the
-- company from the platform's link, the employee only through external_people), and answers what that employee sees of
-- their own record in the staff portal, under the same rules:
--
--   my_hr_person(company, platform tenant, schools person id)
--                         who the person is: 'unknown_company' unless the company is active and is that platform
--                         tenant's; 'not_linked' unless external_people maps (company, 'schools', person id) to an
--                         employee; else the employee number, their onboarding status (anything but 'approved' is a
--                         draft: no pay data) and employment status. Never matched by email.
--   my_hr_summary         name, job, company, latest published payslip, leave waiting for a decision
--   my_hr_payslips        payslips whose country's payroll is approved or paid (published_payslip_keys(), the rule
--                         of salary_history's own_select policy), newest first
--   my_hr_payslip(id)     one of those payslips, every saved figure (as the staff portal's PayslipViewer reads it),
--                         with the run's dates; the bank account only as its last 4 characters
--   my_hr_leave           the company's leave types; per type what is free to book today (leave_available() for
--                         today's bucket, less days waiting for approval, as leave_request_problems() counts them);
--                         the person's applications with their status and approval chain (approval_chains()' steps)
--   my_hr_attendance(from, to)
--                         each day as attendance_days_for() has it (status, clock-in and out, late minutes...), the
--                         possible-absence notices sent to them, their missed-scan requests and their recorded
--                         absences (leave_absences, the staff portal's "Absences recorded"); up to 93 days
--   my_hr_kpis            the current KPI period (open and covering today, else the latest one out of draft: the
--                         employee never sees a draft period's KPIs), their KPIs in it with targets, weights,
--                         self-assessment, final and calculated values, and their attendance over the period so far
--   my_hr_api_log         every call: when, the company, the employee number, the route, the answer's status. No
--                         payload, no token. Written by the backend only; nobody reads it through the API.
--
-- Executable by service_role only. Safe to run again.

-- ---------------------------------------------------------------------------------------------
-- 1. the audit log
-- ---------------------------------------------------------------------------------------------
create table if not exists public.my_hr_api_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  tenant_id uuid references public.tenants(id) on delete set null,
  employee_number text check (employee_number is null or char_length(employee_number) <= 100),
  route text not null check (char_length(route) <= 60),
  status integer not null,
  outcome text check (outcome is null or char_length(outcome) <= 60)
);
create index if not exists my_hr_api_log_tenant_at on public.my_hr_api_log (tenant_id, at desc);
alter table public.my_hr_api_log enable row level security;
revoke all on public.my_hr_api_log from anon, authenticated;
grant select, insert on public.my_hr_api_log to service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. who is calling
-- ---------------------------------------------------------------------------------------------
create or replace function public.my_hr_person(p_tenant uuid, p_platform_tenant uuid, p_external_id text)
returns table (outcome text, employee_number text, onboarding_status text, employment_status text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_number text;
  e record;
begin
  if p_tenant is null or p_platform_tenant is null or not exists (
    select 1 from public.tenants t
    where t.id = p_tenant and t.platform_tenant_id = p_platform_tenant and t.status = 'active') then
    return query select 'unknown_company'::text, null::text, null::text, null::text;
    return;
  end if;
  select m.employee_number into v_number from public.external_people m
  where m.tenant_id = p_tenant and m.source = 'schools' and m.external_id = p_external_id;
  if v_number is null then
    return query select 'not_linked'::text, null::text, null::text, null::text;
    return;
  end if;
  select x."Employee Number" as num, x.onboarding_status as onb, x."Status" as st into e
  from public.employees x where x.tenant_id = p_tenant and x."Employee Number" = v_number;
  if e.num is null then
    return query select 'not_linked'::text, null::text, null::text, null::text;
    return;
  end if;
  return query select 'found'::text, e.num::text, coalesce(e.onb, 'draft')::text, e.st::text;
end $$;

-- the employee, approved by HR (pay data only then); raises otherwise, so a call the backend should not make fails
create or replace function public.my_hr_employee(p_tenant uuid, p_employee text)
returns public.employees
language plpgsql stable security definer set search_path = public as $$
declare
  e public.employees;
begin
  select * into e from public.employees x where x.tenant_id = p_tenant and x."Employee Number" = p_employee;
  if e."Employee Number" is null then
    raise exception 'No such employee' using errcode = 'P0002';
  end if;
  if coalesce(e.onboarding_status, 'draft') <> 'approved' then
    raise exception 'This employee''s record is not approved yet' using errcode = '42501';
  end if;
  return e;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. payslips: the employee's own, once their country's payroll is approved or paid
-- ---------------------------------------------------------------------------------------------
create or replace function public.my_hr_payslips(p_tenant uuid, p_employee text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.my_hr_employee(p_tenant, p_employee);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', h.id, 'pay_period', h.pay_period, 'country', h.country, 'currency', h.currency,
      'basic_salary', h.basic_salary, 'gross_pay', h.gross_pay, 'total_deductions', h.total_deductions, 'net_pay', h.net_pay,
      'run_status', c.status, 'approved_at', c.approved_at, 'paid_at', c.paid_at)
      order by h.pay_period desc, h.created_at desc)
    from public.salary_history h
    join public.payroll_run_countries c
      on c.run_id = h.run_id and c.tenant_id = h.tenant_id and lower(c.country) = lower(h.country)
    where h.tenant_id = p_tenant and h.employee_id = p_employee and c.status in ('approved', 'paid')), '[]'::jsonb);
end $$;

create or replace function public.my_hr_payslip(p_tenant uuid, p_employee text, p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.my_hr_employee(p_tenant, p_employee);
  select (to_jsonb(h) - 'tenant_id' - 'account_number')
         || jsonb_build_object(
              'account_number_last4', case when coalesce(btrim(h.account_number), '') <> '' then right(btrim(h.account_number), 4) end,
              'run_status', c.status, 'approved_at', c.approved_at, 'paid_at', c.paid_at)
    into v
  from public.salary_history h
  join public.payroll_run_countries c
    on c.run_id = h.run_id and c.tenant_id = h.tenant_id and lower(c.country) = lower(h.country)
  where h.id = p_id and h.tenant_id = p_tenant and h.employee_id = p_employee and c.status in ('approved', 'paid');
  return v;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. summary
-- ---------------------------------------------------------------------------------------------
create or replace function public.my_hr_summary(p_tenant uuid, p_employee text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  e public.employees := public.my_hr_employee(p_tenant, p_employee);
  j jsonb := to_jsonb(e);
begin
  return jsonb_build_object(
    'employee', jsonb_build_object(
      'employee_number', e."Employee Number",
      'name', nullif(btrim(concat_ws(' ', j ->> 'First Name', j ->> 'Middle Name', j ->> 'Last Name')), ''),
      'job_title', j ->> 'Job Title', 'department', j ->> 'Department', 'branch', j ->> 'Branch',
      'start_date', j ->> 'Start Date', 'employment_status', j ->> 'Status'),
    'company', (select jsonb_build_object('name', t.name) from public.tenants t where t.id = p_tenant),
    'latest_payslip', (public.my_hr_payslips(p_tenant, p_employee) -> 0),
    'leave_pending', (select count(*) from public.leave_application a
                      where a.tenant_id = p_tenant and a."Employee Number" = p_employee
                        and lower(coalesce(a.status, 'pending')) = 'pending'));
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. leave
-- ---------------------------------------------------------------------------------------------
create or replace function public.my_hr_leave(p_tenant uuid, p_employee text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := public.nairobi_today();
  v_types jsonb := '[]'::jsonb;
  v_balances jsonb := '[]'::jsonb;
  t record;
  pol record;
  v_year integer;
  v_month integer;
  v_free numeric;
  v_pending numeric;
  b public.leave_balances;
begin
  perform public.my_hr_employee(p_tenant, p_employee);
  for t in select * from public.leave_types lt where lt.tenant_id = p_tenant order by lt.name loop
    v_types := v_types || jsonb_build_object('id', t.id, 'name', t.name, 'description', t.description,
                                             'deductible', coalesce(t.is_deductible, true));
    select * into pol from public.current_leave_policies where leave_type_id = t.id;
    v_year := public.leave_bucket_year(p_tenant, pol.accrual_method, v_today);
    v_month := public.leave_bucket_month(pol.accrual_method, v_today);
    v_free := public.leave_available(p_tenant, p_employee, t.id, v_year, v_month);
    if v_free is null then
      continue; -- no balance kept for this type (not deducted, or no limit)
    end if;
    select coalesce(sum(a.days), 0) into v_pending
    from public.leave_application a
    where a.tenant_id = p_tenant and a."Employee Number" = p_employee and a."Leave Type" = t.name
      and lower(coalesce(a.status, 'pending')) = 'pending'
      and public.leave_bucket_year(p_tenant, pol.accrual_method, public.leave_parse_date(a."Start Date")) = v_year
      and (v_month = 0 or extract(month from public.leave_parse_date(a."Start Date")) = v_month);
    select * into b from public.leave_balances lb
    where lb.tenant_id = p_tenant and lb.employee_number = p_employee and lb.leave_type_id = t.id
      and lb.year = v_year and lb.month = v_month;
    v_balances := v_balances || jsonb_build_object(
      'leave_type_id', t.id, 'leave_type', t.name, 'year', v_year, 'month', nullif(v_month, 0),
      'accrued_days', b.accrued_days, 'carried_over_days', b.carried_over_days, 'used_days', coalesce(b.used_days, 0),
      'pending_days', trim_scale(v_pending), 'available_days', trim_scale(v_free - v_pending));
  end loop;

  return jsonb_build_object(
    'leave_types', v_types,
    'balances', v_balances,
    'applications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'leave_type', a."Leave Type", 'start_date', a."Start Date", 'end_date', a."End Date", 'days', a.days,
        'status', lower(coalesce(a.status, 'pending')), 'reason', a.reason, 'submitted_at', a.time_added,
        'approval', (
          select jsonb_build_object('status', r.status, 'current_step', r.current_step, 'decided_at', r.decided_at,
            'steps', (
              select jsonb_agg(jsonb_build_object(
                'position', s.n,
                'label', public.approval_step_label(r.tenant_id, s.step),
                'status', coalesce(x.decision, case when r.status = 'pending' and s.n = r.current_step then 'current'
                                                    when r.status = 'pending' then 'upcoming' else 'not_reached' end),
                'waiting_on', case when r.status = 'pending' and s.n = r.current_step
                                   then public.approval_waiting_on(r.tenant_id, s.step, r.requester_employee_number) end,
                'actor_name', x.actor_name, 'comment', x.comment, 'acted_at', x.created_at) order by s.n)
              from jsonb_array_elements(r.steps) with ordinality as s(step, n)
              left join lateral (
                select y.* from public.approval_actions y
                where y.request_id = r.id and y.step = s.n and y.id > public.approval_round_start(r.id)
                order by y.id desc limit 1) x on true))
          from public.approval_requests r
          where r.tenant_id = p_tenant and r.kind = 'leave' and r.record_id = a.id
            and r.requester_employee_number = p_employee))
        order by a.time_added desc)
      from (select * from public.leave_application l
            where l.tenant_id = p_tenant and l."Employee Number" = p_employee
            order by l.time_added desc limit 200) a), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6. attendance
-- ---------------------------------------------------------------------------------------------
create or replace function public.my_hr_attendance(p_tenant uuid, p_employee text, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.my_hr_employee(p_tenant, p_employee);
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Choose a start date on or before the end date' using errcode = '22023';
  end if;
  if p_to - p_from > 92 then
    raise exception 'Choose a range of 93 days or less' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d.day, 'status', d.status, 'clock_in', d.clock_in, 'clock_out', d.clock_out, 'hours', d.hours,
        'late_minutes', d.late_minutes, 'source', d.source, 'clock_out_via', d.clock_out_via, 'flag', d.flag,
        'counted', d.counted) order by d.day)
      from public.attendance_days_for(p_tenant, p_from, p_to, p_employee, null) d
      where d.employee_number = p_employee), '[]'::jsonb),
    'possible_absence_notices', coalesce((
      select jsonb_agg(jsonb_build_object('start_date', n.start_date, 'end_date', n.end_date, 'notified_on', n.notified_on,
                                          'reply_by', n.reply_by) order by n.start_date desc)
      from public.possible_absence_notices n
      where n.tenant_id = p_tenant and n.employee_number = p_employee
        and n.end_date >= p_from and n.start_date <= p_to), '[]'::jsonb),
    'missed_scan_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'work_date', q.work_date, 'came_in_at', q.came_in_at, 'left_at', q.left_at, 'reason', q.reason,
        'status', q.status, 'approver', q.approver,
        'approver_name', case when q.manager_number is not null then public.attendance_person_name(p_tenant, q.manager_number) else 'HR' end,
        'created_at', q.created_at, 'decided_at', q.decided_at, 'decided_by_name', q.decided_by_name,
        'decision_comment', q.decision_comment) order by q.created_at desc)
      from public.attendance_missed_scan_requests q
      where q.tenant_id = p_tenant and q.employee_number = p_employee
        and q.work_date between p_from and p_to), '[]'::jsonb),
    'absences_recorded', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'start_date', x.start_date, 'end_date', x.end_date,
                                          'days', x.days, 'note', x.note, 'status', x.status, 'excuse_note', x.excuse_note)
                       order by x.start_date desc)
      from public.leave_absences x
      where x.tenant_id = p_tenant and x.employee_number = p_employee
        and x.end_date >= p_from and x.start_date <= p_to), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------
-- 7. KPIs
-- ---------------------------------------------------------------------------------------------
create or replace function public.my_hr_kpis(p_tenant uuid, p_employee text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := public.nairobi_today();
  p public.kpi_periods;
  v_to date;
begin
  perform public.my_hr_employee(p_tenant, p_employee);
  select * into p from public.kpi_periods k
  where k.tenant_id = p_tenant and k.status <> 'draft'
  order by (k.status = 'open' and v_today between k.starts_on and k.ends_on) desc, (k.status = 'open') desc, k.starts_on desc
  limit 1;
  if p.id is null then
    return jsonb_build_object('period', null, 'items', '[]'::jsonb, 'attendance', null);
  end if;
  v_to := least(p.ends_on, v_today);
  return jsonb_build_object(
    'period', jsonb_build_object('id', p.id, 'name', p.name, 'starts_on', p.starts_on, 'ends_on', p.ends_on, 'status', p.status),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignment_id', a.id, 'kpi_id', k.id, 'name', k.name, 'description', k.description, 'unit', k.unit,
        'direction', k.direction, 'measure', k.measure, 'category', k.category, 'frequency', k.frequency,
        'target', a.target, 'weight', a.weight, 'self_value', a.self_value, 'self_comment', a.self_comment,
        'self_at', a.self_at, 'actual_value', a.actual_value, 'manager_comment', a.manager_comment,
        'scored_at', a.scored_at, 'auto_value', a.auto_value, 'auto_detail', a.auto_detail, 'auto_at', a.auto_at)
        order by k.name)
      from public.kpi_assignments a
      join public.kpis k on k.id = a.kpi_id and k.tenant_id = a.tenant_id
      where a.tenant_id = p_tenant and a.period_id = p.id and a.employee_number = p_employee), '[]'::jsonb),
    'attendance', case when v_to >= p.starts_on then (
      select jsonb_build_object(
        'from', p.starts_on, 'to', v_to,
        'working_days', count(*) filter (where d.status in ('present', 'late', 'absent')),
        'present', count(*) filter (where d.status = 'present'),
        'late', count(*) filter (where d.status = 'late'),
        'absent', count(*) filter (where d.status = 'absent'),
        'leave', count(*) filter (where d.status = 'leave'),
        'late_minutes', coalesce(sum(d.late_minutes) filter (where d.status = 'late'), 0))
      from public.attendance_days_for(p_tenant, p.starts_on, v_to, p_employee, null) d
      where d.employee_number = p_employee) end);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 8. only the backend
-- ---------------------------------------------------------------------------------------------
revoke all on function public.my_hr_person(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.my_hr_employee(uuid, text) from public, anon, authenticated;
revoke all on function public.my_hr_payslips(uuid, text) from public, anon, authenticated;
revoke all on function public.my_hr_payslip(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.my_hr_summary(uuid, text) from public, anon, authenticated;
revoke all on function public.my_hr_leave(uuid, text) from public, anon, authenticated;
revoke all on function public.my_hr_attendance(uuid, text, date, date) from public, anon, authenticated;
revoke all on function public.my_hr_kpis(uuid, text) from public, anon, authenticated;
grant execute on function public.my_hr_person(uuid, uuid, text) to service_role;
grant execute on function public.my_hr_employee(uuid, text) to service_role;
grant execute on function public.my_hr_payslips(uuid, text) to service_role;
grant execute on function public.my_hr_payslip(uuid, text, uuid) to service_role;
grant execute on function public.my_hr_summary(uuid, text) to service_role;
grant execute on function public.my_hr_leave(uuid, text) to service_role;
grant execute on function public.my_hr_attendance(uuid, text, date, date) to service_role;
grant execute on function public.my_hr_kpis(uuid, text) to service_role;

notify pgrst, 'reload schema';
