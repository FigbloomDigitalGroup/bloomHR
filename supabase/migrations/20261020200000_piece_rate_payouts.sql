-- Piece rate and contract jobs, stage 4: payouts (FIG-812). Builds on 20261014100000_piece_rate.sql,
-- 20261019800000_piece_rate_recording.sql and 20261020100000_piece_rate_staff.sql, which are not changed.
--
-- Workers paid daily or weekly (and per job, once a job is approved) are paid during the month in payout batches. Each
-- payout holds part of the pay back, and the monthly payroll run (stage 5) works out the exact PAYE, NSSF, SHIF and AHL
-- on the month's total, takes off what was paid out and held back, and pays the balance. The platform does payroll,
-- not payments: an approved batch gives bank and M-Pesa files that finance uploads to the bank. No money moves here.
--
--   work_payout_batches             one payout: kind (daily, weekly, job = contract jobs on completion, ad_hoc = payroll
--                                   picks who), its days (within one month), draft -> approved -> exported, or cancelled
--   work_payout_lines               one worker in a batch: gross (approved, unpaid work in the days plus approved, unpaid
--                                   contract jobs), what is held back, the net to pay, how they are paid (copied from
--                                   their record when the line is made) and the entries and jobs it pays
--   work_entries.payout_line_id / contract_jobs.payout_line_id   set, with paid_out_at, when a batch is approved
--   company_payroll_settings.payout_needs_second_approver   (default on) someone other than who made a batch approves it
--   company_payroll_settings.contractor_reserve             (default off) contractors have the reserve held back too
--
-- What is held back from each payout (the rates used are kept on each line):
--   employees     AHL at the dated 'ahl_rate' (1.5%; flat, so safe to take per payout) + the company's reserve
--                 (payout_reserve_rate) of gross. PAYE, NSSF and SHIF are left to the month end.
--   contractors   withholding tax at their category's dated rate ('wht_contractual' 3%, 'wht_professional' 5%), and the
--                 reserve only when contractor_reserve is on. No PAYE, NSSF, SHIF or AHL.
--   the net is rounded down to whole shillings and never below 0; the cents left over are held with the rest (rounding).
--
--   create_work_payout_batch(kind, from, to, workers, notes)   payroll: a draft batch
--   remove_work_payout_line(line) / refresh_work_payout_details(batch)   payroll, on a draft
--   approve_work_payout_batch(batch)        marks the entries and jobs paid out, so they can't be paid twice
--   cancel_work_payout_batch(batch, reason) before export; releases the entries and jobs
--   mark_work_payout_exported(batch)
--   work_payout_month_totals(month)         payroll: per worker, what the month's payouts paid and held back (stage 5)
--   my_payouts(month)                       the signed-in worker's own payouts in a month
--   work_settings() / set_work_settings(p)  replaced to carry the two new settings as well
--
-- No batch can touch a month whose payroll run is approved or paid. Notifications reuse the existing types: payroll gets
-- 'approval_needed' when a batch waits for a second approver, each worker 'employment_update' when a batch paying them
-- is approved (or cancelled after approval). Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. settings
-- ---------------------------------------------------------------------------------------------
alter table public.company_payroll_settings
  add column if not exists payout_needs_second_approver boolean not null default true,
  add column if not exists contractor_reserve boolean not null default false;

-- ---------------------------------------------------------------------------------------------
-- 2. batches and lines
-- ---------------------------------------------------------------------------------------------
create table if not exists public.work_payout_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('daily', 'weekly', 'job', 'ad_hoc')),
  period_from date not null,
  period_to date not null,
  pay_period text not null,                           -- YYYY-MM: the month the month-end settlement counts it in
  status text not null default 'draft' check (status in ('draft', 'approved', 'exported', 'cancelled')),
  notes text,
  worker_count integer not null default 0,
  flagged_count integer not null default 0,           -- lines with payment details missing
  gross_total numeric(14, 2) not null default 0,
  ahl_total numeric(14, 2) not null default 0,
  reserve_total numeric(14, 2) not null default 0,
  wht_total numeric(14, 2) not null default 0,
  net_total numeric(14, 2) not null default 0,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  exported_by uuid references auth.users(id) on delete set null,
  exported_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancel_reason text,
  updated_at timestamptz not null default now(),
  check (period_to >= period_from),
  check (date_trunc('month', period_from) = date_trunc('month', period_to))
);
create index if not exists work_payout_batches_tenant_created on public.work_payout_batches (tenant_id, created_at desc);
create index if not exists work_payout_batches_tenant_period on public.work_payout_batches (tenant_id, pay_period);

create table if not exists public.work_payout_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  batch_id uuid not null references public.work_payout_batches(id) on delete cascade,
  employee_number text not null,
  worker_name text not null default '',
  worker_kind text not null default 'employee',
  wht_category text,
  pay_frequency text,
  entry_ids uuid[] not null default '{}',
  job_ids uuid[] not null default '{}',
  work_from date,                                     -- the first and last day of work it pays (none: jobs only)
  work_to date,
  work_amount numeric(14, 2) not null default 0,
  jobs_amount numeric(14, 2) not null default 0,
  gross numeric(14, 2) not null check (gross > 0),
  ahl_rate numeric(6, 4) not null default 0,
  reserve_rate numeric(6, 4) not null default 0,
  wht_rate numeric(6, 4) not null default 0,
  ahl numeric(14, 2) not null default 0 check (ahl >= 0),
  reserve numeric(14, 2) not null default 0 check (reserve >= 0),
  wht numeric(14, 2) not null default 0 check (wht >= 0),
  rounding numeric(14, 2) not null default 0 check (rounding >= 0),   -- cents held back by rounding the net down
  net numeric(14, 2) not null check (net >= 0 and net = trunc(net)),
  payment_method text,
  payment_kind text not null default 'mobile' check (payment_kind in ('mobile', 'bank', 'cash')),
  phone text,
  bank text,
  bank_branch text,
  bank_code text,
  branch_code text,
  account_name text,
  account_number text,
  payroll_number text,
  id_number text,
  problem text,                                       -- why it can't be paid yet (payment details missing)
  created_at timestamptz not null default now(),
  check (net + ahl + reserve + wht + rounding = gross),
  unique (batch_id, employee_number)
);
create index if not exists work_payout_lines_tenant_employee on public.work_payout_lines (tenant_id, employee_number);

alter table public.work_entries add column if not exists payout_line_id uuid references public.work_payout_lines(id);
alter table public.contract_jobs add column if not exists payout_line_id uuid references public.work_payout_lines(id);
create index if not exists work_entries_payout_line on public.work_entries (payout_line_id) where payout_line_id is not null;
create index if not exists contract_jobs_payout_line on public.contract_jobs (payout_line_id) where payout_line_id is not null;

-- ---------------------------------------------------------------------------------------------
-- 3. access: payroll reads batches and lines; only the functions below write them. A worker reads their own through
--    my_payouts().
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['work_payout_batches', 'work_payout_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format($p$create policy tenant_isolation on public.%I as restrictive for all
      using (tenant_id = (select public.current_tenant_id()))
      with check (tenant_id = (select public.current_tenant_id()))$p$, t);
    execute format('drop policy if exists payroll_read on public.%I', t);
    execute format($p$create policy payroll_read on public.%I for select to authenticated
      using ((select public.manages_work()))$p$, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I
      for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. paid out: only a payout sets or clears paid_out_at and payout_line_id
-- ---------------------------------------------------------------------------------------------
-- The stage 1/2 rules keep paid_out_at as it was for anyone signed in. These run after them (triggers run in name
-- order) and, while a payout function is working (app.work_payout = 'on'), set paid_out_at to app.work_payout_at
-- (empty: cleared). Otherwise nobody moves payout_line_id.
create or replace function public.work_payout_mark() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.work_payout', true) = 'on' then
    new.paid_out_at := nullif(current_setting('app.work_payout_at', true), '')::timestamptz;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.payout_line_id := null;
  elsif new.payout_line_id is distinct from old.payout_line_id and current_setting('app.renumbering_worker', true) is distinct from 'on' then
    raise exception 'Work is paid out from Piece rate > Payouts';
  end if;
  return new;
end $$;
revoke all on function public.work_payout_mark() from public, anon, authenticated;

drop trigger if exists work_entry_zz_payout on public.work_entries;
create trigger work_entry_zz_payout before insert or update on public.work_entries
  for each row execute function public.work_payout_mark();
drop trigger if exists contract_job_zz_payout on public.contract_jobs;
create trigger contract_job_zz_payout before insert or update on public.contract_jobs
  for each row execute function public.work_payout_mark();

-- lines follow an employee being renumbered, as work and jobs do
create or replace function public.work_payout_follow_renumber() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.work_payout_lines set employee_number = new."Employee Number"
  where tenant_id = new.tenant_id and employee_number = old."Employee Number";
  return new;
end $$;
revoke all on function public.work_payout_follow_renumber() from public, anon, authenticated;

drop trigger if exists work_payout_follow_renumber on public.employees;
create trigger work_payout_follow_renumber
  after update of "Employee Number" on public.employees
  for each row when (old."Employee Number" is distinct from new."Employee Number")
  execute function public.work_payout_follow_renumber();

-- ---------------------------------------------------------------------------------------------
-- 5. helpers
-- ---------------------------------------------------------------------------------------------
-- a Kenyan mobile number as M-Pesa takes it (2547XXXXXXXX / 2541XXXXXXXX), or null
create or replace function public.work_payout_phone(p text) returns text
language sql immutable set search_path = public as $$
  select case
    when d ~ '^254[17][0-9]{8}$' then d
    when d ~ '^0[17][0-9]{8}$' then '254' || substr(d, 2)
    when d ~ '^[17][0-9]{8}$' then '254' || d
  end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x
$$;
revoke all on function public.work_payout_phone(text) from public, anon;
grant execute on function public.work_payout_phone(text) to authenticated;

-- how a payment method is paid: mobile money (no method set counts, as payroll pays it), cash, else a bank transfer
create or replace function public.work_payout_kind(p_method text) returns text
language sql immutable set search_path = public as $$
  select case
    when coalesce(btrim(p_method), '') = '' or p_method ~* 'mpesa|m-pesa|mobile|airtel|safaricom' then 'mobile'
    when btrim(p_method) ~* '^cash$' then 'cash'
    else 'bank'
  end
$$;
revoke all on function public.work_payout_kind(text) from public, anon;
grant execute on function public.work_payout_kind(text) to authenticated;

create or replace function public.payout_needs_second_approver(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.payout_needs_second_approver from public.company_payroll_settings s where s.tenant_id = p_tenant), true)
$$;
revoke all on function public.payout_needs_second_approver(uuid) from public, anon, authenticated;

create or replace function public.contractor_reserve(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.contractor_reserve from public.company_payroll_settings s where s.tenant_id = p_tenant), false)
$$;
revoke all on function public.contractor_reserve(uuid) from public, anon, authenticated;

-- "12 Oct" or "12–18 Oct" or "28 Sep – 4 Oct"
create or replace function public.work_payout_days(p_from date, p_to date) returns text
language sql immutable set search_path = public as $$
  select case
    when p_from is null then null
    when p_to is null or p_to = p_from then to_char(p_from, 'FMDD Mon')
    when date_trunc('month', p_from) = date_trunc('month', p_to) then to_char(p_from, 'FMDD') || '–' || to_char(p_to, 'FMDD Mon')
    else to_char(p_from, 'FMDD Mon') || ' – ' || to_char(p_to, 'FMDD Mon')
  end
$$;
revoke all on function public.work_payout_days(date, date) from public, anon, authenticated;

-- copies the worker's payment details onto a line and says what is missing
create or replace function public.work_payout_details(p_line uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  l public.work_payout_lines;
  e public.employees;
  v_method text;
  v_kind text;
  v_phone text;
begin
  select * into l from public.work_payout_lines where id = p_line;
  select * into e from public.employees where tenant_id = l.tenant_id and "Employee Number" = l.employee_number limit 1;
  v_method := coalesce(nullif(btrim(e.payment_method), ''), 'M-Pesa');
  v_kind := public.work_payout_kind(v_method);
  v_phone := public.work_payout_phone(e."Mobile Number");
  update public.work_payout_lines set
    worker_name = coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Middle Name", e."Last Name")), ''), l.employee_number),
    payment_method = v_method, payment_kind = v_kind,
    phone = coalesce(v_phone, nullif(btrim(e."Mobile Number"), '')),
    bank = nullif(btrim(e."Bank"), ''), bank_branch = nullif(btrim(e."Bank Branch"), ''),
    bank_code = nullif(btrim(e.bank_code), ''), branch_code = nullif(btrim(e.branch_code), ''),
    account_name = nullif(btrim(e.account_number_name), ''), account_number = nullif(btrim(e."Account Number"), ''),
    payroll_number = nullif(btrim(e."Payroll Number"), ''), id_number = e."ID Number"::text,
    problem = case
      when e.id is null then 'No employee record'
      when v_kind = 'mobile' and v_phone is null then 'No valid M-Pesa number'
      when v_kind = 'bank' and (nullif(btrim(e."Bank"), '') is null or nullif(btrim(e."Account Number"), '') is null) then 'No bank and account number'
    end
  where id = p_line;
end $$;
revoke all on function public.work_payout_details(uuid) from public, anon, authenticated;

create or replace function public.work_payout_recount(p_batch uuid) returns void
language sql security definer set search_path = public as $$
  update public.work_payout_batches b set
    worker_count = coalesce(t.n, 0), flagged_count = coalesce(t.flagged, 0),
    gross_total = coalesce(t.gross, 0), ahl_total = coalesce(t.ahl, 0), reserve_total = coalesce(t.reserve, 0),
    wht_total = coalesce(t.wht, 0), net_total = coalesce(t.net, 0), updated_at = now()
  from (
    select count(*)::int n, count(*) filter (where problem is not null)::int flagged, sum(gross) gross, sum(ahl) ahl,
           sum(reserve) reserve, sum(wht) wht, sum(net) net
    from public.work_payout_lines where batch_id = p_batch
  ) t
  where b.id = p_batch
$$;
revoke all on function public.work_payout_recount(uuid) from public, anon, authenticated;

-- payroll's batch, locked for the change, in the status asked for
create or replace function public.work_payout_open(p_batch uuid, p_statuses text[]) returns public.work_payout_batches
language plpgsql security definer set search_path = public as $$
declare
  b public.work_payout_batches;
begin
  if not public.manages_work() then raise exception 'Only payroll can do this' using errcode = '42501'; end if;
  select * into b from public.work_payout_batches where id = p_batch and tenant_id = public.current_tenant_id() for update;
  if not found then raise exception 'No such payout batch' using errcode = '22023'; end if;
  if not (b.status = any (p_statuses)) then raise exception 'This payout batch is %', b.status using errcode = '22023'; end if;
  return b;
end $$;
revoke all on function public.work_payout_open(uuid, text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. making a batch
-- ---------------------------------------------------------------------------------------------
-- Who is in it: daily = workers paid by work daily, weekly = weekly, job = workers paid per job, ad_hoc = the workers
-- payroll picks. Each gets the approved work in the batch's days not yet paid out or in another draft batch, plus
-- their approved contract jobs (approved on or before the last day, in an open month) not yet paid or in a draft.
create or replace function public.create_work_payout_batch(
  p_kind text, p_from date, p_to date, p_workers text[] default null, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_today date := public.work_today();
  v_id uuid;
  v_rates jsonb;
  v_ahl_rate numeric;
  v_wht_c numeric;
  v_wht_p numeric;
  v_reserve_rate numeric;
  v_contractor_reserve boolean;
  e record;
  v_entries uuid[];
  v_jobs uuid[];
  v_work numeric;
  v_jobs_amt numeric;
  v_first date;
  v_last date;
  v_gross numeric;
  v_contractor boolean;
  v_ahl numeric;
  v_reserve numeric;
  v_wht numeric;
  v_wht_rate numeric;
  v_res_rate numeric;
  v_net numeric;
  v_line uuid;
  b public.work_payout_batches;
begin
  if not public.manages_work() then raise exception 'Only payroll can make payouts' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('daily', 'weekly', 'job', 'ad_hoc') then
    raise exception 'Pick daily, weekly, job completion or ad hoc' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Pick a first day, and a last day that is the same day or later' using errcode = '22023';
  end if;
  if p_to > v_today then raise exception 'A payout can''t include days still to come' using errcode = '22023'; end if;
  if date_trunc('month', p_from) <> date_trunc('month', p_to) then
    raise exception 'A payout stays within one month, so the month-end payroll can settle it; make one for each month'
      using errcode = '22023';
  end if;
  if public.pay_month_closed(v_tenant, p_from) then
    raise exception 'Payroll for % is approved; that month is locked', to_char(p_from, 'Mon YYYY') using errcode = '22023';
  end if;
  if p_kind = 'ad_hoc' and coalesce(array_length(p_workers, 1), 0) = 0 then
    raise exception 'Pick who to pay' using errcode = '22023';
  end if;

  v_rates := public.statutory_rates_on(p_to);
  v_ahl_rate := coalesce((v_rates->>'ahl_rate')::numeric, 0.015);
  v_wht_c := coalesce((v_rates->>'wht_contractual')::numeric, 0.03);
  v_wht_p := coalesce((v_rates->>'wht_professional')::numeric, 0.05);
  v_reserve_rate := coalesce((select s.payout_reserve_rate from public.company_payroll_settings s where s.tenant_id = v_tenant), 0.10);
  v_contractor_reserve := public.contractor_reserve(v_tenant);

  insert into public.work_payout_batches (tenant_id, kind, period_from, period_to, pay_period, notes, created_by)
  values (v_tenant, p_kind, p_from, p_to, to_char(p_from, 'YYYY-MM'), nullif(btrim(p_notes), ''), auth.uid())
  returning id into v_id;

  for e in
    select x."Employee Number" as num, x.worker_kind, x.wht_category, x.pay_frequency
    from public.employees x
    where x.tenant_id = v_tenant and x."Employee Number" is not null
      and coalesce(x.worker_kind, 'employee') <> 'casual'
      and case p_kind
            when 'daily' then x.pay_basis = 'work' and x.pay_frequency = 'daily'
            when 'weekly' then x.pay_basis = 'work' and x.pay_frequency = 'weekly'
            when 'job' then x.pay_frequency = 'per_job'
            else x."Employee Number" = any (p_workers)
          end
    order by x."First Name", x."Last Name", x."Employee Number"
  loop
    select coalesce(array_agg(w.id order by w.work_date), '{}'), coalesce(sum(w.amount), 0), min(w.work_date), max(w.work_date)
      into v_entries, v_work, v_first, v_last
    from public.work_entries w
    where p_kind <> 'job' and w.tenant_id = v_tenant and w.employee_number = e.num
      and w.status = 'approved' and w.paid_out_at is null and w.work_date between p_from and p_to
      and not exists (select 1 from public.work_payout_lines l join public.work_payout_batches ob on ob.id = l.batch_id
                      where ob.tenant_id = v_tenant and ob.status = 'draft' and w.id = any (l.entry_ids));

    select coalesce(array_agg(j.id order by j.approved_at), '{}'), coalesce(sum(j.amount), 0)
      into v_jobs, v_jobs_amt
    from public.contract_jobs j
    where j.tenant_id = v_tenant and j.employee_number = e.num
      and j.status = 'approved' and j.paid_out_at is null and j.approved_at is not null
      and (j.approved_at at time zone 'Africa/Nairobi')::date <= p_to
      and not public.pay_month_closed(v_tenant, (j.approved_at at time zone 'Africa/Nairobi')::date)
      and not exists (select 1 from public.work_payout_lines l join public.work_payout_batches ob on ob.id = l.batch_id
                      where ob.tenant_id = v_tenant and ob.status = 'draft' and j.id = any (l.job_ids));

    v_gross := round(v_work + v_jobs_amt, 2);
    continue when v_gross <= 0;

    v_contractor := e.worker_kind = 'contractor';
    if v_contractor then
      v_wht_rate := case when e.wht_category = 'professional' then v_wht_p else v_wht_c end;
      v_res_rate := case when v_contractor_reserve then v_reserve_rate else 0 end;
      v_ahl := 0;
      v_wht := round(v_gross * v_wht_rate, 2);
    else
      v_wht_rate := 0;
      v_res_rate := v_reserve_rate;
      v_ahl := round(v_gross * v_ahl_rate, 2);
      v_wht := 0;
    end if;
    v_reserve := round(v_gross * v_res_rate, 2);
    v_net := greatest(0, floor(v_gross - v_ahl - v_reserve - v_wht));

    insert into public.work_payout_lines (
      tenant_id, batch_id, employee_number, worker_kind, wht_category, pay_frequency, entry_ids, job_ids, work_from, work_to,
      work_amount, jobs_amount, gross, ahl_rate, reserve_rate, wht_rate, ahl, reserve, wht, rounding, net)
    values (
      v_tenant, v_id, e.num, coalesce(e.worker_kind, 'employee'), case when v_contractor then e.wht_category end, e.pay_frequency,
      v_entries, v_jobs, v_first, v_last, v_work, v_jobs_amt, v_gross,
      case when v_contractor then 0 else v_ahl_rate end, v_res_rate, v_wht_rate, v_ahl, v_reserve, v_wht,
      v_gross - v_ahl - v_reserve - v_wht - v_net, v_net)
    returning id into v_line;
    perform public.work_payout_details(v_line);
  end loop;

  perform public.work_payout_recount(v_id);
  select * into b from public.work_payout_batches where id = v_id;

  if b.worker_count > 0 and public.payout_needs_second_approver(v_tenant) then
    perform public.work_notify(v_tenant, array(select public.work_payroll_numbers(v_tenant)), 'approval_needed',
      'Payout waiting for approval',
      coalesce(public.work_worker_name(v_tenant, public.current_employee_number()), 'Payroll') || ' made a payout for '
      || public.work_payout_days(p_from, p_to) || ' (' || b.worker_count || ' ' || case when b.worker_count = 1 then 'worker' else 'workers' end
      || ', ' || public.kes(b.net_total) || ' to pay). Someone else must approve it: open Piece rate > Payouts.');
  end if;
  return v_id;
end $$;
revoke all on function public.create_work_payout_batch(text, date, date, text[], text) from public, anon;
grant execute on function public.create_work_payout_batch(text, date, date, text[], text) to authenticated;

create or replace function public.remove_work_payout_line(p_line uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_batch uuid;
begin
  select l.batch_id into v_batch from public.work_payout_lines l where l.id = p_line and l.tenant_id = public.current_tenant_id();
  if v_batch is null then
    if not public.manages_work() then raise exception 'Only payroll can do this' using errcode = '42501'; end if;
    raise exception 'No such line' using errcode = '22023';
  end if;
  perform public.work_payout_open(v_batch, array['draft']);
  delete from public.work_payout_lines where id = p_line;
  perform public.work_payout_recount(v_batch);
end $$;
revoke all on function public.remove_work_payout_line(uuid) from public, anon;
grant execute on function public.remove_work_payout_line(uuid) to authenticated;

-- payment details fixed on the employee records: copy them onto a draft's lines again
create or replace function public.refresh_work_payout_details(p_batch uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_line uuid;
begin
  perform public.work_payout_open(p_batch, array['draft']);
  for v_line in select id from public.work_payout_lines where batch_id = p_batch loop
    perform public.work_payout_details(v_line);
  end loop;
  perform public.work_payout_recount(p_batch);
end $$;
revoke all on function public.refresh_work_payout_details(uuid) from public, anon;
grant execute on function public.refresh_work_payout_details(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. approving, cancelling, exporting
-- ---------------------------------------------------------------------------------------------
create or replace function public.approve_work_payout_batch(p_batch uuid) returns public.work_payout_batches
language plpgsql security definer set search_path = public as $$
declare
  b public.work_payout_batches;
  v_l record;
  v_changed integer;
begin
  b := public.work_payout_open(p_batch, array['draft']);
  if public.payout_needs_second_approver(b.tenant_id) and b.created_by = auth.uid() then
    raise exception 'Someone other than who made this payout must approve it' using errcode = '42501';
  end if;
  if public.pay_month_closed(b.tenant_id, b.period_from) then
    raise exception 'Payroll for % is approved; that month is locked. Cancel this payout', to_char(b.period_from, 'Mon YYYY');
  end if;
  if not exists (select 1 from public.work_payout_lines where batch_id = p_batch) then
    raise exception 'There is nobody to pay in this payout';
  end if;
  if exists (select 1 from public.work_payout_lines where batch_id = p_batch and problem is not null) then
    raise exception 'Some workers have payment details missing: fix their records and refresh, or remove them from this payout';
  end if;

  -- everything in it must still be approved and unpaid (work can be reopened while a batch is a draft)
  select count(*) into v_changed
  from public.work_payout_lines l, unnest(l.entry_ids) as x(id)
  where l.batch_id = p_batch and not exists (
    select 1 from public.work_entries w where w.id = x.id and w.tenant_id = b.tenant_id and w.status = 'approved' and w.paid_out_at is null);
  select v_changed + count(*) into v_changed
  from public.work_payout_lines l, unnest(l.job_ids) as x(id)
  where l.batch_id = p_batch and not exists (
    select 1 from public.contract_jobs j where j.id = x.id and j.tenant_id = b.tenant_id and j.status = 'approved' and j.paid_out_at is null);
  if v_changed > 0 then
    raise exception 'Some work in this payout changed after it was made (reopened or paid another way). Cancel it and make a new one';
  end if;

  perform set_config('app.work_payout', 'on', true);
  perform set_config('app.work_payout_at', now()::text, true);
  update public.work_entries w set payout_line_id = l.id, paid_out_at = now()
  from public.work_payout_lines l
  where l.batch_id = p_batch and w.id = any (l.entry_ids);
  update public.contract_jobs j set payout_line_id = l.id, paid_out_at = now()
  from public.work_payout_lines l
  where l.batch_id = p_batch and j.id = any (l.job_ids);
  perform set_config('app.work_payout', 'off', true);
  perform set_config('app.work_payout_at', '', true);

  update public.work_payout_batches set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
  where id = p_batch returning * into b;

  for v_l in select * from public.work_payout_lines where batch_id = p_batch loop
    perform public.notify_employee_number(b.tenant_id, v_l.employee_number, 'employment_update', 'Payout on its way',
      public.kes(v_l.net) || ' is being paid to you for '
      || coalesce('work ' || public.work_payout_days(v_l.work_from, v_l.work_to), '')
      || case when v_l.work_from is not null and cardinality(v_l.job_ids) > 0 then ' and ' else '' end
      || case when cardinality(v_l.job_ids) = 1 then 'a contract job' when cardinality(v_l.job_ids) > 1 then cardinality(v_l.job_ids) || ' contract jobs' else '' end
      || '.' || case when v_l.gross > v_l.net
                     then ' ' || public.kes(v_l.gross - v_l.net) || ' is held back and settled with your month-end pay.' else '' end);
  end loop;
  return b;
end $$;
revoke all on function public.approve_work_payout_batch(uuid) from public, anon;
grant execute on function public.approve_work_payout_batch(uuid) to authenticated;

-- before export: the entries and jobs are released, to be paid in another payout
create or replace function public.cancel_work_payout_batch(p_batch uuid, p_reason text default null) returns public.work_payout_batches
language plpgsql security definer set search_path = public as $$
declare
  b public.work_payout_batches;
  v_was text;
  v_l record;
begin
  b := public.work_payout_open(p_batch, array['draft', 'approved']);
  v_was := b.status;
  if v_was = 'approved' then
    if public.pay_month_closed(b.tenant_id, b.period_from) then
      raise exception 'Payroll for % is approved, so this payout can''t be cancelled', to_char(b.period_from, 'Mon YYYY');
    end if;
    perform set_config('app.work_payout', 'on', true);
    perform set_config('app.work_payout_at', '', true);
    update public.work_entries set payout_line_id = null, paid_out_at = null
    where payout_line_id in (select id from public.work_payout_lines where batch_id = p_batch);
    update public.contract_jobs set payout_line_id = null, paid_out_at = null
    where payout_line_id in (select id from public.work_payout_lines where batch_id = p_batch);
    perform set_config('app.work_payout', 'off', true);
  end if;
  update public.work_payout_batches
     set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = nullif(btrim(p_reason), ''),
         updated_at = now()
   where id = p_batch returning * into b;
  if v_was = 'approved' then
    for v_l in select * from public.work_payout_lines where batch_id = p_batch loop
      perform public.notify_employee_number(b.tenant_id, v_l.employee_number, 'employment_update', 'Payout cancelled',
        'The payout of ' || public.kes(v_l.net) || ' to you was cancelled before it was sent. The work in it will be paid in a later payout.');
    end loop;
  end if;
  return b;
end $$;
revoke all on function public.cancel_work_payout_batch(uuid, text) from public, anon;
grant execute on function public.cancel_work_payout_batch(uuid, text) to authenticated;

create or replace function public.mark_work_payout_exported(p_batch uuid) returns public.work_payout_batches
language plpgsql security definer set search_path = public as $$
declare
  b public.work_payout_batches;
begin
  b := public.work_payout_open(p_batch, array['approved']);
  update public.work_payout_batches set status = 'exported', exported_by = auth.uid(), exported_at = now(), updated_at = now()
  where id = p_batch returning * into b;
  return b;
end $$;
revoke all on function public.mark_work_payout_exported(uuid) from public, anon;
grant execute on function public.mark_work_payout_exported(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 8. what the month's payouts paid and held back (for the month-end settlement), and a worker's own
-- ---------------------------------------------------------------------------------------------
create or replace function public.work_payout_month_totals(p_month date)
returns table (
  employee_number text, worker_name text, worker_kind text, pay_period text, payouts integer,
  gross numeric, paid numeric, ahl numeric, reserve numeric, wht numeric, rounding numeric, held numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.manages_work() then raise exception 'Only payroll can see this' using errcode = '42501'; end if;
  return query
    select l.employee_number, max(l.worker_name), max(l.worker_kind), b.pay_period, count(*)::int,
           sum(l.gross), sum(l.net), sum(l.ahl), sum(l.reserve), sum(l.wht), sum(l.rounding),
           sum(l.ahl + l.reserve + l.wht + l.rounding)
    from public.work_payout_lines l
    join public.work_payout_batches b on b.id = l.batch_id
    where b.tenant_id = public.current_tenant_id() and b.status in ('approved', 'exported')
      and b.pay_period = to_char(coalesce(p_month, public.work_today()), 'YYYY-MM')
    group by l.employee_number, b.pay_period
    order by 2;
end $$;
revoke all on function public.work_payout_month_totals(date) from public, anon;
grant execute on function public.work_payout_month_totals(date) to authenticated;

create or replace function public.my_payouts(p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_me text := public.current_employee_number();
  v_period text := to_char(coalesce(p_month, public.work_today()), 'YYYY-MM');
  v_out jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  with mine as (
    select l.*, b.kind, b.period_from, b.period_to, b.approved_at, b.status as batch_status
    from public.work_payout_lines l join public.work_payout_batches b on b.id = l.batch_id
    where v_me is not null and l.tenant_id = v_tenant and b.tenant_id = v_tenant and l.employee_number = v_me
      and b.status in ('approved', 'exported') and b.pay_period = v_period
  )
  select jsonb_build_object(
    'pay_period', v_period,
    'gross', coalesce((select sum(gross) from mine), 0),
    'paid', coalesce((select sum(net) from mine), 0),
    'ahl', coalesce((select sum(ahl) from mine), 0),
    'reserve', coalesce((select sum(reserve) from mine), 0),
    'wht', coalesce((select sum(wht) from mine), 0),
    'held', coalesce((select sum(ahl + reserve + wht + rounding) from mine), 0),
    'payouts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', kind, 'from', period_from, 'to', period_to, 'approved_at', approved_at, 'gross', gross, 'net', net,
               'held', ahl + reserve + wht + rounding, 'work_from', work_from, 'work_to', work_to, 'jobs', cardinality(job_ids))
             order by approved_at)
      from mine
    ), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.my_payouts(date) from public, anon;
grant execute on function public.my_payouts(date) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 9. settings (replaces stage 3's, adding payout_needs_second_approver and contractor_reserve)
-- ---------------------------------------------------------------------------------------------
create or replace function public.work_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'supervisor_work_needs_approval', public.supervisor_work_needs_approval(public.current_tenant_id()),
    'payout_reserve_rate', coalesce((select s.payout_reserve_rate from public.company_payroll_settings s
                                     where s.tenant_id = public.current_tenant_id()), 0.10),
    'self_work_past_days', public.self_work_past_days(public.current_tenant_id()),
    'payout_needs_second_approver', public.payout_needs_second_approver(public.current_tenant_id()),
    'contractor_reserve', public.contractor_reserve(public.current_tenant_id())
  )
$$;
revoke all on function public.work_settings() from public, anon;
grant execute on function public.work_settings() to authenticated;

-- p: supervisor_work_needs_approval, payout_needs_second_approver, contractor_reserve (booleans), payout_reserve_rate
-- (0 to 0.5), self_work_past_days (0 to 62); any may be left out
create or replace function public.set_work_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_days integer;
  v_rate numeric;
begin
  if not public.manages_work() then raise exception 'Only payroll can change this' using errcode = '42501'; end if;
  insert into public.company_payroll_settings (tenant_id, updated_by, updated_at) values (v_tenant, auth.uid(), now())
  on conflict (tenant_id) do nothing;
  if p ? 'supervisor_work_needs_approval' then
    update public.company_payroll_settings
       set supervisor_work_needs_approval = coalesce((p->>'supervisor_work_needs_approval')::boolean, true),
           updated_by = auth.uid(), updated_at = now()
     where tenant_id = v_tenant;
  end if;
  if p ? 'payout_reserve_rate' then
    v_rate := (p->>'payout_reserve_rate')::numeric;
    if v_rate is null or v_rate < 0 or v_rate > 0.5 then
      raise exception 'Pick a reserve from 0%% to 50%%' using errcode = '22023';
    end if;
    update public.company_payroll_settings
       set payout_reserve_rate = v_rate, updated_by = auth.uid(), updated_at = now()
     where tenant_id = v_tenant;
  end if;
  if p ? 'self_work_past_days' then
    v_days := (p->>'self_work_past_days')::numeric::integer;
    if v_days is null or v_days < 0 or v_days > 62 then
      raise exception 'Pick from 0 to 62 days' using errcode = '22023';
    end if;
    update public.company_payroll_settings
       set self_work_past_days = v_days, updated_by = auth.uid(), updated_at = now()
     where tenant_id = v_tenant;
  end if;
  if p ? 'payout_needs_second_approver' then
    update public.company_payroll_settings
       set payout_needs_second_approver = coalesce((p->>'payout_needs_second_approver')::boolean, true),
           updated_by = auth.uid(), updated_at = now()
     where tenant_id = v_tenant;
  end if;
  if p ? 'contractor_reserve' then
    update public.company_payroll_settings
       set contractor_reserve = coalesce((p->>'contractor_reserve')::boolean, false),
           updated_by = auth.uid(), updated_at = now()
     where tenant_id = v_tenant;
  end if;
  return public.work_settings();
end $$;
revoke all on function public.set_work_settings(jsonb) from public, anon;
grant execute on function public.set_work_settings(jsonb) to authenticated;

notify pgrst, 'reload schema';
