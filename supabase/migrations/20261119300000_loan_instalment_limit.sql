-- What a loan's monthly repayment may be, from the employee's pay. The stricter of two rules decides:
--
--   1. a share of basic salary   loan_settings.max_instalment_divisor, e.g. 3: the repayment at most a third of the
--                                basic salary. With interest off up front the repayment is the loan over its months,
--                                so a 3-month loan is up to the basic salary and a 6-month one up to twice it.
--   2. take-home pay left        loan_settings.min_take_home_divisor, e.g. 3: after the repayment and the other loans
--                                the borrower repays outside payroll, net pay must still be at least the basic salary
--                                divided by it (a third: the Employment Act's minimum take-home pay). Net pay already
--                                has the statutory deductions off.
-- Empty settings (the default): no such limit. The fixed amount and the multiple of basic salary still apply too.
--
--   Net pay (loan_net_pay): the latest payslip's while its basic pay is the record's; otherwise the corrected net pay on
--   the loan's form (Correct details), otherwise what the borrower gave when applying (employee_loans.stated_net_pay).
--
--   employee_loans_within_pay   (trigger, after the rate is set: employee_loans_term_rate)
--     * a staff request above either rule is refused, naming the most they can borrow over that term;
--     * approving a loan checks rule 2 again, for whoever approves (it is the law): net pay must be known, and cover it.
--   HR setting up a loan isn't held to rule 1, as for the other limits; rule 2 holds when it is approved.
-- Safe to run again.

alter table public.loan_settings
  add column if not exists max_instalment_divisor numeric check (max_instalment_divisor is null or max_instalment_divisor > 0),
  add column if not exists min_take_home_divisor numeric check (min_take_home_divisor is null or min_take_home_divisor > 0);

alter table public.employee_loans
  add column if not exists stated_net_pay numeric check (stated_net_pay is null or stated_net_pay >= 0);

-- the most that can be borrowed over p_months so that each instalment is at most p_cap (the same sums as loan_schedule)
create or replace function public.loan_most_for_instalment(p_cap numeric, p_rate numeric, p_months integer, p_method text)
returns numeric
language plpgsql immutable set search_path = public as $$
declare
  n integer := greatest(coalesce(p_months, 1), 1);
  r numeric := coalesce(p_rate, 0);
begin
  if p_cap is null or p_cap <= 0 then
    return 0;
  end if;
  if p_method = 'upfront' or r = 0 then
    return floor(p_cap * n);
  elsif p_method = 'flat' then
    return floor(p_cap / (1.0 / n + r / 1200));
  else
    return floor(p_cap * (1 - power(1 + r / 1200, -n)) / (r / 1200));
  end if;
end $$;
grant execute on function public.loan_most_for_instalment(numeric, numeric, integer, text) to authenticated;

-- the employee's basic salary on their record
create or replace function public.loan_basic_salary(p_tenant uuid, p_employee text) returns numeric
language sql stable security definer set search_path = public as $$
  select nullif(regexp_replace(coalesce("Basic Salary"::text, ''), '[^0-9.]', '', 'g'), '')::numeric
  from public.employees where tenant_id = p_tenant and "Employee Number" = p_employee
$$;
revoke all on function public.loan_basic_salary(uuid, text) from public, anon, authenticated;

-- net pay for the loan: the current payslip's, else the form's correction, else what the borrower gave (null: unknown)
create or replace function public.loan_net_pay(p_tenant uuid, p_employee text, p_loan uuid, p_stated numeric) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v_basic numeric := public.loan_basic_salary(p_tenant, p_employee);
  h record;
  v_corrected text;
begin
  select sh.net_pay, sh.basic_salary into h from public.salary_history sh
  where sh.tenant_id = p_tenant and sh.employee_id = p_employee order by sh.pay_period desc limit 1;
  if h.net_pay is not null and (v_basic is null or round(coalesce(h.basic_salary, 0)) = round(v_basic)) then
    return h.net_pay;
  end if;
  select v."values" ->> 'net_salary' into v_corrected from public.employee_loan_form_values v where v.loan_id = p_loan;
  if v_corrected ~ '^[0-9]+(\.[0-9]+)?$' then
    return v_corrected::numeric;
  end if;
  return p_stated;
end $$;
revoke all on function public.loan_net_pay(uuid, text, uuid, numeric) from public, anon, authenticated;

-- The signed-in employee's pay for applying: basic salary, and net pay when their latest payslip is current.
create or replace function public.loan_my_pay() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_me text := public.current_employee_number();
begin
  if v_me is null then
    return null;
  end if;
  return jsonb_build_object(
    'basic', public.loan_basic_salary(v_tenant, v_me),
    'net', public.loan_net_pay(v_tenant, v_me, null, null));
end $$;
revoke all on function public.loan_my_pay() from public, anon;
grant execute on function public.loan_my_pay() to authenticated;

create or replace function public.employee_loans_within_pay() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s public.loan_settings;
  v_basic numeric;
  v_net numeric;
  v_room numeric;
  v_cap numeric;
  v_staff_request boolean;
  v_approving boolean;
  v_rule text;
begin
  select * into s from public.loan_settings where tenant_id = new.tenant_id;
  if s.max_instalment_divisor is null and s.min_take_home_divisor is null then
    return new;
  end if;
  v_staff_request := new.status = 'requested' and not public.manages_loans()
    and (tg_op = 'INSERT' or (new.principal, new.months, new.annual_rate, new.interest_method, new.stated_net_pay, new.other_loan_repayments)
         is distinct from (old.principal, old.months, old.annual_rate, old.interest_method, old.stated_net_pay, old.other_loan_repayments));
  v_approving := new.status = 'approved' and (tg_op = 'INSERT' or old.status = 'requested');
  if not (v_staff_request or v_approving) then
    return new;
  end if;
  v_basic := coalesce(public.loan_basic_salary(new.tenant_id, new.employee_number), 0);

  -- 1. a share of basic salary (staff requests)
  if v_staff_request and s.max_instalment_divisor is not null then
    v_cap := v_basic / s.max_instalment_divisor;
    v_rule := 'your basic salary divided by ' || trim(to_char(s.max_instalment_divisor, 'FM999990.##'));
  end if;

  -- 2. take-home pay left after the repayment and other loans
  if s.min_take_home_divisor is not null then
    v_net := public.loan_net_pay(new.tenant_id, new.employee_number, new.id, new.stated_net_pay);
    if v_net is null then
      if v_approving then
        raise exception 'Confirm the borrower''s current net pay (Correct details on the loan form) before approving: the repayment must leave them at least % take-home',
          public.kes(v_basic / s.min_take_home_divisor) using errcode = '23514';
      end if;
      raise exception 'Give your current net monthly pay, so we can check you can afford the repayment' using errcode = '23514';
    end if;
    v_room := v_net - coalesce(new.other_loan_repayments, 0) - v_basic / s.min_take_home_divisor;
    if v_cap is null or v_room < v_cap then
      v_cap := greatest(v_room, 0);
      v_rule := 'what your net pay of ' || public.kes(v_net) || ' leaves after other loans and the minimum take-home of '
                || public.kes(v_basic / s.min_take_home_divisor);
    end if;
  end if;

  -- a shilling of rounding in the instalment is allowed
  if v_cap is not null and coalesce(new.monthly_instalment, 0) > v_cap + 1 then
    if v_approving and not v_staff_request then
      raise exception 'The repayment of % a month would leave % less than the minimum take-home pay: % is the most it can be',
        public.kes(new.monthly_instalment), case when new.employee_number = public.current_employee_number() then 'you' else 'the borrower' end,
        public.kes(floor(v_cap)) using errcode = '23514';
    end if;
    raise exception 'Your monthly repayment can be at most % (%): over % months you can borrow up to %',
      public.kes(floor(v_cap)), v_rule, new.months,
      public.kes(public.loan_most_for_instalment(v_cap, new.annual_rate, new.months, new.interest_method))
      using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists employee_loans_within_pay on public.employee_loans;
create trigger employee_loans_within_pay before insert or update on public.employee_loans
  for each row execute function public.employee_loans_within_pay();

notify pgrst, 'reload schema';
