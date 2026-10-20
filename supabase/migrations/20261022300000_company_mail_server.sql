-- Each company sends email from its own mail server (cPanel or any SMTP), instead of one server-wide cPanel account.
--
-- Until now the "cPanel (SMTP)" choice in the Email Portal used one mailbox set up on the server (CPANEL_HOST /
-- CPANEL_USER / CPANEL_PASSWORD) that every company shared. Now a company's administrator enters its own mail server
-- under Settings > Company, and the server sends that company's email through it, from its own address. A company
-- without one keeps sending through Figbloom HR mail, as before.
--
--   company_mail_servers(tenant_id, host, port, secure, username, from_name, from_address, password_encrypted,
--                        enabled, last_test_ok, last_test_at, last_test_message, updated_by, updated_at)
--     one row per company. secure = true: SSL/TLS from the start (port 465); false: STARTTLS (port 587).
--     password_encrypted is encrypted by the backend (AES-256-GCM with MAIL_SERVER_ENCRYPTION_KEY, tied to the
--     company) before it is stored; the database never sees the password itself.
--
-- Written and read by the backend (service role) only, like sent_emails: no policy lets a signed-in user read or change
-- a row, so the browser can never read the password, even encrypted. The browser goes through /api/email/mail-server,
-- which never returns it (only whether one is set) and lets only the Settings permission change it.
--
-- sent_emails.provider may now also be 'own_server' (sent through the company's own mail server).
--
-- Written to run again safely.

create table if not exists public.company_mail_servers (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  host text not null,
  port integer not null default 465,
  secure boolean not null default true,
  username text not null,
  from_name text,
  from_address text not null,
  password_encrypted text,
  enabled boolean not null default false,
  last_test_ok boolean,
  last_test_at timestamptz,
  last_test_message text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- columns added after a first version of the table, if one exists
alter table public.company_mail_servers
  add column if not exists port integer not null default 465,
  add column if not exists secure boolean not null default true,
  add column if not exists from_name text,
  add column if not exists password_encrypted text,
  add column if not exists enabled boolean not null default false,
  add column if not exists last_test_ok boolean,
  add column if not exists last_test_at timestamptz,
  add column if not exists last_test_message text,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.company_mail_servers drop constraint if exists company_mail_servers_port_check;
alter table public.company_mail_servers add constraint company_mail_servers_port_check check (port between 1 and 65535);

alter table public.company_mail_servers enable row level security;

drop policy if exists tenant_isolation on public.company_mail_servers;
create policy tenant_isolation on public.company_mail_servers as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- no permissive policy for the API roles, so signed-in users see and change nothing here; only the service role
-- (which bypasses RLS) reads or writes these rows
revoke all on public.company_mail_servers from anon, authenticated;

-- sent_emails: record sends through a company's own mail server as such
do $$
declare c record;
begin
  for c in
    select con.conname from pg_constraint con
    where con.conrelid = 'public.sent_emails'::regclass and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%provider%'
  loop
    execute format('alter table public.sent_emails drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.sent_emails add constraint sent_emails_provider_check
  check (provider in ('resend', 'cpanel', 'smtp', 'own_server'));
