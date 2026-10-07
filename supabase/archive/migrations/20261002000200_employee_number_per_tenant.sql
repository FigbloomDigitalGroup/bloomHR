-- Employee numbers are unique per company, not globally ("EMP-001" can exist in two tenants).
-- Requires 20261002000100_tenant_rls.sql (every table has a NOT NULL tenant_id).
--
-- Design:
--   * employees' primary key becomes (tenant_id, "Employee Number"); an immutable uuid `id` is
--     added alongside it as a stable internal identifier.
--   * every foreign key that pointed at employees("Employee Number") becomes composite
--     (tenant_id, <col>) -> employees (tenant_id, "Employee Number") ON UPDATE CASCADE, keeping its
--     original ON DELETE action, so a row can only ever point at an employee of its own tenant and
--     renumbering an employee follows through to those tables.
--   * tables that store the number as plain text with no foreign key are kept in step by a trigger,
--     so "Employee Number" is a freely editable, per-company label.

-- 1. Surrogate id --------------------------------------------------------------------------------
alter table public.employees add column if not exists id uuid not null default gen_random_uuid();
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.employees'::regclass and conname = 'employees_id_key') then
    alter table public.employees add constraint employees_id_key unique (id);
  end if;
end $$;

-- 2. Composite primary key + composite foreign keys ------------------------------------------------
do $$
declare
  fks jsonb;
  fk jsonb;
  pk_name text;
begin
  -- Remember every single-column FK onto employees("Employee Number").
  select coalesce(jsonb_agg(jsonb_build_object(
           'tbl', con.conrelid::regclass::text,
           'name', con.conname,
           'col', (select a.attname from pg_attribute a where a.attrelid = con.conrelid and a.attnum = con.conkey[1]),
           'del', con.confdeltype)), '[]'::jsonb)
    into fks
  from pg_constraint con
  where con.contype = 'f'
    and con.confrelid = 'public.employees'::regclass
    and array_length(con.conkey, 1) = 1
    and (select a.attname from pg_attribute a where a.attrelid = con.confrelid and a.attnum = con.confkey[1]) = 'Employee Number';

  for fk in select * from jsonb_array_elements(fks) loop
    execute format('alter table %s drop constraint %I', fk ->> 'tbl', fk ->> 'name');
  end loop;

  select conname into pk_name from pg_constraint where conrelid = 'public.employees'::regclass and contype = 'p';
  if pk_name is not null then
    execute format('alter table public.employees drop constraint %I', pk_name);
  end if;
  alter table public.employees add constraint employees_pkey primary key (tenant_id, "Employee Number");

  for fk in select * from jsonb_array_elements(fks) loop
    execute format(
      'alter table %s add constraint %I foreign key (tenant_id, %I) '
      'references public.employees (tenant_id, "Employee Number") on update cascade %s',
      fk ->> 'tbl', fk ->> 'name', fk ->> 'col',
      case fk ->> 'del'
        when 'c' then 'on delete cascade'
        when 'n' then format('on delete set null (%I)', fk ->> 'col')  -- leave tenant_id alone (PG 15+)
        when 'r' then 'on delete restrict'
        when 'd' then format('on delete set default (%I)', fk ->> 'col')
        else ''
      end);
  end loop;
  raise notice 'employee number is now per tenant; rebuilt % foreign keys', jsonb_array_length(fks);
end $$;

-- 3. Keep text copies of the number (no FK) in step when it is edited ------------------------------
create or replace function public.propagate_employee_number()
returns trigger
language plpgsql
as $$
declare
  target jsonb;
  targets jsonb := '[
    ["attendance_logs", "employee_number"], ["email_logs", "Employee Number"], ["email_logs", "employee_id"],
    ["expenses", "employee_id"], ["hr_notifications", "employee_number"], ["incident_reports", "employee_number"],
    ["job_applications", "employee_number"], ["mpesa_callbacks", "employee_number"], ["mpesa_callbacks", "employee_id"],
    ["notifications", "employee_number"], ["payroll_records", "Employee ID"], ["payroll_records", "employee_id"],
    ["payroll_records_current", "Employee ID"], ["payroll_records_current", "employee_id"],
    ["phone_number_change_requests", "employee_number"], ["salary_history", "employee_id"],
    ["staff_loans", "guarantor1_employee_number"], ["staff_loans", "guarantor2_employee_number"],
    ["termination_requests", "Employee Number"], ["termination_requests", "employee_id"]
  ]';
begin
  for target in select * from jsonb_array_elements(targets) loop
    -- skip tables/columns that do not exist in this database
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = target ->> 0 and column_name = target ->> 1
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = target ->> 0 and column_name = 'tenant_id'
    ) then
      execute format('update public.%I set %I = $1 where tenant_id = $2 and %I = $3', target ->> 0, target ->> 1, target ->> 1)
        using new."Employee Number", new.tenant_id, old."Employee Number";
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists employees_propagate_employee_number on public.employees;
create trigger employees_propagate_employee_number
  after update of "Employee Number" on public.employees
  for each row
  when (old."Employee Number" is distinct from new."Employee Number")
  execute function public.propagate_employee_number();

notify pgrst, 'reload schema';
