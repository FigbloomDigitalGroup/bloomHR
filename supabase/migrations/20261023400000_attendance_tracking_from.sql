-- The day attendance starts counting (FIG-986).
--
-- Clock in / clock out (20261023300000) arrived on a working day like any other, so every working day before it showed
-- everyone as absent: nobody could have clocked in. Each company now has the day attendance counts from:
--
--   attendance_settings(tenant_id, tracking_from)   working days before tracking_from are not marked absent (their
--                                                    status is left empty, like a day not over yet); clock-ins on them
--                                                    still show. Companies that already exist start counting today;
--                                                    a company with no row counts from the day it was created. HR (the
--                                                    Employees or HR Lifecycle module) and Settings change it.
--   attendance_tracking_from(tenant)                that day, for attendance_days_for (and the KPIs calculated from it).
--
-- attendance_days_for is 20261023300000's, plus that rule. Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. the setting
-- ---------------------------------------------------------------------------------------------
create table if not exists public.attendance_settings (
  tenant_id uuid primary key default public.current_tenant_id() references public.tenants(id) on delete cascade,
  tracking_from date not null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- the companies already here start counting today (Nairobi), once: running again changes nothing, and a company added
-- since keeps counting from the day it was created
insert into public.attendance_settings (tenant_id, tracking_from)
select t.id, (now() at time zone 'Africa/Nairobi')::date from public.tenants t
where not exists (select 1 from public.attendance_settings)
on conflict (tenant_id) do nothing;

create or replace function public.attendance_settings_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.tenant_id := old.tenant_id;
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.attendance_settings_rules() from public, anon, authenticated;
drop trigger if exists attendance_settings_rules on public.attendance_settings;
create trigger attendance_settings_rules before insert or update on public.attendance_settings
  for each row execute function public.attendance_settings_rules();

alter table public.attendance_settings enable row level security;
drop policy if exists tenant_isolation on public.attendance_settings;
create policy tenant_isolation on public.attendance_settings as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists members_read on public.attendance_settings;
create policy members_read on public.attendance_settings for select to authenticated using (true);
drop policy if exists hr_write on public.attendance_settings;
create policy hr_write on public.attendance_settings for all to authenticated
  using ((select public.manages_attendance()) or (select public.has_module('settings')))
  with check ((select public.manages_attendance()) or (select public.has_module('settings')));
revoke all on public.attendance_settings from anon;
revoke truncate on public.attendance_settings from authenticated;
grant select, insert, update, delete on public.attendance_settings to authenticated;

-- the day a company's attendance counts from: its setting, else the day it was created
create or replace function public.attendance_tracking_from(p_tenant uuid) returns date
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.tracking_from from public.attendance_settings s where s.tenant_id = p_tenant),
    (select (t.created_at at time zone 'Africa/Nairobi')::date from public.tenants t where t.id = p_tenant))
$$;
revoke all on function public.attendance_tracking_from(uuid) from public, anon;
grant execute on function public.attendance_tracking_from(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. the days: not absent before attendance counts
-- ---------------------------------------------------------------------------------------------
-- (20261023300000's, plus: a working day before attendance_tracking_from with no clock-in is left empty, not absent)
create or replace function public.attendance_days_for(
  p_tenant uuid, p_from date, p_to date, p_employee text default null, p_today date default null
) returns table (
  employee_number text, day date, status text, clock_in timestamptz, clock_out timestamptz, hours numeric,
  late_minutes integer, source text, note text
)
language sql stable security definer set search_path = public as $$
  with people as (
    select e."Employee Number" as emp,
           public.employee_start_date(e."Start Date") as hired,
           public.employee_start_date(e."Termination Date") as left_on,
           public.employee_country(p_tenant, e."Employee Number") as country,
           s.work_days, s.start_time, s.grace_minutes
    from public.employees e
    cross join lateral public.work_schedule_for(p_tenant, e."Employee Number") s
    where e.tenant_id = p_tenant
      and (p_employee is null or e."Employee Number" = p_employee)
      and coalesce(e.worker_kind, 'employee') <> 'casual'
      -- still here, or left during (or after) the range
      and (lower(coalesce(e."Status", 'active')) not in ('terminated', 'inactive')
           or public.employee_start_date(e."Termination Date") >= p_from)
  ),
  days as (
    select g::date as day from generate_series(p_from, p_to, interval '1 day') g
  ),
  counting as (
    select public.attendance_tracking_from(p_tenant) as from_day
  ),
  grid as (
    select p.*, d.day,
           (extract(isodow from d.day)::smallint = any (p.work_days)) as working,
           public.is_holiday(p_tenant, p.country, d.day) as holiday,
           exists (
             select 1 from public.leave_application l
             where l.tenant_id = p_tenant and l."Employee Number" = p.emp
               and lower(coalesce(l.status, '')) = 'approved'
               and public.leave_parse_date(l."Start Date") <= d.day
               and public.leave_parse_date(l."End Date") >= d.day
           ) as on_leave,
           a.login_time, a.logout_time, a.source, a.note,
           date_trunc('minute', a.login_time at time zone 'Africa/Nairobi') as in_local
    from people p
    cross join days d
    left join public.attendance_logs a
      on a.tenant_id = p_tenant and a.employee_number = p.emp and a.work_date = d.day and a.source <> 'legacy'
    where (p.hired is null or d.day >= p.hired)
      and (p.left_on is null or d.day <= p.left_on)
  )
  select g.emp,
         g.day,
         case
           when not g.working then 'off'
           when g.holiday then 'holiday'
           when g.on_leave then 'leave'
           when g.login_time is not null then
             case when g.in_local > g.day + g.start_time + make_interval(mins => g.grace_minutes) then 'late' else 'present' end
           when g.day < coalesce(p_today, (now() at time zone 'Africa/Nairobi')::date)
                and (c.from_day is null or g.day >= c.from_day) then 'absent'
           else null
         end,
         g.login_time,
         g.logout_time,
         case when g.login_time is not null and g.logout_time is not null
              then round((extract(epoch from (g.logout_time - g.login_time)) / 3600.0)::numeric, 2) end,
         case
           when g.login_time is null then null
           when g.working and not g.holiday and not g.on_leave
                and g.in_local > g.day + g.start_time + make_interval(mins => g.grace_minutes)
             then (extract(epoch from (g.in_local - (g.day + g.start_time))) / 60)::integer
           else 0
         end,
         g.source,
         g.note
  from grid g
  cross join counting c
  order by g.emp, g.day
$$;
revoke all on function public.attendance_days_for(uuid, date, date, text, date) from public, anon, authenticated;

notify pgrst, 'reload schema';
