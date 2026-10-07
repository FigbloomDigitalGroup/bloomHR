-- FIG-657, tier 1, batch 1: tables that only back admin screens.
--
-- Until now these carried the blanket "any signed-in user can do everything" policy, so a plain STAFF
-- login could read and write payroll, loans, expenses and terminations straight through the API.
-- Access now follows the same module permissions the app already uses to show or hide the screens
-- (role_permissions, edited under Settings > Role Permissions): a user can reach a table if their
-- role has at least one of the modules listed for it. ADMIN always can. The restrictive
-- tenant_isolation policy still keeps everything inside the caller's own company.
--
-- Batch 2 (tables that staff also use for their own rows) and `employees` follow separately.

-- Does the signed-in user's role include this module? The role comes from user_profiles (written by
-- the backend only), never from user_metadata, which users can edit about themselves.
create or replace function public.has_module(p_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.role = 'ADMIN'
        or exists (
          select 1 from public.role_permissions rp
          where rp.tenant_id = p.tenant_id and rp.role_name = p.role and p_module = any (rp.permissions)
        )
    from public.user_profiles p
    where p.user_id = auth.uid()
  ), false)
$$;

create or replace function public.has_any_module(variadic p_modules text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(bool_or(public.has_module(m)), false) from unnest(p_modules) as m
$$;

revoke all on function public.has_module(text) from public, anon;
revoke all on function public.has_any_module(text[]) from public, anon;
grant execute on function public.has_module(text) to authenticated, service_role;
grant execute on function public.has_any_module(text[]) to authenticated, service_role;

-- table -> modules that may use it (screens: see src/components/Layout/Sidebar.tsx)
do $$
declare
  m record;
  pol record;
  mods text;
begin
  for m in
    select * from (values
      ('payment_flows',                array['payroll', 'mpesa-zap']),
      ('salary_advance_payment_flows', array['salaryadmin']),
      ('staff_loans',                  array['reports', 'payroll']),
      ('statutory_deductions',         array['reports', 'payroll']),
      ('hr_salary_advances',           array['hr-lifecycle']),
      ('expenses',                     array['expenses']),
      ('mpesa_callbacks',              array['mpesa-zap', 'salaryadmin']),
      ('mpesa_transactions',           array['mpesa-zap', 'reports']),
      ('hr_terminations',              array['hr-lifecycle']),
      ('hr_suspensions',               array['hr-lifecycle']),
      ('hr_termination_interviews',    array['hr-lifecycle']),
      ('termination_requests',         array['employees', 'hr-lifecycle'])
    ) as v(tbl, modules)
  loop
    continue when to_regclass(format('public.%I', m.tbl)) is null;

    -- remove every permissive policy (the blanket one and any older ones); keep tenant_isolation
    for pol in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = m.tbl and policyname <> 'tenant_isolation'
    loop
      execute format('drop policy %I on public.%I', pol.policyname, m.tbl);
    end loop;

    select string_agg(quote_literal(x), ', ') into mods from unnest(m.modules) as x;
    execute format(
      'create policy module_access on public.%I for all to authenticated '
      'using (public.has_any_module(%s)) with check (public.has_any_module(%s))',
      m.tbl, mods, mods);
  end loop;
end $$;

notify pgrst, 'reload schema';
