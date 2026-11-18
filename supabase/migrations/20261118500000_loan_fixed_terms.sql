-- Fixed loan terms, each with its own rate: e.g. 3 months at 20% and 6 months at 25%, interest taken off up front.
--
--   loan_settings.term_rates   [{"months": 3, "rate": 20}, {"months": 6, "rate": 25}]; empty (the default) leaves loans as
--                              before: any term between the shortest and longest, at the company's or the loan type's rate.
--   employee_loans_term_rate   (trigger, after employee_loans_guard) with fixed terms set, a loan asked for, set up or
--                              approved must be on one of them, and gets that term's rate whoever enters it (staff,
--                              HR, the approval that copies the current rate). The instalment and totals follow. A loan
--                              paid out keeps its terms.
-- Safe to run again.

create or replace function public.valid_term_rates(p jsonb) returns boolean
language sql immutable set search_path = public as $$
  select jsonb_typeof(p) = 'array'
    and not exists (
      select 1 from jsonb_array_elements(p) e
      where jsonb_typeof(e) is distinct from 'object'
         or jsonb_typeof(e -> 'months') is distinct from 'number' or jsonb_typeof(e -> 'rate') is distinct from 'number'
         or not coalesce((e ->> 'months')::numeric = floor((e ->> 'months')::numeric)
                         and (e ->> 'months')::numeric between 1 and 120
                         and (e ->> 'rate')::numeric between 0 and 100, false))
    and (select count(*) from jsonb_array_elements(p)) = (select count(distinct e ->> 'months') from jsonb_array_elements(p) e)
$$;

alter table public.loan_settings add column if not exists term_rates jsonb not null default '[]'::jsonb;
alter table public.loan_settings drop constraint if exists loan_settings_term_rates_check;
alter table public.loan_settings add constraint loan_settings_term_rates_check check (public.valid_term_rates(term_rates));

create or replace function public.employee_loans_term_rate() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_terms jsonb;
  v_rate numeric;
  v_list text;
begin
  if new.status not in ('requested', 'approved') then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and (new.months, new.principal, new.annual_rate, new.interest_method, new.status, new.start_period)
         is not distinct from (old.months, old.principal, old.annual_rate, old.interest_method, old.status, old.start_period) then
    return new;
  end if;
  select s.term_rates into v_terms from public.loan_settings s where s.tenant_id = new.tenant_id;
  if v_terms is null or jsonb_array_length(v_terms) = 0 then
    return new;
  end if;
  select (e ->> 'rate')::numeric into v_rate from jsonb_array_elements(v_terms) e where (e ->> 'months')::int = new.months;
  if v_rate is null then
    select string_agg(e ->> 'months', ' or ' order by (e ->> 'months')::int) into v_list from jsonb_array_elements(v_terms) e;
    raise exception 'Loans are for % months', v_list using errcode = '23514';
  end if;
  if new.annual_rate is distinct from v_rate then
    new.annual_rate := v_rate;
    select sch.payment into new.monthly_instalment
    from public.loan_schedule(new.principal, new.annual_rate, new.interest_method, new.months, new.start_period) sch
    where sch.instalment_no = 1;
    select sum(sch.interest), sum(sch.payment) into new.total_interest, new.total_repayable
    from public.loan_schedule(new.principal, new.annual_rate, new.interest_method, new.months, new.start_period) sch;
  end if;
  return new;
end $$;
drop trigger if exists employee_loans_term_rate on public.employee_loans;
create trigger employee_loans_term_rate before insert or update on public.employee_loans
  for each row execute function public.employee_loans_term_rate();

notify pgrst, 'reload schema';
