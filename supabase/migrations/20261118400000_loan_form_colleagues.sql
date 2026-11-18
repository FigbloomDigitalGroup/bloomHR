-- The loan form completed on the platform by the people on it (20261118100000 and 20261118200000's form):
--
--   employee_loan_witnesses    the witness, normally a colleague: the borrower (or HR) asks them, and once the borrower
--                              has signed, they sign from their own staff portal with their saved signature; their name
--                              and ID number come from their employee record and go on the form. HR can still enter a
--                              witness who isn't on staff, signing on the screen (loan_form_witness, which now also
--                              drops a colleague asked before).
--   employee_loan_form_values  corrections to what the form shows from the employee record (a salary not yet updated
--                              after probation, a missing contract date, ...), for this loan only. The borrower or HR
--                              changes them until HR accepts the form; HR sees which ones differ from the record.
--   reads_loan_forms()         who reads every loan, its form, guarantor, witness, corrections and signed copy: those
--                              who manage loans (Staff loans, Payroll) and finance (Payments), who pays the loans out.
--   delete_cancelled_loan()    HR deletes a cancelled loan (tests, mistakes) with its form, guarantor, witness,
--                              schedule, approval and payment request. The audit trail keeps the rows.
-- Safe to run again.

-- ---------------------------------------------------------------------------------------------
-- 1. who reads loans and their forms: also finance
-- ---------------------------------------------------------------------------------------------
create or replace function public.reads_loan_forms() returns boolean
language sql stable security definer set search_path = public as $$
  select public.manages_loans() or coalesce(public.has_any_module('payments'), false)
$$;
revoke all on function public.reads_loan_forms() from public, anon;
grant execute on function public.reads_loan_forms() to authenticated;

drop policy if exists finance_read on public.employee_loans;
create policy finance_read on public.employee_loans for select to authenticated
  using ((select public.reads_loan_forms()));
drop policy if exists finance_read on public.employee_loan_instalments;
create policy finance_read on public.employee_loan_instalments for select to authenticated
  using ((select public.reads_loan_forms()));
drop policy if exists read_own_or_manage on public.employee_loan_forms;
create policy read_own_or_manage on public.employee_loan_forms for select to authenticated
  using ((select public.reads_loan_forms()) or loan_id in (select public.my_loan_ids()));
drop policy if exists read_involved on public.employee_loan_guarantors;
create policy read_involved on public.employee_loan_guarantors for select to authenticated
  using ((select public.reads_loan_forms()) or loan_id in (select public.my_loan_ids())
         or employee_number = (select public.current_employee_number()));

do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  drop policy if exists loan_forms_select on storage.objects;
  create policy loan_forms_select on storage.objects for select to authenticated
    using (
    bucket_id = 'loan-forms'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and ((select public.reads_loan_forms())
    or (storage.foldername(name))[2] in (select public.my_loan_id_texts()))
    );
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. the witness, a colleague
-- ---------------------------------------------------------------------------------------------
create table if not exists public.employee_loan_witnesses (
  loan_id uuid primary key references public.employee_loans(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_number text not null,
  witness_name text not null check (length(witness_name) <= 200),
  status text not null default 'asked' check (status in ('asked', 'signed', 'declined')),
  decline_reason text check (decline_reason is null or length(decline_reason) <= 1000),
  asked_by uuid references auth.users(id) on delete set null,
  asked_at timestamptz not null default now(),
  signed_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, employee_number) references public.employees(tenant_id, "Employee Number") on update cascade on delete cascade,
  check (status <> 'declined' or nullif(btrim(decline_reason), '') is not null)
);
create index if not exists employee_loan_witnesses_witness on public.employee_loan_witnesses (tenant_id, employee_number);

alter table public.employee_loan_witnesses enable row level security;
drop policy if exists tenant_isolation on public.employee_loan_witnesses;
create policy tenant_isolation on public.employee_loan_witnesses as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists read_involved on public.employee_loan_witnesses;
create policy read_involved on public.employee_loan_witnesses for select to authenticated
  using ((select public.reads_loan_forms()) or loan_id in (select public.my_loan_ids())
         or employee_number = (select public.current_employee_number()));
revoke all on public.employee_loan_witnesses from anon;
revoke insert, update, delete on public.employee_loan_witnesses from authenticated;
drop trigger if exists audit_employee_loan_witnesses on public.employee_loan_witnesses;
create trigger audit_employee_loan_witnesses after insert or update or delete on public.employee_loan_witnesses
  for each row execute function public.audit_row_change();

-- The borrower (or HR) asks a colleague to witness their signature, or another after one declined. Asking someone new
-- takes the last witness's signature off the form.
create or replace function public.loan_set_witness(p_loan uuid, p_employee text)
returns public.employee_loan_witnesses
language plpgsql security definer set search_path = public as $$
declare
  l public.employee_loans;
  w public.employee_loan_witnesses;
  e public.employees;
begin
  select * into l from public.employee_loans where id = p_loan and tenant_id = public.current_tenant_id();
  if l.id is null or not (public.manages_loans() or l.employee_number = public.current_employee_number()) then
    raise exception 'Loan not found' using errcode = 'P0002';
  end if;
  if l.status not in ('requested', 'approved') then
    raise exception 'The witness is chosen before the loan is paid out' using errcode = '22023';
  end if;
  if exists (select 1 from public.employee_loan_forms f where f.loan_id = p_loan and f.status = 'accepted') then
    raise exception 'HR has already accepted the signed form' using errcode = '22023';
  end if;
  select * into e from public.employees where tenant_id = l.tenant_id and "Employee Number" = btrim(coalesce(p_employee, ''));
  if e.id is null then
    raise exception 'Choose a colleague from the company as witness' using errcode = '22023';
  end if;
  if e."Employee Number" = l.employee_number then
    raise exception 'The borrower can''t witness their own signature' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(e."Termination Date", '')), '') is not null then
    raise exception 'The witness must still work for the company' using errcode = '22023';
  end if;
  insert into public.employee_loan_witnesses (loan_id, tenant_id, employee_number, witness_name, asked_by)
  values (l.id, l.tenant_id, e."Employee Number", public.employee_display_name(l.tenant_id, e."Employee Number"), auth.uid())
  on conflict (loan_id) do update set
    employee_number = excluded.employee_number, witness_name = excluded.witness_name, status = 'asked', decline_reason = null,
    signed_at = null, asked_by = auth.uid(), asked_at = now(), updated_at = now()
  returning * into w;
  update public.employee_loan_forms
  set witness_name = null, witness_id_number = null, witness_signature = null, witness_signed_at = null, updated_at = now()
  where loan_id = p_loan and status <> 'accepted';
  perform public.notify_employee_number(l.tenant_id, e."Employee Number", 'loan_witness_asked', 'Witness a loan form?',
    public.employee_display_name(l.tenant_id, l.employee_number) || ' asked you to witness their signature on a loan form. '
    || 'Open Loans in the staff portal: you sign there once they have signed.');
  return w;
end $$;
revoke all on function public.loan_set_witness(uuid, text) from public, anon;
grant execute on function public.loan_set_witness(uuid, text) to authenticated;

-- The colleague witnesses: after the borrower signed the approved loan's form, with their saved signature. Their name
-- and ID number go on the form from their employee record.
create or replace function public.loan_witness_sign(p_loan uuid, p_signature text)
returns public.employee_loan_witnesses
language plpgsql security definer set search_path = public as $$
declare
  w public.employee_loan_witnesses;
  l public.employee_loans;
  f public.employee_loan_forms;
  e public.employees;
begin
  select * into w from public.employee_loan_witnesses where loan_id = p_loan and tenant_id = public.current_tenant_id() for update;
  if w.loan_id is null or w.employee_number is distinct from public.current_employee_number() then
    raise exception 'Loan not found' using errcode = 'P0002';
  end if;
  if w.status <> 'asked' then
    raise exception 'You have already answered' using errcode = '22023';
  end if;
  select * into l from public.employee_loans where id = p_loan;
  select * into f from public.employee_loan_forms where loan_id = p_loan for update;
  if l.status <> 'approved' or f.loan_id is null then
    raise exception 'You witness the form once the loan is approved and the borrower has signed it' using errcode = '22023';
  end if;
  if f.status = 'accepted' then
    raise exception 'HR has already accepted the signed form' using errcode = '22023';
  end if;
  if f.borrower_signature is null then
    raise exception 'The borrower hasn''t signed yet: you witness their signature' using errcode = '22023';
  end if;
  if p_signature is null or not public.is_signature_image(p_signature) then
    raise exception 'Draw your signature under My signature first' using errcode = '22023';
  end if;
  select * into e from public.employees where tenant_id = w.tenant_id and "Employee Number" = w.employee_number;
  update public.employee_loan_forms
  set witness_name = left(w.witness_name, 200), witness_id_number = left(nullif(btrim(coalesce(e."ID Number"::text, '')), ''), 50),
      witness_signature = p_signature, witness_signed_at = now(), updated_at = now()
  where loan_id = p_loan returning * into f;
  update public.employee_loan_witnesses set status = 'signed', signed_at = now(), updated_at = now()
  where loan_id = p_loan returning * into w;
  perform public.notify_employee_number(l.tenant_id, l.employee_number, 'loan_witness_signed', 'Your witness signed',
    w.witness_name || ' witnessed your signature on the loan form.');
  if public.loan_form_signed_in_app(f) then
    perform public.loan_form_tell_hr(l);
  end if;
  return w;
end $$;
revoke all on function public.loan_witness_sign(uuid, text) from public, anon;
grant execute on function public.loan_witness_sign(uuid, text) to authenticated;

create or replace function public.loan_witness_decline(p_loan uuid, p_reason text)
returns public.employee_loan_witnesses
language plpgsql security definer set search_path = public as $$
declare
  w public.employee_loan_witnesses;
  l public.employee_loans;
begin
  select * into w from public.employee_loan_witnesses where loan_id = p_loan and tenant_id = public.current_tenant_id() for update;
  if w.loan_id is null or w.employee_number is distinct from public.current_employee_number() then
    raise exception 'Loan not found' using errcode = 'P0002';
  end if;
  if w.status <> 'asked' then
    raise exception 'You have already answered' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Give a reason, so the borrower knows' using errcode = '22023';
  end if;
  select * into l from public.employee_loans where id = p_loan;
  update public.employee_loan_witnesses set status = 'declined', decline_reason = left(btrim(p_reason), 1000), updated_at = now()
  where loan_id = p_loan returning * into w;
  perform public.notify_employee_number(l.tenant_id, l.employee_number, 'loan_witness_declined', 'Witness declined',
    w.witness_name || ' declined to witness your loan form: ' || btrim(p_reason) || ' Choose another witness under Loans.');
  return w;
end $$;
revoke all on function public.loan_witness_decline(uuid, text) from public, anon;
grant execute on function public.loan_witness_decline(uuid, text) to authenticated;

-- What the witness sees: whose signature, for what loan, and whether they have signed yet. Nothing personal.
create or replace function public.loan_witness_view(p_loan uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  w public.employee_loan_witnesses;
  l public.employee_loans;
  f public.employee_loan_forms;
begin
  select * into w from public.employee_loan_witnesses where loan_id = p_loan and tenant_id = public.current_tenant_id();
  if w.loan_id is null or w.employee_number is distinct from public.current_employee_number() then
    raise exception 'Loan not found' using errcode = 'P0002';
  end if;
  select * into l from public.employee_loans where id = p_loan;
  select * into f from public.employee_loan_forms where loan_id = p_loan;
  return jsonb_build_object(
    'borrower_name', public.employee_display_name(l.tenant_id, l.employee_number),
    'principal', l.principal, 'months', l.months, 'product_name', l.product_name, 'loan_status', l.status,
    'borrower_signed', f.borrower_signature is not null, 'borrower_signature', f.borrower_signature);
end $$;
revoke all on function public.loan_witness_view(uuid) from public, anon;
grant execute on function public.loan_witness_view(uuid) to authenticated;

-- HR's witness who isn't on staff (20261118200000's, and a colleague asked before is dropped)
create or replace function public.loan_form_witness(p_loan uuid, p_name text, p_id_number text, p_signature text)
returns public.employee_loan_forms
language plpgsql security definer set search_path = public as $$
declare
  l public.employee_loans;
  f public.employee_loan_forms;
begin
  perform public.loan_form_check(p_loan);
  select * into l from public.employee_loans where id = p_loan;
  select * into f from public.employee_loan_forms where loan_id = p_loan;
  if l.status <> 'approved' then
    raise exception 'The witness signs while the loan is approved and not yet paid out' using errcode = '22023';
  end if;
  if f.status = 'accepted' then
    raise exception 'HR has already accepted the signed form' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'Give the witness''s full name' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_id_number, '')), '') is null then
    raise exception 'Give the witness''s ID number' using errcode = '22023';
  end if;
  if p_signature is null or not public.is_signature_image(p_signature) then
    raise exception 'The witness must sign' using errcode = '22023';
  end if;
  delete from public.employee_loan_witnesses where loan_id = p_loan;
  update public.employee_loan_forms
  set witness_name = left(btrim(p_name), 200), witness_id_number = left(btrim(p_id_number), 50),
      witness_signature = p_signature, witness_signed_at = now(), updated_at = now()
  where loan_id = p_loan returning * into f;
  if l.employee_number = public.current_employee_number() and public.loan_form_signed_in_app(f) then
    perform public.loan_form_tell_hr(l);
  end if;
  return f;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. corrections to what the form shows
-- ---------------------------------------------------------------------------------------------
create table if not exists public.employee_loan_form_values (
  loan_id uuid primary key references public.employee_loans(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  "values" jsonb not null default '{}'::jsonb check (jsonb_typeof("values") = 'object'),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.employee_loan_form_values enable row level security;
drop policy if exists tenant_isolation on public.employee_loan_form_values;
create policy tenant_isolation on public.employee_loan_form_values as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists read_own_or_staff on public.employee_loan_form_values;
create policy read_own_or_staff on public.employee_loan_form_values for select to authenticated
  using ((select public.reads_loan_forms()) or loan_id in (select public.my_loan_ids()));
revoke all on public.employee_loan_form_values from anon;
revoke insert, update, delete on public.employee_loan_form_values from authenticated;
drop trigger if exists audit_employee_loan_form_values on public.employee_loan_form_values;
create trigger audit_employee_loan_form_values after insert or update or delete on public.employee_loan_form_values
  for each row execute function public.audit_row_change();

-- The borrower or HR sets the corrections (all of them: an empty or missing one shows the record's value again).
create or replace function public.loan_form_set_values(p_loan uuid, p_values jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l public.employee_loans;
  v jsonb := '{}'::jsonb;
  k text;
  val text;
  allowed text[] := array['id_number', 'kra_pin', 'date_of_birth', 'mobile', 'email', 'town', 'workstation', 'job_title',
                          'payroll_number', 'employment_type', 'contract_end_date', 'gross_salary', 'net_salary'];
begin
  select * into l from public.employee_loans where id = p_loan and tenant_id = public.current_tenant_id();
  if l.id is null or not (public.manages_loans() or l.employee_number = public.current_employee_number()) then
    raise exception 'Loan not found' using errcode = 'P0002';
  end if;
  if l.status not in ('requested', 'approved') then
    raise exception 'The form''s details can be corrected until the loan is paid out' using errcode = '22023';
  end if;
  if exists (select 1 from public.employee_loan_forms f where f.loan_id = p_loan and f.status = 'accepted') then
    raise exception 'HR has already accepted the signed form' using errcode = '22023';
  end if;
  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    raise exception 'Give the details as a list of fields' using errcode = '22023';
  end if;
  for k, val in select key, value from jsonb_each_text(p_values) loop
    if not k = any(allowed) then
      raise exception 'The form has no field %', k using errcode = '22023';
    end if;
    val := nullif(btrim(coalesce(val, '')), '');
    if val is null then
      continue;
    end if;
    if length(val) > 200 then
      raise exception 'Keep % to 200 characters', k using errcode = '22023';
    end if;
    if k in ('gross_salary', 'net_salary') and (val !~ '^[0-9]+(\.[0-9]{1,2})?$') then
      raise exception 'Give the salary as an amount in KSh' using errcode = '22023';
    end if;
    v := v || jsonb_build_object(k, val);
  end loop;
  insert into public.employee_loan_form_values (loan_id, tenant_id, "values", updated_by)
  values (l.id, l.tenant_id, v, auth.uid())
  on conflict (loan_id) do update set "values" = excluded."values", updated_by = auth.uid(), updated_at = now();
  return v;
end $$;
revoke all on function public.loan_form_set_values(uuid, jsonb) from public, anon;
grant execute on function public.loan_form_set_values(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. deleting a cancelled loan
-- ---------------------------------------------------------------------------------------------
create or replace function public.delete_cancelled_loan(p_loan uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  l public.employee_loans;
begin
  if not public.manages_loans() then
    raise exception 'Only HR deletes a loan' using errcode = '42501';
  end if;
  select * into l from public.employee_loans where id = p_loan and tenant_id = public.current_tenant_id();
  if l.id is null then
    raise exception 'Loan not found' using errcode = 'P0002';
  end if;
  if l.status <> 'cancelled' then
    raise exception 'Only a cancelled loan can be deleted' using errcode = '22023';
  end if;
  if exists (select 1 from public.employee_loan_repayments r where r.loan_id = p_loan) then
    raise exception 'Payroll has taken repayments for this loan, so it is kept' using errcode = '22023';
  end if;
  delete from public.payment_requests where source = 'loan' and source_id = p_loan and status <> 'paid';
  delete from public.approval_requests where kind = 'loan' and record_id = p_loan;
  -- the form, guarantor, witness, corrections and schedule go with it (on delete cascade)
  delete from public.employee_loans where id = p_loan;
end $$;
revoke all on function public.delete_cancelled_loan(uuid) from public, anon;
grant execute on function public.delete_cancelled_loan(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. notifications (20261118200000's lists, with the witness's)
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
  'payment_due', 'payment_made', 'requisition_requested', 'requisition_approved', 'requisition_rejected',
  'possible_absences', 'possible_absences_team', 'possible_absence',
  'loan_form_to_sign', 'loan_form_signed', 'loan_form_accepted', 'loan_form_sent_back',
  'loan_guarantor_asked', 'loan_guarantor_signed', 'loan_guarantor_declined',
  'loan_witness_asked', 'loan_witness_signed', 'loan_witness_declined'
));

notify pgrst, 'reload schema';
