-- Chat RLS Fix
-- Run this once in your Supabase SQL editor
--
-- Realtime was confirmed enabled (toggled on in the Dashboard, verified via
-- pg_publication_tables), and a properly authenticated test client
-- successfully subscribed (status: SUBSCRIBED) - but a real INSERT still
-- never delivered an event. Supabase Realtime enforces each subscriber's
-- Row Level Security as if it were doing a SELECT, so if `messages`'s
-- existing RLS policy doesn't grant broad SELECT to `authenticated`, the
-- publication/toggle being correct doesn't matter - the row gets filtered
-- out before it's ever sent to the client.
--
-- This adds an ADDITIONAL permissive policy rather than touching whatever
-- policy is already there (multiple permissive policies for the same
-- command are OR'd together in Postgres, so this can only grant access,
-- never take any away) - matches the same "authenticated users, full
-- access" pattern already used everywhere else in this codebase
-- (master_schema.sql's global policy loop, company_events.sql,
-- hr_notifications.sql, etc.).

alter table public.messages enable row level security;
alter table public.channels enable row level security;

drop policy if exists "Enable all access for authenticated users" on public.messages;
create policy "Enable all access for authenticated users" on public.messages
  for all to authenticated using (true) with check (true);

drop policy if exists "Enable all access for authenticated users" on public.channels;
create policy "Enable all access for authenticated users" on public.channels
  for all to authenticated using (true) with check (true);

-- REFRESH API
NOTIFY pgrst, 'reload schema';
