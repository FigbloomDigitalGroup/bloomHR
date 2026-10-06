-- Inviting people to a channel.
--
--   add_channel_members(channel, users[])   the channel's creator (or an administrator) adds colleagues; returns how many
--                                           were added. Only active members of the same company, never to a direct message.
--
-- A private channel is now also visible to the people who were added to it (before: only its creator, the people with
-- its job title, and administrators), and because messages follow channel visibility, they can read and write in it.

drop policy if exists visible_channels on public.channels;
create policy visible_channels on public.channels for select to authenticated
  using (
    case
      when type = 'dm' then exists (select 1 from public.channel_members m where m.channel_id = channels.id and m.user_id = auth.uid())
      else coalesce(is_private, false) = false
           or created_by = auth.uid()
           or job_title = (select public.current_job_title())
           or (select public.current_user_role()) = 'ADMIN'
           or exists (select 1 from public.channel_members m where m.channel_id = channels.id and m.user_id = auth.uid())
    end
  );

create or replace function public.add_channel_members(p_channel uuid, p_users uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_added integer;
begin
  if v_me is null or v_tenant is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.channels c
    where c.id = p_channel
      and c.tenant_id = v_tenant
      and c.type is distinct from 'dm'
      and (c.created_by = v_me or public.current_user_role() = 'ADMIN')
  ) then
    raise exception 'You cannot add people to this channel' using errcode = '42501';
  end if;

  with wanted as (
    select distinct u
    from unnest(coalesce(p_users, '{}'::uuid[])) as u
    where exists (
      select 1 from public.memberships m
      where m.user_id = u and m.tenant_id = v_tenant and m.account_status = 'ACTIVE'
    )
    and not exists (select 1 from public.channel_members x where x.channel_id = p_channel and x.user_id = u)
  ), ins as (
    insert into public.channel_members (channel_id, user_id, role)
    select p_channel, u, 'member' from wanted
    returning 1
  )
  select count(*) into v_added from ins;

  return v_added;
end;
$$;

revoke all on function public.add_channel_members(uuid, uuid[]) from public, anon;
grant execute on function public.add_channel_members(uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
