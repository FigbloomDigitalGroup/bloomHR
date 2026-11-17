-- A manager sets their team's KPIs without waiting for HR.
--
-- Before: a manager (someone people report to, supervised_employee_numbers()) could give their reports KPIs, but only
-- from the KPI library and in a review period, and only HR (manages_kpis()) could add either. In a company where HR had
-- not set up Performance yet, a department head opening My team > KPIs met "No review periods yet" and could do nothing.
--
-- Now a manager may also:
--   - start the current quarter's review ("Q4 2026", open) when no review period covers today
--     (start_current_kpi_period()). It is the company's period, as if HR had made it: HR renames, moves or closes it as
--     before. A period covering today that is still being set up (draft) or open is returned instead, and a closed one
--     is never reopened by a manager.
--   - add KPIs to the company's library, and change or archive the ones they added. HR's KPIs stay HR's.
-- Giving the KPIs to people is unchanged: a manager reaches only their own reports (assign_kpi(), kpi_assignments).
--
-- Written to run again safely.

-- someone reports to the signed-in person
create or replace function public.manages_a_team() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from public.supervised_employee_numbers())
$$;
revoke all on function public.manages_a_team() from public, anon;
grant execute on function public.manages_a_team() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 1. the current quarter's review
-- ---------------------------------------------------------------------------------------------
create or replace function public.start_current_kpi_period() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_today date := current_date;
  v_start date := date_trunc('quarter', current_date)::date;
  v_end date := (date_trunc('quarter', current_date) + interval '3 months - 1 day')::date;
  v_name text := 'Q' || extract(quarter from current_date)::int || ' ' || extract(year from current_date)::int;
  v_id uuid;
begin
  if v_tenant is null or not (public.manages_kpis() or public.manages_a_team()) then
    raise exception 'Only HR or a manager can start a review period' using errcode = '42501';
  end if;

  -- one already covers today: use it
  select id into v_id from public.kpi_periods
  where tenant_id = v_tenant and status <> 'closed' and starts_on <= v_today and ends_on >= v_today
  order by (status = 'open') desc, starts_on desc limit 1;
  if v_id is not null then
    return v_id;
  end if;

  select id into v_id from public.kpi_periods where tenant_id = v_tenant and lower(btrim(name)) = lower(v_name);
  if v_id is not null then
    raise exception 'The % review is closed: ask HR to reopen it', v_name using errcode = '42501';
  end if;

  insert into public.kpi_periods (tenant_id, name, starts_on, ends_on, status)
  values (v_tenant, v_name, v_start, v_end, 'open')
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.start_current_kpi_period() from public, anon;
grant execute on function public.start_current_kpi_period() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. the library: managers add KPIs and change their own
-- ---------------------------------------------------------------------------------------------
drop policy if exists manager_insert on public.kpis;
create policy manager_insert on public.kpis for insert to authenticated
  with check ((select public.manages_a_team()) and created_by = (select auth.uid()));
drop policy if exists manager_update on public.kpis;
create policy manager_update on public.kpis for update to authenticated
  using ((select public.manages_a_team()) and created_by = (select auth.uid()))
  with check ((select public.manages_a_team()) and created_by = (select auth.uid()));

notify pgrst, 'reload schema';
