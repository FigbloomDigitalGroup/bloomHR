-- Employee onboarding, part 2 (FIG-765): only approved employees are paid, the employee's photo is theirs, and the
-- onboarding screens can ask what is missing.
--
--   1. A payslip (salary_history) can only be added for an employee whose onboarding is approved. Every payroll
--      screen saves payslips as the signed-in user and the server's payment queue pays from payslips, so nobody else
--      is paid. (The backend itself is not limited.)
--   2. Only the employee puts their own photo on their record ("Profile Image"). HR may remove one (the employee then
--      uploads a new one) but never sets or replaces it. The storage side is 20261012200100.
--   3. onboarding_missing_for(employee) and onboarding_overview() for the onboarding form and HR's review queue.

-- ---------------------------------------------------------------------------------------------
-- 1. payroll gate
-- ---------------------------------------------------------------------------------------------
create or replace function public.salary_history_approved_employee() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  e record;
begin
  -- the backend and migrations (imports, tests) are not limited; every payroll screen saves as the signed-in user
  if auth.uid() is null then
    return new;
  end if;
  select "First Name", "Last Name", onboarding_status into e
  from public.employees where tenant_id = new.tenant_id and "Employee Number" = new.employee_id;
  if not found then
    raise exception 'No employee % in this company', new.employee_id using errcode = '23503';
  end if;
  if e.onboarding_status <> 'approved' then
    raise exception '% % (%) can''t be paid yet: their onboarding is %, not approved',
      coalesce(e."First Name", ''), coalesce(e."Last Name", ''), new.employee_id, replace(e.onboarding_status, '_', ' ')
      using errcode = '23514';
  end if;
  return new;
end $$;

-- new payslips only: renumbering an employee (which updates employee_id on old payslips) is not affected
-- named to run after salary_history_in_draft_run (triggers run in name order), so a locked run or a bad month is reported first
drop trigger if exists salary_history_onboarded_employee on public.salary_history;
create trigger salary_history_onboarded_employee before insert on public.salary_history
  for each row execute function public.salary_history_approved_employee();

-- ---------------------------------------------------------------------------------------------
-- 2. the photo is the employee's
-- ---------------------------------------------------------------------------------------------
create or replace function public.employees_photo_owner_only() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- the backend and migrations are not limited; removing a photo is allowed
  if auth.uid() is null or new."Profile Image" is null or btrim(new."Profile Image") = '' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new."Profile Image" is not distinct from old."Profile Image" then
    return new;
  end if;
  if new."Employee Number" is distinct from public.current_employee_number() then
    raise exception 'Only the employee can upload their own photo' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists employees_photo_owner_only on public.employees;
create trigger employees_photo_owner_only before insert or update of "Profile Image" on public.employees
  for each row execute function public.employees_photo_owner_only();

-- ---------------------------------------------------------------------------------------------
-- 3. what is missing
-- ---------------------------------------------------------------------------------------------
-- for one record: the caller's own (no argument) or, for HR, anyone's in the company
create or replace function public.onboarding_missing_for(p_employee uuid default null)
returns table (employee_part text[], employer_part text[])
language plpgsql stable security definer set search_path = public as $$
declare
  e public.employees := public.onboarding_record(p_employee, false);
begin
  return query select public.onboarding_missing(e, 'employee'), public.onboarding_missing(e, 'employer');
end $$;
revoke all on function public.onboarding_missing_for(uuid) from public, anon;
grant execute on function public.onboarding_missing_for(uuid) to authenticated;

-- every employee of the company, for HR: where each one is and what is still missing
create or replace function public.onboarding_overview()
returns table (
  id uuid, employee_number text, payroll_number text, name text, job_title text, work_email text,
  status text, submitted_at timestamptz, reviewed_at timestamptz, review_comment text,
  employee_part text[], employer_part text[]
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_module('employees') then
    raise exception 'Only HR can do this' using errcode = '42501';
  end if;
  return query
  select e.id, e."Employee Number", e."Payroll Number",
         btrim(concat_ws(' ', e."First Name", e."Middle Name", e."Last Name")), e."Job Title", e."Work Email",
         e.onboarding_status, e.onboarding_submitted_at, e.onboarding_reviewed_at, e.onboarding_review_comment,
         public.onboarding_missing(e, 'employee'), public.onboarding_missing(e, 'employer')
  from public.employees e
  where e.tenant_id = public.current_tenant_id()
  order by e."First Name", e."Last Name", e."Employee Number";
end $$;
revoke all on function public.onboarding_overview() from public, anon;
grant execute on function public.onboarding_overview() to authenticated;

notify pgrst, 'reload schema';
