-- A limit on what staff borrow by what they repay each month: the monthly repayment at most the basic salary divided by
-- a number (3: a third of basic salary). With interest taken off up front the repayment is the loan over its months,
-- so a 3-month loan is up to the basic salary and a 6-month one up to twice it.
--
--   loan_settings.max_instalment_divisor   e.g. 3; empty (the default): no such limit. The other limits (a fixed
--                                          amount, a multiple of basic salary) still apply: the lowest wins.
--   employee_loans_within_pay              (trigger, after the rate is set: employee_loans_term_rate) a staff request
--                                          whose monthly repayment is above it is refused, naming the most they can
--                                          borrow over that term. HR setting up a loan isn't held to it, as for the
--                                          other limits.
-- Safe to run again.

alter table public.loan_settings
  add column if not exists max_instalment_divisor numeric check (max_instalment_divisor is null or max_instalment_divisor > 0);

create or replace function public.employee_loans_within_pay() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_divisor numeric;
  v_basic numeric;
  v_cap numeric;
  v_most numeric;
begin
  if new.status <> 'requested' or public.manages_loans() then
    return new;
  end if;
  if tg_op = 'UPDATE' and (new.principal, new.months, new.annual_rate, new.interest_method)
     is not distinct from (old.principal, old.months, old.annual_rate, old.interest_method) then
    return new;
  end if;
  select s.max_instalment_divisor into v_divisor from public.loan_settings s where s.tenant_id = new.tenant_id;
  if v_divisor is null then
    return new;
  end if;
  select nullif(regexp_replace(coalesce("Basic Salary"::text, ''), '[^0-9.]', '', 'g'), '')::numeric into v_basic
  from public.employees where tenant_id = new.tenant_id and "Employee Number" = new.employee_number;
  v_cap := coalesce(v_basic, 0) / v_divisor;
  -- a shilling of rounding in the instalment is allowed
  if coalesce(new.monthly_instalment, 0) > v_cap + 1 then
    v_most := public.loan_most_for_instalment(v_cap, new.annual_rate, new.months, new.interest_method);
    raise exception 'Your monthly repayment can be at most % (your basic salary divided by %): over % months you can borrow up to %',
      public.kes(floor(v_cap)), trim(to_char(v_divisor, 'FM999990.##')), new.months, public.kes(v_most)
      using errcode = '23514';
  end if;
  return new;
end $$;

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

drop trigger if exists employee_loans_within_pay on public.employee_loans;
create trigger employee_loans_within_pay before insert or update on public.employee_loans
  for each row execute function public.employee_loans_within_pay();

notify pgrst, 'reload schema';
