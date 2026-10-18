-- Birthdays without the year.
--
-- Colleagues may see each other's birthday (the day and month) but never the year they were born. Every staff member
-- reads employee_directory, which used to carry the full "Date of Birth" (the screens only showed the day and month,
-- but anyone could read the year through the API). Now:
--   * "Date of Birth" is always null in the directory (kept, same place and type, because a view's columns cannot be
--     dropped or reordered in place, and older migrations that tests run again redefine it);
--   * a new last column, birthday, carries just 'MM-DD' (e.g. '11-20'), null when unknown or unreadable. It is read
--     the same way as the daily digest's birthdays (public.birthday_month_day, migration 20261019600000).
-- HR and admins keep the full date of birth through employees (module access); that is unchanged.
--
-- Safe to run again.

create or replace view public.employee_directory with (security_barrier = true) as
  select "tenant_id",
    "Employee Number",
    "Employee Id",
    "First Name",
    "Middle Name",
    "Last Name",
    "Work Email",
    "Work Mobile",
    "Job Title",
    "Job Level",
    "Job Group",
    "Employee Type",
    "Entity",
    "Status",
    "Town",
    "Branch",
    "Office",
    "Area",
    "Manager",
    "manager_email",
    "regional_manager",
    "Leave Approver",
    "Alternate Approver",
    "second_level_leave_approver",
    "alternate_second_level_approver",
    null::text as "Date of Birth",
    "Start Date",
    "Profile Image",
    "id",
    "department_id",
    "reports_to_id",
    "job_title_id",
    "job_group_id",
    public.birthday_month_day(e."Date of Birth") as birthday
  from public.employees e
  where tenant_id = (select public.current_tenant_id());

comment on column public.employee_directory."Date of Birth" is 'Always null: colleagues never see the year. Use birthday (MM-DD); HR reads the full date from employees.';
comment on column public.employee_directory.birthday is 'Birthday as MM-DD (no year), null when unknown.';

notify pgrst, 'reload schema';
