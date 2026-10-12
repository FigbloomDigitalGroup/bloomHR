-- Employee onboarding, part 1: the record holds everything the three monthly returns need, and nobody is paid until
-- HR has approved it.
--
--   KRA PAYE (iTax P10), SHA and NSSF returns are filled straight from employee columns (the field-to-return table is
--   in docs/ONBOARDING.md). HR enters the employment and pay fields; the employee fills in their personal, statutory
--   and bank details through the invite; HR approves or sends the record back with a comment.
--
--   1. New columns: KRA type of employee and residency, PWD, non-cash benefits, pension / PRMF / NSSF voluntary,
--      mortgage interest and insurance premium claims, preferred name, nationality, addresses, bank and branch codes,
--      and the onboarding status. "ID Number" becomes text (passport, alien and refugee numbers have letters);
--      the cash allowances become numbers.
--   2. Rules, checked whenever a value is saved or changed (a malformed old value does not block unrelated edits):
--      KRA PIN upper case A123456789B; ID number per identity type; phone number; SHA and NSSF numbers. ID number,
--      KRA PIN, SHA number and NSSF number are unique within a company.
--   3. Payroll Number is generated per company (PR-00001, PR-00002, ...) and can't be edited.
--   4. Staff edit only their own personal, statutory and bank details. Changing any of those on an approved record
--      sends it back to HR for review.
--   5. draft -> invited -> submitted -> approved, or submitted -> changes_requested -> submitted. Only
--      submit_onboarding / review_onboarding / start_onboarding move a record, and each step is kept in
--      employee_onboarding_reviews.
--   6. Every change to an employee record, emergency contact or next of kin (a new table) goes into audit_log.
--   7. Statutory rates, caps and reliefs live in statutory_rates with effective dates.
--
-- Existing records are tidied first: identifiers are trimmed and upper-cased, the old NHIF number fills an empty SHA
-- number, and where two employees of one company share an ID, KRA PIN, SHA or NSSF number the earliest record keeps
-- it and the others are cleared (the cleared value is kept in audit_log). Every existing employee starts as a draft.

-- ---------------------------------------------------------------------------------------------
-- 1. columns
-- ---------------------------------------------------------------------------------------------
create or replace function pg_temp.to_amount(v text) returns numeric language sql immutable as $$
  select case when x ~ '^\d+(\.\d+)?$' then x::numeric end
  from (select regexp_replace(coalesce(v, ''), '(?i)ksh|kes|[,\s]', '', 'g') as x) s
$$;

alter table public.employees alter column "ID Number" type text using "ID Number"::text;
alter table public.employees alter column house_allowance type numeric(14,2) using pg_temp.to_amount(house_allowance);
alter table public.employees alter column travel_allowance type numeric(14,2) using pg_temp.to_amount(travel_allowance);
alter table public.employees alter column hardship type numeric(14,2) using pg_temp.to_amount(hardship);

alter table public.employees
  add column if not exists preferred_name text,
  add column if not exists nationality text,
  add column if not exists residential_address text,
  add column if not exists permanent_address text,
  add column if not exists kra_employee_type text,
  add column if not exists kra_residency text,
  add column if not exists is_pwd boolean,
  add column if not exists other_cash_allowances numeric(14,2),
  add column if not exists car_benefit numeric(14,2),
  add column if not exists meals_benefit numeric(14,2),
  add column if not exists non_cash_benefit numeric(14,2),
  add column if not exists housing_benefit numeric(14,2),
  add column if not exists other_benefits numeric(14,2),
  add column if not exists other_pension_contribution numeric(14,2),
  add column if not exists post_retirement_medical_fund numeric(14,2),
  add column if not exists nssf_voluntary_contribution numeric(14,2),
  add column if not exists mortgage_interest numeric(14,2),
  add column if not exists insurance_premium numeric(14,2),
  add column if not exists bank_code text,
  add column if not exists branch_code text,
  add column if not exists bank_paybill text,
  add column if not exists onboarding_status text not null default 'draft',
  add column if not exists onboarding_submitted_at timestamptz,
  add column if not exists onboarding_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists onboarding_reviewed_at timestamptz,
  add column if not exists onboarding_review_comment text;

alter table public.employees
  add constraint employees_kra_employee_type_check
    check (kra_employee_type in ('Primary Employee', 'Secondary Employee')),
  add constraint employees_kra_residency_check check (kra_residency in ('Resident', 'Non-Resident')),
  add constraint employees_onboarding_status_check
    check (onboarding_status in ('draft', 'invited', 'submitted', 'changes_requested', 'approved')),
  add constraint employees_amounts_not_negative check (
    coalesce(house_allowance, 0) >= 0 and coalesce(travel_allowance, 0) >= 0 and coalesce(hardship, 0) >= 0
    and coalesce(other_cash_allowances, 0) >= 0 and coalesce(car_benefit, 0) >= 0 and coalesce(meals_benefit, 0) >= 0
    and coalesce(non_cash_benefit, 0) >= 0 and coalesce(housing_benefit, 0) >= 0 and coalesce(other_benefits, 0) >= 0
    and coalesce(other_pension_contribution, 0) >= 0 and coalesce(post_retirement_medical_fund, 0) >= 0
    and coalesce(nssf_voluntary_contribution, 0) >= 0 and coalesce(mortgage_interest, 0) >= 0
    and coalesce(insurance_premium, 0) >= 0);

-- one emergency contact and one next of kin per employee, each with a second number and an address
alter table public.emergency_contact
  add column if not exists alternative_phone text,
  add column if not exists physical_address text;

create table if not exists public.next_of_kin (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  "Employee Number" text not null,
  full_name text not null,
  relationship text not null,
  phone_number text not null,
  alternative_phone text,
  email text,
  physical_address text,
  created_at timestamptz not null default now(),
  unique (tenant_id, "Employee Number"),
  foreign key (tenant_id, "Employee Number") references public.employees(tenant_id, "Employee Number")
    on update cascade on delete cascade
);

-- the same rules as emergency_contact: the employee keeps their own, HR keeps everyone's
alter table public.next_of_kin enable row level security;
drop policy if exists tenant_isolation on public.next_of_kin;
create policy tenant_isolation on public.next_of_kin as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists module_access on public.next_of_kin;
create policy module_access on public.next_of_kin for all to authenticated
  using (public.has_module('employees')) with check (public.has_module('employees'));
drop policy if exists own_all on public.next_of_kin;
create policy own_all on public.next_of_kin for all to authenticated
  using ("Employee Number" = (select public.current_employee_number()))
  with check ("Employee Number" = (select public.current_employee_number()));
revoke all on public.next_of_kin from anon;

-- audit rows for tables whose key is not a uuid
alter table public.audit_log add column if not exists record_key text;

-- ---------------------------------------------------------------------------------------------
-- 2. formats (the app checks the same rules in src/lib/onboardingValidation.ts)
-- ---------------------------------------------------------------------------------------------
create or replace function public.kra_pin_ok(p text) returns boolean language sql immutable as $$
  select p ~ '^A\d{9}[A-Z]$'
$$;

create or replace function public.identity_number_ok(p_type text, p_number text) returns boolean
language sql immutable as $$
  select case p_type
    when 'National ID' then p_number ~ '^\d{6,9}$'
    when 'Alien ID' then p_number ~ '^[A-Z0-9]{5,12}$'
    when 'Refugee ID' then p_number ~ '^[A-Z0-9/-]{5,20}$'
    when 'Passport Number' then p_number ~ '^[A-Z0-9]{6,9}$'
    else false
  end
$$;

-- Kenyan mobile (07.., 01.., 2547.., +2547..) or an international number with its + country code
create or replace function public.phone_ok(p text) returns boolean language sql immutable as $$
  select p ~ '^(0[17]\d{8}|\+?254[17]\d{8}|\+[1-9]\d{7,14})$'
$$;

create or replace function public.nssf_number_ok(p text) returns boolean language sql immutable as $$
  select p ~ '^\d{5,12}$'
$$;

create or replace function public.sha_number_ok(p text) returns boolean language sql immutable as $$
  select p ~ '^[A-Z0-9-]{4,20}$'
$$;

-- ---------------------------------------------------------------------------------------------
-- tidy existing records
-- ---------------------------------------------------------------------------------------------
update public.employees set
  "Tax PIN" = nullif(upper(regexp_replace(coalesce("Tax PIN", ''), '\s', '', 'g')), ''),
  "ID Number" = nullif(upper(regexp_replace(coalesce("ID Number", ''), '\s', '', 'g')), ''),
  "SHIF Number" = nullif(upper(regexp_replace(coalesce(nullif(btrim("SHIF Number"), ''), "NHIF Number", ''), '\s', '', 'g')), ''),
  "NSSF Number" = nullif(regexp_replace(coalesce("NSSF Number", ''), '[\s-]', '', 'g'), ''),
  "Mobile Number" = nullif(regexp_replace(coalesce("Mobile Number", ''), '[\s().-]', '', 'g'), ''),
  "Payroll Number" = nullif(btrim("Payroll Number"), ''),
  "Type of Identification" = case
    when "Type of Identification" ~* 'passport' then 'Passport Number'
    when "Type of Identification" ~* 'alien|foreign' then 'Alien ID'
    when "Type of Identification" ~* 'refugee' then 'Refugee ID'
    when "Type of Identification" ~* 'national|kenya|^\s*n?id\s*$' then 'National ID'
    -- "ID Number" was a number column, so an existing number without a type is a national ID
    when coalesce(btrim("Type of Identification"), '') = '' and coalesce(btrim("ID Number"), '') <> '' then 'National ID'
  end;

alter table public.employees add constraint employees_identity_type_check
  check ("Type of Identification" in ('National ID', 'Alien ID', 'Refugee ID', 'Passport Number'));

-- shared numbers: the earliest record keeps it; the others are cleared and the old value kept in audit_log
do $$
declare
  col text;
begin
  foreach col in array array['ID Number', 'Tax PIN', 'SHIF Number', 'NSSF Number', 'Payroll Number'] loop
    execute format($q$
      with ranked as (
        select id, tenant_id, %1$I as v,
               row_number() over (partition by tenant_id, %1$I order by created_at nulls last, id) as rn
        from public.employees where %1$I is not null
      ), cleared as (
        update public.employees e set %1$I = null from ranked r where r.id = e.id and r.rn > 1
        returning r.id, r.tenant_id, r.v
      )
      insert into public.audit_log (tenant_id, record_id, table_name, action_type, old_data, new_data)
      select tenant_id, id, 'employees', 'MIGRATION_CLEARED_DUPLICATE', jsonb_build_object(%2$L, v), jsonb_build_object(%2$L, null)
      from cleared
    $q$, col, col);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. payroll numbers
-- ---------------------------------------------------------------------------------------------
create table if not exists public.payroll_number_counters (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  last_value integer not null default 0
);
-- only next_payroll_number uses it: RLS with no permissive policy keeps everyone else out
alter table public.payroll_number_counters enable row level security;
drop policy if exists tenant_isolation on public.payroll_number_counters;
create policy tenant_isolation on public.payroll_number_counters as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
revoke all on public.payroll_number_counters from anon;

insert into public.payroll_number_counters (tenant_id, last_value)
select tenant_id, max(substring("Payroll Number" from '^PR-(\d+)$')::integer)
from public.employees where "Payroll Number" ~ '^PR-\d+$'
group by tenant_id
on conflict (tenant_id) do nothing;

create or replace function public.next_payroll_number(p_tenant uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  n integer;
  candidate text;
begin
  loop
    insert into public.payroll_number_counters as c (tenant_id, last_value) values (p_tenant, 1)
      on conflict (tenant_id) do update set last_value = c.last_value + 1
      returning last_value into n;
    candidate := 'PR-' || lpad(n::text, greatest(5, length(n::text)), '0');
    -- an older, hand-typed number may already use it
    exit when not exists (select 1 from public.employees where tenant_id = p_tenant and "Payroll Number" = candidate);
  end loop;
  return candidate;
end $$;
revoke all on function public.next_payroll_number(uuid) from public, anon, authenticated;

do $$
declare
  r record;
begin
  for r in select id, tenant_id from public.employees where "Payroll Number" is null order by tenant_id, created_at nulls last, id loop
    update public.employees set "Payroll Number" = public.next_payroll_number(r.tenant_id) where id = r.id;
  end loop;
end $$;

alter table public.employees alter column "Payroll Number" set not null;
create unique index if not exists employees_payroll_number_key on public.employees (tenant_id, "Payroll Number");
create unique index if not exists employees_id_number_key on public.employees (tenant_id, "ID Number") where "ID Number" is not null;
create unique index if not exists employees_tax_pin_key on public.employees (tenant_id, "Tax PIN") where "Tax PIN" is not null;
create unique index if not exists employees_sha_number_key on public.employees (tenant_id, "SHIF Number") where "SHIF Number" is not null;
create unique index if not exists employees_nssf_number_key on public.employees (tenant_id, "NSSF Number") where "NSSF Number" is not null;

-- ---------------------------------------------------------------------------------------------
-- 4. who edits what
-- ---------------------------------------------------------------------------------------------
-- Details the employee gives that the returns or payments depend on: changing one on an approved record sends it back
-- to HR. ("Mobile Number" has its own rule in the guard.)
create or replace function public.onboarding_review_fields() returns text[] language sql immutable as $$
  select array[
    'First Name', 'Middle Name', 'Last Name', 'Type of Identification', 'ID Number', 'Tax PIN', 'SHIF Number',
    'NHIF Number', 'NSSF Number', 'Mobile Number', 'kra_residency', 'is_pwd', 'Disability Cert No',
    'mortgage_interest', 'insurance_premium', 'Bank', 'Bank Branch', 'account_number_name', 'Account Number',
    'bank_code', 'branch_code', 'bank_paybill'
  ]
$$;

-- Everything an employee may change on their own record (their HELB loan details included). Pay, benefits, pension,
-- statutory deductions, job and company details are HR's.
create or replace function public.employee_self_edit_fields() returns text[] language sql immutable as $$
  select public.onboarding_review_fields() || array[
    'preferred_name', 'nationality', 'residential_address', 'permanent_address', 'Personal Mobile',
    'Alternative Mobile Number', 'Personal Email', 'Date of Birth', 'Gender', 'Marital Status', 'Country',
    'Postal Address', 'Postal Code', 'Postal Location', 'City', 'Area', 'Road', 'House Number', 'passport_number',
    'blood_group', 'religion', 'Profile Image', 'HELB', 'HELB option'
  ]
$$;

create or replace function public.guard_employee_self_update()
returns trigger
language plpgsql
as $$
declare
  k text;
  allowed text[] := public.employee_self_edit_fields();
begin
  -- the backend (service role / migrations) and people who manage employees are not limited
  if auth.uid() is null or public.can_write_employees() then
    return new;
  end if;

  for k in
    select o.key from jsonb_each(to_jsonb(old)) o
    join jsonb_each(to_jsonb(new)) n on n.key = o.key
    where o.value is distinct from n.value
  loop
    -- submit_onboarding moves the employee's own record on
    if k like 'onboarding\_%' and coalesce(current_setting('app.onboarding_transition', true), '') = 'on' then
      continue;
    end if;
    -- the primary mobile number may be set freely until the record is approved, and afterwards only while it is
    -- empty; changing it later goes through HR
    if k = 'Mobile Number' then
      if old.onboarding_status <> 'approved' or coalesce(btrim(old."Mobile Number"), '') = '' then
        continue;
      end if;
      raise exception 'Only HR can change your "Mobile Number" once it is set' using errcode = '42501';
    end if;
    if k <> all (allowed) then
      raise exception 'You can only change your own personal details (not "%")', k
        using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. onboarding history
-- ---------------------------------------------------------------------------------------------
create table if not exists public.employee_onboarding_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  action text not null check (action in ('invited', 'submitted', 'resubmitted', 'approved', 'changes_requested')),
  comment text,
  changed_fields text[],
  actor uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists employee_onboarding_reviews_employee_idx on public.employee_onboarding_reviews (employee_id, created_at);

alter table public.employee_onboarding_reviews enable row level security;
drop policy if exists tenant_isolation on public.employee_onboarding_reviews;
create policy tenant_isolation on public.employee_onboarding_reviews as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
-- written only by the onboarding functions; HR reads all, an employee their own
drop policy if exists hr_read on public.employee_onboarding_reviews;
create policy hr_read on public.employee_onboarding_reviews for select to authenticated
  using (public.has_module('employees'));
drop policy if exists own_read on public.employee_onboarding_reviews;
create policy own_read on public.employee_onboarding_reviews for select to authenticated
  using (employee_id in (select e.id from public.employees e
                         where e."Employee Number" = (select public.current_employee_number())));
revoke all on public.employee_onboarding_reviews from anon;

-- ---------------------------------------------------------------------------------------------
-- 2 + 3 + 4 + 5. one trigger tidies and checks every saved record
-- ---------------------------------------------------------------------------------------------
create or replace function public.employees_onboarding_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  is_insert boolean := tg_op = 'INSERT';
  in_transition boolean := coalesce(current_setting('app.onboarding_transition', true), '') = 'on';
  is_staff boolean := auth.uid() is not null and not public.can_write_employees();
  changed text[];
begin
  -- tidy: identifiers without spaces, upper case; blanks are empty
  new."Tax PIN" := nullif(upper(regexp_replace(coalesce(new."Tax PIN", ''), '\s', '', 'g')), '');
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

  -- formats, checked when a value is new or changed
  if new."Tax PIN" is not null and (is_insert or new."Tax PIN" is distinct from old."Tax PIN")
     and not public.kra_pin_ok(new."Tax PIN") then
    raise exception 'KRA PIN "%" should look like A123456789B', new."Tax PIN" using errcode = '23514';
  end if;
  if new."ID Number" is not null and (is_insert or new."ID Number" is distinct from old."ID Number"
     or new."Type of Identification" is distinct from old."Type of Identification") then
    if not public.identity_number_ok(new."Type of Identification", new."ID Number") then
      raise exception '"%" is not a valid % number', new."ID Number", new."Type of Identification" using errcode = '23514';
    end if;
  end if;
  if new."SHIF Number" is not null and (is_insert or new."SHIF Number" is distinct from old."SHIF Number")
     and not public.sha_number_ok(new."SHIF Number") then
    raise exception 'SHA number "%" should be letters and digits only', new."SHIF Number" using errcode = '23514';
  end if;
  if new."NSSF Number" is not null and (is_insert or new."NSSF Number" is distinct from old."NSSF Number")
     and not public.nssf_number_ok(new."NSSF Number") then
    raise exception 'NSSF number "%" should be 5 to 12 digits', new."NSSF Number" using errcode = '23514';
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
    raise exception 'Another employee in this company already has KRA PIN %', new."Tax PIN" using errcode = '23505';
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
    where (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k);
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
-- what is still missing ("employee": what the employee gives; "employer": what HR enters; "all": both)
-- ---------------------------------------------------------------------------------------------
create or replace function public.onboarding_missing(e public.employees, p_part text default 'all') returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  m text[] := '{}';
  blank constant text := '^\s*$';
  by_bank boolean := coalesce(e.payment_method, '') !~* 'mpesa|m-pesa|mobile|airtel|safaricom|cash'
                     and coalesce(btrim(e.payment_method), '') <> '';
begin
  if p_part in ('employee', 'all') then
    if coalesce(e."Last Name", '') ~ blank then m := m || text 'Surname'; end if;
    if coalesce(e."First Name", '') ~ blank then m := m || text 'First name'; end if;
    if coalesce(e."Date of Birth", '') ~ blank then m := m || text 'Date of birth'; end if;
    if coalesce(e."Gender", '') ~ blank then m := m || text 'Sex'; end if;
    if coalesce(e.nationality, '') ~ blank then m := m || text 'Nationality'; end if;
    if coalesce(e.residential_address, '') ~ blank then m := m || text 'Residential address'; end if;
    if coalesce(e."Personal Email", '') ~ blank then m := m || text 'Personal email'; end if;
    if e."Type of Identification" is null then m := m || text 'Identity type'; end if;
    if e."ID Number" is null then m := m || text 'ID number';
    elsif not public.identity_number_ok(e."Type of Identification", e."ID Number") then m := m || text 'ID number (not valid)'; end if;
    if e."Tax PIN" is null then m := m || text 'KRA PIN';
    elsif not public.kra_pin_ok(e."Tax PIN") then m := m || text 'KRA PIN (not valid)'; end if;
    if e."SHIF Number" is null then m := m || text 'SHA number';
    elsif not public.sha_number_ok(e."SHIF Number") then m := m || text 'SHA number (not valid)'; end if;
    if e."NSSF Number" is null then m := m || text 'NSSF number';
    elsif not public.nssf_number_ok(e."NSSF Number") then m := m || text 'NSSF number (not valid)'; end if;
    if e."Mobile Number" is null then m := m || text 'Phone number';
    elsif not public.phone_ok(e."Mobile Number") then m := m || text 'Phone number (not valid)'; end if;
    if e.kra_residency is null then m := m || text 'Residency'; end if;
    if e.is_pwd is null then m := m || text 'Disability (PWD) status';
    elsif e.is_pwd and e."Disability Cert No" is null then m := m || text 'Exemption certificate number'; end if;
    if by_bank then
      if coalesce(e."Bank", '') ~ blank then m := m || text 'Bank name'; end if;
      if coalesce(e."Bank Branch", '') ~ blank then m := m || text 'Bank branch'; end if;
      if coalesce(e.account_number_name, '') ~ blank then m := m || text 'Account name'; end if;
      if coalesce(e."Account Number", '') ~ blank then m := m || text 'Account number'; end if;
    end if;
    if not exists (select 1 from public.emergency_contact c where c.tenant_id = e.tenant_id
                   and c."Employee Number" = e."Employee Number" and coalesce(c.full_name, '') !~ blank
                   and coalesce(c.phone_number, '') !~ blank) then
      m := m || text 'Emergency contact';
    end if;
    if not exists (select 1 from public.next_of_kin k where k.tenant_id = e.tenant_id
                   and k."Employee Number" = e."Employee Number") then
      m := m || text 'Next of kin';
    end if;
  end if;

  if p_part in ('employer', 'all') then
    if coalesce(e."Job Title", '') ~ blank then m := m || text 'Position'; end if;
    if e.kra_employee_type is null then m := m || text 'Type of employee'; end if;
    if coalesce(e."Basic Salary", 0) <= 0 then m := m || text 'Basic salary'; end if;
    if coalesce(e.payment_method, '') ~ blank then m := m || text 'Payment method'; end if;
  end if;
  return m;
end $$;
revoke all on function public.onboarding_missing(public.employees, text) from public, anon;
grant execute on function public.onboarding_missing(public.employees, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. moving a record on
-- ---------------------------------------------------------------------------------------------
-- the record the caller may act on: their own, or (for people who manage employees) any in their company
create or replace function public.onboarding_record(p_employee uuid, p_hr_only boolean) returns public.employees
language plpgsql stable security definer set search_path = public as $$
declare
  e public.employees;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_employee is null then
    select * into e from public.employees
    where tenant_id = public.current_tenant_id() and "Employee Number" = public.current_employee_number();
  else
    select * into e from public.employees where id = p_employee and tenant_id = public.current_tenant_id();
  end if;
  if e.id is null then
    raise exception 'Employee record not found' using errcode = 'P0002';
  end if;
  if not public.has_module('employees')
     and (p_hr_only or e."Employee Number" is distinct from public.current_employee_number()) then
    raise exception 'Only HR can do this' using errcode = '42501';
  end if;
  return e;
end $$;
revoke all on function public.onboarding_record(uuid, boolean) from public, anon, authenticated;

create or replace function public.onboarding_move(e public.employees, p_status text, p_action text, p_comment text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.onboarding_transition', 'on', true);
  update public.employees set
    onboarding_status = p_status,
    onboarding_submitted_at = case when p_status = 'submitted' then now() else onboarding_submitted_at end,
    onboarding_reviewed_by = case when p_action in ('approved', 'changes_requested') then auth.uid() else onboarding_reviewed_by end,
    onboarding_reviewed_at = case when p_action in ('approved', 'changes_requested') then now() else onboarding_reviewed_at end,
    onboarding_review_comment = case when p_action in ('approved', 'changes_requested') then p_comment else onboarding_review_comment end
  where id = e.id;
  perform set_config('app.onboarding_transition', '', true);
  insert into public.employee_onboarding_reviews (tenant_id, employee_id, action, comment, actor)
  values (e.tenant_id, e.id, p_action, p_comment, auth.uid());
end $$;
revoke all on function public.onboarding_move(public.employees, text, text, text) from public, anon, authenticated;

-- HR has invited the employee to fill in their part (also used to invite again)
create or replace function public.start_onboarding(p_employee uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  e public.employees := public.onboarding_record(p_employee, true);
begin
  if e.onboarding_status not in ('draft', 'invited') then
    raise exception 'This record is already %', replace(e.onboarding_status, '_', ' ');
  end if;
  perform public.onboarding_move(e, 'invited', 'invited', null);
  return 'invited';
end $$;

-- the employee (or HR on their behalf) sends the record for review once their part is complete
create or replace function public.submit_onboarding(p_employee uuid default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  e public.employees := public.onboarding_record(p_employee, false);
  missing text[];
begin
  if e.onboarding_status not in ('draft', 'invited', 'changes_requested') then
    raise exception 'This record is already %', replace(e.onboarding_status, '_', ' ');
  end if;
  missing := public.onboarding_missing(e, 'employee');
  if cardinality(missing) > 0 then
    raise exception 'Still missing: %', array_to_string(missing, ', ') using errcode = '23514';
  end if;
  perform public.onboarding_move(e, 'submitted', 'submitted', null);
  return 'submitted';
end $$;

-- HR approves a submitted record, or sends a submitted or approved one back with a comment
create or replace function public.review_onboarding(p_employee uuid, p_decision text, p_comment text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  e public.employees := public.onboarding_record(p_employee, true);
  missing text[];
  comment text := nullif(btrim(p_comment), '');
begin
  if p_decision = 'approve' then
    if e.onboarding_status <> 'submitted' then
      raise exception 'Only a submitted record can be approved (this one is %)', replace(e.onboarding_status, '_', ' ');
    end if;
    missing := public.onboarding_missing(e, 'all');
    if cardinality(missing) > 0 then
      raise exception 'Still missing: %', array_to_string(missing, ', ') using errcode = '23514';
    end if;
    perform public.onboarding_move(e, 'approved', 'approved', comment);
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

revoke all on function public.start_onboarding(uuid) from public, anon;
revoke all on function public.submit_onboarding(uuid) from public, anon;
revoke all on function public.review_onboarding(uuid, text, text) from public, anon;
grant execute on function public.start_onboarding(uuid) to authenticated;
grant execute on function public.submit_onboarding(uuid) to authenticated;
grant execute on function public.review_onboarding(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. audit log
-- ---------------------------------------------------------------------------------------------
-- One row per change: only the fields that changed (all of them for a new or deleted row), who and when.
create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  row_data jsonb := coalesce(n, o);
  k text;
  old_diff jsonb := '{}';
  new_diff jsonb := '{}';
begin
  -- rows that belong to no company (the default statutory rates) change only through migrations
  if row_data ->> 'tenant_id' is null then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k <> 'updated_at' and (o -> k) is distinct from (n -> k) then
        old_diff := old_diff || jsonb_build_object(k, o -> k);
        new_diff := new_diff || jsonb_build_object(k, n -> k);
      end if;
    end loop;
    if new_diff = '{}' then
      return null;
    end if;
    o := old_diff;
    n := new_diff;
  end if;

  insert into public.audit_log (tenant_id, record_id, record_key, table_name, action_type, old_data, new_data, performed_by)
  values (
    (row_data ->> 'tenant_id')::uuid,
    case when row_data ->> 'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (row_data ->> 'id')::uuid end,
    coalesce(row_data ->> 'Employee Number', row_data ->> 'id'),
    tg_table_name, tg_op, o, n, auth.uid()
  );
  return null;
end $$;

drop trigger if exists audit_employees on public.employees;
create trigger audit_employees after insert or update or delete on public.employees
  for each row execute function public.audit_row_change();
drop trigger if exists audit_emergency_contact on public.emergency_contact;
create trigger audit_emergency_contact after insert or update or delete on public.emergency_contact
  for each row execute function public.audit_row_change();
drop trigger if exists audit_next_of_kin on public.next_of_kin;
create trigger audit_next_of_kin after insert or update or delete on public.next_of_kin
  for each row execute function public.audit_row_change();

-- HR reads the history of employee records; the settings module keeps reading everything; nobody edits it
drop policy if exists employees_read on public.audit_log;
create policy employees_read on public.audit_log for select to authenticated
  using (table_name in ('employees', 'emergency_contact', 'next_of_kin') and public.has_module('employees'));

-- ---------------------------------------------------------------------------------------------
-- 7. statutory rates
-- ---------------------------------------------------------------------------------------------
create table if not exists public.statutory_rates (
  id uuid primary key default gen_random_uuid(),
  -- empty: the default every company uses; a company's own row for the same code and date wins
  tenant_id uuid references public.tenants(id) on delete cascade,
  code text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  value numeric,
  -- PAYE: monthly bands, lowest first: [{"upto": 24000, "rate": 0.10}, ..., {"upto": null, "rate": 0.35}]
  bands jsonb,
  effective_from date not null,
  effective_to date, -- last day it applies; empty until it is replaced
  source text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((value is null) <> (bands is null)),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists statutory_rates_lookup_idx on public.statutory_rates (code, effective_from);

create or replace function public.statutory_rates_no_overlap() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (
    select 1 from public.statutory_rates r
    where r.id <> new.id and r.code = new.code and r.tenant_id is not distinct from new.tenant_id
      and r.effective_from <= coalesce(new.effective_to, 'infinity'::date)
      and new.effective_from <= coalesce(r.effective_to, 'infinity'::date)
  ) then
    raise exception '% already has a rate for part of % to %', new.code, new.effective_from,
      coalesce(new.effective_to::text, 'open-ended') using errcode = '23P01';
  end if;
  return new;
end $$;

drop trigger if exists statutory_rates_no_overlap on public.statutory_rates;
create trigger statutory_rates_no_overlap before insert or update on public.statutory_rates
  for each row execute function public.statutory_rates_no_overlap();

alter table public.statutory_rates enable row level security;
-- everyone signed in reads the defaults and their own company's rates; payroll keeps its company's own rates
drop policy if exists read_rates on public.statutory_rates;
create policy read_rates on public.statutory_rates for select to authenticated
  using (tenant_id is null or tenant_id = (select public.current_tenant_id()));
drop policy if exists payroll_write on public.statutory_rates;
create policy payroll_write on public.statutory_rates for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and public.has_module('payroll'))
  with check (tenant_id = (select public.current_tenant_id()) and public.has_module('payroll'));
revoke all on public.statutory_rates from anon;

drop trigger if exists audit_statutory_rates on public.statutory_rates;
create trigger audit_statutory_rates after insert or update or delete on public.statutory_rates
  for each row execute function public.audit_row_change();

-- every rate in force on a day, as {code: value or bands}; the company's own rate wins over the default
create or replace function public.statutory_rates_on(p_day date default current_date) returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_object_agg(code, coalesce(to_jsonb(value), bands)), '{}')
  from (
    select distinct on (code) code, value, bands
    from public.statutory_rates
    where effective_from <= p_day and (effective_to is null or effective_to >= p_day)
      and (tenant_id is null or tenant_id = public.current_tenant_id())
    order by code, tenant_id nulls last
  ) r
$$;
grant execute on function public.statutory_rates_on(date) to authenticated, service_role;

-- Monthly figures. Confirm against KRA, SHA and NSSF notices before relying on them; a later row replaces a code
-- from its effective date.
insert into public.statutory_rates (tenant_id, code, value, bands, effective_from, effective_to, source) values
  (null, 'paye_bands', null,
   '[{"upto": 24000, "rate": 0.10}, {"upto": 32333, "rate": 0.25}, {"upto": 500000, "rate": 0.30}, {"upto": 800000, "rate": 0.325}, {"upto": null, "rate": 0.35}]',
   '2023-07-01', null, 'Finance Act 2023'),
  (null, 'personal_relief', 2400, null, '2023-07-01', null, 'Income Tax Act'),
  (null, 'insurance_relief_rate', 0.15, null, '2023-07-01', null, 'Income Tax Act'),
  (null, 'insurance_relief_cap', 5000, null, '2023-07-01', null, 'Income Tax Act'),
  (null, 'pension_deduction_cap', 30000, null, '2024-12-27', null, 'Tax Laws (Amendment) Act 2024'),
  (null, 'prmf_deduction_cap', 15000, null, '2024-12-27', null, 'Tax Laws (Amendment) Act 2024'),
  (null, 'mortgage_interest_cap', 30000, null, '2024-12-27', null, 'Tax Laws (Amendment) Act 2024'),
  (null, 'non_cash_benefit_exempt_limit', 5000, null, '2024-12-27', null, 'Tax Laws (Amendment) Act 2024'),
  (null, 'meals_exempt_limit', 5000, null, '2024-12-27', null, 'Tax Laws (Amendment) Act 2024'),
  (null, 'pwd_exempt_income', 150000, null, '2023-07-01', null, 'Income Tax Act'),
  -- 1: the contribution is deducted before PAYE is worked out
  (null, 'shif_deductible', 1, null, '2024-12-27', null, 'Tax Laws (Amendment) Act 2024'),
  (null, 'ahl_deductible', 1, null, '2024-12-27', null, 'Tax Laws (Amendment) Act 2024'),
  (null, 'shif_rate', 0.0275, null, '2024-10-01', null, 'Social Health Insurance Act 2023'),
  (null, 'shif_minimum', 300, null, '2024-10-01', null, 'Social Health Insurance Act 2023'),
  (null, 'ahl_rate', 0.015, null, '2024-03-19', null, 'Affordable Housing Act 2024'),
  (null, 'ahl_employer_rate', 0.015, null, '2024-03-19', null, 'Affordable Housing Act 2024'),
  (null, 'nssf_rate', 0.06, null, '2024-02-01', null, 'NSSF Act 2013'),
  (null, 'nssf_employer_rate', 0.06, null, '2024-02-01', null, 'NSSF Act 2013'),
  (null, 'nssf_lower_limit', 8000, null, '2025-02-01', '2026-01-31', 'NSSF Act 2013, year 3'),
  (null, 'nssf_upper_limit', 72000, null, '2025-02-01', '2026-01-31', 'NSSF Act 2013, year 3'),
  (null, 'nssf_lower_limit', 9000, null, '2026-02-01', null, 'NSSF Act 2013, year 4 (confirm)'),
  (null, 'nssf_upper_limit', 108000, null, '2026-02-01', null, 'NSSF Act 2013, year 4 (confirm)');

notify pgrst, 'reload schema';
