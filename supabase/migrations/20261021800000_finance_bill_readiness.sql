-- Finance Bill readiness (FIG-813): a change in the law is a new dated rate row entered the same day, by a Figbloom
-- platform admin, with nothing hard-coded in the app to update. Builds on 20261020900000_payroll_countries.sql
-- (statutory_rates per country, payroll_run_countries) and the Tanzania and Uganda rates (20261021000000,
-- 20261021100000). Runbook: docs/FINANCE_BILL_RUNBOOK.md.
--
--   per_diem_rate             the share of basic salary paid as a non-taxed per diem (Kenya payroll's company practice,
--                             33% until now in the code). Now a dated rate: the platform default stays 0.33 from 2000,
--                             so no result changes; a company sets its own (0 for none) from a date on the Rates tab.
--   NSSF year 2 limits        Kenya's NSSF lower and upper earnings limits for Feb 2024 to Jan 2025 (KES 7,000 and
--                             36,000, NSSF Act 2013 year 2), so a month in that year has its limits like the others.
--   platform_admins           who may change the platform's default rates (rows with no tenant). Seeded empty. Only
--                             the service role (or the SQL editor) and existing platform admins add or remove one:
--                               select public.grant_platform_admin((select id from auth.users where email = 'name@figbloom.org'), 'why');
--   add_platform_rate         a platform admin adds a new dated version of a default rate or band set for a country:
--                             it is validated (bands go up, rates between 0 and 1), refused when it reaches back into a
--                             month some company has already approved unless confirmed, ends the version before it the
--                             day before, and is recorded in platform_rate_changes. A company's own rates still win.
--   platform_rate_changes     every change to a platform default rate, with who made it and when (the audit log only
--                             keeps company rows). Platform admins read it.
--   payroll_run_rates         the rates each draft country of a run was worked out with (the client sends them when it
--                             saves the run). When the rates in force for that month differ now (a new row, an ended
--                             row, a company's own rate), the country is stale: payroll_stale_countries lists it, the
--                             payroll page asks for a recalculation, and approving it is refused until it is
--                             recalculated. Approved and paid countries never change.
--
-- Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. rates: the per diem share, Kenya's NSSF year 2 limits
-- ---------------------------------------------------------------------------------------------
insert into public.statutory_rates (tenant_id, country, code, value, bands, effective_from, effective_to, source)
select null, 'Kenya', 'per_diem_rate', 0.33, null, date '2000-01-01', null,
       'Company practice default: the share of basic salary paid as a non-taxed per diem (set your own, or 0, on the Rates tab)'
where not exists (
  select 1 from public.statutory_rates r where r.tenant_id is null and lower(r.country) = 'kenya' and r.code = 'per_diem_rate'
);

insert into public.statutory_rates (tenant_id, country, code, value, bands, effective_from, effective_to, source)
select null, 'Kenya', v.code, v.value, null, date '2024-02-01', date '2025-01-31', 'NSSF Act 2013, year 2'
from (values ('nssf_lower_limit', 7000::numeric), ('nssf_upper_limit', 36000::numeric)) as v(code, value)
where not exists (
  select 1 from public.statutory_rates r
  where r.tenant_id is null and lower(r.country) = 'kenya' and r.code = v.code
    and r.effective_from <= date '2025-01-31' and coalesce(r.effective_to, 'infinity'::date) >= date '2024-02-01'
);

-- every rate in force on a day for a country for one company, as statutory_rates_on() gives it to that company
-- (for checks that run outside the company's session: triggers, the stale-run check)
create or replace function public.statutory_rates_for(p_tenant uuid, p_day date, p_country text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(code, coalesce(to_jsonb(value), bands)), '{}')
  from (
    select distinct on (code) code, value, bands
    from public.statutory_rates
    where effective_from <= p_day and (effective_to is null or effective_to >= p_day)
      and lower(country) = lower(coalesce(public.tidy_country(p_country), 'Kenya'))
      and (tenant_id is null or tenant_id = p_tenant)
    order by code, tenant_id nulls last
  ) r
$$;
revoke all on function public.statutory_rates_for(uuid, date, text) from public, anon, authenticated;

-- the last day of a pay period ('2026-10' -> 2026-10-31): the day payroll reads the month's rates for
create or replace function public.pay_period_last_day(p_period text) returns date
language sql immutable as $$
  select (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. platform admins
-- ---------------------------------------------------------------------------------------------
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from public.platform_admins p where p.user_id = auth.uid())
$$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated, service_role;

-- a person sees whether they are one; platform admins see each other. Nobody writes the table directly.
drop policy if exists read_platform_admins on public.platform_admins;
create policy read_platform_admins on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_platform_admin()));
revoke all on public.platform_admins from anon;
revoke insert, update, delete, truncate on public.platform_admins from authenticated;
grant select on public.platform_admins to authenticated;

-- the service role, the SQL editor (no signed-in user) or an existing platform admin
create or replace function public.can_manage_platform() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin()
      or (auth.uid() is null and coalesce(nullif(current_setting('role', true), ''), 'none') in ('none', 'postgres', 'service_role'))
$$;
revoke all on function public.can_manage_platform() from public, anon, authenticated;

create or replace function public.grant_platform_admin(p_user uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_platform() then
    raise exception 'Only a platform admin can add a platform admin' using errcode = '42501';
  end if;
  if p_user is null or not exists (select 1 from auth.users where id = p_user) then
    raise exception 'No such user' using errcode = '22023';
  end if;
  insert into public.platform_admins (user_id, note, added_by) values (p_user, nullif(btrim(p_note), ''), auth.uid())
  on conflict (user_id) do update set note = coalesce(excluded.note, public.platform_admins.note);
end $$;
revoke all on function public.grant_platform_admin(uuid, text) from public, anon;
grant execute on function public.grant_platform_admin(uuid, text) to authenticated, service_role;

create or replace function public.revoke_platform_admin(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_platform() then
    raise exception 'Only a platform admin can remove a platform admin' using errcode = '42501';
  end if;
  delete from public.platform_admins where user_id = p_user;
end $$;
revoke all on function public.revoke_platform_admin(uuid) from public, anon;
grant execute on function public.revoke_platform_admin(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. the audit of platform rates
-- ---------------------------------------------------------------------------------------------
create table if not exists public.platform_rate_changes (
  id uuid primary key default gen_random_uuid(),
  rate_id uuid,
  country text not null,
  code text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  performed_by uuid references auth.users(id) on delete set null,
  performed_at timestamptz not null default now()
);
create index if not exists platform_rate_changes_lookup_idx on public.platform_rate_changes (country, code, performed_at desc);
alter table public.platform_rate_changes enable row level security;
drop policy if exists platform_read on public.platform_rate_changes;
create policy platform_read on public.platform_rate_changes for select to authenticated
  using ((select public.is_platform_admin()));
revoke all on public.platform_rate_changes from anon;
revoke insert, update, delete, truncate on public.platform_rate_changes from authenticated;
grant select on public.platform_rate_changes to authenticated;

create or replace function public.audit_platform_rate() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.statutory_rates := case when tg_op = 'DELETE' then old else new end;
begin
  if r.tenant_id is not null then
    return null;
  end if;
  insert into public.platform_rate_changes (rate_id, country, code, action, old_data, new_data, performed_by)
  values (r.id, r.country, r.code, tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          auth.uid());
  return null;
end $$;
revoke all on function public.audit_platform_rate() from public, anon, authenticated;
drop trigger if exists audit_platform_rate on public.statutory_rates;
create trigger audit_platform_rate after insert or update or delete on public.statutory_rates
  for each row execute function public.audit_platform_rate();

-- ---------------------------------------------------------------------------------------------
-- 4. adding a platform rate
-- ---------------------------------------------------------------------------------------------
-- the latest month any company has approved (or paid) for a country: a new rate before its end reaches back into it
create or replace function public.platform_latest_approved_month(p_country text) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage_platform() then
    raise exception 'Only a platform admin can see this' using errcode = '42501';
  end if;
  return (
    select max(r.pay_period) from public.payroll_runs r
    join public.payroll_run_countries c on c.run_id = r.id
    where lower(c.country) = lower(coalesce(public.tidy_country(p_country), 'Kenya')) and c.status in ('approved', 'paid')
  );
end $$;
revoke all on function public.platform_latest_approved_month(text) from public, anon;
grant execute on function public.platform_latest_approved_month(text) to authenticated, service_role;

-- what is wrong with a rate (an empty array when it is fine): the same checks the screen makes before saving
create or replace function public.platform_rate_problems(p_code text, p_value numeric, p_bands jsonb) returns text[]
language plpgsql immutable set search_path = public as $$
declare
  problems text[] := '{}';
  b jsonb;
  i integer := 0;
  n integer;
  prev numeric := 0;
  v numeric;
begin
  if p_code is null or p_code !~ '^[a-z][a-z0-9_]*$' then
    problems := problems || 'Choose a rate code (lower case letters, digits and _)'::text;
  end if;
  if (p_value is null) = (p_bands is null) then
    return problems || 'Give either a value or bands, not both'::text;
  end if;
  if p_value is not null then
    if p_value < 0 then
      problems := problems || 'The value can''t be below 0'::text;
    elsif (p_code ~ 'rate$' or p_code ~ '^wht_') and p_value > 1 then
      problems := problems || 'A rate is a share between 0 and 1 (e.g. 0.015 for 1.5%)'::text;
    elsif p_code ~ '_deductible$' and p_value not in (0, 1) then
      problems := problems || 'Deductible is 1 (yes) or 0 (no)'::text;
    end if;
    return problems;
  end if;
  if jsonb_typeof(p_bands) <> 'array' or jsonb_array_length(p_bands) = 0 then
    return problems || 'Add at least one band'::text;
  end if;
  n := jsonb_array_length(p_bands);
  for b in select value from jsonb_array_elements(p_bands) loop
    i := i + 1;
    if i < n then
      if coalesce(jsonb_typeof(b -> 'upto'), '') <> 'number' or (b ->> 'upto')::numeric <= prev then
        problems := problems || format('Band %s: each band''s "up to" must be above the one before', i);
      else
        prev := (b ->> 'upto')::numeric;
      end if;
    elsif b ? 'upto' and jsonb_typeof(b -> 'upto') <> 'null' then
      problems := problems || 'The last band is for everything above: leave its "up to" empty'::text;
    end if;
    if coalesce(jsonb_typeof(b -> 'rate'), '') = 'number' then
      v := (b ->> 'rate')::numeric;
      if v < 0 or v > 1 then
        problems := problems || format('Band %s: a rate is a share between 0 and 1', i);
      end if;
    elsif coalesce(jsonb_typeof(b -> 'amount'), '') = 'number' then
      if (b ->> 'amount')::numeric < 0 then
        problems := problems || format('Band %s: the amount can''t be below 0', i);
      end if;
    else
      problems := problems || format('Band %s: give a rate or an amount', i);
    end if;
  end loop;
  return problems;
end $$;
grant execute on function public.platform_rate_problems(text, numeric, jsonb) to authenticated, service_role;

-- A platform admin adds a new version of a default rate (or band set) for a country from a date. The version in force
-- on that date ends the day before; a later version already entered keeps its date (the new one ends the day before
-- it). A version that starts on the same day is corrected in place. Returns the row's id.
create or replace function public.add_platform_rate(
  p_country text, p_code text, p_value numeric, p_bands jsonb, p_from date, p_source text,
  p_confirm_backdate boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_country text := public.tidy_country(p_country);
  v_problems text[];
  v_latest text;
  v_next date;
  v_id uuid;
begin
  if not public.can_manage_platform() then
    raise exception 'Only a platform admin can change the platform rates' using errcode = '42501';
  end if;
  if v_country is null then
    raise exception 'Choose a country' using errcode = '22023';
  end if;
  if p_from is null then
    raise exception 'Choose the date the rate starts' using errcode = '22023';
  end if;
  if nullif(btrim(p_source), '') is null then
    raise exception 'Say where the rate comes from (the Act or notice)' using errcode = '22023';
  end if;
  v_problems := public.platform_rate_problems(p_code, p_value, p_bands);
  if cardinality(v_problems) > 0 then
    raise exception '%', array_to_string(v_problems, '; ') using errcode = '23514';
  end if;

  v_latest := public.platform_latest_approved_month(v_country);
  if v_latest is not null and p_from <= public.pay_period_last_day(v_latest) and not coalesce(p_confirm_backdate, false) then
    raise exception 'Payroll for % in % is already approved by at least one company, and a rate from % reaches back into it. Confirm to add it anyway: approved months keep their payslips (they need amended returns), draft months are flagged for recalculation.',
      v_country, v_latest, p_from using errcode = 'P0001', hint = 'confirm_backdate';
  end if;

  -- a version from the same day: corrected in place
  select id into v_id from public.statutory_rates
  where tenant_id is null and lower(country) = lower(v_country) and code = p_code and effective_from = p_from;
  if v_id is not null then
    update public.statutory_rates set value = p_value, bands = p_bands, source = btrim(p_source) where id = v_id;
    return v_id;
  end if;

  update public.statutory_rates set effective_to = p_from - 1
  where tenant_id is null and lower(country) = lower(v_country) and code = p_code
    and effective_from < p_from and (effective_to is null or effective_to >= p_from);
  select min(effective_from) into v_next from public.statutory_rates
  where tenant_id is null and lower(country) = lower(v_country) and code = p_code and effective_from > p_from;

  insert into public.statutory_rates (tenant_id, country, code, value, bands, effective_from, effective_to, source)
  values (null, v_country, p_code, p_value, p_bands, p_from, v_next - 1, btrim(p_source))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.add_platform_rate(text, text, numeric, jsonb, date, text, boolean) from public, anon;
grant execute on function public.add_platform_rate(text, text, numeric, jsonb, date, text, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. the rates each draft country was worked out with, and stale drafts
-- ---------------------------------------------------------------------------------------------
create table if not exists public.payroll_run_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  country text not null check (btrim(country) <> ''),
  rates jsonb not null check (jsonb_typeof(rates) = 'object'),
  calculated_by uuid default auth.uid() references auth.users(id) on delete set null,
  calculated_at timestamptz not null default now(),
  unique (run_id, country)
);
create index if not exists payroll_run_rates_tenant_idx on public.payroll_run_rates (tenant_id, run_id);
alter table public.payroll_run_rates enable row level security;
drop policy if exists tenant_isolation on public.payroll_run_rates;
create policy tenant_isolation on public.payroll_run_rates as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists module_read on public.payroll_run_rates;
create policy module_read on public.payroll_run_rates for select to authenticated
  using ((select public.has_any_module('payroll', 'hr-lifecycle')));
revoke all on public.payroll_run_rates from anon;
revoke insert, update, delete, truncate on public.payroll_run_rates from authenticated;
grant select on public.payroll_run_rates to authenticated;

-- payroll records the rates it worked a run's draft countries out with: {"Kenya": {...rates}, "Uganda": {...}}.
-- Countries already approved or paid are left as they are. Returns the countries recorded.
create or replace function public.record_payroll_rates(p_run uuid, p_rates jsonb) returns text[]
language plpgsql security definer set search_path = public as $$
declare
  run public.payroll_runs;
  k text;
  v_country text;
  done text[] := '{}';
begin
  if not public.has_module('payroll') then
    raise exception 'Only payroll can do this' using errcode = '42501';
  end if;
  select * into run from public.payroll_runs where id = p_run and tenant_id = public.current_tenant_id();
  if run.id is null then
    raise exception 'No such payroll run' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rates) <> 'object' then
    raise exception 'Rates must be given per country' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_rates) loop
    v_country := public.tidy_country(k);
    if v_country is null or jsonb_typeof(p_rates -> k) <> 'object'
       or coalesce(public.payroll_country_status(run.id, v_country), 'draft') <> 'draft' then
      continue;
    end if;
    insert into public.payroll_run_rates (tenant_id, run_id, country, rates, calculated_by, calculated_at)
    values (run.tenant_id, run.id, v_country, p_rates -> k, auth.uid(), now())
    on conflict (run_id, country) do update
      set rates = excluded.rates, calculated_by = excluded.calculated_by, calculated_at = excluded.calculated_at;
    done := done || v_country;
  end loop;
  return done;
end $$;
revoke all on function public.record_payroll_rates(uuid, jsonb) from public, anon;
grant execute on function public.record_payroll_rates(uuid, jsonb) to authenticated;

-- a draft country worked out with other rates than those in force for its month now (no record: not known, not stale)
create or replace function public.payroll_country_rates_stale(p_run uuid, p_country text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select s.rates is distinct from public.statutory_rates_for(r.tenant_id, public.pay_period_last_day(r.pay_period), s.country)
    from public.payroll_runs r
    join public.payroll_run_rates s on s.run_id = r.id and lower(s.country) = lower(coalesce(public.tidy_country(p_country), 'Kenya'))
    where r.id = p_run
  ), false)
$$;
revoke all on function public.payroll_country_rates_stale(uuid, text) from public, anon, authenticated;

-- the run's draft countries whose rates changed since they were worked out (for the payroll page)
create or replace function public.payroll_stale_countries(p_run uuid) returns setof text
language sql stable security definer set search_path = public as $$
  select c.country from public.payroll_run_countries c
  join public.payroll_runs r on r.id = c.run_id
  where c.run_id = p_run and r.tenant_id = public.current_tenant_id() and c.status = 'draft'
    and public.has_any_module('payroll', 'hr-lifecycle')
    and public.payroll_country_rates_stale(c.run_id, c.country)
  order by c.country
$$;
revoke all on function public.payroll_stale_countries(uuid) from public, anon;
grant execute on function public.payroll_stale_countries(uuid) to authenticated;

-- approving a stale draft country is refused: recalculate first (approved and paid countries are never touched)
create or replace function public.payroll_run_country_rates_current() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'draft' and new.status = 'approved' and public.payroll_country_rates_stale(new.run_id, new.country) then
    raise exception 'The statutory rates for % changed after payroll for % was worked out. Recalculate, then approve.',
      new.country, (select r.pay_period from public.payroll_runs r where r.id = new.run_id) using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.payroll_run_country_rates_current() from public, anon, authenticated;
drop trigger if exists payroll_run_country_rates_current on public.payroll_run_countries;
create trigger payroll_run_country_rates_current before update of status on public.payroll_run_countries
  for each row execute function public.payroll_run_country_rates_current();

-- the drafts there are now: taken as worked out with the rates in force today (nothing to compare them with)
insert into public.payroll_run_rates (tenant_id, run_id, country, rates, calculated_by, calculated_at)
select c.tenant_id, c.run_id, c.country,
       public.statutory_rates_for(c.tenant_id, public.pay_period_last_day(r.pay_period), c.country), null, now()
from public.payroll_run_countries c
join public.payroll_runs r on r.id = c.run_id
where c.status = 'draft'
on conflict (run_id, country) do nothing;

notify pgrst, 'reload schema';
