-- Console roles: every platform admin has one of four roles, and the database enforces what each may do. Builds on
-- 20261021800000_finance_bill_readiness.sql (platform_admins, is_platform_admin(), can_manage_platform(),
-- add_platform_rate()), 20261029100000_platform_organisations.sql (set_company_status(), set_auto_approve_companies())
-- and 20261102100000_platform_staff.sql (the Staff page: platform_admin_changes, grant/remove/revoke).
--
--                     view everything   suspend/reactivate   approve/reject, auto-approve,   invite/remove staff,
--                                         a company            edit statutory rates            change roles
--   owner                  yes               yes                    yes                         yes
--   admin                  yes               yes                    yes                         yes, never touching owners
--   support                yes               yes                    no                          no
--   viewer                 yes               no                     no                          no
--
-- Staff management: an owner may do anything (invite as owner, promote to owner, remove or demote an owner), except
-- remove or demote the last owner. An admin may invite as admin, support or viewer, and remove or change the role of
-- someone who is admin, support or viewer, only to one of those: never make anyone an owner, never remove or demote an
-- owner. Nobody removes themselves; anyone with staff management may lower their own role (an owner only while another
-- owner remains).
--
--   platform_admins.role          'owner' | 'admin' | 'support' | 'viewer'. Every existing admin becomes an owner (Mike
--                                 then sets each role); anyone added later gets the role chosen (default viewer).
--   platform_role()               the signed-in person's role, or null.
--   has_platform_permission(p)    whether the signed-in person's role allows p: 'view', 'suspend_companies',
--                                 'approve_companies', 'edit_rates' or 'manage_staff' (any other name is an error).
--   can_platform(p)               the same, or the SQL editor / service role (no signed-in user), which can still do
--                                 everything, as before: the way back in. Internal.
--   is_platform_admin()           unchanged: any role (console access, and reading everything platform-wide).
--   set_platform_admin_role()     changes someone's role, with a reason, logged ('role_changed', old_role, new_role).
--   platform_admin_changes        gains old_role and new_role, and the action 'role_changed'.
--
-- Write paths switched from "any platform admin" (can_manage_platform()) to a permission:
--   add_platform_rate()           edit_rates
--   set_auto_approve_companies()  approve_companies
--   set_company_status()          approve / reject: approve_companies; suspend / reactivate: suspend_companies
--   grant_platform_admin(), grant_platform_admin_as(), revoke_platform_admin(), remove_platform_admin()
--                                 manage_staff, plus the owner rules above
-- Read paths keep "any platform admin": platform_organisations(), platform_organisation_totals(),
-- platform_latest_approved_month(), platform_staff(), platform_admin_changes_recent(), and the read policies on
-- platform_admins, platform_rate_changes, tenant_status_changes, platform_settings and platform_admin_changes.
-- Platform rate rows (statutory_rates with no company) have no write policy for signed-in users; they only change
-- through add_platform_rate().
--
-- Safe to run again.

-- ---------------------------------------------------------------------------------------------
-- 1. the role
-- ---------------------------------------------------------------------------------------------
-- 'owner' fills the existing rows; anything inserted later without a role is a viewer (the functions below always
-- give one)
alter table public.platform_admins add column if not exists role text not null default 'owner';
alter table public.platform_admins alter column role set default 'viewer';
alter table public.platform_admins drop constraint if exists platform_admins_role_check;
alter table public.platform_admins add constraint platform_admins_role_check
  check (role in ('owner', 'admin', 'support', 'viewer'));

alter table public.platform_admin_changes
  add column if not exists old_role text,
  add column if not exists new_role text;
alter table public.platform_admin_changes drop constraint if exists platform_admin_changes_action_check;
alter table public.platform_admin_changes add constraint platform_admin_changes_action_check
  check (action in ('added', 'removed', 'role_changed'));

-- ---------------------------------------------------------------------------------------------
-- 2. what each role may do
-- ---------------------------------------------------------------------------------------------
create or replace function public.platform_role_allows(p_role text, p_permission text) returns boolean
language plpgsql immutable set search_path = public as $$
begin
  if p_permission not in ('view', 'suspend_companies', 'approve_companies', 'edit_rates', 'manage_staff') then
    raise exception 'Unknown platform permission: %', p_permission using errcode = '22023';
  end if;
  return coalesce(case p_permission
    when 'view' then p_role in ('owner', 'admin', 'support', 'viewer')
    when 'suspend_companies' then p_role in ('owner', 'admin', 'support')
    when 'approve_companies' then p_role in ('owner', 'admin')
    when 'edit_rates' then p_role in ('owner', 'admin')
    when 'manage_staff' then p_role in ('owner', 'admin')
  end, false);
end $$;
revoke all on function public.platform_role_allows(text, text) from public, anon, authenticated;

create or replace function public.platform_role() returns text
language sql stable security definer set search_path = public as $$
  select p.role from public.platform_admins p where auth.uid() is not null and p.user_id = auth.uid()
$$;
revoke all on function public.platform_role() from public, anon;
grant execute on function public.platform_role() to authenticated, service_role;

create or replace function public.has_platform_permission(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.platform_role_allows(public.platform_role(), p)
$$;
revoke all on function public.has_platform_permission(text) from public, anon;
grant execute on function public.has_platform_permission(text) to authenticated, service_role;

-- the SQL editor or the service role, with no signed-in user (the same test as can_manage_platform())
create or replace function public.platform_recovery_caller() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is null and coalesce(nullif(current_setting('role', true), ''), 'none') in ('none', 'postgres', 'service_role')
$$;
revoke all on function public.platform_recovery_caller() from public, anon, authenticated;

create or replace function public.can_platform(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_platform_permission(p) or (public.platform_recovery_caller() and public.platform_role_allows('owner', p))
$$;
revoke all on function public.can_platform(text) from public, anon, authenticated;

/**
 * Whether someone with role p_actor (null: the SQL editor, treated as an owner) may give p_target (their role now, null
 * for someone new) the role p_new (null when removing them). Owners: anything. Admins: never an owner, either way.
 */
create or replace function public.platform_staff_change_allowed(p_actor text, p_target text, p_new text) returns boolean
language sql immutable set search_path = public as $$
  select case coalesce(p_actor, 'owner')
    when 'owner' then true
    when 'admin' then coalesce(p_target, '') <> 'owner' and coalesce(p_new, '') <> 'owner'
    else false
  end
$$;
revoke all on function public.platform_staff_change_allowed(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. adding, with a role
-- ---------------------------------------------------------------------------------------------
drop function if exists public.platform_admin_add(uuid, text, uuid);
-- Adds p_user with p_role (or only updates the note of an existing admin: their role is never changed here) and logs
-- a new admin. Returns true when p_user was not a platform admin before. Callers check who may do this.
create or replace function public.platform_admin_add(p_user uuid, p_note text, p_by uuid, p_role text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_note text := nullif(btrim(p_note), '');
  v_new boolean;
begin
  if p_role is null or p_role not in ('owner', 'admin', 'support', 'viewer') then
    raise exception 'Choose a role: owner, admin, support or viewer' using errcode = '22023';
  end if;
  if p_user is null or not exists (select 1 from auth.users where id = p_user) then
    raise exception 'No such user' using errcode = '22023';
  end if;
  v_new := not exists (select 1 from public.platform_admins where user_id = p_user);
  insert into public.platform_admins (user_id, note, added_by, role) values (p_user, v_note, p_by, p_role)
  on conflict (user_id) do update set note = coalesce(excluded.note, public.platform_admins.note);
  if v_new then
    insert into public.platform_admin_changes (user_id, email, action, note, changed_by, new_role)
    values (p_user, (select u.email::text from auth.users u where u.id = p_user), 'added', v_note, p_by, p_role);
  end if;
  return v_new;
end $$;
revoke all on function public.platform_admin_add(uuid, text, uuid, text) from public, anon, authenticated;

-- Same checks and messages as before, now with a role. p_role defaults to viewer for a signed-in admin, and to owner
-- from the SQL editor or the service role (how the first owner, or a way back in, is set up).
drop function if exists public.grant_platform_admin(uuid, text);
create or replace function public.grant_platform_admin(p_user uuid, p_note text default null, p_role text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_role text := lower(btrim(coalesce(p_role, case when auth.uid() is null then 'owner' else 'viewer' end)));
begin
  if not public.can_platform('manage_staff') then
    raise exception 'Only a platform admin can add a platform admin (owners and admins)' using errcode = '42501';
  end if;
  if not public.platform_staff_change_allowed(public.platform_role(), null, v_role) then
    raise exception 'Only an owner can make someone an owner' using errcode = '42501';
  end if;
  perform public.platform_admin_add(p_user, p_note, auth.uid(), v_role);
end $$;
revoke all on function public.grant_platform_admin(uuid, text, text) from public, anon;
grant execute on function public.grant_platform_admin(uuid, text, text) to authenticated, service_role;

/**
 * The backend's invite route: adds the login with this email as a platform admin with p_role, on behalf of p_by, who
 * must be an owner or an admin (an admin never adds an owner). Only the service role calls it. Returns
 * { user_id, email, added, role }: added false when they already were one, and role is then the role they keep.
 * 'No login with this email' (errcode P0002) tells the route to create the login first.
 */
drop function if exists public.grant_platform_admin_as(uuid, text, text);
create or replace function public.grant_platform_admin_as(p_by uuid, p_email text, p_note text default null, p_role text default 'viewer')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role text := lower(btrim(coalesce(p_role, 'viewer')));
  v_by_role text;
  v_user uuid;
  v_added boolean;
begin
  if auth.uid() is not null or not public.platform_recovery_caller() then
    raise exception 'Only the server can add a platform admin on someone''s behalf' using errcode = '42501';
  end if;
  select role into v_by_role from public.platform_admins where user_id = p_by;
  if p_by is null or not public.platform_role_allows(v_by_role, 'manage_staff') then
    raise exception 'Only a platform admin can add a platform admin (owners and admins)' using errcode = '42501';
  end if;
  if not public.platform_staff_change_allowed(v_by_role, null, v_role) then
    raise exception 'Only an owner can make someone an owner' using errcode = '42501';
  end if;
  if v_email = '' then
    raise exception 'An email is needed' using errcode = '22023';
  end if;
  select u.id into v_user from auth.users u where lower(u.email) = v_email order by u.id limit 1;
  if v_user is null then
    raise exception 'No login with this email' using errcode = 'P0002';
  end if;
  v_added := public.platform_admin_add(v_user, p_note, p_by, v_role);
  return jsonb_build_object('user_id', v_user, 'email', v_email, 'added', v_added,
    'role', (select role from public.platform_admins where user_id = v_user));
end $$;
revoke all on function public.grant_platform_admin_as(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.grant_platform_admin_as(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. removing, and changing roles
-- ---------------------------------------------------------------------------------------------
-- Removes p_user and logs it. p_by is the signed-in owner or admin doing it, or null from the SQL editor or the service
-- role (no rules: the way back in). Nobody removes themselves, an admin never removes an owner, and the last owner
-- stays. Returns false when p_user was not one.
create or replace function public.platform_admin_remove(p_user uuid, p_reason text, p_by uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_by_role text;
  v_role text;
begin
  -- one change of the list at a time, so two people removing each other cannot leave no owner
  perform pg_advisory_xact_lock(hashtextextended('public.platform_admins', 0));
  if p_by is not null then
    select role into v_by_role from public.platform_admins where user_id = p_by;
    if not public.platform_role_allows(v_by_role, 'manage_staff') then
      raise exception 'Only a platform admin can remove a platform admin (owners and admins)' using errcode = '42501';
    end if;
    if p_user = p_by then
      raise exception 'You cannot remove yourself. Ask another platform admin.' using errcode = '22023';
    end if;
  end if;
  select role into v_role from public.platform_admins where user_id = p_user;
  if not found then
    return false;
  end if;
  if p_by is not null then
    if not public.platform_staff_change_allowed(v_by_role, v_role, null) then
      raise exception 'Only an owner can remove an owner' using errcode = '42501';
    end if;
    if v_role = 'owner' and (select count(*) from public.platform_admins where role = 'owner') <= 1 then
      raise exception 'The last owner cannot be removed' using errcode = '22023';
    end if;
  end if;
  delete from public.platform_admins where user_id = p_user;
  insert into public.platform_admin_changes (user_id, email, action, note, changed_by, old_role)
  values (p_user, (select u.email::text from auth.users u where u.id = p_user), 'removed', nullif(btrim(p_reason), ''), p_by, v_role);
  return true;
end $$;
revoke all on function public.platform_admin_remove(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.revoke_platform_admin(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_platform('manage_staff') then
    raise exception 'Only a platform admin can remove a platform admin (owners and admins)' using errcode = '42501';
  end if;
  perform public.platform_admin_remove(p_user, 'Removed with revoke_platform_admin()', auth.uid());
end $$;
revoke all on function public.revoke_platform_admin(uuid) from public, anon;
grant execute on function public.revoke_platform_admin(uuid) to authenticated, service_role;

create or replace function public.remove_platform_admin(p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_platform_permission('manage_staff') then
    raise exception 'Only a platform admin can remove a platform admin (owners and admins)' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Say why this platform admin is removed' using errcode = '22023';
  end if;
  if not public.platform_admin_remove(p_user, left(btrim(p_reason), 1000), auth.uid()) then
    raise exception 'Not a platform admin' using errcode = '22023';
  end if;
end $$;
revoke all on function public.remove_platform_admin(uuid, text) from public, anon;
grant execute on function public.remove_platform_admin(uuid, text) to authenticated;

/**
 * Changes a platform admin's role, with a reason, logged. Owners: any change, but the last owner keeps the role.
 * Admins: only between admin, support and viewer, and never for an owner (their own role included, downward).
 * The SQL editor or the service role (no signed-in user) may do any change (the way back in). Returns the new role.
 */
create or replace function public.set_platform_admin_role(p_user uuid, p_role text, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_new text := lower(btrim(coalesce(p_role, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_by uuid := auth.uid();
  v_by_role text;
  v_old text;
begin
  if not public.can_platform('manage_staff') then
    raise exception 'Only a platform admin can change roles (owners and admins)' using errcode = '42501';
  end if;
  if v_new not in ('owner', 'admin', 'support', 'viewer') then
    raise exception 'Choose a role: owner, admin, support or viewer' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'Say why the role changes' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('public.platform_admins', 0));
  select role into v_old from public.platform_admins where user_id = p_user for update;
  if not found then
    raise exception 'Not a platform admin' using errcode = '22023';
  end if;
  if v_old = v_new then
    raise exception 'They already have that role' using errcode = '22023';
  end if;
  if v_by is not null then
    -- checked again under the lock: someone may have changed the caller's role meanwhile
    select role into v_by_role from public.platform_admins where user_id = v_by;
    if not public.platform_role_allows(v_by_role, 'manage_staff') then
      raise exception 'Only a platform admin can change roles (owners and admins)' using errcode = '42501';
    end if;
    if not public.platform_staff_change_allowed(v_by_role, v_old, v_new) then
      raise exception 'Only an owner can make someone an owner or change an owner''s role' using errcode = '42501';
    end if;
    if v_old = 'owner' and (select count(*) from public.platform_admins where role = 'owner') <= 1 then
      raise exception 'The last owner cannot be given another role. Make someone else an owner first.' using errcode = '22023';
    end if;
  end if;
  update public.platform_admins set role = v_new where user_id = p_user;
  insert into public.platform_admin_changes (user_id, email, action, note, changed_by, old_role, new_role)
  values (p_user, (select u.email::text from auth.users u where u.id = p_user), 'role_changed', left(v_reason, 1000), v_by, v_old, v_new);
  return v_new;
end $$;
revoke all on function public.set_platform_admin_role(uuid, text, text) from public, anon;
grant execute on function public.set_platform_admin_role(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. the Staff page: the role, and the role changes
-- ---------------------------------------------------------------------------------------------
drop function if exists public.platform_staff();
create or replace function public.platform_staff()
returns table (
  user_id uuid, email text, note text, role text, added_by uuid, added_by_email text, added_at timestamptz,
  last_sign_in_at timestamptz, in_company boolean, companies integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin can see the platform admins' using errcode = '42501';
  end if;
  return query
  select p.user_id, u.email::text, p.note, p.role, p.added_by, b.email::text, p.added_at, u.last_sign_in_at,
         exists (select 1 from public.memberships m where m.user_id = p.user_id),
         (select count(distinct m.tenant_id)::int from public.memberships m where m.user_id = p.user_id)
  from public.platform_admins p
  join auth.users u on u.id = p.user_id
  left join auth.users b on b.id = p.added_by
  order by p.added_at, u.email;
end $$;
revoke all on function public.platform_staff() from public, anon;
grant execute on function public.platform_staff() to authenticated;

drop function if exists public.platform_admin_changes_recent(integer);
create or replace function public.platform_admin_changes_recent(p_limit integer default 20)
returns table (
  id uuid, user_id uuid, email text, action text, note text, old_role text, new_role text, changed_by uuid,
  changed_by_email text, changed_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin can see the changes to platform admins' using errcode = '42501';
  end if;
  return query
  select c.id, c.user_id, c.email, c.action, c.note, c.old_role, c.new_role, c.changed_by, b.email::text, c.changed_at
  from public.platform_admin_changes c
  left join auth.users b on b.id = c.changed_by
  order by c.changed_at desc, c.id
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end $$;
revoke all on function public.platform_admin_changes_recent(integer) from public, anon;
grant execute on function public.platform_admin_changes_recent(integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. companies and rates: each write needs its permission
-- ---------------------------------------------------------------------------------------------
-- edit_rates (otherwise unchanged)
create or replace function public.add_platform_rate(
  p_country text, p_code text, p_value numeric, p_bands jsonb, p_from date, p_source text,
  p_confirm_backdate boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_country text := public.tidy_country(p_country);
  v_problems text[];
  v_latest text;
  v_next date;
  v_id uuid;
begin
  if not public.can_platform('edit_rates') then
    raise exception 'Only a platform admin can change the platform rates (owners and admins)' using errcode = '42501';
  end if;
  if v_country is null then
    raise exception 'Choose a country' using errcode = '22023';
  end if;
  if p_from is null then
    raise exception 'Choose the date the rate starts' using errcode = '22023';
  end if;
  if nullif(btrim(p_source), '') is null then
    raise exception 'Say where the rate comes from (the Act or notice)' using errcode = '22023';
  end if;
  v_problems := public.platform_rate_problems(p_code, p_value, p_bands);
  if cardinality(v_problems) > 0 then
    raise exception '%', array_to_string(v_problems, '; ') using errcode = '23514';
  end if;

  v_latest := public.platform_latest_approved_month(v_country);
  if v_latest is not null and p_from <= public.pay_period_last_day(v_latest) and not coalesce(p_confirm_backdate, false) then
    raise exception 'Payroll for % in % is already approved by at least one company, and a rate from % reaches back into it. Confirm to add it anyway: approved months keep their payslips (they need amended returns), draft months are flagged for recalculation.',
      v_country, v_latest, p_from using errcode = 'P0001', hint = 'confirm_backdate';
  end if;

  -- a version from the same day: corrected in place
  select id into v_id from public.statutory_rates
  where tenant_id is null and lower(country) = lower(v_country) and code = p_code and effective_from = p_from;
  if v_id is not null then
    update public.statutory_rates set value = p_value, bands = p_bands, source = btrim(p_source) where id = v_id;
    return v_id;
  end if;

  update public.statutory_rates set effective_to = p_from - 1
  where tenant_id is null and lower(country) = lower(v_country) and code = p_code
    and effective_from < p_from and (effective_to is null or effective_to >= p_from);
  select min(effective_from) into v_next from public.statutory_rates
  where tenant_id is null and lower(country) = lower(v_country) and code = p_code and effective_from > p_from;

  insert into public.statutory_rates (tenant_id, country, code, value, bands, effective_from, effective_to, source)
  values (null, v_country, p_code, p_value, p_bands, p_from, v_next - 1, btrim(p_source))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.add_platform_rate(text, text, numeric, jsonb, date, text, boolean) from public, anon;
grant execute on function public.add_platform_rate(text, text, numeric, jsonb, date, text, boolean) to authenticated, service_role;

-- approve_companies (otherwise unchanged)
create or replace function public.set_auto_approve_companies(p_on boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_platform('approve_companies') then
    raise exception 'Only a platform admin can change how companies are approved (owners and admins)' using errcode = '42501';
  end if;
  if p_on is null then
    raise exception 'Say whether new companies are approved automatically' using errcode = '22023';
  end if;
  insert into public.platform_settings (id, auto_approve_companies, updated_by, updated_at)
  values (true, p_on, auth.uid(), now())
  on conflict (id) do update set auto_approve_companies = excluded.auto_approve_companies,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return p_on;
end $$;
revoke all on function public.set_auto_approve_companies(boolean) from public, anon;
grant execute on function public.set_auto_approve_companies(boolean) to authenticated, service_role;

-- approve_companies or suspend_companies, by action (otherwise unchanged)
create or replace function public.set_company_status(p_tenant uuid, p_action text, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  t public.tenants;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_to text;
begin
  if not public.can_manage_platform() then
    raise exception 'Only a platform admin can approve or suspend companies' using errcode = '42501';
  end if;
  -- approving and rejecting need approve_companies (owner, admin); suspending and reactivating need
  -- suspend_companies (owner, admin, support)
  if v_action in ('approve', 'reject') and not public.can_platform('approve_companies') then
    raise exception 'Only an owner or admin can approve or reject companies' using errcode = '42501';
  end if;
  if v_action in ('suspend', 'reactivate') and not public.can_platform('suspend_companies') then
    raise exception 'Only an owner, admin or support can suspend or reactivate companies' using errcode = '42501';
  end if;
  select * into t from public.tenants where id = p_tenant for update;
  if not found then
    raise exception 'No such company' using errcode = '22023';
  end if;

  if v_action = 'approve' and t.status in ('pending', 'rejected') then
    v_to := 'active';
  elsif v_action = 'reject' and t.status = 'pending' then
    if v_reason is null then
      raise exception 'Say why the company is rejected' using errcode = '22023';
    end if;
    v_to := 'rejected';
  elsif v_action = 'suspend' and t.status = 'active' then
    v_to := 'suspended';
  elsif v_action = 'reactivate' and t.status = 'suspended' then
    v_to := 'active';
  elsif v_action not in ('approve', 'reject', 'suspend', 'reactivate') then
    raise exception 'Unknown action: approve, reject, suspend or reactivate' using errcode = '22023';
  else
    raise exception 'A company that is % cannot be %', t.status,
      case v_action when 'approve' then 'approved' when 'reject' then 'rejected' when 'suspend' then 'suspended' else 'reactivated' end
      using errcode = '22023';
  end if;
  if char_length(coalesce(v_reason, '')) > 1000 then
    raise exception 'Keep the reason under 1,000 characters' using errcode = '22023';
  end if;

  update public.tenants set status = v_to, status_reason = v_reason where id = p_tenant;

  if v_action = 'approve' then
    perform public.email_owner_company_approved(p_tenant);
  end if;
  return v_to;
end $$;
revoke all on function public.set_company_status(uuid, text, text) from public, anon;
grant execute on function public.set_company_status(uuid, text, text) to authenticated, service_role;
