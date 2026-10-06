-- Leave rules a company can set for itself.
--
--   1. accrual_method "monthly_cumulative": a yearly allowance earned month by month (24 days = 2 a month) that builds
--      up through the year. Unused days are lost at the new year, apart from the carry-forward cap (0 = nothing carries).
--   2. Per-employee allowance: leave_entitlements overrides the policy's yearly days for one employee and leave type.
--   3. Year-end reminders: a policy can say "from N days before the year ends, tell anyone who still has M or more unused
--      days (that would be lost) to take leave". Sent to the employee's staff-portal notifications, once a month.
--   4. New companies start with a standard set of leave types (they had none, so the leave form had nothing to offer).
--
-- Everything is a setting on the leave type (Leave > leave type > edit) or on the employee; nothing is hard-wired to one
-- company's policy. The functions run as the caller (RLS keeps them inside that company) and from pg_cron for every company.

-- ---------------------------------------------------------------------------------------------
-- 1 + 3. policy columns
-- ---------------------------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select con.conname from pg_constraint con
    where con.conrelid = 'public.leave_policies'::regclass and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%accrual_method%'
  loop
    execute format('alter table public.leave_policies drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.leave_policies
  add constraint leave_policies_accrual_method_check
  check (accrual_method in ('annual', 'monthly_cumulative', 'monthly_non_cumulative', 'none'));

alter table public.leave_policies add column if not exists reminder_days_before_year_end integer not null default 0;
alter table public.leave_policies add column if not exists reminder_min_remaining numeric not null default 0;
alter table public.leave_policies drop constraint if exists leave_policies_reminder_check;
alter table public.leave_policies
  add constraint leave_policies_reminder_check check (reminder_days_before_year_end >= 0 and reminder_min_remaining >= 0);

-- the view froze its column list before these columns existed
drop view if exists public.current_leave_policies;
create view public.current_leave_policies as
select distinct on (leave_type_id) *
from public.leave_policies
where effective_from <= current_date
order by leave_type_id, effective_from desc;
alter view public.current_leave_policies set (security_invoker = true);

alter table public.leave_balance_adjustments drop constraint if exists leave_balance_adjustments_change_type_check;
alter table public.leave_balance_adjustments
  add constraint leave_balance_adjustments_change_type_check
  check (change_type in ('approval_deduction', 'annual_reset', 'monthly_reset', 'monthly_accrual', 'allowance_change'));

alter table public.hr_notifications drop constraint if exists hr_notifications_notification_type_check;
alter table public.hr_notifications
  add constraint hr_notifications_notification_type_check
  check (notification_type in ('contract_expiring', 'probation_expiring', 'leave_recommended', 'leave_approved', 'leave_rejected', 'leave_year_end_reminder'));

-- ---------------------------------------------------------------------------------------------
-- 2. per-employee allowance
-- ---------------------------------------------------------------------------------------------
create table if not exists public.leave_entitlements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  employee_number text not null,
  leave_type_id uuid not null references public.leave_types(id) on delete cascade,
  days_allotted numeric not null check (days_allotted >= 0),
  updated_at timestamptz not null default now(),
  unique (tenant_id, employee_number, leave_type_id)
);

alter table public.leave_entitlements enable row level security;
drop policy if exists tenant_isolation on public.leave_entitlements;
create policy tenant_isolation on public.leave_entitlements as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists module_access on public.leave_entitlements;
create policy module_access on public.leave_entitlements for all to authenticated
  using (public.has_any_module('leaves')) with check (public.has_any_module('leaves'));
revoke all on public.leave_entitlements from anon;
grant select, insert, update, delete on public.leave_entitlements to authenticated;

-- yearly days for one employee and leave type: their own allowance if set, otherwise the policy's
create or replace function public.leave_entitlement(p_tenant uuid, p_employee text, p_type uuid, p_policy_days numeric)
returns numeric
language sql
stable
as $$
  select coalesce(
    (select e.days_allotted from public.leave_entitlements e
     where e.tenant_id = p_tenant and e.employee_number = p_employee and e.leave_type_id = p_type),
    p_policy_days, 0)
$$;

-- days earned so far this year for a monthly_cumulative type (month 1..12), to 2 decimals
create or replace function public.leave_earned_to_date(p_yearly numeric, p_month integer)
returns numeric
language sql
immutable
as $$ select round(coalesce(p_yearly, 0) * least(greatest(p_month, 1), 12) / 12.0, 2) $$;

-- how many months of a year's allowance count as earned today: this year -> months so far, a past year -> all 12,
-- a future year -> 1
create or replace function public.leave_months_earned(p_year integer)
returns integer
language sql
stable
as $$
  select case when p_year = extract(year from current_date)::int then extract(month from current_date)::int
              when p_year < extract(year from current_date)::int then 12 else 1 end
$$;

-- ---------------------------------------------------------------------------------------------
-- engine: yearly grant (now honouring per-employee allowances)
-- ---------------------------------------------------------------------------------------------
create or replace function public.run_annual_leave_reset(p_year integer)
returns setof public.leave_balances
language plpgsql
as $$
declare
  r record;
  v_carry numeric;
  v_days numeric;
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
    v_days := public.leave_entitlement(r.tenant_id, r.employee_number, r.leave_type_id, r.days_allotted);

    insert into public.leave_balances (tenant_id, employee_number, leave_type_id, year, month, accrued_days, used_days, carried_over_days)
    values (r.tenant_id, r.employee_number, r.leave_type_id, p_year, 0, v_days, 0, v_carry)
    on conflict (employee_number, leave_type_id, year, month) do nothing
    returning * into v_new_row;

    if found then
      insert into public.leave_balance_adjustments
        (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
      values
        (r.tenant_id, v_new_row.id, 'annual_reset', v_days + v_carry, 0, 0, 0, v_days,
         format('Annual reset for %s: %s days allotted + %s carried forward from %s', p_year, v_days, v_carry, p_year - 1));
      return next v_new_row;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- engine: earn the allowance month by month. Safe to run any number of times: it sets the days earned so far,
-- never adds, and never lowers what an employee has already earned.
-- ---------------------------------------------------------------------------------------------
create or replace function public.run_leave_accrual(p_year integer, p_month integer)
returns setof public.leave_balances
language plpgsql
as $$
declare
  r record;
  v_carry numeric;
  v_due numeric;
  v_row public.leave_balances;
  v_old numeric;
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
      and cp.accrual_method = 'monthly_cumulative'
  loop
    v_due := public.leave_earned_to_date(public.leave_entitlement(r.tenant_id, r.employee_number, r.leave_type_id, r.days_allotted), p_month);

    select * into v_row from public.leave_balances b
    where b.employee_number = r.employee_number and b.leave_type_id = r.leave_type_id and b.year = p_year and b.month = 0;

    if not found then
      v_carry := greatest(least(coalesce(r.prev_remaining, 0), r.carry_forward_max_days), 0);
      insert into public.leave_balances (tenant_id, employee_number, leave_type_id, year, month, accrued_days, used_days, carried_over_days, last_accrual_date)
      values (r.tenant_id, r.employee_number, r.leave_type_id, p_year, 0, v_due, 0, v_carry, current_date)
      returning * into v_row;
      insert into public.leave_balance_adjustments
        (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
      values
        (r.tenant_id, v_row.id, 'monthly_accrual', v_due + v_carry, 0, 0, 0, v_due,
         format('Year %s started: %s days earned so far + %s carried forward from %s', p_year, v_due, v_carry, p_year - 1));
      return next v_row;
    elsif v_row.accrued_days < v_due then
      v_old := v_row.accrued_days;
      update public.leave_balances set accrued_days = v_due, last_accrual_date = current_date, updated_at = now()
      where id = v_row.id returning * into v_row;
      insert into public.leave_balance_adjustments
        (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
      values
        (r.tenant_id, v_row.id, 'monthly_accrual', v_due - v_old, v_row.used_days, v_row.used_days, v_old, v_due,
         format('Earned %s days by month %s of %s', v_due, p_month, p_year));
      return next v_row;
    end if;
  end loop;
end;
$$;

-- recording leave taken: seeds the row from the employee's own allowance (and, for monthly types, what is earned so far)
drop function if exists public.increment_leave_balance_used_days(text, uuid, integer, numeric, integer);
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
  v_tenant uuid := public.current_tenant_id();
  v_policy record;
  v_yearly numeric;
  v_seed numeric;
begin
  select * into v_before
  from public.leave_balances
  where employee_number = p_employee_number and leave_type_id = p_leave_type_id and year = p_year and month = p_month;

  select cp.days_allotted, cp.accrual_method into v_policy from public.current_leave_policies cp where cp.leave_type_id = p_leave_type_id;
  v_yearly := public.leave_entitlement(v_tenant, p_employee_number, p_leave_type_id, v_policy.days_allotted);
  v_seed := case when v_policy.accrual_method = 'monthly_cumulative'
                 then public.leave_earned_to_date(v_yearly, public.leave_months_earned(p_year))
                 else v_yearly end;

  insert into public.leave_balances (employee_number, leave_type_id, year, month, accrued_days, used_days)
  values (p_employee_number, p_leave_type_id, p_year, p_month, v_seed, p_days)
  on conflict (employee_number, leave_type_id, year, month)
  do update set used_days = public.leave_balances.used_days + excluded.used_days, updated_at = now()
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

-- HR sets one employee's yearly allowance for a leave type; this year's balance follows at once
create or replace function public.set_leave_entitlement(p_employee_number text, p_leave_type_id uuid, p_days numeric, p_year integer default null)
returns public.leave_balances
language plpgsql
as $$
declare
  v_year integer := coalesce(p_year, extract(year from current_date)::int);
  v_tenant uuid := public.current_tenant_id();
  v_method text;
  v_new numeric;
  v_row public.leave_balances;
  v_old numeric;
begin
  if p_days is null or p_days < 0 then
    raise exception 'The allowance must be zero or more days' using errcode = '22023';
  end if;

  insert into public.leave_entitlements (tenant_id, employee_number, leave_type_id, days_allotted)
  values (v_tenant, p_employee_number, p_leave_type_id, p_days)
  on conflict (tenant_id, employee_number, leave_type_id)
  do update set days_allotted = excluded.days_allotted, updated_at = now();

  select accrual_method into v_method from public.current_leave_policies where leave_type_id = p_leave_type_id;
  v_new := case when v_method = 'monthly_cumulative'
                then public.leave_earned_to_date(p_days, public.leave_months_earned(v_year))
                else p_days end;

  select * into v_row from public.leave_balances
  where employee_number = p_employee_number and leave_type_id = p_leave_type_id and year = v_year and month = 0;
  if found and v_method in ('annual', 'monthly_cumulative') then
    v_old := v_row.accrued_days;
    update public.leave_balances set accrued_days = v_new, updated_at = now() where id = v_row.id returning * into v_row;
    insert into public.leave_balance_adjustments
      (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
    values
      (v_row.tenant_id, v_row.id, 'allowance_change', v_new - v_old, v_row.used_days, v_row.used_days, v_old, v_new,
       format('Yearly allowance set to %s days for this employee', p_days));
  end if;
  return v_row;
end;
$$;
grant execute on function public.set_leave_entitlement(text, uuid, numeric, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. year-end reminders (to the employee's staff-portal notifications), at most once a month per leave type
-- ---------------------------------------------------------------------------------------------
create or replace function public.run_leave_year_end_reminders(p_today date default current_date)
returns integer
language plpgsql
as $$
declare
  r record;
  v_year_end date := make_date(extract(year from p_today)::int, 12, 31);
  v_lost numeric;
  v_title text;
  v_sent integer := 0;
begin
  for r in
    select
      b.tenant_id, b.employee_number, b.remaining_days, lt.name as type_name,
      cp.carry_forward_max_days, cp.reminder_days_before_year_end, cp.reminder_min_remaining,
      e."First Name" as first_name, e."Last Name" as last_name, e."Work Email" as work_email
    from public.leave_balances b
    join public.leave_types lt on lt.id = b.leave_type_id and lt.tenant_id = b.tenant_id
    join public.current_leave_policies cp on cp.leave_type_id = lt.id and cp.tenant_id = b.tenant_id
    join public.employees e on e."Employee Number" = b.employee_number and e.tenant_id = b.tenant_id
    where b.year = extract(year from p_today)::int
      and b.month = 0
      and cp.accrual_method in ('annual', 'monthly_cumulative')
      and cp.reminder_days_before_year_end > 0
      and p_today >= v_year_end - cp.reminder_days_before_year_end
      and b.remaining_days >= cp.reminder_min_remaining
  loop
    -- only what would actually be lost matters: days above the carry-forward cap
    v_lost := greatest(r.remaining_days - coalesce(r.carry_forward_max_days, 0), 0);
    continue when v_lost <= 0;

    v_title := format('Take your %s before the year ends', r.type_name);
    continue when exists (
      select 1 from public.hr_notifications n
      where n.tenant_id = r.tenant_id and n.employee_number = r.employee_number
        and n.notification_type = 'leave_year_end_reminder' and n.title = v_title
        and n.created_at >= date_trunc('month', p_today)
    );

    insert into public.hr_notifications
      (tenant_id, employee_number, employee_name, work_email, notification_type, title, message, end_date, days_remaining, is_read_admin, created_at)
    values
      (r.tenant_id, r.employee_number, btrim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), r.work_email,
       'leave_year_end_reminder', v_title,
       format('You have %s unused %s day(s). %s will be lost on %s%s. Please plan to take some leave before then.',
              r.remaining_days, r.type_name, v_lost, to_char(v_year_end, 'DD Mon YYYY'),
              case when coalesce(r.carry_forward_max_days, 0) > 0 then format(' (only %s can be carried forward)', r.carry_forward_max_days) else '' end),
       v_year_end, v_year_end - p_today, true,
       case when p_today = current_date then now() else p_today::timestamptz end);
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$$;
grant execute on function public.run_leave_year_end_reminders(date) to authenticated;
grant execute on function public.run_leave_accrual(integer, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. a standard set of leave types for a company that has none
-- ---------------------------------------------------------------------------------------------
create or replace function public.seed_default_leave_types(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.leave_types (tenant_id, name, description, is_deductible, is_continuous, icon)
  values
    (p_tenant, 'Annual Leave', 'Yearly leave, earned month by month', true, true, 'Sun'),
    (p_tenant, 'Sick Leave', 'Time off when unwell', true, true, 'Heart'),
    (p_tenant, 'Compassionate Leave', 'Bereavement and family emergencies', true, true, 'HeartHandshake'),
    (p_tenant, 'Maternity Leave', 'Leave for new mothers', false, true, 'Baby'),
    (p_tenant, 'Paternity Leave', 'Leave for new fathers', false, true, 'Baby'),
    (p_tenant, 'Study/Exam Leave', 'Time off for study or examinations', true, true, 'book'),
    (p_tenant, 'Unpaid Leave', 'Leave without pay', true, true, 'calendar')
  on conflict (tenant_id, name) where tenant_id is not null do nothing;

  -- (days, method, carry-forward cap, remind this many days before year end, ...if at least this many days are left)
  insert into public.leave_policies (tenant_id, leave_type_id, days_allotted, accrual_method, carry_forward_max_days, reminder_days_before_year_end, reminder_min_remaining)
  select p_tenant, lt.id, v.days, v.method, v.carry, v.remind_days, v.remind_min
  from public.leave_types lt
  join (values
    ('Annual Leave', 24::numeric, 'monthly_cumulative', 0::numeric, 60, 14::numeric),
    ('Sick Leave', 14::numeric, 'annual', 0::numeric, 0, 0::numeric),
    ('Compassionate Leave', 3::numeric, 'monthly_non_cumulative', 0::numeric, 0, 0::numeric),
    ('Maternity Leave', 90::numeric, 'annual', 0::numeric, 0, 0::numeric),
    ('Paternity Leave', 14::numeric, 'annual', 0::numeric, 0, 0::numeric),
    ('Study/Exam Leave', 10::numeric, 'annual', 0::numeric, 0, 0::numeric)
  ) as v(name, days, method, carry, remind_days, remind_min) on v.name = lt.name
  where lt.tenant_id = p_tenant
    and not exists (select 1 from public.leave_policies p where p.leave_type_id = lt.id);
end;
$$;
revoke all on function public.seed_default_leave_types(uuid) from public, anon, authenticated;

-- companies created through sign-up before this have no leave types at all: give them the standard set. (The original
-- company, 0000...0001, has always had its own, set up by hand, and is left alone.)
do $$
declare t record;
begin
  for t in select id from public.tenants x
           where x.id <> '00000000-0000-0000-0000-000000000001'
             and not exists (select 1 from public.leave_types lt where lt.tenant_id = x.id) loop
    perform public.seed_default_leave_types(t.id);
  end loop;
end $$;

-- new companies get them as they are created
create or replace function public.create_company(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_base text;
  v_slug text;
  v_tenant uuid;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'Company name must be 2 to 80 characters' using errcode = '22023';
  end if;

  -- a person can own a handful of companies; this is a guard against a runaway client, not a business rule
  select count(*) into v_count from public.memberships where user_id = auth.uid() and role = 'ADMIN';
  if v_count >= 10 then
    raise exception 'You already administer 10 companies' using errcode = '22023';
  end if;

  v_base := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
  v_base := btrim(v_base, '-');
  if char_length(v_base) < 3 then v_base := v_base || '-co'; end if;
  v_base := left(v_base, 30);
  v_base := btrim(v_base, '-');
  v_slug := v_base;
  while exists (select 1 from public.tenants where slug = v_slug) loop
    v_slug := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 5);
  end loop;

  insert into public.tenants (name, slug, plan) values (v_name, v_slug, 'trial') returning id into v_tenant;

  -- the new company starts with the same role permissions as the default one, so its roles work straight away
  insert into public.role_permissions (tenant_id, role_name, permissions)
  select v_tenant, rp.role_name, rp.permissions
  from public.role_permissions rp
  where rp.tenant_id = '00000000-0000-0000-0000-000000000001';

  -- every company starts with a general channel, so the chat is never an empty screen
  insert into public.channels (tenant_id, name, description, type, is_private, created_by, is_default)
  values (v_tenant, 'general', 'Company-wide chat and announcements', 'channel', false, auth.uid(), true);

  -- and a standard set of leave types, which they can edit
  perform public.seed_default_leave_types(v_tenant);

  -- their first membership makes it their current company; with existing ones, switch to the new one
  insert into public.memberships (user_id, tenant_id, role, account_status)
  values (auth.uid(), v_tenant, 'ADMIN', 'ACTIVE');
  update public.user_profiles
    set tenant_id = v_tenant, role = 'ADMIN', account_status = 'ACTIVE'
    where user_id = auth.uid();

  return v_tenant;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- scheduling (best effort, like the other leave jobs): earn on the 1st, remind on the 1st and 15th
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('leave-monthly-accrual', '0 0 1 * *',
      $c$select public.run_leave_accrual(extract(year from current_date)::int, extract(month from current_date)::int);$c$);
    perform cron.schedule('leave-year-end-reminders', '0 6 1,15 * *', $c$select public.run_leave_year_end_reminders();$c$);
  else
    raise notice 'pg_cron is not available: run "Earn this month" and the reminders from the Leave page instead.';
  end if;
end $$;

notify pgrst, 'reload schema';
