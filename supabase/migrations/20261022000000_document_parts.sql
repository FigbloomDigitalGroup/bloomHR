-- Employee documents: how many files a document takes, set per company, and the company's own document types.
-- After 20261021900000_extra_documents. Written to run again safely.
--
--   1. Files setting (file_mode) per document type:
--        single  one file. A split scan can be uploaded as extra pages ("Page 2", "Page 3"...); the document counts
--                as provided when page 1 (a file that is not an extra page) is in.
--        slots   a fixed list of named parts, each filled once (e.g. Front and Back). The document counts as provided
--                only when every slot has a file that was not rejected, and as accepted when every slot is accepted.
--        many    as many files as the employee likes, each with an optional label ("KCSE certificate", "BSc
--                Commerce"); provided when there is at least one.
--      Platform defaults sit on document_types: proof of identity has slots that follow the employee's identity type
--      (National, Alien or Refugee ID: Front and Back; a passport: Bio page), the Ugandan NIN card Front and Back, the
--      types that took several files are "many", everything else "single".
--   2. A company overrides the files setting of any type (company_document_settings.file_mode and slots, next to
--      "required", which may now be left to the default). Effective setting: the company's, else the default.
--   3. A company creates its own document types (document_types rows with the company's tenant_id and a generated
--      code). They work like the built-in ones everywhere (checklist, missing, follow-ups, "Add a document", review).
--      Only that company sees them; HR (employees or hr-admin) manages them. One with files is deactivated, never
--      deleted: it leaves the checklist, and its files stay under "Other documents".
--   4. Each file may have a label (trimmed) and a part (the slot, or "Page n").
--   5. Files already uploaded have no part. On a slots document such a file counts as the first slot (an old
--      single ID file is the "Front"), so the document shows "Back missing". Old files HR had already accepted are
--      marked as covering the whole document (complete), once, when this migration first runs, so employees whose ID
--      was accepted are not suddenly marked missing. For a waiting one, HR can "Accept as complete"
--      (accept_document_as_complete). Rejected files never count.

-- ---------------------------------------------------------------------------------------------
-- 1. document types: the files setting, and the company's own types
-- ---------------------------------------------------------------------------------------------
alter table public.document_types add column if not exists file_mode text not null default 'single';
alter table public.document_types add column if not exists slots jsonb;
alter table public.document_types add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.document_types add column if not exists active boolean not null default true;
alter table public.document_types add column if not exists created_by uuid references auth.users(id) on delete set null;
create index if not exists document_types_tenant_idx on public.document_types (tenant_id) where tenant_id is not null;

alter table public.document_types drop constraint if exists document_types_file_mode_check;
alter table public.document_types add constraint document_types_file_mode_check check (file_mode in ('single', 'slots', 'many'));
alter table public.document_types drop constraint if exists document_types_slots_check;
alter table public.document_types add constraint document_types_slots_check
  check (slots is null or jsonb_typeof(slots) in ('array', 'object'));

-- platform defaults (the company's own types keep what the company chose)
update public.document_types set file_mode = 'many', slots = null
 where tenant_id is null and allows_many and code not in ('id_document', 'nin_card')
   and (file_mode, slots) is distinct from ('many', null::jsonb);
update public.document_types set file_mode = 'slots',
       slots = '{"National ID": ["Front", "Back"], "Alien ID": ["Front", "Back"], "Refugee ID": ["Front", "Back"], "Passport Number": ["Bio page"], "*": ["Front", "Back"]}'::jsonb,
       description = 'Your ID card (front and back) or your passport bio page'
 where code = 'id_document' and tenant_id is null;
update public.document_types set file_mode = 'slots', slots = '["Front", "Back"]'::jsonb
 where code = 'nin_card' and tenant_id is null;

-- only this company's types (and the platform's) are visible; nobody writes them directly (the functions below do)
alter table public.document_types enable row level security;
drop policy if exists read_all on public.document_types;
drop policy if exists read_visible on public.document_types;
create policy read_visible on public.document_types for select to authenticated
  using (tenant_id is null or tenant_id = (select public.current_tenant_id()));
drop policy if exists tenant_isolation on public.document_types;
create policy tenant_isolation on public.document_types as restrictive for all
  using (tenant_id is null or tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
revoke insert, update, delete, truncate on public.document_types from anon, authenticated;

-- a company's files setting next to its "required" switch; "required" may now be left to the default (null)
alter table public.company_document_settings alter column required drop not null;
alter table public.company_document_settings add column if not exists file_mode text;
alter table public.company_document_settings add column if not exists slots jsonb;
alter table public.company_document_settings drop constraint if exists company_document_settings_file_mode_check;
alter table public.company_document_settings add constraint company_document_settings_file_mode_check
  check (file_mode is null or file_mode in ('single', 'slots', 'many'));

-- ---------------------------------------------------------------------------------------------
-- 2. the files: a part, a label, and HR's "covers the whole document"
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'employee_documents' and column_name = 'complete') then
    alter table public.employee_documents add column complete boolean not null default false;
    -- once: old files HR already accepted on what is now a slots document cover the whole document
    update public.employee_documents d set complete = true
      from public.document_types t
     where t.code = d.code and t.file_mode = 'slots' and d.status = 'accepted';
  end if;
end $$;
alter table public.employee_documents add column if not exists part text;
alter table public.employee_documents add column if not exists label text;
alter table public.employee_documents drop constraint if exists employee_documents_label_length;
alter table public.employee_documents add constraint employee_documents_label_length check (label is null or length(label) <= 200);
alter table public.employee_documents drop constraint if exists employee_documents_part_length;
alter table public.employee_documents add constraint employee_documents_part_length check (part is null or length(part) between 1 and 60);

-- ---------------------------------------------------------------------------------------------
-- 3. the effective files setting for an employee
-- ---------------------------------------------------------------------------------------------
-- slots as a list: a plain list, or a list per identity type ("*": any other)
create or replace function public.document_slots_resolve(p_def jsonb, p_identity text) returns text[]
language sql immutable set search_path = public as $$
  select case jsonb_typeof(p_def)
    when 'array' then array(select x from jsonb_array_elements_text(p_def) with ordinality a(x, o) order by o)
    when 'object' then array(
      select x from jsonb_array_elements_text(
        case when jsonb_typeof(coalesce(p_def -> p_identity, p_def -> '*')) = 'array'
             then coalesce(p_def -> p_identity, p_def -> '*') else '[]'::jsonb end) with ordinality a(x, o) order by o)
  end
$$;
grant execute on function public.document_slots_resolve(jsonb, text) to authenticated, service_role;

-- the company's setting, else the type's; "slots" with no slot names is "single"
create or replace function public.document_files_for(e public.employees, p_code text)
returns table (file_mode text, slots text[], slots_def jsonb)
language sql stable security definer set search_path = public as $$
  select case when r.mode = 'slots' and coalesce(cardinality(r.resolved), 0) = 0 then 'single' else r.mode end,
         case when r.mode = 'slots' and coalesce(cardinality(r.resolved), 0) > 0 then r.resolved end,
         case when r.mode = 'slots' and coalesce(cardinality(r.resolved), 0) > 0 then r.def end
  from public.document_types t
  left join public.company_document_settings s on s.tenant_id = e.tenant_id and s.code = t.code
  cross join lateral (
    select coalesce(s.file_mode, t.file_mode) as mode,
           coalesce(case when s.file_mode is not null then s.slots end, t.slots) as def
  ) m
  cross join lateral (select m.mode, m.def, public.document_slots_resolve(m.def, e."Type of Identification") as resolved) r
  where t.code = p_code
$$;
revoke all on function public.document_files_for(public.employees, text) from public, anon, authenticated;

-- per slot (one slot for "single" and "many"): whether it has a file that was not rejected, an accepted one, one
-- waiting for HR. A file without a part is the first slot; "single" counts page 1 only; an accepted file HR marked
-- as complete covers every slot.
create or replace function public.document_slot_states(e public.employees, p_code text)
returns table (slot text, ord integer, provided boolean, accepted boolean, pending boolean, has_files boolean)
language sql stable security definer set search_path = public as $$
  with f as (select * from public.document_files_for(e, p_code)),
  whole as (
    select exists (select 1 from public.employee_documents d
                   where d.employee_id = e.id and d.code = p_code and d.complete and d.status = 'accepted') as ok
  ),
  s as (
    select x.slot, x.ord::integer as ord from f cross join lateral unnest(f.slots) with ordinality x(slot, ord) where f.file_mode = 'slots'
    union all
    select null::text, 1 from f where f.file_mode <> 'slots'
  )
  select s.slot, s.ord,
         w.ok or coalesce(bool_or(d.status <> 'rejected'), false),
         w.ok or coalesce(bool_or(d.status = 'accepted'), false),
         coalesce(bool_or(d.status = 'pending'), false),
         count(d.id) > 0
  from s
  cross join whole w
  cross join f
  left join public.employee_documents d on d.employee_id = e.id and d.code = p_code and (
    case f.file_mode
      when 'slots' then coalesce(d.part, f.slots[1]) = s.slot
      when 'single' then coalesce(d.part, '') !~ '^Page ([2-9]|[1-9][0-9]+)$'
      else true
    end)
  group by s.slot, s.ord, w.ok
$$;
revoke all on function public.document_slot_states(public.employees, text) from public, anon, authenticated;

-- every slot has a file that was not rejected
create or replace function public.document_provided(e public.employees, p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(bool_and(x.provided), false) from public.document_slot_states(e, p_code) x
$$;
revoke all on function public.document_provided(public.employees, text) from public, anon, authenticated;

-- every slot has an accepted file
create or replace function public.document_accepted(e public.employees, p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(bool_and(x.accepted), false) from public.document_slot_states(e, p_code) x
$$;
revoke all on function public.document_accepted(public.employees, text) from public, anon, authenticated;

-- where a document is: "Back missing" (some slots in, others not), "waiting for HR", "rejected, upload again", or null
-- (also when it is accepted)
create or replace function public.document_note(e public.employees, p_code text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when bool_and(x.accepted) then null
    when bool_or(x.provided) and bool_or(not x.provided and x.slot is not null)
      then string_agg(x.slot, ' and ' order by x.ord) filter (where not x.provided) || ' missing'
    when exists (select 1 from public.employee_documents d where d.employee_id = e.id and d.code = p_code and d.status = 'pending') then 'waiting for HR'
    when exists (select 1 from public.employee_documents d where d.employee_id = e.id and d.code = p_code and d.status = 'rejected') then 'rejected, upload again'
  end
  from public.document_slot_states(e, p_code) x
$$;
revoke all on function public.document_note(public.employees, text) from public, anon, authenticated;

-- for the screens: the effective files setting of every type the caller (or, for HR, the employee) can see
create or replace function public.document_files(p_employee uuid default null)
returns table (code text, file_mode text, slots text[], slots_def jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
  e public.employees := public.onboarding_record(p_employee, false);
begin
  return query
  select t.code, f.file_mode, f.slots, f.slots_def
  from public.document_types t
  cross join lateral public.document_files_for(e, t.code) f
  where t.tenant_id is null or t.tenant_id = e.tenant_id
  order by t.sort;
end $$;
revoke all on function public.document_files(uuid) from public, anon;
grant execute on function public.document_files(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. a new file: label and part trimmed, the type usable, each slot filled once
-- ---------------------------------------------------------------------------------------------
create or replace function public.employee_documents_parts() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t public.document_types;
  e public.employees;
  f record;
begin
  new.label := nullif(btrim(coalesce(new.label, '')), '');
  new.part := nullif(btrim(coalesce(new.part, '')), '');
  if auth.uid() is not null then
    new.complete := false;
    -- someone else's record: the row-level security refuses it, without saying what is there
    if not public.is_own_employee(new.employee_id) then
      return new;
    end if;
  end if;
  select * into t from public.document_types where code = new.code;
  select * into e from public.employees where id = new.employee_id;
  if t.tenant_id is not null and t.tenant_id is distinct from e.tenant_id then
    raise exception 'Unknown document type' using errcode = '23503';
  end if;
  if not t.active and auth.uid() is not null then
    raise exception 'This document type is no longer used' using errcode = '23514';
  end if;
  if new.part is not null then
    select * into f from public.document_files_for(e, new.code);
    if f.file_mode = 'slots' then
      if not new.part = any (f.slots) then
        raise exception 'Choose one of: %', array_to_string(f.slots, ', ') using errcode = '23514';
      end if;
      if exists (select 1 from public.employee_documents d
                 where d.employee_id = new.employee_id and d.code = new.code and d.status <> 'rejected'
                   and coalesce(d.part, f.slots[1]) = new.part) then
        raise exception '% is already uploaded. Remove it to upload another.', new.part using errcode = '23505';
      end if;
    elsif new.part !~ '^Page [1-9][0-9]*$' then
      raise exception 'This document has no part called %', new.part using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.employee_documents_parts() from public, anon, authenticated;

drop trigger if exists employee_documents_parts on public.employee_documents;
create trigger employee_documents_parts before insert on public.employee_documents
  for each row execute function public.employee_documents_parts();

-- HR accepts one file as the whole document (an old single ID file, or a scan with both sides on one page)
create or replace function public.accept_document_as_complete(p_document uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  d public.employee_documents;
begin
  if not public.has_module('employees') then
    raise exception 'Only HR can do this' using errcode = '42501';
  end if;
  select * into d from public.employee_documents where id = p_document and tenant_id = public.current_tenant_id();
  if d.id is null then
    raise exception 'Document not found' using errcode = 'P0002';
  end if;
  perform set_config('app.document_review', 'on', true);
  update public.employee_documents set status = 'accepted', complete = true, review_note = null,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = d.id;
  perform set_config('app.document_review', '', true);
  return 'accepted';
end $$;
revoke all on function public.accept_document_as_complete(uuid) from public, anon;
grant execute on function public.accept_document_as_complete(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. the checklist (20261021900000): the company's own active types too; allows_many = takes more than one file
-- ---------------------------------------------------------------------------------------------
create or replace function public.document_checklist_for(e public.employees)
returns table (code text, label text, section text, description text, allows_many boolean, required boolean, sort integer)
language sql stable security definer set search_path = public as $$
  select t.code, t.label, t.section, t.description,
         coalesce(s.file_mode, t.file_mode) <> 'single',
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
    and t.active
    and (t.tenant_id is null or t.tenant_id = e.tenant_id)
    and (t.countries is null or k.country = any (t.countries))
  order by t.sort
$$;
revoke all on function public.document_checklist_for(public.employees) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. missing, outstanding and follow-ups count a document only when every slot is in
-- ---------------------------------------------------------------------------------------------
create or replace function public.documents_outstanding(e public.employees) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(c.label || coalesce(' (' || public.document_note(e, c.code) || ')', '') order by c.sort), '{}')
  from public.document_checklist_for(e) c
  where c.required and not public.document_accepted(e, c.code)
$$;
revoke all on function public.documents_outstanding(public.employees) from public, anon, authenticated;

create or replace function public.onboarding_essentials_missing(e public.employees, p_part text default 'all') returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  v_keys text[] := public.onboarding_essential_keys(e.tenant_id);
  m text[] := '{}';
  c record;
begin
  if p_part in ('employee', 'all') then
    select coalesce(array_agg(u.x order by u.o), '{}') into m
    from unnest(public.onboarding_missing(e, 'employee')) with ordinality u(x, o)
    where public.onboarding_item_key(u.x) = any (v_keys);
  end if;
  if p_part in ('employer', 'all') then
    m := m || public.onboarding_missing(e, 'employer');
  end if;
  if 'documents' = any (v_keys) then
    for c in select * from public.document_checklist_for(e) where required loop
      if p_part in ('employee', 'all') and not public.document_provided(e, c.code) then
        m := m || ('Document: ' || c.label);
      elsif p_part in ('employer', 'all') and not public.document_accepted(e, c.code)
        and exists (select 1 from public.employee_documents d where d.employee_id = e.id and d.code = c.code and d.status = 'pending') then
        m := m || ('Review document: ' || c.label);
      end if;
    end loop;
  end if;
  return m;
end $$;
revoke all on function public.onboarding_essentials_missing(public.employees, text) from public, anon;
grant execute on function public.onboarding_essentials_missing(public.employees, text) to authenticated, service_role;

create or replace function public.onboarding_followups(e public.employees)
returns table (item_key text, item text, note text, due_date date, overdue boolean, sort integer)
language sql stable security definer set search_path = public as $$
  with keys as (select public.onboarding_essential_keys(e.tenant_id) k),
  items as (
    select public.onboarding_item_key(u.x) as item_key, u.x as item, null::text as note, u.o::integer as sort
    from unnest(public.onboarding_missing(e, 'employee')) with ordinality u(x, o)
    union all
    select 'documents', 'Document: ' || c.label, public.document_note(e, c.code), 1000 + c.sort
    from public.document_checklist_for(e) c
    where c.required and not public.document_accepted(e, c.code)
  )
  select i.item_key, i.item, i.note, d.due_date, coalesce(d.due_date < current_date, false), i.sort
  from items i
  cross join keys
  left join public.onboarding_followup_due_dates d on d.employee_id = e.id and d.item = i.item
  where e.onboarding_status = 'approved' or not (i.item_key = any (keys.k))
  order by i.sort
$$;
revoke all on function public.onboarding_followups(public.employees) from public, anon;
grant execute on function public.onboarding_followups(public.employees) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 7. HR: a company's files setting, and its own document types
-- ---------------------------------------------------------------------------------------------
create or replace function public.can_manage_documents() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.current_tenant_id() is not null
         and (public.has_module('employees') or public.has_module('hr-admin'))
$$;
revoke all on function public.can_manage_documents() from public, anon;
grant execute on function public.can_manage_documents() to authenticated;

-- slot names: trimmed, distinct, 1 to 10 of them, never "Page n"
create or replace function public.clean_document_slots(p_slots text[]) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  s text[];
begin
  select coalesce(array_agg(x order by o), '{}') into s
  from (select distinct on (lower(btrim(v))) btrim(v) as x, o
        from unnest(coalesce(p_slots, '{}')) with ordinality u(v, o)
        where btrim(coalesce(v, '')) <> ''
        order by lower(btrim(v)), o) q;
  if cardinality(s) = 0 then
    raise exception 'Name at least one slot' using errcode = '23514';
  end if;
  if cardinality(s) > 10 then
    raise exception 'Use at most 10 slots' using errcode = '23514';
  end if;
  if exists (select 1 from unnest(s) x where length(x) > 60 or x ~* '^page [0-9]+$') then
    raise exception 'Slot names are up to 60 characters and can''t be "Page n"' using errcode = '23514';
  end if;
  return to_jsonb(s);
end $$;
grant execute on function public.clean_document_slots(text[]) to authenticated, service_role;

-- the company's files setting for a type (no mode: back to the default)
create or replace function public.set_document_files_setting(p_code text, p_file_mode text, p_slots text[] default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if not public.can_manage_documents() then
    raise exception 'Only HR can do this' using errcode = '42501';
  end if;
  if not exists (select 1 from public.document_types t where t.code = p_code and (t.tenant_id is null or t.tenant_id = v_tenant)) then
    raise exception 'Unknown document type' using errcode = 'P0002';
  end if;
  if p_file_mode is not null and p_file_mode not in ('single', 'slots', 'many') then
    raise exception 'Choose one file, named slots or many files' using errcode = '23514';
  end if;
  insert into public.company_document_settings (tenant_id, code, required, file_mode, slots)
  values (v_tenant, p_code, null, p_file_mode, case when p_file_mode = 'slots' then public.clean_document_slots(p_slots) end)
  on conflict (tenant_id, code) do update set file_mode = excluded.file_mode, slots = excluded.slots, updated_at = now();
end $$;
revoke all on function public.set_document_files_setting(text, text, text[]) from public, anon;
grant execute on function public.set_document_files_setting(text, text, text[]) to authenticated;

-- creates (no code) or changes one of the company's own types; saving one makes it active again
create or replace function public.save_company_document_type(
  p_code text, p_label text, p_description text, p_section text, p_countries text[], p_required boolean,
  p_file_mode text, p_slots text[] default null
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_countries text[];
  v_slots jsonb;
  v_code text := p_code;
begin
  if not public.can_manage_documents() then
    raise exception 'Only HR can do this' using errcode = '42501';
  end if;
  if v_label is null or length(v_label) > 80 then
    raise exception 'Give the document a name (up to 80 characters)' using errcode = '23514';
  end if;
  if p_section is null or p_section not in ('core', 'qualifications', 'role') then
    raise exception 'Choose a section' using errcode = '23514';
  end if;
  if p_file_mode is null or p_file_mode not in ('single', 'slots', 'many') then
    raise exception 'Choose one file, named slots or many files' using errcode = '23514';
  end if;
  if p_file_mode = 'slots' then
    v_slots := public.clean_document_slots(p_slots);
  end if;
  select nullif(array_agg(distinct coalesce(public.tidy_country(btrim(c)), btrim(c))), '{}') into v_countries
  from unnest(coalesce(p_countries, '{}')) c where btrim(coalesce(c, '')) <> '';

  if v_code is null then
    v_code := 'co_' || substr(md5(v_tenant::text || gen_random_uuid()::text), 1, 12);
    insert into public.document_types (code, label, section, description, allows_many, required_by_default, required_when,
                                       sort, countries, file_mode, slots, tenant_id, active, created_by)
    values (v_code, v_label, p_section, nullif(btrim(coalesce(p_description, '')), ''), p_file_mode <> 'single',
            coalesce(p_required, false), null,
            case p_section when 'core' then 90 when 'qualifications' then 190 else 290 end,
            v_countries, p_file_mode, v_slots, v_tenant, true, auth.uid());
  else
    update public.document_types set label = v_label, section = p_section,
           description = nullif(btrim(coalesce(p_description, '')), ''), allows_many = p_file_mode <> 'single',
           required_by_default = coalesce(p_required, false), countries = v_countries, file_mode = p_file_mode,
           slots = v_slots, active = true
     where code = v_code and tenant_id = v_tenant;
    if not found then
      raise exception 'Unknown document type' using errcode = 'P0002';
    end if;
    -- the type's own setting is the company's: drop any override of it
    update public.company_document_settings set required = null, file_mode = null, slots = null, updated_at = now()
     where tenant_id = v_tenant and code = v_code;
  end if;
  return v_code;
end $$;
revoke all on function public.save_company_document_type(text, text, text, text, text[], boolean, text, text[]) from public, anon;
grant execute on function public.save_company_document_type(text, text, text, text, text[], boolean, text, text[]) to authenticated;

-- removes one of the company's own types; one with files is deactivated instead
create or replace function public.remove_company_document_type(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if not public.can_manage_documents() then
    raise exception 'Only HR can do this' using errcode = '42501';
  end if;
  if not exists (select 1 from public.document_types where code = p_code and tenant_id = v_tenant) then
    raise exception 'Unknown document type' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.employee_documents where code = p_code) then
    update public.document_types set active = false where code = p_code and tenant_id = v_tenant;
    return 'deactivated';
  end if;
  delete from public.document_types where code = p_code and tenant_id = v_tenant;
  return 'deleted';
end $$;
revoke all on function public.remove_company_document_type(text) from public, anon;
grant execute on function public.remove_company_document_type(text) to authenticated;

drop trigger if exists audit_document_types on public.document_types;
create trigger audit_document_types after insert or update or delete on public.document_types
  for each row execute function public.audit_row_change();

notify pgrst, 'reload schema';
