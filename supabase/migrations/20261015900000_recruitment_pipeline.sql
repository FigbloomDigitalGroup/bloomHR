-- Recruitment pipeline: jobs, interview stages, interviews, scores and transcripts in one place (FIG-830).
--
-- Until now an application had only a free-text status, and scheduling an interview only sent the candidate an email:
-- nothing about the interview, who sat on the panel, what they thought or what was said was kept. This adds:
--
--   recruitment_stages           a job posting's pipeline (Applied -> Screening -> Interview -> Assessment -> Offer ->
--                                Hired / Rejected). Rows with no job_posting_id are the company's default stages: each
--                                new posting starts with a copy, which the company can rename, add to and reorder.
--                                Applications with no posting use the defaults directly.
--   job_applications.current_stage_id, stage_changed_at, hired_at, hired_by
--                                where the candidate is; moving to the Hired stage marks them hired (hired_at is the
--                                hook for turning a hire into an offer letter / employee later)
--   application_stage_history    every move: from, to, who, when and an optional note; written by the trigger below
--                                (nobody can write or rewrite it directly)
--   recruitment_interviews       an interview: the application, stage, time, in person or by video, its status
--   interview_panelists          who sits on the panel (logins in the same company)
--   interview_scorecards         one per panelist per interview: a recommendation and notes...
--   scorecard_ratings            ...and a 1-5 score for each criterion
--   interview_transcripts        a transcript or notes for an interview: pasted text, a file in the private
--                                interview-transcripts bucket, or a VideoConf meeting's transcript (copied in)
--
-- Who: everything is behind the existing 'recruitment' module and kept to the company. Candidates' details, scores
-- and transcripts are never visible to staff without the module, including staff who applied internally (they still
-- see only their own application, as before). Only the panelist writes their own scorecard.

-- ---------------------------------------------------------------------------------------------
-- 1. stages
-- ---------------------------------------------------------------------------------------------
create table if not exists public.recruitment_stages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  job_posting_id uuid references public.job_postings(id) on delete cascade,   -- null: the company's default stages
  name text not null check (btrim(name) <> '' and length(name) <= 60),
  position integer not null default 0,
  kind text not null default 'open' check (kind in ('open', 'hired', 'rejected')),
  created_at timestamptz not null default now()
);
create index if not exists recruitment_stages_tenant_posting on public.recruitment_stages (tenant_id, job_posting_id, position);
-- one Hired and one Rejected stage per pipeline
create unique index if not exists recruitment_stages_one_end_stage on public.recruitment_stages
  (tenant_id, coalesce(job_posting_id, '00000000-0000-0000-0000-000000000000'::uuid), kind) where kind <> 'open';

-- Gives a pipeline its stages if it has none: a posting copies the company's defaults; the defaults (or a posting
-- whose company has none left) start from the standard list.
create or replace function public.ensure_recruitment_stages(p_tenant uuid, p_posting uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_tenant is null
     or exists (select 1 from public.recruitment_stages where tenant_id = p_tenant and job_posting_id is not distinct from p_posting) then
    return;
  end if;
  if p_posting is not null and exists (select 1 from public.recruitment_stages where tenant_id = p_tenant and job_posting_id is null) then
    insert into public.recruitment_stages (tenant_id, job_posting_id, name, position, kind)
    select p_tenant, p_posting, s.name, s.position, s.kind
    from public.recruitment_stages s where s.tenant_id = p_tenant and s.job_posting_id is null;
    return;   -- Hired and Rejected can't be removed, so the copy always has both
  end if;
  insert into public.recruitment_stages (tenant_id, job_posting_id, name, position, kind)
  select p_tenant, p_posting, v.name, v.position, v.kind
  from (values ('Applied', 1, 'open'), ('Screening', 2, 'open'), ('Interview', 3, 'open'), ('Assessment', 4, 'open'),
               ('Offer', 5, 'open'), ('Hired', 6, 'hired'), ('Rejected', 7, 'rejected')) as v(name, position, kind);
end $$;

-- the first stage of a pipeline (the lowest open one), creating the pipeline if needed
create or replace function public.first_recruitment_stage(p_tenant uuid, p_posting uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.ensure_recruitment_stages(p_tenant, p_posting);
  select id into v_id from public.recruitment_stages
  where tenant_id = p_tenant and job_posting_id is not distinct from p_posting
  order by (kind <> 'open'), position, created_at limit 1;
  return v_id;
end $$;

create or replace function public.recruitment_stage_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    -- the posting or company is being deleted: its pipeline goes with it
    if (old.job_posting_id is not null and not exists (select 1 from public.job_postings where id = old.job_posting_id))
       or not exists (select 1 from public.tenants where id = old.tenant_id) then
      return old;
    end if;
    if old.kind <> 'open' then raise exception 'The Hired and Rejected stages can''t be removed; rename them instead'; end if;
    if exists (select 1 from public.job_applications where current_stage_id = old.id) then
      raise exception 'Move the candidates in % to another stage first', old.name;
    end if;
    return old;
  end if;

  new.name := btrim(new.name);
  if tg_op = 'UPDATE' then
    if new.kind is distinct from old.kind or new.job_posting_id is distinct from old.job_posting_id
       or new.tenant_id is distinct from old.tenant_id then
      raise exception 'A stage can be renamed or moved in the order, not changed into another kind or job';
    end if;
    return new;
  end if;

  if new.job_posting_id is not null
     and not exists (select 1 from public.job_postings where id = new.job_posting_id and tenant_id = new.tenant_id) then
    raise exception 'Unknown job posting';
  end if;
  return new;
end $$;

drop trigger if exists recruitment_stage_rules on public.recruitment_stages;
create trigger recruitment_stage_rules before insert or update or delete on public.recruitment_stages
  for each row execute function public.recruitment_stage_rules();

-- every company has default stages, and every posting its own copy
create or replace function public.recruitment_stages_for_new() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'tenants' then
    perform public.ensure_recruitment_stages(new.id, null);
  else
    perform public.ensure_recruitment_stages(new.tenant_id, new.id);
  end if;
  return null;
end $$;

drop trigger if exists recruitment_default_stages on public.tenants;
create trigger recruitment_default_stages after insert on public.tenants
  for each row execute function public.recruitment_stages_for_new();
drop trigger if exists recruitment_posting_stages on public.job_postings;
create trigger recruitment_posting_stages after insert on public.job_postings
  for each row execute function public.recruitment_stages_for_new();

do $$
declare r record;
begin
  for r in select id from public.tenants loop
    perform public.ensure_recruitment_stages(r.id, null);
  end loop;
  for r in select id, tenant_id from public.job_postings loop
    perform public.ensure_recruitment_stages(r.tenant_id, r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. where each candidate is, and how they got there
-- ---------------------------------------------------------------------------------------------
alter table public.job_applications
  add column if not exists current_stage_id uuid references public.recruitment_stages(id),
  add column if not exists stage_changed_at timestamptz,
  add column if not exists hired_at timestamptz,
  add column if not exists hired_by uuid references auth.users(id) on delete set null;
create index if not exists job_applications_current_stage on public.job_applications (current_stage_id);

create table if not exists public.application_stage_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  application_id uuid not null references public.job_applications(id) on delete cascade,
  from_stage_id uuid references public.recruitment_stages(id) on delete set null,
  to_stage_id uuid references public.recruitment_stages(id) on delete set null,
  from_stage_name text,                 -- the names at the time, so renaming or removing a stage keeps the history
  to_stage_name text not null,
  note text,
  moved_by uuid references auth.users(id) on delete set null,
  moved_at timestamptz not null default now()
);
create index if not exists application_stage_history_application on public.application_stage_history (application_id, moved_at);

-- Existing applications start in the stage their status points to (before the rules below exist, so the status
-- isn't rewritten).
drop trigger if exists job_application_stage on public.job_applications;
drop trigger if exists job_application_stage_history on public.job_applications;
do $$
declare r record;
begin
  for r in select a.id, a.tenant_id, a.job_posting_id, lower(coalesce(a.status, '')) as status
           from public.job_applications a where a.current_stage_id is null loop
    update public.job_applications a set
      current_stage_id = coalesce(
        (select s.id from public.recruitment_stages s
         where s.tenant_id = r.tenant_id and s.job_posting_id is not distinct from r.job_posting_id
           and ((r.status in ('accepted', 'hired') and s.kind = 'hired')
             or (r.status = 'rejected' and s.kind = 'rejected')
             or (r.status in ('interview_scheduled', 'interview') and s.kind = 'open' and lower(s.name) = 'interview')
             or (r.status in ('under_review', 'shortlisted') and s.kind = 'open' and lower(s.name) = 'screening'))
         order by s.position limit 1),
        public.first_recruitment_stage(r.tenant_id, r.job_posting_id)),
      stage_changed_at = coalesce(a.stage_changed_at, a.updated_at, a.applied_at, now()),
      hired_at = case when r.status in ('accepted', 'hired') then coalesce(a.hired_at, a.reviewed_at, a.updated_at, now()) else a.hired_at end
    where a.id = r.id;
  end loop;

  insert into public.application_stage_history (tenant_id, application_id, to_stage_id, to_stage_name, note, moved_at)
  select a.tenant_id, a.id, s.id, s.name, 'Pipeline started', coalesce(a.stage_changed_at, now())
  from public.job_applications a join public.recruitment_stages s on s.id = a.current_stage_id
  where not exists (select 1 from public.application_stage_history h where h.application_id = a.id);
end $$;

-- Keeps the stage valid for the application's job, lets only recruiters move candidates, and keeps the status the
-- staff portal shows in step with the stage.
create or replace function public.job_application_stage() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_stage public.recruitment_stages;
  v_first uuid;
  v_recruiter boolean := auth.uid() is null or public.has_any_module('recruitment');
begin
  if tg_op = 'UPDATE' and new.current_stage_id is not distinct from old.current_stage_id
     and new.job_posting_id is not distinct from old.job_posting_id
     and new.hired_at is not distinct from old.hired_at and new.hired_by is not distinct from old.hired_by
     and new.stage_changed_at is not distinct from old.stage_changed_at then
    return new;
  end if;

  if tg_op = 'UPDATE' and not v_recruiter then
    raise exception 'Only people with the Recruitment module can move candidates between stages';
  end if;

  v_first := public.first_recruitment_stage(new.tenant_id, new.job_posting_id);
  -- an applicant or the careers site can't choose where they start
  if new.current_stage_id is null or (tg_op = 'INSERT' and not v_recruiter) then
    new.current_stage_id := v_first;
  end if;

  select * into v_stage from public.recruitment_stages where id = new.current_stage_id;
  if not found or v_stage.tenant_id <> new.tenant_id or v_stage.job_posting_id is distinct from new.job_posting_id then
    -- the application moved to another job: it starts that job's pipeline
    if tg_op = 'UPDATE' and new.job_posting_id is distinct from old.job_posting_id and new.current_stage_id = old.current_stage_id then
      new.current_stage_id := v_first;
      select * into v_stage from public.recruitment_stages where id = v_first;
    else
      raise exception 'That stage isn''t part of this job''s pipeline';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.current_stage_id is not distinct from old.current_stage_id then
    -- nothing moved; hired_at/hired_by follow the stage only
    new.hired_at := old.hired_at; new.hired_by := old.hired_by; new.stage_changed_at := old.stage_changed_at;
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'withdrawn' then
    raise exception 'This candidate withdrew their application';
  end if;

  new.stage_changed_at := now();
  if v_stage.kind = 'hired' then
    new.status := 'hired';
    new.hired_at := now(); new.hired_by := auth.uid();
  else
    new.hired_at := null; new.hired_by := null;
    if tg_op = 'UPDATE' then
      new.status := case
        when v_stage.kind = 'rejected' then 'rejected'
        when v_stage.id = v_first then 'pending'
        else 'under_review' end;
    end if;
  end if;
  if tg_op = 'UPDATE' and auth.uid() is not null then
    new.reviewed_at := now();
  end if;
  return new;
end $$;

create or replace function public.job_application_stage_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.current_stage_id is not distinct from old.current_stage_id then return null; end if;
  insert into public.application_stage_history
    (tenant_id, application_id, from_stage_id, from_stage_name, to_stage_id, to_stage_name, note, moved_by)
  select new.tenant_id, new.id,
         case when tg_op = 'UPDATE' then old.current_stage_id end,
         case when tg_op = 'UPDATE' then (select name from public.recruitment_stages where id = old.current_stage_id) end,
         new.current_stage_id,
         (select name from public.recruitment_stages where id = new.current_stage_id),
         nullif(btrim(current_setting('recruitment.stage_note', true)), ''),
         auth.uid();
  return null;
end $$;

create trigger job_application_stage before insert or update on public.job_applications
  for each row execute function public.job_application_stage();
create trigger job_application_stage_history after insert or update on public.job_applications
  for each row execute function public.job_application_stage_history();

-- Moves a candidate, with an optional note for the history. RLS applies (it runs as the caller).
create or replace function public.move_application_stage(p_application uuid, p_stage uuid, p_note text default null)
returns void language plpgsql set search_path = public as $$
begin
  perform set_config('recruitment.stage_note', coalesce(p_note, ''), true);
  update public.job_applications set current_stage_id = p_stage where id = p_application;
  if not found then raise exception 'Candidate not found'; end if;
  perform set_config('recruitment.stage_note', '', true);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. interviews and their panels
-- ---------------------------------------------------------------------------------------------
create table if not exists public.recruitment_interviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  application_id uuid not null references public.job_applications(id) on delete cascade,
  stage_id uuid references public.recruitment_stages(id) on delete set null,
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 30 check (duration_minutes between 5 and 600),
  mode text not null default 'video' check (mode in ('in_person', 'video')),
  location text,
  meeting_link text,
  meeting_code text,                    -- the VideoConf meeting, when the interview was held there
  status text not null default 'scheduled' check (status in ('scheduled', 'done', 'cancelled', 'no_show')),
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recruitment_interviews_application on public.recruitment_interviews (application_id, scheduled_at);
create index if not exists recruitment_interviews_tenant_time on public.recruitment_interviews (tenant_id, scheduled_at);

create table if not exists public.interview_panelists (
  interview_id uuid not null references public.recruitment_interviews(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (interview_id, user_id)
);
create index if not exists interview_panelists_user on public.interview_panelists (user_id);

create or replace function public.recruitment_interview_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_app public.job_applications;
begin
  select * into v_app from public.job_applications where id = new.application_id;
  if not found or v_app.tenant_id <> new.tenant_id then raise exception 'Unknown candidate'; end if;
  if new.stage_id is null and tg_op = 'INSERT' then new.stage_id := v_app.current_stage_id; end if;
  if new.stage_id is not null and not exists (
    select 1 from public.recruitment_stages s
    where s.id = new.stage_id and s.tenant_id = new.tenant_id and s.job_posting_id is not distinct from v_app.job_posting_id
  ) then
    raise exception 'That stage isn''t part of this job''s pipeline';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
    if new.application_id <> old.application_id then raise exception 'An interview can''t be moved to another candidate'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists recruitment_interview_rules on public.recruitment_interviews;
create trigger recruitment_interview_rules before insert or update on public.recruitment_interviews
  for each row execute function public.recruitment_interview_rules();

-- a panelist is someone who can sign in to this company
create or replace function public.interview_panelist_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.recruitment_interviews where id = new.interview_id and tenant_id = new.tenant_id) then
    raise exception 'Unknown interview';
  end if;
  if not exists (select 1 from public.memberships m where m.user_id = new.user_id and m.tenant_id = new.tenant_id)
     and not exists (select 1 from public.user_profiles p where p.user_id = new.user_id and p.tenant_id = new.tenant_id) then
    raise exception 'A panelist must be someone in your company';
  end if;
  return new;
end $$;

drop trigger if exists interview_panelist_rules on public.interview_panelists;
create trigger interview_panelist_rules before insert or update on public.interview_panelists
  for each row execute function public.interview_panelist_rules();

-- ---------------------------------------------------------------------------------------------
-- 4. scorecards
-- ---------------------------------------------------------------------------------------------
create table if not exists public.interview_scorecards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  interview_id uuid not null references public.recruitment_interviews(id) on delete cascade,
  panelist_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  recommendation text not null check (recommendation in ('strong_yes', 'yes', 'no', 'strong_no')),
  notes text,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (interview_id, panelist_id)
);

create table if not exists public.scorecard_ratings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  scorecard_id uuid not null references public.interview_scorecards(id) on delete cascade,
  criterion text not null check (btrim(criterion) <> '' and length(criterion) <= 80),
  score smallint not null check (score between 1 and 5),
  created_at timestamptz not null default now()
);
create unique index if not exists scorecard_ratings_criterion on public.scorecard_ratings (scorecard_id, lower(btrim(criterion)));

create or replace function public.interview_scorecard_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.panelist_id <> old.panelist_id or new.interview_id <> old.interview_id) then
    raise exception 'A scorecard stays with its panelist and interview';
  end if;
  if not exists (select 1 from public.recruitment_interviews where id = new.interview_id and tenant_id = new.tenant_id) then
    raise exception 'Unknown interview';
  end if;
  if not exists (select 1 from public.interview_panelists where interview_id = new.interview_id and user_id = new.panelist_id) then
    raise exception 'Only the interview''s panel can score it';
  end if;
  if exists (select 1 from public.recruitment_interviews where id = new.interview_id and status = 'cancelled') then
    raise exception 'This interview was cancelled';
  end if;
  new.updated_at := now();
  if tg_op = 'UPDATE' then new.submitted_at := old.submitted_at; end if;
  return new;
end $$;

drop trigger if exists interview_scorecard_rules on public.interview_scorecards;
create trigger interview_scorecard_rules before insert or update on public.interview_scorecards
  for each row execute function public.interview_scorecard_rules();

create or replace function public.scorecard_rating_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.interview_scorecards where id = new.scorecard_id and tenant_id = new.tenant_id) then
    raise exception 'Unknown scorecard';
  end if;
  new.criterion := btrim(new.criterion);
  return new;
end $$;

drop trigger if exists scorecard_rating_rules on public.scorecard_ratings;
create trigger scorecard_rating_rules before insert or update on public.scorecard_ratings
  for each row execute function public.scorecard_rating_rules();

-- ---------------------------------------------------------------------------------------------
-- 5. transcripts and notes
-- ---------------------------------------------------------------------------------------------
--   text      pasted transcript or notes (body)
--   file      a file in the interview-transcripts bucket: <company id>/<interview id>/<random>.<ext>
--   meeting   a VideoConf meeting's transcript, copied in (body), with the meeting_transcripts row it came from
create table if not exists public.interview_transcripts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  interview_id uuid not null references public.recruitment_interviews(id) on delete cascade,
  kind text not null check (kind in ('text', 'file', 'meeting')),
  title text,
  body text,
  file_path text,
  file_name text,
  meeting_transcript_id bigint references public.meeting_transcripts(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (kind <> 'text' or nullif(btrim(body), '') is not null),
  check (kind <> 'file' or nullif(btrim(file_path), '') is not null)
);
create index if not exists interview_transcripts_interview on public.interview_transcripts (interview_id, created_at);

create or replace function public.interview_transcript_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.recruitment_interviews where id = new.interview_id and tenant_id = new.tenant_id) then
    raise exception 'Unknown interview';
  end if;
  if new.kind = 'file' and split_part(new.file_path, '/', 1) || '/' || split_part(new.file_path, '/', 2)
                           <> new.tenant_id::text || '/' || new.interview_id::text then
    raise exception 'Transcript files are kept in the interview''s own folder';
  end if;
  if new.meeting_transcript_id is not null and not exists (
    select 1 from public.meeting_transcripts where id = new.meeting_transcript_id and tenant_id = new.tenant_id
  ) then
    raise exception 'Unknown meeting transcript';
  end if;
  if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); end if;
  return new;
end $$;

drop trigger if exists interview_transcript_rules on public.interview_transcripts;
create trigger interview_transcript_rules before insert or update on public.interview_transcripts
  for each row execute function public.interview_transcript_rules();

-- Copies a VideoConf meeting's transcripts (one per participant) onto the interview, so recruiters can read them
-- without the Teams module. Only meetings of the caller's own company; returns how many were linked.
create or replace function public.link_meeting_transcript(p_interview uuid, p_meeting_code text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_count integer;
begin
  if not public.has_any_module('recruitment') then raise exception 'You need the Recruitment module to do this'; end if;
  if not exists (select 1 from public.recruitment_interviews where id = p_interview and tenant_id = v_tenant) then
    raise exception 'Unknown interview';
  end if;
  insert into public.interview_transcripts (tenant_id, interview_id, kind, title, body, meeting_transcript_id)
  select v_tenant, p_interview, 'meeting',
         coalesce(nullif(btrim(m.participant_name), ''), 'Meeting transcript'),
         concat_ws(E'\n\n', nullif(btrim(m.summary), ''), nullif(btrim(m.transcript), '')),
         m.id
  from public.meeting_transcripts m
  where m.tenant_id = v_tenant and m.meeting_code = btrim(p_meeting_code)
    and not exists (select 1 from public.interview_transcripts t where t.interview_id = p_interview and t.meeting_transcript_id = m.id);
  get diagnostics v_count = row_count;
  if v_count = 0 and not exists (
    select 1 from public.meeting_transcripts m where m.tenant_id = v_tenant and m.meeting_code = btrim(p_meeting_code)
  ) then
    raise exception 'No transcript found for meeting %', btrim(p_meeting_code);
  end if;
  update public.recruitment_interviews set meeting_code = btrim(p_meeting_code) where id = p_interview;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6. access
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['recruitment_stages', 'application_stage_history', 'recruitment_interviews', 'interview_panelists',
                           'interview_scorecards', 'scorecard_ratings', 'interview_transcripts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format($p$create policy tenant_isolation on public.%I as restrictive for all
      using (tenant_id = (select public.current_tenant_id()))
      with check (tenant_id = (select public.current_tenant_id()))$p$, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists module_read on public.%I', t);
    execute format($p$create policy module_read on public.%I for select to authenticated
      using ((select public.has_any_module('recruitment')))$p$, t);
  end loop;

  -- recruiters set up stages, interviews, panels and transcripts
  foreach t in array array['recruitment_stages', 'recruitment_interviews', 'interview_panelists', 'interview_transcripts'] loop
    execute format('drop policy if exists module_write on public.%I', t);
    execute format($p$create policy module_write on public.%I for all to authenticated
      using ((select public.has_any_module('recruitment')))
      with check ((select public.has_any_module('recruitment')))$p$, t);
  end loop;
end $$;

-- the history has no write policy: only the trigger (which bypasses RLS) writes it

-- each panelist writes only their own scorecard and its ratings
drop policy if exists own_scorecard on public.interview_scorecards;
create policy own_scorecard on public.interview_scorecards for all to authenticated
  using ((select public.has_any_module('recruitment')) and panelist_id = (select auth.uid()))
  with check ((select public.has_any_module('recruitment')) and panelist_id = (select auth.uid()));
drop policy if exists own_ratings on public.scorecard_ratings;
create policy own_ratings on public.scorecard_ratings for all to authenticated
  using ((select public.has_any_module('recruitment'))
         and scorecard_id in (select s.id from public.interview_scorecards s where s.panelist_id = (select auth.uid())))
  with check ((select public.has_any_module('recruitment'))
              and scorecard_id in (select s.id from public.interview_scorecards s where s.panelist_id = (select auth.uid())));

revoke all on function public.ensure_recruitment_stages(uuid, uuid) from public, anon, authenticated;
revoke all on function public.first_recruitment_stage(uuid, uuid) from public, anon, authenticated;
revoke all on function public.move_application_stage(uuid, uuid, text) from public, anon;
revoke all on function public.link_meeting_transcript(uuid, text) from public, anon;
grant execute on function public.move_application_stage(uuid, uuid, text) to authenticated;
grant execute on function public.link_meeting_transcript(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. transcript files: private, per company, recruiters only
-- ---------------------------------------------------------------------------------------------
--   interview-transcripts   <company id>/<interview id>/<random>.<ext>
-- Skipped where there is no storage schema (the test database applies this to a stand-in).
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public) values ('interview-transcripts', 'interview-transcripts', false)
  on conflict (id) do update set public = false;

  drop policy if exists interview_transcripts_select on storage.objects;
  drop policy if exists interview_transcripts_insert on storage.objects;
  drop policy if exists interview_transcripts_delete on storage.objects;

  create policy interview_transcripts_select on storage.objects for select to authenticated
    using (
      bucket_id = 'interview-transcripts'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (select public.has_any_module('recruitment'))
    );

  create policy interview_transcripts_insert on storage.objects for insert to authenticated
    with check (
      bucket_id = 'interview-transcripts'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (select public.has_any_module('recruitment'))
    );

  create policy interview_transcripts_delete on storage.objects for delete to authenticated
    using (
      bucket_id = 'interview-transcripts'
      and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
      and (select public.has_any_module('recruitment'))
    );
end $$;
