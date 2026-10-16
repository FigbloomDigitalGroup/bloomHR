-- Every notification by email too (FIG-890), including chat and team messages.
--
-- Until now only an employee's own bell notifications were emailed (20261013800000), to their work email. This adds:
--
--   1. HR-facing notifications (hr_only_notification(): contracts and probation ending, leave recommended, exit
--      requested, application received, loan requested, signed contract back) are emailed to the people who look
--      after them in that company, by role (hr_alert_recipients() below holds the whole mapping):
--        leave_recommended                                            -> roles with the 'leaves' module
--        contract_expiring, probation_expiring, contract_signed,
--        exit_requested (and any other HR-facing type added later)    -> roles with 'employees' or 'hr-lifecycle'
--        application_received                                         -> roles with 'recruitment'
--        loan_requested                                               -> the HR role and roles with 'payroll'
--                                                                        (who manages loans, as manages_loans())
--      ADMIN always gets them. They go to the login's email (auth.users), so admins and HR people with no employee
--      record get them too. The employee the notification is about is never emailed it (even when they are HR).
--      One notification can go to several people, so each person's copy is a row in notification_email_deliveries
--      (notification id + user id) with its own retries, not the single email_sent flag.
--   2. Unread chat and team messages: a digest (claim_chat_digest_emails()) to a person about messages in their
--      direct messages and channels still unread 10 minutes after they were sent, at most one per person every
--      30 minutes, listing each conversation and how many are unread. Direct messages and @mentions (the chat writes
--      "@Full Name") always count; other channel messages count in channels the person is a member of. The sender is
--      never emailed about their own messages, and "unread" is the chat's own (user_channel_states.last_read_at, as
--      my_unread_counts()), so someone who read the messages in time is not emailed. The digest names conversations
--      and counts only: what people wrote in private stays in the app.
--   3. Preferences, per category, each everything / important only / off:
--        * the employee's own updates: notification_preferences.email_level (the old email boolean still works:
--          false = off, true = everything, when no level is set); important_notification() says what is important.
--          Warnings, suspensions and payslips (always_emailed()) are sent whatever is chosen.
--        * HR alerts and chat: email_preferences (per login, per company). For chat, "important only" = direct
--          messages and @mentions.
--        * a chat can be muted for email (chat_email_mutes, or the chat's own channel_members.is_muted).
--   4. A daily cap per person (daily_email_cap(): 20 emails a day per address and company, Nairobi time, across all
--      of these). What is over
--      the cap waits and goes in their next email the next day. Warnings, suspensions and payslips are not held back.
--
-- All the claim and release functions are for the server only (the send-notification-emails Edge Function, run every
-- minute by pg_cron); signed-in users read and change only their own preferences.

-- ---------------------------------------------------------------------------------------------
-- 1. preferences
-- ---------------------------------------------------------------------------------------------
alter table public.notification_preferences
  add column if not exists email_level text check (email_level in ('all', 'important', 'off'));

-- what "important only" sends: decisions, money, and things waiting for the person (plus what is always emailed)
create or replace function public.important_notification(p_type text) returns boolean language sql immutable as $$
  select public.always_emailed(p_type) or p_type in (
    -- the employee's own
    'leave_approved', 'leave_rejected', 'document_rejected', 'document_requested', 'onboarding_changes_requested',
    'salary_advance_approved', 'salary_advance_rejected', 'salary_advance_paid', 'loan_approved', 'loan_rejected',
    'loan_disbursed', 'salary_paid', 'expense_approved', 'expense_rejected', 'reactivated', 'employment_update',
    'policy_to_accept', 'task_assigned', 'approval_needed', 'exit_approved', 'exit_declined', 'contract_sent',
    'contract_sent_back',
    -- for HR: a decision is waiting
    'leave_recommended', 'exit_requested', 'loan_requested', 'contract_signed', 'contract_expiring', 'probation_expiring')
$$;

create table if not exists public.email_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  hr_alerts text not null default 'all' check (hr_alerts in ('all', 'important', 'off')),
  chat text not null default 'all' check (chat in ('all', 'important', 'off')),
  updated_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

create table if not exists public.chat_email_mutes (
  user_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

do $$
declare
  t text;
begin
  foreach t in array array['email_preferences', 'chat_email_mutes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I as restrictive for all
         using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()))', t);
    execute format('drop policy if exists own_all on public.%I', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

create policy own_all on public.email_preferences for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- only a chat the person can see (the channel rules decide)
create policy own_all on public.chat_email_mutes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.channels c where c.id = channel_id));

-- ---------------------------------------------------------------------------------------------
-- 2. deliveries, the daily cap, and the chat digest's progress (server only: no policies)
-- ---------------------------------------------------------------------------------------------
create table if not exists public.notification_email_deliveries (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('hr_alert', 'chat')),
  -- the HR-facing notification (null for a chat digest)
  notification_id bigint references public.hr_notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  to_email text,
  -- pending -> sent (claimed); back to pending when a send fails; failed after 5 tries; skipped = not wanted
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  attempts integer not null default 0,
  error text,
  -- a chat digest's conversations: [{ channel_id, kind, name, unread, mentions, latest_at }]
  items jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (notification_id, user_id)
);
create index if not exists notification_email_deliveries_pending_idx
  on public.notification_email_deliveries (kind, tenant_id, user_id) where status = 'pending';

create table if not exists public.email_daily_counts (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  to_email text not null,
  day date not null,
  sent integer not null default 0,
  primary key (tenant_id, to_email, day)
);

create table if not exists public.chat_email_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- messages up to here have been considered for a digest
  covered_until timestamptz,
  last_digest_at timestamptz,
  primary key (user_id, tenant_id)
);

do $$
declare
  t text;
begin
  foreach t in array array['notification_email_deliveries', 'email_daily_counts', 'chat_email_state'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I as restrictive for all
         using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()))', t);
    -- no permissive policy and no grants: only the server (service role) reads and writes these
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- messages from before this are not emailed: everyone's chat digest starts now
insert into public.chat_email_state (user_id, tenant_id, covered_until)
select m.user_id, m.tenant_id, now() from public.memberships m
on conflict (user_id, tenant_id) do nothing;

-- HR-facing notifications handed to the HR deliveries (independent of email_sent, which the browser's contract
-- reminders set when they email the employee); those from before this are not emailed
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'hr_notifications' and column_name = 'hr_emails_queued') then
    alter table public.hr_notifications add column hr_emails_queued boolean not null default false;
    update public.hr_notifications set hr_emails_queued = true;
  end if;
end $$;
create index if not exists hr_notifications_hr_unqueued_idx on public.hr_notifications (id) where not hr_emails_queued;

/** Emails a person may get in a day (Nairobi time), across notifications, HR alerts and chat digests. */
create or replace function public.daily_email_cap() returns integer language sql immutable as $$ select 20 $$;

/** Today in Nairobi (UTC+3, no daylight saving). */
create or replace function public.email_day() returns date language sql stable as $$
  select ((now() at time zone 'UTC') + interval '3 hours')::date
$$;

create or replace function public.emails_left_today(p_tenant uuid, p_email text) returns integer
language sql stable security definer set search_path = public as $$
  select public.daily_email_cap() - coalesce(
    (select c.sent from public.email_daily_counts c
     where c.tenant_id = p_tenant and c.to_email = lower(btrim(p_email)) and c.day = public.email_day()), 0)
$$;

/**
 * Adds p_delta (negative: gives back) to today's count of each address in its company, once per entry
 * (p_tenants and p_emails side by side).
 */
create or replace function public.count_emails_sent(p_tenants uuid[], p_emails text[], p_delta integer default 1) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_delta >= 0 then
    insert into public.email_daily_counts as c (tenant_id, to_email, day, sent)
    select x.t, lower(btrim(x.e)), public.email_day(), count(*)::integer * p_delta
    from unnest(p_tenants, p_emails) as x(t, e)
    where x.t is not null and coalesce(btrim(x.e), '') <> ''
    group by x.t, lower(btrim(x.e))
    on conflict (tenant_id, to_email, day) do update set sent = c.sent + excluded.sent;
  else
    update public.email_daily_counts c set sent = greatest(c.sent + g.n * p_delta, 0)
    from (select x.t, lower(btrim(x.e)) as em, count(*)::integer as n from unnest(p_tenants, p_emails) as x(t, e)
          where x.t is not null and coalesce(btrim(x.e), '') <> '' group by 1, 2) g
    where c.tenant_id = g.t and c.to_email = g.em and c.day = public.email_day();
  end if;
end $$;

/** The company's name as the emails show it (the letterhead's, else the company's). */
create or replace function public.email_company_name(p_tenant uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select l.company_name from public.company_logo l
     where l.tenant_id = p_tenant and coalesce(btrim(l.company_name), '') <> '' order by l.created_at desc limit 1),
    (select t.name from public.tenants t where t.id = p_tenant))
$$;

/** A login's employee record in a company (by work email), if they have one. */
create or replace function public.login_employee(p_tenant uuid, p_user uuid)
returns table (first_name text, full_name text, employee_number text)
language sql stable security definer set search_path = public as $$
  select nullif(btrim(e."First Name"), ''),
         nullif(btrim(concat_ws(' ', nullif(btrim(e."First Name"), ''), nullif(btrim(e."Last Name"), ''))), ''),
         e."Employee Number"
  from public.employees e
  join auth.users u on u.id = p_user
  where e.tenant_id = p_tenant and lower(btrim(e."Work Email")) = lower(btrim(u.email))
  limit 1
$$;

/** The first name to greet a login by: their employee record's, else their profile's. */
create or replace function public.login_first_name(p_tenant uuid, p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select le.first_name from public.login_employee(p_tenant, p_user) le),
    (select nullif(split_part(btrim(p.full_name), ' ', 1), '') from public.user_profiles p where p.user_id = p_user))
$$;

revoke all on function public.emails_left_today(uuid, text) from public, anon, authenticated;
revoke all on function public.count_emails_sent(uuid[], text[], integer) from public, anon, authenticated;
revoke all on function public.email_company_name(uuid) from public, anon, authenticated;
revoke all on function public.login_employee(uuid, uuid) from public, anon, authenticated;
revoke all on function public.login_first_name(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. the employee's own notifications: levels and the daily cap
-- ---------------------------------------------------------------------------------------------
/**
 * As before (20261013800000): per employee, every notification not yet emailed, once the latest is p_settle old,
 * marked emailed as it is returned. Now also: "important only" leaves out what is not important; someone who has had
 * their 20 emails today waits until tomorrow (unless a warning, suspension or payslip is among them). HR-facing ones
 * are not the employee's: they go to HR through claim_hr_alert_emails(). Server only.
 */
create or replace function public.claim_notification_emails(p_settle interval default interval '2 minutes', p_limit integer default 50)
returns table (
  tenant_id uuid, employee_number text, to_email text, first_name text, company_name text,
  ids bigint[], items jsonb
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  -- HR-facing, and those the employee doesn't want: done here, nothing to send to the employee
  with pref as (
    select n.id, n.notification_type,
           (select coalesce(p.email_level, case when p.email then 'all' else 'off' end)
            from public.employees e join public.notification_preferences p on p.employee_id = e.id
            where e.tenant_id = n.tenant_id and e."Employee Number" = n.employee_number limit 1) as level
    from public.hr_notifications n
    where not n.email_sent
  )
  update public.hr_notifications n set email_sent = true, email_error = 'not emailed: ' ||
      case when public.hr_only_notification(pref.notification_type) then 'for HR (emailed to HR)'
           when pref.level = 'off' then 'turned off by the employee'
           else 'the employee gets important ones only' end
  from pref
  where n.id = pref.id
    and (public.hr_only_notification(pref.notification_type)
         or (not public.always_emailed(pref.notification_type)
             and (pref.level = 'off' or (pref.level = 'important' and not public.important_notification(pref.notification_type)))));

  return query
  with ready as (
    select n.tenant_id, n.employee_number
    from public.hr_notifications n
    left join public.employees e on e.tenant_id = n.tenant_id and e."Employee Number" = n.employee_number
    where not n.email_sent
    group by n.tenant_id, n.employee_number
    having max(n.created_at) <= now() - p_settle
       and (bool_or(public.always_emailed(n.notification_type))
            or public.emails_left_today(n.tenant_id, coalesce(nullif(btrim(max(e."Work Email")), ''), nullif(btrim(max(n.work_email)), ''))) > 0)
    order by min(n.created_at)
    limit p_limit
  ),
  claimed as (
    update public.hr_notifications n set email_sent = true, emailed_at = now()
    from ready r
    where n.tenant_id = r.tenant_id and n.employee_number = r.employee_number and not n.email_sent
    returning n.*
  ),
  final as (
    select c.tenant_id, c.employee_number,
           coalesce(nullif(btrim(e."Work Email"), ''), nullif(btrim(max(c.work_email)), '')) as to_email,
           e."First Name" as first_name,
           public.email_company_name(c.tenant_id) as company_name,
           array_agg(c.id order by c.created_at) as ids,
           jsonb_agg(jsonb_build_object('type', c.notification_type, 'title', c.title, 'message', c.message, 'at', c.created_at)
                     order by c.created_at) as items
    from claimed c
    left join public.employees e on e.tenant_id = c.tenant_id and e."Employee Number" = c.employee_number
    group by c.tenant_id, c.employee_number, e."Work Email", e."First Name"
  ),
  counted as (
    select public.count_emails_sent(array_agg(f.tenant_id), array_agg(f.to_email), 1) from final f where f.to_email is not null
  )
  select f.tenant_id, f.employee_number, f.to_email, f.first_name, f.company_name, f.ids, f.items
  from final f
  left join counted on true;
end $$;
revoke all on function public.claim_notification_emails(interval, integer) from public, anon, authenticated;
grant execute on function public.claim_notification_emails(interval, integer) to service_role;

/**
 * A send that failed: tried again on a later run, up to 5 times (p_count_attempt false: not counted), and the email
 * is given back to the person's daily count. Server only.
 */
create or replace function public.release_notification_emails(p_ids bigint[], p_error text, p_count_attempt boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.count_emails_sent(array_agg(g.tenant_id), array_agg(g.to_email), -1)
  from (
    select distinct on (n.tenant_id, n.employee_number) n.tenant_id,
           coalesce(nullif(btrim(e."Work Email"), ''), nullif(btrim(n.work_email), '')) as to_email
    from public.hr_notifications n
    left join public.employees e on e.tenant_id = n.tenant_id and e."Employee Number" = n.employee_number
    where n.id = any(p_ids) and n.email_sent and n.emailed_at is not null
  ) g
  where g.to_email is not null;

  update public.hr_notifications
  set email_attempts = email_attempts + case when p_count_attempt then 1 else 0 end,
      email_error = left(p_error, 500),
      email_sent = p_count_attempt and email_attempts + 1 >= 5,
      emailed_at = null
  where id = any(p_ids);
end $$;
revoke all on function public.release_notification_emails(bigint[], text, boolean) from public, anon, authenticated;
grant execute on function public.release_notification_emails(bigint[], text, boolean) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. HR-facing notifications to HR
-- ---------------------------------------------------------------------------------------------
/** The modules whose people are emailed an HR-facing notification of this type (see the header for the mapping). */
create or replace function public.hr_alert_modules(p_type text) returns text[] language sql immutable as $$
  select case
    when p_type = 'leave_recommended' then array['leaves']
    when p_type = 'application_received' then array['recruitment']
    when p_type = 'loan_requested' then array['payroll']
    -- contract_expiring, probation_expiring, contract_signed, exit_requested, and any HR-facing type added later
    else array['employees', 'hr-lifecycle']
  end
$$;

/**
 * Who in a company is emailed an HR-facing notification of this type: active logins whose role there is ADMIN or has
 * one of hr_alert_modules(type) in role_permissions (a loan request: also the HR role, as manages_loans()). Their
 * login email, so people with no employee record are included. Server only.
 */
create or replace function public.hr_alert_recipients(p_tenant uuid, p_type text)
returns table (user_id uuid, email text)
language sql stable security definer set search_path = public as $$
  select m.user_id, btrim(coalesce(nullif(btrim(u.email), ''), p.email))
  from public.memberships m
  left join auth.users u on u.id = m.user_id
  left join public.user_profiles p on p.user_id = m.user_id
  where m.tenant_id = p_tenant
    and m.account_status = 'ACTIVE'
    and coalesce(nullif(btrim(u.email), ''), btrim(p.email), '') <> ''
    and (m.role = 'ADMIN'
         or (p_type = 'loan_requested' and m.role = 'HR')
         or exists (select 1 from public.role_permissions rp
                    where rp.tenant_id = p_tenant and rp.role_name = m.role
                      and rp.permissions && public.hr_alert_modules(p_type)))
$$;
revoke all on function public.hr_alert_recipients(uuid, text) from public, anon, authenticated;
grant execute on function public.hr_alert_recipients(uuid, text) to service_role;

/**
 * Hands each new HR-facing notification to its recipients: one delivery per person (pending, or skipped when they
 * turned HR alerts off or get important ones only). Never to the employee it is about. Server only.
 */
create or replace function public.queue_hr_alert_emails() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  with todo as (
    update public.hr_notifications n set hr_emails_queued = true
    where not n.hr_emails_queued and public.hr_only_notification(n.notification_type)
    returning n.id, n.tenant_id, n.notification_type, n.employee_number
  )
  insert into public.notification_email_deliveries (tenant_id, kind, notification_id, user_id, to_email, status, error)
  select t.tenant_id, 'hr_alert', t.id, r.user_id, r.email,
         case when coalesce(ep.hr_alerts, 'all') = 'off'
                or (ep.hr_alerts = 'important' and not public.important_notification(t.notification_type))
              then 'skipped' else 'pending' end,
         case when coalesce(ep.hr_alerts, 'all') = 'off' then 'not emailed: HR alerts turned off'
              when ep.hr_alerts = 'important' and not public.important_notification(t.notification_type)
                then 'not emailed: gets important ones only' end
  from todo t
  cross join lateral public.hr_alert_recipients(t.tenant_id, t.notification_type) r
  left join public.email_preferences ep on ep.user_id = r.user_id and ep.tenant_id = t.tenant_id
  where not exists (
    select 1 from public.employees e
    where e.tenant_id = t.tenant_id and e."Employee Number" = t.employee_number
      and lower(btrim(e."Work Email")) = lower(r.email))
  on conflict (notification_id, user_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.queue_hr_alert_emails() from public, anon, authenticated;
grant execute on function public.queue_hr_alert_emails() to service_role;

/**
 * The HR alert emails to send now: per person, every pending one, once the latest is p_settle old, and while they are
 * under the daily cap. Marked sent as they are returned (release_email_deliveries() puts back a failed send).
 * `role` is their role in the company. Server only.
 */
create or replace function public.claim_hr_alert_emails(p_settle interval default interval '2 minutes', p_limit integer default 50)
returns table (
  tenant_id uuid, user_id uuid, to_email text, first_name text, company_name text, role text,
  ids bigint[], items jsonb
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.queue_hr_alert_emails();

  return query
  with ready as (
    select d.tenant_id, d.user_id
    from public.notification_email_deliveries d
    join public.hr_notifications n on n.id = d.notification_id
    where d.kind = 'hr_alert' and d.status = 'pending'
    group by d.tenant_id, d.user_id
    having max(n.created_at) <= now() - p_settle and public.emails_left_today(d.tenant_id, max(d.to_email)) > 0
    order by min(n.created_at)
    limit p_limit
  ),
  claimed as (
    update public.notification_email_deliveries d set status = 'sent', sent_at = now()
    from ready r
    where d.tenant_id = r.tenant_id and d.user_id = r.user_id and d.kind = 'hr_alert' and d.status = 'pending'
    returning d.*
  ),
  final as (
    select c.tenant_id, c.user_id, max(c.to_email) as to_email,
           public.login_first_name(c.tenant_id, c.user_id) as first_name,
           public.email_company_name(c.tenant_id) as company_name,
           (select m.role from public.memberships m where m.user_id = c.user_id and m.tenant_id = c.tenant_id) as role,
           array_agg(c.id order by n.created_at) as ids,
           jsonb_agg(jsonb_build_object('type', n.notification_type, 'title', n.title, 'message', n.message, 'at', n.created_at)
                     order by n.created_at) as items
    from claimed c
    join public.hr_notifications n on n.id = c.notification_id
    group by c.tenant_id, c.user_id
  ),
  counted as (
    select public.count_emails_sent(array_agg(f.tenant_id), array_agg(f.to_email), 1) from final f
  )
  select f.tenant_id, f.user_id, f.to_email, f.first_name, f.company_name, f.role, f.ids, f.items
  from final f
  left join counted on true;
end $$;
revoke all on function public.claim_hr_alert_emails(interval, integer) from public, anon, authenticated;
grant execute on function public.claim_hr_alert_emails(interval, integer) to service_role;

/**
 * Deliveries (HR alerts or chat digests) whose send failed: back to pending to be tried on a later run, failed after the
 * 5th try (p_count_attempt false, Resend's rate limit: the try is given back); the email is given back to the daily
 * count. p_ids are those of one or more emails. Server only.
 */
create or replace function public.release_email_deliveries(p_ids bigint[], p_error text, p_count_attempt boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.count_emails_sent(array_agg(g.tenant_id), array_agg(g.to_email), -1)
  from (
    select distinct on (d.tenant_id, d.user_id, d.kind, case when d.kind = 'chat' then d.id end) d.tenant_id, d.to_email
    from public.notification_email_deliveries d
    where d.id = any(p_ids) and d.status = 'sent'
  ) g;

  update public.notification_email_deliveries
  set attempts = attempts + case when p_count_attempt then 1 else 0 end,
      error = left(p_error, 500),
      status = case when p_count_attempt and attempts + 1 >= 5 then 'failed' else 'pending' end,
      sent_at = null
  where id = any(p_ids) and status = 'sent';
end $$;
revoke all on function public.release_email_deliveries(bigint[], text, boolean) from public, anon, authenticated;
grant execute on function public.release_email_deliveries(bigint[], text, boolean) to service_role;

/** A delivery that cannot be sent (no email address): not retried. Server only. */
create or replace function public.skip_email_deliveries(p_ids bigint[], p_error text)
returns void language sql security definer set search_path = public as $$
  update public.notification_email_deliveries set status = 'skipped', error = left(p_error, 500), sent_at = null
  where id = any(p_ids)
$$;
revoke all on function public.skip_email_deliveries(bigint[], text) from public, anon, authenticated;
grant execute on function public.skip_email_deliveries(bigint[], text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. the unread chat digest
-- ---------------------------------------------------------------------------------------------
/**
 * Builds the chat digests that are due and returns those to send now, marked sent (release_email_deliveries() puts
 * back a failed send). A person is due when they have messages, not their own, still unread p_delay after they were
 * sent, in a direct message, a channel they are a member of (chat preference "everything"), or anywhere they were
 * @mentioned; not in a muted chat; at most one digest per p_gap; under the daily cap; chat emails not off. Each
 * digest is one email: [{ channel_id, kind: 'dm' | 'channel', name, unread, mentions, latest_at }]. Server only.
 */
create or replace function public.claim_chat_digest_emails(
  p_delay interval default interval '10 minutes', p_gap interval default interval '30 minutes', p_limit integer default 100)
returns table (
  id bigint, tenant_id uuid, user_id uuid, to_email text, first_name text, company_name text, role text, items jsonb
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_cutoff timestamptz := now() - p_delay;
  -- never look further back than this, however long since someone's last digest
  v_floor timestamptz := now() - interval '2 days';
begin
  with people as (
    select m.user_id, m.tenant_id,
           btrim(coalesce(nullif(btrim(u.email), ''), pr.email)) as email,
           coalesce(ep.chat, 'all') as level,
           greatest(coalesce(st.covered_until, m.created_at), v_floor) as since,
           lower(coalesce((select le.full_name from public.login_employee(m.tenant_id, m.user_id) le), nullif(btrim(pr.full_name), ''))) as full_name
    from public.memberships m
    left join auth.users u on u.id = m.user_id
    left join public.user_profiles pr on pr.user_id = m.user_id
    left join public.email_preferences ep on ep.user_id = m.user_id and ep.tenant_id = m.tenant_id
    left join public.chat_email_state st on st.user_id = m.user_id and st.tenant_id = m.tenant_id
    where m.account_status = 'ACTIVE'
      and coalesce(ep.chat, 'all') <> 'off'
      and (st.last_digest_at is null or st.last_digest_at <= now() - p_gap)
      and coalesce(nullif(btrim(u.email), ''), btrim(pr.email), '') <> ''
      and public.emails_left_today(m.tenant_id, coalesce(nullif(btrim(u.email), ''), pr.email)) > 0
      and not exists (select 1 from public.notification_email_deliveries d
                      where d.kind = 'chat' and d.status = 'pending' and d.user_id = m.user_id and d.tenant_id = m.tenant_id)
  ),
  -- direct messages, and the channels they are a member of
  member_hits as (
    select p.user_id, p.tenant_id, c.id as channel_id, c.type = 'dm' as is_dm, c.name as channel_name,
           msg.id as message_id, msg.author_name, msg.created_at,
           (p.full_name is not null and length(p.full_name) >= 3
            and strpos(lower(coalesce(msg.content, '')), '@' || p.full_name) > 0) as mentioned
    from people p
    join public.channel_members cm on cm.user_id = p.user_id
    join public.channels c on c.id = cm.channel_id and c.tenant_id = p.tenant_id
    join public.messages msg on msg.channel_id = c.id
    where msg.created_at > p.since and msg.created_at <= v_cutoff
      and msg.author_id is distinct from p.user_id
      and not coalesce(cm.is_muted, false)
  ),
  -- @mentions in channels they can see but have not joined (a public channel, or one they created)
  mention_hits as (
    select p.user_id, p.tenant_id, c.id as channel_id, false as is_dm, c.name as channel_name,
           msg.id as message_id, msg.author_name, msg.created_at, true as mentioned
    from public.messages msg
    join public.channels c on c.id = msg.channel_id and c.type is distinct from 'dm'
    join people p on p.tenant_id = c.tenant_id
    where msg.created_at > v_floor and msg.created_at > p.since and msg.created_at <= v_cutoff
      and strpos(coalesce(msg.content, ''), '@') > 0
      and p.full_name is not null and length(p.full_name) >= 3
      and strpos(lower(msg.content), '@' || p.full_name) > 0
      and msg.author_id is distinct from p.user_id
      and (not coalesce(c.is_private, false) or c.created_by = p.user_id)
      and not exists (select 1 from public.channel_members cm where cm.channel_id = c.id and cm.user_id = p.user_id)
  ),
  hits as (
    select h.* from (select * from member_hits union all select * from mention_hits) h
    join people p on p.user_id = h.user_id and p.tenant_id = h.tenant_id
    where (h.is_dm or h.mentioned or p.level = 'all')
      and not exists (select 1 from public.chat_email_mutes mu where mu.user_id = h.user_id and mu.channel_id = h.channel_id)
      and h.created_at > coalesce((select s.last_read_at from public.user_channel_states s
                                   where s.user_id = h.user_id and s.channel_id = h.channel_id), '-infinity'::timestamptz)
  ),
  per_chat as (
    select h.user_id, h.tenant_id, h.channel_id, bool_or(h.is_dm) as is_dm,
           case when bool_or(h.is_dm) then (array_agg(h.author_name order by h.created_at desc))[1] else max(h.channel_name) end as name,
           count(*)::integer as unread, count(*) filter (where h.mentioned)::integer as mentions, max(h.created_at) as latest_at
    from hits h
    group by h.user_id, h.tenant_id, h.channel_id
  ),
  digests as (
    select pc.user_id, pc.tenant_id,
           jsonb_agg(jsonb_build_object('channel_id', pc.channel_id, 'kind', case when pc.is_dm then 'dm' else 'channel' end,
                                        'name', pc.name, 'unread', pc.unread, 'mentions', pc.mentions, 'latest_at', pc.latest_at)
                     order by pc.is_dm desc, pc.mentions > 0 desc, pc.latest_at desc) as items
    from per_chat pc
    group by pc.user_id, pc.tenant_id
  ),
  ins as (
    insert into public.notification_email_deliveries (tenant_id, kind, user_id, to_email, items)
    select d.tenant_id, 'chat', d.user_id, p.email, d.items
    from digests d join people p on p.user_id = d.user_id and p.tenant_id = d.tenant_id
    returning user_id, tenant_id
  )
  insert into public.chat_email_state as s (user_id, tenant_id, covered_until, last_digest_at)
  select i.user_id, i.tenant_id, v_cutoff, now() from ins i
  on conflict (user_id, tenant_id) do update set covered_until = excluded.covered_until, last_digest_at = excluded.last_digest_at;

  return query
  with picked as (
    select d.id from public.notification_email_deliveries d
    where d.kind = 'chat' and d.status = 'pending' and public.emails_left_today(d.tenant_id, d.to_email) > 0
    order by d.id
    limit greatest(coalesce(p_limit, 100), 1)
    for update skip locked
  ),
  claimed as (
    update public.notification_email_deliveries d set status = 'sent', sent_at = now()
    from picked where d.id = picked.id
    returning d.*
  ),
  counted as (
    select public.count_emails_sent(array_agg(c.tenant_id), array_agg(c.to_email), 1) from claimed c
  )
  select c.id, c.tenant_id, c.user_id, c.to_email,
         public.login_first_name(c.tenant_id, c.user_id),
         public.email_company_name(c.tenant_id),
         (select m.role from public.memberships m where m.user_id = c.user_id and m.tenant_id = c.tenant_id),
         c.items
  from claimed c
  left join counted on true;
end $$;
revoke all on function public.claim_chat_digest_emails(interval, interval, integer) from public, anon, authenticated;
grant execute on function public.claim_chat_digest_emails(interval, interval, integer) to service_role;

-- a new member's digest starts when they join (the memberships row's created_at), so no state row is needed for them

notify pgrst, 'reload schema';
