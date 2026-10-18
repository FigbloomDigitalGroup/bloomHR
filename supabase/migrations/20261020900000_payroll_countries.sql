-- One payroll run for every country, approved and filed per country (FIG-905 stage 2). Builds on
-- 20261020500000_branches.sql (each employee's country comes from their branch: employee_country / employee_currency).
--
-- The user's decision: "run like they're one country but in the backend they're different, so the admin doesn't do
-- things many times, does them once and everything is done. When exporting the P10 they do it per country."
--
--   statutory_rates.country           every rate belongs to a country (the rows so far are Kenya's). A company's own rate,
--                                     the no-overlap rule and the lookups are per country:
--                                     statutory_rates_on(day, country default 'Kenya'),
--                                     statutory_rate_for(tenant, code, day, country default 'Kenya').
--   salary_history.country / currency each payslip's country and currency (the rows so far: Kenya / KES). Filled from the
--                                     employee's branch when not given. A payslip's currency is its country's
--                                     (Kenya KES, Tanzania TZS, Uganda UGX, Rwanda RWF) and one currency per country per
--                                     month: a mismatch is refused, never converted.
--   payroll_runs                      still one per company per month (one run for everyone). Its status is now the sum
--                                     of its countries: draft while any country is a draft, paid once every country is
--                                     paid, approved otherwise. Changing it directly (as before) changes every country
--                                     that can change: approving approves every draft country, reopening reopens every
--                                     approved one, marking paid marks every approved one paid.
--   payroll_run_countries             one row per country with payslips in the month's run: status draft / approved /
--                                     paid, approved_by/at, paid_by/at. Payroll approves, reopens or marks paid one
--                                     country (update its status) or several at once. A country's row is made when its
--                                     first payslip of the month is saved and removed when its last draft payslip is.
--
-- Everything the month's approval did before now happens per country, for that country's payslips only:
--   * payslips lock, and staff see theirs, when THEIR country is approved (salary_history_in_draft_run, own_select)
--   * the month-end settlement of piece rate work and contract jobs, arrears, loan repayments and leave payouts
--     (approving Kenya settles Kenya's workers only; reopening Kenya undoes only Kenya's)
--   * "payslip ready" / "salary paid" notifications, payslip emails, payments, hand edits, the NITA levy (Kenya only)
--   * the month lock for work, overtime and imports: pay_month_closed(tenant, day, employee) is closed when the
--     employee's country is approved for that month (or they have a locked payslip in it). pay_month_closed(tenant,
--     day) without an employee still means the whole run is approved (every country), for company-wide checks.
--   * an employee moving branch mid-month is paid by the country they are in when the payslip is worked out (at month
--     end: the period's last day); a draft payslip keeps the country it was worked out with until it is recalculated.
--
-- Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. statutory rates per country
-- ---------------------------------------------------------------------------------------------
alter table public.statutory_rates add column if not exists country text;
update public.statutory_rates set country = 'Kenya' where country is null;
alter table public.statutory_rates alter column country set default 'Kenya';
alter table public.statutory_rates alter column country set not null;
create index if not exists statutory_rates_country_lookup_idx on public.statutory_rates (country, code, effective_from);

create or replace function public.statutory_rates_country() returns trigger
language plpgsql set search_path = public as $$
begin
  new.country := coalesce(public.tidy_country(new.country), 'Kenya');
  return new;
end $$;
revoke all on function public.statutory_rates_country() from public, anon, authenticated;
-- (named to run before statutory_rates_no_overlap)
drop trigger if exists statutory_rates_country on public.statutory_rates;
create trigger statutory_rates_country before insert or update on public.statutory_rates
  for each row execute function public.statutory_rates_country();

-- the same code may have one rate at a time per company and per country
create or replace function public.statutory_rates_no_overlap() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (
    select 1 from public.statutory_rates r
    where r.id <> new.id and r.code = new.code and r.tenant_id is not distinct from new.tenant_id
      and lower(r.country) = lower(coalesce(new.country, 'Kenya'))
      and r.effective_from <= coalesce(new.effective_to, 'infinity'::date)
      and new.effective_from <= coalesce(r.effective_to, 'infinity'::date)
  ) then
    raise exception '% already has a rate for part of % to %', new.code, new.effective_from,
      coalesce(new.effective_to::text, 'open-ended') using errcode = '23P01';
  end if;
  return new;
end $$;

-- every rate in force on a day for a country, as {code: value or bands}; the company's own rate wins over the default
drop function if exists public.statutory_rates_on(date);
create or replace function public.statutory_rates_on(p_day date default current_date, p_country text default 'Kenya') returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_object_agg(code, coalesce(to_jsonb(value), bands)), '{}')
  from (
    select distinct on (code) code, value, bands
    from public.statutory_rates
    where effective_from <= p_day and (effective_to is null or effective_to >= p_day)
      and lower(country) = lower(coalesce(public.tidy_country(p_country), 'Kenya'))
      and (tenant_id is null or tenant_id = public.current_tenant_id())
    order by code, tenant_id nulls last
  ) r
$$;
revoke all on function public.statutory_rates_on(date, text) from public, anon;
grant execute on function public.statutory_rates_on(date, text) to authenticated, service_role;

-- one rate for a company on a day in a country: its own wins over the default
drop function if exists public.statutory_rate_for(uuid, text, date);
create or replace function public.statutory_rate_for(p_tenant uuid, p_code text, p_day date, p_country text default 'Kenya') returns numeric
language sql stable security definer set search_path = public as $$
  select r.value from public.statutory_rates r
  where r.code = p_code and r.effective_from <= p_day and (r.effective_to is null or r.effective_to >= p_day)
    and lower(r.country) = lower(coalesce(public.tidy_country(p_country), 'Kenya'))
    and (r.tenant_id is null or r.tenant_id = p_tenant)
  order by r.tenant_id nulls last
  limit 1
$$;
revoke all on function public.statutory_rate_for(uuid, text, date, text) from public, anon;
grant execute on function public.statutory_rate_for(uuid, text, date, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. each payslip's country and currency (the rows so far are Kenya's, in KES)
-- ---------------------------------------------------------------------------------------------
alter table public.salary_history add column if not exists country text;
alter table public.salary_history add column if not exists currency text;
do $$
begin
  if exists (select 1 from public.salary_history where country is null or currency is null) then
    -- locked payslips are filled in too: the figures don't change
    alter table public.salary_history disable trigger salary_history_in_draft_run;
    alter table public.salary_history disable trigger salary_history_nita_levy;
    update public.salary_history set country = coalesce(country, 'Kenya'), currency = coalesce(currency, 'KES')
    where country is null or currency is null;
    alter table public.salary_history enable trigger salary_history_in_draft_run;
    alter table public.salary_history enable trigger salary_history_nita_levy;
  end if;
end $$;
alter table public.salary_history alter column country set not null;
alter table public.salary_history alter column currency set not null;
alter table public.salary_history drop constraint if exists salary_history_currency_code;
alter table public.salary_history add constraint salary_history_currency_code check (currency ~ '^[A-Z]{3}$');
create index if not exists salary_history_run_country_idx on public.salary_history (run_id, country);

-- ---------------------------------------------------------------------------------------------
-- 3. the run's countries
-- ---------------------------------------------------------------------------------------------
create table if not exists public.payroll_run_countries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  country text not null check (btrim(country) <> ''),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  status text not null default 'draft' check (status in ('draft', 'approved', 'paid')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  paid_by uuid references auth.users(id) on delete set null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, country)
);
create index if not exists payroll_run_countries_tenant_idx on public.payroll_run_countries (tenant_id, run_id);

alter table public.payroll_run_countries enable row level security;
drop policy if exists tenant_isolation on public.payroll_run_countries;
create policy tenant_isolation on public.payroll_run_countries as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
-- read by the same people who read the runs; payroll approves, reopens and marks paid (rows are made and removed by
-- the payslips, never by hand)
drop policy if exists module_read on public.payroll_run_countries;
create policy module_read on public.payroll_run_countries for select to authenticated
  using ((select public.has_any_module('payroll', 'hr-lifecycle')));
drop policy if exists module_update on public.payroll_run_countries;
create policy module_update on public.payroll_run_countries for update to authenticated
  using ((select public.has_module('payroll')))
  with check ((select public.has_module('payroll')));
revoke all on public.payroll_run_countries from anon;
revoke insert, delete, truncate on public.payroll_run_countries from authenticated;
grant select, update on public.payroll_run_countries to authenticated;

drop trigger if exists audit_payroll_run_countries on public.payroll_run_countries;
create trigger audit_payroll_run_countries after insert or update or delete on public.payroll_run_countries
  for each row execute function public.audit_row_change();

-- the runs so far: one row per country they have payslips in (Kenya), with the run's status
insert into public.payroll_run_countries (tenant_id, run_id, country, currency, status, approved_by, approved_at, paid_by, paid_at, created_at)
select r.tenant_id, r.id, h.country, min(h.currency), r.status, r.approved_by, r.approved_at, r.paid_by, r.paid_at, r.created_at
from public.payroll_runs r
join public.salary_history h on h.run_id = r.id
group by r.id, h.country
on conflict (run_id, country) do nothing;

-- ---------------------------------------------------------------------------------------------
-- 4. helpers
-- ---------------------------------------------------------------------------------------------
-- a country's status in a run; a run from before countries (no rows at all) answers with its own status; a country
-- with no row in a run that has others is not started (null)
create or replace function public.payroll_country_status(p_run uuid, p_country text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.status from public.payroll_run_countries c
     where c.run_id = p_run and lower(c.country) = lower(coalesce(nullif(btrim(p_country), ''), 'Kenya'))),
    (select r.status from public.payroll_runs r
     where r.id = p_run and not exists (select 1 from public.payroll_run_countries c where c.run_id = p_run)))
$$;
revoke all on function public.payroll_country_status(uuid, text) from public, anon;
grant execute on function public.payroll_country_status(uuid, text) to authenticated, service_role;

-- the payslip's country is approved (or paid) for its run: locked, and its employee sees it
create or replace function public.payslip_closed(p_run uuid, p_country text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.payroll_country_status(p_run, p_country) in ('approved', 'paid'), false)
$$;
revoke all on function public.payslip_closed(uuid, text) from public, anon;
grant execute on function public.payslip_closed(uuid, text) to authenticated, service_role;

-- an employee's payslip in a run is in that country
create or replace function public.run_country_has(p_run uuid, p_country text, p_employee text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.salary_history h
                 where h.run_id = p_run and h.employee_id = p_employee and lower(h.country) = lower(p_country))
$$;
revoke all on function public.run_country_has(uuid, text, text) from public, anon, authenticated;

-- a payment belongs to its employee's payslip's country; one with no payslip in the run counts for every country
create or replace function public.payment_in_country(p_run uuid, p_country text, p_employee text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.run_country_has(p_run, p_country, p_employee)
      or not exists (select 1 from public.salary_history h where h.run_id = p_run and h.employee_id = p_employee)
$$;
revoke all on function public.payment_in_country(uuid, text, text) from public, anon, authenticated;

-- the run's status follows its countries: draft while any is a draft, paid when all are, approved otherwise
create or replace function public.sync_payroll_run_status(p_run uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_next text;
  v_cur text;
begin
  select case when count(*) = 0 then null
              when bool_or(c.status = 'draft') then 'draft'
              when bool_and(c.status = 'paid') then 'paid'
              else 'approved' end
    into v_next
  from public.payroll_run_countries c where c.run_id = p_run;
  if v_next is null then
    return;
  end if;
  select r.status into v_cur from public.payroll_runs r where r.id = p_run;
  if v_cur is null or v_cur = v_next then
    return;
  end if;
  perform set_config('app.payroll_run_sync', 'on', true);
  update public.payroll_runs set status = v_next where id = p_run;
  perform set_config('app.payroll_run_sync', 'off', true);
end $$;
revoke all on function public.sync_payroll_run_status(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. the month lock per employee
-- ---------------------------------------------------------------------------------------------
-- closed for an employee when the month is approved (or paid) for their country, or they have a payslip in a country
-- that is (someone who moved branch after their country was approved)
create or replace function public.pay_month_closed(p_tenant uuid, p_day date, p_employee text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.payroll_runs r
    join public.payroll_run_countries c on c.run_id = r.id
    where r.tenant_id = p_tenant and r.pay_period = to_char(p_day, 'YYYY-MM') and c.status in ('approved', 'paid')
      and (lower(c.country) = lower(public.employee_country(p_tenant, p_employee))
           or exists (select 1 from public.salary_history h
                      where h.run_id = r.id and h.employee_id = p_employee and lower(h.country) = lower(c.country)))
  ) or exists (
    -- a run from before countries were recorded
    select 1 from public.payroll_runs r
    where r.tenant_id = p_tenant and r.pay_period = to_char(p_day, 'YYYY-MM') and r.status in ('approved', 'paid')
      and not exists (select 1 from public.payroll_run_countries c where c.run_id = r.id)
  )
$$;
revoke all on function public.pay_month_closed(uuid, date, text) from public, anon;
grant execute on function public.pay_month_closed(uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. payslips: their country, currency and lock
-- ---------------------------------------------------------------------------------------------
create or replace function public.salary_history_in_draft_run() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  run public.payroll_runs;
  v_status text;
  v_other text;
  v_first boolean;
begin
  -- renumbering an employee (propagate_employee_number) follows through locked payslips; no figure changes
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'employee_id') = (to_jsonb(old) - 'employee_id') then
    return new;
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.run_id is not null then
    v_status := public.payroll_country_status(old.run_id, old.country);
    if v_status is not null and v_status <> 'draft' then
      select * into run from public.payroll_runs where id = old.run_id;
      raise exception 'Payroll for % in % is %, so its payslips can''t be changed. Reopen it first.',
        run.pay_period, coalesce(old.country, 'Kenya'), v_status;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.pay_period is null or new.pay_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Pay period "%" should look like 2026-09 (year-month)', coalesce(new.pay_period, '');
  end if;

  -- the payslip's country: as given, else the employee's branch's; its currency: as given, else the branch's (for the
  -- employee's own country) or the country's
  new.country := coalesce(public.tidy_country(new.country), public.employee_country(new.tenant_id, new.employee_id), 'Kenya');
  if nullif(btrim(new.currency), '') is null then
    new.currency := case when lower(new.country) = lower(public.employee_country(new.tenant_id, new.employee_id))
                         then public.employee_currency(new.tenant_id, new.employee_id)
                         else public.country_currency(new.country) end;
  end if;
  new.currency := upper(btrim(new.currency));
  -- a known country's payslips are in its own currency: never another
  if lower(new.country) in ('kenya', 'tanzania', 'uganda', 'rwanda') and new.currency <> public.country_currency(new.country) then
    raise exception '% payslips are in %, not % (%): change the branch''s currency, then recalculate',
      new.country, public.country_currency(new.country), new.currency, coalesce(new.employee_id, '') using errcode = '22023';
  end if;

  insert into public.payroll_runs (tenant_id, pay_period)
  values (new.tenant_id, new.pay_period)
  on conflict (tenant_id, pay_period) do nothing;
  select * into run from public.payroll_runs where tenant_id = new.tenant_id and pay_period = new.pay_period;

  -- the country's part of the run, started as a draft with its first payslip (a run from before countries, with no
  -- rows yet, starts its first country with the run's own status)
  v_first := not exists (select 1 from public.payroll_run_countries c where c.run_id = run.id);
  insert into public.payroll_run_countries (tenant_id, run_id, country, currency, status, approved_by, approved_at, paid_by, paid_at)
  values (new.tenant_id, run.id, new.country, new.currency,
          case when v_first then run.status else 'draft' end,
          case when v_first then run.approved_by end, case when v_first then run.approved_at end,
          case when v_first then run.paid_by end, case when v_first then run.paid_at end)
  on conflict (run_id, country) do nothing;

  v_status := public.payroll_country_status(run.id, new.country);
  if v_status <> 'draft' then
    raise exception 'Payroll for % in % is %, so its payslips can''t be changed. Reopen it first.', run.pay_period, new.country, v_status;
  end if;

  -- one currency per country in a month
  select h.currency into v_other from public.salary_history h
  where h.run_id = run.id and lower(h.country) = lower(new.country) and h.currency <> new.currency and h.id is distinct from new.id
  limit 1;
  if v_other is not null then
    raise exception '% payslips for % are in %; this one is in %', new.country, run.pay_period, v_other, new.currency using errcode = '22023';
  end if;

  new.run_id := run.id;
  return new;
end $$;

-- a country's last payslip of the month removed (or moved to another country) while a draft: its row goes too
create or replace function public.salary_history_country_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.run_id is null then
    return null;
  end if;
  if not exists (select 1 from public.salary_history h where h.run_id = old.run_id and lower(h.country) = lower(old.country)) then
    delete from public.payroll_run_countries c
    where c.run_id = old.run_id and lower(c.country) = lower(old.country) and c.status = 'draft';
  end if;
  return null;
end $$;
revoke all on function public.salary_history_country_cleanup() from public, anon, authenticated;
drop trigger if exists salary_history_country_cleanup on public.salary_history;
create trigger salary_history_country_cleanup after delete or update of country, run_id on public.salary_history
  for each row execute function public.salary_history_country_cleanup();

-- staff see their own payslip once THEIR country is approved (or paid) for that month: "run id|country" of each
-- approved country, worked out once per query
create or replace function public.published_payslip_keys() returns setof text
language sql stable security definer set search_path = public as $$
  select c.run_id::text || '|' || lower(c.country) from public.payroll_run_countries c
  where c.tenant_id = (select public.current_tenant_id()) and c.status in ('approved', 'paid')
$$;
revoke all on function public.published_payslip_keys() from public, anon;
grant execute on function public.published_payslip_keys() to authenticated, service_role;

drop policy if exists own_select on public.salary_history;
create policy own_select on public.salary_history for select to authenticated
  using (employee_id = (select public.current_employee_number())
         and (run_id::text || '|' || lower(country)) in (select public.published_payslip_keys()));

-- ---------------------------------------------------------------------------------------------
-- 7. the run's status follows its countries; changing it directly changes its countries
-- ---------------------------------------------------------------------------------------------
create or replace function public.payroll_run_status_change() returns trigger
language plpgsql set search_path = public as $$
declare
  v_sync boolean := coalesce(current_setting('app.payroll_run_sync', true), '') = 'on';
begin
  if new.tenant_id <> old.tenant_id or new.pay_period <> old.pay_period then
    raise exception 'A payroll run''s month can''t be changed';
  end if;

  if new.status <> old.status then
    if v_sync then
      -- the sum of its countries (any change is allowed: e.g. a country added to a paid month makes it a draft again)
      if new.status = 'approved' then
        new.approved_by := coalesce(auth.uid(), old.approved_by);
        new.approved_at := now();
      elsif new.status = 'draft' then
        new.approved_by := null;
        new.approved_at := null;
        new.paid_by := null;
        new.paid_at := null;
      elsif new.status = 'paid' then
        new.paid_by := coalesce(auth.uid(), old.paid_by);
        new.paid_at := now();
        new.approved_at := coalesce(old.approved_at, now());
      end if;
    elsif old.status = 'draft' and new.status = 'approved' then
      if not exists (select 1 from public.salary_history where run_id = new.id) then
        raise exception 'Payroll for % has no payslips to approve', new.pay_period;
      end if;
      new.approved_by := auth.uid();
      new.approved_at := now();
    elsif old.status = 'approved' and new.status = 'draft' then
      new.approved_by := null;
      new.approved_at := null;
    elsif old.status = 'approved' and new.status = 'paid' then
      new.paid_by := auth.uid();
      new.paid_at := now();
    else
      raise exception 'Payroll for % can''t go from % to %', new.pay_period, old.status, new.status;
    end if;
  else
    -- only the status change stamps these
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
    new.paid_by := old.paid_by;
    new.paid_at := old.paid_at;
  end if;

  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;

-- changing the run's status directly (the way it was always done) changes every country that can make that change;
-- named to run after payroll_run_status_change has checked the change
create or replace function public.payroll_run_to_countries() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status or coalesce(current_setting('app.payroll_run_sync', true), '') = 'on' then
    return new;
  end if;
  perform set_config('app.payroll_run_legacy', 'on', true);
  if old.status = 'draft' and new.status = 'approved' then
    update public.payroll_run_countries set status = 'approved' where run_id = new.id and status = 'draft';
  elsif old.status = 'approved' and new.status = 'draft' then
    update public.payroll_run_countries set status = 'draft' where run_id = new.id and status = 'approved';
  elsif old.status = 'approved' and new.status = 'paid' then
    update public.payroll_run_countries set status = 'paid' where run_id = new.id and status = 'approved';
  end if;
  perform set_config('app.payroll_run_legacy', 'off', true);
  return new;
end $$;
revoke all on function public.payroll_run_to_countries() from public, anon, authenticated;
drop trigger if exists payroll_run_to_countries on public.payroll_runs;
create trigger payroll_run_to_countries before update on public.payroll_runs
  for each row execute function public.payroll_run_to_countries();

-- a run with an approved or paid country can't be deleted (that would delete locked payslips)
create or replace function public.payroll_run_delete_draft_only() returns trigger
language plpgsql set search_path = public as $$
declare
  v_locked text;
begin
  if old.status <> 'draft' then
    raise exception 'Payroll for % is %, so it can''t be deleted', old.pay_period, old.status;
  end if;
  select string_agg(c.country || ' is ' || c.status, ', ' order by c.country) into v_locked
  from public.payroll_run_countries c where c.run_id = old.id and c.status <> 'draft';
  if v_locked is not null then
    raise exception 'Payroll for %: % so it can''t be deleted. Discard the draft countries instead.', old.pay_period, v_locked;
  end if;
  return old;
end $$;

-- what approving the whole run used to do now happens per country (section 8)
drop trigger if exists payroll_run_work_settlement on public.payroll_runs;
drop trigger if exists payroll_run_loan_repayments on public.payroll_runs;
drop trigger if exists payroll_run_leave_payouts on public.payroll_runs;
drop trigger if exists payroll_runs_notify on public.payroll_runs;
drop trigger if exists payroll_run_reopen_unpaid_only on public.payroll_runs;
-- (payroll_run_sync_contributions stays on the run: contributions follow the company's next payroll month)

-- ---------------------------------------------------------------------------------------------
-- 8. approving, reopening and paying a country
-- ---------------------------------------------------------------------------------------------
create or replace function public.payroll_run_country_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.payroll_runs;
begin
  if new.run_id <> old.run_id or lower(new.country) <> lower(old.country) or new.tenant_id <> old.tenant_id then
    raise exception 'A payroll country can''t be moved to another run or country';
  end if;
  select * into r from public.payroll_runs where id = new.run_id;
  if new.status <> old.status then
    if old.status = 'draft' and new.status = 'approved' then
      if not exists (select 1 from public.salary_history h where h.run_id = new.run_id and lower(h.country) = lower(new.country)) then
        raise exception 'Payroll for % in % has no payslips to approve', r.pay_period, new.country;
      end if;
      new.approved_by := auth.uid();
      new.approved_at := now();
    elsif old.status = 'approved' and new.status = 'draft' then
      -- once money has gone out to anyone in the country, it stays approved; queued and failed payments are removed
      if exists (
        select 1 from public.payroll_payments p
        where p.run_id = new.run_id and p.status in ('sending', 'sent', 'paid', 'unknown')
          and public.payment_in_country(new.run_id, new.country, p.employee_number)
      ) then
        raise exception 'Payroll for % in % can''t be reopened: payments for it have already been sent.', r.pay_period, new.country;
      end if;
      delete from public.payroll_payments p
      where p.run_id = new.run_id and p.status in ('queued', 'failed') and public.payment_in_country(new.run_id, new.country, p.employee_number);
      new.approved_by := null;
      new.approved_at := null;
    elsif old.status = 'approved' and new.status = 'paid' then
      new.paid_by := auth.uid();
      new.paid_at := now();
    else
      raise exception 'Payroll for % in % can''t go from % to %', r.pay_period, new.country, old.status, new.status;
    end if;
  else
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
    new.paid_by := old.paid_by;
    new.paid_at := old.paid_at;
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.payroll_run_country_rules() from public, anon, authenticated;
drop trigger if exists payroll_run_country_rules on public.payroll_run_countries;
create trigger payroll_run_country_rules before update on public.payroll_run_countries
  for each row execute function public.payroll_run_country_rules();

-- the month-end settlement of piece rate work and contract jobs, for one country's workers (was payroll_run_work_settlement)
create or replace function public.payroll_country_work_settlement(r public.payroll_runs, p_country text, p_old text, p_new text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_changed text;
  v_later text;
begin
  if p_old = 'draft' and p_new = 'approved' then
    -- the payslips must have been worked out from the work, jobs, payouts and arrears as they are now
    select string_agg(coalesce(nullif(btrim(h.employee_name), ''), h.employee_id), ', ' order by h.employee_id) into v_changed
    from public.salary_history h
    left join public.work_settlement_for(r.tenant_id, r.pay_period) s on s.employee_number = h.employee_id
    where h.run_id = r.id and lower(h.country) = lower(p_country) and (
      h.work_pay <> coalesce(s.work_gross, 0) or h.jobs_pay <> coalesce(s.jobs_gross, 0)
      or h.paid_out <> coalesce(s.paid, 0) or h.ahl_withheld <> coalesce(s.ahl, 0)
      or h.reserve_released <> coalesce(s.reserve, 0) + coalesce(s.rounding, 0) or h.wht_withheld <> coalesce(s.wht, 0)
      or h.arrears_brought_forward <> coalesce(s.arrears, 0));
    if v_changed is not null then
      raise exception 'Piece rate work, contract jobs, payouts or arrears for % changed after payroll for % was worked out. Recalculate, then approve.',
        left(v_changed, 300), r.pay_period;
    end if;

    perform set_config('app.work_settling', 'on', true);
    update public.work_entries set settled_pay_period = r.pay_period
    where id in (select x.id from public.work_settlement_entries(r.tenant_id, r.pay_period) x
                 where public.run_country_has(r.id, p_country, x.employee_number));
    update public.contract_jobs set settled_pay_period = r.pay_period
    where id in (select x.id from public.work_settlement_jobs(r.tenant_id, r.pay_period) x
                 where public.run_country_has(r.id, p_country, x.employee_number));
    update public.work_payout_lines set settled_pay_period = r.pay_period
    where id in (select x.id from public.work_settlement_lines(r.tenant_id, r.pay_period) x
                 where public.run_country_has(r.id, p_country, x.employee_number));
    perform set_config('app.work_settling', 'off', true);

    -- the arrears this month recovered, then what it carries forward
    update public.pay_arrears a set settled_in = r.pay_period, settled_run_id = r.id
    where a.tenant_id = r.tenant_id and a.settled_in is null and a.pay_period < r.pay_period
      and public.run_country_has(r.id, p_country, a.employee_number);
    insert into public.pay_arrears (tenant_id, employee_number, pay_period, amount, reason, run_id)
    select r.tenant_id, h.employee_id, r.pay_period, h.arrears_carried_forward, coalesce(h.arrears_note, ''), r.id
    from public.salary_history h
    where h.run_id = r.id and lower(h.country) = lower(p_country) and h.arrears_carried_forward > 0 and h.employee_id is not null
    on conflict (tenant_id, employee_number, pay_period) do update
      set amount = excluded.amount, reason = excluded.reason, run_id = excluded.run_id, settled_in = null, settled_run_id = null;

  elsif p_old = 'approved' and p_new = 'draft' then
    select string_agg(distinct a.settled_in, ', ') into v_later
    from public.pay_arrears a
    where a.tenant_id = r.tenant_id and a.pay_period = r.pay_period and a.settled_in is not null
      and public.run_country_has(r.id, p_country, a.employee_number);
    if v_later is not null then
      raise exception 'Arrears from % were already recovered in the payroll for %: reopen that month first', r.pay_period, v_later;
    end if;
    delete from public.pay_arrears a
    where a.tenant_id = r.tenant_id and a.pay_period = r.pay_period and public.run_country_has(r.id, p_country, a.employee_number);
    update public.pay_arrears a set settled_in = null, settled_run_id = null
    where a.tenant_id = r.tenant_id and a.settled_in = r.pay_period and public.run_country_has(r.id, p_country, a.employee_number);

    perform set_config('app.work_settling', 'on', true);
    update public.work_entries w set settled_pay_period = null
    where w.tenant_id = r.tenant_id and w.settled_pay_period = r.pay_period and public.run_country_has(r.id, p_country, w.employee_number);
    update public.contract_jobs j set settled_pay_period = null
    where j.tenant_id = r.tenant_id and j.settled_pay_period = r.pay_period and public.run_country_has(r.id, p_country, j.employee_number);
    update public.work_payout_lines l set settled_pay_period = null
    where l.tenant_id = r.tenant_id and l.settled_pay_period = r.pay_period and public.run_country_has(r.id, p_country, l.employee_number);
    perform set_config('app.work_settling', 'off', true);
  end if;
end $$;
revoke all on function public.payroll_country_work_settlement(public.payroll_runs, text, text, text) from public, anon, authenticated;

-- loan repayments recorded from one country's payslips (was payroll_run_loan_repayments)
create or replace function public.payroll_country_loan_repayments(r public.payroll_runs, p_country text, p_old text, p_new text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_old = 'draft' and p_new = 'approved' then
    insert into public.employee_loan_repayments (tenant_id, loan_id, pay_period, amount, run_id)
    select r.tenant_id, l.id, r.pay_period, sum((i.item->>'amount')::numeric), r.id
    from public.salary_history h
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(h.deduction_items) = 'array' then h.deduction_items else '[]'::jsonb end) as i(item)
    join public.employee_loans l
      on l.id::text = i.item->>'loan_id' and l.tenant_id = r.tenant_id and l.employee_number = h.employee_id
    where h.run_id = r.id and lower(h.country) = lower(p_country) and (i.item->>'amount') ~ '^\d+(\.\d+)?$'
      and l.status in ('disbursed', 'repaying', 'completed')
    group by l.id
    on conflict (loan_id, pay_period) do update set amount = excluded.amount, run_id = excluded.run_id;
  elsif p_old = 'approved' and p_new = 'draft' then
    delete from public.employee_loan_repayments x
    where x.run_id = r.id
      and exists (select 1 from public.employee_loans l
                  where l.id = x.loan_id and public.run_country_has(r.id, p_country, l.employee_number));
  else
    return;
  end if;
  perform public.refresh_loan_statuses(r.tenant_id);
end $$;
revoke all on function public.payroll_country_loan_repayments(public.payroll_runs, text, text, text) from public, anon, authenticated;

-- leave paid out on one country's payslips marked paid (was payroll_run_leave_payouts)
create or replace function public.payroll_country_leave_payouts(r public.payroll_runs, p_country text, p_old text, p_new text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_old = 'draft' and p_new = 'approved' then
    update public.leave_payouts p
    set status = 'paid', paid_period = r.pay_period, run_id = r.id, amount = x.amount
    from (
      select (i.item->>'leave_payout_id')::uuid as payout_id, h.employee_id, sum((i.item->>'amount')::numeric) as amount
      from public.salary_history h
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(h.earning_items) = 'array' then h.earning_items else '[]'::jsonb end) as i(item)
      where h.run_id = r.id and lower(h.country) = lower(p_country)
        and (i.item->>'leave_payout_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and (i.item->>'amount') ~ '^\d+(\.\d+)?$'
      group by 1, 2
    ) x
    where p.id = x.payout_id and p.tenant_id = r.tenant_id and p.employee_number = x.employee_id and p.status = 'pending';
  elsif p_old = 'approved' and p_new = 'draft' then
    update public.leave_payouts p set status = 'pending', paid_period = null, run_id = null, amount = null
    where p.run_id = r.id and public.run_country_has(r.id, p_country, p.employee_number);
  end if;
end $$;
revoke all on function public.payroll_country_leave_payouts(public.payroll_runs, text, text, text) from public, anon, authenticated;

-- "payslip ready" when a country is approved, "salary paid" when it is marked paid, for its staff (was notify_payroll_run)
create or replace function public.payroll_country_notify(r public.payroll_runs, p_country text, p_new text) returns void
language plpgsql security definer set search_path = public as $$
declare
  h record;
  month text := to_char(to_date(r.pay_period || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY');
begin
  if p_new not in ('approved', 'paid') then
    return;
  end if;
  for h in select distinct employee_id from public.salary_history where run_id = r.id and lower(country) = lower(p_country) loop
    if p_new = 'approved' then
      perform public.notify_employee_number(r.tenant_id, h.employee_id, 'payslip_ready', 'Payslip ready',
        'Your payslip for ' || month || ' is ready. Open Payslips to see it.');
    else
      perform public.notify_employee_number(r.tenant_id, h.employee_id, 'salary_paid', 'Salary paid',
        'Your salary for ' || month || ' has been paid.');
    end if;
  end loop;
end $$;
revoke all on function public.payroll_country_notify(public.payroll_runs, text, text) from public, anon, authenticated;

create or replace function public.payroll_run_country_effects() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.payroll_runs;
begin
  if new.status is not distinct from old.status then
    return null;
  end if;
  select * into r from public.payroll_runs where id = new.run_id;
  perform public.payroll_country_work_settlement(r, new.country, old.status, new.status);
  perform public.payroll_country_loan_repayments(r, new.country, old.status, new.status);
  perform public.payroll_country_leave_payouts(r, new.country, old.status, new.status);
  perform public.payroll_country_notify(r, new.country, new.status);
  -- (changed through the run itself: the run already has its new status)
  if coalesce(current_setting('app.payroll_run_legacy', true), '') <> 'on' then
    perform public.sync_payroll_run_status(new.run_id);
  end if;
  return null;
end $$;
revoke all on function public.payroll_run_country_effects() from public, anon, authenticated;
drop trigger if exists payroll_run_country_effects on public.payroll_run_countries;
create trigger payroll_run_country_effects after update of status on public.payroll_run_countries
  for each row execute function public.payroll_run_country_effects();

-- a country added to (or removed from) the month: the run's status follows
create or replace function public.payroll_run_country_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.payroll_run_legacy', true), '') <> 'on' then
    perform public.sync_payroll_run_status(case when tg_op = 'DELETE' then old.run_id else new.run_id end);
  end if;
  return null;
end $$;
revoke all on function public.payroll_run_country_sync() from public, anon, authenticated;
drop trigger if exists payroll_run_country_sync on public.payroll_run_countries;
create trigger payroll_run_country_sync after insert or delete on public.payroll_run_countries
  for each row execute function public.payroll_run_country_sync();

-- payroll approves (or reopens, or marks paid) several countries at once; returns the countries changed
create or replace function public.set_payroll_countries_status(p_run uuid, p_countries text[], p_status text) returns text[]
language plpgsql security invoker set search_path = public as $$
declare
  v_done text[] := '{}';
  c text;
  v_from text;
begin
  if not public.has_module('payroll') then
    raise exception 'Only payroll can approve payroll' using errcode = '42501';
  end if;
  if p_status not in ('draft', 'approved', 'paid') then
    raise exception 'Choose draft, approved or paid' using errcode = '22023';
  end if;
  v_from := case p_status when 'approved' then 'draft' when 'draft' then 'approved' else 'approved' end;
  foreach c in array coalesce(p_countries, '{}') loop
    update public.payroll_run_countries set status = p_status
    where run_id = p_run and lower(country) = lower(btrim(c)) and status = v_from;
    if found then
      v_done := v_done || public.tidy_country(c);
    end if;
  end loop;
  return v_done;
end $$;
revoke all on function public.set_payroll_countries_status(uuid, text[], text) from public, anon;
grant execute on function public.set_payroll_countries_status(uuid, text[], text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 9. what reads "approved" per payslip now reads the payslip's country
-- ---------------------------------------------------------------------------------------------
-- the server pays approved countries only
create or replace function public.claim_payroll_payments(p_channel text, p_limit integer)
returns setof public.payroll_payments
language sql security definer set search_path = public as $$
  update public.payroll_payments p
  set status = 'sending',
      attempts = p.attempts + 1,
      request_id = 'PAYROLL-' || gen_random_uuid()::text,
      provider_ref = null,
      result_code = null,
      result_desc = null,
      sent_at = null,
      updated_at = now()
  where p.id in (
    select q.id
    from public.payroll_payments q
    join public.payroll_runs r on r.id = q.run_id
    left join public.salary_history h on h.run_id = q.run_id and h.employee_id = q.employee_number
    where q.channel = p_channel and q.status = 'queued'
      and case when h.id is null then r.status in ('approved', 'paid') else public.payslip_closed(q.run_id, h.country) end
    order by q.queued_at, q.id
    limit greatest(p_limit, 0)
    for update of q skip locked
  )
  returning p.*;
$$;

-- the NITA levy is Kenya's: a payslip in another country has none
create or replace function public.salary_history_nita_levy() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind text;
  v_status text;
begin
  if tg_op = 'UPDATE' then
    -- renumbering follows through locked payslips without changing figures
    if (to_jsonb(new) - 'employee_id' - 'nita_levy') = (to_jsonb(old) - 'employee_id' - 'nita_levy') then
      new.nita_levy := old.nita_levy;
      return new;
    end if;
    v_status := public.payroll_country_status(new.run_id, new.country);
    if v_status is not null and v_status <> 'draft' then
      return new;
    end if;
  end if;
  if new.pay_period is null or new.pay_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    return new;
  end if;
  if lower(coalesce(new.country, 'Kenya')) <> 'kenya' then
    new.nita_levy := 0;
    return new;
  end if;
  select coalesce(e.worker_kind, 'employee') into v_kind
  from public.employees e where e.tenant_id = new.tenant_id and e."Employee Number" = new.employee_id;
  new.nita_levy := case when v_kind in ('casual', 'contractor') then 0
                        else coalesce(public.statutory_rate_for(new.tenant_id, 'nita_levy',
                               (to_date(new.pay_period || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date, 'Kenya'), 0) end;
  return new;
end $$;

-- payroll: the month's NITA levy per employee, Kenya's payslips only
create or replace function public.nita_levy_for(p_period text)
returns table (employee_number text, employee_name text, nita_number text, levy numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null or not public.has_module('payroll') then
    raise exception 'Only payroll can see the NITA levy' using errcode = '42501';
  end if;
  if p_period is null or p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Pay period "%" should look like 2026-09 (year-month)', coalesce(p_period, '') using errcode = '22023';
  end if;
  return query
  select h.employee_id,
         coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), h.employee_name, h.employee_id),
         nullif(btrim(e."NITA"), ''),
         h.nita_levy
  from public.salary_history h
  left join public.employees e on e.tenant_id = h.tenant_id and e."Employee Number" = h.employee_id
  where h.tenant_id = v_tenant and h.pay_period = p_period and h.nita_levy > 0 and lower(h.country) = 'kenya'
  order by h.employee_id;
end $$;

-- a payslip edit only while its payslip's country is a draft
create or replace function public.payslip_edit_run_is_draft() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  run public.payroll_runs;
  row_run uuid;
  row_tenant uuid;
  row_employee text;
  v_country text;
  v_status text;
begin
  if tg_op = 'DELETE' then
    row_run := old.run_id;
    row_tenant := old.tenant_id;
    row_employee := old.employee_id;
  else
    row_run := new.run_id;
    row_tenant := new.tenant_id;
    row_employee := new.employee_id;
  end if;

  -- the company itself is being deleted
  if tg_op = 'DELETE' and not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;

  select * into run from public.payroll_runs where id = row_run;
  -- the run is being deleted (a discarded draft takes its edits with it)
  if not found and tg_op = 'DELETE' then
    return old;
  end if;
  if not found or run.tenant_id <> row_tenant then
    raise exception 'That payroll run was not found';
  end if;
  v_country := coalesce((select h.country from public.salary_history h where h.run_id = row_run and h.employee_id = row_employee limit 1),
                        public.employee_country(row_tenant, row_employee));
  v_status := coalesce(public.payroll_country_status(row_run, v_country), 'draft');
  if v_status <> 'draft' then
    raise exception 'Payroll for % in % is %, so its payslips can''t be edited. Reopen it first.', run.pay_period, v_country, v_status;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.run_id <> old.run_id or new.employee_id <> old.employee_id or new.tenant_id <> old.tenant_id) then
    raise exception 'A payslip edit can''t be moved to another payslip';
  end if;
  if tg_table_name = 'payslip_overrides' and tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  if tg_table_name = 'payslip_edits' then
    new.pay_period := run.pay_period;
    new.edited_at := now();
  end if;
  return new;
end $$;

-- the piece rate settlement's catch-up: an item from an earlier month settles in a later payroll when its own month
-- was approved without it for the worker's country
create or replace function public.work_settles_in(p_tenant uuid, p_natural text, p_period text, p_employee text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_natural = p_period or (p_natural < p_period
    and public.pay_month_closed(p_tenant, to_date(p_natural || '-01', 'YYYY-MM-DD'), p_employee))
$$;
revoke all on function public.work_settles_in(uuid, text, text, text) from public, anon, authenticated;

create or replace function public.work_settlement_entries(p_tenant uuid, p_period text) returns setof public.work_entries
language sql stable security definer set search_path = public as $$
  select w.* from public.work_entries w
  left join public.work_payout_lines l on l.id = w.payout_line_id
  left join public.work_payout_batches b on b.id = l.batch_id
  where w.tenant_id = p_tenant and w.status = 'approved' and w.settled_pay_period is null
    and public.work_settles_in(p_tenant, coalesce(b.pay_period, to_char(w.work_date, 'YYYY-MM')), p_period, w.employee_number)
$$;

create or replace function public.work_settlement_jobs(p_tenant uuid, p_period text) returns setof public.contract_jobs
language sql stable security definer set search_path = public as $$
  select j.* from public.contract_jobs j
  left join public.work_payout_lines l on l.id = j.payout_line_id
  left join public.work_payout_batches b on b.id = l.batch_id
  where j.tenant_id = p_tenant and j.status = 'approved' and j.approved_at is not null and j.settled_pay_period is null
    and public.work_settles_in(p_tenant,
          coalesce(b.pay_period, to_char(j.approved_at at time zone 'Africa/Nairobi', 'YYYY-MM')), p_period, j.employee_number)
$$;

create or replace function public.work_settlement_lines(p_tenant uuid, p_period text) returns setof public.work_payout_lines
language sql stable security definer set search_path = public as $$
  select l.* from public.work_payout_lines l
  join public.work_payout_batches b on b.id = l.batch_id
  where l.tenant_id = p_tenant and b.tenant_id = p_tenant and b.status in ('approved', 'exported')
    and l.settled_pay_period is null and public.work_settles_in(p_tenant, b.pay_period, p_period, l.employee_number)
$$;

-- the signed-in worker: is that month settled? (their payslip's country approved)
create or replace function public.my_work_settlement(p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_me text := public.current_employee_number();
  v_period text := to_char(coalesce(p_month, public.work_today()), 'YYYY-MM');
  r public.payroll_runs;
  h public.salary_history;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into r from public.payroll_runs where tenant_id = v_tenant and pay_period = v_period;
  if r.id is not null and v_me is not null then
    select * into h from public.salary_history x
    where x.run_id = r.id and x.employee_id = v_me and public.payslip_closed(x.run_id, x.country) limit 1;
  end if;
  return jsonb_build_object(
    'pay_period', v_period,
    'settled', h.id is not null,
    'net_pay', coalesce(h.net_pay, 0),
    'paid_out', coalesce(h.paid_out, 0),
    'arrears_brought_forward', coalesce(h.arrears_brought_forward, 0),
    'arrears_carried_forward', coalesce(h.arrears_carried_forward, 0)
  );
end $$;

-- the P9 is Kenya's tax card: the employee's approved Kenya payslips of the year
create or replace function public.p9_payslips(p_employee uuid, p_year integer)
returns setof public.salary_history
language plpgsql stable security definer set search_path = public as $$
declare
  e public.employees;
begin
  select * into e from public.employees where id = p_employee and tenant_id = public.current_tenant_id();
  if e.id is null then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
  if not (public.is_own_employee(e.id) or public.has_any_module('payroll', 'hr-lifecycle')) then
    raise exception 'You can only see your own P9' using errcode = '42501';
  end if;
  return query
  select h.* from public.salary_history h
  where h.tenant_id = e.tenant_id and h.employee_id = e."Employee Number"
    and lower(h.country) = 'kenya' and public.payslip_closed(h.run_id, h.country) and h.pay_period like p_year::text || '-%'
  order by h.pay_period;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 10. the month lock per employee in work, overtime and imports (unchanged but for the employee's own lock)
-- ---------------------------------------------------------------------------------------------
create or replace function public.work_entry_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_payroll boolean := public.manages_work();
  v_self boolean;
  v_supervisor boolean;
  v_type public.work_types;
  v_kind text;
  v_needs boolean;
begin
  -- an employee renumbered (work_follow_renumber): only employee_number changes
  if tg_op = 'UPDATE' and current_setting('app.renumbering_worker', true) = 'on'
     and (to_jsonb(new) - 'employee_number' - 'amount') = (to_jsonb(old) - 'employee_number' - 'amount') then
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.paid_out_at is not null then raise exception 'This work has been paid out and can''t be removed'; end if;
    if public.pay_month_closed(old.tenant_id, old.work_date, old.employee_number) then
      raise exception 'Payroll for % is approved; this work can''t be removed', to_char(old.work_date, 'Mon YYYY');
    end if;
    if auth.uid() is not null and not v_payroll then
      if old.status = 'approved' then raise exception 'Approved work can only be removed by payroll'; end if;
      if not (public.supervises(old.employee_number) or old.entered_by = auth.uid()) then
        raise exception 'Only payroll, the supervisor or whoever recorded it can remove this work';
      end if;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.paid_out_at is not null and new.paid_out_at is not distinct from old.paid_out_at then
      raise exception 'This work has been paid out and can''t be changed';
    end if;
    if public.pay_month_closed(old.tenant_id, old.work_date, old.employee_number) then
      raise exception 'Payroll for % is approved; this work can''t be changed', to_char(old.work_date, 'Mon YYYY');
    end if;
    if new.employee_number is distinct from old.employee_number and auth.uid() is not null and not v_payroll then
      raise exception 'Only payroll can move work to another worker';
    end if;
  end if;

  if public.pay_month_closed(new.tenant_id, new.work_date, new.employee_number) then
    raise exception 'Payroll for % is approved; record this work in an open month', to_char(new.work_date, 'Mon YYYY');
  end if;
  if new.work_date > current_date + 1 then raise exception 'Work can''t be recorded for a future day'; end if;

  select e.worker_kind into v_kind from public.employees e
  where e.tenant_id = new.tenant_id and e."Employee Number" = new.employee_number;
  if not found then raise exception 'Unknown worker %', new.employee_number; end if;
  if v_kind = 'casual' then
    raise exception '% is a casual worker: record their days on the Casual workers page', new.employee_number;
  end if;

  select * into v_type from public.work_types where id = new.work_type_id and tenant_id = new.tenant_id;
  if not found then raise exception 'Unknown kind of work'; end if;
  if tg_op = 'INSERT' or new.work_type_id is distinct from old.work_type_id or new.work_date is distinct from old.work_date then
    if (tg_op = 'INSERT' or new.work_type_id is distinct from old.work_type_id) and not v_type.active then
      raise exception '% is paused; pick another kind of work', v_type.name;
    end if;
    if (v_type.effective_from is not null and new.work_date < v_type.effective_from)
       or (v_type.effective_to is not null and new.work_date > v_type.effective_to) then
      raise exception '% can only be recorded from % to %', v_type.name,
        coalesce(to_char(v_type.effective_from, 'DD Mon YYYY'), 'the start'), coalesce(to_char(v_type.effective_to, 'DD Mon YYYY'), 'now');
    end if;
    new.rate := public.work_rate_on(v_type.id, new.work_date);
  end if;

  new.updated_at := now();

  -- the server and SQL scripts (no signed-in user) are trusted
  if auth.uid() is null then return new; end if;

  v_self := new.employee_number = public.current_employee_number();
  v_supervisor := not v_self and public.supervises(new.employee_number);
  v_needs := public.supervisor_work_needs_approval(new.tenant_id);

  if tg_op = 'INSERT' then
    new.entered_by := auth.uid();
    new.paid_out_at := null;
    new.rejection_reason := null;
    if v_payroll then
      new.source := case when new.source = 'upload' then 'upload' else 'payroll' end;
    elsif v_supervisor then
      new.source := 'supervisor';
      new.import_id := null;
    elsif v_self then
      new.source := 'self';
      new.import_id := null;
    else
      raise exception 'You can only record work for yourself or your team';
    end if;
    new.decided_by := null; new.decided_at := null;
    if new.status = 'draft' then
      new.submitted_at := null;
      return new;
    end if;
    new.submitted_at := now();
    -- payroll's own work counts at once; a supervisor's too when the company doesn't ask payroll to check it; a
    -- worker's own waits for their supervisor
    if new.source in ('payroll', 'upload') or (new.source = 'supervisor' and not v_needs) then
      new.status := 'approved';
      new.decided_by := auth.uid(); new.decided_at := now();
    else
      new.status := 'submitted';
    end if;
    return new;
  end if;

  -- UPDATE
  new.paid_out_at := old.paid_out_at;
  new.source := old.source;
  new.entered_by := old.entered_by;
  new.import_id := old.import_id;

  if old.status = 'approved' and not v_payroll then
    raise exception 'Approved work can only be changed by payroll';
  end if;
  -- a worker only touches their own entries (not what their supervisor or payroll recorded for them)
  if not (v_payroll or v_supervisor) and old.source <> 'self' then
    raise exception 'Only payroll or the supervisor can change this work';
  end if;

  if new.status is distinct from old.status then
    if new.status in ('approved', 'rejected') then
      if not (v_payroll or v_supervisor) then
        raise exception 'Only payroll or the supervisor can approve or reject work';
      end if;
      if v_self and new.status = 'approved' then raise exception 'Someone else must approve your work'; end if;
      if not v_payroll then
        if old.status <> 'submitted' then raise exception 'Only submitted work can be approved or rejected'; end if;
        if old.source <> 'self' then raise exception 'Work a supervisor entered is approved by payroll'; end if;
      end if;
      new.decided_by := auth.uid(); new.decided_at := now();
      if new.status = 'approved' then new.rejection_reason := null; end if;
    elsif new.status = 'submitted' then
      if old.status = 'approved' then
        -- payroll reopening it (checked above): it waits again
        new.status := 'submitted';
        new.decided_by := null; new.decided_at := null;
      elsif v_payroll or (v_supervisor and old.source <> 'self' and not v_needs) then
        new.status := 'approved';
        new.decided_by := auth.uid(); new.decided_at := now();
      else
        new.decided_by := null; new.decided_at := null;
      end if;
      new.submitted_at := now();
      new.rejection_reason := null;
    elsif new.status = 'draft' then
      if old.status = 'approved' then raise exception 'Reopen approved work rather than making it a draft'; end if;
      if not (v_payroll or old.entered_by = auth.uid()) then
        raise exception 'Only whoever recorded it can take it back to a draft';
      end if;
      new.decided_by := null; new.decided_at := null; new.submitted_at := null; new.rejection_reason := null;
    end if;
  else
    new.decided_by := old.decided_by; new.decided_at := old.decided_at;
    new.submitted_at := old.submitted_at;
  end if;
  return new;
end $$;


create or replace function public.overtime_entry_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_payroll boolean := public.manages_work();
  v_self boolean;
  v_supervisor boolean;
  v_reason text;
begin
  -- an employee renumbered, or the kind of day worked out again after a holiday or work week changed
  if tg_op = 'UPDATE' and current_setting('app.overtime_system', true) = 'on'
     and (to_jsonb(new) - 'employee_number' - 'day_type' - 'updated_at') = (to_jsonb(old) - 'employee_number' - 'day_type' - 'updated_at') then
    return new;
  end if;

  if tg_op = 'DELETE' then
    if public.pay_month_closed(old.tenant_id, old.work_date, old.employee_number) then
      raise exception 'Payroll for % is approved; this overtime can''t be removed', to_char(old.work_date, 'Mon YYYY');
    end if;
    if auth.uid() is not null and not v_payroll and not public.supervises(old.employee_number)
       and not (old.employee_number = public.current_employee_number() and old.status <> 'approved') then
      raise exception 'Only payroll or the supervisor can remove approved overtime';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if public.pay_month_closed(old.tenant_id, old.work_date, old.employee_number) then
      raise exception 'Payroll for % is approved; this overtime can''t be changed', to_char(old.work_date, 'Mon YYYY');
    end if;
    if new.employee_number is distinct from old.employee_number then
      raise exception 'Remove the overtime and record it for the other person instead';
    end if;
  end if;

  if new.work_date is null then raise exception 'Choose the day the overtime was worked'; end if;
  if public.pay_month_closed(new.tenant_id, new.work_date, new.employee_number) then
    raise exception 'Payroll for % is approved; record this overtime in an open month', to_char(new.work_date, 'Mon YYYY');
  end if;
  if new.work_date > current_date + 1 then raise exception 'Overtime can''t be recorded for a day still to come'; end if;
  if nullif(btrim(new.employee_number), '') is null then raise exception 'Choose who worked the overtime'; end if;

  if tg_op = 'INSERT' or new.work_date is distinct from old.work_date or new.hours is distinct from old.hours then
    if not (select enabled from public.overtime_settings(new.tenant_id)) then
      raise exception 'Overtime is turned off for this company (payroll settings)';
    end if;
    v_reason := public.overtime_excluded_reason(new.tenant_id, new.employee_number);
    if v_reason = 'Unknown employee' then
      raise exception 'Unknown employee %', new.employee_number;
    elsif v_reason is not null then
      raise exception '%: %', new.employee_number, v_reason;
    end if;
  end if;

  new.day_type := public.overtime_day_type(new.tenant_id, new.employee_number, new.work_date);
  new.note := nullif(btrim(new.note), '');
  new.updated_at := now();

  -- the server and SQL scripts (no signed-in user) are trusted
  if auth.uid() is null then return new; end if;

  v_self := coalesce(new.employee_number = public.current_employee_number(), false);
  v_supervisor := not v_self and public.supervises(new.employee_number);

  if tg_op = 'INSERT' then
    new.entered_by := auth.uid();
    if v_payroll and not v_self then
      new.source := case when new.source = 'upload' then 'upload' else 'payroll' end;
    elsif v_supervisor then
      new.source := 'supervisor';
    elsif v_self then
      new.source := 'self';
    else
      raise exception 'You can only record overtime for your team, or request your own';
    end if;
    -- payroll and supervisors check overtime as they enter it; an employee's own request waits for approval
    new.rejection_reason := null;
    if new.source = 'self' then
      new.status := 'submitted';
      new.decided_by := null; new.decided_at := null;
    else
      new.status := 'approved';
      new.decided_by := auth.uid(); new.decided_at := now();
    end if;
    return new;
  end if;

  -- UPDATE
  new.source := old.source;
  new.entered_by := old.entered_by;
  if v_self and not v_payroll then
    -- the employee: only their own request that isn't approved, and changing it sends it back for approval
    if old.status = 'approved' then raise exception 'Approved overtime can only be changed by payroll or the supervisor'; end if;
    if new.status = 'approved' then raise exception 'Someone else must approve your overtime'; end if;
    new.status := 'submitted';
    new.decided_by := null; new.decided_at := null; new.rejection_reason := null;
    return new;
  end if;
  if not (v_payroll or v_supervisor) then
    raise exception 'Only payroll or the supervisor can change this overtime';
  end if;
  if v_self and new.status = 'approved' and old.status <> 'approved' then
    raise exception 'Someone else must approve your overtime';
  end if;
  if new.status is distinct from old.status then
    if new.status = 'submitted' then
      new.decided_by := null; new.decided_at := null; new.rejection_reason := null;
    else
      new.decided_by := auth.uid(); new.decided_at := now();
      if new.status = 'approved' then new.rejection_reason := null; end if;
    end if;
  elsif new.hours is distinct from old.hours or new.work_date is distinct from old.work_date then
    -- payroll or the supervisor correcting the hours: what they enter is approved (their own waits for someone else)
    if v_self then
      new.status := 'submitted';
      new.decided_by := null; new.decided_at := null;
    else
      new.status := 'approved';
      new.decided_by := auth.uid(); new.decided_at := now();
    end if;
    new.rejection_reason := null;
  else
    new.decided_by := old.decided_by; new.decided_at := old.decided_at;
  end if;
  return new;
end $$;


create or replace function public.overtime_reclassify(p_tenant uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_tenant is null or not exists (select 1 from public.overtime_entries where tenant_id = p_tenant) then
    return;
  end if;
  perform set_config('app.overtime_system', 'on', true);
  update public.overtime_entries o
     set day_type = public.overtime_day_type(o.tenant_id, o.employee_number, o.work_date)
   where o.tenant_id = p_tenant
     and not public.pay_month_closed(o.tenant_id, o.work_date, o.employee_number)
     and o.day_type is distinct from public.overtime_day_type(o.tenant_id, o.employee_number, o.work_date);
  perform set_config('app.overtime_system', 'off', true);
end $$;

create or replace function public.work_import_rows(p_rows jsonb, p_import uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_row jsonb;
  v_i integer := 0;
  v_n integer;
  v_out jsonb := '[]'::jsonb;
  v_emp text;
  v_found text;
  v_name text;
  v_kind text;
  v_basis text;
  v_date date;
  v_type public.work_types;
  v_qty numeric;
  v_rate numeric;
  v_error text;
  v_seen jsonb := '{}'::jsonb;
  v_key text;
  v_existing numeric;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Send a list of rows' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'At most 5000 rows at a time' using errcode = '22023'; end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_n := case when jsonb_typeof(v_row->'sheet_row') = 'number' then (v_row->>'sheet_row')::numeric::integer else v_i end;
    v_error := null; v_found := null; v_name := null; v_date := null; v_type := null; v_qty := null; v_rate := null; v_kind := null; v_basis := null;
    v_emp := nullif(btrim(v_row->>'employee_number'), '');

    if v_emp is null then
      v_error := 'Add the employee number';
    else
      select e."Employee Number", nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), e.worker_kind, e.pay_basis
        into v_found, v_name, v_kind, v_basis
      from public.employees e where e.tenant_id = v_tenant and lower(e."Employee Number") = lower(v_emp)
      order by (e."Employee Number" = v_emp) desc limit 1;
      if v_found is null then
        v_error := 'Unknown worker ' || v_emp;
      else
        v_emp := v_found;
        if v_kind = 'casual' then
          v_error := v_emp || ' is a casual worker: record their days on the Casual workers page';
        elsif v_basis <> 'work' then
          v_error := v_emp || ' is paid a salary; set them to be paid by work first (Piece rate > Workers)';
        end if;
      end if;
    end if;

    if v_error is null then
      begin
        v_date := nullif(btrim(v_row->>'work_date'), '')::date;
      exception when others then
        v_date := null;
      end;
      if v_date is null then
        v_error := 'The date "' || coalesce(v_row->>'work_date', '') || '" should look like 2026-10-16';
      elsif v_date > current_date + 1 then
        v_error := 'The date ' || to_char(v_date, 'DD Mon YYYY') || ' is in the future';
      elsif public.pay_month_closed(v_tenant, v_date, v_emp) then
        v_error := 'Payroll for ' || to_char(v_date, 'Mon YYYY') || ' is approved; that month is locked';
      end if;
    end if;

    if v_error is null then
      select * into v_type from public.work_types t
      where t.tenant_id = v_tenant and lower(btrim(t.name)) = lower(btrim(coalesce(v_row->>'work_type', '')));
      if v_type.id is null then
        v_error := 'Unknown kind of work "' || coalesce(v_row->>'work_type', '') || '"';
      elsif not v_type.active then
        v_error := v_type.name || ' is paused';
      elsif (v_type.effective_from is not null and v_date < v_type.effective_from)
         or (v_type.effective_to is not null and v_date > v_type.effective_to) then
        v_error := v_type.name || ' can''t be recorded on ' || to_char(v_date, 'DD Mon YYYY');
      end if;
    end if;

    if v_error is null then
      begin
        v_qty := nullif(replace(btrim(v_row->>'quantity'), ',', ''), '')::numeric;
      exception when others then
        v_qty := null;
      end;
      if v_qty is null or v_qty <= 0 or v_qty >= 1000000000 then
        v_error := 'The quantity "' || coalesce(v_row->>'quantity', '') || '" should be a number more than 0';
      else
        v_qty := round(v_qty, 3);
      end if;
    end if;

    if v_error is null then
      v_key := v_emp || '|' || v_date || '|' || v_type.id;
      if v_seen ? v_key then
        v_error := 'The same worker, day and kind of work as row ' || (v_seen->>v_key);
      else
        v_seen := v_seen || jsonb_build_object(v_key, v_n);
        select w.amount into v_existing from public.work_entries w
        where w.tenant_id = v_tenant and w.employee_number = v_emp and w.work_date = v_date and w.work_type_id = v_type.id
          and w.status <> 'rejected'
        limit 1;
        if found then
          v_error := 'Already recorded for ' || v_emp || ' on ' || to_char(v_date, 'DD Mon YYYY') || ' (' || public.kes(v_existing) || ')';
        end if;
      end if;
    end if;

    if v_error is null then
      v_rate := public.work_rate_on(v_type.id, v_date);
      if p_import is not null then
        begin
          insert into public.work_entries (tenant_id, employee_number, work_date, work_type_id, quantity, rate, source, notes, import_id)
          values (v_tenant, v_emp, v_date, v_type.id, v_qty, v_rate, 'upload', nullif(btrim(v_row->>'notes'), ''), p_import);
        exception when others then
          v_error := sqlerrm;
        end;
      end if;
    end if;

    v_out := v_out || jsonb_build_object(
      'row', v_n, 'ok', v_error is null, 'error', v_error, 'employee_number', v_emp, 'worker_name', v_name,
      'work_date', v_date, 'work_type_id', v_type.id, 'work_type', v_type.name, 'unit', v_type.unit,
      'quantity', v_qty, 'rate', v_rate, 'amount', case when v_error is null then round(v_qty * v_rate, 2) end);
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 11. deleting an employee, payslip emails: per payslip country
-- ---------------------------------------------------------------------------------------------
create or replace function public.delete_employee(p_employee uuid, p_confirm boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.employees;
  locked integer;
  login uuid;
  files text[];
  leave_count integer;
  documents integer;
  reason text;
begin
  if not public.has_module('employees') then
    raise exception 'Only HR can delete employees' using errcode = '42501';
  end if;
  select * into e from public.employees where id = p_employee and tenant_id = public.current_tenant_id();
  if e.id is null then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;

  select count(*) into locked
  from public.salary_history h
  where h.tenant_id = e.tenant_id and h.employee_id = e."Employee Number" and public.payslip_closed(h.run_id, h.country);

  if e."Employee Number" = public.current_employee_number() then
    reason := 'You can''t delete your own employee record';
  elsif locked > 0 then
    reason := 'They have payslips in approved payroll months, which must be kept. Terminate them instead.';
  end if;

  select u.id into login
  from auth.users u join public.memberships m on m.user_id = u.id and m.tenant_id = e.tenant_id
  where lower(u.email) = lower(btrim(coalesce(e."Work Email", '')))
  limit 1;

  select array_agg(x.file_path) into files from (
    select d.file_path from public.employee_documents d where d.employee_id = e.id
    union all
    select f.file_path from public.employee_health_files f join public.employee_health_records r on r.id = f.record_id
    where r.employee_id = e.id
  ) x;
  select count(*) into documents from public.employee_documents d where d.employee_id = e.id;
  select count(*) into leave_count from public.leave_application l where l.tenant_id = e.tenant_id and l."Employee Number" = e."Employee Number";

  if not p_confirm then
    return jsonb_build_object(
      'employee_number', e."Employee Number",
      'name', btrim(concat_ws(' ', e."First Name", e."Middle Name", e."Last Name")),
      'blocked', reason,
      'has_login', login is not null,
      'documents', documents,
      'leave_applications', leave_count
    );
  end if;

  if reason is not null then
    raise exception '%', reason using errcode = '42501';
  end if;

  delete from public.salary_history where tenant_id = e.tenant_id and employee_id = e."Employee Number";
  delete from public.leave_application where tenant_id = e.tenant_id and "Employee Number" = e."Employee Number";
  update public.invitations set status = 'revoked'
  where tenant_id = e.tenant_id and lower(email) = lower(btrim(coalesce(e."Work Email", ''))) and status = 'pending';
  delete from public.employees where id = e.id;

  return jsonb_build_object(
    'employee_number', e."Employee Number",
    'login_user_id', login,
    'files', coalesce(to_jsonb(files), '[]'::jsonb)
  );
end $$;


create or replace function public.queue_payslip_emails(p_run uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  r public.payroll_runs;
  v_password boolean;
begin
  if not public.has_module('payroll') then
    raise exception 'Only payroll can email payslips' using errcode = '42501';
  end if;
  select * into r from public.payroll_runs where id = p_run and tenant_id = v_tenant;
  if r.id is null then
    raise exception 'Payroll run not found' using errcode = 'P0002';
  end if;
  -- at least one of the month's countries approved: its payslips are emailed (a draft country's are not)
  if r.status not in ('approved', 'paid')
     and not exists (select 1 from public.payroll_run_countries c where c.run_id = r.id and c.status in ('approved', 'paid')) then
    raise exception 'Approve the payroll before emailing payslips';
  end if;
  select coalesce((select s.payslip_pdf_password from public.company_payroll_settings s where s.tenant_id = v_tenant), true)
    into v_password;

  with people as (
    select distinct on (h.employee_id) h.employee_id as number,
           coalesce(nullif(btrim(concat_ws(' ', nullif(btrim(e."First Name"), ''), nullif(btrim(e."Last Name"), ''))), ''),
                    nullif(btrim(h.employee_name), '')) as name,
           e.id as emp_id, btrim(e."Work Email") as email, nullif(btrim(e."ID Number"), '') as id_number
    from public.salary_history h
    left join public.employees e on e.tenant_id = v_tenant and e."Employee Number" = h.employee_id
    where h.run_id = r.id and coalesce(btrim(h.employee_id), '') <> '' and public.payslip_closed(h.run_id, h.country)
    order by h.employee_id
  ),
  judged as (
    select p.*,
           case when p.emp_id is null then 'Not emailed: no employee record'
                when not public.email_address_ok(p.email) then 'Not emailed: no work email'
                when v_password and p.id_number is null then 'Not emailed: no ID number for the PDF password'
           end as skip_reason
    from people p
  )
  insert into public.payslip_emails as pe (tenant_id, run_id, pay_period, employee_number, employee_name, to_email, status,
                                           pdf_path, password_protected, error, queued_by)
  select v_tenant, r.id, r.pay_period, j.number, j.name, case when j.skip_reason is null then lower(j.email) end,
         case when j.skip_reason is null then 'waiting_pdf' else 'skipped' end,
         public.payslip_pdf_path(v_tenant, r.pay_period, j.number), v_password, j.skip_reason, auth.uid()
  from judged j
  on conflict (run_id, employee_number) do update
    set employee_name = excluded.employee_name, to_email = excluded.to_email, status = excluded.status,
        password_protected = excluded.password_protected, error = excluded.error, attempts = 0,
        queued_by = excluded.queued_by, updated_at = now(), sent_at = null, provider_id = null
    where pe.status in ('failed', 'skipped');

  -- their "Payslip ready" notification is not emailed on its own: the payslip email says the same, with the PDF
  update public.hr_notifications n
  set email_sent = true, email_error = 'not emailed: the payslip is emailed with its PDF'
  where n.tenant_id = v_tenant and n.notification_type = 'payslip_ready' and not n.email_sent
    and exists (select 1 from public.payslip_emails pe
                where pe.run_id = r.id and pe.employee_number = n.employee_number and pe.status <> 'skipped');

  return public.payslip_email_summary(r.id);
end $$;

create or replace function public.claim_payslip_emails(p_limit integer default 10)
returns table (
  id bigint, tenant_id uuid, employee_number text, to_email text, first_name text, company_name text,
  pay_period text, pdf_path text, password_protected boolean, keep_days integer
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  update public.payslip_emails set status = 'pending', updated_at = now()
  where status = 'sending' and updated_at < now() - interval '15 minutes';

  return query
  with picked as (
    select pe.id from public.payslip_emails pe
    join public.salary_history h on h.run_id = pe.run_id and h.employee_id = pe.employee_number
      and public.payslip_closed(h.run_id, h.country)
    where pe.status = 'pending'
    order by pe.id
    limit greatest(coalesce(p_limit, 10), 1)
    for update of pe skip locked
  ),
  claimed as (
    update public.payslip_emails pe set status = 'sending', updated_at = now()
    from picked where pe.id = picked.id
    returning pe.*
  )
  select c.id, c.tenant_id, c.employee_number, c.to_email,
         (select nullif(btrim(e."First Name"), '') from public.employees e
          where e.tenant_id = c.tenant_id and e."Employee Number" = c.employee_number limit 1),
         public.email_company_name(c.tenant_id),
         c.pay_period, c.pdf_path, c.password_protected,
         coalesce((select s.payslip_pdf_keep_days from public.company_payroll_settings s where s.tenant_id = c.tenant_id), 0)
  from claimed c
  order by c.id;
end $$;

notify pgrst, 'reload schema';
