-- Emails at the scale of a company of thousands (FIG-820).
--
-- The send-notification-emails Edge Function (20261013800000) took 50 notifications a minute and sent them one after
-- another, about 3,000 an hour: a notice to 20,000 staff took seven hours. It now keeps claiming and sending for most of
-- each minute, up to 100 emails per request to Resend's batch endpoint, at a steady number of requests per second.
-- The cron job and claim_notification_emails() are unchanged (the function asks for more per claim).
--
-- The Email Portal sent a company-wide email from the browser, one request per person, within a budget of 1,000
-- recipients an hour per user, so an email to 5,000 staff was refused. It now hands the whole list to the server once
-- (POST /api/email/bulk), which queues it here; the same Edge Function sends the queue after the notifications.
--   * bulk_emails: one row per company-wide email (subject, body, attachments, who sent it).
--   * bulk_email_recipients: one row per person, queued -> sending -> sent, or failed after 5 tries.
--   * queue_bulk_email(): queues an email to those of the given addresses that are the work email of one of the
--     company's own employees (so a stolen session cannot mail the outside world through the queue).
--   * claim_bulk_emails() / release_bulk_emails() / finish_bulk_emails(): for the Edge Function. Claiming uses
--     FOR UPDATE SKIP LOCKED, so two runs never take the same recipient; one left 'sending' by a run that died is
--     claimed again after 15 minutes.
--   * release_notification_emails() gains p_count_attempt: a send Resend refused only because of its rate limit goes
--     back without using up one of the 5 tries.
-- All of these are for the server only (service role); signed-in users cannot read or change the queue.

-- 1. notifications: a release that does not count as a try ------------------------------------------------------

drop function if exists public.release_notification_emails(bigint[], text);

/** A send that failed: tried again on a later run, up to 5 times (p_count_attempt false: not counted). Server only. */
create or replace function public.release_notification_emails(p_ids bigint[], p_error text, p_count_attempt boolean default true)
returns void language sql security definer set search_path = public as $$
  update public.hr_notifications
  set email_attempts = email_attempts + case when p_count_attempt then 1 else 0 end,
      email_error = left(p_error, 500),
      email_sent = p_count_attempt and email_attempts + 1 >= 5,
      emailed_at = null
  where id = any(p_ids)
$$;
revoke all on function public.release_notification_emails(bigint[], text, boolean) from public, anon, authenticated;
grant execute on function public.release_notification_emails(bigint[], text, boolean) to service_role;

-- 2. the bulk email queue -----------------------------------------------------------------------------------------

create table if not exists public.bulk_emails (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  purpose text not null,
  from_address text,
  subject text not null,
  html text not null,
  -- [{ filename, content (base64) }]; Resend's batch endpoint takes no attachments, so these go one by one
  attachments jsonb not null default '[]'::jsonb,
  recipient_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.bulk_email_recipients (
  id bigint generated always as identity primary key,
  bulk_email_id uuid not null references public.bulk_emails(id) on delete cascade,
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  to_email text not null,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts integer not null default 0,
  error text,
  provider_id text,
  claimed_at timestamptz,
  sent_at timestamptz,
  unique (bulk_email_id, to_email)
);

create index if not exists bulk_email_recipients_pending_idx on public.bulk_email_recipients (id)
  where status in ('queued', 'sending');
create index if not exists bulk_emails_tenant_idx on public.bulk_emails (tenant_id, created_at desc);

do $$
declare
  t text;
begin
  foreach t in array array['bulk_emails', 'bulk_email_recipients'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I as restrictive for all
         using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()))', t);
    -- no permissive policy, so signed-in users see and change nothing; the server (service role) reads and writes it
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

/**
 * Queues one email to every address in p_emails that is the work email of an employee of p_tenant (case and spaces
 * ignored, each person once); the others are skipped. Returns the new bulk email's id (null when nobody matched, and
 * then nothing is queued) and how many were queued and skipped. For the server only.
 */
create or replace function public.queue_bulk_email(
  p_tenant uuid, p_created_by uuid, p_purpose text, p_from text, p_subject text, p_html text,
  p_attachments jsonb, p_emails text[]
) returns table (bulk_email_id uuid, queued integer, skipped integer)
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_queued integer;
  v_asked integer;
begin
  if p_tenant is null or coalesce(btrim(p_subject), '') = '' or coalesce(btrim(p_html), '') = '' then
    raise exception 'queue_bulk_email: a company, a subject and a body are needed';
  end if;

  select count(distinct lower(btrim(a))) into v_asked from unnest(p_emails) a where coalesce(btrim(a), '') <> '';

  insert into public.bulk_emails (tenant_id, created_by, purpose, from_address, subject, html, attachments)
  values (p_tenant, p_created_by, p_purpose, p_from, p_subject, p_html, coalesce(p_attachments, '[]'::jsonb))
  returning id into v_id;

  insert into public.bulk_email_recipients (bulk_email_id, tenant_id, to_email)
  select distinct on (lower(btrim(e."Work Email"))) v_id, p_tenant, btrim(e."Work Email")
  from public.employees e
  where e.tenant_id = p_tenant
    and coalesce(btrim(e."Work Email"), '') <> ''
    and lower(btrim(e."Work Email")) in (select lower(btrim(a)) from unnest(p_emails) a)
  order by lower(btrim(e."Work Email"));
  get diagnostics v_queued = row_count;

  if v_queued = 0 then
    delete from public.bulk_emails where id = v_id;
    v_id := null;
  else
    update public.bulk_emails set recipient_count = v_queued where id = v_id;
  end if;

  return query select v_id, v_queued, greatest(v_asked - v_queued, 0);
end $$;
revoke all on function public.queue_bulk_email(uuid, uuid, text, text, text, text, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.queue_bulk_email(uuid, uuid, text, text, text, text, jsonb, text[]) to service_role;

/**
 * Up to p_limit recipients to send to now, oldest queued first, marked 'sending' as they are returned; also those left
 * 'sending' for 15 minutes by a run that died (given up on after 5 tries). Server only.
 */
create or replace function public.claim_bulk_emails(p_limit integer default 100)
returns table (id bigint, bulk_email_id uuid, tenant_id uuid, to_email text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  update public.bulk_email_recipients r
  set status = 'failed', error = coalesce(r.error, 'not sent: the sending run stopped')
  where r.status = 'sending' and r.claimed_at < now() - interval '15 minutes' and r.attempts >= 5;

  return query
  with picked as (
    select r.id
    from public.bulk_email_recipients r
    where r.status = 'queued'
       or (r.status = 'sending' and r.claimed_at < now() - interval '15 minutes')
    order by r.id
    limit greatest(coalesce(p_limit, 100), 1)
    for update skip locked
  )
  update public.bulk_email_recipients r
  set status = 'sending', claimed_at = now(), attempts = r.attempts + 1
  from picked
  where r.id = picked.id
  returning r.id, r.bulk_email_id, r.tenant_id, r.to_email;
end $$;
revoke all on function public.claim_bulk_emails(integer) from public, anon, authenticated;
grant execute on function public.claim_bulk_emails(integer) to service_role;

/**
 * Sends that failed go back to the queue, or are 'failed' after the 5th try. p_count_attempt false (Resend's rate
 * limit): the try is given back. Server only.
 */
create or replace function public.release_bulk_emails(p_ids bigint[], p_error text, p_count_attempt boolean default true)
returns void language sql security definer set search_path = public as $$
  update public.bulk_email_recipients
  set attempts = case when p_count_attempt then attempts else greatest(attempts - 1, 0) end,
      status = case when p_count_attempt and attempts >= 5 then 'failed' else 'queued' end,
      error = left(p_error, 500),
      claimed_at = null
  where id = any(p_ids) and status = 'sending'
$$;
revoke all on function public.release_bulk_emails(bigint[], text, boolean) from public, anon, authenticated;
grant execute on function public.release_bulk_emails(bigint[], text, boolean) to service_role;

/** Marks recipients sent, with the provider's id for each (p_provider_ids in the same order as p_ids). Server only. */
create or replace function public.finish_bulk_emails(p_ids bigint[], p_provider_ids text[])
returns void language sql security definer set search_path = public as $$
  update public.bulk_email_recipients r
  set status = 'sent', sent_at = now(), provider_id = s.provider_id, error = null
  from unnest(p_ids, p_provider_ids) as s(id, provider_id)
  where r.id = s.id and r.status = 'sending'
$$;
revoke all on function public.finish_bulk_emails(bigint[], text[]) from public, anon, authenticated;
grant execute on function public.finish_bulk_emails(bigint[], text[]) to service_role;

notify pgrst, 'reload schema';
