-- Approval workflows each company sets up (FIG-829), leave first: an ordered chain of approvers ("line manager, then
-- HR, then the CTO"), checked in the database instead of the browser.
--
--   * approval_workflows: one per company per kind ('leave' now; 'salary_advance' and 'bulk_import' can be set up but
--     nothing uses them yet). approval_steps: its ordered steps. Each step's approver is one of
--       leave_approver  - the employee's "Leave Approver" (Add/Edit Employee); their "Alternate Approver" also decides
--       reports_to      - the employee's line manager (employees.manager_email, the same link supervises() uses)
--       role            - anyone whose role is approver_role (ADMIN, HR, CHECKER, MANAGER ...)
--       person          - one named employee
--       department_head - the head of the employee's department; only when employees.department_id and
--                         departments.head_employee_id exist (approval_department_head_available()), else not offered
--     with an optional alternate (a role or a person) who may decide in their place. A step is skipped when its
--     approver is the person asking (skip_if_requester), or when the employee has nobody in that place (no Leave
--     Approver, no manager) - as today, where an employee without a Leave Approver goes straight to HR.
--   * approval_requests: one per thing being approved (a leave application), with a copy of the steps taken when it
--     was made, so editing the workflow never changes a request already on its way. approval_actions: who decided
--     which step, how, with what comment, when.
--   * decide_approval(request, decision, comment) is the only way to decide: the caller must be the current step's
--     approver (or its alternate; ADMIN too while the workflow lets admins act, as admins could before). Approving
--     moves to the next step or, at the last, approves the application; rejecting ends it at any step. Anyone who
--     approves a later step may also turn the request down early (HR could always reject before the recommendation).
--     Nobody decides their own request. Changing a leave application's status or recommendation directly while its
--     request is pending is refused.
--   * What a decision writes on leave_application is what the Leave page wrote before: an earlier step approving sets
--     recstatus = 'recommended' and recommendation_notes; the last step sets status = 'approved' and notes; a rejection
--     sets status = 'rejected' and notes (and, from an earlier step's approver, recstatus = 'not_recommended' and
--     recommendation_notes). The leave balance is still taken by the Leave page when the decision comes back approved.
--   * Notifications (hr_notifications): the next approver(s) get 'approval_needed'; when the next step is a role (HR)
--     the HR bell gets 'leave_recommended' as before; the employee gets 'approval_progress' after each step and
--     'leave_approved' / 'leave_rejected' at the end.
--   * Every company starts with a leave workflow that is today's: 1. the employee's Leave Approver recommends,
--     2. HR approves (and admins may act at any step). Pending applications are put on it at the step they have
--     reached (recommended ones at step 2), quietly (no notifications).

-- ---------------------------------------------------------------------------------------------
-- 1. tables
-- ---------------------------------------------------------------------------------------------
create table if not exists public.approval_workflows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('leave', 'salary_advance', 'bulk_import')),
  -- admins may decide any step (as they could recommend and approve leave before)
  admins_can_act boolean not null default true,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, kind)
);

create table if not exists public.approval_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  workflow_id uuid not null references public.approval_workflows(id) on delete cascade,
  position smallint not null check (position between 1 and 10),
  label text check (label is null or char_length(btrim(label)) between 1 and 60),
  approver_type text not null check (approver_type in ('leave_approver', 'reports_to', 'department_head', 'role', 'person')),
  approver_role text check (approver_role is null or approver_role ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  approver_employee_id uuid references public.employees(id) on delete set null,
  alternate_type text check (alternate_type is null or alternate_type in ('role', 'person')),
  alternate_role text check (alternate_role is null or alternate_role ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  alternate_employee_id uuid references public.employees(id) on delete set null,
  skip_if_requester boolean not null default true,
  check (approver_type <> 'role' or approver_role is not null),
  check (alternate_type is distinct from 'role' or alternate_role is not null),
  unique (workflow_id, position)
);
create index if not exists approval_steps_workflow_idx on public.approval_steps (workflow_id, position);

create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  workflow_id uuid references public.approval_workflows(id) on delete set null,
  kind text not null check (kind in ('leave', 'salary_advance', 'bulk_import')),
  -- the thing being approved (for 'leave', the leave_application id)
  record_id uuid not null,
  requester_employee_number text,
  -- the workflow's steps when the request was made (see approval_step_json)
  steps jsonb not null check (jsonb_typeof(steps) = 'array'),
  admins_can_act boolean not null default true,
  -- the step waiting on a decision (1-based); once finished, the step that finished it
  current_step smallint not null default 1,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (kind, record_id)
);
create index if not exists approval_requests_pending_idx on public.approval_requests (tenant_id, kind, status);
create index if not exists approval_requests_requester_idx on public.approval_requests (tenant_id, requester_employee_number);

create table if not exists public.approval_actions (
  id bigint generated always as identity primary key,
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  step smallint not null,
  decision text not null check (decision in ('approved', 'rejected', 'skipped')),
  comment text check (comment is null or char_length(comment) <= 1000),
  -- approver / alternate / admin (an admin acting on any step) / later_step (a later approver turning it down early)
  -- / system (a skipped step, or a decision made before workflows)
  acted_as text not null check (acted_as in ('approver', 'alternate', 'admin', 'later_step', 'system')),
  actor_user_id uuid default auth.uid() references auth.users(id) on delete set null,
  actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists approval_actions_request_idx on public.approval_actions (request_id, step);

-- ---------------------------------------------------------------------------------------------
-- 2. who approves
-- ---------------------------------------------------------------------------------------------

-- the "department head" approver needs the org structure (departments with a head, employees in a department)
create or replace function public.approval_department_head_available() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'employees' and column_name = 'department_id')
     and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'departments' and column_name = 'head_employee_id')
$$;

-- names compared the way people type them ("jane  Doe" = "Jane Doe")
create or replace function public.approval_name_key(p text) returns text language sql immutable as $$
  select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'))
$$;

create or replace function public.approval_employee_name(e public.employees) returns text language sql stable as $$
  select coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), e."Work Email", e."Employee Number")
$$;

/**
 * The employees who approve as this approver for this employee (p_requester, an employee number):
 * p_type is a step's approver type, or 'alternate_leave_approver' (the employee's Alternate Approver).
 * The Leave Approver fields hold a name (as Add/Edit Employee saves them); an email or employee number works too.
 */
create or replace function public.approval_people(p_tenant uuid, p_type text, p_role text, p_employee uuid, p_requester text)
returns setof public.employees
language plpgsql stable security definer set search_path = public as $$
declare
  r public.employees;
  who text;
begin
  if p_type in ('leave_approver', 'alternate_leave_approver', 'reports_to') then
    select * into r from public.employees where tenant_id = p_tenant and "Employee Number" = p_requester;
    if r.id is null then
      return;
    end if;
  end if;
  if p_type in ('leave_approver', 'alternate_leave_approver') then
    who := nullif(btrim(case when p_type = 'leave_approver' then r."Leave Approver" else r."Alternate Approver" end), '');
    if who is null then
      return;
    end if;
    return query select e.* from public.employees e
      where e.tenant_id = p_tenant
        and (public.approval_name_key(concat_ws(' ', e."First Name", e."Last Name")) = public.approval_name_key(who)
             or lower(btrim(e."Work Email")) = lower(who) or e."Employee Number" = who);
  elsif p_type = 'reports_to' then
    return query select e.* from public.employees e
      where e.tenant_id = p_tenant and lower(btrim(e."Work Email")) = lower(btrim(r.manager_email));
  elsif p_type = 'person' then
    return query select e.* from public.employees e where e.tenant_id = p_tenant and e.id = p_employee;
  elsif p_type = 'role' then
    return query select e.* from public.employees e
      where e.tenant_id = p_tenant and lower(btrim(e."Work Email")) in (
        select lower(u.email) from auth.users u
        where u.id in (select m.user_id from public.memberships m where m.tenant_id = p_tenant and m.role = p_role
                       union
                       select p.user_id from public.user_profiles p where p.tenant_id = p_tenant and p.role = p_role));
  elsif p_type = 'department_head' and public.approval_department_head_available() then
    -- the org structure is not part of this migration: read it only where it exists
    return query execute
      'select h.* from public.employees r join public.departments d on d.id = r.department_id
         join public.employees h on h.id = d.head_employee_id
       where r.tenant_id = $1 and r."Employee Number" = $2 and h.tenant_id = $1'
      using p_tenant, p_requester;
  end if;
end $$;

-- the employee has someone in this place at all (a Leave Approver typed in, a manager's email), found or not
create or replace function public.approval_has_assignee(p_tenant uuid, p_step jsonb, p_requester text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_step ->> 'approver_type'
    when 'leave_approver' then exists (select 1 from public.employees r where r.tenant_id = p_tenant
      and r."Employee Number" = p_requester and coalesce(btrim(r."Leave Approver"), '') <> '')
    when 'reports_to' then exists (select 1 from public.employees r where r.tenant_id = p_tenant
      and r."Employee Number" = p_requester and coalesce(btrim(r.manager_email), '') <> '')
    when 'role' then true
    else exists (select 1 from public.approval_people(p_tenant, p_step ->> 'approver_type', p_step ->> 'approver_role',
                   (p_step ->> 'approver_employee_id')::uuid, p_requester))
  end
$$;

-- the step's main approvers (employee numbers), then its alternates
create or replace function public.approval_step_numbers(p_tenant uuid, p_step jsonb, p_requester text, p_alternates boolean)
returns setof text
language sql stable security definer set search_path = public as $$
  select p."Employee Number" from public.approval_people(p_tenant, p_step ->> 'approver_type', p_step ->> 'approver_role',
    (p_step ->> 'approver_employee_id')::uuid, p_requester) p
  where not p_alternates
  union
  select p."Employee Number" from public.approval_people(p_tenant, 'alternate_leave_approver', null, null, p_requester) p
  where p_alternates and p_step ->> 'approver_type' = 'leave_approver'
  union
  select p."Employee Number" from public.approval_people(p_tenant, p_step ->> 'alternate_type', p_step ->> 'alternate_role',
    (p_step ->> 'alternate_employee_id')::uuid, p_requester) p
  where p_alternates and p_step ->> 'alternate_type' is not null
$$;

-- how the signed-in user may decide this step: 'approver', 'alternate', 'admin', or null (not at all)
create or replace function public.approval_acting_as(p_tenant uuid, p_step jsonb, p_requester text, p_admins boolean)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  me text := public.current_employee_number();
  my_role text := public.current_user_role();
begin
  if p_step ->> 'approver_type' = 'role' then
    if my_role = p_step ->> 'approver_role' then
      return 'approver';
    end if;
  elsif p_step ->> 'approver_type' = 'reports_to' then
    -- the manager is found by their login's email, as supervises() does (they need no employee record)
    if exists (select 1 from public.employees r where r.tenant_id = p_tenant and r."Employee Number" = p_requester
               and lower(btrim(r.manager_email)) = lower(public.current_user_email())) then
      return 'approver';
    end if;
  elsif me is not null and me in (select public.approval_step_numbers(p_tenant, p_step, p_requester, false)) then
    return 'approver';
  end if;
  if p_step ->> 'alternate_type' = 'role' and my_role = p_step ->> 'alternate_role' then
    return 'alternate';
  end if;
  if me is not null and me in (select public.approval_step_numbers(p_tenant, p_step, p_requester, true)) then
    return 'alternate';
  end if;
  if p_admins and my_role = 'ADMIN' then
    return 'admin';
  end if;
  return null;
end $$;

-- why a step is passed over: 'requester' (its approver is the person asking), 'no approver' (the employee has nobody
-- in that place), or null (it waits for a decision). A role step always waits.
create or replace function public.approval_skip_reason(p_tenant uuid, p_step jsonb, p_requester text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  main text[];
  alternates text[];
begin
  if p_step ->> 'approver_type' = 'role' then
    return null;
  end if;
  -- the usual case, quickly: nobody typed in at all
  if p_step ->> 'alternate_type' is null and p_step ->> 'approver_type' in ('leave_approver', 'reports_to') and not exists (
       select 1 from public.employees r where r.tenant_id = p_tenant and r."Employee Number" = p_requester
         and (case when p_step ->> 'approver_type' = 'leave_approver'
                   then coalesce(btrim(r."Leave Approver"), '') <> '' or coalesce(btrim(r."Alternate Approver"), '') <> ''
                   else coalesce(btrim(r.manager_email), '') <> '' end)) then
    return 'no approver';
  end if;
  main := array(select public.approval_step_numbers(p_tenant, p_step, p_requester, false));
  alternates := array(select public.approval_step_numbers(p_tenant, p_step, p_requester, true));
  if coalesce((p_step ->> 'skip_if_requester')::boolean, true) and cardinality(main) > 0
     and main <@ array[p_requester] then
    return 'requester';
  end if;
  if cardinality(main) = 0 and cardinality(alternates) = 0 and p_step ->> 'alternate_type' is distinct from 'role'
     and not public.approval_has_assignee(p_tenant, p_step, p_requester) then
    return 'no approver';
  end if;
  return null;
end $$;

-- what a step is called: its own label, else what its approver is
create or replace function public.approval_step_label(p_tenant uuid, p_step jsonb) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(p_step ->> 'label'), ''), case p_step ->> 'approver_type'
    when 'leave_approver' then 'Leave approver'
    when 'reports_to' then 'Line manager'
    when 'department_head' then 'Department head'
    when 'role' then p_step ->> 'approver_role'
    when 'person' then (select public.approval_employee_name(e) from public.employees e
                        where e.tenant_id = p_tenant and e.id = (p_step ->> 'approver_employee_id')::uuid)
  end, 'Approver')
$$;

-- who the step is waiting on, in words ("Jane Doe or John Kamau", "HR")
create or replace function public.approval_waiting_on(p_tenant uuid, p_step jsonb, p_requester text) returns text
language sql stable security definer set search_path = public as $$
  select nullif(concat_ws(' or ',
    case when p_step ->> 'approver_type' = 'role' then p_step ->> 'approver_role'
         else coalesce(
           (select string_agg(public.approval_employee_name(p), ', ' order by p."First Name")
            from public.approval_people(p_tenant, p_step ->> 'approver_type', p_step ->> 'approver_role',
                                        (p_step ->> 'approver_employee_id')::uuid, p_requester) p
            where p."Employee Number" is distinct from p_requester),
           (select nullif(btrim(case p_step ->> 'approver_type' when 'leave_approver' then r."Leave Approver"
                                                                when 'reports_to' then r.manager_email end), '')
            from public.employees r where r.tenant_id = p_tenant and r."Employee Number" = p_requester))
    end,
    case when p_step ->> 'alternate_type' = 'role' then p_step ->> 'alternate_role' end,
    (select string_agg(public.approval_employee_name(p), ', ' order by p."First Name")
     from public.employees p
     where p.tenant_id = p_tenant and p."Employee Number" is distinct from p_requester
       and p."Employee Number" in (select public.approval_step_numbers(p_tenant, p_step, p_requester, true))
       and p_step ->> 'alternate_type' is distinct from 'role')
  ), '')
$$;

revoke all on function public.approval_people(uuid, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.approval_has_assignee(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.approval_step_numbers(uuid, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public.approval_acting_as(uuid, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public.approval_skip_reason(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.approval_step_label(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.approval_waiting_on(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.approval_department_head_available() from public, anon;
grant execute on function public.approval_department_head_available() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. workflows: today's by default, edited on Settings > Approval workflows
-- ---------------------------------------------------------------------------------------------

-- a step as kept on a request
create or replace function public.approval_step_json(s public.approval_steps) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'label', s.label, 'approver_type', s.approver_type, 'approver_role', s.approver_role,
    'approver_employee_id', s.approver_employee_id, 'alternate_type', s.alternate_type, 'alternate_role', s.alternate_role,
    'alternate_employee_id', s.alternate_employee_id, 'skip_if_requester', s.skip_if_requester)
$$;

-- today's chain: the employee's Leave Approver recommends, then HR approves
create or replace function public.approval_default_steps(p_kind text) returns jsonb language sql immutable as $$
  select case p_kind
    when 'leave' then jsonb_build_array(
      jsonb_build_object('label', null, 'approver_type', 'leave_approver', 'approver_role', null, 'approver_employee_id', null,
                         'alternate_type', null, 'alternate_role', null, 'alternate_employee_id', null, 'skip_if_requester', true),
      jsonb_build_object('label', null, 'approver_type', 'role', 'approver_role', 'HR', 'approver_employee_id', null,
                         'alternate_type', null, 'alternate_role', null, 'alternate_employee_id', null, 'skip_if_requester', true))
    else jsonb_build_array(
      jsonb_build_object('label', null, 'approver_type', 'role', 'approver_role', 'HR', 'approver_employee_id', null,
                         'alternate_type', null, 'alternate_role', null, 'alternate_employee_id', null, 'skip_if_requester', true))
  end
$$;

-- a company's workflow for this kind, with its steps (today's if it has none yet)
create or replace function public.approval_workflow_create(p_tenant uuid, p_kind text) returns public.approval_workflows
language plpgsql security definer set search_path = public as $$
declare
  w public.approval_workflows;
  s jsonb;
  i int := 0;
begin
  select * into w from public.approval_workflows where tenant_id = p_tenant and kind = p_kind;
  if w.id is not null then
    return w;
  end if;
  insert into public.approval_workflows (tenant_id, kind, updated_by) values (p_tenant, p_kind, null)
  on conflict (tenant_id, kind) do nothing returning * into w;
  if w.id is null then
    select * into w from public.approval_workflows where tenant_id = p_tenant and kind = p_kind;
    return w;
  end if;
  for s in select value from jsonb_array_elements(public.approval_default_steps(p_kind)) loop
    i := i + 1;
    insert into public.approval_steps (tenant_id, workflow_id, position, approver_type, approver_role, skip_if_requester)
    values (p_tenant, w.id, i, s ->> 'approver_type', s ->> 'approver_role', true);
  end loop;
  return w;
end $$;
revoke all on function public.approval_workflow_create(uuid, text) from public, anon, authenticated;

-- every company has today's leave workflow, and a new company gets it when it is created
select public.approval_workflow_create(t.id, 'leave') from public.tenants t;

create or replace function public.approval_workflows_for_new_company() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.approval_workflow_create(new.id, 'leave');
  return null;
end $$;
drop trigger if exists approval_workflows_for_new_company on public.tenants;
create trigger approval_workflows_for_new_company after insert on public.tenants
  for each row execute function public.approval_workflows_for_new_company();

/**
 * Saves a company's workflow for a kind: its steps in order (replacing the ones there) and whether admins may act at
 * any step. ADMIN and people with Settings. Requests already made keep the steps they started with.
 * p_steps: [{label?, approver_type, approver_role?, approver_employee_id? | approver_employee_number?, alternate_type?,
 *            alternate_role?, alternate_employee_id? | alternate_employee_number?, skip_if_requester?}, ...]
 */
create or replace function public.save_approval_workflow(p_kind text, p_steps jsonb, p_admins_can_act boolean default true)
returns public.approval_workflows
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  w public.approval_workflows;
  s jsonb;
  i int := 0;
begin
  if v_tenant is null or not public.has_any_module('settings') then
    raise exception 'Only an admin or someone with Settings can change approval workflows' using errcode = '42501';
  end if;
  if p_kind not in ('leave', 'salary_advance', 'bulk_import') then
    raise exception 'Unknown kind of approval: %', p_kind using errcode = '22023';
  end if;
  if jsonb_typeof(p_steps) is distinct from 'array' or jsonb_array_length(p_steps) not between 1 and 10 then
    raise exception 'A workflow needs between 1 and 10 steps' using errcode = '22023';
  end if;
  -- the screen picks people by employee number
  select jsonb_agg(x.value || jsonb_strip_nulls(jsonb_build_object(
           'approver_employee_id', (select e.id from public.employees e
                                    where e.tenant_id = v_tenant and e."Employee Number" = x.value ->> 'approver_employee_number'),
           'alternate_employee_id', (select e.id from public.employees e
                                     where e.tenant_id = v_tenant and e."Employee Number" = x.value ->> 'alternate_employee_number')))
         order by x.n)
  into p_steps
  from jsonb_array_elements(p_steps) with ordinality as x(value, n);
  for s in select value from jsonb_array_elements(p_steps) loop
    if s ->> 'approver_type' = 'department_head' and not public.approval_department_head_available() then
      raise exception 'Departments are not set up, so a department head cannot approve' using errcode = '22023';
    end if;
    if s ->> 'approver_type' = 'person' and not exists (
         select 1 from public.employees e where e.tenant_id = v_tenant and e.id = (s ->> 'approver_employee_id')::uuid) then
      raise exception 'Choose who approves at step %', i + 1 using errcode = '22023';
    end if;
    if s ->> 'alternate_type' = 'person' and not exists (
         select 1 from public.employees e where e.tenant_id = v_tenant and e.id = (s ->> 'alternate_employee_id')::uuid) then
      raise exception 'Choose the alternate approver at step %', i + 1 using errcode = '22023';
    end if;
    i := i + 1;
  end loop;

  w := public.approval_workflow_create(v_tenant, p_kind);
  update public.approval_workflows set admins_can_act = coalesce(p_admins_can_act, true), updated_by = auth.uid(), updated_at = now()
  where id = w.id returning * into w;
  delete from public.approval_steps where workflow_id = w.id;
  i := 0;
  for s in select value from jsonb_array_elements(p_steps) loop
    i := i + 1;
    insert into public.approval_steps (tenant_id, workflow_id, position, label, approver_type, approver_role, approver_employee_id,
                                       alternate_type, alternate_role, alternate_employee_id, skip_if_requester)
    values (v_tenant, w.id, i, nullif(btrim(s ->> 'label'), ''), s ->> 'approver_type',
            case when s ->> 'approver_type' = 'role' then upper(btrim(s ->> 'approver_role')) end,
            case when s ->> 'approver_type' = 'person' then (s ->> 'approver_employee_id')::uuid end,
            nullif(s ->> 'alternate_type', ''),
            case when s ->> 'alternate_type' = 'role' then upper(btrim(s ->> 'alternate_role')) end,
            case when s ->> 'alternate_type' = 'person' then (s ->> 'alternate_employee_id')::uuid end,
            coalesce((s ->> 'skip_if_requester')::boolean, true));
  end loop;
  return w;
end $$;
revoke all on function public.save_approval_workflow(text, jsonb, boolean) from public, anon;
grant execute on function public.save_approval_workflow(text, jsonb, boolean) to authenticated;

-- a company's workflow for the settings screen: whether admins may act, and its steps with the people's numbers and names
create or replace function public.approval_workflow(p_kind text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'kind', p_kind,
    'admins_can_act', coalesce(w.admins_can_act, true),
    'department_head_available', public.approval_department_head_available(),
    'steps', coalesce((
      select jsonb_agg(public.approval_step_json(s) || jsonb_build_object(
               'approver_employee_number', a."Employee Number", 'approver_name', public.approval_employee_name(a),
               'alternate_employee_number', b."Employee Number", 'alternate_name', public.approval_employee_name(b))
             order by s.position)
      from public.approval_steps s
      left join public.employees a on a.id = s.approver_employee_id
      left join public.employees b on b.id = s.alternate_employee_id
      where s.workflow_id = w.id), public.approval_default_steps(p_kind)))
  from (select 1) one
  left join public.approval_workflows w on w.tenant_id = public.current_tenant_id() and w.kind = p_kind
  where public.current_tenant_id() is not null
$$;
revoke all on function public.approval_workflow(text) from public, anon;
grant execute on function public.approval_workflow(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. what a decision does to the thing approved, and who hears about it
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
  'approval_needed', 'approval_progress'
));

-- "Annual Leave (3 days, 2026-11-02 to 2026-11-04)"
create or replace function public.approval_leave_text(l public.leave_application) returns text language sql stable as $$
  select coalesce(nullif(btrim(l."Leave Type"), ''), 'leave') || ' application (' || coalesce(l.days, 0) || ' day'
    || case when l.days = 1 then '' else 's' end
    || coalesce(', ' || nullif(btrim(l."Start Date"), '') || ' to ' || nullif(btrim(l."End Date"), ''), '') || ')'
$$;

-- tells the approvers of the step a request has reached (nothing while p_quiet, as when existing ones are put on it)
create or replace function public.approval_notify_step(r public.approval_requests, p_actor text) returns void
language plpgsql security definer set search_path = public as $$
declare
  step jsonb := r.steps -> (r.current_step - 1);
  l public.leave_application;
  who text;
  p public.employees;
begin
  if r.kind <> 'leave' or coalesce(current_setting('app.approval_quiet', true), '') = 'on' then
    return;
  end if;
  select * into l from public.leave_application where id = r.record_id;
  if l.id is null then
    return;
  end if;
  who := coalesce(nullif(btrim(l.name), ''), l."Employee Number");
  if step ->> 'approver_type' = 'role' then
    -- the HR bell, as when a Leave Approver recommended before (a new application already shows there)
    if p_actor is not null then
      perform public.notify_employee_number(r.tenant_id, r.requester_employee_number, 'leave_recommended',
        'Leave application recommended - awaiting final approval',
        p_actor || ' approved ' || who || '''s ' || public.approval_leave_text(l) || '. Awaiting '
        || public.approval_step_label(r.tenant_id, step) || ' approval.');
    end if;
    return;
  end if;
  for p in
    select e.* from public.employees e
    where e.tenant_id = r.tenant_id and e."Employee Number" is distinct from r.requester_employee_number
      and (e."Employee Number" in (select public.approval_step_numbers(r.tenant_id, step, r.requester_employee_number, false))
           or e."Employee Number" in (select public.approval_step_numbers(r.tenant_id, step, r.requester_employee_number, true)))
  loop
    perform public.notify_employee(p.id, 'approval_needed', 'Leave awaiting your approval',
      who || '''s ' || public.approval_leave_text(l) || ' is waiting for your approval. Open Leave to approve or reject it.');
  end loop;
end $$;

-- writes the decision on the thing approved (as the Leave page did) and tells the employee
create or replace function public.approval_apply(r public.approval_requests, p_decision text, p_final boolean,
                                                 p_by_step boolean, p_comment text, p_actor text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  l public.leave_application;
  note text := nullif(btrim(p_comment), '');
  next_label text;
begin
  if r.kind <> 'leave' then
    return;
  end if;
  perform set_config('app.approval_decision', 'on', true);
  if p_decision = 'approved' and not p_final then
    update public.leave_application set recstatus = 'recommended', recommendation_notes = note
    where id = r.record_id returning * into l;
  elsif p_decision = 'approved' then
    update public.leave_application set status = 'approved', notes = note where id = r.record_id returning * into l;
  elsif not p_final and p_by_step then
    update public.leave_application
    set status = 'rejected', notes = note, recstatus = 'not_recommended', recommendation_notes = note
    where id = r.record_id returning * into l;
  else
    update public.leave_application set status = 'rejected', notes = note where id = r.record_id returning * into l;
  end if;
  perform set_config('app.approval_decision', '', true);
  if l.id is null or coalesce(current_setting('app.approval_quiet', true), '') = 'on' then
    return;
  end if;

  if p_decision = 'approved' and not p_final then
    next_label := public.approval_step_label(r.tenant_id, r.steps -> (r.current_step - 1));
    perform public.notify_employee_number(r.tenant_id, l."Employee Number", 'approval_progress', 'Leave application moving on',
      'Your ' || public.approval_leave_text(l) || ' was approved by ' || coalesce(p_actor, 'your approver')
      || '. It is now waiting on ' || next_label || '.');
  elsif p_decision = 'approved' then
    perform public.notify_employee_number(r.tenant_id, l."Employee Number", 'leave_approved', 'Leave application approved',
      'Your ' || public.approval_leave_text(l) || ' has been approved.');
  else
    perform public.notify_employee_number(r.tenant_id, l."Employee Number", 'leave_rejected', 'Leave application rejected',
      'Your ' || public.approval_leave_text(l) || ' has been rejected.' || public.with_note('Reason', note));
  end if;
end $$;

/**
 * Moves a request on from step p_from: passes over the steps to skip (recorded as skipped), stops at the first that
 * waits for a decision and tells its approvers. Past the last step the request is approved - unless every step was
 * skipped, when nobody has approved anything yet: then an admin decides (a last step is added for them).
 */
create or replace function public.approval_advance(p_request uuid, p_from int, p_actor text) returns public.approval_requests
language plpgsql security definer set search_path = public as $$
declare
  r public.approval_requests;
  i int := p_from;
  reason text;
begin
  select * into r from public.approval_requests where id = p_request;
  loop
    if i > jsonb_array_length(r.steps) then
      if not exists (select 1 from public.approval_actions a where a.request_id = r.id and a.decision = 'approved') then
        update public.approval_requests
        set steps = steps || jsonb_build_array(jsonb_build_object(
              'label', 'Admin', 'approver_type', 'role', 'approver_role', 'ADMIN', 'approver_employee_id', null,
              'alternate_type', null, 'alternate_role', null, 'alternate_employee_id', null, 'skip_if_requester', true)),
            current_step = i
        where id = r.id returning * into r;
        return r;
      end if;
      update public.approval_requests set status = 'approved', current_step = i - 1, decided_at = now()
      where id = r.id returning * into r;
      perform public.approval_apply(r, 'approved', true, true, null, p_actor);
      return r;
    end if;
    reason := public.approval_skip_reason(r.tenant_id, r.steps -> (i - 1), r.requester_employee_number);
    exit when reason is null;
    insert into public.approval_actions (tenant_id, request_id, step, decision, comment, acted_as, actor_user_id, actor_name)
    values (r.tenant_id, r.id, i, 'skipped',
            case reason when 'requester' then 'Skipped: the approver is the person asking'
                        else 'Skipped: nobody to approve at this step' end,
            'system', null, null);
    i := i + 1;
  end loop;
  update public.approval_requests set current_step = i where id = r.id returning * into r;
  perform public.approval_notify_step(r, p_actor);
  return r;
end $$;

-- starts the approval of a new thing on its company's workflow
create or replace function public.approval_start(p_tenant uuid, p_kind text, p_record uuid, p_requester text)
returns public.approval_requests
language plpgsql security definer set search_path = public as $$
declare
  w public.approval_workflows := public.approval_workflow_create(p_tenant, p_kind);
  v_steps jsonb;
  r public.approval_requests;
begin
  select jsonb_agg(public.approval_step_json(s) order by s.position) into v_steps
  from public.approval_steps s where s.workflow_id = w.id;
  insert into public.approval_requests (tenant_id, workflow_id, kind, record_id, requester_employee_number, steps, admins_can_act)
  values (p_tenant, w.id, p_kind, p_record, p_requester, coalesce(v_steps, public.approval_default_steps(p_kind)), w.admins_can_act)
  on conflict (kind, record_id) do nothing
  returning * into r;
  if r.id is null then
    select * into r from public.approval_requests where kind = p_kind and record_id = p_record;
    return r;
  end if;
  return public.approval_advance(r.id, 1, null);
end $$;

revoke all on function public.approval_notify_step(public.approval_requests, text) from public, anon, authenticated;
revoke all on function public.approval_apply(public.approval_requests, text, boolean, boolean, text, text) from public, anon, authenticated;
revoke all on function public.approval_advance(uuid, int, text) from public, anon, authenticated;
revoke all on function public.approval_start(uuid, text, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. deciding
-- ---------------------------------------------------------------------------------------------

/**
 * The current step's approver approves or rejects (with a comment). Approving moves the request to the next step,
 * or approves the thing at the last; rejecting ends it. Returns the request as it now is.
 */
create or replace function public.decide_approval(p_request uuid, p_decision text, p_comment text default null)
returns public.approval_requests
language plpgsql security definer set search_path = public as $$
declare
  r public.approval_requests;
  step jsonb;
  how text;
  i int;
  me text := public.current_employee_number();
  actor text;
  note text := nullif(btrim(p_comment), '');
begin
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'The decision must be approved or rejected' using errcode = '22023';
  end if;
  if char_length(coalesce(note, '')) > 1000 then
    raise exception 'The comment is too long (1000 characters at most)' using errcode = '22023';
  end if;
  select * into r from public.approval_requests where id = p_request and tenant_id = public.current_tenant_id() for update;
  if r.id is null then
    raise exception 'Approval request not found' using errcode = 'P0002';
  end if;
  if r.status <> 'pending' then
    raise exception 'This request has already been %', r.status using errcode = '55000';
  end if;
  if me is not null and me = r.requester_employee_number then
    raise exception 'You cannot decide your own request' using errcode = '42501';
  end if;

  step := r.steps -> (r.current_step - 1);
  how := public.approval_acting_as(r.tenant_id, step, r.requester_employee_number, r.admins_can_act);
  if how is null and p_decision = 'rejected' then
    -- a later step's approver may turn it down early
    for i in r.current_step + 1 .. jsonb_array_length(r.steps) loop
      if public.approval_acting_as(r.tenant_id, r.steps -> (i - 1), r.requester_employee_number, false) is not null then
        how := 'later_step';
        exit;
      end if;
    end loop;
  end if;
  if how is null then
    raise exception 'You are not the approver for this step' using errcode = '42501';
  end if;

  select coalesce((select public.approval_employee_name(e) from public.employees e
                   where e.tenant_id = r.tenant_id and e."Employee Number" = me),
                  (select nullif(btrim(p.full_name), '') from public.user_profiles p where p.user_id = auth.uid()),
                  public.current_user_email())
  into actor;
  insert into public.approval_actions (tenant_id, request_id, step, decision, comment, acted_as, actor_name)
  values (r.tenant_id, r.id, r.current_step, p_decision, note, how, actor);

  if p_decision = 'rejected' then
    update public.approval_requests set status = 'rejected', decided_at = now() where id = r.id returning * into r;
    perform public.approval_apply(r, 'rejected', r.current_step = jsonb_array_length(r.steps), how <> 'later_step', note, actor);
    return r;
  end if;

  if r.current_step >= jsonb_array_length(r.steps) then
    update public.approval_requests set status = 'approved', decided_at = now() where id = r.id returning * into r;
    perform public.approval_apply(r, 'approved', true, true, note, actor);
    return r;
  end if;
  r := public.approval_advance(r.id, r.current_step + 1, actor);
  if r.status = 'pending' then
    perform public.approval_apply(r, 'approved', false, true, note, actor);
  end if;
  return r;
end $$;
revoke all on function public.decide_approval(uuid, text, text) from public, anon;
grant execute on function public.decide_approval(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. reading: the chain of each request, and what is waiting on me
-- ---------------------------------------------------------------------------------------------

-- requests the signed-in user may decide now, or has decided (so they can see them)
create or replace function public.approval_request_ids_for_me() returns setof uuid
language sql stable security definer set search_path = public as $$
  select r.id from public.approval_requests r
  where r.tenant_id = public.current_tenant_id() and r.status = 'pending'
    and r.requester_employee_number is distinct from public.current_employee_number()
    and public.approval_acting_as(r.tenant_id, r.steps -> (r.current_step - 1), r.requester_employee_number, r.admins_can_act) is not null
  union
  select a.request_id from public.approval_actions a
  where a.tenant_id = public.current_tenant_id() and a.actor_user_id = auth.uid()
$$;
revoke all on function public.approval_request_ids_for_me() from public, anon;
grant execute on function public.approval_request_ids_for_me() to authenticated;

/**
 * Each request's chain, for the Leave page and the staff portal: per step its label, status (approved, rejected,
 * skipped, current, upcoming), who it is waiting on, and who decided it with what comment; and whether the signed-in
 * user may approve or reject now. Only the requests the caller may see: their own, the ones they decide, and all of a
 * kind for people with its module.
 */
create or replace function public.approval_chains(p_kind text, p_record_ids uuid[])
returns table (record_id uuid, request_id uuid, status text, current_step int, can_approve boolean, can_reject boolean, steps jsonb)
language sql stable security definer set search_path = public as $$
  with visible as (
    select r.* from public.approval_requests r
    where r.tenant_id = public.current_tenant_id() and r.kind = p_kind and r.record_id = any(p_record_ids)
      and ((p_kind = 'leave' and public.has_any_module('leaves'))
           or r.requester_employee_number = public.current_employee_number()
           or r.id in (select public.approval_request_ids_for_me()))
  ), mine as (
    select v.id, case when v.status = 'pending' and v.requester_employee_number is distinct from public.current_employee_number()
                      then public.approval_acting_as(v.tenant_id, v.steps -> (v.current_step - 1), v.requester_employee_number, v.admins_can_act)
                 end as how,
           v.status = 'pending' and v.requester_employee_number is distinct from public.current_employee_number() and exists (
             select 1 from generate_series(v.current_step + 1, jsonb_array_length(v.steps)) g
             where public.approval_acting_as(v.tenant_id, v.steps -> (g - 1), v.requester_employee_number, false) is not null
           ) as later
    from visible v
  )
  select v.record_id, v.id, v.status, v.current_step::int, m.how is not null, m.how is not null or m.later,
    (select jsonb_agg(jsonb_build_object(
        'position', s.n,
        'label', public.approval_step_label(v.tenant_id, s.step),
        'approver_type', s.step ->> 'approver_type',
        'status', coalesce(a.decision, case when v.status = 'pending' and s.n = v.current_step then 'current'
                                            when v.status = 'pending' then 'upcoming' else 'not_reached' end),
        'waiting_on', case when v.status = 'pending' and s.n = v.current_step
                           then public.approval_waiting_on(v.tenant_id, s.step, v.requester_employee_number) end,
        'actor_name', a.actor_name, 'acted_as', a.acted_as, 'comment', a.comment, 'acted_at', a.created_at
      ) order by s.n)
     from jsonb_array_elements(v.steps) with ordinality as s(step, n)
     left join lateral (
       select x.* from public.approval_actions x where x.request_id = v.id and x.step = s.n order by x.id desc limit 1
     ) a on true)
  from visible v join mine m on m.id = v.id
$$;
revoke all on function public.approval_chains(text, uuid[]) from public, anon;
grant execute on function public.approval_chains(text, uuid[]) to authenticated;

-- leave waiting on the signed-in user (as an approver or alternate, not just as an admin), for the staff portal
create or replace function public.my_leave_approvals()
returns table (request_id uuid, record_id uuid, employee_number text, name text, leave_type text, start_date text,
               end_date text, days bigint, reason text, step_label text, time_added timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, l.id, l."Employee Number", l.name, l."Leave Type", l."Start Date", l."End Date", l.days, l.reason,
         public.approval_step_label(r.tenant_id, r.steps -> (r.current_step - 1)), l.time_added
  from public.approval_requests r
  join public.leave_application l on l.id = r.record_id and l.tenant_id = r.tenant_id
  where r.tenant_id = public.current_tenant_id() and r.kind = 'leave' and r.status = 'pending'
    and r.requester_employee_number is distinct from public.current_employee_number()
    and public.approval_acting_as(r.tenant_id, r.steps -> (r.current_step - 1), r.requester_employee_number, false) is not null
  order by l.time_added
$$;
revoke all on function public.my_leave_approvals() from public, anon;
grant execute on function public.my_leave_approvals() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. access
-- ---------------------------------------------------------------------------------------------
alter table public.approval_workflows enable row level security;
alter table public.approval_steps enable row level security;
alter table public.approval_requests enable row level security;
alter table public.approval_actions enable row level security;

drop policy if exists tenant_isolation on public.approval_workflows;
create policy tenant_isolation on public.approval_workflows as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists tenant_isolation on public.approval_steps;
create policy tenant_isolation on public.approval_steps as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists tenant_isolation on public.approval_requests;
create policy tenant_isolation on public.approval_requests as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists tenant_isolation on public.approval_actions;
create policy tenant_isolation on public.approval_actions as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));

-- everyone in the company reads the workflows (the Leave page and the portal show the chain); they change through
-- save_approval_workflow only
drop policy if exists members_read on public.approval_workflows;
create policy members_read on public.approval_workflows for select to authenticated using (true);
drop policy if exists members_read on public.approval_steps;
create policy members_read on public.approval_steps for select to authenticated using (true);

-- requests and their decisions: people with the module, the employee asking, and their approvers; written by the
-- functions above only
drop policy if exists involved_read on public.approval_requests;
create policy involved_read on public.approval_requests for select to authenticated using (
  (kind = 'leave' and (select public.has_any_module('leaves')))
  or requester_employee_number = (select public.current_employee_number())
  or id in (select public.approval_request_ids_for_me())
);
drop policy if exists involved_read on public.approval_actions;
create policy involved_read on public.approval_actions for select to authenticated using (
  request_id in (select r.id from public.approval_requests r)
);

-- (no insert, update or delete policies: nobody writes them directly)
revoke all on public.approval_workflows, public.approval_steps, public.approval_requests, public.approval_actions from anon;

-- ---------------------------------------------------------------------------------------------
-- 8. leave applications go through it
-- ---------------------------------------------------------------------------------------------

-- a new pending application starts on its company's leave workflow (one made already decided, e.g. leave HR
-- schedules, does not)
create or replace function public.leave_application_start_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if lower(coalesce(new.status, 'pending')) = 'pending' then
    perform public.approval_start(new.tenant_id, 'leave', new.id, new."Employee Number");
  end if;
  return null;
end $$;
drop trigger if exists leave_application_start_approval on public.leave_application;
create trigger leave_application_start_approval after insert on public.leave_application
  for each row execute function public.leave_application_start_approval();

-- while its approval is pending, an application's decision fields change through decide_approval only
create or replace function public.leave_application_guard_decision() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.approval_decision', true), '') <> 'on'
     and (new.status is distinct from old.status or new.recstatus is distinct from old.recstatus
          or new.recommendation_notes is distinct from old.recommendation_notes)
     and exists (select 1 from public.approval_requests r
                 where r.kind = 'leave' and r.record_id = old.id and r.status = 'pending') then
    raise exception 'This leave application is waiting on its approvers: approve or reject it through its approval chain'
      using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists leave_application_guard_decision on public.leave_application;
create trigger leave_application_guard_decision before update on public.leave_application
  for each row execute function public.leave_application_guard_decision();

-- the request follows the application's employee number (it cascades from employees) and goes when it goes
create or replace function public.leave_application_sync_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    delete from public.approval_requests where kind = 'leave' and record_id = old.id;
  elsif new."Employee Number" is distinct from old."Employee Number" then
    update public.approval_requests set requester_employee_number = new."Employee Number"
    where kind = 'leave' and record_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists leave_application_sync_approval on public.leave_application;
create trigger leave_application_sync_approval after update of "Employee Number" or delete on public.leave_application
  for each row execute function public.leave_application_sync_approval();

-- pending applications made before workflows: on the default workflow at the step they reached - recommended ones at
-- step 2 (the recommendation recorded as step 1's approval) - without notifying anyone
do $$
declare
  l public.leave_application;
  w public.approval_workflows;
  r public.approval_requests;
begin
  perform set_config('app.approval_quiet', 'on', true);
  for l in
    select a.* from public.leave_application a
    where lower(coalesce(a.status, 'pending')) = 'pending'
      and not exists (select 1 from public.approval_requests x where x.kind = 'leave' and x.record_id = a.id)
  loop
    w := public.approval_workflow_create(l.tenant_id, 'leave');
    insert into public.approval_requests (tenant_id, workflow_id, kind, record_id, requester_employee_number, steps, admins_can_act)
    values (l.tenant_id, w.id, 'leave', l.id, l."Employee Number", public.approval_default_steps('leave'), true)
    returning * into r;
    if l.recstatus = 'recommended' then
      insert into public.approval_actions (tenant_id, request_id, step, decision, comment, acted_as, actor_user_id, actor_name)
      values (l.tenant_id, r.id, 1, 'approved', l.recommendation_notes, 'system', null, 'Recommended before approval workflows');
      perform public.approval_advance(r.id, 2, null);
    else
      perform public.approval_advance(r.id, 1, null);
    end if;
  end loop;
  perform set_config('app.approval_quiet', '', true);
end $$;

notify pgrst, 'reload schema';
