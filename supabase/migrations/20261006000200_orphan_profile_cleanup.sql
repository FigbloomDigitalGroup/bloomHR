-- Deleting a login (for example in the Supabase dashboard while testing) left its profile and memberships behind,
-- because neither table is tied to auth.users. The next person to register with the same email then failed with
-- "duplicate key value violates unique constraint user_profiles_email_key".
--
--   1. clean up rows whose login no longer exists
--   2. when a login is deleted from now on, remove its profile and memberships with it
--   3. make the membership -> profile step tolerate a leftover row for the same email (it removes it)

-- 1. one-off clean-up of leftovers ------------------------------------------------------------------
delete from public.memberships m where not exists (select 1 from auth.users u where u.id = m.user_id);
delete from public.user_profiles p where not exists (select 1 from auth.users u where u.id = p.user_id);

-- 2. keep them in step from now on ------------------------------------------------------------------
create or replace function public.cleanup_deleted_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.memberships where user_id = old.id;
  delete from public.user_profiles where user_id = old.id;
  return old;
end;
$$;

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.cleanup_deleted_user();

-- 3. a leftover row for the same email must not block a new login ---------------------------------------
create or replace function public.membership_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fallback public.memberships;
  v_email text;
begin
  if pg_trigger_depth() > 1 then return null; end if;

  select u.email into v_email from auth.users u where u.id = new.user_id;

  -- a profile for this email that belongs to a login which no longer exists is a leftover: remove it
  if v_email is not null then
    delete from public.user_profiles p
    where lower(p.email) = lower(v_email)
      and p.user_id <> new.user_id
      and not exists (select 1 from auth.users u where u.id = p.user_id);
  end if;

  insert into public.user_profiles (user_id, email, role, account_status, tenant_id)
  values (new.user_id, v_email, new.role, new.account_status, new.tenant_id)
  on conflict (user_id) do update
    set email          = coalesce(excluded.email, public.user_profiles.email),
        role           = case when public.user_profiles.tenant_id = new.tenant_id then new.role else public.user_profiles.role end,
        account_status = case when public.user_profiles.tenant_id = new.tenant_id then new.account_status else public.user_profiles.account_status end;

  if new.account_status <> 'ACTIVE'
     and exists (select 1 from public.user_profiles p where p.user_id = new.user_id and p.tenant_id = new.tenant_id) then
    select m.* into v_fallback
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id and t.status = 'active'
    where m.user_id = new.user_id and m.tenant_id <> new.tenant_id and m.account_status = 'ACTIVE'
    order by m.created_at
    limit 1;
    if found then
      update public.user_profiles
        set tenant_id = v_fallback.tenant_id, role = v_fallback.role, account_status = v_fallback.account_status
        where user_id = new.user_id;
    end if;
  end if;
  return null;
end;
$$;

notify pgrst, 'reload schema';
