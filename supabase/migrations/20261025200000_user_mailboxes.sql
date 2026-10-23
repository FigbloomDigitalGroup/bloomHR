-- The in-app mailbox, reading (FIG-1205, PR 1 of 3): each person connects their own mailbox (e.g. mary@company.com on
-- the company's cPanel) and reads it inside the platform.
--
--   user_mailboxes(user_id, tenant_id, email, imap_host, imap_port, secure, username, password_encrypted,
--                  smtp_host, smtp_port, connected_at, last_ok_at, last_error, updated_at)
--     one row per person per company (a login in two companies can connect a mailbox in each).
--     imap_port 993 = SSL/TLS from the start (secure = true); 143 = STARTTLS, required (secure = false).
--     smtp_host / smtp_port are kept now for sending (PR 2); nothing uses them yet.
--     password_encrypted is encrypted by the backend (AES-256-GCM with MAIL_SERVER_ENCRYPTION_KEY) with the person's
--     user id and company id both bound in, so a stored password cannot be copied onto another person's row, or
--     another company's, and used there. The database never sees the password itself.
--
-- Who can use a row: only its owner, and only through the backend (/api/mailbox, mailbox_routes.js), which finds the
-- row by the signed-in person's own user id and company; it never takes a user id from the request.
--   * writes (connect, change, disconnect): the backend only (service role). No signed-in user, not even the
--     administrator, can insert, change or delete a row directly.
--   * reads: the owner may read their own row's other columns directly (RLS user_id = auth.uid(), inside their
--     current company); password_encrypted is not granted to any API role at all, so not even the owner can read it,
--     encrypted or not. Nobody else, administrators included, sees any row.
-- No mail is stored: every request fetches it fresh from the mail server.
--
-- The "My mailbox" module (mailbox): off by default (no role is given it here); a company ticks it for the roles that
-- should have it under Settings > Roles. Administrators always have every module.
--
-- Written to run again safely.

create table if not exists public.user_mailboxes (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null,
  imap_host text not null,
  imap_port integer not null default 993,
  secure boolean not null default true,
  username text not null,
  password_encrypted text not null,
  smtp_host text,
  smtp_port integer,
  connected_at timestamptz not null default now(),
  last_ok_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

alter table public.user_mailboxes drop constraint if exists user_mailboxes_imap_port_check;
alter table public.user_mailboxes add constraint user_mailboxes_imap_port_check
  check ((imap_port = 993 and secure) or (imap_port = 143 and not secure));
alter table public.user_mailboxes drop constraint if exists user_mailboxes_smtp_port_check;
alter table public.user_mailboxes add constraint user_mailboxes_smtp_port_check
  check (smtp_port is null or smtp_port in (25, 465, 587, 2525));

create index if not exists user_mailboxes_tenant_idx on public.user_mailboxes (tenant_id);

alter table public.user_mailboxes enable row level security;

drop policy if exists tenant_isolation on public.user_mailboxes;
create policy tenant_isolation on public.user_mailboxes as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

drop policy if exists owner_reads on public.user_mailboxes;
create policy owner_reads on public.user_mailboxes for select to authenticated
  using (user_id = (select auth.uid()));

-- the API roles get no table rights (no writes, no password column); the owner's read is limited to these columns
revoke all on public.user_mailboxes from anon, authenticated;
grant select (user_id, tenant_id, email, imap_host, imap_port, secure, username, smtp_host, smtp_port,
              connected_at, last_ok_at, last_error, updated_at)
  on public.user_mailboxes to authenticated;

-- the module, given to no role (off until a company ticks it)
do $$
begin
  perform public.seed_module_once('mailbox', 'My mailbox',
    'Connect their own email account and read it inside the app', 'workspace', array[]::text[]);
end $$;
