-- The app follows the modules ticked for a role, not the role's name (custom roles, FIG-827).
--
-- Companies now build their own roles ("Supervisors", "Payroll clerk") by ticking modules. But several database
-- functions and policies still asked "is this person ADMIN / HR / MANAGER?", so a custom role only got those powers
-- through the role it is based on, and a company could not give them to anyone else (or take them away from HR).
-- This replaces those name checks with modules, so the Roles & Permissions screen decides.
--
--   * New modules (each given ONCE, below, to the roles that had the power by name, so nothing changes for anyone):
--       task-oversight     See every task (read-only)                   ADMIN, HR
--       kpi-admin          Manage KPIs, templates, job titles, periods   HR, and CHECKER/OPERATIONS/STAFF roles with Performance
--       loans              Staff loans                                  HR
--       team-work          My team's work (casual, overtime, piece rate, leave discipline for your reports)   MANAGER
--       casual-overtime    Casual workers & overtime screens            HR
--       approve-exits      Approve or decline an exit                   HR
--       chat-channels      Create chat channels                         HR, MANAGER
--       chat-admin         Moderate chat (not direct messages)          nobody (administrators always)
--       sign-in-security   Two-step sign-in for the company             nobody (administrators always)
--       employee-edit      Add and edit employees (app buttons)         HR, MANAGER, REGIONAL
--       hr-admin           HR administration (app buttons)              HR
--       hr-lifecycle       already used by policies, now in the catalogue; given to nobody new
--     "Given to a role" means the system role's row in every company, and every custom role based on it that exists
--     now. Administrators (ADMIN-based roles) have every module, as before. A company missing a system role's row gets
--     one holding just the new module (that role passed the name check before). Running this again gives nothing, so a
--     company that unticks a module keeps it unticked. New companies copy the default company's roles.
--   * loans, approve-exits, sign-in-security and hr-admin join the modules a STAFF-based role may not hold.
--   * Name checks replaced (old -> new):
--       oversees_tasks()        ADMIN/HR                          -> task-oversight
--       manages_kpis()          ADMIN/HR, or Performance on a role other than MANAGER/REGIONAL -> kpi-admin
--       manages_job_titles()    ADMIN/HR or employees or KPIs     -> employees or manages_kpis()
--       manages_loans()         ADMIN/HR or payroll               -> loans or payroll
--       exit_decision_refusal() ADMIN/HR (and "another ADMIN/HR") -> approve-exits (and another holder of it)
--       hr_alert_recipients()   the base role's modules; HR for loans -> the person's own role's modules; loans
--       work_payroll_numbers()  the base role's modules           -> the person's own role's modules
--       chat: creating channels ADMIN/HR/MANAGER -> chat-channels; seeing private channels, managing any channel and
--         its members, editing or removing anyone's messages (not DMs), add_channel_members() ADMIN -> chat-admin
--       two-step sign-in: "admins, HR and payroll" ADMIN/HR/CHECKER -> anyone holding payroll, settings,
--         role-permissions or invite-people (the same people with the default modules); changing the company setting,
--         seeing and resetting people's two-step ADMIN -> sign-in-security
--   * Kept on purpose (they name a role by design):
--       approval_acting_as / approval_advance / approval_default_steps / my_approval_chain: an approval step names a
--         role on purpose, and ADMIN is the last-resort approver;
--       kpi_checkins_rules: nobody enters their own final score unless ADMIN (the system administrator has nobody above);
--       the todos.delete_tasks policy: a legacy table the app no longer uses, only the system administrator cleans it;
--       the custom-roles machinery (company_roles_rules, create/update/delete_company_role, role_permissions_rules,
--         user_may_grant, can_invite_people, can_manage_roles, create_company, has_module, my_modules,
--         module_allowed_for_base, seed_company_roles): "is the system administrator" rules by design;
--       two_step_applies(mode, role): no database code calls it any more; kept for anything outside that still does.
-- Safe to run again.

-- ---------------------------------------------------------------------------------------------
-- 1. giving a new module once
-- ---------------------------------------------------------------------------------------------
/**
 * Adds a module to the catalogue and, only the first time (when it was not there yet), gives it to the roles in
 * p_bases: the system role's row in every company (a row holding just the module when the company has none) and every
 * custom role based on one of them. p_also_if_has / p_also_bases: also to every role (system or custom) based on one
 * of p_also_bases that holds p_also_if_has.
 */
create or replace function public.seed_module_once(
  p_module text, p_name text, p_description text, p_category text, p_bases text[],
  p_also_if_has text default null, p_also_bases text[] default '{}'
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.permissions where module_id = p_module) then
    return;
  end if;
  insert into public.permissions (module_id, module_name, description, category)
  values (p_module, p_name, p_description, p_category)
  on conflict (module_id) do nothing;

  update public.role_permissions rp
    set permissions = array_append(coalesce(rp.permissions, '{}'), p_module), updated_at = now()
    where not (p_module = any (coalesce(rp.permissions, '{}')))
      and (
        (rp.role_name = any (public.system_role_names()) and rp.role_name = any (coalesce(p_bases, '{}')))
        or exists (select 1 from public.company_roles c
                   where c.tenant_id = rp.tenant_id and c.role_key = rp.role_name and not c.is_system
                     and c.base_role = any (coalesce(p_bases, '{}')))
        or (p_also_if_has is not null and p_also_if_has = any (coalesce(rp.permissions, '{}'))
            and ((rp.role_name = any (public.system_role_names()) and rp.role_name = any (p_also_bases))
                 or exists (select 1 from public.company_roles c
                            where c.tenant_id = rp.tenant_id and c.role_key = rp.role_name and not c.is_system
                              and c.base_role = any (p_also_bases))))
      );

  -- a company (one whose roles are set up) with no row for one of those system roles: that role passed the name check
  -- before, so it gets a row holding just the module (ADMIN needs none: administrators have every module)
  insert into public.role_permissions (tenant_id, role_name, permissions)
  select t.id, b, array[p_module]
  from public.tenants t
  cross join unnest(coalesce(p_bases, '{}')) b
  where b = any (public.system_role_names()) and b <> 'ADMIN'
    and exists (select 1 from public.role_permissions rp where rp.tenant_id = t.id)
    and not exists (select 1 from public.role_permissions rp where rp.tenant_id = t.id and rp.role_name = b);
end $$;
revoke all on function public.seed_module_once(text, text, text, text, text[], text, text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. STAFF-based roles may not hold the new powers over money and other people
-- ---------------------------------------------------------------------------------------------
-- These lists change with this migration, so they are `stable`, not `immutable`: an immutable function is folded into
-- the plans a database session keeps (e.g. role_permissions_rules() in a long-lived API connection), which would go on
-- using the old list. The functions that call them are re-created below so every session drops plans made before.
create or replace function public.admin_only_modules() returns text[]
language sql stable as $$
  select array['settings', 'role-permissions']
$$;

create or replace function public.staff_restricted_modules() returns text[]
language sql stable as $$
  select array['payroll', 'salaryadmin', 'mpesa-zap', 'adminconfirm', 'assign-managers', 'hr-lifecycle',
               'loans', 'approve-exits', 'sign-in-security', 'hr-admin']
$$;

create or replace function public.module_allowed_for_base(p_base text, p_module text) returns boolean
language sql stable as $$
  select p_base = 'ADMIN'
      or (not (p_module = any (public.admin_only_modules()))
          and (p_base is distinct from 'STAFF' or not (p_module = any (public.staff_restricted_modules()))))
$$;

-- unchanged bodies (20261019700000), re-created so no session keeps a plan made with the old lists
create or replace function public.role_modules(p_tenant uuid, p_role text, p_company_role uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  cr public.company_roles;
  v text[];
begin
  if p_tenant is null or p_role is null then
    return '{}';
  end if;
  if p_company_role is not null then
    select c.* into cr from public.company_roles c
    where c.id = p_company_role and c.tenant_id = p_tenant and c.base_role = p_role;
    if found and not cr.is_system then
      select rp.permissions into v from public.role_permissions rp where rp.tenant_id = p_tenant and rp.role_name = cr.role_key;
      return array(select distinct m from unnest(coalesce(v, '{}')) m where public.module_allowed_for_base(cr.base_role, m) order by 1);
    end if;
  end if;
  select rp.permissions into v from public.role_permissions rp where rp.tenant_id = p_tenant and rp.role_name = p_role;
  return coalesce(v, '{}');
end $$;
revoke all on function public.role_modules(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.role_modules(uuid, text, uuid) to service_role;

create or replace function public.role_permissions_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cr public.company_roles;
  v_base text;
  v_bad text;
  v_added text[];
begin
  new.permissions := array(select distinct m from unnest(coalesce(new.permissions, '{}')) m where coalesce(btrim(m), '') <> '' order by 1);

  if new.role_name ~ '^CR_' then
    select c.* into cr from public.company_roles c where c.tenant_id = new.tenant_id and c.role_key = new.role_name;
    if not found then
      raise exception 'Unknown role' using errcode = '22023';
    end if;
    v_base := cr.base_role;
    select m into v_bad from unnest(new.permissions) m where not public.module_allowed_for_base(v_base, m) limit 1;
    if v_bad is not null then
      raise exception '"%" cannot be given to a role based on %', coalesce((select p.module_name from public.permissions p where p.module_id = v_bad), v_bad),
        case when v_bad = any (public.admin_only_modules()) then 'anything but Administrator' else 'Staff' end
        using errcode = '42501';
    end if;
  else
    v_base := new.role_name;
  end if;

  -- someone who is not an administrator, changing their own company's roles: never an administrator role, and never
  -- access they do not have themselves (the database's own functions seeding a new company are not limited)
  -- (someone who may not manage roles at all is refused by the row-level security policy instead)
  if auth.uid() is not null and new.tenant_id = public.current_tenant_id() and coalesce(public.current_user_role(), '') <> 'ADMIN'
     and public.has_module('role-permissions') then
    if v_base = 'ADMIN' then
      raise exception 'Only an administrator can change an administrator role' using errcode = '42501';
    end if;
    v_added := array(select unnest(new.permissions) except select unnest(case when tg_op = 'UPDATE' then coalesce(old.permissions, '{}') else '{}' end));
    if not (v_added <@ coalesce(public.my_modules(), '{}')) then
      raise exception 'You cannot give a role access you do not have yourself' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. the new modules
-- ---------------------------------------------------------------------------------------------
do $$
begin
  perform public.seed_module_once('task-oversight', 'See every task',
    'See every task in the company, read-only, with its comments and files', 'workspace', array['ADMIN', 'HR']);
  -- the old rule: ADMIN and HR, or Performance on a role other than MANAGER and REGIONAL
  perform public.seed_module_once('kpi-admin', 'Manage KPIs',
    'Set up KPIs, templates, job titles and review periods for everyone', 'people-hr', array['HR'],
    'performance', array['CHECKER', 'OPERATIONS', 'STAFF']);
  perform public.seed_module_once('loans', 'Staff loans', 'Manage staff loans and get loan requests', 'finance', array['HR']);
  perform public.seed_module_once('team-work', 'My team''s work',
    'Casual workers, overtime, piece rate and leave discipline for the people who report to you', 'people-hr', array['MANAGER']);
  perform public.seed_module_once('casual-overtime', 'Casual workers & overtime',
    'Open the Casual workers and Overtime screens', 'finance', array['HR']);
  perform public.seed_module_once('approve-exits', 'Approve exits', 'Approve or decline an employee''s exit', 'people-hr', array['HR']);
  perform public.seed_module_once('chat-channels', 'Create chat channels', 'Start new chat channels', 'workspace', array['HR', 'MANAGER']);
  perform public.seed_module_once('chat-admin', 'Moderate chat',
    'See private channels, manage any channel and its members, edit or remove anyone''s messages (not direct messages)',
    'workspace', '{}'::text[]);
  perform public.seed_module_once('sign-in-security', 'Sign-in security',
    'Set two-step sign-in for the company and reset someone''s two-step sign-in', 'system', '{}'::text[]);
  perform public.seed_module_once('employee-edit', 'Add and edit employees',
    'Show Add employee and Edit on employee records (what can be saved still follows Employees)', 'people-hr',
    array['HR', 'MANAGER', 'REGIONAL']);
  perform public.seed_module_once('hr-admin', 'HR administration',
    'Delete and bulk-add employees, relocate and merge duplicates, set leave types, see salary details on employee forms, and see every pending leave request',
    'people-hr', array['HR']);
end $$;

-- already checked by policies, missing from the catalogue (so it could not be ticked); given to nobody new
insert into public.permissions (module_id, module_name, description, category)
values ('hr-lifecycle', 'HR Lifecycle', 'Contracts, probation, employment status and suspensions', 'people-hr')
on conflict (module_id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- 4. tasks, KPIs, job titles, loans
-- ---------------------------------------------------------------------------------------------
create or replace function public.oversees_tasks() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.has_module('task-oversight')
$$;

create or replace function public.manages_kpis() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.has_module('kpi-admin'), false)
$$;

create or replace function public.manages_job_titles() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.has_module('employees') or public.manages_kpis(), false)
$$;

create or replace function public.manages_loans() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.has_any_module('loans', 'payroll'), false)
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. exits
-- ---------------------------------------------------------------------------------------------
create or replace function public.exit_decision_refusal(p_requested_by uuid, p_decision text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid;
begin
  select p.tenant_id into v_tenant from public.user_profiles p where p.user_id = auth.uid();
  if v_tenant is null or not public.has_module('approve-exits') then
    return 'Only HR or an administrator can approve or decline an exit';
  end if;
  if p_decision = 'approved' and p_requested_by = auth.uid() and exists (
    select 1 from public.memberships m
    where m.tenant_id = v_tenant and m.user_id <> auth.uid() and m.account_status = 'ACTIVE'
      and (m.role = 'ADMIN' or 'approve-exits' = any (public.role_modules(v_tenant, m.role, m.company_role_id)))
  ) then
    return 'You started this exit, so another HR person or an administrator must approve it';
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6. who gets HR alerts, and who records work for payroll: the person's own role (custom roles included)
-- ---------------------------------------------------------------------------------------------
create or replace function public.hr_alert_recipients(p_tenant uuid, p_type text)
returns table (user_id uuid, email text)
language sql stable security definer set search_path = public as $$
  select m.user_id, btrim(coalesce(nullif(btrim(u.email), ''), p.email))
  from public.memberships m
  left join auth.users u on u.id = m.user_id
  left join public.user_profiles p on p.user_id = m.user_id
  cross join lateral (select public.role_modules(p_tenant, m.role, m.company_role_id) as mods) r
  where m.tenant_id = p_tenant
    and m.account_status = 'ACTIVE'
    and coalesce(nullif(btrim(u.email), ''), btrim(p.email), '') <> ''
    and (m.role = 'ADMIN'
         or r.mods && public.hr_alert_modules(p_type)
         or (p_type = 'loan_requested' and 'loans' = any (r.mods)))
$$;

create or replace function public.work_payroll_numbers(p_tenant uuid) returns setof text
language plpgsql stable security definer set search_path = public as $$
declare
  v_found boolean := false;
  v_number text;
begin
  for v_number in
    select distinct e."Employee Number"
    from public.user_profiles p
    join auth.users u on u.id = p.user_id
    join public.employees e on e.tenant_id = p_tenant and lower(btrim(e."Work Email")) = lower(btrim(u.email))
    where p.tenant_id = p_tenant and e."Employee Number" is not null
      and public.role_modules(p_tenant, p.role, p.company_role_id) && array['work-records', 'payroll']
  loop
    v_found := true;
    return next v_number;
  end loop;
  -- nobody holds those modules: the system administrator
  if not v_found then
    return query
      select distinct e."Employee Number"
      from public.user_profiles p
      join auth.users u on u.id = p.user_id
      join public.employees e on e.tenant_id = p_tenant and lower(btrim(e."Work Email")) = lower(btrim(u.email))
      where p.tenant_id = p_tenant and p.role = 'ADMIN' and e."Employee Number" is not null;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 7. chat
-- ---------------------------------------------------------------------------------------------
drop policy if exists create_channels on public.channels;
create policy create_channels on public.channels for insert to authenticated
  with check (((created_by = (select auth.uid())) AND (type IS DISTINCT FROM 'dm'::text) AND (NOT COALESCE(is_default, false))
    AND (select public.has_module('chat-channels'))));

drop policy if exists delete_channels on public.channels;
create policy delete_channels on public.channels for delete to authenticated
  using (((type IS DISTINCT FROM 'dm'::text) AND (NOT COALESCE(is_default, false))
    AND ((created_by = (select auth.uid())) OR (select public.has_module('chat-admin')))));

drop policy if exists manage_channels on public.channels;
create policy manage_channels on public.channels for update to authenticated
  using (((type IS DISTINCT FROM 'dm'::text) AND (NOT COALESCE(is_default, false))
    AND ((created_by = (select auth.uid())) OR (select public.has_module('chat-admin')))))
  with check (((type IS DISTINCT FROM 'dm'::text) AND (NOT COALESCE(is_default, false))
    AND ((created_by = (select auth.uid())) OR (select public.has_module('chat-admin')))));

drop policy if exists visible_channels on public.channels;
create policy visible_channels on public.channels for select to authenticated
  using (
CASE
    WHEN (type = 'dm'::text) THEN (EXISTS ( SELECT 1
       FROM channel_members m
      WHERE ((m.channel_id = channels.id) AND (m.user_id = (select auth.uid())))))
    ELSE ((COALESCE(is_private, false) = false) OR (created_by = (select auth.uid())) OR (job_title = (select public.current_job_title()))
      OR (select public.has_module('chat-admin')) OR (EXISTS ( SELECT 1
       FROM channel_members m
      WHERE ((m.channel_id = channels.id) AND (m.user_id = (select auth.uid()))))))
END);

drop policy if exists own_membership on public.channel_members;
create policy own_membership on public.channel_members for all to authenticated
  using ((((user_id = (select auth.uid())) OR (select public.has_module('chat-admin'))) AND (NOT public.is_dm_channel(channel_id))))
  with check (((NOT public.is_dm_channel(channel_id))
    AND ((select public.has_module('chat-admin')) OR ((user_id = (select auth.uid())) AND public.channel_open_to_me(channel_id)))));

drop policy if exists delete_messages on public.messages;
create policy delete_messages on public.messages for delete to authenticated
  using (((author_id = (select auth.uid())) OR ((select public.has_module('chat-admin')) AND (NOT public.is_dm_channel(channel_id)))));

drop policy if exists edit_messages on public.messages;
create policy edit_messages on public.messages for update to authenticated
  using (((author_id = (select auth.uid())) OR ((select public.has_module('chat-admin')) AND (NOT public.is_dm_channel(channel_id)))))
  with check (((author_id = (select auth.uid())) OR ((select public.has_module('chat-admin')) AND (NOT public.is_dm_channel(channel_id)))));

create or replace function public.add_channel_members(p_channel uuid, p_users uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_added integer;
begin
  if v_me is null or v_tenant is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.channels c
    where c.id = p_channel
      and c.tenant_id = v_tenant
      and c.type is distinct from 'dm'
      and (c.created_by = v_me or public.has_module('chat-admin'))
  ) then
    raise exception 'You cannot add people to this channel' using errcode = '42501';
  end if;

  with wanted as (
    select distinct u
    from unnest(coalesce(p_users, '{}'::uuid[])) as u
    where exists (
      select 1 from public.memberships m
      where m.user_id = u and m.tenant_id = v_tenant and m.account_status = 'ACTIVE'
    )
    and not exists (select 1 from public.channel_members x where x.channel_id = p_channel and x.user_id = u)
  ), ins as (
    insert into public.channel_members (channel_id, user_id, role)
    select p_channel, u, 'member' from wanted
    returning 1
  )
  select count(*) into v_added from ins;

  return v_added;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 8. two-step sign-in
-- ---------------------------------------------------------------------------------------------
-- "Admins, HR and payroll": whoever holds one of these (with the default modules: ADMIN, HR, CHECKER, as before)
create or replace function public.two_step_privileged_modules() returns text[]
language sql immutable as $$
  select array['payroll', 'settings', 'role-permissions', 'invite-people']
$$;
grant execute on function public.two_step_privileged_modules() to authenticated, service_role;

/** Does the company's two-step setting (off / privileged / everyone) ask the signed-in person for a code? */
create or replace function public.two_step_applies_to_me(p_mode text) returns boolean
language sql stable security definer set search_path = public as $$
  select case coalesce(p_mode, 'off')
    when 'everyone' then true
    when 'privileged' then coalesce(public.has_any_module(variadic public.two_step_privileged_modules()), false)
    else false
  end
$$;
revoke all on function public.two_step_applies_to_me(text) from public, anon;
grant execute on function public.two_step_applies_to_me(text) to authenticated, service_role;

create or replace function public.mfa_required() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  t uuid := public.current_tenant_id();
  p record;
begin
  if t is null then
    return false;
  end if;
  select * into p from public.two_step_policy(t);
  if not public.two_step_applies_to_me(p.mode)
     and not coalesce((select u.enabled from public.user_two_step u where u.user_id = auth.uid() and u.tenant_id = t), false) then
    return false;
  end if;
  return not public.mfa_passed();
end $$;

create or replace function public.my_two_step()
returns table (enabled boolean, method text, company_requires boolean, company_method text)
language plpgsql stable security definer set search_path = public as $$
declare
  t uuid := public.current_tenant_id();
  p record;
begin
  if t is null or auth.uid() is null then
    raise exception 'You are not signed in to a company' using errcode = '42501';
  end if;
  select * into p from public.two_step_policy(t);
  company_requires := public.two_step_applies_to_me(p.mode);
  company_method := p.method;
  select coalesce(u.enabled, false), coalesce(u.method, 'email') into enabled, method
  from (select 1) one left join public.user_two_step u on u.user_id = auth.uid() and u.tenant_id = t;
  enabled := enabled or company_requires;
  return next;
end $$;

create or replace function public.set_my_two_step(p_enabled boolean, p_method text default 'email')
returns table (enabled boolean, method text, company_requires boolean, company_method text)
language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.current_tenant_id();
  p record;
begin
  if t is null or auth.uid() is null then
    raise exception 'You are not signed in to a company' using errcode = '42501';
  end if;
  if coalesce(p_method, 'email') not in ('email', 'sms') then
    raise exception 'Choose email or SMS' using errcode = '22023';
  end if;
  select * into p from public.two_step_policy(t);
  if not coalesce(p_enabled, false) and public.two_step_applies_to_me(p.mode) then
    raise exception 'Your company asks for a code when you sign in, so it can''t be turned off' using errcode = '42501';
  end if;
  insert into public.user_two_step as u (user_id, tenant_id, enabled, method, updated_at)
  values (auth.uid(), t, coalesce(p_enabled, false), coalesce(p_method, 'email'), now())
  on conflict (user_id, tenant_id) do update set enabled = excluded.enabled, method = excluded.method, updated_at = now();
  return query select * from public.my_two_step();
end $$;

create or replace function public.two_step_settings()
returns table (mode text, method text, can_edit boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  t uuid := public.current_tenant_id();
begin
  if t is null then
    raise exception 'You are not signed in to a company' using errcode = '42501';
  end if;
  select p.mode, p.method into mode, method from public.two_step_policy(t) p;
  can_edit := coalesce(public.has_module('sign-in-security'), false);
  return next;
end $$;

create or replace function public.set_two_step_settings(p_mode text, p_method text)
returns table (mode text, method text, can_edit boolean)
language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.current_tenant_id();
begin
  if t is null or not public.has_module('sign-in-security') then
    raise exception 'Only an administrator can change two-step sign-in' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('off', 'privileged', 'everyone') then
    raise exception 'Choose off, admins HR and payroll, or everyone' using errcode = '22023';
  end if;
  if p_method is null or p_method not in ('email', 'sms') then
    raise exception 'Choose email or SMS' using errcode = '22023';
  end if;
  insert into public.company_security_settings as s (tenant_id, two_step, two_step_method, updated_by)
    values (t, p_mode, p_method, auth.uid())
    on conflict (tenant_id) do update set two_step = excluded.two_step, two_step_method = excluded.two_step_method,
      updated_by = excluded.updated_by, updated_at = now();
  return query select * from public.two_step_settings();
end $$;

create or replace function public.two_step_people()
returns table (user_id uuid, name text, email text, method text, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_module('sign-in-security') then
    raise exception 'Only an administrator can see this' using errcode = '42501';
  end if;
  return query
  select u.user_id, coalesce(nullif(btrim(p.full_name), ''), p.email), p.email, u.method, u.updated_at
  from public.user_two_step u
  left join public.user_profiles p on p.user_id = u.user_id
  where u.tenant_id = public.current_tenant_id() and u.enabled
  order by 2;
end $$;

create or replace function public.reset_two_step(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.current_tenant_id();
begin
  if not public.has_module('sign-in-security') then
    raise exception 'Only an administrator can reset two-step sign-in' using errcode = '42501';
  end if;
  update public.user_two_step set enabled = false, updated_at = now() where user_id = p_user and tenant_id = t;
  delete from public.mfa_numbers m
  where m.tenant_id = t and lower(m.email) = (select lower(u.email) from auth.users u where u.id = p_user);
end $$;

notify pgrst, 'reload schema';
