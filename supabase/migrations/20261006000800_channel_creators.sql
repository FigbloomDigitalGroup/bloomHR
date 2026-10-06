-- Who may create channels, and the one channel every company keeps.
--
--   * only administrators, HR and managers may create channels (so they decide the names, e.g. #engineering, #sales);
--     everyone else uses the channels that exist. Before this, any signed-in member could.
--   * every company has a "general" channel that stays: nobody can rename or delete it, and a client cannot make
--     another channel "the default". It is marked with channels.is_default.
--
-- Direct messages are unaffected (they are created by start_direct_message()).

alter table public.channels add column if not exists is_default boolean not null default false;

-- mark each company's existing general channel (the oldest one called "general")
update public.channels c
set is_default = true
where lower(c.name) = 'general'
  and c.type is distinct from 'dm'
  and c.id = (
    select c2.id from public.channels c2
    where c2.tenant_id = c.tenant_id and lower(c2.name) = 'general' and c2.type is distinct from 'dm'
    order by c2.created_at nulls last, c2.id
    limit 1
  );

-- creating
drop policy if exists create_channels on public.channels;
create policy create_channels on public.channels for insert to authenticated
  with check (
    created_by = auth.uid()
    and type is distinct from 'dm'
    and not coalesce(is_default, false)
    and (select public.current_user_role()) in ('ADMIN', 'HR', 'MANAGER')
  );

-- renaming / changing: not the default channel
drop policy if exists manage_channels on public.channels;
create policy manage_channels on public.channels for update to authenticated
  using (type is distinct from 'dm' and not coalesce(is_default, false) and (created_by = auth.uid() or (select public.current_user_role()) = 'ADMIN'))
  with check (type is distinct from 'dm' and not coalesce(is_default, false) and (created_by = auth.uid() or (select public.current_user_role()) = 'ADMIN'));

-- deleting: not the default channel
drop policy if exists delete_channels on public.channels;
create policy delete_channels on public.channels for delete to authenticated
  using (type is distinct from 'dm' and not coalesce(is_default, false) and (created_by = auth.uid() or (select public.current_user_role()) = 'ADMIN'));

-- new companies: their general channel is the protected default
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
  insert into public.channels (tenant_id, name, description, type, is_private, created_by, is_default)
  values (v_tenant, 'general', 'Company-wide chat and announcements', 'channel', false, auth.uid(), true);

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
