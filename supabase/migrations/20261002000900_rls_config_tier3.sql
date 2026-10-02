-- FIG-657, tier 3: configuration, branches, performance/loan book and asset tables.
--
-- Same model as tiers 1 and 2: access through module permissions, tenant rule on top, blanket
-- policy removed. Configuration that every screen needs (leave types, holidays, branches, branding...)
-- stays readable by everyone in the company; changing it needs a module.
--
--   read by everyone in the company, changed by a module
--     leave_types, leave_policies, holidays ........ leaves
--     salary_advance_settings ...................... salaryadmin, settings
--     company_logo ................................. settings
--     company_events ............................... settings, employees, hr-lifecycle
--     kenya_branches ............................... settings
--     regional_managers ............................ assign-managers
--   module only (not readable by others)
--     statutory_settings ........................... payroll, reports
--     system_settings .............................. settings, adminconfirm, email-portal  (holds Gmail OAuth tokens)
--     sender_id_configs, sms_templates ............. sms
--     kenya_office_locations ....................... recruitment
--     branch_performance, clients, client_visits,
--       loans, loan_payments ....................... performance
--     assets ....................................... asset
--   read-only for a module (written only by the database / backend)
--     audit_log .................................... settings

-- 1. Singleton settings rows -----------------------------------------------------------------------
-- salary_advance_settings and system_settings keep ONE row per company, addressed as id = 1. With the
-- primary key on id alone, the second company could never create its row (and saving would collide
-- with the first company's row it cannot see). Make the key per company; callers upsert on
-- (tenant_id, id).
do $$
declare
  t text;
  pk text;
begin
  foreach t in array array['salary_advance_settings', 'system_settings'] loop
    continue when to_regclass(format('public.%I', t)) is null;
    select conname into pk from pg_constraint where conrelid = format('public.%I', t)::regclass and contype = 'p';
    continue when pk is null;
    if (select array_length(conkey, 1) from pg_constraint where conname = pk and conrelid = format('public.%I', t)::regclass) = 1 then
      execute format('alter table public.%I drop constraint %I', t, pk);
      execute format('alter table public.%I add constraint %I primary key (tenant_id, id)', t, pk);
    end if;
  end loop;
end $$;

-- 2. system_settings holds secrets, but every login needs to know whether MFA is required --------------
create or replace function public.mfa_required()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce((
    select s.mfa_enabled from public.system_settings s
    where s.tenant_id = (select public.current_tenant_id()) and s.id = 1
  ), false);
exception when undefined_table then
  return false;  -- a database without system_settings has no MFA setting
end;
$$;

revoke all on function public.mfa_required() from public, anon;
grant execute on function public.mfa_required() to authenticated, service_role;

-- 3. Policies ---------------------------------------------------------------------------------------
do $$
declare
  m record;
  pol record;
begin
  for m in
    select * from (values
      ('leave_types',             'read_all',  array['leaves']),
      ('leave_policies',          'read_all',  array['leaves']),
      ('holidays',                'read_all',  array['leaves']),
      ('salary_advance_settings', 'read_all',  array['salaryadmin', 'settings']),
      ('company_logo',            'read_all',  array['settings']),
      ('company_events',          'read_all',  array['settings', 'employees', 'hr-lifecycle']),
      ('kenya_branches',          'read_all',  array['settings']),
      ('regional_managers',       'read_all',  array['assign-managers']),
      ('statutory_settings',      'module',    array['payroll', 'reports']),
      ('system_settings',         'module',    array['settings', 'adminconfirm', 'email-portal']),
      ('sender_id_configs',       'module',    array['sms']),
      ('sms_templates',           'module',    array['sms']),
      ('kenya_office_locations',  'module',    array['recruitment']),
      ('branch_performance',      'module',    array['performance']),
      ('clients',                 'module',    array['performance']),
      ('client_visits',           'module',    array['performance']),
      ('loans',                   'module',    array['performance']),
      ('loan_payments',           'module',    array['performance']),
      ('assets',                  'module',    array['asset']),
      ('audit_log',               'read_only', array['settings'])
    ) as v(tbl, mode, modules)
  loop
    continue when to_regclass(format('public.%I', m.tbl)) is null;

    for pol in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = m.tbl and policyname <> 'tenant_isolation'
    loop
      execute format('drop policy %I on public.%I', pol.policyname, m.tbl);
    end loop;

    if m.mode = 'read_only' then
      execute format(
        'create policy module_read on public.%I for select to authenticated using (public.has_any_module(variadic %L::text[]))',
        m.tbl, m.modules);
    else
      execute format(
        'create policy module_access on public.%I for all to authenticated '
        'using (public.has_any_module(variadic %L::text[])) with check (public.has_any_module(variadic %L::text[]))',
        m.tbl, m.modules, m.modules);
      if m.mode = 'read_all' then
        execute format('create policy read_all on public.%I for select to authenticated using (true)', m.tbl);
      end if;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
