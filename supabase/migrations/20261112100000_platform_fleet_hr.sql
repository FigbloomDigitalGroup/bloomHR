-- Figbloom Fleet + Figbloom HR (ERP/FLEET_HR_CONTRACT.md section 2): Fleet takes Schools' place in the Schools + HR
-- integration (20261105100000, 20261106200000, 20261107100000, 20261108300000, 20261108400000), product id 'fleet'.
-- What was hard-coded to 'schools' now follows the person's source product:
--
--   tenants.platform_source        which product the company was switched on from ('schools' or 'fleet'). Set by
--                                  platform_enable_hr(p_source); existing platform companies are Schools'. A company
--                                  with nobody mapped from another product takes the source of the first staff event
--                                  it gets (so a Fleet company switched on without a hint still ends up 'fleet').
--   platform_sources()             the products whose people HR maps: schools, fleet.
--   platform_upsert_staff() / platform_staff_left()
--                                  <source>.staff.* for any platform source, mapped in external_people with that
--                                  source. platform_upsert_school_staff() / platform_school_staff_left() stay (Schools).
--   platform_leave_steps(source) / platform_leave_chain()
--                                  the platform leave chain by product: 1. Leave Approver, 2. role ADMIN, labelled
--                                  "School admin" (Schools) or "Company admin" (Fleet). platform_school_leave_chain()
--                                  stays, answering as before.
--   hr.employee.left               one per mapped source (Schools' dedupe key unchanged), data.source added.
--   hr.leave.approved / .cancelled for a person mapped from any platform source, data.source added (the snapshot the
--                                  platform was last told is unchanged, so nothing already sent is sent again).
--   my_hr_person(), my_hr_approver(), my_hr_leave_import()
--                                  take p_source (default 'schools'): My HR resolves people of the calling product.
--
-- The platform delivers each event to the subscribing product that is active and linked for the same customer, so
-- events go back to whichever product the person came from. Safe to run again.

-- ---------------------------------------------------------------------------------------------
-- 1. the product a platform company came from
-- ---------------------------------------------------------------------------------------------
alter table public.tenants add column if not exists platform_source text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_platform_source_check') then
    alter table public.tenants add constraint tenants_platform_source_check
      check (platform_source is null or platform_source ~ '^[a-z][a-z0-9_]{0,31}$');
  end if;
end $$;
-- every platform company so far is a school's
update public.tenants set platform_source = 'schools' where platform_tenant_id is not null and platform_source is null;

create or replace function public.platform_sources() returns text[] language sql immutable as $$
  select array['schools', 'fleet']::text[]
$$;
revoke all on function public.platform_sources() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. the platform leave chain, by product
-- ---------------------------------------------------------------------------------------------
create or replace function public.platform_leave_steps(p_source text) returns jsonb language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('label', null, 'approver_type', 'leave_approver', 'approver_role', null, 'approver_module', null,
                       'approver_employee_id', null, 'alternate_type', null, 'alternate_role', null,
                       'alternate_employee_id', null, 'skip_if_requester', true),
    jsonb_build_object('label', case when coalesce(p_source, 'schools') = 'schools' then 'School admin' else 'Company admin' end,
                       'approver_type', 'role', 'approver_role', 'ADMIN', 'approver_module', null,
                       'approver_employee_id', null, 'alternate_type', null, 'alternate_role', null,
                       'alternate_employee_id', null, 'skip_if_requester', true))
$$;
revoke all on function public.platform_leave_steps(text) from public, anon, authenticated;

/**
 * Puts a platform company (tenants.platform_tenant_id) on its product's leave chain (platform_leave_steps()). Changes
 * the chain only while it is HR's default or another product's platform chain, never saved from Settings
 * (approval_workflows.updated_by is null). Returns
 *   { tenant_id, source, chain: 'set' | 'already_set' | 'customised' | 'not_platform', rerouted }
 * With p_reroute_pending, pending leave requests whose copy is HR's default or another platform chain get this one.
 * Server only.
 */
create or replace function public.platform_leave_chain(p_tenant uuid, p_reroute_pending boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.tenants;
  w public.approval_workflows;
  v_source text;
  v_key jsonb;
  v_chain text;
  v_steps jsonb;
  v_replaceable jsonb[];
  s jsonb;
  i int := 0;
  v_rerouted int := 0;
begin
  select * into t from public.tenants x where x.id = p_tenant;
  if t.id is null or t.platform_tenant_id is null then
    return jsonb_build_object('tenant_id', p_tenant, 'source', null, 'chain', 'not_platform', 'rerouted', 0);
  end if;
  v_source := coalesce(t.platform_source, 'schools');
  v_steps := public.platform_leave_steps(v_source);
  -- what may be replaced: HR's default, and the chain of any other platform product
  select array_agg(k) into v_replaceable from (
    select public.approval_steps_key(public.approval_default_steps('leave')) k
    union all
    select public.approval_steps_key(public.platform_leave_steps(x)) from unnest(public.platform_sources()) x where x <> v_source
  ) q;

  perform public.approval_workflow_create(t.id, 'leave');
  select * into w from public.approval_workflows x where x.tenant_id = t.id and x.kind = 'leave' for update;
  select public.approval_steps_key(jsonb_agg(public.approval_step_json(st) order by st.position)) into v_key
  from public.approval_steps st where st.workflow_id = w.id;

  if v_key = public.approval_steps_key(v_steps) then
    v_chain := 'already_set';
  elsif v_key = any (v_replaceable) and w.updated_by is null then
    delete from public.approval_steps where workflow_id = w.id;
    for s in select value from jsonb_array_elements(v_steps) loop
      i := i + 1;
      insert into public.approval_steps (tenant_id, workflow_id, position, label, approver_type, approver_role, skip_if_requester)
      values (t.id, w.id, i, s ->> 'label', s ->> 'approver_type', s ->> 'approver_role', true);
    end loop;
    -- updated_by stays empty: nobody chose this chain in Settings
    update public.approval_workflows set updated_at = now() where id = w.id;
    v_chain := 'set';
  else
    v_chain := 'customised';
  end if;

  if coalesce(p_reroute_pending, false) and v_chain <> 'customised' then
    update public.approval_requests r set steps = v_steps
    where r.tenant_id = t.id and r.kind = 'leave' and r.status = 'pending'
      and public.approval_steps_key(r.steps) = any (v_replaceable);
    get diagnostics v_rerouted = row_count;
  end if;

  return jsonb_build_object('tenant_id', t.id, 'source', v_source, 'chain', v_chain, 'rerouted', v_rerouted);
end $$;
revoke all on function public.platform_leave_chain(uuid, boolean) from public, anon, authenticated;
grant execute on function public.platform_leave_chain(uuid, boolean) to service_role;

-- (20261108400000's, answering as before: 'already_school', 'not_school'), now the company's own product's chain
create or replace function public.platform_school_leave_chain(p_tenant uuid, p_reroute_pending boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb := public.platform_leave_chain(p_tenant, p_reroute_pending);
begin
  return jsonb_build_object('tenant_id', v -> 'tenant_id',
    'chain', case v ->> 'chain' when 'already_set' then 'already_school' when 'not_platform' then 'not_school' else v ->> 'chain' end,
    'rerouted', v -> 'rerouted');
end $$;
revoke all on function public.platform_school_leave_chain(uuid, boolean) from public, anon, authenticated;
grant execute on function public.platform_school_leave_chain(uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. platform.module.enabled: the company, for the product it was switched on from
-- ---------------------------------------------------------------------------------------------
drop function if exists public.platform_enable_hr(uuid, text, text, jsonb);
/**
 * (20261108400000's, plus p_source: the product the customer came from, 'schools' when not one of
 * platform_sources(); kept on tenants.platform_source and choosing the leave chain. A repeat sets the source of a
 * company that has none.) Server only.
 */
create or replace function public.platform_enable_hr(p_platform_tenant uuid, p_name text, p_slug text default null,
                                                     p_admins jsonb default '[]'::jsonb, p_source text default 'schools')
returns table (tenant_id uuid, slug text, name text, created boolean, invited integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  t public.tenants;
  v_source text := case when p_source = any (public.platform_sources()) then p_source else 'schools' end;
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
    if t.platform_source is null then
      update public.tenants x set platform_source = v_source where x.id = t.id;
    end if;
    return query select t.id, t.slug, t.name, false, 0;
    return;
  end if;

  if char_length(v_name) < 2 then
    raise exception 'The customer''s name is missing' using errcode = '22023';
  end if;

  -- the customer's own address if it is free and valid here, else one made from the name (as create_company)
  if v_wanted ~ '^[a-z0-9-]{3,40}$' and not exists (select 1 from public.tenants x where x.slug = v_wanted) then
    v_slug := v_wanted;
  else
    v_base := btrim(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '-');
    if char_length(v_base) < 3 then v_base := v_base || '-co'; end if;
    v_base := btrim(left(v_base, 30), '-');
    if char_length(v_base) < 3 then v_base := case when v_source = 'schools' then 'school' else 'company' end; end if;
    v_slug := v_base;
    while exists (select 1 from public.tenants x where x.slug = v_slug) loop
      v_slug := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 5);
    end loop;
  end if;

  -- active straight away: Figbloom staff switched HR on from the console
  insert into public.tenants (name, slug, plan, status, platform_tenant_id, platform_source)
  values (v_name, v_slug, 'trial', 'active', p_platform_tenant, v_source)
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
  -- leave goes to the person's Leave Approver, then the customer's admins (not to an HR role nobody here has)
  perform public.platform_leave_chain(t.id);

  -- the customer's admins, invited as administrators (never matched to anyone by email: the invitation is the link)
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
revoke all on function public.platform_enable_hr(uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.platform_enable_hr(uuid, text, text, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. <source>.staff.created / .updated: a draft employee per person of any platform product
-- ---------------------------------------------------------------------------------------------
/**
 * platform_upsert_school_staff() (20261105100000) for any product in platform_sources(): the person's draft employee,
 * mapped in external_people (company, p_source, p_person). A company that has nobody mapped from another product takes
 * p_source as its platform_source (and that product's leave chain, unless customised). Server only. Raises P0002 when
 * the platform tenant has no HR company, 22023 for an unknown product.
 */
create or replace function public.platform_upsert_staff(
  p_platform_tenant uuid, p_source text, p_person text, p_first text, p_middle text, p_last text,
  p_phone text default null, p_email text default null, p_job_title text default null)
returns table (employee_number text, created boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  t public.tenants;
  v_tenant uuid;
  v_number text;
  v_first text := nullif(left(btrim(coalesce(p_first, '')), 100), '');
  v_middle text := nullif(left(btrim(coalesce(p_middle, '')), 100), '');
  v_last text := nullif(left(btrim(coalesce(p_last, '')), 100), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s()-]', '', 'g'), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_title text := nullif(left(btrim(coalesce(p_job_title, '')), 120), '');
begin
  if not (p_source = any (public.platform_sources())) then
    raise exception 'Unknown product %', p_source using errcode = '22023';
  end if;
  if coalesce(btrim(p_person), '') = '' then
    raise exception 'The person''s id is missing' using errcode = '22023';
  end if;
  select * into t from public.tenants x where x.platform_tenant_id = p_platform_tenant;
  v_tenant := t.id;
  if v_tenant is null then
    raise exception 'No HR company for platform tenant %', p_platform_tenant using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('external_people:' || v_tenant::text || ':' || p_source || ':' || p_person, 0));

  -- the company's product: the first product whose people arrive, while nobody from another is mapped
  if t.platform_source is distinct from p_source and not exists (
    select 1 from public.external_people m where m.tenant_id = v_tenant and m.source <> p_source) then
    update public.tenants x set platform_source = p_source where x.id = v_tenant;
    perform public.platform_leave_chain(v_tenant, true);
  end if;

  if v_phone is not null and not public.phone_ok(v_phone) then v_phone := null; end if;
  if v_email is not null and (v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(v_email) > 254) then v_email := null; end if;

  select m.employee_number into v_number from public.external_people m
  where m.tenant_id = v_tenant and m.source = p_source and m.external_id = p_person;

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
    where m.tenant_id = v_tenant and m.source = p_source and m.external_id = p_person;
    return query select v_number, false;
    return;
  end if;

  -- a new employee: the company's next number (employees_default_employee_number), a draft until HR approves them
  insert into public.employees as e (tenant_id, "First Name", "Middle Name", "Last Name", "Mobile Number", "Work Email",
                                     "Job Title", onboarding_status)
  values (v_tenant, coalesce(v_first, 'Unnamed'), v_middle, v_last, v_phone, v_email, v_title, 'draft')
  returning e."Employee Number" into v_number;
  insert into public.external_people (tenant_id, employee_number, source, external_id)
  values (v_tenant, v_number, p_source, p_person);
  return query select v_number, true;
end $$;
revoke all on function public.platform_upsert_staff(uuid, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.platform_upsert_staff(uuid, text, text, text, text, text, text, text, text) to service_role;

-- (20261105100000's, for Schools)
create or replace function public.platform_upsert_school_staff(
  p_platform_tenant uuid, p_person text, p_first text, p_middle text, p_last text,
  p_phone text default null, p_email text default null, p_job_title text default null)
returns table (employee_number text, created boolean)
language sql security definer set search_path = public as $$
  select * from public.platform_upsert_staff(p_platform_tenant, 'schools', p_person, p_first, p_middle, p_last, p_phone, p_email, p_job_title)
$$;
revoke all on function public.platform_upsert_school_staff(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.platform_upsert_school_staff(uuid, text, text, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. <source>.staff.left: HR's exit flow for the mapped employee
-- ---------------------------------------------------------------------------------------------
/** platform_school_staff_left() (20261105100000) for any product in platform_sources(). Server only. */
create or replace function public.platform_staff_left(p_platform_tenant uuid, p_source text, p_person text, p_left_on date default null)
returns table (employee_number text, outcome text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_tenant uuid;
  v_number text;
  e public.employees;
  v_left date := coalesce(p_left_on, current_date);
begin
  if not (p_source = any (public.platform_sources())) then
    raise exception 'Unknown product %', p_source using errcode = '22023';
  end if;
  select x.id into v_tenant from public.tenants x where x.platform_tenant_id = p_platform_tenant;
  if v_tenant is null then
    raise exception 'No HR company for platform tenant %', p_platform_tenant using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('external_people:' || v_tenant::text || ':' || p_source || ':' || coalesce(p_person, ''), 0));

  select m.employee_number into v_number from public.external_people m
  where m.tenant_id = v_tenant and m.source = p_source and m.external_id = p_person;
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
          case when p_source = 'schools' then 'Left the school in Figbloom Schools on ' else 'Left the company in Figbloom Fleet on ' end
            || to_char(v_left, 'DD Mon YYYY'),
          least(v_left, current_date), greatest(v_left - least(v_left, current_date), 0), v_left);
  return query select v_number, 'exit_started'::text;
end $$;
revoke all on function public.platform_staff_left(uuid, text, text, date) from public, anon, authenticated;
grant execute on function public.platform_staff_left(uuid, text, text, date) to service_role;

-- (20261105100000's, for Schools)
create or replace function public.platform_school_staff_left(p_platform_tenant uuid, p_person text, p_left_on date default null)
returns table (employee_number text, outcome text)
language sql security definer set search_path = public as $$
  select * from public.platform_staff_left(p_platform_tenant, 'schools', p_person, p_left_on)
$$;
revoke all on function public.platform_school_staff_left(uuid, text, date) from public, anon, authenticated;
grant execute on function public.platform_school_staff_left(uuid, text, date) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 6. hr.employee.left: one per product the employee is mapped from
-- ---------------------------------------------------------------------------------------------
create or replace function public.employee_exit_platform_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m record;
begin
  if new.access_ended_at is null or old.access_ended_at is not null then
    return null;
  end if;
  begin
    if not exists (select 1 from public.tenants t where t.id = new.tenant_id and t.platform_tenant_id is not null) then
      return null;
    end if;
    for m in select x.source, x.external_id from public.external_people x
             where x.tenant_id = new.tenant_id and x.employee_number = new.employee_number
               and x.source = any (public.platform_sources())
             order by x.source loop
      insert into public.platform_event_outbox (tenant_id, event_type, dedupe_key, data)
      values (new.tenant_id, 'hr.employee.left',
              -- Schools' key as before (an exit's id), so nothing already queued is queued again
              case when m.source = 'schools' then new.id::text else new.id::text || ':' || m.source end,
              jsonb_build_object('employee_number', new.employee_number, 'external_id', m.external_id, 'source', m.source,
                                 'left_on', to_char(new.last_working_day, 'YYYY-MM-DD')))
      on conflict (event_type, tenant_id, dedupe_key) do nothing;
    end loop;
  exception when others then
    raise warning 'hr.employee.left not queued for exit %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.employee_exit_platform_event() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. hr.leave.*: for a person of any platform product
-- ---------------------------------------------------------------------------------------------
-- the mapping the platform hears about for an employee: the company's own product first
create or replace function public.platform_person_of(p_tenant uuid, p_employee text)
returns table (source text, external_id text)
language sql stable security definer set search_path = public as $$
  select m.source, m.external_id
  from public.external_people m
  left join public.tenants t on t.id = m.tenant_id
  where m.tenant_id = p_tenant and m.employee_number = p_employee and m.source = any (public.platform_sources())
  order by (m.source = coalesce(t.platform_source, 'schools')) desc, m.source
  limit 1
$$;
revoke all on function public.platform_person_of(uuid, text) from public, anon, authenticated;

-- (20261108300000's, for any platform product; the snapshot itself is unchanged)
create or replace function public.leave_platform_snapshot(a public.leave_application) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when lower(btrim(coalesce(a.status, ''))) = 'approved' and t.platform_tenant_id is not null and m.external_id is not null
    then jsonb_build_object(
      'application_id', a.id,
      'external_id', m.external_id,
      'employee_number', a."Employee Number",
      'leave_type', btrim(a."Leave Type"),
      'start_date', to_char(public.leave_parse_date(a."Start Date"), 'YYYY-MM-DD'),
      'end_date', to_char(public.leave_parse_date(a."End Date"), 'YYYY-MM-DD'),
      'half_day', lower(btrim(coalesce(a.type, ''))) = 'half day',
      'days', trim_scale(coalesce(a.days, 0)))
  end
  from public.tenants t
  left join lateral public.platform_person_of(a.tenant_id, a."Employee Number") m on true
  where t.id = a.tenant_id
$$;
revoke all on function public.leave_platform_snapshot(public.leave_application) from public, anon, authenticated;

-- (20261108300000's, plus data.source: the product the person came from)
create or replace function public.leave_application_platform_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_was boolean := tg_op <> 'INSERT' and lower(btrim(coalesce(old.status, ''))) = 'approved';
  v_is boolean := tg_op <> 'DELETE' and lower(btrim(coalesce(new.status, ''))) = 'approved';
  v_id uuid;
  v_tenant uuid;
  v_new jsonb;
  v_source text;
  s public.leave_platform_events;
begin
  if not (v_was or v_is) then
    return null;
  end if;
  if tg_op = 'DELETE' then
    v_id := old.id;
    v_tenant := old.tenant_id;
  else
    v_id := new.id;
    v_tenant := new.tenant_id;
  end if;
  -- a product's own history, imported: it has it already
  if coalesce(current_setting('app.my_hr_import', true), '') = 'on'
     or exists (select 1 from public.leave_history_imports i where i.application_id = v_id) then
    return null;
  end if;
  begin
    if tg_op <> 'DELETE' then
      v_new := public.leave_platform_snapshot(new);
    end if;
    select * into s from public.leave_platform_events where application_id = v_id for update;
    if s.application_id is null then
      if v_new is null then
        return null;
      end if;
      insert into public.leave_platform_events (application_id, tenant_id) values (v_id, v_tenant)
      on conflict (application_id) do nothing;
      select * into s from public.leave_platform_events where application_id = v_id for update;
    end if;
    -- the product of the person the event is about (by the id the platform was or is told), else the company's
    select coalesce(
      (select m.source from public.external_people m
       where m.tenant_id = v_tenant and m.external_id = coalesce(v_new, s.sent) ->> 'external_id'
         and m.source = any (public.platform_sources())
       order by m.source limit 1),
      (select t.platform_source from public.tenants t where t.id = v_tenant)) into v_source;
    if s.sent is not null and s.sent is distinct from v_new then
      s.seq := s.seq + 1;
      insert into public.platform_event_outbox (tenant_id, event_type, dedupe_key, data)
      values (v_tenant, 'hr.leave.cancelled', v_id::text || ':' || s.seq,
              s.sent || jsonb_build_object('status', 'cancelled', 'source', v_source))
      on conflict (event_type, tenant_id, dedupe_key) do nothing;
    end if;
    if v_new is not null and v_new is distinct from s.sent then
      s.seq := s.seq + 1;
      insert into public.platform_event_outbox (tenant_id, event_type, dedupe_key, data)
      values (v_tenant, 'hr.leave.approved', v_id::text || ':' || s.seq,
              v_new || jsonb_build_object('status', 'approved', 'source', v_source))
      on conflict (event_type, tenant_id, dedupe_key) do nothing;
    end if;
    update public.leave_platform_events set sent = v_new, seq = s.seq, updated_at = now() where application_id = v_id;
  exception when others then
    -- never blocks the leave itself
    raise warning 'hr.leave event not queued for application %: %', v_id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.leave_application_platform_event() from public, anon, authenticated;

-- (20261108300000's: the person's id in the company's own product first)
create or replace function public.my_hr_leave_approval_item(a public.leave_application, p_step_label text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'application_id', a.id,
    'employee', jsonb_build_object('employee_number', a."Employee Number",
      'name', coalesce((select public.approval_employee_name(e) from public.employees e
                        where e.tenant_id = a.tenant_id and e."Employee Number" = a."Employee Number"), a.name),
      'external_id', (select m.external_id from public.platform_person_of(a.tenant_id, a."Employee Number") m)),
    'leave_type', a."Leave Type", 'start_date', a."Start Date", 'end_date', a."End Date", 'days', a.days,
    'half_day', lower(btrim(coalesce(a.type, ''))) = 'half day',
    'reason', a.reason, 'submitted_at', a.time_added, 'status', lower(coalesce(a.status, 'pending')),
    'step_label', p_step_label,
    'document', case when a.document_path is not null then jsonb_build_object('name', a.document_name, 'path', a.document_path) end,
    'followup_document', case when a.followup_document_path is not null
                              then jsonb_build_object('name', a.followup_document_name, 'path', a.followup_document_path) end,
    'approval', public.my_hr_leave_chain(a.tenant_id, a.id))
$$;
revoke all on function public.my_hr_leave_approval_item(public.leave_application, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 8. My HR: the calling product's people
-- ---------------------------------------------------------------------------------------------
drop function if exists public.my_hr_person(uuid, uuid, text);
create or replace function public.my_hr_person(p_tenant uuid, p_platform_tenant uuid, p_external_id text, p_source text default 'schools')
returns table (outcome text, employee_number text, onboarding_status text, employment_status text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_number text;
  e record;
begin
  if p_tenant is null or p_platform_tenant is null or not exists (
    select 1 from public.tenants t
    where t.id = p_tenant and t.platform_tenant_id = p_platform_tenant and t.status = 'active') then
    return query select 'unknown_company'::text, null::text, null::text, null::text;
    return;
  end if;
  select m.employee_number into v_number from public.external_people m
  where m.tenant_id = p_tenant and m.source = coalesce(p_source, 'schools') and m.external_id = p_external_id;
  if v_number is null then
    return query select 'not_linked'::text, null::text, null::text, null::text;
    return;
  end if;
  select x."Employee Number" as num, x.onboarding_status as onb, x."Status" as st into e
  from public.employees x where x.tenant_id = p_tenant and x."Employee Number" = v_number;
  if e.num is null then
    return query select 'not_linked'::text, null::text, null::text, null::text;
    return;
  end if;
  return query select 'found'::text, e.num::text, coalesce(e.onb, 'draft')::text, e.st::text;
end $$;
revoke all on function public.my_hr_person(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.my_hr_person(uuid, uuid, text, text) to service_role;

drop function if exists public.my_hr_approver(uuid, uuid, text);
create or replace function public.my_hr_approver(p_tenant uuid, p_platform_tenant uuid, p_external_id text, p_source text default 'schools')
returns table (outcome text, user_id uuid)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_user uuid;
begin
  if p_tenant is null or p_platform_tenant is null or not exists (
    select 1 from public.tenants t
    where t.id = p_tenant and t.platform_tenant_id = p_platform_tenant and t.status = 'active') then
    return query select 'unknown_company'::text, null::uuid;
    return;
  end if;
  select l.user_id into v_user from public.external_logins l
  where l.tenant_id = p_tenant and l.source = coalesce(p_source, 'schools') and l.external_id = p_external_id;
  if v_user is null then
    return query select 'not_linked'::text, null::uuid;
    return;
  end if;
  if not exists (select 1 from public.memberships m
                 where m.user_id = v_user and m.tenant_id = p_tenant and m.account_status = 'ACTIVE') then
    return query select 'no_access'::text, v_user;
    return;
  end if;
  return query select 'found'::text, v_user;
end $$;
revoke all on function public.my_hr_approver(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.my_hr_approver(uuid, uuid, text, text) to service_role;

drop function if exists public.my_hr_leave_import(uuid, uuid, jsonb, boolean);
create or replace function public.my_hr_leave_import(p_tenant uuid, p_platform_tenant uuid, p_records jsonb, p_dry_run boolean,
                                                     p_source text default 'schools')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rec jsonb;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
  v_source text;
  v_external text;
  v_employee public.employees;
  v_start date;
  v_end date;
  v_status text;
  v_type text;
  v_mapped boolean;
  v_days numeric;
  v_existing uuid;
  a public.leave_application;
  v_counts jsonb := '{}'::jsonb;
  v_outcome text;
  v_product text := coalesce(p_source, 'schools');
  v_label text := case when coalesce(p_source, 'schools') = 'schools' then 'Schools' else 'Fleet' end;
begin
  if not (v_product = any (public.platform_sources())) then
    raise exception 'Unknown product %', v_product using errcode = '22023';
  end if;
  if p_tenant is null or p_platform_tenant is null or not exists (
    select 1 from public.tenants t where t.id = p_tenant and t.platform_tenant_id = p_platform_tenant and t.status = 'active') then
    raise exception 'unknown company' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_records) is distinct from 'array' then
    raise exception 'records must be a list' using errcode = '22023';
  end if;

  -- no approval chain (approved on arrival), no notifications, no events
  perform set_config('app.approval_quiet', 'on', true);
  perform set_config('app.my_hr_import', 'on', true);

  for rec in select value from jsonb_array_elements(p_records) loop
    v_result := null;
    v_source := left(btrim(coalesce(rec ->> 'source_id', '')), 201);
    v_external := btrim(coalesce(rec ->> 'external_id', ''));
    v_start := public.leave_parse_date(rec ->> 'start_date');
    v_end := public.leave_parse_date(rec ->> 'end_date');
    v_status := lower(btrim(coalesce(rec ->> 'status', '')));
    v_days := case when coalesce(rec ->> 'days', '') ~ '^\d+(\.\d+)?$' then (rec ->> 'days')::numeric end;
    v_employee := null;
    select e.* into v_employee from public.external_people m
    join public.employees e on e.tenant_id = m.tenant_id and e."Employee Number" = m.employee_number
    where m.tenant_id = p_tenant and m.source = v_product and m.external_id = v_external;

    select i.application_id into v_existing from public.leave_history_imports i
    where i.tenant_id = p_tenant and i.source = v_product and i.source_id = v_source;

    if v_source = '' or char_length(v_source) > 200 then
      v_result := jsonb_build_object('outcome', 'invalid', 'message', 'source_id is needed (200 characters at most)');
    elsif v_existing is not null then
      v_result := jsonb_build_object('outcome', 'already_imported', 'application_id', v_existing);
    elsif v_employee."Employee Number" is null then
      v_result := jsonb_build_object('outcome', 'not_linked', 'message', 'This person is not linked to an HR employee');
    elsif v_start is null or v_end is null or v_end < v_start then
      v_result := jsonb_build_object('outcome', 'invalid', 'message', 'start_date and end_date are YYYY-MM-DD, the end on or after the start');
    elsif v_status <> 'approved' then
      v_result := jsonb_build_object('outcome', 'skipped', 'message', 'Only approved leave is imported');
    else
      select t.name into v_type from public.leave_types t
      where t.tenant_id = p_tenant and lower(t.name) = lower(btrim(coalesce(rec ->> 'leave_type_name', '')));
      v_mapped := v_type is null;
      begin
        if v_mapped then
          v_type := 'Imported from ' || v_label;
          insert into public.leave_types (tenant_id, name, description, is_deductible, is_continuous)
          values (p_tenant, v_type, 'Leave imported from Figbloom ' || v_label || ' whose type HR does not have', false, true)
          on conflict (tenant_id, name) where tenant_id is not null do nothing;
        end if;
        insert into public.leave_application (tenant_id, "Employee Number", name, "Office Branch", "Leave Type",
                                              "Start Date", "End Date", days, type, "Application Type", reason, status, time_added)
        values (p_tenant, v_employee."Employee Number", btrim(concat_ws(' ', v_employee."First Name", v_employee."Last Name")),
                v_employee."Town", v_type, to_char(v_start, 'YYYY-MM-DD'), to_char(v_end, 'YYYY-MM-DD'), coalesce(v_days, 0),
                case when v_start = v_end and v_days = 0.5 then 'Half Day' else 'Full Day' end,
                'Imported from Figbloom ' || v_label, 'Imported from Figbloom ' || v_label, 'approved', now())
        returning * into a;
        insert into public.leave_history_imports (tenant_id, source, source_id, application_id)
        values (p_tenant, v_product, v_source, a.id);
        v_result := jsonb_build_object('outcome', case when p_dry_run then 'would_import' else 'imported' end,
          'application_id', case when p_dry_run then null else a.id end,
          'employee_number', a."Employee Number", 'leave_type', a."Leave Type", 'type_mapped', v_mapped,
          'start_date', a."Start Date", 'end_date', a."End Date", 'days', a.days, 'schools_days', v_days, 'source_days', v_days);
        if p_dry_run then
          raise exception 'dry run' using errcode = 'XMHR1';
        end if;
      exception
        when sqlstate 'XMHR1' then
          null; -- the dry run's rollback: v_result stays
        when others then
          v_result := jsonb_build_object('outcome', 'refused',
            'reason', case when sqlerrm like 'This overlaps %' then 'overlap' when sqlerrm like 'Not enough %' then 'balance' else 'rules' end,
            'message', left(sqlerrm, 300));
      end;
    end if;
    v_outcome := v_result ->> 'outcome';
    v_counts := v_counts || jsonb_build_object(v_outcome, coalesce((v_counts ->> v_outcome)::int, 0) + 1);
    v_results := v_results || (jsonb_build_object('source_id', nullif(v_source, ''), 'external_id', nullif(v_external, '')) || v_result);
  end loop;

  perform set_config('app.approval_quiet', '', true);
  perform set_config('app.my_hr_import', '', true);
  return jsonb_build_object('dry_run', coalesce(p_dry_run, false), 'counts', v_counts, 'results', v_results);
end $$;
revoke all on function public.my_hr_leave_import(uuid, uuid, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.my_hr_leave_import(uuid, uuid, jsonb, boolean, text) to service_role;

notify pgrst, 'reload schema';
