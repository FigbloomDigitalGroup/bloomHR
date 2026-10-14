-- Each company chooses how its employee numbers are given (20261014600000 gave everyone MCL-000001, MCL-000002, ...):
--
--   * 'system' (the default): the system gives the next number. The company sets its format: a prefix with any
--     separator it wants ('MCL-', 'EMP/', 'FIG', or none), how many digits the count is padded to (1-10) and the
--     next number to give. Existing companies keep MCL-000001 exactly: their prefix 'MCL' becomes 'MCL-'.
--   * 'own': the company keeps its own numbers. The bulk upload takes a new person's number from the sheet and a
--     new row without one is an error. A blank number added any other way (one at a time, or a flow that doesn't
--     ask for one) still gets a system number rather than failing, so nobody is left without a number.
--
-- employee_numbering() reads the settings and the next number as it would be given, without using it up;
-- set_employee_numbering(...) changes them (ADMIN, Settings or Employees).

-- the prefix now includes its own separator; the old check (letters only, the '-' added for you) goes
alter table public.company_payroll_settings drop constraint if exists company_payroll_settings_employee_number_prefix_check;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'company_payroll_settings_employee_number_prefix_format_check') then
    update public.company_payroll_settings set employee_number_prefix = employee_number_prefix || '-'
    where employee_number_prefix ~ '^[A-Z][A-Z0-9]{0,9}$';
  end if;
end $$;
alter table public.company_payroll_settings alter column employee_number_prefix set default 'MCL-';
alter table public.company_payroll_settings drop constraint if exists company_payroll_settings_employee_number_prefix_format_check;
alter table public.company_payroll_settings add constraint company_payroll_settings_employee_number_prefix_format_check
  check (employee_number_prefix ~ '^[A-Za-z0-9/_.-]{0,12}$');

alter table public.company_payroll_settings add column if not exists employee_number_mode text not null default 'system';
alter table public.company_payroll_settings drop constraint if exists company_payroll_settings_employee_number_mode_check;
alter table public.company_payroll_settings add constraint company_payroll_settings_employee_number_mode_check
  check (employee_number_mode in ('system', 'own'));

alter table public.company_payroll_settings add column if not exists employee_number_digits integer not null default 6;
alter table public.company_payroll_settings drop constraint if exists company_payroll_settings_employee_number_digits_check;
alter table public.company_payroll_settings add constraint company_payroll_settings_employee_number_digits_check
  check (employee_number_digits between 1 and 10);

-- prefix + the count padded to at least `digits` (a count longer than that is never cut)
create or replace function public.format_employee_number(p_prefix text, p_digits integer, p_n bigint) returns text
language sql immutable set search_path = public as $$
  select coalesce(p_prefix, '') || lpad(p_n::text, greatest(p_digits, length(p_n::text)), '0')
$$;

-- the company's mode; save_employees_batch runs as the caller, who may not read the payroll settings (only the mode
-- is shown, and only of the caller's company)
create or replace function public.employee_number_mode() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select s.employee_number_mode from public.company_payroll_settings s where s.tenant_id = public.current_tenant_id()), 'system')
$$;
revoke all on function public.employee_number_mode() from public, anon;
grant execute on function public.employee_number_mode() to authenticated;

create or replace function public.next_employee_number(p_tenant uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  s record;
  n integer;
  candidate text;
begin
  select coalesce(max(c.employee_number_prefix), 'MCL-') prefix, coalesce(max(c.employee_number_digits), 6) digits into s
  from public.company_payroll_settings c where c.tenant_id = p_tenant;
  loop
    insert into public.employee_number_counters as c (tenant_id, last_value) values (p_tenant, 1)
      on conflict (tenant_id) do update set last_value = c.last_value + 1
      returning last_value into n;
    candidate := public.format_employee_number(s.prefix, s.digits, n);
    exit when not exists (select 1 from public.employees where tenant_id = p_tenant and "Employee Number" = candidate);
  end loop;
  return candidate;
end $$;
revoke all on function public.next_employee_number(uuid) from public, anon, authenticated;

create or replace function public.employee_numbering()
returns table (mode text, prefix text, digits integer, next_number integer, preview text)
language plpgsql stable security definer set search_path = public as $$
declare
  t uuid := public.current_tenant_id();
  n integer;
begin
  if t is null or not public.has_any_module('employees', 'payroll', 'settings') then
    raise exception 'You may not see how employee numbers are given' using errcode = '42501';
  end if;
  select coalesce(max(s.employee_number_mode), 'system'), coalesce(max(s.employee_number_prefix), 'MCL-'),
         coalesce(max(s.employee_number_digits), 6)
    into mode, prefix, digits
  from public.company_payroll_settings s where s.tenant_id = t;
  next_number := coalesce((select c.last_value from public.employee_number_counters c where c.tenant_id = t), 0) + 1;
  -- the number next_employee_number would give: the first one from next_number that nobody has
  n := next_number;
  loop
    preview := public.format_employee_number(prefix, digits, n);
    exit when not exists (select 1 from public.employees e where e.tenant_id = t and e."Employee Number" = preview);
    n := n + 1;
  end loop;
  return next;
end $$;
revoke all on function public.employee_numbering() from public, anon;
grant execute on function public.employee_numbering() to authenticated;

create or replace function public.set_employee_numbering(p_mode text, p_prefix text, p_digits integer, p_next integer default null)
returns table (mode text, prefix text, digits integer, next_number integer, preview text)
language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.current_tenant_id();
begin
  if t is null or not public.has_any_module('settings', 'employees') then
    raise exception 'You may not change how employee numbers are given' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('system', 'own') then
    raise exception 'Choose system or own numbers' using errcode = '22023';
  end if;
  if coalesce(p_prefix, '') !~ '^[A-Za-z0-9/_.-]{0,12}$' then
    raise exception 'The prefix may have up to 12 letters, digits and / _ . -' using errcode = '22023';
  end if;
  if p_digits is null or p_digits not between 1 and 10 then
    raise exception 'The number of digits must be 1 to 10' using errcode = '22023';
  end if;
  if p_next is not null and p_next < 1 then
    raise exception 'The next number must be 1 or more' using errcode = '22023';
  end if;

  insert into public.company_payroll_settings as s (tenant_id, employee_number_mode, employee_number_prefix, employee_number_digits)
    values (t, p_mode, coalesce(p_prefix, ''), p_digits)
    on conflict (tenant_id) do update set employee_number_mode = excluded.employee_number_mode,
      employee_number_prefix = excluded.employee_number_prefix, employee_number_digits = excluded.employee_number_digits,
      updated_by = auth.uid(), updated_at = now();
  if p_next is not null then
    insert into public.employee_number_counters as c (tenant_id, last_value) values (t, p_next - 1)
      on conflict (tenant_id) do update set last_value = excluded.last_value;
  end if;
  return query select * from public.employee_numbering();
end $$;
revoke all on function public.set_employee_numbering(text, text, integer, integer) from public, anon;
grant execute on function public.set_employee_numbering(text, text, integer, integer) to authenticated;

-- as in 20261014600000, except that in 'own' mode a new person's number comes from the sheet and is required
create or replace function public.save_employees_batch(p_rows jsonb)
returns table (row_no integer, employee_number text, outcome text, employee_id uuid, work_email text, error_code text, error_message text)
language plpgsql security invoker set search_path = public as $$
declare
  r jsonb;
  fields jsonb;
  cols text;
  existing uuid;
  v_number text;
  v_typed text;
  v_id uuid;
  v_email text;
  i integer := 0;
  own boolean := public.employee_number_mode() = 'own';
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
      v_typed := v_number;
      -- an existing employee's number never changes here; it only finds them
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
        if own then
          -- the company's own numbers: the sheet gives the new person's number
          if v_typed is null then
            raise exception 'missing Employee Number' using errcode = '23502';
          end if;
          fields := fields || jsonb_build_object('Employee Number', v_typed);
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
