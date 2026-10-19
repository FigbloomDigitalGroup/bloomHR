-- Employee documents: extra documents, and a core list that follows the employee's country.
-- After 20261021700000_onboarding_essentials. Written to run again safely.
--
--   1. Other documents. An employee can upload documents beyond what they are asked for: any document type that is
--      not required of them (professional certificates, licences, employment evidence...) or a new generic type
--      "other" with their own title (e.g. "First Aid certificate") and an optional description. A title is needed
--      for "other". HR reviews them like any document (accept, or reject with a reason). They are never required, so
--      they never count as missing, outstanding or follow-ups (all of which read document_checklist_for, below).
--      The insert policy (own_insert, 20261014400000) already lets the employee upload any type for themselves.
--
--   2. Countries. document_types.countries lists the countries a type applies to (null: every country). The Kenyan
--      statutory documents (KRA PIN certificate, NSSF details, SHA membership, HELB clearance certificate, KRA PWD
--      exemption certificate) are Kenya only; Tanzania gets the TRA TIN certificate, NSSF Tanzania and the HESLB
--      letter (required only for HESLB loan holders: employees.heslb_borrower), Uganda the URA TIN certificate, NSSF
--      Uganda and the National ID (NIN) card. An employee's checklist only has the types for their branch's country
--      (employee_country, else the company's; Kenya when nothing is set). Files already uploaded are untouched.

-- ---------------------------------------------------------------------------------------------
-- 1. document types: a country list, the "other" section and the HESLB rule
-- ---------------------------------------------------------------------------------------------
alter table public.document_types add column if not exists countries text[];

alter table public.document_types drop constraint if exists document_types_section_check;
alter table public.document_types add constraint document_types_section_check
  check (section in ('core', 'qualifications', 'role', 'claims', 'other'));

alter table public.document_types drop constraint if exists document_types_required_when_check;
alter table public.document_types add constraint document_types_required_when_check
  check (required_when in ('pwd', 'mortgage', 'insurance', 'heslb'));

insert into public.document_types (code, label, section, description, allows_many, required_by_default, required_when, sort, countries) values
  ('tra_tin_certificate', 'TRA TIN certificate', 'core', 'Your Taxpayer Identification Number certificate from the TRA', false, true, null, 31, array['Tanzania']),
  ('ura_tin_certificate', 'URA TIN certificate', 'core', 'Your Taxpayer Identification Number certificate from the URA', false, true, null, 32, array['Uganda']),
  ('tz_nssf_document', 'NSSF Tanzania card or statement', 'core', 'Your NSSF card or a statement showing your NSSF number', false, true, null, 41, array['Tanzania']),
  ('ug_nssf_document', 'NSSF Uganda card or statement', 'core', 'Your NSSF card or a statement showing your NSSF number', false, true, null, 42, array['Uganda']),
  ('heslb_document', 'HESLB letter (loan beneficiaries)', 'core', 'Your HESLB letter showing your loan and index number', false, false, 'heslb', 61, array['Tanzania']),
  ('nin_card', 'National ID (NIN) card', 'core', 'Your Ugandan national ID card showing your NIN (both sides)', true, false, null, 15, array['Uganda']),
  ('other', 'Other document', 'other', 'Any other document, with your own title', true, false, null, 900, null)
on conflict (code) do update set label = excluded.label, section = excluded.section, description = excluded.description,
  allows_many = excluded.allows_many, required_by_default = excluded.required_by_default,
  required_when = excluded.required_when, sort = excluded.sort, countries = excluded.countries;

update public.document_types set countries = array['Kenya']
 where code in ('kra_pin_certificate', 'nssf_document', 'sha_membership', 'helb_certificate', 'pwd_certificate')
   and countries is distinct from array['Kenya'];

-- ---------------------------------------------------------------------------------------------
-- 2. a file's own title and description ("other" needs a title)
-- ---------------------------------------------------------------------------------------------
alter table public.employee_documents add column if not exists title text;
alter table public.employee_documents add column if not exists description text;

create or replace function public.employee_documents_title() returns trigger
language plpgsql set search_path = public as $$
begin
  new.title := nullif(btrim(coalesce(new.title, '')), '');
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  if new.code = 'other' and new.title is null then
    raise exception 'Give the document a title' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.employee_documents_title() from public, anon, authenticated;

drop trigger if exists employee_documents_title on public.employee_documents;
create trigger employee_documents_title before insert on public.employee_documents
  for each row execute function public.employee_documents_title();

alter table public.employee_documents drop constraint if exists employee_documents_other_title;
alter table public.employee_documents add constraint employee_documents_other_title
  check (code <> 'other' or coalesce(btrim(title), '') <> '');

-- ---------------------------------------------------------------------------------------------
-- 3. the checklist: the employee's country only, HESLB for loan holders, and never "other"
-- ---------------------------------------------------------------------------------------------
create or replace function public.employee_document_country(e public.employees) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(public.tidy_country(public.employee_country(e.tenant_id, e."Employee Number")), 'Kenya')
$$;
revoke all on function public.employee_document_country(public.employees) from public, anon, authenticated;

create or replace function public.document_checklist_for(e public.employees)
returns table (code text, label text, section text, description text, allows_many boolean, required boolean, sort integer)
language sql stable security definer set search_path = public as $$
  select t.code, t.label, t.section, t.description, t.allows_many,
         case
           when t.required_when = 'pwd' then coalesce(e.is_pwd, false)
           when t.required_when = 'mortgage' then coalesce(e.mortgage_interest, 0) > 0
           when t.required_when = 'insurance' then coalesce(e.insurance_premium, 0) > 0
           when t.required_when = 'heslb' then coalesce(e.heslb_borrower, false)
           else coalesce(s.required, t.required_by_default)
                or exists (select 1 from public.employee_document_requirements r where r.employee_id = e.id and r.code = t.code)
         end,
         t.sort
  from public.document_types t
  cross join (select public.employee_document_country(e) as country) k
  left join public.company_document_settings s on s.tenant_id = e.tenant_id and s.code = t.code
  where t.section <> 'other'
    and (t.countries is null or k.country = any (t.countries))
  order by t.sort
$$;
revoke all on function public.document_checklist_for(public.employees) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. the review notification names an "other" document by its title
-- ---------------------------------------------------------------------------------------------
create or replace function public.notify_document_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  what text;
begin
  if new.status is not distinct from old.status or new.status not in ('accepted', 'rejected')
     or not public.acting_on_someone_else(new.employee_id) then
    return new;
  end if;
  select t.label into what from public.document_types t where t.code = new.code;
  what := coalesce(new.title, what, 'document') || ' (' || new.file_name || ')';
  if new.status = 'accepted' then
    perform public.notify_employee(new.employee_id, 'document_accepted', 'Document accepted',
      'HR accepted your ' || what || '.');
  else
    perform public.notify_employee(new.employee_id, 'document_rejected', 'Document not accepted',
      'HR did not accept your ' || what || '.'
      || coalesce(' Reason: ' || nullif(btrim(new.review_note), '') || '.', '')
      || ' Please upload it again.');
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
