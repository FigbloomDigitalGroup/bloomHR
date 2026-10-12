-- Employee onboarding, part 3 (FIG-765): documents and referees.
--
--   document_types                 every kind of document onboarding asks for, by section: core attachments,
--                                  qualifications, role-specific, and the ones a tax claim needs (PWD exemption
--                                  certificate, mortgage interest, insurance). Some allow several files.
--   company_document_settings      a company's own "required" switch per document type (else the type's default)
--   employee_document_requirements role-specific documents HR asks of one employee (driving licence for a driver...)
--   employee_documents             the files: uploaded by the employee only, into their own folder in the private
--                                  "documents" bucket; HR accepts or rejects each (a rejection needs a reason)
--   employee_referees              as many referees as the employee gives; at least one is needed
--
-- What is required: the company's (or default) required types, the role-specific ones HR asked for, and the claim
-- documents when the employee claims PWD exemption, mortgage interest or insurance relief. The employee can't
-- submit until each has a file that was not rejected; HR can't approve until each has an accepted file.
-- Files already uploaded on the staff portal's Documents tab become documents here (waiting for HR).

-- ---------------------------------------------------------------------------------------------
-- document types
-- ---------------------------------------------------------------------------------------------
create table if not exists public.document_types (
  code text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
  label text not null,
  section text not null check (section in ('core', 'qualifications', 'role', 'claims')),
  description text,
  allows_many boolean not null default false,
  required_by_default boolean not null default false,
  -- claim documents are required only while the claim is made
  required_when text check (required_when in ('pwd', 'mortgage', 'insurance')),
  sort integer not null default 0
);

alter table public.document_types enable row level security;
drop policy if exists read_all on public.document_types;
create policy read_all on public.document_types for select to authenticated using (true);
revoke all on public.document_types from anon;

insert into public.document_types (code, label, section, description, allows_many, required_by_default, required_when, sort) values
  ('id_document', 'Proof of identity', 'core', 'A clear copy of your national ID (both sides) or passport bio page', true, true, null, 10),
  ('passport_photo', 'Passport-size photograph', 'core', 'A recent passport-size photo', false, true, null, 20),
  ('kra_pin_certificate', 'KRA PIN certificate', 'core', null, false, true, null, 30),
  ('nssf_document', 'NSSF details', 'core', 'Your NSSF card or a statement showing your NSSF number', false, true, null, 40),
  ('sha_membership', 'SHA membership', 'core', 'Your SHA membership document (PDF)', false, true, null, 50),
  ('helb_certificate', 'HELB compliance certificate', 'core', null, false, true, null, 60),
  ('cv', 'Updated CV', 'qualifications', null, false, true, null, 110),
  ('academic_certificate', 'Academic certificates', 'qualifications', 'Degree, diploma, KCSE and other certificates', true, true, null, 120),
  ('professional_certificate', 'Professional certificates', 'qualifications', null, true, false, null, 130),
  ('professional_membership', 'Professional membership or practising licence', 'qualifications', null, true, false, null, 140),
  ('employment_evidence', 'Previous employment evidence', 'qualifications', 'Certificates of service, recommendation letters', true, false, null, 150),
  ('driving_licence', 'Driving licence', 'role', null, false, false, null, 210),
  ('police_clearance', 'Police clearance certificate', 'role', 'Certificate of good conduct', false, false, null, 220),
  ('medical_fitness', 'Medical fitness certificate', 'role', null, false, false, null, 230),
  ('dependants_documents', 'Dependants’ documents', 'role', 'Birth certificates, marriage certificate', true, false, null, 240),
  ('beneficiary_documents', 'Beneficiary documents', 'role', 'Nomination of beneficiaries', true, false, null, 250),
  ('pwd_certificate', 'KRA PWD exemption certificate', 'claims', 'Needed while you claim the disability tax exemption', false, false, 'pwd', 310),
  ('mortgage_document', 'Mortgage interest statement', 'claims', 'From your lender, for the mortgage interest you claim', false, false, 'mortgage', 320),
  ('insurance_document', 'Insurance policy', 'claims', 'For the life or health insurance premiums you claim', true, false, 'insurance', 330)
on conflict (code) do update set label = excluded.label, section = excluded.section, description = excluded.description,
  allows_many = excluded.allows_many, required_by_default = excluded.required_by_default,
  required_when = excluded.required_when, sort = excluded.sort;

-- ---------------------------------------------------------------------------------------------
-- what a company and HR require
-- ---------------------------------------------------------------------------------------------
create table if not exists public.company_document_settings (
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  code text not null references public.document_types(code) on delete cascade,
  required boolean not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, code)
);

create table if not exists public.employee_document_requirements (
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  code text not null references public.document_types(code) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (employee_id, code)
);

-- the employee whose record this is (the signed-in login's own employee row in this company)
create or replace function public.is_own_employee(p_employee uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.employees e
    where e.id = p_employee and e.tenant_id = public.current_tenant_id()
      and e."Employee Number" = public.current_employee_number()
  )
$$;
revoke all on function public.is_own_employee(uuid) from public, anon;
grant execute on function public.is_own_employee(uuid) to authenticated;

alter table public.company_document_settings enable row level security;
drop policy if exists tenant_isolation on public.company_document_settings;
create policy tenant_isolation on public.company_document_settings as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists read_company on public.company_document_settings;
create policy read_company on public.company_document_settings for select to authenticated using (true);
drop policy if exists hr_write on public.company_document_settings;
create policy hr_write on public.company_document_settings for all to authenticated
  using (public.has_module('employees')) with check (public.has_module('employees'));
revoke all on public.company_document_settings from anon;

alter table public.employee_document_requirements enable row level security;
drop policy if exists tenant_isolation on public.employee_document_requirements;
create policy tenant_isolation on public.employee_document_requirements as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists hr_all on public.employee_document_requirements;
create policy hr_all on public.employee_document_requirements for all to authenticated
  using (public.has_module('employees')) with check (public.has_module('employees'));
drop policy if exists own_read on public.employee_document_requirements;
create policy own_read on public.employee_document_requirements for select to authenticated
  using (public.is_own_employee(employee_id));
revoke all on public.employee_document_requirements from anon;

-- ---------------------------------------------------------------------------------------------
-- the files
-- ---------------------------------------------------------------------------------------------
create table if not exists public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  code text not null references public.document_types(code),
  file_path text not null,          -- in the "documents" bucket: <company>/<uploader's login>/...
  file_name text not null,
  content_type text,
  size_bytes bigint,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  review_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  uploaded_by uuid default auth.uid() references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now()
);
create index if not exists employee_documents_employee_idx on public.employee_documents (employee_id, code);

-- a new file always waits for HR, belongs to the uploader's own folder, and is never pre-reviewed
create or replace function public.employee_documents_rules() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      if new.file_path not like (public.current_tenant_id())::text || '/' || (auth.uid())::text || '/%' then
        raise exception 'A document must be uploaded to your own folder' using errcode = '42501';
      end if;
      new.status := 'pending';
      new.review_note := null;
      new.reviewed_by := null;
      new.reviewed_at := null;
      new.uploaded_by := auth.uid();
      new.uploaded_at := now();
    end if;
    return new;
  end if;
  -- only review_employee_document changes a file's review, and nothing else about it changes
  if auth.uid() is not null and coalesce(current_setting('app.document_review', true), '') <> 'on' then
    raise exception 'Documents are reviewed with Accept or Reject' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists employee_documents_rules on public.employee_documents;
create trigger employee_documents_rules before insert or update on public.employee_documents
  for each row execute function public.employee_documents_rules();

alter table public.employee_documents enable row level security;
drop policy if exists tenant_isolation on public.employee_documents;
create policy tenant_isolation on public.employee_documents as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
-- HR sees everyone's (the same people storage lets open the files)
drop policy if exists hr_read on public.employee_documents;
create policy hr_read on public.employee_documents for select to authenticated
  using (public.has_any_module('employees', 'hr-lifecycle'));
-- the employee uploads, sees and removes their own; an accepted file stays
drop policy if exists own_read on public.employee_documents;
create policy own_read on public.employee_documents for select to authenticated using (public.is_own_employee(employee_id));
drop policy if exists own_insert on public.employee_documents;
create policy own_insert on public.employee_documents for insert to authenticated with check (public.is_own_employee(employee_id));
drop policy if exists own_delete on public.employee_documents;
create policy own_delete on public.employee_documents for delete to authenticated
  using (public.is_own_employee(employee_id) and status <> 'accepted');
revoke all on public.employee_documents from anon;

create or replace function public.review_employee_document(p_document uuid, p_decision text, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  d public.employee_documents;
  note text := nullif(btrim(p_note), '');
begin
  if not public.has_module('employees') then
    raise exception 'Only HR can do this' using errcode = '42501';
  end if;
  select * into d from public.employee_documents where id = p_document and tenant_id = public.current_tenant_id();
  if d.id is null then
    raise exception 'Document not found' using errcode = 'P0002';
  end if;
  if p_decision not in ('accept', 'reject') then
    raise exception 'Decision must be accept or reject';
  end if;
  if p_decision = 'reject' and note is null then
    raise exception 'Say why the document is rejected' using errcode = '23514';
  end if;
  perform set_config('app.document_review', 'on', true);
  update public.employee_documents set
    status = case p_decision when 'accept' then 'accepted' else 'rejected' end,
    review_note = note, reviewed_by = auth.uid(), reviewed_at = now()
  where id = d.id;
  perform set_config('app.document_review', '', true);
  return case p_decision when 'accept' then 'accepted' else 'rejected' end;
end $$;
revoke all on function public.review_employee_document(uuid, text, text) from public, anon;
grant execute on function public.review_employee_document(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- referees
-- ---------------------------------------------------------------------------------------------
create table if not exists public.employee_referees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  full_name text not null check (btrim(full_name) <> ''),
  organisation text,
  position text,
  phone text,
  email text,
  relationship text,
  created_at timestamptz not null default now(),
  check (coalesce(btrim(phone), '') <> '' or coalesce(btrim(email), '') <> '')
);
create index if not exists employee_referees_employee_idx on public.employee_referees (employee_id);

alter table public.employee_referees enable row level security;
drop policy if exists tenant_isolation on public.employee_referees;
create policy tenant_isolation on public.employee_referees as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists hr_read on public.employee_referees;
create policy hr_read on public.employee_referees for select to authenticated using (public.has_module('employees'));
drop policy if exists own_all on public.employee_referees;
create policy own_all on public.employee_referees for all to authenticated
  using (public.is_own_employee(employee_id)) with check (public.is_own_employee(employee_id));
revoke all on public.employee_referees from anon;

-- ---------------------------------------------------------------------------------------------
-- what each employee must provide, and what is missing
-- ---------------------------------------------------------------------------------------------
-- every document type with whether this employee must provide it
create or replace function public.document_checklist_for(e public.employees)
returns table (code text, label text, section text, description text, allows_many boolean, required boolean, sort integer)
language sql stable security definer set search_path = public as $$
  select t.code, t.label, t.section, t.description, t.allows_many,
         case
           when t.required_when = 'pwd' then coalesce(e.is_pwd, false)
           when t.required_when = 'mortgage' then coalesce(e.mortgage_interest, 0) > 0
           when t.required_when = 'insurance' then coalesce(e.insurance_premium, 0) > 0
           else coalesce(s.required, t.required_by_default)
                or exists (select 1 from public.employee_document_requirements r where r.employee_id = e.id and r.code = t.code)
         end,
         t.sort
  from public.document_types t
  left join public.company_document_settings s on s.tenant_id = e.tenant_id and s.code = t.code
  order by t.sort
$$;
revoke all on function public.document_checklist_for(public.employees) from public, anon, authenticated;

-- for the screens: the caller's own checklist, or (HR) anyone's
create or replace function public.document_checklist(p_employee uuid default null)
returns table (code text, label text, section text, description text, allows_many boolean, required boolean, sort integer)
language plpgsql stable security definer set search_path = public as $$
declare
  e public.employees := public.onboarding_record(p_employee, false);
begin
  return query select * from public.document_checklist_for(e);
end $$;
revoke all on function public.document_checklist(uuid) from public, anon;
grant execute on function public.document_checklist(uuid) to authenticated;

-- the details part stays as it was; onboarding_missing adds documents and referees (submit, review and the overview
-- all call it by name)
alter function public.onboarding_missing(public.employees, text) rename to onboarding_missing_details;

create or replace function public.onboarding_missing(e public.employees, p_part text default 'all') returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  m text[] := public.onboarding_missing_details(e, p_part);
  c record;
begin
  for c in select * from public.document_checklist_for(e) where required loop
    -- the employee: a file that was not rejected
    if p_part in ('employee', 'all') and not exists (
      select 1 from public.employee_documents d where d.employee_id = e.id and d.code = c.code and d.status <> 'rejected') then
      m := m || ('Document: ' || c.label);
    -- HR: an accepted file
    elsif p_part in ('employer', 'all') and not exists (
      select 1 from public.employee_documents d where d.employee_id = e.id and d.code = c.code and d.status = 'accepted')
      and exists (select 1 from public.employee_documents d where d.employee_id = e.id and d.code = c.code and d.status = 'pending') then
      m := m || ('Review document: ' || c.label);
    end if;
  end loop;
  if p_part in ('employee', 'all') and not exists (select 1 from public.employee_referees r where r.employee_id = e.id) then
    m := m || text 'Referee';
  end if;
  return m;
end $$;
revoke all on function public.onboarding_missing(public.employees, text) from public, anon;
grant execute on function public.onboarding_missing(public.employees, text) to authenticated, service_role;
revoke all on function public.onboarding_missing_details(public.employees, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- audit
-- ---------------------------------------------------------------------------------------------
drop trigger if exists audit_employee_documents on public.employee_documents;
create trigger audit_employee_documents after insert or update or delete on public.employee_documents
  for each row execute function public.audit_row_change();
drop trigger if exists audit_employee_referees on public.employee_referees;
create trigger audit_employee_referees after insert or update or delete on public.employee_referees
  for each row execute function public.audit_row_change();
drop trigger if exists audit_employee_document_requirements on public.employee_document_requirements;
create trigger audit_employee_document_requirements after insert or update or delete on public.employee_document_requirements
  for each row execute function public.audit_row_change();

drop policy if exists employees_read on public.audit_log;
create policy employees_read on public.audit_log for select to authenticated
  using (table_name in ('employees', 'emergency_contact', 'next_of_kin', 'employee_documents', 'employee_referees',
                        'employee_document_requirements')
         and public.has_module('employees'));

-- ---------------------------------------------------------------------------------------------
-- files already uploaded on the staff portal's Documents tab: <company>/<login>/<type>_<time>.<ext>
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  insert into public.employee_documents (tenant_id, employee_id, code, file_path, file_name, content_type, size_bytes, uploaded_by, uploaded_at)
  select e.tenant_id, e.id,
         case m[1]
           when 'id_front' then 'id_document' when 'id_back' then 'id_document' when 'kra_pin' then 'kra_pin_certificate'
           when 'nssf' then 'nssf_document' when 'nhif' then 'sha_membership' when 'cv' then 'cv'
           else 'academic_certificate'
         end,
         o.name, regexp_replace(o.name, '^.*/', ''), o.metadata ->> 'mimetype', (o.metadata ->> 'size')::bigint,
         u.id, coalesce(o.created_at, now())
  from storage.objects o
  cross join lateral regexp_match(regexp_replace(o.name, '^.*/', ''), '^(id_front|id_back|kra_pin|nssf|nhif|cv|certificates)_') m
  join auth.users u on u.id::text = split_part(o.name, '/', 2)
  join public.employees e on e.tenant_id::text = split_part(o.name, '/', 1) and lower(e."Work Email") = lower(u.email)
  where o.bucket_id = 'documents' and array_length(string_to_array(o.name, '/'), 1) = 3
    and not exists (select 1 from public.employee_documents d where d.file_path = o.name);
end $$;

notify pgrst, 'reload schema';
