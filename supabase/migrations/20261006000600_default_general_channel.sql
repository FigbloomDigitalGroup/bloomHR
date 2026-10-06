-- A new company's chat was an empty screen: channels belong to a company, and nothing created the first one (only an
-- admin could, from Teams). Every company now starts with a public "general" channel.
--
--   1. existing companies that have no channel at all get one
--   2. create_company() adds it for companies created from now on

-- 1. backfill (only companies with no channel: nobody's own setup is touched)
insert into public.channels (tenant_id, name, description, type, is_private, created_by)
select t.id, 'general', 'Company-wide chat and announcements', 'channel', false, null
from public.tenants t
where not exists (select 1 from public.channels c where c.tenant_id = t.id);

-- 2. new companies
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

  -- every company starts with a general channel, so the chat is never an empty screen
  insert into public.channels (tenant_id, name, description, type, is_private, created_by)
  values (v_tenant, 'general', 'Company-wide chat and announcements', 'channel', false, auth.uid());

  -- their first membership makes it their current company; with existing ones, switch to the new one
  insert into public.memberships (user_id, tenant_id, role, account_status)
  values (auth.uid(), v_tenant, 'ADMIN', 'ACTIVE');
  update public.user_profiles
    set tenant_id = v_tenant, role = 'ADMIN', account_status = 'ACTIVE'
    where user_id = auth.uid();

  return v_tenant;
end;
$$;

notify pgrst, 'reload schema';
