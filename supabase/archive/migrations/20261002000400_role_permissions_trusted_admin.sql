-- The role used to authorise writes to role_permissions came from the JWT's user_metadata, which
-- every signed-in user can edit about themselves (supabase.auth.updateUser({ data: { role } })).
-- Any STAFF user could therefore become "ADMIN" for these policies and rewrite their company's
-- role permissions. Use user_profiles.role instead: it is written only by the backend
-- (admin_routes.js, service role) and clients have no write access to it.

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role from public.user_profiles p where p.user_id = auth.uid()
$$;

revoke all on function public.current_user_role() from public, anon;
grant execute on function public.current_user_role() to authenticated, service_role;

-- role_permissions: readable by the tenant's signed-in users, writable by the tenant's admins.
-- (The restrictive tenant_isolation policy still keeps every operation inside the caller's tenant.)
-- master_schema.sql gave every table a blanket "authenticated users can do everything" policy, and
-- permissive policies are ORed: while it exists on this table, the admin-only rule below restricts
-- nothing. Remove it here.
drop policy if exists "Enable all access for authenticated users" on public.role_permissions;
drop policy if exists "Only admins can modify role permissions" on public.role_permissions;
drop policy if exists "Anyone can view role permissions" on public.role_permissions;
drop policy if exists "Admins can modify role permissions" on public.role_permissions;
drop policy if exists "Signed-in users can view role permissions" on public.role_permissions;

create policy "Signed-in users can view role permissions" on public.role_permissions
  for select to authenticated using (true);

create policy "Admins can modify role permissions" on public.role_permissions
  for all to authenticated
  using ((select public.current_user_role()) = 'ADMIN')
  with check ((select public.current_user_role()) = 'ADMIN');

-- The permission helpers took the role from auth.users.raw_user_meta_data, which is user-editable
-- for the same reason. Read it from user_profiles.
create or replace function public.has_permission(user_id uuid, required_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_tenant uuid;
  v_permissions text[];
begin
  select p.tenant_id, p.role into v_tenant, v_role from public.user_profiles p where p.user_id = has_permission.user_id;
  if v_tenant is null or v_role is null then return false; end if;
  if auth.uid() is not null and v_tenant is distinct from public.current_tenant_id() then return false; end if;

  select rp.permissions into v_permissions
  from public.role_permissions rp
  where rp.role_name = v_role and rp.tenant_id = v_tenant;

  return coalesce(required_permission = any (v_permissions), false);
end;
$$;

create or replace function public.get_user_permissions(user_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_tenant uuid;
  v_permissions text[];
begin
  select p.tenant_id, p.role into v_tenant, v_role from public.user_profiles p where p.user_id = get_user_permissions.user_id;
  if v_tenant is null or v_role is null then return array[]::text[]; end if;
  if auth.uid() is not null and v_tenant is distinct from public.current_tenant_id() then return array[]::text[]; end if;

  select rp.permissions into v_permissions
  from public.role_permissions rp
  where rp.role_name = v_role and rp.tenant_id = v_tenant;

  return coalesce(v_permissions, array[]::text[]);
end;
$$;

notify pgrst, 'reload schema';
