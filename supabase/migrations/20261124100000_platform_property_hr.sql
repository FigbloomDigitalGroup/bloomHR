-- Figbloom Property + Figbloom HR (ERP/PROPERTY_HR_CONTRACT.md section 2): Property takes Fleet's place in the
-- platform integration (20261112100000_platform_fleet_hr.sql), product id 'property'. That migration made everything
-- follow the person's source product, but a few places still name the products:
--
--   platform_sources()             the products whose people HR maps: schools, fleet, now property. Everything that
--                                  checks a source (platform_enable_hr, platform_upsert_staff, platform_staff_left,
--                                  hr.employee.left, hr.leave.*, my_hr_*) goes through it.
--   platform_leave_steps(source)   Property's chain: 1. Leave Approver, 2. role ADMIN labelled "Property manager" (the
--                                  workspace's admins in HR: its creator, invited as ADMIN, and whoever they make ADMIN).
--                                  Schools ("School admin") and Fleet ("Company admin") are unchanged, so no existing
--                                  company's chain changes.
--   platform_staff_left()          the exit's reason in Property's words ("Left the workspace in Figbloom Property on").
--   my_hr_leave_import()           leave imported from Property is labelled "Imported from Figbloom Property".
--
-- tenants.platform_source's check only asks for a lower-case id, so 'property' needs no change there. Safe to run again.

create or replace function public.platform_sources() returns text[] language sql immutable as $$
  select array['schools', 'fleet', 'property']::text[]
$$;
revoke all on function public.platform_sources() from public, anon, authenticated;

create or replace function public.platform_leave_steps(p_source text) returns jsonb language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('label', null, 'approver_type', 'leave_approver', 'approver_role', null, 'approver_module', null,
                       'approver_employee_id', null, 'alternate_type', null, 'alternate_role', null,
                       'alternate_employee_id', null, 'skip_if_requester', true),
    jsonb_build_object('label', case coalesce(p_source, 'schools') when 'schools' then 'School admin'
                                                                   when 'property' then 'Property manager'
                                                                   else 'Company admin' end,
                       'approver_type', 'role', 'approver_role', 'ADMIN', 'approver_module', null,
                       'approver_employee_id', null, 'alternate_type', null, 'alternate_role', null,
                       'alternate_employee_id', null, 'skip_if_requester', true))
$$;
revoke all on function public.platform_leave_steps(text) from public, anon, authenticated;

-- (20261112100000's, with Property's words)
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
          case p_source when 'schools' then 'Left the school in Figbloom Schools on '
                        when 'property' then 'Left the workspace in Figbloom Property on '
                        else 'Left the company in Figbloom Fleet on ' end
            || to_char(v_left, 'DD Mon YYYY'),
          least(v_left, current_date), greatest(v_left - least(v_left, current_date), 0), v_left);
  return query select v_number, 'exit_started'::text;
end $$;
revoke all on function public.platform_staff_left(uuid, text, text, date) from public, anon, authenticated;
grant execute on function public.platform_staff_left(uuid, text, text, date) to service_role;

-- (20261112100000's, with Property's label)
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
  v_label text := case coalesce(p_source, 'schools') when 'schools' then 'Schools' when 'property' then 'Property' else 'Fleet' end;
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
