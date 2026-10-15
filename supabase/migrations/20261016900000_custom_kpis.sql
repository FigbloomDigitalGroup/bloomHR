-- Custom KPIs: each company defines how its people's performance is measured.
--
-- The Performance page came from a microfinance app and measured everyone on fixed loan targets (loans disbursed,
-- client visits, collections). Companies of every kind use this product, so each one now keeps its own KPIs:
--
--   kpis               the company's KPI library: name, description, unit (number, percent, currency_ksh, yes_no,
--                      rating_1_5), direction (higher or lower is better), default target and weight, how often it is
--                      measured and an optional category (Financial, Customer, Process, People ...). Archived, never
--                      deleted while in use.
--   kpi_periods        review periods ("Q4 2026"): start and end dates and a status. draft (being set up; staff don't
--                      see it yet) -> open (check-ins and scoring) -> closed (locked; HR may reopen it).
--   kpi_assignments    a KPI for one employee in one period, with their target and weight (an employee's weights in a
--                      period should total 100; the screens warn, nothing refuses), who set it and how (one person, a
--                      department, a job title or a job group: assign_kpi()). Also the latest self-assessment and the
--                      final (manager / HR) actual, copied from the check-ins below.
--   kpi_checkins       every check-in, kept: a self-assessment (the employee) or a final actual (their manager or HR),
--                      value, comment, by whom and when. Only added, never changed.
--
-- Scores (achievement % per KPI, the weighted overall score, rating bands) are worked out by src/lib/kpis.ts.
--
-- Who does what:
--   HR and administrators (role), or anyone else whose role has the Performance module (MANAGER and REGIONAL roles,
--   which carry that module by default, are line managers and count as managers below)       everything
--   a manager (someone the employee reports to: reports_to_id, manager_email or regional_manager, the same rule as
--   supervised_employee_numbers())        sees their reports' KPIs, assigns KPIs to them and enters final scores
--   the employee        sees their own KPIs once the period is out of draft and adds self-assessments while it is open
--   Nobody enters their own final score (except an administrator).
--
-- Written to run again safely (if not exists / or replace / drop ... if exists).

-- ---------------------------------------------------------------------------------------------
-- 1. helpers
-- ---------------------------------------------------------------------------------------------
create or replace function public.manages_kpis() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    public.current_user_role() in ('ADMIN', 'HR')
    or (public.current_user_role() not in ('MANAGER', 'REGIONAL') and public.has_module('performance')),
    false)
$$;
revoke all on function public.manages_kpis() from public, anon;
grant execute on function public.manages_kpis() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. tables
-- ---------------------------------------------------------------------------------------------
create table if not exists public.kpis (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (btrim(name) <> '' and length(btrim(name)) <= 120),
  description text check (description is null or length(description) <= 2000),
  unit text not null default 'number' check (unit in ('number', 'percent', 'currency_ksh', 'yes_no', 'rating_1_5')),
  direction text not null default 'higher_is_better' check (direction in ('higher_is_better', 'lower_is_better')),
  default_target numeric(16, 2),
  default_weight numeric(5, 2) not null default 0 check (default_weight between 0 and 100),
  frequency text not null default 'quarterly' check (frequency in ('monthly', 'quarterly', 'annual')),
  category text check (category is null or length(category) <= 60),
  archived boolean not null default false,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id)
);
create unique index if not exists kpis_tenant_name on public.kpis (tenant_id, lower(btrim(name)));

create table if not exists public.kpi_periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (btrim(name) <> '' and length(btrim(name)) <= 80),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  check (ends_on >= starts_on)
);
create unique index if not exists kpi_periods_tenant_name on public.kpi_periods (tenant_id, lower(btrim(name)));

create table if not exists public.kpi_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  period_id uuid not null,
  kpi_id uuid not null,
  employee_number text not null,
  target numeric(16, 2),
  weight numeric(5, 2) not null default 0 check (weight between 0 and 100),
  assigned_via text not null default 'person' check (assigned_via in ('person', 'department', 'job_title', 'job_group')),
  assigned_by uuid default auth.uid() references auth.users(id) on delete set null,
  -- the latest self-assessment and final actual (from kpi_checkins)
  self_value numeric(16, 2),
  self_comment text,
  self_by uuid references auth.users(id) on delete set null,
  self_at timestamptz,
  actual_value numeric(16, 2),
  manager_comment text,
  scored_by uuid references auth.users(id) on delete set null,
  scored_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  unique (period_id, kpi_id, employee_number),
  foreign key (period_id, tenant_id) references public.kpi_periods (id, tenant_id) on delete cascade,
  foreign key (kpi_id, tenant_id) references public.kpis (id, tenant_id) on delete restrict,
  foreign key (tenant_id, employee_number) references public.employees (tenant_id, "Employee Number") on update cascade on delete cascade
);
create index if not exists kpi_assignments_tenant_employee on public.kpi_assignments (tenant_id, employee_number);
create index if not exists kpi_assignments_kpi on public.kpi_assignments (kpi_id);

create table if not exists public.kpi_checkins (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  assignment_id uuid not null,
  kind text not null check (kind in ('self', 'final')),
  value numeric(16, 2),
  comment text check (comment is null or length(comment) <= 2000),
  entered_by uuid default auth.uid() references auth.users(id) on delete set null,
  entered_at timestamptz not null default now(),
  foreign key (assignment_id, tenant_id) references public.kpi_assignments (id, tenant_id) on delete cascade,
  check (value is not null or nullif(btrim(comment), '') is not null)
);
create index if not exists kpi_checkins_assignment on public.kpi_checkins (assignment_id, entered_at);

-- ---------------------------------------------------------------------------------------------
-- 3. rules
-- ---------------------------------------------------------------------------------------------
create or replace function public.kpis_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.name := btrim(new.name);
  new.category := nullif(btrim(new.category), '');
  if tg_op = 'UPDATE' then
    new.tenant_id := old.tenant_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists kpis_rules on public.kpis;
create trigger kpis_rules before insert or update on public.kpis for each row execute function public.kpis_rules();

create or replace function public.kpi_periods_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'UPDATE' then
    new.tenant_id := old.tenant_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists kpi_periods_rules on public.kpi_periods;
create trigger kpi_periods_rules before insert or update on public.kpi_periods for each row execute function public.kpi_periods_rules();

create or replace function public.kpi_assignments_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_default numeric;
begin
  -- a check-in copying its value here (kpi_checkins_apply)
  if current_setting('app.kpi_checkin', true) = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    select p.status into v_status from public.kpi_periods p where p.id = old.period_id;
    if auth.uid() is not null and v_status = 'closed' and pg_trigger_depth() <= 1 then
      raise exception 'This review period is closed; reopen it to change its KPIs' using errcode = '42501';
    end if;
    return old;
  end if;

  -- an employee renumbered: the foreign key moves their KPIs along and nothing else changes
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'employee_number') = (to_jsonb(old) - 'employee_number') then
    return new;
  end if;

  select p.status into v_status from public.kpi_periods p where p.id = new.period_id;
  if auth.uid() is not null and v_status = 'closed' then
    raise exception 'This review period is closed; reopen it to change its KPIs' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.assigned_by := coalesce(auth.uid(), new.assigned_by);
    new.self_value := null; new.self_comment := null; new.self_by := null; new.self_at := null;
    new.actual_value := null; new.manager_comment := null; new.scored_by := null; new.scored_at := null;
    new.created_at := now();
    if new.target is null then
      select k.default_target into v_default from public.kpis k where k.id = new.kpi_id;
      new.target := v_default;
    end if;
  else
    -- only the target, the weight (and how it was assigned) change here; the scores come from check-ins
    new.tenant_id := old.tenant_id;
    new.period_id := old.period_id;
    new.kpi_id := old.kpi_id;
    new.employee_number := old.employee_number;
    new.created_at := old.created_at;
    new.self_value := old.self_value; new.self_comment := old.self_comment; new.self_by := old.self_by; new.self_at := old.self_at;
    new.actual_value := old.actual_value; new.manager_comment := old.manager_comment;
    new.scored_by := old.scored_by; new.scored_at := old.scored_at;
    if auth.uid() is not null then
      new.assigned_by := auth.uid();
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists kpi_assignments_rules on public.kpi_assignments;
create trigger kpi_assignments_rules before insert or update or delete on public.kpi_assignments
  for each row execute function public.kpi_assignments_rules();

create or replace function public.kpi_checkins_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  a public.kpi_assignments;
  v_status text;
  v_unit text;
  v_me text := public.current_employee_number();
begin
  select * into a from public.kpi_assignments where id = new.assignment_id;
  if a.id is null then
    raise exception 'Unknown KPI' using errcode = '23503';
  end if;
  select p.status into v_status from public.kpi_periods p where p.id = a.period_id;
  select k.unit into v_unit from public.kpis k where k.id = a.kpi_id;

  new.tenant_id := a.tenant_id;
  new.entered_at := now();
  new.comment := nullif(btrim(new.comment), '');
  if auth.uid() is not null then
    new.entered_by := auth.uid();
    if v_status is distinct from 'open' then
      raise exception 'Check-ins can only be added while the review period is open' using errcode = '42501';
    end if;
    if new.kind = 'self' then
      if v_me is null or a.employee_number <> v_me then
        raise exception 'Only the employee can add their own self-assessment' using errcode = '42501';
      end if;
    else
      if not (public.manages_kpis() or a.employee_number in (select public.supervised_employee_numbers())) then
        raise exception 'Only the employee''s manager or HR can enter the final score' using errcode = '42501';
      end if;
      if a.employee_number = v_me and public.current_user_role() is distinct from 'ADMIN' then
        raise exception 'You can''t enter your own final score' using errcode = '42501';
      end if;
    end if;
  end if;

  if new.value is not null then
    if v_unit = 'yes_no' and new.value not in (0, 1) then
      raise exception 'A yes/no KPI takes 1 (yes) or 0 (no)' using errcode = '22023';
    elsif v_unit = 'rating_1_5' and (new.value < 1 or new.value > 5) then
      raise exception 'A rating is from 1 to 5' using errcode = '22023';
    elsif v_unit = 'percent' and new.value < 0 then
      raise exception 'A percentage can''t be negative' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists kpi_checkins_rules on public.kpi_checkins;
create trigger kpi_checkins_rules before insert on public.kpi_checkins for each row execute function public.kpi_checkins_rules();

-- the assignment shows the latest of each kind
create or replace function public.kpi_checkins_apply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.kpi_checkin', 'on', true);
  if new.kind = 'self' then
    update public.kpi_assignments set self_value = new.value, self_comment = new.comment, self_by = new.entered_by,
      self_at = new.entered_at, updated_at = now()
    where id = new.assignment_id;
  else
    update public.kpi_assignments set actual_value = new.value, manager_comment = new.comment, scored_by = new.entered_by,
      scored_at = new.entered_at, updated_at = now()
    where id = new.assignment_id;
  end if;
  perform set_config('app.kpi_checkin', 'off', true);
  return new;
end $$;
drop trigger if exists kpi_checkins_apply on public.kpi_checkins;
create trigger kpi_checkins_apply after insert on public.kpi_checkins for each row execute function public.kpi_checkins_apply();

-- check-ins are a record: never changed or removed by hand
create or replace function public.kpi_checkins_keep() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- (removing the assignment, its period or the employee takes its check-ins with it: those run one trigger deeper)
  if auth.uid() is not null and pg_trigger_depth() <= 1 then
    raise exception 'Check-ins can''t be changed; add a new one' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists kpi_checkins_keep on public.kpi_checkins;
create trigger kpi_checkins_keep before update or delete on public.kpi_checkins for each row execute function public.kpi_checkins_keep();

revoke all on function public.kpis_rules() from public, anon, authenticated;
revoke all on function public.kpi_periods_rules() from public, anon, authenticated;
revoke all on function public.kpi_assignments_rules() from public, anon, authenticated;
revoke all on function public.kpi_checkins_rules() from public, anon, authenticated;
revoke all on function public.kpi_checkins_apply() from public, anon, authenticated;
revoke all on function public.kpi_checkins_keep() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. access
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['kpis', 'kpi_periods', 'kpi_assignments', 'kpi_checkins'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format($p$create policy tenant_isolation on public.%I as restrictive for all
      using (tenant_id = (select public.current_tenant_id()))
      with check (tenant_id = (select public.current_tenant_id()))$p$, t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- the library and the periods: everyone in the company reads them; HR changes them
drop policy if exists read_company on public.kpis;
create policy read_company on public.kpis for select to authenticated using (true);
drop policy if exists hr_write on public.kpis;
create policy hr_write on public.kpis for all to authenticated
  using ((select public.manages_kpis())) with check ((select public.manages_kpis()));

drop policy if exists read_company on public.kpi_periods;
create policy read_company on public.kpi_periods for select to authenticated using (true);
drop policy if exists hr_write on public.kpi_periods;
create policy hr_write on public.kpi_periods for all to authenticated
  using ((select public.manages_kpis())) with check ((select public.manages_kpis()));

-- assignments: HR all; a manager their reports'; the employee their own once the period is out of draft
drop policy if exists hr_manager_or_own on public.kpi_assignments;
create policy hr_manager_or_own on public.kpi_assignments for select to authenticated
  using ((select public.manages_kpis())
    or employee_number in (select public.supervised_employee_numbers())
    or (employee_number = (select public.current_employee_number())
        and period_id in (select p.id from public.kpi_periods p where p.status <> 'draft')));
drop policy if exists hr_or_manager_insert on public.kpi_assignments;
create policy hr_or_manager_insert on public.kpi_assignments for insert to authenticated
  with check ((select public.manages_kpis()) or employee_number in (select public.supervised_employee_numbers()));
drop policy if exists hr_or_manager_update on public.kpi_assignments;
create policy hr_or_manager_update on public.kpi_assignments for update to authenticated
  using ((select public.manages_kpis()) or employee_number in (select public.supervised_employee_numbers()))
  with check ((select public.manages_kpis()) or employee_number in (select public.supervised_employee_numbers()));
drop policy if exists hr_or_manager_delete on public.kpi_assignments;
create policy hr_or_manager_delete on public.kpi_assignments for delete to authenticated
  using ((select public.manages_kpis()) or employee_number in (select public.supervised_employee_numbers()));

-- check-ins: whoever sees the assignment sees its check-ins and may try to add one (the rules above decide which kind)
drop policy if exists visible_assignment on public.kpi_checkins;
create policy visible_assignment on public.kpi_checkins for select to authenticated
  using (assignment_id in (select a.id from public.kpi_assignments a));
drop policy if exists visible_assignment_insert on public.kpi_checkins;
create policy visible_assignment_insert on public.kpi_checkins for insert to authenticated
  with check (assignment_id in (select a.id from public.kpi_assignments a));

-- ---------------------------------------------------------------------------------------------
-- 5. assigning a KPI to one person, a department, a job title or a job group
-- ---------------------------------------------------------------------------------------------
-- Adds (or updates the target and weight of) the KPI for each current employee in scope; a manager reaches only their
-- own reports. Returns how many employees it was set for.
create or replace function public.assign_kpi(
  p_period uuid, p_kpi uuid, p_scope text, p_value text, p_target numeric default null, p_weight numeric default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_hr boolean := public.manages_kpis();
  v_kpi public.kpis;
  v_n integer;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_scope not in ('person', 'department', 'job_title', 'job_group') then
    raise exception 'Unknown scope %', p_scope using errcode = '22023';
  end if;
  if nullif(btrim(p_value), '') is null then
    raise exception 'Choose who to assign it to' using errcode = '22023';
  end if;
  select * into v_kpi from public.kpis where id = p_kpi and tenant_id = v_tenant;
  if v_kpi.id is null then
    raise exception 'Unknown KPI' using errcode = '23503';
  end if;
  if not exists (select 1 from public.kpi_periods where id = p_period and tenant_id = v_tenant) then
    raise exception 'Unknown review period' using errcode = '23503';
  end if;
  if not v_hr and not exists (select 1 from public.supervised_employee_numbers()) then
    raise exception 'Only HR or a manager can assign KPIs' using errcode = '42501';
  end if;
  if p_weight is not null and (p_weight < 0 or p_weight > 100) then
    raise exception 'A weight is from 0 to 100' using errcode = '22023';
  end if;

  insert into public.kpi_assignments (tenant_id, period_id, kpi_id, employee_number, target, weight, assigned_via)
  select v_tenant, p_period, p_kpi, e."Employee Number", coalesce(p_target, v_kpi.default_target),
         coalesce(p_weight, v_kpi.default_weight), p_scope
  from public.employees e
  where e.tenant_id = v_tenant
    and lower(coalesce(btrim(e."Status"), '')) not in ('terminated', 'inactive', 'exited', 'resigned', 'dismissed')
    and case p_scope
      when 'person' then e."Employee Number" = p_value
      when 'department' then e.department_id::text = p_value
      when 'job_title' then lower(btrim(e."Job Title")) = lower(btrim(p_value))
      else (e.job_group_id::text = p_value or lower(btrim(e."Job Group")) = lower(btrim(p_value)))
    end
    and (v_hr or e."Employee Number" in (select public.supervised_employee_numbers()))
  on conflict (period_id, kpi_id, employee_number) do update
    set target = excluded.target, weight = excluded.weight, assigned_via = excluded.assigned_via;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.assign_kpi(uuid, uuid, text, text, numeric, numeric) from public, anon;
grant execute on function public.assign_kpi(uuid, uuid, text, text, numeric, numeric) to authenticated;

-- What the signed-in person may do on the Performance page: manage everything, or score a team, and who they are.
create or replace function public.kpi_my_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'manages', public.manages_kpis(),
    'employee_number', public.current_employee_number(),
    'team', (select coalesce(array_agg(n order by n), array[]::text[]) from public.supervised_employee_numbers() n)
  )
$$;
revoke all on function public.kpi_my_access() from public, anon;
grant execute on function public.kpi_my_access() to authenticated;

notify pgrst, 'reload schema';
