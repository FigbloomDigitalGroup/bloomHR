-- KPI templates per department, job title, job group or everyone, applied automatically; a job titles list (FIG-885).
--
-- Until now a KPI reached people only through assign_kpi() (20261016900000): one KPI, copied once to the current
-- employees of a department / job title (free text) / job group / one person, again every review period, and nothing
-- for anyone who joined or moved afterwards. This adds:
--
--   job_titles              the company's job titles: name (used once per company, ignoring case and extra spaces), an
--                           optional department and default job group (the add-employee form fills them in when they
--                           are still empty), active. Made from each company's existing "Job Title" texts.
--   employees.job_title_id  the employee's title. "Job Title" (text, read by contracts, payslips, reports) follows it:
--                             * job_title_id set        -> "Job Title" becomes the title's name
--                             * "Job Title" typed       -> linked to the company's title of that name (spelling
--                                                          tidied to the list's); a new name is added to the list
--                                                          when the person saving may manage job titles (or it is a
--                                                          system job), otherwise left unlinked
--                             * a title renamed         -> its employees' "Job Title" is renamed too
--                           merge_job_titles() moves one title's employees and templates onto another and removes it.
--   kpi_templates           a named set of KPIs for a department (and its sub-departments), a job title, a job group or
--                           everyone; only active templates are applied, and a template can only be active when its
--                           weights total 100.
--   kpi_template_items      the template's KPIs with a target (empty: the KPI's default target) and a weight.
--   kpi_assignments         + assigned_via 'template', template_id (which template it came from), overridden (a
--                           manager or HR changed its target or weight: kept as they set it from then on) and
--                           no_longer_matches (it came from a template that no longer fits the employee but it already
--                           has check-ins, so it was kept).
--
-- Applying templates (kpi_apply_templates_now): every active employee gets, as kpi_assignments, the items of every
-- active template that matches them:
--   * when a review period is opened (draft or closed -> open, or added as open): everyone;
--   * when an employee is added, or their department, job title, job group or status changes, while periods are open:
--     that employee, in each open period;
--   * by hand: apply_kpi_templates() (the Templates screen's "Apply to open periods", e.g. after editing a template).
-- Each run adds the template KPIs an employee doesn't have yet, brings the ones from templates up to date (target and
-- weight, unless overridden), and deals with template KPIs that no longer match: removed when nobody has checked in on
-- them yet, otherwise kept and marked no_longer_matches.
--
-- The same KPI from more than one place: one assignment, from the highest priority source:
--     person (anything assigned by hand, assign_kpi or the Assign screen, is never replaced by a template)
--   > job title > job group > department (the employee's own department before the one above it, and so on)
--   > everyone
-- (ties: the older template). Weights: each template's weights total 100, so someone matched by one template gets 100;
-- someone matched by several gets the sum, and the screens warn whenever a person's weights don't total 100.
--
-- Who does what: everyone in the company reads job titles and templates (pickers, "from template" labels). HR and
-- administrators, the Performance module (manages_kpis()) and the Employees module manage job titles; manages_kpis()
-- manages templates. Every table keeps to its company (the restrictive tenant_isolation policy).
--
-- No notifications are sent (staff see new KPIs on My KPIs).
-- Written to run again safely (if not exists / or replace / drop ... if exists / on conflict do nothing).

-- ---------------------------------------------------------------------------------------------
-- 1. job titles
-- ---------------------------------------------------------------------------------------------
-- the name as it is compared: lower case, no spaces at either end, runs of spaces (tabs, new lines) as one
create or replace function public.job_title_key(p text) returns text
language sql immutable as $$
  select nullif(lower(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'))), '')
$$;
-- the name as it is kept: the same, with its case
create or replace function public.job_title_tidy(p text) returns text
language sql immutable as $$
  select nullif(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')), '')
$$;

create table if not exists public.job_titles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (btrim(name) <> '' and length(btrim(name)) <= 120),
  department_id uuid references public.departments(id) on delete set null,
  job_group_id uuid,
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (job_group_id, tenant_id) references public.job_groups (id, tenant_id) on delete set null (job_group_id)
);
create unique index if not exists job_titles_tenant_name on public.job_titles (tenant_id, public.job_title_key(name));

alter table public.employees add column if not exists job_title_id uuid;
alter table public.employees drop constraint if exists employees_job_title_fkey;
alter table public.employees add constraint employees_job_title_fkey
  foreign key (job_title_id, tenant_id) references public.job_titles (id, tenant_id) on delete set null (job_title_id);
create index if not exists employees_job_title on public.employees (job_title_id) where job_title_id is not null;

create or replace function public.manages_job_titles() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() in ('ADMIN', 'HR') or public.has_module('employees') or public.manages_kpis(), false)
$$;
revoke all on function public.manages_job_titles() from public, anon;
grant execute on function public.manages_job_titles() to authenticated, service_role;

create or replace function public.job_titles_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.name := public.job_title_tidy(new.name);
  if tg_op = 'UPDATE' then
    new.tenant_id := old.tenant_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if new.department_id is not null
     and not exists (select 1 from public.departments d where d.id = new.department_id and d.tenant_id = new.tenant_id) then
    raise exception 'The department must be one of this company''s' using errcode = '23503';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists job_titles_rules on public.job_titles;
create trigger job_titles_rules before insert or update on public.job_titles
  for each row execute function public.job_titles_rules();

-- a renamed title renames its employees' "Job Title"
create or replace function public.job_titles_name_follows() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.employees set "Job Title" = new.name
  where job_title_id = new.id and "Job Title" is distinct from new.name;
  return new;
end $$;
drop trigger if exists job_titles_name_follows on public.job_titles;
create trigger job_titles_name_follows after update of name on public.job_titles
  for each row when (old.name is distinct from new.name) execute function public.job_titles_name_follows();

revoke all on function public.job_titles_rules() from public, anon, authenticated;
revoke all on function public.job_titles_name_follows() from public, anon, authenticated;

-- existing titles: one per distinct "Job Title" in each company (ignoring case and spacing), spelt the way most of its
-- employees spell it; then each employee linked and their text tidied to it
insert into public.job_titles (tenant_id, name, created_by)
select distinct on (v.tenant_id, v.k) v.tenant_id, v.name, null::uuid
from (
  select e.tenant_id, public.job_title_key(e."Job Title") as k, public.job_title_tidy(e."Job Title") as name, count(*) as n
  from public.employees e
  where e.tenant_id is not null and public.job_title_key(e."Job Title") is not null
    and length(public.job_title_tidy(e."Job Title")) <= 120
  group by 1, 2, 3
) v
order by v.tenant_id, v.k, v.n desc, v.name
on conflict do nothing;

update public.employees e set job_title_id = t.id, "Job Title" = t.name
from public.job_titles t
where e.job_title_id is null and t.tenant_id = e.tenant_id
  and public.job_title_key(t.name) = public.job_title_key(e."Job Title");

-- the employee's title and its text, kept together
create or replace function public.employees_job_title() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  is_insert boolean := tg_op = 'INSERT';
  id_changed boolean;
  text_changed boolean;
  t public.job_titles;
  k text := public.job_title_key(new."Job Title");
begin
  id_changed := case when is_insert then new.job_title_id is not null else new.job_title_id is distinct from old.job_title_id end;
  text_changed := case when is_insert then k is not null else new."Job Title" is distinct from old."Job Title" end;

  if id_changed then
    if new.job_title_id is not null then
      select * into t from public.job_titles where id = new.job_title_id;
      if t.id is null or t.tenant_id <> new.tenant_id then
        raise exception 'The job title must be one of this company''s' using errcode = '23503';
      end if;
      new."Job Title" := t.name;
    elsif not text_changed and exists (
      select 1 from public.job_titles x where x.id = old.job_title_id and public.job_title_key(x.name) = k) then
      -- the title taken away: its text goes with it
      new."Job Title" := null;
    end if;
  elsif text_changed then
    if k is null then
      new.job_title_id := null;
    else
      select * into t from public.job_titles where tenant_id = new.tenant_id and public.job_title_key(name) = k;
      if t.id is null and length(public.job_title_tidy(new."Job Title")) <= 120
         and (auth.uid() is null or public.manages_job_titles()) then
        insert into public.job_titles (tenant_id, name) values (new.tenant_id, public.job_title_tidy(new."Job Title"))
          on conflict do nothing
          returning * into t;
        if t.id is null then
          select * into t from public.job_titles where tenant_id = new.tenant_id and public.job_title_key(name) = k;
        end if;
      end if;
      new.job_title_id := t.id;
      if t.id is not null then
        new."Job Title" := t.name;
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.employees_job_title() from public, anon, authenticated;
drop trigger if exists employees_job_title on public.employees;
create trigger employees_job_title before insert or update on public.employees
  for each row execute function public.employees_job_title();

-- ---------------------------------------------------------------------------------------------
-- 2. KPI templates
-- ---------------------------------------------------------------------------------------------
create table if not exists public.kpi_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (btrim(name) <> '' and length(btrim(name)) <= 120),
  description text check (description is null or length(description) <= 2000),
  applies_to text not null check (applies_to in ('department', 'job_title', 'job_group', 'everyone')),
  department_id uuid references public.departments(id) on delete restrict,
  job_title_id uuid,
  job_group_id uuid,
  active boolean not null default false,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (job_title_id, tenant_id) references public.job_titles (id, tenant_id) on delete restrict,
  foreign key (job_group_id, tenant_id) references public.job_groups (id, tenant_id) on delete restrict,
  check (
    (applies_to = 'department' and department_id is not null and job_title_id is null and job_group_id is null)
    or (applies_to = 'job_title' and job_title_id is not null and department_id is null and job_group_id is null)
    or (applies_to = 'job_group' and job_group_id is not null and department_id is null and job_title_id is null)
    or (applies_to = 'everyone' and department_id is null and job_title_id is null and job_group_id is null))
);
create unique index if not exists kpi_templates_tenant_name on public.kpi_templates (tenant_id, lower(btrim(name)));

create table if not exists public.kpi_template_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  template_id uuid not null,
  kpi_id uuid not null,
  target numeric(16, 2),
  weight numeric(5, 2) not null default 0 check (weight between 0 and 100),
  created_at timestamptz not null default now(),
  unique (template_id, kpi_id),
  foreign key (template_id, tenant_id) references public.kpi_templates (id, tenant_id) on delete cascade,
  foreign key (kpi_id, tenant_id) references public.kpis (id, tenant_id) on delete restrict
);
create index if not exists kpi_template_items_kpi on public.kpi_template_items (kpi_id);

alter table public.kpi_assignments
  add column if not exists template_id uuid,
  add column if not exists overridden boolean not null default false,
  add column if not exists no_longer_matches boolean not null default false;
alter table public.kpi_assignments drop constraint if exists kpi_assignments_assigned_via_check;
alter table public.kpi_assignments add constraint kpi_assignments_assigned_via_check
  check (assigned_via in ('person', 'department', 'job_title', 'job_group', 'template'));
alter table public.kpi_assignments drop constraint if exists kpi_assignments_template_fkey;
alter table public.kpi_assignments add constraint kpi_assignments_template_fkey
  foreign key (template_id, tenant_id) references public.kpi_templates (id, tenant_id) on delete set null (template_id);
create index if not exists kpi_assignments_template on public.kpi_assignments (template_id) where template_id is not null;

-- a template's weights total, and whether it may be active
create or replace function public.kpi_template_weight_total(p_template uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(i.weight), 0) from public.kpi_template_items i where i.template_id = p_template
$$;
revoke all on function public.kpi_template_weight_total(uuid) from public, anon, authenticated;

create or replace function public.kpi_template_check_active(p_template uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_total numeric := public.kpi_template_weight_total(p_template);
begin
  if not exists (select 1 from public.kpi_template_items i where i.template_id = p_template) then
    raise exception 'Add KPIs to the template before making it active' using errcode = '23514';
  end if;
  if v_total <> 100 then
    raise exception 'A template''s weights must total 100%% before it can be active (they total %)', trim_scale(v_total) || '%'
      using errcode = '23514';
  end if;
end $$;
revoke all on function public.kpi_template_check_active(uuid) from public, anon, authenticated;

create or replace function public.kpi_templates_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.name := btrim(new.name);
  new.description := nullif(btrim(new.description), '');
  if tg_op = 'UPDATE' then
    new.tenant_id := old.tenant_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  -- only the target that goes with what it applies to
  if new.applies_to <> 'department' then new.department_id := null; end if;
  if new.applies_to <> 'job_title' then new.job_title_id := null; end if;
  if new.applies_to <> 'job_group' then new.job_group_id := null; end if;
  if new.department_id is not null
     and not exists (select 1 from public.departments d where d.id = new.department_id and d.tenant_id = new.tenant_id) then
    raise exception 'The department must be one of this company''s' using errcode = '23503';
  end if;
  if new.active and (tg_op = 'INSERT' or not old.active) then
    perform public.kpi_template_check_active(new.id);
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists kpi_templates_rules on public.kpi_templates;
create trigger kpi_templates_rules before insert or update on public.kpi_templates
  for each row execute function public.kpi_templates_rules();

create or replace function public.kpi_template_items_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tenant uuid;
begin
  select t.tenant_id into v_tenant from public.kpi_templates t where t.id = new.template_id;
  new.tenant_id := coalesce(v_tenant, new.tenant_id);
  if tg_op = 'UPDATE' then
    new.template_id := old.template_id;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists kpi_template_items_rules on public.kpi_template_items;
create trigger kpi_template_items_rules before insert or update on public.kpi_template_items
  for each row execute function public.kpi_template_items_rules();

-- an active template's weights still total 100 once the change is done (checked at the end of the transaction, so a
-- template can be edited in several steps)
create or replace function public.kpi_template_items_total() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_template uuid := case when tg_op = 'DELETE' then old.template_id else new.template_id end;
begin
  if exists (select 1 from public.kpi_templates t where t.id = v_template and t.active) then
    perform public.kpi_template_check_active(v_template);
  end if;
  return null;
end $$;
drop trigger if exists kpi_template_items_total on public.kpi_template_items;
create constraint trigger kpi_template_items_total after insert or update or delete on public.kpi_template_items
  deferrable initially deferred for each row execute function public.kpi_template_items_total();

revoke all on function public.kpi_templates_rules() from public, anon, authenticated;
revoke all on function public.kpi_template_items_rules() from public, anon, authenticated;
revoke all on function public.kpi_template_items_total() from public, anon, authenticated;

-- an assignment's template details are the system's: set when a template is applied; a person changing a template
-- KPI's target or weight marks it overridden (and it stays as they set it); re-assigning it by hand makes it a manual one
create or replace function public.kpi_assignments_template_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.kpi_checkin', true) = 'on' or current_setting('app.kpi_template_apply', true) = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.assigned_via = 'template' then
      new.assigned_via := 'person';
    end if;
    new.template_id := null;
    new.overridden := false;
    new.no_longer_matches := false;
    return new;
  end if;
  -- an employee renumbered
  if (to_jsonb(new) - 'employee_number') = (to_jsonb(old) - 'employee_number') then
    return new;
  end if;
  -- its template removed (the foreign key clears template_id)
  if new.template_id is null and old.template_id is not null
     and not exists (select 1 from public.kpi_templates t where t.id = old.template_id) then
    return new;
  end if;
  new.template_id := old.template_id;
  new.no_longer_matches := old.no_longer_matches;
  if old.assigned_via = 'template' then
    if new.assigned_via <> 'template' then
      new.template_id := null;
      new.overridden := false;
      new.no_longer_matches := false;
    else
      new.overridden := old.overridden or new.target is distinct from old.target or new.weight is distinct from old.weight;
    end if;
  else
    if new.assigned_via = 'template' then
      new.assigned_via := old.assigned_via;
    end if;
    new.overridden := false;
  end if;
  return new;
end $$;
revoke all on function public.kpi_assignments_template_rules() from public, anon, authenticated;
drop trigger if exists kpi_assignments_template_rules on public.kpi_assignments;
create trigger kpi_assignments_template_rules before insert or update on public.kpi_assignments
  for each row execute function public.kpi_assignments_template_rules();

-- (20261016900000's rules, plus: removing a template clears its assignments' template_id, whatever the period's status)
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
  -- a template removed: the foreign key clears template_id (also in a closed period) and nothing else changes
  if tg_op = 'UPDATE' and new.template_id is null and old.template_id is not null
     and (to_jsonb(new) - 'template_id') = (to_jsonb(old) - 'template_id') then
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
-- ---------------------------------------------------------------------------------------------
-- 3. access
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['job_titles', 'kpi_templates', 'kpi_template_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format($p$create policy tenant_isolation on public.%I as restrictive for all
      using (tenant_id = (select public.current_tenant_id()))
      with check (tenant_id = (select public.current_tenant_id()))$p$, t);
    execute format('drop policy if exists read_company on public.%I', t);
    execute format('create policy read_company on public.%I for select to authenticated using (true)', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

drop policy if exists manage on public.job_titles;
create policy manage on public.job_titles for all to authenticated
  using ((select public.manages_job_titles())) with check ((select public.manages_job_titles()));
drop policy if exists hr_write on public.kpi_templates;
create policy hr_write on public.kpi_templates for all to authenticated
  using ((select public.manages_kpis())) with check ((select public.manages_kpis()));
drop policy if exists hr_write on public.kpi_template_items;
create policy hr_write on public.kpi_template_items for all to authenticated
  using ((select public.manages_kpis())) with check ((select public.manages_kpis()));

-- ---------------------------------------------------------------------------------------------
-- 4. which templates match which employees, and applying them
-- ---------------------------------------------------------------------------------------------
create or replace function public.kpi_employee_active(p_status text) returns boolean
language sql immutable as $$
  select lower(coalesce(btrim(p_status), '')) not in ('terminated', 'inactive', 'exited', 'resigned', 'dismissed')
$$;

-- every (active employee, template) match with its priority: 2 job title, 3 job group, 4 department (depth 0 the
-- employee's own department, 1 the one above it ...), 5 everyone. (1, a person, is a manual assignment.)
create or replace function public.kpi_template_candidates(p_tenant uuid, p_employee text default null, p_active_only boolean default true)
returns table (employee_number text, template_id uuid, priority integer, depth integer, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  with recursive emp as (
    select e."Employee Number" as num, e.department_id, e.job_title_id, e.job_group_id
    from public.employees e
    where e.tenant_id = p_tenant
      and (p_employee is null or e."Employee Number" = p_employee)
      and public.kpi_employee_active(e."Status")
  ),
  up as (
    select emp.num, emp.department_id as dep, 0 as depth from emp where emp.department_id is not null
    union all
    select up.num, d.parent_id, up.depth + 1
    from up join public.departments d on d.id = up.dep
    where d.parent_id is not null and up.depth < 50
  ),
  tpl as (
    select * from public.kpi_templates t where t.tenant_id = p_tenant and (t.active or not p_active_only)
  )
  select emp.num, tpl.id, 2, 0, tpl.created_at from emp join tpl on tpl.applies_to = 'job_title' and tpl.job_title_id = emp.job_title_id
  union all
  select emp.num, tpl.id, 3, 0, tpl.created_at from emp join tpl on tpl.applies_to = 'job_group' and tpl.job_group_id = emp.job_group_id
  union all
  select up.num, tpl.id, 4, up.depth, tpl.created_at from up join tpl on tpl.applies_to = 'department' and tpl.department_id = up.dep
  union all
  select emp.num, tpl.id, 5, 0, tpl.created_at from emp join tpl on tpl.applies_to = 'everyone'
$$;
revoke all on function public.kpi_template_candidates(uuid, text, boolean) from public, anon, authenticated;

-- what the active templates give each employee: one row per KPI, from the highest priority template
create or replace function public.kpi_template_desired(p_tenant uuid, p_employee text default null)
returns table (employee_number text, kpi_id uuid, template_id uuid, target numeric, weight numeric)
language sql stable security definer set search_path = public as $$
  select distinct on (c.employee_number, i.kpi_id) c.employee_number, i.kpi_id, c.template_id, coalesce(i.target, k.default_target), i.weight
  from public.kpi_template_candidates(p_tenant, p_employee, true) c
  join public.kpi_template_items i on i.template_id = c.template_id
  join public.kpis k on k.id = i.kpi_id and not k.archived
  order by c.employee_number, i.kpi_id, c.priority, c.depth, c.created_at, c.template_id
$$;
revoke all on function public.kpi_template_desired(uuid, text) from public, anon, authenticated;

-- applies the active templates in an open period, to everyone or one employee; returns how many KPIs were added
create or replace function public.kpi_apply_templates_now(p_period uuid, p_employee text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_status text;
  v_prev text := coalesce(current_setting('app.kpi_template_apply', true), '');
  v_added integer;
begin
  select p.tenant_id, p.status into v_tenant, v_status from public.kpi_periods p where p.id = p_period;
  if v_tenant is null or v_status is distinct from 'open' then
    return 0;
  end if;
  perform set_config('app.kpi_template_apply', 'on', true);

  -- the template KPIs they don't have yet (anything they already have, manual or not, stays)
  insert into public.kpi_assignments (tenant_id, period_id, kpi_id, employee_number, target, weight, assigned_via, template_id)
  select v_tenant, p_period, d.kpi_id, d.employee_number, d.target, d.weight, 'template', d.template_id
  from public.kpi_template_desired(v_tenant, p_employee) d
  on conflict (period_id, kpi_id, employee_number) do nothing;
  get diagnostics v_added = row_count;

  -- the ones from templates, up to date (an overridden one keeps its target and weight)
  with d as materialized (select * from public.kpi_template_desired(v_tenant, p_employee))
  update public.kpi_assignments a
  set template_id = d.template_id,
      target = case when a.overridden then a.target else d.target end,
      weight = case when a.overridden then a.weight else d.weight end,
      no_longer_matches = false
  from d
  where a.period_id = p_period and a.employee_number = d.employee_number and a.kpi_id = d.kpi_id
    and a.assigned_via = 'template'
    and (a.template_id is distinct from d.template_id or a.no_longer_matches
         or (not a.overridden and (a.target is distinct from d.target or a.weight <> d.weight)));

  -- the ones that no longer match a current employee: removed, unless someone has checked in on them
  with d as materialized (select * from public.kpi_template_desired(v_tenant, p_employee)),
  gone as (
    select a.id, exists (select 1 from public.kpi_checkins c where c.assignment_id = a.id) as kept
    from public.kpi_assignments a
    join public.employees e on e.tenant_id = a.tenant_id and e."Employee Number" = a.employee_number
    where a.period_id = p_period and a.assigned_via = 'template'
      and (p_employee is null or a.employee_number = p_employee)
      and public.kpi_employee_active(e."Status")
      and not exists (select 1 from d where d.employee_number = a.employee_number and d.kpi_id = a.kpi_id)
  ),
  removed as (
    delete from public.kpi_assignments a using gone where a.id = gone.id and not gone.kept returning a.id
  )
  update public.kpi_assignments a set no_longer_matches = true
  from gone where a.id = gone.id and gone.kept and not a.no_longer_matches;

  perform set_config('app.kpi_template_apply', v_prev, true);
  return v_added;
end $$;
revoke all on function public.kpi_apply_templates_now(uuid, text) from public, anon, authenticated;

-- a period opened: everyone gets their template KPIs
create or replace function public.kpi_periods_apply_templates() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.kpi_apply_templates_now(new.id, null);
  return new;
end $$;
revoke all on function public.kpi_periods_apply_templates() from public, anon, authenticated;
drop trigger if exists kpi_periods_apply_templates on public.kpi_periods;
drop trigger if exists kpi_periods_apply_templates_insert on public.kpi_periods;
create trigger kpi_periods_apply_templates_insert after insert on public.kpi_periods
  for each row when (new.status = 'open') execute function public.kpi_periods_apply_templates();
drop trigger if exists kpi_periods_apply_templates_open on public.kpi_periods;
create trigger kpi_periods_apply_templates_open after update on public.kpi_periods
  for each row when (new.status = 'open' and old.status is distinct from 'open') execute function public.kpi_periods_apply_templates();

-- an employee joined, moved or came back during open periods: their template KPIs in each
create or replace function public.employees_apply_kpi_templates() returns trigger
language plpgsql security definer set search_path = public as $$
declare p uuid;
begin
  for p in select k.id from public.kpi_periods k where k.tenant_id = new.tenant_id and k.status = 'open' loop
    perform public.kpi_apply_templates_now(p, new."Employee Number");
  end loop;
  return new;
end $$;
revoke all on function public.employees_apply_kpi_templates() from public, anon, authenticated;
drop trigger if exists employees_apply_kpi_templates on public.employees;
create trigger employees_apply_kpi_templates after insert on public.employees
  for each row execute function public.employees_apply_kpi_templates();
drop trigger if exists employees_apply_kpi_templates_change on public.employees;
create trigger employees_apply_kpi_templates_change after update on public.employees
  for each row when (old.department_id is distinct from new.department_id
                     or old.job_title_id is distinct from new.job_title_id
                     or old.job_group_id is distinct from new.job_group_id
                     or old."Status" is distinct from new."Status")
  execute function public.employees_apply_kpi_templates();

-- ---------------------------------------------------------------------------------------------
-- 5. for the screens
-- ---------------------------------------------------------------------------------------------
-- "Apply to open periods" (or one open period): returns how many KPIs were added
create or replace function public.apply_kpi_templates(p_period uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  p uuid;
  n integer := 0;
begin
  if auth.uid() is null or v_tenant is null or not public.manages_kpis() then
    raise exception 'Only HR can apply KPI templates' using errcode = '42501';
  end if;
  if p_period is not null and not exists (select 1 from public.kpi_periods k where k.id = p_period and k.tenant_id = v_tenant) then
    raise exception 'Unknown review period' using errcode = '23503';
  end if;
  if p_period is not null and not exists (select 1 from public.kpi_periods k where k.id = p_period and k.status = 'open') then
    raise exception 'Open the review period first' using errcode = '22023';
  end if;
  for p in select k.id from public.kpi_periods k
           where k.tenant_id = v_tenant and k.status = 'open' and (p_period is null or k.id = p_period) loop
    n := n + public.kpi_apply_templates_now(p, null);
  end loop;
  return n;
end $$;
revoke all on function public.apply_kpi_templates(uuid) from public, anon;
grant execute on function public.apply_kpi_templates(uuid) to authenticated;

-- who each template matches now (active or not), for the Templates screen
create or replace function public.kpi_template_members()
returns table (template_id uuid, employee_number text, priority integer, depth integer)
language plpgsql stable security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null or not public.manages_kpis() then
    raise exception 'Only HR can see KPI templates'' matches' using errcode = '42501';
  end if;
  return query
  select distinct c.template_id, c.employee_number, c.priority, min(c.depth) over (partition by c.template_id, c.employee_number)
  from public.kpi_template_candidates(v_tenant, null, false) c;
end $$;
revoke all on function public.kpi_template_members() from public, anon;
grant execute on function public.kpi_template_members() to authenticated;

-- adds or changes a template and its KPIs in one go; returns its id
create or replace function public.save_kpi_template(
  p_id uuid, p_name text, p_applies_to text, p_target uuid, p_active boolean, p_items jsonb, p_description text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := p_id;
  it jsonb;
begin
  if auth.uid() is null or v_tenant is null or not public.manages_kpis() then
    raise exception 'Only HR can change KPI templates' using errcode = '42501';
  end if;
  if p_applies_to not in ('department', 'job_title', 'job_group', 'everyone') then
    raise exception 'Unknown "applies to": %', p_applies_to using errcode = '22023';
  end if;
  if p_applies_to <> 'everyone' and p_target is null then
    raise exception 'Choose who the template is for' using errcode = '22023';
  end if;
  if p_applies_to = 'job_title' and not exists (select 1 from public.job_titles j where j.id = p_target and j.tenant_id = v_tenant)
     or p_applies_to = 'job_group' and not exists (select 1 from public.job_groups j where j.id = p_target and j.tenant_id = v_tenant)
     or p_applies_to = 'department' and not exists (select 1 from public.departments d where d.id = p_target and d.tenant_id = v_tenant) then
    raise exception 'Choose one of this company''s %', replace(p_applies_to, '_', ' ') || 's' using errcode = '23503';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'The KPIs must be a list' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.kpi_templates (tenant_id, name, description, applies_to, department_id, job_title_id, job_group_id, active)
    values (v_tenant, p_name, p_description, p_applies_to,
      case when p_applies_to = 'department' then p_target end,
      case when p_applies_to = 'job_title' then p_target end,
      case when p_applies_to = 'job_group' then p_target end, false)
    returning id into v_id;
  else
    update public.kpi_templates set name = p_name, description = p_description, applies_to = p_applies_to,
      department_id = case when p_applies_to = 'department' then p_target end,
      job_title_id = case when p_applies_to = 'job_title' then p_target end,
      job_group_id = case when p_applies_to = 'job_group' then p_target end,
      active = false
    where id = v_id and tenant_id = v_tenant;
    if not found then
      raise exception 'Unknown KPI template' using errcode = '23503';
    end if;
  end if;

  delete from public.kpi_template_items where template_id = v_id;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if not exists (select 1 from public.kpis k where k.id = (it->>'kpi_id')::uuid and k.tenant_id = v_tenant) then
      raise exception 'Unknown KPI' using errcode = '23503';
    end if;
    insert into public.kpi_template_items (tenant_id, template_id, kpi_id, target, weight)
    values (v_tenant, v_id, (it->>'kpi_id')::uuid, nullif(it->>'target', '')::numeric, coalesce(nullif(it->>'weight', '')::numeric, 0));
  end loop;

  if p_active then
    update public.kpi_templates set active = true where id = v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.save_kpi_template(uuid, text, text, uuid, boolean, jsonb, text) from public, anon;
grant execute on function public.save_kpi_template(uuid, text, text, uuid, boolean, jsonb, text) to authenticated;

-- the company's job groups (code and name only, no pay) for the template and job title pickers
create or replace function public.job_group_choices()
returns table (id uuid, code text, name text, active boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null or not (public.manages_kpis() or public.manages_job_titles() or public.manages_job_groups()) then
    raise exception 'You may not see job groups' using errcode = '42501';
  end if;
  return query select j.id, j.code, j.name, j.active from public.job_groups j where j.tenant_id = v_tenant order by j.active desc, lower(j.code);
end $$;
revoke all on function public.job_group_choices() from public, anon;
grant execute on function public.job_group_choices() to authenticated;

-- Settings -> Job titles: each title and how many employees have it
create or replace function public.job_titles_overview()
returns table (id uuid, name text, department_id uuid, job_group_id uuid, active boolean, employee_count integer, template_count integer)
language plpgsql stable security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null or not public.manages_job_titles() then
    raise exception 'You may not manage job titles' using errcode = '42501';
  end if;
  return query
  select j.id, j.name, j.department_id, j.job_group_id, j.active,
    (select count(*)::integer from public.employees e where e.tenant_id = v_tenant and e.job_title_id = j.id),
    (select count(*)::integer from public.kpi_templates t where t.job_title_id = j.id)
  from public.job_titles j
  where j.tenant_id = v_tenant
  order by j.active desc, lower(j.name);
end $$;
revoke all on function public.job_titles_overview() from public, anon;
grant execute on function public.job_titles_overview() to authenticated;

-- merges a duplicate title into another: its employees and templates move over and it is removed; returns how many
-- employees moved
create or replace function public.merge_job_titles(p_from uuid, p_into uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  n integer;
begin
  if auth.uid() is null or v_tenant is null or not public.manages_job_titles() then
    raise exception 'You may not manage job titles' using errcode = '42501';
  end if;
  if p_from = p_into then
    raise exception 'Choose a different title to merge into' using errcode = '22023';
  end if;
  if (select count(*) from public.job_titles j where j.id in (p_from, p_into) and j.tenant_id = v_tenant) <> 2 then
    raise exception 'Unknown job title' using errcode = '23503';
  end if;
  update public.employees set job_title_id = p_into where tenant_id = v_tenant and job_title_id = p_from;
  get diagnostics n = row_count;
  update public.kpi_templates set job_title_id = p_into where tenant_id = v_tenant and job_title_id = p_from;
  delete from public.job_titles where id = p_from;
  return n;
end $$;
revoke all on function public.merge_job_titles(uuid, uuid) from public, anon;
grant execute on function public.merge_job_titles(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. the directory every role reads: plus the job title and job group ids (template matches, pickers)
-- ---------------------------------------------------------------------------------------------
-- Skipped once 20261020700000_birthday_privacy has redefined the view (it adds a birthday column and hides the year),
-- so running this file again neither fails on the extra column nor brings the year back.
do $do$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'employee_directory' and column_name = 'birthday') then
    execute $v$
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
    "reports_to_id",
    "job_title_id",
    "job_group_id"
  from public.employees e
  where tenant_id = (select public.current_tenant_id())
    $v$;
  end if;
end $do$;

notify pgrst, 'reload schema';
