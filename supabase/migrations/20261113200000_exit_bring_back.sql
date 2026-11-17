-- Bringing someone back after their exit has ended their access.
--
-- Before: once an approved exit passed the last working day (or HR completed access early), the person was
-- Terminated, their login to the company DEACTIVATED, and the exit could no longer be cancelled ("They have already
-- left"). Nothing in the app could undo the Terminated status: reactivating the login in user management left the
-- employee record Terminated, so the sign-in check kept signing them out, and the open exit kept refusing payslips
-- after their last month.
--
-- Now HR can cancel an exit whose access has ended, as long as it is not completed (a completed exit is history; a
-- returning leaver is hired again). Cancelling it brings them back: the employee is Active again with no Termination
-- Date, and their login to this company (DEACTIVATED by the exit) is ACTIVE again. access_ended_at is kept as the
-- record that their access did end for a while.
--
--   employee_exit_rules()       the same as 20261016400000_exits.sql, without the "already left" refusal on cancel
--   employee_exit_bring_back()  after an ended exit is cancelled: the employee and their login come back

create or replace function public.employee_exit_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_hr boolean := public.manages_exits();
  v_self boolean;
  v_emp public.employees;
  v_refusal text;
  v_ending boolean := current_setting('app.exit_ending', true) = 'on';
begin
  -- an employee renumbered: the foreign key moves their exits along and nothing else changes
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'employee_number') = (to_jsonb(old) - 'employee_number') then
    return new;
  end if;

  if tg_op = 'DELETE' then
    if auth.uid() is not null and old.status not in ('requested', 'declined', 'cancelled') then
      raise exception 'An approved exit can''t be deleted; cancel it instead' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    -- complete_exit() and the daily job end access and close the exit; everything else is checked below
    if v_ending then
      return new;
    end if;
    if old.status = 'completed' then
      raise exception 'A completed exit can''t be changed' using errcode = '42501';
    end if;
    new.tenant_id := old.tenant_id;
    new.kind := old.kind;
    new.requested_by := old.requested_by;
    new.created_at := old.created_at;
    new.access_ended_at := old.access_ended_at;
    new.completed_by := old.completed_by;
    new.completed_at := old.completed_at;
  end if;

  select * into v_emp from public.employees where tenant_id = new.tenant_id and "Employee Number" = new.employee_number;
  if v_emp.id is null then
    raise exception 'Unknown employee %', new.employee_number using errcode = '23503';
  end if;
  new.updated_at := now();
  if new.kind = 'resignation' then
    new.reason_category := 'resignation';
  end if;

  if tg_op = 'INSERT' then
    if lower(coalesce(v_emp."Status", '')) in ('terminated', 'inactive') then
      raise exception '% has already left', coalesce(nullif(btrim(concat_ws(' ', v_emp."First Name", v_emp."Last Name")), ''), new.employee_number);
    end if;
    new.status := 'requested';
    new.decided_by := null; new.decided_at := null; new.decision_note := null;
    new.access_ended_at := null; new.completed_by := null; new.completed_at := null;
    new.created_at := now();
    new.notice_given_on := coalesce(new.notice_given_on, current_date);
    new.notice_days := coalesce(new.notice_days, v_emp.notice_days, 28);
    new.last_working_day := coalesce(new.last_working_day, new.notice_given_on + new.notice_days);
  end if;

  -- the backend and SQL scripts (no signed-in user) are trusted
  if auth.uid() is null then
    return new;
  end if;

  v_self := new.employee_number = public.current_employee_number();

  if tg_op = 'INSERT' then
    new.requested_by := auth.uid();
    if not v_hr then
      if not v_self then
        raise exception 'You can only resign yourself' using errcode = '42501';
      end if;
      if new.kind <> 'resignation' then
        raise exception 'Only HR can start a termination' using errcode = '42501';
      end if;
    end if;
  end if;

  if not v_hr then
    -- the employee, on their own resignation: today's notice, their contract's notice period, no notice pay
    if not v_self or new.kind <> 'resignation' then
      raise exception 'You can only resign yourself' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' then
      if old.status <> 'requested' then
        raise exception 'Your resignation has been %; ask HR to change it', old.status using errcode = '42501';
      end if;
      if new.status not in ('requested', 'cancelled') then
        raise exception 'Only HR can approve or decline a resignation' using errcode = '42501';
      end if;
      new.notice_given_on := old.notice_given_on;
      new.decided_by := old.decided_by; new.decided_at := old.decided_at; new.decision_note := old.decision_note;
    else
      new.notice_given_on := current_date;
    end if;
    new.notice_days := coalesce(v_emp.notice_days, 28);
    new.notice_pay := false;
    if new.last_working_day < new.notice_given_on + new.notice_days then
      raise exception 'Your notice period is % days, so your last working day can be % at the earliest',
        new.notice_days, to_char(new.notice_given_on + new.notice_days, 'DD Mon YYYY') using errcode = '23514';
    end if;
    return new;
  end if;

  -- HR
  if tg_op = 'INSERT' then
    return new;
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'requested' and new.status in ('approved', 'declined', 'cancelled'))
         or (old.status = 'approved' and new.status in ('clearance', 'cancelled'))
         or (old.status = 'clearance' and new.status = 'cancelled')) then
      if new.status = 'completed' then
        raise exception 'Complete an exit with complete_exit(), which also ends their access' using errcode = '42501';
      end if;
      raise exception 'An exit can''t go from % to %', old.status, new.status using errcode = '23514';
    end if;
    if new.status in ('approved', 'declined') then
      v_refusal := public.exit_decision_refusal(old.requested_by, new.status);
      if v_refusal is not null then
        raise exception '%', v_refusal using errcode = '42501';
      end if;
      new.decided_by := auth.uid();
      new.decided_at := now();
    end if;
    -- cancelling after their access ended brings them back (employee_exit_bring_back(), below)
  else
    new.decided_by := old.decided_by;
    new.decided_at := old.decided_at;
  end if;
  return new;
end $$;

create or replace function public.employee_exit_bring_back() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  e public.employees;
begin
  if new.status <> 'cancelled' or old.status = 'cancelled' or old.access_ended_at is null then
    return null;
  end if;
  select * into e from public.employees where tenant_id = new.tenant_id and "Employee Number" = new.employee_number;
  if e.id is null then
    return null;
  end if;
  update public.employees set "Status" = 'Active', "Termination Date" = null
    where id = e.id and (lower(coalesce("Status", '')) in ('terminated', 'inactive') or nullif(btrim("Termination Date"), '') is not null);
  update public.memberships m set account_status = 'ACTIVE'
    from auth.users u
    where u.id = m.user_id and m.tenant_id = new.tenant_id and m.account_status = 'DEACTIVATED'
      and lower(u.email) = lower(btrim(coalesce(e."Work Email", '')));
  -- membership_to_profile() skips changes made inside another trigger (pg_trigger_depth() > 1), so the profile the
  -- sign-in check reads is brought back here, as it would mirror it: only where this is their current company
  update public.user_profiles p set account_status = 'ACTIVE'
    from auth.users u
    where u.id = p.user_id and p.tenant_id = new.tenant_id and p.account_status = 'DEACTIVATED'
      and lower(u.email) = lower(btrim(coalesce(e."Work Email", '')));
  return null;
end $$;
revoke all on function public.employee_exit_bring_back() from public, anon, authenticated;

drop trigger if exists employee_exit_bring_back on public.employee_exits;
create trigger employee_exit_bring_back after update of status on public.employee_exits
  for each row execute function public.employee_exit_bring_back();
