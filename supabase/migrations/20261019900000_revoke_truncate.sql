-- Signed-in and signed-out users can no longer TRUNCATE tables.
--
-- The baseline grants ALL on nearly every public table to anon and authenticated (Supabase's default), and default
-- privileges give every new table the same. ALL includes TRUNCATE, which empties a whole table and ignores row-level
-- security. The API (PostgREST) has no way to send it, and the app never truncates anything, but the right should not
-- exist: this takes it away from anon and authenticated on every existing table, and from tables created from now on.
-- service_role and postgres keep it. Nothing else changes: SELECT/INSERT/UPDATE/DELETE stay governed by RLS as before.

revoke truncate on all tables in schema public from anon, authenticated;

do $$
begin
  alter default privileges for role postgres in schema public revoke truncate on tables from anon, authenticated;
exception when insufficient_privilege then
  raise notice 'could not change default privileges for postgres; existing tables were still fixed';
end $$;
