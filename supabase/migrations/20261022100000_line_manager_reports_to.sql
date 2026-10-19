-- A "Line manager" approval step finds the manager from Reports to (FIG-916).
--
-- Approval workflows (20261015800000) found an employee's line manager by the old manager_email field only. Add/Edit
-- Employee now saves "Reports to" as reports_to_id (20261016200000), and supervises() / My team read both - but the
-- approval helpers did not, so with Reports to filled in and no manager email (as everyone in a company set up since)
-- a Line manager step was skipped as "nobody to approve at this step", and the supervisor could never decide it.
--
-- The four helpers that read the line manager now take the employee's Reports to person as well as the manager email:
--   approval_people        who the line manager is (for notifications, "waiting on", the staff Approve leave page)
--   approval_has_assignee  the employee has a line manager at all
--   approval_skip_reason   the quick "nobody typed in" check
--   approval_acting_as     the signed-in user is the line manager (by their login's email, or as the Reports to person)
-- Everything else is unchanged. Safe to run again.

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
  elsif p_type = 'department_head' and public.approval_department_head_available() then
    -- the org structure is not part of this migration: read it only where it exists
    return query execute
      'select h.* from public.employees r join public.departments d on d.id = r.department_id
         join public.employees h on h.id = d.head_employee_id
       where r.tenant_id = $1 and r."Employee Number" = $2 and h.tenant_id = $1'
      using p_tenant, p_requester;
  end if;
end $$;

-- the employee has someone in this place at all (a Leave Approver typed in, a Reports to or manager's email), found or not
create or replace function public.approval_has_assignee(p_tenant uuid, p_step jsonb, p_requester text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_step ->> 'approver_type'
    when 'leave_approver' then exists (select 1 from public.employees r where r.tenant_id = p_tenant
      and r."Employee Number" = p_requester and coalesce(btrim(r."Leave Approver"), '') <> '')
    when 'reports_to' then exists (select 1 from public.employees r where r.tenant_id = p_tenant
      and r."Employee Number" = p_requester and (r.reports_to_id is not null or coalesce(btrim(r.manager_email), '') <> ''))
    when 'role' then true
    else exists (select 1 from public.approval_people(p_tenant, p_step ->> 'approver_type', p_step ->> 'approver_role',
                   (p_step ->> 'approver_employee_id')::uuid, p_requester))
  end
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

revoke all on function public.approval_people(uuid, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.approval_has_assignee(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.approval_acting_as(uuid, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public.approval_skip_reason(uuid, jsonb, text) from public, anon, authenticated;
