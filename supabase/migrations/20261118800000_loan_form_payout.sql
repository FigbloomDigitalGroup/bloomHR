-- What finance records when paying a loan out (the date and transaction reference) shows on the loan form for everyone
-- who reads it: the borrower, guarantor and witness too, who can't read payments themselves. loan_form_borrower()
-- (20261118700000's) returns it. Safe to run again.

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
    'corrections', coalesce((select v."values" from public.employee_loan_form_values v where v.loan_id = l.id), '{}'::jsonb),
    -- what finance recorded when paying it out, for everyone who reads the form (staff can't read payments)
    'payout', (select jsonb_build_object('reference', r.payment_reference, 'paid_on', r.paid_on)
               from public.payment_requests r where r.source = 'loan' and r.source_id = l.id and r.status = 'paid' limit 1)
  );
end $$;

notify pgrst, 'reload schema';
