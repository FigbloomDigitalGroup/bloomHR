-- Salary advances: the longest a company lets staff take to repay one.
--
--   * salary_advance_settings.max_repayment_months: 1 to 12, 6 by default (what the request form offered until now).
--     1 means every advance comes off the pay of the month it was asked for, so staff aren't offered more.
--   * salary_advance_terms(): what the staff request form needs from the settings (open or closed, the closed
--     message, the longest repayment). Staff can't read salary_advance_settings itself (the 'salaryadmin' and
--     'settings' modules only), so until now the form never saw a closed window either.
--   * A new request over the limit is refused. Requests already made keep their terms.

alter table public.salary_advance_settings add column if not exists max_repayment_months integer not null default 6;
alter table public.salary_advance_settings drop constraint if exists salary_advance_settings_max_repayment_months_check;
alter table public.salary_advance_settings add constraint salary_advance_settings_max_repayment_months_check
  check (max_repayment_months between 1 and 12);

create or replace function public.salary_advance_terms()
returns table (applications_active boolean, custom_message text, max_repayment_months integer)
language sql stable security definer set search_path = public as $$
  select coalesce(s.applications_active, true), s.custom_message, coalesce(s.max_repayment_months, 6)
  from (select 1) one
  left join public.salary_advance_settings s on s.tenant_id = public.current_tenant_id() and s.id = 1;
$$;
revoke all on function public.salary_advance_terms() from public, anon;
grant execute on function public.salary_advance_terms() to authenticated;

create or replace function public.salary_advance_months_within_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_max integer;
begin
  select s.max_repayment_months into v_max
  from public.salary_advance_settings s where s.tenant_id = new.tenant_id and s.id = 1;
  v_max := coalesce(v_max, 6);
  if coalesce(new.repayment_months, 1) > v_max then
    raise exception '%', case when v_max = 1 then 'Advances here are repaid in one month.'
                              else 'Advances here are repaid within ' || v_max || ' months. Choose ' || v_max || ' or fewer.' end
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.salary_advance_months_within_limit() from public, anon, authenticated;

drop trigger if exists salary_advance_months_within_limit on public.salary_advance;
create trigger salary_advance_months_within_limit before insert on public.salary_advance
  for each row execute function public.salary_advance_months_within_limit();
