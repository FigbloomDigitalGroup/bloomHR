-- Direct messages for real. Until now a "direct message" was a placeholder kept in the sender's browser: it was never
-- saved or delivered, so nobody could receive one.
--
-- A direct message is a PRIVATE two-person channel (channels.type = 'dm') with exactly two members. It is created only
-- through start_direct_message(), and only the two members can see it or its messages. Not even a company
-- administrator can: the channel rules below that used to say "admins see every channel" now stop at direct messages.
--
--   company_members()              the logins of the company (who can be messaged)
--   start_direct_message(user)     find or create the conversation with a colleague; returns its id
--   my_direct_messages()           my conversations and who is on the other end

-- ---------------------------------------------------------------------------------------------
-- helper: is this channel a direct message? (security definer, so it answers even for a channel the caller cannot see)
-- ---------------------------------------------------------------------------------------------
create or replace function public.is_dm_channel(p_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists (select 1 from public.channels c where c.id = p_channel and c.type = 'dm') $$;

revoke all on function public.is_dm_channel(uuid) from public, anon;
grant execute on function public.is_dm_channel(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- channel rules: direct messages are visible to their two members only
-- ---------------------------------------------------------------------------------------------
drop policy if exists visible_channels on public.channels;
create policy visible_channels on public.channels for select to authenticated
  using (
    case
      when type = 'dm' then exists (select 1 from public.channel_members m where m.channel_id = channels.id and m.user_id = auth.uid())
      else coalesce(is_private, false) = false
           or created_by = auth.uid()
           or job_title = (select public.current_job_title())
           or (select public.current_user_role()) = 'ADMIN'
    end
  );

-- direct messages are created by start_direct_message() only
drop policy if exists create_channels on public.channels;
create policy create_channels on public.channels for insert to authenticated
  with check (created_by = auth.uid() and type is distinct from 'dm');

drop policy if exists manage_channels on public.channels;
create policy manage_channels on public.channels for update to authenticated
  using (type is distinct from 'dm' and (created_by = auth.uid() or (select public.current_user_role()) = 'ADMIN'))
  with check (type is distinct from 'dm' and (created_by = auth.uid() or (select public.current_user_role()) = 'ADMIN'));

drop policy if exists delete_channels on public.channels;
create policy delete_channels on public.channels for delete to authenticated
  using (type is distinct from 'dm' and (created_by = auth.uid() or (select public.current_user_role()) = 'ADMIN'));

-- ---------------------------------------------------------------------------------------------
-- membership rules: nobody adds themselves to (or removes people from) a direct message
-- ---------------------------------------------------------------------------------------------
drop policy if exists own_membership on public.channel_members;
create policy own_membership on public.channel_members for all to authenticated
  using ((user_id = auth.uid() or (select public.current_user_role()) = 'ADMIN') and not public.is_dm_channel(channel_id))
  with check ((user_id = auth.uid() or (select public.current_user_role()) = 'ADMIN') and not public.is_dm_channel(channel_id));

-- you can always see your own membership rows, direct messages included (the channel rule above relies on it)
drop policy if exists own_membership_read on public.channel_members;
create policy own_membership_read on public.channel_members for select to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------------------------
-- message rules: administrators moderate channels, not private conversations
-- ---------------------------------------------------------------------------------------------
drop policy if exists edit_messages on public.messages;
create policy edit_messages on public.messages for update to authenticated
  using (author_id = auth.uid() or ((select public.current_user_role()) = 'ADMIN' and not public.is_dm_channel(channel_id)))
  with check (author_id = auth.uid() or ((select public.current_user_role()) = 'ADMIN' and not public.is_dm_channel(channel_id)));

drop policy if exists delete_messages on public.messages;
create policy delete_messages on public.messages for delete to authenticated
  using (author_id = auth.uid() or ((select public.current_user_role()) = 'ADMIN' and not public.is_dm_channel(channel_id)));

-- ---------------------------------------------------------------------------------------------
-- what the chat calls
-- ---------------------------------------------------------------------------------------------
-- dropped first: a database that already has the later version (with avatar_url, 20261006000900) cannot have its
-- return type changed in place; 20261006000900 recreates that version
drop function if exists public.company_members();
create or replace function public.company_members()
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, u.email
  from public.memberships m
  join auth.users u on u.id = m.user_id
  where m.tenant_id = (select public.current_tenant_id())
    and m.account_status = 'ACTIVE'
$$;

create or replace function public.start_direct_message(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if v_tenant is null then
    raise exception 'You are not in a company' using errcode = '42501';
  end if;
  if p_other is null or p_other = v_me then
    raise exception 'Choose someone else to message' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.user_id = p_other and m.tenant_id = v_tenant and m.account_status = 'ACTIVE'
  ) then
    raise exception 'That person is not in your company' using errcode = '22023';
  end if;

  -- the conversation between exactly these two people, if there already is one
  select c.id into v_id
  from public.channels c
  where c.tenant_id = v_tenant and c.type = 'dm'
    and exists (select 1 from public.channel_members m where m.channel_id = c.id and m.user_id = v_me)
    and exists (select 1 from public.channel_members m where m.channel_id = c.id and m.user_id = p_other)
    and (select count(*) from public.channel_members m where m.channel_id = c.id) = 2
  limit 1;

  if v_id is null then
    insert into public.channels (tenant_id, name, type, is_private, created_by)
    values (v_tenant, 'dm', 'dm', true, v_me)
    returning id into v_id;
    insert into public.channel_members (channel_id, user_id, role)
    values (v_id, v_me, 'member'), (v_id, p_other, 'member');
  end if;

  return v_id;
end;
$$;

create or replace function public.my_direct_messages()
returns table (channel_id uuid, other_user_id uuid, other_email text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, o.user_id, u.email
  from public.channels c
  join public.channel_members me on me.channel_id = c.id and me.user_id = auth.uid()
  join public.channel_members o on o.channel_id = c.id and o.user_id <> auth.uid()
  join auth.users u on u.id = o.user_id
  where c.type = 'dm' and c.tenant_id = (select public.current_tenant_id())
$$;

revoke all on function public.company_members() from public, anon;
revoke all on function public.start_direct_message(uuid) from public, anon;
revoke all on function public.my_direct_messages() from public, anon;
grant execute on function public.company_members() to authenticated;
grant execute on function public.start_direct_message(uuid) to authenticated;
grant execute on function public.my_direct_messages() to authenticated;

notify pgrst, 'reload schema';
