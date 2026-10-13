-- The P9 (the employee's yearly tax deduction card, FIG-773):
--   * the employer's KRA PIN, which it shows: payroll keeps it with the company's payroll settings, and every member of
--     the company can read the company's name and PIN (and nothing else from those settings) with company_tax_details();
--   * p9_payslips(employee, year): the employee's payslips in approved or paid payroll months of that year, for the
--     employee themselves or for people who read payslips (payroll, HR lifecycle); staff can't list payroll runs.

alter table public.company_payroll_settings
  add column if not exists employer_kra_pin text check (employer_kra_pin is null or employer_kra_pin ~ '^[AP]\d{9}[A-Z]$');

-- the company's name (as on its letterhead, else its account name) and its employer KRA PIN
create or replace function public.company_tax_details()
returns table (company_name text, employer_kra_pin text)
language sql stable security definer set search_path = public as $$
  select coalesce(
           (select l.company_name from public.company_logo l
            where l.tenant_id = public.current_tenant_id() and coalesce(btrim(l.company_name), '') <> ''
            order by l.created_at desc limit 1),
           (select t.name from public.tenants t where t.id = public.current_tenant_id())
         ),
         (select s.employer_kra_pin from public.company_payroll_settings s where s.tenant_id = public.current_tenant_id())
$$;
revoke all on function public.company_tax_details() from public, anon;
grant execute on function public.company_tax_details() to authenticated;

create or replace function public.p9_payslips(p_employee uuid, p_year integer)
returns setof public.salary_history
language plpgsql stable security definer set search_path = public as $$
declare
  e public.employees;
begin
  select * into e from public.employees where id = p_employee and tenant_id = public.current_tenant_id();
  if e.id is null then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
  if not (public.is_own_employee(e.id) or public.has_any_module('payroll', 'hr-lifecycle')) then
    raise exception 'You can only see your own P9' using errcode = '42501';
  end if;
  return query
  select h.* from public.salary_history h join public.payroll_runs r on r.id = h.run_id
  where h.tenant_id = e.tenant_id and h.employee_id = e."Employee Number"
    and r.status in ('approved', 'paid') and h.pay_period like p_year::text || '-%'
  order by h.pay_period;
end $$;
revoke all on function public.p9_payslips(uuid, integer) from public, anon;
grant execute on function public.p9_payslips(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
