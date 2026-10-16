-- Full-pay then half-pay days on a leave type, e.g. sick leave: 30 days at full pay, then 15 at half pay (FIG-879).
--
--   leave_policies.half_pay_days      days a year at half pay once the full-pay days are used (0 = none)
--   leave_application.half_pay_days   how many of an approved application's days are at half pay, worked out as its
--                                     balance is taken (payroll deducts half a day's pay for each, FIG-880)
-- The balance counts both: what is left is the full-pay days left plus the half-pay days left. Once both are used the
-- leave is refused, with a pointer to annual leave. Days come off full pay first.

alter table public.leave_policies add column if not exists half_pay_days numeric not null default 0;
alter table public.leave_policies drop constraint if exists leave_policies_half_pay_check;
alter table public.leave_policies add constraint leave_policies_half_pay_check check (half_pay_days >= 0 and half_pay_days <= 366);

drop view if exists public.current_leave_policies;
create view public.current_leave_policies as
select distinct on (leave_type_id) *
from public.leave_policies
where effective_from <= current_date
order by leave_type_id, effective_from desc;
alter view public.current_leave_policies set (security_invoker = true);

alter table public.leave_application add column if not exists half_pay_days numeric not null default 0;

-- the half-pay days a leave type gives (0 when none, or when the balance isn't limited)
create or replace function public.leave_half_pay_allowance(p_type uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select case when p.balance_rule = 'none' then 0 else p.half_pay_days end
                   from public.current_leave_policies p where p.leave_type_id = p_type), 0)
$$;
revoke all on function public.leave_half_pay_allowance(uuid) from public, anon, authenticated;

-- what is left now includes the half-pay days
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

  if pol.accrual_method = 'monthly_cumulative' and pol.balance_rule = 'full_year' then
    v_allowance := greatest(public.leave_year_allowance(p_tenant, p_employee, v_yearly, p_year, 12), coalesce(b.accrued_days, 0));
  else
    v_allowance := coalesce(b.accrued_days, public.leave_seed_days(p_tenant, p_employee, pol.accrual_method, v_yearly, p_year));
  end if;
  return v_allowance + coalesce(b.carried_over_days, 0) + coalesce(pol.half_pay_days, 0) - coalesce(b.used_days, 0);
end $$;
revoke all on function public.leave_available(uuid, text, uuid, integer, integer) from public, anon, authenticated;

-- taking the balance also records how many of the days are at half pay
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
  v_half numeric := 0;
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
      raise exception 'Not enough % left for %: % day% free, and this leave needs %.%',
        t.name, coalesce(nullif(btrim(p_app.name), ''), p_app."Employee Number"), trim_scale(greatest(v_free, 0)),
        case when greatest(v_free, 0) = 1 then '' else 's' end, trim_scale(v_days),
        case when public.leave_half_pay_allowance(t.id) > 0
             then ' Its full-pay and half-pay days are used: they can apply for annual leave instead'
             else ' Change the allowance in Balances, or the leave type''s balance rule' end
        using errcode = 'P0001';
    end if;
    -- full-pay days first; what goes past them is at half pay
    if v_free is not null then
      v_half := least(v_days, greatest(v_days - greatest(v_free - public.leave_half_pay_allowance(t.id), 0), 0));
    end if;
  end if;

  select * into v_before from public.leave_balances
  where employee_number = p_app."Employee Number" and leave_type_id = t.id and year = v_year and month = v_month;

  v_seed := public.leave_seed_days(p_app.tenant_id, p_app."Employee Number", pol.accrual_method,
    public.leave_entitlement(p_app.tenant_id, p_app."Employee Number", t.id, pol.days_allotted), v_year);

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
     case when p_sign > 0 then 'Leave application approved' else 'Approved leave application no longer approved' end
       || case when v_half > 0 then format(' (%s at half pay)', trim_scale(v_half)) else '' end);

  update public.leave_application set half_pay_days = case when p_sign > 0 then v_half else 0 end where id = p_app.id;
end $$;
revoke all on function public.leave_take(public.leave_application, integer) from public, anon, authenticated;

-- the forms are told how many of the days would be at half pay
create or replace function public.leave_request_check(
  p_employee_number text, p_leave_type text, p_start text, p_end text, p_half boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_self boolean := public.current_employee_number() is not distinct from p_employee_number;
  r record;
  v_type uuid;
  v_halfpay numeric := 0;
  v_at_half numeric := 0;
begin
  if not v_self and not public.has_module('leaves') then
    raise exception 'You can only check your own leave' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees e where e.tenant_id = v_tenant and e."Employee Number" = p_employee_number) then
    raise exception 'No such employee' using errcode = '22023';
  end if;
  select * into r from public.leave_request_problems(v_tenant, p_employee_number, p_leave_type,
    public.leave_parse_date(p_start), public.leave_parse_date(p_end), v_self, null, coalesce(p_half, false));
  select id into v_type from public.leave_types where tenant_id = v_tenant and name = btrim(coalesce(p_leave_type, ''));
  if v_type is not null then
    v_halfpay := public.leave_half_pay_allowance(v_type);
  end if;
  if v_halfpay > 0 and r.available is not null and r.days > 0 then
    v_at_half := least(r.days, greatest(r.days - greatest(r.available - v_halfpay, 0), 0));
  end if;
  return jsonb_build_object('days', r.days, 'available', r.available, 'problems', to_jsonb(r.problems),
    'document', public.leave_document_needed(v_tenant, p_leave_type, r.days),
    'half_pay_days', trim_scale(v_at_half),
    'full_pay_left', case when v_halfpay > 0 and r.available is not null then trim_scale(greatest(r.available - v_halfpay, 0)) end,
    'half_pay_left', case when v_halfpay > 0 and r.available is not null then trim_scale(least(v_halfpay, greatest(r.available, 0))) end);
end $$;

notify pgrst, 'reload schema';
