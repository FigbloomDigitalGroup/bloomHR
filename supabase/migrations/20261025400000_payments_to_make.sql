-- Payments to make (FIG-1209): HR approves money, finance is told and records how it was paid.
--
-- The app can't move money yet, so every approved money item waits in one list for finance. Finance pays it outside the
-- app (bank, M-Pesa, Airtel Money, another app, cash or cheque) and records how, with the reference; paying from the
-- app itself ('in_app') is kept for when a payment provider is wired (src/lib/inAppPayments.ts).
--
--   payment_requests   one row per approved item: source ('salary_advance', 'loan', 'expense', 'requisition') and
--                      source_id, who is paid (an employee, or a name for anyone else), the amount, what it is for and
--                      who approved it. to_pay -> paid | cancelled. Written only by the triggers and record_payment().
--   requisitions       any other payment: an employee (or HR) asks for money for a purpose, to themselves, another
--                      employee or anyone else (a supplier: name and payment details). pending -> approved | rejected |
--                      cancelled; approved -> paid (record_payment) | cancelled. One approval step, by the
--                      'requisitions' module (HR); nobody approves a payment to themselves.
--   record_payment(id, via, reference, paid_on, note)
--                      finance (the 'payments' module) records it paid: a reference is needed unless it was cash, nobody
--                      records a payment to themselves. The item it came from follows: the advance becomes 'paid', the
--                      loan 'disbursed' (its repayments start), the expense gets paid_at, the requisition 'paid'.
--   payment_payees()   how to pay each employee with an item waiting (method, mobile number, bank and account), for
--                      finance, who may not read the employee records.
--
-- The source items keep their own screens. Approving one adds it to the list; rejecting or cancelling it takes it off
-- (while unpaid); approving it again puts it back. An item marked paid on its own screen (Salary Advance "Mark as
-- paid", Loans "Mark as disbursed") closes its row too, with no method, so nothing is paid twice.
--
-- Who is told: finance (everyone with the 'payments' module, and admins) by email when an item is approved
-- ('payment_due', an HR-side alert, so the payee never sees it); the payee when it is paid (advances and loans keep
-- their own 'salary_advance_paid' / 'loan_disbursed', the rest get 'payment_made'); HR ('requisitions') when a
-- requisition is asked for; the person who asked when it is decided.
--
-- Modules: 'payments' ("Payments to make") goes to administrators and every role that already had payroll, the people
-- who paid until now; 'requisitions' ("Approve requisitions") to HR. Both are barred from STAFF-based roles.
--
-- Items approved before this migration: approved, unpaid salary advances and approved loans not yet paid out join the
-- list quietly (no emails). Expenses don't: the module is hidden and its old approvals have no paid state to trust.

-- ---------------------------------------------------------------------------------------------
-- 1. modules
-- ---------------------------------------------------------------------------------------------
do $$
begin
  perform public.seed_module_once('payments', 'Payments to make',
    'Get told when HR approves money, and record how it was paid', 'finance', array['ADMIN'],
    'payroll', public.system_role_names());
  perform public.seed_module_once('requisitions', 'Approve requisitions',
    'Approve or turn down requests for money (requisitions)', 'finance', array['ADMIN', 'HR']);
end $$;

create or replace function public.staff_restricted_modules() returns text[]
language sql stable as $$
  select array['payroll', 'salaryadmin', 'mpesa-zap', 'adminconfirm', 'assign-managers', 'hr-lifecycle',
               'loans', 'approve-exits', 'sign-in-security', 'hr-admin', 'payments', 'requisitions']
$$;

-- record_payment() moving a loan to 'disbursed' for finance, who may not manage loans themselves
create or replace function public.manages_loans() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.has_any_module('loans', 'payroll'), false)
      or coalesce(current_setting('figbloom.payment_record', true), '') = 'on'
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. tables
-- ---------------------------------------------------------------------------------------------
create table if not exists public.requisitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  -- who asked (null when HR raised it without an employee record)
  requested_by text,
  payee_type text not null default 'employee' check (payee_type in ('employee', 'other')),
  payee_employee_number text,
  -- the employee's name (filled in), or whoever else is paid
  payee_name text check (payee_name is null or length(payee_name) <= 120),
  -- for anyone else: how to pay them (bank and account, M-Pesa number, till...)
  payee_details text check (payee_details is null or length(payee_details) <= 500),
  category text check (category is null or length(category) <= 60),
  amount numeric not null check (amount > 0),
  purpose text not null check (btrim(purpose) <> '' and length(purpose) <= 1000),
  needed_by date,
  -- a quote or invoice, in storage
  attachment_path text check (attachment_path is null or length(attachment_path) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled', 'paid')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_by_email text,
  decided_at timestamptz,
  decision_comment text check (decision_comment is null or length(decision_comment) <= 1000),
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (payee_type = 'other' or payee_employee_number is not null),
  check (payee_type = 'employee' or btrim(coalesce(payee_name, '')) <> '')
);
create index if not exists requisitions_tenant_status on public.requisitions (tenant_id, status);
create index if not exists requisitions_tenant_requested_by on public.requisitions (tenant_id, requested_by);

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  source text not null check (source in ('salary_advance', 'loan', 'expense', 'requisition')),
  source_id uuid not null,
  -- the employee paid, if it is one
  employee_number text,
  payee_name text not null,
  payee_details text,
  amount numeric not null check (amount > 0),
  purpose text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_by_email text,
  approved_at timestamptz not null default now(),
  status text not null default 'to_pay' check (status in ('to_pay', 'paid', 'cancelled')),
  -- null when it was marked paid on the item's own screen
  paid_via text check (paid_via in ('in_app', 'bank', 'mpesa', 'airtel', 'other_app', 'cash', 'cheque')),
  payment_reference text check (payment_reference is null or length(payment_reference) <= 120),
  paid_on date,
  payment_note text check (payment_note is null or length(payment_note) <= 1000),
  paid_by uuid references auth.users(id) on delete set null,
  paid_by_email text,
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_id)
);
create index if not exists payment_requests_tenant_status on public.payment_requests (tenant_id, status);
create index if not exists payment_requests_tenant_employee on public.payment_requests (tenant_id, employee_number);

alter table public.expenses add column if not exists paid_at timestamptz;

-- ---------------------------------------------------------------------------------------------
-- 3. the list: approved items join it, rejected or cancelled ones leave it, ones paid elsewhere close it
-- ---------------------------------------------------------------------------------------------
create or replace function public.employee_display_name(p_tenant uuid, p_number text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), '')
     from public.employees e where e.tenant_id = p_tenant and e."Employee Number" = p_number),
    p_number)
$$;
revoke all on function public.employee_display_name(uuid, text) from public, anon, authenticated;

-- an item was approved: it joins the list (or comes back to it, if it had been cancelled)
create or replace function public.payment_request_open(
  p_tenant uuid, p_source text, p_source_id uuid, p_employee text, p_payee text, p_details text,
  p_amount numeric, p_purpose text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_amount, 0) <= 0 then
    return;
  end if;
  insert into public.payment_requests (tenant_id, source, source_id, employee_number, payee_name, payee_details, amount,
                                       purpose, approved_by, approved_by_email, approved_at)
  values (p_tenant, p_source, p_source_id, nullif(btrim(p_employee), ''),
          coalesce(nullif(btrim(p_payee), ''), nullif(btrim(p_employee), ''), 'Unknown'), p_details, p_amount, p_purpose,
          auth.uid(), (select u.email from auth.users u where u.id = auth.uid()), now())
  on conflict (source, source_id) do update
    set status = 'to_pay', amount = excluded.amount, payee_name = excluded.payee_name,
        payee_details = excluded.payee_details, purpose = excluded.purpose, employee_number = excluded.employee_number,
        approved_by = excluded.approved_by, approved_by_email = excluded.approved_by_email, approved_at = now(),
        cancelled_at = null, updated_at = now()
    where payment_requests.status = 'cancelled';
end $$;
revoke all on function public.payment_request_open(uuid, text, uuid, text, text, text, numeric, text) from public, anon, authenticated;

-- an item was rejected, cancelled or sent back: off the list, unless it was already paid
create or replace function public.payment_request_close(p_source text, p_source_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.payment_requests set status = 'cancelled', cancelled_at = now(), updated_at = now()
  where source = p_source and source_id = p_source_id and status = 'to_pay'
$$;
revoke all on function public.payment_request_close(text, uuid) from public, anon, authenticated;

-- an item was marked paid on its own screen (not through record_payment, which closes the row first)
create or replace function public.payment_request_paid_elsewhere(p_source text, p_source_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.payment_requests
  set status = 'paid', paid_on = current_date, paid_by = auth.uid(),
      paid_by_email = (select u.email from auth.users u where u.id = auth.uid()), paid_at = now(), updated_at = now()
  where source = p_source and source_id = p_source_id and status = 'to_pay'
$$;
revoke all on function public.payment_request_paid_elsewhere(text, uuid) from public, anon, authenticated;

-- salary advances (status is free text: 'Pending', 'approved', 'rejected', 'paid', 'completed')
create or replace function public.salary_advance_payment_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s text := lower(coalesce(new.status, ''));
begin
  if tg_op = 'UPDATE' and s is not distinct from lower(coalesce(old.status, '')) then
    return null;
  end if;
  if s = 'approved' then
    perform public.payment_request_open(new.tenant_id, 'salary_advance', new.id, new."Employee Number",
      coalesce(nullif(btrim(new."Full Name"), ''), public.employee_display_name(new.tenant_id, new."Employee Number")), null,
      coalesce(new.admin_adjusted_amount, new."Amount Requested"),
      'Salary advance' || coalesce(': ' || nullif(btrim(new."Reason for Advance"), ''), ''));
  elsif s in ('paid', 'completed') then
    perform public.payment_request_paid_elsewhere('salary_advance', new.id);
  elsif tg_op = 'UPDATE' then
    perform public.payment_request_close('salary_advance', new.id);
  end if;
  return null;
end $$;
drop trigger if exists salary_advance_payment_request on public.salary_advance;
create trigger salary_advance_payment_request after insert or update of status on public.salary_advance
  for each row execute function public.salary_advance_payment_request();

-- employee loans
create or replace function public.employee_loan_payment_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  if new.status = 'approved' then
    perform public.payment_request_open(new.tenant_id, 'loan', new.id, new.employee_number,
      public.employee_display_name(new.tenant_id, new.employee_number), null, new.principal,
      coalesce(new.product_name, 'Loan') || ' over ' || new.months || ' months'
      || coalesce(': ' || nullif(btrim(new.reason), ''), ''));
  elsif new.status = 'disbursed' and tg_op = 'UPDATE' and old.status = 'approved' then
    perform public.payment_request_paid_elsewhere('loan', new.id);
  elsif new.status in ('rejected', 'cancelled', 'requested') then
    perform public.payment_request_close('loan', new.id);
  end if;
  return null;
end $$;
drop trigger if exists employee_loan_payment_request on public.employee_loans;
create trigger employee_loan_payment_request after insert or update of status on public.employee_loans
  for each row execute function public.employee_loan_payment_request();

-- expenses (status: pending, recommended, approved, rejected)
create or replace function public.expense_payment_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s text := lower(coalesce(new.status, ''));
begin
  if tg_op = 'UPDATE' and s is not distinct from lower(coalesce(old.status, '')) then
    return null;
  end if;
  if s = 'approved' and new.paid_at is null then
    perform public.payment_request_open(new.tenant_id, 'expense', new.id, new.employee_id,
      coalesce(nullif(btrim(new.employee_full_name), ''), public.employee_display_name(new.tenant_id, new.employee_id)), null,
      new.amount, 'Expense claim' || coalesce(': ' || nullif(btrim(new.title), ''), ''));
  elsif tg_op = 'UPDATE' and s <> 'approved' then
    perform public.payment_request_close('expense', new.id);
  end if;
  return null;
end $$;
drop trigger if exists expense_payment_request on public.expenses;
create trigger expense_payment_request after insert or update of status on public.expenses
  for each row execute function public.expense_payment_request();

-- ---------------------------------------------------------------------------------------------
-- 4. requisitions: the rules (whoever writes them), the list and who hears of them
-- ---------------------------------------------------------------------------------------------
create or replace function public.approves_requisitions() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.has_module('requisitions'), false)
$$;
revoke all on function public.approves_requisitions() from public, anon;
grant execute on function public.approves_requisitions() to authenticated;

create or replace function public.requisitions_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_approver boolean := public.approves_requisitions();
  -- record_payment() marking it paid
  v_paying boolean := coalesce(current_setting('figbloom.payment_record', true), '') = 'on';
  v_me text := public.current_employee_number();
  v_moving boolean;
begin
  if new.payee_type = 'employee' then
    if not exists (select 1 from public.employees e
                   where e.tenant_id = new.tenant_id and e."Employee Number" = new.payee_employee_number) then
      raise exception 'Choose an employee to pay';
    end if;
    new.payee_name := public.employee_display_name(new.tenant_id, new.payee_employee_number);
    new.payee_details := null;
  else
    new.payee_employee_number := null;
    new.payee_name := btrim(new.payee_name);
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.decided_by := null; new.decided_by_email := null; new.decided_at := null;
    new.paid_at := null; new.cancelled_at := null;
    if not v_approver then
      if v_me is null then
        raise exception 'Only employees can ask for a requisition';
      end if;
      new.requested_by := v_me;
      if new.status <> 'pending' then
        raise exception 'A new requisition waits for HR''s approval';
      end if;
    else
      new.requested_by := coalesce(new.requested_by, v_me);
      if new.status not in ('pending', 'approved') then
        raise exception 'A new requisition is either waiting or approved';
      end if;
    end if;
    v_moving := new.status <> 'pending';
  else
    if new.tenant_id <> old.tenant_id or new.id <> old.id then
      raise exception 'A requisition can''t move to another company';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.requested_by := old.requested_by;
    v_moving := new.status is distinct from old.status;

    if old.status in ('paid', 'rejected', 'cancelled') and not v_paying then
      raise exception 'A requisition that is % can''t change', old.status;
    end if;
    if not v_approver and not v_paying then
      -- the person who asked may change or withdraw it while it waits
      if not (old.status = 'pending' and old.requested_by = v_me and new.status in ('pending', 'cancelled')) then
        raise exception 'Only HR can change a requisition';
      end if;
    end if;
    if v_moving and not (
      (old.status = 'pending' and new.status in ('approved', 'rejected', 'cancelled'))
      or (old.status = 'approved' and new.status = 'cancelled')
      or (v_paying and old.status = 'approved' and new.status = 'paid')
    ) then
      raise exception 'A requisition that is % can''t become %', old.status, new.status;
    end if;
    if old.status = 'approved' and not v_paying
       and (new.amount, new.payee_type, new.payee_employee_number, new.payee_name, new.payee_details)
           is distinct from (old.amount, old.payee_type, old.payee_employee_number, old.payee_name, old.payee_details) then
      raise exception 'An approved requisition''s amount and payee can''t change. Cancel it and raise a new one.';
    end if;
    if not v_moving then
      new.decided_by := old.decided_by; new.decided_by_email := old.decided_by_email; new.decided_at := old.decided_at;
      new.paid_at := old.paid_at; new.cancelled_at := old.cancelled_at;
    end if;
  end if;

  if v_moving and new.status in ('approved', 'rejected') then
    if v_me is not null and new.payee_employee_number = v_me then
      raise exception 'Someone else must decide on a payment to you';
    end if;
    if new.status = 'rejected' and coalesce(btrim(new.decision_comment), '') = '' then
      raise exception 'Give a reason for turning the requisition down';
    end if;
    new.decided_by := auth.uid();
    new.decided_by_email := (select u.email from auth.users u where u.id = auth.uid());
    new.decided_at := now();
  end if;
  if v_moving and new.status = 'cancelled' then
    new.cancelled_at := now();
  end if;
  if v_moving and new.status = 'paid' then
    new.paid_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists requisitions_guard on public.requisitions;
create trigger requisitions_guard before insert or update on public.requisitions
  for each row execute function public.requisitions_guard();

create or replace function public.requisitions_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text := coalesce(public.employee_display_name(new.tenant_id, new.requested_by), 'HR');
  what text := public.kes(new.amount) || ' to ' || new.payee_name || ' for ' || btrim(new.purpose);
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    if new.status = 'approved' then
      -- still waiting to be paid: keep the list in step with an edit to the purpose
      update public.payment_requests set purpose = 'Requisition: ' || btrim(new.purpose), updated_at = now()
      where source = 'requisition' and source_id = new.id and status = 'to_pay';
    end if;
    return null;
  end if;
  if new.status = 'approved' then
    perform public.payment_request_open(new.tenant_id, 'requisition', new.id, new.payee_employee_number, new.payee_name,
      new.payee_details, new.amount, 'Requisition: ' || btrim(new.purpose));
  elsif new.status in ('rejected', 'cancelled') then
    perform public.payment_request_close('requisition', new.id);
  end if;

  if tg_op = 'INSERT' and new.status = 'pending' then
    insert into public.hr_notifications (tenant_id, employee_number, employee_name, notification_type, title, message)
    values (new.tenant_id, coalesce(new.requested_by, ''), who, 'requisition_requested', 'Requisition to review',
      who || ' asked for ' || what || '.');
  elsif new.requested_by is not null and new.requested_by is distinct from public.current_employee_number() then
    if new.status = 'approved' then
      perform public.notify_employee_number(new.tenant_id, new.requested_by, 'requisition_approved', 'Requisition approved',
        'Your requisition of ' || what || ' was approved and sent to finance to pay.'
        || public.with_note('Notes', new.decision_comment));
    elsif new.status = 'rejected' then
      perform public.notify_employee_number(new.tenant_id, new.requested_by, 'requisition_rejected', 'Requisition not approved',
        'Your requisition of ' || what || ' was not approved.' || public.with_note('Reason', new.decision_comment));
    end if;
  end if;
  return null;
end $$;
drop trigger if exists requisitions_after on public.requisitions;
create trigger requisitions_after after insert or update on public.requisitions
  for each row execute function public.requisitions_after();

-- ---------------------------------------------------------------------------------------------
-- 5. finance hears of each item to pay
-- ---------------------------------------------------------------------------------------------
create or replace function public.payment_requests_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_by text;
begin
  if new.status <> 'to_pay' or (tg_op = 'UPDATE' and old.status = 'to_pay')
     or coalesce(current_setting('figbloom.payment_quiet', true), '') = 'on' then
    return null;
  end if;
  -- the approver by name when they are an employee, else by email
  select public.employee_display_name(new.tenant_id, e."Employee Number") into v_by
  from public.employees e
  where e.tenant_id = new.tenant_id and lower(btrim(e."Work Email")) = lower(btrim(new.approved_by_email))
  limit 1;
  v_by := coalesce(v_by, new.approved_by_email);
  insert into public.hr_notifications (tenant_id, employee_number, employee_name, notification_type, title, message)
  values (new.tenant_id, coalesce(new.employee_number, ''), new.payee_name, 'payment_due', 'Payment to make',
    public.kes(new.amount) || ' to ' || new.payee_name || ' (' || coalesce(new.purpose, replace(new.source, '_', ' '))
    || ') was approved' || coalesce(' by ' || nullif(btrim(v_by), ''), '') || '. Pay it and record it in Payments to make.');
  return null;
end $$;
drop trigger if exists payment_requests_notify on public.payment_requests;
create trigger payment_requests_notify after insert or update of status on public.payment_requests
  for each row execute function public.payment_requests_notify();

-- ---------------------------------------------------------------------------------------------
-- 6. finance records a payment
-- ---------------------------------------------------------------------------------------------
create or replace function public.record_payment(
  p_id uuid, p_via text, p_reference text, p_paid_on date, p_note text default null
) returns public.payment_requests
language plpgsql security definer set search_path = public as $$
declare
  r public.payment_requests;
  v_ref text := nullif(btrim(p_reference), '');
  v_email text := (select u.email from auth.users u where u.id = auth.uid());
  v_how text;
begin
  if not coalesce(public.has_module('payments'), false) then
    raise exception 'Only finance can record payments';
  end if;
  select * into r from public.payment_requests
  where id = p_id and tenant_id = public.current_tenant_id() for update;
  if not found then
    raise exception 'Payment not found';
  end if;
  if r.status = 'paid' then
    raise exception 'This payment was already recorded';
  elsif r.status = 'cancelled' then
    raise exception 'This payment was cancelled: what it was for is no longer approved';
  end if;
  if p_via is null or p_via not in ('bank', 'mpesa', 'airtel', 'other_app', 'cash', 'cheque') then
    raise exception 'Choose how it was paid';
  end if;
  if v_ref is null and p_via <> 'cash' then
    raise exception 'Enter the payment reference (the bank, M-Pesa or cheque number)';
  end if;
  if p_paid_on is null or p_paid_on > current_date then
    raise exception 'Enter the date it was paid (not a future date)';
  end if;
  if r.employee_number is not null and r.employee_number = public.current_employee_number() then
    raise exception 'Someone else must record a payment to you';
  end if;

  -- the row first, so the item's own trigger finds it paid and leaves it
  update public.payment_requests
  set status = 'paid', paid_via = p_via, payment_reference = v_ref, paid_on = p_paid_on,
      payment_note = nullif(btrim(p_note), ''), paid_by = auth.uid(), paid_by_email = v_email, paid_at = now(),
      updated_at = now()
  where id = r.id
  returning * into r;

  perform set_config('figbloom.payment_record', 'on', true);
  if r.source = 'salary_advance' then
    update public.salary_advance
    set status = 'paid', payment_processed = 'true', payment_date = p_paid_on::timestamptz,
        paid_by = auth.uid()::text, paid_by_email = v_email, last_updated = now()
    where id = r.source_id and tenant_id = r.tenant_id;
  elsif r.source = 'loan' then
    update public.employee_loans set status = 'disbursed' where id = r.source_id and tenant_id = r.tenant_id and status = 'approved';
  elsif r.source = 'expense' then
    update public.expenses set paid_at = now() where id = r.source_id and tenant_id = r.tenant_id;
  elsif r.source = 'requisition' then
    update public.requisitions set status = 'paid' where id = r.source_id and tenant_id = r.tenant_id and status = 'approved';
  end if;
  perform set_config('figbloom.payment_record', 'off', true);

  -- advances and loans tell the employee themselves (salary_advance_paid, loan_disbursed)
  if r.source in ('expense', 'requisition') and r.employee_number is not null then
    v_how := case p_via when 'bank' then 'bank transfer' when 'mpesa' then 'M-Pesa' when 'airtel' then 'Airtel Money'
                        when 'other_app' then 'payment app' when 'cash' then 'cash' when 'cheque' then 'cheque' end;
    perform public.notify_employee_number(r.tenant_id, r.employee_number, 'payment_made', 'Payment made',
      public.kes(r.amount) || ' (' || coalesce(r.purpose, replace(r.source, '_', ' ')) || ') was paid to you by ' || v_how
      || coalesce(', reference ' || v_ref, '') || ', on ' || to_char(p_paid_on, 'FMDD Mon YYYY') || '.');
  end if;
  return r;
end $$;
revoke all on function public.record_payment(uuid, text, text, date, text) from public, anon;
grant execute on function public.record_payment(uuid, text, text, date, text) to authenticated;

-- how to pay each employee with something waiting: finance may not read the employee records, so only these fields,
-- only for them
create or replace function public.payment_payees()
returns table (employee_number text, payment_method text, mobile_number text, bank text, bank_branch text,
               account_number text, account_name text)
language sql stable security definer set search_path = public as $$
  select e."Employee Number", e.payment_method, e."Mobile Number", e."Bank", e."Bank Branch", e."Account Number",
         e.account_number_name
  from public.employees e
  where coalesce(public.has_module('payments'), false)
    and e.tenant_id = public.current_tenant_id()
    and e."Employee Number" in (select r.employee_number from public.payment_requests r
                                where r.tenant_id = public.current_tenant_id() and r.status = 'to_pay')
$$;
revoke all on function public.payment_payees() from public, anon;
grant execute on function public.payment_payees() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. access
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['payment_requests', 'requisitions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format($p$create policy tenant_isolation on public.%I as restrictive for all
      using (tenant_id = (select public.current_tenant_id()))
      with check (tenant_id = (select public.current_tenant_id()))$p$, t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- the list: finance, and the people who approve what goes on it, read it; employees see what is paid to them.
-- Nobody writes it directly (the triggers and record_payment do).
revoke insert, update, delete on public.payment_requests from authenticated;
drop policy if exists read on public.payment_requests;
create policy read on public.payment_requests for select to authenticated
  using ((select public.has_any_module('payments', 'requisitions', 'salaryadmin', 'loans', 'expenses'))
         or employee_number = (select public.current_employee_number()));

-- requisitions: HR (requisitions) and finance (payments) read all, HR changes them; employees their own (the guard
-- limits what they may do)
drop policy if exists read on public.requisitions;
create policy read on public.requisitions for select to authenticated
  using ((select public.has_any_module('requisitions', 'payments'))
         or requested_by = (select public.current_employee_number())
         or payee_employee_number = (select public.current_employee_number()));
drop policy if exists manage on public.requisitions;
create policy manage on public.requisitions for all to authenticated
  using ((select public.approves_requisitions())) with check ((select public.approves_requisitions()));
drop policy if exists own_insert on public.requisitions;
create policy own_insert on public.requisitions for insert to authenticated
  with check (requested_by = (select public.current_employee_number()) and status = 'pending');
drop policy if exists own_update on public.requisitions;
create policy own_update on public.requisitions for update to authenticated
  using (requested_by = (select public.current_employee_number()) and status = 'pending')
  with check (requested_by = (select public.current_employee_number()));

-- ---------------------------------------------------------------------------------------------
-- 8. notifications
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
  'leave_reopened',
  'attendance_odd_hours',
  'missed_scan_requested', 'missed_scan_request', 'missed_scan_approved', 'missed_scan_declined',
  'payment_due', 'payment_made', 'requisition_requested', 'requisition_approved', 'requisition_rejected'
));

-- (20261025100000's list, plus a payment for finance to make and a requisition for HR to decide)
create or replace function public.hr_only_notification(p_type text) returns boolean language sql immutable as $$
  select p_type in ('contract_expiring', 'probation_expiring', 'leave_recommended', 'exit_requested', 'application_received',
                    'loan_requested', 'contract_signed', 'leave_exhausted', 'casual_limit', 'leave_document_overdue',
                    'contribution_requested', 'onboarding_followups_overdue', 'attendance_odd_hours', 'missed_scan_requested',
                    'payment_due', 'requisition_requested')
$$;

-- (20261025100000's list, plus the five above)
create or replace function public.important_notification(p_type text) returns boolean language sql immutable as $$
  select public.always_emailed(p_type) or p_type in (
    -- the employee's own
    'leave_approved', 'leave_rejected', 'leave_reopened', 'document_rejected', 'document_requested', 'onboarding_changes_requested',
    'salary_advance_approved', 'salary_advance_rejected', 'salary_advance_paid', 'loan_approved', 'loan_rejected',
    'loan_disbursed', 'salary_paid', 'expense_approved', 'expense_rejected', 'reactivated', 'employment_update',
    'policy_to_accept', 'task_assigned', 'approval_needed', 'exit_approved', 'exit_declined', 'contract_sent',
    'contract_sent_back', 'missed_scan_request', 'missed_scan_approved', 'missed_scan_declined',
    'payment_made', 'requisition_approved', 'requisition_rejected',
    -- for HR: a decision is waiting
    'leave_recommended', 'exit_requested', 'loan_requested', 'contract_signed', 'contract_expiring', 'probation_expiring',
    'missed_scan_requested', 'requisition_requested',
    -- for finance: a payment is waiting
    'payment_due')
$$;

-- (20261019000000's list, plus finance for a payment to make and HR's requisitions module for a requisition)
create or replace function public.hr_alert_modules(p_type text) returns text[] language sql immutable as $$
  select case
    when p_type in ('leave_recommended', 'leave_exhausted', 'leave_document_overdue') then array['leaves']
    when p_type = 'application_received' then array['recruitment']
    when p_type in ('loan_requested', 'contribution_requested') then array['payroll']
    when p_type = 'casual_limit' then array['work-records', 'payroll']
    when p_type = 'payment_due' then array['payments']
    when p_type = 'requisition_requested' then array['requisitions']
    -- contract_expiring, probation_expiring, contract_signed, exit_requested, and any HR-facing type added later
    else array['employees', 'hr-lifecycle']
  end
$$;

-- ---------------------------------------------------------------------------------------------
-- 9. what was already approved and not yet paid joins the list, quietly
-- ---------------------------------------------------------------------------------------------
do $$
begin
  perform set_config('figbloom.payment_quiet', 'on', true);
  insert into public.payment_requests (tenant_id, source, source_id, employee_number, payee_name, amount, purpose,
                                       approved_by_email, approved_at)
  select a.tenant_id, 'salary_advance', a.id, a."Employee Number",
         coalesce(nullif(btrim(a."Full Name"), ''), public.employee_display_name(a.tenant_id, a."Employee Number")),
         coalesce(a.admin_adjusted_amount, a."Amount Requested"),
         'Salary advance' || coalesce(': ' || nullif(btrim(a."Reason for Advance"), ''), ''),
         a.approved_by_email, coalesce(a.admin_approval_date, a.last_updated, a.time_added, now())
  from public.salary_advance a
  where lower(coalesce(a.status, '')) = 'approved' and coalesce(a.payment_processed, 'false') <> 'true'
    and coalesce(a.admin_adjusted_amount, a."Amount Requested", 0) > 0
  on conflict (source, source_id) do nothing;

  insert into public.payment_requests (tenant_id, source, source_id, employee_number, payee_name, amount, purpose,
                                       approved_by, approved_by_email, approved_at)
  select l.tenant_id, 'loan', l.id, l.employee_number, public.employee_display_name(l.tenant_id, l.employee_number),
         l.principal, coalesce(l.product_name, 'Loan') || ' over ' || l.months || ' months'
           || coalesce(': ' || nullif(btrim(l.reason), ''), ''),
         l.decided_by, l.decided_by_email, coalesce(l.decided_at, l.updated_at)
  from public.employee_loans l
  where l.status = 'approved'
  on conflict (source, source_id) do nothing;
  perform set_config('figbloom.payment_quiet', 'off', true);
end $$;

notify pgrst, 'reload schema';
