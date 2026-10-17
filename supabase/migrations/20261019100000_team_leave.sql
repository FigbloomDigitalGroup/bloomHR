-- A supervisor sees who on their team is on leave (FIG-897 follow-up): the APPROVED leave of their own reports
-- (supervised_employee_numbers()) that falls in a date range, with the leave type, dates and days only: no reason,
-- notes or documents. Staff can otherwise read only their own leave; this is the one narrow addition.

create or replace function public.my_team_leave(p_from date, p_to date)
returns table (employee_number text, name text, leave_type text, start_date date, end_date date, days numeric)
language sql stable security definer set search_path = public as $$
  select a."Employee Number",
         coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), nullif(btrim(a.name), ''), a."Employee Number"),
         a."Leave Type",
         public.leave_parse_date(a."Start Date"),
         public.leave_parse_date(a."End Date"),
         a.days
  from public.leave_application a
  left join public.employees e on e.tenant_id = a.tenant_id and e."Employee Number" = a."Employee Number"
  where auth.uid() is not null
    and a.tenant_id = public.current_tenant_id()
    and lower(coalesce(a.status, '')) = 'approved'
    and a."Employee Number" in (select public.supervised_employee_numbers())
    and a."Employee Number" is distinct from public.current_employee_number()
    and public.leave_parse_date(a."Start Date") <= p_to
    and public.leave_parse_date(a."End Date") >= p_from
  order by 4, 2
$$;
revoke all on function public.my_team_leave(date, date) from public, anon;
grant execute on function public.my_team_leave(date, date) to authenticated;

notify pgrst, 'reload schema';
