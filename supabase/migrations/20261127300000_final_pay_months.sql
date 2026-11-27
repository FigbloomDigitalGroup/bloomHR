-- Payroll knows when a leaver's final pay was made.
--
-- An exit's final dues (employee_exit_final_dues, 20261016400000) are "included in payroll month X" by HR when the
-- leaver's final pay goes out. Payroll did not read it, so someone paid off in October whose last working day was in
-- November was still on November's payroll. The final dues themselves are HR's only (they show what the leaver is owed),
-- so payroll gets just the month: final_pay_months() lists, for the signed-in user's company, each leaver whose final
-- dues are included in a month, and that month. The payroll page leaves them out of every later month.
--
-- Read by anyone who works on payroll or looks after exits; nothing about the amounts.

create or replace function public.final_pay_months()
returns table (employee_number text, payroll_period text)
language sql stable security definer set search_path = public as $$
  select d.employee_number, min(d.payroll_period)
  from public.employee_exit_final_dues d
  where d.tenant_id = public.current_tenant_id()
    and d.status = 'included'
    and public.has_any_module('payroll', 'employees', 'hr-lifecycle')
  group by d.employee_number
$$;
revoke all on function public.final_pay_months() from public, anon;
grant execute on function public.final_pay_months() to authenticated;

notify pgrst, 'reload schema';
