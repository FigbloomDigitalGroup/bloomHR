-- Leave rules each company sets per leave type, checked in the database (FIG-875).
--
-- Before this, nothing checked the balance: an application could be for any number of days, approving it deducted
-- the days from the browser (so a balance could go negative, or be missed if the page closed), and the only rule was
-- "one application per leave type per month", checked in the staff portal only. The two forms also counted days
-- differently (the staff portal calendar days, the Leave page working days less holidays).
--
--   1. New settings on the leave type's policy (Leave > leave type > edit):
--        max_days_per_request  - most days one application may ask for (null = no limit: all of it at once is fine)
--        min_notice_days       - how many days ahead an employee must apply (0 = none; past dates are then allowed too,
--                                as for sick leave applied for afterwards)
--        balance_rule          - 'earned'    only days earned so far (for leave earned month by month)
--                                'full_year' up to the whole year's allowance, even before it is earned (the default)
--                                'none'      no limit; the balance may go below zero
--        count_days            - 'working' (Mon-Fri less the company's holidays) or 'calendar' (every day)
--        one_per_month         - at most one application for this leave type each calendar month (off by default)
--   2. leave_days_between counts the days a leave covers, the same way for every form.
--   3. A new application is checked when it is made (leave_application_check): the days are worked out here (whatever
--      the form sent), and an employee applying for themselves must keep to every rule. HR (the leaves module)
--      entering leave for someone else may skip the notice, per-request and once-a-month rules, but not the balance.
--      Rows written without a signed-in user (the service role, migrations) are not checked.
--      leave_request_check(...) gives the forms the same answer before anyone presses submit.
--   4. The balance moves when the application is finally approved (by the approval chain, or entered already
--      approved): checked against the balance rule, then deducted - in the same transaction, so an approval that
--      would overdraw is refused. If approved leave is later rejected, the days go back.
--      increment_leave_balance_used_days, which the Leave page called after approving, now changes nothing, so a page
--      loaded before this cannot deduct a second time.

-- ---------------------------------------------------------------------------------------------
-- 1. policy settings
-- ---------------------------------------------------------------------------------------------
alter table public.leave_policies add column if not exists max_days_per_request numeric;
alter table public.leave_policies add column if not exists min_notice_days integer not null default 0;
alter table public.leave_policies add column if not exists balance_rule text not null default 'full_year';
alter table public.leave_policies add column if not exists count_days text not null default 'working';
alter table public.leave_policies add column if not exists one_per_month boolean not null default false;

alter table public.leave_policies drop constraint if exists leave_policies_rules_check;
alter table public.leave_policies
  add constraint leave_policies_rules_check check (
    (max_days_per_request is null or max_days_per_request > 0)
    and min_notice_days >= 0
    and balance_rule in ('earned', 'full_year', 'none')
    and count_days in ('working', 'calendar')
  );

-- maternity and paternity leave run in calendar days (Employment Act: three months, two weeks); the rest in working days
update public.leave_policies p set count_days = 'calendar'
from public.leave_types t
where t.id = p.leave_type_id and (t.name ilike 'maternity%' or t.name ilike 'paternity%');

-- the view froze its column list before these columns existed
drop view if exists public.current_leave_policies;
create view public.current_leave_policies as
select distinct on (leave_type_id) *
from public.leave_policies
where effective_from <= current_date
order by leave_type_id, effective_from desc;
alter view public.current_leave_policies set (security_invoker = true);

-- new companies: maternity and paternity in calendar days
create or replace function public.leave_policies_default_count_days() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.count_days = 'working'
     and exists (select 1 from public.leave_types t
                 where t.id = new.leave_type_id and (t.name ilike 'maternity%' or t.name ilike 'paternity%'))
     and not exists (select 1 from public.leave_policies p where p.leave_type_id = new.leave_type_id) then
    new.count_days := 'calendar';
  end if;
  return new;
end $$;
drop trigger if exists leave_policies_default_count_days on public.leave_policies;
create trigger leave_policies_default_count_days before insert on public.leave_policies
  for each row execute function public.leave_policies_default_count_days();

alter table public.leave_balance_adjustments drop constraint if exists leave_balance_adjustments_change_type_check;
alter table public.leave_balance_adjustments
  add constraint leave_balance_adjustments_change_type_check
  check (change_type in ('approval_deduction', 'approval_reversal', 'annual_reset', 'monthly_reset', 'monthly_accrual', 'allowance_change'));

-- ---------------------------------------------------------------------------------------------
-- 2. counting days
-- ---------------------------------------------------------------------------------------------

-- "Start Date" and "End Date" are text: a date, or null when it is not one
create or replace function public.leave_parse_date(p text) returns date
language plpgsql immutable as $$
begin
  return nullif(btrim(p), '')::date;
exception when others then
  return null;
end $$;

-- days a leave from p_start to p_end covers, both ends included: every day, or Monday to Friday less the company's
-- holidays (a recurring holiday falls on the same day every year)
create or replace function public.leave_days_between(p_tenant uuid, p_start date, p_end date, p_calendar boolean)
returns integer
language sql stable security definer set search_path = public as $$
  select case
    when p_start is null or p_end is null or p_end < p_start then 0
    when p_calendar then (p_end - p_start) + 1
    else (
      select count(*)::int
      from generate_series(p_start, p_end, interval '1 day') g(d)
      where extract(isodow from g.d) < 6
        and not exists (
          select 1 from public.holidays h
          where h.tenant_id = p_tenant and h.date is not null
            and (h.date = g.d::date
                 or (coalesce(h.recurring, false) and to_char(h.date, 'MM-DD') = to_char(g.d, 'MM-DD'))))
    )
  end
$$;
revoke all on function public.leave_days_between(uuid, date, date, boolean) from public, anon;
grant execute on function public.leave_days_between(uuid, date, date, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. what is left, and the rules
-- ---------------------------------------------------------------------------------------------

-- the balance row an application draws on: the start date's year, and its month for leave that resets monthly
create or replace function public.leave_bucket_month(p_method text, p_start date) returns integer
language sql immutable as $$
  select case when p_method = 'monthly_non_cumulative' then extract(month from p_start)::int else 0 end
$$;

/**
 * Days one employee can still take of a leave type in the year (and month, for leave that resets monthly) under the
 * policy's balance rule. Null when there is no limit: the type is not taken from a balance, has no allowance, or
 * its balance rule is 'none'.
 */
create or replace function public.leave_available(p_tenant uuid, p_employee text, p_type uuid, p_year integer, p_month integer)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  t public.leave_types;
  pol record;
  b public.leave_balances;
  v_yearly numeric;
  v_allowance numeric;
begin
  select * into t from public.leave_types where id = p_type and tenant_id = p_tenant;
  select * into pol from public.current_leave_policies where leave_type_id = p_type;
  if t.id is null or not coalesce(t.is_deductible, true) or pol.leave_type_id is null
     or pol.accrual_method = 'none' or pol.days_allotted is null or pol.balance_rule = 'none' then
    return null;
  end if;
  v_yearly := public.leave_entitlement(p_tenant, p_employee, p_type, pol.days_allotted);
  select * into b from public.leave_balances
  where employee_number = p_employee and leave_type_id = p_type and year = p_year and month = p_month;

  if pol.accrual_method = 'monthly_cumulative' then
    v_allowance := case when pol.balance_rule = 'earned'
                        then coalesce(b.accrued_days, public.leave_earned_to_date(v_yearly, public.leave_months_earned(p_year)))
                        else greatest(v_yearly, coalesce(b.accrued_days, 0)) end;
  else
    v_allowance := coalesce(b.accrued_days, v_yearly);
  end if;
  return v_allowance + coalesce(b.carried_over_days, 0) - coalesce(b.used_days, 0);
end $$;
revoke all on function public.leave_available(uuid, text, uuid, integer, integer) from public, anon, authenticated;

/**
 * Checks an application before it is made. p_self: the employee is applying for themselves, so the notice,
 * per-request and once-a-month rules apply (HR entering leave for someone may skip those, never the balance).
 * p_exclude: an application to leave out of the counts (the one being checked). Returns the days the leave covers,
 * the days still free to book (after other pending applications; null = no limit) and what is wrong, if anything.
 */
create or replace function public.leave_request_problems(
  p_tenant uuid, p_employee text, p_type text, p_start date, p_end date, p_self boolean, p_exclude uuid default null
) returns table (days integer, available numeric, problems text[])
language plpgsql stable security definer set search_path = public as $$
declare
  t public.leave_types;
  pol record;
  v_days integer := 0;
  v_free numeric;
  v_pending numeric;
  v_month integer;
  v_problems text[] := '{}';
begin
  select * into t from public.leave_types lt where lt.tenant_id = p_tenant and lt.name = btrim(coalesce(p_type, ''));
  if t.id is null then
    return query select 0, null::numeric, array['Choose a leave type'];
    return;
  end if;
  select * into pol from public.current_leave_policies where leave_type_id = t.id;

  if p_start is null or p_end is null or p_end < p_start then
    return query select 0, null::numeric, array['Choose a start date, and an end date that is the same day or later'];
    return;
  end if;

  v_days := public.leave_days_between(p_tenant, p_start, p_end, coalesce(pol.count_days, 'working') = 'calendar');
  if v_days = 0 then
    return query select 0, null::numeric, array['Those dates are all weekends or public holidays, so no leave is needed'];
    return;
  end if;

  if p_self and pol.leave_type_id is not null then
    if pol.max_days_per_request is not null and v_days > pol.max_days_per_request then
      v_problems := v_problems || format('%s allows at most %s days in one application (this is %s)',
        t.name, trim_scale(pol.max_days_per_request), v_days);
    end if;
    if pol.min_notice_days > 0 and p_start < current_date + pol.min_notice_days then
      v_problems := v_problems || format('%s needs %s days'' notice: the earliest start date is %s',
        t.name, pol.min_notice_days, to_char(current_date + pol.min_notice_days, 'DD Mon YYYY'));
    end if;
    if pol.one_per_month and exists (
      select 1 from public.leave_application a
      where a.tenant_id = p_tenant and a."Employee Number" = p_employee and a."Leave Type" = t.name
        and a.id is distinct from p_exclude
        and lower(coalesce(a.status, 'pending')) not in ('rejected', 'cancelled')
        and date_trunc('month', a.time_added) = date_trunc('month', now())) then
      v_problems := v_problems || format('You have already applied for %s this month', t.name);
    end if;
  end if;

  v_month := public.leave_bucket_month(pol.accrual_method, p_start);
  v_free := public.leave_available(p_tenant, p_employee, t.id, extract(year from p_start)::int, v_month);
  if v_free is not null then
    -- days already asked for and still waiting, from the same balance
    select coalesce(sum(a.days), 0) into v_pending
    from public.leave_application a
    where a.tenant_id = p_tenant and a."Employee Number" = p_employee and a."Leave Type" = t.name
      and a.id is distinct from p_exclude
      and lower(coalesce(a.status, 'pending')) = 'pending'
      and extract(year from public.leave_parse_date(a."Start Date")) = extract(year from p_start)
      and (v_month = 0 or extract(month from public.leave_parse_date(a."Start Date")) = v_month);
    v_free := v_free - v_pending;
    if v_days > v_free then
      v_problems := v_problems || format('Not enough %s left: %s day%s free to book%s, and this needs %s',
        t.name, trim_scale(greatest(v_free, 0)), case when greatest(v_free, 0) = 1 then '' else 's' end,
        case when v_pending > 0 then format(' (%s more waiting for approval)', trim_scale(v_pending)) else '' end,
        v_days);
    end if;
  end if;

  return query select v_days, v_free, v_problems;
end $$;
revoke all on function public.leave_request_problems(uuid, text, text, date, date, boolean, uuid) from public, anon, authenticated;

-- for the forms: the same check an application gets when it is made, for one's own leave or (with the leaves
-- module) a colleague's
create or replace function public.leave_request_check(p_employee_number text, p_leave_type text, p_start text, p_end text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_self boolean := public.current_employee_number() is not distinct from p_employee_number;
  r record;
begin
  if not v_self and not public.has_module('leaves') then
    raise exception 'You can only check your own leave' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees e where e.tenant_id = v_tenant and e."Employee Number" = p_employee_number) then
    raise exception 'No such employee' using errcode = '22023';
  end if;
  select * into r from public.leave_request_problems(v_tenant, p_employee_number, p_leave_type,
    public.leave_parse_date(p_start), public.leave_parse_date(p_end), v_self);
  return jsonb_build_object('days', r.days, 'available', r.available, 'problems', to_jsonb(r.problems));
end $$;
revoke all on function public.leave_request_check(text, text, text, text) from public, anon;
grant execute on function public.leave_request_check(text, text, text, text) to authenticated;

-- a new application: work out its days, and (from a signed-in user) refuse it if it breaks a rule
create or replace function public.leave_application_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_self boolean;
begin
  if auth.uid() is null then
    -- the service role and migrations: only fill in the days when the type and dates make sense
    select * into r from public.leave_request_problems(new.tenant_id, new."Employee Number", new."Leave Type",
      public.leave_parse_date(new."Start Date"), public.leave_parse_date(new."End Date"), false, new.id);
    if r.days > 0 then
      new.days := r.days;
    end if;
    return new;
  end if;

  v_self := public.current_employee_number() is not distinct from new."Employee Number" or not public.has_module('leaves');
  select * into r from public.leave_request_problems(new.tenant_id, new."Employee Number", new."Leave Type",
    public.leave_parse_date(new."Start Date"), public.leave_parse_date(new."End Date"), v_self, new.id);
  -- leave entered already approved takes the balance as it is saved (below), with the same balance check
  if lower(coalesce(new.status, 'pending')) = 'approved' then
    r.problems := array(select p from unnest(r.problems) p where p not like 'Not enough %');
  end if;
  if cardinality(r.problems) > 0 then
    raise exception '%', array_to_string(r.problems, '. ') using errcode = 'P0001';
  end if;
  new.days := r.days;
  return new;
end $$;
drop trigger if exists leave_application_check on public.leave_application;
create trigger leave_application_check before insert on public.leave_application
  for each row execute function public.leave_application_check();

-- ---------------------------------------------------------------------------------------------
-- 4. the balance moves on approval
-- ---------------------------------------------------------------------------------------------

/**
 * Takes an approved application's days from its balance (p_sign 1), or gives them back (p_sign -1). Taking is
 * refused when the balance rule leaves too few days. Applications whose leave type or start date can't be
 * matched, and leave types not taken from a balance, are left alone (as the Leave page did).
 */
create or replace function public.leave_take(p_app public.leave_application, p_sign integer)
returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.leave_types;
  pol record;
  v_start date := public.leave_parse_date(p_app."Start Date");
  v_year integer;
  v_month integer;
  v_days numeric := coalesce(p_app.days, 0);
  v_free numeric;
  v_yearly numeric;
  v_seed numeric;
  v_before public.leave_balances;
  v_after public.leave_balances;
begin
  select * into t from public.leave_types where tenant_id = p_app.tenant_id and name = btrim(coalesce(p_app."Leave Type", ''));
  if t.id is null or not coalesce(t.is_deductible, true) or v_start is null or v_days <= 0 then
    return;
  end if;
  select * into pol from public.current_leave_policies where leave_type_id = t.id;
  if pol.leave_type_id is null or pol.accrual_method = 'none' then
    return;
  end if;
  v_year := extract(year from v_start)::int;
  v_month := public.leave_bucket_month(pol.accrual_method, v_start);

  if p_sign > 0 then
    v_free := public.leave_available(p_app.tenant_id, p_app."Employee Number", t.id, v_year, v_month);
    if v_free is not null and v_days > v_free then
      raise exception 'Not enough % left for %: % day% free, and this leave needs %. Change the allowance in Balances, or the leave type''s balance rule',
        t.name, coalesce(nullif(btrim(p_app.name), ''), p_app."Employee Number"), trim_scale(greatest(v_free, 0)),
        case when greatest(v_free, 0) = 1 then '' else 's' end, trim_scale(v_days)
        using errcode = 'P0001';
    end if;
  end if;

  select * into v_before from public.leave_balances
  where employee_number = p_app."Employee Number" and leave_type_id = t.id and year = v_year and month = v_month;

  v_yearly := public.leave_entitlement(p_app.tenant_id, p_app."Employee Number", t.id, pol.days_allotted);
  v_seed := case when pol.accrual_method = 'monthly_cumulative'
                 then public.leave_earned_to_date(v_yearly, public.leave_months_earned(v_year))
                 else v_yearly end;

  insert into public.leave_balances (tenant_id, employee_number, leave_type_id, year, month, accrued_days, used_days)
  values (p_app.tenant_id, p_app."Employee Number", t.id, v_year, v_month, v_seed, greatest(p_sign * v_days, 0))
  on conflict (employee_number, leave_type_id, year, month)
  do update set used_days = greatest(public.leave_balances.used_days + p_sign * v_days, 0), updated_at = now()
  returning * into v_after;

  insert into public.leave_balance_adjustments
    (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
  values
    (p_app.tenant_id, v_after.id, case when p_sign > 0 then 'approval_deduction' else 'approval_reversal' end,
     v_after.used_days - coalesce(v_before.used_days, 0),
     coalesce(v_before.used_days, 0), v_after.used_days,
     coalesce(v_before.accrued_days, v_after.accrued_days), v_after.accrued_days,
     case when p_sign > 0 then 'Leave application approved' else 'Approved leave application no longer approved' end);
end $$;
revoke all on function public.leave_take(public.leave_application, integer) from public, anon, authenticated;

create or replace function public.leave_application_balance() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  was boolean := tg_op = 'UPDATE' and lower(coalesce(old.status, '')) = 'approved';
  now_approved boolean := lower(coalesce(new.status, '')) = 'approved';
begin
  if now_approved and not was then
    perform public.leave_take(new, 1);
  elsif was and not now_approved then
    perform public.leave_take(old, -1);
  end if;
  return null;
end $$;
drop trigger if exists leave_application_balance on public.leave_application;
create trigger leave_application_balance after insert or update of status on public.leave_application
  for each row execute function public.leave_application_balance();

-- the Leave page called this after approving; the database now does it, so a page loaded before this changes nothing
drop function if exists public.increment_leave_balance_used_days(text, uuid, integer, numeric, integer);
create or replace function public.increment_leave_balance_used_days(
  p_employee_number text,
  p_leave_type_id uuid,
  p_year integer,
  p_days numeric,
  p_month integer default 0
) returns public.leave_balances
language sql stable
as $$
  select * from public.leave_balances
  where employee_number = p_employee_number and leave_type_id = p_leave_type_id and year = p_year and month = p_month
$$;
grant execute on function public.increment_leave_balance_used_days(text, uuid, integer, numeric, integer) to authenticated;

notify pgrst, 'reload schema';
