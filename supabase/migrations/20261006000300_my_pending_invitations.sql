-- Invitations waiting for the signed-in person, so nobody has to go back to their email and paste a link.
--
--   my_pending_invitations()      the open invitations sent to the signed-in person's (confirmed) address
--   accept_my_invitation(id)      join one of them
--
-- The address must be CONFIRMED (auth.users.email_confirmed_at): otherwise anyone could register someone else's
-- address while "Confirm email" is off and claim the invitations sent to it. The invitation's id is only a handle;
-- what authorises joining is that the signed-in, confirmed address is the one that was invited.

create or replace function public.my_pending_invitations()
returns table (id uuid, company_name text, role text, expires_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, t.name, i.role, i.expires_at
  from public.invitations i
  join public.tenants t on t.id = i.tenant_id and t.status = 'active'
  join auth.users u on u.id = auth.uid()
  where u.email_confirmed_at is not null
    and lower(u.email) = lower(i.email)
    and i.status = 'pending'
    and i.expires_at > now()
  order by i.created_at desc
$$;

create or replace function public.accept_my_invitation(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invitations;
  v_email text;
  v_confirmed timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = auth.uid();
  if v_confirmed is null then
    raise exception 'Confirm your email address first' using errcode = '42501';
  end if;

  select i.* into v_inv
  from public.invitations i
  join public.tenants t on t.id = i.tenant_id and t.status = 'active'
  where i.id = p_id and i.status = 'pending' and i.expires_at > now() and lower(i.email) = v_email
  for update of i;
  if not found then
    raise exception 'This invitation is not valid any more' using errcode = '22023';
  end if;

  insert into public.memberships (user_id, tenant_id, role, account_status)
  values (auth.uid(), v_inv.tenant_id, v_inv.role, 'ACTIVE')
  on conflict (user_id, tenant_id) do update set role = excluded.role, account_status = 'ACTIVE';

  update public.user_profiles
    set tenant_id = v_inv.tenant_id, role = v_inv.role, account_status = 'ACTIVE'
    where user_id = auth.uid();

  update public.invitations
    set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
    where id = v_inv.id;

  return v_inv.tenant_id;
end;
$$;

revoke all on function public.my_pending_invitations() from public, anon;
revoke all on function public.accept_my_invitation(uuid) from public, anon;
grant execute on function public.my_pending_invitations() to authenticated;
grant execute on function public.accept_my_invitation(uuid) to authenticated;

notify pgrst, 'reload schema';
