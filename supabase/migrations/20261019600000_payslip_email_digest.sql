-- Payslips emailed with their PDF attached (FIG-732), and a daily email about company events and birthdays (FIG-771).
-- After 20261019400000_kpi_notifications. Written to run again safely.
--
-- A. Payslips by email, with the PDF attached
--   * Once a month's payroll is approved (or paid), payroll (the 'payroll' module, or ADMIN) presses "Email payslips":
--     queue_payslip_emails(run) adds one row per payslip to payslip_emails. Employees with no work email, or (when the
--     PDFs are password protected) no ID number, are added as 'skipped' with the reason, so payroll sees who was left
--     out. A company setting (company_payroll_settings.payslip_email_auto) starts this by itself on approval.
--   * The PDFs are made in the approver's browser by the same code as the "Download PDF" button, so the emailed PDF
--     is the one people already know. Each is uploaded to the private bucket payslip-pdfs at
--     <company>/<period>/<employee>.pdf (payroll writes; the employee reads their own) and payslip_pdfs_uploaded()
--     marks the row ready ('waiting_pdf' -> 'pending').
--   * The send-notification-emails Edge Function (every minute) claims ready rows (claim_payslip_emails(): 'sending'),
--     downloads each PDF, attaches it, sends it through Resend, and marks it 'sent' (finish_payslip_emails()). A send
--     that fails goes back with release_payslip_emails() and is tried again, up to 5 times ('failed'). Pressing the
--     button again re-queues the failed and skipped ones (an email address added since is picked up).
--   * The file is deleted once sent, or kept for payslip_pdf_keep_days (company setting, default 0 = delete at once);
--     payslip_pdfs_to_delete() lists what is due, mark_payslip_pdfs_deleted() records it.
--   * company_payroll_settings.payslip_pdf_password (default on): each PDF is protected with the employee's ID number.
--     The email says the password is their ID number; it never contains it.
--   * The "Payslip ready" notification of a payslip that is being emailed with its PDF is not emailed separately.
--
-- B. A daily email about company events and birthdays
--   * create_company_digests(day), run every morning by pg_cron (08:00 Nairobi), gives each active employee with a
--     work email at most one notification of the new type company_digest for the day, only when there is something to
--     say: company events today, and in company_email_settings.event_reminder_days days (default 1), and today's
--     birthdays of colleagues ("Today is Amina Wanjiru's birthday 🎉": first and last name only, never the year or an
--     age). Nobody is told about their own birthday; they get "Happy birthday from everyone at <company>!" instead.
--     The existing pipeline emails it (it follows the person's "My updates" email level; it is not "important").
--   * Company settings (company_email_settings): event reminders on/off and how many days before, birthday emails
--     on/off. Personal: notification_preferences.event_emails / birthday_emails leave events or birthdays out of
--     their digest (bell and email).
--   * Once per person per day (company_digest_log): running it twice the same day creates nothing new.
--
-- company_digest is a new type, not employment_update or another existing one: it is about the company, not the
-- employee's own employment, it must not count as "important" (people who chose important-only should not get
-- birthday emails), and a type of its own lets the bell and the opt-outs treat it separately.

-- ---------------------------------------------------------------------------------------------
-- 1. the new notification type
-- ---------------------------------------------------------------------------------------------
alter table public.hr_notifications drop constraint if exists hr_notifications_notification_type_check;
alter table public.hr_notifications add constraint hr_notifications_notification_type_check check (notification_type in (
  'contract_expiring', 'probation_expiring', 'leave_recommended', 'leave_approved', 'leave_rejected', 'leave_year_end_reminder',
  'document_accepted', 'document_rejected', 'onboarding_approved', 'onboarding_changes_requested', 'photo_removed',
  'document_requested',
  'salary_advance_approved', 'salary_advance_rejected', 'salary_advance_paid', 'loan_approved', 'loan_rejected',
  'payslip_ready', 'salary_paid', 'expense_approved', 'expense_rejected', 'phone_change_approved', 'phone_change_rejected',
  'incident_update', 'warning_issued', 'suspended', 'reactivated', 'employment_update', 'leave_scheduled', 'policy_to_accept',
  'task_assigned', 'asset_assigned',
  -- every type added since the approval workflows (20261015800000) must stay in this list
  'approval_needed', 'approval_progress',
  'exit_requested', 'exit_approved', 'exit_declined',
  'application_received',
  'loan_requested', 'loan_disbursed', 'loan_repaid',
  'contract_sent', 'contract_sent_back', 'contract_accepted', 'contract_cancelled', 'contract_signed',
  'leave_exhausted', 'casual_limit',
  'leave_document_overdue',
  'contribution_requested',
  'company_digest'
));

-- ---------------------------------------------------------------------------------------------
-- 2. payslip email settings (payroll's, with the company's other payroll settings)
-- ---------------------------------------------------------------------------------------------
alter table public.company_payroll_settings
  add column if not exists payslip_email_auto boolean not null default false,
  add column if not exists payslip_pdf_password boolean not null default true,
  add column if not exists payslip_pdf_keep_days integer not null default 0;
alter table public.company_payroll_settings drop constraint if exists company_payroll_settings_payslip_pdf_keep_days_check;
alter table public.company_payroll_settings add constraint company_payroll_settings_payslip_pdf_keep_days_check
  check (payslip_pdf_keep_days between 0 and 365);

-- ---------------------------------------------------------------------------------------------
-- 3. the payslip email queue
-- ---------------------------------------------------------------------------------------------
create table if not exists public.payslip_emails (
  id bigint generated always as identity primary key,
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  pay_period text not null,
  employee_number text not null,
  employee_name text,
  to_email text,
  -- waiting_pdf -> pending (PDF uploaded) -> sending (claimed) -> sent; back to pending when a send fails; failed
  -- after 5 tries; skipped = could not be sent (no email address, no ID number for the password)
  status text not null default 'waiting_pdf'
    check (status in ('waiting_pdf', 'pending', 'sending', 'sent', 'failed', 'skipped')),
  pdf_path text,
  password_protected boolean not null default false,
  attempts integer not null default 0,
  error text,
  provider_id text,
  queued_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  pdf_deleted_at timestamptz,
  unique (run_id, employee_number)
);
create index if not exists payslip_emails_pending_idx on public.payslip_emails (id) where status = 'pending';
create index if not exists payslip_emails_tenant_idx on public.payslip_emails (tenant_id, run_id);

alter table public.payslip_emails enable row level security;
drop policy if exists tenant_isolation on public.payslip_emails;
create policy tenant_isolation on public.payslip_emails as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
-- payroll sees the progress; every change goes through the functions below
drop policy if exists payroll_select on public.payslip_emails;
create policy payroll_select on public.payslip_emails for select to authenticated
  using ((select public.has_module('payroll')));
revoke all on public.payslip_emails from anon, authenticated;
grant select on public.payslip_emails to authenticated;

/** Where a payslip's PDF goes in the payslip-pdfs bucket: <company>/<period>/<employee>.pdf (safe characters only). */
create or replace function public.payslip_pdf_path(p_tenant uuid, p_period text, p_employee text) returns text
language sql immutable as $$
  select p_tenant::text || '/' || regexp_replace(coalesce(p_period, ''), '[^0-9A-Za-z-]', '_', 'g') || '/'
         || regexp_replace(btrim(coalesce(p_employee, '')), '[^0-9A-Za-z._-]', '_', 'g') || '.pdf'
$$;

/** An address the emails can go to (the same check as the Edge Function). */
create or replace function public.email_address_ok(p_email text) returns boolean language sql immutable as $$
  select coalesce(btrim(p_email), '') ~ '^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$'
$$;

/** Each status's count for a run, and who was skipped and why: { total, sent, ..., skipped_people: [{ employee_number, employee_name, reason }] }. */
create or replace function public.payslip_email_summary(p_run uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'total', count(*),
    'waiting_pdf', count(*) filter (where e.status = 'waiting_pdf'),
    'pending', count(*) filter (where e.status = 'pending'),
    'sending', count(*) filter (where e.status = 'sending'),
    'sent', count(*) filter (where e.status = 'sent'),
    'failed', count(*) filter (where e.status = 'failed'),
    'skipped', count(*) filter (where e.status = 'skipped'),
    'skipped_people', coalesce(jsonb_agg(jsonb_build_object('employee_number', e.employee_number, 'employee_name', e.employee_name,
                                                            'reason', e.error) order by e.employee_number)
                               filter (where e.status = 'skipped'), '[]'::jsonb))
  from public.payslip_emails e
  where e.run_id = p_run and e.tenant_id = public.current_tenant_id()
$$;
revoke all on function public.payslip_email_summary(uuid) from public, anon;
grant execute on function public.payslip_email_summary(uuid) to authenticated;

/**
 * Payroll: emails the payslips of an approved (or paid) run. Adds a row per payslip (skipped, with the reason, when
 * there is no work email, or no ID number while PDFs are password protected); payslips already queued are left as
 * they are, except failed and skipped ones, which are looked at again (a retry). Returns payslip_email_summary().
 */
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
  if r.status not in ('approved', 'paid') then
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
    where h.run_id = r.id and coalesce(btrim(h.employee_id), '') <> ''
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
revoke all on function public.queue_payslip_emails(uuid) from public, anon;
grant execute on function public.queue_payslip_emails(uuid) to authenticated;

/**
 * Payroll: the PDFs of these rows are uploaded; they are ready to send. Only rows of the signed-in person's company
 * that are waiting for their PDF (and, where storage is there, whose file is in the bucket). Returns how many.
 */
create or replace function public.payslip_pdfs_uploaded(p_ids bigint[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
  v_storage boolean := to_regclass('storage.objects') is not null;
begin
  if not public.has_module('payroll') then
    raise exception 'Only payroll can email payslips' using errcode = '42501';
  end if;
  if v_storage then
    update public.payslip_emails pe set status = 'pending', error = null, pdf_deleted_at = null, updated_at = now()
    where pe.id = any(p_ids) and pe.tenant_id = public.current_tenant_id() and pe.status = 'waiting_pdf'
      and exists (select 1 from storage.objects o where o.bucket_id = 'payslip-pdfs' and o.name = pe.pdf_path);
  else
    update public.payslip_emails pe set status = 'pending', error = null, pdf_deleted_at = null, updated_at = now()
    where pe.id = any(p_ids) and pe.tenant_id = public.current_tenant_id() and pe.status = 'waiting_pdf';
  end if;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.payslip_pdfs_uploaded(bigint[]) from public, anon;
grant execute on function public.payslip_pdfs_uploaded(bigint[]) to authenticated;

/**
 * Server: the payslip emails to send now, marked 'sending'. Only runs still approved or paid (a reopened month waits).
 * Rows left 'sending' for 15 minutes (a run that stopped half way) are put back first.
 */
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
    join public.payroll_runs r on r.id = pe.run_id and r.status in ('approved', 'paid')
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
revoke all on function public.claim_payslip_emails(integer) from public, anon, authenticated;
grant execute on function public.claim_payslip_emails(integer) to service_role;

/** Server: sent (with Resend's ids, side by side). */
create or replace function public.finish_payslip_emails(p_ids bigint[], p_provider_ids text[] default null)
returns void language sql security definer set search_path = public as $$
  update public.payslip_emails pe
  set status = 'sent', sent_at = now(), updated_at = now(), error = null,
      provider_id = (select x.p from unnest(p_ids, p_provider_ids) as x(i, p) where x.i = pe.id limit 1)
  where pe.id = any(p_ids) and pe.status = 'sending'
$$;
revoke all on function public.finish_payslip_emails(bigint[], text[]) from public, anon, authenticated;
grant execute on function public.finish_payslip_emails(bigint[], text[]) to service_role;

/** Server: a send that failed: tried again later, failed after the 5th try (p_count_attempt false: not counted). */
create or replace function public.release_payslip_emails(p_ids bigint[], p_error text, p_count_attempt boolean default true)
returns void language sql security definer set search_path = public as $$
  update public.payslip_emails
  set attempts = attempts + case when p_count_attempt then 1 else 0 end,
      error = left(p_error, 500),
      status = case when p_count_attempt and attempts + 1 >= 5 then 'failed' else 'pending' end,
      updated_at = now()
  where id = any(p_ids) and status = 'sending'
$$;
revoke all on function public.release_payslip_emails(bigint[], text, boolean) from public, anon, authenticated;
grant execute on function public.release_payslip_emails(bigint[], text, boolean) to service_role;

/** Server: cannot be sent (no valid address): skipped, with the reason. */
create or replace function public.skip_payslip_emails(p_ids bigint[], p_error text)
returns void language sql security definer set search_path = public as $$
  update public.payslip_emails set status = 'skipped', error = left(p_error, 500), updated_at = now()
  where id = any(p_ids) and status in ('pending', 'sending')
$$;
revoke all on function public.skip_payslip_emails(bigint[], text) from public, anon, authenticated;
grant execute on function public.skip_payslip_emails(bigint[], text) to service_role;

/**
 * Server: PDFs to delete from the bucket: sent ones past the company's payslip_pdf_keep_days (0 = straight away),
 * and those of failed or skipped emails after 30 days.
 */
create or replace function public.payslip_pdfs_to_delete(p_limit integer default 100)
returns table (id bigint, pdf_path text)
language sql stable security definer set search_path = public as $$
  select pe.id, pe.pdf_path
  from public.payslip_emails pe
  left join public.company_payroll_settings s on s.tenant_id = pe.tenant_id
  where pe.pdf_path is not null and pe.pdf_deleted_at is null
    and ((pe.status = 'sent' and pe.sent_at <= now() - make_interval(days => coalesce(s.payslip_pdf_keep_days, 0)))
         or (pe.status in ('failed', 'skipped') and pe.updated_at <= now() - interval '30 days'))
  order by pe.id
  limit greatest(coalesce(p_limit, 100), 1)
$$;
revoke all on function public.payslip_pdfs_to_delete(integer) from public, anon, authenticated;
grant execute on function public.payslip_pdfs_to_delete(integer) to service_role;

create or replace function public.mark_payslip_pdfs_deleted(p_ids bigint[]) returns void
language sql security definer set search_path = public as $$
  update public.payslip_emails set pdf_deleted_at = now() where id = any(p_ids) and pdf_deleted_at is null
$$;
revoke all on function public.mark_payslip_pdfs_deleted(bigint[]) from public, anon, authenticated;
grant execute on function public.mark_payslip_pdfs_deleted(bigint[]) to service_role;

/** The signed-in employee's own payslip PDF (for the bucket's policy; the queue itself is payroll's only). */
create or replace function public.own_payslip_pdf(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.payslip_emails pe
    where pe.pdf_path = p_name and pe.tenant_id = public.current_tenant_id()
      and pe.employee_number = public.current_employee_number())
$$;
revoke all on function public.own_payslip_pdf(text) from public, anon;
grant execute on function public.own_payslip_pdf(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. the private payslip-pdfs bucket (skipped where there is no storage, as in the tests' database)
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public) values ('payslip-pdfs', 'payslip-pdfs', false)
  on conflict (id) do update set public = false;

  drop policy if exists payslip_pdfs_select on storage.objects;
  drop policy if exists payslip_pdfs_insert on storage.objects;
  drop policy if exists payslip_pdfs_update on storage.objects;
  drop policy if exists payslip_pdfs_delete on storage.objects;

  -- payroll in the company's own folder; an employee their own payslip
  create policy payslip_pdfs_select on storage.objects for select to authenticated
    using (
      bucket_id = 'payslip-pdfs'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and ((select public.has_module('payroll')) or public.own_payslip_pdf(name))
    );
  create policy payslip_pdfs_insert on storage.objects for insert to authenticated
    with check (
      bucket_id = 'payslip-pdfs'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (select public.has_module('payroll'))
    );
  create policy payslip_pdfs_update on storage.objects for update to authenticated
    using (
      bucket_id = 'payslip-pdfs'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (select public.has_module('payroll'))
    )
    with check (
      bucket_id = 'payslip-pdfs'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (select public.has_module('payroll'))
    );
  create policy payslip_pdfs_delete on storage.objects for delete to authenticated
    using (
      bucket_id = 'payslip-pdfs'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (select public.has_module('payroll'))
    );
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. company and personal settings for the daily email
-- ---------------------------------------------------------------------------------------------
create table if not exists public.company_email_settings (
  tenant_id uuid primary key default public.current_tenant_id() references public.tenants(id) on delete cascade,
  event_reminders boolean not null default true,
  event_reminder_days integer not null default 1,
  birthday_emails boolean not null default true,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.company_email_settings drop constraint if exists company_email_settings_event_reminder_days_check;
alter table public.company_email_settings add constraint company_email_settings_event_reminder_days_check
  check (event_reminder_days between 0 and 30);

alter table public.company_email_settings enable row level security;
drop policy if exists tenant_isolation on public.company_email_settings;
create policy tenant_isolation on public.company_email_settings as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
-- everyone in the company may see them; settings admins and HR (employees) change them
drop policy if exists member_select on public.company_email_settings;
create policy member_select on public.company_email_settings for select to authenticated using (true);
drop policy if exists hr_write on public.company_email_settings;
create policy hr_write on public.company_email_settings for all to authenticated
  using ((select public.has_module('settings')) or (select public.has_module('employees')))
  with check ((select public.has_module('settings')) or (select public.has_module('employees')));
revoke all on public.company_email_settings from anon;

drop trigger if exists audit_company_email_settings on public.company_email_settings;
create trigger audit_company_email_settings after insert or update or delete on public.company_email_settings
  for each row execute function public.audit_row_change();

-- a person's own: leave company events, or birthdays, out of their daily email
alter table public.notification_preferences
  add column if not exists event_emails boolean not null default true,
  add column if not exists birthday_emails boolean not null default true;

-- ---------------------------------------------------------------------------------------------
-- 6. the daily digest
-- ---------------------------------------------------------------------------------------------
/** "MM-DD" of a date of birth kept as text ("1990-10-17...", or "17/10/1990"); null when it can't be read. */
create or replace function public.birthday_month_day(p_dob text) returns text language plpgsql immutable as $$
declare
  m text[];
  v_month integer;
  v_day integer;
begin
  if p_dob is null then
    return null;
  end if;
  m := regexp_match(btrim(p_dob), '^(\d{4})-(\d{1,2})-(\d{1,2})');
  if m is not null then
    v_month := m[2]::integer; v_day := m[3]::integer;
  else
    m := regexp_match(btrim(p_dob), '^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})');
    if m is null then
      return null;
    end if;
    v_day := m[1]::integer; v_month := m[2]::integer;
  end if;
  if v_month not between 1 and 12 or v_day not between 1 and 31 then
    return null;
  end if;
  return lpad(v_month::text, 2, '0') || '-' || lpad(v_day::text, 2, '0');
end $$;

/** Whether a birthday falls on a day (29 February is celebrated on the 28th in other years). */
create or replace function public.is_birthday_on(p_dob text, p_day date) returns boolean language sql immutable as $$
  select coalesce(
    public.birthday_month_day(p_dob) = to_char(p_day, 'MM-DD')
    or (public.birthday_month_day(p_dob) = '02-29' and to_char(p_day, 'MM-DD') = '02-28'
        and extract(day from (date_trunc('year', p_day) + interval '2 months - 1 day'))::integer = 28),
    false)
$$;

/** An employee who still works for the company (as the team lists). */
create or replace function public.employee_is_active(p_status text) returns boolean language sql immutable as $$
  select lower(coalesce(btrim(p_status), '')) not in ('terminated', 'inactive', 'exited', 'resigned', 'dismissed')
$$;

create table if not exists public.company_digest_log (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_number text not null,
  day date not null,
  notification_id bigint references public.hr_notifications(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, employee_number, day)
);
alter table public.company_digest_log enable row level security;
drop policy if exists tenant_isolation on public.company_digest_log;
create policy tenant_isolation on public.company_digest_log as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
-- server only: no permissive policy, no grants
revoke all on public.company_digest_log from anon, authenticated;

/**
 * The day's company digests (server only; pg_cron every morning). For every company: its events today and in
 * event_reminder_days days, and today's birthdays; then for every active employee with a work email who has not had
 * theirs today, one company_digest notification with the lines that are for them (none: nothing is created).
 * Returns how many notifications were created.
 */
create or replace function public.create_company_digests(p_day date default public.email_day()) returns integer
language plpgsql security definer set search_path = public as $$
declare
  t record;
  e record;
  v_events_on boolean;
  v_days integer;
  v_birthdays_on boolean;
  v_company text;
  v_today text[];
  v_soon text[];
  v_born text[];   -- employee numbers with a birthday today
  v_names text[];  -- their names, side by side
  v_lines text[];
  v_title text;
  v_own boolean;
  v_id bigint;
  v_count integer := 0;
  i integer;
begin
  for t in select x.id from public.tenants x order by x.id loop
    select coalesce(s.event_reminders, true), coalesce(s.event_reminder_days, 1), coalesce(s.birthday_emails, true)
      into v_events_on, v_days, v_birthdays_on
    from (select 1) one left join public.company_email_settings s on s.tenant_id = t.id;
    if not v_events_on and not v_birthdays_on then
      continue;
    end if;

    v_today := '{}'; v_soon := '{}'; v_born := '{}'; v_names := '{}';
    if v_events_on then
      select coalesce(array_agg(btrim(ev.title) order by btrim(ev.title)), '{}') into v_today
      from public.company_events ev where ev.tenant_id = t.id and ev.date = p_day and coalesce(btrim(ev.title), '') <> '';
      if v_days > 0 then
        select coalesce(array_agg(btrim(ev.title) order by btrim(ev.title)), '{}') into v_soon
        from public.company_events ev where ev.tenant_id = t.id and ev.date = p_day + v_days and coalesce(btrim(ev.title), '') <> '';
      end if;
    end if;
    if v_birthdays_on then
      -- first and last name only: no middle name, never the year or an age
      select coalesce(array_agg(b.number order by b.name, b.number), '{}'), coalesce(array_agg(b.name order by b.name, b.number), '{}')
        into v_born, v_names
      from (
        select x."Employee Number" as number,
               btrim(concat_ws(' ', nullif(btrim(x."First Name"), ''), nullif(btrim(x."Last Name"), ''))) as name
        from public.employees x
        where x.tenant_id = t.id and public.employee_is_active(x."Status") and public.is_birthday_on(x."Date of Birth", p_day)
          and coalesce(btrim(x."Employee Number"), '') <> ''
      ) b
      where b.name <> '';
    end if;
    if cardinality(v_today) = 0 and cardinality(v_soon) = 0 and cardinality(v_born) = 0 then
      continue;
    end if;
    v_company := coalesce(nullif(btrim(public.email_company_name(t.id)), ''), 'the company');

    for e in
      select x.id, x."Employee Number" as number, x."First Name" as first_name, x."Last Name" as last_name, x."Work Email" as email,
             coalesce(p.event_emails, true) as event_emails, coalesce(p.birthday_emails, true) as birthday_emails
      from public.employees x
      left join public.notification_preferences p on p.employee_id = x.id
      where x.tenant_id = t.id and public.employee_is_active(x."Status")
        and coalesce(btrim(x."Employee Number"), '') <> '' and coalesce(btrim(x."Work Email"), '') <> ''
        and not exists (select 1 from public.company_digest_log l
                        where l.tenant_id = t.id and l.employee_number = x."Employee Number" and l.day = p_day)
      order by x."Employee Number"
    loop
      v_lines := '{}';
      v_own := false;
      if e.birthday_emails and cardinality(v_born) > 0 then
        v_own := e.number = any(v_born);
        if v_own then
          v_lines := v_lines || ('Happy birthday from everyone at ' || v_company || '! 🎉');
        end if;
        for i in 1 .. cardinality(v_born) loop
          if v_born[i] <> e.number then
            v_lines := v_lines || ('Today is ' || v_names[i] || '''s birthday 🎉');
          end if;
        end loop;
      end if;
      if e.event_emails then
        v_lines := v_lines || array(select 'Today: ' || x from unnest(v_today) x);
        v_lines := v_lines || array(
          select case when v_days = 1 then 'Tomorrow: ' else 'On ' || to_char(p_day + v_days, 'FMDay FMDD FMMonth') || ': ' end || x
          from unnest(v_soon) x);
      end if;
      if cardinality(v_lines) = 0 then
        continue;
      end if;

      -- once a day: the log row is taken first, so a second run (or two at once) adds nothing
      insert into public.company_digest_log (tenant_id, employee_number, day) values (t.id, e.number, p_day)
      on conflict do nothing;
      if not found then
        continue;
      end if;

      v_title := case when v_own then 'Happy birthday! 🎉'
                      when cardinality(v_lines) = 1 then v_lines[1]
                      else 'Today at ' || v_company end;
      -- the employee's own: already read as far as HR's bell goes (one a day per employee would bury HR's alerts)
      insert into public.hr_notifications (tenant_id, employee_number, employee_name, work_email, notification_type, title, message,
                                           is_read_admin)
      values (t.id, e.number, nullif(btrim(concat_ws(' ', e.first_name, e.last_name)), ''), e.email, 'company_digest',
              left(v_title, 200), array_to_string(v_lines, E'\n'), true)
      returning id into v_id;
      update public.company_digest_log set notification_id = v_id
      where tenant_id = t.id and employee_number = e.number and day = p_day;
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end $$;
revoke all on function public.create_company_digests(date) from public, anon, authenticated;
grant execute on function public.create_company_digests(date) to service_role;

-- every morning at 05:00 UTC (08:00 in Nairobi), best effort (skipped with a notice where pg_cron is not available)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    if exists (select 1 from cron.job where jobname = 'company-daily-digest') then
      perform cron.unschedule('company-daily-digest');
    end if;
    perform cron.schedule('company-daily-digest', '0 5 * * *', $c$ select public.create_company_digests() $c$);
  else
    raise notice 'pg_cron is not available on this project - the daily events and birthdays email is not scheduled.';
  end if;
exception when others then
  raise notice 'The daily events and birthdays email was not scheduled: %', sqlerrm;
end $$;

notify pgrst, 'reload schema';
