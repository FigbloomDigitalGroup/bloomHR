-- Platform staff: the console's Staff page (/platform/staff), where Figbloom's platform admins see, invite and remove
-- each other. Builds on the platform admins of 20261021800000_finance_bill_readiness.sql (FIG-813): platform_admins,
-- is_platform_admin(), can_manage_platform(), grant_platform_admin() and revoke_platform_admin().
--
--   platform_admin_changes    every platform admin added or removed, with their email at the time, the note or reason,
--                             who did it and when. Platform admins read it; nobody writes it directly.
--   platform_admin_add()      the one place a platform admin is added, and logged (internal). grant_platform_admin()
--                             (unchanged signature and checks) and grant_platform_admin_as() both go through it.
--   grant_platform_admin_as() for the backend only (service role): adds the login with this email as a platform admin
--                             on behalf of p_by, who must be a platform admin. The console's invite route
--                             (POST /api/platform/staff/invite) uses it after creating the login, so the log names the
--                             admin who invited, not "the server".
--   platform_admin_remove()   the one place a platform admin is removed, and logged (internal). A signed-in admin
--                             cannot remove themselves or the last platform admin; the SQL editor still can (the way
--                             back in if every admin is lost). revoke_platform_admin() (same signature) now goes through it
--                             too, with the same guards and a default reason, so there is no unguarded way to remove one.
--   remove_platform_admin()   a platform admin removes another one, with a reason.
--   platform_staff()          every platform admin: email, note, who added them and when, last sign-in, and whether
--                             they also belong to a company.
--   platform_admin_changes_recent()
--                             the latest changes, newest first.
--
-- platform_staff(), remove_platform_admin() and platform_admin_changes_recent() are for signed-in platform admins only
-- (is_platform_admin()); everyone else, including the service role, is refused.
--
-- Safe to run again.

-- ---------------------------------------------------------------------------------------------
-- 1. the log
-- ---------------------------------------------------------------------------------------------
create table if not exists public.platform_admin_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text,
  action text not null check (action in ('added', 'removed')),
  note text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists platform_admin_changes_at_idx on public.platform_admin_changes (changed_at desc);
alter table public.platform_admin_changes enable row level security;
drop policy if exists platform_read on public.platform_admin_changes;
create policy platform_read on public.platform_admin_changes for select to authenticated
  using ((select public.is_platform_admin()));
revoke all on public.platform_admin_changes from anon;
revoke insert, update, delete, truncate on public.platform_admin_changes from authenticated;
grant select on public.platform_admin_changes to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. adding: one place, logged
-- ---------------------------------------------------------------------------------------------
-- Adds p_user (or updates the note of an existing admin, as before) and logs a new admin. Returns true when p_user was
-- not a platform admin before. Callers check who may do this.
create or replace function public.platform_admin_add(p_user uuid, p_note text, p_by uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_note text := nullif(btrim(p_note), '');
  v_new boolean;
begin
  if p_user is null or not exists (select 1 from auth.users where id = p_user) then
    raise exception 'No such user' using errcode = '22023';
  end if;
  v_new := not exists (select 1 from public.platform_admins where user_id = p_user);
  insert into public.platform_admins (user_id, note, added_by) values (p_user, v_note, p_by)
  on conflict (user_id) do update set note = coalesce(excluded.note, public.platform_admins.note);
  if v_new then
    insert into public.platform_admin_changes (user_id, email, action, note, changed_by)
    values (p_user, (select u.email::text from auth.users u where u.id = p_user), 'added', v_note, p_by);
  end if;
  return v_new;
end $$;
revoke all on function public.platform_admin_add(uuid, text, uuid) from public, anon, authenticated;

-- same signature, same checks and messages as before (finance_bill_readiness.test.ts); now logged
create or replace function public.grant_platform_admin(p_user uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_platform() then
    raise exception 'Only a platform admin can add a platform admin' using errcode = '42501';
  end if;
  perform public.platform_admin_add(p_user, p_note, auth.uid());
end $$;
revoke all on function public.grant_platform_admin(uuid, text) from public, anon;
grant execute on function public.grant_platform_admin(uuid, text) to authenticated, service_role;

/**
 * The backend's invite route: adds the login with this email as a platform admin, on behalf of p_by. Only the service
 * role calls it (no signed-in user), and p_by must be a platform admin. Returns { user_id, email, added } (added false
 * when they already were one). 'No login with this email' (errcode P0002) tells the route to create the login first.
 */
create or replace function public.grant_platform_admin_as(p_by uuid, p_email text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user uuid;
  v_added boolean;
begin
  if auth.uid() is not null or not public.can_manage_platform() then
    raise exception 'Only the server can add a platform admin on someone''s behalf' using errcode = '42501';
  end if;
  if p_by is null or not exists (select 1 from public.platform_admins where user_id = p_by) then
    raise exception 'Only a platform admin can add a platform admin' using errcode = '42501';
  end if;
  if v_email = '' then
    raise exception 'An email is needed' using errcode = '22023';
  end if;
  select u.id into v_user from auth.users u where lower(u.email) = v_email order by u.id limit 1;
  if v_user is null then
    raise exception 'No login with this email' using errcode = 'P0002';
  end if;
  v_added := public.platform_admin_add(v_user, p_note, p_by);
  return jsonb_build_object('user_id', v_user, 'email', v_email, 'added', v_added);
end $$;
revoke all on function public.grant_platform_admin_as(uuid, text, text) from public, anon, authenticated;
grant execute on function public.grant_platform_admin_as(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. removing: one place, logged
-- ---------------------------------------------------------------------------------------------
-- Removes p_user and logs it. p_by is the signed-in admin doing it, or null from the SQL editor or the service role.
-- A signed-in admin cannot remove themselves or the last platform admin. Returns false when p_user was not one.
create or replace function public.platform_admin_remove(p_user uuid, p_reason text, p_by uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  -- one change of the list at a time, so two admins removing each other cannot leave none
  perform pg_advisory_xact_lock(hashtextextended('public.platform_admins', 0));
  if p_by is not null then
    if not exists (select 1 from public.platform_admins where user_id = p_by) then
      raise exception 'Only a platform admin can remove a platform admin' using errcode = '42501';
    end if;
    if p_user = p_by then
      raise exception 'You cannot remove yourself. Ask another platform admin.' using errcode = '22023';
    end if;
  end if;
  if not exists (select 1 from public.platform_admins where user_id = p_user) then
    return false;
  end if;
  if p_by is not null and (select count(*) from public.platform_admins) <= 1 then
    raise exception 'The last platform admin cannot be removed' using errcode = '22023';
  end if;
  delete from public.platform_admins where user_id = p_user;
  insert into public.platform_admin_changes (user_id, email, action, note, changed_by)
  values (p_user, (select u.email::text from auth.users u where u.id = p_user), 'removed', nullif(btrim(p_reason), ''), p_by);
  return true;
end $$;
revoke all on function public.platform_admin_remove(uuid, text, uuid) from public, anon, authenticated;

-- same signature and check as before; now logged, and a signed-in admin can't use it to remove themselves or the last one
create or replace function public.revoke_platform_admin(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_platform() then
    raise exception 'Only a platform admin can remove a platform admin' using errcode = '42501';
  end if;
  perform public.platform_admin_remove(p_user, 'Removed with revoke_platform_admin()', auth.uid());
end $$;
revoke all on function public.revoke_platform_admin(uuid) from public, anon;
grant execute on function public.revoke_platform_admin(uuid) to authenticated, service_role;

create or replace function public.remove_platform_admin(p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin can remove a platform admin' using errcode = '42501';
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

-- ---------------------------------------------------------------------------------------------
-- 4. the Staff page
-- ---------------------------------------------------------------------------------------------
drop function if exists public.platform_staff();
create or replace function public.platform_staff()
returns table (
  user_id uuid, email text, note text, added_by uuid, added_by_email text, added_at timestamptz,
  last_sign_in_at timestamptz, in_company boolean, companies integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin can see the platform admins' using errcode = '42501';
  end if;
  return query
  select p.user_id, u.email::text, p.note, p.added_by, b.email::text, p.added_at, u.last_sign_in_at,
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
  id uuid, user_id uuid, email text, action text, note text, changed_by uuid, changed_by_email text, changed_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin can see the changes to platform admins' using errcode = '42501';
  end if;
  return query
  select c.id, c.user_id, c.email, c.action, c.note, c.changed_by, b.email::text, c.changed_at
  from public.platform_admin_changes c
  left join auth.users b on b.id = c.changed_by
  order by c.changed_at desc, c.id
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end $$;
revoke all on function public.platform_admin_changes_recent(integer) from public, anon;
grant execute on function public.platform_admin_changes_recent(integer) to authenticated;
