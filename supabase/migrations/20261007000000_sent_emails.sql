-- A record of every email the server sends, per company.
--
-- The sent-mail log used to be read straight from the email provider's account, which every company shares, so an
-- admin in one company could read another company's termination and warning letters. The server now writes a row here
-- for each send and lists only the caller's company's rows; the provider is asked for details of one email only after
-- the server has checked that the email belongs to the caller's company.
--
--   sent_emails(tenant_id, provider, provider_id, purpose, sent_by, from_address, to_addresses, subject, created_at)
--
-- Written and read by the backend (service role) only; the browser goes through /api/email/logs.

create table if not exists public.sent_emails (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null check (provider in ('resend', 'cpanel', 'smtp')),
  provider_id text,
  purpose text not null,
  sent_by uuid references auth.users(id) on delete set null,
  from_address text,
  to_addresses text[] not null default '{}',
  subject text not null,
  created_at timestamptz not null default now()
);

create index if not exists sent_emails_tenant_created on public.sent_emails (tenant_id, created_at desc, id desc);

alter table public.sent_emails enable row level security;

drop policy if exists tenant_isolation on public.sent_emails;
create policy tenant_isolation on public.sent_emails as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- no permissive policy for the API roles, so signed-in users see and change nothing here; only the service role
-- (which bypasses RLS) reads or writes these rows
revoke all on public.sent_emails from anon;
