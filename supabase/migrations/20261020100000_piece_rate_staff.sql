-- Piece rate and contract jobs, stage 3: the staff portal (FIG-812). Builds on 20261014100000_piece_rate.sql and
-- 20261019800000_piece_rate_recording.sql, which are not changed.
--
-- Workers paid by work (or given contract jobs) record their own work in the staff portal, see their entries, mark
-- their jobs done and see what they have earned this month (gross, before deductions; payouts are stage 4, the
-- month-end settlement stage 5). This adds:
--
--   company_payroll_settings.self_work_past_days   (default 7) how many days back a worker may record their own work;
--                                        never a future day. Supervisors and payroll are not limited by it.
--   work_entries.reopened_at             when payroll last reopened approved work (shown to the worker as "Reopened")
--   contract_jobs.completion_file / completion_file_name   an optional photo or document with "done", in the private
--                                        'work-files' bucket at <company>/<job id>/<file>
--   my_work_profile()                    the signed-in worker: pay setup, whether they have jobs (so the portal knows to
--                                        show "My work"), the past-days limit, today (Nairobi) and the locked months
--   my_work_earnings(month)              their own gross for a month: approved and waiting work and jobs, by kind of
--                                        work and by week. Only ever their own rows.
--   complete_my_job(job, note, file, file_name)   a worker marks their own open job done (the stage 1 rules and the
--                                        stage 2 notification to the approver apply)
--   work_settings() / set_work_settings(p)   replaced to carry self_work_past_days as well
--
-- What a worker sees is already limited to their own rows by the stage 1/2 policies (involved, drafts_private);
-- my_work_* read only current_employee_number()'s rows. Written to run again safely.

-- ---------------------------------------------------------------------------------------------
-- 1. columns and the setting
-- ---------------------------------------------------------------------------------------------
alter table public.company_payroll_settings
  add column if not exists self_work_past_days integer not null default 7;
alter table public.company_payroll_settings drop constraint if exists company_payroll_settings_self_work_past_days_check;
alter table public.company_payroll_settings add constraint company_payroll_settings_self_work_past_days_check
  check (self_work_past_days between 0 and 62);

alter table public.work_entries add column if not exists reopened_at timestamptz;
alter table public.contract_jobs
  add column if not exists completion_file text,
  add column if not exists completion_file_name text;

create or replace function public.self_work_past_days(p_tenant uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select s.self_work_past_days from public.company_payroll_settings s where s.tenant_id = p_tenant), 7)
$$;
revoke all on function public.self_work_past_days(uuid) from public, anon, authenticated;

create or replace function public.work_today() returns date
language sql stable set search_path = public as $$
  select (now() at time zone 'Africa/Nairobi')::date
$$;
revoke all on function public.work_today() from public, anon;
grant execute on function public.work_today() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. a worker's own work: today or up to the limit back, never a future day
-- ---------------------------------------------------------------------------------------------
-- Runs after work_entry_rules (triggers run in name order). Only the worker's own entries, only when the day is set
-- or changed: a rejected entry from before the limit can still be corrected and sent again.
create or replace function public.work_entry_self_window() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.work_today();
  v_days integer;
begin
  if auth.uid() is null or public.manages_work() then return new; end if;
  if new.employee_number is distinct from public.current_employee_number() then return new; end if;
  if tg_op = 'UPDATE' and new.work_date is not distinct from old.work_date then return new; end if;
  if new.work_date > v_today then raise exception 'Work can''t be recorded for a future day'; end if;
  v_days := public.self_work_past_days(new.tenant_id);
  if new.work_date < v_today - v_days then
    raise exception 'You can record your own work for the last % days only; ask your supervisor to record older work', v_days;
  end if;
  return new;
end $$;
revoke all on function public.work_entry_self_window() from public, anon, authenticated;

drop trigger if exists work_entry_self_window on public.work_entries;
create trigger work_entry_self_window before insert or update of work_date on public.work_entries
  for each row execute function public.work_entry_self_window();

-- payroll reopening approved work: remembered so the worker sees "Reopened" rather than just "Waiting"
create or replace function public.work_entry_track_reopen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.reopened_at := null;
  elsif old.status = 'approved' and new.status = 'submitted' then
    new.reopened_at := now();
  elsif new.status in ('approved', 'draft') then
    new.reopened_at := null;
  else
    new.reopened_at := old.reopened_at;
  end if;
  return new;
end $$;
revoke all on function public.work_entry_track_reopen() from public, anon, authenticated;

drop trigger if exists work_entry_track_reopen on public.work_entries;
create trigger work_entry_track_reopen before insert or update on public.work_entries
  for each row execute function public.work_entry_track_reopen();

-- a job's file must be in its own folder: <company>/<job id>/...
create or replace function public.contract_job_file_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.completion_file is not null
     and (tg_op = 'INSERT' or new.completion_file is distinct from old.completion_file)
     and new.completion_file not like new.tenant_id::text || '/' || new.id::text || '/%' then
    raise exception 'That file doesn''t belong to this job';
  end if;
  return new;
end $$;
revoke all on function public.contract_job_file_check() from public, anon, authenticated;

drop trigger if exists contract_job_file_check on public.contract_jobs;
create trigger contract_job_file_check before insert or update of completion_file on public.contract_jobs
  for each row execute function public.contract_job_file_check();

-- ---------------------------------------------------------------------------------------------
-- 3. settings (replaces stage 2's, adding self_work_past_days)
-- ---------------------------------------------------------------------------------------------
create or replace function public.work_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'supervisor_work_needs_approval', public.supervisor_work_needs_approval(public.current_tenant_id()),
    'payout_reserve_rate', coalesce((select s.payout_reserve_rate from public.company_payroll_settings s
                                     where s.tenant_id = public.current_tenant_id()), 0.10),
    'self_work_past_days', public.self_work_past_days(public.current_tenant_id())
  )
$$;
revoke all on function public.work_settings() from public, anon;
grant execute on function public.work_settings() to authenticated;

-- p: supervisor_work_needs_approval (boolean), payout_reserve_rate (0 to 0.5), self_work_past_days (0 to 62); any may be
-- left out
create or replace function public.set_work_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_days integer;
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
  if p ? 'self_work_past_days' then
    v_days := (p->>'self_work_past_days')::numeric::integer;
    if v_days is null or v_days < 0 or v_days > 62 then
      raise exception 'Pick from 0 to 62 days' using errcode = '22023';
    end if;
    update public.company_payroll_settings
       set self_work_past_days = v_days, updated_by = auth.uid(), updated_at = now()
     where tenant_id = v_tenant;
  end if;
  return public.work_settings();
end $$;
revoke all on function public.set_work_settings(jsonb) from public, anon;
grant execute on function public.set_work_settings(jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. the signed-in worker
-- ---------------------------------------------------------------------------------------------
create or replace function public.my_work_profile() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_me text := public.current_employee_number();
  e public.employees;
  v_jobs boolean;
begin
  if auth.uid() is null or v_tenant is null or v_me is null then
    return jsonb_build_object('employee_number', null, 'qualifies', false);
  end if;
  select * into e from public.employees where tenant_id = v_tenant and "Employee Number" = v_me limit 1;
  if e.id is null then return jsonb_build_object('employee_number', null, 'qualifies', false); end if;
  v_jobs := exists (select 1 from public.contract_jobs j where j.tenant_id = v_tenant and j.employee_number = v_me);
  return jsonb_build_object(
    'employee_number', v_me,
    'worker_kind', e.worker_kind,
    'pay_basis', e.pay_basis,
    'pay_frequency', e.pay_frequency,
    'has_jobs', v_jobs,
    'qualifies', coalesce(e.worker_kind, 'employee') <> 'casual' and (e.pay_basis = 'work' or v_jobs),
    'past_days', public.self_work_past_days(v_tenant),
    'today', public.work_today(),
    'closed_months', coalesce((
      select jsonb_agg(distinct r.pay_period order by r.pay_period) from public.payroll_runs r
      where r.tenant_id = v_tenant and r.status in ('approved', 'paid')
        and r.pay_period >= to_char(public.work_today() - interval '13 months', 'YYYY-MM')
    ), '[]'::jsonb)
  );
end $$;
revoke all on function public.my_work_profile() from public, anon;
grant execute on function public.my_work_profile() to authenticated;

-- The worker's own gross for the month p_month is in (default this month). Work counts by its day; a job by the day it
-- was approved (waiting: the day it was marked done), as work_totals(). Before deductions: payouts (stage 4) and the
-- month-end settlement (stage 5) work out what is taken home.
create or replace function public.my_work_earnings(p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_me text := public.current_employee_number();
  v_from date := date_trunc('month', coalesce(p_month, public.work_today()))::date;
  v_to date := (date_trunc('month', coalesce(p_month, public.work_today())) + interval '1 month - 1 day')::date;
  v_out jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  with w as (
    select we.work_date, we.status, we.quantity, we.amount, t.name as type_name, t.unit
    from public.work_entries we join public.work_types t on t.id = we.work_type_id
    where v_me is not null and we.tenant_id = v_tenant and we.employee_number = v_me
      and we.work_date between v_from and v_to and we.status in ('submitted', 'approved')
  ),
  j as (
    select x.status, x.amount, x.day from (
      select cj.status, cj.amount,
             case when cj.status = 'approved' then (cj.approved_at at time zone 'Africa/Nairobi')::date
                  else (cj.completed_at at time zone 'Africa/Nairobi')::date end as day
      from public.contract_jobs cj
      where v_me is not null and cj.tenant_id = v_tenant and cj.employee_number = v_me and cj.status in ('approved', 'completed')
    ) x where x.day between v_from and v_to
  ),
  weeks as (
    select greatest(g::date, v_from) as wf, least(g::date + 6, v_to) as wt
    from generate_series(date_trunc('week', v_from)::date, v_to, interval '1 week') g
  )
  select jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'approved_work', coalesce((select sum(amount) from w where status = 'approved'), 0),
    'waiting_work', coalesce((select sum(amount) from w where status = 'submitted'), 0),
    'approved_jobs', coalesce((select sum(amount) from j where status = 'approved'), 0),
    'waiting_jobs', coalesce((select sum(amount) from j where status = 'completed'), 0),
    'approved_entries', (select count(*) from w where status = 'approved'),
    'waiting_entries', (select count(*) from w where status = 'submitted'),
    'approved_job_count', (select count(*) from j where status = 'approved'),
    'waiting_job_count', (select count(*) from j where status = 'completed'),
    'by_type', coalesce((
      select jsonb_agg(jsonb_build_object(
               'work_type', type_name, 'unit', unit,
               'quantity', approved_qty, 'amount', approved_amt, 'waiting_quantity', waiting_qty, 'waiting_amount', waiting_amt)
             order by type_name)
      from (
        select type_name, unit,
               coalesce(sum(quantity) filter (where status = 'approved'), 0) as approved_qty,
               coalesce(sum(amount) filter (where status = 'approved'), 0) as approved_amt,
               coalesce(sum(quantity) filter (where status = 'submitted'), 0) as waiting_qty,
               coalesce(sum(amount) filter (where status = 'submitted'), 0) as waiting_amt
        from w group by type_name, unit
      ) t
    ), '[]'::jsonb),
    'by_week', coalesce((
      select jsonb_agg(jsonb_build_object(
               'from', k.wf, 'to', k.wt,
               'work', coalesce((select sum(amount) from w where status = 'approved' and work_date between k.wf and k.wt), 0),
               'jobs', coalesce((select sum(amount) from j where status = 'approved' and day between k.wf and k.wt), 0),
               'waiting', coalesce((select sum(amount) from w where status = 'submitted' and work_date between k.wf and k.wt), 0)
                        + coalesce((select sum(amount) from j where status = 'completed' and day between k.wf and k.wt), 0))
             order by k.wf)
      from weeks k
    ), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.my_work_earnings(date) from public, anon;
grant execute on function public.my_work_earnings(date) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. a worker marks their own job done
-- ---------------------------------------------------------------------------------------------
create or replace function public.complete_my_job(p_job uuid, p_note text default null, p_file text default null, p_file_name text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_me text := public.current_employee_number();
  j public.contract_jobs;
begin
  if auth.uid() is null or v_me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into j from public.contract_jobs where id = p_job and tenant_id = v_tenant;
  if j.id is null or j.employee_number is distinct from v_me then raise exception 'Job not found' using errcode = '22023'; end if;
  if j.status <> 'open' then raise exception 'Only an open job can be marked done' using errcode = '22023'; end if;
  -- the rules (contract_job_rules), the file check and the approver's notification (notify_contract_job) apply as usual
  update public.contract_jobs
     set status = 'completed',
         completion_notes = nullif(btrim(coalesce(p_note, '')), ''),
         completion_file = nullif(btrim(coalesce(p_file, '')), ''),
         completion_file_name = case when nullif(btrim(coalesce(p_file, '')), '') is not null then left(coalesce(nullif(btrim(p_file_name), ''), 'file'), 300) end
   where id = p_job;
end $$;
revoke all on function public.complete_my_job(uuid, text, text, text) from public, anon;
grant execute on function public.complete_my_job(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. files with a job (private): <company>/<job id>/<file>; whoever can see the job (the contract_jobs policies decide)
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public) values ('work-files', 'work-files', false)
  on conflict (id) do update set public = false;

  drop policy if exists work_files_select on storage.objects;
  drop policy if exists work_files_insert on storage.objects;
  drop policy if exists work_files_delete on storage.objects;

  create policy work_files_select on storage.objects for select to authenticated
    using (
      bucket_id = 'work-files'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and exists (select 1 from public.contract_jobs j where j.id::text = (storage.foldername(name))[2])
    );
  create policy work_files_insert on storage.objects for insert to authenticated
    with check (
      bucket_id = 'work-files'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and exists (select 1 from public.contract_jobs j where j.id::text = (storage.foldername(name))[2] and j.status = 'open')
    );
  create policy work_files_delete on storage.objects for delete to authenticated
    using (
      bucket_id = 'work-files'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and owner = (select auth.uid())
    );
end $$;

notify pgrst, 'reload schema';
