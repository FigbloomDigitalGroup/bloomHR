-- Close a hole opened by channel_invites: being a member of a channel now makes a private channel visible, but the
-- channel_members policy let any login add ITSELF to ANY channel of its company, so anyone who learned a private
-- channel's id could join it and read it.
--
-- A login may now add itself only to a channel that is open to it (a public one, its own, or one for its job title);
-- adding someone else to a private channel goes through add_channel_members(), which checks the caller owns the channel.
-- Administrators keep full control. Direct messages stay closed to direct inserts.

-- Is this channel one the caller may join without being invited? (security definer: it must not go back through the
-- channel visibility rule, which itself reads channel_members)
create or replace function public.channel_open_to_me(p_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.channels c
    where c.id = p_channel
      and c.tenant_id = (select public.current_tenant_id())
      and c.type is distinct from 'dm'
      and (
        coalesce(c.is_private, false) = false
        or c.created_by = auth.uid()
        or c.job_title = (select public.current_job_title())
      )
  )
$$;

revoke all on function public.channel_open_to_me(uuid) from public, anon;
grant execute on function public.channel_open_to_me(uuid) to authenticated;

drop policy if exists own_membership on public.channel_members;
create policy own_membership on public.channel_members for all to authenticated
  using ((user_id = auth.uid() or (select public.current_user_role()) = 'ADMIN') and not public.is_dm_channel(channel_id))
  with check (
    not public.is_dm_channel(channel_id)
    and (
      (select public.current_user_role()) = 'ADMIN'
      or (user_id = auth.uid() and public.channel_open_to_me(channel_id))
    )
  );

notify pgrst, 'reload schema';
