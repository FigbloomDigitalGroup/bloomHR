-- Employee numbers come from the system, in one format, so a bulk upload can't add numbers that are missing, mistyped
-- or in someone's own style. HR adds people with just their names and work email.
--
-- A new employee added without an Employee Number gets the company's next one: its prefix (MCL unless the company
-- sets another) and a 6-digit count, MCL-000001, MCL-000002, ... in order per company. A number already in use (an
-- older hand-typed or clock-based MCL-302233, say) is skipped. The payroll number (PR-00001) is separate and unchanged.
--
-- save_employees_batch (the bulk upload) no longer takes new employee numbers from the sheet:
--   * a row whose Employee Number or Work Email belongs to an employee of the company updates that employee;
--   * any other row adds a new employee with a generated number (a number typed for a new person is ignored), and
--     the number is returned so the upload can show it.

alter table public.company_payroll_settings add column if not exists employee_number_prefix text not null default 'MCL';
alter table public.company_payroll_settings drop constraint if exists company_payroll_settings_employee_number_prefix_check;
alter table public.company_payroll_settings add constraint company_payroll_settings_employee_number_prefix_check
  check (employee_number_prefix ~ '^[A-Z][A-Z0-9]{0,9}$');

create table if not exists public.employee_number_counters (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  last_value integer not null default 0
);
-- only next_employee_number uses it: RLS with no permissive policy keeps everyone else out
alter table public.employee_number_counters enable row level security;
drop policy if exists tenant_isolation on public.employee_number_counters;
create policy tenant_isolation on public.employee_number_counters as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
revoke all on public.employee_number_counters from anon;

create or replace function public.next_employee_number(p_tenant uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  prefix text := coalesce((select s.employee_number_prefix from public.company_payroll_settings s where s.tenant_id = p_tenant), 'MCL');
  n integer;
  candidate text;
begin
  loop
    insert into public.employee_number_counters as c (tenant_id, last_value) values (p_tenant, 1)
      on conflict (tenant_id) do update set last_value = c.last_value + 1
      returning last_value into n;
    candidate := prefix || '-' || lpad(n::text, greatest(6, length(n::text)), '0');
    exit when not exists (select 1 from public.employees where tenant_id = p_tenant and "Employee Number" = candidate);
  end loop;
  return candidate;
end $$;
revoke all on function public.next_employee_number(uuid) from public, anon, authenticated;

create or replace function public.employees_default_employee_number() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(btrim(new."Employee Number"), '') = '' then
    new."Employee Number" := public.next_employee_number(new.tenant_id);
  end if;
  return new;
end $$;

-- Postgres runs BEFORE triggers in name order; nothing before this one reads the employee number
drop trigger if exists employees_default_employee_number on public.employees;
create trigger employees_default_employee_number before insert on public.employees
  for each row execute function public.employees_default_employee_number();

create or replace function public.save_employees_batch(p_rows jsonb)
returns table (row_no integer, employee_number text, outcome text, employee_id uuid, work_email text, error_code text, error_message text)
language plpgsql security invoker set search_path = public as $$
declare
  r jsonb;
  fields jsonb;
  cols text;
  existing uuid;
  v_number text;
  v_id uuid;
  v_email text;
  i integer := 0;
  -- what a row may set: not the keys, the generated payroll number or the onboarding state
  allowed text[] := (
    select array_agg(a.attname::text) from pg_attribute a
    where a.attrelid = 'public.employees'::regclass and a.attnum > 0 and not a.attisdropped
      and a.attgenerated = '' and a.attidentity = ''
      and a.attname not in ('id', 'tenant_id', 'created_at', 'Payroll Number') and a.attname not like 'onboarding\_%');
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'The rows must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'Save at most 500 rows at a time' using errcode = '22023';
  end if;

  for r in select x.value from jsonb_array_elements(p_rows) x loop
    i := i + 1;
    row_no := coalesce((r->>'row')::integer, i);
    v_number := null; v_id := null; v_email := null;
    outcome := null; error_code := null; error_message := null;
    begin
      select coalesce(jsonb_object_agg(f.key, f.value), '{}'::jsonb) into fields
      from jsonb_each(case when jsonb_typeof(r->'data') = 'object' then r->'data' else '{}'::jsonb end) f
      where f.key = any (allowed);
      v_number := nullif(btrim(fields->>'Employee Number'), '');
      -- the number never comes from the sheet: it only finds an existing employee
      fields := fields - 'Employee Number';

      existing := null;
      if v_number is not null then
        select e.id into existing from public.employees e
        where e.tenant_id = public.current_tenant_id() and e."Employee Number" = v_number;
      end if;
      if existing is null and coalesce(btrim(fields->>'Work Email'), '') <> '' then
        -- the same work email can't belong to two employees of a company
        select e.id into existing from public.employees e
        where e.tenant_id = public.current_tenant_id() and lower(btrim(e."Work Email")) = lower(btrim(fields->>'Work Email'));
      end if;
      v_number := null;

      if existing is null then
        if coalesce(btrim(fields->>'Work Email'), '') = '' then
          raise exception 'no work email (the invitation to join is sent there)' using errcode = '23502';
        end if;
        select string_agg(format('%I', k), ', ') into cols from jsonb_object_keys(fields) k;
        execute format('insert into public.employees (%s) select %s from jsonb_populate_record(null::public.employees, $1) '
                       'returning id, "Work Email", "Employee Number"', cols, cols)
          using fields into v_id, v_email, v_number;
        outcome := 'created';
      else
        if fields = '{}'::jsonb then
          select e.id, e."Work Email", e."Employee Number" into v_id, v_email, v_number from public.employees e where e.id = existing;
        else
          select string_agg(format('%I', k), ', ') into cols from jsonb_object_keys(fields) k;
          execute format('update public.employees set (%s) = (select %s from jsonb_populate_record(null::public.employees, $1)) '
                         'where id = $2 returning id, "Work Email", "Employee Number"', cols, cols)
            using fields, existing into v_id, v_email, v_number;
        end if;
        if v_id is null then
          raise exception 'you may not change this employee' using errcode = '42501';
        end if;
        outcome := 'updated';
      end if;
    exception when others then
      outcome := 'error';
      v_id := null;
      v_email := null;
      error_code := sqlstate;
      error_message := sqlerrm;
    end;
    employee_number := v_number;
    employee_id := v_id;
    work_email := v_email;
    return next;
  end loop;
end $$;
revoke all on function public.save_employees_batch(jsonb) from public, anon;
grant execute on function public.save_employees_batch(jsonb) to authenticated;

notify pgrst, 'reload schema';
