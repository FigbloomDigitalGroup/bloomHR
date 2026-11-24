-- "Invite admin" in the Figbloom console: Figbloom staff invite someone else as an administrator of a customer's HR
-- company (a Schools school, a Fleet company or a Property workspace with HR & Payroll on), for when the admin email the
-- customer gave is wrong or made up. Until now that took a row inserted by hand.
--
--   platform_invite_hr_admin(p_platform_tenant, p_email, p_actor, p_actor_email, p_name)
--       the HR company of that platform tenant (tenants.platform_tenant_id), and an ADMIN invitation queued for p_email
--       exactly as platform_enable_hr() queues the customer's admins (invite_queue: via_platform, no sender, sent by the
--       send-invites job). Answers one of:
--         queued            queued now (recorded in audit_log as console:<actor email>)
--         already_invited   an invitation to that address is waiting to be sent, or sent and still open (not
--                           accepted, revoked or expired): nothing is queued
--         already_member    that address already has a login in the company (member_role says as what): nothing queued
--         no_company        HR has no company for that platform tenant (HR & Payroll not on, or not linked yet)
--       The actor must be a platform admin whose console role approves companies (Owner, Admin), as the console's
--       Enable: the console backend checks first, this checks again. Server only (service_role).
--
-- Safe to run again.

create or replace function public.platform_invite_hr_admin(
  p_platform_tenant uuid, p_email text, p_actor uuid, p_actor_email text, p_name text default null)
returns table (outcome text, tenant_id uuid, tenant_name text, member_role text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  t public.tenants;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := nullif(left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 200), '');
  v_actor_email text := nullif(lower(btrim(coalesce(p_actor_email, ''))), '');
  v_role text;
  v_queue_id bigint;
begin
  if p_platform_tenant is null then
    raise exception 'The platform tenant is missing' using errcode = '22023';
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(v_email) > 254 then
    raise exception 'That is not a valid email address' using errcode = '22023';
  end if;
  if p_actor is null or v_actor_email is null
     or not exists (select 1 from public.platform_admins p
                    where p.user_id = p_actor and public.platform_role_allows(p.role, 'approve_companies')) then
    raise exception 'Only a platform owner or admin can invite a customer''s HR admin' using errcode = '42501';
  end if;

  select * into t from public.tenants x where x.platform_tenant_id = p_platform_tenant;
  if t.id is null then
    return query select 'no_company'::text, null::uuid, null::text, null::text;
    return;
  end if;

  -- one at a time per company and address, so a double click queues one invitation
  perform pg_advisory_xact_lock(hashtextextended('platform_invite_hr_admin:' || t.id::text || ':' || v_email, 0));

  select m.role into v_role
  from public.memberships m join auth.users u on u.id = m.user_id
  where m.tenant_id = t.id and lower(u.email) = v_email
  limit 1;
  if v_role is not null then
    return query select 'already_member'::text, t.id, t.name, v_role;
    return;
  end if;

  if exists (select 1 from public.invite_queue q
             where q.tenant_id = t.id and lower(q.email) = v_email and q.status in ('queued', 'sending'))
     or exists (select 1 from public.invitations i
                where i.tenant_id = t.id and lower(i.email) = v_email and i.status = 'pending' and i.expires_at > now()) then
    return query select 'already_invited'::text, t.id, t.name, null::text;
    return;
  end if;

  -- as platform_enable_hr(): an administrator, queued by the platform (no sender), sent by the send-invites job
  insert into public.invite_queue (tenant_id, batch_id, email, role, requested_by, via_platform)
  values (t.id, gen_random_uuid(), v_email, 'ADMIN', null, true)
  on conflict do nothing
  returning id into v_queue_id;
  if v_queue_id is null then
    return query select 'already_invited'::text, t.id, t.name, null::text;
    return;
  end if;

  -- who asked, in the company's audit trail (the platform records console actions as console:<email> the same way)
  insert into public.audit_log (tenant_id, record_id, record_key, table_name, action_type, old_data, new_data, performed_by)
  values (t.id, null, v_email, 'invite_queue', 'PLATFORM_INVITE_ADMIN', null,
          jsonb_build_object('email', v_email, 'name', v_name, 'role', 'ADMIN', 'queue_id', v_queue_id,
                             'platform_tenant_id', p_platform_tenant, 'actor', 'console:' || v_actor_email),
          p_actor);

  return query select 'queued'::text, t.id, t.name, null::text;
end $$;
revoke all on function public.platform_invite_hr_admin(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.platform_invite_hr_admin(uuid, text, uuid, text, text) to service_role;
