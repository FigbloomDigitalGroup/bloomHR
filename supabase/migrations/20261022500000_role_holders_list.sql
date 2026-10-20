-- Who has a role, by name, on the Roles screen; and the standard roles described as they really are.
--
--   company_role_holder_list(role_key)  the people in the caller's company who hold the role: the same people
--                                       company_role_holders() counts (a company role by its key, else the base role),
--                                       with their name (their employee record, matched on the work email, else
--                                       their profile), email, location and account status. Only for those who may
--                                       manage roles (can_manage_roles()); anyone else gets no rows. Changing
--                                       someone's role from there goes through assign_company_role(), unchanged.
--   the standard roles' descriptions    the seeded ones said HR does payroll ("Employee and payroll management") and
--                                       little else; they now say what each role gets by default. A description a
--                                       company changed is left alone. New companies get the new wording.
-- Safe to run again.

-- ---------------------------------------------------------------------------------------------
-- 1. the people who hold a role
-- ---------------------------------------------------------------------------------------------
drop function if exists public.company_role_holder_list(text);
create or replace function public.company_role_holder_list(p_role_key text)
returns table (user_id uuid, full_name text, email text, location text, account_status text)
language sql stable security definer set search_path = public as $$
  select
    m.user_id,
    coalesce(
      nullif(btrim(concat_ws(' ', nullif(btrim(e."First Name"), ''), nullif(btrim(e."Last Name"), ''))), ''),
      nullif(btrim(p.full_name), ''),
      nullif(btrim(u.raw_user_meta_data ->> 'full_name'), '')
    ) as full_name,
    coalesce(u.email, p.email)::text as email,
    coalesce(
      nullif(btrim(u.raw_user_meta_data ->> 'location'), ''),
      nullif(btrim(e."Branch"), ''),
      nullif(btrim(e."Town"), '')
    ) as location,
    m.account_status
  from public.memberships m
  left join public.company_roles cr on cr.id = m.company_role_id and cr.tenant_id = m.tenant_id
  left join auth.users u on u.id = m.user_id
  left join public.user_profiles p on p.user_id = m.user_id and p.tenant_id = m.tenant_id
  left join lateral (
    select x."First Name", x."Last Name", x."Branch", x."Town"
    from public.employees x
    where x.tenant_id = m.tenant_id
      and coalesce(u.email, p.email) is not null
      and lower(btrim(x."Work Email")) = lower(btrim(coalesce(u.email, p.email)))
    order by x.id
    limit 1
  ) e on true
  where p_role_key is not null
    and m.tenant_id = public.current_tenant_id()
    and public.can_manage_roles()
    and coalesce(cr.role_key, m.role) = p_role_key
  order by 2 nulls last, 3 nulls last
$$;
revoke all on function public.company_role_holder_list(text) from public, anon;
grant execute on function public.company_role_holder_list(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. the standard roles, described as they are
-- ---------------------------------------------------------------------------------------------
create or replace function public.system_role_description(p_role text) returns text
language sql immutable set search_path = public as $$
  select case p_role
    when 'ADMIN' then 'Everything: every screen, setting and role'
    when 'HR' then 'People: employee records, hiring, leave, performance, training, discipline, exits and staff loans. Not payroll or settings'
    when 'CHECKER' then 'Money checks: payroll, salary advances and M-Pesa payments, with employee records and reports'
    when 'MANAGER' then 'Their people: employees, leave, performance, salary advances and incidents, and their team''s casual work and overtime'
    when 'REGIONAL' then 'Several branches: employees, leave, performance, salary advances and reports'
    when 'OPERATIONS' then 'Day to day: employees, hiring, leave, training, discipline, SMS and reports'
    when 'STAFF' then 'The staff portal only: their own profile, leave, payslips, tasks and chat'
  end
$$;

-- the old seeded wording, so only descriptions nobody changed are updated
update public.company_roles c
set description = public.system_role_description(c.role_key)
where c.is_system
  and public.system_role_description(c.role_key) is not null
  and c.description is not distinct from (case c.role_key
    when 'ADMIN' then 'Full access to every screen and setting'
    when 'HR' then 'Employee and payroll management'
    when 'CHECKER' then 'Verification and approval workflows'
    when 'MANAGER' then 'Team oversight and reporting'
    when 'REGIONAL' then 'Supervision of several branches'
    when 'OPERATIONS' then 'Day-to-day operations'
    when 'STAFF' then 'The staff portal'
  end);

-- new companies: as in 20261019700000_custom_roles.sql, with the new wording
create or replace function public.seed_company_roles(p_tenant uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.company_roles (tenant_id, role_key, name, description, base_role, is_system)
  select p_tenant, v.k, v.n, public.system_role_description(v.k), v.k, true
  from (values
    ('ADMIN', 'Administrator'),
    ('HR', 'Human Resources'),
    ('CHECKER', 'Checker'),
    ('MANAGER', 'Manager'),
    ('REGIONAL', 'Regional Manager'),
    ('OPERATIONS', 'Operations'),
    ('STAFF', 'Staff')
  ) as v(k, n)
  where exists (select 1 from public.tenants t where t.id = p_tenant)
    -- a company that already uses the name for a role of its own keeps it (the role is then shown by its key)
    and not exists (select 1 from public.company_roles c
                    where c.tenant_id = p_tenant and (c.role_key = v.k or lower(btrim(c.name)) = lower(v.n)))
  on conflict (tenant_id, role_key) do nothing
$$;
revoke all on function public.seed_company_roles(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
