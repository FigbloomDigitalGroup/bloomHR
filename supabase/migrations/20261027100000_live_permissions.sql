-- A role change reaches the people in it without a refresh.
--
-- The app read the signed-in person's permissions once, when the page opened: someone given "Manage projects" on
-- their role only saw the New project button after reloading. The app now listens for changes (livePermissions.ts) to
-- role_permissions (modules ticked per role), company_roles (a company's own roles) and user_profiles (the person
-- moved to another role) and reloads the permissions when one comes in.
--
-- Realtime only sends a change to someone whose read policies let them see the row, and these three are already
-- readable within the company only (tenant_isolation, user_profiles_tenant_read); the app asks for its own profile
-- row alone. Nothing about who can read what changes here.
--
-- Written to run again safely.

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['role_permissions', 'company_roles', 'user_profiles'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
