-- My team in the staff portal: the people the signed-in employee supervises.
--
-- A STAFF login only ever sees the staff portal, but a staff member can still be someone's supervisor (the report's
-- reports_to_id, manager_email or regional_manager points at them: supervised_employee_numbers()). The database
-- already lets a supervisor assign and score their reports' KPIs, record and approve their overtime and record their
-- casual workers' days, whatever their role. The staff portal needs one more thing: who those reports are.
--
--   my_team()     the signed-in person's current reports (not themselves, not people who have left), with only what a
--                 supervisor needs to recognise them: employee number, name, job title, department, photo, whether
--                 they are a casual worker and their status. No pay, ID, bank or contact details.
--
-- Adds no access: it returns the same people supervised_employee_numbers() already gives, in the caller's company.
-- Written to run again safely (create or replace).

create or replace function public.my_team()
returns table (
  employee_number text, first_name text, last_name text, job_title text, department_id uuid, department text,
  photo text, worker_kind text, status text
)
language sql stable security definer set search_path = public as $$
  select e."Employee Number", e."First Name", e."Last Name", e."Job Title", e.department_id,
         coalesce(d.name, nullif(btrim(e."Job Level"), '')), nullif(btrim(e."Profile Image"), ''), e.worker_kind, e."Status"
  from public.employees e
  left join public.departments d on d.id = e.department_id and d.tenant_id = e.tenant_id
  where auth.uid() is not null
    and e.tenant_id = public.current_tenant_id()
    and e."Employee Number" in (select public.supervised_employee_numbers())
    and e."Employee Number" is distinct from public.current_employee_number()
    and lower(coalesce(btrim(e."Status"), '')) not in ('terminated', 'inactive', 'exited', 'resigned', 'dismissed')
  order by e."First Name", e."Last Name", e."Employee Number"
$$;
revoke all on function public.my_team() from public, anon;
grant execute on function public.my_team() to authenticated;

notify pgrst, 'reload schema';
