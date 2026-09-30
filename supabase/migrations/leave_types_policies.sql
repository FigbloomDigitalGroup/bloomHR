-- Leave Types & Leave Policies
-- Run this once in your Supabase SQL editor
--
-- `leave_types` already exists in ziradev (created during the FIG-520 schema
-- reconstruction) with 6 rows: Annual, Compassionate, Maternity, Paternity,
-- Sick, Unpaid - and no `tenant_id`/`max_days` column. This version is written
-- to be additive against that real state instead of assuming a clean table:
-- it only ADDs columns/indexes, and never rewrites existing rows' name,
-- description, icon, is_deductible or is_continuous.
--
-- Splits "what a leave type is" (leave_types) from "how many days an org
-- grants for it, and how those days behave over time" (leave_policies),
-- because the same leave type needs different day counts per accrual cadence
-- (e.g. Compassionate Leave resets monthly and never carries over, while
-- Annual Leave resets yearly and carries over up to a cap).
--
-- `tenant_id` is added so this is forward-compatible with the shared-schema
-- multi-tenancy work (FIG-512/FIG-514, still in design/unbuilt as of
-- 2026-09-29) without depending on it: there is no `tenants` table yet, so
-- tenant_id is nullable and unconstrained (no FK). NULL means "the single
-- Figbloom tenant" for now. Once FIG-514 lands and backfills a real tenants
-- table, existing rows here can be updated to point at it and the FK added.

create table if not exists public.leave_types (
  id uuid primary key default gen_random_uuid()
);

alter table public.leave_types add column if not exists tenant_id     uuid;
alter table public.leave_types add column if not exists name          text;
alter table public.leave_types add column if not exists description   text;
alter table public.leave_types add column if not exists is_deductible boolean not null default true;
alter table public.leave_types add column if not exists is_continuous boolean not null default true;
alter table public.leave_types add column if not exists icon          text not null default 'calendar';
alter table public.leave_types add column if not exists created_at    timestamptz not null default now();

alter table public.leave_types alter column name set not null;

-- Name must be unique per tenant, and unique among untenanted (NULL) rows too -
-- a plain UNIQUE(tenant_id, name) wouldn't catch duplicates among NULLs, since
-- Postgres treats every NULL as distinct.
create unique index if not exists leave_types_name_no_tenant_idx
  on public.leave_types (name) where tenant_id is null;
create unique index if not exists leave_types_tenant_name_idx
  on public.leave_types (tenant_id, name) where tenant_id is not null;

create index if not exists leave_types_tenant_idx on public.leave_types (tenant_id);

create table if not exists public.leave_policies (
  id                     uuid primary key default gen_random_uuid(),
  leave_type_id          uuid not null references public.leave_types(id) on delete cascade,
  -- Days granted per accrual period. NULL = uncapped (e.g. Unpaid Leave).
  days_allotted          numeric,
  accrual_method         text not null default 'annual'
                           check (accrual_method in ('annual', 'monthly_non_cumulative', 'none')),
  -- Only meaningful for accrual_method = 'annual'. Days beyond this cap are
  -- forfeited at the Jan 1 reset instead of carried into the new year.
  carry_forward_max_days numeric not null default 0,
  -- Lets a policy change apply from a future date without rewriting history;
  -- "current" policy = latest row with effective_from <= today (see view below).
  effective_from         date not null default current_date,
  created_at             timestamptz not null default now(),
  unique (leave_type_id, effective_from)
);

create index if not exists leave_policies_leave_type_idx on public.leave_policies (leave_type_id);

-- The policy in effect today for each leave type.
create or replace view public.current_leave_policies as
select distinct on (leave_type_id) *
from public.leave_policies
where effective_from <= current_date
order by leave_type_id, effective_from desc;

alter table public.leave_types enable row level security;
alter table public.leave_policies enable row level security;

drop policy if exists "Enable all access for authenticated users" on public.leave_types;
create policy "Enable all access for authenticated users" on public.leave_types
  for all to authenticated using (true) with check (true);

drop policy if exists "Enable all access for authenticated users" on public.leave_policies;
create policy "Enable all access for authenticated users" on public.leave_policies
  for all to authenticated using (true) with check (true);

-- Add Study/Exam Leave - explicitly requested in the policy discussion and
-- missing from the existing catalog. Existing types (including Unpaid Leave,
-- which predates this discussion) are left untouched.
insert into public.leave_types (name, description, is_deductible, is_continuous, icon)
values ('Study/Exam Leave', 'Time off for study or examinations', true, true, 'book')
on conflict do nothing;

-- Seed policy rows for every type that has a real day cap. Maternity/Paternity
-- keep is_deductible = false as-is (per team decision, 2026-09-29) so they
-- won't appear in the Balances tab yet, but their entitlement is recorded here
-- for when that's turned on. Unpaid Leave intentionally has no policy row -
-- it's uncapped by nature.
insert into public.leave_policies (leave_type_id, days_allotted, accrual_method, carry_forward_max_days)
select lt.id, v.days_allotted, v.accrual_method, v.carry_forward_max_days
from public.leave_types lt
join (values
  ('Annual Leave',        24::numeric, 'annual',                 5::numeric),
  ('Sick Leave',          14::numeric, 'annual',                 0::numeric),
  ('Maternity Leave',     90::numeric, 'annual',                 0::numeric),
  ('Paternity Leave',     14::numeric, 'annual',                 0::numeric),
  -- 3 days every month, does not accumulate: unused days are lost at each
  -- month's reset, never carried within or across years.
  ('Compassionate Leave',  3::numeric, 'monthly_non_cumulative', 0::numeric),
  -- Placeholder day count - confirm the actual entitlement with HR before
  -- relying on this for real approvals.
  ('Study/Exam Leave',    10::numeric, 'annual',                 0::numeric)
) as v(name, days_allotted, accrual_method, carry_forward_max_days) on v.name = lt.name
where lt.tenant_id is null
on conflict (leave_type_id, effective_from) do nothing;

-- REFRESH API
NOTIFY pgrst, 'reload schema';
