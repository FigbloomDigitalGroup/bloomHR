-- Company Events Table
-- Run this once in your Supabase SQL editor
-- Generic company events (town halls, trainings, anniversaries, etc.) shown on the
-- Company Calendar, kept separate from `holidays` since holidays also drive leave
-- day calculations in LeaveManagement and shouldn't be conflated with one-off events.

create table if not exists public.company_events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  date        date not null,
  description text,
  created_by  text,
  created_at  timestamptz not null default now()
);

-- Index for fast month-range lookups
create index if not exists company_events_date_idx on public.company_events (date);

-- Enable Row Level Security (same "authenticated users only" pattern as employees/leave_application)
alter table public.company_events enable row level security;

create policy "Enable all access for authenticated users" on public.company_events
  for all to authenticated using (true) with check (true);
