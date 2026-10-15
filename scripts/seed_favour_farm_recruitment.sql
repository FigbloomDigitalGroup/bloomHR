-- Demo recruitment data for Favour Farm: 3 jobs, 12 candidates across the pipeline, interviews (done, upcoming,
-- cancelled, no-show) with panels, scorecards and a transcript.
--
-- Run once in the Supabase SQL editor (it runs as postgres, so RLS is skipped). It is not a migration: the data is
-- for this one company's demo. It stops if the company isn't found or the demo jobs are already there.
--   * jobs are marked posted_by = 'demo-seed' and kept off the public careers page (is_public = false)
--   * candidates are marked source = 'demo-seed', with @example.com emails, so nothing reaches a real person
--   * the panel is up to 3 people who can already sign in to the company; with nobody, interviews have no panel
-- To remove it all, run the block at the end of this file.

do $$
declare
  t uuid;
  panel uuid[];
  jobs uuid[] := '{}';
  j uuid;
  open_stages uuid[];
  hired_stage uuid;
  rejected_stage uuid;
  app uuid;
  iv uuid;
  sc uuid;
  c record;
  stage uuid;
  applied timestamptz;
  n int := 0;
begin
  select id into t from public.tenants where name ilike '%favour%farm%' order by created_at limit 1;
  if t is null then
    raise exception 'No company named like "Favour Farm" found';
  end if;
  if exists (select 1 from public.job_postings where tenant_id = t and posted_by = 'demo-seed') then
    raise notice 'Demo recruitment data is already there for this company; nothing done';
    return;
  end if;

  select array_agg(user_id) into panel
  from (select m.user_id from public.memberships m
        where m.tenant_id = t and m.account_status = 'ACTIVE'
        order by (m.role = 'ADMIN') desc, m.created_at limit 3) p;

  -- jobs (each gets its own copy of the company's stages from the posting trigger)
  insert into public.job_postings (tenant_id, job_title, department, location, job_type, job_level, description,
                                   requirements, responsibilities, salary_range, benefits, application_deadline,
                                   status, posted_by, is_public)
  values
    (t, 'Farm Supervisor', 'Operations', 'Limuru', 'Full-time', 'Mid-level',
     'Lead a team of 25 field workers across our tea and vegetable blocks.',
     'Diploma in Agriculture or related field; 3+ years supervising farm teams; basic computer skills.',
     'Plan daily work, track picking and output, keep attendance, enforce safety and quality standards.',
     'KES 45,000 - 60,000', 'Housing allowance, medical cover, transport', current_date + 21, 'open', 'demo-seed', false),
    (t, 'Agronomist', 'Production', 'Limuru', 'Full-time', 'Senior',
     'Own crop health, soil fertility and spraying programmes for 120 acres.',
     'BSc Agronomy or Horticulture; 4+ years in commercial farming; PCPB pesticide handling certificate.',
     'Soil and leaf testing, fertiliser and spray plans, pest scouting, training field staff.',
     'KES 90,000 - 120,000', 'Medical cover, motorbike allowance', current_date + 14, 'open', 'demo-seed', false),
    (t, 'Accounts Assistant', 'Finance', 'Nairobi', 'Full-time', 'Entry',
     'Support payroll, supplier payments and month-end in a growing agribusiness.',
     'CPA Part II or degree in Commerce; knowledge of PAYE, SHIF, NSSF and Housing Levy; Excel.',
     'Prepare payroll inputs, reconcile M-Pesa and bank, file statutory returns, keep records.',
     'KES 35,000 - 45,000', 'Medical cover', current_date + 10, 'open', 'demo-seed', false);
  select array_agg(id order by array_position(array['Farm Supervisor', 'Agronomist', 'Accounts Assistant'], job_title))
    into jobs
  from public.job_postings where tenant_id = t and posted_by = 'demo-seed';

  -- candidates: (job #, first, last, county, experience, expected salary, where they are: 1-5 open stage, 'hired', 'rejected')
  for c in
    select * from (values
      (1, 'Peter',   'Kamau',    'Kiambu',   '6 years as field supervisor, Kakuzi',              'KES 55,000',  '4'),
      (1, 'Grace',   'Wanjiru',  'Nakuru',   '4 years team lead, flower farm in Naivasha',       'KES 50,000',  '3'),
      (1, 'Samuel',  'Otieno',   'Kisumu',   '3 years sugarcane outgrower supervisor',           'KES 48,000',  '2'),
      (1, 'Esther',  'Chebet',   'Kericho',  '5 years tea estate supervisor',                    'KES 52,000',  'hired'),
      (1, 'Brian',   'Mutua',    'Machakos', '1 year farm hand',                                 'KES 45,000',  'rejected'),
      (2, 'Faith',   'Njeri',    'Nyeri',    '5 years agronomist, horticulture exporter',        'KES 110,000', '3'),
      (2, 'Dennis',  'Kiprono',  'Uasin Gishu', '4 years crop protection, agrochemical company', 'KES 100,000', '5'),
      (2, 'Mercy',   'Akinyi',   'Siaya',    'Graduate trainee, KALRO',                          'KES 85,000',  '1'),
      (2, 'John',    'Mwangi',   'Murang''a','7 years farm manager, avocado orchards',           'KES 120,000', '3'),
      (3, 'Lucy',    'Wambui',   'Nairobi',  '2 years payroll clerk, SME accounting firm',       'KES 40,000',  '3'),
      (3, 'Kevin',   'Ochieng',  'Kisumu',   'CPA finalist, 1 year audit assistant',             'KES 38,000',  '2'),
      (3, 'Joy',     'Muthoni',  'Kiambu',   'Fresh graduate, BCom Finance',                     'KES 35,000',  '1')
    ) v(job, first_name, last_name, county, experience, expected, at_stage)
  loop
    n := n + 1;
    j := jobs[c.job];
    select array_agg(id order by position, created_at) into open_stages
      from public.recruitment_stages where tenant_id = t and job_posting_id = j and kind = 'open';
    select id into hired_stage from public.recruitment_stages where tenant_id = t and job_posting_id = j and kind = 'hired';
    select id into rejected_stage from public.recruitment_stages where tenant_id = t and job_posting_id = j and kind = 'rejected';
    stage := case c.at_stage
               when 'hired' then hired_stage
               when 'rejected' then rejected_stage
               else open_stages[least(c.at_stage::int, array_length(open_stages, 1))] end;
    applied := now() - ((20 - n) || ' days')::interval;

    insert into public.job_applications (tenant_id, job_posting_id, first_name, last_name, email, phone, nationality,
                                         county, position, work_experience, expected_salary, education, skills,
                                         languages, why_joining_us, cover_letter, applied_at, current_stage_id, status,
                                         source)
    values (t, j, c.first_name, c.last_name,
            lower(c.first_name || '.' || c.last_name) || '@example.com',
            '+2547000001' || lpad(n::text, 2, '0'), 'Kenyan', c.county,
            (select job_title from public.job_postings where id = j), c.experience, c.expected,
            case c.job when 2 then 'BSc Agronomy' when 3 then 'BCom / CPA' else 'Diploma in Agriculture' end,
            case c.job when 2 then 'Soil testing, IPM, spray programmes'
                       when 3 then 'Excel, QuickBooks, PAYE and statutory returns'
                       else 'Team leadership, attendance tracking, picking targets' end,
            'English, Kiswahili',
            'I want to grow with a farm that is investing in its people and systems.',
            'Please find my application for the role. I am available to start within a month.',
            applied, stage,
            case when stage = open_stages[1] then 'pending' when stage = rejected_stage then 'rejected'
                 when stage = hired_stage then 'hired' else 'under_review' end,
            'demo-seed')
    returning id into app;

    -- the history: the trigger wrote one move (to where they are now); give it a believable date and the stage they
    -- came from, and add the steps before it
    if stage = open_stages[1] then
      update public.application_stage_history set moved_at = applied where application_id = app;
    else
      update public.application_stage_history h set
        from_stage_id = prev.id, from_stage_name = prev.name, moved_by = panel[1],
        note = case when c.at_stage = 'rejected' then 'Did not attend the interview'
                    when c.at_stage = 'hired' then 'Accepted the offer'
                    when c.at_stage = '2' then 'CV meets the requirements' end,
        moved_at = case when c.at_stage in ('2') then applied + interval '1 day'
                        when c.at_stage = '3' then applied + interval '3 days'
                        else now() - interval '1 day' end
      from public.recruitment_stages prev
      where h.application_id = app
        and prev.id = case when c.at_stage = '2' then open_stages[1]
                           when c.at_stage = 'hired' then coalesce(open_stages[5], open_stages[3])
                           when c.at_stage = 'rejected' then open_stages[3]
                           else open_stages[c.at_stage::int - 1] end;
      insert into public.application_stage_history (tenant_id, application_id, to_stage_id, to_stage_name, note, moved_at)
      select t, app, s.id, s.name, 'Applied', applied from public.recruitment_stages s where s.id = open_stages[1];
      if c.at_stage <> '2' then
        insert into public.application_stage_history (tenant_id, application_id, from_stage_id, from_stage_name,
                                                       to_stage_id, to_stage_name, note, moved_by, moved_at)
        select t, app, s1.id, s1.name, s2.id, s2.name, 'CV meets the requirements', panel[1], applied + interval '1 day'
        from public.recruitment_stages s1, public.recruitment_stages s2
        where s1.id = open_stages[1] and s2.id = open_stages[2];
      end if;
    end if;

    -- interviews for everyone who reached the Interview stage or beyond
    if c.at_stage in ('3', '4', '5', 'hired', 'rejected') then
      insert into public.recruitment_interviews (tenant_id, application_id, stage_id, scheduled_at, duration_minutes,
                                                 mode, location, meeting_link, status, notes, created_by)
      values (t, app, coalesce(open_stages[3], stage),
              case when c.at_stage = '3' and c.first_name in ('Grace', 'Faith', 'Lucy') then
                     date_trunc('hour', now()) + ((n % 5 + 1) || ' days')::interval + interval '10 hours'
                   else date_trunc('hour', now()) - ((n % 6 + 2) || ' days')::interval + interval '10 hours' end,
              45,
              case when c.job = 3 then 'video' else 'in_person' end,
              case when c.job = 3 then null else 'Favour Farm office, Limuru' end,
              case when c.job = 3 then 'https://meet.example.com/favour-farm-' || n end,
              case when c.at_stage = '3' and c.first_name in ('Grace', 'Faith', 'Lucy') then 'scheduled'
                   when c.first_name = 'Brian' then 'no_show'
                   when c.first_name = 'John' then 'cancelled'
                   else 'done' end,
              case when c.first_name = 'John' then 'Candidate asked to reschedule' end,
              panel[1])
      returning id into iv;

      if panel is not null then
        insert into public.interview_panelists (interview_id, user_id, tenant_id)
        select iv, u, t from unnest(panel) u;

        -- scorecards for the interviews that happened
        if exists (select 1 from public.recruitment_interviews where id = iv and status = 'done') then
          for i in 1 .. array_length(panel, 1) loop
            insert into public.interview_scorecards (tenant_id, interview_id, panelist_id, recommendation, notes)
            values (t, iv, panel[i],
                    case when c.at_stage in ('hired', '5') then (array['strong_yes', 'yes'])[1 + (i % 2)]
                         when c.at_stage = '4' then 'yes'
                         else (array['yes', 'no'])[1 + (i % 2)] end,
                    case when c.at_stage in ('hired', '5') then 'Clear, practical answers; strong references.'
                         else 'Good attitude; needs more hands-on experience.' end)
            returning id into sc;
            insert into public.scorecard_ratings (tenant_id, scorecard_id, criterion, score)
            select t, sc, crit,
                   least(5, greatest(1, case when c.at_stage in ('hired', '5') then 4 else 3 end + ((i + k) % 2)))
            from unnest(array['Technical knowledge', 'Communication', 'Leadership', 'Culture fit']) with ordinality u(crit, k);
          end loop;
        end if;
      end if;

      if c.first_name in ('Peter', 'Esther') then
        insert into public.interview_transcripts (tenant_id, interview_id, kind, title, body, created_by)
        values (t, iv, 'text', 'Interview notes',
                'Q: How do you keep a picking team on target?' || chr(10) ||
                'A: Daily targets per block, weighing at the collection point twice a day, and recognising the top pickers.' || chr(10) ||
                'Q: How do you handle absenteeism?' || chr(10) ||
                'A: Track attendance from the first day, talk to the worker early, and follow the disciplinary policy.',
                panel[1]);
      end if;
    end if;
  end loop;

  raise notice 'Seeded 3 jobs, % candidates and their interviews for company %', n, t;
end $$;

-- ---------------------------------------------------------------------------------------------
-- To remove the demo data (candidates first; their interviews, scores and history go with them):
-- ---------------------------------------------------------------------------------------------
-- delete from public.job_applications a using public.tenants t
--   where a.tenant_id = t.id and t.name ilike '%favour%farm%' and a.source = 'demo-seed';
-- delete from public.job_postings p using public.tenants t
--   where p.tenant_id = t.id and t.name ilike '%favour%farm%' and p.posted_by = 'demo-seed';
