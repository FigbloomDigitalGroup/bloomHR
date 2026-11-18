-- The loan form, as the people on it need it (20261118100000 to 20261118500000's form):
--
--   * Signed online from the request on: the form exists as soon as a loan is asked for, and the borrower, the
--     witness and the guarantor sign straight away (before, only once approved). Uploading a paper copy, HR's review
--     and payout still wait for approval. Loans waiting for approval get their form now.
--   * The guarantor's details (ID, KRA PIN, date of birth, phone, email, town, address) fill in from their employee
--     record as soon as they are asked; they add only their relationship to the borrower and another phone number.
--   * loan_form_borrower(): the borrower's details for the form, read by the database for whoever may see the loan:
--       employment type   HR Lifecycle's (hr_employment_status: confirmed after probation is Permanent), else the
--                         record's "Employee Type";
--       pay               the latest payslip's gross and net while its basic pay is the record's; once the record's
--                         basic salary has changed (a raise after probation), the record's basic salary as gross and
--                         no net (net includes per diem and other benefits only a payslip has: the borrower corrects
--                         it), and pay_changed says so.
-- Safe to run again.

-- ---------------------------------------------------------------------------------------------
-- 1. signed online from the request on
-- ---------------------------------------------------------------------------------------------
create or replace function public.employee_loan_form_open() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_required boolean;
begin
  if new.status not in ('requested', 'approved') or (tg_op = 'UPDATE' and old.status is not distinct from new.status) then
    return null;
  end if;
  select coalesce((select s.require_signed_form from public.loan_settings s where s.tenant_id = new.tenant_id), true)
  into v_required;
  insert into public.employee_loan_forms (loan_id, tenant_id, required)
  values (new.id, new.tenant_id, v_required)
  on conflict (loan_id) do nothing;
  -- told to sign once approved, unless they already have
  if v_required and new.status = 'approved'
     and not exists (select 1 from public.employee_loan_forms f where f.loan_id = new.id and f.borrower_signature is not null) then
    perform public.notify_employee_number(new.tenant_id, new.employee_number, 'loan_form_to_sign', 'Sign your loan form',
      'Your ' || lower(coalesce(new.product_name, 'loan')) || ' of ' || public.kes(new.principal)
      || ' is approved. Open Loans in the staff portal to sign the loan form and upload the signed copy. It is paid out once HR accepts it.');
  end if;
  return null;
end $$;

-- loans waiting for approval get their form now
insert into public.employee_loan_forms (loan_id, tenant_id, required)
select l.id, l.tenant_id, coalesce((select s.require_signed_form from public.loan_settings s where s.tenant_id = l.tenant_id), true)
from public.employee_loans l
where l.status = 'requested'
on conflict (loan_id) do nothing;

-- (20261118200000's, from the request on)
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

-- (20261118400000's, from the request on)
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
  if l.status not in ('requested', 'approved') or f.loan_id is null then
    raise exception 'This loan is no longer waiting for its form to be signed' using errcode = '22023';
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

-- ---------------------------------------------------------------------------------------------
-- 2. the guarantor's details from their record
-- ---------------------------------------------------------------------------------------------
-- (20261118200000's, filling in their details when asked)
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

-- (20261118200000's, keeping the address from their record unless they give another)
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
      residential_address = coalesce(left(nullif(btrim(coalesce(p_address, '')), ''), 300), residential_address),
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

-- guarantors asked already, not yet signed: their details now
update public.employee_loan_guarantors g
set id_number = coalesce(g.id_number, nullif(btrim(coalesce(e."ID Number"::text, '')), '')),
    kra_pin = coalesce(g.kra_pin, nullif(btrim(coalesce(e."Tax PIN"::text, '')), '')),
    date_of_birth = coalesce(g.date_of_birth, nullif(btrim(coalesce(e."Date of Birth"::text, '')), '')),
    mobile = coalesce(g.mobile, nullif(btrim(coalesce(e."Mobile Number"::text, '')), '')),
    email = coalesce(g.email, nullif(btrim(coalesce(e."Work Email"::text, '')), '')),
    town = coalesce(g.town, nullif(btrim(coalesce(e."Town"::text, '')), '')),
    residential_address = coalesce(g.residential_address, nullif(btrim(coalesce(e."Postal Address"::text, '')), ''))
from public.employees e
where e.tenant_id = g.tenant_id and e."Employee Number" = g.employee_number and g.status = 'asked';

-- ---------------------------------------------------------------------------------------------
-- 3. the borrower's details for the form
-- ---------------------------------------------------------------------------------------------
create or replace function public.loan_form_borrower(p_loan uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l public.employee_loans;
  e public.employees;
  s public.hr_employment_status;
  h record;
  v_basic numeric;
  v_type text;
  v_changed boolean := false;
  v_gross numeric;
  v_net numeric;
begin
  select * into l from public.employee_loans where id = p_loan and tenant_id = public.current_tenant_id();
  if l.id is null or not (public.reads_loan_forms() or l.employee_number = public.current_employee_number()) then
    raise exception 'Loan not found' using errcode = 'P0002';
  end if;
  select * into e from public.employees where tenant_id = l.tenant_id and "Employee Number" = l.employee_number;
  select * into s from public.hr_employment_status where tenant_id = l.tenant_id and "Employee Number" = l.employee_number
  order by updated_at desc nulls last, id desc limit 1;
  v_type := case
    when s.employment_type = 'Probation' and coalesce(s.is_confirmed, false) then 'Permanent'
    else coalesce(nullif(btrim(coalesce(s.employment_type, '')), ''), nullif(btrim(coalesce(e."Employee Type", '')), ''))
  end;
  v_basic := nullif(regexp_replace(coalesce(e."Basic Salary"::text, ''), '[^0-9.]', '', 'g'), '')::numeric;
  select sh.gross_pay, sh.net_pay, sh.basic_salary, sh.pay_period into h
  from public.salary_history sh
  where sh.tenant_id = l.tenant_id and sh.employee_id = l.employee_number
  order by sh.pay_period desc limit 1;
  if h.pay_period is not null and (v_basic is null or round(coalesce(h.basic_salary, 0)) = round(v_basic)) then
    v_gross := h.gross_pay;
    v_net := h.net_pay;
  else
    v_changed := h.pay_period is not null;
    v_gross := v_basic;
    v_net := null;
  end if;
  return jsonb_build_object(
    'employee', to_jsonb(e) - 'Basic Salary',
    'employment_type', v_type,
    'contract_end_date', coalesce(s.contract_end_date::text, nullif(btrim(coalesce(e."Contract End Date", '')), '')),
    'gross', v_gross,
    'net', v_net,
    'pay_period', h.pay_period,
    'pay_changed', v_changed,
    'basic_salary', v_basic
  );
end $$;
revoke all on function public.loan_form_borrower(uuid) from public, anon;
grant execute on function public.loan_form_borrower(uuid) to authenticated;

notify pgrst, 'reload schema';
