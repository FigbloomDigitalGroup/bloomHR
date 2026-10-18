// @vitest-environment node
//
// HR and admins see every task in their company, read-only, for oversight (20261019650000): the task, its comments,
// activity, attachments (rows and stored files), label links and projects. They do not change or delete a task they
// are not concerned with, and other roles still see only what concerns them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const ADM = '00000000-0000-0000-0000-00000000f201'; // ADMIN, not involved
const HR = '00000000-0000-0000-0000-00000000f202'; // HR, not involved
const MGR = '00000000-0000-0000-0000-00000000f203'; // MANAGER with the Task Manager module, not involved
const OPS = '00000000-0000-0000-0000-00000000f204'; // OPERATIONS with the Task Manager module, not involved
const PAT = '00000000-0000-0000-0000-00000000f205'; // STAFF, not involved
const LEAD = '00000000-0000-0000-0000-00000000f206'; // STAFF, leads the project, creates the task
const MO = '00000000-0000-0000-0000-00000000f207'; // STAFF, the assignee
const OUT = '00000000-0000-0000-0000-00000000f208'; // another company's ADMIN
const HRX = '00000000-0000-0000-0000-00000000f209'; // HR, assigned a task of their own

let db: PGlite;
let project: string;
let task: string;
let hrTask: string;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) =>
  asUser(db, user, () => rows<T>(sql, params));
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const migration = (f: string) => readFileSync(join(__dirname, '..', 'migrations', f), 'utf8');

// everything a viewer can read about the task
const sees = async (user: string, id = task) => ({
  task: (await as(user, `select 1 from tasks where id = $1`, [id])).length,
  comments: (await as(user, `select 1 from task_comments where task_id = $1`, [id])).length,
  activity: (await as(user, `select 1 from task_activity where task_id = $1`, [id])).length > 0,
  attachments: (await as(user, `select 1 from task_attachments where task_id = $1`, [id])).length,
  labels: (await as(user, `select 1 from task_label_links where task_id = $1`, [id])).length,
  files: (await as(user, `select 1 from storage.objects where bucket_id = 'task-attachments' and name like $1`, [`%/${id}/%`])).length,
});

beforeAll(async () => {
  db = await bootDb();
  // the test database has no storage schema: add a stand-in, then the task file policies on it
  await db.exec(`
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid());
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as
      $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
    grant usage on schema storage to anon, authenticated;
    grant all on storage.objects to anon, authenticated;
  `);
  for (const f of ['20261019200000_tasks.sql', '20261019500000_task_visibility.sql', '20261019650000_task_oversight.sql',
    '20261020000000_manage_projects.sql']) {
    await db.exec(migration(f));
    await db.exec('reset search_path');
  }
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values
      ('${ADM}', 'adm@a.co'), ('${HR}', 'hr@a.co'), ('${MGR}', 'mgr@a.co'), ('${OPS}', 'ops@a.co'), ('${PAT}', 'pat@a.co'),
      ('${LEAD}', 'lead@a.co'), ('${MO}', 'mo@a.co'), ('${OUT}', 'out@b.co'), ('${HRX}', 'hrx@a.co');
    insert into user_profiles (user_id, email, role, full_name, tenant_id) values
      ('${ADM}', 'adm@a.co', 'ADMIN', null, '${A}'), ('${HR}', 'hr@a.co', 'HR', null, '${A}'),
      ('${MGR}', 'mgr@a.co', 'MANAGER', null, '${A}'), ('${OPS}', 'ops@a.co', 'OPERATIONS', null, '${A}'),
      ('${PAT}', 'pat@a.co', 'STAFF', null, '${A}'), ('${LEAD}', 'lead@a.co', 'STAFF', null, '${A}'),
      ('${MO}', 'mo@a.co', 'STAFF', null, '${A}'), ('${OUT}', 'out@b.co', 'ADMIN', null, '${B}'),
      ('${HRX}', 'hrx@a.co', 'HR', null, '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Job Title", "Status", tenant_id) values
      ('A-ADM', 'Ada', 'Admin', 'adm@a.co', 'Administrator', 'Active', '${A}'),
      ('A-HR', 'Hana', 'HR', 'hr@a.co', 'HR Officer', 'Active', '${A}'),
      ('A-MGR', 'Max', 'Manager', 'mgr@a.co', 'Manager', 'Active', '${A}'),
      ('A-OPS', 'Oli', 'Ops', 'ops@a.co', 'Operations', 'Active', '${A}'),
      ('A-PAT', 'Pat', 'Peer', 'pat@a.co', 'Loan Officer', 'Active', '${A}'),
      ('A-LEAD', 'Lena', 'Lead', 'lead@a.co', 'Team Lead', 'Active', '${A}'),
      ('A-MO', 'Mo', 'Member', 'mo@a.co', 'Loan Officer', 'Active', '${A}'),
      ('A-HRX', 'Hal', 'HR', 'hrx@a.co', 'HR Officer', 'Active', '${A}'),
      ('B-1', 'Bo', 'Other', 'out@b.co', 'Admin', 'Active', '${B}');
    delete from role_permissions where tenant_id = '${A}';
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('ADMIN', array['task-manager', 'task-projects'], '${A}'), ('HR', array['task-manager', 'task-projects'], '${A}'),
      ('MANAGER', array['task-manager', 'task-projects'], '${A}'), ('OPERATIONS', array['task-manager', 'task-projects'], '${A}'),
      ('STAFF', array['task-manager'], '${A}');
  `);
  // a project nobody above created (made by the database), led by Lena, with Mo in it
  project = (await rows<{ id: string }>(
    `insert into task_projects (key, name, lead_number, tenant_id) values ('OPS', 'Operations', 'A-LEAD', $1) returning id`, [A]))[0].id;
  await rows(`insert into task_project_members (project_id, employee_number, tenant_id) values ($1, 'A-MO', $2)`, [project, A]);
  // Lena gives Mo a task (insert then returning, as the app does), comments on it, labels it; Mo attaches a file
  task = (await as<{ id: string }>(LEAD,
    `insert into tasks (project_id, title, assignee_number, created_by) values ($1, 'Count the safe', 'A-MO', $2) returning id`, [project, LEAD]))[0].id;
  await as(LEAD, `insert into task_comments (task_id, body) values ($1, 'Before Friday please')`, [task]);
  const label = (await rows<{ id: string }>(`insert into task_labels (name, tenant_id) values ('Audit', $1) returning id`, [A]))[0].id;
  await as(LEAD, `insert into task_label_links (task_id, label_id) values ($1, $2)`, [task, label]);
  await as(MO, `insert into task_attachments (task_id, path, file_name, uploaded_by) values ($1, $2, 'count.pdf', $3)`, [task, `${A}/${task}/count.pdf`, MO]);
  await as(MO, `insert into storage.objects (bucket_id, name) values ('task-attachments', $1)`, [`${A}/${task}/count.pdf`]);
  // and a task assigned to an HR officer
  hrTask = (await as<{ id: string }>(LEAD,
    `insert into tasks (project_id, title, assignee_number, created_by) values ($1, 'Update the leave form', 'A-HRX', $2) returning id`, [project, LEAD]))[0].id;
}, 180000);

describe('HR and admins oversee every task', () => {
  it('ADMIN and HR see an unrelated task with its comments, activity, attachments, labels and files', async () => {
    for (const who of [ADM, HR]) {
      expect(await sees(who)).toEqual({ task: 1, comments: 1, activity: true, attachments: 1, labels: 1, files: 1 });
      expect(await as(who, `select 1 from task_projects where id = $1`, [project])).toHaveLength(1);
      expect(await as(who, `select 1 from task_project_members where project_id = $1`, [project])).toHaveLength(1);
    }
  });

  it('but cannot change or delete it, comment on it or attach to it', async () => {
    for (const who of [ADM, HR]) {
      expect(await as(who, `update tasks set priority = 'low' where id = $1 returning 1`, [task])).toHaveLength(0);
      expect(await as(who, `delete from tasks where id = $1 returning 1`, [task])).toHaveLength(0);
      expect(await as(who, `select can_edit_task($1) ok`, [task])).toEqual([{ ok: false }]);
      expect(await as(who, `select task_concerns_me($1) ok`, [task])).toEqual([{ ok: false }]);
      expect(await as(who, `delete from task_comments where task_id = $1 returning 1`, [task])).toHaveLength(0);
      expect(await as(who, `delete from task_label_links where task_id = $1 returning 1`, [task])).toHaveLength(0);
      expect(await as(who, `delete from task_attachments where task_id = $1 returning 1`, [task])).toHaveLength(0);
      expect(await as(who, `delete from storage.objects where name like $1 returning 1`, [`%/${task}/%`])).toHaveLength(0);
      expect(await fails(as(who, `insert into task_comments (task_id, body) values ($1, 'x')`, [task]))).toMatch(/row-level security/);
      expect(await fails(as(who, `insert into task_attachments (task_id, path, file_name, uploaded_by) values ($1, 'p', 'f', $2)`, [task, who]))).toMatch(/row-level security/);
      expect(await fails(as(who, `insert into storage.objects (bucket_id, name) values ('task-attachments', $1)`, [`${A}/${task}/x.pdf`]))).toMatch(/row-level security/);
    }
    expect((await rows<{ priority: string }>(`select priority from tasks where id = $1`, [task]))[0].priority).toBe('none');
  });

  it('an HR officer who is concerned (the assignee) still changes their own task', async () => {
    expect(await as(HRX, `select task_concerns_me($1) ok`, [hrTask])).toEqual([{ ok: true }]);
    expect(await as(HRX, `update tasks set status = 'in_progress' where id = $1 returning 1`, [hrTask])).toHaveLength(1);
    expect(await fails(as(HRX, `insert into task_comments (task_id, body) values ($1, 'On it')`, [hrTask]))).toBe('');
    // and only reads the other one
    expect(await as(HRX, `update tasks set priority = 'low' where id = $1 returning 1`, [task])).toHaveLength(0);
  });

  it('admins still create tasks (insert then returning) as people who run tasks', async () => {
    const [t] = await as<{ id: string }>(ADM, `insert into tasks (project_id, title, created_by) values ($1, 'Admin task', $2) returning id`, [project, ADM]);
    expect(t.id).toBeTruthy();
    expect(await as(HR, `select 1 from tasks where id = $1`, [t.id])).toHaveLength(1); // HR sees it too
    expect(await as(HR, `update tasks set title = 'x' where id = $1 returning 1`, [t.id])).toHaveLength(0);
    expect(await as(ADM, `update tasks set title = 'Admin task 2' where id = $1 returning 1`, [t.id])).toHaveLength(1); // its creator
    await as(ADM, `delete from tasks where id = $1`, [t.id]);
  });
});

describe('other roles are unchanged', () => {
  it('MANAGER, OPERATIONS and STAFF who are not involved see none of it', async () => {
    for (const who of [MGR, OPS, PAT]) {
      expect(await sees(who)).toEqual({ task: 0, comments: 0, activity: false, attachments: 0, labels: 0, files: 0 });
      expect(await as(who, `select task_concerns_me($1) ok`, [task])).toEqual([{ ok: false }]);
    }
    expect(await as(PAT, `select 1 from task_projects where id = $1`, [project])).toHaveLength(0);
  });

  it('the people concerned still see it', async () => {
    for (const who of [LEAD, MO]) expect((await sees(who)).task).toBe(1);
  });

  it('another company’s ADMIN sees nothing', async () => {
    expect(await sees(OUT)).toEqual({ task: 0, comments: 0, activity: false, attachments: 0, labels: 0, files: 0 });
    expect(await as(OUT, `select 1 from tasks where tenant_id = $1`, [A])).toHaveLength(0);
    expect(await as(OUT, `select 1 from task_projects where tenant_id = $1`, [A])).toHaveLength(0);
  });

  it('HR’s notifications list still hides other people’s task notifications', async () => {
    expect((await rows(`select 1 from hr_notifications where notification_type = 'task_assigned' and employee_number = 'A-MO'`)).length).toBeGreaterThan(0);
    for (const who of [HR, ADM]) {
      expect(await as(who, `select 1 from hr_notifications where notification_type = 'task_assigned' and employee_number = 'A-MO'`)).toHaveLength(0);
    }
  });
});

describe('the migration', () => {
  it('runs again safely', async () => {
    await db.exec(migration('20261019650000_task_oversight.sql'));
    await db.exec(migration('20261019650000_task_oversight.sql'));
    await db.exec('reset search_path');
    expect((await sees(HR)).task).toBe(1);
    expect((await sees(PAT)).task).toBe(0);
    expect(await as(ADM, `update tasks set priority = 'low' where id = $1 returning 1`, [task])).toHaveLength(0);
    const n = await rows<{ n: number }>(`select count(*)::int n from pg_policies where tablename = 'tasks' and policyname = 'task_select'`);
    expect(n[0].n).toBe(1);
  });
});
