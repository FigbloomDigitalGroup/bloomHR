-- Onboarding: approve with the essentials; documents, referees and policies can follow later.
-- After 20261021600000_payslip_details. Written to run again safely.
--
-- Until now onboarding was all or nothing: submit_onboarding refused until everything the employee gives was in, and
-- review_onboarding('approve') until everything was in, and only approved employees are paid. One missing referee or
-- accepted policy kept someone off payroll. Now:
--
--   1. Every item the missing-lists already name (onboarding_missing and its parts: 20261012100000, 20261012400000,
--      20261012600000, 20261013400000, 20261021100000) has a machine key (onboarding_item_key(label)), e.g.
--      'Surname' and 'First name' -> full_name, 'KRA PIN' / 'TIN' -> tax_number, 'Bank name' ... 'Account number' ->
--      bank_account, 'Referee' -> referee, 'Agreement: X' -> policies, 'Document: X' -> documents. The labels are the
--      ones the lists already use; nothing new is asked for. onboarding_item_catalogue() lists the keys for Settings.
--   2. Each company decides which keys are essential (company_onboarding_settings.essential_items, edited by HR: the
--      employees or hr-admin module, through save_onboarding_settings). Default: full name, date of birth, phone, ID
--      type and number, the tax number (KRA PIN / TRA TIN / URA TIN by the employee's country), NSSF number, SHA
--      number (asked for in Kenya only), bank details (when paid by bank; M-Pesa / mobile money pay goes to the phone
--      number) and next of kin. Everything else can follow later: required documents, referees, policies to accept,
--      sex, nationality, addresses, personal email, residency, PWD status, emergency contact, a Tanzanian HESLB index
--      number. Health and accommodation records were never needed (20261012500000). Ticking every key restores all or
--      nothing (documents then need an upload to submit and an accepted file to approve, as 20261012400000 had it).
--      HR's own part (position, type of employee, basic salary, payment method) is always needed.
--   3. onboarding_essentials_missing(e, part) is what blocks: submit_onboarding checks the employee's essentials,
--      review_onboarding('approve') the employee's and HR's. onboarding_missing still returns everything, for display.
--      onboarding_followups(e) is what is left to provide (the non-essential items; on an approved record, everything
--      outstanding), each with HR's due date (set_onboarding_followup_due). onboarding_missing_for and
--      onboarding_overview return both.
--   4. Providing a follow-up never sends an approved record back: a field the employee fills in for the first time
--      whose item is not essential is not a change. Changing an essential detail (bank, tax number...) still sends it
--      back, as before. HR reviews documents one by one, as before.
--   5. Reminders: on approval, then every company_onboarding_settings.reminder_every_days days (default 7), and on or
--      after an item's due date, the employee gets a 'document_requested' notification (employee-facing, emailed by
--      the pipeline) listing what is still to provide. HR gets 'onboarding_followups_overdue' (a new HR-facing type)
--      for each employee with items past their due date: when an item becomes overdue, then every reminder interval.
--      run_onboarding_followup_reminders(day), daily from pg_cron (best effort), at most once per person per day.
--   6. The payroll gate is unchanged: approved means payable. Follow-ups never block pay.

-- ---------------------------------------------------------------------------------------------
-- 1. the items, their keys, and the company's essentials
-- ---------------------------------------------------------------------------------------------
-- every item an employee can be asked for, as Settings shows it; payroll_note says why payroll needs it
create or replace function public.onboarding_item_catalogue()
returns table (item_key text, label text, section text, default_essential boolean, payroll_note text, sort integer)
language sql immutable as $$
  select * from (values
    ('full_name', 'Full name (surname and first name)', 'Personal details', true, null::text, 10),
    ('date_of_birth', 'Date of birth', 'Personal details', true, null, 20),
    ('phone_number', 'Phone number (M-Pesa / mobile money pay goes to it)', 'Personal details', true,
      'Salaries paid by M-Pesa or mobile money are sent to this number.', 30),
    ('sex', 'Sex', 'Personal details', false, null, 40),
    ('nationality', 'Nationality', 'Personal details', false, null, 50),
    ('residential_address', 'Residential address', 'Personal details', false, null, 60),
    ('personal_email', 'Personal email', 'Personal details', false, null, 70),
    ('identity', 'ID type and number', 'Identity and statutory numbers', true,
      'Payroll returns list each employee''s ID number.', 110),
    ('tax_number', 'Tax number (KRA PIN in Kenya, TIN in Tanzania and Uganda)', 'Identity and statutory numbers', true,
      'PAYE returns need each employee''s tax number.', 120),
    ('nssf_number', 'NSSF number', 'Identity and statutory numbers', true, 'NSSF returns need each member''s number.', 130),
    ('sha_number', 'SHA number (Kenya only)', 'Identity and statutory numbers', true, 'SHA returns need each member''s number.', 140),
    ('residency', 'Residency for tax', 'Identity and statutory numbers', false, null, 150),
    ('pwd_status', 'Disability (PWD) status and exemption certificate number', 'Identity and statutory numbers', false, null, 160),
    ('heslb_index_number', 'HESLB index number (Tanzania, loan holders)', 'Identity and statutory numbers', false,
      'HESLB repayments need the borrower''s index number.', 170),
    ('bank_account', 'Bank details (when paid by bank)', 'Payment', true, 'Salaries paid by bank need the account.', 210),
    ('next_of_kin', 'Next of kin', 'Contacts', true, null, 310),
    ('emergency_contact', 'Emergency contact', 'Contacts', false, null, 320),
    ('referee', 'Referee', 'Documents, referees and policies', false, null, 410),
    ('documents', 'Required documents (certificates, HELB clearance and the others in Required documents)',
      'Documents, referees and policies', false, null, 420),
    ('policies', 'Policies to accept', 'Documents, referees and policies', false, null, 430)
  ) as c(item_key, label, section, default_essential, payroll_note, sort)
  order by sort
$$;
grant execute on function public.onboarding_item_catalogue() to authenticated, service_role;

create or replace function public.onboarding_default_essentials() returns text[] language sql immutable as $$
  select array_agg(item_key order by sort) from public.onboarding_item_catalogue() where default_essential
$$;

-- the key of an item a missing-list names (its label, as onboarding_missing returns it)
create or replace function public.onboarding_item_key(p_item text) returns text language sql immutable as $$
  select case
    when p_item like 'Document: %' or p_item like 'Review document: %' then 'documents'
    when p_item like 'Agreement: %' then 'policies'
    else case regexp_replace(coalesce(p_item, ''), '\s*\(not valid\)$', '')
      when 'Surname' then 'full_name'
      when 'First name' then 'full_name'
      when 'Date of birth' then 'date_of_birth'
      when 'Sex' then 'sex'
      when 'Nationality' then 'nationality'
      when 'Residential address' then 'residential_address'
      when 'Personal email' then 'personal_email'
      when 'Identity type' then 'identity'
      when 'ID number' then 'identity'
      when 'KRA PIN' then 'tax_number'
      when 'TIN' then 'tax_number'
      when 'SHA number' then 'sha_number'
      when 'NSSF number' then 'nssf_number'
      when 'HESLB index number' then 'heslb_index_number'
      when 'Phone number' then 'phone_number'
      when 'Residency' then 'residency'
      when 'Disability (PWD) status' then 'pwd_status'
      when 'Exemption certificate number' then 'pwd_status'
      when 'Bank name' then 'bank_account'
      when 'Bank branch' then 'bank_account'
      when 'Account name' then 'bank_account'
      when 'Account number' then 'bank_account'
      when 'Emergency contact' then 'emergency_contact'
      when 'Next of kin' then 'next_of_kin'
      when 'Referee' then 'referee'
      when 'Position' then 'position'
      when 'Type of employee' then 'employee_type'
      when 'Basic salary' then 'basic_salary'
      when 'Payment method' then 'payment_method'
      else lower(btrim(regexp_replace(coalesce(p_item, ''), '[^A-Za-z0-9]+', '_', 'g'), '_'))
    end
  end
$$;
grant execute on function public.onboarding_item_key(text) to authenticated, service_role;

-- the item an employees column belongs to (the details the employee gives that send an approved record back)
create or replace function public.onboarding_field_item_key(p_field text) returns text language sql immutable as $$
  select case
    when p_field in ('First Name', 'Last Name') then 'full_name'
    when p_field in ('Type of Identification', 'ID Number') then 'identity'
    when p_field = 'Tax PIN' then 'tax_number'
    when p_field in ('SHIF Number', 'NHIF Number') then 'sha_number'
    when p_field = 'NSSF Number' then 'nssf_number'
    when p_field = 'Mobile Number' then 'phone_number'
    when p_field = 'kra_residency' then 'residency'
    when p_field in ('is_pwd', 'Disability Cert No') then 'pwd_status'
    when p_field in ('Bank', 'Bank Branch', 'account_number_name', 'Account Number', 'bank_code', 'branch_code') then 'bank_account'
    when p_field = 'heslb_index_number' then 'heslb_index_number'
  end
$$;

create table if not exists public.company_onboarding_settings (
  tenant_id uuid primary key default public.current_tenant_id() references public.tenants(id) on delete cascade,
  essential_items text[] not null default public.onboarding_default_essentials(),
  reminder_every_days integer not null default 7,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null
);
alter table public.company_onboarding_settings drop constraint if exists company_onboarding_settings_reminder_every_days_check;
alter table public.company_onboarding_settings add constraint company_onboarding_settings_reminder_every_days_check
  check (reminder_every_days between 1 and 90);

alter table public.company_onboarding_settings enable row level security;
drop policy if exists tenant_isolation on public.company_onboarding_settings;
create policy tenant_isolation on public.company_onboarding_settings as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists read_company on public.company_onboarding_settings;
create policy read_company on public.company_onboarding_settings for select to authenticated using (true);
revoke all on public.company_onboarding_settings from anon;
-- changed only through save_onboarding_settings
revoke insert, update, delete, truncate on public.company_onboarding_settings from authenticated;

-- a company's essential keys (the default until HR changes them)
create or replace function public.onboarding_essential_keys(p_tenant uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((select s.essential_items from public.company_onboarding_settings s where s.tenant_id = p_tenant),
                  public.onboarding_default_essentials())
$$;
revoke all on function public.onboarding_essential_keys(uuid) from public, anon, authenticated;

-- Settings: every item with whether it is essential in the caller's company, and the reminder interval
create or replace function public.onboarding_settings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_keys text[];
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'Sign in to a company first' using errcode = '42501';
  end if;
  v_keys := public.onboarding_essential_keys(v_tenant);
  return jsonb_build_object(
    'reminder_every_days', coalesce((select s.reminder_every_days from public.company_onboarding_settings s where s.tenant_id = v_tenant), 7),
    'customised', exists (select 1 from public.company_onboarding_settings s where s.tenant_id = v_tenant),
    'items', (select jsonb_agg(jsonb_build_object(
                'item_key', c.item_key, 'label', c.label, 'section', c.section, 'essential', c.item_key = any (v_keys),
                'default_essential', c.default_essential, 'payroll_note', c.payroll_note) order by c.sort)
              from public.onboarding_item_catalogue() c));
end $$;
revoke all on function public.onboarding_settings() from public, anon;
grant execute on function public.onboarding_settings() to authenticated;

-- HR saves which items are essential (any choice is allowed; Settings warns about the ones payroll needs) and how
-- often the employee is reminded of what is still to provide
create or replace function public.save_onboarding_settings(p_essential_items text[], p_reminder_every_days integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_unknown text;
  v_items text[];
begin
  if auth.uid() is null or v_tenant is null or not (public.has_module('employees') or public.has_module('hr-admin')) then
    raise exception 'Only HR can change the onboarding settings' using errcode = '42501';
  end if;
  if p_essential_items is null then
    raise exception 'Say which items are essential' using errcode = '23514';
  end if;
  select k into v_unknown from unnest(p_essential_items) k
  where k not in (select c.item_key from public.onboarding_item_catalogue() c) limit 1;
  if v_unknown is not null then
    raise exception 'Unknown onboarding item "%"', v_unknown using errcode = '23514';
  end if;
  if p_reminder_every_days is not null and p_reminder_every_days not between 1 and 90 then
    raise exception 'Remind every 1 to 90 days' using errcode = '23514';
  end if;
  select coalesce(array_agg(c.item_key order by c.sort), '{}') into v_items
  from public.onboarding_item_catalogue() c where c.item_key = any (p_essential_items);
  insert into public.company_onboarding_settings (tenant_id, essential_items, reminder_every_days, updated_at, updated_by)
  values (v_tenant, v_items, coalesce(p_reminder_every_days, 7), now(), auth.uid())
  on conflict (tenant_id) do update set
    essential_items = excluded.essential_items,
    reminder_every_days = coalesce(p_reminder_every_days, company_onboarding_settings.reminder_every_days),
    updated_at = now(), updated_by = auth.uid();
  return public.onboarding_settings();
end $$;
revoke all on function public.save_onboarding_settings(text[], integer) from public, anon;
grant execute on function public.save_onboarding_settings(text[], integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. what blocks, and what can follow later
-- ---------------------------------------------------------------------------------------------
-- What blocks ("employee": submitting; "employer": HR's part; "all": approving): the employee's missing items whose
-- key is essential in the company, all of HR's part, and (when documents are essential) each required document without
-- an upload ("Document: X") or, for HR, with an upload still waiting for review ("Review document: X").
create or replace function public.onboarding_essentials_missing(e public.employees, p_part text default 'all') returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  v_keys text[] := public.onboarding_essential_keys(e.tenant_id);
  m text[] := '{}';
  c record;
begin
  if p_part in ('employee', 'all') then
    select coalesce(array_agg(u.x order by u.o), '{}') into m
    from unnest(public.onboarding_missing(e, 'employee')) with ordinality u(x, o)
    where public.onboarding_item_key(u.x) = any (v_keys);
  end if;
  if p_part in ('employer', 'all') then
    m := m || public.onboarding_missing(e, 'employer');
  end if;
  if 'documents' = any (v_keys) then
    for c in select * from public.document_checklist_for(e) where required loop
      if p_part in ('employee', 'all') and not exists (
        select 1 from public.employee_documents d where d.employee_id = e.id and d.code = c.code and d.status <> 'rejected') then
        m := m || ('Document: ' || c.label);
      elsif p_part in ('employer', 'all') and not exists (
        select 1 from public.employee_documents d where d.employee_id = e.id and d.code = c.code and d.status = 'accepted')
        and exists (select 1 from public.employee_documents d where d.employee_id = e.id and d.code = c.code and d.status = 'pending') then
        m := m || ('Review document: ' || c.label);
      end if;
    end loop;
  end if;
  return m;
end $$;
revoke all on function public.onboarding_essentials_missing(public.employees, text) from public, anon;
grant execute on function public.onboarding_essentials_missing(public.employees, text) to authenticated, service_role;

-- HR's due date for an item still to provide (the item as onboarding_followups names it)
create table if not exists public.onboarding_followup_due_dates (
  employee_id uuid not null references public.employees(id) on delete cascade,
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  item text not null check (btrim(item) <> ''),
  due_date date not null,
  set_by uuid default auth.uid() references auth.users(id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (employee_id, item)
);
create index if not exists onboarding_followup_due_dates_tenant on public.onboarding_followup_due_dates (tenant_id);
alter table public.onboarding_followup_due_dates enable row level security;
drop policy if exists tenant_isolation on public.onboarding_followup_due_dates;
create policy tenant_isolation on public.onboarding_followup_due_dates as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists hr_read on public.onboarding_followup_due_dates;
create policy hr_read on public.onboarding_followup_due_dates for select to authenticated using ((select public.has_module('employees')));
drop policy if exists own_read on public.onboarding_followup_due_dates;
create policy own_read on public.onboarding_followup_due_dates for select to authenticated
  using (employee_id = (select public.current_employee_id()));
revoke all on public.onboarding_followup_due_dates from anon;
revoke insert, update, delete, truncate on public.onboarding_followup_due_dates from authenticated;

-- What is left to provide: the employee's outstanding items (details, referee, policies, and every required document
-- without an accepted file) that are not essential; on an approved record, everything outstanding. Each with its
-- note (where a document is), HR's due date, and whether that date has passed.
create or replace function public.onboarding_followups(e public.employees)
returns table (item_key text, item text, note text, due_date date, overdue boolean, sort integer)
language sql stable security definer set search_path = public as $$
  with keys as (select public.onboarding_essential_keys(e.tenant_id) k),
  items as (
    select public.onboarding_item_key(u.x) as item_key, u.x as item, null::text as note, u.o::integer as sort
    from unnest(public.onboarding_missing(e, 'employee')) with ordinality u(x, o)
    union all
    select 'documents', 'Document: ' || c.label,
           case
             when exists (select 1 from public.employee_documents d where d.employee_id = e.id and d.code = c.code and d.status = 'pending') then 'waiting for HR'
             when exists (select 1 from public.employee_documents d where d.employee_id = e.id and d.code = c.code and d.status = 'rejected') then 'rejected, upload again'
           end,
           1000 + c.sort
    from public.document_checklist_for(e) c
    where c.required
      and not exists (select 1 from public.employee_documents d where d.employee_id = e.id and d.code = c.code and d.status = 'accepted')
  )
  select i.item_key, i.item, i.note, d.due_date, coalesce(d.due_date < current_date, false), i.sort
  from items i
  cross join keys
  left join public.onboarding_followup_due_dates d on d.employee_id = e.id and d.item = i.item
  where e.onboarding_status = 'approved' or not (i.item_key = any (keys.k))
  order by i.sort
$$;
revoke all on function public.onboarding_followups(public.employees) from public, anon;
grant execute on function public.onboarding_followups(public.employees) to authenticated, service_role;

-- HR sets (or, with no date, clears) the due date of an item still to provide
create or replace function public.set_onboarding_followup_due(p_employee uuid, p_item text, p_due date)
returns void language plpgsql security definer set search_path = public as $$
declare
  e public.employees := public.onboarding_record(p_employee, true);
begin
  if p_due is null then
    delete from public.onboarding_followup_due_dates where employee_id = e.id and item = p_item;
    return;
  end if;
  if not exists (select 1 from public.onboarding_followups(e) f where f.item = p_item) then
    raise exception '"%" is not still to provide for this employee', p_item using errcode = '23514';
  end if;
  insert into public.onboarding_followup_due_dates (employee_id, tenant_id, item, due_date, set_by, set_at)
  values (e.id, e.tenant_id, p_item, p_due, auth.uid(), now())
  on conflict (employee_id, item) do update set due_date = excluded.due_date, set_by = excluded.set_by, set_at = now();
end $$;
revoke all on function public.set_onboarding_followup_due(uuid, text, date) from public, anon;
grant execute on function public.set_onboarding_followup_due(uuid, text, date) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. reminders
-- ---------------------------------------------------------------------------------------------
-- the new HR-facing type: every value from 20261019600000_payslip_email_digest.sql, plus onboarding_followups_overdue
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
  'contribution_requested',
  'company_digest',
  'onboarding_followups_overdue'
));

-- (20261019000000's list, plus onboarding_followups_overdue; hr_alert_modules sends it to the employees and
-- hr-lifecycle modules, its default for HR-facing types)
create or replace function public.hr_only_notification(p_type text) returns boolean language sql immutable as $$
  select p_type in ('contract_expiring', 'probation_expiring', 'leave_recommended', 'exit_requested', 'application_received',
                    'loan_requested', 'contract_signed', 'leave_exhausted', 'casual_limit', 'leave_document_overdue',
                    'contribution_requested', 'onboarding_followups_overdue')
$$;

-- each reminder sent to an employee (at most one a day), and each overdue notice sent to HR about them
create table if not exists public.onboarding_followup_reminders (
  employee_id uuid not null references public.employees(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reminded_on date not null,
  items text[] not null default '{}',
  primary key (employee_id, reminded_on)
);
create table if not exists public.onboarding_followup_overdue_notices (
  employee_id uuid not null references public.employees(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  notified_on date not null,
  items text[] not null default '{}',
  primary key (employee_id, notified_on)
);
do $$
declare
  t text;
begin
  foreach t in array array['onboarding_followup_reminders', 'onboarding_followup_overdue_notices'] loop
    execute format('create index if not exists %1$s_tenant on public.%1$I (tenant_id)', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all
      using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()))', t);
    execute format('drop policy if exists hr_read on public.%I', t);
    execute format('create policy hr_read on public.%I for select to authenticated using ((select public.has_module(''employees'')))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;

-- "Updated CV (due 30 Oct 2026)"
create or replace function public.onboarding_followup_text(p_item text, p_due date) returns text language sql immutable as $$
  select p_item || coalesce(' (due ' || to_char(p_due, 'FMDD Mon YYYY') || ')', '')
$$;

-- reminds one employee of what is still to provide, once a day at most; whether it did
create or replace function public.onboarding_remind_employee(e public.employees, p_day date, p_items text[])
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if coalesce(cardinality(p_items), 0) = 0 or coalesce(btrim(e."Employee Number"), '') = '' then
    return false;
  end if;
  insert into public.onboarding_followup_reminders (employee_id, tenant_id, reminded_on, items)
  values (e.id, e.tenant_id, p_day, p_items)
  on conflict (employee_id, reminded_on) do nothing;
  if not found then
    return false;
  end if;
  perform public.notify_employee(e.id, 'document_requested', 'Still to provide for your onboarding',
    'Your onboarding is approved and you are on payroll. Still to provide: ' || array_to_string(p_items, ', ')
    || '. Add them in Onboarding in the staff portal.');
  return true;
end $$;
revoke all on function public.onboarding_remind_employee(public.employees, date, text[]) from public, anon, authenticated;

-- one company, one day: employees with something still to provide are reminded on approval (see review_onboarding),
-- then every reminder_every_days days, and on or after an item's due date; HR hears about each employee with items
-- past their due date when one becomes overdue, then every reminder_every_days days. How many notifications it made.
create or replace function public.onboarding_followup_reminders_for(p_tenant uuid, p_day date default current_date)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_every integer := coalesce((select s.reminder_every_days from public.company_onboarding_settings s where s.tenant_id = p_tenant), 7);
  e public.employees;
  v_last date;
  v_last_hr date;
  v_items text[];
  v_due_now boolean;
  v_overdue text[];
  v_newly_overdue boolean;
  v_first_due date;
  v_name text;
  n integer := 0;
begin
  for e in
    select * from public.employees x
    where x.tenant_id = p_tenant and x.onboarding_status = 'approved' and coalesce(x.worker_kind, 'employee') <> 'casual'
      and public.employee_is_active(x."Status") and coalesce(btrim(x."Employee Number"), '') <> ''
    order by x."Employee Number"
  loop
    select max(r.reminded_on) into v_last from public.onboarding_followup_reminders r where r.employee_id = e.id and r.reminded_on <= p_day;
    select max(o.notified_on) into v_last_hr from public.onboarding_followup_overdue_notices o where o.employee_id = e.id and o.notified_on <= p_day;
    select coalesce(array_agg(public.onboarding_followup_text(f.item, f.due_date) order by f.sort), '{}'),
           coalesce(bool_or(f.due_date <= p_day and (v_last is null or v_last < f.due_date)), false),
           coalesce(array_agg(public.onboarding_followup_text(f.item, f.due_date) order by f.sort) filter (where f.due_date < p_day), '{}'),
           coalesce(bool_or(f.due_date < p_day and (v_last_hr is null or f.due_date >= v_last_hr)), false),
           min(f.due_date) filter (where f.due_date < p_day)
      into v_items, v_due_now, v_overdue, v_newly_overdue, v_first_due
    from public.onboarding_followups(e) f;
    if cardinality(v_items) = 0 then
      continue;
    end if;

    if (v_last is null or p_day - v_last >= v_every or v_due_now)
       and public.onboarding_remind_employee(e, p_day, v_items) then
      n := n + 1;
    end if;

    if cardinality(v_overdue) > 0 and (v_last_hr is null or p_day - v_last_hr >= v_every or v_newly_overdue) then
      insert into public.onboarding_followup_overdue_notices (employee_id, tenant_id, notified_on, items)
      values (e.id, e.tenant_id, p_day, v_overdue)
      on conflict (employee_id, notified_on) do nothing;
      if found then
        v_name := coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), e."Employee Number");
        insert into public.hr_notifications (tenant_id, employee_number, employee_name, work_email, notification_type, title, message, end_date)
        values (e.tenant_id, e."Employee Number", v_name, e."Work Email", 'onboarding_followups_overdue', 'Onboarding items overdue',
          v_name || ' has not yet provided: ' || array_to_string(v_overdue, ', ') || '. Follow it up in Onboarding.', v_first_due);
        n := n + 1;
      end if;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.onboarding_followup_reminders_for(uuid, date) from public, anon, authenticated;

-- the daily job: every company (one company's failure does not stop the others)
create or replace function public.run_onboarding_followup_reminders(p_day date default current_date) returns integer
language plpgsql security definer set search_path = public as $$
declare
  t uuid;
  n integer := 0;
begin
  for t in select distinct x.tenant_id from public.employees x where x.onboarding_status = 'approved' loop
    begin
      n := n + public.onboarding_followup_reminders_for(t, p_day);
    exception when others then
      raise warning 'onboarding follow-up reminders skipped for company %: %', t, sqlerrm;
    end;
  end loop;
  return n;
end $$;
revoke all on function public.run_onboarding_followup_reminders(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. submitting and approving check the essentials only (from 20261012100000)
-- ---------------------------------------------------------------------------------------------
create or replace function public.submit_onboarding(p_employee uuid default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  e public.employees := public.onboarding_record(p_employee, false);
  missing text[];
begin
  if e.onboarding_status not in ('draft', 'invited', 'changes_requested') then
    raise exception 'This record is already %', replace(e.onboarding_status, '_', ' ');
  end if;
  missing := public.onboarding_essentials_missing(e, 'employee');
  if cardinality(missing) > 0 then
    raise exception 'Still missing: %', array_to_string(missing, ', ') using errcode = '23514';
  end if;
  perform public.onboarding_move(e, 'submitted', 'submitted', null);
  return 'submitted';
end $$;

-- HR approves a submitted record once the essentials are in (the employee is reminded of anything still to provide),
-- or sends a submitted or approved one back with a comment
create or replace function public.review_onboarding(p_employee uuid, p_decision text, p_comment text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  e public.employees := public.onboarding_record(p_employee, true);
  missing text[];
  comment text := nullif(btrim(p_comment), '');
  v_items text[];
begin
  if p_decision = 'approve' then
    if e.onboarding_status <> 'submitted' then
      raise exception 'Only a submitted record can be approved (this one is %)', replace(e.onboarding_status, '_', ' ');
    end if;
    missing := public.onboarding_essentials_missing(e, 'all');
    if cardinality(missing) > 0 then
      raise exception 'Still missing: %', array_to_string(missing, ', ') using errcode = '23514';
    end if;
    perform public.onboarding_move(e, 'approved', 'approved', comment);
    select * into e from public.employees where id = e.id;
    if coalesce(e.worker_kind, 'employee') <> 'casual' then
      select coalesce(array_agg(public.onboarding_followup_text(f.item, f.due_date) order by f.sort), '{}') into v_items
      from public.onboarding_followups(e) f;
      perform public.onboarding_remind_employee(e, current_date, v_items);
    end if;
    return 'approved';
  elsif p_decision = 'request_changes' then
    if e.onboarding_status not in ('submitted', 'approved') then
      raise exception 'Only a submitted or approved record can be sent back (this one is %)', replace(e.onboarding_status, '_', ' ');
    end if;
    if comment is null then
      raise exception 'Say what needs changing' using errcode = '23514';
    end if;
    perform public.onboarding_move(e, 'changes_requested', 'changes_requested', comment);
    return 'changes_requested';
  end if;
  raise exception 'Decision must be approve or request_changes';
end $$;

revoke all on function public.submit_onboarding(uuid) from public, anon;
revoke all on function public.review_onboarding(uuid, text, text) from public, anon;
grant execute on function public.submit_onboarding(uuid) to authenticated;
grant execute on function public.review_onboarding(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. providing a follow-up does not send an approved record back
--    (20261021100000's employee record checks; only the "goes back to HR" step changes: a field the employee fills in
--    for the first time whose item is not essential in the company is not a change)
-- ---------------------------------------------------------------------------------------------
create or replace function public.employees_onboarding_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  is_insert boolean := tg_op = 'INSERT';
  in_transition boolean := coalesce(current_setting('app.onboarding_transition', true), '') = 'on';
  is_staff boolean := auth.uid() is not null and not public.can_write_employees();
  changed text[];
  v_country text := coalesce(public.employee_row_country(new.tenant_id, new.branch_id, new."Branch"), 'Kenya');
begin
  -- tidy: identifiers without spaces, upper case; blanks are empty
  new."Tax PIN" := public.tidy_tax_number(v_country, new."Tax PIN");
  new."ID Number" := nullif(upper(regexp_replace(coalesce(new."ID Number", ''), '\s', '', 'g')), '');
  new."SHIF Number" := nullif(upper(regexp_replace(coalesce(new."SHIF Number", ''), '\s', '', 'g')), '');
  new."NSSF Number" := nullif(regexp_replace(coalesce(new."NSSF Number", ''), '[\s-]', '', 'g'), '');
  new."Mobile Number" := nullif(regexp_replace(coalesce(new."Mobile Number", ''), '[\s().-]', '', 'g'), '');
  new."Type of Identification" := nullif(btrim(new."Type of Identification"), '');
  -- the older forms only ask for a national ID number and have no identity type
  if new."ID Number" is not null and new."Type of Identification" is null then
    new."Type of Identification" := 'National ID';
  end if;
  new."Disability Cert No" := nullif(btrim(new."Disability Cert No"), '');
  -- a Tanzanian National ID (NIDA) is written with dashes: kept as its 20 digits
  if v_country = 'Tanzania' and new."Type of Identification" = 'National ID' then
    new."ID Number" := nullif(replace(coalesce(new."ID Number", ''), '-', ''), '');
  end if;
  -- Tanzania: the HESLB Form Four index number, upper case (20261021000000)
  new.heslb_index_number := nullif(upper(btrim(coalesce(new.heslb_index_number, ''))), '');

  -- formats, checked when a value is new or changed
  if new."Tax PIN" is not null and (is_insert or new."Tax PIN" is distinct from old."Tax PIN")
     and not public.tax_number_ok(v_country, new."Tax PIN") then
    raise exception '% "%" %', public.tax_number_label(v_country), new."Tax PIN", public.tax_number_hint(v_country) using errcode = '23514';
  end if;
  if new."ID Number" is not null and (is_insert or new."ID Number" is distinct from old."ID Number"
     or new."Type of Identification" is distinct from old."Type of Identification") then
    if not public.identity_number_ok_in(v_country, new."Type of Identification", new."ID Number") then
      raise exception '"%" is not a valid % number', new."ID Number", new."Type of Identification" using errcode = '23514';
    end if;
  end if;
  if new."SHIF Number" is not null and (is_insert or new."SHIF Number" is distinct from old."SHIF Number")
     and not public.sha_number_ok(new."SHIF Number") then
    raise exception 'SHA number "%" should be letters and digits only', new."SHIF Number" using errcode = '23514';
  end if;
  if new."NSSF Number" is not null and (is_insert or new."NSSF Number" is distinct from old."NSSF Number")
     and not public.social_security_number_ok(v_country, new."NSSF Number") then
    raise exception 'NSSF number "%" %', new."NSSF Number", public.social_security_number_hint(v_country) using errcode = '23514';
  end if;
  if new."Mobile Number" is not null and (is_insert or new."Mobile Number" is distinct from old."Mobile Number")
     and not public.phone_ok(new."Mobile Number") then
    raise exception 'Phone number "%" should look like 0712345678, or start with + and the country code', new."Mobile Number"
      using errcode = '23514';
  end if;

  -- unique within the company (the unique indexes back this up); the message does not say who has it
  if new."ID Number" is not null and (is_insert or new."ID Number" is distinct from old."ID Number") and exists (
    select 1 from public.employees where tenant_id = new.tenant_id and "ID Number" = new."ID Number" and id <> new.id) then
    raise exception 'Another employee in this company already has ID number %', new."ID Number" using errcode = '23505';
  end if;
  if new."Tax PIN" is not null and (is_insert or new."Tax PIN" is distinct from old."Tax PIN") and exists (
    select 1 from public.employees where tenant_id = new.tenant_id and "Tax PIN" = new."Tax PIN" and id <> new.id) then
    raise exception 'Another employee in this company already has % %', public.tax_number_label(v_country), new."Tax PIN" using errcode = '23505';
  end if;
  if new."SHIF Number" is not null and (is_insert or new."SHIF Number" is distinct from old."SHIF Number") and exists (
    select 1 from public.employees where tenant_id = new.tenant_id and "SHIF Number" = new."SHIF Number" and id <> new.id) then
    raise exception 'Another employee in this company already has SHA number %', new."SHIF Number" using errcode = '23505';
  end if;
  if new."NSSF Number" is not null and (is_insert or new."NSSF Number" is distinct from old."NSSF Number") and exists (
    select 1 from public.employees where tenant_id = new.tenant_id and "NSSF Number" = new."NSSF Number" and id <> new.id) then
    raise exception 'Another employee in this company already has NSSF number %', new."NSSF Number" using errcode = '23505';
  end if;

  -- payroll number: generated, never typed (the backend may bring one over from another system)
  if is_insert then
    if auth.uid() is not null or coalesce(btrim(new."Payroll Number"), '') = '' then
      new."Payroll Number" := public.next_payroll_number(new.tenant_id);
    end if;
  elsif auth.uid() is not null then
    new."Payroll Number" := old."Payroll Number";
  end if;

  -- onboarding status: a new record starts as a draft; afterwards only the onboarding functions move it
  if is_insert then
    if auth.uid() is not null then
      new.onboarding_status := 'draft';
      new.onboarding_submitted_at := null;
      new.onboarding_reviewed_by := null;
      new.onboarding_reviewed_at := null;
      new.onboarding_review_comment := null;
    end if;
    return new;
  end if;

  if auth.uid() is not null and not in_transition then
    if new.onboarding_status is distinct from old.onboarding_status then
      raise exception 'Onboarding moves on by submitting or reviewing the record, not by editing it' using errcode = '42501';
    end if;
    new.onboarding_submitted_at := old.onboarding_submitted_at;
    new.onboarding_reviewed_by := old.onboarding_reviewed_by;
    new.onboarding_reviewed_at := old.onboarding_reviewed_at;
    new.onboarding_review_comment := old.onboarding_review_comment;
  end if;

  -- an employee changing an approved record's details sends it back to HR (and out of payroll until approved)
  if is_staff and not in_transition and old.onboarding_status = 'approved' then
    select array_agg(k order by k) into changed
    from unnest(public.onboarding_review_fields()) k
    where (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k)
      -- filling in a follow-up (an empty field whose item is not essential) is not a change
      and not (nullif(btrim(coalesce(to_jsonb(old) ->> k, '')), '') is null
               and coalesce(public.onboarding_field_item_key(k) <> all (public.onboarding_essential_keys(new.tenant_id)), false));
    if changed is not null then
      new.onboarding_status := 'submitted';
      new.onboarding_submitted_at := now();
      insert into public.employee_onboarding_reviews (tenant_id, employee_id, action, changed_fields, actor)
      values (new.tenant_id, new.id, 'resubmitted', changed, auth.uid());
    end if;
  end if;
  return new;
end $$;

drop trigger if exists employees_onboarding_rules on public.employees;
create trigger employees_onboarding_rules before insert or update on public.employees
  for each row execute function public.employees_onboarding_rules();

-- ---------------------------------------------------------------------------------------------
-- 6. what the screens read (from 20261013400000 and 20261017900000): the essentials and the follow-ups too
-- ---------------------------------------------------------------------------------------------
-- a follow-up for the screens
create or replace function public.onboarding_followups_json(e public.employees) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('item_key', f.item_key, 'item', f.item, 'note', f.note,
                                               'due_date', f.due_date, 'overdue', f.overdue) order by f.sort), '[]'::jsonb)
  from public.onboarding_followups(e) f
$$;
revoke all on function public.onboarding_followups_json(public.employees) from public, anon, authenticated;

drop function if exists public.onboarding_missing_for(uuid);
create function public.onboarding_missing_for(p_employee uuid default null)
returns table (employee_part text[], employer_part text[], documents_outstanding text[],
               essentials_employee text[], essentials_employer text[], followups jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
  e public.employees := public.onboarding_record(p_employee, false);
begin
  return query select public.onboarding_missing(e, 'employee'), public.onboarding_missing(e, 'employer'), public.documents_outstanding(e),
                      public.onboarding_essentials_missing(e, 'employee'), public.onboarding_essentials_missing(e, 'employer'),
                      public.onboarding_followups_json(e);
end $$;
revoke all on function public.onboarding_missing_for(uuid) from public, anon;
grant execute on function public.onboarding_missing_for(uuid) to authenticated;

drop function if exists public.onboarding_overview();
create function public.onboarding_overview()
returns table (
  id uuid, employee_number text, payroll_number text, name text, job_title text, work_email text,
  status text, submitted_at timestamptz, reviewed_at timestamptz, review_comment text,
  employee_part text[], employer_part text[], documents_outstanding text[],
  essentials_missing text[], followups text[], followups_overdue integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_module('employees') then
    raise exception 'Only HR can do this' using errcode = '42501';
  end if;
  return query
  select e.id, e."Employee Number", e."Payroll Number",
         btrim(concat_ws(' ', e."First Name", e."Middle Name", e."Last Name")), e."Job Title", e."Work Email",
         e.onboarding_status, e.onboarding_submitted_at, e.onboarding_reviewed_at, e.onboarding_review_comment,
         public.onboarding_missing(e, 'employee'), public.onboarding_missing(e, 'employer'), public.documents_outstanding(e),
         public.onboarding_essentials_missing(e, 'all'), f.items, f.overdue
  from public.employees e
  cross join lateral (
    select coalesce(array_agg(x.item order by x.sort), '{}') as items, (count(*) filter (where x.overdue))::integer as overdue
    from public.onboarding_followups(e) x
  ) f
  where e.tenant_id = public.current_tenant_id() and coalesce(e.worker_kind, 'employee') <> 'casual'
  order by e."First Name", e."Last Name", e."Employee Number";
end $$;
revoke all on function public.onboarding_overview() from public, anon;
grant execute on function public.onboarding_overview() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. scheduling (best effort): reminders every morning (06:00 UTC, 09:00 in Nairobi)
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('onboarding-followups-daily', '0 6 * * *', $c$select public.run_onboarding_followup_reminders();$c$);
  else
    raise notice 'pg_cron is not available: onboarding follow-up reminders go out on approval only.';
  end if;
end $$;

notify pgrst, 'reload schema';
