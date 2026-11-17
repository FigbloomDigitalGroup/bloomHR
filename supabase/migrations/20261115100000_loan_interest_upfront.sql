-- Loans with the interest taken off up front ('upfront'), next to reducing balance and flat.
--
--   The rate is charged once per loan, whatever the term, and taken off what is paid out. The loan amount (principal)
--   is what the employee repays, in equal parts; they receive the principal less rate% of it. At 20%, a KSh 100,000
--   loan over 3 months pays out 80,000, books 20,000 interest, and payroll takes 33,333, 33,333 and 33,334.
--
--   In the schedule, each instalment's principal is its share of the money paid out (on the running total, so the
--   parts add up exactly) and the rest is interest; the balance is what is still to be repaid of the loan amount.
--   The same sums as src/lib/loans.ts loanSchedule.
--
-- What is paid out is total_repayable - total_interest for every method (the principal for the other two), so
-- finance's "to pay" list and the employee's messages use that instead of the principal.

-- ---------------------------------------------------------------------------------------------
-- 1. the new method
-- ---------------------------------------------------------------------------------------------
alter table public.loan_settings drop constraint if exists loan_settings_interest_method_check;
alter table public.loan_settings add constraint loan_settings_interest_method_check
  check (interest_method in ('reducing_balance', 'flat', 'upfront'));
alter table public.loan_products drop constraint if exists loan_products_interest_method_check;
alter table public.loan_products add constraint loan_products_interest_method_check
  check (interest_method in ('reducing_balance', 'flat', 'upfront'));
alter table public.employee_loans drop constraint if exists employee_loans_interest_method_check;
alter table public.employee_loans add constraint employee_loans_interest_method_check
  check (interest_method in ('reducing_balance', 'flat', 'upfront'));

-- ---------------------------------------------------------------------------------------------
-- 2. the schedule (20261016700000's, with the upfront branch)
-- ---------------------------------------------------------------------------------------------
create or replace function public.loan_schedule(p_principal numeric, p_annual_rate numeric, p_method text, p_months integer, p_start text)
returns table (instalment_no integer, period text, payment numeric, principal numeric, interest numeric, balance numeric)
language plpgsql immutable set search_path = public as $$
declare
  n integer := greatest(coalesce(p_months, 1), 1);
  rate numeric := coalesce(p_annual_rate, 0);
  bal numeric := p_principal;
  a numeric;
  part_principal numeric;
  part_interest numeric;
  total_interest numeric;
  paid_out numeric;
  pay numeric;
  paid numeric := 0;
  up_to numeric;
  so_far numeric := 0;
  i integer;
  first_month date := to_date(p_start || '-01', 'YYYY-MM-DD');
begin
  if p_principal is null or p_principal <= 0 or p_start is null then
    return;
  end if;
  if p_method = 'flat' then
    total_interest := round(p_principal * rate * n / 1200);
    for i in 1..n loop
      if i = n then
        part_principal := bal;
        part_interest := total_interest - round(total_interest / n) * (n - 1);
      else
        part_principal := round(p_principal / n);
        part_interest := round(total_interest / n);
      end if;
      bal := bal - part_principal;
      return query select i, to_char(first_month + make_interval(months => i - 1), 'YYYY-MM'),
        part_principal + part_interest, part_principal, part_interest, bal;
    end loop;
  elsif p_method = 'upfront' then
    paid_out := round(p_principal - p_principal * rate / 100);
    a := round(p_principal / n);
    for i in 1..n loop
      pay := case when i = n then bal else a end;
      paid := paid + pay;
      up_to := case when i = n then paid_out else round(paid * paid_out / p_principal) end;
      part_principal := up_to - so_far;
      so_far := up_to;
      bal := bal - pay;
      return query select i, to_char(first_month + make_interval(months => i - 1), 'YYYY-MM'),
        pay, part_principal, pay - part_principal, bal;
    end loop;
  else
    if rate = 0 then
      a := round(p_principal / n);
    else
      a := round(p_principal * (rate / 1200) / (1 - power(1 + rate / 1200, -n)));
    end if;
    for i in 1..n loop
      part_interest := round(bal * rate / 1200);
      part_principal := case when i = n then bal else greatest(least(a - part_interest, bal), 0) end;
      bal := bal - part_principal;
      return query select i, to_char(first_month + make_interval(months => i - 1), 'YYYY-MM'),
        part_principal + part_interest, part_principal, part_interest, bal;
    end loop;
  end if;
end $$;
grant execute on function public.loan_schedule(numeric, numeric, text, integer, text) to authenticated;

-- what is paid out to the employee: the amount, less the interest when it is taken off up front
create or replace function public.loan_paid_out(l public.employee_loans) returns numeric
language sql immutable set search_path = public as $$
  select case when l.interest_method = 'upfront' then l.principal - coalesce(l.total_interest, 0) else l.principal end
$$;
grant execute on function public.loan_paid_out(public.employee_loans) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. finance pays out the net amount (20261025400000's, with loan_paid_out)
-- ---------------------------------------------------------------------------------------------
create or replace function public.employee_loan_payment_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  if new.status = 'approved' then
    perform public.payment_request_open(new.tenant_id, 'loan', new.id, new.employee_number,
      public.employee_display_name(new.tenant_id, new.employee_number), null, public.loan_paid_out(new),
      coalesce(new.product_name, 'Loan') || ' over ' || new.months || ' months'
      || case when new.interest_method = 'upfront'
           then ' (' || public.kes(new.principal) || ' less ' || public.kes(coalesce(new.total_interest, 0)) || ' interest)'
           else '' end
      || coalesce(': ' || nullif(btrim(new.reason), ''), ''));
  elsif new.status = 'disbursed' and tg_op = 'UPDATE' and old.status = 'approved' then
    perform public.payment_request_paid_elsewhere('loan', new.id);
  elsif new.status in ('rejected', 'cancelled', 'requested') then
    perform public.payment_request_close('loan', new.id);
  end if;
  return null;
end $$;

-- anything already waiting to be paid
update public.payment_requests r
set amount = public.loan_paid_out(l), updated_at = now()
from public.employee_loans l
where r.source = 'loan' and r.source_id = l.id and r.status = 'to_pay' and r.amount is distinct from public.loan_paid_out(l);

-- ---------------------------------------------------------------------------------------------
-- 4. the employee's messages say what they receive (20261025700000's)
-- ---------------------------------------------------------------------------------------------
create or replace function public.employee_loans_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  what text;
  month_name text := to_char(to_date(new.start_period || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY');
  upfront text := case when new.interest_method = 'upfront'
    then ' You receive ' || public.kes(public.loan_paid_out(new)) || ' (' || public.kes(coalesce(new.total_interest, 0))
         || ' interest is taken off up front).'
    else '' end;
begin
  if tg_op = 'INSERT' or (new.principal, new.annual_rate, new.interest_method, new.months, new.start_period)
     is distinct from (old.principal, old.annual_rate, old.interest_method, old.months, old.start_period) then
    delete from public.employee_loan_instalments where loan_id = new.id;
    insert into public.employee_loan_instalments (tenant_id, loan_id, instalment_no, period, payment, principal, interest, balance)
    select new.tenant_id, new.id, s.instalment_no, s.period, s.payment, s.principal, s.interest, s.balance
    from public.loan_schedule(new.principal, new.annual_rate, new.interest_method, new.months, new.start_period) s;
  end if;

  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  what := coalesce(new.product_name, 'loan');
  if new.status = 'approved' then
    perform public.notify_employee_number(new.tenant_id, new.employee_number, 'loan_approved', 'Loan approved',
      'Your ' || lower(what) || ' of ' || public.kes(new.principal) || ' was approved: ' || public.kes(new.monthly_instalment)
      || ' a month for ' || new.months || ' months from ' || month_name || ' pay.' || upfront
      || public.with_note('Notes', new.decision_comment));
  elsif new.status = 'rejected' then
    perform public.notify_employee_number(new.tenant_id, new.employee_number, 'loan_rejected', 'Loan not approved',
      'Your ' || lower(what) || ' request of ' || public.kes(new.principal) || ' was not approved.'
      || public.with_note('Reason', new.decision_comment));
  elsif new.status = 'disbursed' and tg_op = 'UPDATE' and old.status = 'approved' then
    perform public.notify_employee_number(new.tenant_id, new.employee_number, 'loan_disbursed', 'Loan paid out',
      case when new.interest_method = 'upfront'
        then public.kes(public.loan_paid_out(new)) || ' of your ' || lower(what) || ' of ' || public.kes(new.principal)
             || ' has been paid out (' || public.kes(coalesce(new.total_interest, 0)) || ' interest taken off up front).'
        else 'Your ' || lower(what) || ' of ' || public.kes(new.principal) || ' has been paid out.' end
      || ' Repayments come off your pay from ' || month_name || '.');
  elsif new.status = 'completed' then
    perform public.notify_employee_number(new.tenant_id, new.employee_number, 'loan_repaid', 'Loan repaid',
      'Your ' || lower(what) || ' of ' || public.kes(new.principal) || ' is fully repaid.');
  end if;
  return null;
end $$;

notify pgrst, 'reload schema';
