-- "Also tell" on an approval workflow (FIG-878): roles told when a request is finally approved or rejected, without
-- being a step themselves - "the line manager approves, HR is told".
--
--   approval_workflows.notify_roles   e.g. {HR}; empty = nobody extra
--   approval_requests.notify_roles    copied when the request is made, like its steps
-- When a request ends (approved or rejected), everyone in the company with one of those roles hears about it in their
-- notifications (and so by email), except the person who asked and whoever made the decision.

alter table public.approval_workflows add column if not exists notify_roles text[] not null default '{}';
alter table public.approval_requests add column if not exists notify_roles text[] not null default '{}';

create or replace function public.valid_role_list(p text[]) returns boolean language sql immutable as $$
  select p is not null and cardinality(p) <= 10
     and not exists (select 1 from unnest(p) r where r is null or r !~ '^[A-Z][A-Z0-9_]{0,39}$')
$$;
alter table public.approval_workflows drop constraint if exists approval_workflows_notify_roles_check;
alter table public.approval_workflows add constraint approval_workflows_notify_roles_check check (public.valid_role_list(notify_roles));

-- a new request takes the workflow's "also tell" with its steps
create or replace function public.approval_start(p_tenant uuid, p_kind text, p_record uuid, p_requester text)
returns public.approval_requests
language plpgsql security definer set search_path = public as $$
declare
  w public.approval_workflows := public.approval_workflow_create(p_tenant, p_kind);
  v_steps jsonb;
  r public.approval_requests;
begin
  select jsonb_agg(public.approval_step_json(s) order by s.position) into v_steps
  from public.approval_steps s where s.workflow_id = w.id;
  insert into public.approval_requests (tenant_id, workflow_id, kind, record_id, requester_employee_number, steps, admins_can_act, notify_roles)
  values (p_tenant, w.id, p_kind, p_record, p_requester, coalesce(v_steps, public.approval_default_steps(p_kind)), w.admins_can_act,
          coalesce(w.notify_roles, '{}'))
  on conflict (kind, record_id) do nothing
  returning * into r;
  if r.id is null then
    select * into r from public.approval_requests where kind = p_kind and record_id = p_record;
    return r;
  end if;
  return public.approval_advance(r.id, 1, null);
end $$;
revoke all on function public.approval_start(uuid, text, uuid, text) from public, anon, authenticated;

-- the screen reads it with the steps
create or replace function public.approval_workflow(p_kind text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'kind', p_kind,
    'admins_can_act', coalesce(w.admins_can_act, true),
    'notify_roles', to_jsonb(coalesce(w.notify_roles, '{}'::text[])),
    'department_head_available', public.approval_department_head_available(),
    'steps', coalesce((
      select jsonb_agg(public.approval_step_json(s) || jsonb_build_object(
               'approver_employee_number', a."Employee Number", 'approver_name', public.approval_employee_name(a),
               'alternate_employee_number', b."Employee Number", 'alternate_name', public.approval_employee_name(b))
             order by s.position)
      from public.approval_steps s
      left join public.employees a on a.id = s.approver_employee_id
      left join public.employees b on b.id = s.alternate_employee_id
      where s.workflow_id = w.id), public.approval_default_steps(p_kind)))
  from (select 1) one
  left join public.approval_workflows w on w.tenant_id = public.current_tenant_id() and w.kind = p_kind
  where public.current_tenant_id() is not null
$$;
revoke all on function public.approval_workflow(text) from public, anon;
grant execute on function public.approval_workflow(text) to authenticated;

-- saving takes the "also tell" roles too (null leaves them as they are)
create or replace function public.save_approval_workflow_notify(p_kind text, p_notify_roles text[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_roles text[];
begin
  if v_tenant is null or not public.has_any_module('settings') then
    raise exception 'Only an admin or someone with Settings can change approval workflows' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct upper(btrim(r))) filter (where nullif(btrim(r), '') is not null), '{}')
  into v_roles from unnest(coalesce(p_notify_roles, '{}'::text[])) r;
  if not public.valid_role_list(v_roles) then
    raise exception 'Choose up to 10 roles to tell' using errcode = '22023';
  end if;
  perform public.approval_workflow_create(v_tenant, p_kind);
  update public.approval_workflows set notify_roles = v_roles, updated_by = auth.uid(), updated_at = now()
  where tenant_id = v_tenant and kind = p_kind;
end $$;
revoke all on function public.save_approval_workflow_notify(text, text[]) from public, anon;
grant execute on function public.save_approval_workflow_notify(text, text[]) to authenticated;

drop function if exists public.save_approval_workflow(text, jsonb, boolean, text[]);
create or replace function public.save_approval_workflow(p_kind text, p_steps jsonb, p_admins_can_act boolean, p_notify_roles text[])
returns public.approval_workflows
language plpgsql security definer set search_path = public as $$
declare
  w public.approval_workflows;
begin
  w := public.save_approval_workflow(p_kind, p_steps, p_admins_can_act);
  if p_notify_roles is not null then
    perform public.save_approval_workflow_notify(p_kind, p_notify_roles);
    select * into w from public.approval_workflows where id = w.id;
  end if;
  return w;
end $$;
revoke all on function public.save_approval_workflow(text, jsonb, boolean, text[]) from public, anon;
grant execute on function public.save_approval_workflow(text, jsonb, boolean, text[]) to authenticated;

-- when a request ends, the "also tell" roles hear about it
create or replace function public.approval_notify_roles_on_decision() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  l public.leave_application;
  who text;
  what text;
  by_whom text;
  p public.employees;
  r text;
  told uuid[] := '{}';
  me text := public.current_employee_number();
begin
  if new.status = old.status or new.status not in ('approved', 'rejected') or cardinality(new.notify_roles) = 0
     or coalesce(current_setting('app.approval_quiet', true), '') = 'on' then
    return null;
  end if;
  if new.kind = 'leave' then
    select * into l from public.leave_application where id = new.record_id;
    if l.id is null then
      return null;
    end if;
    who := coalesce(nullif(btrim(l.name), ''), l."Employee Number");
    what := who || '''s ' || public.approval_leave_text(l);
  else
    what := 'A ' || replace(new.kind, '_', ' ') || ' request';
  end if;
  select a.actor_name into by_whom from public.approval_actions a
  where a.request_id = new.id and a.decision in ('approved', 'rejected') order by a.created_at desc, a.id desc limit 1;

  foreach r in array new.notify_roles loop
    for p in select * from public.approval_people(new.tenant_id, 'role', r, null, new.requester_employee_number) loop
      if p.id = any(told) or p."Employee Number" is not distinct from new.requester_employee_number
         or p."Employee Number" is not distinct from me then
        continue;
      end if;
      told := told || p.id;
      perform public.notify_employee(p.id, 'approval_progress',
        case when new.status = 'approved' then 'Leave approved' else 'Leave rejected' end,
        what || ' was ' || new.status || coalesce(' by ' || nullif(btrim(by_whom), ''), '') || '.');
    end loop;
  end loop;
  return null;
end $$;
drop trigger if exists approval_notify_roles_on_decision on public.approval_requests;
create trigger approval_notify_roles_on_decision after update of status on public.approval_requests
  for each row execute function public.approval_notify_roles_on_decision();

notify pgrst, 'reload schema';
