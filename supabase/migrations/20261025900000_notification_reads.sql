-- The admin bell: each person's own read and cleared notifications.
--
-- Until now one admin opening an HR alert set hr_notifications.is_read_admin, which hid it from every other admin, and
-- "Clear all" only emptied the panel in that browser (everything came back on the next load). Now:
--
--   hr_notification_reads        one row per person and notification they have read (read_at) or cleared (cleared_at:
--                                gone from their bell). Each person reads and writes only their own rows, and only for
--                                notifications they can see.
--   my_admin_notifications(n)    the signed-in person's bell: the newest n notifications they can see that they haven't
--                                cleared, each with is_read (theirs). As before it leaves out the daily company digest
--                                and the notifications already marked read for everyone (is_read_admin, before this).
--
-- is_read_admin is no longer set by the bell; the staff portal's is_read_staff (one employee's own) is unchanged.

create table if not exists public.hr_notification_reads (
  notification_id bigint not null references public.hr_notifications(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  read_at timestamptz not null default now(),
  cleared_at timestamptz,
  primary key (notification_id, user_id)
);
create index if not exists hr_notification_reads_user on public.hr_notification_reads (user_id, tenant_id);

alter table public.hr_notification_reads enable row level security;
drop policy if exists own_rows on public.hr_notification_reads;
create policy own_rows on public.hr_notification_reads for all to authenticated
  using (user_id = (select auth.uid()) and tenant_id = (select public.current_tenant_id()))
  with check (
    user_id = (select auth.uid()) and tenant_id = (select public.current_tenant_id())
    -- only a notification the person can see (hr_notifications' own policies apply here)
    and exists (select 1 from public.hr_notifications n where n.id = notification_id)
  );
grant select, insert, update, delete on public.hr_notification_reads to authenticated;

-- security invoker: hr_notifications' policies decide what the person sees
create or replace function public.my_admin_notifications(p_limit integer default 50)
returns table (
  id bigint, employee_number text, employee_name text, work_email text, notification_type text, title text,
  message text, end_date date, days_remaining integer, created_at timestamptz, is_read boolean
)
language sql stable security invoker set search_path = public as $$
  select n.id, n.employee_number, n.employee_name, n.work_email, n.notification_type, n.title, n.message, n.end_date,
         n.days_remaining, n.created_at, r.notification_id is not null
  from public.hr_notifications n
  left join public.hr_notification_reads r on r.notification_id = n.id and r.user_id = auth.uid()
  where n.is_read_admin = false
    and n.notification_type <> 'company_digest'
    and r.cleared_at is null
  order by n.created_at desc, n.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;
revoke all on function public.my_admin_notifications(integer) from public, anon;
grant execute on function public.my_admin_notifications(integer) to authenticated;
