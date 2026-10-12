-- NSSF numbers can end in X (a check character, e.g. 206593059X on finance's July 2026 NSSF return); 20261012100000
-- only allowed digits, so a real number was refused. Now: 5 to 12 characters, digits, the last a digit or X, saved
-- in upper case. (The trigger below runs before employees_onboarding_rules, which checks the format.)

create or replace function public.nssf_number_ok(p text) returns boolean language sql immutable as $$
  select p ~ '^\d{4,11}[0-9X]$'
$$;

create or replace function public.employees_nssf_number_upper() returns trigger
language plpgsql set search_path = public as $$
begin
  new."NSSF Number" := upper(new."NSSF Number");
  return new;
end $$;

-- named to run before employees_onboarding_rules (triggers run in name order)
drop trigger if exists employees_nssf_number_upper on public.employees;
create trigger employees_nssf_number_upper before insert or update of "NSSF Number" on public.employees
  for each row execute function public.employees_nssf_number_upper();

notify pgrst, 'reload schema';
