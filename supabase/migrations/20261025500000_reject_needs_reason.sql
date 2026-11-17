-- A rejection needs a reason (the employee saw their leave turned down with none).
--
-- decide_approval (20261015800000) took the comment as optional for both decisions. Rejecting now needs one, as
-- sending approved leave back to pending already does (reopen_leave): it goes on the request's chain and in the
-- "rejected" notification the employee gets. Approving still needs none. Every kind of request (leave, salary
-- advances, bulk imports) goes through this function, so the rule is the same for all of them.
-- (20261015800000's, with the reason check before the decision is written)
create or replace function public.decide_approval(p_request uuid, p_decision text, p_comment text default null)
returns public.approval_requests
language plpgsql security definer set search_path = public as $$
declare
  r public.approval_requests;
  step jsonb;
  how text;
  i int;
  me text := public.current_employee_number();
  actor text;
  note text := nullif(btrim(p_comment), '');
begin
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'The decision must be approved or rejected' using errcode = '22023';
  end if;
  if char_length(coalesce(note, '')) > 1000 then
    raise exception 'The comment is too long (1000 characters at most)' using errcode = '22023';
  end if;
  select * into r from public.approval_requests where id = p_request and tenant_id = public.current_tenant_id() for update;
  if r.id is null then
    raise exception 'Approval request not found' using errcode = 'P0002';
  end if;
  if r.status <> 'pending' then
    raise exception 'This request has already been %', r.status using errcode = '55000';
  end if;
  if me is not null and me = r.requester_employee_number then
    raise exception 'You cannot decide your own request' using errcode = '42501';
  end if;

  step := r.steps -> (r.current_step - 1);
  how := public.approval_acting_as(r.tenant_id, step, r.requester_employee_number, r.admins_can_act);
  if how is null and p_decision = 'rejected' then
    -- a later step's approver may turn it down early
    for i in r.current_step + 1 .. jsonb_array_length(r.steps) loop
      if public.approval_acting_as(r.tenant_id, r.steps -> (i - 1), r.requester_employee_number, false) is not null then
        how := 'later_step';
        exit;
      end if;
    end loop;
  end if;
  if how is null then
    raise exception 'You are not the approver for this step' using errcode = '42501';
  end if;

  if p_decision = 'rejected' and note is null then
    raise exception 'Give a reason for rejecting: the employee will see it' using errcode = '22023';
  end if;

  select coalesce((select public.approval_employee_name(e) from public.employees e
                   where e.tenant_id = r.tenant_id and e."Employee Number" = me),
                  (select nullif(btrim(p.full_name), '') from public.user_profiles p where p.user_id = auth.uid()),
                  public.current_user_email())
  into actor;
  insert into public.approval_actions (tenant_id, request_id, step, decision, comment, acted_as, actor_name)
  values (r.tenant_id, r.id, r.current_step, p_decision, note, how, actor);

  if p_decision = 'rejected' then
    update public.approval_requests set status = 'rejected', decided_at = now() where id = r.id returning * into r;
    perform public.approval_apply(r, 'rejected', r.current_step = jsonb_array_length(r.steps), how <> 'later_step', note, actor);
    return r;
  end if;

  if r.current_step >= jsonb_array_length(r.steps) then
    update public.approval_requests set status = 'approved', decided_at = now() where id = r.id returning * into r;
    perform public.approval_apply(r, 'approved', true, true, note, actor);
    return r;
  end if;
  r := public.approval_advance(r.id, r.current_step + 1, actor);
  if r.status = 'pending' then
    perform public.approval_apply(r, 'approved', false, true, note, actor);
  end if;
  return r;
end $$;
revoke all on function public.decide_approval(uuid, text, text) from public, anon;
grant execute on function public.decide_approval(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
