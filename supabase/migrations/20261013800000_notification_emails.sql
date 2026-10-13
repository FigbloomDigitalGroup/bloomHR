-- Notifications by email too (FIG-771): the staff portal's bell notifications (hr_notifications) are also emailed to
-- the employee's work email by the send-notification-emails Edge Function, which pg_cron calls every minute (below).
-- The cron job reads the function's address and its secret from the Vault at run time (no secrets in migrations); the
-- function gets the same secret as CRON_SECRET. `node scripts/setup-notification-emails.mjs` sets both up (and deploys
-- the function), with set_notification_email_secrets() below.
--   * claim_notification_emails(): what to send now, one email per employee with everything not yet emailed, once
--     their latest notification is a couple of minutes old (so a burst, like HR reviewing ten documents, is one email).
--     Claiming marks them emailed in the same statement, so two servers can never send the same one.
--   * release_notification_emails(): a send that failed goes back to be tried again, up to 5 times.
--   * notification_preferences: an employee may turn the emails off; warnings, suspensions and payslips are still
--     emailed (they matter too much to miss). The bell is unaffected.
-- Notifications from before this are not emailed. Reminders meant for HR (contracts, probation, leave recommended)
-- are not for the employee and are never emailed here.

alter table public.hr_notifications
  add column if not exists email_attempts integer not null default 0,
  add column if not exists email_error text,
  add column if not exists emailed_at timestamptz;

-- what is there already is not emailed
update public.hr_notifications set email_sent = true where not email_sent;

create index if not exists hr_notifications_unsent_idx on public.hr_notifications (tenant_id, employee_number, created_at)
  where not email_sent;

create table if not exists public.notification_preferences (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  email boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;
drop policy if exists tenant_isolation on public.notification_preferences;
create policy tenant_isolation on public.notification_preferences as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists own_all on public.notification_preferences;
create policy own_all on public.notification_preferences for all to authenticated
  using (public.is_own_employee(employee_id)) with check (public.is_own_employee(employee_id));
revoke all on public.notification_preferences from anon;

-- emailed even to someone who turned the emails off
create or replace function public.always_emailed(p_type text) returns boolean language sql immutable as $$
  select p_type in ('warning_issued', 'suspended', 'payslip_ready')
$$;

-- the reminders meant for HR, which the employee's bell doesn't show either
create or replace function public.hr_only_notification(p_type text) returns boolean language sql immutable as $$
  select p_type in ('contract_expiring', 'probation_expiring', 'leave_recommended')
$$;

/**
 * The emails to send now: per employee, every notification not yet emailed, once the latest is p_settle old.
 * Marks them emailed as it returns them. Those the employee doesn't want emailed are marked done without sending.
 * For the server only (service role).
 */
create or replace function public.claim_notification_emails(p_settle interval default interval '2 minutes', p_limit integer default 50)
returns table (
  tenant_id uuid, employee_number text, to_email text, first_name text, company_name text,
  ids bigint[], items jsonb
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  -- reminders for HR, and those the employee turned off (but not the ones always emailed): done, nothing to send
  update public.hr_notifications n set email_sent = true, email_error = 'not emailed: ' ||
      case when public.hr_only_notification(n.notification_type) then 'for HR' else 'turned off by the employee' end
  where not n.email_sent
    and (public.hr_only_notification(n.notification_type)
         or (not public.always_emailed(n.notification_type) and exists (
               select 1 from public.employees e join public.notification_preferences p on p.employee_id = e.id
               where e.tenant_id = n.tenant_id and e."Employee Number" = n.employee_number and not p.email)));

  return query
  with ready as (
    select n.tenant_id, n.employee_number
    from public.hr_notifications n
    where not n.email_sent
    group by n.tenant_id, n.employee_number
    having max(n.created_at) <= now() - p_settle
    order by min(n.created_at)
    limit p_limit
  ),
  claimed as (
    update public.hr_notifications n set email_sent = true, emailed_at = now()
    from ready r
    where n.tenant_id = r.tenant_id and n.employee_number = r.employee_number and not n.email_sent
    returning n.*
  )
  select c.tenant_id, c.employee_number,
         coalesce(nullif(btrim(e."Work Email"), ''), nullif(btrim(max(c.work_email)), '')),
         e."First Name",
         coalesce(
           (select l.company_name from public.company_logo l
            where l.tenant_id = c.tenant_id and coalesce(btrim(l.company_name), '') <> '' order by l.created_at desc limit 1),
           (select t.name from public.tenants t where t.id = c.tenant_id)),
         array_agg(c.id order by c.created_at),
         jsonb_agg(jsonb_build_object('type', c.notification_type, 'title', c.title, 'message', c.message, 'at', c.created_at)
                   order by c.created_at)
  from claimed c
  left join public.employees e on e.tenant_id = c.tenant_id and e."Employee Number" = c.employee_number
  group by c.tenant_id, c.employee_number, e."Work Email", e."First Name";
end $$;
revoke all on function public.claim_notification_emails(interval, integer) from public, anon, authenticated;
grant execute on function public.claim_notification_emails(interval, integer) to service_role;

/** A send that failed: tried again on a later run, up to 5 times; then left with the error. Server only. */
create or replace function public.release_notification_emails(p_ids bigint[], p_error text)
returns void language sql security definer set search_path = public as $$
  update public.hr_notifications
  set email_attempts = email_attempts + 1,
      email_error = left(p_error, 500),
      email_sent = email_attempts + 1 >= 5,
      emailed_at = null
  where id = any(p_ids)
$$;
revoke all on function public.release_notification_emails(bigint[], text) from public, anon, authenticated;
grant execute on function public.release_notification_emails(bigint[], text) to service_role;

/** Puts the function's address and the cron secret in the Vault (the setup script calls it). Server only. */
create or replace function public.set_notification_email_secrets(p_project_url text, p_secret text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s record;
begin
  if coalesce(p_project_url, '') !~ '^https://' or length(coalesce(p_secret, '')) < 32 then
    raise exception 'An https project address and a secret of at least 32 characters are needed';
  end if;
  for s in select * from (values ('project_url', p_project_url), ('notification_emails_cron_secret', p_secret)) v(name, value) loop
    if exists (select 1 from vault.secrets where name = s.name) then
      perform vault.update_secret((select id from vault.secrets where name = s.name), s.value);
    else
      perform vault.create_secret(s.value, s.name);
    end if;
  end loop;
end $$;
revoke all on function public.set_notification_email_secrets(text, text) from public, anon, authenticated;
grant execute on function public.set_notification_email_secrets(text, text) to service_role;

-- every minute: call the Edge Function (skipped with a notice where pg_cron or pg_net is not available)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
    if exists (select 1 from cron.job where jobname = 'send-notification-emails') then
      perform cron.unschedule('send-notification-emails');
    end if;
    perform cron.schedule(
      'send-notification-emails',
      '* * * * *',
      $c$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-notification-emails',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notification_emails_cron_secret')),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      ) where exists (select 1 from vault.decrypted_secrets where name = 'project_url');
      $c$
    );
  else
    raise notice 'pg_cron or pg_net is not available on this project - notification emails are not scheduled.';
  end if;
end $$;

notify pgrst, 'reload schema';
