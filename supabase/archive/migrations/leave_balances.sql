-- Leave Balances
-- Run this once in your Supabase SQL editor
--
-- Real, persisted per-employee/leave-type/year balances. Replaces the old
-- Balances tab behavior, which recomputed everything from scratch on every
-- render and silently discarded any manual edits or "Run Accrual" clicks
-- (see FIG-563). Builds on leave_types/leave_policies from
-- leave_types_policies.sql.

create table if not exists public.leave_balances (
  id                 uuid primary key default gen_random_uuid(),
  employee_number    text not null references public.employees("Employee Number") on delete cascade,
  leave_type_id      uuid not null references public.leave_types(id) on delete cascade,
  year               integer not null,
  accrued_days       numeric not null default 0,
  used_days          numeric not null default 0,
  carried_over_days  numeric not null default 0,
  remaining_days     numeric generated always as (accrued_days + carried_over_days - used_days) stored,
  monthly_accrual    numeric not null default 0,
  last_accrual_date  date,
  updated_at         timestamptz not null default now(),
  unique (employee_number, leave_type_id, year)
);

create index if not exists leave_balances_employee_idx on public.leave_balances (employee_number);
create index if not exists leave_balances_leave_type_idx on public.leave_balances (leave_type_id);
create index if not exists leave_balances_year_idx on public.leave_balances (year);

alter table public.leave_balances enable row level security;

drop policy if exists "Enable all access for authenticated users" on public.leave_balances;
create policy "Enable all access for authenticated users" on public.leave_balances
  for all to authenticated using (true) with check (true);

-- Atomically records leave taken against a balance: creates the row (seeded
-- from the leave type's current policy allotment) on first use, or adds to
-- an existing row's used_days. Called when an application is approved - see
-- handleUpdateStatus in LeaveManagement.tsx. Rejecting an application never
-- needs this: nothing is deducted until approval, so there's nothing to
-- reverse on rejection.
create or replace function public.increment_leave_balance_used_days(
  p_employee_number text,
  p_leave_type_id uuid,
  p_year integer,
  p_days numeric
) returns public.leave_balances
language sql
as $$
  insert into public.leave_balances (employee_number, leave_type_id, year, accrued_days, used_days)
  values (
    p_employee_number,
    p_leave_type_id,
    p_year,
    coalesce((select days_allotted from public.current_leave_policies where leave_type_id = p_leave_type_id), 0),
    p_days
  )
  on conflict (employee_number, leave_type_id, year)
  do update set used_days = public.leave_balances.used_days + excluded.used_days,
                updated_at = now()
  returning *;
$$;

grant execute on function public.increment_leave_balance_used_days(text, uuid, integer, numeric) to authenticated;

-- REFRESH API
NOTIFY pgrst, 'reload schema';
