-- hr_notification_reads (20261025900000) checked the company inside its own_rows policy but had no restrictive
-- tenant_isolation policy, which every company-owned table has (supabase/tests/tenant_isolation.test.ts). Same rule,
-- the standard wall.
drop policy if exists tenant_isolation on public.hr_notification_reads;
create policy tenant_isolation on public.hr_notification_reads as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

notify pgrst, 'reload schema';
