-- Two-step sign-in anyone can turn on for themselves (FIG-891). The company's setting (company_security_settings:
-- off / admins, HR and checkers / everyone) stays the minimum; on top of it a person may ask for a code at every sign-in
-- (by email, or SMS to their registered number), and can't turn it off while the company asks it of them.
--
--   user_two_step(user_id, tenant_id, enabled, method)   one row per login per company
--   personal_two_step(tenant, user)                      for the server (mfa_routes.js): their own setting
--   mfa_required()                                       now also true for someone who turned it on themselves
--   my_two_step() / set_my_two_step(enabled, method)     the person's own setting, and whether the company requires it
--   two_step_people() / reset_two_step(user)             ADMIN: who has it on; turn it off for someone who lost access
--                                                        (their registered SMS number is removed too)

create table if not exists public.user_two_step (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  enabled boolean not null default false,
  method text not null default 'email' check (method in ('email', 'sms')),
  updated_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);
alter table public.user_two_step enable row level security;
drop policy if exists tenant_isolation on public.user_two_step;
create policy tenant_isolation on public.user_two_step as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
-- read and changed only through the functions below
revoke all on public.user_two_step from anon, authenticated;

create or replace function public.personal_two_step(p_tenant uuid, p_user uuid)
returns table (enabled boolean, method text)
language sql stable security definer set search_path = public as $$
  select coalesce(u.enabled, false), coalesce(u.method, 'email')
  from (select 1) one
  left join public.user_two_step u on u.user_id = p_user and u.tenant_id = p_tenant
$$;
revoke all on function public.personal_two_step(uuid, uuid) from public, anon, authenticated;
grant execute on function public.personal_two_step(uuid, uuid) to service_role;

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
  if not public.two_step_applies(p.mode, public.current_user_role())
     and not coalesce((select u.enabled from public.user_two_step u where u.user_id = auth.uid() and u.tenant_id = t), false) then
    return false;
  end if;
  return not public.mfa_passed();
end $$;
revoke all on function public.mfa_required() from public, anon;
grant execute on function public.mfa_required() to authenticated, service_role;

-- the signed-in person's own setting; company_requires: their company asks it of them, so it can't be turned off
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
  company_requires := public.two_step_applies(p.mode, public.current_user_role());
  company_method := p.method;
  select coalesce(u.enabled, false), coalesce(u.method, 'email') into enabled, method
  from (select 1) one left join public.user_two_step u on u.user_id = auth.uid() and u.tenant_id = t;
  enabled := enabled or company_requires;
  return next;
end $$;
revoke all on function public.my_two_step() from public, anon;
grant execute on function public.my_two_step() to authenticated;

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
  if not coalesce(p_enabled, false) and public.two_step_applies(p.mode, public.current_user_role()) then
    raise exception 'Your company asks for a code when you sign in, so it can''t be turned off' using errcode = '42501';
  end if;
  insert into public.user_two_step as u (user_id, tenant_id, enabled, method, updated_at)
  values (auth.uid(), t, coalesce(p_enabled, false), coalesce(p_method, 'email'), now())
  on conflict (user_id, tenant_id) do update set enabled = excluded.enabled, method = excluded.method, updated_at = now();
  return query select * from public.my_two_step();
end $$;
revoke all on function public.set_my_two_step(boolean, text) from public, anon;
grant execute on function public.set_my_two_step(boolean, text) to authenticated;

-- ADMIN: who asked for a code themselves
create or replace function public.two_step_people()
returns table (user_id uuid, name text, email text, method text, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.current_user_role(), '') <> 'ADMIN' then
    raise exception 'Only an administrator can see this' using errcode = '42501';
  end if;
  return query
  select u.user_id, coalesce(nullif(btrim(p.full_name), ''), p.email), p.email, u.method, u.updated_at
  from public.user_two_step u
  left join public.user_profiles p on p.user_id = u.user_id
  where u.tenant_id = public.current_tenant_id() and u.enabled
  order by 2;
end $$;
revoke all on function public.two_step_people() from public, anon;
grant execute on function public.two_step_people() to authenticated;

-- ADMIN: someone lost their phone or email: turn their own setting off and remove their registered SMS number
create or replace function public.reset_two_step(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.current_tenant_id();
begin
  if coalesce(public.current_user_role(), '') <> 'ADMIN' then
    raise exception 'Only an administrator can reset two-step sign-in' using errcode = '42501';
  end if;
  update public.user_two_step set enabled = false, updated_at = now() where user_id = p_user and tenant_id = t;
  delete from public.mfa_numbers m
  where m.tenant_id = t and lower(m.email) = (select lower(u.email) from auth.users u where u.id = p_user);
end $$;
revoke all on function public.reset_two_step(uuid) from public, anon;
grant execute on function public.reset_two_step(uuid) to authenticated;

notify pgrst, 'reload schema';
