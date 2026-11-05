-- Figbloom Schools + HR, phase 1 ("Connect"): ERP/SCHOOLS_HR_PHASE1_CONTRACT.md section 2.
--
-- The Figbloom platform relays events between products. bloomHR receives them at POST /api/platform/events
-- (platform_events_routes.js, which calls the functions below with the service role) and sends its own through an
-- outbox. Nothing here changes anything for an existing company: every table is new, and the functions only run when
-- the platform sends an event (behind PLATFORM_EVENTS_ENABLED on the backend).
--
--   tenants.platform_tenant_id   the Figbloom platform's customer account this company is for (a school). Set when
--                                the platform switches HR on for it; unique.
--   external_people              who an employee is in another product: (company, source 'schools', the person's id
--                                there) -> Employee Number. People are never matched by email.
--   platform_event_receipts      every platform delivery applied (x-figbloom-delivery), so a repeat does nothing.
--   platform_event_outbox        bloomHR's events for the platform (hr.employee.left), sent by the backend
--                                (POST /api/platform/outbox/flush, called every minute by pg_cron while any wait) with
--                                retries.
--   invite_queue.via_platform    an invitation queued by the platform for a new company's first administrators: there
--                                is nobody in the company yet to have sent it, so claim_invitations() doesn't ask
--                                whether the sender may still invite.
--
--   platform_enable_hr()         platform.module.enabled: creates the HR company (active) for a platform tenant and
--                                queues an ADMIN invitation for each admin listed. Once per platform tenant: a repeat
--                                finds the company and queues nothing.
--   platform_upsert_school_staff()
--                                schools.staff.created / .updated: the person's draft employee, created with the
--                                company's next Employee Number and mapped in external_people, or updated.
--   platform_school_staff_left() schools.staff.left: starts HR's exit for the mapped employee (a termination,
--                                'requested', last working day = the day they left Schools). Nothing is deleted.
--   (trigger) when an exit ends a mapped employee's access (complete_exit(), or the daily job after their last day),
--                                hr.employee.left goes into the outbox.
--
-- Draft employees: HR's onboarding status already is the draft flag. A new employee starts onboarding_status 'draft',
-- and payroll refuses a payslip for anyone whose onboarding is not 'approved' (salary_history_approved_employee(),
-- 20261012200000 and 20261017900000). So these employees are created with onboarding_status = 'draft' and payroll
-- ignores them until HR completes and approves their record. No new flag is needed.
--
-- Safe to run again.

-- ---------------------------------------------------------------------------------------------
-- 1. the platform's id for a company
-- ---------------------------------------------------------------------------------------------
alter table public.tenants add column if not exists platform_tenant_id uuid;
create unique index if not exists tenants_platform_tenant_id_key on public.tenants (platform_tenant_id);

-- ---------------------------------------------------------------------------------------------
-- 2. people in other products, mapped to employees
-- ---------------------------------------------------------------------------------------------
create table if not exists public.external_people (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_number text not null,
  source text not null check (source ~ '^[a-z][a-z0-9_]{0,31}$'),
  external_id text not null check (char_length(external_id) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, source, external_id),
  -- one person in a product is one employee, and the other way round
  unique (tenant_id, source, employee_number),
  foreign key (tenant_id, employee_number) references public.employees(tenant_id, "Employee Number")
    on update cascade on delete cascade
);

alter table public.external_people enable row level security;
drop policy if exists tenant_isolation on public.external_people;
create policy tenant_isolation on public.external_people as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
-- HR sees who is linked; only the backend (service role) writes
drop policy if exists module_select on public.external_people;
create policy module_select on public.external_people for select to authenticated
  using ((select public.has_module('employees')));
revoke all on public.external_people from anon;
revoke insert, update, delete, truncate on public.external_people from authenticated;
grant select on public.external_people to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. deliveries received (idempotency) and events to send (outbox): the backend's only
-- ---------------------------------------------------------------------------------------------
create table if not exists public.platform_event_receipts (
  delivery_id text primary key check (char_length(delivery_id) between 1 and 200),
  event_type text not null,
  event_id text,
  received_at timestamptz not null default now(),
  result text not null
);
alter table public.platform_event_receipts enable row level security;
revoke all on public.platform_event_receipts from anon, authenticated;

create table if not exists public.platform_event_outbox (
  id uuid primary key default gen_random_uuid(),   -- the event's id on the platform: a resend is not delivered twice
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_type text not null check (event_type ~ '^hr\.[a-z_.]+$'),
  dedupe_key text not null,                         -- what the event is about (an exit's id): queued once
  data jsonb not null,
  occurred_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_type, tenant_id, dedupe_key)
);
create index if not exists platform_event_outbox_due_idx on public.platform_event_outbox (next_attempt_at)
  where status in ('pending', 'sending');
alter table public.platform_event_outbox enable row level security;
drop policy if exists tenant_isolation on public.platform_event_outbox;
create policy tenant_isolation on public.platform_event_outbox as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
revoke all on public.platform_event_outbox from anon, authenticated;

/**
 * The events to send now (at most p_limit), marked 'sending'. Locked with SKIP LOCKED, so two runs never send the same
 * one; one left 'sending' for 10 minutes (a run that died) is claimed again. Server only.
 */
create or replace function public.claim_platform_events(p_limit integer default 20)
returns table (id uuid, tenant_id uuid, event_type text, data jsonb, occurred_at timestamptz, attempts integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select o.id from public.platform_event_outbox o
    where (o.status = 'pending' and o.next_attempt_at <= now())
       or (o.status = 'sending' and o.claimed_at < now() - interval '10 minutes')
    order by o.next_attempt_at, o.created_at
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update skip locked
  )
  update public.platform_event_outbox o
    set status = 'sending', attempts = o.attempts + 1, claimed_at = now()
  from due where o.id = due.id
  returning o.id, o.tenant_id, o.event_type, o.data, o.occurred_at, o.attempts;
end $$;
revoke all on function public.claim_platform_events(integer) from public, anon, authenticated;
grant execute on function public.claim_platform_events(integer) to service_role;

/**
 * Records how sending went: sent; or tried again later (1, 2, 4 ... minutes, at most 6 hours apart) unless p_retry is
 * false (the platform refused it for good) or it has been tried 20 times: then failed. Server only.
 */
create or replace function public.finish_platform_event(p_id uuid, p_ok boolean, p_error text default null, p_retry boolean default true)
returns text language plpgsql security definer set search_path = public as $$
declare
  o public.platform_event_outbox;
begin
  select * into o from public.platform_event_outbox where id = p_id for update;
  if o.id is null then
    return null;
  end if;
  if p_ok then
    update public.platform_event_outbox set status = 'sent', sent_at = now(), last_error = null where id = p_id;
    return 'sent';
  end if;
  if not coalesce(p_retry, true) or o.attempts >= 20 then
    update public.platform_event_outbox set status = 'failed', last_error = left(p_error, 500) where id = p_id;
    return 'failed';
  end if;
  update public.platform_event_outbox
    set status = 'pending', last_error = left(p_error, 500),
        next_attempt_at = now() + least(interval '6 hours', make_interval(mins => power(2, greatest(o.attempts - 1, 0))::integer))
    where id = p_id;
  return 'pending';
end $$;
revoke all on function public.finish_platform_event(uuid, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.finish_platform_event(uuid, boolean, text, boolean) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. invitations the platform queues for a new company's administrators
-- ---------------------------------------------------------------------------------------------
alter table public.invite_queue add column if not exists via_platform boolean not null default false;

-- 20261019700000's claim_invitations(), unchanged except that an invitation queued by the platform (via_platform,
-- no sender) skips the check that its sender may still invite
drop function if exists public.claim_invitations(integer);
create or replace function public.claim_invitations(p_limit integer default 100)
returns table (
  id bigint, tenant_id uuid, email text, role text, token text, expires_at timestamptz,
  company_name text, inviter_email text, role_name text
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  q record;
  v_token text;
  v_id uuid;
  v_expires timestamptz;
  v_company_role uuid;
begin
  for q in
    select iq.* from public.invite_queue iq
    where (iq.status = 'queued' and iq.next_attempt_at <= now())
       or (iq.status = 'sending' and iq.claimed_at < now() - interval '10 minutes')
    order by iq.id
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
    for update skip locked
  loop
    if q.attempts >= 5 then
      update public.invite_queue set status = 'failed', error = coalesce(error, 'not sent after 5 attempts'), updated_at = now()
      where invite_queue.id = q.id;
      continue;
    end if;

    -- the person who queued it must still be allowed to invite this role here (the platform's own have no sender)
    if not (q.via_platform and q.requested_by is null)
       and not public.user_may_grant(q.requested_by, q.tenant_id, q.role, q.company_role_id) then
      update public.invite_queue set status = 'failed', updated_at = now(),
        error = 'the person who sent this can no longer invite people to this company'
      where invite_queue.id = q.id;
      continue;
    end if;

    v_company_role := public.invitation_company_role(q.tenant_id, q.role, q.company_role_id);
    if q.company_role_id is not null and v_company_role is null then
      update public.invite_queue set status = 'failed', updated_at = now(), error = 'the role was switched off'
      where invite_queue.id = q.id;
      continue;
    end if;

    if exists (
      select 1 from public.memberships m join auth.users u on u.id = m.user_id
      where m.tenant_id = q.tenant_id and lower(u.email) = lower(q.email)
    ) then
      update public.invite_queue set status = 'skipped', error = 'already has access to this company', updated_at = now()
      where invite_queue.id = q.id;
      continue;
    end if;

    -- one open invitation per address and company: a new one replaces the old link (as create_invitation)
    update public.invitations i set status = 'revoked'
    where i.tenant_id = q.tenant_id and lower(i.email) = lower(q.email) and i.status = 'pending';

    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.invitations (tenant_id, email, role, company_role_id, token_hash, invited_by)
    values (q.tenant_id, lower(q.email), q.role, v_company_role, public.hash_invite_token(v_token), q.requested_by)
    returning invitations.id, invitations.expires_at into v_id, v_expires;

    update public.invite_queue set status = 'sending', attempts = attempts + 1, claimed_at = now(),
      invitation_id = v_id, updated_at = now()
    where invite_queue.id = q.id;

    return query
      select q.id, q.tenant_id, lower(q.email), q.role, v_token, v_expires,
             (select t.name from public.tenants t where t.id = q.tenant_id),
             (select u.email::text from auth.users u where u.id = q.requested_by),
             public.role_display_name(q.tenant_id, q.role, v_company_role);
  end loop;
end $$;
revoke all on function public.claim_invitations(integer) from public, anon, authenticated;
grant execute on function public.claim_invitations(integer) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. platform.module.enabled (module hr): the school's HR company
-- ---------------------------------------------------------------------------------------------
/**
 * The HR company for a platform tenant, created if there is none: create_company() without a signed-in owner (the
 * same roles, general channel and leave types), status active, and an ADMIN invitation queued for each admin in
 * p_admins ([{ "email": ... }], sent by the send-invites job). A repeat for the same platform tenant creates and queues
 * nothing and returns the existing company (created = false). Server only.
 */
create or replace function public.platform_enable_hr(p_platform_tenant uuid, p_name text, p_slug text default null, p_admins jsonb default '[]'::jsonb)
returns table (tenant_id uuid, slug text, name text, created boolean, invited integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  t public.tenants;
  v_name text := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 80);
  v_wanted text := lower(btrim(coalesce(p_slug, '')));
  v_base text;
  v_slug text;
  v_batch uuid := gen_random_uuid();
  v_invited integer := 0;
  a jsonb;
  v_email text;
begin
  if p_platform_tenant is null then
    raise exception 'The platform tenant is missing' using errcode = '22023';
  end if;
  -- one at a time per platform tenant, so two deliveries of the same event make one company
  perform pg_advisory_xact_lock(hashtextextended('platform_enable_hr:' || p_platform_tenant::text, 0));

  select * into t from public.tenants x where x.platform_tenant_id = p_platform_tenant;
  if t.id is not null then
    return query select t.id, t.slug, t.name, false, 0;
    return;
  end if;

  if char_length(v_name) < 2 then
    raise exception 'The school''s name is missing' using errcode = '22023';
  end if;

  -- the school's own address if it is free and valid here, else one made from the name (as create_company)
  if v_wanted ~ '^[a-z0-9-]{3,40}$' and not exists (select 1 from public.tenants x where x.slug = v_wanted) then
    v_slug := v_wanted;
  else
    v_base := btrim(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '-');
    if char_length(v_base) < 3 then v_base := v_base || '-co'; end if;
    v_base := btrim(left(v_base, 30), '-');
    if char_length(v_base) < 3 then v_base := 'school'; end if;
    v_slug := v_base;
    while exists (select 1 from public.tenants x where x.slug = v_slug) loop
      v_slug := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 5);
    end loop;
  end if;

  -- active straight away: Figbloom staff switched HR on from the console
  insert into public.tenants (name, slug, plan, status, platform_tenant_id)
  values (v_name, v_slug, 'trial', 'active', p_platform_tenant)
  returning * into t;

  insert into public.role_permissions (tenant_id, role_name, permissions)
  select t.id, rp.role_name, rp.permissions
  from public.role_permissions rp
  where rp.tenant_id = '00000000-0000-0000-0000-000000000001'
    and rp.role_name = any (public.system_role_names())
  on conflict do nothing;

  insert into public.channels (tenant_id, name, description, type, is_private, created_by, is_default)
  values (t.id, 'general', 'Company-wide chat and announcements', 'channel', false, null, true);

  perform public.seed_default_leave_types(t.id);

  -- the school's admins, invited as administrators (never matched to anyone by email: the invitation is the link)
  for a in select x.value from jsonb_array_elements(case when jsonb_typeof(p_admins) = 'array' then p_admins else '[]'::jsonb end) x loop
    v_email := lower(btrim(coalesce(a->>'email', '')));
    continue when v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(v_email) > 254;
    insert into public.invite_queue (tenant_id, batch_id, email, role, requested_by, via_platform)
    values (t.id, v_batch, v_email, 'ADMIN', null, true)
    on conflict do nothing;
    if found then v_invited := v_invited + 1; end if;
  end loop;

  return query select t.id, t.slug, t.name, true, v_invited;
end $$;
revoke all on function public.platform_enable_hr(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.platform_enable_hr(uuid, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 6. schools.staff.created / .updated: a draft employee per Schools person
-- ---------------------------------------------------------------------------------------------
/**
 * The draft employee for a Schools person in the HR company of p_platform_tenant: created (the company's next Employee
 * Number, onboarding 'draft', so payroll ignores them) and mapped in external_people, or, when already mapped, updated
 * (name and job title; phone and work email only when given). The phone is kept only when it is a valid number; the
 * work email only when no other employee of the company has it (people are never matched by email). Server only.
 * Raises P0002 when the platform tenant has no HR company.
 */
create or replace function public.platform_upsert_school_staff(
  p_platform_tenant uuid, p_person text, p_first text, p_middle text, p_last text,
  p_phone text default null, p_email text default null, p_job_title text default null)
returns table (employee_number text, created boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_tenant uuid;
  v_number text;
  v_first text := nullif(left(btrim(coalesce(p_first, '')), 100), '');
  v_middle text := nullif(left(btrim(coalesce(p_middle, '')), 100), '');
  v_last text := nullif(left(btrim(coalesce(p_last, '')), 100), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s()-]', '', 'g'), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_title text := nullif(left(btrim(coalesce(p_job_title, '')), 120), '');
begin
  if coalesce(btrim(p_person), '') = '' then
    raise exception 'The person''s id is missing' using errcode = '22023';
  end if;
  select x.id into v_tenant from public.tenants x where x.platform_tenant_id = p_platform_tenant;
  if v_tenant is null then
    raise exception 'No HR company for platform tenant %', p_platform_tenant using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('external_people:' || v_tenant::text || ':schools:' || p_person, 0));

  if v_phone is not null and not public.phone_ok(v_phone) then v_phone := null; end if;
  if v_email is not null and (v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(v_email) > 254) then v_email := null; end if;

  select m.employee_number into v_number from public.external_people m
  where m.tenant_id = v_tenant and m.source = 'schools' and m.external_id = p_person;

  -- someone else in the company already has this work email: leave it out rather than guess who is who
  if v_email is not null and exists (
    select 1 from public.employees e
    where e.tenant_id = v_tenant and lower(btrim(e."Work Email")) = v_email
      and e."Employee Number" is distinct from v_number) then
    v_email := null;
  end if;

  if v_number is not null then
    update public.employees e set
      "First Name" = coalesce(v_first, e."First Name"),
      "Middle Name" = case when v_first is not null then v_middle else e."Middle Name" end,
      "Last Name" = case when v_first is not null then v_last else e."Last Name" end,
      "Mobile Number" = coalesce(v_phone, e."Mobile Number"),
      "Work Email" = coalesce(v_email, e."Work Email"),
      "Job Title" = coalesce(v_title, e."Job Title")
    where e.tenant_id = v_tenant and e."Employee Number" = v_number;
    update public.external_people m set updated_at = now()
    where m.tenant_id = v_tenant and m.source = 'schools' and m.external_id = p_person;
    return query select v_number, false;
    return;
  end if;

  -- a new employee: the company's next number (employees_default_employee_number), a draft until HR approves them
  insert into public.employees as e (tenant_id, "First Name", "Middle Name", "Last Name", "Mobile Number", "Work Email",
                                     "Job Title", onboarding_status)
  values (v_tenant, coalesce(v_first, 'Unnamed'), v_middle, v_last, v_phone, v_email, v_title, 'draft')
  returning e."Employee Number" into v_number;

  insert into public.external_people (tenant_id, employee_number, source, external_id)
  values (v_tenant, v_number, 'schools', p_person);
  return query select v_number, true;
end $$;
revoke all on function public.platform_upsert_school_staff(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.platform_upsert_school_staff(uuid, text, text, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 7. schools.staff.left: HR's exit flow for the mapped employee
-- ---------------------------------------------------------------------------------------------
/**
 * A Schools person left (archived or deactivated there): HR's exit starts for their employee, as a termination waiting
 * for HR ('requested'), last working day p_left_on. HR approves, clears and completes it as any other exit. Outcome:
 * 'exit_started', 'exit_open' (one is already open), 'already_left' (Terminated or Inactive) or 'unknown' (nobody
 * mapped: nothing to do). Server only. Raises P0002 when the platform tenant has no HR company.
 */
create or replace function public.platform_school_staff_left(p_platform_tenant uuid, p_person text, p_left_on date default null)
returns table (employee_number text, outcome text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_tenant uuid;
  v_number text;
  e public.employees;
  v_left date := coalesce(p_left_on, current_date);
begin
  select x.id into v_tenant from public.tenants x where x.platform_tenant_id = p_platform_tenant;
  if v_tenant is null then
    raise exception 'No HR company for platform tenant %', p_platform_tenant using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('external_people:' || v_tenant::text || ':schools:' || coalesce(p_person, ''), 0));

  select m.employee_number into v_number from public.external_people m
  where m.tenant_id = v_tenant and m.source = 'schools' and m.external_id = p_person;
  if v_number is null then
    return query select null::text, 'unknown'::text;
    return;
  end if;

  select * into e from public.employees x where x.tenant_id = v_tenant and x."Employee Number" = v_number;
  if lower(coalesce(e."Status", '')) in ('terminated', 'inactive') then
    return query select v_number, 'already_left'::text;
    return;
  end if;
  if exists (select 1 from public.employee_exits x where x.tenant_id = v_tenant and x.employee_number = v_number
             and x.status in ('requested', 'approved', 'clearance')) then
    return query select v_number, 'exit_open'::text;
    return;
  end if;

  insert into public.employee_exits (tenant_id, employee_number, kind, reason_category, reason, notice_given_on, notice_days, last_working_day)
  values (v_tenant, v_number, 'termination', 'other',
          'Left the school in Figbloom Schools on ' || to_char(v_left, 'DD Mon YYYY'),
          least(v_left, current_date), greatest(v_left - least(v_left, current_date), 0), v_left);
  return query select v_number, 'exit_started'::text;
end $$;
revoke all on function public.platform_school_staff_left(uuid, text, date) from public, anon, authenticated;
grant execute on function public.platform_school_staff_left(uuid, text, date) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 8. an exit ends a mapped employee's employment: hr.employee.left for the platform
-- ---------------------------------------------------------------------------------------------
-- When their access ends (complete_exit(), or the daily job the day after their last working day, whichever is first)
-- they are Terminated in HR. Queued once per exit; a failure here never blocks the exit.
create or replace function public.employee_exit_platform_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_person text;
begin
  if new.access_ended_at is null or old.access_ended_at is not null then
    return null;
  end if;
  begin
    select m.external_id into v_person from public.external_people m
    where m.tenant_id = new.tenant_id and m.source = 'schools' and m.employee_number = new.employee_number;
    if v_person is null or not exists (select 1 from public.tenants t where t.id = new.tenant_id and t.platform_tenant_id is not null) then
      return null;
    end if;
    insert into public.platform_event_outbox (tenant_id, event_type, dedupe_key, data)
    values (new.tenant_id, 'hr.employee.left', new.id::text,
            jsonb_build_object('employee_number', new.employee_number, 'external_id', v_person,
                               'left_on', to_char(new.last_working_day, 'YYYY-MM-DD')))
    on conflict (event_type, tenant_id, dedupe_key) do nothing;
  exception when others then
    raise warning 'hr.employee.left not queued for exit %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.employee_exit_platform_event() from public, anon, authenticated;
drop trigger if exists employee_exit_platform_event on public.employee_exits;
create trigger employee_exit_platform_event after update of access_ended_at on public.employee_exits
  for each row execute function public.employee_exit_platform_event();

-- ---------------------------------------------------------------------------------------------
-- 9. every minute, while an event waits: ask the backend to send them
-- ---------------------------------------------------------------------------------------------
-- The backend's address and the shared secret live in Vault (as the notification emails' do, 20261013800000):
--   hr_api_url                    https://hr.figbloom.org (or the staging address), where /api/platform/... is
--   platform_outbox_cron_secret   the same value as the backend's PLATFORM_OUTBOX_CRON_SECRET
-- set with: select public.set_platform_outbox_settings('https://...', '<secret>');
create or replace function public.set_platform_outbox_settings(p_api_url text, p_cron_secret text) returns void
language plpgsql security definer set search_path = public as $$
declare
  s record;
begin
  if coalesce(p_api_url, '') !~ '^https://[^/\s]+' then
    raise exception 'The address must start with https://' using errcode = '22023';
  end if;
  if char_length(coalesce(p_cron_secret, '')) < 32 then
    raise exception 'The secret must be at least 32 characters' using errcode = '22023';
  end if;
  for s in select * from (values ('hr_api_url', rtrim(p_api_url, '/')), ('platform_outbox_cron_secret', p_cron_secret)) v(name, value) loop
    if exists (select 1 from vault.secrets where name = s.name) then
      perform vault.update_secret((select id from vault.secrets where name = s.name), s.value);
    else
      perform vault.create_secret(s.value, s.name);
    end if;
  end loop;
end $$;
revoke all on function public.set_platform_outbox_settings(text, text) from public, anon, authenticated;
grant execute on function public.set_platform_outbox_settings(text, text) to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
    if exists (select 1 from cron.job where jobname = 'platform-events-outbox') then
      perform cron.unschedule('platform-events-outbox');
    end if;
    perform cron.schedule(
      'platform-events-outbox',
      '* * * * *',
      $c$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'hr_api_url') || '/api/platform/outbox/flush',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'platform_outbox_cron_secret')),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      ) where exists (select 1 from vault.decrypted_secrets where name = 'hr_api_url')
          and exists (select 1 from vault.decrypted_secrets where name = 'platform_outbox_cron_secret')
          and exists (select 1 from public.platform_event_outbox
                      where (status = 'pending' and next_attempt_at <= now())
                         or (status = 'sending' and claimed_at < now() - interval '10 minutes'));
      $c$
    );
  else
    raise notice 'pg_cron or pg_net is not available on this project - the platform events outbox is not scheduled.';
  end if;
end $$;

notify pgrst, 'reload schema';
