-- FIG-514: multi-tenancy, "expand" step (see docs/MULTI_TENANCY_RFC.md).
--
-- Adds the tenants table, the current_tenant_id() helper and a nullable tenant_id on every
-- tenant-owned table, backfilled with a single default tenant. It changes no access rules:
-- 20261002000100_tenant_rls.sql ("contract" step, FIG-515) makes the column NOT NULL and
-- replaces the blanket RLS policy. Ship the two together; do not run this one alone in production.
--
-- Table classes (keep in sync with the exempt lists below and in supabase/tests/tenant_isolation.test.ts):
--   root       tenants                         - the tenant list itself
--   global     permissions                     - system catalogue, identical for everyone
--   legacy     Employee_Records_Duplicate, kenya_branches_duplicate
--                                              - old copies, not tenant-ified (see RFC section 2.4)
--   identity   user_profiles                   - tenant_id is NOT NULL and backend-written
--   everything else in public (tables)         - tenant data/config: gets tenant_id

create table if not exists public.tenants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  plan          text not null default 'trial',
  status        text not null default 'active' check (status in ('active', 'suspended')),
  max_employees integer,  -- NULL = unlimited; billing hook, not enforced yet
  created_at    timestamptz not null default now()
);

-- The company that exists today. Rename it (name/slug) to the real company after migrating.
insert into public.tenants (id, name, slug, plan)
values ('00000000-0000-0000-0000-000000000001', 'Figbloom HR', 'figbloom', 'internal')
on conflict (id) do nothing;

-- One company per login: the tenant is a property of the profile.
alter table public.user_profiles
  add column if not exists tenant_id uuid references public.tenants(id);
update public.user_profiles
  set tenant_id = '00000000-0000-0000-0000-000000000001'
  where tenant_id is null;
alter table public.user_profiles alter column tenant_id set not null;
create index if not exists user_profiles_tenant_id_idx on public.user_profiles (tenant_id);

-- The one helper everything hangs off. Looked up per request (not a token claim) so moving a
-- user or suspending a tenant takes effect immediately. NULL for a suspended tenant makes every
-- tenant policy fail: a one-line kill switch.
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.tenant_id
  from public.user_profiles p
  join public.tenants t on t.id = p.tenant_id
  where p.user_id = auth.uid() and t.status = 'active'
$$;

revoke all on function public.current_tenant_id() from public, anon;
-- anon may call it too (it returns NULL for them) so RLS policies that use it deny cleanly
-- instead of raising "permission denied for function".
grant execute on function public.current_tenant_id() to anon, authenticated, service_role;

-- Add tenant_id to every other public table, backfill, then default new rows to the caller's
-- tenant (reads are filtered by RLS and inserts are stamped by this default, so most app queries
-- need no change). Service-role code bypasses RLS and gets no default: it must set tenant_id.
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
    -- hr_contract_settings already has an unrelated text tenant_id (from database/hr_lifecycle_schema.sql).
    -- Keep its values under another name and let tenant_id be the real uuid.
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = r.relname and column_name = 'tenant_id' and udt_name <> 'uuid'
    ) then
      execute format('alter table public.%I rename column tenant_id to legacy_tenant_id', r.relname);
      raise notice 'renamed %.tenant_id (not a uuid) to legacy_tenant_id', r.relname;
    end if;
    execute format('alter table public.%I add column if not exists tenant_id uuid', r.relname);
    execute format('update public.%I set tenant_id = %L where tenant_id is null', r.relname, '00000000-0000-0000-0000-000000000001');
    -- leave_types/hr_contract_settings already had a nullable, unconstrained tenant_id: make sure
    -- every table ends up with the foreign key.
    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', r.relname)::regclass and contype = 'f'
        and confrelid = 'public.tenants'::regclass
    ) then
      execute format('alter table public.%I add constraint %I foreign key (tenant_id) references public.tenants(id)',
                     r.relname, r.relname || '_tenant_id_fkey');
    end if;
    execute format('alter table public.%I alter column tenant_id set default public.current_tenant_id()', r.relname);
    execute format('create index if not exists %I on public.%I (tenant_id)', r.relname || '_tenant_id_idx', r.relname);
  end loop;
end $$;

notify pgrst, 'reload schema';
