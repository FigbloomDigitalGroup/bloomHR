-- The guarantor reads the whole loan form, as the borrower does (20261118600000's form):
--
--   * loan_form_for_guarantor() also returns the form as it stands (the borrower's, witness's and approver's
--     signatures and their dates) and the witness.
--   * loan_form_borrower() is also for the loan's guarantor and witness, and returns the borrower's corrections for the
--     loan, so the guarantor sees the borrower's details as the form shows them.
-- (Before, the guarantor saw the loan's terms only.) Safe to run again.

-- the signed-in employee guarantees or witnesses the loan
create or replace function public.signs_loan_form(p_loan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.employee_loan_guarantors g
                 where g.loan_id = p_loan and g.employee_number = public.current_employee_number())
      or exists (select 1 from public.employee_loan_witnesses w
                 where w.loan_id = p_loan and w.employee_number = public.current_employee_number())
$$;
revoke all on function public.signs_loan_form(uuid) from public, anon;
grant execute on function public.signs_loan_form(uuid) to authenticated;

-- (20261118600000's, also for the guarantor and witness, with the corrections)
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
  if l.id is null or not (public.reads_loan_forms() or l.employee_number = public.current_employee_number()
                          or public.signs_loan_form(l.id)) then
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
    'basic_salary', v_basic,
    -- the borrower's corrections for this loan (employee_loan_form_values), for those who can't read them directly
    'corrections', coalesce((select v."values" from public.employee_loan_form_values v where v.loan_id = l.id), '{}'::jsonb)
  );
end $$;

-- (20261118200000's, with the form and the witness)
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
      'disbursed_at', l.disbursed_at, 'created_at', l.created_at, 'disbursement_account', l.disbursement_account,
      'residential_address', l.residential_address, 'other_loan_repayments', l.other_loan_repayments),
    'borrower_name', public.employee_display_name(l.tenant_id, l.employee_number),
    'schedule', coalesce((select jsonb_agg(jsonb_build_object('instalment_no', i.instalment_no, 'period', i.period, 'payment', i.payment,
                                                             'principal', i.principal, 'interest', i.interest, 'balance', i.balance) order by i.instalment_no)
                          from public.employee_loan_instalments i where i.loan_id = l.id), '[]'::jsonb),
    'guarantor', to_jsonb(g),
    -- the form as it stands: the borrower's, witness's and approver's signatures and their dates
    'form', (select to_jsonb(f) from public.employee_loan_forms f where f.loan_id = l.id),
    'witness', (select to_jsonb(w) from public.employee_loan_witnesses w where w.loan_id = l.id),
    'employer', (select c.company_name from public.company_profile c where c.tenant_id = l.tenant_id)
  );
end $$;

notify pgrst, 'reload schema';
