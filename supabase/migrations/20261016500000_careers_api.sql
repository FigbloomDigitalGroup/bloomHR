-- Careers API: each company lists its open jobs and takes applications on its own website (FIG-838).
--
-- Recruitment had one fixed careers link. Now every company has its own careers feed, read by the public API
-- (careers_routes.js: GET /api/careers/<slug>/jobs, POST .../jobs/<id>/apply), a hosted page (/careers/<slug>) and an
-- embed snippet for companies without developers:
--
--   careers_settings          per company: the public slug in those addresses (unique; starts from the company
--                             name; editable), the website origins allowed to call the API from a browser (CORS), and
--                             whether the salary range is shown
--   job_postings.is_public    "Show on careers page" (off by default): only open, public postings whose closing date
--                             hasn't passed are listed
--   job_applications.source   where an application came from ('careers_page' or 'careers_api')
--   careers_company(), careers_jobs(), careers_apply()
--                             what the API reads and writes. Only the server calls them (service role): it rate-limits
--                             and checks every request first. They return only what a job ad shows - never another
--                             company's data, never the salary unless the company shows it - and an application always
--                             lands in that job's first pipeline stage, with its history, and in HR's bell.
--
-- CVs go to the private resumes bucket (careers/<company id>/<random>.<ext>); a recruiter opens them as before.

-- ---------------------------------------------------------------------------------------------
-- 1. per company: slug, allowed origins, salary
-- ---------------------------------------------------------------------------------------------
create table if not exists public.careers_settings (
  tenant_id uuid primary key default public.current_tenant_id() references public.tenants(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  allowed_origins text[] not null default '{}',
  show_salary boolean not null default false,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index if not exists careers_settings_slug on public.careers_settings (slug);

alter table public.careers_settings enable row level security;
drop policy if exists tenant_isolation on public.careers_settings;
create policy tenant_isolation on public.careers_settings as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists settings_or_recruitment_read on public.careers_settings;
create policy settings_or_recruitment_read on public.careers_settings for select to authenticated
  using ((select public.has_any_module('settings', 'recruitment')));
drop policy if exists settings_insert on public.careers_settings;
create policy settings_insert on public.careers_settings for insert to authenticated
  with check ((select public.has_any_module('settings')));
drop policy if exists settings_update on public.careers_settings;
create policy settings_update on public.careers_settings for update to authenticated
  using ((select public.has_any_module('settings')))
  with check ((select public.has_any_module('settings')));
revoke all on public.careers_settings from anon;

-- "Acme Kenya Ltd." -> "acme-kenya-ltd"; never shorter than 3 characters
create or replace function public.careers_slugify(p_name text) returns text language sql immutable as $$
  select case when length(s) >= 3 then s else left(rtrim('careers-' || s, '-'), 50) end
  from (select btrim(left(btrim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'), '-'), 40), '-') as s) x
$$;

-- a free slug from the company name: "acme", else "acme-2", "acme-3"...
create or replace function public.careers_free_slug(p_name text, p_tenant uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_base text := public.careers_slugify(p_name);
  v_slug text := v_base;
  n integer := 1;
begin
  while exists (select 1 from public.careers_settings where slug = v_slug and tenant_id is distinct from p_tenant) loop
    n := n + 1;
    v_slug := left(v_base, 44) || '-' || n;
  end loop;
  return v_slug;
end $$;
revoke all on function public.careers_free_slug(text, uuid) from public, anon, authenticated;

-- Tidies what is saved: the slug in lower case, origins as scheme://host[:port] (no path, no trailing slash), each
-- once, at most 20. Who changed it and when.
create or replace function public.careers_settings_rules() returns trigger
language plpgsql set search_path = public as $$
declare
  o text;
  v_origins text[] := '{}';
begin
  new.slug := lower(btrim(new.slug));
  if new.slug !~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' then
    raise exception 'The careers address must be 3 to 50 letters, numbers or dashes, starting and ending with a letter or number';
  end if;
  foreach o in array coalesce(new.allowed_origins, '{}') loop
    o := regexp_replace(lower(btrim(o)), '/+$', '');
    continue when o = '';
    if o !~ '^https?://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$' then
      raise exception 'Not a website address: % (use the form https://www.example.com)', o;
    end if;
    if not o = any(v_origins) then
      v_origins := v_origins || o;
    end if;
  end loop;
  if cardinality(v_origins) > 20 then
    raise exception 'At most 20 websites can use the careers API';
  end if;
  new.allowed_origins := v_origins;
  if tg_op = 'UPDATE' then
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists careers_settings_rules on public.careers_settings;
create trigger careers_settings_rules before insert or update on public.careers_settings
  for each row execute function public.careers_settings_rules();

-- every company has its settings: existing ones from their profile name (else account name), new ones when created
insert into public.careers_settings (tenant_id, slug)
select t.id, public.careers_free_slug(coalesce((select p.company_name from public.company_profile p where p.tenant_id = t.id), t.name), t.id)
from public.tenants t
where not exists (select 1 from public.careers_settings c where c.tenant_id = t.id)
order by t.created_at;

create or replace function public.careers_settings_for_new_company() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.careers_settings (tenant_id, slug)
  values (new.id, public.careers_free_slug(new.name, new.id))
  on conflict (tenant_id) do nothing;
  return null;
end $$;
drop trigger if exists careers_settings_for_new_company on public.tenants;
create trigger careers_settings_for_new_company after insert on public.tenants
  for each row execute function public.careers_settings_for_new_company();

-- ---------------------------------------------------------------------------------------------
-- 2. which postings are public; where applications came from
-- ---------------------------------------------------------------------------------------------
alter table public.job_postings add column if not exists is_public boolean not null default false;
create index if not exists job_postings_public on public.job_postings (tenant_id, posted_at desc) where is_public;

alter table public.job_applications add column if not exists source text;
alter table public.job_applications drop constraint if exists job_applications_source_check;
alter table public.job_applications add constraint job_applications_source_check
  check (source is null or length(source) <= 40);

-- ---------------------------------------------------------------------------------------------
-- 3. HR hears of a new application (the admin bell; never emailed to anyone as an employee notification)
-- ---------------------------------------------------------------------------------------------
alter table public.hr_notifications drop constraint if exists hr_notifications_notification_type_check;
alter table public.hr_notifications add constraint hr_notifications_notification_type_check check (notification_type in (
  'contract_expiring', 'probation_expiring', 'leave_recommended', 'leave_approved', 'leave_rejected', 'leave_year_end_reminder',
  'document_accepted', 'document_rejected', 'onboarding_approved', 'onboarding_changes_requested', 'photo_removed',
  'document_requested',
  'salary_advance_approved', 'salary_advance_rejected', 'salary_advance_paid', 'loan_approved', 'loan_rejected',
  'payslip_ready', 'salary_paid', 'expense_approved', 'expense_rejected', 'phone_change_approved', 'phone_change_rejected',
  'incident_update', 'warning_issued', 'suspended', 'reactivated', 'employment_update', 'leave_scheduled', 'policy_to_accept',
  'task_assigned', 'asset_assigned',
  -- from the approval workflows (20261015800000): every type added since must stay in this list
  'approval_needed', 'approval_progress',
  'exit_requested', 'exit_approved', 'exit_declined',
  'application_received'
));

create or replace function public.hr_only_notification(p_type text) returns boolean language sql immutable as $$
  select p_type in ('contract_expiring', 'probation_expiring', 'leave_recommended', 'exit_requested', 'application_received')
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. what the public API reads and writes (server only)
-- ---------------------------------------------------------------------------------------------
-- The company behind a slug, with its brand. Nothing for an unknown slug or a suspended company.
create or replace function public.careers_company(p_slug text)
returns table (
  tenant_id uuid, slug text, company_name text, tagline text, logo_url text, primary_color text, secondary_color text,
  website text, description text, allowed_origins text[], show_salary boolean
)
language sql stable security definer set search_path = public as $$
  select c.tenant_id, c.slug, coalesce(p.company_name, t.name), p.tagline, p.logo_url, p.primary_color, p.secondary_color,
         p.website, p.description, c.allowed_origins, c.show_salary
  from public.careers_settings c
  join public.tenants t on t.id = c.tenant_id and t.status = 'active'
  left join public.company_profile p on p.tenant_id = c.tenant_id
  where c.slug = lower(btrim(p_slug))
$$;
revoke all on function public.careers_company(text) from public, anon, authenticated;
grant execute on function public.careers_company(text) to service_role;

-- A company's listed jobs (or one of them): open, shown on the careers page, not past their closing date. Only the
-- fields of a job ad; the salary only when the company shows it.
create or replace function public.careers_jobs(p_tenant uuid, p_job uuid default null)
returns table (
  id uuid, title text, department text, location text, employment_type text, job_level text, description text,
  requirements text, responsibilities text, benefits text, salary text, closing_date date, posted_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select j.id, j.job_title, j.department, j.location, j.job_type, j.job_level, j.description,
         j.requirements, j.responsibilities, j.benefits,
         case when coalesce((select c.show_salary from public.careers_settings c where c.tenant_id = p_tenant), false)
              then nullif(btrim(j.salary_range), '') end,
         j.application_deadline, coalesce(j.posted_at, j.created_at)
  from public.job_postings j
  where p_tenant is not null and j.tenant_id = p_tenant and j.is_public
    and lower(coalesce(j.status, '')) = 'open'
    and (j.application_deadline is null or j.application_deadline >= current_date)
    and (p_job is null or j.id = p_job)
  order by coalesce(j.posted_at, j.created_at) desc nulls last, j.job_title
$$;
revoke all on function public.careers_jobs(uuid, uuid) from public, anon, authenticated;
grant execute on function public.careers_jobs(uuid, uuid) to service_role;

-- An application from the careers API, for a listed job of that company. The pipeline's triggers put it in the job's
-- first stage and record that in its history; HR gets a bell notification. The same email applying to the same job
-- again adds nothing (the caller still answers with the same neutral message). Returns the application.
create or replace function public.careers_apply(
  p_tenant uuid, p_job uuid, p_first_name text, p_last_name text, p_email text, p_phone text, p_cover_note text,
  p_answers jsonb, p_resume_path text, p_resume_name text, p_source text default 'careers_api'
) returns table (application_id uuid, duplicate boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_job record;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(concat_ws(' ', btrim(p_first_name), nullif(btrim(p_last_name), '')));
  v_answers text;
  v_id uuid;
begin
  select * into v_job from public.careers_jobs(p_tenant, p_job);
  if v_job.id is null then
    raise exception 'careers: this job is not open for applications' using errcode = 'P0002';
  end if;

  if coalesce(length(btrim(p_first_name)), 0) not between 1 and 80 or coalesce(length(p_last_name), 0) > 80 then
    raise exception 'careers: a name of up to 80 characters is required' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'careers: a valid email is required' using errcode = '22023';
  end if;
  if p_phone is not null and btrim(p_phone) <> '' and btrim(p_phone) !~ '^\+?[0-9][0-9 ()-]{5,24}$' then
    raise exception 'careers: not a phone number' using errcode = '22023';
  end if;
  if coalesce(length(p_cover_note), 0) > 5000 then
    raise exception 'careers: the cover note is too long' using errcode = '22023';
  end if;
  if p_resume_path is null or p_resume_path !~ ('^careers/' || p_tenant::text || '/[0-9a-f-]{36}\.(pdf|doc|docx)$') then
    raise exception 'careers: a CV is required' using errcode = '22023';
  end if;
  if p_answers is not null and (jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) > 20
     or length(p_answers::text) > 20000) then
    raise exception 'careers: too many answers' using errcode = '22023';
  end if;

  -- one application per person per job (concurrent duplicates queue here)
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || '/careers/' || p_job::text || '/' || v_email, 0));
  select a.id into v_id from public.job_applications a
  where a.tenant_id = p_tenant and a.job_posting_id = p_job and lower(btrim(a.email)) = v_email
  limit 1;
  if v_id is not null then
    return query select v_id, true;
    return;
  end if;

  select string_agg(btrim(coalesce(e ->> 'question', 'Question')) || E'\n' || btrim(coalesce(e ->> 'answer', '')), E'\n\n')
  into v_answers
  from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) e
  where jsonb_typeof(e) = 'object' and btrim(coalesce(e ->> 'answer', '')) <> '';

  insert into public.job_applications (
    tenant_id, job_posting_id, first_name, last_name, email, phone, cover_letter, additional_info,
    resume_file_url, resume_file_name, position, department, preferred_location, status, source, applied_at
  ) values (
    p_tenant, p_job, btrim(p_first_name), nullif(btrim(p_last_name), ''), v_email, nullif(btrim(p_phone), ''),
    nullif(btrim(p_cover_note), ''), v_answers, p_resume_path, left(nullif(btrim(p_resume_name), ''), 200),
    v_job.title, v_job.department, v_job.location, 'pending', left(coalesce(p_source, 'careers_api'), 40), now()
  ) returning id into v_id;

  insert into public.hr_notifications
    (tenant_id, employee_number, employee_name, notification_type, title, message, is_read_staff, email_sent)
  values (p_tenant, '', v_name, 'application_received', 'New application',
    v_name || ' applied for ' || v_job.title || ' on your careers page.', true, true);

  return query select v_id, false;
end $$;
revoke all on function public.careers_apply(uuid, uuid, text, text, text, text, text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.careers_apply(uuid, uuid, text, text, text, text, text, jsonb, text, text, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. CVs: a recruiter opens a careers-site CV by its stored path; the bucket takes at most 5 MB a file
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  drop policy if exists resumes_select on storage.objects;
  create policy resumes_select on storage.objects for select to authenticated
    using (
      bucket_id = 'resumes'
      and (select public.has_any_module('recruitment'))
      and exists (
        select 1 from public.job_applications ja
        where storage.objects.name = 'public/' || ja.resume_file_name
           -- the careers API stores the path itself (careers/<company id>/<file>)
           or storage.objects.name = ja.resume_file_url
           -- the stored link ends in /resumes/<path> (before any ?query); compared exactly, not with LIKE wildcards
           or right(split_part(ja.resume_file_url, '?', 1), length(storage.objects.name) + 9) = '/resumes/' || storage.objects.name
      )
    );

  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute $q$update storage.buckets set file_size_limit = 5242880 where id = 'resumes'$q$;
  end if;
end $$;

notify pgrst, 'reload schema';
