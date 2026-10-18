-- Companies create their own roles (FIG-827). Clients asked for roles named the way they work ("Operators",
-- "Supervisors") with the screens each may use.
--
--   * company_roles: each company's roles. Its seven system roles (ADMIN, HR, CHECKER, MANAGER, REGIONAL, OPERATIONS,
--     STAFF) are rows too (is_system), so a company can rename how they are shown. A custom role has a name, a
--     description, a BASE role (one of the seven) and its own modules, kept in role_permissions under the role's key
--     (role_name = 'CR_<id>'), next to the system roles' rows.
--   * memberships.company_role_id (per company, the source of truth) and user_profiles.company_role_id (the company
--     the person is working in, mirrored by a trigger). user_profiles.role stays the BASE role, so every check that
--     reads the role name (the app, and SQL such as current_user_role()) keeps working as before.
--   * has_module() / has_any_module() / get_user_permissions() / has_permission(): a person with a custom role has
--     that role's modules; everyone else has their role's, as before. ADMIN-based roles have every module, as ADMIN.
--   * No escalation, enforced here:
--       - a custom role never holds more than its base role may: settings and role-permissions (the company's set-up
--         and who may do what) only on roles based on ADMIN (admin_only_modules()); payroll and the other powers over
--         money and other people's records not on roles based on STAFF (staff_restricted_modules()). Task modules
--         (task-manager, the planned task-projects) are allowed on STAFF-based roles;
--       - only an administrator creates a role based on ADMIN, and someone who is not an administrator cannot give
--         a role access they do not have themselves, or change an administrator role;
--       - nobody changes their own role; giving a role (inviting, assigning) follows the rule HR had: administrators
--         give any role, others with "Invite people" give roles based on STAFF whose modules they hold themselves.
--   * Inviting people is now a module, "invite-people" (granted once to ADMIN and HR in every company, who invited
--     before), and managing roles is the "role-permissions" module, instead of checks on the role's name.
--   * A role that people hold cannot be deleted or switched off until they are moved to another one.
--   * Changes to roles, their modules and who holds which are written to the audit trail.
-- Safe to run again.

-- ---------------------------------------------------------------------------------------------
-- 1. inviting people becomes a module
-- ---------------------------------------------------------------------------------------------
-- given once to the roles that invited before (ADMIN and HR, every company); running this again changes nothing, so
-- a company that took it away from HR keeps it that way
do $$
begin
  if not exists (select 1 from public.permissions where module_id = 'invite-people') then
    insert into public.permissions (module_id, module_name, description, category)
    values ('invite-people', 'Invite people', 'Invite people to the company and choose their role', 'system');
    update public.role_permissions
      set permissions = array_append(coalesce(permissions, '{}'), 'invite-people'), updated_at = now()
      where role_name in ('ADMIN', 'HR') and not ('invite-people' = any (coalesce(permissions, '{}')));
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. helpers
-- ---------------------------------------------------------------------------------------------
create or replace function public.system_role_names() returns text[]
language sql immutable as $$
  select array['ADMIN', 'HR', 'CHECKER', 'MANAGER', 'REGIONAL', 'OPERATIONS', 'STAFF']
$$;

-- Modules only a role based on ADMIN may hold: the company's settings (Settings, its pages and the set-up assistant)
-- and Role Permissions (who may do what). Anyone holding them could give themselves everything else.
create or replace function public.admin_only_modules() returns text[]
language sql immutable as $$
  select array['settings', 'role-permissions']
$$;

-- Modules a role based on STAFF may not hold either: money and the powers over other people's accounts and
-- records (payroll, salary advances, M-Pesa, approving staff sign-ups, assigning managers, the HR lifecycle).
-- Everything else may be given to a STAFF-based role, notably the task modules (task-manager, and the planned
-- task-projects, FIG-901), so a company can let some staff create and assign projects without making them admins or
-- HR. "Invite people" too, but only when an administrator ticks it.
create or replace function public.staff_restricted_modules() returns text[]
language sql immutable as $$
  select array['payroll', 'salaryadmin', 'mpesa-zap', 'adminconfirm', 'assign-managers', 'hr-lifecycle']
$$;

create or replace function public.module_allowed_for_base(p_base text, p_module text) returns boolean
language sql immutable as $$
  select p_base = 'ADMIN'
      or (not (p_module = any (public.admin_only_modules()))
          and (p_base is distinct from 'STAFF' or not (p_module = any (public.staff_restricted_modules()))))
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. company_roles
-- ---------------------------------------------------------------------------------------------
create table if not exists public.company_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  -- what role_permissions.role_name holds for it: the system role's name, or CR_<id without dashes>
  role_key text not null,
  name text not null,
  description text,
  base_role text not null,
  is_system boolean not null default false,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_roles_base_role_check
    check (base_role = any (array['ADMIN', 'HR', 'CHECKER', 'MANAGER', 'REGIONAL', 'OPERATIONS', 'STAFF'])),
  constraint company_roles_name_check check (char_length(btrim(name)) between 1 and 60),
  constraint company_roles_description_check check (description is null or char_length(description) <= 300),
  constraint company_roles_key_check
    check ((is_system and role_key = base_role) or (not is_system and role_key ~ '^CR_[0-9a-f]{32}$')),
  constraint company_roles_system_active check (active or not is_system),
  constraint company_roles_tenant_key unique (tenant_id, role_key),
  constraint company_roles_tenant_id_id unique (tenant_id, id)
);
create unique index if not exists company_roles_tenant_name on public.company_roles (tenant_id, lower(btrim(name)));
create index if not exists company_roles_tenant_idx on public.company_roles (tenant_id);

alter table public.company_roles enable row level security;
drop policy if exists tenant_isolation on public.company_roles;
create policy tenant_isolation on public.company_roles as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
-- everyone in the company sees its roles (their names are shown wherever a role is); changes go through the functions
drop policy if exists company_roles_read on public.company_roles;
create policy company_roles_read on public.company_roles for select to authenticated using (true);
revoke all on public.company_roles from anon;
revoke insert, update, delete, truncate on public.company_roles from authenticated;
grant select on public.company_roles to authenticated;

create or replace function public.company_roles_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_people integer;
begin
  if tg_op = 'DELETE' then
    -- a company being deleted takes its roles with it
    if not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
      return old;
    end if;
    if old.is_system then
      raise exception 'The system roles cannot be deleted (you can rename them)' using errcode = '42501';
    end if;
    select count(*) into v_people from public.memberships m where m.company_role_id = old.id;
    if v_people > 0 then
      raise exception '% % this role. Move them to another role first.', v_people, case when v_people = 1 then 'person has' else 'people have' end
        using errcode = '23503';
    end if;
    return old;
  end if;

  new.name := btrim(new.name);
  new.description := nullif(btrim(coalesce(new.description, '')), '');

  if tg_op = 'INSERT' then
    if not new.is_system then
      new.role_key := 'CR_' || replace(new.id::text, '-', '');
      if new.base_role = 'ADMIN' and auth.uid() is not null and coalesce(public.current_user_role(), '') <> 'ADMIN' then
        raise exception 'Only an administrator can create a role based on Administrator' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  -- what a role is cannot change, only how it is called and whether it is in use
  if new.tenant_id is distinct from old.tenant_id or new.role_key is distinct from old.role_key
     or new.is_system is distinct from old.is_system or new.base_role is distinct from old.base_role then
    raise exception 'A role''s company, key and base role cannot be changed' using errcode = '42501';
  end if;
  if old.active and not new.active then
    select count(*) into v_people from public.memberships m where m.company_role_id = old.id;
    if v_people > 0 then
      raise exception '% % this role. Move them to another role first.', v_people, case when v_people = 1 then 'person has' else 'people have' end
        using errcode = '23503';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists company_roles_rules on public.company_roles;
create trigger company_roles_rules before insert or update or delete on public.company_roles
  for each row execute function public.company_roles_rules();

-- every company has its seven system roles as rows, named as the role screen has always shown them
create or replace function public.seed_company_roles(p_tenant uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.company_roles (tenant_id, role_key, name, description, base_role, is_system)
  select p_tenant, v.k, v.n, v.d, v.k, true
  from (values
    ('ADMIN', 'Administrator', 'Full access to every screen and setting'),
    ('HR', 'Human Resources', 'Employee and payroll management'),
    ('CHECKER', 'Checker', 'Verification and approval workflows'),
    ('MANAGER', 'Manager', 'Team oversight and reporting'),
    ('REGIONAL', 'Regional Manager', 'Supervision of several branches'),
    ('OPERATIONS', 'Operations', 'Day-to-day operations'),
    ('STAFF', 'Staff', 'The staff portal')
  ) as v(k, n, d)
  where exists (select 1 from public.tenants t where t.id = p_tenant)
    -- a company that already uses the name for a role of its own keeps it (the role is then shown by its key)
    and not exists (select 1 from public.company_roles c
                    where c.tenant_id = p_tenant and (c.role_key = v.k or lower(btrim(c.name)) = lower(v.n)))
  on conflict (tenant_id, role_key) do nothing
$$;
revoke all on function public.seed_company_roles(uuid) from public, anon, authenticated;

do $$
declare t record;
begin
  for t in select id from public.tenants order by created_at loop
    perform public.seed_company_roles(t.id);
  end loop;
end $$;

create or replace function public.company_roles_for_new_company() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_company_roles(new.id);
  return null;
end $$;
drop trigger if exists company_roles_for_new_company on public.tenants;
create trigger company_roles_for_new_company after insert on public.tenants
  for each row execute function public.company_roles_for_new_company();

-- ---------------------------------------------------------------------------------------------
-- 4. who holds which role: memberships (per company) and user_profiles (the company they work in)
-- ---------------------------------------------------------------------------------------------
alter table public.memberships add column if not exists company_role_id uuid;
alter table public.user_profiles add column if not exists company_role_id uuid;
alter table public.invitations add column if not exists company_role_id uuid;
alter table public.invite_queue add column if not exists company_role_id uuid;

do $$
begin
  -- the role must be one of the same company's: the key includes the company
  if not exists (select 1 from pg_constraint where conname = 'memberships_company_role_fkey') then
    alter table public.memberships add constraint memberships_company_role_fkey
      foreign key (tenant_id, company_role_id) references public.company_roles (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_profiles_company_role_fkey') then
    alter table public.user_profiles add constraint user_profiles_company_role_fkey
      foreign key (tenant_id, company_role_id) references public.company_roles (tenant_id, id);
  end if;
  -- a deleted role leaves the invitation with its base role
  if not exists (select 1 from pg_constraint where conname = 'invitations_company_role_fkey') then
    alter table public.invitations add constraint invitations_company_role_fkey
      foreign key (company_role_id) references public.company_roles (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invite_queue_company_role_fkey') then
    alter table public.invite_queue add constraint invite_queue_company_role_fkey
      foreign key (company_role_id) references public.company_roles (id) on delete set null;
  end if;
end $$;
create index if not exists memberships_company_role_idx on public.memberships (company_role_id) where company_role_id is not null;

/**
 * Keeps a membership's role and company role together. Giving someone a company role sets their base role from it;
 * changing only the base role (anything that knows nothing of company roles, e.g. an older server) drops a company
 * role that no longer matches it.
 */
create or replace function public.membership_company_role() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cr public.company_roles;
begin
  if new.company_role_id is null then
    return new;
  end if;
  select c.* into cr from public.company_roles c where c.id = new.company_role_id;
  if not found or cr.tenant_id is distinct from new.tenant_id then
    raise exception 'That role belongs to another company' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' or new.company_role_id is distinct from old.company_role_id then
    if not cr.active then
      raise exception 'The role "%" is switched off', cr.name using errcode = '22023';
    end if;
    new.role := cr.base_role;
  elsif new.role is distinct from cr.base_role then
    new.company_role_id := null;
  end if;
  return new;
end $$;
drop trigger if exists memberships_company_role on public.memberships;
create trigger memberships_company_role before insert or update on public.memberships
  for each row execute function public.membership_company_role();

/** user_profiles.company_role_id is always the one of the membership in the company they work in, never set directly. */
create or replace function public.profile_company_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.company_role_id := (
    select m.company_role_id
    from public.memberships m
    join public.company_roles cr on cr.id = m.company_role_id and cr.tenant_id = m.tenant_id and cr.base_role = new.role
    where m.user_id = new.user_id and m.tenant_id = new.tenant_id
  );
  return new;
end $$;
drop trigger if exists user_profiles_company_role on public.user_profiles;
create trigger user_profiles_company_role before insert or update on public.user_profiles
  for each row execute function public.profile_company_role();

-- ---------------------------------------------------------------------------------------------
-- 5. effective modules
-- ---------------------------------------------------------------------------------------------
/**
 * The modules a role has in a company: a custom role's own (never more than its base role may hold), otherwise the
 * role's. Internal (the functions below call it); it takes any company, so clients cannot call it.
 */
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

create or replace function public.has_module(p_module text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'ADMIN'
        or case
             when cr.id is not null then
               public.module_allowed_for_base(cr.base_role, p_module)
               and exists (
                 select 1 from public.role_permissions rp
                 where rp.tenant_id = p.tenant_id and rp.role_name = cr.role_key and p_module = any (rp.permissions))
             else exists (
               select 1 from public.role_permissions rp
               where rp.tenant_id = p.tenant_id and rp.role_name = p.role and p_module = any (rp.permissions))
           end
    from public.user_profiles p
    left join public.company_roles cr
      on cr.id = p.company_role_id and cr.tenant_id = p.tenant_id and cr.base_role = p.role and not cr.is_system
    where p.user_id = auth.uid()
  ), false)
$$;

create or replace function public.get_user_permissions(user_id uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text;
  v_tenant uuid;
  v_company_role uuid;
begin
  select p.tenant_id, p.role, p.company_role_id into v_tenant, v_role, v_company_role
  from public.user_profiles p where p.user_id = get_user_permissions.user_id;
  if v_tenant is null or v_role is null then return array[]::text[]; end if;
  if auth.uid() is not null and v_tenant is distinct from public.current_tenant_id() then return array[]::text[]; end if;
  return public.role_modules(v_tenant, v_role, v_company_role);
end;
$$;

create or replace function public.has_permission(user_id uuid, required_permission text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text;
  v_tenant uuid;
  v_company_role uuid;
begin
  select p.tenant_id, p.role, p.company_role_id into v_tenant, v_role, v_company_role
  from public.user_profiles p where p.user_id = has_permission.user_id;
  if v_tenant is null or v_role is null then return false; end if;
  if auth.uid() is not null and v_tenant is distinct from public.current_tenant_id() then return false; end if;
  return coalesce(required_permission = any (public.role_modules(v_tenant, v_role, v_company_role)), false);
end;
$$;

/** The signed-in person's modules in the company they work in (every module for an administrator). */
create or replace function public.my_modules() returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when p.role = 'ADMIN' then (select coalesce(array_agg(x.module_id order by x.module_id), '{}') from public.permissions x)
    else public.role_modules(p.tenant_id, p.role, p.company_role_id)
  end
  from public.user_profiles p
  where p.user_id = auth.uid()
$$;
revoke all on function public.my_modules() from public, anon;
grant execute on function public.my_modules() to authenticated;

/** How a role is shown in a company: the custom role's name, else the system role's (as the company named it). */
create or replace function public.role_display_name(p_tenant uuid, p_role text, p_company_role uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.name from public.company_roles c where c.id = p_company_role and c.tenant_id = p_tenant and c.base_role = p_role),
    (select c.name from public.company_roles c where c.tenant_id = p_tenant and c.role_key = p_role),
    p_role)
$$;
revoke all on function public.role_display_name(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.role_display_name(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 6. who may give which role
-- ---------------------------------------------------------------------------------------------
/**
 * May this person (an active member of the company) give someone this role? Administrators give any role. Others
 * need "Invite people", and give only roles based on STAFF; a custom one only when they hold all its modules
 * themselves (so nobody hands out access they do not have). The rule HR had, as modules.
 */
create or replace function public.user_may_grant(p_user uuid, p_tenant uuid, p_base text, p_company_role uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  m public.memberships;
  mine text[];
begin
  select x.* into m from public.memberships x
  join public.tenants t on t.id = x.tenant_id and t.status = 'active'
  where x.user_id = p_user and x.tenant_id = p_tenant and x.account_status = 'ACTIVE';
  if not found then
    return false;
  end if;
  if m.role = 'ADMIN' then
    return true;
  end if;
  mine := public.role_modules(p_tenant, m.role, m.company_role_id);
  if not ('invite-people' = any (mine)) or p_base is distinct from 'STAFF' then
    return false;
  end if;
  if p_company_role is not null and exists (
    select 1 from public.company_roles c where c.id = p_company_role and c.tenant_id = p_tenant and not c.is_system
  ) then
    return public.role_modules(p_tenant, p_base, p_company_role) <@ mine;
  end if;
  return true;
end $$;
revoke all on function public.user_may_grant(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.user_may_grant(uuid, uuid, text, uuid) to service_role;

/** The signed-in person may invite people (ADMIN, or "Invite people"), in an active company, with an active login. */
create or replace function public.can_invite_people() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'ADMIN' or public.has_module('invite-people')
    from public.user_profiles p
    join public.tenants t on t.id = p.tenant_id and t.status = 'active'
    where p.user_id = auth.uid() and p.account_status = 'ACTIVE'
  ), false)
$$;
revoke all on function public.can_invite_people() from public, anon;
grant execute on function public.can_invite_people() to authenticated;

/** The signed-in person may manage the company's roles (ADMIN, or the Role Permissions module). */
create or replace function public.can_manage_roles() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'ADMIN' or public.has_module('role-permissions')
    from public.user_profiles p
    join public.tenants t on t.id = p.tenant_id and t.status = 'active'
    where p.user_id = auth.uid() and p.account_status = 'ACTIVE'
  ), false)
$$;
revoke all on function public.can_manage_roles() from public, anon;
grant execute on function public.can_manage_roles() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. role_permissions: who may change it, and what a role may hold
-- ---------------------------------------------------------------------------------------------
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
drop trigger if exists role_permissions_rules on public.role_permissions;
create trigger role_permissions_rules before insert or update on public.role_permissions
  for each row execute function public.role_permissions_rules();

-- managing roles is the Role Permissions module (administrators always have it), not the role's name
drop policy if exists "Admins can modify role permissions" on public.role_permissions;
drop policy if exists role_managers_write on public.role_permissions;
create policy role_managers_write on public.role_permissions for all to authenticated
  using ((select public.has_module('role-permissions'))) with check ((select public.has_module('role-permissions')));

-- ---------------------------------------------------------------------------------------------
-- 8. managing roles
-- ---------------------------------------------------------------------------------------------
create or replace function public.require_role_manager() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if not public.can_manage_roles() then
    raise exception 'Only an administrator can manage roles' using errcode = '42501';
  end if;
  return public.current_tenant_id();
end $$;
revoke all on function public.require_role_manager() from public, anon, authenticated;

/** Sets the modules of one of the company's roles (system or custom); the rules are role_permissions_rules(). */
create or replace function public.set_company_role_modules(p_role uuid, p_modules text[]) returns text[]
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.require_role_manager();
  cr public.company_roles;
  v_bad text;
  v_modules text[] := array(select distinct btrim(m) from unnest(coalesce(p_modules, '{}')) m where coalesce(btrim(m), '') <> '' order by 1);
  v_saved text[];
begin
  select c.* into cr from public.company_roles c where c.id = p_role and c.tenant_id = v_tenant;
  if not found then
    raise exception 'Unknown role' using errcode = '22023';
  end if;
  if not cr.is_system then
    select m into v_bad from unnest(v_modules) m where not exists (select 1 from public.permissions p where p.module_id = m) limit 1;
    if v_bad is not null then
      raise exception 'Unknown module "%"', v_bad using errcode = '22023';
    end if;
  end if;
  insert into public.role_permissions (tenant_id, role_name, permissions)
  values (v_tenant, cr.role_key, v_modules)
  on conflict (tenant_id, role_name) do update set permissions = excluded.permissions
  returning permissions into v_saved;
  return v_saved;
end $$;
revoke all on function public.set_company_role_modules(uuid, text[]) from public, anon;
grant execute on function public.set_company_role_modules(uuid, text[]) to authenticated;

create or replace function public.create_company_role(p_name text, p_base_role text, p_description text default null, p_modules text[] default '{}')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.require_role_manager();
  v_base text := upper(btrim(coalesce(p_base_role, '')));
  v_id uuid;
begin
  if not (v_base = any (public.system_role_names())) then
    raise exception 'Choose what the role is based on' using errcode = '22023';
  end if;
  if v_base = 'ADMIN' and coalesce(public.current_user_role(), '') <> 'ADMIN' then
    raise exception 'Only an administrator can create a role based on Administrator' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 60 then
    raise exception 'A role''s name must be 1 to 60 characters' using errcode = '22023';
  end if;
  if exists (select 1 from public.company_roles c where c.tenant_id = v_tenant and lower(btrim(c.name)) = lower(btrim(p_name))) then
    raise exception 'There is already a role called "%"', btrim(p_name) using errcode = '23505';
  end if;
  insert into public.company_roles (tenant_id, name, description, base_role, is_system, created_by, role_key)
  values (v_tenant, p_name, p_description, v_base, false, auth.uid(), 'CR_00000000000000000000000000000000')
  returning id into v_id;
  perform public.set_company_role_modules(v_id, p_modules);
  return v_id;
end $$;
revoke all on function public.create_company_role(text, text, text, text[]) from public, anon;
grant execute on function public.create_company_role(text, text, text, text[]) to authenticated;

/** Renames, describes, or switches a role on or off (a null argument leaves that as it is). System roles: name and description only. */
create or replace function public.update_company_role(p_role uuid, p_name text default null, p_description text default null, p_active boolean default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.require_role_manager();
  cr public.company_roles;
begin
  select c.* into cr from public.company_roles c where c.id = p_role and c.tenant_id = v_tenant;
  if not found then
    raise exception 'Unknown role' using errcode = '22023';
  end if;
  if cr.base_role = 'ADMIN' and coalesce(public.current_user_role(), '') <> 'ADMIN' then
    raise exception 'Only an administrator can change an administrator role' using errcode = '42501';
  end if;
  if p_active is false and cr.is_system then
    raise exception 'The system roles cannot be switched off' using errcode = '42501';
  end if;
  if p_name is not null then
    if char_length(btrim(p_name)) not between 1 and 60 then
      raise exception 'A role''s name must be 1 to 60 characters' using errcode = '22023';
    end if;
    if exists (select 1 from public.company_roles c
               where c.tenant_id = v_tenant and c.id <> p_role and lower(btrim(c.name)) = lower(btrim(p_name))) then
      raise exception 'There is already a role called "%"', btrim(p_name) using errcode = '23505';
    end if;
  end if;
  update public.company_roles c
    set name = coalesce(p_name, c.name),
        description = case when p_description is null then c.description else p_description end,
        active = coalesce(p_active, c.active)
    where c.id = p_role;
end $$;
revoke all on function public.update_company_role(uuid, text, text, boolean) from public, anon;
grant execute on function public.update_company_role(uuid, text, text, boolean) to authenticated;

/** Deletes a custom role nobody holds (company_roles_rules() refuses otherwise), with its modules. */
create or replace function public.delete_company_role(p_role uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.require_role_manager();
  cr public.company_roles;
begin
  select c.* into cr from public.company_roles c where c.id = p_role and c.tenant_id = v_tenant;
  if not found then
    raise exception 'Unknown role' using errcode = '22023';
  end if;
  if cr.base_role = 'ADMIN' and coalesce(public.current_user_role(), '') <> 'ADMIN' then
    raise exception 'Only an administrator can change an administrator role' using errcode = '42501';
  end if;
  delete from public.company_roles where id = p_role;
  delete from public.role_permissions where tenant_id = v_tenant and role_name = cr.role_key;
end $$;
revoke all on function public.delete_company_role(uuid) from public, anon;
grant execute on function public.delete_company_role(uuid) to authenticated;

/** How many active people hold each of the company's roles (by role key), for the roles screen. */
create or replace function public.company_role_holders() returns table (role_key text, people integer)
language sql stable security definer set search_path = public as $$
  select coalesce(cr.role_key, m.role), count(*)::integer
  from public.memberships m
  left join public.company_roles cr on cr.id = m.company_role_id
  where m.tenant_id = public.current_tenant_id() and public.can_manage_roles()
  group by 1
$$;
revoke all on function public.company_role_holders() from public, anon;
grant execute on function public.company_role_holders() to authenticated;

/**
 * Gives a member of the company one of its roles (their base role follows from it). Same rule as inviting
 * (user_may_grant) for both the role they have and the one they get; nobody changes their own role.
 */
create or replace function public.assign_company_role(p_user uuid, p_role uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  target public.memberships;
  cr public.company_roles;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'You cannot change your own role' using errcode = '42501';
  end if;
  select m.* into target from public.memberships m where m.user_id = p_user and m.tenant_id = v_tenant;
  if not found then
    raise exception 'That person is not in this company' using errcode = '22023';
  end if;
  select c.* into cr from public.company_roles c where c.id = p_role and c.tenant_id = v_tenant;
  if not found then
    raise exception 'Unknown role' using errcode = '22023';
  end if;
  if not cr.active then
    raise exception 'The role "%" is switched off', cr.name using errcode = '22023';
  end if;
  if not public.user_may_grant(auth.uid(), v_tenant, target.role, target.company_role_id)
     or not public.user_may_grant(auth.uid(), v_tenant, cr.base_role, cr.id) then
    raise exception 'Only an administrator can give this role' using errcode = '42501';
  end if;
  update public.memberships set company_role_id = cr.id where user_id = p_user and tenant_id = v_tenant;
end $$;
revoke all on function public.assign_company_role(uuid, uuid) from public, anon;
grant execute on function public.assign_company_role(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 9. invitations with a company role
-- ---------------------------------------------------------------------------------------------
drop function if exists public.create_invitation(text, text);
create or replace function public.create_invitation(p_email text, p_role text, p_company_role_id uuid default null)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $_$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_tenant uuid;
  v_role text := upper(btrim(coalesce(p_role, '')));
  cr public.company_roles;
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  v_tenant := public.current_tenant_id();
  if v_tenant is null or not public.can_invite_people() then
    raise exception 'Only an administrator or HR can invite people' using errcode = '42501';
  end if;
  if p_company_role_id is not null then
    select c.* into cr from public.company_roles c where c.id = p_company_role_id and c.tenant_id = v_tenant and c.active;
    if not found then
      raise exception 'Unknown role' using errcode = '22023';
    end if;
    v_role := cr.base_role;
  elsif not (v_role = any (public.system_role_names())) then
    raise exception 'Unknown role' using errcode = '22023';
  end if;
  -- the rule HR had (staff only), as modules: see user_may_grant()
  if not public.user_may_grant(auth.uid(), v_tenant, v_role, p_company_role_id) then
    raise exception 'Only an administrator can invite this role' using errcode = '42501';
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(v_email) > 254 then
    raise exception 'A valid email is required' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.tenant_id = v_tenant and lower(u.email) = v_email
  ) then
    raise exception 'That person is already in this company' using errcode = '23505';
  end if;

  -- one open invitation per address and company: a new one replaces the old link
  update public.invitations set status = 'revoked'
  where tenant_id = v_tenant and lower(email) = v_email and status = 'pending';

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.invitations (tenant_id, email, role, company_role_id, token_hash, invited_by)
  values (v_tenant, v_email, v_role, p_company_role_id, public.hash_invite_token(v_token), auth.uid())
  returning id, invitations.expires_at into v_id, v_expires;

  return query select v_id, v_token, v_expires;
end;
$_$;
revoke all on function public.create_invitation(text, text, uuid) from public, anon;
grant execute on function public.create_invitation(text, text, uuid) to authenticated, service_role;

create or replace function public.revoke_invitation(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null or not public.can_invite_people() then
    raise exception 'Only an administrator or HR can cancel invitations' using errcode = '42501';
  end if;
  update public.invitations set status = 'revoked'
  where id = p_id and tenant_id = v_tenant and status = 'pending';
end;
$$;

-- the role an invitation gives, if it can still be given: a company role still in use, else none (the base role)
create or replace function public.invitation_company_role(p_tenant uuid, p_role text, p_company_role uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select c.id from public.company_roles c
  where c.id = p_company_role and c.tenant_id = p_tenant and c.base_role = p_role and c.active
$$;
revoke all on function public.invitation_company_role(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.invitation_company_role(uuid, text, uuid) to service_role;

create or replace function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_inv public.invitations;
  v_email text;
  v_company_role uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select i.* into v_inv
  from public.invitations i
  join public.tenants t on t.id = i.tenant_id and t.status = 'active'
  where i.token_hash = public.hash_invite_token(p_token) and i.status = 'pending' and i.expires_at > now()
  for update of i;
  if not found then
    raise exception 'This invitation is not valid any more' using errcode = '22023';
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();
  if v_email is distinct from lower(v_inv.email) then
    raise exception 'This invitation was sent to a different email address' using errcode = '42501';
  end if;

  v_company_role := public.invitation_company_role(v_inv.tenant_id, v_inv.role, v_inv.company_role_id);
  insert into public.memberships (user_id, tenant_id, role, company_role_id, account_status)
  values (auth.uid(), v_inv.tenant_id, v_inv.role, v_company_role, 'ACTIVE')
  on conflict (user_id, tenant_id) do update
    set role = excluded.role, company_role_id = excluded.company_role_id, account_status = 'ACTIVE';

  -- they joined to work there: make it their current company
  update public.user_profiles
    set tenant_id = v_inv.tenant_id, role = v_inv.role, account_status = 'ACTIVE'
    where user_id = auth.uid();

  update public.invitations
    set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
    where id = v_inv.id;

  return v_inv.tenant_id;
end;
$$;

create or replace function public.accept_my_invitation(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_inv public.invitations;
  v_email text;
  v_confirmed timestamptz;
  v_company_role uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = auth.uid();
  if v_confirmed is null then
    raise exception 'Confirm your email address first' using errcode = '42501';
  end if;

  select i.* into v_inv
  from public.invitations i
  join public.tenants t on t.id = i.tenant_id and t.status = 'active'
  where i.id = p_id and i.status = 'pending' and i.expires_at > now() and lower(i.email) = v_email
  for update of i;
  if not found then
    raise exception 'This invitation is not valid any more' using errcode = '22023';
  end if;

  v_company_role := public.invitation_company_role(v_inv.tenant_id, v_inv.role, v_inv.company_role_id);
  insert into public.memberships (user_id, tenant_id, role, company_role_id, account_status)
  values (auth.uid(), v_inv.tenant_id, v_inv.role, v_company_role, 'ACTIVE')
  on conflict (user_id, tenant_id) do update
    set role = excluded.role, company_role_id = excluded.company_role_id, account_status = 'ACTIVE';

  update public.user_profiles
    set tenant_id = v_inv.tenant_id, role = v_inv.role, account_status = 'ACTIVE'
    where user_id = auth.uid();

  update public.invitations
    set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
    where id = v_inv.id;

  return v_inv.tenant_id;
end;
$$;

-- the invitation page and the "waiting for you" list show the role by its name in that company
drop function if exists public.invitation_preview(text);
create or replace function public.invitation_preview(p_token text)
returns table (company_name text, email text, role text, role_name text)
language sql stable security definer set search_path = public as $$
  select t.name, i.email, i.role, public.role_display_name(i.tenant_id, i.role, i.company_role_id)
  from public.invitations i
  join public.tenants t on t.id = i.tenant_id and t.status = 'active'
  where i.token_hash = public.hash_invite_token(p_token) and i.status = 'pending' and i.expires_at > now()
$$;
revoke all on function public.invitation_preview(text) from public;
grant execute on function public.invitation_preview(text) to anon, authenticated, service_role;

drop function if exists public.my_pending_invitations();
create or replace function public.my_pending_invitations()
returns table (id uuid, company_name text, role text, expires_at timestamptz, role_name text)
language sql stable security definer set search_path = public as $$
  select i.id, t.name, i.role, i.expires_at, public.role_display_name(i.tenant_id, i.role, i.company_role_id)
  from public.invitations i
  join public.tenants t on t.id = i.tenant_id and t.status = 'active'
  join auth.users u on u.id = auth.uid()
  where u.email_confirmed_at is not null
    and lower(u.email) = lower(i.email)
    and i.status = 'pending'
    and i.expires_at > now()
  order by i.created_at desc
$$;
revoke all on function public.my_pending_invitations() from public, anon;
grant execute on function public.my_pending_invitations() to authenticated, service_role;

-- who reads the company's invitations and the bulk queue: whoever may invite, not a list of role names
drop policy if exists invitations_admin_read on public.invitations;
create policy invitations_admin_read on public.invitations for select to authenticated
  using ((select public.can_invite_people()));
drop policy if exists inviters_read on public.invite_queue;
create policy inviters_read on public.invite_queue for select to authenticated
  using ((select public.can_invite_people()));

-- the caller's role in the company they work in, when they may invite people; else nulls
create or replace function public.inviter_role(out role text, out tenant_id uuid)
language sql stable security definer set search_path = public as $$
  select p.role, p.tenant_id
  from public.user_profiles p
  join public.tenants t on t.id = p.tenant_id and t.status = 'active'
  where p.user_id = auth.uid() and p.account_status = 'ACTIVE' and public.can_invite_people()
$$;
revoke all on function public.inviter_role() from public, anon, authenticated;

/**
 * Queues invitations: p_people is [{ "email": ..., "role": "STAFF", "company_role_id": null }, ...] (at most 1000).
 * The same checks as create_invitation(). Someone already in the company is recorded as skipped; an address already
 * waiting is moved into this batch. Returns the batch and the addresses refused, with why.
 */
create or replace function public.enqueue_invitations(p_people jsonb, p_batch uuid default null)
returns table (batch_id uuid, queued integer, skipped integer, rejected jsonb)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  me record;
  v_batch uuid := coalesce(p_batch, gen_random_uuid());
  v_queued integer := 0;
  v_skipped integer := 0;
  v_rejected jsonb := '[]'::jsonb;
  p record;
  problem text;
  v_role text;
  v_company_role uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select * into me from public.inviter_role();
  if me.tenant_id is null then
    raise exception 'Only an administrator or HR can invite people' using errcode = '42501';
  end if;
  if jsonb_typeof(p_people) is distinct from 'array' then
    raise exception 'The people to invite must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_people) > 1000 then
    raise exception 'Queue at most 1000 people at a time' using errcode = '22023';
  end if;

  for p in
    with wanted as (
      select distinct on (lower(btrim(coalesce(x->>'email', ''))))
        lower(btrim(coalesce(x->>'email', ''))) as email,
        coalesce(nullif(upper(btrim(x->>'role')), ''), 'STAFF') as role,
        nullif(btrim(coalesce(x->>'company_role_id', '')), '') as company_role,
        case when btrim(coalesce(x->>'company_role_id', '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then btrim(x->>'company_role_id')::uuid end as company_role_uuid
      from jsonb_array_elements(p_people) x
      order by 1
    ),
    -- who is in the company already, looked up once for the whole list
    members as (
      select distinct lower(u.email) as email
      from public.memberships m join auth.users u on u.id = m.user_id
      where m.tenant_id = me.tenant_id
    )
    select w.email, w.role, w.company_role, (mb.email is not null) as is_member,
           c.id as cr_id, c.base_role as cr_base
    from wanted w
    left join members mb on mb.email = w.email
    left join public.company_roles c on c.id = w.company_role_uuid and c.tenant_id = me.tenant_id and c.active
    order by w.email
  loop
    v_role := coalesce(p.cr_base, p.role);
    v_company_role := p.cr_id;
    problem := case
      when p.email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(p.email) > 254 then 'not a valid email address'
      when p.company_role is not null and p.cr_id is null then 'unknown role'
      when not (v_role = any (public.system_role_names())) then 'unknown role'
      when not public.user_may_grant(auth.uid(), me.tenant_id, v_role, v_company_role) then 'only an administrator can invite this role'
    end;
    if problem is not null then
      v_rejected := v_rejected || jsonb_build_object('email', p.email, 'reason', problem);
      continue;
    end if;

    if p.is_member then
      insert into public.invite_queue (tenant_id, batch_id, email, role, company_role_id, status, error, requested_by)
      values (me.tenant_id, v_batch, p.email, v_role, v_company_role, 'skipped', 'already has access to this company', auth.uid());
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- already waiting to be sent: counted in this batch instead
    update public.invite_queue q set batch_id = v_batch,
      role = case when q.status = 'queued' then v_role else q.role end,
      company_role_id = case when q.status = 'queued' then v_company_role else q.company_role_id end,
      requested_by = auth.uid(), updated_at = now()
    where q.tenant_id = me.tenant_id and lower(q.email) = p.email and q.status in ('queued', 'sending');
    if not found then
      insert into public.invite_queue (tenant_id, batch_id, email, role, company_role_id, requested_by)
      values (me.tenant_id, v_batch, p.email, v_role, v_company_role, auth.uid());
    end if;
    v_queued := v_queued + 1;
  end loop;

  return query select v_batch, v_queued, v_skipped, v_rejected;
end $$;
revoke all on function public.enqueue_invitations(jsonb, uuid) from public, anon;
grant execute on function public.enqueue_invitations(jsonb, uuid) to authenticated;

/** Puts a batch's failed invitations back in the queue (only those the caller may still give). Returns how many. */
create or replace function public.retry_failed_invitations(p_batch uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  me record;
  n integer;
begin
  select * into me from public.inviter_role();
  if me.tenant_id is null then
    raise exception 'Only an administrator or HR can invite people' using errcode = '42501';
  end if;
  update public.invite_queue q
  set status = 'queued', attempts = 0, error = null, next_attempt_at = now(), requested_by = auth.uid(), updated_at = now()
  where q.tenant_id = me.tenant_id and q.batch_id = p_batch and q.status = 'failed'
    and public.user_may_grant(auth.uid(), me.tenant_id, q.role, q.company_role_id)
    -- one already waiting again (queued from another upload) stays failed here
    and not exists (select 1 from public.invite_queue o
                    where o.tenant_id = q.tenant_id and lower(o.email) = lower(q.email) and o.status in ('queued', 'sending'));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.retry_failed_invitations(uuid) from public, anon;
grant execute on function public.retry_failed_invitations(uuid) to authenticated;

/**
 * The invitations to email now (as 20261014300000), each with a fresh link token. The person who queued each one must
 * still be allowed to give its role (user_may_grant). role_name is the role as the company names it, for the email.
 */
drop function if exists public.claim_invitations(integer);
create or replace function public.claim_invitations(p_limit integer default 100)
returns table (
  id bigint, tenant_id uuid, email text, role text, token text, expires_at timestamptz,
  company_name text, inviter_email text, role_name text
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  q record;
  v_token text;
  v_id uuid;
  v_expires timestamptz;
  v_company_role uuid;
begin
  for q in
    select iq.* from public.invite_queue iq
    where (iq.status = 'queued' and iq.next_attempt_at <= now())
       or (iq.status = 'sending' and iq.claimed_at < now() - interval '10 minutes')
    order by iq.id
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
    for update skip locked
  loop
    if q.attempts >= 5 then
      update public.invite_queue set status = 'failed', error = coalesce(error, 'not sent after 5 attempts'), updated_at = now()
      where invite_queue.id = q.id;
      continue;
    end if;

    -- the person who queued it must still be allowed to invite this role here
    if not public.user_may_grant(q.requested_by, q.tenant_id, q.role, q.company_role_id) then
      update public.invite_queue set status = 'failed', updated_at = now(),
        error = 'the person who sent this can no longer invite people to this company'
      where invite_queue.id = q.id;
      continue;
    end if;

    v_company_role := public.invitation_company_role(q.tenant_id, q.role, q.company_role_id);
    if q.company_role_id is not null and v_company_role is null then
      update public.invite_queue set status = 'failed', updated_at = now(), error = 'the role was switched off'
      where invite_queue.id = q.id;
      continue;
    end if;

    if exists (
      select 1 from public.memberships m join auth.users u on u.id = m.user_id
      where m.tenant_id = q.tenant_id and lower(u.email) = lower(q.email)
    ) then
      update public.invite_queue set status = 'skipped', error = 'already has access to this company', updated_at = now()
      where invite_queue.id = q.id;
      continue;
    end if;

    -- one open invitation per address and company: a new one replaces the old link (as create_invitation)
    update public.invitations i set status = 'revoked'
    where i.tenant_id = q.tenant_id and lower(i.email) = lower(q.email) and i.status = 'pending';

    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.invitations (tenant_id, email, role, company_role_id, token_hash, invited_by)
    values (q.tenant_id, lower(q.email), q.role, v_company_role, public.hash_invite_token(v_token), q.requested_by)
    returning invitations.id, invitations.expires_at into v_id, v_expires;

    update public.invite_queue set status = 'sending', attempts = attempts + 1, claimed_at = now(),
      invitation_id = v_id, updated_at = now()
    where invite_queue.id = q.id;

    return query
      select q.id, q.tenant_id, lower(q.email), q.role, v_token, v_expires,
             (select t.name from public.tenants t where t.id = q.tenant_id),
             (select u.email::text from auth.users u where u.id = q.requested_by),
             public.role_display_name(q.tenant_id, q.role, v_company_role);
  end loop;
end $$;
revoke all on function public.claim_invitations(integer) from public, anon, authenticated;
grant execute on function public.claim_invitations(integer) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 10. new companies copy the default company's SYSTEM roles only (not its own custom roles)
-- ---------------------------------------------------------------------------------------------
create or replace function public.create_company(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_base text;
  v_slug text;
  v_tenant uuid;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'Company name must be 2 to 80 characters' using errcode = '22023';
  end if;

  -- a person can own a handful of companies; this is a guard against a runaway client, not a business rule
  select count(*) into v_count from public.memberships where user_id = auth.uid() and role = 'ADMIN';
  if v_count >= 10 then
    raise exception 'You already administer 10 companies' using errcode = '22023';
  end if;

  v_base := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
  v_base := btrim(v_base, '-');
  if char_length(v_base) < 3 then v_base := v_base || '-co'; end if;
  v_base := left(v_base, 30);
  v_base := btrim(v_base, '-');
  v_slug := v_base;
  while exists (select 1 from public.tenants where slug = v_slug) loop
    v_slug := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 5);
  end loop;

  -- (its seven system roles are added by the company_roles_for_new_company trigger)
  insert into public.tenants (name, slug, plan) values (v_name, v_slug, 'trial') returning id into v_tenant;

  -- the new company starts with the same role permissions as the default one, so its roles work straight away
  insert into public.role_permissions (tenant_id, role_name, permissions)
  select v_tenant, rp.role_name, rp.permissions
  from public.role_permissions rp
  where rp.tenant_id = '00000000-0000-0000-0000-000000000001'
    and rp.role_name = any (public.system_role_names());

  -- every company starts with a general channel, so the chat is never an empty screen
  insert into public.channels (tenant_id, name, description, type, is_private, created_by, is_default)
  values (v_tenant, 'general', 'Company-wide chat and announcements', 'channel', false, auth.uid(), true);

  -- and a standard set of leave types, which they can edit
  perform public.seed_default_leave_types(v_tenant);

  -- their first membership makes it their current company; with existing ones, switch to the new one
  insert into public.memberships (user_id, tenant_id, role, account_status)
  values (auth.uid(), v_tenant, 'ADMIN', 'ACTIVE');
  update public.user_profiles
    set tenant_id = v_tenant, role = 'ADMIN', account_status = 'ACTIVE'
    where user_id = auth.uid();

  return v_tenant;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 11. the audit trail: roles, their modules, and who holds which
-- ---------------------------------------------------------------------------------------------
create or replace function public.audit_roles_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  v_table text := tg_table_name;
  v_key text;
  v_old jsonb;
  v_new jsonb;
  v_record uuid;
begin
  -- changes people make (not migrations or maintenance), in a company that still exists
  if auth.uid() is null or not exists (select 1 from public.tenants t where t.id = v_tenant) then
    return null;
  end if;
  -- setting up a company (its system roles, and the permissions a new company copies) is not a change to record
  -- (nested: a condition on a column only one of the tables has is only worked out for that table)
  if tg_op = 'INSERT' and tg_table_name = 'company_roles' then
    if new.is_system then
      return null;
    end if;
  end if;
  if tg_op = 'INSERT' and tg_table_name = 'role_permissions' then
    if new.tenant_id is distinct from public.current_tenant_id() then
      return null;
    end if;
  end if;

  if tg_table_name = 'company_roles' then
    v_record := coalesce(new.id, old.id);
    v_key := coalesce(new.name, old.name);
    v_old := case when tg_op <> 'INSERT' then jsonb_build_object('name', old.name, 'description', old.description,
               'based_on', public.role_display_name(old.tenant_id, old.base_role, null), 'active', old.active) end;
    v_new := case when tg_op <> 'DELETE' then jsonb_build_object('name', new.name, 'description', new.description,
               'based_on', public.role_display_name(new.tenant_id, new.base_role, null), 'active', new.active) end;
  elsif tg_table_name = 'role_permissions' then
    v_record := coalesce(new.id, old.id);
    v_key := coalesce((select c.name from public.company_roles c
                       where c.tenant_id = v_tenant and c.role_key = coalesce(new.role_name, old.role_name)),
                      coalesce(new.role_name, old.role_name));
    v_old := case when tg_op <> 'INSERT' then jsonb_build_object('modules', to_jsonb(coalesce(old.permissions, '{}'))) end;
    v_new := case when tg_op <> 'DELETE' then jsonb_build_object('modules', to_jsonb(coalesce(new.permissions, '{}'))) end;
  else
    -- memberships: who holds which role
    v_table := 'role_assignments';
    v_key := coalesce((select u.email::text from auth.users u where u.id = coalesce(new.user_id, old.user_id)), coalesce(new.user_id, old.user_id)::text);
    v_old := case when tg_op <> 'INSERT' then jsonb_build_object('role', public.role_display_name(old.tenant_id, old.role, old.company_role_id)) end;
    v_new := case when tg_op <> 'DELETE' then jsonb_build_object('role', public.role_display_name(new.tenant_id, new.role, new.company_role_id)) end;
  end if;

  if v_old is not distinct from v_new then
    return null;
  end if;
  insert into public.audit_log (tenant_id, record_id, record_key, table_name, action_type, old_data, new_data, performed_by)
  values (v_tenant, v_record, v_key, v_table, tg_op, v_old, v_new, auth.uid());
  return null;
end $$;
drop trigger if exists audit_company_roles on public.company_roles;
create trigger audit_company_roles after insert or update or delete on public.company_roles
  for each row execute function public.audit_roles_change();
drop trigger if exists audit_role_permissions on public.role_permissions;
create trigger audit_role_permissions after insert or update or delete on public.role_permissions
  for each row execute function public.audit_roles_change();
drop trigger if exists audit_role_assignments on public.memberships;
create trigger audit_role_assignments after update of role, company_role_id on public.memberships
  for each row execute function public.audit_roles_change();

notify pgrst, 'reload schema';
