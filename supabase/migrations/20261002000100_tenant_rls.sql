-- FIG-515: multi-tenancy, "contract" step (see docs/MULTI_TENANCY_RFC.md).
-- Requires 20261002000000_tenants_expand.sql. Ship the two together.
--
-- Design note: the tenant rule is a RESTRICTIVE policy. Postgres ANDs restrictive policies with
-- the existing permissive ones, so:
--   * the intra-tenant rules already in the database (chat membership, "admins only", ...) keep
--     working untouched, and
--   * a stray permissive `USING (true)` policy (like the one master_schema.sql generates) can
--     never open a table across tenants.
-- Tables that have no permissive policy yet get a plain "tenant members" one so they stay usable.

-- ---------------------------------------------------------------------------------------------
-- 1. Tenant tables: NOT NULL + restrictive tenant_isolation policy
-- ---------------------------------------------------------------------------------------------
do $$
declare
  r record;
  exempt text[] := array['tenants', 'permissions', 'user_profiles',
                         'Employee_Records_Duplicate', 'kenya_branches_duplicate'];
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
      and c.relname <> all (exempt)
    order by c.relname
  loop
    execute format('alter table public.%I alter column tenant_id set not null', r.relname);
    execute format('alter table public.%I enable row level security', r.relname);
    execute format('drop policy if exists tenant_isolation on public.%I', r.relname);
    execute format(
      'create policy tenant_isolation on public.%I as restrictive for all '
      'using (tenant_id = (select public.current_tenant_id())) '
      'with check (tenant_id = (select public.current_tenant_id()))', r.relname);

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = r.relname and permissive = 'PERMISSIVE'
    ) then
      execute format(
        'create policy tenant_members on public.%I for all to authenticated using (true) with check (true)', r.relname);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. Special tables
-- ---------------------------------------------------------------------------------------------
-- tenants: a user can read only their own company; written by the backend only.
alter table public.tenants enable row level security;
drop policy if exists tenant_self_read on public.tenants;
create policy tenant_self_read on public.tenants for select to authenticated
  using (id = (select public.current_tenant_id()));
revoke insert, update, delete on public.tenants from anon, authenticated;

-- permissions: global, read-only catalogue (changed by migrations / service role only).
alter table public.permissions enable row level security;
do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'permissions' loop
    execute format('drop policy %I on public.permissions', pol.policyname);
  end loop;
end $$;
create policy permissions_read on public.permissions for select to authenticated using (true);
revoke insert, update, delete on public.permissions from anon, authenticated;

-- user_profiles: readable within the tenant, written by the backend (service role) only.
-- Otherwise a user could move themselves, or anyone else, into another tenant.
alter table public.user_profiles enable row level security;
do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'user_profiles' loop
    execute format('drop policy %I on public.user_profiles', pol.policyname);
  end loop;
end $$;
create policy user_profiles_tenant_read on public.user_profiles for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));
revoke insert, update, delete on public.user_profiles from anon, authenticated;

-- Legacy duplicates are not tenant-ified: close them to clients (backend/service role only)
-- until Login.tsx stops using them (FIG-516).
do $$
declare t text; pol record;
begin
  foreach t in array array['Employee_Records_Duplicate', 'kenya_branches_duplicate'] loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('alter table public.%I enable row level security', t);
      for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
        execute format('drop policy %I on public.%I', pol.policyname, t);
      end loop;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. Uniqueness: text business keys become unique per tenant, otherwise company A can detect that
--    company B uses a value (a leak) or be blocked by it (a bug). Only the keys listed below are
--    converted: changing a unique constraint breaks every `upsert(..., { onConflict })` that names
--    its old columns, so each conversion is deliberate and its callers are updated with it
--    (RolePermissions.tsx for role_permissions). Any other candidate is reported with a NOTICE
--    for review. Constraints that include a uuid column are globally unique already, and ones
--    referenced by a foreign key (employees."Employee Number") cannot change without migrating the
--    FKs - tracked separately.
-- ---------------------------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select con.conrelid::regclass::text as tbl, con.conname,
           (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
              from unnest(con.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as cols
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where con.contype = 'u' and n.nspname = 'public'
      and cl.relname <> all (array['tenants', 'permissions', 'user_profiles',
                                   'Employee_Records_Duplicate', 'kenya_branches_duplicate'])
      and exists (select 1 from pg_attribute a where a.attrelid = cl.oid and a.attname = 'tenant_id' and not a.attisdropped)
      and not exists (select 1 from unnest(con.conkey) as k(attnum) join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
                      where a.attname = 'tenant_id' or a.atttypid = 'uuid'::regtype)
      and not exists (select 1 from pg_constraint f where f.contype = 'f' and f.confrelid = con.conrelid and f.confkey = con.conkey)
  loop
    if (c.tbl, c.cols) in (('role_permissions', 'role_name'), ('employees', '"Work Email"')) then
      execute format('alter table %s drop constraint %I', c.tbl, c.conname);
      execute format('alter table %s add constraint %I unique (tenant_id, %s)', c.tbl, c.conname, c.cols);
      raise notice 'unique per tenant: %.% is now (tenant_id, %)', c.tbl, c.conname, c.cols;
    else
      raise notice 'REVIEW: %.% unique (%) is still global; decide whether it should be per tenant', c.tbl, c.conname, c.cols;
    end if;
  end loop;
end $$;

-- Views defined with `select *` froze their column list before tenant_id existed. Re-expand the
-- ones we know about so they expose tenant_id (CREATE OR REPLACE may append columns).
create or replace view public.current_leave_policies as
select distinct on (leave_type_id) *
from public.leave_policies
where effective_from <= current_date
order by leave_type_id, effective_from desc;

-- ---------------------------------------------------------------------------------------------
-- 4. Views run as their owner by default and would bypass RLS: make them run as the caller.
-- ---------------------------------------------------------------------------------------------
do $$
declare v record;
begin
  for v in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('alter view public.%I set (security_invoker = true)', v.relname);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. SECURITY DEFINER / system-run code must respect the tenant
-- ---------------------------------------------------------------------------------------------
-- Permission helpers: only answer for users in the caller's own tenant, and read that tenant's
-- role_permissions. (Service-role callers have no tenant of their own and may ask about anyone.)
create or replace function public.has_permission(user_id uuid, required_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_tenant uuid;
  v_permissions text[];
begin
  select p.tenant_id into v_tenant from public.user_profiles p where p.user_id = has_permission.user_id;
  if v_tenant is null then return false; end if;
  if auth.uid() is not null and v_tenant is distinct from public.current_tenant_id() then return false; end if;

  select u.raw_user_meta_data ->> 'role' into v_role from auth.users u where u.id = has_permission.user_id;
  if v_role is null then return false; end if;

  select rp.permissions into v_permissions
  from public.role_permissions rp
  where rp.role_name = v_role and rp.tenant_id = v_tenant;

  return coalesce(required_permission = any (v_permissions), false);
end;
$$;

create or replace function public.get_user_permissions(user_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_tenant uuid;
  v_permissions text[];
begin
  select p.tenant_id into v_tenant from public.user_profiles p where p.user_id = get_user_permissions.user_id;
  if v_tenant is null then return array[]::text[]; end if;
  if auth.uid() is not null and v_tenant is distinct from public.current_tenant_id() then return array[]::text[]; end if;

  select u.raw_user_meta_data ->> 'role' into v_role from auth.users u where u.id = get_user_permissions.user_id;
  if v_role is null then return array[]::text[]; end if;

  select rp.permissions into v_permissions
  from public.role_permissions rp
  where rp.role_name = v_role and rp.tenant_id = v_tenant;

  return coalesce(v_permissions, array[]::text[]);
end;
$$;

-- Leave resets run as the caller (RLS limits them to the caller's tenant) but also from pg_cron
-- as the postgres owner (every tenant, no RLS, no default tenant). Keep each employee, leave type
-- and policy inside one tenant and stamp tenant_id explicitly so both paths are correct.
create or replace function public.run_annual_leave_reset(p_year integer)
returns setof public.leave_balances
language plpgsql
as $$
declare
  r record;
  v_carry numeric;
  v_new_row public.leave_balances;
begin
  for r in
    select
      e.tenant_id as tenant_id,
      e."Employee Number" as employee_number,
      lt.id as leave_type_id,
      cp.days_allotted,
      cp.carry_forward_max_days,
      prev.remaining_days as prev_remaining
    from public.employees e
    join public.leave_types lt on lt.tenant_id = e.tenant_id
    join public.current_leave_policies cp on cp.leave_type_id = lt.id and cp.tenant_id = e.tenant_id
    left join public.leave_balances prev
      on prev.employee_number = e."Employee Number"
     and prev.tenant_id = e.tenant_id
     and prev.leave_type_id = lt.id
     and prev.year = p_year - 1
     and prev.month = 0
    where lt.is_deductible = true
      and cp.accrual_method = 'annual'
  loop
    v_carry := greatest(least(coalesce(r.prev_remaining, 0), r.carry_forward_max_days), 0);

    insert into public.leave_balances (tenant_id, employee_number, leave_type_id, year, month, accrued_days, used_days, carried_over_days)
    values (r.tenant_id, r.employee_number, r.leave_type_id, p_year, 0, coalesce(r.days_allotted, 0), 0, v_carry)
    on conflict (employee_number, leave_type_id, year, month) do nothing
    returning * into v_new_row;

    if found then
      insert into public.leave_balance_adjustments
        (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
      values
        (r.tenant_id, v_new_row.id, 'annual_reset', coalesce(r.days_allotted, 0) + v_carry, 0, 0, 0, coalesce(r.days_allotted, 0),
         format('Annual reset for %s: %s days allotted + %s carried forward from %s', p_year, coalesce(r.days_allotted, 0), v_carry, p_year - 1));
      return next v_new_row;
    end if;
  end loop;
end;
$$;

create or replace function public.run_monthly_leave_reset(p_year integer, p_month integer)
returns setof public.leave_balances
language plpgsql
as $$
declare
  r record;
  v_new_row public.leave_balances;
begin
  for r in
    select
      e.tenant_id as tenant_id,
      e."Employee Number" as employee_number,
      lt.id as leave_type_id,
      cp.days_allotted
    from public.employees e
    join public.leave_types lt on lt.tenant_id = e.tenant_id
    join public.current_leave_policies cp on cp.leave_type_id = lt.id and cp.tenant_id = e.tenant_id
    where lt.is_deductible = true
      and cp.accrual_method = 'monthly_non_cumulative'
  loop
    insert into public.leave_balances (tenant_id, employee_number, leave_type_id, year, month, accrued_days, used_days, carried_over_days)
    values (r.tenant_id, r.employee_number, r.leave_type_id, p_year, p_month, coalesce(r.days_allotted, 0), 0, 0)
    on conflict (employee_number, leave_type_id, year, month) do nothing
    returning * into v_new_row;

    if found then
      insert into public.leave_balance_adjustments
        (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
      values
        (r.tenant_id, v_new_row.id, 'monthly_reset', coalesce(r.days_allotted, 0), 0, 0, 0, coalesce(r.days_allotted, 0),
         format('Monthly reset for %s-%s: %s days, does not carry over', p_year, p_month, coalesce(r.days_allotted, 0)));
      return next v_new_row;
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
