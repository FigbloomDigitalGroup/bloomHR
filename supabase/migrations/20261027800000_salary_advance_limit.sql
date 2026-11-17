-- Salary advances: at most 30% of the person's basic salary.
--
-- 20261027700000 took the limit away (it had been 20%, checked only by the form); the company's rule is 30%. It is now
-- checked here too, so it holds for staff asking for themselves and for an admin applying on someone's behalf alike.
-- The basic salary is the one on the employee record, not what the request says. Advances already asked for are not
-- touched. Written to run again safely.

create or replace function public.salary_advance_within_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_basic numeric;
  v_limit numeric;
begin
  select nullif(regexp_replace(coalesce(e."Basic Salary"::text, ''), '[^0-9.]', '', 'g'), '')::numeric into v_basic
  from public.employees e where e.tenant_id = new.tenant_id and e."Employee Number" = new."Employee Number";
  v_limit := floor(coalesce(v_basic, 0) * 0.3);
  if coalesce(new."Amount Requested", 0) > v_limit then
    raise exception '%', case when v_limit <= 0
      then 'No basic salary is on this employee''s record, so no advance can be given. Ask HR to add it.'
      else 'The most that can be asked for is KSh ' || to_char(v_limit, 'FM999,999,999,990') || ' (30% of the basic salary).' end
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.salary_advance_within_limit() from public, anon, authenticated;

drop trigger if exists salary_advance_within_limit on public.salary_advance;
create trigger salary_advance_within_limit before insert on public.salary_advance
  for each row execute function public.salary_advance_within_limit();

notify pgrst, 'reload schema';
