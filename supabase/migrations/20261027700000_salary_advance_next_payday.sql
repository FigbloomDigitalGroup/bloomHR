-- Salary advances: repaid in full on the next payday, no limit on the amount, and admins apply on someone's behalf.
--
--   * A new advance is taken back in one go: repayment_months stays 1, and the request form no longer offers to spread
--     it (salary_advance_months_within_limit now refuses more than 1). Payroll takes it off the pay of the month it was
--     asked for, or the next payroll when that one was approved before the advance was paid (src/lib/salaryAdvance.ts).
--     Advances already spread over several months keep their parts. salary_advance_settings.max_repayment_months is no
--     longer read by the app.
--   * There is no limit on the amount (the 20% of basic salary was only ever checked by the form); the approvers decide.
--   * requested_by / requested_by_email: who applied when it wasn't the employee themselves (someone on the salary
--     advance screen applying for them). Set by the database from the signed-in person, so it can't be put in by hand;
--     blank when the employee asked for themselves.
--
-- Access is unchanged: the screens that manage advances (salaryadmin, payroll, reports) could already add one for
-- anyone in their company, and it starts on the company's approval chain like any request. Written to run again safely.

alter table public.salary_advance add column if not exists requested_by uuid references auth.users(id) on delete set null;
alter table public.salary_advance add column if not exists requested_by_email text;

create or replace function public.salary_advance_months_within_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.repayment_months, 1) > 1 then
    raise exception 'Salary advances are repaid in full on the next payday: they can''t be spread over months.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.salary_advance_months_within_limit() from public, anon, authenticated;

create or replace function public.salary_advance_applied_by() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new."Employee Number" is distinct from public.current_employee_number() then
    new.requested_by := auth.uid();
    new.requested_by_email := (select u.email from auth.users u where u.id = auth.uid());
  else
    new.requested_by := null;
    new.requested_by_email := null;
  end if;
  return new;
end $$;
revoke all on function public.salary_advance_applied_by() from public, anon, authenticated;

drop trigger if exists salary_advance_applied_by on public.salary_advance;
create trigger salary_advance_applied_by before insert on public.salary_advance
  for each row execute function public.salary_advance_applied_by();

-- and not changed afterwards
create or replace function public.salary_advance_keep_applied_by() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.requested_by := old.requested_by;
  new.requested_by_email := old.requested_by_email;
  return new;
end $$;
revoke all on function public.salary_advance_keep_applied_by() from public, anon, authenticated;

drop trigger if exists salary_advance_keep_applied_by on public.salary_advance;
create trigger salary_advance_keep_applied_by before update on public.salary_advance
  for each row execute function public.salary_advance_keep_applied_by();

notify pgrst, 'reload schema';
