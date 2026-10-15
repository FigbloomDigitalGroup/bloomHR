-- Demo payroll data for FAVOR FARM, Kajiado: job groups and their pay, 15 staff ready for payroll (approved, with KRA PIN,
-- SHIF and NSSF numbers, M-Pesa or bank details), SACCO / welfare / loan deductions, a salary advance, and this
-- month's harvesting on the piece-rate screens.
--
-- Run once in the Supabase SQL editor (it runs as postgres, so RLS is skipped). It is not a migration: the data is
-- for this one company's demo. It finds the company by its slug, favor-farm-kajiado, and stops if it isn't found or the demo staff are already there.
-- Nothing is paid here: open Payroll and press Start for this month to run it live.
--   * staff have work emails @demo.favorfarm.example, which is how the clean-up finds them; no invitation is sent
--   * KRA PINs, SHIF, NSSF, ID and account numbers are made up (A99... / CR99... / 99...), never real people's
--   * piece-rate work shows on the Work & Piece Rate screens; payroll doesn't add it to payslips yet (FIG-812)
-- To remove it all, run the block at the end of this file (before any payroll run with these staff is approved).

do $$
declare
  t uuid;
  g record;
  gid uuid;
  e record;
  n int := 0;
  harvest uuid;
  weeding uuid;
  sacco uuid;
  welfare uuid;
  loan uuid;
  d date;
  harvesters text[] := '{}';
  num text;
begin
  select id into t from public.tenants where slug = 'favor-farm-kajiado';
  if t is null then
    raise exception 'No company with the slug favor-farm-kajiado (FAVOR FARM, Kajiado) found';
  end if;
  if exists (select 1 from public.employees where tenant_id = t and "Work Email" ilike '%@demo.favorfarm.example') then
    raise notice 'Demo payroll data is already there for this company; nothing done';
    return;
  end if;

  -- job groups and what they pay from 1 January
  for g in
    select * from (values
      ('FF-1', 'General worker',            18000,  2500,     0),
      ('FF-2', 'Skilled worker',            28000,  4000,  2000),
      ('FF-3', 'Supervisor / officer',      52000,  8000,  4000),
      ('FF-4', 'Management',               120000, 20000, 10000)
    ) v(code, name, basic, house, travel)
  loop
    insert into public.job_groups (tenant_id, code, name) values (t, g.code, g.name) on conflict do nothing;
    select id into gid from public.job_groups where tenant_id = t and lower(code) = lower(g.code);
    insert into public.job_group_rates (tenant_id, job_group_id, effective_from, basic_salary, house_allowance, travel_allowance)
    values (t, gid, date '2026-01-01', g.basic, g.house, g.travel)
    on conflict do nothing;
  end loop;

  -- staff: (first, last, gender, job title, group, type, start, pays by, bank)
  for e in
    select * from (values
      ('Daniel',    'Kariuki',  'Male',   'Farm Manager',          'FF-4', 'Permanent', '2021-02-01', 'bank',  'Equity Bank'),
      ('Anne',      'Wairimu',  'Female', 'Accountant',            'FF-3', 'Permanent', '2022-06-01', 'bank',  'KCB Bank'),
      ('Joseph',    'Ndung''u', 'Male',   'Farm Supervisor',       'FF-3', 'Permanent', '2020-09-14', 'bank',  'Co-operative Bank'),
      ('Esther',    'Chebet',   'Female', 'Farm Supervisor',       'FF-3', 'Probation', '2026-10-01', 'bank',  'Equity Bank'),
      ('Paul',      'Kiptoo',   'Male',   'Tractor Driver',        'FF-2', 'Permanent', '2019-04-01', 'mpesa', null),
      ('Mary',      'Atieno',   'Female', 'Drip Irrigation Technician', 'FF-2', 'Permanent', '2023-01-09', 'mpesa', null),
      ('Ruth',      'Nyambura', 'Female', 'Store Clerk',           'FF-2', 'Contract',  '2025-03-03', 'mpesa', null),
      ('James',     'Odhiambo', 'Male',   'Harvester',            'FF-1', 'Permanent', '2018-07-02', 'mpesa', null),
      ('Catherine', 'Wanjiku',  'Female', 'Harvester',            'FF-1', 'Permanent', '2021-05-17', 'mpesa', null),
      ('Moses',     'Kibet',    'Male',   'Harvester',            'FF-1', 'Permanent', '2022-08-01', 'mpesa', null),
      ('Alice',     'Nduta',    'Female', 'Harvester',            'FF-1', 'Contract',  '2025-01-06', 'mpesa', null),
      ('Wycliffe',  'Barasa',   'Male',   'General Worker',        'FF-1', 'Permanent', '2020-02-10', 'mpesa', null),
      ('Rose',      'Achieng',  'Female', 'General Worker',        'FF-1', 'Contract',  '2025-06-02', 'mpesa', null),
      ('Stephen',   'Mutiso',   'Male',   'Night Guard',           'FF-1', 'Permanent', '2019-11-04', 'mpesa', null),
      ('Naomi',     'Jepkoech', 'Female', 'Harvester',            'FF-1', 'Probation', '2026-09-01', 'mpesa', null)
    ) v(first_name, last_name, gender, title, grp, emp_type, start_date, pays_by, bank)
  loop
    n := n + 1;
    select id into gid from public.job_groups where tenant_id = t and lower(code) = lower(e.grp);
    insert into public.employees (
      tenant_id, "First Name", "Last Name", "Gender", "Work Email", "Job Title", "Employee Type", "Start Date",
      "Office", "Country", "Type of Identification", "ID Number", "Mobile Number", "Tax PIN", "SHIF Number",
      "NSSF Number", payment_method, "Bank", "Account Number", account_number_name, job_group_id, onboarding_status)
    values (
      t, e.first_name, e.last_name, e.gender,
      lower(e.first_name || '.' || replace(e.last_name, '''', '')) || '@demo.favorfarm.example',
      e.title, e.emp_type, e.start_date, 'Kajiado', 'Kenya', 'National ID',
      '9900' || lpad(n::text, 4, '0'),
      '07990000' || lpad(n::text, 2, '0'),
      'A9900000' || lpad(n::text, 2, '0') || 'K',
      'CR99000' || lpad(n::text, 5, '0'),
      '99000' || lpad(n::text, 4, '0'),
      e.pays_by, e.bank,
      case when e.pays_by = 'bank' then '99001000' || lpad(n::text, 5, '0') end,
      case when e.pays_by = 'bank' then e.first_name || ' ' || e.last_name end,
      gid, 'approved')
    returning "Employee Number" into num;
    if e.title = 'Harvester' then harvesters := harvesters || num; end if;
  end loop;

  -- the farm manager is paid above the group's rate (shows the override)
  update public.employees set pay_overridden = true, pay_override_reason = 'Agreed on promotion, March 2026',
         "Basic Salary" = 135000
  where tenant_id = t and "Work Email" = 'daniel.kariuki@demo.favorfarm.example';

  -- deductions on the payslip
  insert into public.deduction_types (tenant_id, name) values (t, 'Farm SACCO'), (t, 'Staff Welfare'), (t, 'Staff loan repayment')
    on conflict do nothing;
  select id into sacco from public.deduction_types where tenant_id = t and lower(name) = 'farm sacco';
  select id into welfare from public.deduction_types where tenant_id = t and lower(name) = 'staff welfare';
  select id into loan from public.deduction_types where tenant_id = t and lower(name) = 'staff loan repayment';
  insert into public.employee_deductions (tenant_id, employee_number, deduction_type_id, amount, start_period, end_period, notes)
  select t, x."Employee Number", welfare, 200, null, null, 'Monthly welfare contribution'
    from public.employees x where x.tenant_id = t and x."Work Email" ilike '%@demo.favorfarm.example'
  union all
  select t, x."Employee Number", sacco, case when x."Job Group" in ('FF-3', 'FF-4') then 3000 else 1000 end, null, null, 'SACCO savings'
    from public.employees x where x.tenant_id = t and x."Work Email" in (
      'anne.wairimu@demo.favorfarm.example', 'joseph.ndungu@demo.favorfarm.example',
      'paul.kiptoo@demo.favorfarm.example', 'james.odhiambo@demo.favorfarm.example',
      'catherine.wanjiku@demo.favorfarm.example')
  union all
  select t, x."Employee Number", loan, 2500, to_char(current_date, 'YYYY-MM'),
         to_char(current_date + interval '3 months', 'YYYY-MM'), 'Motorbike loan, KES 10,000 over 4 months'
    from public.employees x where x.tenant_id = t and x."Work Email" = 'paul.kiptoo@demo.favorfarm.example';

  -- a salary advance paid out this month, recovered in this month's payroll
  insert into public.salary_advance (tenant_id, "Employee Number", "Full Name", "Amount Requested", status,
                                     payment_processed, time_added, repayment_months)
  select t, x."Employee Number", 'Moses Kibet', 5000, 'paid', 'true', now() - interval '5 days', 1
    from public.employees x where x.tenant_id = t and x."Work Email" = 'moses.kibet@demo.favorfarm.example';

  -- piece rate: what's harvested and weeded this month, approved
  insert into public.work_types (tenant_id, name, unit, rate) values (t, 'Vegetable harvesting', 'kg', 8), (t, 'Weeding', 'row', 35)
    on conflict do nothing;
  select id into harvest from public.work_types where tenant_id = t and lower(name) = 'vegetable harvesting';
  select id into weeding from public.work_types where tenant_id = t and lower(name) = 'weeding';
  for d in select generate_series(date_trunc('month', current_date)::date, current_date - 1, interval '1 day')::date loop
    continue when extract(isodow from d) = 7;   -- no harvesting on Sundays
    insert into public.work_entries (tenant_id, employee_number, work_date, work_type_id, quantity, rate, status, source)
    select t, p, d, harvest, 28 + ((i * 7 + extract(day from d)::int * 3) % 27), 8, 'approved', 'payroll'
      from unnest(harvesters) with ordinality u(p, i);
    if extract(isodow from d) in (2, 4) then
      insert into public.work_entries (tenant_id, employee_number, work_date, work_type_id, quantity, rate, status, source)
      select t, x."Employee Number", d, weeding, 6 + (extract(day from d)::int % 4), 35, 'approved', 'payroll'
        from public.employees x
       where x.tenant_id = t and x."Work Email" in ('wycliffe.barasa@demo.favorfarm.example', 'rose.achieng@demo.favorfarm.example');
    end if;
  end loop;

  raise notice 'Seeded % staff, job groups, deductions, an advance and piece-rate work for company %', n, t;
end $$;

-- ---------------------------------------------------------------------------------------------
-- To remove the demo staff and everything attached to them (a payroll run that includes them must still be a draft):
-- ---------------------------------------------------------------------------------------------
-- create temp table demo_staff as select e.tenant_id, e."Employee Number" as num from public.employees e
--   join public.tenants t on t.id = e.tenant_id
--   where t.slug = 'favor-farm-kajiado' and e."Work Email" ilike '%@demo.favorfarm.example';
-- delete from public.salary_history h using demo_staff s where h.tenant_id = s.tenant_id and h.employee_id = s.num;
-- delete from public.work_entries w using demo_staff s where w.tenant_id = s.tenant_id and w.employee_number = s.num;
-- delete from public.employee_deductions x using demo_staff s where x.tenant_id = s.tenant_id and x.employee_number = s.num;
-- delete from public.salary_advance a using demo_staff s where a.tenant_id = s.tenant_id and a."Employee Number" = s.num;
-- delete from public.employees e using demo_staff s where e.tenant_id = s.tenant_id and e."Employee Number" = s.num;
-- delete from public.work_types w using demo_staff s where w.tenant_id = s.tenant_id and w.name in ('Vegetable harvesting', 'Weeding')
--   and not exists (select 1 from public.work_entries x where x.work_type_id = w.id);
-- delete from public.deduction_types d using demo_staff s where d.tenant_id = s.tenant_id
--   and d.name in ('Farm SACCO', 'Staff Welfare', 'Staff loan repayment')
--   and not exists (select 1 from public.employee_deductions x where x.deduction_type_id = d.id);
-- delete from public.job_group_rates r using public.job_groups g, demo_staff s where r.job_group_id = g.id
--   and g.tenant_id = s.tenant_id and g.code in ('FF-1', 'FF-2', 'FF-3', 'FF-4')
--   and not exists (select 1 from public.employees x where x.job_group_id = g.id);
-- delete from public.job_groups g using demo_staff s where g.tenant_id = s.tenant_id and g.code in ('FF-1', 'FF-2', 'FF-3', 'FF-4')
--   and not exists (select 1 from public.employees x where x.job_group_id = g.id);
-- delete from public.payroll_runs r using demo_staff s where r.tenant_id = s.tenant_id and r.status = 'draft'
--   and not exists (select 1 from public.salary_history h where h.run_id = r.id);
-- drop table demo_staff;
