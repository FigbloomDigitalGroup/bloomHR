-- Approval chains for money (FIG-1210): loans, salary advances, expense claims and requisitions go through the
-- approval workflows each company sets up (Settings > Approval workflows), as leave does.
--
-- Until now each was approved in one step on its own screen. Now:
--   * The kinds 'loan', 'expense' and 'requisition' join 'leave', 'salary_advance' and 'bulk_import'.
--   * A step's approver may be "anyone with a module" (approver_type 'module', approval_steps.approver_module): the
--     people whose role holds it, e.g. 'loans' ("Staff loans"). Each money kind's default chain is one such step, the
--     people who approved it before, so nothing changes until a company edits its chain:
--       loan -> loans, salary_advance -> salaryadmin, expense -> expenses, requisition -> requisitions.
--     A company can then make it, say, "line manager, then anyone with Staff loans, then the finance director".
--   * A new request (a loan 'requested', an advance or expense 'pending', a requisition 'pending') starts on its
--     company's chain. One HR enters already approved (a loan HR sets up, a requisition approved as it is raised)
--     stays approved only when the chain is a single step they may decide; otherwise it starts on the chain too.
--   * decide_approval is the only way to decide one while it is on its chain. Each step's approvers are told
--     ('approval_needed', in their bell and by email); after an earlier step the employee hears it moved on
--     ('approval_progress'). The last approval writes the item's approval as its screen did, and a rejection (a reason
--     is needed) its rejection: the item's own notifications follow, and an approved item joins Payments to make
--     (20261025400000). Changing an item's decision directly while its chain is pending is refused; withdrawing or
--     cancelling it ends the chain.
--   * Who sees the chains: the people with the kind's module (approval_kind_modules), the employee asking and the
--     approvers - as for leave.
--   * The creation alerts 'loan_requested' and 'requisition_requested' are no longer sent: the chain's
--     'approval_needed' replaces them (it reached the same people when the chain is the default, and the right
--     people when it isn't).
--   * Items waiting for a decision when this runs are put on the default chain quietly.

-- ---------------------------------------------------------------------------------------------
-- 1. the kinds, and who sees each
-- ---------------------------------------------------------------------------------------------
create or replace function public.approval_kind_list() returns text[] language sql immutable as $$
  select array['leave', 'salary_advance', 'bulk_import', 'loan', 'expense', 'requisition']
$$;

-- the modules whose holders see every request of a kind (and its chain)
create or replace function public.approval_kind_modules(p_kind text) returns text[] language sql immutable as $$
  select case p_kind
    when 'leave' then array['leaves']
    when 'salary_advance' then array['salaryadmin']
    when 'loan' then array['loans', 'payroll']
    when 'expense' then array['expenses']
    when 'requisition' then array['requisitions', 'payments']
    else array[]::text[]
  end
$$;

alter table public.approval_workflows drop constraint if exists approval_workflows_kind_check;
alter table public.approval_workflows add constraint approval_workflows_kind_check check (kind = any (public.approval_kind_list()));
alter table public.approval_requests drop constraint if exists approval_requests_kind_check;
alter table public.approval_requests add constraint approval_requests_kind_check check (kind = any (public.approval_kind_list()));

-- ---------------------------------------------------------------------------------------------
-- 2. "anyone with a module" as an approver
-- ---------------------------------------------------------------------------------------------
alter table public.approval_steps add column if not exists approver_module text
  check (approver_module is null or approver_module ~ '^[a-z][a-z0-9-]{0,39}$');
alter table public.approval_steps drop constraint if exists approval_steps_approver_type_check;
alter table public.approval_steps add constraint approval_steps_approver_type_check
  check (approver_type in ('leave_approver', 'reports_to', 'department_head', 'role', 'person', 'module'));
alter table public.approval_steps drop constraint if exists approval_steps_module_check;
alter table public.approval_steps add constraint approval_steps_module_check check (approver_type <> 'module' or approver_module is not null);

-- (20261015800000's, with the module)
create or replace function public.approval_step_json(s public.approval_steps) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'label', s.label, 'approver_type', s.approver_type, 'approver_role', s.approver_role, 'approver_module', s.approver_module,
    'approver_employee_id', s.approver_employee_id, 'alternate_type', s.alternate_type, 'alternate_role', s.alternate_role,
    'alternate_employee_id', s.alternate_employee_id, 'skip_if_requester', s.skip_if_requester)
$$;

-- what approval_people looks up for a step: its module for a module step, else its role
create or replace function public.approval_step_who(p_step jsonb) returns text language sql immutable as $$
  select case when p_step ->> 'approver_type' = 'module' then p_step ->> 'approver_module' else p_step ->> 'approver_role' end
$$;

-- (20261022100000's, plus 'module': the employees whose login's role holds it; administrators hold every module but
-- are not listed - they act as admins, when the workflow lets them)
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
    -- the Reports to person, and whoever the old manager email names
    return query select e.* from public.employees e
      where e.tenant_id = p_tenant
        and (e.id = r.reports_to_id or lower(btrim(e."Work Email")) = lower(btrim(r.manager_email)));
  elsif p_type = 'person' then
    return query select e.* from public.employees e where e.tenant_id = p_tenant and e.id = p_employee;
  elsif p_type = 'role' then
    return query select e.* from public.employees e
      where e.tenant_id = p_tenant and lower(btrim(e."Work Email")) in (
        select lower(u.email) from auth.users u
        where u.id in (select m.user_id from public.memberships m where m.tenant_id = p_tenant and m.role = p_role
                       union
                       select p.user_id from public.user_profiles p where p.tenant_id = p_tenant and p.role = p_role));
  elsif p_type = 'module' then
    return query select e.* from public.employees e
      where e.tenant_id = p_tenant and lower(btrim(e."Work Email")) in (
        select lower(btrim(coalesce(nullif(btrim(u.email), ''), p.email)))
        from public.memberships m
        left join auth.users u on u.id = m.user_id
        left join public.user_profiles p on p.user_id = m.user_id
        where m.tenant_id = p_tenant and m.account_status = 'ACTIVE' and m.role <> 'ADMIN'
          and p_role = any (public.role_modules(p_tenant, m.role, m.company_role_id)));
  elsif p_type = 'department_head' and public.approval_department_head_available() then
    -- the org structure is not part of this migration: read it only where it exists
    return query execute
      'select h.* from public.employees r join public.departments d on d.id = r.department_id
         join public.employees h on h.id = d.head_employee_id
       where r.tenant_id = $1 and r."Employee Number" = $2 and h.tenant_id = $1'
      using p_tenant, p_requester;
  end if;
end $$;

-- (20261022100000's; a module step, like a role step, always has someone)
create or replace function public.approval_has_assignee(p_tenant uuid, p_step jsonb, p_requester text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_step ->> 'approver_type'
    when 'leave_approver' then exists (select 1 from public.employees r where r.tenant_id = p_tenant
      and r."Employee Number" = p_requester and coalesce(btrim(r."Leave Approver"), '') <> '')
    when 'reports_to' then exists (select 1 from public.employees r where r.tenant_id = p_tenant
      and r."Employee Number" = p_requester and (r.reports_to_id is not null or coalesce(btrim(r.manager_email), '') <> ''))
    when 'role' then true
    when 'module' then true
    else exists (select 1 from public.approval_people(p_tenant, p_step ->> 'approver_type', public.approval_step_who(p_step),
                   (p_step ->> 'approver_employee_id')::uuid, p_requester))
  end
$$;

-- (20261015800000's, looking up a module step's module)
create or replace function public.approval_step_numbers(p_tenant uuid, p_step jsonb, p_requester text, p_alternates boolean)
returns setof text
language sql stable security definer set search_path = public as $$
  select p."Employee Number" from public.approval_people(p_tenant, p_step ->> 'approver_type', public.approval_step_who(p_step),
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

-- (20261022100000's, plus a module step: the signed-in user's role holds the module; an administrator acts as admin)
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
  elsif p_step ->> 'approver_type' = 'module' then
    if my_role is distinct from 'ADMIN' and coalesce(public.has_module(p_step ->> 'approver_module'), false) then
      return 'approver';
    end if;
  elsif p_step ->> 'approver_type' = 'reports_to' then
    -- the Reports to person, or the manager found by their login's email, as supervises() does (they need no
    -- employee record)
    if exists (select 1 from public.employees r where r.tenant_id = p_tenant and r."Employee Number" = p_requester
               and (lower(btrim(r.manager_email)) = lower(public.current_user_email())
                    or r.reports_to_id = public.current_employee_id())) then
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

-- (20261022100000's; a module step, like a role step, always waits)
create or replace function public.approval_skip_reason(p_tenant uuid, p_step jsonb, p_requester text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  main text[];
  alternates text[];
begin
  if p_step ->> 'approver_type' in ('role', 'module') then
    return null;
  end if;
  -- the usual case, quickly: nobody typed in at all
  if p_step ->> 'alternate_type' is null and p_step ->> 'approver_type' in ('leave_approver', 'reports_to') and not exists (
       select 1 from public.employees r where r.tenant_id = p_tenant and r."Employee Number" = p_requester
         and (case when p_step ->> 'approver_type' = 'leave_approver'
                   then coalesce(btrim(r."Leave Approver"), '') <> '' or coalesce(btrim(r."Alternate Approver"), '') <> ''
                   else r.reports_to_id is not null or coalesce(btrim(r.manager_email), '') <> '' end)) then
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

-- the module's name as the Roles screen shows it ("Staff loans")
create or replace function public.approval_module_name(p_module text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(btrim(p.module_name), '') from public.permissions p where p.module_id = p_module), p_module)
$$;

-- (20261015800000's, plus a module step: the module's name)
create or replace function public.approval_step_label(p_tenant uuid, p_step jsonb) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(p_step ->> 'label'), ''), case p_step ->> 'approver_type'
    when 'leave_approver' then 'Leave approver'
    when 'reports_to' then 'Line manager'
    when 'department_head' then 'Department head'
    when 'role' then p_step ->> 'approver_role'
    when 'module' then public.approval_module_name(p_step ->> 'approver_module')
    when 'person' then (select public.approval_employee_name(e) from public.employees e
                        where e.tenant_id = p_tenant and e.id = (p_step ->> 'approver_employee_id')::uuid)
  end, 'Approver')
$$;

-- (20261015800000's, plus a module step: "anyone with Staff loans")
create or replace function public.approval_waiting_on(p_tenant uuid, p_step jsonb, p_requester text) returns text
language sql stable security definer set search_path = public as $$
  select nullif(concat_ws(' or ',
    case when p_step ->> 'approver_type' = 'role' then p_step ->> 'approver_role'
         when p_step ->> 'approver_type' = 'module' then 'anyone with ' || public.approval_module_name(p_step ->> 'approver_module')
         else coalesce(
           (select string_agg(public.approval_employee_name(p), ', ' order by p."First Name")
            from public.approval_people(p_tenant, p_step ->> 'approver_type', public.approval_step_who(p_step),
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

revoke all on function public.approval_step_who(jsonb) from public, anon, authenticated;
revoke all on function public.approval_people(uuid, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.approval_has_assignee(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.approval_step_numbers(uuid, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public.approval_acting_as(uuid, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public.approval_skip_reason(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.approval_step_label(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.approval_waiting_on(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.approval_module_name(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. the chains: today's by default, saved on Settings > Approval workflows
-- ---------------------------------------------------------------------------------------------
create or replace function public.approval_default_steps(p_kind text) returns jsonb language sql immutable as $$
  select case
    when p_kind = 'leave' then jsonb_build_array(
      jsonb_build_object('label', null, 'approver_type', 'leave_approver', 'approver_role', null, 'approver_module', null,
                         'approver_employee_id', null, 'alternate_type', null, 'alternate_role', null,
                         'alternate_employee_id', null, 'skip_if_requester', true),
      jsonb_build_object('label', null, 'approver_type', 'role', 'approver_role', 'HR', 'approver_module', null,
                         'approver_employee_id', null, 'alternate_type', null, 'alternate_role', null,
                         'alternate_employee_id', null, 'skip_if_requester', true))
    -- money: the people who approved it on its own screen
    when p_kind in ('salary_advance', 'loan', 'expense', 'requisition') then jsonb_build_array(
      jsonb_build_object('label', null, 'approver_type', 'module', 'approver_role', null,
                         'approver_module', case p_kind when 'salary_advance' then 'salaryadmin' when 'loan' then 'loans'
                                                        when 'expense' then 'expenses' else 'requisitions' end,
                         'approver_employee_id', null, 'alternate_type', null, 'alternate_role', null,
                         'alternate_employee_id', null, 'skip_if_requester', true))
    else jsonb_build_array(
      jsonb_build_object('label', null, 'approver_type', 'role', 'approver_role', 'HR', 'approver_module', null,
                         'approver_employee_id', null, 'alternate_type', null, 'alternate_role', null,
                         'alternate_employee_id', null, 'skip_if_requester', true))
  end
$$;

-- (20261015800000's, keeping a default step's module)
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
    insert into public.approval_steps (tenant_id, workflow_id, position, approver_type, approver_role, approver_module, skip_if_requester)
    values (p_tenant, w.id, i, s ->> 'approver_type', s ->> 'approver_role', s ->> 'approver_module', true);
  end loop;
  return w;
end $$;
revoke all on function public.approval_workflow_create(uuid, text) from public, anon, authenticated;

-- (20261015800000's, with every kind and module steps; the four-argument one of 20261017500000 calls it)
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
  if p_kind is null or not (p_kind = any (public.approval_kind_list())) then
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
    if s ->> 'approver_type' = 'module' and not exists (
         select 1 from public.permissions p where p.module_id = s ->> 'approver_module') then
      raise exception 'Choose what the approvers at step % can do', i + 1 using errcode = '22023';
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
    insert into public.approval_steps (tenant_id, workflow_id, position, label, approver_type, approver_role, approver_module,
                                       approver_employee_id, alternate_type, alternate_role, alternate_employee_id, skip_if_requester)
    values (v_tenant, w.id, i, nullif(btrim(s ->> 'label'), ''), s ->> 'approver_type',
            case when s ->> 'approver_type' = 'role' then upper(btrim(s ->> 'approver_role')) end,
            case when s ->> 'approver_type' = 'module' then btrim(s ->> 'approver_module') end,
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

-- (20261018800000's, for every kind)
create or replace function public.my_approval_chain(p_kind text default 'leave') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  me text := public.current_employee_number();
  w public.approval_workflows;
  v_steps jsonb;
  s jsonb;
  n int;
  reason text;
  goes jsonb := '[]'::jsonb;
  passed jsonb := '[]'::jsonb;
  fallback boolean := false;
begin
  if v_tenant is null then
    return null;
  end if;
  if p_kind is null or not (p_kind = any (public.approval_kind_list())) then
    raise exception 'Unknown kind of request: %', p_kind using errcode = '22023';
  end if;

  -- the company's workflow as a new request would copy it (today's default when it has none yet)
  select * into w from public.approval_workflows where tenant_id = v_tenant and kind = p_kind;
  if w.id is not null then
    select jsonb_agg(public.approval_step_json(st) order by st.position) into v_steps
    from public.approval_steps st where st.workflow_id = w.id;
  end if;
  v_steps := coalesce(v_steps, public.approval_default_steps(p_kind));

  for s, n in select e.value, e.ord::int from jsonb_array_elements(v_steps) with ordinality as e(value, ord) loop
    reason := public.approval_skip_reason(v_tenant, s, me);
    if reason is null then
      goes := goes || jsonb_build_array(jsonb_build_object(
        'position', n,
        'label', public.approval_step_label(v_tenant, s),
        'approver_type', s ->> 'approver_type',
        'approver_role', s ->> 'approver_role',
        'who', public.approval_waiting_on(v_tenant, s, me)));
    else
      passed := passed || jsonb_build_array(jsonb_build_object(
        'position', n,
        'label', public.approval_step_label(v_tenant, s),
        'approver_type', s ->> 'approver_type',
        'reason', reason));
    end if;
  end loop;

  -- every step passed over: approval_advance hands it to an admin rather than approving it by itself
  if jsonb_array_length(goes) = 0 then
    fallback := true;
    goes := jsonb_build_array(jsonb_build_object(
      'position', jsonb_array_length(v_steps) + 1, 'label', 'Admin', 'approver_type', 'role', 'approver_role', 'ADMIN',
      'who', 'ADMIN'));
  end if;

  return jsonb_build_object(
    'kind', p_kind,
    'has_employee_record', me is not null,
    'steps', goes,
    'skipped', passed,
    'also_told', to_jsonb(coalesce(w.notify_roles, '{}'::text[])),
    'admin_fallback', fallback);
end $$;
revoke all on function public.my_approval_chain(text) from public, anon;
grant execute on function public.my_approval_chain(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. what a money request is, in words
-- ---------------------------------------------------------------------------------------------
-- "Loan request", "Salary advance", "Expense claim", "Requisition"
create or replace function public.approval_kind_noun(p_kind text) returns text language sql immutable as $$
  select case p_kind when 'loan' then 'Loan request' when 'salary_advance' then 'Salary advance'
                     when 'expense' then 'Expense claim' when 'requisition' then 'Requisition'
                     when 'leave' then 'Leave application' else initcap(replace(p_kind, '_', ' ')) end
$$;

-- "Jane Doe's loan request of KES 30,000.00 over 6 months"
create or replace function public.approval_money_text(p_kind text, p_record uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v text;
begin
  if p_kind = 'loan' then
    select public.employee_display_name(l.tenant_id, l.employee_number) || '''s ' || lower(coalesce(l.product_name, 'loan'))
           || ' request of ' || public.kes(l.principal) || ' over ' || l.months || ' months' into v
    from public.employee_loans l where l.id = p_record;
  elsif p_kind = 'salary_advance' then
    select coalesce(nullif(btrim(a."Full Name"), ''), public.employee_display_name(a.tenant_id, a."Employee Number"))
           || '''s salary advance of ' || public.kes(coalesce(a.admin_adjusted_amount, a."Amount Requested")) into v
    from public.salary_advance a where a.id = p_record;
  elsif p_kind = 'expense' then
    select coalesce(nullif(btrim(x.employee_full_name), ''), public.employee_display_name(x.tenant_id, x.employee_id))
           || '''s expense claim of ' || public.kes(x.amount) || coalesce(' (' || nullif(btrim(x.title), '') || ')', '') into v
    from public.expenses x where x.id = p_record;
  elsif p_kind = 'requisition' then
    select coalesce(public.employee_display_name(q.tenant_id, q.requested_by), 'A') || '''s requisition of '
           || public.kes(q.amount) || ' to ' || q.payee_name || ' for ' || btrim(q.purpose) into v
    from public.requisitions q where q.id = p_record;
  end if;
  return coalesce(v, 'A ' || lower(public.approval_kind_noun(p_kind)));
end $$;
revoke all on function public.approval_money_text(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. telling each step's approvers, and writing the decision on the item
-- ---------------------------------------------------------------------------------------------
-- (20261015800000's for leave; money: every approver of the step with an employee record, in their bell and by email)
create or replace function public.approval_notify_step(r public.approval_requests, p_actor text) returns void
language plpgsql security definer set search_path = public as $$
declare
  step jsonb := r.steps -> (r.current_step - 1);
  l public.leave_application;
  who text;
  what text;
  p public.employees;
begin
  if coalesce(current_setting('app.approval_quiet', true), '') = 'on' then
    return;
  end if;
  if r.kind in ('loan', 'salary_advance', 'expense', 'requisition') then
    what := public.approval_money_text(r.kind, r.record_id);
    for p in
      select e.* from public.employees e
      where e.tenant_id = r.tenant_id and e."Employee Number" is distinct from r.requester_employee_number
        and (e."Employee Number" in (select public.approval_step_numbers(r.tenant_id, step, r.requester_employee_number, false))
             or e."Employee Number" in (select public.approval_step_numbers(r.tenant_id, step, r.requester_employee_number, true)))
    loop
      perform public.notify_employee(p.id, 'approval_needed', public.approval_kind_noun(r.kind) || ' awaiting your approval',
        what || ' is waiting for your approval' || coalesce(' (' || p_actor || ' approved the step before)', '') || '.');
    end loop;
    return;
  end if;
  if r.kind <> 'leave' then
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

-- the decision on a money item, as its screen wrote it (the item's own notifications and Payments to make follow)
create or replace function public.approval_apply_money(r public.approval_requests, p_approved boolean, p_note text, p_actor text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_email text := public.current_user_email();
begin
  perform set_config('app.approval_decision', 'on', true);
  if r.kind = 'loan' then
    update public.employee_loans
    set status = case when p_approved then 'approved' else 'rejected' end,
        decision_comment = coalesce(p_note, decision_comment)
    where id = r.record_id and status = 'requested';
  elsif r.kind = 'salary_advance' then
    if p_approved then
      update public.salary_advance
      set status = 'approved', admin_approval = 'true', admin_approval_date = now(), approved_by = auth.uid()::text,
          approved_by_email = v_email, admin_notes = coalesce(p_note, admin_notes), last_updated = now()
      where id = r.record_id;
    else
      update public.salary_advance
      set status = 'rejected', admin_approval = 'false', admin_notes = p_note, admin_rejection_date = now(),
          rejected_by = auth.uid()::text, rejected_by_email = v_email, last_updated = now()
      where id = r.record_id;
    end if;
  elsif r.kind = 'expense' then
    if p_approved then
      update public.expenses set status = 'approved', approved_by = coalesce(p_actor, v_email), approved_date = current_date
      where id = r.record_id;
    else
      update public.expenses set status = 'rejected', rejection_reason = p_note where id = r.record_id;
    end if;
  elsif r.kind = 'requisition' then
    update public.requisitions
    set status = case when p_approved then 'approved' else 'rejected' end, decision_comment = coalesce(p_note, decision_comment)
    where id = r.record_id and status = 'pending';
  end if;
  perform set_config('app.approval_decision', '', true);
end $$;
revoke all on function public.approval_apply_money(public.approval_requests, boolean, text, text) from public, anon, authenticated;

-- (20261015800000's for leave; money: the last approval or a rejection is written on the item, an earlier approval
-- tells the employee it moved on)
create or replace function public.approval_apply(r public.approval_requests, p_decision text, p_final boolean,
                                                 p_by_step boolean, p_comment text, p_actor text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  l public.leave_application;
  note text := nullif(btrim(p_comment), '');
  next_label text;
begin
  if r.kind in ('loan', 'salary_advance', 'expense', 'requisition') then
    if p_decision = 'approved' and not p_final then
      if coalesce(current_setting('app.approval_quiet', true), '') <> 'on' and r.requester_employee_number is not null then
        next_label := public.approval_step_label(r.tenant_id, r.steps -> (r.current_step - 1));
        perform public.notify_employee_number(r.tenant_id, r.requester_employee_number, 'approval_progress',
          public.approval_kind_noun(r.kind) || ' moving on',
          'Your ' || lower(public.approval_kind_noun(r.kind)) || ' was approved by ' || coalesce(p_actor, 'your approver')
          || '. It is now waiting on ' || next_label || '.');
      end if;
    else
      perform public.approval_apply_money(r, p_decision = 'approved', note, p_actor);
    end if;
    return;
  end if;
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

revoke all on function public.approval_notify_step(public.approval_requests, text) from public, anon, authenticated;
revoke all on function public.approval_apply(public.approval_requests, text, boolean, boolean, text, text) from public, anon, authenticated;

-- (20261017500000's, saying what was decided for every kind, not "Leave approved")
create or replace function public.approval_notify_roles_on_decision() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  l public.leave_application;
  who text;
  what text;
  by_whom text;
  p public.employees;
  r text;
  told uuid[] := '{}';
  me text := public.current_employee_number();
begin
  if new.status = old.status or new.status not in ('approved', 'rejected') or cardinality(new.notify_roles) = 0
     or coalesce(current_setting('app.approval_quiet', true), '') = 'on' then
    return null;
  end if;
  if new.kind = 'leave' then
    select * into l from public.leave_application where id = new.record_id;
    if l.id is null then
      return null;
    end if;
    who := coalesce(nullif(btrim(l.name), ''), l."Employee Number");
    what := who || '''s ' || public.approval_leave_text(l);
  elsif new.kind in ('loan', 'salary_advance', 'expense', 'requisition') then
    what := public.approval_money_text(new.kind, new.record_id);
  else
    what := 'A ' || replace(new.kind, '_', ' ') || ' request';
  end if;
  select a.actor_name into by_whom from public.approval_actions a
  where a.request_id = new.id and a.decision in ('approved', 'rejected') order by a.created_at desc, a.id desc limit 1;

  foreach r in array new.notify_roles loop
    for p in select * from public.approval_people(new.tenant_id, 'role', r, null, new.requester_employee_number) loop
      if p.id = any(told) or p."Employee Number" is not distinct from new.requester_employee_number
         or p."Employee Number" is not distinct from me then
        continue;
      end if;
      told := told || p.id;
      perform public.notify_employee(p.id, 'approval_progress',
        case when new.kind = 'leave' then 'Leave' else public.approval_kind_noun(new.kind) end
          || case when new.status = 'approved' then ' approved' else ' rejected' end,
        what || ' was ' || new.status || coalesce(' by ' || nullif(btrim(by_whom), ''), '') || '.');
    end loop;
  end loop;
  return null;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6. who sees the chains, and what waits on me
-- ---------------------------------------------------------------------------------------------
-- (20261023000000's, with each kind's module instead of leave's only)
drop function if exists public.approval_chains(text, uuid[]);
create or replace function public.approval_chains(p_kind text, p_record_ids uuid[])
returns table (record_id uuid, request_id uuid, status text, current_step int, can_approve boolean, can_reject boolean,
               steps jsonb, can_reopen boolean, reopened jsonb)
language sql stable security definer set search_path = public as $$
  with visible as (
    select r.*, public.approval_round_start(r.id) as since from public.approval_requests r
    where r.tenant_id = public.current_tenant_id() and r.kind = p_kind and r.record_id = any(p_record_ids)
      and (public.has_any_module(variadic public.approval_kind_modules(p_kind))
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
       select x.* from public.approval_actions x
       where x.request_id = v.id and x.step = s.n and x.id > v.since order by x.id desc limit 1
     ) a on true),
    v.status = 'approved' and v.kind = 'leave'
      and public.leave_reopen_refusal((select r from public.approval_requests r where r.id = v.id)) is null,
    (select jsonb_build_object('actor_name', x.actor_name, 'acted_as', x.acted_as, 'comment', x.comment, 'acted_at', x.created_at)
     from public.approval_actions x where x.id = v.since)
  from visible v join mine m on m.id = v.id
$$;
revoke all on function public.approval_chains(text, uuid[]) from public, anon;
grant execute on function public.approval_chains(text, uuid[]) to authenticated;

drop policy if exists involved_read on public.approval_requests;
create policy involved_read on public.approval_requests for select to authenticated using (
  (select public.has_any_module(variadic public.approval_kind_modules(kind)))
  or requester_employee_number = (select public.current_employee_number())
  or id in (select public.approval_request_ids_for_me())
);

-- the money requests waiting on the signed-in user's decision (as an approver or alternate, not just as an admin): for
-- the staff portal's Approvals and anyone deciding outside the item's own screen
create or replace function public.my_money_approvals()
returns table (request_id uuid, kind text, record_id uuid, employee_number text, summary text, step_label text,
               created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.kind, r.record_id, r.requester_employee_number, public.approval_money_text(r.kind, r.record_id),
         public.approval_step_label(r.tenant_id, r.steps -> (r.current_step - 1)), r.created_at
  from public.approval_requests r
  where r.tenant_id = public.current_tenant_id() and r.status = 'pending'
    and r.kind in ('loan', 'salary_advance', 'expense', 'requisition')
    and r.requester_employee_number is distinct from public.current_employee_number()
    and public.approval_acting_as(r.tenant_id, r.steps -> (r.current_step - 1), r.requester_employee_number, false) is not null
  order by r.created_at
$$;
revoke all on function public.my_money_approvals() from public, anon;
grant execute on function public.my_money_approvals() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. the items: a new request starts on its chain; its decision changes through the chain only
-- ---------------------------------------------------------------------------------------------
-- the approval writes the decision as whoever decides, who need not manage loans or requisitions themselves
create or replace function public.manages_loans() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.has_any_module('loans', 'payroll'), false)
      or coalesce(current_setting('figbloom.payment_record', true), '') = 'on'
      or coalesce(current_setting('app.approval_decision', true), '') = 'on'
$$;

create or replace function public.approves_requisitions() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.has_module('requisitions'), false)
      or coalesce(current_setting('app.approval_decision', true), '') = 'on'
$$;

-- the kind of request an item is, and whether a status means it is waiting for a decision
create or replace function public.money_waiting_status(p_kind text, p_status text) returns boolean language sql immutable as $$
  select case p_kind when 'loan' then p_status = 'requested'
                     when 'requisition' then p_status = 'pending'
                     else lower(coalesce(p_status, 'pending')) = 'pending' end
$$;

-- the employee an item is for (the one asking): the triggers below are shared by tables with different columns
create or replace function public.money_requester(p_kind text, p_row jsonb) returns text language sql immutable as $$
  select case p_kind when 'loan' then p_row ->> 'employee_number' when 'salary_advance' then p_row ->> 'Employee Number'
                     when 'expense' then p_row ->> 'employee_id' when 'requisition' then p_row ->> 'requested_by' end
$$;

-- An item entered already approved (a loan HR sets up, a requisition approved as it is raised) stays approved only
-- when the company's chain is one step the person entering it may decide; otherwise it goes on the chain like any
-- request, so a chain of several approvers can't be stepped round. (Named to run before the items' own guards.)
create or replace function public.money_direct_approval() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := tg_argv[0];
  v_requester text;
  w public.approval_workflows;
  v_steps jsonb;
begin
  -- (someone who may not manage this kind at all is left to the item's own rules, which refuse them)
  if lower(coalesce(new.status, '')) <> 'approved' or coalesce(current_setting('app.approval_decision', true), '') = 'on'
     or coalesce(current_setting('app.approval_quiet', true), '') = 'on'
     or not coalesce(public.has_any_module(variadic public.approval_kind_modules(v_kind)), false) then
    return new;
  end if;
  v_requester := coalesce(public.money_requester(v_kind, to_jsonb(new)), case when v_kind = 'requisition' then public.current_employee_number() end);
  w := public.approval_workflow_create(new.tenant_id, v_kind);
  select jsonb_agg(public.approval_step_json(s) order by s.position) into v_steps
  from public.approval_steps s where s.workflow_id = w.id;
  v_steps := coalesce(v_steps, public.approval_default_steps(v_kind));
  if jsonb_array_length(v_steps) = 1
     and public.approval_acting_as(new.tenant_id, v_steps -> 0, v_requester, w.admins_can_act) is not null then
    return new;
  end if;
  new.status := case v_kind when 'loan' then 'requested' when 'salary_advance' then 'Pending' else 'pending' end;
  return new;
end $$;
revoke all on function public.money_direct_approval() from public, anon, authenticated;

-- a new item waiting for a decision starts on its company's chain
create or replace function public.money_start_approval() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := tg_argv[0];
  v_requester text;
begin
  v_requester := public.money_requester(v_kind, to_jsonb(new));
  if public.money_waiting_status(v_kind, new.status) then
    perform public.approval_start(new.tenant_id, v_kind, new.id, v_requester);
  end if;
  return null;
end $$;

-- An item on a chain is decided through decide_approval only: while the chain is pending nothing decides or pays it,
-- and once the chain has decided, its approval or rejection is not made again by hand (a rejected advance is not
-- approved on the side). Withdrawing or cancelling it (any other change of status) is allowed, and ends a pending chain.
create or replace function public.money_guard_decision() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := tg_argv[0];
  v_chain text;
  s text := lower(coalesce(new.status, ''));
begin
  if new.status is not distinct from old.status or coalesce(current_setting('app.approval_decision', true), '') = 'on' then
    return new;
  end if;
  select r.status into v_chain from public.approval_requests r where r.kind = v_kind and r.record_id = old.id;
  if v_chain = 'pending' and s in ('approved', 'rejected', 'paid', 'completed', 'disbursed') then
    raise exception 'This % is waiting on its approvers: approve or reject it through its approval chain',
      lower(public.approval_kind_noun(v_kind)) using errcode = '42501';
  end if;
  if v_chain in ('approved', 'rejected') and s in ('approved', 'rejected') then
    raise exception 'This % was % through its approval chain and can''t be % by hand',
      lower(public.approval_kind_noun(v_kind)), v_chain, s using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.money_end_approval() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := tg_argv[0];
begin
  if tg_op = 'DELETE' then
    delete from public.approval_requests where kind = v_kind and record_id = old.id;
  elsif new.status is distinct from old.status and coalesce(current_setting('app.approval_decision', true), '') <> 'on'
        and not public.money_waiting_status(v_kind, new.status) then
    delete from public.approval_requests where kind = v_kind and record_id = new.id and status = 'pending';
  end if;
  return null;
end $$;

do $$
declare
  t record;
begin
  for t in select * from (values ('employee_loans', 'loan'), ('salary_advance', 'salary_advance'), ('expenses', 'expense'),
                                 ('requisitions', 'requisition')) as x(tbl, kind) loop
    execute format('drop trigger if exists aa_money_direct_approval on public.%I', t.tbl);
    execute format('create trigger aa_money_direct_approval before insert on public.%I for each row execute function public.money_direct_approval(%L)', t.tbl, t.kind);
    execute format('drop trigger if exists money_start_approval on public.%I', t.tbl);
    execute format('create trigger money_start_approval after insert on public.%I for each row execute function public.money_start_approval(%L)', t.tbl, t.kind);
    execute format('drop trigger if exists money_guard_decision on public.%I', t.tbl);
    execute format('create trigger money_guard_decision before update of status on public.%I for each row execute function public.money_guard_decision(%L)', t.tbl, t.kind);
    execute format('drop trigger if exists money_end_approval on public.%I', t.tbl);
    execute format('create trigger money_end_approval after update of status or delete on public.%I for each row execute function public.money_end_approval(%L)', t.tbl, t.kind);
  end loop;
end $$;

revoke all on function public.money_start_approval() from public, anon, authenticated;
revoke all on function public.money_guard_decision() from public, anon, authenticated;
revoke all on function public.money_end_approval() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 8. the creation alerts the chain replaces
-- ---------------------------------------------------------------------------------------------
-- (20261016700000's, without 'loan_requested': the chain tells the approvers)
create or replace function public.employee_loans_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  what text;
  month_name text := to_char(to_date(new.start_period || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY');
begin
  if tg_op = 'INSERT' or (new.principal, new.annual_rate, new.interest_method, new.months, new.start_period)
     is distinct from (old.principal, old.annual_rate, old.interest_method, old.months, old.start_period) then
    delete from public.employee_loan_instalments where loan_id = new.id;
    insert into public.employee_loan_instalments (tenant_id, loan_id, instalment_no, period, payment, principal, interest, balance)
    select new.tenant_id, new.id, s.instalment_no, s.period, s.payment, s.principal, s.interest, s.balance
    from public.loan_schedule(new.principal, new.annual_rate, new.interest_method, new.months, new.start_period) s;
  end if;

  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  what := coalesce(new.product_name, 'loan');
  if new.status = 'approved' then
    perform public.notify_employee_number(new.tenant_id, new.employee_number, 'loan_approved', 'Loan approved',
      'Your ' || lower(what) || ' of ' || public.kes(new.principal) || ' was approved: ' || public.kes(new.monthly_instalment)
      || ' a month for ' || new.months || ' months from ' || month_name || ' pay.' || public.with_note('Notes', new.decision_comment));
  elsif new.status = 'rejected' then
    perform public.notify_employee_number(new.tenant_id, new.employee_number, 'loan_rejected', 'Loan not approved',
      'Your ' || lower(what) || ' request of ' || public.kes(new.principal) || ' was not approved.'
      || public.with_note('Reason', new.decision_comment));
  elsif new.status = 'disbursed' and tg_op = 'UPDATE' and old.status = 'approved' then
    perform public.notify_employee_number(new.tenant_id, new.employee_number, 'loan_disbursed', 'Loan paid out',
      'Your ' || lower(what) || ' of ' || public.kes(new.principal) || ' has been paid out. Repayments come off your pay from '
      || month_name || '.');
  elsif new.status = 'completed' then
    perform public.notify_employee_number(new.tenant_id, new.employee_number, 'loan_repaid', 'Loan repaid',
      'Your ' || lower(what) || ' of ' || public.kes(new.principal) || ' is fully repaid.');
  end if;
  return null;
end $$;

-- (20261025400000's, without 'requisition_requested': the chain tells the approvers)
create or replace function public.requisitions_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  what text := public.kes(new.amount) || ' to ' || new.payee_name || ' for ' || btrim(new.purpose);
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    if new.status = 'approved' then
      -- still waiting to be paid: keep the list in step with an edit to the purpose
      update public.payment_requests set purpose = 'Requisition: ' || btrim(new.purpose), updated_at = now()
      where source = 'requisition' and source_id = new.id and status = 'to_pay';
    end if;
    return null;
  end if;
  if new.status = 'approved' then
    perform public.payment_request_open(new.tenant_id, 'requisition', new.id, new.payee_employee_number, new.payee_name,
      new.payee_details, new.amount, 'Requisition: ' || btrim(new.purpose));
  elsif new.status in ('rejected', 'cancelled') then
    perform public.payment_request_close('requisition', new.id);
  end if;

  if new.requested_by is not null and new.requested_by is distinct from public.current_employee_number() then
    if new.status = 'approved' then
      perform public.notify_employee_number(new.tenant_id, new.requested_by, 'requisition_approved', 'Requisition approved',
        'Your requisition of ' || what || ' was approved and sent to finance to pay.'
        || public.with_note('Notes', new.decision_comment));
    elsif new.status = 'rejected' then
      perform public.notify_employee_number(new.tenant_id, new.requested_by, 'requisition_rejected', 'Requisition not approved',
        'Your requisition of ' || what || ' was not approved.' || public.with_note('Reason', new.decision_comment));
    end if;
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 9. items waiting for a decision now go on the default chain, quietly
-- ---------------------------------------------------------------------------------------------
do $$
declare
  x record;
begin
  perform set_config('app.approval_quiet', 'on', true);
  for x in
    select 'loan' as kind, l.tenant_id, l.id, l.employee_number as requester from public.employee_loans l where l.status = 'requested'
    union all
    select 'salary_advance', a.tenant_id, a.id, a."Employee Number" from public.salary_advance a
    where lower(coalesce(a.status, 'pending')) = 'pending'
    union all
    select 'expense', e.tenant_id, e.id, e.employee_id from public.expenses e where lower(coalesce(e.status, 'pending')) = 'pending'
    union all
    select 'requisition', q.tenant_id, q.id, q.requested_by from public.requisitions q where q.status = 'pending'
  loop
    perform public.approval_start(x.tenant_id, x.kind, x.id, x.requester);
  end loop;
  perform set_config('app.approval_quiet', '', true);
end $$;

notify pgrst, 'reload schema';
