-- Chat at company scale (FIG-817): every company has a "general" channel, so one message reached every connected
-- user, and each of them then counted the unread messages of every one of their channels with one query per channel,
-- each a scan of the company's messages (messages had no index on channel_id). With thousands of people online that
-- is thousands of times (channels x people) per message.
--   * indexes for the chat's read paths: a channel's messages by time (loading a channel, its latest message, unread
--     counts), and channel membership both ways (the channel visibility rule and my_direct_messages() look it up).
--   * my_unread_counts(): every channel I can see with its unread count, in one query. The browser calls it once when
--     the chat opens and then keeps the counts up to date from the realtime messages themselves.
-- Unread = messages after my last_read_at in user_channel_states (a channel I never opened: all of them), not counting
-- my own. A count stops at 100: the badges show "99+" past 99, so counting further is work nobody sees.

create index if not exists messages_channel_created_idx on public.messages (channel_id, created_at);
create index if not exists channel_members_channel_user_idx on public.channel_members (channel_id, user_id);
create index if not exists channel_members_user_idx on public.channel_members (user_id, channel_id);

-- security invoker: the channel and message rules decide what I can see, exactly as when the browser reads them
create or replace function public.my_unread_counts()
returns table (channel_id uuid, unread integer)
language sql
stable
security invoker
set search_path = public
as $$
  select c.id,
         (select count(*)::integer from (
            select 1
            from public.messages m
            where m.channel_id = c.id
              and m.created_at > coalesce(s.last_read_at, '-infinity'::timestamptz)
              and m.author_id is distinct from (select auth.uid())
            limit 100
          ) unread)
  from public.channels c
  left join public.user_channel_states s on s.channel_id = c.id and s.user_id = (select auth.uid())
  where c.tenant_id = (select public.current_tenant_id())
$$;

revoke all on function public.my_unread_counts() from public, anon;
grant execute on function public.my_unread_counts() to authenticated;

notify pgrst, 'reload schema';
