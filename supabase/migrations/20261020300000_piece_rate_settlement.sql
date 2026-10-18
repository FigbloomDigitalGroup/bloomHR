-- Piece rate and contract jobs, stage 5: the month-end settlement in the monthly payroll run (FIG-812). Builds on
-- 20261014100000_piece_rate.sql, 20261019800000_piece_rate_recording.sql, 20261020100000_piece_rate_staff.sql and
-- 20261020200000_piece_rate_payouts.sql, which are not changed.
--
-- During the month workers paid by work (and per job) are paid in payouts that hold part of the pay back (stage 4).
-- The monthly payroll run settles the month: it adds the month's approved work and contract jobs to the payslip as
-- earnings ("Piece rate work", "Contract jobs"), works out PAYE, NSSF, SHIF and AHL on the month's total exactly as for
-- a salary (the browser's payroll calculation, lib/statutoryCalc; there is no second tax calculator), takes off what
-- the payouts already paid and any arrears brought forward, and pays the balance. Statutory returns stay one line per
-- worker per month: the payslip is the only place the month's PAYE, NSSF, SHIF and AHL are worked out.
--
--   work_month_settlement(month)     payroll: per worker, the month's work gross and contract jobs gross (paid out or
--                                    not), the gross already paid out, what payouts paid and held back (AHL, reserve,
--                                    WHT, rounding: the same figures as work_payout_month_totals(month)) and arrears
--                                    brought forward. The payroll page adds these to the month's payslips.
--   salary_history                   new columns: work_pay, jobs_pay, work_items (by kind of work), paid_out (what
--                                    payouts actually paid), ahl_withheld, reserve_released (reserve + rounding),
--                                    wht_withheld, wht_rate, wht_tax, arrears_brought_forward, arrears_carried_forward,
--                                    arrears_note, worker_kind, work_settlement (this payslip settles a month of work)
--   work_entries / contract_jobs / work_payout_lines .settled_pay_period   set when the payroll run that settled them
--                                    is approved, so nothing is ever counted twice; cleared if that run is reopened
--   pay_arrears                      what a worker still owes when a month's deductions were more than was left to pay
--                                    (or over the two-thirds limit): the month it arose in, the amount, why, and the
--                                    month whose payroll recovered it (settled_in)
--   company_payroll_settings.deduction_cap   (default on) Employment Act s.19(3): deductions are kept within two-thirds
--                                    of the month's wages; the rest carries forward as an arrear
--   my_work_settlement(month)        the signed-in worker: whether that month's work is settled on an approved payslip
--
-- The settlement (worked out in the browser, lib/workSettlement, and saved on the payslip):
--   net to pay at month end = gross pay - total deductions - paid out during the month - arrears brought forward
--                             + carried forward (never below 0)
--   * gross pay includes ALL the month's work and jobs, paid out or not; what payouts held back is therefore part of
--     it and is never deducted again: AHL withheld counts towards the month's AHL, the reserve and the rounding cents
--     are released into the balance, a contractor's WHT withheld counts towards the month's WHT
--   * a balance below 0 becomes 0 net pay and an arrear for next month
--   * with deduction_cap on, total deductions plus arrears brought forward above two-thirds of the month's gross pay
--     carry forward too (PAYE, NSSF, SHIF, AHL and WHT are always taken in full: they are owed to KRA, NSSF and SHA
--     for the month whatever the cap)
--   * contractors: no PAYE, NSSF, SHIF or AHL (nor NITA); withholding tax at their category's dated rate
--     ('wht_contractual' 3%, 'wht_professional' 5%) on the month's gross, less what payouts already withheld. The
--     Employment Act's cap does not apply to them (a contract for service), but a negative balance still carries forward
--
-- Approving the run (payroll_runs draft -> approved):
--   * refuses when the work, jobs, payouts or arrears changed after the payslips were worked out (recalculate first)
--   * marks the work, jobs and payout lines it settled (settled_pay_period), only for workers on that run
--   * records each payslip's carried-forward amount as an arrear, and marks the arrears it recovered
-- Reopening it (approved -> draft) undoes all three, unless an arrear from it was already recovered by a later month.
--
-- Which month an item settles in: a paid-out item in its payout's month; an unpaid work entry in its day's month; an
-- unpaid job in the month it was approved. Anything a worker was not paid for in an approved month (they were not on
-- that run) is picked up by the next run (catch-up). Workers with no work, no payouts, no arrears, who are employees
-- paid a salary, are worked out exactly as before. Casual workers keep their own pay runs and are untouched.
--
-- Assumptions (no finance sign-off; each is a default or a setting):
--   1. the s.19(3) cap is on by default (deduction_cap) and covers every deduction plus arrears brought forward; the
--      statutory deductions are always taken in full even above it
--   2. arrears and the cap apply to payslips that settle work (workers paid by work, contractors, or anyone with work,
--      jobs, payouts or arrears that month); a salaried-only payslip is unchanged, as before
--   3. a contractor paid a salary has WHT on it too, instead of PAYE (contractors were on PAYE before; that was wrong)
--   4. net pay is kept to the cent, like salaried net pay (payouts round down to shillings; month end does not)
--   5. arrears are recovered in full the next month, subject to the cap; they never expire
--
-- Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. the setting
-- ---------------------------------------------------------------------------------------------
alter table public.company_payroll_settings
  add column if not exists deduction_cap boolean not null default true;

create or replace function public.deduction_cap(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.deduction_cap from public.company_payroll_settings s where s.tenant_id = p_tenant), true)
$$;
revoke all on function public.deduction_cap(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. the payslip's settlement
-- ---------------------------------------------------------------------------------------------
alter table public.salary_history
  add column if not exists work_pay numeric(14, 2) not null default 0,
  add column if not exists jobs_pay numeric(14, 2) not null default 0,
  add column if not exists work_items jsonb not null default '[]'::jsonb,
  add column if not exists paid_out numeric(14, 2) not null default 0,
  add column if not exists ahl_withheld numeric(14, 2) not null default 0,
  add column if not exists reserve_released numeric(14, 2) not null default 0,
  add column if not exists wht_withheld numeric(14, 2) not null default 0,
  add column if not exists wht_rate numeric(6, 4) not null default 0,
  add column if not exists wht_tax numeric(14, 2) not null default 0,
  add column if not exists arrears_brought_forward numeric(14, 2) not null default 0,
  add column if not exists arrears_carried_forward numeric(14, 2) not null default 0,
  add column if not exists arrears_note text,
  add column if not exists worker_kind text,
  add column if not exists work_settlement boolean not null default false;

alter table public.salary_history drop constraint if exists salary_history_settlement_check;
alter table public.salary_history add constraint salary_history_settlement_check check (
  work_pay >= 0 and jobs_pay >= 0 and paid_out >= 0 and ahl_withheld >= 0 and reserve_released >= 0 and wht_withheld >= 0
  and wht_rate >= 0 and wht_tax >= 0 and arrears_brought_forward >= 0 and arrears_carried_forward >= 0
);

-- ---------------------------------------------------------------------------------------------
-- 3. settled marks
-- ---------------------------------------------------------------------------------------------
alter table public.work_entries add column if not exists settled_pay_period text;
alter table public.contract_jobs add column if not exists settled_pay_period text;
alter table public.work_payout_lines add column if not exists settled_pay_period text;

do $$
declare t text;
begin
  foreach t in array array['work_entries', 'contract_jobs', 'work_payout_lines'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_settled_pay_period_check');
    execute format($c$alter table public.%I add constraint %I
      check (settled_pay_period is null or settled_pay_period ~ '^\d{4}-(0[1-9]|1[0-2])$')$c$, t, t || '_settled_pay_period_check');
    execute format('create index if not exists %I on public.%I (tenant_id, settled_pay_period) where settled_pay_period is not null',
      t || '_settled', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. arrears
-- ---------------------------------------------------------------------------------------------
create table if not exists public.pay_arrears (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  employee_number text not null,
  pay_period text not null check (pay_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),   -- the month it arose in
  amount numeric(14, 2) not null check (amount > 0),
  reason text not null default '',
  run_id uuid references public.payroll_runs(id) on delete set null,
  settled_in text check (settled_in is null or settled_in ~ '^\d{4}-(0[1-9]|1[0-2])$'),   -- the month that recovered it
  settled_run_id uuid references public.payroll_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, employee_number, pay_period)
);
create index if not exists pay_arrears_open on public.pay_arrears (tenant_id, employee_number) where settled_in is null;

alter table public.pay_arrears enable row level security;
drop policy if exists tenant_isolation on public.pay_arrears;
create policy tenant_isolation on public.pay_arrears as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
-- payroll reads them; a worker reads their own; only the payroll run writes them
drop policy if exists payroll_read on public.pay_arrears;
create policy payroll_read on public.pay_arrears for select to authenticated
  using ((select public.manages_work()));
drop policy if exists own_read on public.pay_arrears;
create policy own_read on public.pay_arrears for select to authenticated
  using (employee_number = (select public.current_employee_number()));
revoke all on public.pay_arrears from anon;
revoke insert, update, delete, truncate on public.pay_arrears from authenticated;
drop trigger if exists audit_pay_arrears on public.pay_arrears;
create trigger audit_pay_arrears after insert or update or delete on public.pay_arrears
  for each row execute function public.audit_row_change();

-- arrears follow an employee being renumbered, as payslips do
create or replace function public.pay_arrears_follow_renumber() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.pay_arrears set employee_number = new."Employee Number"
  where tenant_id = new.tenant_id and employee_number = old."Employee Number";
  return new;
end $$;
revoke all on function public.pay_arrears_follow_renumber() from public, anon, authenticated;
drop trigger if exists pay_arrears_follow_renumber on public.employees;
create trigger pay_arrears_follow_renumber
  after update of "Employee Number" on public.employees
  for each row when (old."Employee Number" is distinct from new."Employee Number")
  execute function public.pay_arrears_follow_renumber();

-- ---------------------------------------------------------------------------------------------
-- 5. only the payroll run marks work settled, and settled work is fixed
-- ---------------------------------------------------------------------------------------------
-- The stage 1/2 rules refuse any change to work in a locked month or already paid out, which the settlement marks are.
-- So the rules triggers now skip an update whose only purpose is the mark: one made while the payroll run is settling
-- (app.work_settling = 'on', set only inside payroll_run_work_settlement below) that changes settled_pay_period. The
-- rules themselves are not changed; inserts and deletes go through them as before.
drop trigger if exists work_entry_rules on public.work_entries;
create trigger work_entry_rules before insert or delete on public.work_entries
  for each row execute function public.work_entry_rules();
drop trigger if exists work_entry_rules_update on public.work_entries;
create trigger work_entry_rules_update before update on public.work_entries
  for each row
  when (coalesce(current_setting('app.work_settling', true), '') <> 'on'
        or old.settled_pay_period is not distinct from new.settled_pay_period)
  execute function public.work_entry_rules();

drop trigger if exists contract_job_rules on public.contract_jobs;
create trigger contract_job_rules before insert or delete on public.contract_jobs
  for each row execute function public.contract_job_rules();
drop trigger if exists contract_job_rules_update on public.contract_jobs;
create trigger contract_job_rules_update before update on public.contract_jobs
  for each row
  when (coalesce(current_setting('app.work_settling', true), '') <> 'on'
        or old.settled_pay_period is not distinct from new.settled_pay_period)
  execute function public.contract_job_rules();

create or replace function public.work_settled_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.work_settling', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.settled_pay_period := null;
    return new;
  end if;
  -- nothing but the worker's number changes (an employee renumbered; a work entry's amount is a generated column,
  -- not filled in yet here)
  if (to_jsonb(new) - 'employee_number' - case when tg_table_name = 'work_entries' then 'amount' else '' end)
     = (to_jsonb(old) - 'employee_number' - case when tg_table_name = 'work_entries' then 'amount' else '' end) then
    return new;
  end if;
  if old.settled_pay_period is not null then
    raise exception 'This was settled in the payroll for %, so it can''t be changed', old.settled_pay_period;
  end if;
  if new.settled_pay_period is not null then
    raise exception 'Work is settled by approving the monthly payroll';
  end if;
  return new;
end $$;
revoke all on function public.work_settled_guard() from public, anon, authenticated;

drop trigger if exists work_entry_settled_guard on public.work_entries;
create trigger work_entry_settled_guard before insert or update on public.work_entries
  for each row execute function public.work_settled_guard();
drop trigger if exists contract_job_settled_guard on public.contract_jobs;
create trigger contract_job_settled_guard before insert or update on public.contract_jobs
  for each row execute function public.work_settled_guard();
drop trigger if exists work_payout_line_settled_guard on public.work_payout_lines;
create trigger work_payout_line_settled_guard before insert or update on public.work_payout_lines
  for each row execute function public.work_settled_guard();

-- ---------------------------------------------------------------------------------------------
-- 6. what a month's payroll settles
-- ---------------------------------------------------------------------------------------------
-- an item whose own month is p_natural settles in p_period's payroll: its own month, or a later one when its own
-- month's payroll is approved without it (catch-up)
create or replace function public.work_settles_in(p_tenant uuid, p_natural text, p_period text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_natural = p_period or (p_natural < p_period and exists (
    select 1 from public.payroll_runs r
    where r.tenant_id = p_tenant and r.pay_period = p_natural and r.status in ('approved', 'paid')))
$$;
revoke all on function public.work_settles_in(uuid, text, text) from public, anon, authenticated;

-- approved work, not yet settled; a paid-out entry belongs to its payout's month, an unpaid one to its day's
create or replace function public.work_settlement_entries(p_tenant uuid, p_period text) returns setof public.work_entries
language sql stable security definer set search_path = public as $$
  select w.* from public.work_entries w
  left join public.work_payout_lines l on l.id = w.payout_line_id
  left join public.work_payout_batches b on b.id = l.batch_id
  where w.tenant_id = p_tenant and w.status = 'approved' and w.settled_pay_period is null
    and public.work_settles_in(p_tenant, coalesce(b.pay_period, to_char(w.work_date, 'YYYY-MM')), p_period)
$$;
revoke all on function public.work_settlement_entries(uuid, text) from public, anon, authenticated;

-- approved contract jobs, not yet settled; a paid-out job belongs to its payout's month, an unpaid one to the month
-- it was approved in
create or replace function public.work_settlement_jobs(p_tenant uuid, p_period text) returns setof public.contract_jobs
language sql stable security definer set search_path = public as $$
  select j.* from public.contract_jobs j
  left join public.work_payout_lines l on l.id = j.payout_line_id
  left join public.work_payout_batches b on b.id = l.batch_id
  where j.tenant_id = p_tenant and j.status = 'approved' and j.approved_at is not null and j.settled_pay_period is null
    and public.work_settles_in(p_tenant,
          coalesce(b.pay_period, to_char(j.approved_at at time zone 'Africa/Nairobi', 'YYYY-MM')), p_period)
$$;
revoke all on function public.work_settlement_jobs(uuid, text) from public, anon, authenticated;

-- the lines of approved (or exported) payouts, not yet settled, in their batch's month
create or replace function public.work_settlement_lines(p_tenant uuid, p_period text) returns setof public.work_payout_lines
language sql stable security definer set search_path = public as $$
  select l.* from public.work_payout_lines l
  join public.work_payout_batches b on b.id = l.batch_id
  where l.tenant_id = p_tenant and b.tenant_id = p_tenant and b.status in ('approved', 'exported')
    and l.settled_pay_period is null and public.work_settles_in(p_tenant, b.pay_period, p_period)
$$;
revoke all on function public.work_settlement_lines(uuid, text) from public, anon, authenticated;

-- per worker, for one company and month
create or replace function public.work_settlement_for(p_tenant uuid, p_period text)
returns table (
  employee_number text, work_gross numeric, jobs_gross numeric, paid_out_gross numeric, work_lines jsonb, job_count integer,
  payouts integer, paid numeric, ahl numeric, reserve numeric, wht numeric, rounding numeric, arrears numeric
)
language sql stable security definer set search_path = public as $$
  with entries as (select * from public.work_settlement_entries(p_tenant, p_period)),
  jobs as (select * from public.work_settlement_jobs(p_tenant, p_period)),
  lines as (select * from public.work_settlement_lines(p_tenant, p_period)),
  owed as (
    select a.employee_number, sum(a.amount) as amount from public.pay_arrears a
    where a.tenant_id = p_tenant and a.settled_in is null and a.pay_period < p_period
    group by a.employee_number
  ),
  per_type as (
    select e.employee_number, t.name, t.unit, sum(e.quantity) as quantity, sum(e.amount) as amount
    from entries e join public.work_types t on t.id = e.work_type_id
    group by e.employee_number, t.name, t.unit
  ),
  people as (
    select x.employee_number from entries x union select x.employee_number from jobs x
    union select x.employee_number from lines x union select x.employee_number from owed x
  )
  select p.employee_number,
         coalesce((select sum(e.amount) from entries e where e.employee_number = p.employee_number), 0),
         coalesce((select sum(j.amount) from jobs j where j.employee_number = p.employee_number), 0),
         coalesce((select sum(e.amount) from entries e where e.employee_number = p.employee_number and e.payout_line_id is not null), 0)
           + coalesce((select sum(j.amount) from jobs j where j.employee_number = p.employee_number and j.payout_line_id is not null), 0),
         coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'unit', x.unit, 'quantity', x.quantity, 'amount', x.amount)
                                    order by x.name)
                   from per_type x where x.employee_number = p.employee_number), '[]'::jsonb),
         (select count(*) from jobs j where j.employee_number = p.employee_number)::integer,
         (select count(*) from lines l where l.employee_number = p.employee_number)::integer,
         coalesce((select sum(l.net) from lines l where l.employee_number = p.employee_number), 0),
         coalesce((select sum(l.ahl) from lines l where l.employee_number = p.employee_number), 0),
         coalesce((select sum(l.reserve) from lines l where l.employee_number = p.employee_number), 0),
         coalesce((select sum(l.wht) from lines l where l.employee_number = p.employee_number), 0),
         coalesce((select sum(l.rounding) from lines l where l.employee_number = p.employee_number), 0),
         coalesce((select o.amount from owed o where o.employee_number = p.employee_number), 0)
  from people p
  order by p.employee_number
$$;
revoke all on function public.work_settlement_for(uuid, text) from public, anon, authenticated;

-- payroll: the month p_month is in (default this month)
create or replace function public.work_month_settlement(p_month date default null)
returns table (
  employee_number text, worker_name text, worker_kind text, pay_basis text, wht_category text,
  work_gross numeric, jobs_gross numeric, gross numeric, paid_out_gross numeric, work_lines jsonb, job_count integer,
  payouts integer, paid numeric, ahl numeric, reserve numeric, wht numeric, rounding numeric, held numeric, arrears numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if not public.manages_work() then raise exception 'Only payroll can see this' using errcode = '42501'; end if;
  return query
    select s.employee_number, public.work_worker_name(v_tenant, s.employee_number), e.worker_kind, e.pay_basis, e.wht_category,
           s.work_gross, s.jobs_gross, s.work_gross + s.jobs_gross, s.paid_out_gross, s.work_lines, s.job_count,
           s.payouts, s.paid, s.ahl, s.reserve, s.wht, s.rounding, s.ahl + s.reserve + s.wht + s.rounding, s.arrears
    from public.work_settlement_for(v_tenant, to_char(coalesce(p_month, public.work_today()), 'YYYY-MM')) s
    left join public.employees e on e.tenant_id = v_tenant and e."Employee Number" = s.employee_number
    order by 2;
end $$;
revoke all on function public.work_month_settlement(date) from public, anon;
grant execute on function public.work_month_settlement(date) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. approving and reopening the payroll run
-- ---------------------------------------------------------------------------------------------
create or replace function public.payroll_run_work_settlement() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_changed text;
  v_later text;
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  if old.status = 'draft' and new.status = 'approved' then
    -- the payslips must have been worked out from the work, jobs, payouts and arrears as they are now
    select string_agg(coalesce(nullif(btrim(h.employee_name), ''), h.employee_id), ', ' order by h.employee_id) into v_changed
    from public.salary_history h
    left join public.work_settlement_for(new.tenant_id, new.pay_period) s on s.employee_number = h.employee_id
    where h.run_id = new.id and (
      h.work_pay <> coalesce(s.work_gross, 0) or h.jobs_pay <> coalesce(s.jobs_gross, 0)
      or h.paid_out <> coalesce(s.paid, 0) or h.ahl_withheld <> coalesce(s.ahl, 0)
      or h.reserve_released <> coalesce(s.reserve, 0) + coalesce(s.rounding, 0) or h.wht_withheld <> coalesce(s.wht, 0)
      or h.arrears_brought_forward <> coalesce(s.arrears, 0));
    if v_changed is not null then
      raise exception 'Piece rate work, contract jobs, payouts or arrears for % changed after payroll for % was worked out. Recalculate, then approve.',
        left(v_changed, 300), new.pay_period;
    end if;

    perform set_config('app.work_settling', 'on', true);
    update public.work_entries set settled_pay_period = new.pay_period
    where id in (select x.id from public.work_settlement_entries(new.tenant_id, new.pay_period) x
                 where exists (select 1 from public.salary_history h where h.run_id = new.id and h.employee_id = x.employee_number));
    update public.contract_jobs set settled_pay_period = new.pay_period
    where id in (select x.id from public.work_settlement_jobs(new.tenant_id, new.pay_period) x
                 where exists (select 1 from public.salary_history h where h.run_id = new.id and h.employee_id = x.employee_number));
    update public.work_payout_lines set settled_pay_period = new.pay_period
    where id in (select x.id from public.work_settlement_lines(new.tenant_id, new.pay_period) x
                 where exists (select 1 from public.salary_history h where h.run_id = new.id and h.employee_id = x.employee_number));
    perform set_config('app.work_settling', 'off', true);

    -- the arrears this month recovered, then what it carries forward
    update public.pay_arrears a set settled_in = new.pay_period, settled_run_id = new.id
    where a.tenant_id = new.tenant_id and a.settled_in is null and a.pay_period < new.pay_period
      and exists (select 1 from public.salary_history h where h.run_id = new.id and h.employee_id = a.employee_number);
    insert into public.pay_arrears (tenant_id, employee_number, pay_period, amount, reason, run_id)
    select new.tenant_id, h.employee_id, new.pay_period, h.arrears_carried_forward, coalesce(h.arrears_note, ''), new.id
    from public.salary_history h
    where h.run_id = new.id and h.arrears_carried_forward > 0 and h.employee_id is not null
    on conflict (tenant_id, employee_number, pay_period) do update
      set amount = excluded.amount, reason = excluded.reason, run_id = excluded.run_id, settled_in = null, settled_run_id = null;

  elsif old.status = 'approved' and new.status = 'draft' then
    select string_agg(distinct a.settled_in, ', ') into v_later
    from public.pay_arrears a
    where a.tenant_id = new.tenant_id and a.pay_period = new.pay_period and a.settled_in is not null;
    if v_later is not null then
      raise exception 'Arrears from % were already recovered in the payroll for %: reopen that month first', new.pay_period, v_later;
    end if;
    delete from public.pay_arrears where tenant_id = new.tenant_id and pay_period = new.pay_period;
    update public.pay_arrears set settled_in = null, settled_run_id = null
    where tenant_id = new.tenant_id and settled_in = new.pay_period;

    perform set_config('app.work_settling', 'on', true);
    update public.work_entries set settled_pay_period = null where tenant_id = new.tenant_id and settled_pay_period = new.pay_period;
    update public.contract_jobs set settled_pay_period = null where tenant_id = new.tenant_id and settled_pay_period = new.pay_period;
    update public.work_payout_lines set settled_pay_period = null where tenant_id = new.tenant_id and settled_pay_period = new.pay_period;
    perform set_config('app.work_settling', 'off', true);
  end if;
  return null;
end $$;
revoke all on function public.payroll_run_work_settlement() from public, anon, authenticated;

drop trigger if exists payroll_run_work_settlement on public.payroll_runs;
create trigger payroll_run_work_settlement after update of status on public.payroll_runs
  for each row execute function public.payroll_run_work_settlement();

-- ---------------------------------------------------------------------------------------------
-- 8. the signed-in worker: is that month settled?
-- ---------------------------------------------------------------------------------------------
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
  if r.id is not null and r.status in ('approved', 'paid') and v_me is not null then
    select * into h from public.salary_history where run_id = r.id and employee_id = v_me limit 1;
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
revoke all on function public.my_work_settlement(date) from public, anon;
grant execute on function public.my_work_settlement(date) to authenticated;

notify pgrst, 'reload schema';
