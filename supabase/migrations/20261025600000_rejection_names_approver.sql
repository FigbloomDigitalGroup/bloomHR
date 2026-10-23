-- The "Leave application rejected" notification (and so its email) says who rejected it.
--
-- approval_apply (20261015800000) already had the decider's name (p_actor) and put it in the "moving on" message, but
-- the rejection said only "has been rejected." with the reason. It now reads "has been rejected by Ian Duncan." and then
-- the reason. Nothing else changes.
-- (20261015800000's, with the name in the rejection)
create or replace function public.approval_apply(r public.approval_requests, p_decision text, p_final boolean,
                                                 p_by_step boolean, p_comment text, p_actor text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  l public.leave_application;
  note text := nullif(btrim(p_comment), '');
  next_label text;
begin
  if r.kind <> 'leave' then
    return;
  end if;
  perform set_config('app.approval_decision', 'on', true);
  if p_decision = 'approved' and not p_final then
    update public.leave_application set recstatus = 'recommended', recommendation_notes = note
    where id = r.record_id returning * into l;
  elsif p_decision = 'approved' then
    update public.leave_application set status = 'approved', notes = note where id = r.record_id returning * into l;
  elsif not p_final and p_by_step then
    update public.leave_application
    set status = 'rejected', notes = note, recstatus = 'not_recommended', recommendation_notes = note
    where id = r.record_id returning * into l;
  else
    update public.leave_application set status = 'rejected', notes = note where id = r.record_id returning * into l;
  end if;
  perform set_config('app.approval_decision', '', true);
  if l.id is null or coalesce(current_setting('app.approval_quiet', true), '') = 'on' then
    return;
  end if;

  if p_decision = 'approved' and not p_final then
    next_label := public.approval_step_label(r.tenant_id, r.steps -> (r.current_step - 1));
    perform public.notify_employee_number(r.tenant_id, l."Employee Number", 'approval_progress', 'Leave application moving on',
      'Your ' || public.approval_leave_text(l) || ' was approved by ' || coalesce(p_actor, 'your approver')
      || '. It is now waiting on ' || next_label || '.');
  elsif p_decision = 'approved' then
    perform public.notify_employee_number(r.tenant_id, l."Employee Number", 'leave_approved', 'Leave application approved',
      'Your ' || public.approval_leave_text(l) || ' has been approved.');
  else
    perform public.notify_employee_number(r.tenant_id, l."Employee Number", 'leave_rejected', 'Leave application rejected',
      'Your ' || public.approval_leave_text(l) || ' has been rejected'
      || coalesce(' by ' || nullif(btrim(p_actor), ''), '') || '.' || public.with_note('Reason', note));
  end if;
end $$;
revoke all on function public.approval_apply(public.approval_requests, text, boolean, boolean, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
