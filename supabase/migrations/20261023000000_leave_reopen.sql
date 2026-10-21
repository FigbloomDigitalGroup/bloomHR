-- Operations' final say on leave (the COO's ask).
--
-- 1. Operations as the last approver is a workflow setting: a last step "Anyone with a role: OPERATIONS" in
--    Settings > Approval workflows. Nothing here is needed for that.
-- 2. Reopening: whoever holds the new "Reopen approved leave" module (given once to Operations; administrators always
--    have it) can send an approved leave back to pending, with a reason, until it starts.
--    The days go back to the balance (leave_application_balance), the chain starts again from its first step on the
--    company's workflow as it is now, and the employee is told why. The reopen is kept in approval_actions; the chain
--    shows only what was decided since.
-- 3. A decided application's status no longer changes by a direct update either (before, only a pending one was
--    guarded): it changes through its chain or reopen_leave, so every change is recorded.

-- ---------------------------------------------------------------------------------------------
-- 1. a reopen is an action on the request
-- ---------------------------------------------------------------------------------------------
alter table public.approval_actions drop constraint if exists approval_actions_decision_check;
alter table public.approval_actions add constraint approval_actions_decision_check
  check (decision in ('approved', 'rejected', 'skipped', 'reopened'));
alter table public.approval_actions drop constraint if exists approval_actions_acted_as_check;
alter table public.approval_actions add constraint approval_actions_acted_as_check
  check (acted_as in ('approver', 'alternate', 'admin', 'later_step', 'system', 'reopener'));

-- the power to take an approval back, given once to Operations (a module, not the role's name, so a company can give it
-- to another role or take it away in Settings > Roles)
do $$
begin
  perform public.seed_module_once('reopen-leave', 'Reopen approved leave',
    'Send approved leave back to pending, with a reason, before it starts', 'people-hr', array['OPERATIONS']);
end $$;

-- the actions of the request's current round: everything after its last reopen (0 = never reopened)
create or replace function public.approval_round_start(p_request uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(max(a.id), 0) from public.approval_actions a where a.request_id = p_request and a.decision = 'reopened'
$$;
revoke all on function public.approval_round_start(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. the employee hears about it
-- ---------------------------------------------------------------------------------------------
alter table public.hr_notifications drop constraint if exists hr_notifications_notification_type_check;
alter table public.hr_notifications add constraint hr_notifications_notification_type_check check (notification_type in (
  'contract_expiring', 'probation_expiring', 'leave_recommended', 'leave_approved', 'leave_rejected', 'leave_year_end_reminder',
  'document_accepted', 'document_rejected', 'onboarding_approved', 'onboarding_changes_requested', 'photo_removed',
  'document_requested',
  'salary_advance_approved', 'salary_advance_rejected', 'salary_advance_paid', 'loan_approved', 'loan_rejected',
  'payslip_ready', 'salary_paid', 'expense_approved', 'expense_rejected', 'phone_change_approved', 'phone_change_rejected',
  'incident_update', 'warning_issued', 'suspended', 'reactivated', 'employment_update', 'leave_scheduled', 'policy_to_accept',
  'task_assigned', 'asset_assigned',
  -- every type added since the approval workflows (20261015800000) must stay in this list
  'approval_needed', 'approval_progress',
  'exit_requested', 'exit_approved', 'exit_declined',
  'application_received',
  'loan_requested', 'loan_disbursed', 'loan_repaid',
  'contract_sent', 'contract_sent_back', 'contract_accepted', 'contract_cancelled', 'contract_signed',
  'leave_exhausted', 'casual_limit',
  'leave_document_overdue',
  'contribution_requested',
  'company_digest',
  'onboarding_followups_overdue',
  'leave_reopened'
));

-- (20261017600000's list, plus leave_reopened: an approval taken back is as important as the approval)
create or replace function public.important_notification(p_type text) returns boolean language sql immutable as $$
  select public.always_emailed(p_type) or p_type in (
    -- the employee's own
    'leave_approved', 'leave_rejected', 'leave_reopened', 'document_rejected', 'document_requested', 'onboarding_changes_requested',
    'salary_advance_approved', 'salary_advance_rejected', 'salary_advance_paid', 'loan_approved', 'loan_rejected',
    'loan_disbursed', 'salary_paid', 'expense_approved', 'expense_rejected', 'reactivated', 'employment_update',
    'policy_to_accept', 'task_assigned', 'approval_needed', 'exit_approved', 'exit_declined', 'contract_sent',
    'contract_sent_back',
    -- for HR: a decision is waiting
    'leave_recommended', 'exit_requested', 'loan_requested', 'contract_signed', 'contract_expiring', 'probation_expiring')
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. moving on counts only this round's approvals
-- ---------------------------------------------------------------------------------------------

-- (20261015800000's, but "nobody has approved anything yet" looks only at the actions since the last reopen: a
-- reopened request whose steps are all skipped goes to an admin rather than straight back to approved)
create or replace function public.approval_advance(p_request uuid, p_from int, p_actor text) returns public.approval_requests
language plpgsql security definer set search_path = public as $$
declare
  r public.approval_requests;
  i int := p_from;
  reason text;
  since bigint := public.approval_round_start(p_request);
begin
  select * into r from public.approval_requests where id = p_request;
  loop
    if i > jsonb_array_length(r.steps) then
      if not exists (select 1 from public.approval_actions a
                     where a.request_id = r.id and a.decision = 'approved' and a.id > since) then
        update public.approval_requests
        set steps = steps || jsonb_build_array(jsonb_build_object(
              'label', 'Admin', 'approver_type', 'role', 'approver_role', 'ADMIN', 'approver_employee_id', null,
              'alternate_type', null, 'alternate_role', null, 'alternate_employee_id', null, 'skip_if_requester', true)),
            current_step = i
        where id = r.id returning * into r;
        return r;
      end if;
      update public.approval_requests set status = 'approved', current_step = i - 1, decided_at = now()
      where id = r.id returning * into r;
      perform public.approval_apply(r, 'approved', true, true, null, p_actor);
      return r;
    end if;
    reason := public.approval_skip_reason(r.tenant_id, r.steps -> (i - 1), r.requester_employee_number);
    exit when reason is null;
    insert into public.approval_actions (tenant_id, request_id, step, decision, comment, acted_as, actor_user_id, actor_name)
    values (r.tenant_id, r.id, i, 'skipped',
            case reason when 'requester' then 'Skipped: the approver is the person asking'
                        else 'Skipped: nobody to approve at this step' end,
            'system', null, null);
    i := i + 1;
  end loop;
  update public.approval_requests set current_step = i where id = r.id returning * into r;
  perform public.approval_notify_step(r, p_actor);
  return r;
end $$;
revoke all on function public.approval_advance(uuid, int, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. reopening
-- ---------------------------------------------------------------------------------------------

-- why the signed-in user may not reopen this leave request now, or null when they may
create or replace function public.leave_reopen_refusal(r public.approval_requests) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  l public.leave_application;
  starts date;
begin
  if r.kind <> 'leave' or r.status <> 'approved' then
    return 'Only approved leave can be sent back to pending';
  end if;
  if not public.has_module('reopen-leave') then
    return 'Only Operations (or an admin) can send approved leave back to pending';
  end if;
  if public.current_employee_number() is not distinct from r.requester_employee_number then
    return 'You cannot reopen your own leave';
  end if;
  select * into l from public.leave_application where id = r.record_id and tenant_id = r.tenant_id;
  if l.id is null or lower(coalesce(l.status, '')) <> 'approved' then
    return 'Only approved leave can be sent back to pending';
  end if;
  starts := public.leave_parse_date(l."Start Date");
  if starts is null or starts <= public.work_today() then
    return 'This leave has already started, so it can no longer be sent back to pending';
  end if;
  return null;
end $$;
revoke all on function public.leave_reopen_refusal(public.approval_requests) from public, anon, authenticated;

/**
 * Operations (whoever holds reopen-leave) sends an approved leave application back to pending, with a reason, before it starts.
 * The days go back to the balance, the approval starts again from the first step of the company's workflow (as it is
 * now), and the employee is told why. Returns the request as it now is.
 */
create or replace function public.reopen_leave(p_application uuid, p_reason text)
returns public.approval_requests
language plpgsql security definer set search_path = public as $$
declare
  r public.approval_requests;
  l public.leave_application;
  w public.approval_workflows;
  v_steps jsonb;
  refusal text;
  actor text;
  me text := public.current_employee_number();
  note text := nullif(btrim(p_reason), '');
begin
  if note is null then
    raise exception 'Give a reason: the employee and the approvers will see it' using errcode = '22023';
  end if;
  if char_length(note) > 1000 then
    raise exception 'The reason is too long (1000 characters at most)' using errcode = '22023';
  end if;
  select * into r from public.approval_requests
  where kind = 'leave' and record_id = p_application and tenant_id = public.current_tenant_id() for update;
  if r.id is null then
    raise exception 'This leave has no approval chain to send it back to (it was entered already decided)' using errcode = 'P0002';
  end if;
  refusal := public.leave_reopen_refusal(r);
  if refusal is not null then
    raise exception '%', refusal using errcode = case when refusal like 'Only Operations%' or refusal like 'You cannot%'
                                                         then '42501' else '55000' end;
  end if;

  select coalesce((select public.approval_employee_name(e) from public.employees e
                   where e.tenant_id = r.tenant_id and e."Employee Number" = me),
                  (select nullif(btrim(p.full_name), '') from public.user_profiles p where p.user_id = auth.uid()),
                  public.current_user_email())
  into actor;
  insert into public.approval_actions (tenant_id, request_id, step, decision, comment, acted_as, actor_name)
  values (r.tenant_id, r.id, r.current_step, 'reopened', note,
          'reopener', actor);

  -- back to pending: the balance trigger gives the days back
  perform set_config('app.approval_decision', 'on', true);
  update public.leave_application set status = 'pending', recstatus = null, recommendation_notes = null, notes = null
  where id = r.record_id returning * into l;
  perform set_config('app.approval_decision', '', true);

  w := public.approval_workflow_create(r.tenant_id, 'leave');
  select jsonb_agg(public.approval_step_json(s) order by s.position) into v_steps
  from public.approval_steps s where s.workflow_id = w.id;
  update public.approval_requests
  set workflow_id = w.id, steps = coalesce(v_steps, public.approval_default_steps('leave')), admins_can_act = w.admins_can_act,
      notify_roles = coalesce(w.notify_roles, '{}'), status = 'pending', current_step = 1, decided_at = null
  where id = r.id;
  r := public.approval_advance(r.id, 1, null);

  if coalesce(current_setting('app.approval_quiet', true), '') <> 'on' then
    perform public.notify_employee_number(r.tenant_id, l."Employee Number", 'leave_reopened', 'Leave sent back for approval',
      'Your ' || public.approval_leave_text(l) || ' was sent back to pending by ' || coalesce(actor, 'Operations')
      || ' and needs to be approved again. The days are back in your balance until then.' || public.with_note('Reason', note));
  end if;
  return r;
end $$;
revoke all on function public.reopen_leave(uuid, text) from public, anon;
grant execute on function public.reopen_leave(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. the chain shows this round, who may reopen, and the last reopen
-- ---------------------------------------------------------------------------------------------
drop function if exists public.approval_chains(text, uuid[]);
create or replace function public.approval_chains(p_kind text, p_record_ids uuid[])
returns table (record_id uuid, request_id uuid, status text, current_step int, can_approve boolean, can_reject boolean,
               steps jsonb, can_reopen boolean, reopened jsonb)
language sql stable security definer set search_path = public as $$
  with visible as (
    select r.*, public.approval_round_start(r.id) as since from public.approval_requests r
    where r.tenant_id = public.current_tenant_id() and r.kind = p_kind and r.record_id = any(p_record_ids)
      and ((p_kind = 'leave' and public.has_any_module('leaves'))
           or r.requester_employee_number = public.current_employee_number()
           or r.id in (select public.approval_request_ids_for_me()))
  ), mine as (
    select v.id, case when v.status = 'pending' and v.requester_employee_number is distinct from public.current_employee_number()
                      then public.approval_acting_as(v.tenant_id, v.steps -> (v.current_step - 1), v.requester_employee_number, v.admins_can_act)
                 end as how,
           v.status = 'pending' and v.requester_employee_number is distinct from public.current_employee_number() and exists (
             select 1 from generate_series(v.current_step + 1, jsonb_array_length(v.steps)) g
             where public.approval_acting_as(v.tenant_id, v.steps -> (g - 1), v.requester_employee_number, false) is not null
           ) as later
    from visible v
  )
  select v.record_id, v.id, v.status, v.current_step::int, m.how is not null, m.how is not null or m.later,
    (select jsonb_agg(jsonb_build_object(
        'position', s.n,
        'label', public.approval_step_label(v.tenant_id, s.step),
        'approver_type', s.step ->> 'approver_type',
        'status', coalesce(a.decision, case when v.status = 'pending' and s.n = v.current_step then 'current'
                                            when v.status = 'pending' then 'upcoming' else 'not_reached' end),
        'waiting_on', case when v.status = 'pending' and s.n = v.current_step
                           then public.approval_waiting_on(v.tenant_id, s.step, v.requester_employee_number) end,
        'actor_name', a.actor_name, 'acted_as', a.acted_as, 'comment', a.comment, 'acted_at', a.created_at
      ) order by s.n)
     from jsonb_array_elements(v.steps) with ordinality as s(step, n)
     left join lateral (
       select x.* from public.approval_actions x
       where x.request_id = v.id and x.step = s.n and x.id > v.since order by x.id desc limit 1
     ) a on true),
    v.status = 'approved' and v.kind = 'leave'
      and public.leave_reopen_refusal((select r from public.approval_requests r where r.id = v.id)) is null,
    (select jsonb_build_object('actor_name', x.actor_name, 'acted_as', x.acted_as, 'comment', x.comment, 'acted_at', x.created_at)
     from public.approval_actions x where x.id = v.since)
  from visible v join mine m on m.id = v.id
$$;
revoke all on function public.approval_chains(text, uuid[]) from public, anon;
grant execute on function public.approval_chains(text, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. a decided application's status changes through its chain too
-- ---------------------------------------------------------------------------------------------

-- (20261015800000's guarded only while pending; leave entered already decided, with no chain, is as before)
create or replace function public.leave_application_guard_decision() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  req_status text;
begin
  if coalesce(current_setting('app.approval_decision', true), '') <> 'on'
     and (new.status is distinct from old.status or new.recstatus is distinct from old.recstatus
          or new.recommendation_notes is distinct from old.recommendation_notes) then
    select r.status into req_status from public.approval_requests r where r.kind = 'leave' and r.record_id = old.id;
    if req_status = 'pending' then
      raise exception 'This leave application is waiting on its approvers: approve or reject it through its approval chain'
        using errcode = '42501';
    elsif req_status is not null then
      raise exception 'This leave application has been %: Operations can send it back to pending (Reopen) before it starts', req_status
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
