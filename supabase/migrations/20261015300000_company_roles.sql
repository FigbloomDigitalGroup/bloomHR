-- Companies make their own roles (FIG-827). Until now every company had the same fixed roles (ADMIN, HR, CHECKER,
-- MANAGER, REGIONAL, OPERATIONS, STAFF) and some rules named them. Now:
--
--   * A role is a row of role_permissions, as before: role_name is its key (what memberships.role, user_profiles.role,
--     invitations.role and invite_queue.role hold) and permissions its modules. It gains a display_name, a
--     description and is_system. Renaming changes the display name only, never the key, so nothing that refers to
--     a role has to change with it and a rename cannot leave anyone pointing at a role that is gone.
--   * Two roles are built in (is_system): ADMIN (every module, always; cannot be changed or deleted) and STAFF (the
--     self-service baseline; its name and modules can change, but it cannot be deleted). The other five are now
--     ordinary roles of each company, with the modules they have today, so nothing changes for anyone.
--   * Who manages roles: ADMIN, or a role with the 'role-permissions' module. Anyone but ADMIN can only give a role
--     modules they have themselves, and only change or delete roles whose modules they have themselves.
--     A role is created with create_company_role() (it picks the key), changed with an ordinary update, and
--     deleted with delete_company_role(), which refuses while people, open invitations or queued invitations use it
--     unless a replacement role is given (it moves them in the same transaction). A direct delete of a role in use
--     is refused too.
--   * Rules that named roles now use modules:
--       - inviting people (create_invitation, enqueue_invitations, retry_failed_invitations, claim_invitations,
--         revoke_invitation, inviter_role, the invitations and invite_queue read policies), was ADMIN or HR:
--         the new 'invite-people' module (seeded to every company's HR role). What role someone may be given is
--         decided by can_assign_role(): ADMIN may give any role; someone with 'invite-people' only a role with less
--         access than their own (all its modules are theirs, and it lacks some), and always STAFF; never ADMIN.
--         For the seeded roles that is exactly the old rule: HR invites STAFF only.
--         The backend (admin_routes.js) asks the same function when it creates or changes a login.
--       - creating chat channels, was ADMIN, HR or MANAGER: the new 'create-channels' module (seeded to those roles).
--       - the unknown-role checks (a fixed list of seven): the role must exist in the company.
--       - editing role permissions, was ADMIN: ADMIN or 'role-permissions' (above).
--     Checks that mean "the company's administrator" (moderating chat, the ADMIN role's own rules, the ten-company
--     limit) keep naming ADMIN: it is the built-in role that cannot be changed.
--   * create_company() starts a new company with the seven built-in roles of the default company only (no longer
--     every role the default company has made for itself).

-- ---------------------------------------------------------------------------------------------
-- 1. roles: a display name, a description, and the built-in ones marked
-- ---------------------------------------------------------------------------------------------
alter table public.role_permissions add column if not exists display_name text;
alter table public.role_permissions add column if not exists description text;
alter table public.role_permissions add column if not exists is_system boolean
  generated always as (coalesce(role_name in ('ADMIN', 'STAFF'), false)) stored;

-- the seven roles every company started with (their keys stay valid wherever they are already used)
create or replace function public.fixed_role_keys() returns text[]
language sql immutable set search_path = public as $$
  select array['ADMIN', 'HR', 'CHECKER', 'MANAGER', 'REGIONAL', 'OPERATIONS', 'STAFF']
$$;

-- the name a role is shown by when it is given none: the built-in labels, else its key in words
create or replace function public.default_role_label(p_key text) returns text
language sql immutable set search_path = public as $$
  select case p_key
    when 'ADMIN' then 'Administrator'
    when 'HR' then 'Human Resources'
    when 'CHECKER' then 'Checker'
    when 'MANAGER' then 'Manager'
    when 'REGIONAL' then 'Regional Manager'
    when 'OPERATIONS' then 'Operations'
    when 'STAFF' then 'Staff'
    else initcap(replace(lower(coalesce(p_key, 'role')), '_', ' '))
  end
$$;

-- A role must now exist in the company to be given, and its row is what a rule reads instead of the name. Every
-- company gets the two built-in roles, and a row for each fixed role its people or invitations already use; a row
-- added here has no modules, which is what someone in a role without a row had until now.
insert into public.role_permissions (tenant_id, role_name, permissions)
select t.id, k.key, '{}'
from public.tenants t
cross join (values ('ADMIN'), ('HR'), ('CHECKER'), ('MANAGER'), ('REGIONAL'), ('OPERATIONS'), ('STAFF')) k(key)
where not exists (select 1 from public.role_permissions r where r.tenant_id = t.id and r.role_name = k.key)
  and (k.key in ('ADMIN', 'STAFF')
       or exists (select 1 from public.memberships m where m.tenant_id = t.id and m.role = k.key)
       or exists (select 1 from public.user_profiles p where p.tenant_id = t.id and p.role = k.key)
       or exists (select 1 from public.invitations i where i.tenant_id = t.id and i.role = k.key and i.status = 'pending')
       or exists (select 1 from public.invite_queue q where q.tenant_id = t.id and q.role = k.key and q.status in ('queued', 'sending', 'failed')));

update public.role_permissions set
  display_name = public.default_role_label(role_name),
  description = coalesce(description, case role_name
    when 'ADMIN' then 'Full system access & configuration'
    when 'HR' then 'Employee & payroll management'
    when 'CHECKER' then 'Verification & approval workflows'
    when 'MANAGER' then 'Team oversight & reporting'
    when 'REGIONAL' then 'Multi-branch supervision'
    when 'OPERATIONS' then 'Day-to-day system operations'
    when 'STAFF' then 'Basic portal access'
  end)
where display_name is null;
-- two rows of one company that came out with the same name (e.g. 'HR' and 'hr') are told apart by their key
update public.role_permissions rp set display_name = rp.display_name || ' (' || rp.role_name || ')'
from (
  select id, row_number() over (partition by tenant_id, lower(display_name) order by created_at, id) n
  from public.role_permissions
) d
where d.id = rp.id and d.n > 1;
create unique index if not exists role_permissions_display_name_key on public.role_permissions (tenant_id, lower(display_name));

-- ---------------------------------------------------------------------------------------------
-- 2. two new modules for what roles used to decide by name
-- ---------------------------------------------------------------------------------------------
insert into public.permissions (module_id, module_name, description, category) values
  ('invite-people', 'Invite People', 'Invite people to the company and manage logins of roles within your own access', 'people-hr'),
  ('create-channels', 'Create Channels', 'Create chat channels in Teams', 'workspace')
on conflict (module_id) do nothing;

-- who could do it before keeps it (in every company, and the default company new ones are copied from)
update public.role_permissions set permissions = coalesce(permissions, '{}') || array['invite-people']
where role_name in ('ADMIN', 'HR') and not ('invite-people' = any (coalesce(permissions, '{}')));
update public.role_permissions set permissions = coalesce(permissions, '{}') || array['create-channels']
where role_name in ('ADMIN', 'HR', 'MANAGER') and not ('create-channels' = any (coalesce(permissions, '{}')));

-- ---------------------------------------------------------------------------------------------
-- 3. what a member may do with roles
-- ---------------------------------------------------------------------------------------------
-- The modules of a member's role in a company (ADMIN: every module); null when they are not an active member of it.
create or replace function public.member_modules(p_user uuid, p_tenant uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when m.role = 'ADMIN' then (select coalesce(array_agg(p.module_id::text), '{}') from public.permissions p)
    else coalesce((select rp.permissions from public.role_permissions rp
                   where rp.tenant_id = m.tenant_id and rp.role_name = m.role), '{}')
  end
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id and t.status = 'active'
  where m.user_id = p_user and m.tenant_id = p_tenant and m.account_status = 'ACTIVE'
$$;
revoke all on function public.member_modules(uuid, uuid) from public, anon, authenticated;

-- Is the role within the member's reach: never ADMIN unless they are ADMIN, and otherwise only a role whose modules
-- they all have themselves (so nobody can hand out access they lack). p_below also leaves out roles with all of the
-- member's own access (their own role, or one just like it): what they may give other people.
create or replace function public.role_within_reach(p_user uuid, p_tenant uuid, p_role text, p_below boolean default false)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when m.role = 'ADMIN' then true
      when p_role = 'ADMIN' then false
      else r.perms <@ mine.perms and not (p_below and mine.perms <@ r.perms)
    end
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id and t.status = 'active'
    cross join lateral (select coalesce(public.member_modules(p_user, p_tenant), '{}') as perms) mine
    cross join lateral (select coalesce((select rp.permissions from public.role_permissions rp
                                         where rp.tenant_id = p_tenant and rp.role_name = p_role), '{}') as perms) r
    where m.user_id = p_user and m.tenant_id = p_tenant and m.account_status = 'ACTIVE'
  ), false)
$$;
revoke all on function public.role_within_reach(uuid, uuid, text, boolean) from public, anon, authenticated;

/**
 * May this member give someone this role in the company (invite them with it, or set it on their login)? The role
 * must exist there; ADMIN may give any; someone with 'invite-people' a role with less access than their own: all of
 * its modules are theirs, and it lacks some of theirs (so HR gives STAFF, not HR). Never ADMIN. STAFF, the
 * self-service baseline everyone joins with, can always be given by someone with 'invite-people' (as HR always could),
 * whatever modules the company has given it.
 * Used by the invitation functions and, with the service key, by the backend (admin_routes.js).
 */
create or replace function public.can_assign_role(p_user uuid, p_tenant uuid, p_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (exists (select 1 from public.role_permissions rp where rp.tenant_id = p_tenant and rp.role_name = p_role)
     -- STAFF is always valid, and an administrator may still give one of the seven fixed roles in a company that
     -- has no row for it (as before; it grants no modules there)
     or p_role = 'STAFF'
     or (p_role = any (public.fixed_role_keys())
         and exists (select 1 from public.memberships m where m.user_id = p_user and m.tenant_id = p_tenant and m.role = 'ADMIN')))
    and 'invite-people' = any (public.member_modules(p_user, p_tenant))
    and (p_role = 'STAFF' or public.role_within_reach(p_user, p_tenant, p_role, true)),
  false)
$$;
revoke all on function public.can_assign_role(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.can_assign_role(uuid, uuid, text) to service_role;

-- Does anyone use the role: members, open invitations, invitations waiting in the queue.
create or replace function public.role_in_use(p_tenant uuid, p_role text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  -- the role guard calls this as the signed-in user, always for their own company; nobody may ask about another
  if auth.uid() is not null and p_tenant is distinct from public.current_tenant_id() then
    raise exception 'Not your company' using errcode = '42501';
  end if;
  return exists (select 1 from public.memberships m where m.tenant_id = p_tenant and m.role = p_role)
      or exists (select 1 from public.user_profiles p where p.tenant_id = p_tenant and p.role = p_role)
      or exists (select 1 from public.invitations i where i.tenant_id = p_tenant and i.role = p_role and i.status = 'pending')
      or exists (select 1 from public.invite_queue q where q.tenant_id = p_tenant and q.role = p_role and q.status in ('queued', 'sending'));
end $$;
revoke all on function public.role_in_use(uuid, text) from public, anon;
grant execute on function public.role_in_use(uuid, text) to authenticated, service_role;

/** The roles of the company the signed-in person may give someone (for the invite and user screens). */
create or replace function public.assignable_roles()
returns table (role_name text, display_name text)
language sql stable security definer set search_path = public as $$
  select rp.role_name, rp.display_name
  from public.role_permissions rp
  where rp.tenant_id = public.current_tenant_id()
    and public.can_assign_role(auth.uid(), rp.tenant_id, rp.role_name)
  order by rp.role_name = 'STAFF' desc, rp.display_name
$$;
revoke all on function public.assignable_roles() from public, anon;
grant execute on function public.assignable_roles() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. writing roles: who may, and what
-- ---------------------------------------------------------------------------------------------
-- Security invoker on purpose: current_user tells a signed-in person writing directly (authenticated) from the
-- backend, a migration or one of the functions above (which check the caller themselves).
create or replace function public.guard_role_permissions() returns trigger
language plpgsql set search_path = public as $$
declare
  v_end_user boolean := current_user in ('authenticated', 'anon');
  v_mine text[];
begin
  if tg_op = 'DELETE' then
    if v_end_user and old.role_name in ('ADMIN', 'STAFF') then
      raise exception 'The % role is built in and cannot be deleted', public.default_role_label(old.role_name) using errcode = '42501';
    end if;
    if public.role_in_use(old.tenant_id, old.role_name) then
      raise exception 'The role "%" is still in use: choose a role to move its people to', coalesce(old.display_name, old.role_name)
        using errcode = '23503';
    end if;
  else
    new.display_name := nullif(btrim(coalesce(new.display_name, '')), '');
    new.display_name := coalesce(new.display_name, public.default_role_label(new.role_name));
    if char_length(new.display_name) > 60 then
      raise exception 'A role name is at most 60 characters' using errcode = '22023';
    end if;
    new.description := nullif(btrim(coalesce(new.description, '')), '');
    new.permissions := coalesce(new.permissions, '{}');
  end if;
  if tg_op = 'UPDATE' and (new.role_name is distinct from old.role_name or new.tenant_id is distinct from old.tenant_id) then
    raise exception 'A role''s key and company cannot change (rename it instead)' using errcode = '42501';
  end if;

  if not v_end_user then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- a signed-in person. Without 'role-permissions' the policy refuses the write (it is checked after this trigger
  -- for a new row, so leave the refusal to it)
  if not public.has_module('role-permissions') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if (tg_op = 'INSERT' and new.role_name = 'ADMIN') or (tg_op <> 'INSERT' and old.role_name = 'ADMIN') then
    raise exception 'The Administrator role always has every module and cannot be changed' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and coalesce(new.role_name, '') !~ '^[A-Z][A-Z0-9_]{1,39}$' then
    raise exception 'A role key is 2 to 40 capital letters, digits or _' using errcode = '22023';
  end if;
  if tg_op <> 'DELETE' and exists (
    select 1 from unnest(new.permissions) m
    where not (tg_op = 'UPDATE' and m = any (coalesce(old.permissions, '{}')))
      and not exists (select 1 from public.permissions p where p.module_id = m)
  ) then
    raise exception 'Unknown module' using errcode = '22023';
  end if;

  if (select public.current_user_role()) is distinct from 'ADMIN' then
    v_mine := coalesce(public.get_user_permissions(auth.uid()), '{}');
    if tg_op <> 'INSERT' and not coalesce(old.permissions, '{}') <@ v_mine then
      raise exception 'You can only change roles whose modules you have yourself' using errcode = '42501';
    end if;
    if tg_op <> 'DELETE' and not new.permissions <@ v_mine then
      raise exception 'You can only give a role modules you have yourself' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists role_permissions_guard on public.role_permissions;
create trigger role_permissions_guard before insert or update or delete on public.role_permissions
  for each row execute function public.guard_role_permissions();

drop policy if exists "Admins can modify role permissions" on public.role_permissions;
drop policy if exists "Role managers can modify role permissions" on public.role_permissions;
create policy "Role managers can modify role permissions" on public.role_permissions to authenticated
  using ((select public.has_module('role-permissions'))) with check ((select public.has_module('role-permissions')));

/**
 * Adds a role to the company the signed-in person works in, and returns its key (made from the name: 'Field
 * Officer' -> FIELD_OFFICER, FIELD_OFFICER_2 if taken). Runs as the caller: the policy and the guard above apply.
 */
create or replace function public.create_company_role(p_name text, p_description text default null, p_permissions text[] default '{}')
returns text language plpgsql security invoker set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_base text;
  v_key text;
  n integer := 1;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'A role name is 2 to 60 characters' using errcode = '22023';
  end if;
  if exists (select 1 from public.role_permissions rp
             where rp.tenant_id = public.current_tenant_id() and lower(rp.display_name) = lower(v_name)) then
    raise exception 'There is already a role called "%"', v_name using errcode = '23505';
  end if;

  v_base := btrim(regexp_replace(upper(v_name), '[^A-Z0-9]+', '_', 'g'), '_');
  if v_base !~ '^[A-Z]' then v_base := 'ROLE_' || v_base; end if;
  v_base := btrim(left(v_base, 36), '_');
  if char_length(v_base) < 2 then v_base := 'ROLE'; end if;
  v_key := v_base;
  -- the built-in keys are never made for a new role, even where a company is missing one
  while v_key in ('ADMIN', 'STAFF')
     or exists (select 1 from public.role_permissions rp where rp.tenant_id = public.current_tenant_id() and rp.role_name = v_key) loop
    n := n + 1;
    v_key := v_base || '_' || n;
  end loop;

  insert into public.role_permissions (role_name, display_name, description, permissions)
  values (v_key, v_name, p_description, coalesce(p_permissions, '{}'));
  return v_key;
end $$;
revoke all on function public.create_company_role(text, text, text[]) from public, anon;
grant execute on function public.create_company_role(text, text, text[]) to authenticated;

/**
 * Deletes a role of the company the signed-in person works in. While anyone (members, open or queued invitations)
 * uses it, a replacement role must be given: they are all moved to it first, in the same transaction. Returns how
 * many people were moved. ADMIN and STAFF cannot be deleted; nobody deletes their own role; anyone but ADMIN only
 * deletes roles whose modules they have themselves, and moves people only to a role with less access than theirs.
 */
create or replace function public.delete_company_role(p_role text, p_replacement text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_moved integer := 0;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if not public.has_module('role-permissions') then
    raise exception 'You cannot manage roles' using errcode = '42501';
  end if;
  if not exists (select 1 from public.role_permissions rp where rp.tenant_id = v_tenant and rp.role_name = p_role) then
    raise exception 'Unknown role' using errcode = '22023';
  end if;
  if p_role in ('ADMIN', 'STAFF') then
    raise exception 'The % role is built in and cannot be deleted', public.default_role_label(p_role) using errcode = '42501';
  end if;
  if (select public.current_user_role()) = p_role then
    raise exception 'You cannot delete your own role' using errcode = '42501';
  end if;
  if not public.role_within_reach(auth.uid(), v_tenant, p_role) then
    raise exception 'You can only change roles whose modules you have yourself' using errcode = '42501';
  end if;

  if public.role_in_use(v_tenant, p_role) then
    if p_replacement is null then
      raise exception 'This role is still in use: choose a role to move its people to' using errcode = '23503';
    end if;
    if p_replacement = p_role
       or not exists (select 1 from public.role_permissions rp where rp.tenant_id = v_tenant and rp.role_name = p_replacement) then
      raise exception 'Choose another role of this company to move them to' using errcode = '22023';
    end if;
    if p_replacement <> 'STAFF' and not public.role_within_reach(auth.uid(), v_tenant, p_replacement, true) then
      raise exception 'You can only move people to a role with less access than your own' using errcode = '42501';
    end if;

    -- memberships first: their trigger mirrors the change into user_profiles for whoever works in this company now
    update public.memberships set role = p_replacement where tenant_id = v_tenant and role = p_role;
    get diagnostics v_moved = row_count;
    update public.user_profiles set role = p_replacement where tenant_id = v_tenant and role = p_role;
    update public.invitations set role = p_replacement where tenant_id = v_tenant and role = p_role and status = 'pending';
    update public.invite_queue set role = p_replacement, updated_at = now()
    where tenant_id = v_tenant and role = p_role and status in ('queued', 'sending', 'failed');
  end if;

  delete from public.role_permissions where tenant_id = v_tenant and role_name = p_role;
  return v_moved;
end $$;
revoke all on function public.delete_company_role(text, text) from public, anon;
grant execute on function public.delete_company_role(text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. inviting people: the 'invite-people' module instead of ADMIN or HR, and the role must exist in the company
-- ---------------------------------------------------------------------------------------------
-- the caller's role in the company they are working in, when they may invite people; else null
create or replace function public.inviter_role(out role text, out tenant_id uuid)
language sql stable security definer set search_path = public as $$
  select p.role, p.tenant_id
  from public.user_profiles p
  join public.tenants t on t.id = p.tenant_id and t.status = 'active'
  where p.user_id = auth.uid() and p.account_status = 'ACTIVE'
    and 'invite-people' = any (coalesce(public.member_modules(p.user_id, p.tenant_id), '{}'))
$$;
revoke all on function public.inviter_role() from public, anon, authenticated;

create or replace function public.create_invitation(p_email text, p_role text)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $_$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  me record;
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select * into me from public.inviter_role();
  if me.tenant_id is null then
    raise exception 'Only an administrator or HR can invite people' using errcode = '42501';
  end if;
  if not (coalesce(p_role, '') = any (public.fixed_role_keys()))
     and not exists (select 1 from public.role_permissions rp where rp.tenant_id = me.tenant_id and rp.role_name = p_role) then
    raise exception 'Unknown role' using errcode = '22023';
  end if;
  if not public.can_assign_role(auth.uid(), me.tenant_id, p_role) then
    if p_role = 'ADMIN' then
      raise exception 'Only an administrator can invite this role' using errcode = '42501';
    end if;
    raise exception 'Only an administrator can invite this role: it has access you do not have' using errcode = '42501';
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(v_email) > 254 then
    raise exception 'A valid email is required' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.tenant_id = me.tenant_id and lower(u.email) = v_email
  ) then
    raise exception 'That person is already in this company' using errcode = '23505';
  end if;

  -- one open invitation per address and company: a new one replaces the old link
  update public.invitations set status = 'revoked'
  where invitations.tenant_id = me.tenant_id and lower(email) = v_email and status = 'pending';

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.invitations (tenant_id, email, role, token_hash, invited_by)
  values (me.tenant_id, v_email, p_role, public.hash_invite_token(v_token), auth.uid())
  returning id, invitations.expires_at into v_id, v_expires;

  return query select v_id, v_token, v_expires;
end;
$_$;

create or replace function public.revoke_invitation(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record;
begin
  select * into me from public.inviter_role();
  if me.tenant_id is null then
    raise exception 'Only an administrator or HR can cancel invitations' using errcode = '42501';
  end if;
  update public.invitations set status = 'revoked'
  where id = p_id and tenant_id = me.tenant_id and status = 'pending';
end;
$$;

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
        coalesce(nullif(upper(btrim(x->>'role')), ''), 'STAFF') as role
      from jsonb_array_elements(p_people) x
      order by 1
    ),
    -- who is in the company already, looked up once for the whole list
    members as (
      select distinct lower(u.email) as email
      from public.memberships m join auth.users u on u.id = m.user_id
      where m.tenant_id = me.tenant_id
    ),
    -- what the caller may give, worked out once per role rather than per person
    roles as (
      select w.role,
             w.role = any (public.fixed_role_keys())
               or exists (select 1 from public.role_permissions rp where rp.tenant_id = me.tenant_id and rp.role_name = w.role) as known,
             public.can_assign_role(auth.uid(), me.tenant_id, w.role) as allowed
      from (select distinct role from wanted) w
    )
    select w.email, w.role, (mb.email is not null) as is_member, r.known, r.allowed
    from wanted w left join members mb on mb.email = w.email join roles r on r.role = w.role
    order by w.email
  loop
    problem := case
      when p.email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(p.email) > 254 then 'not a valid email address'
      when not p.known then 'unknown role'
      when not p.allowed then 'only an administrator can invite this role'
    end;
    if problem is not null then
      v_rejected := v_rejected || jsonb_build_object('email', p.email, 'reason', problem);
      continue;
    end if;

    if p.is_member then
      insert into public.invite_queue (tenant_id, batch_id, email, role, status, error, requested_by)
      values (me.tenant_id, v_batch, p.email, p.role, 'skipped', 'already has access to this company', auth.uid());
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- already waiting to be sent: counted in this batch instead
    update public.invite_queue q set batch_id = v_batch, role = case when q.status = 'queued' then p.role else q.role end,
      requested_by = auth.uid(), updated_at = now()
    where q.tenant_id = me.tenant_id and lower(q.email) = p.email and q.status in ('queued', 'sending');
    if not found then
      insert into public.invite_queue (tenant_id, batch_id, email, role, requested_by)
      values (me.tenant_id, v_batch, p.email, p.role, auth.uid());
    end if;
    v_queued := v_queued + 1;
  end loop;

  return query select v_batch, v_queued, v_skipped, v_rejected;
end $$;

/** Puts a batch's failed invitations back in the queue (only those for roles the caller may still give). */
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
    and public.can_assign_role(auth.uid(), me.tenant_id, q.role)
    -- one already waiting again (queued from another upload) stays failed here
    and not exists (select 1 from public.invite_queue o
                    where o.tenant_id = q.tenant_id and lower(o.email) = lower(q.email) and o.status in ('queued', 'sending'));
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.claim_invitations(p_limit integer default 100)
returns table (
  id bigint, tenant_id uuid, email text, role text, token text, expires_at timestamptz,
  company_name text, inviter_email text
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  q record;
  v_token text;
  v_id uuid;
  v_expires timestamptz;
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

    -- the person who queued it must still be allowed to give this role here (and the role must still exist)
    if not public.can_assign_role(q.requested_by, q.tenant_id, q.role) then
      update public.invite_queue set status = 'failed', updated_at = now(),
        error = 'the person who sent this can no longer invite people to this company'
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
    insert into public.invitations (tenant_id, email, role, token_hash, invited_by)
    values (q.tenant_id, lower(q.email), q.role, public.hash_invite_token(v_token), q.requested_by)
    returning invitations.id, invitations.expires_at into v_id, v_expires;

    update public.invite_queue set status = 'sending', attempts = attempts + 1, claimed_at = now(),
      invitation_id = v_id, updated_at = now()
    where invite_queue.id = q.id;

    return query
      select q.id, q.tenant_id, lower(q.email), q.role, v_token, v_expires,
             (select t.name from public.tenants t where t.id = q.tenant_id),
             (select u.email::text from auth.users u where u.id = q.requested_by);
  end loop;
end $$;

drop policy if exists invitations_admin_read on public.invitations;
create policy invitations_admin_read on public.invitations for select to authenticated
  using ((select public.has_module('invite-people')));
drop policy if exists inviters_read on public.invite_queue;
create policy inviters_read on public.invite_queue for select to authenticated
  using ((select public.has_module('invite-people')));

-- ---------------------------------------------------------------------------------------------
-- 6. creating chat channels: the 'create-channels' module instead of ADMIN, HR or MANAGER
-- ---------------------------------------------------------------------------------------------
drop policy if exists create_channels on public.channels;
create policy create_channels on public.channels for insert to authenticated
  with check (((created_by = (select auth.uid())) AND (type IS DISTINCT FROM 'dm'::text) AND (NOT COALESCE(is_default, false))
    AND (select public.has_module('create-channels'))));

-- ---------------------------------------------------------------------------------------------
-- 7. a new company starts with the built-in roles only
-- ---------------------------------------------------------------------------------------------
create or replace function public.create_company(p_name text)
returns uuid language plpgsql security definer set search_path = public as $function$
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

  insert into public.tenants (name, slug, plan) values (v_name, v_slug, 'trial') returning id into v_tenant;

  -- the new company starts with the default company's built-in roles (not the ones it made for itself), so its
  -- roles work straight away; it can change them and add its own
  insert into public.role_permissions (tenant_id, role_name, permissions, display_name, description)
  select v_tenant, rp.role_name, rp.permissions, rp.display_name, rp.description
  from public.role_permissions rp
  where rp.tenant_id = '00000000-0000-0000-0000-000000000001'
    and rp.role_name in ('ADMIN', 'HR', 'CHECKER', 'MANAGER', 'REGIONAL', 'OPERATIONS', 'STAFF');

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
$function$;

notify pgrst, 'reload schema';
