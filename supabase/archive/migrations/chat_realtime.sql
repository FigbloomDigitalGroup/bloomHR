-- Enable Realtime for Chat
-- Run this once in your Supabase SQL editor
--
-- Verified empirically (a real subscribe-then-insert test against the live
-- project): the Supabase client successfully subscribes to `messages`
-- postgres_changes (status: SUBSCRIBED), but no event was ever delivered
-- for a real INSERT. Root cause: the table was never added to Postgres's
-- `supabase_realtime` publication, which is what actually makes Supabase
-- ship row changes over the realtime websocket - the client-side
-- subscription code (Chat.tsx, chatServices.ts, LeaveManagement.tsx's own
-- leave_application subscription, etc.) can be perfectly correct and still
-- receive nothing if the table itself was never enabled here.
--
-- Without this, chat is not live: a message only appears for someone else
-- once they refresh or re-open the channel, not immediately like
-- Slack/WhatsApp.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'channels'
  ) then
    alter publication supabase_realtime add table public.channels;
  end if;
end $$;
