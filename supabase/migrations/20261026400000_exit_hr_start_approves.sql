-- An exit HR starts is approved as it starts (Oct 26: "if HR is starting it, they should just be allowed").
--
-- Before: someone with Approve exits had to approve, and not the person who started it while another holder existed.
-- Now:
--   * whoever holds Approve exits (or is an administrator) may approve any exit, their own start included;
--   * an exit they start for someone else (a termination, or a resignation on that person's behalf) is approved at
--     once, which also adds the clearance checklist and sends the usual notices (employee_exit_after), as a manual
--     approval does;
--   * a resignation an employee sends from the staff portal, and an exit started by someone with only the HR
--     lifecycle module, still wait for approval as before.

create or replace function public.exit_decision_refusal(p_requested_by uuid, p_decision text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid;
begin
  select p.tenant_id into v_tenant from public.user_profiles p where p.user_id = auth.uid();
  if v_tenant is null or not public.has_module('approve-exits') then
    return 'Only HR or an administrator can approve or decline an exit';
  end if;
  return null;
end $$;

create or replace function public.employee_exit_approve_on_start() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'requested' and auth.uid() is not null and new.requested_by = auth.uid()
     and new.employee_number is distinct from public.current_employee_number()
     and public.has_module('approve-exits') then
    update public.employee_exits set status = 'approved' where id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists employee_exit_approve_on_start on public.employee_exits;
create trigger employee_exit_approve_on_start after insert on public.employee_exits
  for each row execute function public.employee_exit_approve_on_start();

notify pgrst, 'reload schema';
