-- NSSF and SHA number checks that stop rejecting real numbers.
--
-- The database accepted only 5 to 12 plain digits for a Kenyan NSSF number, while the form also allowed a check letter at
-- the end, so a real number such as 206593059X (on finance's July 2026 NSSF return) passed on screen and failed on save.
-- Neither NSSF nor SHA publishes a number format, so both checks now only catch typos, the same as the app
-- (src/lib/onboardingValidation.ts):
--   NSSF (Kenya)  4 to 15 letters and digits, at least one digit; spaces, dashes, slashes and dots are ignored
--   SHA           4 to 25 letters, digits and dashes, at least one digit; spaces, slashes and dots are ignored
-- Tanzania's and Uganda's NSSF checks (social_security_number_ok, 20261021100000) are unchanged.

create or replace function public.nssf_number_ok(p text) returns boolean language sql immutable as $$
  select v ~ '^[A-Z0-9]{4,15}$' and v ~ '[0-9]'
  from (select upper(regexp_replace(coalesce(p, ''), '[[:space:]/.-]', '', 'g')) as v) x
$$;

create or replace function public.sha_number_ok(p text) returns boolean language sql immutable as $$
  select v ~ '^[A-Z0-9-]{4,25}$' and v ~ '[0-9]'
  from (select upper(regexp_replace(coalesce(p, ''), '[[:space:]/.]', '', 'g')) as v) x
$$;

create or replace function public.social_security_number_hint(p_country text) returns text language sql immutable as $$
  select case when public.tidy_country(p_country) in ('Tanzania', 'Uganda') then 'should be 6 to 15 letters and digits'
              else 'should be 4 to 15 letters and digits' end
$$;
