// @vitest-environment node
//
// Recruitment pipeline (FIG-830): stages per job posting, stage moves recorded, interviews with panels, one scorecard
// per panelist, transcripts (text, private files, VideoConf meetings). Everything is behind the 'recruitment' module
// and kept to the company; staff who applied internally still see only their own application.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const REC = '00000000-0000-0000-0000-00000000e001'; // recruiter in A
const PANEL = '00000000-0000-0000-0000-00000000e002'; // recruiter in A, sits on panels
const OUTSIDER = '00000000-0000-0000-0000-00000000e003'; // recruiter in A, not on the panel
const STAFF = '00000000-0000-0000-0000-00000000e004'; // staff in A who applies internally (no recruitment module)
const B_REC = '00000000-0000-0000-0000-00000000e005'; // recruiter in B

const MIGRATION = join(__dirname, '..', 'migrations', '20261015900000_recruitment_pipeline.sql');

let db: PGlite;
let posting: string;
let other: string;
let app: string;
let interview: string;

const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const stage = async (name: string, postingId = posting) =>
  (await rows<{ id: string }>(`select id from recruitment_stages where job_posting_id = '${postingId}' and name = '${name}'`))[0].id;
const stageNames = async (where: string) =>
  (await rows<{ name: string }>(`select name from recruitment_stages where ${where} order by position, created_at`)).map((r) => r.name);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values
      ('${REC}', 'rec@a.co'), ('${PANEL}', 'panel@a.co'), ('${OUTSIDER}', 'out@a.co'), ('${STAFF}', 'staff@a.co'),
      ('${B_REC}', 'rec@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${REC}', 'rec@a.co', 'HR', '${A}'), ('${PANEL}', 'panel@a.co', 'HR', '${A}'), ('${OUTSIDER}', 'out@a.co', 'HR', '${A}'),
      ('${STAFF}', 'staff@a.co', 'STAFF', '${A}'), ('${B_REC}', 'rec@b.co', 'HR', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['recruitment'], '${A}'), ('STAFF', array['dashboard'], '${A}'), ('HR', array['recruitment'], '${B}');
    insert into employees ("Employee Number", "First Name", "Work Email", tenant_id) values ('S1', 'Sam', 'staff@a.co', '${A}');
  `);
  posting = (
    await read<{ id: string }>(
      REC,
      `insert into job_postings (job_title, department, job_type, description, requirements, status)
       values ('Sales Rep', 'Sales', 'Full-time', 'Sell', 'Selling', 'open') returning id`
    )
  )[0].id;
  other = (
    await read<{ id: string }>(
      REC,
      `insert into job_postings (job_title, department, job_type, description, requirements, status)
       values ('Driver', 'Logistics', 'Full-time', 'Drive', 'Licence', 'open') returning id`
    )
  )[0].id;
}, 120000);

describe('stages', () => {
  it('every company has the default stages, and each posting starts with its own copy', async () => {
    const defaults = ['Applied', 'Screening', 'Interview', 'Assessment', 'Offer', 'Hired', 'Rejected'];
    expect(await stageNames(`tenant_id = '${A}' and job_posting_id is null`)).toEqual(defaults);
    expect(await stageNames(`tenant_id = '${B}' and job_posting_id is null`)).toEqual(defaults); // a company added later
    expect(await stageNames(`job_posting_id = '${posting}'`)).toEqual(defaults);
  });

  it("a recruiter renames, adds and reorders a posting's stages without touching the defaults or other postings", async () => {
    await as(REC, `update recruitment_stages set name = 'Phone screen' where id = '${await stage('Screening')}'`);
    await as(REC, `insert into recruitment_stages (job_posting_id, name, position) values ('${posting}', 'Ride along', 4)`);
    // the board renumbers the stages in their new order
    await as(
      REC,
      `update recruitment_stages s set position = v.position
       from (values ('Assessment', 3), ('Interview', 4), ('Ride along', 5), ('Offer', 6), ('Hired', 7), ('Rejected', 8)) as v(name, position)
       where s.job_posting_id = '${posting}' and s.name = v.name`
    );
    expect(await stageNames(`job_posting_id = '${posting}'`)).toEqual([
      'Applied', 'Phone screen', 'Assessment', 'Interview', 'Ride along', 'Offer', 'Hired', 'Rejected',
    ]);
    expect(await stageNames(`tenant_id = '${A}' and job_posting_id is null`)).toContain('Screening');
    expect(await stageNames(`job_posting_id = '${other}'`)).toContain('Screening');
  });

  it('Hired and Rejected stay: they can be renamed but not removed, duplicated or turned into another kind', async () => {
    await expect(as(REC, `delete from recruitment_stages where id = '${await stage('Hired')}'`)).rejects.toThrow(/can't be removed/);
    await expect(as(REC, `insert into recruitment_stages (job_posting_id, name, kind) values ('${posting}', 'Hired 2', 'hired')`)).rejects.toThrow(
      /duplicate|unique/i
    );
    await expect(as(REC, `update recruitment_stages set kind = 'open' where id = '${await stage('Rejected')}'`)).rejects.toThrow(/another kind/);
  });

  it('staff without the module neither see nor change stages', async () => {
    expect(await read(STAFF, `select 1 from recruitment_stages`)).toHaveLength(0);
    await expect(as(STAFF, `insert into recruitment_stages (job_posting_id, name) values ('${posting}', 'Mine')`)).rejects.toThrow(/row-level security/);
  });
});

describe('moving candidates', () => {
  it('a new application starts in the first stage, whatever the applicant asks for, and that is recorded', async () => {
    const hired = await stage('Hired');
    app = (
      await read<{ id: string }>(
        STAFF,
        `insert into job_applications (job_posting_id, employee_number, first_name, last_name, email, status, current_stage_id)
         values ('${posting}', 'S1', 'Sam', 'Staff', 'staff@a.co', 'pending', '${hired}') returning id`
      )
    )[0].id;
    const [a] = await rows<{ current_stage_id: string; hired_at: string | null }>(`select current_stage_id, hired_at from job_applications where id = '${app}'`);
    expect(a).toEqual({ current_stage_id: await stage('Applied'), hired_at: null });
    expect(await rows(`select from_stage_name, to_stage_name, moved_by from application_stage_history where application_id = '${app}'`)).toEqual([
      { from_stage_name: null, to_stage_name: 'Applied', moved_by: STAFF },
    ]);
  });

  it('a recruiter moves the candidate: who, when and the note are recorded, and the status follows', async () => {
    await as(REC, `select move_application_stage('${app}', '${await stage('Phone screen')}', 'Strong CV')`);
    const [a] = await rows<{ status: string }>(`select status from job_applications where id = '${app}'`);
    expect(a.status).toBe('under_review');
    const history = await read<{ from_stage_name: string; to_stage_name: string; note: string; moved_by: string; recent: boolean }>(
      REC,
      `select from_stage_name, to_stage_name, note, moved_by, moved_at > now() - interval '1 minute' as recent
       from application_stage_history where application_id = '${app}' order by moved_at, from_stage_name nulls first`
    );
    expect(history[1]).toEqual({ from_stage_name: 'Applied', to_stage_name: 'Phone screen', note: 'Strong CV', moved_by: REC, recent: true });
  });

  it('Hired marks the application hired; moving back clears it', async () => {
    await as(REC, `select move_application_stage('${app}', '${await stage('Hired')}', null)`);
    let [a] = await rows<{ status: string; hired_at: string | null; hired_by: string | null }>(
      `select status, hired_at, hired_by from job_applications where id = '${app}'`
    );
    expect(a.status).toBe('hired');
    expect(a.hired_at).not.toBeNull();
    expect(a.hired_by).toBe(REC);
    await as(REC, `select move_application_stage('${app}', '${await stage('Interview')}', 'Reference fell through')`);
    [a] = await rows(`select status, hired_at, hired_by from job_applications where id = '${app}'`);
    expect(a).toEqual({ status: 'under_review', hired_at: null, hired_by: null });
  });

  it("refuses a stage from another job's pipeline", async () => {
    await expect(as(REC, `select move_application_stage('${app}', '${await stage('Offer', other)}', null)`)).rejects.toThrow(
      /isn't part of this job's pipeline/
    );
  });

  it('the applicant cannot move themselves, nor read the history', async () => {
    await expect(as(STAFF, `select move_application_stage('${app}', '${await stage('Offer')}', null)`)).rejects.toThrow(
      /Only people with the Recruitment module|Candidate not found/
    );
    await as(STAFF, `update job_applications set hired_at = now() where id = '${app}'`).catch(() => undefined);
    expect((await rows<{ hired_at: string | null }>(`select hired_at from job_applications where id = '${app}'`))[0].hired_at).toBeNull();
    expect(await read(STAFF, `select 1 from application_stage_history`)).toHaveLength(0);
    // they still see their own application, as before
    expect(await read(STAFF, `select id from job_applications`)).toEqual([{ id: app }]);
  });

  it('nobody writes or rewrites the history directly, not even a recruiter', async () => {
    await expect(
      as(REC, `insert into application_stage_history (application_id, to_stage_name) values ('${app}', 'Hired')`)
    ).rejects.toThrow(/row-level security/);
    await as(REC, `delete from application_stage_history`);
    await as(REC, `update application_stage_history set note = 'rewritten'`);
    expect(await rows(`select count(*)::int as n from application_stage_history where application_id = '${app}' and note is distinct from 'rewritten'`)).toEqual([
      { n: 4 },
    ]);
  });

  it('a stage with candidates in it cannot be removed', async () => {
    await expect(as(REC, `delete from recruitment_stages where id = '${await stage('Interview')}'`)).rejects.toThrow(/Move the candidates/);
  });
});

describe('interviews and scorecards', () => {
  beforeAll(async () => {
    interview = (
      await read<{ id: string }>(
        REC,
        `insert into recruitment_interviews (application_id, scheduled_at, mode, meeting_link)
         values ('${app}', now() + interval '1 day', 'video', 'https://meet.example/x') returning id`
      )
    )[0].id;
    await as(REC, `insert into interview_panelists (interview_id, user_id) values ('${interview}', '${REC}'), ('${interview}', '${PANEL}')`);
  });

  it('an interview is saved against the candidate, in their current stage, by the recruiter', async () => {
    const [i] = await rows(`select stage_id, status, created_by from recruitment_interviews where id = '${interview}'`);
    expect(i).toEqual({ stage_id: await stage('Interview'), status: 'scheduled', created_by: REC });
  });

  it('a panelist must be someone in the company', async () => {
    await expect(as(REC, `insert into interview_panelists (interview_id, user_id) values ('${interview}', '${B_REC}')`)).rejects.toThrow(
      /someone in your company/
    );
  });

  it('each panelist scores the criteria and recommends, once', async () => {
    for (const [user, rec, scores] of [
      [PANEL, 'strong_yes', [5, 4]],
      [REC, 'no', [2, 3]],
    ] as const) {
      const id = (
        await read<{ id: string }>(user, `insert into interview_scorecards (interview_id, recommendation, notes) values ('${interview}', '${rec}', 'ok') returning id`)
      )[0].id;
      await as(user, `insert into scorecard_ratings (scorecard_id, criterion, score) values ('${id}', 'Communication', ${scores[0]}), ('${id}', 'Experience', ${scores[1]})`);
    }
    await expect(as(PANEL, `insert into interview_scorecards (interview_id, recommendation) values ('${interview}', 'yes')`)).rejects.toThrow(/duplicate|unique/i);
    const summary = await read(
      OUTSIDER,
      `select s.panelist_id, s.recommendation, round(avg(r.score), 1)::text as avg
       from interview_scorecards s join scorecard_ratings r on r.scorecard_id = s.id group by 1, 2 order by 3 desc`
    );
    expect(summary).toEqual([
      { panelist_id: PANEL, recommendation: 'strong_yes', avg: '4.5' },
      { panelist_id: REC, recommendation: 'no', avg: '2.5' },
    ]);
  });

  it("nobody writes another panelist's scorecard, and only the panel scores", async () => {
    await expect(
      as(REC, `insert into interview_scorecards (interview_id, panelist_id, recommendation) values ('${interview}', '${OUTSIDER}', 'yes')`)
    ).rejects.toThrow(/row-level security|Only the interview's panel/);
    await expect(
      as(REC, `insert into interview_scorecards (interview_id, panelist_id, recommendation) values ('${interview}', '${PANEL}', 'no')`)
    ).rejects.toThrow(/row-level security|duplicate/);
    await expect(as(OUTSIDER, `insert into interview_scorecards (interview_id, recommendation) values ('${interview}', 'yes')`)).rejects.toThrow(
      /Only the interview's panel/
    );
    await as(REC, `update interview_scorecards set recommendation = 'strong_no' where panelist_id = '${PANEL}'`);
    await as(REC, `update scorecard_ratings set score = 1`);
    expect(await rows(`select recommendation from interview_scorecards where panelist_id = '${PANEL}'`)).toEqual([{ recommendation: 'strong_yes' }]);
    expect(await rows(`select score from scorecard_ratings where score = 5`)).toEqual([{ score: 5 }]);
  });

  it('scores are 1 to 5', async () => {
    const [{ id }] = await rows<{ id: string }>(`select id from interview_scorecards where panelist_id = '${PANEL}'`);
    await expect(as(PANEL, `insert into scorecard_ratings (scorecard_id, criterion, score) values ('${id}', 'Attitude', 6)`)).rejects.toThrow(/check/i);
  });

  it('staff without the module see no interviews, panels or scores, even about their own application', async () => {
    for (const t of ['recruitment_interviews', 'interview_panelists', 'interview_scorecards', 'scorecard_ratings']) {
      expect(await read(STAFF, `select 1 from ${t}`)).toHaveLength(0);
    }
  });
});

describe('transcripts', () => {
  it('pasted text and a file in the interview folder are kept; a file elsewhere is refused', async () => {
    await as(REC, `insert into interview_transcripts (interview_id, kind, body) values ('${interview}', 'text', 'Q: Why sales?')`);
    await as(REC, `insert into interview_transcripts (interview_id, kind, file_path, file_name) values ('${interview}', 'file', '${A}/${interview}/f.pdf', 'notes.pdf')`);
    await expect(
      as(REC, `insert into interview_transcripts (interview_id, kind, file_path) values ('${interview}', 'file', '${B}/${interview}/f.pdf')`)
    ).rejects.toThrow(/own folder/);
    await expect(as(REC, `insert into interview_transcripts (interview_id, kind, body) values ('${interview}', 'text', '  ')`)).rejects.toThrow(/check/i);
  });

  it("a VideoConf meeting's transcripts are copied onto the interview; other companies' meetings are not found", async () => {
    await db.exec(`
      insert into meeting_transcripts (meeting_code, participant_name, transcript, summary, tenant_id) values
        ('abc-123', 'Sam', 'Hello there', 'Went well', '${A}'), ('xyz-999', 'Eve', 'Secret', null, '${B}');
    `);
    expect(await read(REC, `select link_meeting_transcript('${interview}', 'abc-123') as n`)).toEqual([{ n: 1 }]);
    expect(await read(REC, `select link_meeting_transcript('${interview}', 'abc-123') as n`)).toEqual([{ n: 0 }]); // not twice
    expect(await read(REC, `select title, body from interview_transcripts where kind = 'meeting'`)).toEqual([
      { title: 'Sam', body: 'Went well\n\nHello there' },
    ]);
    await expect(as(REC, `select link_meeting_transcript('${interview}', 'xyz-999')`)).rejects.toThrow(/No transcript found/);
    await expect(as(STAFF, `select link_meeting_transcript('${interview}', 'abc-123')`)).rejects.toThrow(/Recruitment module/);
    expect(await read(STAFF, `select 1 from interview_transcripts`)).toHaveLength(0);
  });
});

describe('other companies', () => {
  it("see none of the company's pipeline and cannot add to it", async () => {
    for (const t of ['application_stage_history', 'recruitment_interviews', 'interview_panelists', 'interview_scorecards', 'scorecard_ratings', 'interview_transcripts']) {
      expect(await read(B_REC, `select 1 from ${t}`)).toHaveLength(0);
    }
    expect(await read(B_REC, `select 1 from recruitment_stages where tenant_id = '${A}'`)).toHaveLength(0);
    await expect(
      as(B_REC, `insert into recruitment_interviews (application_id, scheduled_at) values ('${app}', now())`)
    ).rejects.toThrow(/Unknown candidate/);
    await expect(as(B_REC, `select move_application_stage('${app}', '${await stage('Offer')}', null)`)).rejects.toThrow(/Candidate not found/);
    await expect(as(B_REC, `insert into recruitment_stages (job_posting_id, name) values ('${posting}', 'Sneaky')`)).rejects.toThrow(/Unknown job posting/);
  });
});

describe('transcript files in storage', () => {
  beforeAll(async () => {
    await db.exec(`
      create schema storage;
      create table storage.buckets (id text primary key, name text, public boolean);
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      create function storage.foldername(name text) returns text[] language sql immutable as
        $$ select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $$;
      grant usage on schema storage to anon, authenticated;
      grant all on storage.objects to anon, authenticated;
    `);
    // the migration runs again, now with storage: it is safe to run twice
    await db.exec(readFileSync(MIGRATION, 'utf8'));
  });

  const put = (name: string) => db.query(`insert into storage.objects (bucket_id, name) values ('interview-transcripts', '${name}')`);
  const visible = async () => (await rows<{ name: string }>(`select name from storage.objects where bucket_id = 'interview-transcripts'`)).map((r) => r.name);

  it('the bucket is private', async () => {
    expect(await rows(`select public from storage.buckets where id = 'interview-transcripts'`)).toEqual([{ public: false }]);
  });

  it('recruiters save and open files in their company folder; staff and other companies cannot', async () => {
    await asUser(db, REC, async () => {
      await expect(put(`${A}/${interview}/t.pdf`)).resolves.toBeTruthy();
      await expect(put(`${B}/${interview}/t.pdf`)).rejects.toThrow(/row-level security/);
    });
    await asUser(db, STAFF, async () => {
      await expect(put(`${A}/${interview}/s.pdf`)).rejects.toThrow(/row-level security/);
      expect(await visible()).toEqual([]);
    });
    expect(await asUser(db, PANEL, visible)).toEqual([`${A}/${interview}/t.pdf`]);
    expect(await asUser(db, B_REC, visible)).toEqual([]);
  });

  it('running the migration again kept every stage and recorded nothing new', async () => {
    expect(await stageNames(`job_posting_id = '${posting}'`)).toHaveLength(8);
    expect(await rows(`select count(*)::int as n from application_stage_history where application_id = '${app}'`)).toEqual([{ n: 4 }]);
  });
});

describe('removing a posting', () => {
  it('takes its pipeline and candidates with it', async () => {
    await as(REC, `delete from job_postings where id = '${posting}'`);
    expect(await rows(`select 1 from recruitment_stages where job_posting_id = '${posting}'`)).toHaveLength(0);
    expect(await rows(`select 1 from job_applications where id = '${app}'`)).toHaveLength(0);
  });
});
