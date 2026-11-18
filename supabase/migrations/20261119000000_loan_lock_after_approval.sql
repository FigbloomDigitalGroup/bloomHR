-- Once a loan is approved, its agreement can't be changed by anyone, HR and administrators included:
--
--   * the terms and the applicant's entries: amount, term, rate, how interest is charged, loan type, purpose, residential
--     address, other loan repayments and the account to be paid into (employee_loans_lock_terms). The first repayment
--     month may still move (paying out after its payroll ran, 20261118300000): the amounts don't change;
--   * the corrections to the form's details (loan_form_set_values: until approval only);
--   * signatures given: the borrower doesn't sign again, and a guarantor or witness who has signed isn't replaced.
-- Signatures still missing are given after approval as before, a paper copy is uploaded, and HR accepts it. When HR
-- sends the form back to be fixed, the signatures and corrections may change again (the terms stay as approved).
-- Safe to run again.

create or replace function public.employee_loans_lock_terms() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status <> 'requested'
     and (new.principal, new.months, new.annual_rate, new.interest_method, new.product_id, new.reason,
          new.residential_address, new.other_loan_repayments, new.disbursement_account)
         is distinct from
         (old.principal, old.months, old.annual_rate, old.interest_method, old.product_id, old.reason,
          old.residential_address, old.other_loan_repayments, old.disbursement_account) then
    raise exception 'The loan is %: its agreement can''t be changed', old.status using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists employee_loans_lock_terms on public.employee_loans;
create trigger employee_loans_lock_terms before update on public.employee_loans
  for each row execute function public.employee_loans_lock_terms();

-- (20261118400000's: corrections until approval only)
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
  if l.status <> 'requested'
     and not exists (select 1 from public.employee_loan_forms f where f.loan_id = p_loan and f.status = 'sent_back') then
    raise exception 'The loan is approved: its agreement can''t be changed' using errcode = '22023';
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

-- (20261118600000's: no signing again once approved)
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
  if l.status not in ('requested', 'approved') then
    raise exception 'The form can be signed until the loan is paid out' using errcode = '22023';
  end if;
  if f.status = 'accepted' then
    raise exception 'HR has already accepted your signed form' using errcode = '22023';
  end if;
  if f.borrower_signature is not null and l.status <> 'requested' and f.status <> 'sent_back' then
    raise exception 'The loan is approved: you have signed it, and your signature can''t be changed' using errcode = '22023';
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

-- (20261118600000's: a guarantor who signed stays once approved)
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
  if g.status = 'signed' and l.status <> 'requested'
     and not exists (select 1 from public.employee_loan_forms f where f.loan_id = p_loan and f.status = 'sent_back') then
    raise exception 'The loan is approved and its guarantor has signed: they can''t be changed' using errcode = '22023';
  end if;
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
  -- their details from their employee record, on the form straight away (signing copies them again, fresh)
  update public.employee_loan_guarantors
  set id_number = nullif(btrim(coalesce(e."ID Number"::text, '')), ''),
      kra_pin = nullif(btrim(coalesce(e."Tax PIN"::text, '')), ''),
      date_of_birth = nullif(btrim(coalesce(e."Date of Birth"::text, '')), ''),
      mobile = nullif(btrim(coalesce(e."Mobile Number"::text, '')), ''),
      email = nullif(btrim(coalesce(e."Work Email"::text, '')), ''),
      town = nullif(btrim(coalesce(e."Town"::text, '')), ''),
      residential_address = nullif(btrim(coalesce(e."Postal Address"::text, '')), '')
  where loan_id = l.id
  returning * into g;
  perform public.notify_employee_number(l.tenant_id, e."Employee Number", 'loan_guarantor_asked', 'Guarantee a loan?',
    public.employee_display_name(l.tenant_id, l.employee_number) || ' asked you to guarantee their loan of '
    || public.kes(l.principal) || ' over ' || l.months || ' months. Open Loans in the staff portal to read the form and sign or decline.');
  return g;
end $$;

-- (20261118400000's: a witness who signed stays once approved)
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
  if l.status <> 'requested'
     and exists (select 1 from public.employee_loan_forms f
                 where f.loan_id = p_loan and f.witness_signature is not null and f.status <> 'sent_back') then
    raise exception 'The loan is approved and its witness has signed: they can''t be changed' using errcode = '22023';
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

-- (20261118400000's: likewise for a witness not on staff)
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
  if f.witness_signature is not null and l.status <> 'requested' and f.status <> 'sent_back' then
    raise exception 'The loan is approved and its witness has signed: they can''t be changed' using errcode = '22023';
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

notify pgrst, 'reload schema';
