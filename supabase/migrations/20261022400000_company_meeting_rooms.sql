-- Video calls: private rooms per company. Written to run again safely.
--
-- The video call screen (VideoConf) used to open a room named after the date alone ("quick-red-team-12") on the
-- public Jitsi server: staff of every company using the app that week landed in the same room, and anyone who knew
-- the pattern could join. Now each company has a random secret, and the room a meeting code opens is a hash of the
-- secret and the code (src/lib/meetingRooms.ts). The same code opens a different room in each company.
--
--   company_meeting_secrets  one row per company: a 64-hex-character random secret. Nobody reads or writes the table
--                            directly; company_meeting_secret() returns the caller's own company's secret, making it on
--                            first use. Any signed-in member of an active company may have it (staff use video calls
--                            in the staff portal; admins, HR and managers on the Video calls screen).

create table if not exists public.company_meeting_secrets (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  secret text not null default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  created_at timestamptz not null default now()
);

-- in case the table was made before with weaker or missing secrets
alter table public.company_meeting_secrets add column if not exists secret text;
alter table public.company_meeting_secrets add column if not exists created_at timestamptz not null default now();
update public.company_meeting_secrets
   set secret = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
 where secret is null or length(secret) < 32;
alter table public.company_meeting_secrets
  alter column secret set default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
alter table public.company_meeting_secrets alter column secret set not null;
alter table public.company_meeting_secrets drop constraint if exists company_meeting_secrets_secret_check;
alter table public.company_meeting_secrets add constraint company_meeting_secrets_secret_check check (length(secret) >= 32);

-- every company has one from the start
insert into public.company_meeting_secrets (tenant_id)
select t.id from public.tenants t
on conflict (tenant_id) do nothing;

-- access: only through the function below
alter table public.company_meeting_secrets enable row level security;
drop policy if exists tenant_isolation on public.company_meeting_secrets;
create policy tenant_isolation on public.company_meeting_secrets as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
revoke all on public.company_meeting_secrets from anon, authenticated;
grant all on public.company_meeting_secrets to service_role;

create or replace function public.company_meeting_secret() returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_secret text;
begin
  if v_tenant is null then raise exception 'Sign in to a company to use video calls'; end if;
  insert into public.company_meeting_secrets (tenant_id) values (v_tenant) on conflict (tenant_id) do nothing;
  select s.secret into v_secret from public.company_meeting_secrets s where s.tenant_id = v_tenant;
  return v_secret;
end $$;

revoke all on function public.company_meeting_secret() from public, anon;
grant execute on function public.company_meeting_secret() to authenticated, service_role;
