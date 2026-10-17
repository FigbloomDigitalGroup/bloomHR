-- A "Company" area in the staff portal: the company calendar, the organogram, the departments, and who approves
-- the employee's leave, for every signed-in employee, read-only.
--
--   my_approval_chain(kind)  the signed-in employee's approval chain for a kind of request ('leave' by default), worked
--                            out BEFORE they ask, the way approval_start / approval_advance would on the company's
--                            workflow today: the steps it will go through in order with who decides each ("Max
--                            Manager", "HR"), the steps it will pass over and why (the approver is the person asking,
--                            or they have nobody in that place), the roles also told when it ends ("also tell"), and
--                            whether it falls back to an admin because every step is passed over.
--   company_directory()      the caller's company's current employees with only what an organogram needs: name, job
--                            title, department, who they report to, photo. No contact details, dates, ID or pay.
--                            People who have left are not in it.
--
-- Nothing else changes: the calendar reads holidays and company_events (every employee already reads them), birthdays
-- as the staff Celebrations card does, and the employee's own leave through leave_application's own_select; the
-- departments table is already readable by everyone in the company. No access is widened.

-- ---------------------------------------------------------------------------------------------
-- 1. who approves my leave
-- ---------------------------------------------------------------------------------------------
create or replace function public.my_approval_chain(p_kind text default 'leave') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  me text := public.current_employee_number();
  w public.approval_workflows;
  v_steps jsonb;
  s jsonb;
  n int;
  reason text;
  goes jsonb := '[]'::jsonb;
  passed jsonb := '[]'::jsonb;
  fallback boolean := false;
begin
  if v_tenant is null then
    return null;
  end if;
  if p_kind is null or p_kind not in ('leave', 'salary_advance', 'bulk_import') then
    raise exception 'Unknown kind of request: %', p_kind using errcode = '22023';
  end if;

  -- the company's workflow as a new request would copy it (today's default when it has none yet)
  select * into w from public.approval_workflows where tenant_id = v_tenant and kind = p_kind;
  if w.id is not null then
    select jsonb_agg(public.approval_step_json(st) order by st.position) into v_steps
    from public.approval_steps st where st.workflow_id = w.id;
  end if;
  v_steps := coalesce(v_steps, public.approval_default_steps(p_kind));

  for s, n in select e.value, e.ord::int from jsonb_array_elements(v_steps) with ordinality as e(value, ord) loop
    reason := public.approval_skip_reason(v_tenant, s, me);
    if reason is null then
      goes := goes || jsonb_build_array(jsonb_build_object(
        'position', n,
        'label', public.approval_step_label(v_tenant, s),
        'approver_type', s ->> 'approver_type',
        'approver_role', s ->> 'approver_role',
        'who', public.approval_waiting_on(v_tenant, s, me)));
    else
      passed := passed || jsonb_build_array(jsonb_build_object(
        'position', n,
        'label', public.approval_step_label(v_tenant, s),
        'approver_type', s ->> 'approver_type',
        'reason', reason));
    end if;
  end loop;

  -- every step passed over: approval_advance hands it to an admin rather than approving it by itself
  if jsonb_array_length(goes) = 0 then
    fallback := true;
    goes := jsonb_build_array(jsonb_build_object(
      'position', jsonb_array_length(v_steps) + 1, 'label', 'Admin', 'approver_type', 'role', 'approver_role', 'ADMIN',
      'who', 'ADMIN'));
  end if;

  return jsonb_build_object(
    'kind', p_kind,
    'has_employee_record', me is not null,
    'steps', goes,
    'skipped', passed,
    'also_told', to_jsonb(coalesce(w.notify_roles, '{}'::text[])),
    'admin_fallback', fallback);
end $$;
revoke all on function public.my_approval_chain(text) from public, anon;
grant execute on function public.my_approval_chain(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. the organogram's people, safe columns only
-- ---------------------------------------------------------------------------------------------
create or replace function public.company_directory()
returns table (id uuid, employee_number text, first_name text, middle_name text, last_name text, job_title text,
               department_id uuid, department text, reports_to_id uuid, photo text)
language sql stable security definer set search_path = public as $$
  select e.id, e."Employee Number"::text, e."First Name"::text, e."Middle Name"::text, e."Last Name"::text,
         e."Job Title"::text, e.department_id, e."Job Level"::text, e.reports_to_id, e."Profile Image"::text
  from public.employees e
  where public.current_tenant_id() is not null
    and e.tenant_id = public.current_tenant_id()
    and coalesce(e."Status", '') !~* '(terminat|resign|exit|left)'
  order by e."First Name", e."Employee Number"
$$;
revoke all on function public.company_directory() from public, anon;
grant execute on function public.company_directory() to authenticated;

notify pgrst, 'reload schema';
