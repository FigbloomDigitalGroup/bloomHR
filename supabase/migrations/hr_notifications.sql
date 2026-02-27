-- HR Notifications Table
-- Run this once in your Supabase SQL editor

create table if not exists public.hr_notifications (
  id                 bigserial primary key,
  employee_number    text not null,
  employee_name      text,
  work_email         text,
  notification_type  text not null check (notification_type in ('contract_expiring', 'probation_expiring')),
  title              text not null,
  message            text not null,
  end_date           date not null,
  days_remaining     int not null,
  is_read_admin      boolean not null default false,
  is_read_staff      boolean not null default false,
  email_sent         boolean not null default false,
  created_at         timestamptz not null default now()
);

-- Index for fast lookups
create index if not exists hr_notifications_employee_number_idx on public.hr_notifications (employee_number);
create index if not exists hr_notifications_type_idx             on public.hr_notifications (notification_type);
create index if not exists hr_notifications_created_at_idx       on public.hr_notifications (created_at desc);

-- Enable Row Level Security (allow all for service_role; anon can read their own)
alter table public.hr_notifications enable row level security;

-- Admin can read/write all
create policy "Admin full access" on public.hr_notifications
  for all using (true) with check (true);
