-- Repaying a loan from this month's pay, while this month's payroll hasn't been approved.
--
--   loan_first_open_period()   the earliest pay month a loan can start in: this month, unless its payroll run (or one
--                              of its countries) is already approved or paid, then the first month after that is still
--                              open. Staff choose this month or next when they apply; HR choose from it on.
--   employee_loans_start_month (trigger, after employee_loans_guard)
--                              * a loan asked for, or a start month changed, before that month is refused: its payroll
--                                is done and would never take the instalment;
--                              * a loan approved or paid out after its start month's payroll ran moves to the first
--                                open month (otherwise payroll would take the missed instalment on top of the next one).
--                                The amounts don't change; the schedule follows the new months.
-- Safe to run again.

create or replace function public.loan_first_open_period(p_tenant uuid default null) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select to_char(m, 'YYYY-MM')
     from generate_series(date_trunc('month', now()), date_trunc('month', now()) + interval '12 months', interval '1 month') m
     where not exists (
       select 1 from public.payroll_runs r
       where r.tenant_id = coalesce(p_tenant, public.current_tenant_id()) and r.pay_period = to_char(m, 'YYYY-MM')
         and (r.status in ('approved', 'paid')
              or exists (select 1 from public.payroll_run_countries c where c.run_id = r.id and c.status in ('approved', 'paid'))))
     order by m
     limit 1),
    to_char(now() + interval '1 month', 'YYYY-MM'))
$$;
revoke all on function public.loan_first_open_period(uuid) from public, anon;
grant execute on function public.loan_first_open_period(uuid) to authenticated;

create or replace function public.employee_loans_start_month() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_open text;
  v_chosen boolean;
  v_moving boolean;
begin
  if new.status not in ('requested', 'approved', 'disbursed') then
    return new;
  end if;
  v_chosen := tg_op = 'INSERT' or new.start_period is distinct from old.start_period;
  v_moving := tg_op = 'UPDATE' and new.status is distinct from old.status;
  if new.status = 'disbursed' and not (v_moving and old.status = 'approved') then
    return new;
  end if;
  if not (v_chosen or v_moving) then
    return new;
  end if;
  v_open := public.loan_first_open_period(new.tenant_id);
  if new.start_period >= v_open then
    return new;
  end if;
  -- a step on (approved, paid out) after the month's payroll ran: start in the first open month (paying out may already
  -- have moved a past month to this one, in employee_loans_guard)
  if v_moving then
    new.start_period := v_open;
    return new;
  end if;
  raise exception 'Repayments can start from % pay at the earliest: % is past or its payroll is already approved',
    to_char(to_date(v_open || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY'),
    to_char(to_date(new.start_period || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY')
    using errcode = '23514';
end $$;
drop trigger if exists employee_loans_start_month on public.employee_loans;
create trigger employee_loans_start_month before insert or update of start_period, status on public.employee_loans
  for each row execute function public.employee_loans_start_month();

notify pgrst, 'reload schema';
