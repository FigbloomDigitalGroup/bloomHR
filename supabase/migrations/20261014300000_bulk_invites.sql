-- Adding thousands of employees at once (FIG-818). A company bulk-adds 5,000-20,000 employees from a spreadsheet;
-- before this every row was checked, saved, invited and emailed one request at a time from the browser (hours, with
-- the tab open). Now:
--   * save_employees_batch(): the upload saves a few hundred rows per call. It runs as the caller (RLS, the employees
--     triggers and the onboarding/payroll rules all apply exactly as before) and reports each row's result.
--   * invite_queue + enqueue_invitations(): the browser only queues who to invite. The send-invites Edge Function,
--     called every minute by pg_cron (below), claims a batch with claim_invitations(), which makes each invitation
--     the same way create_invitation() does (only the token's hash is stored; a new one replaces the old link), and
--     emails the links through Resend in batches. Each person's status is kept (queued, sending, sent, skipped,
--     failed + why), so HR can close the tab, come back to see "x of y sent", and retry the failures.
--     The cron job uses the same Vault secrets as the notification emails (20261013800000): the function address
--     and the shared CRON_SECRET.
--   * start_onboarding_by_email(): marks the new employees invited in one statement per chunk, instead of one call
--     each.
-- Joining is unchanged: the email links to /join?token=..., and accepting goes through /api/invites/accept or
-- accept_invitation() as before.

-- ---------------------------------------------------------------------------------------------
-- 1. saving the upload in batches
-- ---------------------------------------------------------------------------------------------
/**
 * Saves rows of the bulk employee upload: p_rows is [{ "row": 2, "data": { "Employee Number": ..., ... } }, ...].
 * An employee number already in the company is updated with the given fields, a new one is added (it needs a work
 * email: the invitation to join is sent there). Runs as the caller, so it can do nothing they could not do one row
 * at a time. Each row is saved on its own: a row that fails is reported and the others are still saved.
 */
create or replace function public.save_employees_batch(p_rows jsonb)
returns table (row_no integer, employee_number text, outcome text, employee_id uuid, work_email text, error_code text, error_message text)
language plpgsql security invoker set search_path = public as $$
declare
  r jsonb;
  fields jsonb;
  cols text;
  existing uuid;
  v_number text;
  v_id uuid;
  v_email text;
  i integer := 0;
  -- what a row may set: not the keys, the generated payroll number or the onboarding state
  allowed text[] := (
    select array_agg(a.attname::text) from pg_attribute a
    where a.attrelid = 'public.employees'::regclass and a.attnum > 0 and not a.attisdropped
      and a.attgenerated = '' and a.attidentity = ''
      and a.attname not in ('id', 'tenant_id', 'created_at', 'Payroll Number') and a.attname not like 'onboarding\_%');
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'The rows must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'Save at most 500 rows at a time' using errcode = '22023';
  end if;

  for r in select x.value from jsonb_array_elements(p_rows) x loop
    i := i + 1;
    row_no := coalesce((r->>'row')::integer, i);
    v_number := null; v_id := null; v_email := null;
    outcome := null; error_code := null; error_message := null;
    begin
      select coalesce(jsonb_object_agg(f.key, f.value), '{}'::jsonb) into fields
      from jsonb_each(case when jsonb_typeof(r->'data') = 'object' then r->'data' else '{}'::jsonb end) f
      where f.key = any (allowed);
      v_number := nullif(btrim(fields->>'Employee Number'), '');
      if v_number is null then
        raise exception 'missing Employee Number' using errcode = '23502';
      end if;
      fields := fields || jsonb_build_object('Employee Number', v_number);
      select string_agg(format('%I', k), ', ') into cols from jsonb_object_keys(fields) k;

      existing := null;
      select e.id into existing from public.employees e
      where e.tenant_id = public.current_tenant_id() and e."Employee Number" = v_number;

      if existing is null then
        if coalesce(btrim(fields->>'Work Email'), '') = '' then
          raise exception 'no work email (the invitation to join is sent there)' using errcode = '23502';
        end if;
        execute format('insert into public.employees (%s) select %s from jsonb_populate_record(null::public.employees, $1) '
                       'returning id, "Work Email"', cols, cols)
          using fields into v_id, v_email;
        outcome := 'created';
      else
        execute format('update public.employees set (%s) = (select %s from jsonb_populate_record(null::public.employees, $1)) '
                       'where id = $2 returning id, "Work Email"', cols, cols)
          using fields, existing into v_id, v_email;
        if v_id is null then
          raise exception 'you may not change this employee' using errcode = '42501';
        end if;
        outcome := 'updated';
      end if;
    exception when others then
      outcome := 'error';
      v_id := null;
      v_email := null;
      error_code := sqlstate;
      error_message := sqlerrm;
    end;
    employee_number := v_number;
    employee_id := v_id;
    work_email := v_email;
    return next;
  end loop;
end $$;
revoke all on function public.save_employees_batch(jsonb) from public, anon;
grant execute on function public.save_employees_batch(jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. the invitation queue
-- ---------------------------------------------------------------------------------------------
create table if not exists public.invite_queue (
  id bigint generated always as identity primary key,
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  -- one upload (or one retry) is one batch: what the progress is counted over
  batch_id uuid not null,
  email text not null,
  role text not null default 'STAFF',
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'skipped', 'failed')),
  attempts integer not null default 0,
  error text,
  requested_by uuid references auth.users(id) on delete set null,
  invitation_id uuid references public.invitations(id) on delete set null,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists invite_queue_due_idx on public.invite_queue (next_attempt_at, id) where status in ('queued', 'sending');
create index if not exists invite_queue_batch_idx on public.invite_queue (tenant_id, batch_id, status);
-- an address waits in the queue once per company
create unique index if not exists invite_queue_open_key on public.invite_queue (tenant_id, lower(email)) where status in ('queued', 'sending');

alter table public.invite_queue enable row level security;
drop policy if exists tenant_isolation on public.invite_queue;
create policy tenant_isolation on public.invite_queue as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
-- administrators and HR follow the progress; there is no write policy: rows are written only by the functions below
drop policy if exists inviters_read on public.invite_queue;
create policy inviters_read on public.invite_queue for select to authenticated
  using ((select public.current_user_role()) = any (array['ADMIN', 'HR']));
revoke all on public.invite_queue from anon;

-- the caller's role in the company they are working in, when they may invite people (ADMIN or HR); else null
create or replace function public.inviter_role(out role text, out tenant_id uuid)
language sql stable security definer set search_path = public as $$
  select p.role, p.tenant_id
  from public.user_profiles p
  join public.tenants t on t.id = p.tenant_id and t.status = 'active'
  where p.user_id = auth.uid() and p.account_status = 'ACTIVE' and p.role in ('ADMIN', 'HR')
$$;
revoke all on function public.inviter_role() from public, anon, authenticated;

/**
 * Queues invitations to join the company: p_people is [{ "email": ..., "role": "STAFF" }, ...] (at most 1000; send
 * more in several calls with the same p_batch). The same checks as create_invitation(): only ADMIN or HR, and HR
 * invites staff only. Someone already in the company is recorded as skipped; an address already waiting is moved
 * into this batch. Returns the batch and the addresses refused, with why.
 */
create or replace function public.enqueue_invitations(p_people jsonb, p_batch uuid default null)
returns table (batch_id uuid, queued integer, skipped integer, rejected jsonb)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  me record;
  v_batch uuid := coalesce(p_batch, gen_random_uuid());
  v_queued integer := 0;
  v_skipped integer := 0;
  v_rejected jsonb := '[]'::jsonb;
  p record;
  problem text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select * into me from public.inviter_role();
  if me.tenant_id is null then
    raise exception 'Only an administrator or HR can invite people' using errcode = '42501';
  end if;
  if jsonb_typeof(p_people) is distinct from 'array' then
    raise exception 'The people to invite must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_people) > 1000 then
    raise exception 'Queue at most 1000 people at a time' using errcode = '22023';
  end if;

  for p in
    with wanted as (
      select distinct on (lower(btrim(coalesce(x->>'email', ''))))
        lower(btrim(coalesce(x->>'email', ''))) as email,
        coalesce(nullif(upper(btrim(x->>'role')), ''), 'STAFF') as role
      from jsonb_array_elements(p_people) x
      order by 1
    ),
    -- who is in the company already, looked up once for the whole list
    members as (
      select distinct lower(u.email) as email
      from public.memberships m join auth.users u on u.id = m.user_id
      where m.tenant_id = me.tenant_id
    )
    select w.email, w.role, (mb.email is not null) as is_member
    from wanted w left join members mb on mb.email = w.email
    order by w.email
  loop
    problem := case
      when p.email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(p.email) > 254 then 'not a valid email address'
      when p.role not in ('ADMIN', 'HR', 'CHECKER', 'MANAGER', 'REGIONAL', 'OPERATIONS', 'STAFF') then 'unknown role'
      when me.role <> 'ADMIN' and p.role <> 'STAFF' then 'only an administrator can invite this role'
    end;
    if problem is not null then
      v_rejected := v_rejected || jsonb_build_object('email', p.email, 'reason', problem);
      continue;
    end if;

    if p.is_member then
      insert into public.invite_queue (tenant_id, batch_id, email, role, status, error, requested_by)
      values (me.tenant_id, v_batch, p.email, p.role, 'skipped', 'already has access to this company', auth.uid());
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- already waiting to be sent: counted in this batch instead
    update public.invite_queue q set batch_id = v_batch, role = case when q.status = 'queued' then p.role else q.role end,
      requested_by = auth.uid(), updated_at = now()
    where q.tenant_id = me.tenant_id and lower(q.email) = p.email and q.status in ('queued', 'sending');
    if not found then
      insert into public.invite_queue (tenant_id, batch_id, email, role, requested_by)
      values (me.tenant_id, v_batch, p.email, p.role, auth.uid());
    end if;
    v_queued := v_queued + 1;
  end loop;

  return query select v_batch, v_queued, v_skipped, v_rejected;
end $$;
revoke all on function public.enqueue_invitations(jsonb, uuid) from public, anon;
grant execute on function public.enqueue_invitations(jsonb, uuid) to authenticated;

/** How far a batch has got: counts by status, and the failures with their reasons (the first 200). As the caller. */
create or replace function public.invitation_batch_progress(p_batch uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'total', count(*),
    'queued', count(*) filter (where q.status = 'queued'),
    'sending', count(*) filter (where q.status = 'sending'),
    'sent', count(*) filter (where q.status = 'sent'),
    'skipped', count(*) filter (where q.status = 'skipped'),
    'failed', count(*) filter (where q.status = 'failed'),
    'failures', coalesce((
      select jsonb_agg(jsonb_build_object('email', f.email, 'error', f.error) order by f.id)
      from (select id, email, error from public.invite_queue
            where batch_id = p_batch and status = 'failed' order by id limit 200) f), '[]'::jsonb))
  from public.invite_queue q
  where q.batch_id = p_batch
$$;
revoke all on function public.invitation_batch_progress(uuid) from public, anon;
grant execute on function public.invitation_batch_progress(uuid) to authenticated;

/** Puts a batch's failed invitations back in the queue (HR only those for staff). Returns how many. */
create or replace function public.retry_failed_invitations(p_batch uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  me record;
  n integer;
begin
  select * into me from public.inviter_role();
  if me.tenant_id is null then
    raise exception 'Only an administrator or HR can invite people' using errcode = '42501';
  end if;
  update public.invite_queue q
  set status = 'queued', attempts = 0, error = null, next_attempt_at = now(), requested_by = auth.uid(), updated_at = now()
  where q.tenant_id = me.tenant_id and q.batch_id = p_batch and q.status = 'failed'
    and (me.role = 'ADMIN' or q.role = 'STAFF')
    -- one already waiting again (queued from another upload) stays failed here
    and not exists (select 1 from public.invite_queue o
                    where o.tenant_id = q.tenant_id and lower(o.email) = lower(q.email) and o.status in ('queued', 'sending'));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.retry_failed_invitations(uuid) from public, anon;
grant execute on function public.retry_failed_invitations(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. the server's side (service role only): claim, then mark sent or hand back
-- ---------------------------------------------------------------------------------------------
/**
 * The invitations to email now (at most p_limit), each with a fresh link token. For each one claimed it does what
 * create_invitation() does for the person who queued it: checks they may still invite this role, skips someone
 * already in the company, revokes any earlier open invitation for the address and stores the new token's hash.
 * The token itself is only returned, never stored. Rows are locked with SKIP LOCKED, so two runs never claim the
 * same one; one left 'sending' for 10 minutes (a run that died) is claimed again, up to 5 attempts.
 */
create or replace function public.claim_invitations(p_limit integer default 100)
returns table (
  id bigint, tenant_id uuid, email text, role text, token text, expires_at timestamptz,
  company_name text, inviter_email text
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  q record;
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  for q in
    select iq.* from public.invite_queue iq
    where (iq.status = 'queued' and iq.next_attempt_at <= now())
       or (iq.status = 'sending' and iq.claimed_at < now() - interval '10 minutes')
    order by iq.id
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
    for update skip locked
  loop
    if q.attempts >= 5 then
      update public.invite_queue set status = 'failed', error = coalesce(error, 'not sent after 5 attempts'), updated_at = now()
      where invite_queue.id = q.id;
      continue;
    end if;

    -- the person who queued it must still be allowed to invite this role here
    if not exists (
      select 1 from public.memberships m
      join public.tenants t on t.id = m.tenant_id and t.status = 'active'
      where m.user_id = q.requested_by and m.tenant_id = q.tenant_id and m.account_status = 'ACTIVE'
        and (m.role = 'ADMIN' or (m.role = 'HR' and q.role = 'STAFF'))
    ) then
      update public.invite_queue set status = 'failed', updated_at = now(),
        error = 'the person who sent this can no longer invite people to this company'
      where invite_queue.id = q.id;
      continue;
    end if;

    if exists (
      select 1 from public.memberships m join auth.users u on u.id = m.user_id
      where m.tenant_id = q.tenant_id and lower(u.email) = lower(q.email)
    ) then
      update public.invite_queue set status = 'skipped', error = 'already has access to this company', updated_at = now()
      where invite_queue.id = q.id;
      continue;
    end if;

    -- one open invitation per address and company: a new one replaces the old link (as create_invitation)
    update public.invitations i set status = 'revoked'
    where i.tenant_id = q.tenant_id and lower(i.email) = lower(q.email) and i.status = 'pending';

    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.invitations (tenant_id, email, role, token_hash, invited_by)
    values (q.tenant_id, lower(q.email), q.role, public.hash_invite_token(v_token), q.requested_by)
    returning invitations.id, invitations.expires_at into v_id, v_expires;

    update public.invite_queue set status = 'sending', attempts = attempts + 1, claimed_at = now(),
      invitation_id = v_id, updated_at = now()
    where invite_queue.id = q.id;

    return query
      select q.id, q.tenant_id, lower(q.email), q.role, v_token, v_expires,
             (select t.name from public.tenants t where t.id = q.tenant_id),
             (select u.email::text from auth.users u where u.id = q.requested_by);
  end loop;
end $$;
revoke all on function public.claim_invitations(integer) from public, anon, authenticated;
grant execute on function public.claim_invitations(integer) to service_role;

/** The emails went out. Server only. */
create or replace function public.finish_invitations(p_ids bigint[])
returns void language sql security definer set search_path = public as $$
  update public.invite_queue set status = 'sent', sent_at = now(), error = null, updated_at = now()
  where id = any (p_ids) and status = 'sending'
$$;
revoke all on function public.finish_invitations(bigint[]) from public, anon, authenticated;
grant execute on function public.finish_invitations(bigint[]) to service_role;

/**
 * The emails did not go out. With p_retry they are tried again later (after 2, 4, 8, 16 minutes), up to 5 attempts;
 * without (the address was refused) they fail straight away. Server only.
 */
create or replace function public.release_invitations(p_ids bigint[], p_error text, p_retry boolean default true)
returns void language sql security definer set search_path = public as $$
  update public.invite_queue
  set status = case when p_retry and attempts < 5 then 'queued' else 'failed' end,
      error = left(p_error, 500),
      next_attempt_at = now() + make_interval(mins => power(2, least(attempts, 6))::integer),
      updated_at = now()
  where id = any (p_ids) and status = 'sending'
$$;
revoke all on function public.release_invitations(bigint[], text, boolean) from public, anon, authenticated;
grant execute on function public.release_invitations(bigint[], text, boolean) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. onboarding started for many employees at once
-- ---------------------------------------------------------------------------------------------
/**
 * After invitations were queued for employees added in bulk: marks those still drafts as invited, found by work
 * email (at most 1000 per call), with the same history entry start_onboarding() writes. Returns how many.
 */
create or replace function public.start_onboarding_by_email(p_emails text[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if not public.has_module('employees') then
    raise exception 'Only HR can do this' using errcode = '42501';
  end if;
  if cardinality(p_emails) > 1000 then
    raise exception 'At most 1000 at a time' using errcode = '22023';
  end if;

  perform set_config('app.onboarding_transition', 'on', true);
  with moved as (
    update public.employees e set onboarding_status = 'invited'
    where e.tenant_id = public.current_tenant_id() and e.onboarding_status = 'draft'
      and lower(btrim(e."Work Email")) in (select lower(btrim(x)) from unnest(p_emails) x)
    returning e.id, e.tenant_id
  )
  insert into public.employee_onboarding_reviews (tenant_id, employee_id, action, comment, actor)
  select m.tenant_id, m.id, 'invited', null, auth.uid() from moved m;
  get diagnostics n = row_count;
  perform set_config('app.onboarding_transition', '', true);
  return n;
end $$;
revoke all on function public.start_onboarding_by_email(text[]) from public, anon;
grant execute on function public.start_onboarding_by_email(text[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. every minute, while anything is waiting: call the Edge Function
-- ---------------------------------------------------------------------------------------------
-- Uses the Vault secrets of the notification emails (project_url, notification_emails_cron_secret); the function
-- gets the same secret as CRON_SECRET. Skipped with a notice where pg_cron or pg_net is not available.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
    if exists (select 1 from cron.job where jobname = 'send-invites') then
      perform cron.unschedule('send-invites');
    end if;
    perform cron.schedule(
      'send-invites',
      '* * * * *',
      $c$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-invites',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notification_emails_cron_secret')),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      ) where exists (select 1 from vault.decrypted_secrets where name = 'project_url')
          and exists (select 1 from public.invite_queue where status in ('queued', 'sending'));
      $c$
    );
  else
    raise notice 'pg_cron or pg_net is not available on this project - invitations are not sent by the queue.';
  end if;
end $$;

notify pgrst, 'reload schema';
