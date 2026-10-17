-- Staff contributions and the NITA training levy (FIG-898).
--
-- "Where can I add my other contributions as staff" and "NITA is 50 KES per month". No finance team signs these off,
-- so the defaults below are the usual Kenyan ones and each is a setting or a dated rate.
--
-- Part 1: an employee asks for a contribution from their pay; payroll approves or declines it.
--
--   employee_contributions                one request: kind, amount a month, from month (and optional until), provider,
--                                         reference, an optional supporting document (documents bucket, the
--                                         employee's own folder), status:
--     pending -> active (approved) | declined (with a reason) | cancelled (withdrawn by the employee)
--     active  -> stopped (by the employee or payroll, from the next payroll month) | ended (its until month passed)
--   Approving turns it into the payroll input it belongs to, using what payroll already reads:
--     sacco, welfare, other               a voluntary deduction (employee_deductions) under the company's "SACCO",
--                                         "Welfare" or the provider's deduction type, for the same months
--     pension_avc                         added to employees.other_pension_contribution: taken from pay and deducted
--                                         before PAYE up to pension_deduction_cap (lib/statutoryCalc)
--     prmf                                added to employees.post_retirement_medical_fund (taken from pay, deducted up
--                                         to prmf_deduction_cap)
--     insurance_premium                   added to employees.insurance_premium: insurance relief (15%, capped); the
--                                         employee pays the insurer, nothing is taken from pay
--     mortgage_interest                   added to employees.mortgage_interest: deducted before PAYE up to its cap;
--                                         the employee pays the lender
--   Those four employee amounts have no months of their own, so applied_amount remembers what this request added:
--   sync_employee_contributions(tenant) adds it once the request's first month is the next payroll month and takes it
--   off again after its last month (or when it is stopped). It runs on approve and stop, when a payroll month is
--   approved, when payroll opens the requests, and every morning (pg_cron, best effort).
--   "The next payroll month" is the month after the latest approved (or paid) payroll, and never before this month.
--
--   request_contribution(...)             the employee, for themselves; payroll is told (contribution_requested)
--   decide_contribution(id, approve, reason)   people with the Payroll module, not for themselves; the employee is told
--                                         (employment_update)
--   stop_contribution(id)                 the employee (their own) or payroll: a pending request is withdrawn, an active
--                                         one stops from the next payroll month; the other side is told
--   employee_contributions_list()         payroll: the company's requests; anyone else: their own
--
-- Part 2: the NITA levy (Industrial Training (Training Levy) Order): the EMPLOYER pays KES 50 a month for each
-- employee; it is not taken from pay.
--   statutory_rates 'nita_levy'           50, dated, editable per company in the Rates tab like the other rates
--   salary_history.nita_levy              the levy for that payslip (an employer cost, not in total_deductions or net
--                                         pay), worked out by the database whenever a draft payslip is saved: the
--                                         rate in force on the month's last day; 0 for casual workers and contractors
--                                         (they are not employees on the PAYE payroll)
--   nita_levy_for('YYYY-MM')              payroll: per employee, the month's levy (from the saved payslips)

-- ---------------------------------------------------------------------------------------------
-- 1. notification type (HR-facing): every value from 20261018700000_leave_discipline.sql, plus contribution_requested
-- ---------------------------------------------------------------------------------------------
alter table public.hr_notifications drop constraint if exists hr_notifications_notification_type_check;
alter table public.hr_notifications add constraint hr_notifications_notification_type_check check (notification_type in (
  'contract_expiring', 'probation_expiring', 'leave_recommended', 'leave_approved', 'leave_rejected', 'leave_year_end_reminder',
  'document_accepted', 'document_rejected', 'onboarding_approved', 'onboarding_changes_requested', 'photo_removed',
  'document_requested',
  'salary_advance_approved', 'salary_advance_rejected', 'salary_advance_paid', 'loan_approved', 'loan_rejected',
  'payslip_ready', 'salary_paid', 'expense_approved', 'expense_rejected', 'phone_change_approved', 'phone_change_rejected',
  'incident_update', 'warning_issued', 'suspended', 'reactivated', 'employment_update', 'leave_scheduled', 'policy_to_accept',
  'task_assigned', 'asset_assigned',
  -- every type added since the approval workflows (20261015800000) must stay in this list
  'approval_needed', 'approval_progress',
  'exit_requested', 'exit_approved', 'exit_declined',
  'application_received',
  'loan_requested', 'loan_disbursed', 'loan_repaid',
  'contract_sent', 'contract_sent_back', 'contract_accepted', 'contract_cancelled', 'contract_signed',
  'leave_exhausted', 'casual_limit',
  'leave_document_overdue',
  'contribution_requested'
));

create or replace function public.hr_only_notification(p_type text) returns boolean language sql immutable as $$
  select p_type in ('contract_expiring', 'probation_expiring', 'leave_recommended', 'exit_requested', 'application_received',
                    'loan_requested', 'contract_signed', 'leave_exhausted', 'casual_limit', 'leave_document_overdue',
                    'contribution_requested')
$$;

-- who is emailed each (20261017600000): leave alerts go to people who run leave; casual workers and contributions to payroll
create or replace function public.hr_alert_modules(p_type text) returns text[] language sql immutable as $$
  select case
    when p_type in ('leave_recommended', 'leave_exhausted', 'leave_document_overdue') then array['leaves']
    when p_type = 'application_received' then array['recruitment']
    when p_type in ('loan_requested', 'contribution_requested') then array['payroll']
    when p_type = 'casual_limit' then array['work-records', 'payroll']
    -- contract_expiring, probation_expiring, contract_signed, exit_requested, and any HR-facing type added later
    else array['employees', 'hr-lifecycle']
  end
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. months
-- ---------------------------------------------------------------------------------------------
create or replace function public.period_add(p_period text, p_months integer) returns text
language sql immutable as $$
  select to_char(to_date(p_period || '-01', 'YYYY-MM-DD') + make_interval(months => p_months), 'YYYY-MM')
$$;

create or replace function public.period_label(p_period text) returns text
language sql immutable as $$
  select to_char(to_date(p_period || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY')
$$;

-- the first month a change can still reach: after the latest approved (or paid) payroll, and not before this month
create or replace function public.next_payroll_period(p_tenant uuid) returns text
language sql stable security definer set search_path = public as $$
  select greatest(
    to_char(current_date, 'YYYY-MM'),
    coalesce((select public.period_add(max(r.pay_period), 1) from public.payroll_runs r
              where r.tenant_id = p_tenant and r.status in ('approved', 'paid')), '0000-00'))
$$;
revoke all on function public.next_payroll_period(uuid) from public, anon;
grant execute on function public.next_payroll_period(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. contributions
-- ---------------------------------------------------------------------------------------------
create table if not exists public.employee_contributions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  employee_number text not null,
  kind text not null check (kind in ('pension_avc', 'sacco', 'welfare', 'insurance_premium', 'mortgage_interest', 'prmf', 'other')),
  amount numeric(14, 2) not null check (amount > 0 and amount <= 10000000),
  start_period text not null check (start_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  end_period text check (end_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  provider text check (provider is null or char_length(provider) <= 200),
  reference text check (reference is null or char_length(reference) <= 200),
  note text check (note is null or char_length(note) <= 1000),
  document_path text check (document_path is null or char_length(document_path) <= 500),
  status text not null default 'pending' check (status in ('pending', 'declined', 'cancelled', 'active', 'stopped', 'ended')),
  decline_reason text check (decline_reason is null or char_length(decline_reason) <= 1000),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  stopped_by uuid references auth.users(id) on delete set null,
  stopped_at timestamptz,
  -- the first month it is no longer taken
  stop_period text check (stop_period is null or stop_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- pension, PRMF, insurance premium, mortgage interest: what this request has added to the employee's amount
  applied_amount numeric(14, 2) not null default 0,
  -- SACCO, welfare, other: the voluntary deduction approving it made
  employee_deduction_id uuid references public.employee_deductions(id) on delete set null,
  requested_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (end_period is null or end_period >= start_period),
  foreign key (tenant_id, employee_number) references public.employees(tenant_id, "Employee Number")
    on update cascade on delete cascade
);
create index if not exists employee_contributions_tenant_employee on public.employee_contributions (tenant_id, employee_number);
create index if not exists employee_contributions_tenant_status on public.employee_contributions (tenant_id, status);

alter table public.employee_contributions enable row level security;
drop policy if exists tenant_isolation on public.employee_contributions;
create policy tenant_isolation on public.employee_contributions as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
-- read: payroll, and the employee their own. Changes only through the functions below.
drop policy if exists involved_select on public.employee_contributions;
create policy involved_select on public.employee_contributions for select to authenticated
  using ((select public.has_module('payroll')) or employee_number = (select public.current_employee_number()));
revoke all on public.employee_contributions from anon;
revoke insert, update, delete, truncate on public.employee_contributions from authenticated;

drop trigger if exists audit_employee_contributions on public.employee_contributions;
create trigger audit_employee_contributions after insert or update or delete on public.employee_contributions
  for each row execute function public.audit_row_change();

create or replace function public.contribution_kind_label(p_kind text) returns text
language sql immutable as $$
  select case p_kind
    when 'pension_avc' then 'Pension (AVC)'
    when 'sacco' then 'SACCO'
    when 'welfare' then 'Welfare'
    when 'insurance_premium' then 'Insurance premium'
    when 'mortgage_interest' then 'Mortgage interest'
    when 'prmf' then 'Post-retirement medical fund'
    else 'Other contribution'
  end
$$;

-- the employee amount payroll reads for each kind that has one (the rest become voluntary deductions)
create or replace function public.contribution_employee_field(p_kind text) returns text
language sql immutable as $$
  select case p_kind
    when 'pension_avc' then 'other_pension_contribution'
    when 'prmf' then 'post_retirement_medical_fund'
    when 'insurance_premium' then 'insurance_premium'
    when 'mortgage_interest' then 'mortgage_interest'
  end
$$;

-- "from October 2026", "October 2026 to March 2027"
create or replace function public.contribution_months(p_start text, p_end text) returns text
language sql immutable as $$
  select case when p_end is null then 'from ' || public.period_label(p_start)
              when p_end = p_start then 'for ' || public.period_label(p_start)
              else public.period_label(p_start) || ' to ' || public.period_label(p_end) end
$$;

/**
 * Adds p_delta to one of the employee's payroll amounts (never below 0). Run as the system, not as the person
 * deciding: the employee record's own rules would otherwise treat a payroll-only user as the employee editing it and
 * send the record back for onboarding review. Who decided is kept on the contribution (and its audit trail).
 */
create or replace function public.contribution_adjust_employee(p_tenant uuid, p_employee text, p_kind text, p_delta numeric)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_field text := public.contribution_employee_field(p_kind);
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_claims text := current_setting('request.jwt.claims', true);
begin
  if v_field is null or coalesce(p_delta, 0) = 0 then
    return;
  end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  execute format('update public.employees set %I = greatest(0, coalesce(%I, 0) + $1) where tenant_id = $2 and "Employee Number" = $3',
                 v_field, v_field)
    using p_delta, p_tenant, p_employee;
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end $$;
revoke all on function public.contribution_adjust_employee(uuid, text, text, numeric) from public, anon, authenticated;

/**
 * Brings one company's employee amounts in line with its contributions for the next payroll month: adds an active
 * contribution once it has started, takes it off after its last month or once stopped, and marks finished ones
 * ended. How many contributions changed.
 */
create or replace function public.sync_employee_contributions(p_tenant uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_next text := public.next_payroll_period(p_tenant);
  c public.employee_contributions;
  v_want numeric;
  n integer := 0;
begin
  for c in
    select * from public.employee_contributions x
    where x.tenant_id = p_tenant and (x.status = 'active' or x.applied_amount <> 0)
    order by x.created_at
    for update
  loop
    if public.contribution_employee_field(c.kind) is not null then
      v_want := case when c.status = 'active' and c.start_period <= v_next and (c.end_period is null or c.end_period >= v_next)
                     then c.amount else 0 end;
      if v_want <> c.applied_amount then
        perform public.contribution_adjust_employee(p_tenant, c.employee_number, c.kind, v_want - c.applied_amount);
        update public.employee_contributions set applied_amount = v_want where id = c.id;
        n := n + 1;
      end if;
    end if;
    if c.status = 'active' and c.end_period is not null and c.end_period < v_next then
      update public.employee_contributions set status = 'ended' where id = c.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.sync_employee_contributions(uuid) from public, anon, authenticated;

-- payroll opening the requests: their company brought up to date
create or replace function public.sync_my_company_contributions() returns integer
language plpgsql security definer set search_path = public as $$
begin
  if public.current_tenant_id() is null or not public.has_module('payroll') then
    raise exception 'Only payroll can do this' using errcode = '42501';
  end if;
  return public.sync_employee_contributions(public.current_tenant_id());
end $$;
revoke all on function public.sync_my_company_contributions() from public, anon;
grant execute on function public.sync_my_company_contributions() to authenticated;

-- the daily job: every company with contributions
create or replace function public.sync_employee_contributions_all() returns integer
language plpgsql security definer set search_path = public as $$
declare
  t uuid;
  n integer := 0;
begin
  for t in select distinct x.tenant_id from public.employee_contributions x where x.status = 'active' or x.applied_amount <> 0 loop
    begin
      n := n + public.sync_employee_contributions(t);
    exception when others then
      raise warning 'contributions skipped for company %: %', t, sqlerrm;
    end;
  end loop;
  return n;
end $$;
revoke all on function public.sync_employee_contributions_all() from public, anon, authenticated;

-- approving a payroll month moves "the next payroll month" on: contributions follow
create or replace function public.payroll_run_sync_contributions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    perform public.sync_employee_contributions(new.tenant_id);
  end if;
  return null;
end $$;
revoke all on function public.payroll_run_sync_contributions() from public, anon, authenticated;
drop trigger if exists payroll_run_sync_contributions on public.payroll_runs;
create trigger payroll_run_sync_contributions after update of status on public.payroll_runs
  for each row execute function public.payroll_run_sync_contributions();

/** The employee asks for a contribution from their pay. Payroll is told. */
create or replace function public.request_contribution(
  p_kind text, p_amount numeric, p_start text, p_end text default null, p_provider text default null,
  p_reference text default null, p_note text default null, p_document text default null
) returns public.employee_contributions
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_emp text := public.current_employee_number();
  v_doc text := nullif(btrim(coalesce(p_document, '')), '');
  e public.employees;
  r public.employee_contributions;
  who text;
begin
  if v_tenant is null or v_emp is null then
    raise exception 'Only an employee can ask for a contribution from their own pay' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('pension_avc', 'sacco', 'welfare', 'insurance_premium', 'mortgage_interest', 'prmf', 'other') then
    raise exception 'Choose what kind of contribution it is' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then
    raise exception 'Enter the amount a month (above 0)' using errcode = '22023';
  end if;
  if p_start is null or p_start !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Choose the month it starts' using errcode = '22023';
  end if;
  if p_start < to_char(current_date, 'YYYY-MM') then
    raise exception 'A contribution can''t start in a month that has passed' using errcode = '22023';
  end if;
  if p_end is not null and (p_end !~ '^\d{4}-(0[1-9]|1[0-2])$' or p_end < p_start) then
    raise exception 'The last month can''t be before the first' using errcode = '22023';
  end if;
  if p_kind = 'other' and nullif(btrim(coalesce(p_provider, '')), '') is null then
    raise exception 'Say who the contribution is paid to' using errcode = '22023';
  end if;
  if v_doc is not null and v_doc not like v_tenant::text || '/' || auth.uid()::text || '/%' then
    raise exception 'Upload the document again' using errcode = '22023';
  end if;
  if exists (select 1 from public.employee_contributions x where x.tenant_id = v_tenant and x.employee_number = v_emp
             and x.kind = p_kind and x.status = 'pending') then
    raise exception 'You already have a % request waiting for payroll', lower(public.contribution_kind_label(p_kind))
      using errcode = '23505';
  end if;

  insert into public.employee_contributions (tenant_id, employee_number, kind, amount, start_period, end_period, provider,
                                             reference, note, document_path, requested_by)
  values (v_tenant, v_emp, p_kind, round(p_amount, 2), p_start, p_end, nullif(btrim(left(coalesce(p_provider, ''), 200)), ''),
          nullif(btrim(left(coalesce(p_reference, ''), 200)), ''), nullif(btrim(left(coalesce(p_note, ''), 1000)), ''),
          v_doc, auth.uid())
  returning * into r;

  select * into e from public.employees where tenant_id = v_tenant and "Employee Number" = v_emp;
  who := coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), v_emp);
  insert into public.hr_notifications (tenant_id, employee_number, employee_name, work_email, notification_type, title, message)
  values (v_tenant, v_emp, who, e."Work Email", 'contribution_requested', 'Contribution to review',
    who || ' asked for ' || lower(public.contribution_kind_label(r.kind)) || coalesce(' (' || r.provider || ')', '')
    || ' of ' || public.kes(r.amount) || ' a month, ' || public.contribution_months(r.start_period, r.end_period)
    || '. Review it in Payroll, Deductions.');
  return r;
end $$;
revoke all on function public.request_contribution(text, numeric, text, text, text, text, text, text) from public, anon;
grant execute on function public.request_contribution(text, numeric, text, text, text, text, text, text) to authenticated;

/**
 * Payroll approves or declines a request. Approving makes the payroll input (see the top of this file) from the
 * request's first month, or the next payroll month if that has passed; declining needs a reason. The employee is told.
 */
create or replace function public.decide_contribution(p_id uuid, p_approve boolean, p_reason text default null)
returns public.employee_contributions
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  r public.employee_contributions;
  v_next text;
  v_start text;
  v_type_name text;
  v_type public.deduction_types;
  v_deduction uuid;
  v_reason text := nullif(btrim(left(coalesce(p_reason, ''), 1000)), '');
begin
  if v_tenant is null or not public.has_module('payroll') then
    raise exception 'Only payroll can approve or decline contributions' using errcode = '42501';
  end if;
  select * into r from public.employee_contributions where id = p_id and tenant_id = v_tenant for update;
  if r.id is null then
    raise exception 'No such contribution request' using errcode = '22023';
  end if;
  if r.employee_number = coalesce(public.current_employee_number(), '') then
    raise exception 'Someone else in payroll has to decide your own request' using errcode = '42501';
  end if;
  if r.status <> 'pending' then
    raise exception 'This request has already been dealt with' using errcode = '22023';
  end if;

  if not coalesce(p_approve, false) then
    if v_reason is null then
      raise exception 'Give the employee a reason for declining' using errcode = '22023';
    end if;
    update public.employee_contributions
    set status = 'declined', decline_reason = v_reason, decided_by = auth.uid(), decided_at = now()
    where id = r.id returning * into r;
    perform public.notify_employee_number(r.tenant_id, r.employee_number, 'employment_update', 'Contribution declined',
      'Your ' || lower(public.contribution_kind_label(r.kind)) || ' request of ' || public.kes(r.amount)
      || ' a month was declined. Reason: ' || v_reason || '.');
    return r;
  end if;

  v_next := public.next_payroll_period(v_tenant);
  v_start := greatest(r.start_period, v_next);
  if r.end_period is not null and r.end_period < v_start then
    raise exception 'Its last month (%) has already been paid; decline it and ask the employee for new months',
      public.period_label(r.end_period) using errcode = '22023';
  end if;

  if public.contribution_employee_field(r.kind) is null then
    v_type_name := case r.kind when 'sacco' then 'SACCO' when 'welfare' then 'Welfare'
                               else coalesce(r.provider, 'Other contribution') end;
    select * into v_type from public.deduction_types t
    where t.tenant_id = v_tenant and lower(btrim(t.name)) = lower(btrim(v_type_name));
    if v_type.id is null then
      insert into public.deduction_types (tenant_id, name) values (v_tenant, v_type_name) returning * into v_type;
    elsif not v_type.active then
      raise exception 'The "%" deduction is paused. Resume it in Deductions first, then approve.', v_type.name
        using errcode = '22023';
    end if;
    insert into public.employee_deductions (tenant_id, employee_number, deduction_type_id, amount, start_period, end_period, notes)
    values (v_tenant, r.employee_number, v_type.id, r.amount, v_start, r.end_period,
      left('Asked for by the employee' || coalesce(': ' || nullif(concat_ws(', ', r.provider, 'ref ' || r.reference), ''), ''), 1000))
    returning id into v_deduction;
  end if;

  update public.employee_contributions
  set status = 'active', start_period = v_start, decided_by = auth.uid(), decided_at = now(), employee_deduction_id = v_deduction,
      decline_reason = null
  where id = r.id returning * into r;
  perform public.sync_employee_contributions(v_tenant);
  select * into r from public.employee_contributions where id = r.id;

  perform public.notify_employee_number(r.tenant_id, r.employee_number, 'employment_update', 'Contribution approved',
    'Your ' || lower(public.contribution_kind_label(r.kind)) || ' of ' || public.kes(r.amount) || ' a month was approved, '
    || public.contribution_months(r.start_period, r.end_period) || '. '
    || case when r.kind in ('insurance_premium', 'mortgage_interest')
            then 'It lowers the tax taken from your pay; you keep paying ' || coalesce(r.provider, 'the provider') || ' yourself.'
            when r.kind in ('pension_avc', 'prmf')
            then 'It is taken from your pay and lowers your taxable pay (up to the legal limit).'
            else 'It is taken from your pay each month.' end);
  return r;
end $$;
revoke all on function public.decide_contribution(uuid, boolean, text) from public, anon;
grant execute on function public.decide_contribution(uuid, boolean, text) to authenticated;

/**
 * Stops a contribution: the employee (their own) or payroll. A request still waiting is withdrawn; an active one is no
 * longer taken from the next payroll month. The other side is told.
 */
create or replace function public.stop_contribution(p_id uuid) returns public.employee_contributions
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_own boolean;
  r public.employee_contributions;
  v_next text;
  v_last text;
  e public.employees;
  who text;
begin
  if v_tenant is null then
    raise exception 'Sign in to a company first' using errcode = '42501';
  end if;
  select * into r from public.employee_contributions where id = p_id and tenant_id = v_tenant for update;
  if r.id is null then
    raise exception 'No such contribution' using errcode = '22023';
  end if;
  v_own := r.employee_number = coalesce(public.current_employee_number(), '');
  if not v_own and not public.has_module('payroll') then
    raise exception 'Only the employee or payroll can stop this contribution' using errcode = '42501';
  end if;

  if r.status = 'pending' then
    if not v_own then
      raise exception 'Decline the request instead' using errcode = '22023';
    end if;
    update public.employee_contributions set status = 'cancelled', stopped_by = auth.uid(), stopped_at = now()
    where id = r.id returning * into r;
    return r;
  end if;
  if r.status <> 'active' then
    raise exception 'This contribution is not running' using errcode = '22023';
  end if;

  v_next := public.next_payroll_period(v_tenant);
  v_last := public.period_add(v_next, -1);
  if r.end_period is not null and r.end_period < v_next then
    raise exception 'This contribution has already ended' using errcode = '22023';
  end if;

  if r.employee_deduction_id is not null then
    if v_last < r.start_period then
      delete from public.employee_deductions where id = r.employee_deduction_id and tenant_id = v_tenant;
    else
      update public.employee_deductions set end_period = v_last where id = r.employee_deduction_id and tenant_id = v_tenant;
    end if;
  end if;

  update public.employee_contributions
  set status = 'stopped', stopped_by = auth.uid(), stopped_at = now(), stop_period = v_next,
      end_period = case when v_last < r.start_period then null else v_last end
  where id = r.id returning * into r;
  perform public.sync_employee_contributions(v_tenant);
  select * into r from public.employee_contributions where id = r.id;

  select * into e from public.employees where tenant_id = v_tenant and "Employee Number" = r.employee_number;
  who := coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), r.employee_number);
  if v_own then
    insert into public.hr_notifications (tenant_id, employee_number, employee_name, work_email, notification_type, title, message)
    values (v_tenant, r.employee_number, who, e."Work Email", 'contribution_requested', 'Contribution stopped',
      who || ' stopped their ' || lower(public.contribution_kind_label(r.kind)) || coalesce(' (' || r.provider || ')', '')
      || ' of ' || public.kes(r.amount) || ' a month. It is not taken from ' || public.period_label(v_next) || ' on.');
  else
    perform public.notify_employee_number(v_tenant, r.employee_number, 'employment_update', 'Contribution stopped',
      'Payroll stopped your ' || lower(public.contribution_kind_label(r.kind)) || ' of ' || public.kes(r.amount)
      || ' a month. It is not taken from ' || public.period_label(v_next) || ' on.');
  end if;
  return r;
end $$;
revoke all on function public.stop_contribution(uuid) from public, anon;
grant execute on function public.stop_contribution(uuid) to authenticated;

-- payroll: the company's contributions; anyone else: their own. Newest first, waiting ones on top.
create or replace function public.employee_contributions_list()
returns table (
  id uuid, employee_number text, employee_name text, kind text, amount numeric, start_period text, end_period text,
  provider text, reference text, note text, document_path text, status text, decline_reason text, decided_at timestamptz,
  stopped_at timestamptz, stop_period text, applied_amount numeric, created_at timestamptz, next_payroll_period text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_payroll boolean := public.has_module('payroll');
  v_me text := public.current_employee_number();
begin
  if v_tenant is null then
    raise exception 'Sign in to a company first' using errcode = '42501';
  end if;
  return query
  select x.id, x.employee_number,
         coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), x.employee_number),
         x.kind, x.amount, x.start_period, x.end_period, x.provider, x.reference, x.note, x.document_path, x.status,
         x.decline_reason, x.decided_at, x.stopped_at, x.stop_period, x.applied_amount, x.created_at,
         public.next_payroll_period(v_tenant)
  from public.employee_contributions x
  left join public.employees e on e.tenant_id = x.tenant_id and e."Employee Number" = x.employee_number
  where x.tenant_id = v_tenant and (v_payroll or x.employee_number = v_me)
  order by (x.status = 'pending') desc, x.created_at desc;
end $$;
revoke all on function public.employee_contributions_list() from public, anon;
grant execute on function public.employee_contributions_list() to authenticated;

-- payroll may open the supporting document of a request (the documents bucket otherwise shows a file to its owner
-- and to people who manage employees)
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  drop policy if exists contribution_documents_select on storage.objects;
  create policy contribution_documents_select on storage.objects for select to authenticated
    using (
      bucket_id = 'documents'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (select public.has_module('payroll'))
      and exists (select 1 from public.employee_contributions c where c.document_path = storage.objects.name)
    );
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. NITA training levy
-- ---------------------------------------------------------------------------------------------
insert into public.statutory_rates (tenant_id, code, value, bands, effective_from, effective_to, source)
select null, 'nita_levy', 50, null, date '2012-01-01', null,
       'Industrial Training (Training Levy) Order 2011: KES 50 per employee a month, paid by the employer'
where not exists (select 1 from public.statutory_rates r where r.tenant_id is null and r.code = 'nita_levy');

-- one rate for a company on a day: its own wins over the default
create or replace function public.statutory_rate_for(p_tenant uuid, p_code text, p_day date) returns numeric
language sql stable security definer set search_path = public as $$
  select r.value from public.statutory_rates r
  where r.code = p_code and r.effective_from <= p_day and (r.effective_to is null or r.effective_to >= p_day)
    and (r.tenant_id is null or r.tenant_id = p_tenant)
  order by r.tenant_id nulls last
  limit 1
$$;
revoke all on function public.statutory_rate_for(uuid, text, date) from public, anon;
grant execute on function public.statutory_rate_for(uuid, text, date) to authenticated;

alter table public.salary_history add column if not exists nita_levy numeric(12, 2) not null default 0;

-- the levy on a payslip: the rate in force on the month's last day, unless the person is a casual worker or a
-- contractor. Worked out when a payslip is saved, and again while its month is a draft.
create or replace function public.salary_history_nita_levy() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind text;
  v_status text;
begin
  if tg_op = 'UPDATE' then
    -- renumbering follows through locked payslips without changing figures
    if (to_jsonb(new) - 'employee_id' - 'nita_levy') = (to_jsonb(old) - 'employee_id' - 'nita_levy') then
      new.nita_levy := old.nita_levy;
      return new;
    end if;
    select r.status into v_status from public.payroll_runs r where r.id = new.run_id;
    if v_status is not null and v_status <> 'draft' then
      return new;
    end if;
  end if;
  if new.pay_period is null or new.pay_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    return new;
  end if;
  select coalesce(e.worker_kind, 'employee') into v_kind
  from public.employees e where e.tenant_id = new.tenant_id and e."Employee Number" = new.employee_id;
  new.nita_levy := case when v_kind in ('casual', 'contractor') then 0
                        else coalesce(public.statutory_rate_for(new.tenant_id, 'nita_levy',
                               (to_date(new.pay_period || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date), 0) end;
  return new;
end $$;
revoke all on function public.salary_history_nita_levy() from public, anon, authenticated;
drop trigger if exists salary_history_nita_levy on public.salary_history;
create trigger salary_history_nita_levy before insert or update on public.salary_history
  for each row execute function public.salary_history_nita_levy();

-- payroll: the month's levy per employee (from the saved payslips), largest first
create or replace function public.nita_levy_for(p_period text)
returns table (employee_number text, employee_name text, nita_number text, levy numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null or not public.has_module('payroll') then
    raise exception 'Only payroll can see the NITA levy' using errcode = '42501';
  end if;
  if p_period is null or p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Pay period "%" should look like 2026-09 (year-month)', coalesce(p_period, '') using errcode = '22023';
  end if;
  return query
  select h.employee_id,
         coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), h.employee_name, h.employee_id),
         nullif(btrim(e."NITA"), ''),
         h.nita_levy
  from public.salary_history h
  left join public.employees e on e.tenant_id = h.tenant_id and e."Employee Number" = h.employee_id
  where h.tenant_id = v_tenant and h.pay_period = p_period and h.nita_levy > 0
  order by h.employee_id;
end $$;
revoke all on function public.nita_levy_for(text) from public, anon;
grant execute on function public.nita_levy_for(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. scheduling (best effort): contributions follow the payroll month every morning (05:40 UTC, 08:40 in Nairobi)
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('employee-contributions-daily', '40 5 * * *', $c$select public.sync_employee_contributions_all();$c$);
  else
    raise notice 'pg_cron is not available: contributions follow the payroll month when payroll approves a month or opens the requests.';
  end if;
end $$;

notify pgrst, 'reload schema';
