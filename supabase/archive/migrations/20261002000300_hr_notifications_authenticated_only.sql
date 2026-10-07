-- hr_notifications: the original "Admin full access" policy was created without a TO clause, so it
-- applied to the PUBLIC role (including anon) with USING (true). Since the tenant migration,
-- anonymous users are already denied by the restrictive tenant_isolation policy (they have no
-- tenant), but a policy that grants everyone access is one dropped guard away from an open table.
-- Make the grant explicit and limited to signed-in users.
--
-- (Intra-tenant narrowing - staff seeing only their own notifications - is a separate change.)

drop policy if exists "Admin full access" on public.hr_notifications;
drop policy if exists "Authenticated users full access" on public.hr_notifications;
create policy "Authenticated users full access" on public.hr_notifications
  for all to authenticated using (true) with check (true);

notify pgrst, 'reload schema';
