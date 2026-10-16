-- Tell payroll and HR when a casual worker nears the limit of continuous casual work (FIG-893, Employment Act s.37),
-- in the HR bell and by email (FIG-890; casual_limit goes to people with Work & Piece Rate or Payroll, and ADMIN).
-- Once per run of working days: when a day is recorded that brings the casual's latest run to within 5 days of the
-- company's limit (company_payroll_settings.casual_day_limit, default 30). The same counting as casual_limit_alerts():
-- a gap of up to 2 days without work doesn't end a run.

-- the casual's latest run of working days: how many, and the day it started
create or replace function public.casual_latest_run(p_tenant uuid, p_employee text)
returns table (days integer, since date)
language sql stable security definer set search_path = public as $$
  with worked as (
    select d.work_date from public.casual_days d
    where d.tenant_id = p_tenant and d.employee_number = p_employee and d.portion in ('full', 'half')
  ), marked as (
    select w.work_date, case when w.work_date - lag(w.work_date) over (order by w.work_date) <= 3 then 0 else 1 end as breaks
    from worked w
  ), grouped as (
    select m.work_date, sum(m.breaks) over (order by m.work_date) as grp from marked m
  )
  select count(*)::int, min(g.work_date) from grouped g
  where g.grp = (select max(grp) from grouped)
$$;
revoke all on function public.casual_latest_run(uuid, text) from public, anon, authenticated;

create or replace function public.casual_days_limit_alert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_limit integer;
  e public.employees;
  who text;
begin
  if new.portion not in ('full', 'half') then
    return null;
  end if;
  select coalesce((select s.casual_day_limit from public.company_payroll_settings s where s.tenant_id = new.tenant_id), 30)
  into v_limit;
  select * into r from public.casual_latest_run(new.tenant_id, new.employee_number);
  if r.days is null or r.days <= v_limit - 5 then
    return null;
  end if;
  -- once per run (end_date = the day the run started)
  if exists (select 1 from public.hr_notifications n
             where n.tenant_id = new.tenant_id and n.employee_number = new.employee_number
               and n.notification_type = 'casual_limit' and n.end_date = r.since) then
    return null;
  end if;
  select * into e from public.employees where tenant_id = new.tenant_id and "Employee Number" = new.employee_number;
  if coalesce(e.worker_kind, 'employee') <> 'casual' then
    return null;
  end if;
  who := coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), new.employee_number);
  insert into public.hr_notifications (tenant_id, employee_number, employee_name, work_email, notification_type, title, message,
                                       end_date, days_remaining)
  values (new.tenant_id, new.employee_number, who, e."Work Email", 'casual_limit',
    case when r.days > v_limit then 'Casual worker over the day limit' else 'Casual worker near the day limit' end,
    who || ' has worked ' || r.days || ' days in a row as a casual (since ' || to_char(r.since, 'DD Mon YYYY')
    || '; your limit is ' || v_limit || '). Past about a month of continuous work the law treats them as on a monthly '
    || 'contract: put them on a contract, or give them a break. See Casual workers.',
    r.since, greatest(v_limit - r.days, 0));
  return null;
end $$;
drop trigger if exists casual_days_limit_alert on public.casual_days;
create trigger casual_days_limit_alert after insert or update of portion on public.casual_days
  for each row execute function public.casual_days_limit_alert();

notify pgrst, 'reload schema';
