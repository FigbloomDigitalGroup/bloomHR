// @vitest-environment node
//
// Staff add their own tasks (the company's Personal project) and sub-tasks under the tasks they work on
// (20261027200000). A Personal task is the creator's own: the rest of the company never sees it. Real migrations on
// PGlite.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000e901'; // HR: manages projects and oversees tasks
const LEAD = '00000000-0000-0000-0000-00000000e902'; // STAFF, leads OPS
const MO = '00000000-0000-0000-0000-00000000e903'; // STAFF, given a task in OPS, not in the project
const PAT = '00000000-0000-0000-0000-00000000e904'; // STAFF, in no project
const FILE = '20261027200000_staff_own_tasks.sql';

let db: PGlite;
let ops: string;
let moTask: string;

const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) => asUser(db, user, () => rows<T>(sql, params));
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const personal = async (tenant: string) =>
  (await rows<{ id: string; key: string; name: string }>(`select id, key, name from task_projects where tenant_id = $1 and personal`, [tenant]));

beforeAll(async () => {
  db = await bootDb({
    file: FILE,
    seed: async (d) => {
      await d.exec(`
        insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
        insert into auth.users (id, email) values
          ('${HR}', 'hr@a.co'), ('${LEAD}', 'lead@a.co'), ('${MO}', 'mo@a.co'), ('${PAT}', 'pat@a.co');
        insert into user_profiles (user_id, email, role, full_name, tenant_id) values
          ('${HR}', 'hr@a.co', 'HR', null, '${A}'), ('${LEAD}', 'lead@a.co', 'STAFF', null, '${A}'),
          ('${MO}', 'mo@a.co', 'STAFF', null, '${A}'), ('${PAT}', 'pat@a.co', 'STAFF', null, '${A}');
        insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Job Title", "Status", tenant_id) values
          ('A-HR', 'Hana', 'HR', 'hr@a.co', 'HR Officer', 'Active', '${A}'),
          ('A-LEAD', 'Lena', 'Lead', 'lead@a.co', 'Team Lead', 'Active', '${A}'),
          ('A-MO', 'Mo', 'Member', 'mo@a.co', 'Loan Officer', 'Active', '${A}'),
          ('A-PAT', 'Pat', 'Peer', 'pat@a.co', 'Loan Officer', 'Active', '${A}');
        -- a project whose key a Personal project would want
        insert into task_projects (key, name, tenant_id) values ('MY', 'Marketing Year', '${B}');
      `);
    },
  });
  ops = (await rows<{ id: string }>(
    `insert into task_projects (key, name, lead_number, tenant_id) values ('OPS', 'Operations', 'A-LEAD', $1) returning id`, [A]))[0].id;
  moTask = (await as<{ id: string }>(LEAD,
    `insert into tasks (project_id, title, assignee_number, created_by) values ($1, 'Count the safe', 'A-MO', $2) returning id`, [ops, LEAD]))[0].id;
}, 180000);

describe('the Personal project', () => {
  it('every company has one, with a free key', async () => {
    expect(await personal(A)).toEqual([expect.objectContaining({ key: 'MY', name: 'Personal' })]);
    expect(await personal(B)).toEqual([expect.objectContaining({ key: 'MINE' })]);
  });

  it('a new company gets one too', async () => {
    const founder = '00000000-0000-0000-0000-00000000e9f1';
    await db.exec(`insert into auth.users (id, email) values ('${founder}', 'founder@new.co')`);
    const [{ id }] = await as<{ id: string }>(founder, `select create_company('New Co') id`);
    expect(await personal(id)).toHaveLength(1);
  });

  it('staff in no project see it and add their own task there', async () => {
    const [mine] = await personal(A);
    expect((await as(PAT, `select id from task_projects where personal`))).toEqual([{ id: mine.id }]);
    const [t] = await as<{ key: string }>(PAT,
      `insert into tasks (project_id, title, assignee_number, created_by) values ($1, 'Plan my week', 'A-PAT', $2) returning key`, [mine.id, PAT]);
    expect(t.key).toBe('MY-1');
    // or for nobody yet
    await as(PAT, `insert into tasks (project_id, title, created_by) values ($1, 'Read the policy', $2)`, [mine.id, PAT]);
  });

  it('a Personal task is never given to someone else, nor made for a group', async () => {
    const [mine] = await personal(A);
    expect(await fails(as(PAT, `insert into tasks (project_id, title, assignee_number, created_by) values ($1, 'Yours', 'A-MO', $2)`, [mine.id, PAT])))
      .toMatch(/only be given to the person who added it/);
    expect(await fails(as(PAT, `update tasks set assignee_number = 'A-MO' where title = 'Plan my week'`)))
      .toMatch(/only be given to the person who added it/);
    expect(await fails(as(HR, `select create_group_task($1, 'All of you', null, 'none', null::date, 'people', null::uuid, null::text, array['A-MO'])`, [mine.id])))
      .toMatch(/Personal tasks are for yourself/);
  });

  it('nobody else sees a Personal task: not other staff, not a project manager; HR oversight does', async () => {
    const seen = async (user: string) => (await as<{ title: string }>(user, `select title from tasks where title = 'Plan my week'`)).length;
    expect(await seen(PAT)).toBe(1);
    expect(await seen(MO)).toBe(0);
    expect(await seen(LEAD)).toBe(0);
    expect(await seen(HR)).toBe(1);
  });

  it('has no lead, department or members, is not archived, and stays', async () => {
    const [mine] = await personal(A);
    expect(await fails(as(HR, `update task_projects set lead_number = 'A-HR' where id = $1`, [mine.id]))).toMatch(/no lead or department/);
    expect(await fails(as(HR, `update task_projects set archived = true where id = $1`, [mine.id]))).toMatch(/cannot be archived/);
    expect(await fails(as(HR, `insert into task_project_members (project_id, employee_number) values ($1, 'A-HR')`, [mine.id])))
      .toMatch(/has no members/);
    expect(await fails(as(HR, `delete from task_projects where id = $1`, [mine.id]))).toMatch(/cannot be deleted/);
    // a manager can still rename it
    await as(HR, `update task_projects set name = 'My own work' where id = $1`, [mine.id]);
    expect((await personal(A))[0].name).toBe('My own work');
  });

  it('holds no recurring tasks', async () => {
    const [mine] = await personal(A);
    expect(await fails(as(HR, `insert into task_templates (project_id, title, schedule, target_kind, people) values ($1, 'Daily check', 'daily', 'people', array['A-MO'])`, [mine.id])))
      .toMatch(/recurring task cannot be in the Personal project/);
  });

  it('only the system makes one, and no project becomes Personal', async () => {
    expect(await fails(as(HR, `insert into task_projects (key, name, personal) values ('ME2', 'Mine too', true)`))).toMatch(/made by the system/);
    expect(await fails(as(HR, `update task_projects set personal = true where id = $1`, [ops]))).toMatch(/cannot be made Personal/);
  });
});

describe('sub-tasks', () => {
  it('the assignee adds a sub-task under their task in a project they are not in', async () => {
    const [sub] = await as<{ project_id: string; key: string }>(MO,
      `insert into tasks (project_id, parent_id, title, created_by) values ($1, $2, 'Count the coins', $3) returning project_id, key`,
      [ops, moTask, MO]);
    expect(sub.project_id).toBe(ops);
    expect(sub.key).toBe('OPS-2');
  });

  it('a sub-task always lands in its parent’s project, whatever project is sent', async () => {
    const [mine] = await personal(A);
    const [sub] = await as<{ project_id: string }>(MO,
      `insert into tasks (project_id, parent_id, title, created_by) values ($1, $2, 'Count the notes', $3) returning project_id`,
      [mine.id, moTask, MO]);
    expect(sub.project_id).toBe(ops);
  });

  it('someone who may not change the task cannot add under it, nor add to a project they are not in', async () => {
    expect(await fails(as(PAT, `insert into tasks (project_id, parent_id, title, created_by) values ($1, $2, 'Sneak', $3)`, [ops, moTask, PAT])))
      .toMatch(/row-level security/);
    expect(await fails(as(MO, `insert into tasks (project_id, title, created_by) values ($1, 'Top level', $2)`, [ops, MO])))
      .toMatch(/row-level security/);
  });
});

describe('running again', () => {
  it('changes nothing', async () => {
    await db.exec(readFileSync(join(__dirname, '..', 'migrations', FILE), 'utf8'));
    await db.exec('reset search_path');
    expect(await personal(A)).toHaveLength(1);
    expect(await personal(B)).toHaveLength(1);
  });
});
