-- Documents with leave: a doctor's report for sick leave, a birth notification for paternity leave... (FIG-876).
--
--   1. Each leave type's policy may name a document and say when it is due:
--        document_name               e.g. "Report from a registered medical practitioner" (null = none)
--        document_when               'with_application' (no application without it) or 'after' (within
--                                    document_within_days of the leave's first day)
--        document_if_longer_than     only for leave longer than this many days (0 = always)
--        followup_document_name      a second document due after the leave starts (e.g. the birth notification
--                                    after maternity leave), within followup_within_days of its first day
--   2. leave_application keeps the file of each (document_path / followup_document_path, in the private
--      leave-documents bucket, under <company>/<login of whoever uploaded it>/...).
--   3. "With the application" is checked when an employee applies for themselves: no document, no application. HR
--      entering leave for someone may add it later. attach_leave_document() adds or replaces a document afterwards:
--      by the employee whose leave it is, or by HR.
--   4. The files: the uploader, HR (Leave) and anyone who can see the application (its approvers) can open them.
--   5. leave_request_check() also tells the forms which document is needed.
--   6. New companies start with: sick leave - a medical report; maternity - a report with the expected delivery date,
--      then the birth notification within 30 days; paternity - the birth notification; adoption - the custody
--      agreement. Existing companies turn documents on in Leave > Leave Types.

-- ---------------------------------------------------------------------------------------------
-- 1. policy settings
-- ---------------------------------------------------------------------------------------------
alter table public.leave_policies add column if not exists document_name text;
alter table public.leave_policies add column if not exists document_when text not null default 'with_application';
alter table public.leave_policies add column if not exists document_within_days integer not null default 0;
alter table public.leave_policies add column if not exists document_if_longer_than numeric not null default 0;
alter table public.leave_policies add column if not exists followup_document_name text;
alter table public.leave_policies add column if not exists followup_within_days integer not null default 14;

alter table public.leave_policies drop constraint if exists leave_policies_documents_check;
alter table public.leave_policies add constraint leave_policies_documents_check check (
  (document_name is null or char_length(btrim(document_name)) between 1 and 120)
  and (followup_document_name is null or char_length(btrim(followup_document_name)) between 1 and 120)
  and document_when in ('with_application', 'after')
  and document_within_days between 0 and 365
  and followup_within_days between 0 and 365
  and document_if_longer_than >= 0
);

drop view if exists public.current_leave_policies;
create view public.current_leave_policies as
select distinct on (leave_type_id) *
from public.leave_policies
where effective_from <= current_date
order by leave_type_id, effective_from desc;
alter view public.current_leave_policies set (security_invoker = true);

-- ---------------------------------------------------------------------------------------------
-- 2. the files on the application
-- ---------------------------------------------------------------------------------------------
alter table public.leave_application add column if not exists document_path text;
alter table public.leave_application add column if not exists document_name text;
alter table public.leave_application add column if not exists document_uploaded_at timestamptz;
alter table public.leave_application add column if not exists followup_document_path text;
alter table public.leave_application add column if not exists followup_document_name text;
alter table public.leave_application add column if not exists followup_uploaded_at timestamptz;

-- a file in the company's folder that the signed-in login uploaded (or, for HR, any of the company's)
create or replace function public.leave_document_path_ok(p_tenant uuid, p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_path is not null and split_part(p_path, '/', 1) = p_tenant::text and p_path !~ '\.\.'
     and (split_part(p_path, '/', 2) = auth.uid()::text or public.has_module('leaves'))
$$;
revoke all on function public.leave_document_path_ok(uuid, text) from public, anon;

-- what one leave type asks for, given how many days the leave is
create or replace function public.leave_document_needed(p_tenant uuid, p_type text, p_days numeric) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when p.leave_type_id is null then null else jsonb_build_object(
    'name', case when p.document_name is not null and coalesce(p_days, 0) > p.document_if_longer_than then p.document_name end,
    'when', p.document_when,
    'within_days', p.document_within_days,
    'followup_name', p.followup_document_name,
    'followup_within_days', p.followup_within_days) end
  from public.leave_types t
  left join public.current_leave_policies p on p.leave_type_id = t.id
  where t.tenant_id = p_tenant and t.name = btrim(coalesce(p_type, ''))
$$;
revoke all on function public.leave_document_needed(uuid, text, numeric) from public, anon;

-- ---------------------------------------------------------------------------------------------
-- 3. checked when applying; added afterwards
-- ---------------------------------------------------------------------------------------------
create or replace function public.leave_application_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_self boolean;
  v_half boolean := lower(btrim(coalesce(new.type, ''))) = 'half day';
  v_doc jsonb;
begin
  if auth.uid() is null then
    select * into r from public.leave_request_problems(new.tenant_id, new."Employee Number", new."Leave Type",
      public.leave_parse_date(new."Start Date"), public.leave_parse_date(new."End Date"), false, new.id, v_half);
    if r.days > 0 then
      new.days := r.days;
    end if;
    return new;
  end if;

  v_self := public.current_employee_number() is not distinct from new."Employee Number" or not public.has_module('leaves');
  select * into r from public.leave_request_problems(new.tenant_id, new."Employee Number", new."Leave Type",
    public.leave_parse_date(new."Start Date"), public.leave_parse_date(new."End Date"), v_self, new.id, v_half);
  if lower(coalesce(new.status, 'pending')) = 'approved' then
    r.problems := array(select p from unnest(r.problems) p where p not like 'Not enough %');
  end if;

  -- documents: only files from this company's folder; "with the application" for one's own leave
  if new.document_path is not null and not public.leave_document_path_ok(new.tenant_id, new.document_path) then
    r.problems := r.problems || 'That document was not uploaded here; attach it again'::text;
  end if;
  if new.followup_document_path is not null and not public.leave_document_path_ok(new.tenant_id, new.followup_document_path) then
    r.problems := r.problems || 'That document was not uploaded here; attach it again'::text;
  end if;
  v_doc := public.leave_document_needed(new.tenant_id, new."Leave Type", r.days);
  if v_self and v_doc ->> 'name' is not null and v_doc ->> 'when' = 'with_application' and new.document_path is null then
    r.problems := r.problems || format('%s needs a document with the application: %s', btrim(new."Leave Type"), v_doc ->> 'name');
  end if;
  if new.document_path is not null then
    new.document_uploaded_at := now();
  else
    new.document_name := null;
  end if;
  if new.followup_document_path is not null then
    new.followup_uploaded_at := now();
  else
    new.followup_document_name := null;
  end if;

  if cardinality(r.problems) > 0 then
    raise exception '%', array_to_string(r.problems, '. ') using errcode = 'P0001';
  end if;
  new.days := r.days;
  return new;
end $$;

/**
 * Adds or replaces a document on a leave application afterwards ('main' = the leave type's document, 'followup' =
 * its follow-up one): the employee whose leave it is, or HR (Leave). The file must be in the company's folder (the
 * caller's own, unless HR).
 */
create or replace function public.attach_leave_document(p_leave uuid, p_kind text, p_path text, p_name text)
returns public.leave_application
language plpgsql security definer set search_path = public as $$
declare
  l public.leave_application;
begin
  select * into l from public.leave_application where id = p_leave and tenant_id = public.current_tenant_id();
  if l.id is null then
    raise exception 'No such leave application' using errcode = '22023';
  end if;
  if public.current_employee_number() is distinct from l."Employee Number" and not public.has_module('leaves') then
    raise exception 'Only the employee or HR can add documents to this leave' using errcode = '42501';
  end if;
  if p_kind not in ('main', 'followup') then
    raise exception 'Unknown document' using errcode = '22023';
  end if;
  if not public.leave_document_path_ok(l.tenant_id, p_path) then
    raise exception 'That document was not uploaded here; attach it again' using errcode = '42501';
  end if;
  if p_kind = 'main' then
    update public.leave_application
    set document_path = p_path, document_name = left(nullif(btrim(p_name), ''), 200), document_uploaded_at = now()
    where id = l.id returning * into l;
  else
    update public.leave_application
    set followup_document_path = p_path, followup_document_name = left(nullif(btrim(p_name), ''), 200), followup_uploaded_at = now()
    where id = l.id returning * into l;
  end if;
  return l;
end $$;
revoke all on function public.attach_leave_document(uuid, text, text, text) from public, anon;
grant execute on function public.attach_leave_document(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. the forms are told which document is needed
-- ---------------------------------------------------------------------------------------------
create or replace function public.leave_request_check(
  p_employee_number text, p_leave_type text, p_start text, p_end text, p_half boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_self boolean := public.current_employee_number() is not distinct from p_employee_number;
  r record;
begin
  if not v_self and not public.has_module('leaves') then
    raise exception 'You can only check your own leave' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees e where e.tenant_id = v_tenant and e."Employee Number" = p_employee_number) then
    raise exception 'No such employee' using errcode = '22023';
  end if;
  select * into r from public.leave_request_problems(v_tenant, p_employee_number, p_leave_type,
    public.leave_parse_date(p_start), public.leave_parse_date(p_end), v_self, null, coalesce(p_half, false));
  return jsonb_build_object('days', r.days, 'available', r.available, 'problems', to_jsonb(r.problems),
    'document', public.leave_document_needed(v_tenant, p_leave_type, r.days));
end $$;

-- each of the company's leave types and the documents it asks for, for the staff portal's leave history (staff can't
-- read leave_policies)
create or replace function public.leave_document_rules() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'leave_type', t.name, 'name', p.document_name, 'when', p.document_when, 'within_days', p.document_within_days,
    'if_longer_than', p.document_if_longer_than, 'followup_name', p.followup_document_name,
    'followup_within_days', p.followup_within_days) order by t.name), '[]'::jsonb)
  from public.leave_types t
  join public.current_leave_policies p on p.leave_type_id = t.id
  where t.tenant_id = public.current_tenant_id()
    and (p.document_name is not null or p.followup_document_name is not null)
$$;
revoke all on function public.leave_document_rules() from public, anon;
grant execute on function public.leave_document_rules() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. the bucket
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public) values ('leave-documents', 'leave-documents', false)
  on conflict (id) do update set public = false;

  drop policy if exists leave_documents_select on storage.objects;
  drop policy if exists leave_documents_insert on storage.objects;
  drop policy if exists leave_documents_delete on storage.objects;

  -- the uploader, HR, and anyone who can see an application the file is on (its approvers, by leave_application's RLS)
  create policy leave_documents_select on storage.objects for select to authenticated
    using (
      bucket_id = 'leave-documents'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and ((storage.foldername(name))[2] = (select auth.uid())::text
           or (select public.has_any_module('leaves'))
           or exists (select 1 from public.leave_application a
                      where a.document_path = storage.objects.name or a.followup_document_path = storage.objects.name))
    );

  create policy leave_documents_insert on storage.objects for insert to authenticated
    with check (
      bucket_id = 'leave-documents'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (storage.foldername(name))[2] = (select auth.uid())::text
    );

  create policy leave_documents_delete on storage.objects for delete to authenticated
    using (
      bucket_id = 'leave-documents'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (storage.foldername(name))[2] = (select auth.uid())::text
    );
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6. new companies' documents
-- ---------------------------------------------------------------------------------------------
create or replace function public.seed_default_leave_types(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.leave_types (tenant_id, name, description, is_deductible, is_continuous, icon)
  values
    (p_tenant, 'Annual Leave', 'Yearly leave, earned month by month (Employment Act: 21 working days)', true, true, 'Sun'),
    (p_tenant, 'Sick Leave', 'Time off when unwell, with a report from a registered medical practitioner', true, true, 'Heart'),
    (p_tenant, 'Compassionate Leave (immediate family)', 'Bereavement in the immediate family, per bereavement', true, true, 'HeartHandshake'),
    (p_tenant, 'Compassionate Leave (extended family)', 'Bereavement in the extended family, per bereavement', true, true, 'HeartHandshake'),
    (p_tenant, 'Maternity Leave', 'Three months for new mothers', false, true, 'Baby'),
    (p_tenant, 'Paternity Leave', 'Two weeks for new fathers', false, true, 'Baby'),
    (p_tenant, 'Adoption Leave', 'One month when adopting a child', false, true, 'Baby'),
    (p_tenant, 'Study/Exam Leave', 'Time off for study or examinations (optional: remove it if you don''t offer it)', true, true, 'book'),
    (p_tenant, 'Unpaid Leave', 'Leave without pay', true, true, 'calendar')
  on conflict (tenant_id, name) where tenant_id is not null do nothing;

  insert into public.leave_policies (tenant_id, leave_type_id, days_allotted, accrual_method, carry_forward_max_days,
                                     reminder_days_before_year_end, reminder_min_remaining, max_days_per_request,
                                     min_notice_days, count_days, service_months_before_use,
                                     document_name, followup_document_name, followup_within_days)
  select p_tenant, lt.id, v.days, v.method, 0, v.remind_days, v.remind_min, v.per_request, v.notice, v.count_days, v.service,
         v.document, v.followup, 30
  from public.leave_types lt
  join (values
    -- (name, days, method, remind days before year end, ...if this many left, most per application, notice, count,
    --  service months, document with the application, follow-up document)
    ('Annual Leave', 21::numeric, 'monthly_cumulative', 60, 14::numeric, null::numeric, 0, 'working', 2, null::text, null::text),
    ('Sick Leave', 14::numeric, 'annual', 0, 0::numeric, null::numeric, 0, 'working', 0,
      'Report from a registered medical practitioner stating the rest period', null::text),
    ('Compassionate Leave (immediate family)', null::numeric, 'none', 0, 0::numeric, 10::numeric, 0, 'working', 0, null::text, null::text),
    ('Compassionate Leave (extended family)', null::numeric, 'none', 0, 0::numeric, 3::numeric, 0, 'working', 0, null::text, null::text),
    ('Maternity Leave', 90::numeric, 'annual', 0, 0::numeric, null::numeric, 7, 'calendar', 0,
      'Medical report with the expected delivery date', 'Birth notification'),
    ('Paternity Leave', 14::numeric, 'annual', 0, 0::numeric, null::numeric, 0, 'calendar', 0, 'Birth notification', null::text),
    ('Adoption Leave', 30::numeric, 'annual', 0, 0::numeric, null::numeric, 0, 'calendar', 0,
      'Custody agreement from the adoption agency', null::text),
    ('Study/Exam Leave', 10::numeric, 'annual', 0, 0::numeric, null::numeric, 0, 'working', 0, null::text, null::text)
  ) as v(name, days, method, remind_days, remind_min, per_request, notice, count_days, service, document, followup) on v.name = lt.name
  where lt.tenant_id = p_tenant
    and not exists (select 1 from public.leave_policies p where p.leave_type_id = lt.id);
end;
$$;
revoke all on function public.seed_default_leave_types(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
