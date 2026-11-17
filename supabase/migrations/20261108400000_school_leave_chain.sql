-- A school-shaped leave approval chain for the HR companies Figbloom Schools creates (platform_enable_hr(),
-- 20261105100000), so a teacher's leave reaches the head teacher's "Leave to approve" (my_leave_approvals()).
--
-- Every company starts on HR's default leave chain: 1. the employee's Leave Approver, 2. anyone with the role HR. A
-- school's company has nobody with HR: the school's admins are invited as ADMIN, and my_leave_approvals() lists only
-- what waits on someone as approver or alternate (not admins acting on any step), so applications sat at step 2 with
-- nobody seeing them. A school company now gets:
--   1. the employee's Leave Approver (or Alternate), as before: skipped when they have none or are the person asking
--   2. "School admin": approver_type 'role', approver_role 'ADMIN' - the people the school had HR invite on enable.
--      approval_acting_as() already resolves a role step to whoever holds the role (current_user_role()), so the step
--      is in their my_leave_approvals() and they decide it with decide_approval() (the My HR path,
--      my_hr_leave_decide(), switches the login into the company first, so its role there counts). Nothing new is
--      granted: they are admins already. A 'person' step would need each admin to have an employee record (invitees
--      usually have none), and giving them the HR role as well would add HR's modules to people who are admins
--      already, for no gain.
--   A bursar step is not added. HR admins add one in Settings > Approval workflows > Leave: "Add step", then
--   "Who approves" = a person (the bursar's employee record), or anyone with a role or a module, and Save. Once a
--   school saves its chain there, nothing here changes it again.
--
-- platform_school_leave_chain(tenant[, reroute_pending]) (service_role only) sets it, and platform_enable_hr() calls it
-- for each company it creates. It changes a company's chain only when the company is a school company
-- (tenants.platform_tenant_id) and its leave chain is still exactly HR's default as created (the default steps, never
-- saved from Settings: approval_workflows.updated_by is null). A chain that already is the school one is left as it
-- is (running it again does nothing), and any other (customised) chain is never touched. Non-school companies are
-- never touched.
--
-- Requests already made keep their own copy of the steps (approval_requests.steps, taken when the request starts), so
-- a pending application stays waiting on "HR". With p_reroute_pending => true, the company's pending leave requests
-- whose copy is still HR's default get the school chain as their copy, at the same step (the steps line up: step 1 is
-- the same, step 2 HR becomes School admin), so one waiting on HR appears in the admins' "Leave to approve". Nothing
-- else about them changes (history, current step; nobody is notified). Requests on any other copy are left alone.
--
-- Safe to run again.

-- the parts of a chain that matter, whatever keys its copy happens to carry (older copies have no approver_module)
create or replace function public.approval_steps_key(p_steps jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'label', nullif(btrim(x.s ->> 'label'), ''), 'approver_type', x.s ->> 'approver_type',
           'approver_role', x.s ->> 'approver_role', 'approver_module', x.s ->> 'approver_module',
           'approver_employee_id', x.s ->> 'approver_employee_id', 'alternate_type', x.s ->> 'alternate_type',
           'alternate_role', x.s ->> 'alternate_role', 'alternate_employee_id', x.s ->> 'alternate_employee_id',
           'skip_if_requester', coalesce((x.s ->> 'skip_if_requester')::boolean, true)) order by x.n), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_steps) = 'array' then p_steps else '[]'::jsonb end)
       with ordinality as x(s, n)
$$;
revoke all on function public.approval_steps_key(jsonb) from public, anon, authenticated;

-- a school company's leave chain: the Leave Approver, then the school's admins
create or replace function public.platform_school_leave_steps() returns jsonb language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('label', null, 'approver_type', 'leave_approver', 'approver_role', null, 'approver_module', null,
                       'approver_employee_id', null, 'alternate_type', null, 'alternate_role', null,
                       'alternate_employee_id', null, 'skip_if_requester', true),
    jsonb_build_object('label', 'School admin', 'approver_type', 'role', 'approver_role', 'ADMIN', 'approver_module', null,
                       'approver_employee_id', null, 'alternate_type', null, 'alternate_role', null,
                       'alternate_employee_id', null, 'skip_if_requester', true))
$$;
revoke all on function public.platform_school_leave_steps() from public, anon, authenticated;

/**
 * Puts a school company on the school leave chain (see above). Returns
 *   { tenant_id, chain: 'set' | 'already_school' | 'customised' | 'not_school', rerouted: <pending requests moved> }
 * 'not_school': no such company, or not created for a platform tenant; nothing is changed. Server only.
 */
create or replace function public.platform_school_leave_chain(p_tenant uuid, p_reroute_pending boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.tenants;
  w public.approval_workflows;
  v_key jsonb;
  v_chain text;
  v_school jsonb := public.platform_school_leave_steps();
  v_default jsonb := public.approval_steps_key(public.approval_default_steps('leave'));
  s jsonb;
  i int := 0;
  v_rerouted int := 0;
begin
  select * into t from public.tenants x where x.id = p_tenant;
  if t.id is null or t.platform_tenant_id is null then
    return jsonb_build_object('tenant_id', p_tenant, 'chain', 'not_school', 'rerouted', 0);
  end if;

  perform public.approval_workflow_create(t.id, 'leave');
  select * into w from public.approval_workflows x where x.tenant_id = t.id and x.kind = 'leave' for update;
  select public.approval_steps_key(jsonb_agg(public.approval_step_json(st) order by st.position)) into v_key
  from public.approval_steps st where st.workflow_id = w.id;

  if v_key = public.approval_steps_key(v_school) then
    v_chain := 'already_school';
  elsif v_key = v_default and w.updated_by is null then
    delete from public.approval_steps where workflow_id = w.id;
    for s in select value from jsonb_array_elements(v_school) loop
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
    update public.approval_requests r set steps = v_school
    where r.tenant_id = t.id and r.kind = 'leave' and r.status = 'pending'
      and public.approval_steps_key(r.steps) = v_default;
    get diagnostics v_rerouted = row_count;
  end if;

  return jsonb_build_object('tenant_id', t.id, 'chain', v_chain, 'rerouted', v_rerouted);
end $$;
revoke all on function public.platform_school_leave_chain(uuid, boolean) from public, anon, authenticated;
grant execute on function public.platform_school_leave_chain(uuid, boolean) to service_role;

-- (20261105100000's, plus: the new company gets the school leave chain)
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
  -- leave goes to the person's Leave Approver, then the school's admins (not to an HR role nobody here has)
  perform public.platform_school_leave_chain(t.id);

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
