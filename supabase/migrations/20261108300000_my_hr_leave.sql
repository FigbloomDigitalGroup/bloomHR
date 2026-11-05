-- Leave in Figbloom Schools, run by Figbloom HR (phase 2 step 2a): ERP/SCHOOLS_HR_LEAVE_CONTRACT.md section 2.
--
-- Extends "My HR" (20261107100000_my_hr_api.sql): the backend (my_hr_routes.js) verifies Schools' platform token and the
-- school's link, finds the person (an employee only through external_people; an approver only through external_logins,
-- the link made by the one-click sign-in), then calls the functions below with the service role. HR's own leave rules
-- are used as they are: nothing here decides whether leave is allowed, who approves it or what it costs.
--
--   my_hr_leave_form(company, employee)
--                         the leave types with their rules (half days, document, most days, notice, service months,
--                         once a month), the employee's balances (as my_hr_leave) and the approval chain an application
--                         would go through now (the company's leave workflow, with who each step waits on)
--   my_hr_leave_apply(...)
--                         an application by the employee: inserted into leave_application exactly as the staff portal
--                         does, with HR's applicant checks (leave_application_check(): leave_request_problems() with
--                         "self" rules, the document "with the application"), which this migration lets apply to an
--                         application made through My HR (app.my_hr_applicant, set for that one insert). The approval
--                         chain and the approvers' notifications start as for any application.
--   my_hr_leave_cancel(company, employee, application)
--                         the employee's own application: while it waits (its chain ends, like a withdrawn loan) or once
--                         approved, before it starts (the day reopen_leave() also stops at; the days go back to the
--                         balance through leave_application_balance()). HR had no employee cancellation before this.
--   my_hr_approver(company, platform tenant, schools person)
--                         which HR login the person is: only external_logins (company, 'schools', person); 'no_access'
--                         unless that login is an active member of the active company
--   my_hr_leave_approvals(company, login)
--                         HR's "waiting on me" (my_leave_approvals()), as that login, with each application's details,
--                         chain so far and document paths (the backend turns them into short-lived links)
--   my_hr_leave_decide(company, login, application, approved|rejected, comment)
--                         decide_approval() as that login: HR's permission checks, delegation (alternates, admins),
--                         audit (approval_actions with their name) and notifications, unchanged
--   my_hr_leave_import(company, platform tenant, records, dry run)
--                         Schools' leave history as approved applications: idempotent on (company, 'schools', source id)
--                         (leave_history_imports), no approval chain, no notifications, counted in balances by HR's
--                         balance trigger like any approved leave; unknown types go to "Imported from Schools"; a dry
--                         run tries each record and rolls it back
--
-- Acting as the approver: my_hr_act_begin() / my_hr_act_end() (internal, executable by nobody but these functions) make
-- auth.uid() that login for the rest of the transaction (request.jwt.claim.sub / request.jwt.claims, transaction-local,
-- as PostgREST sets them for a signed-in user), and, only when the login is currently working in another of its companies,
-- switch it into this one the way the one-click sign-in does (platform_handoff_enter()) and back again before the
-- transaction ends; an error rolls everything back. The login comes only from external_logins, never from the caller.
--
-- Events for the platform (outbox, sent by POST /api/platform/outbox/flush like hr.employee.left): when an application
-- of a Schools-mapped employee becomes approved (finally), stops being approved (cancelled, reopened, rejected later,
-- deleted), or changes while approved (dates, half day, days, type): hr.leave.approved / hr.leave.cancelled, a change
-- being cancelled (as it was) + approved (as it is), same application id. leave_platform_events keeps what the platform
-- was last told about each application, so each change is queued exactly once. Imported history sends nothing.
--
-- Executable by service_role only. Safe to run again.

-- ---------------------------------------------------------------------------------------------
-- 1. the audit log knows the approver's login
-- ---------------------------------------------------------------------------------------------
alter table public.my_hr_api_log add column if not exists user_id uuid;

-- ---------------------------------------------------------------------------------------------
-- 2. HR's applicant checks for an application made through My HR
-- ---------------------------------------------------------------------------------------------

-- a document Schools sent with an application: stored by the backend under <company>/my-hr/<random name>
create or replace function public.my_hr_document_path_ok(p_tenant uuid, p_path text) returns boolean
language sql immutable as $$
  select p_path is not null and split_part(p_path, '/', 1) = p_tenant::text and split_part(p_path, '/', 2) = 'my-hr'
     and split_part(p_path, '/', 3) ~ '^[0-9a-f-]{36}(\.[a-z0-9]{1,10})?$' and split_part(p_path, '/', 4) = ''
$$;
revoke all on function public.my_hr_document_path_ok(uuid, text) from public, anon, authenticated;

-- (20261017300000's, plus: an application inserted by my_hr_leave_apply() is checked as the employee's own, with the
-- same rules as the staff portal's. Nothing else changes: a signed-in user is checked as before, and the server entering
-- leave for someone is still only counted.)
create or replace function public.leave_application_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_self boolean;
  v_half boolean := lower(btrim(coalesce(new.type, ''))) = 'half day';
  v_doc jsonb;
  v_my_hr boolean := coalesce(current_setting('app.my_hr_applicant', true), '')
                     = new.tenant_id::text || ':' || coalesce(new."Employee Number", '');
begin
  if auth.uid() is null and not v_my_hr then
    select * into r from public.leave_request_problems(new.tenant_id, new."Employee Number", new."Leave Type",
      public.leave_parse_date(new."Start Date"), public.leave_parse_date(new."End Date"), false, new.id, v_half);
    if r.days > 0 then
      new.days := r.days;
    end if;
    return new;
  end if;

  v_self := v_my_hr or public.current_employee_number() is not distinct from new."Employee Number" or not public.has_module('leaves');
  select * into r from public.leave_request_problems(new.tenant_id, new."Employee Number", new."Leave Type",
    public.leave_parse_date(new."Start Date"), public.leave_parse_date(new."End Date"), v_self, new.id, v_half);
  if lower(coalesce(new.status, 'pending')) = 'approved' then
    r.problems := array(select p from unnest(r.problems) p where p not like 'Not enough %');
  end if;

  -- documents: only files from this company's folder; "with the application" for one's own leave
  if new.document_path is not null and not (case when v_my_hr then public.my_hr_document_path_ok(new.tenant_id, new.document_path)
                                                 else public.leave_document_path_ok(new.tenant_id, new.document_path) end) then
    r.problems := r.problems || 'That document was not uploaded here; attach it again'::text;
  end if;
  if new.followup_document_path is not null and not (case when v_my_hr then public.my_hr_document_path_ok(new.tenant_id, new.followup_document_path)
                                                          else public.leave_document_path_ok(new.tenant_id, new.followup_document_path) end) then
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

-- (20261018600000's, plus: quiet while history is imported: app.approval_quiet, HR's own "no notifications" switch)
create or replace function public.leave_application_exhausted_alert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_start date := public.leave_parse_date(new."Start Date");
  v_year integer;
  v_end date;
  v_sick numeric;
  v_annual numeric;
  e public.employees;
  who text;
begin
  if coalesce(current_setting('app.approval_quiet', true), '') = 'on' then
    return null;
  end if;
  if lower(coalesce(new.status, '')) <> 'approved' or (tg_op = 'UPDATE' and lower(coalesce(old.status, '')) = 'approved')
     or v_start is null or new."Leave Type" !~* '^(sick|annual)' then
    return null;
  end if;
  v_year := public.leave_year_of(new.tenant_id, v_start);
  v_end := public.leave_year_end(new.tenant_id, v_year);
  v_sick := public.leave_left_of_kind(new.tenant_id, new."Employee Number", 'sick', v_year);
  v_annual := public.leave_left_of_kind(new.tenant_id, new."Employee Number", 'annual', v_year);
  if v_sick is null or v_annual is null or v_sick > 0 or v_annual > 0 then
    return null;
  end if;
  if exists (select 1 from public.hr_notifications n
             where n.tenant_id = new.tenant_id and n.employee_number = new."Employee Number"
               and n.notification_type = 'leave_exhausted' and n.end_date = v_end) then
    return null;
  end if;
  select * into e from public.employees where tenant_id = new.tenant_id and "Employee Number" = new."Employee Number";
  who := coalesce(nullif(btrim(concat_ws(' ', e."First Name", e."Last Name")), ''), new."Employee Number");
  insert into public.hr_notifications (tenant_id, employee_number, employee_name, work_email, notification_type, title, message, end_date)
  values (new.tenant_id, new."Employee Number", who, e."Work Email", 'leave_exhausted', 'All sick and annual leave used',
    who || ' has used all their sick leave (half-pay days included) and all their annual leave for '
    || case when public.leave_year_start_month(new.tenant_id) = 1 then v_year::text
            else 'the leave year from ' || to_char(public.leave_year_start(new.tenant_id, v_year), 'DD Mon YYYY') end
    || '. Any more time off would be unpaid or outside policy: talk to them about next steps.',
    v_end);
  return null;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2b. no overlapping leave (every path: the staff portal, HR entering leave, the server, My HR)
-- ---------------------------------------------------------------------------------------------
-- A new application, or a change to an application's dates or type, is refused when its dates meet another application
-- of the same employee that is pending (at any step) or approved. Rejected and cancelled ones don't count, nor does the
-- application itself. HR doesn't record which half of the day a half day is, so two half days on the same day overlap.
-- Only inserts and date/type changes are checked: overlaps already in the data are left alone (a status change, a
-- reopen, a renumbering or any other edit never trips on them).

-- "3 to 5 Dec", "28 Nov to 2 Dec", "3 Dec", with the year when it isn't this year
create or replace function public.leave_dates_text(p_start date, p_end date) returns text
language sql stable as $$
  select case
    when p_end is null or p_end = p_start then to_char(p_start, 'FMDD Mon')
    when to_char(p_start, 'MM YYYY') = to_char(p_end, 'MM YYYY') then to_char(p_start, 'FMDD') || ' to ' || to_char(p_end, 'FMDD Mon')
    else to_char(p_start, 'FMDD Mon') || ' to ' || to_char(p_end, 'FMDD Mon')
  end || case when extract(year from coalesce(p_end, p_start)) <> extract(year from current_date)
              then ' ' || to_char(coalesce(p_end, p_start), 'YYYY') else '' end
$$;

create or replace function public.leave_application_overlap() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_start date := public.leave_parse_date(new."Start Date");
  v_end date := public.leave_parse_date(new."End Date");
  x public.leave_application;
  v_whose text;
begin
  if tg_op = 'UPDATE' and new."Start Date" is not distinct from old."Start Date" and new."End Date" is not distinct from old."End Date"
     and new."Leave Type" is not distinct from old."Leave Type" and new.type is not distinct from old.type then
    return new;
  end if;
  if lower(btrim(coalesce(new.status, 'pending'))) not in ('pending', 'approved') or v_start is null then
    return new;
  end if;
  v_end := coalesce(v_end, v_start);
  select a.* into x from public.leave_application a
  where a.tenant_id = new.tenant_id and a."Employee Number" = new."Employee Number" and a.id is distinct from new.id
    and lower(btrim(coalesce(a.status, 'pending'))) in ('pending', 'approved')
    and public.leave_parse_date(a."Start Date") <= v_end
    and coalesce(public.leave_parse_date(a."End Date"), public.leave_parse_date(a."Start Date")) >= v_start
  order by public.leave_parse_date(a."Start Date")
  limit 1;
  if x.id is null then
    return new;
  end if;
  v_whose := case
    when coalesce(current_setting('app.my_hr_applicant', true), '') = new.tenant_id::text || ':' || coalesce(new."Employee Number", '')
         or (auth.uid() is not null and public.current_employee_number() is not distinct from new."Employee Number") then 'your'
    else coalesce((select public.approval_employee_name(e) || '''s' from public.employees e
                   where e.tenant_id = new.tenant_id and e."Employee Number" = new."Employee Number"), 'their') end;
  raise exception 'This overlaps % % % (%). Cancel or change that one first.',
    v_whose, btrim(x."Leave Type"),
    case when coalesce(public.leave_parse_date(x."End Date"), public.leave_parse_date(x."Start Date")) = public.leave_parse_date(x."Start Date")
         then 'on ' || public.leave_dates_text(public.leave_parse_date(x."Start Date"), null)
              || case when lower(btrim(coalesce(x.type, ''))) = 'half day' then ', a half day' else '' end
         else 'from ' || public.leave_dates_text(public.leave_parse_date(x."Start Date"), public.leave_parse_date(x."End Date")) end,
    lower(btrim(coalesce(x.status, 'pending')))
    using errcode = 'P0001';
end $$;
revoke all on function public.leave_application_overlap() from public, anon, authenticated;
drop trigger if exists leave_application_overlap on public.leave_application;
create trigger leave_application_overlap before insert or update of "Start Date", "End Date", "Leave Type", type
  on public.leave_application for each row execute function public.leave_application_overlap();

-- ---------------------------------------------------------------------------------------------
-- 3. history imported from Schools, and what the platform was last told
-- ---------------------------------------------------------------------------------------------
create table if not exists public.leave_history_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source text not null check (source ~ '^[a-z][a-z0-9_]{0,31}$'),
  source_id text not null check (char_length(source_id) between 1 and 200),
  application_id uuid not null,
  imported_at timestamptz not null default now(),
  unique (tenant_id, source, source_id)
);
create index if not exists leave_history_imports_application_idx on public.leave_history_imports (application_id);
alter table public.leave_history_imports enable row level security;
drop policy if exists tenant_isolation on public.leave_history_imports;
create policy tenant_isolation on public.leave_history_imports as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
revoke all on public.leave_history_imports from anon, authenticated;
grant select, insert, update, delete on public.leave_history_imports to service_role;

create table if not exists public.leave_platform_events (
  application_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sent jsonb,                                  -- the approved leave as the platform was last told it; null: not approved
  seq integer not null default 0,              -- events queued for this application so far (the outbox dedupe key)
  updated_at timestamptz not null default now()
);
alter table public.leave_platform_events enable row level security;
drop policy if exists tenant_isolation on public.leave_platform_events;
create policy tenant_isolation on public.leave_platform_events as restrictive for all
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
revoke all on public.leave_platform_events from anon, authenticated;
grant select on public.leave_platform_events to service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. events: hr.leave.approved / hr.leave.cancelled
-- ---------------------------------------------------------------------------------------------

-- the approved application as the platform hears it, or null (not approved, or not a Schools person's, or a company
-- that isn't on the platform)
create or replace function public.leave_platform_snapshot(a public.leave_application) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when lower(btrim(coalesce(a.status, ''))) = 'approved' and t.platform_tenant_id is not null and m.external_id is not null
    then jsonb_build_object(
      'application_id', a.id,
      'external_id', m.external_id,
      'employee_number', a."Employee Number",
      'leave_type', btrim(a."Leave Type"),
      'start_date', to_char(public.leave_parse_date(a."Start Date"), 'YYYY-MM-DD'),
      'end_date', to_char(public.leave_parse_date(a."End Date"), 'YYYY-MM-DD'),
      'half_day', lower(btrim(coalesce(a.type, ''))) = 'half day',
      'days', trim_scale(coalesce(a.days, 0)))
  end
  from public.tenants t
  left join public.external_people m
    on m.tenant_id = a.tenant_id and m.source = 'schools' and m.employee_number = a."Employee Number"
  where t.id = a.tenant_id
$$;
revoke all on function public.leave_platform_snapshot(public.leave_application) from public, anon, authenticated;

create or replace function public.leave_application_platform_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_was boolean := tg_op <> 'INSERT' and lower(btrim(coalesce(old.status, ''))) = 'approved';
  v_is boolean := tg_op <> 'DELETE' and lower(btrim(coalesce(new.status, ''))) = 'approved';
  v_id uuid;
  v_tenant uuid;
  v_new jsonb;
  s public.leave_platform_events;
begin
  if not (v_was or v_is) then
    return null;
  end if;
  if tg_op = 'DELETE' then
    v_id := old.id;
    v_tenant := old.tenant_id;
  else
    v_id := new.id;
    v_tenant := new.tenant_id;
  end if;
  -- Schools' own history, imported: Schools has it already
  if coalesce(current_setting('app.my_hr_import', true), '') = 'on'
     or exists (select 1 from public.leave_history_imports i where i.application_id = v_id) then
    return null;
  end if;
  begin
    if tg_op <> 'DELETE' then
      v_new := public.leave_platform_snapshot(new);
    end if;
    select * into s from public.leave_platform_events where application_id = v_id for update;
    if s.application_id is null then
      if v_new is null then
        return null;
      end if;
      insert into public.leave_platform_events (application_id, tenant_id) values (v_id, v_tenant)
      on conflict (application_id) do nothing;
      select * into s from public.leave_platform_events where application_id = v_id for update;
    end if;
    if s.sent is not null and s.sent is distinct from v_new then
      s.seq := s.seq + 1;
      insert into public.platform_event_outbox (tenant_id, event_type, dedupe_key, data)
      values (v_tenant, 'hr.leave.cancelled', v_id::text || ':' || s.seq, s.sent || jsonb_build_object('status', 'cancelled'))
      on conflict (event_type, tenant_id, dedupe_key) do nothing;
    end if;
    if v_new is not null and v_new is distinct from s.sent then
      s.seq := s.seq + 1;
      insert into public.platform_event_outbox (tenant_id, event_type, dedupe_key, data)
      values (v_tenant, 'hr.leave.approved', v_id::text || ':' || s.seq, v_new || jsonb_build_object('status', 'approved'))
      on conflict (event_type, tenant_id, dedupe_key) do nothing;
    end if;
    update public.leave_platform_events set sent = v_new, seq = s.seq, updated_at = now() where application_id = v_id;
  exception when others then
    -- never blocks the leave itself
    raise warning 'hr.leave event not queued for application %: %', v_id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.leave_application_platform_event() from public, anon, authenticated;
drop trigger if exists leave_application_platform_event on public.leave_application;
create trigger leave_application_platform_event after insert or update or delete on public.leave_application
  for each row execute function public.leave_application_platform_event();

-- ---------------------------------------------------------------------------------------------
-- 5. an application as My HR answers it (GET leave, apply, cancel, approvals)
-- ---------------------------------------------------------------------------------------------

-- the approval chain of one application (approval_chains()' steps, this round only)
create or replace function public.my_hr_leave_chain(p_tenant uuid, p_application uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('status', r.status, 'current_step', r.current_step, 'decided_at', r.decided_at,
    'steps', (
      select jsonb_agg(jsonb_build_object(
        'position', s.n,
        'label', public.approval_step_label(r.tenant_id, s.step),
        'status', coalesce(x.decision, case when r.status = 'pending' and s.n = r.current_step then 'current'
                                            when r.status = 'pending' then 'upcoming' else 'not_reached' end),
        'waiting_on', case when r.status = 'pending' and s.n = r.current_step
                           then public.approval_waiting_on(r.tenant_id, s.step, r.requester_employee_number) end,
        'actor_name', x.actor_name, 'comment', x.comment, 'acted_at', x.created_at) order by s.n)
      from jsonb_array_elements(r.steps) with ordinality as s(step, n)
      left join lateral (
        select y.* from public.approval_actions y
        where y.request_id = r.id and y.step = s.n and y.id > public.approval_round_start(r.id)
        order by y.id desc limit 1) x on true))
  from public.approval_requests r
  where r.tenant_id = p_tenant and r.kind = 'leave' and r.record_id = p_application
$$;

-- whether the employee may cancel it now (my_hr_leave_cancel()'s rule), and why not
create or replace function public.my_hr_leave_cancel_refusal(a public.leave_application) returns text
language sql stable security definer set search_path = public as $$
  select case
    when lower(btrim(coalesce(a.status, 'pending'))) = 'pending' then null
    when lower(btrim(coalesce(a.status, ''))) = 'approved' then
      case when public.leave_parse_date(a."Start Date") > public.work_today() then null
           else 'This leave has already started, so it can no longer be cancelled' end
    else format('This leave application is %s, so there is nothing to cancel', lower(btrim(coalesce(a.status, ''))))
  end
$$;

create or replace function public.my_hr_leave_application(a public.leave_application) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', a.id, 'leave_type', a."Leave Type", 'start_date', a."Start Date", 'end_date', a."End Date", 'days', a.days,
    'half_day', lower(btrim(coalesce(a.type, ''))) = 'half day',
    'status', lower(coalesce(a.status, 'pending')), 'reason', a.reason, 'submitted_at', a.time_added,
    'decision_note', a.notes,
    'document_name', a.document_name, 'followup_document_name', a.followup_document_name,
    'cancellable', public.my_hr_leave_cancel_refusal(a) is null,
    'approval', public.my_hr_leave_chain(a.tenant_id, a.id))
$$;

-- (20261107100000's, each application through my_hr_leave_application(): the same fields, plus half_day, the decision
-- note, the documents' names and whether it can be cancelled)
create or replace function public.my_hr_leave(p_tenant uuid, p_employee text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := public.nairobi_today();
  v_types jsonb := '[]'::jsonb;
  v_balances jsonb := '[]'::jsonb;
  t record;
  pol record;
  v_year integer;
  v_month integer;
  v_free numeric;
  v_pending numeric;
  b public.leave_balances;
begin
  perform public.my_hr_employee(p_tenant, p_employee);
  for t in select * from public.leave_types lt where lt.tenant_id = p_tenant order by lt.name loop
    v_types := v_types || jsonb_build_object('id', t.id, 'name', t.name, 'description', t.description,
                                             'deductible', coalesce(t.is_deductible, true));
    select * into pol from public.current_leave_policies where leave_type_id = t.id;
    v_year := public.leave_bucket_year(p_tenant, pol.accrual_method, v_today);
    v_month := public.leave_bucket_month(pol.accrual_method, v_today);
    v_free := public.leave_available(p_tenant, p_employee, t.id, v_year, v_month);
    if v_free is null then
      continue; -- no balance kept for this type (not deducted, or no limit)
    end if;
    select coalesce(sum(a.days), 0) into v_pending
    from public.leave_application a
    where a.tenant_id = p_tenant and a."Employee Number" = p_employee and a."Leave Type" = t.name
      and lower(coalesce(a.status, 'pending')) = 'pending'
      and public.leave_bucket_year(p_tenant, pol.accrual_method, public.leave_parse_date(a."Start Date")) = v_year
      and (v_month = 0 or extract(month from public.leave_parse_date(a."Start Date")) = v_month);
    select * into b from public.leave_balances lb
    where lb.tenant_id = p_tenant and lb.employee_number = p_employee and lb.leave_type_id = t.id
      and lb.year = v_year and lb.month = v_month;
    v_balances := v_balances || jsonb_build_object(
      'leave_type_id', t.id, 'leave_type', t.name, 'year', v_year, 'month', nullif(v_month, 0),
      'accrued_days', b.accrued_days, 'carried_over_days', b.carried_over_days, 'used_days', coalesce(b.used_days, 0),
      'pending_days', trim_scale(v_pending), 'available_days', trim_scale(v_free - v_pending));
  end loop;

  return jsonb_build_object(
    'leave_types', v_types,
    'balances', v_balances,
    'applications', coalesce((
      select jsonb_agg(public.my_hr_leave_application(a) order by a.time_added desc)
      from (select * from public.leave_application l
            where l.tenant_id = p_tenant and l."Employee Number" = p_employee
            order by l.time_added desc limit 200) a), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6. the form
-- ---------------------------------------------------------------------------------------------
create or replace function public.my_hr_leave_form(p_tenant uuid, p_employee text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_leave jsonb := public.my_hr_leave(p_tenant, p_employee); -- also: the employee, approved by HR
  v_joined date := public.employee_joined(p_tenant, p_employee);
  v_steps jsonb;
  v_admins boolean;
begin
  -- the company's leave workflow as it is now (approval_start() takes it the same way), else HR's default
  select (select jsonb_agg(public.approval_step_json(s) order by s.position) from public.approval_steps s where s.workflow_id = w.id),
         w.admins_can_act
    into v_steps, v_admins
  from public.approval_workflows w where w.tenant_id = p_tenant and w.kind = 'leave';
  v_steps := coalesce(v_steps, public.approval_default_steps('leave'));

  return jsonb_build_object(
    'leave_types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'description', t.description,
        'deductible', coalesce(t.is_deductible, true), 'paid', t.paid,
        -- HR lets every type be taken as a half day (one date): leave_request_problems()
        'half_days', true,
        'count_days', coalesce(p.count_days, 'working'),
        'max_days_per_request', p.max_days_per_request,
        'min_notice_days', coalesce(p.min_notice_days, 0),
        'earliest_start', case when coalesce(p.min_notice_days, 0) > 0 then to_char(current_date + p.min_notice_days, 'YYYY-MM-DD') end,
        'one_per_month', coalesce(p.one_per_month, false),
        'service_months_before_use', coalesce(p.service_months_before_use, 0),
        'available_from', case when coalesce(p.service_months_before_use, 0) > 0 and v_joined is not null
                               then to_char((v_joined + make_interval(months => p.service_months_before_use))::date, 'YYYY-MM-DD') end,
        'document', case when p.document_name is not null or p.followup_document_name is not null then jsonb_build_object(
          'name', p.document_name, 'when', p.document_when, 'within_days', p.document_within_days,
          'required_if_longer_than', p.document_if_longer_than,
          'followup_name', p.followup_document_name, 'followup_within_days', p.followup_within_days) end,
        'balance', (select b from jsonb_array_elements(v_leave -> 'balances') b where b ->> 'leave_type_id' = t.id::text))
        order by t.name)
      from public.leave_types t
      left join public.current_leave_policies p on p.leave_type_id = t.id
      where t.tenant_id = p_tenant and t.name <> 'Imported from Schools'), '[]'::jsonb),
    'balances', v_leave -> 'balances',
    'approval_chain', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', s.n,
        'label', public.approval_step_label(p_tenant, s.step),
        'waiting_on', public.approval_waiting_on(p_tenant, s.step, p_employee),
        'skipped', public.approval_skip_reason(p_tenant, s.step, p_employee) is not null) order by s.n)
      from jsonb_array_elements(v_steps) with ordinality as s(step, n)), '[]'::jsonb),
    'admins_can_act', coalesce(v_admins, true),
    'reason_min_length', 10,
    'document_max_bytes', 5 * 1024 * 1024);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 7. apply and cancel (the employee's own)
-- ---------------------------------------------------------------------------------------------
create or replace function public.my_hr_leave_apply(
  p_tenant uuid, p_employee text, p_type uuid, p_start date, p_end date, p_half boolean, p_reason text,
  p_document_path text default null, p_document_name text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.employees := public.my_hr_employee(p_tenant, p_employee);
  v_type text;
  a public.leave_application;
begin
  select t.name into v_type from public.leave_types t where t.tenant_id = p_tenant and t.id = p_type;
  if v_type is null or v_type = 'Imported from Schools' then
    raise exception 'Choose a leave type' using errcode = '22023';
  end if;
  if p_document_path is not null and not public.my_hr_document_path_ok(p_tenant, p_document_path) then
    raise exception 'That document was not uploaded here; attach it again' using errcode = '22023';
  end if;

  -- HR's applicant checks, as for the employee applying in the staff portal (leave_application_check())
  perform set_config('app.my_hr_applicant', p_tenant::text || ':' || p_employee, true);
  insert into public.leave_application (tenant_id, "Employee Number", name, "Office Branch", "Leave Type", "Start Date",
                                        "End Date", days, type, "Application Type", reason, status, time_added,
                                        document_path, document_name)
  values (p_tenant, p_employee, btrim(concat_ws(' ', e."First Name", e."Last Name")), e."Town", v_type,
          to_char(p_start, 'YYYY-MM-DD'), to_char(p_end, 'YYYY-MM-DD'), 0,
          case when coalesce(p_half, false) then 'Half Day' else 'Full Day' end, 'First Application', btrim(p_reason),
          'Pending', now(), p_document_path, case when p_document_path is not null then left(btrim(p_document_name), 255) end)
  returning * into a;
  perform set_config('app.my_hr_applicant', '', true);
  return public.my_hr_leave_application(a);
end $$;

create or replace function public.my_hr_leave_cancel(p_tenant uuid, p_employee text, p_application uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a public.leave_application;
  refusal text;
begin
  perform public.my_hr_employee(p_tenant, p_employee);
  select * into a from public.leave_application l
  where l.id = p_application and l.tenant_id = p_tenant and l."Employee Number" = p_employee for update;
  if a.id is null then
    raise exception 'No such leave application' using errcode = 'P0002';
  end if;
  refusal := public.my_hr_leave_cancel_refusal(a);
  if refusal is not null then
    raise exception '%', refusal using errcode = '55000';
  end if;
  -- a status change outside the chain, as reopen_leave() makes one; the balance trigger gives approved days back
  perform set_config('app.approval_decision', 'on', true);
  update public.leave_application set status = 'cancelled' where id = a.id returning * into a;
  perform set_config('app.approval_decision', '', true);
  -- a chain still waiting ends (as a withdrawn loan's does: money_end_approval())
  delete from public.approval_requests where kind = 'leave' and record_id = a.id and status = 'pending';
  return public.my_hr_leave_application(a);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 8. approvers: who they are, and acting as them
-- ---------------------------------------------------------------------------------------------
create or replace function public.my_hr_approver(p_tenant uuid, p_platform_tenant uuid, p_external_id text)
returns table (outcome text, user_id uuid)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_user uuid;
begin
  if p_tenant is null or p_platform_tenant is null or not exists (
    select 1 from public.tenants t
    where t.id = p_tenant and t.platform_tenant_id = p_platform_tenant and t.status = 'active') then
    return query select 'unknown_company'::text, null::uuid;
    return;
  end if;
  select l.user_id into v_user from public.external_logins l
  where l.tenant_id = p_tenant and l.source = 'schools' and l.external_id = p_external_id;
  if v_user is null then
    return query select 'not_linked'::text, null::uuid;
    return;
  end if;
  if not exists (select 1 from public.memberships m
                 where m.user_id = v_user and m.tenant_id = p_tenant and m.account_status = 'ACTIVE') then
    return query select 'no_access'::text, v_user;
    return;
  end if;
  return query select 'found'::text, v_user;
end $$;

/**
 * Makes auth.uid() p_user for the rest of this transaction, working in p_tenant, so HR's own functions see that login
 * as the one acting. Internal: called only by my_hr_leave_approvals() / my_hr_leave_decide(), which the backend calls
 * with a login found through external_logins. Returns what my_hr_act_end() puts back.
 */
create or replace function public.my_hr_act_begin(p_tenant uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.user_profiles;
  v_saved jsonb;
begin
  if not exists (select 1 from public.memberships m join public.tenants t on t.id = m.tenant_id and t.status = 'active'
                 where m.user_id = p_user and m.tenant_id = p_tenant and m.account_status = 'ACTIVE') then
    raise exception 'This HR login has no access to this company' using errcode = '42501';
  end if;
  select * into p from public.user_profiles where user_id = p_user for update;
  if p.user_id is null then
    raise exception 'This HR login has no access to this company' using errcode = '42501';
  end if;
  v_saved := jsonb_build_object(
    'sub', current_setting('request.jwt.claim.sub', true),
    'claims', current_setting('request.jwt.claims', true),
    'role', current_setting('request.jwt.claim.role', true),
    'switched', p.tenant_id is distinct from p_tenant,
    'tenant_id', p.tenant_id, 'profile_role', p.role, 'account_status', p.account_status);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  if p.tenant_id is distinct from p_tenant and not public.platform_handoff_enter(p_tenant, p_user) then
    raise exception 'This HR login has no access to this company' using errcode = '42501';
  end if;
  if public.current_tenant_id() is distinct from p_tenant then
    raise exception 'This HR login has no access to this company' using errcode = '42501';
  end if;
  return v_saved;
end $$;

create or replace function public.my_hr_act_end(p_user uuid, p_saved jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce((p_saved ->> 'switched')::boolean, false) then
    update public.user_profiles
      set tenant_id = (p_saved ->> 'tenant_id')::uuid, role = p_saved ->> 'profile_role', account_status = p_saved ->> 'account_status'
      where user_id = p_user;
  end if;
  perform set_config('request.jwt.claim.sub', coalesce(p_saved ->> 'sub', ''), true);
  perform set_config('request.jwt.claims', coalesce(p_saved ->> 'claims', ''), true);
  perform set_config('request.jwt.claim.role', coalesce(p_saved ->> 'role', ''), true);
end $$;

-- one application as an approver sees it in "Leave to approve" (the document paths are for the backend to sign)
create or replace function public.my_hr_leave_approval_item(a public.leave_application, p_step_label text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'application_id', a.id,
    'employee', jsonb_build_object('employee_number', a."Employee Number",
      'name', coalesce((select public.approval_employee_name(e) from public.employees e
                        where e.tenant_id = a.tenant_id and e."Employee Number" = a."Employee Number"), a.name),
      'external_id', (select m.external_id from public.external_people m
                      where m.tenant_id = a.tenant_id and m.source = 'schools' and m.employee_number = a."Employee Number")),
    'leave_type', a."Leave Type", 'start_date', a."Start Date", 'end_date', a."End Date", 'days', a.days,
    'half_day', lower(btrim(coalesce(a.type, ''))) = 'half day',
    'reason', a.reason, 'submitted_at', a.time_added, 'status', lower(coalesce(a.status, 'pending')),
    'step_label', p_step_label,
    'document', case when a.document_path is not null then jsonb_build_object('name', a.document_name, 'path', a.document_path) end,
    'followup_document', case when a.followup_document_path is not null
                              then jsonb_build_object('name', a.followup_document_name, 'path', a.followup_document_path) end,
    'approval', public.my_hr_leave_chain(a.tenant_id, a.id))
$$;

-- HR's "waiting on me" (my_leave_approvals(): the current step is this login's, and it is not their own), as that login
create or replace function public.my_hr_leave_approvals(p_tenant uuid, p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_saved jsonb := public.my_hr_act_begin(p_tenant, p_user);
  v jsonb;
begin
  select coalesce(jsonb_agg(public.my_hr_leave_approval_item(l, m.step_label) order by m.time_added), '[]'::jsonb) into v
  from public.my_leave_approvals() m
  join public.leave_application l on l.id = m.record_id and l.tenant_id = p_tenant;
  perform public.my_hr_act_end(p_user, v_saved);
  return v;
end $$;

-- decide_approval() as that login: whether they may, and everything it records and sends, is HR's
create or replace function public.my_hr_leave_decide(p_tenant uuid, p_user uuid, p_application uuid, p_decision text,
                                                     p_comment text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_saved jsonb := public.my_hr_act_begin(p_tenant, p_user);
  v_request uuid;
  r public.approval_requests;
  a public.leave_application;
begin
  select q.id into v_request from public.approval_requests q
  where q.tenant_id = p_tenant and q.kind = 'leave' and q.record_id = p_application;
  if v_request is null then
    raise exception 'No such leave application waiting for a decision' using errcode = 'P0002';
  end if;
  r := public.decide_approval(v_request, p_decision, p_comment);
  select * into a from public.leave_application where id = p_application;
  perform public.my_hr_act_end(p_user, v_saved);
  return jsonb_build_object('request_status', r.status, 'application', public.my_hr_leave_approval_item(a, null) - 'document' - 'followup_document');
end $$;

-- ---------------------------------------------------------------------------------------------
-- 9. history from Schools
-- ---------------------------------------------------------------------------------------------
create or replace function public.my_hr_leave_import(p_tenant uuid, p_platform_tenant uuid, p_records jsonb, p_dry_run boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rec jsonb;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
  v_source text;
  v_external text;
  v_employee public.employees;
  v_start date;
  v_end date;
  v_status text;
  v_type text;
  v_mapped boolean;
  v_days numeric;
  v_existing uuid;
  a public.leave_application;
  v_counts jsonb := '{}'::jsonb;
  v_outcome text;
begin
  if p_tenant is null or p_platform_tenant is null or not exists (
    select 1 from public.tenants t where t.id = p_tenant and t.platform_tenant_id = p_platform_tenant and t.status = 'active') then
    raise exception 'unknown company' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_records) is distinct from 'array' then
    raise exception 'records must be a list' using errcode = '22023';
  end if;

  -- no approval chain (approved on arrival), no notifications, no events
  perform set_config('app.approval_quiet', 'on', true);
  perform set_config('app.my_hr_import', 'on', true);

  for rec in select value from jsonb_array_elements(p_records) loop
    v_result := null;
    v_source := left(btrim(coalesce(rec ->> 'source_id', '')), 201);
    v_external := btrim(coalesce(rec ->> 'external_id', ''));
    v_start := public.leave_parse_date(rec ->> 'start_date');
    v_end := public.leave_parse_date(rec ->> 'end_date');
    v_status := lower(btrim(coalesce(rec ->> 'status', '')));
    v_days := case when coalesce(rec ->> 'days', '') ~ '^\d+(\.\d+)?$' then (rec ->> 'days')::numeric end;
    v_employee := null;
    select e.* into v_employee from public.external_people m
    join public.employees e on e.tenant_id = m.tenant_id and e."Employee Number" = m.employee_number
    where m.tenant_id = p_tenant and m.source = 'schools' and m.external_id = v_external;

    select i.application_id into v_existing from public.leave_history_imports i
    where i.tenant_id = p_tenant and i.source = 'schools' and i.source_id = v_source;

    if v_source = '' or char_length(v_source) > 200 then
      v_result := jsonb_build_object('outcome', 'invalid', 'message', 'source_id is needed (200 characters at most)');
    elsif v_existing is not null then
      v_result := jsonb_build_object('outcome', 'already_imported', 'application_id', v_existing);
    elsif v_employee."Employee Number" is null then
      v_result := jsonb_build_object('outcome', 'not_linked', 'message', 'This person is not linked to an HR employee');
    elsif v_start is null or v_end is null or v_end < v_start then
      v_result := jsonb_build_object('outcome', 'invalid', 'message', 'start_date and end_date are YYYY-MM-DD, the end on or after the start');
    elsif v_status <> 'approved' then
      v_result := jsonb_build_object('outcome', 'skipped', 'message', 'Only approved leave is imported');
    else
      select t.name into v_type from public.leave_types t
      where t.tenant_id = p_tenant and lower(t.name) = lower(btrim(coalesce(rec ->> 'leave_type_name', '')));
      v_mapped := v_type is null;
      begin
        if v_mapped then
          v_type := 'Imported from Schools';
          insert into public.leave_types (tenant_id, name, description, is_deductible, is_continuous)
          values (p_tenant, v_type, 'Leave imported from Figbloom Schools whose type HR does not have', false, true)
          on conflict (tenant_id, name) where tenant_id is not null do nothing;
        end if;
        -- entered already decided, as HR enters leave for someone: HR counts the days (its work week and holidays) and
        -- its balance trigger takes them from the balance, refusing leave the balance doesn't cover, and leave_application_overlap() refusing leave that overlaps the employee's pending or approved leave (reported as refused, reason overlap: nothing is counted twice)
        insert into public.leave_application (tenant_id, "Employee Number", name, "Office Branch", "Leave Type",
                                              "Start Date", "End Date", days, type, "Application Type", reason, status, time_added)
        values (p_tenant, v_employee."Employee Number", btrim(concat_ws(' ', v_employee."First Name", v_employee."Last Name")),
                v_employee."Town", v_type, to_char(v_start, 'YYYY-MM-DD'), to_char(v_end, 'YYYY-MM-DD'), coalesce(v_days, 0),
                case when v_start = v_end and v_days = 0.5 then 'Half Day' else 'Full Day' end,
                'Imported from Figbloom Schools', 'Imported from Figbloom Schools', 'approved', now())
        returning * into a;
        insert into public.leave_history_imports (tenant_id, source, source_id, application_id)
        values (p_tenant, 'schools', v_source, a.id);
        v_result := jsonb_build_object('outcome', case when p_dry_run then 'would_import' else 'imported' end,
          'application_id', case when p_dry_run then null else a.id end,
          'employee_number', a."Employee Number", 'leave_type', a."Leave Type", 'type_mapped', v_mapped,
          'start_date', a."Start Date", 'end_date', a."End Date", 'days', a.days, 'schools_days', v_days);
        if p_dry_run then
          raise exception 'dry run' using errcode = 'XMHR1';
        end if;
      exception
        when sqlstate 'XMHR1' then
          null; -- the dry run's rollback: v_result stays
        when others then
          v_result := jsonb_build_object('outcome', 'refused',
            'reason', case when sqlerrm like 'This overlaps %' then 'overlap' when sqlerrm like 'Not enough %' then 'balance' else 'rules' end,
            'message', left(sqlerrm, 300));
      end;
    end if;
    v_outcome := v_result ->> 'outcome';
    v_counts := v_counts || jsonb_build_object(v_outcome, coalesce((v_counts ->> v_outcome)::int, 0) + 1);
    v_results := v_results || (jsonb_build_object('source_id', nullif(v_source, ''), 'external_id', nullif(v_external, '')) || v_result);
  end loop;

  perform set_config('app.approval_quiet', '', true);
  perform set_config('app.my_hr_import', '', true);
  return jsonb_build_object('dry_run', coalesce(p_dry_run, false), 'counts', v_counts, 'results', v_results);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 10. only the backend
-- ---------------------------------------------------------------------------------------------
revoke all on function public.my_hr_leave_chain(uuid, uuid) from public, anon, authenticated;
revoke all on function public.my_hr_leave_cancel_refusal(public.leave_application) from public, anon, authenticated;
revoke all on function public.my_hr_leave_application(public.leave_application) from public, anon, authenticated;
revoke all on function public.my_hr_leave_approval_item(public.leave_application, text) from public, anon, authenticated;
revoke all on function public.my_hr_act_begin(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.my_hr_act_end(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.my_hr_leave(uuid, text) from public, anon, authenticated;
revoke all on function public.my_hr_leave_form(uuid, text) from public, anon, authenticated;
revoke all on function public.my_hr_leave_apply(uuid, text, uuid, date, date, boolean, text, text, text) from public, anon, authenticated;
revoke all on function public.my_hr_leave_cancel(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.my_hr_approver(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.my_hr_leave_approvals(uuid, uuid) from public, anon, authenticated;
revoke all on function public.my_hr_leave_decide(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.my_hr_leave_import(uuid, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.my_hr_leave(uuid, text) to service_role;
grant execute on function public.my_hr_leave_form(uuid, text) to service_role;
grant execute on function public.my_hr_leave_apply(uuid, text, uuid, date, date, boolean, text, text, text) to service_role;
grant execute on function public.my_hr_leave_cancel(uuid, text, uuid) to service_role;
grant execute on function public.my_hr_approver(uuid, uuid, text) to service_role;
grant execute on function public.my_hr_leave_approvals(uuid, uuid) to service_role;
grant execute on function public.my_hr_leave_decide(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.my_hr_leave_import(uuid, uuid, jsonb, boolean) to service_role;

notify pgrst, 'reload schema';
