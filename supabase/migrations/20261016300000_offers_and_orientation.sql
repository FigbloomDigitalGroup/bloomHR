-- After hiring: offer letters, orientation checklists, required training and tests (FIG-831).
--
-- "Onboarding after qualifying: offer letter, training, orientation, exams, tests". HR (ADMIN, or the Employees or
-- Recruitment module: manages_hiring()) now:
--
--   1. Offer letters
--      offer_letter_templates   each company's letter templates: a title and a body with placeholders
--                               ({{candidate_name}}, {{job_title}}, {{start_date}}, {{basic_salary}}, ...; the app fills
--                               them, src/lib/offers.ts). Every company gets one default template.
--      job_offers               an offer to a candidate (optionally from a job application): name, email, job title, job
--                               group, pay, start date and expiry, and the letter's text (copied from the template, so
--                               HR can edit it). Choosing a job group fills the pay from the group's current rate.
--                               draft -> sent -> accepted | declined | expired, and draft/sent -> withdrawn. Only a draft
--                               can be edited; the status moves only through the functions below.
--      send_offer()             makes a link token for the candidate (only its hash is kept, like invitations; sending
--                               again replaces the link) and marks the offer sent. The app emails the link (/offer?token=).
--      offer_by_token()         the public page: the one offer that token opens, with the company's name, logo and
--                               colours. respond_to_offer() accepts or declines it (once, before it expires).
--      add_offer_employee()     after acceptance HR adds the candidate as an employee (a draft onboarding record); the
--                               app then queues their staff invite (enqueue_invitations).
--   2. Orientation checklists: templates (items with an owner, hr / manager / employee, and a due day counted from the
--      start date) copied to an employee as their checklist. A new employee gets the template for their job title, or
--      the company's default one, as soon as they are added; HR can assign another. HR ticks any item, the employee
--      the ones that are theirs.
--   3. Required training: training videos or documents required for new employees (all, or one job title) within a
--      number of days of starting. Completion is read from training_progress.
--   4. Tests: multiple-choice quizzes with a pass mark, assigned to new employees (automatically by job title, or by
--      hand). The employee takes it in the staff portal: the answers are marked here, never sent to the browser, and
--      the score kept. One attempt; HR can allow another.
--
-- after_hiring() is what the onboarding page and the staff portal show for one employee; after_hiring_summary() the
-- progress of everyone for the onboarding list.

-- ---------------------------------------------------------------------------------------------
-- 0. who manages hiring
-- ---------------------------------------------------------------------------------------------
create or replace function public.manages_hiring() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_any_module('employees', 'recruitment')
$$;
revoke all on function public.manages_hiring() from public, anon;
grant execute on function public.manages_hiring() to authenticated;

-- an employee's start date ("Start Date" is text): null when it is blank or not a date
create or replace function public.employee_start_date(p_start text) returns date
language plpgsql immutable as $$
begin
  if p_start ~ '^\s*\d{4}-\d{2}-\d{2}' then
    return substring(btrim(p_start) from 1 for 10)::date;
  end if;
  return null;
exception when others then
  return null;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 1. tables
-- ---------------------------------------------------------------------------------------------
create table if not exists public.offer_letter_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body text not null check (char_length(btrim(body)) between 1 and 20000),
  is_default boolean not null default false,
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id)
);
create unique index if not exists offer_letter_templates_one_default on public.offer_letter_templates (tenant_id) where is_default;

create table if not exists public.job_offers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  application_id uuid references public.job_applications(id) on delete set null,
  template_id uuid,
  candidate_first_name text not null check (char_length(btrim(candidate_first_name)) between 1 and 100),
  candidate_last_name text check (char_length(candidate_last_name) <= 100),
  candidate_email text check (candidate_email is null or candidate_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  job_title text not null check (char_length(btrim(job_title)) between 1 and 200),
  job_group_id uuid,
  basic_salary numeric(14, 2) not null default 0 check (basic_salary >= 0),
  house_allowance numeric(14, 2) not null default 0 check (house_allowance >= 0),
  travel_allowance numeric(14, 2) not null default 0 check (travel_allowance >= 0),
  other_allowances numeric(14, 2) not null default 0 check (other_allowances >= 0),
  start_date date,
  expiry_date date,
  title text not null default 'Offer of employment' check (char_length(btrim(title)) between 1 and 200),
  body text not null check (char_length(btrim(body)) between 1 and 20000),
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined', 'expired', 'withdrawn')),
  token_hash text unique,
  sent_at timestamptz,
  viewed_at timestamptz,
  responded_at timestamptz,
  decline_reason text check (char_length(decline_reason) <= 1000),
  employee_id uuid references public.employees(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (template_id, tenant_id) references public.offer_letter_templates (id, tenant_id) on delete set null (template_id),
  foreign key (job_group_id, tenant_id) references public.job_groups (id, tenant_id) on delete set null (job_group_id),
  check (expiry_date is null or start_date is null or expiry_date <= start_date + 365)
);
create index if not exists job_offers_tenant on public.job_offers (tenant_id, created_at desc);
create index if not exists job_offers_employee on public.job_offers (employee_id) where employee_id is not null;

create table if not exists public.orientation_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  -- given to new employees with this job title (ignoring case); the default one to everyone else
  job_title text check (job_title is null or char_length(btrim(job_title)) between 1 and 200),
  is_default boolean not null default false,
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id)
);
create unique index if not exists orientation_templates_one_default on public.orientation_templates (tenant_id) where is_default;

create table if not exists public.orientation_template_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  template_id uuid not null,
  position integer not null default 0,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 1000),
  owner_role text not null default 'hr' check (owner_role in ('hr', 'manager', 'employee')),
  due_offset_days integer not null default 0 check (due_offset_days between -90 and 365),
  foreign key (template_id, tenant_id) references public.orientation_templates (id, tenant_id) on delete cascade
);
create index if not exists orientation_template_items_template on public.orientation_template_items (template_id, position);

create table if not exists public.employee_orientation_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  template_id uuid references public.orientation_templates(id) on delete set null,
  position integer not null default 0,
  title text not null,
  description text,
  owner_role text not null check (owner_role in ('hr', 'manager', 'employee')),
  due_date date,
  done_at timestamptz,
  done_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists employee_orientation_items_employee on public.employee_orientation_items (employee_id, position);
create index if not exists employee_orientation_items_tenant on public.employee_orientation_items (tenant_id);

create table if not exists public.required_training (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  item_kind text not null check (item_kind in ('video', 'document')),
  item_id uuid not null,
  -- everyone new when null, else new employees with this job title (ignoring case)
  job_title text check (job_title is null or char_length(btrim(job_title)) between 1 and 200),
  due_days integer not null default 30 check (due_days between 0 and 365),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists required_training_unique
  on public.required_training (tenant_id, item_kind, item_id, lower(btrim(coalesce(job_title, ''))));

create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 2000),
  pass_mark integer not null default 70 check (pass_mark between 0 and 100),   -- percent
  -- given to every new employee (job_title null) or those with this job title, when auto_assign
  auto_assign boolean not null default false,
  job_title text check (job_title is null or char_length(btrim(job_title)) between 1 and 200),
  due_days integer not null default 14 check (due_days between 0 and 365),
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id)
);

create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  quiz_id uuid not null,
  position integer not null default 0,
  question text not null check (char_length(btrim(question)) between 1 and 1000),
  options text[] not null check (cardinality(options) between 2 and 8),
  correct_index integer not null check (correct_index >= 0 and correct_index < cardinality(options)),
  foreign key (quiz_id, tenant_id) references public.quizzes (id, tenant_id) on delete cascade
);
create index if not exists quiz_questions_quiz on public.quiz_questions (quiz_id, position);

create table if not exists public.quiz_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  quiz_id uuid not null,
  employee_id uuid not null references public.employees(id) on delete cascade,
  due_date date,
  assigned_by uuid default auth.uid() references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  attempts integer not null default 0,
  submitted_at timestamptz,
  answers integer[],
  correct_count integer,
  question_count integer,
  score integer check (score between 0 and 100),
  passed boolean,
  foreign key (quiz_id, tenant_id) references public.quizzes (id, tenant_id) on delete cascade,
  unique (quiz_id, employee_id)
);
create index if not exists quiz_assignments_employee on public.quiz_assignments (employee_id);
create index if not exists quiz_assignments_tenant on public.quiz_assignments (tenant_id);

-- ---------------------------------------------------------------------------------------------
-- 2. access: HR manages everything; an employee reads their own checklist and test results (the rest through the
--    functions below). The offer token page is reached only through offer_by_token().
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['offer_letter_templates', 'job_offers', 'orientation_templates', 'orientation_template_items',
                           'employee_orientation_items', 'required_training', 'quizzes', 'quiz_questions', 'quiz_assignments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format($p$create policy tenant_isolation on public.%I as restrictive for all
      using (tenant_id = (select public.current_tenant_id()))
      with check (tenant_id = (select public.current_tenant_id()))$p$, t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
  -- set up freely by HR
  foreach t in array array['offer_letter_templates', 'job_offers', 'orientation_templates', 'orientation_template_items',
                           'required_training', 'quizzes', 'quiz_questions'] loop
    execute format('drop policy if exists manage on public.%I', t);
    execute format($p$create policy manage on public.%I for all to authenticated
      using ((select public.manages_hiring())) with check ((select public.manages_hiring()))$p$, t);
  end loop;
  -- an employee's checklist and tests: written by the functions below; HR reads (and may remove) them, the employee
  -- reads their own
  foreach t in array array['employee_orientation_items', 'quiz_assignments'] loop
    execute format('drop policy if exists hr_read on public.%I', t);
    execute format($p$create policy hr_read on public.%I for select to authenticated using ((select public.manages_hiring()))$p$, t);
    execute format('drop policy if exists hr_delete on public.%I', t);
    execute format($p$create policy hr_delete on public.%I for delete to authenticated using ((select public.manages_hiring()))$p$, t);
    execute format('drop policy if exists own_read on public.%I', t);
    execute format($p$create policy own_read on public.%I for select to authenticated
      using (employee_id = (select public.current_employee_id()))$p$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. offer letter templates: one default per company
-- ---------------------------------------------------------------------------------------------
create or replace function public.default_offer_letter_body() returns text
language sql immutable as $$
  select $body$Dear {{candidate_name}},

We are pleased to offer you the position of {{job_title}} at {{company_name}}. Your employment will start on {{start_date}}.

Your monthly basic salary will be {{basic_salary}}, with allowances of {{allowances}} a month (job group: {{job_group}}). Your pay is subject to the statutory deductions (PAYE, NSSF, SHIF and the Housing Levy).

This offer depends on satisfactory references and on the documents we will ask for when you join. The full terms of your employment will be set out in your contract.

Please accept or decline this offer by {{expiry_date}} using the buttons below this letter. We look forward to welcoming you to {{company_name}}.

Yours sincerely,

{{company_name}}$body$
$$;

create or replace function public.seed_offer_letter_template(p_tenant uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.offer_letter_templates (tenant_id, title, body, is_default, created_by)
  select p_tenant, 'Offer of employment', public.default_offer_letter_body(), true, null
  where not exists (select 1 from public.offer_letter_templates o where o.tenant_id = p_tenant)
$$;
revoke all on function public.seed_offer_letter_template(uuid) from public, anon, authenticated;

select public.seed_offer_letter_template(t.id) from public.tenants t;

create or replace function public.offer_template_for_new_company() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_offer_letter_template(new.id);
  return new;
end $$;
drop trigger if exists offer_template_for_new_company on public.tenants;
create trigger offer_template_for_new_company after insert on public.tenants
  for each row execute function public.offer_template_for_new_company();

create or replace function public.after_hiring_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['offer_letter_templates', 'job_offers', 'orientation_templates', 'quizzes'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.after_hiring_touch()', t || '_touch', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. offers: the rules on every save
-- ---------------------------------------------------------------------------------------------
create or replace function public.job_offers_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  moving boolean := coalesce(current_setting('app.offer_transition', true), '') = 'on';
  r public.job_group_rates;
begin
  if tg_op = 'DELETE' then
    if old.status in ('sent', 'accepted') and not moving then
      raise exception 'A sent or accepted offer can''t be deleted; withdraw it instead' using errcode = '42501';
    end if;
    return old;
  end if;

  if not moving then
    if tg_op = 'INSERT' then
      if new.status <> 'draft' or new.token_hash is not null or new.sent_at is not null or new.responded_at is not null
         or new.employee_id is not null or new.viewed_at is not null or new.decline_reason is not null then
        raise exception 'A new offer starts as a draft' using errcode = '42501';
      end if;
    else
      -- the employee, template or job group it points to was removed (the foreign keys clear the link)
      if (new.employee_id is null or new.employee_id = old.employee_id)
         and (new.template_id is null or new.template_id = old.template_id)
         and (new.job_group_id is null or new.job_group_id = old.job_group_id)
         and to_jsonb(new) - array['employee_id', 'template_id', 'job_group_id', 'updated_at']
             = to_jsonb(old) - array['employee_id', 'template_id', 'job_group_id', 'updated_at']
         and (old.status <> 'draft' or new.job_group_id is not distinct from old.job_group_id) then
        return new;
      end if;
      if old.status <> 'draft' then
        raise exception 'This offer is % and can no longer be changed', old.status using errcode = '42501';
      end if;
      if new.status is distinct from old.status or new.token_hash is distinct from old.token_hash
         or new.sent_at is distinct from old.sent_at or new.responded_at is distinct from old.responded_at
         or new.viewed_at is distinct from old.viewed_at or new.decline_reason is distinct from old.decline_reason
         or new.employee_id is distinct from old.employee_id or new.tenant_id is distinct from old.tenant_id then
        raise exception 'Send, withdraw or answer an offer with its buttons' using errcode = '42501';
      end if;
    end if;
  end if;

  new.candidate_first_name := btrim(new.candidate_first_name);
  new.candidate_last_name := nullif(btrim(new.candidate_last_name), '');
  new.candidate_email := nullif(lower(btrim(new.candidate_email)), '');
  new.job_title := btrim(new.job_title);

  if new.application_id is not null and (tg_op = 'INSERT' or new.application_id is distinct from old.application_id)
     and not exists (select 1 from public.job_applications a where a.id = new.application_id and a.tenant_id = new.tenant_id) then
    raise exception 'That job application is not in your company' using errcode = '42501';
  end if;

  -- a job group's current rate fills the pay (a band keeps the salary typed, moved into the band)
  if new.status = 'draft' and new.job_group_id is not null
     and (tg_op = 'INSERT' or new.job_group_id is distinct from old.job_group_id or new.basic_salary is distinct from old.basic_salary) then
    r := public.job_group_rate_on(new.job_group_id, current_date);
    if r.id is not null then
      new.basic_salary := coalesce(r.basic_salary, least(greatest(coalesce(nullif(new.basic_salary, 0), r.basic_min), r.basic_min), r.basic_max));
      new.house_allowance := r.house_allowance;
      new.travel_allowance := r.travel_allowance;
      new.other_allowances := r.other_allowances;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists job_offers_rules on public.job_offers;
create trigger job_offers_rules before insert or update or delete on public.job_offers
  for each row execute function public.job_offers_rules();

-- the offer HR may act on (in their company)
create or replace function public.hiring_offer(p_offer uuid) returns public.job_offers
language plpgsql stable security definer set search_path = public as $$
declare o public.job_offers;
begin
  if auth.uid() is null or not public.manages_hiring() then
    raise exception 'Only HR can do this' using errcode = '42501';
  end if;
  select * into o from public.job_offers where id = p_offer and tenant_id = public.current_tenant_id();
  if o.id is null then
    raise exception 'Offer not found' using errcode = 'P0002';
  end if;
  return o;
end $$;
revoke all on function public.hiring_offer(uuid) from public, anon, authenticated;

/**
 * Sends (or sends again) an offer: checks it is complete, makes a new link token (the old link stops working) and
 * marks it sent. Returns the token, which is not stored: the app puts it in the email's link.
 */
create or replace function public.send_offer(p_offer uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  o public.job_offers := public.hiring_offer(p_offer);
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if o.status not in ('draft', 'sent') then
    raise exception 'This offer is % and can''t be sent', o.status using errcode = '22023';
  end if;
  if o.candidate_email is null then
    raise exception 'Add the candidate''s email first' using errcode = '23514';
  end if;
  if o.start_date is null then
    raise exception 'Add the start date first' using errcode = '23514';
  end if;
  if o.expiry_date is null or o.expiry_date < current_date then
    raise exception 'Choose an expiry date from today on' using errcode = '23514';
  end if;
  perform set_config('app.offer_transition', 'on', true);
  update public.job_offers set status = 'sent', token_hash = public.hash_invite_token(v_token), sent_at = now()
  where id = o.id;
  perform set_config('app.offer_transition', '', true);
  return v_token;
end $$;
revoke all on function public.send_offer(uuid) from public, anon;
grant execute on function public.send_offer(uuid) to authenticated;

-- takes back a draft or sent offer; its link stops working
create or replace function public.withdraw_offer(p_offer uuid) returns text
language plpgsql security definer set search_path = public as $$
declare o public.job_offers := public.hiring_offer(p_offer);
begin
  if o.status not in ('draft', 'sent') then
    raise exception 'This offer is % and can''t be withdrawn', o.status using errcode = '22023';
  end if;
  perform set_config('app.offer_transition', 'on', true);
  update public.job_offers set status = 'withdrawn', token_hash = null where id = o.id;
  perform set_config('app.offer_transition', '', true);
  return 'withdrawn';
end $$;
revoke all on function public.withdraw_offer(uuid) from public, anon;
grant execute on function public.withdraw_offer(uuid) to authenticated;

-- sent offers past their expiry date (every day; the screens also treat them as expired straight away)
create or replace function public.expire_job_offers() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform set_config('app.offer_transition', 'on', true);
  update public.job_offers set status = 'expired' where status = 'sent' and expiry_date < current_date;
  get diagnostics n = row_count;
  perform set_config('app.offer_transition', '', true);
  return n;
end $$;
revoke all on function public.expire_job_offers() from public, anon, authenticated;

/**
 * The public offer page: the one offer this token opens (anyone with the link, signed in or not), with the company's
 * name, logo, colours and contact details. Nothing else is reachable with the token. Null when the link is not valid
 * (unknown, replaced by a newer one, or the offer was withdrawn).
 */
create or replace function public.offer_by_token(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o public.job_offers;
  c public.company_profile;
  v_company text;
  v_group text;
begin
  if coalesce(length(p_token), 0) < 32 then
    return null;
  end if;
  select * into o from public.job_offers where token_hash = public.hash_invite_token(p_token);
  if o.id is null then
    return null;
  end if;
  if o.viewed_at is null then
    perform set_config('app.offer_transition', 'on', true);
    update public.job_offers set viewed_at = now() where id = o.id;
    perform set_config('app.offer_transition', '', true);
  end if;
  select * into c from public.company_profile where tenant_id = o.tenant_id;
  v_company := coalesce(c.company_name, (select t.name from public.tenants t where t.id = o.tenant_id));
  select j.name into v_group from public.job_groups j where j.id = o.job_group_id;
  return jsonb_build_object(
    'title', o.title,
    'body', o.body,
    'candidate_first_name', o.candidate_first_name,
    'candidate_last_name', o.candidate_last_name,
    'job_title', o.job_title,
    'job_group', v_group,
    'basic_salary', o.basic_salary,
    'house_allowance', o.house_allowance,
    'travel_allowance', o.travel_allowance,
    'other_allowances', o.other_allowances,
    'start_date', o.start_date,
    'expiry_date', o.expiry_date,
    'sent_at', o.sent_at,
    'status', case when o.status = 'sent' and o.expiry_date < current_date then 'expired' else o.status end,
    'responded_at', o.responded_at,
    'company', jsonb_build_object(
      'name', v_company, 'logo_url', c.logo_url, 'tagline', c.tagline,
      'primary_color', c.primary_color, 'secondary_color', c.secondary_color,
      'address_line1', c.address_line1, 'address_line2', c.address_line2, 'city', c.city, 'postal_code', c.postal_code,
      'country', c.country, 'phone', c.official_phone, 'email', c.official_email, 'website', c.website)
  );
end $$;
revoke all on function public.offer_by_token(text) from public;
grant execute on function public.offer_by_token(text) to anon, authenticated;

-- the candidate accepts or declines (with an optional reason), once, while the offer is open
create or replace function public.respond_to_offer(p_token text, p_accept boolean, p_reason text default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  o public.job_offers;
  v_status text := case when p_accept then 'accepted' else 'declined' end;
begin
  if p_accept is null then
    raise exception 'Accept or decline the offer' using errcode = '22023';
  end if;
  select * into o from public.job_offers
  where coalesce(length(p_token), 0) >= 32 and token_hash = public.hash_invite_token(p_token)
  for update;
  if o.id is null then
    raise exception 'This offer link is not valid' using errcode = 'P0002';
  end if;
  if o.status in ('accepted', 'declined') then
    raise exception 'You have already % this offer', o.status using errcode = '22023';
  end if;
  if o.status = 'expired' or (o.status = 'sent' and o.expiry_date < current_date) then
    raise exception 'This offer expired on %', to_char(o.expiry_date, 'FMDD FMMonth YYYY') using errcode = '22023';
  end if;
  if o.status <> 'sent' then
    raise exception 'This offer is no longer open' using errcode = '22023';
  end if;
  perform set_config('app.offer_transition', 'on', true);
  update public.job_offers set status = v_status, responded_at = now(),
    decline_reason = case when p_accept then null else left(nullif(btrim(p_reason), ''), 1000) end
  where id = o.id;
  perform set_config('app.offer_transition', '', true);
  return v_status;
end $$;
revoke all on function public.respond_to_offer(text, boolean, text) from public;
grant execute on function public.respond_to_offer(text, boolean, text) to anon, authenticated;

/**
 * After the candidate accepted: adds them as an employee (a draft onboarding record with their names, job title, job
 * group, pay and start date; the work email given, else the email the offer went to) and links the offer to it. The
 * employee gets their orientation checklist and tests as any new employee does. Needs the Employees module. The app
 * then queues their invitation to the staff portal.
 */
create or replace function public.add_offer_employee(p_offer uuid, p_work_email text default null)
returns table (employee_id uuid, employee_number text, work_email text)
language plpgsql security definer set search_path = public as $$
declare
  o public.job_offers := public.hiring_offer(p_offer);
  v_email text := lower(btrim(coalesce(nullif(btrim(p_work_email), ''), o.candidate_email)));
  v_id uuid;
  v_number text;
begin
  if not public.has_module('employees') then
    raise exception 'Only people who manage employees can add one' using errcode = '42501';
  end if;
  if o.status <> 'accepted' then
    raise exception 'Only an accepted offer can be added as an employee' using errcode = '22023';
  end if;
  if o.employee_id is not null then
    raise exception 'This candidate has already been added as an employee' using errcode = '22023';
  end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Give a valid work email' using errcode = '23514';
  end if;
  if exists (select 1 from public.employees e where e.tenant_id = o.tenant_id and lower(btrim(e."Work Email")) = v_email) then
    raise exception 'An employee with the work email % already exists', v_email using errcode = '23505';
  end if;

  insert into public.employees ("First Name", "Last Name", "Work Email", "Personal Email", "Job Title", "Start Date",
    job_group_id, "Basic Salary", house_allowance, travel_allowance, other_cash_allowances, tenant_id)
  values (o.candidate_first_name, o.candidate_last_name, v_email, o.candidate_email, o.job_title, o.start_date::text,
    o.job_group_id, o.basic_salary, o.house_allowance, o.travel_allowance, o.other_allowances, o.tenant_id)
  returning id, "Employee Number" into v_id, v_number;

  perform set_config('app.offer_transition', 'on', true);
  update public.job_offers set employee_id = v_id where id = o.id;
  perform set_config('app.offer_transition', '', true);
  return query select v_id, v_number, v_email;
end $$;
revoke all on function public.add_offer_employee(uuid, text) from public, anon;
grant execute on function public.add_offer_employee(uuid, text) to authenticated;

-- the active job groups with their current pay, for choosing one on an offer (Recruitment may not read job_groups)
create or replace function public.offer_job_groups()
returns table (id uuid, code text, name text, effective_from date, basic_salary numeric, basic_min numeric, basic_max numeric,
  house_allowance numeric, travel_allowance numeric, other_allowances numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.manages_hiring() then
    raise exception 'You may not see job groups' using errcode = '42501';
  end if;
  return query
  select j.id, j.code, j.name, r.effective_from, r.basic_salary, r.basic_min, r.basic_max, r.house_allowance,
    r.travel_allowance, r.other_allowances
  from public.job_groups j
  left join lateral (select (public.job_group_rate_on(j.id, current_date)).*) r on true
  where j.tenant_id = public.current_tenant_id() and j.active
  order by lower(j.code);
end $$;
revoke all on function public.offer_job_groups() from public, anon;
grant execute on function public.offer_job_groups() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. orientation checklists
-- ---------------------------------------------------------------------------------------------
-- copies a template's items to the employee as their checklist (items not yet done are replaced); no checks: callers
-- check who may do it
create or replace function public.assign_orientation_now(p_employee uuid, p_template uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  e public.employees;
  n integer;
begin
  select * into e from public.employees where id = p_employee;
  delete from public.employee_orientation_items i where i.employee_id = p_employee and i.done_at is null;
  insert into public.employee_orientation_items (tenant_id, employee_id, template_id, position, title, description, owner_role, due_date)
  select e.tenant_id, e.id, t.template_id, t.position, t.title, t.description, t.owner_role,
    coalesce(public.employee_start_date(e."Start Date"), e.created_at::date, current_date) + t.due_offset_days
  from public.orientation_template_items t
  where t.template_id = p_template and t.tenant_id = e.tenant_id
  order by t.position;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.assign_orientation_now(uuid, uuid) from public, anon, authenticated;

-- HR gives the employee a checklist (another template replaces the items not yet done). Returns how many items.
create or replace function public.assign_orientation(p_employee uuid, p_template uuid) returns integer
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.manages_hiring() then
    raise exception 'Only HR can do this' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees e where e.id = p_employee and e.tenant_id = public.current_tenant_id()) then
    raise exception 'Employee record not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.orientation_templates t where t.id = p_template and t.tenant_id = public.current_tenant_id()) then
    raise exception 'Checklist not found' using errcode = 'P0002';
  end if;
  return public.assign_orientation_now(p_employee, p_template);
end $$;
revoke all on function public.assign_orientation(uuid, uuid) from public, anon;
grant execute on function public.assign_orientation(uuid, uuid) to authenticated;

-- ticks (or unticks) a checklist item: HR any item, the employee their own items marked for them
create or replace function public.set_orientation_item_done(p_item uuid, p_done boolean) returns void
language plpgsql security definer set search_path = public as $$
declare i public.employee_orientation_items;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select * into i from public.employee_orientation_items where id = p_item and tenant_id = public.current_tenant_id();
  if i.id is null then
    raise exception 'Checklist item not found' using errcode = 'P0002';
  end if;
  if not public.manages_hiring()
     and (i.employee_id is distinct from public.current_employee_id() or i.owner_role <> 'employee') then
    raise exception 'HR ticks this item' using errcode = '42501';
  end if;
  update public.employee_orientation_items
  set done_at = case when p_done then coalesce(done_at, now()) end,
      done_by = case when p_done then coalesce(done_by, auth.uid()) end
  where id = i.id;
end $$;
revoke all on function public.set_orientation_item_done(uuid, boolean) from public, anon;
grant execute on function public.set_orientation_item_done(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. required training: the item must be one of the company's training videos or documents
-- ---------------------------------------------------------------------------------------------
create or replace function public.required_training_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.job_title := nullif(btrim(new.job_title), '');
  if new.item_kind = 'video' and not exists (select 1 from public.training_videos v where v.id = new.item_id and v.tenant_id = new.tenant_id)
     or new.item_kind = 'document' and not exists (select 1 from public.training_documents d where d.id = new.item_id and d.tenant_id = new.tenant_id) then
    raise exception 'That training item is not in your company' using errcode = '23503';
  end if;
  return new;
end $$;
drop trigger if exists required_training_rules on public.required_training;
create trigger required_training_rules before insert or update on public.required_training
  for each row execute function public.required_training_rules();

-- ---------------------------------------------------------------------------------------------
-- 7. tests
-- ---------------------------------------------------------------------------------------------
create or replace function public.quizzes_rules() returns trigger
language plpgsql as $$
begin
  new.job_title := nullif(btrim(new.job_title), '');
  return new;
end $$;
drop trigger if exists quizzes_rules on public.quizzes;
create trigger quizzes_rules before insert or update on public.quizzes
  for each row execute function public.quizzes_rules();
drop trigger if exists orientation_templates_rules on public.orientation_templates;
create trigger orientation_templates_rules before insert or update on public.orientation_templates
  for each row execute function public.quizzes_rules();

-- HR gives an employee a test (again: nothing changes). Returns the assignment.
create or replace function public.assign_quiz(p_quiz uuid, p_employee uuid, p_due date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.current_tenant_id();
  q public.quizzes;
  e public.employees;
  v_id uuid;
begin
  if auth.uid() is null or not public.manages_hiring() then
    raise exception 'Only HR can do this' using errcode = '42501';
  end if;
  select * into q from public.quizzes where id = p_quiz and tenant_id = t;
  select * into e from public.employees where id = p_employee and tenant_id = t;
  if q.id is null or e.id is null then
    raise exception 'Test or employee not found' using errcode = 'P0002';
  end if;
  insert into public.quiz_assignments (tenant_id, quiz_id, employee_id, due_date)
  values (t, q.id, e.id, coalesce(p_due, greatest(coalesce(public.employee_start_date(e."Start Date"), current_date), current_date) + q.due_days))
  on conflict (quiz_id, employee_id) do nothing;
  select a.id into v_id from public.quiz_assignments a where a.quiz_id = q.id and a.employee_id = e.id;
  return v_id;
end $$;
revoke all on function public.assign_quiz(uuid, uuid, date) from public, anon;
grant execute on function public.assign_quiz(uuid, uuid, date) to authenticated;

-- HR lets the employee take the test again (the earlier score is cleared; the number of attempts is kept)
create or replace function public.reset_quiz_assignment(p_assignment uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.manages_hiring() then
    raise exception 'Only HR can do this' using errcode = '42501';
  end if;
  update public.quiz_assignments
  set submitted_at = null, answers = null, correct_count = null, question_count = null, score = null, passed = null
  where id = p_assignment and tenant_id = public.current_tenant_id();
  if not found then
    raise exception 'Test not found' using errcode = 'P0002';
  end if;
end $$;
revoke all on function public.reset_quiz_assignment(uuid) from public, anon;
grant execute on function public.reset_quiz_assignment(uuid) to authenticated;

-- the signed-in employee's own assignment, locked for marking
create or replace function public.my_quiz_assignment(p_assignment uuid) returns public.quiz_assignments
language plpgsql security definer set search_path = public as $$
declare a public.quiz_assignments;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select * into a from public.quiz_assignments
  where id = p_assignment and tenant_id = public.current_tenant_id() and employee_id = public.current_employee_id()
  for update;
  if a.id is null then
    raise exception 'Test not found' using errcode = 'P0002';
  end if;
  return a;
end $$;
revoke all on function public.my_quiz_assignment(uuid) from public, anon, authenticated;

-- the test to take: its questions and choices, without the answers
create or replace function public.quiz_to_take(p_assignment uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a public.quiz_assignments := public.my_quiz_assignment(p_assignment);
  q public.quizzes;
begin
  if a.submitted_at is not null then
    raise exception 'You have already taken this test' using errcode = '22023';
  end if;
  select * into q from public.quizzes where id = a.quiz_id;
  return jsonb_build_object(
    'title', q.title, 'description', q.description, 'pass_mark', q.pass_mark,
    'questions', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'question', x.question, 'options', to_jsonb(x.options))
                                            order by x.position, x.id)
                           from public.quiz_questions x where x.quiz_id = q.id), '[]'::jsonb));
end $$;
revoke all on function public.quiz_to_take(uuid) from public, anon;
grant execute on function public.quiz_to_take(uuid) to authenticated;

/**
 * Marks the employee's answers (p_answers: the chosen option's index for each question, in the order quiz_to_take
 * gave them; null for none) and keeps the score: the percentage right, passed when it reaches the pass mark.
 */
create or replace function public.submit_quiz(p_assignment uuid, p_answers integer[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a public.quiz_assignments := public.my_quiz_assignment(p_assignment);
  q public.quizzes;
  v_total integer;
  v_right integer;
  v_score integer;
begin
  if a.submitted_at is not null then
    raise exception 'You have already taken this test' using errcode = '22023';
  end if;
  select * into q from public.quizzes where id = a.quiz_id;
  select count(*) into v_total from public.quiz_questions where quiz_id = q.id;
  if v_total = 0 then
    raise exception 'This test has no questions yet' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_answers), 0) <> v_total then
    raise exception 'Answer every question' using errcode = '22023';
  end if;
  select count(*) into v_right
  from (select x.correct_index, row_number() over (order by x.position, x.id) n from public.quiz_questions x where x.quiz_id = q.id) s
  where p_answers[s.n] = s.correct_index;
  v_score := round(100.0 * v_right / v_total);
  update public.quiz_assignments
  set submitted_at = now(), answers = p_answers, correct_count = v_right, question_count = v_total, score = v_score,
      passed = v_score >= q.pass_mark, attempts = attempts + 1
  where id = a.id;
  return jsonb_build_object('score', v_score, 'passed', v_score >= q.pass_mark, 'correct', v_right, 'total', v_total,
                            'pass_mark', q.pass_mark);
end $$;
revoke all on function public.submit_quiz(uuid, integer[]) from public, anon;
grant execute on function public.submit_quiz(uuid, integer[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 8. a new employee gets their checklist (the template for their job title, else the default) and the tests set to
--    be given to new employees
-- ---------------------------------------------------------------------------------------------
create or replace function public.employees_after_hiring() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_template uuid;
  v_start date := greatest(coalesce(public.employee_start_date(new."Start Date"), current_date), current_date);
begin
  select t.id into v_template from public.orientation_templates t
  where t.tenant_id = new.tenant_id and t.active
    and (lower(t.job_title) = lower(btrim(new."Job Title")) or t.is_default)
  order by (t.job_title is not null and lower(t.job_title) = lower(btrim(new."Job Title"))) desc, t.created_at
  limit 1;
  if v_template is not null then
    perform public.assign_orientation_now(new.id, v_template);
  end if;

  insert into public.quiz_assignments (tenant_id, quiz_id, employee_id, due_date, assigned_by)
  select new.tenant_id, q.id, new.id, v_start + q.due_days, auth.uid()
  from public.quizzes q
  where q.tenant_id = new.tenant_id and q.active and q.auto_assign
    and (q.job_title is null or lower(q.job_title) = lower(btrim(new."Job Title")))
  on conflict (quiz_id, employee_id) do nothing;
  return new;
end $$;
drop trigger if exists employees_after_hiring on public.employees;
create trigger employees_after_hiring after insert on public.employees
  for each row execute function public.employees_after_hiring();

-- ---------------------------------------------------------------------------------------------
-- 9. what the screens show
-- ---------------------------------------------------------------------------------------------
/**
 * One employee's after-hiring progress: their offer (HR only), orientation checklist, required training (done when
 * training_progress says so) and tests. p_employee null: the signed-in employee's own. HR sees anyone in the company.
 */
create or replace function public.after_hiring(p_employee uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  e public.employees;
  hr boolean := public.manages_hiring();
  v_start date;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select * into e from public.employees
  where tenant_id = public.current_tenant_id() and id = coalesce(p_employee, public.current_employee_id());
  if e.id is null then
    raise exception 'Employee record not found' using errcode = 'P0002';
  end if;
  if not hr and e.id is distinct from public.current_employee_id() then
    raise exception 'Only HR can see this' using errcode = '42501';
  end if;
  v_start := coalesce(public.employee_start_date(e."Start Date"), e.created_at::date, current_date);

  return jsonb_build_object(
    'employee', jsonb_build_object('id', e.id, 'employee_number', e."Employee Number",
      'name', btrim(concat_ws(' ', e."First Name", e."Last Name")), 'job_title', e."Job Title", 'start_date', v_start),
    'offer', case when hr then (
      select jsonb_build_object('id', o.id, 'status', o.status, 'job_title', o.job_title, 'sent_at', o.sent_at,
                                'responded_at', o.responded_at, 'start_date', o.start_date)
      from public.job_offers o where o.employee_id = e.id order by o.created_at desc limit 1) end,
    'orientation', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'description', i.description, 'owner_role', i.owner_role,
                                          'due_date', i.due_date, 'done_at', i.done_at) order by i.position, i.due_date, i.title)
      from public.employee_orientation_items i where i.employee_id = e.id), '[]'::jsonb),
    'training', coalesce((
      select jsonb_agg(jsonb_build_object('kind', r.item_kind, 'item_id', r.item_id, 'title', r.title, 'due_date', r.due_date,
                                          'completed', r.completed_at is not null, 'completed_at', r.completed_at)
                       order by r.due_date, r.title)
      from (
        select rt.item_kind, rt.item_id, min(v_start + rt.due_days) due_date,
          coalesce(min(v.title), min(d.title), 'Training') title,
          (select max(coalesce(p.completed_at, p.updated_at)) from public.training_progress p
           where p.tenant_id = e.tenant_id and p.employee_number = e."Employee Number"
             and p.document_id = rt.item_id::text and p.completed) completed_at
        from public.required_training rt
        left join public.training_videos v on rt.item_kind = 'video' and v.id = rt.item_id
        left join public.training_documents d on rt.item_kind = 'document' and d.id = rt.item_id
        where rt.tenant_id = e.tenant_id and (rt.job_title is null or lower(rt.job_title) = lower(btrim(e."Job Title")))
        group by rt.item_kind, rt.item_id
      ) r), '[]'::jsonb),
    'tests', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'quiz_id', q.id, 'title', q.title, 'pass_mark', q.pass_mark,
                                          'due_date', a.due_date, 'submitted_at', a.submitted_at, 'score', a.score,
                                          'passed', a.passed, 'attempts', a.attempts, 'correct_count', a.correct_count,
                                          'question_count', coalesce(a.question_count, (select count(*) from public.quiz_questions x where x.quiz_id = q.id)))
                       order by a.due_date, q.title)
      from public.quiz_assignments a join public.quizzes q on q.id = a.quiz_id
      where a.employee_id = e.id), '[]'::jsonb)
  );
end $$;
revoke all on function public.after_hiring(uuid) from public, anon;
grant execute on function public.after_hiring(uuid) to authenticated;

-- every employee with a checklist or tests: how far they are (for the onboarding list)
create or replace function public.after_hiring_summary()
returns table (employee_id uuid, orientation_done integer, orientation_total integer, tests_passed integer, tests_total integer)
language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.current_tenant_id();
begin
  if not public.manages_hiring() then
    raise exception 'Only HR can see this' using errcode = '42501';
  end if;
  return query
  select x.employee_id, sum(x.od)::integer, sum(x.ot)::integer, sum(x.tp)::integer, sum(x.tt)::integer
  from (
    select i.employee_id, (i.done_at is not null)::integer od, 1 ot, 0 tp, 0 tt
    from public.employee_orientation_items i where i.tenant_id = t
    union all
    select a.employee_id, 0, 0, coalesce(a.passed, false)::integer, 1
    from public.quiz_assignments a where a.tenant_id = t
  ) x
  group by x.employee_id;
end $$;
revoke all on function public.after_hiring_summary() from public, anon;
grant execute on function public.after_hiring_summary() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 10. scheduling (best effort, like the other daily jobs): sent offers past their expiry date become expired
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    if exists (select 1 from cron.job where jobname = 'job-offers-expire-daily') then
      perform cron.unschedule('job-offers-expire-daily');
    end if;
    perform cron.schedule('job-offers-expire-daily', '10 0 * * *', $c$select public.expire_job_offers();$c$);
  else
    raise notice 'pg_cron is not available: offers past their expiry date show as expired, and can''t be accepted, but keep the status sent.';
  end if;
end $$;

notify pgrst, 'reload schema';
