-- Multi-company membership (part 2 of 4): create a company, invite people, accept an invitation.
--
-- Everything here is a security-definer function the browser calls with the person's own session, so it
-- works without the Express backend. The functions are the only way to create a company, invite someone or
-- join one: clients cannot write tenants, memberships or invitations directly.
--
--   create_company(name)              signed-in person creates a company and becomes its ADMIN
--   create_invitation(email, role)    ADMIN (or HR, for STAFF) invites an email address; returns the link token
--   revoke_invitation(id)             cancel a pending invitation
--   invitation_preview(token)         anyone with the link: which company, which role, which email
--   accept_invitation(token)          the invited person (signed in with that same email) joins
--
-- Invitation tokens are random and only their SHA-256 hash is stored, so a copy of the table is not a
-- set of working links. An invitation is single-use, expires after 7 days, and can only be accepted by a login
-- whose email matches the one invited.

create table if not exists public.invitations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  email       text not null,
  role        text not null,
  token_hash  text not null unique,
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by  uuid,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid
);
create index if not exists invitations_tenant_id_idx on public.invitations (tenant_id);
create index if not exists invitations_email_idx on public.invitations (lower(email));

alter table public.invitations enable row level security;
drop policy if exists tenant_isolation on public.invitations;
create policy tenant_isolation on public.invitations as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists invitations_admin_read on public.invitations;
create policy invitations_admin_read on public.invitations for select to authenticated
  using ((select public.current_user_role()) in ('ADMIN', 'HR'));
-- no insert/update/delete policy exists, so row-level security refuses every client write
revoke all on public.invitations from anon;

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
create or replace function public.hash_invite_token(p_token text)
returns text
language sql
immutable
as $$ select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') $$;

revoke all on function public.hash_invite_token(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- create_company
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

  insert into public.tenants (name, slug, plan) values (v_name, v_slug, 'trial') returning id into v_tenant;

  -- the new company starts with the same role permissions as the default one, so its roles work straight away
  insert into public.role_permissions (tenant_id, role_name, permissions)
  select v_tenant, rp.role_name, rp.permissions
  from public.role_permissions rp
  where rp.tenant_id = '00000000-0000-0000-0000-000000000001';

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
-- create_invitation / revoke_invitation
-- ---------------------------------------------------------------------------------------------
create or replace function public.create_invitation(p_email text, p_role text)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_caller_role text;
  v_tenant uuid;
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select p.role, p.tenant_id into v_caller_role, v_tenant
  from public.user_profiles p
  join public.tenants t on t.id = p.tenant_id and t.status = 'active'
  where p.user_id = auth.uid() and p.account_status = 'ACTIVE';
  if v_tenant is null or v_caller_role not in ('ADMIN', 'HR') then
    raise exception 'Only an administrator or HR can invite people' using errcode = '42501';
  end if;
  -- HR may invite staff only, the same limit as creating logins
  if v_caller_role <> 'ADMIN' and p_role <> 'STAFF' then
    raise exception 'Only an administrator can invite this role' using errcode = '42501';
  end if;
  if p_role not in ('ADMIN', 'HR', 'CHECKER', 'MANAGER', 'REGIONAL', 'OPERATIONS', 'STAFF') then
    raise exception 'Unknown role' using errcode = '22023';
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
  insert into public.invitations (tenant_id, email, role, token_hash, invited_by)
  values (v_tenant, v_email, p_role, public.hash_invite_token(v_token), auth.uid())
  returning id, invitations.expires_at into v_id, v_expires;

  return query select v_id, v_token, v_expires;
end;
$$;

create or replace function public.revoke_invitation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_tenant uuid;
begin
  select p.role, p.tenant_id into v_caller_role, v_tenant
  from public.user_profiles p where p.user_id = auth.uid() and p.account_status = 'ACTIVE';
  if v_tenant is null or v_caller_role not in ('ADMIN', 'HR') then
    raise exception 'Only an administrator or HR can cancel invitations' using errcode = '42501';
  end if;
  update public.invitations set status = 'revoked'
  where id = p_id and tenant_id = v_tenant and status = 'pending';
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- invitation_preview / accept_invitation
-- ---------------------------------------------------------------------------------------------
-- What the join page shows before anyone signs in. Reveals nothing without the token, and only the
-- fields the invited person needs; an unknown, used, revoked or expired link all look the same.
create or replace function public.invitation_preview(p_token text)
returns table (company_name text, email text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select t.name, i.email, i.role
  from public.invitations i
  join public.tenants t on t.id = i.tenant_id and t.status = 'active'
  where i.token_hash = public.hash_invite_token(p_token) and i.status = 'pending' and i.expires_at > now()
$$;

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invitations;
  v_email text;
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

  insert into public.memberships (user_id, tenant_id, role, account_status)
  values (auth.uid(), v_inv.tenant_id, v_inv.role, 'ACTIVE')
  on conflict (user_id, tenant_id) do update set role = excluded.role, account_status = 'ACTIVE';

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

revoke all on function public.create_company(text) from public, anon;
revoke all on function public.create_invitation(text, text) from public, anon;
revoke all on function public.revoke_invitation(uuid) from public, anon;
revoke all on function public.accept_invitation(text) from public, anon;
revoke all on function public.invitation_preview(text) from public;
grant execute on function public.create_company(text) to authenticated;
grant execute on function public.create_invitation(text, text) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.invitation_preview(text) to anon, authenticated;

notify pgrst, 'reload schema';
