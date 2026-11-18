-- The loan agreement form (check-off loan application, key facts statement, terms, salary deduction authority,
-- declaration and lender approval), signed with people's saved signatures, and the signed copy kept with the loan.
--
--   loan_settings          gains the lender shown on the form (empty: the company itself, from its profile), the late
--                          payment charge and what happens to the balance on death or permanent incapacity (both
--                          printed on the form only: payroll charges neither), and whether a signed form is needed
--                          before payout (on by default).
--   employee_loans         gains what the applicant adds on the form: residential address, other monthly loan
--                          repayments, and the M-Pesa number or account to be paid into (finance sees it on the
--                          payment).
--   employee_loan_forms    one per approved loan: the three saved signatures put on it and the signed copy.
--       borrower           the employee signs their own approved loan (Sign with my signature).
--       lender approver    whoever gave the final approval signs right after approving.
--       employer officer   the HR person who accepts the signed copy signs the employer undertaking.
--       none -> uploaded (the employee or HR uploads the signed PDF) -> accepted, or -> sent_back (HR says what to fix)
--   storage bucket loan-forms (private): <company id>/<loan id>/signed-<random>.pdf, a new file on every upload.
--
-- Payout waits for the form: a loan approved from now on, in a company that requires the form, reaches finance's
-- Payments to make only when HR accepts its signed copy, and can't be marked paid out before. Loans approved before
-- this migration have no form row and pay out as before.
--
-- Every change to a form goes through the functions in section 4, which check who is asking; nobody writes the table
-- directly.

-- ---------------------------------------------------------------------------------------------
-- 1. settings and the applicant's details
-- ---------------------------------------------------------------------------------------------
alter table public.loan_settings
  add column if not exists lender_name text check (lender_name is null or length(lender_name) <= 200),
  add column if not exists lender_licence text check (lender_licence is null or length(lender_licence) <= 200),
  add column if not exists lender_address text check (lender_address is null or length(lender_address) <= 300),
  add column if not exists lender_postal_address text check (lender_postal_address is null or length(lender_postal_address) <= 200),
  add column if not exists lender_phone text check (lender_phone is null or length(lender_phone) <= 50),
  add column if not exists lender_email text check (lender_email is null or length(lender_email) <= 200),
  add column if not exists complaints_email text check (complaints_email is null or length(complaints_email) <= 200),
  add column if not exists late_charge_percent numeric check (late_charge_percent is null or (late_charge_percent >= 0 and late_charge_percent <= 100)),
  add column if not exists incapacity_terms text check (incapacity_terms is null or length(incapacity_terms) <= 1000),
  add column if not exists require_signed_form boolean not null default true;

alter table public.employee_loans
  add column if not exists residential_address text check (residential_address is null or length(residential_address) <= 300),
  add column if not exists other_loan_repayments numeric check (other_loan_repayments is null or other_loan_repayments >= 0),
  add column if not exists disbursement_account text check (disbursement_account is null or length(disbursement_account) <= 100);

-- ---------------------------------------------------------------------------------------------
-- 2. the form
-- ---------------------------------------------------------------------------------------------
create table if not exists public.employee_loan_forms (
  loan_id uuid primary key references public.employee_loans(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- payout waits for HR to accept the signed copy
  required boolean not null default true,
  borrower_signature text check (public.is_signature_image(borrower_signature)),
  borrower_signed_at timestamptz,
  approver_signature text check (public.is_signature_image(approver_signature)),
  approver_name text check (approver_name is null or length(approver_name) <= 200),
  approver_title text check (approver_title is null or length(approver_title) <= 200),
  approver_signed_at timestamptz,
  status text not null default 'none' check (status in ('none', 'uploaded', 'accepted', 'sent_back')),
  file_path text,
  file_name text check (file_name is null or length(file_name) <= 255),
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz,
  send_back_reason text check (send_back_reason is null or length(send_back_reason) <= 1000),
  employer_signature text check (public.is_signature_image(employer_signature)),
  employer_officer text check (employer_officer is null or length(employer_officer) <= 200),
  employer_officer_title text check (employer_officer_title is null or length(employer_officer_title) <= 200),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status not in ('uploaded', 'accepted') or file_path is not null),
  check (status <> 'sent_back' or nullif(btrim(send_back_reason), '') is not null)
);
create index if not exists employee_loan_forms_tenant_status on public.employee_loan_forms (tenant_id, status);

alter table public.employee_loan_forms enable row level security;
drop policy if exists tenant_isolation on public.employee_loan_forms;
create policy tenant_isolation on public.employee_loan_forms as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
-- read: whoever manages loans, and the borrower; no write policies (section 4 writes it)
drop policy if exists read_own_or_manage on public.employee_loan_forms;
create policy read_own_or_manage on public.employee_loan_forms for select to authenticated
  using ((select public.manages_loans()) or loan_id in (select public.my_loan_ids()));
revoke all on public.employee_loan_forms from anon;
revoke insert, update, delete on public.employee_loan_forms from authenticated;

drop trigger if exists audit_employee_loan_forms on public.employee_loan_forms;
create trigger audit_employee_loan_forms after insert or update or delete on public.employee_loan_forms
  for each row execute function public.audit_row_change();

-- a loan that becomes approved gets its form (the name sorts before employee_loan_payment_request, which reads it)
create or replace function public.employee_loan_form_open() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_required boolean;
begin
  if new.status <> 'approved' or (tg_op = 'UPDATE' and old.status is not distinct from new.status) then
    return null;
  end if;
  select coalesce((select s.require_signed_form from public.loan_settings s where s.tenant_id = new.tenant_id), true)
  into v_required;
  insert into public.employee_loan_forms (loan_id, tenant_id, required)
  values (new.id, new.tenant_id, v_required)
  on conflict (loan_id) do nothing;
  if v_required then
    perform public.notify_employee_number(new.tenant_id, new.employee_number, 'loan_form_to_sign', 'Sign your loan form',
      'Your ' || lower(coalesce(new.product_name, 'loan')) || ' of ' || public.kes(new.principal)
      || ' is approved. Open Loans in the staff portal to sign the loan form and upload the signed copy. It is paid out once HR accepts it.');
  end if;
  return null;
end $$;
drop trigger if exists employee_loan_form_open on public.employee_loans;
create trigger employee_loan_form_open after insert or update of status on public.employee_loans
  for each row execute function public.employee_loan_form_open();

-- the form still holds up payout
create or replace function public.loan_form_pending(p_loan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.employee_loan_forms f where f.loan_id = p_loan and f.required and f.status <> 'accepted')
$$;
revoke all on function public.loan_form_pending(uuid) from public, anon;
grant execute on function public.loan_form_pending(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. payout waits for the form
-- ---------------------------------------------------------------------------------------------
-- finance's payment for an approved loan (20261115100000's, with the account to pay into)
create or replace function public.loan_open_payment(l public.employee_loans) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.payment_request_open(l.tenant_id, 'loan', l.id, l.employee_number,
    public.employee_display_name(l.tenant_id, l.employee_number), nullif(btrim(coalesce(l.disbursement_account, '')), ''),
    public.loan_paid_out(l),
    coalesce(l.product_name, 'Loan') || ' over ' || l.months || ' months'
    || case when l.interest_method = 'upfront'
         then ' (' || public.kes(l.principal) || ' less ' || public.kes(coalesce(l.total_interest, 0)) || ' interest)'
         else '' end
    || coalesce(': ' || nullif(btrim(l.reason), ''), ''));
end $$;
revoke all on function public.loan_open_payment(public.employee_loans) from public, anon, authenticated;

create or replace function public.employee_loan_payment_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  if new.status = 'approved' then
    -- a form still to be signed and accepted: finance is told when HR accepts it (loan_form_review)
    if not public.loan_form_pending(new.id) then
      perform public.loan_open_payment(new);
    end if;
  elsif new.status = 'disbursed' and tg_op = 'UPDATE' and old.status = 'approved' then
    perform public.payment_request_paid_elsewhere('loan', new.id);
  elsif new.status in ('rejected', 'cancelled', 'requested') then
    perform public.payment_request_close('loan', new.id);
  end if;
  return null;
end $$;

-- nothing is paid out before the signed form is accepted, whoever tries
create or replace function public.employee_loan_form_gate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'approved' and new.status = 'disbursed' and public.loan_form_pending(new.id) then
    raise exception 'The signed loan form must be uploaded and accepted before the loan is paid out' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists employee_loan_form_gate on public.employee_loans;
create trigger employee_loan_form_gate before update of status on public.employee_loans
  for each row execute function public.employee_loan_form_gate();

-- ---------------------------------------------------------------------------------------------
-- 4. the steps
-- ---------------------------------------------------------------------------------------------
-- Checks the signed-in person may act on the loan's form (HR, or the borrower) and locks the form for the change. Each
-- step below starts with it, then reads the loan (l) and its form (f).
create or replace function public.loan_form_check(p_loan uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_loan public.employee_loans;
begin
  select * into v_loan from public.employee_loans where id = p_loan and tenant_id = public.current_tenant_id();
  if v_loan.id is null or not (public.manages_loans() or v_loan.employee_number = public.current_employee_number()) then
    raise exception 'Loan not found' using errcode = 'P0002';
  end if;
  perform 1 from public.employee_loan_forms where loan_id = p_loan for update;
  if not found then
    raise exception 'This loan has no form to sign yet: it is signed once the loan is approved' using errcode = '22023';
  end if;
end $$;
revoke all on function public.loan_form_check(uuid) from public, anon, authenticated;

-- The borrower puts their saved signature on their approved loan's form (the declaration and the salary deduction
-- authority). They may sign again, with a newer signature, until HR accepts the signed copy.
create or replace function public.loan_form_sign_borrower(p_loan uuid, p_signature text)
returns public.employee_loan_forms
language plpgsql security definer set search_path = public as $$
declare
  l public.employee_loans;
  f public.employee_loan_forms;
begin
  perform public.loan_form_check(p_loan);
  select * into l from public.employee_loans where id = p_loan;
  select * into f from public.employee_loan_forms where loan_id = p_loan;
  if l.employee_number is distinct from public.current_employee_number() then
    raise exception 'Only the borrower signs as the borrower' using errcode = '42501';
  end if;
  if l.status <> 'approved' then
    raise exception 'The form can be signed while the loan is approved and not yet paid out' using errcode = '22023';
  end if;
  if f.status = 'accepted' then
    raise exception 'HR has already accepted your signed form' using errcode = '22023';
  end if;
  if p_signature is null or not public.is_signature_image(p_signature) then
    raise exception 'Draw your signature under My signature first' using errcode = '22023';
  end if;
  update public.employee_loan_forms set borrower_signature = p_signature, borrower_signed_at = now(), updated_at = now()
  where loan_id = p_loan returning * into f;
  return f;
end $$;
revoke all on function public.loan_form_sign_borrower(uuid, text) from public, anon;
grant execute on function public.loan_form_sign_borrower(uuid, text) to authenticated;

-- Whoever gave the loan its final approval signs the lender approval (once; their name and job title go with it).
create or replace function public.loan_form_sign_approver(p_loan uuid, p_signature text, p_name text, p_title text default null)
returns public.employee_loan_forms
language plpgsql security definer set search_path = public as $$
declare
  l public.employee_loans;
  f public.employee_loan_forms;
begin
  perform public.loan_form_check(p_loan);
  select * into l from public.employee_loans where id = p_loan;
  select * into f from public.employee_loan_forms where loan_id = p_loan;
  if l.decided_by is distinct from auth.uid() then
    raise exception 'Only the person who approved the loan signs its approval' using errcode = '42501';
  end if;
  if l.status not in ('approved', 'disbursed', 'repaying', 'completed') then
    raise exception 'The loan is not approved' using errcode = '22023';
  end if;
  if f.approver_signature is not null then
    raise exception 'The approval is already signed' using errcode = '22023';
  end if;
  if p_signature is null or not public.is_signature_image(p_signature) then
    raise exception 'Draw your signature under My signature first' using errcode = '22023';
  end if;
  update public.employee_loan_forms
  set approver_signature = p_signature, approver_name = left(nullif(btrim(coalesce(p_name, '')), ''), 200),
      approver_title = left(nullif(btrim(coalesce(p_title, '')), ''), 200), approver_signed_at = now(), updated_at = now()
  where loan_id = p_loan returning * into f;
  return f;
end $$;
revoke all on function public.loan_form_sign_approver(uuid, text, text, text) from public, anon;
grant execute on function public.loan_form_sign_approver(uuid, text, text, text) to authenticated;

-- The signed copy (already in storage at p_path) is in: from the borrower, or from HR for a form signed on paper.
-- HR hears when the borrower sends it. It may be replaced until HR accepts it.
create or replace function public.loan_form_submit(p_loan uuid, p_path text, p_file_name text default null)
returns public.employee_loan_forms
language plpgsql security definer set search_path = public as $$
declare
  l public.employee_loans;
  f public.employee_loan_forms;
  e public.employees;
  who text;
begin
  perform public.loan_form_check(p_loan);
  select * into l from public.employee_loans where id = p_loan;
  select * into f from public.employee_loan_forms where loan_id = p_loan;
  if l.status <> 'approved' then
    raise exception 'A signed form can be uploaded while the loan is approved and not yet paid out' using errcode = '22023';
  end if;
  if f.status = 'accepted' then
    raise exception 'HR has already accepted the signed form, so it can''t be replaced' using errcode = '22023';
  end if;
  if split_part(coalesce(p_path, ''), '/', 1) <> l.tenant_id::text or split_part(p_path, '/', 2) <> l.id::text
     or split_part(p_path, '/', 3) not like 'signed-%' or split_part(p_path, '/', 4) <> '' then
    raise exception 'The signed form must be saved in the loan''s own folder' using errcode = '23514';
  end if;
  if lower(p_path) !~ '\.pdf$' then
    raise exception 'The signed form must be a PDF' using errcode = '23514';
  end if;
  update public.employee_loan_forms
  set status = 'uploaded', file_path = p_path, file_name = left(nullif(btrim(coalesce(p_file_name, '')), ''), 255),
      uploaded_by = auth.uid(), uploaded_at = now(), reviewed_by = null, reviewed_at = null, updated_at = now()
  where loan_id = p_loan returning * into f;

  if l.employee_number = public.current_employee_number() then
    select * into e from public.employees where tenant_id = l.tenant_id and "Employee Number" = l.employee_number;
    who := coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), l.employee_number);
    insert into public.hr_notifications (tenant_id, employee_number, employee_name, work_email, notification_type, title, message)
    values (l.tenant_id, l.employee_number, who, e."Work Email", 'loan_form_signed', 'Signed loan form to review',
      who || ' uploaded the signed form for their loan of ' || public.kes(l.principal) || '. Review it under Loans > To pay out.');
  end if;
  return f;
end $$;
revoke all on function public.loan_form_submit(uuid, text, text) from public, anon;
grant execute on function public.loan_form_submit(uuid, text, text) to authenticated;

-- HR accepts the signed copy, signing the employer undertaking with their saved signature (finance is then told to
-- pay), or sends it back saying what to fix.
create or replace function public.loan_form_review(
  p_loan uuid, p_accept boolean, p_reason text default null,
  p_signature text default null, p_officer text default null, p_title text default null
) returns public.employee_loan_forms
language plpgsql security definer set search_path = public as $$
declare
  l public.employee_loans;
  f public.employee_loan_forms;
begin
  perform public.loan_form_check(p_loan);
  select * into l from public.employee_loans where id = p_loan;
  select * into f from public.employee_loan_forms where loan_id = p_loan;
  if not public.manages_loans() then
    raise exception 'Only HR reviews a signed loan form' using errcode = '42501';
  end if;
  if l.employee_number = public.current_employee_number() then
    raise exception 'Someone else must review the form for your own loan' using errcode = '42501';
  end if;
  if f.status <> 'uploaded' then
    raise exception 'There is no signed form waiting to be reviewed' using errcode = '22023';
  end if;
  if l.status <> 'approved' then
    raise exception 'The loan is no longer waiting to be paid out' using errcode = '22023';
  end if;
  if p_accept is null then
    raise exception 'Accept the form or send it back' using errcode = '22023';
  end if;
  if p_accept then
    if p_signature is null or not public.is_signature_image(p_signature) then
      raise exception 'Draw your signature under My signature first: it signs the employer undertaking' using errcode = '22023';
    end if;
    update public.employee_loan_forms
    set status = 'accepted', send_back_reason = null, employer_signature = p_signature,
        employer_officer = left(nullif(btrim(coalesce(p_officer, '')), ''), 200),
        employer_officer_title = left(nullif(btrim(coalesce(p_title, '')), ''), 200),
        reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    where loan_id = p_loan returning * into f;
    perform public.loan_open_payment(l);
    perform public.notify_employee_number(l.tenant_id, l.employee_number, 'loan_form_accepted', 'Loan form accepted',
      'HR accepted your signed loan form. Your loan of ' || public.kes(l.principal) || ' now goes to finance to be paid out.');
  else
    if nullif(btrim(coalesce(p_reason, '')), '') is null then
      raise exception 'Say what needs fixing' using errcode = '22023';
    end if;
    update public.employee_loan_forms
    set status = 'sent_back', send_back_reason = left(btrim(p_reason), 1000), reviewed_by = auth.uid(), reviewed_at = now(),
        updated_at = now()
    where loan_id = p_loan returning * into f;
    perform public.notify_employee_number(l.tenant_id, l.employee_number, 'loan_form_sent_back', 'Loan form sent back',
      'HR sent your signed loan form back: ' || btrim(p_reason) || ' Please upload a corrected signed copy under Loans.');
  end if;
  return f;
end $$;
revoke all on function public.loan_form_review(uuid, boolean, text, text, text, text) from public, anon;
grant execute on function public.loan_form_review(uuid, boolean, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. the files
-- ---------------------------------------------------------------------------------------------
-- the signed-in employee's loans whose signed form they may still upload, as text for the storage policies
create or replace function public.my_open_loan_form_ids() returns setof text
language sql stable security definer set search_path = public as $$
  select l.id::text from public.employee_loans l
  join public.employee_loan_forms f on f.loan_id = l.id
  where l.tenant_id = public.current_tenant_id() and l.employee_number = public.current_employee_number()
    and l.status = 'approved' and f.status <> 'accepted'
$$;
create or replace function public.my_loan_id_texts() returns setof text
language sql stable security definer set search_path = public as $$
  select id::text from public.my_loan_ids() id
$$;
revoke all on function public.my_open_loan_form_ids() from public, anon;
revoke all on function public.my_loan_id_texts() from public, anon;
grant execute on function public.my_open_loan_form_ids() to authenticated;
grant execute on function public.my_loan_id_texts() to authenticated;

do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public) values ('loan-forms', 'loan-forms', false)
  on conflict (id) do update set public = false;
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute $u$update storage.buckets set file_size_limit = 20971520, allowed_mime_types = array['application/pdf'] where id = 'loan-forms'$u$;
  end if;

  drop policy if exists loan_forms_select on storage.objects;
  create policy loan_forms_select on storage.objects for select to authenticated
    using (
    bucket_id = 'loan-forms'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and ((select public.manages_loans())
    or (storage.foldername(name))[2] in (select public.my_loan_id_texts()))
    );
  drop policy if exists loan_forms_insert on storage.objects;
  create policy loan_forms_insert on storage.objects for insert to authenticated
    with check (
    bucket_id = 'loan-forms'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and array_length(storage.foldername(name), 1) = 2
    and storage.filename(name) like 'signed-%'
    and lower(storage.filename(name)) like '%.pdf'
    and ((select public.manages_loans())
    or (storage.foldername(name))[2] in (select public.my_open_loan_form_ids()))
    );
  -- no update or delete: every signed copy is kept
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6. notifications (20261106100000's lists, with the loan form's)
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
  'loan_form_to_sign', 'loan_form_signed', 'loan_form_accepted', 'loan_form_sent_back'
));

create or replace function public.hr_only_notification(p_type text) returns boolean language sql immutable as $$
  select p_type in ('contract_expiring', 'probation_expiring', 'leave_recommended', 'exit_requested', 'application_received',
                    'loan_requested', 'contract_signed', 'leave_exhausted', 'casual_limit', 'leave_document_overdue',
                    'contribution_requested', 'onboarding_followups_overdue', 'attendance_odd_hours', 'missed_scan_requested',
                    'payment_due', 'requisition_requested', 'possible_absences', 'loan_form_signed')
$$;

notify pgrst, 'reload schema';
