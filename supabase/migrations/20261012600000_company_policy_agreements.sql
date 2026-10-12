-- Employee onboarding, part 5 (FIG-765): company agreements and policies, each accepted with its own checkbox.
--
--   company_policies          a policy or agreement (code of conduct, data protection...), required or not, active
--   company_policy_versions   its published wording: text and/or a file; a published version never changes, a new
--                             version is published instead (employees then accept again). content_hash fingerprints
--                             exactly what was published.
--   policy_acceptances        the checkbox, as the employee's signature: who, which version (and its fingerprint),
--                             when, and the browser it came from. Recorded only by accept_policy(); never changed.
--
-- Every active required policy's latest version must be accepted before the employee can submit their onboarding.
-- Policy files go in the private "documents" bucket under <company>/<HR login>/policies/, which every employee of the
-- company may open (20261012600100 for storage).

create table if not exists public.company_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  required boolean not null default true,
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.company_policy_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  policy_id uuid not null references public.company_policies(id) on delete cascade,
  version integer not null,
  body text,
  file_path text,
  file_name text,
  content_hash text not null,
  published_by uuid default auth.uid() references auth.users(id) on delete set null,
  published_at timestamptz not null default now(),
  unique (policy_id, version),
  check (coalesce(btrim(body), '') <> '' or file_path is not null)
);

create table if not exists public.policy_acceptances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  version_id uuid not null references public.company_policy_versions(id) on delete restrict,
  content_hash text not null,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz not null default now(),
  user_agent text,
  unique (employee_id, version_id)
);

-- the published wording is fixed: number and fingerprint it; it can't be edited afterwards
create or replace function public.company_policy_versions_publish() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'A published policy can''t be changed; publish a new version' using errcode = '42501';
  end if;
  new.version := coalesce((select max(v.version) from public.company_policy_versions v where v.policy_id = new.policy_id), 0) + 1;
  new.content_hash := encode(sha256(convert_to(coalesce(new.body, '') || E'\n' || coalesce(new.file_path, ''), 'UTF8')), 'hex');
  new.published_at := now();
  if auth.uid() is not null then
    new.published_by := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists company_policy_versions_publish on public.company_policy_versions;
create trigger company_policy_versions_publish before insert or update on public.company_policy_versions
  for each row execute function public.company_policy_versions_publish();

-- ---------------------------------------------------------------------------------------------
-- access: HR writes policies; every employee of the company reads them; acceptances only through accept_policy
-- ---------------------------------------------------------------------------------------------
alter table public.company_policies enable row level security;
drop policy if exists tenant_isolation on public.company_policies;
create policy tenant_isolation on public.company_policies as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists read_company on public.company_policies;
create policy read_company on public.company_policies for select to authenticated using (true);
drop policy if exists hr_write on public.company_policies;
create policy hr_write on public.company_policies for all to authenticated
  using (public.has_module('employees')) with check (public.has_module('employees'));
revoke all on public.company_policies from anon;

alter table public.company_policy_versions enable row level security;
drop policy if exists tenant_isolation on public.company_policy_versions;
create policy tenant_isolation on public.company_policy_versions as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists read_company on public.company_policy_versions;
create policy read_company on public.company_policy_versions for select to authenticated using (true);
drop policy if exists hr_publish on public.company_policy_versions;
create policy hr_publish on public.company_policy_versions for insert to authenticated with check (public.has_module('employees'));
revoke all on public.company_policy_versions from anon;

alter table public.policy_acceptances enable row level security;
drop policy if exists tenant_isolation on public.policy_acceptances;
create policy tenant_isolation on public.policy_acceptances as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists hr_read on public.policy_acceptances;
create policy hr_read on public.policy_acceptances for select to authenticated using (public.has_module('employees'));
drop policy if exists own_read on public.policy_acceptances;
create policy own_read on public.policy_acceptances for select to authenticated using (public.is_own_employee(employee_id));
revoke all on public.policy_acceptances from anon;

-- the employee's checkbox: accepts the given version of a policy for their own record
create or replace function public.accept_policy(p_version uuid, p_user_agent text default null) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  e public.employees := public.onboarding_record(null, false);
  v public.company_policy_versions;
  accepted timestamptz;
begin
  select * into v from public.company_policy_versions where id = p_version and tenant_id = e.tenant_id;
  if v.id is null then
    raise exception 'Policy not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.company_policy_versions n where n.policy_id = v.policy_id and n.version > v.version) then
    raise exception 'This policy has a newer version; read and accept that one' using errcode = '23514';
  end if;
  insert into public.policy_acceptances (tenant_id, employee_id, version_id, content_hash, accepted_by, user_agent)
  values (e.tenant_id, e.id, v.id, v.content_hash, auth.uid(), left(p_user_agent, 500))
  on conflict (employee_id, version_id) do nothing;
  select a.accepted_at into accepted from public.policy_acceptances a where a.employee_id = e.id and a.version_id = v.id;
  return accepted;
end $$;
revoke all on function public.accept_policy(uuid, text) from public, anon;
grant execute on function public.accept_policy(uuid, text) to authenticated;

-- every active policy with its latest version and whether this employee accepted it (no id: the caller's own)
create or replace function public.policy_checklist(p_employee uuid default null)
returns table (policy_id uuid, title text, required boolean, version_id uuid, version integer, body text, file_path text,
               file_name text, published_at timestamptz, accepted_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  e public.employees := public.onboarding_record(p_employee, false);
begin
  return query
  select p.id, p.title, p.required, v.id, v.version, v.body, v.file_path, v.file_name, v.published_at, a.accepted_at
  from public.company_policies p
  join lateral (select * from public.company_policy_versions x where x.policy_id = p.id order by x.version desc limit 1) v on true
  left join public.policy_acceptances a on a.version_id = v.id and a.employee_id = e.id
  where p.tenant_id = e.tenant_id and p.active
  order by p.required desc, p.title;
end $$;
revoke all on function public.policy_checklist(uuid) from public, anon;
grant execute on function public.policy_checklist(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- onboarding: every required policy accepted before submitting
-- ---------------------------------------------------------------------------------------------
create or replace function public.onboarding_missing_agreements(e public.employees) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg('Agreement: ' || p.title order by p.title), '{}')
  from public.company_policies p
  join lateral (select x.id from public.company_policy_versions x where x.policy_id = p.id order by x.version desc limit 1) v on true
  where p.tenant_id = e.tenant_id and p.active and p.required
    and not exists (select 1 from public.policy_acceptances a where a.version_id = v.id and a.employee_id = e.id)
$$;
revoke all on function public.onboarding_missing_agreements(public.employees) from public, anon, authenticated;

-- the details and documents part stays as it was; onboarding_missing adds agreements
alter function public.onboarding_missing(public.employees, text) rename to onboarding_missing_without_agreements;

create or replace function public.onboarding_missing(e public.employees, p_part text default 'all') returns text[]
language sql stable security definer set search_path = public as $$
  select public.onboarding_missing_without_agreements(e, p_part)
         || case when p_part in ('employee', 'all') then public.onboarding_missing_agreements(e) else '{}'::text[] end
$$;
revoke all on function public.onboarding_missing(public.employees, text) from public, anon;
grant execute on function public.onboarding_missing(public.employees, text) to authenticated, service_role;
revoke all on function public.onboarding_missing_without_agreements(public.employees, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- audit
-- ---------------------------------------------------------------------------------------------
drop trigger if exists audit_company_policies on public.company_policies;
create trigger audit_company_policies after insert or update or delete on public.company_policies
  for each row execute function public.audit_row_change();
drop trigger if exists audit_company_policy_versions on public.company_policy_versions;
create trigger audit_company_policy_versions after insert on public.company_policy_versions
  for each row execute function public.audit_row_change();
drop trigger if exists audit_policy_acceptances on public.policy_acceptances;
create trigger audit_policy_acceptances after insert on public.policy_acceptances
  for each row execute function public.audit_row_change();

drop policy if exists employees_read on public.audit_log;
create policy employees_read on public.audit_log for select to authenticated
  using (table_name in ('employees', 'emergency_contact', 'next_of_kin', 'employee_documents', 'employee_referees',
                        'employee_document_requirements', 'employee_health_records', 'employee_health_files',
                        'employee_health_consents', 'company_policies', 'company_policy_versions', 'policy_acceptances')
         and public.has_module('employees'));

notify pgrst, 'reload schema';
