-- Platform organisations: Figbloom approves new companies before they use the app, and sees every company on one page
-- (/platform/organisations). Builds on the platform admins of 20261021800000_finance_bill_readiness.sql (FIG-813):
-- is_platform_admin(), can_manage_platform().
--
--   tenants.status            gains 'pending' (waiting for Figbloom) and 'rejected', next to 'active' and 'suspended'.
--                             Every existing company stays 'active': nothing here changes who can open what today.
--   tenants.created_by        who created the company (create_company() sets it). company_owner() falls back to the
--                             first administrator for older companies, which have none.
--   tenants.status_reason / status_changed_by / status_changed_at
--                             the latest decision on the company: who approved, rejected, suspended or reactivated it,
--                             when, and why (a reason is needed to reject, optional otherwise).
--   tenant_status_changes     every change of a company's status, with who made it, when and why (audited by a
--                             trigger, like platform_rate_changes). Platform admins read it.
--   platform_settings         one row: auto_approve_companies (default off: manual approval). Only platform admins
--                             change it, through set_auto_approve_companies().
--   create_company()          creates the company 'pending' when approval is manual, 'active' when automatic, and
--                             emails every platform admin about the sign-up (a link to /platform/organisations).
--   set_company_status()      a platform admin approves (pending or rejected -> active), rejects (pending -> rejected,
--                             with a reason), suspends (active -> suspended) or reactivates (suspended -> active) a
--                             company. Approving emails the owner.
--   platform_organisations()  every company with its owner, plan, status, employees, users, payroll runs and last
--   platform_organisation_totals()
--                             activity, and the totals at the top of the page. Platform admins only.
--   my_company_status()       the status of the company the signed-in person is working in, so the app shows a pending
--                             (or rejected, or suspended) company's people a waiting screen instead of the app.
--
-- A company that is not active was already shut out by the database: current_tenant_id() is null for it (so row-level
-- security shows and changes nothing), and inviting, joining and switching to it are refused. has_module() now asks
-- for an active company too, so the module checks inside functions (payroll, approvals...) refuse it as well. People
-- who also belong to an active company switch to it and carry on; platform admins are not affected.
--
-- Emails go through the existing queue (bulk_emails, sent by the send-notification-emails Edge Function, migration
-- 20261014500000). When that function is not set up, they wait in the queue and nothing else changes.
--
-- Safe to run again.

-- ---------------------------------------------------------------------------------------------
-- 1. the company's status, and who decided it
-- ---------------------------------------------------------------------------------------------
alter table public.tenants drop constraint if exists tenants_status_check;
alter table public.tenants add constraint tenants_status_check
  check (status = any (array['pending', 'active', 'rejected', 'suspended']));

alter table public.tenants
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists status_reason text,
  add column if not exists status_changed_by uuid references auth.users(id) on delete set null,
  add column if not exists status_changed_at timestamptz;

create index if not exists tenants_status_idx on public.tenants (status, created_at desc);

-- every change of status, with who made it (the audit of platform_rate_changes, for companies)
create table if not exists public.tenant_status_changes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  old_status text,
  new_status text not null,
  reason text,
  performed_by uuid references auth.users(id) on delete set null,
  performed_at timestamptz not null default now()
);
create index if not exists tenant_status_changes_tenant_idx on public.tenant_status_changes (tenant_id, performed_at desc);
alter table public.tenant_status_changes enable row level security;
drop policy if exists platform_read on public.tenant_status_changes;
create policy platform_read on public.tenant_status_changes for select to authenticated
  using ((select public.is_platform_admin()));
revoke all on public.tenant_status_changes from anon;
revoke insert, update, delete, truncate on public.tenant_status_changes from authenticated;
grant select on public.tenant_status_changes to authenticated;

-- a change of status records who made it and when (also from the SQL editor), and the reason belongs to that change
create or replace function public.tenant_status_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    new.status_changed_by := auth.uid();
    if new.status_reason is not distinct from old.status_reason then
      new.status_reason := null;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.tenant_status_stamp() from public, anon, authenticated;
drop trigger if exists tenant_status_stamp on public.tenants;
create trigger tenant_status_stamp before update of status on public.tenants
  for each row execute function public.tenant_status_stamp();

create or replace function public.audit_tenant_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  insert into public.tenant_status_changes (tenant_id, old_status, new_status, reason, performed_by)
  values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status,
          case when tg_op = 'UPDATE' then new.status_reason end, auth.uid());
  return null;
end $$;
revoke all on function public.audit_tenant_status() from public, anon, authenticated;
drop trigger if exists audit_tenant_status on public.tenants;
create trigger audit_tenant_status after insert or update of status on public.tenants
  for each row execute function public.audit_tenant_status();

-- ---------------------------------------------------------------------------------------------
-- 2. the platform's settings: approve new companies by hand (default) or automatically
-- ---------------------------------------------------------------------------------------------
create table if not exists public.platform_settings (
  id boolean primary key default true check (id),
  auto_approve_companies boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (id) values (true) on conflict (id) do nothing;
alter table public.platform_settings enable row level security;
drop policy if exists platform_read on public.platform_settings;
create policy platform_read on public.platform_settings for select to authenticated
  using ((select public.is_platform_admin()));
revoke all on public.platform_settings from anon;
revoke insert, update, delete, truncate on public.platform_settings from authenticated;
grant select on public.platform_settings to authenticated;

create or replace function public.auto_approve_companies() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.auto_approve_companies from public.platform_settings s where s.id), false)
$$;
revoke all on function public.auto_approve_companies() from public, anon, authenticated;
grant execute on function public.auto_approve_companies() to service_role;

create or replace function public.set_auto_approve_companies(p_on boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_platform() then
    raise exception 'Only a platform admin can change how companies are approved' using errcode = '42501';
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

-- ---------------------------------------------------------------------------------------------
-- 3. emails, through the existing queue (bulk_emails, sent by the send-notification-emails Edge Function)
-- ---------------------------------------------------------------------------------------------
create or replace function public.html_text(p text) returns text
language sql immutable as $$
  select replace(replace(replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;')
$$;

-- the owner of a company: whoever created it, else its first administrator
create or replace function public.company_owner(p_tenant uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select t.created_by from public.tenants t where t.id = p_tenant),
    (select m.user_id from public.memberships m where m.tenant_id = p_tenant and m.role = 'ADMIN' order by m.created_at, m.user_id limit 1)
  )
$$;
revoke all on function public.company_owner(uuid) from public, anon, authenticated;

/**
 * Queues one email about a company to these addresses (empty ones and repeats dropped; nothing queued when none is
 * left). Links in the body are paths ("/platform/organisations"): the Edge Function puts the app's address in front.
 * Internal: the platform functions below call it.
 */
create or replace function public.queue_platform_email(p_tenant uuid, p_purpose text, p_subject text, p_html text, p_emails text[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_count integer;
begin
  select count(distinct lower(btrim(a))) into v_count from unnest(coalesce(p_emails, '{}')) a where coalesce(btrim(a), '') <> '';
  if v_count = 0 then
    return null;
  end if;
  insert into public.bulk_emails (tenant_id, created_by, purpose, subject, html, recipient_count)
  values (p_tenant, auth.uid(), p_purpose, p_subject, p_html, v_count)
  returning id into v_id;
  insert into public.bulk_email_recipients (bulk_email_id, tenant_id, to_email)
  select distinct on (lower(btrim(a))) v_id, p_tenant, btrim(a)
  from unnest(p_emails) a
  where coalesce(btrim(a), '') <> ''
  order by lower(btrim(a));
  return v_id;
end $$;
revoke all on function public.queue_platform_email(uuid, text, text, text, text[]) from public, anon, authenticated;

create or replace function public.email_platform_admins_new_company(p_tenant uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.tenants;
  v_owner text;
begin
  select * into t from public.tenants where id = p_tenant;
  select u.email into v_owner from auth.users u where u.id = public.company_owner(p_tenant);
  perform public.queue_platform_email(
    p_tenant,
    'platform-new-company',
    left(case when t.status = 'pending' then 'New company waiting for approval: ' else 'New company signed up: ' end
         || regexp_replace(t.name, '[\r\n]+', ' ', 'g'), 200),
    '<p>' || public.html_text(t.name) || ' signed up'
      || case when v_owner is not null then ' (' || public.html_text(v_owner) || ')' else '' end || '.</p>'
      || case when t.status = 'pending'
           then '<p>It is waiting for approval. Until a platform admin approves it, its owner sees a waiting screen.</p>'
           else '<p>It was approved automatically.</p>' end
      || '<p><a href="/platform/organisations">Open Organisations</a></p>',
    array(select u.email::text from public.platform_admins p join auth.users u on u.id = p.user_id)
  );
end $$;
revoke all on function public.email_platform_admins_new_company(uuid) from public, anon, authenticated;

create or replace function public.email_owner_company_approved(p_tenant uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.tenants;
  v_owner text;
begin
  select * into t from public.tenants where id = p_tenant;
  select u.email into v_owner from auth.users u where u.id = public.company_owner(p_tenant);
  perform public.queue_platform_email(
    p_tenant,
    'platform-company-approved',
    left('Your company ' || regexp_replace(t.name, '[\r\n]+', ' ', 'g') || ' is approved', 200),
    '<p>Good news: ' || public.html_text(t.name) || ' is approved. You can now use Figbloom HR: add your employees, '
      || 'invite your team and run payroll.</p><p><a href="/dashboard">Open Figbloom HR</a></p>',
    array[v_owner]
  );
end $$;
revoke all on function public.email_owner_company_approved(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. creating a company: pending until approved, unless approval is automatic
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

  -- waiting for Figbloom's approval, unless the platform approves new companies automatically
  -- (its seven system roles are added by the company_roles_for_new_company trigger)
  insert into public.tenants (name, slug, plan, status, created_by)
  values (v_name, v_slug, 'trial', case when public.auto_approve_companies() then 'active' else 'pending' end, auth.uid())
  returning id into v_tenant;

  -- the new company starts with the same role permissions as the default one, so its roles work straight away
  insert into public.role_permissions (tenant_id, role_name, permissions)
  select v_tenant, rp.role_name, rp.permissions
  from public.role_permissions rp
  where rp.tenant_id = '00000000-0000-0000-0000-000000000001'
    and rp.role_name = any (public.system_role_names());

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

  -- Figbloom's platform admins hear about every sign-up
  perform public.email_platform_admins_new_company(v_tenant);

  return v_tenant;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. approving, rejecting, suspending, reactivating
-- ---------------------------------------------------------------------------------------------
/**
 * A platform admin's decision on a company. p_action: approve (pending or rejected -> active), reject (pending ->
 * rejected, a reason is needed), suspend (active -> suspended), reactivate (suspended -> active). Recorded on the
 * company and in tenant_status_changes. Approving emails the owner. Returns the new status.
 */
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

-- ---------------------------------------------------------------------------------------------
-- 6. the organisations page
-- ---------------------------------------------------------------------------------------------
-- A company's last activity: the latest sign-in of any of its members (auth.users.last_sign_in_at). A sign-in is
-- per login, not per company, so someone in two companies counts for both; it is the signal every company has.
create or replace function public.company_last_activity(p_tenant uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select max(u.last_sign_in_at)
  from public.memberships m join auth.users u on u.id = m.user_id
  where m.tenant_id = p_tenant
$$;
revoke all on function public.company_last_activity(uuid) from public, anon, authenticated;

drop function if exists public.platform_organisations();
create or replace function public.platform_organisations()
returns table (
  id uuid, name text, slug text, plan text, status text, created_at timestamptz,
  owner_id uuid, owner_name text, owner_email text,
  employees integer, users integer, payroll_runs integer, last_activity timestamptz,
  status_reason text, status_changed_at timestamptz, status_changed_by_email text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage_platform() then
    raise exception 'Only a platform admin can see every company' using errcode = '42501';
  end if;
  return query
  select t.id, t.name, t.slug, t.plan, t.status, t.created_at,
         o.id,
         nullif(btrim(coalesce(o.raw_user_meta_data->>'full_name', o.raw_user_meta_data->>'name', '')), ''),
         o.email::text,
         (select count(*)::int from public.employees e where e.tenant_id = t.id),
         (select count(*)::int from public.memberships m where m.tenant_id = t.id),
         (select count(*)::int from public.payroll_runs r where r.tenant_id = t.id),
         public.company_last_activity(t.id),
         t.status_reason, t.status_changed_at,
         (select u.email::text from auth.users u where u.id = t.status_changed_by)
  from public.tenants t
  left join auth.users o on o.id = public.company_owner(t.id)
  order by (t.status = 'pending') desc, t.created_at desc;
end $$;
revoke all on function public.platform_organisations() from public, anon;
grant execute on function public.platform_organisations() to authenticated, service_role;

/**
 * The figures at the top of the page: companies by status, sign-ups per week for the last p_weeks weeks (Monday to
 * Sunday, oldest first, weeks with none included), companies active in the last 7 days (company_last_activity), and
 * whether new companies are approved automatically.
 */
create or replace function public.platform_organisation_totals(p_weeks integer default 8)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_weeks integer := least(greatest(coalesce(p_weeks, 8), 1), 52);
begin
  if not public.can_manage_platform() then
    raise exception 'Only a platform admin can see every company' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'by_status', (
      select jsonb_build_object(
        'pending', count(*) filter (where status = 'pending'),
        'active', count(*) filter (where status = 'active'),
        'rejected', count(*) filter (where status = 'rejected'),
        'suspended', count(*) filter (where status = 'suspended'),
        'total', count(*))
      from public.tenants),
    'signups_by_week', (
      select coalesce(jsonb_agg(jsonb_build_object('week', w.week::date, 'count', (
        select count(*) from public.tenants t where date_trunc('week', t.created_at) = w.week)) order by w.week), '[]'::jsonb)
      from generate_series(date_trunc('week', now()) - make_interval(weeks => v_weeks - 1), date_trunc('week', now()), interval '1 week') as w(week)),
    'active_last_7_days', (
      select count(*) from public.tenants t where public.company_last_activity(t.id) >= now() - interval '7 days'),
    'auto_approve', public.auto_approve_companies()
  );
end $$;
revoke all on function public.platform_organisation_totals(integer) from public, anon;
grant execute on function public.platform_organisation_totals(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 7. the signed-in person's company status (the app's waiting screen)
-- ---------------------------------------------------------------------------------------------
drop function if exists public.my_company_status();
create or replace function public.my_company_status()
returns table (tenant_id uuid, name text, status text, status_reason text, status_changed_at timestamptz, other_active_companies integer)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.status, t.status_reason, t.status_changed_at,
         (select count(*)::int from public.memberships m
          join public.tenants x on x.id = m.tenant_id and x.status = 'active'
          where m.user_id = p.user_id and m.account_status = 'ACTIVE' and m.tenant_id <> t.id)
  from public.user_profiles p
  join public.tenants t on t.id = p.tenant_id
  where p.user_id = auth.uid()
$$;
revoke all on function public.my_company_status() from public, anon;
grant execute on function public.my_company_status() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 8. module checks need an active company (payroll, approvals... inside functions)
-- ---------------------------------------------------------------------------------------------
create or replace function public.has_module(p_module text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'ADMIN'
        or case
             when cr.id is not null then
               public.module_allowed_for_base(cr.base_role, p_module)
               and exists (
                 select 1 from public.role_permissions rp
                 where rp.tenant_id = p.tenant_id and rp.role_name = cr.role_key and p_module = any (rp.permissions))
             else exists (
               select 1 from public.role_permissions rp
               where rp.tenant_id = p.tenant_id and rp.role_name = p.role and p_module = any (rp.permissions))
           end
    from public.user_profiles p
    join public.tenants t on t.id = p.tenant_id and t.status = 'active'
    left join public.company_roles cr
      on cr.id = p.company_role_id and cr.tenant_id = p.tenant_id and cr.base_role = p.role and not cr.is_system
    where p.user_id = auth.uid()
  ), false)
$$;

notify pgrst, 'reload schema';
