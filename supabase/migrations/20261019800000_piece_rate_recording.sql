-- Piece rate and contract jobs, stage 2: recording (FIG-812). Builds on stage 1 (20261014100000_piece_rate.sql).
--
-- Work is recorded three ways: a supervisor enters their team's work for the day, payroll uploads a spreadsheet, or a
-- worker submits their own (the staff portal screen is stage 3), which counts only once a supervisor approves it.
-- This adds:
--
--   work_entries.status 'draft'          saved but not sent: doesn't count, isn't in anyone's approval queue, and only
--                                        the person who saved it, the worker's supervisor and payroll see it
--   company_payroll_settings.supervisor_work_needs_approval   (default on) what a supervisor submits waits for
--                                        payroll's approval, as casual days do; off: it counts at once (stage 1)
--   work_types.effective_from / effective_to   the days a kind of work can be recorded for (both optional)
--   work_type_rates                      a kind of work's rate from a date: work takes the rate in force on its day
--   employees.pay_frequency 'per_job'    paid per contract job
--   work_imports                         each spreadsheet payroll uploaded: who, when, how many rows, the problems
--   work_people()                        the workers the signed-in person records work for (payroll: everyone who
--                                        isn't a casual; a supervisor: their team), with their pay setup
--   set_worker_pay(...)                  payroll sets a worker's pay setup (employee or contractor, salary or work...)
--   set_work_rate(type, rate, from)      payroll changes a rate from a date
--   check_work_import(rows) / import_work_entries(file, rows)   the spreadsheet: checked row by row, then the good
--                                        rows imported
--   submit_work_entries(ids)             send drafts (or corrected rejected work) for approval, telling the approver
--   decide_work_entries(ids, decision, reason)   approve or reject, single or many, telling whoever submitted it
--   reopen_work_entries(ids)             payroll only: approved work back to waiting, to be corrected
--   work_totals(from, to)                per worker: approved quantity and gross so far, what is still waiting, and
--                                        approved contract jobs (read-only; stages 4 and 5 pay from these)
--   work_settings() / set_work_settings(p)
--
-- Rules that change from stage 1 (work_entry_rules is replaced; nothing else in stage 1 is):
--   * approved work is locked: only payroll changes, removes or reopens it (stage 1 let the supervisor too)
--   * a supervisor approves their workers' own submissions; work a supervisor entered is approved by payroll (when the
--     setting is on) and payroll's own and uploaded work is approved as it is entered
--   * nobody approves their own submission
--   * casual workers' days stay on the Casual workers page (20261017900000): no work entries or jobs for them
--
-- Notifications reuse the existing types: the approver gets 'approval_needed', whoever submitted gets
-- 'approval_progress', a worker given a job gets 'employment_update'.
--
-- Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. settings and the worker's pay frequency
-- ---------------------------------------------------------------------------------------------
alter table public.company_payroll_settings
  add column if not exists supervisor_work_needs_approval boolean not null default true;

alter table public.employees drop constraint if exists employees_pay_frequency_check;
alter table public.employees add constraint employees_pay_frequency_check
  check (pay_frequency in ('daily', 'weekly', 'monthly', 'per_job'));

-- ---------------------------------------------------------------------------------------------
-- 2. kinds of work: dates, and rates from a date
-- ---------------------------------------------------------------------------------------------
alter table public.work_types
  add column if not exists effective_from date,
  add column if not exists effective_to date;
alter table public.work_types drop constraint if exists work_types_effective_dates_check;
alter table public.work_types add constraint work_types_effective_dates_check
  check (effective_to is null or effective_from is null or effective_to >= effective_from);

create table if not exists public.work_type_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  work_type_id uuid not null references public.work_types(id) on delete cascade,
  rate numeric(12, 2) not null check (rate > 0),
  effective_from date not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists work_type_rates_type_from on public.work_type_rates (work_type_id, effective_from);

-- each kind of work already set up gets its current rate for every day ('-infinity': from the start)
insert into public.work_type_rates (tenant_id, work_type_id, rate, effective_from)
select t.tenant_id, t.id, t.rate, coalesce(t.effective_from, '-infinity'::date)
from public.work_types t
where not exists (select 1 from public.work_type_rates r where r.work_type_id = t.id);

-- the rate for work done on a day: the latest that started on or before it; before the first, the first
create or replace function public.work_rate_on(p_type uuid, p_day date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select r.rate from public.work_type_rates r where r.work_type_id = p_type and r.effective_from <= p_day
      order by r.effective_from desc limit 1),
    (select r.rate from public.work_type_rates r where r.work_type_id = p_type order by r.effective_from limit 1),
    (select t.rate from public.work_types t where t.id = p_type)
  )
$$;
revoke all on function public.work_rate_on(uuid, date) from public, anon;
grant execute on function public.work_rate_on(uuid, date) to authenticated;

-- a new kind of work's rate applies from the start (or its first day); a rate changed directly (not through
-- set_work_rate) applies from today
create or replace function public.work_type_rate_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.work_rate_sync', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into public.work_type_rates (tenant_id, work_type_id, rate, effective_from)
    values (new.tenant_id, new.id, new.rate, coalesce(new.effective_from, '-infinity'::date))
    on conflict (work_type_id, effective_from) do update set rate = excluded.rate;
  elsif new.rate is distinct from old.rate then
    insert into public.work_type_rates (tenant_id, work_type_id, rate, effective_from)
    values (new.tenant_id, new.id, new.rate, current_date)
    on conflict (work_type_id, effective_from) do update set rate = excluded.rate;
  end if;
  return new;
end $$;
revoke all on function public.work_type_rate_history() from public, anon, authenticated;

drop trigger if exists work_type_rate_history on public.work_types;
create trigger work_type_rate_history after insert or update of rate on public.work_types
  for each row execute function public.work_type_rate_history();

-- payroll: a kind of work pays p_rate from p_from (past days included; work already recorded keeps its rate)
create or replace function public.set_work_rate(p_type uuid, p_rate numeric, p_from date) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_type public.work_types;
  v_now numeric;
begin
  if not public.manages_work() then raise exception 'Only payroll can change rates' using errcode = '42501'; end if;
  select * into v_type from public.work_types where id = p_type and tenant_id = public.current_tenant_id();
  if v_type.id is null then raise exception 'Unknown kind of work' using errcode = '22023'; end if;
  if p_rate is null or p_rate <= 0 then raise exception 'Add a rate of more than 0' using errcode = '22023'; end if;
  if p_from is null then raise exception 'Say from which day the rate applies' using errcode = '22023'; end if;
  insert into public.work_type_rates (tenant_id, work_type_id, rate, effective_from)
  values (v_type.tenant_id, v_type.id, round(p_rate, 2), p_from)
  on conflict (work_type_id, effective_from) do update set rate = excluded.rate, created_by = auth.uid(), created_at = now();
  -- the type's rate shows today's rate
  v_now := public.work_rate_on(v_type.id, current_date);
  if v_now is distinct from v_type.rate then
    perform set_config('app.work_rate_sync', 'on', true);
    update public.work_types set rate = v_now where id = v_type.id;
    perform set_config('app.work_rate_sync', 'off', true);
  end if;
  return v_now;
end $$;
revoke all on function public.set_work_rate(uuid, numeric, date) from public, anon;
grant execute on function public.set_work_rate(uuid, numeric, date) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. spreadsheet imports, drafts
-- ---------------------------------------------------------------------------------------------
create table if not exists public.work_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  file_name text,
  row_count integer not null default 0,
  imported_count integer not null default 0,
  problem_count integer not null default 0,
  problems jsonb not null default '[]'::jsonb,       -- [{row, error}]
  imported_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists work_imports_tenant_created on public.work_imports (tenant_id, created_at desc);

alter table public.work_entries add column if not exists import_id uuid references public.work_imports(id) on delete set null;
alter table public.work_entries add column if not exists submitted_at timestamptz;

alter table public.work_entries drop constraint if exists work_entries_status_check;
alter table public.work_entries add constraint work_entries_status_check
  check (status in ('draft', 'submitted', 'approved', 'rejected'));
create index if not exists work_entries_tenant_status on public.work_entries (tenant_id, status);

-- ---------------------------------------------------------------------------------------------
-- 4. access
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['work_type_rates', 'work_imports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format($p$create policy tenant_isolation on public.%I as restrictive for all
      using (tenant_id = (select public.current_tenant_id()))
      with check (tenant_id = (select public.current_tenant_id()))$p$, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I
      for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- rates: everyone in the company reads them (supervisors see amounts as they enter); payroll changes them
drop policy if exists read_company on public.work_type_rates;
create policy read_company on public.work_type_rates for select to authenticated using (true);
drop policy if exists manage on public.work_type_rates;
create policy manage on public.work_type_rates for all to authenticated
  using ((select public.manages_work())) with check ((select public.manages_work()));

-- imports: payroll reads them; only import_work_entries() writes them
drop policy if exists payroll_read on public.work_imports;
create policy payroll_read on public.work_imports for select to authenticated using ((select public.manages_work()));
revoke insert, update, delete on public.work_imports from authenticated;

-- a draft is private to whoever saved it, the worker's supervisor and payroll
drop policy if exists drafts_private on public.work_entries;
create policy drafts_private on public.work_entries as restrictive for select to authenticated
  using (status <> 'draft' or entered_by = (select auth.uid()) or (select public.manages_work())
         or employee_number in (select public.supervised_employee_numbers()));

-- ---------------------------------------------------------------------------------------------
-- 5. helpers
-- ---------------------------------------------------------------------------------------------
create or replace function public.supervisor_work_needs_approval(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.supervisor_work_needs_approval from public.company_payroll_settings s where s.tenant_id = p_tenant), true)
$$;
revoke all on function public.supervisor_work_needs_approval(uuid) from public, anon, authenticated;

-- the worker's supervisors (manager_email, regional_manager or reports_to_id), as employee numbers
create or replace function public.work_supervisor_numbers(p_tenant uuid, p_worker text) returns setof text
language sql stable security definer set search_path = public as $$
  select distinct s."Employee Number"
  from public.employees w
  join public.employees s on s.tenant_id = w.tenant_id
  where w.tenant_id = p_tenant and w."Employee Number" = p_worker
    and s."Employee Number" is not null and s."Employee Number" is distinct from w."Employee Number"
    and (lower(btrim(s."Work Email")) in (lower(btrim(w.manager_email)), lower(btrim(w.regional_manager)))
         or s.id = w.reports_to_id)
$$;
revoke all on function public.work_supervisor_numbers(uuid, text) from public, anon, authenticated;

-- the people who run work and payroll (Work & Piece Rate or Payroll module), as employee numbers; admins when nobody has
-- either module
create or replace function public.work_payroll_numbers(p_tenant uuid) returns setof text
language plpgsql stable security definer set search_path = public as $$
declare
  v_found boolean := false;
  v_number text;
begin
  for v_number in
    select distinct e."Employee Number"
    from public.user_profiles p
    join auth.users u on u.id = p.user_id
    join public.employees e on e.tenant_id = p_tenant and lower(btrim(e."Work Email")) = lower(btrim(u.email))
    where p.tenant_id = p_tenant and e."Employee Number" is not null
      and exists (select 1 from public.role_permissions rp
                  where rp.tenant_id = p_tenant and rp.role_name = p.role and rp.permissions && array['work-records', 'payroll'])
  loop
    v_found := true;
    return next v_number;
  end loop;
  if not v_found then
    return query
      select distinct e."Employee Number"
      from public.user_profiles p
      join auth.users u on u.id = p.user_id
      join public.employees e on e.tenant_id = p_tenant and lower(btrim(e."Work Email")) = lower(btrim(u.email))
      where p.tenant_id = p_tenant and p.role = 'ADMIN' and e."Employee Number" is not null;
  end if;
end $$;
revoke all on function public.work_payroll_numbers(uuid) from public, anon, authenticated;

-- one notification to each of these people (never to whoever is acting: notify_employee_number skips them)
create or replace function public.work_notify(p_tenant uuid, p_numbers text[], p_type text, p_title text, p_message text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_number text;
begin
  foreach v_number in array coalesce(p_numbers, '{}'::text[]) loop
    perform public.notify_employee_number(p_tenant, v_number, p_type, p_title, p_message);
  end loop;
end $$;
revoke all on function public.work_notify(uuid, text[], text, text, text) from public, anon, authenticated;

-- who approves a worker's own submission: their supervisors, else payroll
create or replace function public.work_approver_numbers(p_tenant uuid, p_worker text) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(array(select public.work_supervisor_numbers(p_tenant, p_worker)), '{}'::text[]),
    array(select public.work_payroll_numbers(p_tenant))
  )
$$;
revoke all on function public.work_approver_numbers(uuid, text) from public, anon, authenticated;

-- the signed-in person may see (and so act on) this worker's work
create or replace function public.work_involved(p_employee text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.manages_work() or public.supervises(p_employee) or p_employee = public.current_employee_number()
$$;
revoke all on function public.work_involved(text) from public, anon;
grant execute on function public.work_involved(text) to authenticated;

create or replace function public.work_worker_name(p_tenant uuid, p_worker text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), p_worker)
  from public.employees e where e.tenant_id = p_tenant and e."Employee Number" = p_worker
  union all select p_worker
  limit 1
$$;
revoke all on function public.work_worker_name(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. rules for recorded work (replaces stage 1's)
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
    if public.pay_month_closed(old.tenant_id, old.work_date) then
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
    if public.pay_month_closed(old.tenant_id, old.work_date) then
      raise exception 'Payroll for % is approved; this work can''t be changed', to_char(old.work_date, 'Mon YYYY');
    end if;
    if new.employee_number is distinct from old.employee_number and auth.uid() is not null and not v_payroll then
      raise exception 'Only payroll can move work to another worker';
    end if;
  end if;

  if public.pay_month_closed(new.tenant_id, new.work_date) then
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

drop trigger if exists work_entry_rules on public.work_entries;
create trigger work_entry_rules before insert or update or delete on public.work_entries
  for each row execute function public.work_entry_rules();

-- no contract jobs for casual workers either (they are paid in casual pay runs)
create or replace function public.contract_job_not_casual() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_casual(new.tenant_id, new.employee_number) then
    raise exception '% is a casual worker: pay them through casual pay runs, not a contract job', new.employee_number;
  end if;
  return new;
end $$;
revoke all on function public.contract_job_not_casual() from public, anon, authenticated;
drop trigger if exists contract_job_not_casual on public.contract_jobs;
create trigger contract_job_not_casual before insert or update of employee_number on public.contract_jobs
  for each row execute function public.contract_job_not_casual();

-- ---------------------------------------------------------------------------------------------
-- 7. who records for whom, and their pay setup
-- ---------------------------------------------------------------------------------------------
create or replace function public.work_people()
returns table (
  employee_number text, first_name text, last_name text, job_title text, department text, worker_kind text,
  pay_basis text, pay_frequency text, wht_category text, supervisor text, status text, is_team boolean
)
language sql stable security definer set search_path = public as $$
  select e."Employee Number", e."First Name", e."Last Name", e."Job Title",
         coalesce(d.name, nullif(btrim(e."Job Level"), '')), e.worker_kind, e.pay_basis, e.pay_frequency, e.wht_category,
         coalesce(nullif(btrim(e.manager_email), ''), nullif(btrim(e.regional_manager), '')), e."Status",
         e."Employee Number" in (select public.supervised_employee_numbers())
  from public.employees e
  left join public.departments d on d.id = e.department_id and d.tenant_id = e.tenant_id
  where auth.uid() is not null
    and e.tenant_id = public.current_tenant_id()
    and e."Employee Number" is not null
    and coalesce(e.worker_kind, 'employee') <> 'casual'
    and lower(coalesce(btrim(e."Status"), '')) not in ('terminated', 'inactive', 'exited', 'resigned', 'dismissed')
    and (public.manages_work()
         or (e."Employee Number" in (select public.supervised_employee_numbers())
             and e."Employee Number" is distinct from public.current_employee_number()))
  order by e."First Name", e."Last Name", e."Employee Number"
$$;
revoke all on function public.work_people() from public, anon;
grant execute on function public.work_people() to authenticated;

create or replace function public.set_worker_pay(p_employee text, p_kind text, p_basis text, p_frequency text, p_wht text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_kind text;
begin
  -- an employee record change: payroll (the Payroll module) or HR, as for any other change to an employee's record
  if not (public.manages_work() and public.can_write_employees()) then
    raise exception 'Only payroll can change how someone is paid' using errcode = '42501';
  end if;
  select e.worker_kind into v_kind from public.employees e where e.tenant_id = v_tenant and e."Employee Number" = p_employee;
  if not found then raise exception 'Unknown worker %', p_employee using errcode = '22023'; end if;
  if v_kind = 'casual' then
    raise exception 'Casual workers are set up on the Casual workers page' using errcode = '22023';
  end if;
  if p_kind not in ('employee', 'contractor') then raise exception 'Pick employee or contractor' using errcode = '22023'; end if;
  if p_basis not in ('salary', 'work') then raise exception 'Pick paid by salary or by work' using errcode = '22023'; end if;
  if p_frequency not in ('daily', 'weekly', 'monthly', 'per_job') then
    raise exception 'Pick daily, weekly, monthly or per job' using errcode = '22023';
  end if;
  if p_basis = 'salary' and p_frequency <> 'monthly' then
    raise exception 'A salary is paid monthly' using errcode = '22023';
  end if;
  if p_kind = 'contractor' and coalesce(p_wht, '') not in ('contractual', 'professional') then
    raise exception 'Pick the contractor''s withholding tax: contractual (3%%) or professional (5%%)' using errcode = '22023';
  end if;
  update public.employees
     set worker_kind = p_kind, pay_basis = p_basis, pay_frequency = p_frequency,
         wht_category = case when p_kind = 'contractor' then p_wht end
   where tenant_id = v_tenant and "Employee Number" = p_employee;
end $$;
revoke all on function public.set_worker_pay(text, text, text, text, text) from public, anon;
grant execute on function public.set_worker_pay(text, text, text, text, text) to authenticated;

create or replace function public.work_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'supervisor_work_needs_approval', public.supervisor_work_needs_approval(public.current_tenant_id()),
    'payout_reserve_rate', coalesce((select s.payout_reserve_rate from public.company_payroll_settings s
                                     where s.tenant_id = public.current_tenant_id()), 0.10)
  )
$$;
revoke all on function public.work_settings() from public, anon;
grant execute on function public.work_settings() to authenticated;

-- p: supervisor_work_needs_approval (boolean), payout_reserve_rate (0 to 0.5); either may be left out
create or replace function public.set_work_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
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
    update public.company_payroll_settings
       set payout_reserve_rate = (p->>'payout_reserve_rate')::numeric, updated_by = auth.uid(), updated_at = now()
     where tenant_id = v_tenant;
  end if;
  return public.work_settings();
end $$;
revoke all on function public.set_work_settings(jsonb) from public, anon;
grant execute on function public.set_work_settings(jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 8. submitting, deciding and reopening work, with notifications
-- ---------------------------------------------------------------------------------------------
-- Each entry is done on its own: what can't be done is listed with why ([{id, error}]), the rest goes ahead.
create or replace function public.submit_work_entries(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_id uuid;
  e public.work_entries;
  v_failed jsonb := '[]'::jsonb;
  v_submitted integer := 0;
  v_approved integer := 0;
  v_self_workers text[] := '{}';
  v_by_supervisor integer := 0;
  v_worker text;
  v_me text := coalesce(public.work_worker_name(v_tenant, public.current_employee_number()), 'Someone');
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  foreach v_id in array coalesce(p_ids, '{}'::uuid[]) loop
    begin
      select * into e from public.work_entries where id = v_id and tenant_id = v_tenant;
      if e.id is null or not public.work_involved(e.employee_number) then raise exception 'Not found'; end if;
      if e.status not in ('draft', 'rejected') then raise exception 'Already sent'; end if;
      update public.work_entries set status = 'submitted' where id = v_id returning * into e;
      if e.status = 'approved' then
        v_approved := v_approved + 1;
      else
        v_submitted := v_submitted + 1;
        if e.source = 'self' then
          if not e.employee_number = any (v_self_workers) then v_self_workers := v_self_workers || e.employee_number; end if;
        else
          v_by_supervisor := v_by_supervisor + 1;
        end if;
      end if;
    exception when others then
      v_failed := v_failed || jsonb_build_object('id', v_id, 'error', sqlerrm);
    end;
  end loop;

  -- a worker's own work: their supervisors (or payroll); a supervisor's: payroll
  foreach v_worker in array v_self_workers loop
    perform public.work_notify(v_tenant, public.work_approver_numbers(v_tenant, v_worker), 'approval_needed',
      'Work waiting for your approval',
      public.work_worker_name(v_tenant, v_worker) || ' submitted work for approval. Open Piece rate > Approvals to approve or reject it.');
  end loop;
  if v_by_supervisor > 0 then
    perform public.work_notify(v_tenant, array(select public.work_payroll_numbers(v_tenant)), 'approval_needed',
      'Work waiting for your approval',
      v_me || ' submitted ' || v_by_supervisor || ' work ' || case when v_by_supervisor = 1 then 'entry' else 'entries' end
      || ' for approval. Open Piece rate > Approvals to approve or reject them.');
  end if;
  return jsonb_build_object('submitted', v_submitted, 'approved', v_approved, 'failed', v_failed);
end $$;
revoke all on function public.submit_work_entries(uuid[]) from public, anon;
grant execute on function public.submit_work_entries(uuid[]) to authenticated;

create or replace function public.decide_work_entries(p_ids uuid[], p_decision text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_id uuid;
  e public.work_entries;
  v_failed jsonb := '[]'::jsonb;
  v_done integer := 0;
  v_reason text := nullif(btrim(p_reason), '');
  v_decided jsonb := '[]'::jsonb;
  r record;
  v_who text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'Approve or reject' using errcode = '22023'; end if;
  if p_decision = 'rejected' and v_reason is null then raise exception 'Say why the work is rejected' using errcode = '22023'; end if;


  foreach v_id in array coalesce(p_ids, '{}'::uuid[]) loop
    begin
      select * into e from public.work_entries where id = v_id and tenant_id = v_tenant;
      if e.id is null or not public.work_involved(e.employee_number) then raise exception 'Not found'; end if;
      if e.status = p_decision then raise exception 'Already %', p_decision; end if;
      update public.work_entries
         set status = p_decision, rejection_reason = case when p_decision = 'rejected' then v_reason end
       where id = v_id returning * into e;
      v_done := v_done + 1;
      v_decided := v_decided || jsonb_build_object('entered_by', e.entered_by, 'source', e.source,
        'employee_number', e.employee_number, 'amount', e.amount, 'work_date', e.work_date);
    exception when others then
      v_failed := v_failed || jsonb_build_object('id', v_id, 'error', sqlerrm);
    end;
  end loop;

  -- whoever submitted it hears: the worker for their own work, the supervisor for what they entered
  for r in
    select d.source, d.entered_by, d.employee_number, count(*) as n, sum(d.amount) as total, min(d.work_date) as first_day,
           max(d.work_date) as last_day
    from jsonb_to_recordset(v_decided) as d(entered_by uuid, source text, employee_number text, amount numeric, work_date date)
    where d.source in ('self', 'supervisor')
    group by d.source, d.entered_by, d.employee_number
  loop
    v_who := case when r.source = 'self' then r.employee_number
                  else (select l.employee_number from public.login_employee(v_tenant, r.entered_by) l) end;
    continue when v_who is null;
    perform public.notify_employee_number(v_tenant, v_who, 'approval_progress',
      case when p_decision = 'approved' then 'Work approved' else 'Work not approved' end,
      case when r.source = 'self' then 'Your work' else public.work_worker_name(v_tenant, r.employee_number) || '''s work' end
      || ' for ' || to_char(r.first_day, 'DD Mon YYYY')
      || case when r.last_day <> r.first_day then ' to ' || to_char(r.last_day, 'DD Mon YYYY') else '' end
      || ' (' || r.n || ' ' || case when r.n = 1 then 'entry' else 'entries' end || ', ' || public.kes(r.total) || ') was '
      || case when p_decision = 'approved' then 'approved.' else 'not approved.' || public.with_note('Reason', v_reason)
              || ' Correct it and send it again.' end);
  end loop;
  return jsonb_build_object('done', v_done, 'failed', v_failed);
end $$;
revoke all on function public.decide_work_entries(uuid[], text, text) from public, anon;
grant execute on function public.decide_work_entries(uuid[], text, text) to authenticated;

-- payroll only: approved work back to waiting, so it can be corrected
create or replace function public.reopen_work_entries(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_id uuid;
  v_failed jsonb := '[]'::jsonb;
  v_done integer := 0;
begin
  if not public.manages_work() then raise exception 'Only payroll can reopen approved work' using errcode = '42501'; end if;
  foreach v_id in array coalesce(p_ids, '{}'::uuid[]) loop
    begin
      update public.work_entries set status = 'submitted' where id = v_id and tenant_id = v_tenant and status = 'approved';
      if not found then raise exception 'Not approved work'; end if;
      v_done := v_done + 1;
    exception when others then
      v_failed := v_failed || jsonb_build_object('id', v_id, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('done', v_done, 'failed', v_failed);
end $$;
revoke all on function public.reopen_work_entries(uuid[]) from public, anon;
grant execute on function public.reopen_work_entries(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 9. the spreadsheet: checked row by row, then imported
-- ---------------------------------------------------------------------------------------------
-- p_rows: [{employee_number, work_date (YYYY-MM-DD), work_type (name), quantity, notes, sheet_row}]. Returns, per row
-- (its sheet_row when sent, else 1 for the first row): {row, ok, error, employee_number, worker_name, work_date, work_type_id, work_type,
-- unit, quantity, rate, amount}. With p_import, the good rows are added as uploads under that import.
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
      elsif public.pay_month_closed(v_tenant, v_date) then
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
revoke all on function public.work_import_rows(jsonb, uuid) from public, anon, authenticated;

create or replace function public.check_work_import(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.manages_work() then raise exception 'Only payroll can upload work' using errcode = '42501'; end if;
  return public.work_import_rows(p_rows, null);
end $$;
revoke all on function public.check_work_import(jsonb) from public, anon;
grant execute on function public.check_work_import(jsonb) to authenticated;

create or replace function public.import_work_entries(p_file_name text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_import uuid;
  v_rows jsonb;
  v_problems jsonb;
  v_ok integer;
begin
  if not public.manages_work() then raise exception 'Only payroll can upload work' using errcode = '42501'; end if;
  insert into public.work_imports (tenant_id, file_name, row_count, imported_by)
  values (public.current_tenant_id(), nullif(btrim(p_file_name), ''), coalesce(jsonb_array_length(p_rows), 0), auth.uid())
  returning id into v_import;
  v_rows := public.work_import_rows(p_rows, v_import);
  select count(*) filter (where (r->>'ok')::boolean),
         coalesce(jsonb_agg(jsonb_build_object('row', (r->>'row')::int, 'error', r->>'error')) filter (where not (r->>'ok')::boolean), '[]'::jsonb)
    into v_ok, v_problems
  from jsonb_array_elements(v_rows) r;
  update public.work_imports set imported_count = v_ok, problem_count = jsonb_array_length(v_problems), problems = v_problems
   where id = v_import;
  return jsonb_build_object('import_id', v_import, 'imported', v_ok, 'problems', v_problems, 'rows', v_rows);
end $$;
revoke all on function public.import_work_entries(text, jsonb) from public, anon;
grant execute on function public.import_work_entries(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 10. running totals for a period
-- ---------------------------------------------------------------------------------------------
create or replace function public.work_totals(p_from date, p_to date)
returns table (
  employee_number text, worker_name text, worker_kind text, pay_frequency text, lines jsonb,
  approved_amount numeric, waiting_amount numeric, approved_entries integer, waiting_entries integer, jobs_approved_amount numeric
)
language sql stable security definer set search_path = public as $$
  with mine as (
    select w.* from public.work_entries w
    where w.tenant_id = public.current_tenant_id() and w.work_date between p_from and p_to
      and w.status in ('submitted', 'approved') and public.work_involved(w.employee_number)
  ),
  jobs as (
    select j.employee_number, sum(j.amount) as amount from public.contract_jobs j
    where j.tenant_id = public.current_tenant_id() and j.status = 'approved'
      and (j.approved_at at time zone 'Africa/Nairobi')::date between p_from and p_to
      and public.work_involved(j.employee_number)
    group by j.employee_number
  ),
  per_type as (
    select m.employee_number, t.name, t.unit, sum(m.quantity) as quantity, sum(m.amount) as amount
    from mine m join public.work_types t on t.id = m.work_type_id
    where m.status = 'approved'
    group by m.employee_number, t.name, t.unit
  ),
  people as (
    select employee_number from mine union select employee_number from jobs
  )
  select p.employee_number, public.work_worker_name(public.current_tenant_id(), p.employee_number), e.worker_kind, e.pay_frequency,
         coalesce((select jsonb_agg(jsonb_build_object('work_type', x.name, 'unit', x.unit, 'quantity', x.quantity, 'amount', x.amount) order by x.name)
                   from per_type x where x.employee_number = p.employee_number), '[]'::jsonb),
         coalesce((select sum(m.amount) from mine m where m.employee_number = p.employee_number and m.status = 'approved'), 0),
         coalesce((select sum(m.amount) from mine m where m.employee_number = p.employee_number and m.status = 'submitted'), 0),
         (select count(*) from mine m where m.employee_number = p.employee_number and m.status = 'approved')::integer,
         (select count(*) from mine m where m.employee_number = p.employee_number and m.status = 'submitted')::integer,
         coalesce((select j.amount from jobs j where j.employee_number = p.employee_number), 0)
  from people p
  left join public.employees e on e.tenant_id = public.current_tenant_id() and e."Employee Number" = p.employee_number
  order by 2
$$;
revoke all on function public.work_totals(date, date) from public, anon;
grant execute on function public.work_totals(date, date) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 11. contract job notifications
-- ---------------------------------------------------------------------------------------------
create or replace function public.notify_contract_job() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_job text := '"' || new.title || '" (' || public.kes(new.amount) || ')';
begin
  if tg_op = 'INSERT' then
    perform public.notify_employee_number(new.tenant_id, new.employee_number, 'employment_update', 'New contract job',
      'You have a new job: ' || v_job
      || coalesce(', due ' || to_char(new.due_date, 'DD Mon YYYY'), '') || '. It is paid once it is completed and approved.');
    return new;
  end if;
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'completed' and old.status = 'open' then
    perform public.work_notify(new.tenant_id, public.work_approver_numbers(new.tenant_id, new.employee_number), 'approval_needed',
      'Contract job ready for approval',
      public.work_worker_name(new.tenant_id, new.employee_number) || ' finished ' || v_job
      || '. Open Piece rate > Contract jobs to approve it or send it back.');
  elsif new.status = 'approved' then
    perform public.notify_employee_number(new.tenant_id, new.employee_number, 'approval_progress', 'Contract job approved',
      'Your job ' || v_job || ' was approved. It will be paid with your next payout.');
  elsif new.status = 'open' and old.status = 'completed' then
    perform public.notify_employee_number(new.tenant_id, new.employee_number, 'approval_progress', 'Contract job sent back',
      'Your job ' || v_job || ' was sent back.' || public.with_note('Reason', new.sent_back_reason));
  elsif new.status = 'cancelled' then
    perform public.notify_employee_number(new.tenant_id, new.employee_number, 'approval_progress', 'Contract job cancelled',
      'Your job ' || v_job || ' was cancelled.');
  end if;
  return new;
end $$;
revoke all on function public.notify_contract_job() from public, anon, authenticated;

drop trigger if exists notify_contract_job on public.contract_jobs;
create trigger notify_contract_job after insert or update of status on public.contract_jobs
  for each row execute function public.notify_contract_job();

notify pgrst, 'reload schema';
