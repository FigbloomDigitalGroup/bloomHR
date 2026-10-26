-- Exit letters, drawn signatures and the archive of generated documents.
--
--   user_signatures         each person's drawn signature in this company (a PNG in the private "signatures" bucket,
--                           <company>/<login>/...). Only they read or change it; the app puts it on the letters they send.
--   generated_documents     every document the app makes (a letter sent or downloaded, ...): what, about whom, who
--                           made it, when, who it was emailed to, and the file's SHA-256. The PDF itself is kept in the
--                           private "generated-documents" bucket (<company>/<kind>/...). Nobody changes or deletes a
--                           row or its file; each row is also in the audit trail.
--   exit_letter_templates   each company's letters for exits (termination, non-confirmation after probation, accepting
--                           a resignation, ...): a title and a body with placeholders, as offer letters have.
--
-- Who: HR (the 'employees' or 'hr-lifecycle' module, as for exits) manages the templates and writes the letters; the
-- archive is read by HR and by Settings (with the audit trail), and each person reads what they made.

-- ---------------------------------------------------------------------------------------------
-- 1. signatures
-- ---------------------------------------------------------------------------------------------
create table if not exists public.user_signatures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  path text not null check (path <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

alter table public.user_signatures enable row level security;
drop policy if exists tenant_isolation on public.user_signatures;
create policy tenant_isolation on public.user_signatures as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists own on public.user_signatures;
create policy own on public.user_signatures for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and split_part(path, '/', 1) = tenant_id::text and split_part(path, '/', 2) = user_id::text);
revoke all on public.user_signatures from anon;

create or replace function public.user_signatures_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.user_id := old.user_id;
  new.tenant_id := old.tenant_id;
  return new;
end $$;
drop trigger if exists user_signatures_touch on public.user_signatures;
create trigger user_signatures_touch before update on public.user_signatures
  for each row execute function public.user_signatures_touch();

drop trigger if exists audit_user_signatures on public.user_signatures;
create trigger audit_user_signatures after insert or update or delete on public.user_signatures
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------------------------
-- 2. generated documents
-- ---------------------------------------------------------------------------------------------
create or replace function public.reads_generated_documents() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_any_module('employees', 'hr-lifecycle', 'settings')
$$;
revoke all on function public.reads_generated_documents() from public, anon;
grant execute on function public.reads_generated_documents() to authenticated;

create table if not exists public.generated_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  kind text not null check (kind ~ '^[a-z][a-z_]{1,39}$'),          -- exit_letter, offer_letter, ...
  title text not null check (char_length(btrim(title)) between 1 and 300),
  employee_number text,                                              -- whom it is about, when an employee
  reference_id uuid,                                                 -- the exit, offer, ... it belongs to
  file_path text not null check (file_path <> ''),
  file_size integer check (file_size >= 0),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  emailed_to text[] not null default '{}',
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists generated_documents_tenant_created on public.generated_documents (tenant_id, created_at desc);
create index if not exists generated_documents_reference on public.generated_documents (reference_id) where reference_id is not null;

alter table public.generated_documents enable row level security;
drop policy if exists tenant_isolation on public.generated_documents;
create policy tenant_isolation on public.generated_documents as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists hr_or_own_read on public.generated_documents;
create policy hr_or_own_read on public.generated_documents for select to authenticated
  using ((select public.reads_generated_documents()) or created_by = (select auth.uid()));
-- anyone signed in may record what they made, under their own name and in their company's folder
drop policy if exists record_own on public.generated_documents;
create policy record_own on public.generated_documents for insert to authenticated
  with check (created_by = (select auth.uid()) and split_part(file_path, '/', 1) = tenant_id::text);
revoke all on public.generated_documents from anon;

-- the record is the evidence: who made it and when is set here, and it never changes or goes away
create or replace function public.generated_documents_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    return new;
  end if;
  raise exception 'Generated documents are kept as they were made' using errcode = '42501';
end $$;
drop trigger if exists generated_documents_rules on public.generated_documents;
create trigger generated_documents_rules before insert or update or delete on public.generated_documents
  for each row execute function public.generated_documents_rules();

drop trigger if exists audit_generated_documents on public.generated_documents;
create trigger audit_generated_documents after insert on public.generated_documents
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------------------------
-- 3. the files: two private buckets
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public) values ('signatures', 'signatures', false)
  on conflict (id) do update set public = false;
  insert into storage.buckets (id, name, public) values ('generated-documents', 'generated-documents', false)
  on conflict (id) do update set public = false;
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute $u$update storage.buckets set file_size_limit = 1048576, allowed_mime_types = array['image/png'] where id = 'signatures'$u$;
    execute $u$update storage.buckets set file_size_limit = 20971520, allowed_mime_types = array['application/pdf'] where id = 'generated-documents'$u$;
  end if;

  drop policy if exists signatures_own_select on storage.objects;
  drop policy if exists signatures_own_insert on storage.objects;
  drop policy if exists signatures_own_delete on storage.objects;
  drop policy if exists generated_documents_select on storage.objects;
  drop policy if exists generated_documents_insert on storage.objects;

  -- a signature: only its owner, in <company>/<login>/
  create policy signatures_own_select on storage.objects for select to authenticated
    using (bucket_id = 'signatures'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (storage.foldername(name))[2] = (select auth.uid())::text);
  create policy signatures_own_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'signatures'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (storage.foldername(name))[2] = (select auth.uid())::text
      and array_length(storage.foldername(name), 1) = 2
      and lower(storage.filename(name)) like '%.png');
  create policy signatures_own_delete on storage.objects for delete to authenticated
    using (bucket_id = 'signatures'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (storage.foldername(name))[2] = (select auth.uid())::text);

  -- a generated document: added to the company's folder by whoever made it, read as its record is; never changed or
  -- removed (no update or delete policy)
  create policy generated_documents_select on storage.objects for select to authenticated
    using (bucket_id = 'generated-documents'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and ((select public.reads_generated_documents()) or owner = (select auth.uid())));
  create policy generated_documents_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'generated-documents'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and array_length(storage.foldername(name), 1) = 2
      and lower(storage.filename(name)) like '%.pdf');
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. exit letter templates
-- ---------------------------------------------------------------------------------------------
create table if not exists public.exit_letter_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body text not null check (char_length(btrim(body)) between 1 and 20000),
  is_default boolean not null default false,
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists exit_letter_templates_one_default on public.exit_letter_templates (tenant_id) where is_default;

alter table public.exit_letter_templates enable row level security;
drop policy if exists tenant_isolation on public.exit_letter_templates;
create policy tenant_isolation on public.exit_letter_templates as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists manage on public.exit_letter_templates;
create policy manage on public.exit_letter_templates for all to authenticated
  using ((select public.manages_exits())) with check ((select public.manages_exits()));
revoke all on public.exit_letter_templates from anon;

drop trigger if exists exit_letter_templates_touch on public.exit_letter_templates;
create trigger exit_letter_templates_touch before update on public.exit_letter_templates
  for each row execute function public.after_hiring_touch();

-- every company starts with three: a termination (the default), non-confirmation after probation, and accepting a
-- resignation; HR edits them or adds their own
create or replace function public.seed_exit_letter_templates(p_tenant uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.exit_letter_templates (tenant_id, title, body, is_default, created_by)
  select p_tenant, t.title, t.body, t.is_default, null
  from (values
    ('RE: TERMINATION OF EMPLOYMENT', $body$To: {{employee_name}}
Position: {{job_title}}

Dear {{first_name}},

This letter is to inform you that the company has decided to terminate your employment as {{job_title}} with {{company_name}}. Your employment will come to an end effective {{last_working_day}}.

This decision is made in accordance with the terms of your employment agreement and applicable labour laws.

You are required to complete any pending handover procedures and return all company property in your possession on or before {{last_working_day}}, your last working day.

Any outstanding salary and other dues will be processed in accordance with your employment terms and applicable employment laws.

We thank you for your service and wish you the very best in your future endeavours.

Yours sincerely,

{{signature}}
{{sender_name}}
{{sender_title}}
{{company_name}}$body$, true, 1),
    ('RE: NON-CONFIRMATION OF EMPLOYMENT', $body$To: {{employee_name}}
Position: {{job_title}}

Dear {{first_name}},

Following the completion of your probationary period, the company has reviewed your performance and overall suitability for the position.

After careful consideration, we regret to inform you that the company has decided NOT to confirm your employment or proceed with offering you a contract of employment. Consequently, your employment will come to an end effective {{last_working_day}}.

This decision follows the company's assessment of your suitability for the role and is made in accordance with the terms of your employment agreement and applicable labour laws.

You are required to complete any pending handover procedures and return all company property in your possession on or before {{last_working_day}}, your last working day.

Any outstanding salary due will be processed in accordance with your employment terms and applicable employment laws.

The company appreciates the time you have spent working with us during your probationary period and wishes you the very best in your future endeavours.

Yours sincerely,

{{signature}}
{{sender_name}}
{{sender_title}}
{{company_name}}$body$, false, 2),
    ('RE: ACCEPTANCE OF RESIGNATION', $body$To: {{employee_name}}
Position: {{job_title}}

Dear {{first_name}},

We acknowledge receipt of your resignation notice dated {{notice_given_on}} and accept your resignation from the position of {{job_title}}. Your last working day will be {{last_working_day}}.

Please complete any pending handover procedures and return all company property in your possession on or before your last working day.

Any outstanding salary and other dues will be processed in accordance with your employment terms and applicable employment laws.

We thank you for your contribution to {{company_name}} and wish you the very best in your future endeavours.

Yours sincerely,

{{signature}}
{{sender_name}}
{{sender_title}}
{{company_name}}$body$, false, 3)
  ) as t(title, body, is_default, n)
  where not exists (select 1 from public.exit_letter_templates e where e.tenant_id = p_tenant)
  order by t.n
$$;
revoke all on function public.seed_exit_letter_templates(uuid) from public, anon, authenticated;

select public.seed_exit_letter_templates(t.id) from public.tenants t;

create or replace function public.exit_letter_templates_for_new_company() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_exit_letter_templates(new.id);
  return new;
end $$;
drop trigger if exists exit_letter_templates_for_new_company on public.tenants;
create trigger exit_letter_templates_for_new_company after insert on public.tenants
  for each row execute function public.exit_letter_templates_for_new_company();

notify pgrst, 'reload schema';
