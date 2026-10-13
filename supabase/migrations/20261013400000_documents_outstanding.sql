-- Missing documents no longer hold up onboarding (FIG-765 follow-up). Employees found it hard to have every document
-- ready at once, so:
--
--   * submitting needs the employee's details, a referee and the required policies, but not the documents;
--   * HR can approve (and so pay) without them: payroll needs the details, not the files;
--   * every required document without an accepted file is "outstanding" (documents_outstanding), shown to the
--     employee and to HR (onboarding_missing_for / onboarding_overview) until it is uploaded and accepted.
--
-- onboarding_missing calls onboarding_missing_without_agreements (20261012600000), which 20261012400000 made check
-- documents; it now checks the details and the referee only.

create or replace function public.onboarding_missing_without_agreements(e public.employees, p_part text default 'all') returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  m text[] := public.onboarding_missing_details(e, p_part);
begin
  if p_part in ('employee', 'all') and not exists (select 1 from public.employee_referees r where r.employee_id = e.id) then
    m := m || text 'Referee';
  end if;
  return m;
end $$;

-- every required document without an accepted file, saying where it is: not uploaded, waiting for HR, or rejected
create or replace function public.documents_outstanding(e public.employees) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(
    c.label || case
      when exists (select 1 from public.employee_documents d where d.employee_id = e.id and d.code = c.code and d.status = 'pending') then ' (waiting for HR)'
      when exists (select 1 from public.employee_documents d where d.employee_id = e.id and d.code = c.code and d.status = 'rejected') then ' (rejected, upload again)'
      else ''
    end
    order by c.sort), '{}')
  from public.document_checklist_for(e) c
  where c.required
    and not exists (select 1 from public.employee_documents d where d.employee_id = e.id and d.code = c.code and d.status = 'accepted')
$$;
revoke all on function public.documents_outstanding(public.employees) from public, anon, authenticated;

-- the caller's own record or (HR) anyone's: what is missing, and the documents still outstanding
drop function if exists public.onboarding_missing_for(uuid);
create function public.onboarding_missing_for(p_employee uuid default null)
returns table (employee_part text[], employer_part text[], documents_outstanding text[])
language plpgsql stable security definer set search_path = public as $$
declare
  e public.employees := public.onboarding_record(p_employee, false);
begin
  return query select public.onboarding_missing(e, 'employee'), public.onboarding_missing(e, 'employer'), public.documents_outstanding(e);
end $$;
revoke all on function public.onboarding_missing_for(uuid) from public, anon;
grant execute on function public.onboarding_missing_for(uuid) to authenticated;

drop function if exists public.onboarding_overview();
create function public.onboarding_overview()
returns table (
  id uuid, employee_number text, payroll_number text, name text, job_title text, work_email text,
  status text, submitted_at timestamptz, reviewed_at timestamptz, review_comment text,
  employee_part text[], employer_part text[], documents_outstanding text[]
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
         public.onboarding_missing(e, 'employee'), public.onboarding_missing(e, 'employer'), public.documents_outstanding(e)
  from public.employees e
  where e.tenant_id = public.current_tenant_id()
  order by e."First Name", e."Last Name", e."Employee Number";
end $$;
revoke all on function public.onboarding_overview() from public, anon;
grant execute on function public.onboarding_overview() to authenticated;

notify pgrst, 'reload schema';
