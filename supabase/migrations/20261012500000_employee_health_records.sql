-- Employee onboarding, part 4 (FIG-765): health records. Health information is sensitive personal data (Kenya Data
-- Protection Act 2019), so:
--
--   * it is voluntary and never needed for onboarding; the employee first gives consent (employee_health_consents)
--     and can withdraw it, which deletes their health records;
--   * employee_health_records: a medical condition (diabetes, asthma...) or a disability / accommodation need, with
--     the medical institution and date; employee_health_files: supporting documents from medical institutions,
--     uploaded by the employee into their own folder of the private "documents" bucket (<company>/<login>/health/...);
--   * the employee sees and keeps their own; HR and administrators (the employees module) read them only through
--     health_records_for(), and every such read is logged in audit_log (VIEW);
--   * changes are logged without their contents, so the audit log never holds medical details.

create table if not exists public.employee_health_consents (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  given_at timestamptz not null default now(),
  given_by uuid default auth.uid() references auth.users(id) on delete set null
);

create table if not exists public.employee_health_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  kind text not null check (kind in ('condition', 'accommodation')),
  title text not null check (btrim(title) <> ''),
  details text,
  institution text,
  diagnosed_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists employee_health_records_employee_idx on public.employee_health_records (employee_id);

create table if not exists public.employee_health_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  record_id uuid not null references public.employee_health_records(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  content_type text,
  size_bytes bigint,
  uploaded_by uuid default auth.uid() references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now()
);
create index if not exists employee_health_files_record_idx on public.employee_health_files (record_id);

-- ---------------------------------------------------------------------------------------------
-- rules
-- ---------------------------------------------------------------------------------------------
-- a record needs the employee's consent; its files go in their own health folder
create or replace function public.employee_health_records_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not exists (select 1 from public.employee_health_consents c where c.employee_id = new.employee_id) then
    raise exception 'Give your consent before adding health information' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists employee_health_records_rules on public.employee_health_records;
create trigger employee_health_records_rules before insert or update on public.employee_health_records
  for each row execute function public.employee_health_records_rules();

create or replace function public.employee_health_files_rules() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null then
    if new.file_path not like (public.current_tenant_id())::text || '/' || (auth.uid())::text || '/health/%' then
      raise exception 'A health document must be uploaded to your own folder' using errcode = '42501';
    end if;
    new.uploaded_by := auth.uid();
    new.uploaded_at := now();
  end if;
  return new;
end $$;

drop trigger if exists employee_health_files_rules on public.employee_health_files;
create trigger employee_health_files_rules before insert or update on public.employee_health_files
  for each row execute function public.employee_health_files_rules();

-- ---------------------------------------------------------------------------------------------
-- access: the employee only (HR reads through health_records_for)
-- ---------------------------------------------------------------------------------------------
alter table public.employee_health_consents enable row level security;
drop policy if exists tenant_isolation on public.employee_health_consents;
create policy tenant_isolation on public.employee_health_consents as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists own_all on public.employee_health_consents;
create policy own_all on public.employee_health_consents for all to authenticated
  using (public.is_own_employee(employee_id)) with check (public.is_own_employee(employee_id));
revoke all on public.employee_health_consents from anon;

alter table public.employee_health_records enable row level security;
drop policy if exists tenant_isolation on public.employee_health_records;
create policy tenant_isolation on public.employee_health_records as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists own_all on public.employee_health_records;
create policy own_all on public.employee_health_records for all to authenticated
  using (public.is_own_employee(employee_id)) with check (public.is_own_employee(employee_id));
revoke all on public.employee_health_records from anon;

alter table public.employee_health_files enable row level security;
drop policy if exists tenant_isolation on public.employee_health_files;
create policy tenant_isolation on public.employee_health_files as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists own_all on public.employee_health_files;
create policy own_all on public.employee_health_files for all to authenticated
  using (exists (select 1 from public.employee_health_records r where r.id = record_id and public.is_own_employee(r.employee_id)))
  with check (exists (select 1 from public.employee_health_records r where r.id = record_id and public.is_own_employee(r.employee_id)));
revoke all on public.employee_health_files from anon;

-- withdrawing consent deletes everything (the app removes the files from storage first)
create or replace function public.employee_health_consents_withdrawn() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.employee_health_records where employee_id = old.employee_id;
  return old;
end $$;

drop trigger if exists employee_health_consents_withdrawn on public.employee_health_consents;
create trigger employee_health_consents_withdrawn after delete on public.employee_health_consents
  for each row execute function public.employee_health_consents_withdrawn();

-- ---------------------------------------------------------------------------------------------
-- HR reads them here, and every read is logged
-- ---------------------------------------------------------------------------------------------
create or replace function public.health_records_for(p_employee uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.employees := public.onboarding_record(p_employee, false);
  own boolean := e."Employee Number" is not distinct from public.current_employee_number();
begin
  if not own then
    insert into public.audit_log (tenant_id, record_id, record_key, table_name, action_type, performed_by)
    values (e.tenant_id, e.id, e."Employee Number", 'employee_health_records', 'VIEW', auth.uid());
  end if;
  return jsonb_build_object(
    'consent_given_at', (select c.given_at from public.employee_health_consents c where c.employee_id = e.id),
    'records', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'title', r.title, 'details', r.details, 'institution', r.institution,
        'diagnosed_on', r.diagnosed_on, 'created_at', r.created_at,
        'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'file_path', f.file_path, 'file_name', f.file_name)
                                             order by f.uploaded_at)
                           from public.employee_health_files f where f.record_id = r.id), '[]'::jsonb)
      ) order by r.created_at)
      from public.employee_health_records r where r.employee_id = e.id
    ), '[]'::jsonb)
  );
end $$;
revoke all on function public.health_records_for(uuid) from public, anon;
grant execute on function public.health_records_for(uuid) to authenticated;

-- HR opening one health document is logged too
create or replace function public.log_health_file_view(p_file uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  f record;
begin
  select hf.id, r.employee_id, r.tenant_id into f
  from public.employee_health_files hf join public.employee_health_records r on r.id = hf.record_id
  where hf.id = p_file and r.tenant_id = public.current_tenant_id();
  if f.id is null then
    raise exception 'Document not found' using errcode = 'P0002';
  end if;
  if not public.is_own_employee(f.employee_id) then
    if not public.has_module('employees') then
      raise exception 'Only HR can do this' using errcode = '42501';
    end if;
    insert into public.audit_log (tenant_id, record_id, table_name, action_type, performed_by)
    values (f.tenant_id, f.id, 'employee_health_files', 'VIEW', auth.uid());
  end if;
end $$;
revoke all on function public.log_health_file_view(uuid) from public, anon;
grant execute on function public.log_health_file_view(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- changes are logged without their contents
-- ---------------------------------------------------------------------------------------------
create or replace function public.audit_health_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  row_data jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_log (tenant_id, record_id, record_key, table_name, action_type, performed_by)
  values ((row_data ->> 'tenant_id')::uuid, coalesce((row_data ->> 'id')::uuid, (row_data ->> 'employee_id')::uuid),
          row_data ->> 'employee_id', tg_table_name, tg_op, auth.uid());
  return null;
end $$;

drop trigger if exists audit_employee_health_records on public.employee_health_records;
create trigger audit_employee_health_records after insert or update or delete on public.employee_health_records
  for each row execute function public.audit_health_change();
drop trigger if exists audit_employee_health_files on public.employee_health_files;
create trigger audit_employee_health_files after insert or update or delete on public.employee_health_files
  for each row execute function public.audit_health_change();
drop trigger if exists audit_employee_health_consents on public.employee_health_consents;
create trigger audit_employee_health_consents after insert or update or delete on public.employee_health_consents
  for each row execute function public.audit_health_change();

-- HR sees who looked at and changed health records (never their contents)
drop policy if exists employees_read on public.audit_log;
create policy employees_read on public.audit_log for select to authenticated
  using (table_name in ('employees', 'emergency_contact', 'next_of_kin', 'employee_documents', 'employee_referees',
                        'employee_document_requirements', 'employee_health_records', 'employee_health_files',
                        'employee_health_consents')
         and public.has_module('employees'));

notify pgrst, 'reload schema';
