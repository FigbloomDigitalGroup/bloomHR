-- Exits: resignations and terminations, from the request to the last day (FIG-832).
--
--   employee_exits                   one exit per leaver: a resignation (the employee, from the staff portal, or HR on
--                                    their behalf) or a termination (HR). requested -> approved -> clearance -> completed,
--                                    or declined / cancelled on the way.
--   employee_exit_clearance_items    the exit's checklist: assets to return (one per asset assigned to them in Assets),
--                                    IT access, finance (advances, loans, expenses), handover. Each has an owner, done
--                                    and notes. Added when the exit is approved; HR can add more.
--   hr_termination_interviews        (existing) now also the exit interview: exit_id + answers (questions and answers).
--                                    Confidential to HR.
--   employee_exit_final_dues         the final dues statement: lines (pro-rated basic, leave days, notice pay, less
--                                    advances, loans and deductions due), totals, reviewed, and "included in payroll month
--                                    X" (set by hand), for the payroll run to read.
--   employees.notice_days            the notice period on the person's contract (28 days when not set: Employment Act s.35)
--
-- Who does what (enforced by the triggers below, not only by the screens):
--   HR ('employees' or 'hr-lifecycle' module)   starts terminations, records resignations, runs the checklist,
--                                               interview and final dues, completes the exit
--   HR or an administrator (role)               approves or declines; not the person who started the exit when someone
--                                               else can (exit_decision_refusal: the one place to swap for approval
--                                               workflows later)
--   the employee                                resigns themselves only, with at least their notice period; sees their
--                                               own exit and may withdraw or correct it while it waits
--
-- When it ends (the day after the last working day, by the daily job, or when HR completes the exit, whichever is
-- first): the employee becomes Terminated with their Termination Date, their login to this company is deactivated
-- (memberships.account_status, which the sign-in check refuses) and payslips after their last month are refused.

-- ---------------------------------------------------------------------------------------------
-- 1. the notice period on the contract
-- ---------------------------------------------------------------------------------------------
alter table public.employees add column if not exists notice_days integer;
alter table public.employees drop constraint if exists employees_notice_days_check;
alter table public.employees add constraint employees_notice_days_check check (notice_days is null or notice_days between 0 and 365);

-- ---------------------------------------------------------------------------------------------
-- 2. helpers
-- ---------------------------------------------------------------------------------------------
create or replace function public.manages_exits() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_any_module('employees', 'hr-lifecycle')
$$;

-- Why the signed-in user may not approve (or decline) this exit, or null when they may. The built-in approval: HR or an
-- administrator, and for approving, not the person who started it while another HR person or administrator could.
-- When approval workflows arrive, this is the function to replace (and decideExit in src/lib/exits.ts).
create or replace function public.exit_decision_refusal(p_requested_by uuid, p_decision text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text;
  v_tenant uuid;
begin
  select p.role, p.tenant_id into v_role, v_tenant from public.user_profiles p where p.user_id = auth.uid();
  if v_role is null or v_role not in ('ADMIN', 'HR') then
    return 'Only HR or an administrator can approve or decline an exit';
  end if;
  if p_decision = 'approved' and p_requested_by = auth.uid() and exists (
    select 1 from public.memberships m
    where m.tenant_id = v_tenant and m.user_id <> auth.uid() and m.account_status = 'ACTIVE' and m.role in ('ADMIN', 'HR')
  ) then
    return 'You started this exit, so another HR person or an administrator must approve it';
  end if;
  return null;
end $$;

revoke all on function public.manages_exits() from public, anon;
revoke all on function public.exit_decision_refusal(uuid, text) from public, anon;
grant execute on function public.manages_exits() to authenticated;
grant execute on function public.exit_decision_refusal(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. exits
-- ---------------------------------------------------------------------------------------------
create table if not exists public.employee_exits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  employee_number text not null,
  kind text not null check (kind in ('resignation', 'termination')),
  reason_category text check (reason_category in (
    'resignation', 'misconduct', 'poor_performance', 'redundancy', 'contract_end', 'medical', 'mutual_agreement', 'other'
  )),
  reason text,
  notice_given_on date not null default current_date,
  notice_days integer not null check (notice_days between 0 and 365),   -- filled from the contract when not given
  last_working_day date not null,
  notice_pay boolean not null default false,                            -- paid in lieu of the notice not worked
  letter_path text,                                                     -- "documents" bucket: <company>/<login>/...
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'clearance', 'completed', 'declined', 'cancelled')),
  decision_note text,
  requested_by uuid default auth.uid() references auth.users(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  access_ended_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, employee_number) references public.employees(tenant_id, "Employee Number") on update cascade on delete cascade,
  check (kind = 'resignation' or (reason_category is not null and reason_category <> 'resignation')),
  check (last_working_day >= notice_given_on),
  check (status <> 'declined' or nullif(btrim(decision_note), '') is not null)
);
create index if not exists employee_exits_tenant_status on public.employee_exits (tenant_id, status);
-- one open exit per person
create unique index if not exists employee_exits_one_open on public.employee_exits (tenant_id, employee_number)
  where status in ('requested', 'approved', 'clearance');

create table if not exists public.employee_exit_clearance_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  exit_id uuid not null references public.employee_exits(id) on delete cascade,
  category text not null check (category in ('assets', 'it', 'finance', 'handover', 'other')),
  title text not null check (btrim(title) <> ''),
  owner text,                                            -- who clears it: IT, Finance, the line manager...
  asset_id uuid references public.assets(id) on delete set null,
  done boolean not null default false,
  done_by uuid references auth.users(id) on delete set null,
  done_at timestamptz,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists employee_exit_clearance_items_exit on public.employee_exit_clearance_items (exit_id, sort_order);

create table if not exists public.employee_exit_final_dues (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  exit_id uuid not null unique references public.employee_exits(id) on delete cascade,
  employee_number text not null,                          -- copied from the exit, so payroll reads one table
  -- [{ "code": "basic", "label": "...", "detail": "...", "kind": "earning" | "deduction", "amount": 1234.5 }, ...]
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array'),
  earnings numeric(14, 2) not null default 0,
  deductions numeric(14, 2) not null default 0,
  net numeric(14, 2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'included')),
  payroll_period text check (payroll_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),   -- "included in payroll month X"
  prepared_by uuid default auth.uid() references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  included_by uuid references auth.users(id) on delete set null,
  included_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, employee_number) references public.employees(tenant_id, "Employee Number") on update cascade on delete cascade,
  check ((status = 'included') = (payroll_period is not null))
);
create index if not exists employee_exit_final_dues_period on public.employee_exit_final_dues (tenant_id, payroll_period);

-- the exit interview: the existing interviews table, tied to the exit, with its questions and answers
alter table public.hr_termination_interviews
  add column if not exists exit_id uuid references public.employee_exits(id) on delete cascade,
  add column if not exists answers jsonb not null default '[]'::jsonb;
create unique index if not exists hr_termination_interviews_exit on public.hr_termination_interviews (exit_id) where exit_id is not null;

-- ---------------------------------------------------------------------------------------------
-- 4. access
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['employee_exits', 'employee_exit_clearance_items', 'employee_exit_final_dues'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format($p$create policy tenant_isolation on public.%I as restrictive for all
      using (tenant_id = (select public.current_tenant_id()))
      with check (tenant_id = (select public.current_tenant_id()))$p$, t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- the exit: HR, and the employee their own resignation (a termination is HR's until HR tells them; the triggers decide
-- what each may do)
drop policy if exists hr_or_own on public.employee_exits;
create policy hr_or_own on public.employee_exits for select to authenticated
  using ((select public.manages_exits()) or (kind = 'resignation' and employee_number = (select public.current_employee_number())));
drop policy if exists hr_or_own_insert on public.employee_exits;
create policy hr_or_own_insert on public.employee_exits for insert to authenticated
  with check ((select public.manages_exits()) or employee_number = (select public.current_employee_number()));
drop policy if exists hr_or_own_update on public.employee_exits;
create policy hr_or_own_update on public.employee_exits for update to authenticated
  using ((select public.manages_exits()) or (kind = 'resignation' and employee_number = (select public.current_employee_number())))
  with check ((select public.manages_exits()) or employee_number = (select public.current_employee_number()));
drop policy if exists hr_delete on public.employee_exits;
create policy hr_delete on public.employee_exits for delete to authenticated using ((select public.manages_exits()));

-- the checklist and the final dues: HR only
drop policy if exists hr_only on public.employee_exit_clearance_items;
create policy hr_only on public.employee_exit_clearance_items for all to authenticated
  using ((select public.manages_exits())) with check ((select public.manages_exits()));
drop policy if exists hr_only on public.employee_exit_final_dues;
create policy hr_only on public.employee_exit_final_dues for all to authenticated
  using ((select public.manages_exits())) with check ((select public.manages_exits()));

-- exit interviews: confidential to HR (either HR module, like the rest of the exit)
drop policy if exists module_access on public.hr_termination_interviews;
create policy module_access on public.hr_termination_interviews for all to authenticated
  using ((select public.has_any_module('employees', 'hr-lifecycle')))
  with check ((select public.has_any_module('employees', 'hr-lifecycle')));

-- ---------------------------------------------------------------------------------------------
-- 5. rules for exits
-- ---------------------------------------------------------------------------------------------
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
    if new.status = 'cancelled' and old.access_ended_at is not null then
      raise exception 'They have already left; complete the exit instead' using errcode = '23514';
    end if;
  else
    new.decided_by := old.decided_by;
    new.decided_at := old.decided_at;
  end if;
  return new;
end $$;

drop trigger if exists employee_exit_rules on public.employee_exits;
create trigger employee_exit_rules before insert or update or delete on public.employee_exits
  for each row execute function public.employee_exit_rules();

-- ---------------------------------------------------------------------------------------------
-- 6. the checklist, added when the exit is approved
-- ---------------------------------------------------------------------------------------------
create or replace function public.seed_exit_clearance(p_exit uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  x public.employee_exits;
  n integer := 0;
  a record;
begin
  select * into x from public.employee_exits where id = p_exit;
  if x.id is null or exists (select 1 from public.employee_exit_clearance_items where exit_id = x.id) then
    return;
  end if;
  -- what Assets has assigned to them (stored as "First Last (EmpNo)")
  for a in
    select s.id, coalesce(nullif(btrim(s.asset_name), ''), nullif(btrim(s.model), ''), 'Asset') as name, nullif(btrim(s.asset_tag), '') as tag
    from public.assets s
    where s.tenant_id = x.tenant_id and right(btrim(coalesce(s.assigned_to, '')), length(x.employee_number) + 2) = '(' || x.employee_number || ')'
    order by 2
  loop
    n := n + 1;
    insert into public.employee_exit_clearance_items (tenant_id, exit_id, category, title, owner, asset_id, sort_order)
    values (x.tenant_id, x.id, 'assets', 'Return ' || a.name || coalesce(' (' || a.tag || ')', ''), 'Assets', a.id, n);
  end loop;
  insert into public.employee_exit_clearance_items (tenant_id, exit_id, category, title, owner, sort_order)
  values
    (x.tenant_id, x.id, 'assets',
     case when n = 0 then 'Return company property (laptop, phone, ID badge, keys)' else 'Return any other company property (ID badge, keys)' end,
     'Line manager', n + 1),
    (x.tenant_id, x.id, 'it', 'Close email and system access', 'IT', n + 2),
    (x.tenant_id, x.id, 'finance', 'Settle salary advances, loans and expense claims', 'Finance', n + 3),
    (x.tenant_id, x.id, 'handover', 'Hand over work, files and passwords', 'Line manager', n + 4);
end $$;
revoke all on function public.seed_exit_clearance(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. notifications (the staff portal bell and HR's)
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
  -- from the approval workflows (20261015800000): every type added since must stay in this list
  'approval_needed', 'approval_progress',
  'exit_requested', 'exit_approved', 'exit_declined'
));

-- a resignation to decide is for HR (the employee's bell doesn't show it, and it isn't emailed to them)
create or replace function public.hr_only_notification(p_type text) returns boolean language sql immutable as $$
  select p_type in ('contract_expiring', 'probation_expiring', 'leave_recommended', 'exit_requested')
$$;

-- After an exit changes: the checklist on approval; HR hears of a new resignation; the employee hears whether their
-- resignation was accepted. A termination is never announced in the bell: HR tells the person.
create or replace function public.employee_exit_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  e public.employees;
  who text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  select * into e from public.employees where tenant_id = new.tenant_id and "Employee Number" = new.employee_number;
  who := coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), new.employee_number);

  if tg_op = 'INSERT' and new.kind = 'resignation' then
    insert into public.hr_notifications (tenant_id, employee_number, employee_name, work_email, notification_type, title, message)
    values (new.tenant_id, new.employee_number, who, e."Work Email", 'exit_requested', 'Resignation to review',
      who || ' has resigned. Last working day: ' || to_char(new.last_working_day, 'DD Mon YYYY') || '.'
      || public.with_note('Reason', new.reason));
  elsif tg_op = 'UPDATE' and new.status = 'approved' then
    perform public.seed_exit_clearance(new.id);
    if new.kind = 'resignation' then
      perform public.notify_employee_number(new.tenant_id, new.employee_number, 'exit_approved', 'Resignation accepted',
        'Your resignation was accepted. Your last working day is ' || to_char(new.last_working_day, 'DD Mon YYYY') || '.'
        || public.with_note('Notes', new.decision_note));
    end if;
  elsif tg_op = 'UPDATE' and new.status = 'declined' and new.kind = 'resignation' then
    perform public.notify_employee_number(new.tenant_id, new.employee_number, 'exit_declined', 'Resignation not accepted',
      'Your resignation was not accepted.' || public.with_note('Reason', new.decision_note) || ' Please speak to HR.');
  end if;
  return null;
end $$;

drop trigger if exists employee_exit_after on public.employee_exits;
create trigger employee_exit_after after insert or update of status on public.employee_exits
  for each row execute function public.employee_exit_after();

-- ---------------------------------------------------------------------------------------------
-- 8. rules for the checklist and the final dues
-- ---------------------------------------------------------------------------------------------
create or replace function public.exit_part_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  x public.employee_exits;
begin
  select * into x from public.employee_exits where id = case when tg_op = 'DELETE' then old.exit_id else new.exit_id end;
  if auth.uid() is not null and x.status = 'completed' then
    raise exception 'The exit is completed; its checklist and final dues can''t change' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if x.id is null or x.tenant_id <> new.tenant_id then
    raise exception 'Unknown exit' using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' then
    new.exit_id := old.exit_id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();

  if tg_table_name = 'employee_exit_clearance_items' then
    if x.status not in ('approved', 'clearance') and auth.uid() is not null then
      raise exception 'The checklist opens once the exit is approved' using errcode = '23514';
    end if;
    if new.done and (tg_op = 'INSERT' or not old.done) then
      new.done_by := auth.uid(); new.done_at := now();
    elsif not new.done then
      new.done_by := null; new.done_at := null;
    else
      new.done_by := old.done_by; new.done_at := old.done_at;
    end if;
    return new;
  end if;

  -- final dues
  if x.status in ('declined', 'cancelled') then
    raise exception 'The exit was %; there are no final dues', x.status using errcode = '23514';
  end if;
  new.employee_number := x.employee_number;
  if tg_op = 'UPDATE' then
    new.prepared_by := old.prepared_by;
    if old.status = 'included' and new.status = 'included' and (new.lines, new.payroll_period) is distinct from (old.lines, old.payroll_period) then
      raise exception 'This statement is in payroll for %; take it out of that month before changing it', old.payroll_period using errcode = '23514';
    end if;
  else
    new.prepared_by := coalesce(auth.uid(), new.prepared_by);
  end if;
  if exists (
    select 1 from jsonb_array_elements(new.lines) l
    where jsonb_typeof(l) <> 'object' or coalesce(l->>'kind', '') not in ('earning', 'deduction')
       or case when jsonb_typeof(l->'amount') = 'number' then (l->>'amount')::numeric < 0 else true end
       or coalesce(btrim(l->>'label'), '') = ''
  ) then
    raise exception 'Each line needs a label, earning or deduction, and an amount of 0 or more' using errcode = '22023';
  end if;
  select coalesce(round(sum((l->>'amount')::numeric) filter (where l->>'kind' = 'earning'), 2), 0),
         coalesce(round(sum((l->>'amount')::numeric) filter (where l->>'kind' = 'deduction'), 2), 0)
  into new.earnings, new.deductions
  from jsonb_array_elements(new.lines) l;
  new.net := new.earnings - new.deductions;

  if new.status <> 'included' then
    new.payroll_period := null; new.included_by := null; new.included_at := null;
  elsif tg_op = 'INSERT' or old.status <> 'included' or new.payroll_period is distinct from old.payroll_period then
    new.included_by := auth.uid(); new.included_at := now();
  else
    new.included_by := old.included_by; new.included_at := old.included_at;
  end if;
  if new.status = 'draft' then
    new.reviewed_by := null; new.reviewed_at := null;
  elsif tg_op = 'INSERT' or old.status = 'draft' then
    new.reviewed_by := auth.uid(); new.reviewed_at := now();
  else
    new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at;
  end if;
  return new;
end $$;

drop trigger if exists exit_part_rules on public.employee_exit_clearance_items;
create trigger exit_part_rules before insert or update or delete on public.employee_exit_clearance_items
  for each row execute function public.exit_part_rules();
drop trigger if exists exit_part_rules on public.employee_exit_final_dues;
create trigger exit_part_rules before insert or update or delete on public.employee_exit_final_dues
  for each row execute function public.exit_part_rules();

-- ticking the first item moves an approved exit into clearance
create or replace function public.exit_clearance_started() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.done then
    update public.employee_exits set status = 'clearance' where id = new.exit_id and status = 'approved';
  end if;
  return null;
end $$;
drop trigger if exists exit_clearance_started on public.employee_exit_clearance_items;
create trigger exit_clearance_started after insert or update of done on public.employee_exit_clearance_items
  for each row execute function public.exit_clearance_started();

-- ---------------------------------------------------------------------------------------------
-- 9. the end: access, the employee record, payroll
-- ---------------------------------------------------------------------------------------------
-- They are no longer employed: Terminated with their last working day, and their login to this company deactivated
-- (the sign-in check refuses a deactivated account; anyone also in another company moves to that one). Once only.
create or replace function public.end_exit_access(p_exit uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  x public.employee_exits;
  e public.employees;
begin
  select * into x from public.employee_exits where id = p_exit;
  if x.id is null or x.access_ended_at is not null then
    return;
  end if;
  select * into e from public.employees where tenant_id = x.tenant_id and "Employee Number" = x.employee_number;
  update public.employees
    set "Status" = 'Terminated', "Termination Date" = to_char(x.last_working_day, 'YYYY-MM-DD')
    where id = e.id;
  update public.memberships m set account_status = 'DEACTIVATED'
    from auth.users u
    where u.id = m.user_id and m.tenant_id = x.tenant_id and m.account_status = 'ACTIVE'
      and lower(u.email) = lower(btrim(coalesce(e."Work Email", '')));
  perform set_config('app.exit_ending', 'on', true);
  update public.employee_exits set access_ended_at = now(), updated_at = now() where id = x.id;
  perform set_config('app.exit_ending', 'off', true);
end $$;
revoke all on function public.end_exit_access(uuid) from public, anon, authenticated;

-- HR completes the exit once the checklist is done: their access ends now (if it hasn't), the exit closes, and the
-- lifecycle records (hr_terminations) get the leaver.
create or replace function public.complete_exit(p_exit uuid) returns public.employee_exits
language plpgsql security definer set search_path = public as $$
declare
  x public.employee_exits;
  open_items integer;
begin
  if not public.manages_exits() then
    raise exception 'Only HR can complete an exit' using errcode = '42501';
  end if;
  select * into x from public.employee_exits where id = p_exit and tenant_id = public.current_tenant_id() for update;
  if x.id is null then
    raise exception 'Exit not found' using errcode = 'P0002';
  end if;
  if x.status not in ('approved', 'clearance') then
    raise exception 'Only an approved exit can be completed (this one is %)', x.status using errcode = '23514';
  end if;
  if x.employee_number = public.current_employee_number() then
    raise exception 'Someone else must complete your own exit' using errcode = '42501';
  end if;
  select count(*) into open_items from public.employee_exit_clearance_items where exit_id = x.id and not done;
  if open_items > 0 then
    raise exception '% clearance item(s) are still open', open_items using errcode = '23514';
  end if;

  perform public.end_exit_access(x.id);
  perform set_config('app.exit_ending', 'on', true);
  update public.employee_exits set status = 'completed', completed_by = auth.uid(), completed_at = now(), updated_at = now()
    where id = x.id returning * into x;
  perform set_config('app.exit_ending', 'off', true);

  insert into public.hr_terminations
    (tenant_id, "Employee Number", termination_date, termination_type, termination_reason, final_payroll_status, clearance_status, performed_by)
  values (
    x.tenant_id, x.employee_number, x.last_working_day,
    case when x.kind = 'resignation' then 'Voluntary' when x.reason_category = 'redundancy' then 'Redundancy'
         when x.reason_category = 'contract_end' then 'Contract End' else 'Dismissal' end,
    nullif(btrim(concat_ws(': ', replace(x.reason_category, '_', ' '), nullif(btrim(x.reason), ''))), ''),
    coalesce((select case when d.status = 'included' then 'Included in ' || d.payroll_period else 'Pending' end
              from public.employee_exit_final_dues d where d.exit_id = x.id), 'Pending'),
    'Completed',
    (select u.email from auth.users u where u.id = auth.uid())
  );
  return x;
end $$;
revoke all on function public.complete_exit(uuid) from public, anon;
grant execute on function public.complete_exit(uuid) to authenticated;

-- Approved exits whose last working day has passed: end their access. Daily for every company (pg_cron); HR's Exits
-- page also runs it for its own company when it opens, so nothing waits on the job.
create or replace function public.end_due_exit_access() returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
  v_tenant uuid;
begin
  if auth.uid() is not null then
    if not public.manages_exits() then
      raise exception 'Only HR can do this' using errcode = '42501';
    end if;
    v_tenant := public.current_tenant_id();
  end if;
  for r in
    select id from public.employee_exits
    where status in ('approved', 'clearance') and access_ended_at is null and last_working_day < current_date
      and (v_tenant is null or tenant_id = v_tenant)
  loop
    perform public.end_exit_access(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.end_due_exit_access() from public, anon;
grant execute on function public.end_due_exit_access() to authenticated;

-- No payslip after the month someone left in: by their Termination Date, or an approved exit's last working day.
create or replace function public.salary_history_not_after_exit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_left text;
begin
  select coalesce(
    (select left(btrim(e."Termination Date"), 10) from public.employees e
     where e.tenant_id = new.tenant_id and e."Employee Number" = new.employee_id and btrim(e."Termination Date") ~ '^\d{4}-\d{2}-\d{2}'),
    (select to_char(min(x.last_working_day), 'YYYY-MM-DD') from public.employee_exits x
     where x.tenant_id = new.tenant_id and x.employee_number = new.employee_id and x.status in ('approved', 'clearance', 'completed'))
  ) into v_left;
  if v_left is not null and new.pay_period > left(v_left, 7) then
    raise exception '% left on %, so they can''t be paid for %', new.employee_id, v_left, new.pay_period using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists salary_history_not_after_exit on public.salary_history;
create trigger salary_history_not_after_exit before insert on public.salary_history
  for each row execute function public.salary_history_not_after_exit();

-- ---------------------------------------------------------------------------------------------
-- 10. scheduling (best effort, like the leave jobs): end access just after midnight
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('exit-access-end', '15 0 * * *', $c$select public.end_due_exit_access();$c$);
  else
    raise notice 'pg_cron is not available: access ends when HR completes the exit or opens the Exits page.';
  end if;
end $$;

notify pgrst, 'reload schema';
