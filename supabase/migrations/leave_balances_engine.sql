-- Leave Balance Reset Engine
-- Run this once in your Supabase SQL editor (after leave_balances.sql)
--
-- FIG-563 gave leave_balances a real, persisted row per (employee, leave
-- type, year), but nothing ever reset or carried those balances forward -
-- this migration adds that. It also fixes a granularity gap FIG-563 left:
-- Compassionate Leave resets every month and never carries over, which a
-- year-only balance can't represent (an employee's 3 monthly days would
-- just keep draining all year with no reset). Balances now live in a
-- "bucket" identified by (year, month), where month = 0 means "the whole
-- year" (used by annual-cadence types) and month = 1-12 means "just that
-- calendar month" (used by monthly_non_cumulative types, i.e. Compassionate
-- Leave). Existing rows default to month = 0, which is correct - FIG-563's
-- code only ever created annual-style rows.

alter table public.leave_balances add column if not exists month integer not null default 0;

alter table public.leave_balances drop constraint if exists leave_balances_employee_number_leave_type_id_year_key;
alter table public.leave_balances drop constraint if exists leave_balances_unique_bucket;
alter table public.leave_balances add constraint leave_balances_unique_bucket
  unique (employee_number, leave_type_id, year, month);

create index if not exists leave_balances_year_month_idx on public.leave_balances (year, month);

-- Audit trail: every reset or approval-driven deduction leaves a row here so
-- "why did this balance change" always has an answer.
create table if not exists public.leave_balance_adjustments (
  id                   uuid primary key default gen_random_uuid(),
  leave_balance_id     uuid not null references public.leave_balances(id) on delete cascade,
  change_type          text not null check (change_type in ('approval_deduction', 'annual_reset', 'monthly_reset')),
  delta_days           numeric not null,
  used_days_before     numeric not null,
  used_days_after      numeric not null,
  accrued_days_before  numeric not null,
  accrued_days_after   numeric not null,
  reason               text,
  created_at           timestamptz not null default now()
);

create index if not exists leave_balance_adjustments_balance_idx on public.leave_balance_adjustments (leave_balance_id);

alter table public.leave_balance_adjustments enable row level security;

drop policy if exists "Enable all access for authenticated users" on public.leave_balance_adjustments;
create policy "Enable all access for authenticated users" on public.leave_balance_adjustments
  for all to authenticated using (true) with check (true);

-- Replaces the FIG-563 version (text, uuid, integer, numeric) with one that
-- also takes p_month and writes an audit row. Dropped explicitly first since
-- adding a parameter would otherwise create a second overload instead of
-- replacing the original.
drop function if exists public.increment_leave_balance_used_days(text, uuid, integer, numeric);

create or replace function public.increment_leave_balance_used_days(
  p_employee_number text,
  p_leave_type_id uuid,
  p_year integer,
  p_days numeric,
  p_month integer default 0
) returns public.leave_balances
language plpgsql
as $$
declare
  v_before public.leave_balances;
  v_after  public.leave_balances;
begin
  select * into v_before
  from public.leave_balances
  where employee_number = p_employee_number
    and leave_type_id = p_leave_type_id
    and year = p_year
    and month = p_month;

  insert into public.leave_balances (employee_number, leave_type_id, year, month, accrued_days, used_days)
  values (
    p_employee_number,
    p_leave_type_id,
    p_year,
    p_month,
    coalesce((select days_allotted from public.current_leave_policies where leave_type_id = p_leave_type_id), 0),
    p_days
  )
  on conflict (employee_number, leave_type_id, year, month)
  do update set used_days = public.leave_balances.used_days + excluded.used_days,
                updated_at = now()
  returning * into v_after;

  insert into public.leave_balance_adjustments
    (leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
  values
    (v_after.id, 'approval_deduction', p_days,
     coalesce(v_before.used_days, 0), v_after.used_days,
     coalesce(v_before.accrued_days, v_after.accrued_days), v_after.accrued_days,
     'Leave application approved');

  return v_after;
end;
$$;

grant execute on function public.increment_leave_balance_used_days(text, uuid, integer, numeric, integer) to authenticated;

-- Annual reset: for every (employee, deductible annual-cadence leave type),
-- grants the policy's day allotment for p_year, carrying forward up to
-- carry_forward_max_days of whatever was left over from p_year - 1 (0 for an
-- employee/type with no prior-year row - e.g. a new hire). Idempotent: if
-- p_year's row already exists for a given employee/type, it's left alone
-- (on conflict do nothing) rather than double-granting or overwriting
-- January usage that's already happened.
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
      e."Employee Number" as employee_number,
      lt.id as leave_type_id,
      cp.days_allotted,
      cp.carry_forward_max_days,
      prev.remaining_days as prev_remaining
    from public.employees e
    cross join public.leave_types lt
    join public.current_leave_policies cp on cp.leave_type_id = lt.id
    left join public.leave_balances prev
      on prev.employee_number = e."Employee Number"
     and prev.leave_type_id = lt.id
     and prev.year = p_year - 1
     and prev.month = 0
    where lt.is_deductible = true
      and cp.accrual_method = 'annual'
  loop
    v_carry := greatest(least(coalesce(r.prev_remaining, 0), r.carry_forward_max_days), 0);

    insert into public.leave_balances (employee_number, leave_type_id, year, month, accrued_days, used_days, carried_over_days)
    values (r.employee_number, r.leave_type_id, p_year, 0, coalesce(r.days_allotted, 0), 0, v_carry)
    on conflict (employee_number, leave_type_id, year, month) do nothing
    returning * into v_new_row;

    if found then
      insert into public.leave_balance_adjustments
        (leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
      values
        (v_new_row.id, 'annual_reset', coalesce(r.days_allotted, 0) + v_carry, 0, 0, 0, coalesce(r.days_allotted, 0),
         format('Annual reset for %s: %s days allotted + %s carried forward from %s', p_year, coalesce(r.days_allotted, 0), v_carry, p_year - 1));
      return next v_new_row;
    end if;
  end loop;
end;
$$;

grant execute on function public.run_annual_leave_reset(integer) to authenticated;

-- Monthly reset: for every (employee, deductible monthly_non_cumulative
-- leave type - i.e. Compassionate Leave), grants a fresh allotment for
-- (p_year, p_month) with nothing carried over from any prior month.
-- Idempotent the same way as the annual reset.
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
      e."Employee Number" as employee_number,
      lt.id as leave_type_id,
      cp.days_allotted
    from public.employees e
    cross join public.leave_types lt
    join public.current_leave_policies cp on cp.leave_type_id = lt.id
    where lt.is_deductible = true
      and cp.accrual_method = 'monthly_non_cumulative'
  loop
    insert into public.leave_balances (employee_number, leave_type_id, year, month, accrued_days, used_days, carried_over_days)
    values (r.employee_number, r.leave_type_id, p_year, p_month, coalesce(r.days_allotted, 0), 0, 0)
    on conflict (employee_number, leave_type_id, year, month) do nothing
    returning * into v_new_row;

    if found then
      insert into public.leave_balance_adjustments
        (leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
      values
        (v_new_row.id, 'monthly_reset', coalesce(r.days_allotted, 0), 0, 0, 0, coalesce(r.days_allotted, 0),
         format('Monthly reset for %s-%s: %s days, does not carry over', p_year, p_month, coalesce(r.days_allotted, 0)));
      return next v_new_row;
    end if;
  end loop;
end;
$$;

grant execute on function public.run_monthly_leave_reset(integer, integer) to authenticated;

-- Best-effort scheduling via pg_cron: Jan 1 for the annual reset, the 1st of
-- every month for the monthly reset. Skipped with a notice (not an error) if
-- pg_cron isn't enabled on this project - enable it under Dashboard >
-- Database > Extensions, then re-run just this block. Either way, the
-- on-demand buttons in the app work regardless of whether this succeeds.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;

    perform cron.schedule(
      'annual-leave-reset',
      '0 0 1 1 *',
      $c$select public.run_annual_leave_reset(extract(year from current_date)::int);$c$
    );
    perform cron.schedule(
      'monthly-leave-reset',
      '0 0 1 * *',
      $c$select public.run_monthly_leave_reset(extract(year from current_date)::int, extract(month from current_date)::int);$c$
    );
  else
    raise notice 'pg_cron is not available on this project - schedule these manually or enable pg_cron in the Dashboard (Database > Extensions), then re-run this DO block.';
  end if;
end $$;

-- REFRESH API
NOTIFY pgrst, 'reload schema';
