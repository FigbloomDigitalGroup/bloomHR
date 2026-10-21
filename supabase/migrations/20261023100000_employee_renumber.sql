-- Changing a company's employee-number prefix for everyone (MCL-000123 -> FBL-000123), and the records that did not
-- follow a renumber.
--
-- 1. Renumbering an employee already followed through to ~50 tables (foreign keys with on update cascade,
--    propagate_employee_number and the *_follow_renumber triggers). These kept the old number and were left behind:
--    leave_entitlements (a person's own allowance), leave_payouts, leave_document_overdue_notices, lst_years,
--    payroll_payments, payslip_emails, work_injury_cases, company_digest_log; and other employees' "Leave Approver" /
--    "Alternate Approver" when it holds the number. Now they follow.
-- 2. renumber_employees(from, to): an administrator (or Settings) changes the prefix of every employee whose number
--    starts with it, keeping the rest of the number, and the company's prefix for new employees with it. Refused, with
--    nothing changed, when a new number is already someone's.

-- ---------------------------------------------------------------------------------------------
-- 1. the rest follows a renumber
-- ---------------------------------------------------------------------------------------------
create or replace function public.employees_follow_renumber_rest() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  target text;
begin
  foreach target in array array['leave_entitlements', 'leave_payouts', 'leave_document_overdue_notices', 'lst_years',
                                'payroll_payments', 'payslip_emails', 'work_injury_cases', 'company_digest_log'] loop
    -- (a table this database doesn't have yet is passed over)
    if to_regclass('public.' || target) is not null then
      execute format('update public.%I set employee_number = $1 where tenant_id = $2 and employee_number = $3', target)
        using new."Employee Number", new.tenant_id, old."Employee Number";
    end if;
  end loop;
  update public.employees set "Leave Approver" = new."Employee Number"
  where tenant_id = new.tenant_id and btrim("Leave Approver") = old."Employee Number";
  update public.employees set "Alternate Approver" = new."Employee Number"
  where tenant_id = new.tenant_id and btrim("Alternate Approver") = old."Employee Number";
  return new;
end $$;
revoke all on function public.employees_follow_renumber_rest() from public, anon, authenticated;

drop trigger if exists employees_follow_renumber_rest on public.employees;
create trigger employees_follow_renumber_rest
  after update of "Employee Number" on public.employees
  for each row when (old."Employee Number" is distinct from new."Employee Number")
  execute function public.employees_follow_renumber_rest();

-- ---------------------------------------------------------------------------------------------
-- 2. a new prefix for everyone
-- ---------------------------------------------------------------------------------------------

/**
 * Every employee of the caller's company whose number starts with p_from gets p_to instead (the rest of the number
 * kept), and new employees get p_to too when p_from was the company's prefix. Returns how many were renumbered.
 * Administrators and Settings only. Refused, with nothing changed, when a new number is already someone's.
 */
create or replace function public.renumber_employees(p_from text, p_to text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.current_tenant_id();
  clash text;
  emp record;
  n integer := 0;
begin
  if t is null or not public.has_module('settings') then
    raise exception 'Only an administrator (or someone with Settings) can renumber employees' using errcode = '42501';
  end if;
  if coalesce(p_from, '') !~ '^[A-Za-z0-9/_.-]{1,12}$' or coalesce(p_to, '') !~ '^[A-Za-z0-9/_.-]{0,12}$' then
    raise exception 'The prefix may have up to 12 letters, digits and / _ . -' using errcode = '22023';
  end if;
  if p_from = p_to then
    raise exception 'The new prefix is the same as the old one' using errcode = '22023';
  end if;

  select string_agg(x.new_number, ', ' order by x.new_number) into clash
  from (
    select p_to || substr(e."Employee Number", length(p_from) + 1) new_number
    from public.employees e
    where e.tenant_id = t and left(e."Employee Number", length(p_from)) = p_from
  ) x
  where exists (select 1 from public.employees o where o.tenant_id = t and o."Employee Number" = x.new_number);
  if clash is not null then
    raise exception 'Nothing was changed: these numbers are already someone''s: %', left(clash, 300) using errcode = '23505';
  end if;

  for emp in
    select id, "Employee Number" num from public.employees
    where tenant_id = t and left("Employee Number", length(p_from)) = p_from
    order by "Employee Number"
  loop
    update public.employees set "Employee Number" = p_to || substr(emp.num, length(p_from) + 1) where id = emp.id;
    n := n + 1;
  end loop;

  update public.company_payroll_settings set employee_number_prefix = p_to, updated_by = auth.uid(), updated_at = now()
  where tenant_id = t and employee_number_prefix = p_from;
  return n;
end $$;
revoke all on function public.renumber_employees(text, text) from public, anon;
grant execute on function public.renumber_employees(text, text) to authenticated;

notify pgrst, 'reload schema';
