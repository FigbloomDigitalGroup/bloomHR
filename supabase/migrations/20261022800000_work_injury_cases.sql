-- Workplace accidents and work injuries (WIBA). Builds on incident reports (incident_reports, baseline; module
-- 'incident-reports'). Written to run again safely.
--
--   incident_reports.incident_type   two more kinds a person can report: 'workplace_injury' (an accident at work that
--                                    hurt someone) and 'occupational_disease' (an illness caused by the work).
--   work_injury_cases                one case per injured employee: opened by HR from an incident report (or on its
--                                    own), with the accident (when, where, what happened), the injury, witnesses, first
--                                    aid and hospital, days off work, the incapacity the doctor or the Director assessed,
--                                    the monthly earnings used for the estimate, and the claim's progress:
--                                      reported -> notified (to the authority: DOSH in Kenya, WCF in Tanzania, the
--                                      labour officer in Uganda) -> claim_lodged (with the insurer) -> assessed -> paid
--                                      -> closed.
--                                    Moving to a step fills in its date (today) when none was given. The country is the
--                                    employee's branch's country (employee_country) when not given, and the currency
--                                    follows it. The legal deadlines and the compensation estimate are worked out in the
--                                    app from dated rules (src/lib/workInjuryRules.ts); nothing here posts to payroll.
--   work_injury_documents            files with a case (medical reports, police abstract, the DOSH form, receipts), in
--                                    the private "documents" bucket under <company>/<login>/work-injuries/<case>/...
--   company_wiba_cover               the company's work injury insurance (WIBA s.7 in Kenya): insurer, policy number,
--                                    cover dates, and the DOSH workplace registration number for the report form. The
--                                    dashboard warns when it is missing or expired.
--
-- Who: the same people as incident reports (module 'incident-reports'), inside their own company. Employees do not
-- see the cases (yet); they keep seeing their own incident report.

-- ---------------------------------------------------------------------------------------------
-- 1. incident reports: injuries and occupational disease
-- ---------------------------------------------------------------------------------------------
alter table public.incident_reports drop constraint if exists incident_reports_incident_type_check;
alter table public.incident_reports add constraint incident_reports_incident_type_check check (incident_type = any (array[
  'harassment', 'discrimination', 'safety_violation', 'ethics_violation', 'fraud', 'theft', 'policy_violation',
  'workplace_violence', 'workplace_injury', 'occupational_disease', 'other']));

-- ---------------------------------------------------------------------------------------------
-- 2. the company's work injury cover
-- ---------------------------------------------------------------------------------------------
create table if not exists public.company_wiba_cover (
  tenant_id uuid primary key default public.current_tenant_id() references public.tenants(id) on delete cascade,
  insurer_name text,
  policy_number text,
  cover_start date,
  cover_expiry date,
  dosh_registration_no text,
  notes text,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'company_wiba_cover_lengths_check') then
    alter table public.company_wiba_cover add constraint company_wiba_cover_lengths_check check (
      coalesce(length(insurer_name), 0) <= 200 and coalesce(length(policy_number), 0) <= 100
      and coalesce(length(dosh_registration_no), 0) <= 100 and coalesce(length(notes), 0) <= 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'company_wiba_cover_dates_check') then
    alter table public.company_wiba_cover add constraint company_wiba_cover_dates_check
      check (cover_start is null or cover_expiry is null or cover_expiry >= cover_start);
  end if;
end $$;

create or replace function public.company_wiba_cover_rules() returns trigger
language plpgsql set search_path = public as $$
begin
  new.insurer_name := nullif(btrim(new.insurer_name), '');
  new.policy_number := nullif(btrim(new.policy_number), '');
  new.dosh_registration_no := nullif(btrim(new.dosh_registration_no), '');
  new.notes := nullif(btrim(new.notes), '');
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.company_wiba_cover_rules() from public, anon, authenticated;

drop trigger if exists company_wiba_cover_rules on public.company_wiba_cover;
create trigger company_wiba_cover_rules before insert or update on public.company_wiba_cover
  for each row execute function public.company_wiba_cover_rules();

alter table public.company_wiba_cover enable row level security;
drop policy if exists tenant_isolation on public.company_wiba_cover;
create policy tenant_isolation on public.company_wiba_cover as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists module_access on public.company_wiba_cover;
create policy module_access on public.company_wiba_cover for all to authenticated
  using ((select public.has_any_module('incident-reports')))
  with check ((select public.has_any_module('incident-reports')));
revoke all on public.company_wiba_cover from anon;
revoke truncate on public.company_wiba_cover from authenticated;
grant select, insert, update, delete on public.company_wiba_cover to authenticated;

drop trigger if exists audit_company_wiba_cover on public.company_wiba_cover;
create trigger audit_company_wiba_cover after insert or update or delete on public.company_wiba_cover
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------------------------
-- 3. work injury cases
-- ---------------------------------------------------------------------------------------------
create table if not exists public.work_injury_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  incident_report_id uuid references public.incident_reports(id) on delete set null,
  employee_number text not null,
  employee_name text,
  country text,
  currency text,
  kind text not null default 'accident',
  is_fatal boolean not null default false,
  occurred_at timestamptz not null,
  employer_notified_on date,
  place text,
  what_happened text,
  injury_nature text,
  body_parts text,
  witnesses text,
  first_aid text,
  hospital text,
  doctor text,
  on_duty boolean not null default true,
  stopped_work_on date,
  returned_to_work_on date,
  days_off integer,
  incapacity_percent numeric(5, 2),
  monthly_earnings numeric(14, 2),
  medical_costs numeric(14, 2),
  status text not null default 'reported',
  authority_notified_on date,
  authority_reference text,
  claim_lodged_on date,
  insurer_claim_number text,
  assessed_on date,
  assessed_amount numeric(14, 2),
  paid_on date,
  paid_amount numeric(14, 2),
  closed_on date,
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'work_injury_cases_kind_check') then
    alter table public.work_injury_cases add constraint work_injury_cases_kind_check
      check (kind in ('accident', 'occupational_disease'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'work_injury_cases_status_check') then
    alter table public.work_injury_cases add constraint work_injury_cases_status_check
      check (status in ('reported', 'notified', 'claim_lodged', 'assessed', 'paid', 'closed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'work_injury_cases_numbers_check') then
    alter table public.work_injury_cases add constraint work_injury_cases_numbers_check check (
      (days_off is null or days_off between 0 and 3650)
      and (incapacity_percent is null or incapacity_percent between 0 and 100)
      and (monthly_earnings is null or monthly_earnings >= 0)
      and (medical_costs is null or medical_costs >= 0)
      and (assessed_amount is null or assessed_amount >= 0)
      and (paid_amount is null or paid_amount >= 0));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'work_injury_cases_dates_check') then
    alter table public.work_injury_cases add constraint work_injury_cases_dates_check check (
      (returned_to_work_on is null or stopped_work_on is null or returned_to_work_on >= stopped_work_on));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'work_injury_cases_lengths_check') then
    alter table public.work_injury_cases add constraint work_injury_cases_lengths_check check (
      coalesce(length(place), 0) <= 500 and coalesce(length(what_happened), 0) <= 5000
      and coalesce(length(injury_nature), 0) <= 2000 and coalesce(length(body_parts), 0) <= 500
      and coalesce(length(witnesses), 0) <= 2000 and coalesce(length(first_aid), 0) <= 2000
      and coalesce(length(hospital), 0) <= 500 and coalesce(length(doctor), 0) <= 300
      and coalesce(length(authority_reference), 0) <= 200 and coalesce(length(insurer_claim_number), 0) <= 200
      and coalesce(length(notes), 0) <= 5000);
  end if;
end $$;

create index if not exists work_injury_cases_tenant_idx on public.work_injury_cases (tenant_id, status);
create index if not exists work_injury_cases_incident_idx on public.work_injury_cases (incident_report_id);
create index if not exists work_injury_cases_employee_idx on public.work_injury_cases (tenant_id, employee_number);

-- tidies the text, checks the employee and incident report are this company's, fills in the country and currency, and
-- the date of each step reached
create or replace function public.work_injury_cases_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.employee_number := btrim(coalesce(new.employee_number, ''));
  if new.employee_number = '' then
    raise exception 'Choose the injured employee' using errcode = '23514';
  end if;
  if (tg_op = 'INSERT' or new.employee_number is distinct from old.employee_number) and not exists (
    select 1 from public.employees e where e.tenant_id = new.tenant_id and e."Employee Number" = new.employee_number
  ) then
    raise exception 'Unknown employee' using errcode = '23503';
  end if;
  if new.incident_report_id is not null and (tg_op = 'INSERT' or new.incident_report_id is distinct from old.incident_report_id)
     and not exists (select 1 from public.incident_reports r where r.id = new.incident_report_id and r.tenant_id = new.tenant_id) then
    raise exception 'Unknown incident report' using errcode = '23503';
  end if;

  -- the name as it is in the employee record, kept with the case (the form prints it)
  if tg_op = 'INSERT' or new.employee_number is distinct from old.employee_number then
    new.employee_name := coalesce(
      (select nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), '')
         from public.employees e where e.tenant_id = new.tenant_id and e."Employee Number" = new.employee_number limit 1),
      nullif(btrim(new.employee_name), ''));
  end if;

  new.country := coalesce(public.tidy_country(new.country),
                          public.tidy_country(public.employee_country(new.tenant_id, new.employee_number)), 'Kenya');
  new.currency := coalesce(nullif(upper(btrim(new.currency)), ''), public.country_currency(new.country));

  new.place := nullif(btrim(new.place), '');
  new.what_happened := nullif(btrim(new.what_happened), '');
  new.injury_nature := nullif(btrim(new.injury_nature), '');
  new.body_parts := nullif(btrim(new.body_parts), '');
  new.witnesses := nullif(btrim(new.witnesses), '');
  new.first_aid := nullif(btrim(new.first_aid), '');
  new.hospital := nullif(btrim(new.hospital), '');
  new.doctor := nullif(btrim(new.doctor), '');
  new.authority_reference := nullif(btrim(new.authority_reference), '');
  new.insurer_claim_number := nullif(btrim(new.insurer_claim_number), '');
  new.notes := nullif(btrim(new.notes), '');
  -- the employer learns of it no earlier than it happened; when not given, the day it happened
  new.employer_notified_on := coalesce(new.employer_notified_on, (new.occurred_at at time zone 'Africa/Nairobi')::date);

  -- each step reached gets its date (today, East Africa time) when none was given
  if new.status in ('notified', 'claim_lodged', 'assessed', 'paid', 'closed') then
    new.authority_notified_on := coalesce(new.authority_notified_on, (now() at time zone 'Africa/Nairobi')::date);
  end if;
  if new.status in ('claim_lodged', 'assessed', 'paid', 'closed') then
    new.claim_lodged_on := coalesce(new.claim_lodged_on, (now() at time zone 'Africa/Nairobi')::date);
  end if;
  if new.status in ('assessed', 'paid', 'closed') then
    new.assessed_on := coalesce(new.assessed_on, (now() at time zone 'Africa/Nairobi')::date);
  end if;
  if new.status = 'paid' then
    new.paid_on := coalesce(new.paid_on, (now() at time zone 'Africa/Nairobi')::date);
  end if;
  if new.status = 'closed' then
    new.closed_on := coalesce(new.closed_on, (now() at time zone 'Africa/Nairobi')::date);
  end if;

  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.work_injury_cases_rules() from public, anon, authenticated;

drop trigger if exists work_injury_cases_rules on public.work_injury_cases;
create trigger work_injury_cases_rules before insert or update on public.work_injury_cases
  for each row execute function public.work_injury_cases_rules();

alter table public.work_injury_cases enable row level security;
drop policy if exists tenant_isolation on public.work_injury_cases;
create policy tenant_isolation on public.work_injury_cases as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists module_access on public.work_injury_cases;
create policy module_access on public.work_injury_cases for all to authenticated
  using ((select public.has_any_module('incident-reports')))
  with check ((select public.has_any_module('incident-reports')));
revoke all on public.work_injury_cases from anon;
revoke truncate on public.work_injury_cases from authenticated;
grant select, insert, update, delete on public.work_injury_cases to authenticated;

drop trigger if exists audit_work_injury_cases on public.work_injury_cases;
create trigger audit_work_injury_cases after insert or update or delete on public.work_injury_cases
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------------------------
-- 4. files with a case
-- ---------------------------------------------------------------------------------------------
create table if not exists public.work_injury_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  case_id uuid not null references public.work_injury_cases(id) on delete cascade,
  label text,
  file_path text not null,
  file_name text not null,
  uploaded_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists work_injury_documents_case_idx on public.work_injury_documents (case_id);

create or replace function public.work_injury_documents_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.work_injury_cases c where c.id = new.case_id and c.tenant_id = new.tenant_id) then
    raise exception 'Unknown work injury case' using errcode = '23503';
  end if;
  -- the file is in this company's folder of the documents bucket, under work-injuries/<case>/
  if split_part(new.file_path, '/', 1) <> new.tenant_id::text
     or split_part(new.file_path, '/', 3) <> 'work-injuries'
     or split_part(new.file_path, '/', 4) <> new.case_id::text then
    raise exception 'The file is not in this case''s folder' using errcode = '23514';
  end if;
  new.label := nullif(left(btrim(coalesce(new.label, '')), 200), '');
  new.file_name := left(coalesce(nullif(btrim(new.file_name), ''), 'file'), 300);
  if tg_op = 'INSERT' then
    new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
  end if;
  return new;
end $$;
revoke all on function public.work_injury_documents_rules() from public, anon, authenticated;

drop trigger if exists work_injury_documents_rules on public.work_injury_documents;
create trigger work_injury_documents_rules before insert or update on public.work_injury_documents
  for each row execute function public.work_injury_documents_rules();

alter table public.work_injury_documents enable row level security;
drop policy if exists tenant_isolation on public.work_injury_documents;
create policy tenant_isolation on public.work_injury_documents as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists module_access on public.work_injury_documents;
create policy module_access on public.work_injury_documents for all to authenticated
  using ((select public.has_any_module('incident-reports')))
  with check ((select public.has_any_module('incident-reports')));
revoke all on public.work_injury_documents from anon;
revoke truncate on public.work_injury_documents from authenticated;
grant select, insert, delete on public.work_injury_documents to authenticated;

drop trigger if exists audit_work_injury_documents on public.work_injury_documents;
create trigger audit_work_injury_documents after insert or update or delete on public.work_injury_documents
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------------------------
-- 5. the files: whoever handles incident reports opens and removes them (uploading into one's own folder is already
--    allowed by documents_insert, 20261007000100). Skipped where there is no storage schema (the test database).
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  drop policy if exists documents_work_injuries_select on storage.objects;
  drop policy if exists documents_work_injuries_delete on storage.objects;
  create policy documents_work_injuries_select on storage.objects for select to authenticated
    using (
      bucket_id = 'documents'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (storage.foldername(name))[3] = 'work-injuries'
      and (select public.has_any_module('incident-reports'))
      and exists (select 1 from public.work_injury_documents d where d.file_path = storage.objects.name)
    );
  create policy documents_work_injuries_delete on storage.objects for delete to authenticated
    using (
      bucket_id = 'documents'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (storage.foldername(name))[3] = 'work-injuries'
      and (select public.has_any_module('incident-reports'))
    );
end $$;

notify pgrst, 'reload schema';
