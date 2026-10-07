-- Multi-company membership (part 1 of 4): one login can belong to several companies.
--
-- Until now a login had exactly one company (user_profiles.tenant_id) and one role (user_profiles.role).
-- Every row-level-security rule reads those two columns, so they stay exactly as they are and now mean
-- "the company this person is currently working in, and their role there". The new source of truth is
-- `memberships` (user, company, role, status). The app behaves as before until a person has two memberships.
--
--   memberships      one row per (user, company): the role and status in that company
--   user_profiles    the ACTIVE company's row, kept in step by the triggers below (RLS reads this)
--   switch_company() the only way a person changes which company is active (checks membership)
--   my_companies()   the companies a person may choose from
--
-- Nothing here lets a client write memberships or user_profiles: only the backend (service role) and the
-- security-definer functions below do, so nobody can add themselves to a company.

-- The live database has this column (the backend reads it); master_schema.sql never declared it.
alter table public.user_profiles add column if not exists account_status text default 'ACTIVE';

create table if not exists public.memberships (
  user_id        uuid not null,  -- auth.users.id; no FK, matching user_profiles (the backend removes rows on delete)
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  role           text not null default 'STAFF',
  account_status text not null default 'ACTIVE',
  created_at     timestamptz not null default now(),
  primary key (user_id, tenant_id)
);
create index if not exists memberships_tenant_id_idx on public.memberships (tenant_id);

alter table public.memberships enable row level security;
drop policy if exists memberships_own_read on public.memberships;
create policy memberships_own_read on public.memberships for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.memberships from anon;
revoke insert, update, delete on public.memberships from authenticated;

-- Everyone who already has a profile is a member of that company, with the same role and status.
insert into public.memberships (user_id, tenant_id, role, account_status)
select p.user_id, p.tenant_id, coalesce(p.role, 'STAFF'), coalesce(p.account_status, 'ACTIVE')
from public.user_profiles p
where p.tenant_id is not null
on conflict (user_id, tenant_id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Keeping the two tables in step. Both triggers skip when they were themselves fired by the other
-- one (pg_trigger_depth() > 1), so they cannot loop.
-- ---------------------------------------------------------------------------------------------

-- A profile written directly (the backend's older path, manual SQL, tests) becomes a membership too.
create or replace function public.profile_to_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 or new.tenant_id is null then return null; end if;
  insert into public.memberships (user_id, tenant_id, role, account_status)
  values (new.user_id, new.tenant_id, coalesce(new.role, 'STAFF'), coalesce(new.account_status, 'ACTIVE'))
  on conflict (user_id, tenant_id) do update
    set role = excluded.role, account_status = excluded.account_status;
  return null;
end;
$$;

drop trigger if exists user_profiles_to_membership on public.user_profiles;
create trigger user_profiles_to_membership
  after insert or update of tenant_id, role, account_status on public.user_profiles
  for each row execute function public.profile_to_membership();

-- A membership written by the backend is reflected in the profile when it is the company the person is in
-- (or they have no profile yet, which makes it their first company). If their current company stops being
-- usable, move them to another active one instead of locking them out.
create or replace function public.membership_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fallback public.memberships;
begin
  if pg_trigger_depth() > 1 then return null; end if;

  insert into public.user_profiles (user_id, email, role, account_status, tenant_id)
  values (new.user_id, (select u.email from auth.users u where u.id = new.user_id), new.role, new.account_status, new.tenant_id)
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

drop trigger if exists memberships_to_profile on public.memberships;
create trigger memberships_to_profile
  after insert or update on public.memberships
  for each row execute function public.membership_to_profile();

-- Removing the membership of the company a person is in moves them to another active one, or, with none
-- left, removes the profile so they can no longer act as anyone.
create or replace function public.membership_removed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fallback public.memberships;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if not exists (select 1 from public.user_profiles p where p.user_id = old.user_id and p.tenant_id = old.tenant_id) then
    return null;
  end if;

  select m.* into v_fallback
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id and t.status = 'active'
  where m.user_id = old.user_id and m.account_status = 'ACTIVE'
  order by m.created_at
  limit 1;

  if found then
    update public.user_profiles
      set tenant_id = v_fallback.tenant_id, role = v_fallback.role, account_status = v_fallback.account_status
      where user_id = old.user_id;
  else
    delete from public.user_profiles where user_id = old.user_id;
  end if;
  return null;
end;
$$;

drop trigger if exists memberships_removed on public.memberships;
create trigger memberships_removed
  after delete on public.memberships
  for each row execute function public.membership_removed();

-- ---------------------------------------------------------------------------------------------
-- What the app calls
-- ---------------------------------------------------------------------------------------------

-- The companies the signed-in person can choose from (active membership in an active company).
create or replace function public.my_companies()
returns table (tenant_id uuid, name text, slug text, role text, is_current boolean)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.name, t.slug, m.role, (p.tenant_id = t.id)
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id and t.status = 'active'
  left join public.user_profiles p on p.user_id = m.user_id
  where m.user_id = auth.uid() and m.account_status = 'ACTIVE'
  order by t.name
$$;

-- Choose which company to work in. Only a company the person is an active member of is accepted; the role
-- comes from that membership, never from the caller.
create or replace function public.switch_company(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.memberships;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select m.* into v_member
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id and t.status = 'active'
  where m.user_id = auth.uid() and m.tenant_id = p_tenant_id and m.account_status = 'ACTIVE';
  if not found then
    raise exception 'You are not a member of that company' using errcode = '42501';
  end if;

  update public.user_profiles
    set tenant_id = v_member.tenant_id, role = v_member.role, account_status = v_member.account_status
    where user_id = auth.uid();
  if not found then
    raise exception 'No profile for this user' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.my_companies() from public, anon;
revoke all on function public.switch_company(uuid) from public, anon;
grant execute on function public.my_companies() to authenticated;
grant execute on function public.switch_company(uuid) to authenticated;

notify pgrst, 'reload schema';
