-- Org structure: each company sets up its own departments and reporting lines, shown as an organogram (FIG-826).
--
-- Until now "Department" was the free-text `Job Level` column (the employee forms label it Department) and a person's
-- manager was free text too (`Manager`, a name; `manager_email`, which the supervisor checks read; `regional_manager`).
-- This adds:
--
--   departments(name, parent_id, head_employee_id, active)   the company's departments, nested (no loops); a name is
--                                                            used once per company, whatever its case
--   employees.department_id                                  the employee's department (one of their company's)
--   employees.reports_to_id                                  who they report to (someone in their company, not
--                                                            themselves, and never a loop)
--
-- The old columns stay (other screens and checks read them) and follow the new ones:
--   * department_id set     -> `Job Level` becomes the department's name (renaming a department renames it too)
--   * `Job Level` typed     -> department_id is the company's department of that name, created if there is none
--                              (the bulk upload and older screens write only `Job Level`)
--   * reports_to_id set     -> manager_email becomes the manager's work email and `Manager` their name, so
--                              supervises() / supervised_employee_numbers() keep working unchanged
--   * manager_email typed   -> reports_to_id is the one employee with that work email (none if it is nobody, more
--                              than one person, the employee themselves, or would make a loop)
--   * a manager's work email or name changes -> their reports' manager_email / `Manager` follow
--
-- Backfill (existing companies): a department for each distinct non-empty `Job Level` (ignoring case and spaces) and
-- each employee put in it; reports_to_id where manager_email is exactly one other employee's work email (ignoring
-- case) in the same company, skipping any that would make a loop. Nothing already set is changed, so this can run
-- again safely.
--
-- Who does what: everyone in the company reads the departments (pickers, organogram); ADMIN and people with the
-- Employees module change them. employee_directory gains id, department_id and reports_to_id, so the organogram and the
-- "Reports to" picker work for every role.

-- ---------------------------------------------------------------------------------------------
-- 1. departments
-- ---------------------------------------------------------------------------------------------
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (btrim(name) <> '' and length(btrim(name)) <= 100),
  parent_id uuid references public.departments(id) on delete set null,
  head_employee_id uuid references public.employees(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);
create unique index if not exists departments_tenant_name on public.departments (tenant_id, lower(btrim(name)));
create index if not exists departments_tenant_parent on public.departments (tenant_id, parent_id);

alter table public.employees
  add column if not exists department_id uuid references public.departments(id) on delete set null,
  add column if not exists reports_to_id uuid references public.employees(id) on delete set null;
alter table public.employees drop constraint if exists employees_reports_to_not_self;
alter table public.employees add constraint employees_reports_to_not_self check (reports_to_id is null or reports_to_id <> id);
create index if not exists employees_department_idx on public.employees (department_id);
create index if not exists employees_reports_to_idx on public.employees (reports_to_id);

-- ---------------------------------------------------------------------------------------------
-- 2. helpers
-- ---------------------------------------------------------------------------------------------
-- p_employee reporting to p_manager would make a loop: p_manager already reports, directly or not, to p_employee
create or replace function public.reports_to_loops(p_employee uuid, p_manager uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  cur uuid := p_manager;
  hops integer := 0;
begin
  while cur is not null and hops < 10000 loop
    if cur = p_employee then
      return true;
    end if;
    select e.reports_to_id into cur from public.employees e where e.id = cur;
    hops := hops + 1;
  end loop;
  return false;
end $$;

-- p_department inside p_parent would make a loop: p_parent is p_department or one of its sub-departments
create or replace function public.department_loops(p_department uuid, p_parent uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  cur uuid := p_parent;
  hops integer := 0;
begin
  while cur is not null and hops < 10000 loop
    if cur = p_department then
      return true;
    end if;
    select d.parent_id into cur from public.departments d where d.id = cur;
    hops := hops + 1;
  end loop;
  return false;
end $$;

-- the one employee of the company with this work email (ignoring case), other than p_self; null if none or several
create or replace function public.employee_by_work_email(p_tenant uuid, p_email text, p_self uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select case when count(*) = 1 then (array_agg(e.id))[1] end
  from public.employees e
  where e.tenant_id = p_tenant and nullif(btrim(p_email), '') is not null
    and lower(btrim(e."Work Email")) = lower(btrim(p_email)) and e.id is distinct from p_self
$$;

revoke all on function public.reports_to_loops(uuid, uuid) from public, anon, authenticated;
revoke all on function public.department_loops(uuid, uuid) from public, anon, authenticated;
revoke all on function public.employee_by_work_email(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. rules for departments
-- ---------------------------------------------------------------------------------------------
create or replace function public.departments_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  if new.parent_id is not null then
    if not exists (select 1 from public.departments d where d.id = new.parent_id and d.tenant_id = new.tenant_id) then
      raise exception 'The parent department must be one of this company''s' using errcode = '23503';
    end if;
    if public.department_loops(new.id, new.parent_id) then
      raise exception 'A department can''t be inside itself or one of its own sub-departments' using errcode = '23514';
    end if;
  end if;
  if new.head_employee_id is not null
     and not exists (select 1 from public.employees e where e.id = new.head_employee_id and e.tenant_id = new.tenant_id) then
    raise exception 'The head of a department must be an employee of this company' using errcode = '23503';
  end if;
  return new;
end $$;

drop trigger if exists departments_rules on public.departments;
create trigger departments_rules before insert or update on public.departments
  for each row execute function public.departments_rules();

-- renaming a department renames it on its employees (`Job Level`, which other screens show as the department)
create or replace function public.departments_renamed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.employees e set "Job Level" = new.name
  where e.department_id = new.id and e.tenant_id = new.tenant_id and e."Job Level" is distinct from new.name;
  return null;
end $$;

drop trigger if exists departments_renamed on public.departments;
create trigger departments_renamed after update of name on public.departments
  for each row when (old.name is distinct from new.name) execute function public.departments_renamed();

-- ---------------------------------------------------------------------------------------------
-- 4. access
-- ---------------------------------------------------------------------------------------------
alter table public.departments enable row level security;
drop policy if exists tenant_isolation on public.departments;
create policy tenant_isolation on public.departments as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
revoke all on public.departments from anon;

-- everyone in the company reads them (pickers, organogram); ADMIN and the Employees module change them
drop policy if exists read_company on public.departments;
create policy read_company on public.departments for select to authenticated using (true);
drop policy if exists hr_write on public.departments;
create policy hr_write on public.departments for all to authenticated
  using ((select public.has_module('employees')))
  with check ((select public.has_module('employees')));

-- ---------------------------------------------------------------------------------------------
-- 5. backfill (before the employee rules below, so it changes only department_id and reports_to_id)
-- ---------------------------------------------------------------------------------------------
-- a department for each distinct `Job Level` a company uses (the spelling most of its employees have)
insert into public.departments (tenant_id, name)
select x.tenant_id, x.name
from (
  select distinct on (e.tenant_id, lower(btrim(e."Job Level"))) e.tenant_id, btrim(e."Job Level") as name
  from public.employees e
  where nullif(btrim(e."Job Level"), '') is not null and length(btrim(e."Job Level")) <= 100
  group by e.tenant_id, lower(btrim(e."Job Level")), btrim(e."Job Level")
  order by e.tenant_id, lower(btrim(e."Job Level")), count(*) desc, btrim(e."Job Level")
) x
on conflict (tenant_id, lower(btrim(name))) do nothing;

update public.employees e set department_id = d.id
from public.departments d
where e.department_id is null and d.tenant_id = e.tenant_id
  and lower(btrim(e."Job Level")) = lower(btrim(d.name));

-- reporting lines from manager_email, one at a time so a loop in the old data is skipped rather than saved
do $$
declare
  r record;
begin
  for r in
    select e.id, public.employee_by_work_email(e.tenant_id, e.manager_email, e.id) as manager_id
    from public.employees e
    where e.reports_to_id is null and nullif(btrim(e.manager_email), '') is not null
    order by e.tenant_id, e."Employee Number"
  loop
    if r.manager_id is not null and not public.reports_to_loops(r.id, r.manager_id) then
      update public.employees set reports_to_id = r.manager_id where id = r.id and reports_to_id is null;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6. rules for an employee's department and manager
-- ---------------------------------------------------------------------------------------------
create or replace function public.employees_org_structure() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  is_insert boolean := tg_op = 'INSERT';
  dep_changed boolean;
  level_changed boolean;
  rep_changed boolean;
  email_changed boolean;
  d public.departments;
  m public.employees;
  level text := nullif(btrim(new."Job Level"), '');
begin
  dep_changed := case when is_insert then new.department_id is not null else new.department_id is distinct from old.department_id end;
  level_changed := case when is_insert then level is not null else new."Job Level" is distinct from old."Job Level" end;
  rep_changed := case when is_insert then new.reports_to_id is not null else new.reports_to_id is distinct from old.reports_to_id end;
  email_changed := case when is_insert then nullif(btrim(new.manager_email), '') is not null
                        else new.manager_email is distinct from old.manager_email end;

  -- the department (it wins over `Job Level` when both change)
  if dep_changed then
    if new.department_id is not null then
      select * into d from public.departments where id = new.department_id;
      if d.id is null or d.tenant_id <> new.tenant_id then
        raise exception 'The department must be one of this company''s' using errcode = '23503';
      end if;
      if lower(coalesce(level, '')) <> lower(d.name) then
        new."Job Level" := d.name;
      end if;
    elsif level is not null and exists (
      select 1 from public.departments x where x.id = old.department_id and lower(btrim(x.name)) = lower(level)) then
      new."Job Level" := null;
    end if;
  elsif level_changed then
    if level is null then
      new.department_id := null;
    elsif length(level) <= 100 then
      select * into d from public.departments
      where tenant_id = new.tenant_id and lower(btrim(name)) = lower(level);
      if d.id is null then
        insert into public.departments (tenant_id, name) values (new.tenant_id, level)
          on conflict (tenant_id, lower(btrim(name))) do nothing
          returning * into d;
        if d.id is null then
          select * into d from public.departments where tenant_id = new.tenant_id and lower(btrim(name)) = lower(level);
        end if;
      end if;
      new.department_id := d.id;
    end if;
  end if;

  -- the manager (reports_to_id wins over manager_email when both change)
  if rep_changed then
    if new.reports_to_id is not null then
      if new.reports_to_id = new.id then
        raise exception 'Someone can''t report to themselves' using errcode = '23514';
      end if;
      select * into m from public.employees where id = new.reports_to_id;
      if m.id is null or m.tenant_id <> new.tenant_id then
        raise exception 'The manager must be an employee of this company' using errcode = '23503';
      end if;
      if public.reports_to_loops(new.id, new.reports_to_id) then
        raise exception 'That would make a loop: % already reports (directly or through others) to this employee',
          btrim(concat_ws(' ', m."First Name", m."Last Name")) using errcode = '23514';
      end if;
      if lower(btrim(coalesce(new.manager_email, ''))) <> lower(btrim(coalesce(m."Work Email", ''))) then
        new.manager_email := nullif(btrim(m."Work Email"), '');
      end if;
      new."Manager" := nullif(btrim(concat_ws(' ', m."First Name", m."Last Name")), '');
    elsif not is_insert and old.reports_to_id is not null then
      -- no manager now: clear what pointed at the old one (an email someone typed for another reason stays)
      select * into m from public.employees where id = old.reports_to_id;
      if m.id is not null and lower(btrim(coalesce(new.manager_email, ''))) = lower(btrim(coalesce(m."Work Email", ''))) then
        new.manager_email := null;
      end if;
      if m.id is not null and btrim(coalesce(new."Manager", '')) = btrim(concat_ws(' ', m."First Name", m."Last Name")) then
        new."Manager" := null;
      end if;
    end if;
  elsif email_changed then
    -- the manager's own work email changed (it still points at them): keep them
    if new.reports_to_id is null or not exists (
      select 1 from public.employees x where x.id = new.reports_to_id
        and lower(btrim(x."Work Email")) = lower(btrim(coalesce(new.manager_email, '')))) then
      new.reports_to_id := public.employee_by_work_email(new.tenant_id, new.manager_email, new.id);
      if new.reports_to_id is not null and public.reports_to_loops(new.id, new.reports_to_id) then
        new.reports_to_id := null;
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists employees_org_structure on public.employees;
create trigger employees_org_structure before insert or update on public.employees
  for each row execute function public.employees_org_structure();

-- a manager's new work email or name goes on their reports, so the supervisor checks keep finding them
create or replace function public.employees_manager_details_follow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.employees e
  set manager_email = nullif(btrim(new."Work Email"), ''),
      "Manager" = nullif(btrim(concat_ws(' ', new."First Name", new."Last Name")), '')
  where e.reports_to_id = new.id and e.tenant_id = new.tenant_id
    and (e.manager_email is distinct from nullif(btrim(new."Work Email"), '')
         or e."Manager" is distinct from nullif(btrim(concat_ws(' ', new."First Name", new."Last Name")), ''));
  return null;
end $$;

drop trigger if exists employees_manager_details_follow on public.employees;
create trigger employees_manager_details_follow after update of "Work Email", "First Name", "Last Name" on public.employees
  for each row when (old."Work Email" is distinct from new."Work Email" or old."First Name" is distinct from new."First Name"
                     or old."Last Name" is distinct from new."Last Name")
  execute function public.employees_manager_details_follow();

revoke all on function public.departments_rules() from public, anon, authenticated;
revoke all on function public.departments_renamed() from public, anon, authenticated;
revoke all on function public.employees_org_structure() from public, anon, authenticated;
revoke all on function public.employees_manager_details_follow() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. the directory every role reads: plus id, department and manager (the organogram, the "Reports to" picker)
-- ---------------------------------------------------------------------------------------------
create or replace view public.employee_directory with (security_barrier = true) as
  select "tenant_id",
    "Employee Number",
    "Employee Id",
    "First Name",
    "Middle Name",
    "Last Name",
    "Work Email",
    "Work Mobile",
    "Job Title",
    "Job Level",
    "Job Group",
    "Employee Type",
    "Entity",
    "Status",
    "Town",
    "Branch",
    "Office",
    "Area",
    "Manager",
    "manager_email",
    "regional_manager",
    "Leave Approver",
    "Alternate Approver",
    "second_level_leave_approver",
    "alternate_second_level_approver",
    "Date of Birth",
    "Start Date",
    "Profile Image",
    "id",
    "department_id",
    "reports_to_id"
  from public.employees e
  where tenant_id = (select public.current_tenant_id());

notify pgrst, 'reload schema';
