-- The loan form filled in the app as far as it can be (20261118100000's form), and its guarantor: the witness, the
-- guarantor, who did the affordability assessment, and the checklist. Only the stamps are left for the paper copy.
--
--   employee_loan_guarantors          one per loan: the colleague who guarantees it (the form says the guarantor works
--                                    for the same employer, so they are one of the company's employees). The borrower
--                                    (or HR) asks them; they sign in their staff portal with their saved signature,
--                                    adding their relationship to the borrower, another phone number and their address,
--                                    or decline. Their ID, KRA PIN, date of birth, phone, email and town are copied from
--                                    their employee record as they sign, so the borrower and HR see them on the form.
--                                    The guarantor sees the loan's terms, not the borrower's personal details.
--                                    A form the company requires needs the guarantor's signature to be accepted in the
--                                    app; a copy signed on paper is HR's to judge.
--
--   employee_loan_forms.witness_*    the witness's name, ID number and signature, drawn on the screen (a witness is
--                                    usually not a user, so they have no saved signature). The borrower or HR adds it
--                                    while the form is open (the loan approved, the signed copy not yet accepted), and
--                                    may redo it until then.
--   employee_loan_forms.affordability_by, checks
--                                    HR's part: who did the affordability assessment, and the checklist items it ticked
--                                    (the guarantor's documents, the applicant's ID and KRA PIN, the payslips). "Signed
--                                    loan form" ticks itself once HR accepts it.
--
--   A form signed, witnessed and guaranteed in the app is ready for HR without an upload: HR accepts it (or sends it
--   back) as an uploaded copy, and hears of it when the last of them signs. Uploading a copy signed on paper works as
--   before.
--
-- Written only through the functions here (and the 20261118100000 steps). Safe to run again.

alter table public.employee_loan_forms
  add column if not exists witness_name text check (witness_name is null or length(witness_name) <= 200),
  add column if not exists witness_id_number text check (witness_id_number is null or length(witness_id_number) <= 50),
  add column if not exists witness_signature text check (public.is_signature_image(witness_signature)),
  add column if not exists witness_signed_at timestamptz,
  add column if not exists affordability_by text check (affordability_by is null or length(affordability_by) <= 200),
  add column if not exists checks text[] not null default '{}'
    check (checks <@ array['guarantor_docs', 'id_kra', 'payslips']);

-- ---------------------------------------------------------------------------------------------
-- The guarantor
-- ---------------------------------------------------------------------------------------------
create table if not exists public.employee_loan_guarantors (
  loan_id uuid primary key references public.employee_loans(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_number text not null,
  guarantor_name text not null check (length(guarantor_name) <= 200),
  status text not null default 'asked' check (status in ('asked', 'signed', 'declined')),
  decline_reason text check (decline_reason is null or length(decline_reason) <= 1000),
  -- the guarantor adds these as they sign
  relationship text check (relationship is null or length(relationship) <= 100),
  alternative_phone text check (alternative_phone is null or length(alternative_phone) <= 50),
  residential_address text check (residential_address is null or length(residential_address) <= 300),
  -- copied from their employee record as they sign
  id_number text, kra_pin text, date_of_birth text, mobile text, email text, town text,
  signature text check (public.is_signature_image(signature)),
  signed_at timestamptz,
  asked_by uuid references auth.users(id) on delete set null,
  asked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, employee_number) references public.employees(tenant_id, "Employee Number") on update cascade on delete cascade,
  check (status <> 'signed' or (signature is not null and relationship is not null)),
  check (status <> 'declined' or nullif(btrim(decline_reason), '') is not null)
);
create index if not exists employee_loan_guarantors_guarantor on public.employee_loan_guarantors (tenant_id, employee_number);

alter table public.employee_loan_guarantors enable row level security;
drop policy if exists tenant_isolation on public.employee_loan_guarantors;
create policy tenant_isolation on public.employee_loan_guarantors as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
-- read: HR, the borrower and the guarantor; no write policies (the functions below write it)
drop policy if exists read_involved on public.employee_loan_guarantors;
create policy read_involved on public.employee_loan_guarantors for select to authenticated
  using ((select public.manages_loans()) or loan_id in (select public.my_loan_ids())
         or employee_number = (select public.current_employee_number()));
revoke all on public.employee_loan_guarantors from anon;
revoke insert, update, delete on public.employee_loan_guarantors from authenticated;

drop trigger if exists audit_employee_loan_guarantors on public.employee_loan_guarantors;
create trigger audit_employee_loan_guarantors after insert or update or delete on public.employee_loan_guarantors
  for each row execute function public.audit_row_change();

-- the colleagues a borrower may ask: everyone in the company still employed, but themselves
create or replace function public.loan_guarantor_choices()
returns table (employee_number text, name text)
language sql stable security definer set search_path = public as $$
  select e."Employee Number", public.employee_display_name(e.tenant_id, e."Employee Number")
  from public.employees e
  where e.tenant_id = public.current_tenant_id() and nullif(btrim(coalesce(e."Termination Date", '')), '') is null
    and e."Employee Number" is distinct from public.current_employee_number()
  order by 2
$$;
revoke all on function public.loan_guarantor_choices() from public, anon;
grant execute on function public.loan_guarantor_choices() to authenticated;

-- The borrower (or HR) asks a colleague to guarantee the loan, or asks another after one declined. A guarantor who
-- signed stays, unless HR changes them.
create or replace function public.loan_set_guarantor(p_loan uuid, p_employee text)
returns public.employee_loan_guarantors
language plpgsql security definer set search_path = public as $$
declare
  l public.employee_loans;
  g public.employee_loan_guarantors;
  e public.employees;
  v_form_status text;
begin
  select * into l from public.employee_loans where id = p_loan and tenant_id = public.current_tenant_id();
  if l.id is null or not (public.manages_loans() or l.employee_number = public.current_employee_number()) then
    raise exception 'Loan not found' using errcode = 'P0002';
  end if;
  if l.status not in ('requested', 'approved') then
    raise exception 'The guarantor is chosen before the loan is paid out' using errcode = '22023';
  end if;
  select status into v_form_status from public.employee_loan_forms where loan_id = p_loan;
  if v_form_status = 'accepted' then
    raise exception 'HR has already accepted the signed form' using errcode = '22023';
  end if;
  select * into g from public.employee_loan_guarantors where loan_id = p_loan for update;
  if g.status = 'signed' and not public.manages_loans() then
    raise exception 'Your guarantor has already signed. Ask HR to change them.' using errcode = '22023';
  end if;
  select * into e from public.employees where tenant_id = l.tenant_id and "Employee Number" = btrim(coalesce(p_employee, ''));
  if e.id is null then
    raise exception 'Choose a colleague from the company as guarantor' using errcode = '22023';
  end if;
  if e."Employee Number" = l.employee_number then
    raise exception 'The borrower can''t be their own guarantor' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(e."Termination Date", '')), '') is not null then
    raise exception 'The guarantor must still work for the company' using errcode = '22023';
  end if;
  insert into public.employee_loan_guarantors (loan_id, tenant_id, employee_number, guarantor_name, asked_by)
  values (l.id, l.tenant_id, e."Employee Number", public.employee_display_name(l.tenant_id, e."Employee Number"), auth.uid())
  on conflict (loan_id) do update set
    employee_number = excluded.employee_number, guarantor_name = excluded.guarantor_name, status = 'asked',
    decline_reason = null, relationship = null, alternative_phone = null, residential_address = null, id_number = null,
    kra_pin = null, date_of_birth = null, mobile = null, email = null, town = null, signature = null, signed_at = null,
    asked_by = auth.uid(), asked_at = now(), updated_at = now()
  returning * into g;
  perform public.notify_employee_number(l.tenant_id, e."Employee Number", 'loan_guarantor_asked', 'Guarantee a loan?',
    public.employee_display_name(l.tenant_id, l.employee_number) || ' asked you to guarantee their loan of '
    || public.kes(l.principal) || ' over ' || l.months || ' months. Open Loans in the staff portal to read the form and sign or decline.');
  return g;
end $$;
revoke all on function public.loan_set_guarantor(uuid, text) from public, anon;
grant execute on function public.loan_set_guarantor(uuid, text) to authenticated;

-- The guarantor signs (with their saved signature) or declines.
create or replace function public.loan_guarantor_sign(
  p_loan uuid, p_signature text, p_relationship text, p_alternative_phone text default null, p_address text default null
) returns public.employee_loan_guarantors
language plpgsql security definer set search_path = public as $$
declare
  l public.employee_loans;
  g public.employee_loan_guarantors;
  e public.employees;
  f public.employee_loan_forms;
begin
  select * into g from public.employee_loan_guarantors where loan_id = p_loan and tenant_id = public.current_tenant_id() for update;
  if g.loan_id is null or g.employee_number is distinct from public.current_employee_number() then
    raise exception 'Loan not found' using errcode = 'P0002';
  end if;
  select * into l from public.employee_loans where id = p_loan;
  if l.status not in ('requested', 'approved') then
    raise exception 'This loan is no longer waiting for a guarantor' using errcode = '22023';
  end if;
  if g.status <> 'asked' then
    raise exception 'You have already %', case g.status when 'signed' then 'signed' else 'declined' end using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_relationship, '')), '') is null then
    raise exception 'Say how you are related to the borrower (for example: colleague)' using errcode = '22023';
  end if;
  if p_signature is null or not public.is_signature_image(p_signature) then
    raise exception 'Draw your signature under My signature first' using errcode = '22023';
  end if;
  select * into e from public.employees where tenant_id = g.tenant_id and "Employee Number" = g.employee_number;
  update public.employee_loan_guarantors
  set status = 'signed', signature = p_signature, signed_at = now(),
      relationship = left(btrim(p_relationship), 100),
      alternative_phone = left(nullif(btrim(coalesce(p_alternative_phone, '')), ''), 50),
      residential_address = left(nullif(btrim(coalesce(p_address, '')), ''), 300),
      id_number = nullif(btrim(coalesce(e."ID Number"::text, '')), ''),
      kra_pin = nullif(btrim(coalesce(e."Tax PIN"::text, '')), ''),
      date_of_birth = nullif(btrim(coalesce(e."Date of Birth"::text, '')), ''),
      mobile = nullif(btrim(coalesce(e."Mobile Number"::text, '')), ''),
      email = nullif(btrim(coalesce(e."Work Email"::text, '')), ''),
      town = nullif(btrim(coalesce(e."Town"::text, '')), ''),
      updated_at = now()
  where loan_id = p_loan returning * into g;
  perform public.notify_employee_number(l.tenant_id, l.employee_number, 'loan_guarantor_signed', 'Your guarantor signed',
    g.guarantor_name || ' signed as guarantor for your loan of ' || public.kes(l.principal) || '.');
  select * into f from public.employee_loan_forms where loan_id = p_loan;
  if f.loan_id is not null and public.loan_form_signed_in_app(f) then
    perform public.loan_form_tell_hr(l);
  end if;
  return g;
end $$;
revoke all on function public.loan_guarantor_sign(uuid, text, text, text, text) from public, anon;
grant execute on function public.loan_guarantor_sign(uuid, text, text, text, text) to authenticated;

create or replace function public.loan_guarantor_decline(p_loan uuid, p_reason text)
returns public.employee_loan_guarantors
language plpgsql security definer set search_path = public as $$
declare
  l public.employee_loans;
  g public.employee_loan_guarantors;
begin
  select * into g from public.employee_loan_guarantors where loan_id = p_loan and tenant_id = public.current_tenant_id() for update;
  if g.loan_id is null or g.employee_number is distinct from public.current_employee_number() then
    raise exception 'Loan not found' using errcode = 'P0002';
  end if;
  if g.status <> 'asked' then
    raise exception 'You have already answered' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Give a reason, so the borrower knows' using errcode = '22023';
  end if;
  select * into l from public.employee_loans where id = p_loan;
  update public.employee_loan_guarantors set status = 'declined', decline_reason = left(btrim(p_reason), 1000), updated_at = now()
  where loan_id = p_loan returning * into g;
  perform public.notify_employee_number(l.tenant_id, l.employee_number, 'loan_guarantor_declined', 'Guarantor declined',
    g.guarantor_name || ' declined to guarantee your loan of ' || public.kes(l.principal) || ': ' || btrim(p_reason)
    || ' Choose another guarantor under Loans.');
  return g;
end $$;
revoke all on function public.loan_guarantor_decline(uuid, text) from public, anon;
grant execute on function public.loan_guarantor_decline(uuid, text) to authenticated;

-- What the guarantor sees of the loan: its terms and schedule, the borrower's name, the lender, and their own part. Not
-- the borrower's ID, KRA PIN, date of birth, address or pay.
create or replace function public.loan_form_for_guarantor(p_loan uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  g public.employee_loan_guarantors;
  l public.employee_loans;
begin
  select * into g from public.employee_loan_guarantors where loan_id = p_loan and tenant_id = public.current_tenant_id();
  if g.loan_id is null or g.employee_number is distinct from public.current_employee_number() then
    raise exception 'Loan not found' using errcode = 'P0002';
  end if;
  select * into l from public.employee_loans where id = p_loan;
  return jsonb_build_object(
    'loan', jsonb_build_object(
      'id', l.id, 'employee_number', l.employee_number, 'product_id', l.product_id, 'product_name', l.product_name,
      'principal', l.principal, 'annual_rate', l.annual_rate, 'interest_method', l.interest_method, 'months', l.months,
      'start_period', l.start_period, 'monthly_instalment', l.monthly_instalment, 'total_interest', l.total_interest,
      'total_repayable', l.total_repayable, 'status', l.status, 'reason', l.reason, 'decided_at', l.decided_at,
      'disbursed_at', l.disbursed_at, 'created_at', l.created_at, 'disbursement_account', l.disbursement_account),
    'borrower_name', public.employee_display_name(l.tenant_id, l.employee_number),
    'schedule', coalesce((select jsonb_agg(jsonb_build_object('instalment_no', i.instalment_no, 'period', i.period, 'payment', i.payment,
                                                             'principal', i.principal, 'interest', i.interest, 'balance', i.balance) order by i.instalment_no)
                          from public.employee_loan_instalments i where i.loan_id = l.id), '[]'::jsonb),
    'guarantor', to_jsonb(g),
    'employer', (select c.company_name from public.company_profile c where c.tenant_id = l.tenant_id)
  );
end $$;
revoke all on function public.loan_form_for_guarantor(uuid) from public, anon;
grant execute on function public.loan_form_for_guarantor(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- A form signed in the app: HR may accept it with no upload
-- ---------------------------------------------------------------------------------------------
-- An accepted form has an uploaded copy, or the borrower's and the witness's signatures in the app
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.employee_loan_forms'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%''accepted''%' and pg_get_constraintdef(oid) like '%file_path%'
  loop
    execute format('alter table public.employee_loan_forms drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.employee_loan_forms drop constraint if exists employee_loan_forms_uploaded_has_file;
alter table public.employee_loan_forms add constraint employee_loan_forms_uploaded_has_file
  check (status <> 'uploaded' or file_path is not null);
alter table public.employee_loan_forms drop constraint if exists employee_loan_forms_accepted_is_signed;
alter table public.employee_loan_forms add constraint employee_loan_forms_accepted_is_signed
  check (status <> 'accepted' or file_path is not null or (borrower_signature is not null and witness_signature is not null));

-- signed by the borrower, witnessed and (when the form is required) guaranteed in the app, the witness since HR last sent
-- it back (if it did): ready for HR to review
create or replace function public.loan_form_signed_in_app(f public.employee_loan_forms) returns boolean
language sql stable security definer set search_path = public as $$
  select f.status in ('none', 'sent_back') and f.borrower_signature is not null and f.witness_signature is not null
    and (f.reviewed_at is null or f.witness_signed_at > f.reviewed_at)
    and (not f.required or exists (select 1 from public.employee_loan_guarantors g where g.loan_id = f.loan_id and g.status = 'signed'))
$$;
grant execute on function public.loan_form_signed_in_app(public.employee_loan_forms) to authenticated;

-- HR hears that a borrower's form is ready (as an upload does, in loan_form_submit)
create or replace function public.loan_form_tell_hr(l public.employee_loans) returns void
language plpgsql security definer set search_path = public as $$
declare
  e public.employees;
  who text;
begin
  select * into e from public.employees where tenant_id = l.tenant_id and "Employee Number" = l.employee_number;
  who := coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), l.employee_number);
  insert into public.hr_notifications (tenant_id, employee_number, employee_name, work_email, notification_type, title, message)
  values (l.tenant_id, l.employee_number, who, e."Work Email", 'loan_form_signed', 'Signed loan form to review',
    who || ' signed the form for their loan of ' || public.kes(l.principal) || ', witnessed and guaranteed. Review it under Loans > To pay out.');
end $$;
revoke all on function public.loan_form_tell_hr(public.employee_loans) from public, anon, authenticated;

-- The witness of the borrower's signature: name, ID number and their signature drawn on the screen.
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
  update public.employee_loan_forms
  set witness_name = left(btrim(p_name), 200), witness_id_number = left(btrim(p_id_number), 50),
      witness_signature = p_signature, witness_signed_at = now(), updated_at = now()
  where loan_id = p_loan returning * into f;
  -- HR adding the witness needs no message to itself
  if l.employee_number = public.current_employee_number() and public.loan_form_signed_in_app(f) then
    perform public.loan_form_tell_hr(l);
  end if;
  return f;
end $$;
revoke all on function public.loan_form_witness(uuid, text, text, text) from public, anon;
grant execute on function public.loan_form_witness(uuid, text, text, text) to authenticated;

-- HR's part: who did the affordability assessment and the checklist items it ticked (all of them, replacing the last).
create or replace function public.loan_form_checks(p_loan uuid, p_affordability_by text, p_checks text[])
returns public.employee_loan_forms
language plpgsql security definer set search_path = public as $$
declare
  l public.employee_loans;
  f public.employee_loan_forms;
  v_checks text[] := array(select distinct c from unnest(coalesce(p_checks, '{}')) c order by c);
begin
  if not public.manages_loans() then
    raise exception 'Only HR fills in the checklist' using errcode = '42501';
  end if;
  perform public.loan_form_check(p_loan);
  select * into l from public.employee_loans where id = p_loan;
  if l.employee_number = public.current_employee_number() then
    raise exception 'Someone else must fill in the checklist for your own loan' using errcode = '42501';
  end if;
  if l.status in ('rejected', 'cancelled') then
    raise exception 'The loan is %', l.status using errcode = '22023';
  end if;
  if not v_checks <@ array['guarantor_docs', 'id_kra', 'payslips'] then
    raise exception 'Unknown checklist item' using errcode = '22023';
  end if;
  update public.employee_loan_forms
  set affordability_by = left(nullif(btrim(coalesce(p_affordability_by, '')), ''), 200), checks = v_checks, updated_at = now()
  where loan_id = p_loan returning * into f;
  return f;
end $$;
revoke all on function public.loan_form_checks(uuid, text, text[]) from public, anon;
grant execute on function public.loan_form_checks(uuid, text, text[]) to authenticated;

-- (20261118100000's, and HR hears when the form is complete in the app)
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
  -- witnessed already: the form is complete in the app, and HR hears of it
  if public.loan_form_signed_in_app(f) then
    perform public.loan_form_tell_hr(l);
  end if;
  return f;
end $$;
revoke all on function public.loan_form_sign_borrower(uuid, text) from public, anon;
grant execute on function public.loan_form_sign_borrower(uuid, text) to authenticated;

-- (20261118100000's, also for a form signed in the app with no upload)
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
  if not (f.status = 'uploaded' or public.loan_form_signed_in_app(f)) then
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

-- notifications (20261118100000's lists, with the guarantor's)
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
  'loan_guarantor_asked', 'loan_guarantor_signed', 'loan_guarantor_declined'
));

create or replace function public.hr_only_notification(p_type text) returns boolean language sql immutable as $$
  select p_type in ('contract_expiring', 'probation_expiring', 'leave_recommended', 'exit_requested', 'application_received',
                    'loan_requested', 'contract_signed', 'leave_exhausted', 'casual_limit', 'leave_document_overdue',
                    'contribution_requested', 'onboarding_followups_overdue', 'attendance_odd_hours', 'missed_scan_requested',
                    'payment_due', 'requisition_requested', 'possible_absences', 'loan_form_signed')
$$;

notify pgrst, 'reload schema';
