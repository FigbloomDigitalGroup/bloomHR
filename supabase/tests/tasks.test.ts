// @vitest-environment node
//
// Tasks like Linear (20261019200000): projects with keys, who sees and changes a task, sub-tasks, a task for a whole
// department (one per person under a group task), recurring role tasks once per period, the activity log,
// notifications (assigned, @mentioned, commented, done) and the old todos copied into a "General" project.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000e101'; // runs tasks
const LEAD = '00000000-0000-0000-0000-00000000e102'; // STAFF, leads the project
const MO = '00000000-0000-0000-0000-00000000e103'; // STAFF, a project member, reports to BOSS
const BOSS = '00000000-0000-0000-0000-00000000e104'; // STAFF, Mo's supervisor (not in the project)
const PAT = '00000000-0000-0000-0000-00000000e105'; // STAFF, an unrelated colleague
const RITA = '00000000-0000-0000-0000-00000000e106'; // STAFF, in Sales
const OUT = '00000000-0000-0000-0000-00000000e107'; // another company's admin
const OLD = '00000000-0000-0000-0000-00000000e108'; // an old login with no employee record

let db: PGlite;
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
const titlesFor = async (user: string) =>
  (await as<{ title: string }>(user, `select title from tasks where project_id = $1 order by title`, [project])).map((r) => r.title);
const notes = async (number: string) =>
  rows<{ title: string; message: string; notification_type: string }>(
    `select title, message, notification_type from hr_notifications where employee_number = $1 order by id`, [number]);

let project: string;
let sales: string;

beforeAll(async () => {
  db = await bootDb({
    file: '20261019200000_tasks.sql',
    // the old task manager's rows, with the free text and gaps live data has
    seed: async (d) => {
      await d.exec(`
        insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
        insert into auth.users (id, email) values
          ('${HR}', 'hr@a.co'), ('${LEAD}', 'lead@a.co'), ('${MO}', 'mo@a.co'), ('${BOSS}', 'boss@a.co'),
          ('${PAT}', 'pat@a.co'), ('${RITA}', 'rita@a.co'), ('${OUT}', 'out@b.co'), ('${OLD}', 'old@a.co');
        insert into user_profiles (user_id, email, role, full_name, tenant_id) values
          ('${HR}', 'hr@a.co', 'HR', 'Hana HR', '${A}'), ('${LEAD}', 'lead@a.co', 'STAFF', null, '${A}'),
          ('${MO}', 'mo@a.co', 'STAFF', null, '${A}'), ('${BOSS}', 'boss@a.co', 'STAFF', null, '${A}'),
          ('${PAT}', 'pat@a.co', 'STAFF', null, '${A}'), ('${RITA}', 'rita@a.co', 'STAFF', null, '${A}'),
          ('${OUT}', 'out@b.co', 'ADMIN', null, '${B}'), ('${OLD}', 'old@a.co', 'STAFF', null, '${A}');
        insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Job Title", "Status", tenant_id) values
          ('A-HR', 'Hana', 'HR', 'hr@a.co', 'HR Officer', 'Active', '${A}'),
          ('A-LEAD', 'Lena', 'Lead', 'lead@a.co', 'Team Lead', 'Active', '${A}'),
          ('A-MO', 'Mo', 'Member', 'mo@a.co', 'Loan Officer', 'Active', '${A}'),
          ('A-BOSS', 'Ben', 'Boss', 'boss@a.co', 'Branch Manager', 'Active', '${A}'),
          ('A-PAT', 'Pat', 'Peer', 'pat@a.co', 'Loan Officer', 'Active', '${A}'),
          ('A-RITA', 'Rita', 'Sales', 'rita@a.co', 'Sales Rep', 'Active', '${A}'),
          ('A-SAM', 'Sam', 'Sales', 'sam@a.co', 'sales rep ', 'Active', '${A}'),
          ('A-GONE', 'Gus', 'Gone', 'gus@a.co', 'Sales Rep', 'Terminated', '${A}'),
          ('B-1', 'Bo', 'Other', 'out@b.co', 'Sales Rep', 'Active', '${B}');
        insert into todos (id, title, description, user_id, assigned_to, status, priority, department, category, completed, due_date, tenant_id) values
          ('00000000-0000-0000-0000-0000000f0001', 'Old follow-up', 'Call the client', '${HR}', 'A-MO', 'in-progress', 'critical', 'credit', 'collections', false, '2026-09-30', '${A}'),
          ('00000000-0000-0000-0000-0000000f0002', 'Old by login', null, '${PAT}', '${MO}', 'not-started', 'low', null, null, true, null, '${A}'),
          ('00000000-0000-0000-0000-0000000f0003', '  ', null, null, 'Someone Who Left', null, null, 'ops', null, null, null, '${A}'),
          ('00000000-0000-0000-0000-0000000f0004', 'Odd one', null, '${OLD}', 'not-a-uuid-zzzz', 'weird', 'Whatever', null, null, false, null, '${A}'),
          ('00000000-0000-0000-0000-0000000f0005', 'Other company', null, '${OUT}', 'B-1', 'on-hold', 'high', null, null, false, null, '${B}');
      `);
    },
  });
  await db.exec(`
    delete from role_permissions where tenant_id = '${A}';
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees', 'task-manager'], '${A}'),
      -- every default STAFF role has the Task Manager module: it must not mean "sees every task"
      ('STAFF', array['dashboard', 'task-manager'], '${A}');
  `);
  const boss = (await rows<{ id: string }>(`select id from employees where "Employee Number" = 'A-BOSS'`))[0].id;
  await db.query(`update employees set reports_to_id = $1 where "Employee Number" = 'A-MO'`, [boss]);
  sales = (await as<{ id: string }>(HR, `insert into departments (name) values ('Sales') returning id`))[0].id;
  const salesNorth = (await as<{ id: string }>(HR, `insert into departments (name, parent_id) values ('Sales North', $1) returning id`, [sales]))[0].id;
  await db.query(`update employees set department_id = $1 where "Employee Number" in ('A-RITA', 'A-GONE')`, [sales]);
  await db.query(`update employees set department_id = $1 where "Employee Number" = 'A-SAM'`, [salesNorth]);

  project = (await as<{ id: string }>(HR, `insert into task_projects (key, name, lead_number) values ('ops', 'Operations', 'A-LEAD') returning id`))[0].id;
  await as(HR, `insert into task_project_members (project_id, employee_number) values ($1, 'A-MO')`, [project]);
}, 180000);

describe('the old todos', () => {
  it('are copied once into each company’s General project, matching the assignee where possible', async () => {
    const got = await rows<{ key: string; title: string; status: string; priority: string; assignee_number: string | null;
      creator_number: string | null; created_by: string | null; due_date: string | null; description: string | null; tenant_id: string }>(
      `select t.key, t.title, t.status, t.priority, t.assignee_number, t.creator_number, t.created_by, t.due_date::text, t.description, t.tenant_id
       from tasks t join task_projects p on p.id = t.project_id where p.key = 'GEN' order by t.legacy_todo_id`);
    expect(got.map((t) => [t.title, t.status, t.priority, t.assignee_number])).toEqual([
      ['Old follow-up', 'in_progress', 'urgent', 'A-MO'],
      ['Old by login', 'done', 'low', 'A-MO'], // assigned by login id, completed
      ['Untitled task', 'todo', 'none', null], // blank title, nobody to match
      ['Odd one', 'todo', 'none', null],
      ['Other company', 'backlog', 'high', 'B-1'],
    ]);
    expect(got[0].creator_number).toBe('A-HR');
    expect(got[0].due_date).toBe('2026-09-30');
    expect(got[0].description).toContain('Call the client');
    expect(got[0].description).toContain('Department: credit');
    expect(got[0].description).toContain('Category: collections');
    expect(got[2].description).toContain('Assigned to: Someone Who Left');
    expect(got[3].created_by).toBe(OLD);
    expect(got[3].creator_number).toBeNull();
    expect(got[4].tenant_id).toBe(B);
    // each company's own General project, keys numbered in order
    expect(got.slice(0, 4).map((t) => t.key)).toEqual(['GEN-1', 'GEN-2', 'GEN-3', 'GEN-4']);
    expect(got[4].key).toBe('GEN-1');
    // nobody was notified about old tasks, and no activity was made up
    expect(await rows(`select 1 from task_activity a join tasks t on t.id = a.task_id where t.legacy_todo_id is not null`)).toHaveLength(0);
  });

  it('old tasks are no longer visible to the whole company', async () => {
    const pat = await as<{ title: string }>(PAT, `select title from tasks where legacy_todo_id is not null order by title`);
    expect(pat.map((t) => t.title)).toEqual(['Old by login']); // the one Pat created
    expect((await as<{ title: string }>(PAT, `select title from todos order by title`)).map((t) => t.title)).toEqual(['Old by login']);
    expect(await as(RITA, `select 1 from tasks where legacy_todo_id is not null`)).toHaveLength(0);
    expect(await as(HR, `select 1 from tasks where legacy_todo_id is not null`)).toHaveLength(4);
  });

  it('running the migration again copies nothing twice', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    await db.exec(readFileSync(join(__dirname, '..', 'migrations', '20261019200000_tasks.sql'), 'utf8'));
    await db.exec('reset search_path');
    expect((await rows<{ n: number }>(`select count(*)::int n from tasks where legacy_todo_id is not null`))[0].n).toBe(5);
    expect((await rows<{ n: number }>(`select count(*)::int n from task_projects where key = 'GEN'`))[0].n).toBe(2);
  });
});

describe('keys', () => {
  it('number each project’s tasks in order, and follow a key change', async () => {
    const keys: string[] = [];
    for (const t of ['Key one', 'Key two', 'Key three']) {
      keys.push((await as<{ key: string }>(HR, `insert into tasks (project_id, title, created_by) values ($1, $2, $3) returning key`, [project, t, HR]))[0].key);
    }
    expect(keys).toEqual(['OPS-1', 'OPS-2', 'OPS-3']);
    const other = (await as<{ id: string }>(HR, `insert into task_projects (key, name) values ('FIN', 'Finance') returning id`))[0].id;
    const moved = await as<{ key: string }>(HR, `update tasks set project_id = $1 where key = 'OPS-3' returning key`, [other]);
    expect(moved[0].key).toBe('FIN-1');
    await as(HR, `update task_projects set key = 'MONEY' where id = $1`, [other]);
    expect((await rows<{ key: string }>(`select key from tasks where project_id = $1`, [other]))[0].key).toBe('MONEY-1');
    // the next one in Operations is still OPS-4 (numbers are never reused)
    expect((await as<{ key: string }>(HR, `insert into tasks (project_id, title, created_by) values ($1, 'Key four', $2) returning key`, [project, HR]))[0].key).toBe('OPS-4');
    expect(await fails(as(HR, `insert into task_projects (key, name) values ('ops', 'Again')`))).toMatch(/duplicate|unique/);
    expect(await fails(as(HR, `insert into task_projects (key, name) values ('1X', 'Bad')`))).toMatch(/check/);
  });
});

describe('who sees a task', () => {
  beforeAll(async () => {
    await as(HR, `insert into tasks (project_id, title, assignee_number, created_by) values ($1, 'For Mo', 'A-MO', $2)`, [project, HR]);
    await as(HR, `insert into tasks (project_id, title, assignee_number, created_by) values ($1, 'For Rita', 'A-RITA', $2)`, [project, HR]);
    await as(MO, `insert into tasks (project_id, title, created_by) values ($1, 'Mo wrote this', $2)`, [project, MO]);
  });

  it('the assignee, creator, project members, the assignee’s manager and HR; not a colleague or another company', async () => {
    // Rita is not in the project, but is assigned one task
    expect(await titlesFor(RITA)).toEqual(['For Rita']);
    // Mo is a member: every task in the project
    expect(await titlesFor(MO)).toContain('For Rita');
    // the lead too
    expect(await titlesFor(LEAD)).toContain('Mo wrote this');
    // Mo's manager sees Mo's tasks only
    expect(await titlesFor(BOSS)).toEqual(['For Mo']);
    // an unrelated colleague sees nothing (the Task Manager module on a STAFF role is not enough)
    expect(await titlesFor(PAT)).toEqual([]);
    expect(await as(PAT, `select 1 from task_projects where id = $1`, [project])).toHaveLength(0);
    // HR sees everything
    expect((await titlesFor(HR)).length).toBeGreaterThanOrEqual(6);
    // another company sees nothing, even its admin
    expect(await as(OUT, `select 1 from tasks where tenant_id = $1`, [A])).toHaveLength(0);
    expect(await asAnon(db, () => rows(`select 1 from tasks`)).catch(() => [])).toHaveLength(0);
  });

  it('a project’s department counts as its members', async () => {
    const dep = (await as<{ id: string }>(HR, `insert into task_projects (key, name, department_id) values ('SAL', 'Sales work', $1) returning id`, [sales]))[0].id;
    await as(HR, `insert into tasks (project_id, title, created_by) values ($1, 'Sales target', $2)`, [dep, HR]);
    expect(await as(RITA, `select title from tasks where project_id = $1`, [dep])).toHaveLength(1);
    expect(await as(PAT, `select title from tasks where project_id = $1`, [dep])).toHaveLength(0);
    // Rita may create tasks there; Pat may not
    expect(await fails(as(RITA, `insert into tasks (project_id, title, created_by) values ($1, 'Rita adds', $2)`, [dep, RITA]))).toBe('');
    expect(await fails(as(PAT, `insert into tasks (project_id, title, created_by) values ($1, 'Pat adds', $2)`, [dep, PAT]))).toMatch(/row-level security/);
  });
});

describe('who changes a task', () => {
  it('assignee, creator, lead and HR edit; a member who is none of those, the manager and a colleague cannot', async () => {
    expect(await as(MO, `update tasks set status = 'in_progress' where title = 'For Mo' returning 1`)).toHaveLength(1); // assignee
    expect(await as(LEAD, `update tasks set priority = 'high' where title = 'For Rita' returning 1`)).toHaveLength(1); // lead
    expect(await as(RITA, `update tasks set status = 'in_review' where title = 'For Rita' returning 1`)).toHaveLength(1); // assignee
    expect(await as(MO, `update tasks set priority = 'low' where title = 'For Rita' returning 1`)).toHaveLength(0); // member only
    expect(await as(BOSS, `update tasks set priority = 'low' where title = 'For Mo' returning 1`)).toHaveLength(0); // manager reads only
    expect(await as(PAT, `update tasks set priority = 'low' where title = 'For Mo' returning 1`)).toHaveLength(0);
    expect(await as(HR, `update tasks set due_date = '2026-11-01' where title = 'For Mo' returning 1`)).toHaveLength(1);
    // only the creator, lead or HR delete: not the assignee
    expect(await as(MO, `delete from tasks where title = 'For Mo' returning 1`)).toHaveLength(0);
    expect(await as(MO, `delete from tasks where title = 'Mo wrote this' returning 1`)).toHaveLength(1);
    // the creator cannot be changed
    await as(HR, `update tasks set created_by = $1 where title = 'For Mo'`, [PAT]);
    expect((await rows<{ created_by: string }>(`select created_by from tasks where title = 'For Mo'`))[0].created_by).toBe(HR);
  });

  it('you create tasks as yourself, only in projects you are in; only HR makes projects', async () => {
    expect(await fails(as(MO, `insert into tasks (project_id, title, created_by) values ($1, 'As someone else', $2)`, [project, LEAD]))).toMatch(/row-level security/);
    expect(await fails(as(MO, `insert into task_projects (key, name) values ('MO', 'Mine')`))).toMatch(/row-level security/);
    // the lead manages members
    expect(await fails(as(LEAD, `insert into task_project_members (project_id, employee_number) values ($1, 'A-PAT')`, [project]))).toBe('');
    expect(await as(LEAD, `delete from task_project_members where project_id = $1 and employee_number = 'A-PAT' returning 1`, [project])).toHaveLength(1);
    expect(await fails(as(MO, `insert into task_project_members (project_id, employee_number) values ($1, 'A-PAT')`, [project]))).toMatch(/row-level security/);
  });

  it('marking done sets completed_at, reopening clears it', async () => {
    const [done] = await as<{ completed_at: string | null }>(MO, `update tasks set status = 'done' where title = 'For Mo' returning completed_at`);
    expect(done.completed_at).not.toBeNull();
    const [open] = await as<{ completed_at: string | null }>(MO, `update tasks set status = 'todo' where title = 'For Mo' returning completed_at`);
    expect(open.completed_at).toBeNull();
  });
});

describe('sub-tasks', () => {
  it('live in the parent’s project and can never be under themselves', async () => {
    const other = (await rows<{ id: string }>(`select id from task_projects where key = 'MONEY'`))[0].id;
    const parent = (await as<{ id: string }>(HR, `insert into tasks (project_id, title, created_by) values ($1, 'Parent', $2) returning id`, [project, HR]))[0].id;
    const child = (await as<{ id: string; project_id: string }>(HR,
      `insert into tasks (project_id, parent_id, title, created_by) values ($1, $2, 'Child', $3) returning id, project_id`, [other, parent, HR]))[0];
    expect(child.project_id).toBe(project);
    expect(await fails(as(HR, `update tasks set parent_id = $1 where id = $2`, [child.id, parent]))).toMatch(/own sub-task/);
    // deleting the parent removes its sub-tasks
    await as(HR, `delete from tasks where id = $1`, [parent]);
    expect(await rows(`select 1 from tasks where id = $1`, [child.id])).toHaveLength(0);
  });
});

describe('a task for a department', () => {
  it('makes a group task and one sub-task per current person (sub-departments included)', async () => {
    const [{ create_group_task: group }] = await as<{ create_group_task: string }>(HR,
      `select create_group_task($1, 'Submit monthly report', 'By Friday', 'high', '2026-10-31', 'department', $2)`, [project, sales]);
    const kids = await rows<{ assignee_number: string; status: string }>(
      `select assignee_number, status from tasks where parent_id = $1 order by assignee_number`, [group]);
    expect(kids.map((k) => k.assignee_number)).toEqual(['A-RITA', 'A-SAM']); // not Gus, who left
    const [g] = await rows<{ is_group: boolean; assignee_number: string | null }>(`select is_group, assignee_number from tasks where id = $1`, [group]);
    expect(g).toEqual({ is_group: true, assignee_number: null });
    // each person is told, once
    expect((await notes('A-SAM')).filter((n) => n.message.includes('Submit monthly report'))).toHaveLength(1);

    // the group follows its sub-tasks: in progress, then done when everyone has finished
    await as(RITA, `update tasks set status = 'done' where parent_id = $1 and assignee_number = 'A-RITA'`, [group]);
    expect((await rows<{ status: string }>(`select status from tasks where id = $1`, [group]))[0].status).toBe('in_progress');
    await rows(`update tasks set status = 'done' where parent_id = $1 and assignee_number = 'A-SAM'`, [group]);
    expect((await rows<{ status: string }>(`select status from tasks where id = $1`, [group]))[0].status).toBe('done');
  });

  it('by job title (any spelling of the case), and not for someone who may not', async () => {
    const [{ create_group_task: group }] = await as<{ create_group_task: string }>(HR,
      `select create_group_task($1, 'Update price list', null, 'none', null, 'job_title', null, 'Sales Rep')`, [project]);
    expect((await rows<{ a: string }>(`select assignee_number a from tasks where parent_id = $1 order by 1`, [group])).map((r) => r.a)).toEqual(['A-RITA', 'A-SAM']);
    expect(await fails(as(MO, `select create_group_task($1, 'Nope', null, 'none', null, 'department', $2)`, [project, sales]))).toMatch(/cannot give tasks/);
    expect(await fails(as(HR, `select create_group_task($1, 'Nobody', null, 'none', null, 'job_title', null, 'Astronaut')`, [project]))).toMatch(/Nobody matches/);
  });

  it('a member may give one to the people they supervise', async () => {
    await as(HR, `insert into task_project_members (project_id, employee_number) values ($1, 'A-BOSS')`, [project]);
    expect(await fails(as(BOSS, `select create_group_task($1, 'Team check-in', null, 'none', null, 'people', null, null, array['A-MO'])`, [project]))).toBe('');
    expect(await fails(as(BOSS, `select create_group_task($1, 'Not mine', null, 'none', null, 'people', null, null, array['A-PAT'])`, [project]))).toMatch(/cannot give tasks/);
    await as(HR, `delete from task_project_members where project_id = $1 and employee_number = 'A-BOSS'`, [project]);
  });
});

describe('recurring role tasks', () => {
  it('make each person’s task once per period', async () => {
    await as(HR, `insert into task_templates (project_id, title, schedule, target_kind, job_title, priority, due_in_days)
                  values ($1, 'Weekly cash count', 'weekly', 'job_title', 'Loan Officer', 'medium', 2)`, [project]);
    await as(HR, `insert into task_templates (project_id, title, schedule, month_day, target_kind, people)
                  values ($1, 'Month-end report', 'monthly', 31, 'people', array['A-LEAD'])`, [project]);
    const run = async (day: string) => (await as<{ run_task_templates: number }>(HR, `select run_task_templates($1::date)`, [day]))[0].run_task_templates;
    // Monday 19 Oct 2026: the weekly one for both loan officers; the monthly one is not due until the last day
    expect(await run('2026-10-19')).toBe(2);
    expect(await run('2026-10-21')).toBe(0); // same week: nothing again
    expect(await run('2026-10-26')).toBe(2); // next week
    expect(await run('2026-10-31')).toBe(1); // last day of October (31)
    expect(await run('2026-10-31')).toBe(0);
    const made = await rows<{ assignee_number: string; due_date: string; template_period: string; priority: string }>(
      `select assignee_number, due_date::text, template_period, priority from tasks where title = 'Weekly cash count' order by template_period, assignee_number`);
    expect(made[0]).toEqual({ assignee_number: 'A-MO', due_date: '2026-10-21', template_period: '2026-W43', priority: 'medium' });
    expect(made.map((m) => m.assignee_number)).toEqual(['A-MO', 'A-PAT', 'A-MO', 'A-PAT']);
    // only people who run tasks may run them by hand, and a STAFF member cannot see templates
    expect(await fails(as(MO, `select run_task_templates()`))).toMatch(/Only people who run tasks/);
    expect(await as(MO, `select 1 from task_templates`)).toHaveLength(0);
  });

  it('the morning job (no one signed in) runs every company, still once per period', async () => {
    expect((await rows<{ n: number }>(`select run_task_templates('2026-10-27'::date) n`))[0].n).toBe(0);
  });
});

describe('activity', () => {
  it('records who changed what, before and after', async () => {
    const [t] = await as<{ id: string }>(HR, `insert into tasks (project_id, title, created_by) values ($1, 'Tracked', $2) returning id`, [project, HR]);
    await as(HR, `update tasks set status = 'in_progress', priority = 'urgent', assignee_number = 'A-MO' where id = $1`, [t.id]);
    const label = (await as<{ id: string }>(HR, `insert into task_labels (name, color) values ('Audit', 'red') returning id`))[0].id;
    await as(HR, `insert into task_label_links (task_id, label_id) values ($1, $2)`, [t.id, label]);
    await as(MO, `update tasks set status = 'done' where id = $1`, [t.id]);
    const log = await as<{ field: string; before_value: string | null; after_value: string | null; actor_name: string }>(MO,
      `select field, before_value, after_value, actor_name from task_activity where task_id = $1 order by id`, [t.id]);
    expect(log.map((l) => [l.field, l.before_value, l.after_value])).toEqual([
      ['created', null, expect.stringMatching(/^OPS-\d+$/)],
      ['status', 'todo', 'in_progress'],
      ['priority', 'none', 'urgent'],
      ['assignee', null, 'A-MO'],
      ['labels', null, 'Audit'],
      ['status', 'in_progress', 'done'],
    ]);
    expect(log[1].actor_name).toBe('Hana HR');
    expect(log[5].actor_name).toBe('Mo Member');
    // nobody writes the log by hand
    expect(await fails(as(HR, `insert into task_activity (tenant_id, task_id, field) values ($1, $2, 'x')`, [A, t.id]))).toMatch(/permission denied/);
    // a colleague who cannot see the task cannot see its activity
    expect(await as(PAT, `select 1 from task_activity where task_id = $1`, [t.id])).toHaveLength(0);
    // only people who run tasks set labels
    expect(await fails(as(MO, `insert into task_labels (name) values ('Mine')`))).toMatch(/row-level security/);
  });
});

describe('notifications', () => {
  let task: string;
  beforeAll(async () => {
    task = (await as<{ id: string }>(LEAD, `insert into tasks (project_id, title, assignee_number, created_by) values ($1, 'Count the safe', 'A-MO', $2) returning id`, [project, LEAD]))[0].id;
  });

  it('the assignee is told once, and not when you give a task to yourself', async () => {
    const mine = (await notes('A-MO')).filter((n) => n.message.includes('Count the safe'));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ notification_type: 'task_assigned', title: 'New task' });
    expect(mine[0].message).toMatch(/^You have been given a task: OPS-\d+ Count the safe\.$/);
    await as(MO, `insert into tasks (project_id, title, assignee_number, created_by) values ($1, 'Self task', 'A-MO', $2)`, [project, MO]);
    expect((await notes('A-MO')).filter((n) => n.message.includes('Self task'))).toHaveLength(0);
  });

  it('@mentions tell the person mentioned (who can then see the task); a comment tells the assignee and creator', async () => {
    const before = { mo: (await notes('A-MO')).length, lead: (await notes('A-LEAD')).length, pat: (await notes('A-PAT')).length };
    // the lead comments and mentions Pat (not in the project) and Mo (the assignee) and a made-up number
    await as(LEAD, `insert into task_comments (task_id, body, mentions) values ($1, 'Please help @Pat @Mo', array['A-PAT', 'A-MO', 'NOPE', 'A-PAT'])`, [task]);
    const pat = (await notes('A-PAT')).slice(before.pat);
    expect(pat).toHaveLength(1);
    expect(pat[0].title).toBe('You were mentioned');
    expect(pat[0].message).toMatch(/^Lena Lead mentioned you on OPS-\d+ Count the safe\.$/);
    // Mo is mentioned, so gets the mention, not also "new comment"
    const mo = (await notes('A-MO')).slice(before.mo);
    expect(mo.map((n) => n.title)).toEqual(['You were mentioned']);
    // the lead wrote it: not told
    expect((await notes('A-LEAD')).length).toBe(before.lead);
    // the comment kept only real people, once each
    expect((await rows<{ mentions: string[] }>(`select mentions from task_comments where task_id = $1`, [task]))[0].mentions).toEqual(['A-MO', 'A-PAT']);
    // Pat can now see the task and its comments
    expect(await as(PAT, `select 1 from tasks where id = $1`, [task])).toHaveLength(1);
    expect(await as(PAT, `select 1 from task_comments where task_id = $1`, [task])).toHaveLength(1);

    // Mo replies: the creator (lead) gets "new comment"
    await as(MO, `insert into task_comments (task_id, body) values ($1, 'On it')`, [task]);
    const lead = (await notes('A-LEAD')).slice(before.lead);
    expect(lead.map((n) => n.title)).toEqual(['New comment on your task']);
    expect(lead[0].message).toMatch(/^Mo Member commented on OPS-\d+ Count the safe\.$/);
    // you cannot comment as someone else, or edit another person's comment
    const [forged] = await as<{ author_id: string; author_name: string }>(MO,
      `insert into task_comments (task_id, body, author_id) values ($1, 'x', $2) returning author_id, author_name`, [task, LEAD]);
    expect(forged).toEqual({ author_id: MO, author_name: 'Mo Member' });
    expect(await as(MO, `update task_comments set body = 'changed' where author_id = $1 returning 1`, [LEAD])).toHaveLength(0);
    // a colleague who cannot see the task cannot comment on it
    expect(await fails(as(RITA, `insert into task_comments (task_id, body) values ($1, 'x')`, [task]))).toMatch(/row-level security/);
  });

  it('done tells the creator', async () => {
    const before = (await notes('A-LEAD')).length;
    await as(MO, `update tasks set status = 'done' where id = $1`, [task]);
    const lead = (await notes('A-LEAD')).slice(before);
    expect(lead).toHaveLength(1);
    expect(lead[0]).toMatchObject({ title: 'Task done' });
    expect(lead[0].message).toMatch(/^Mo Member marked OPS-\d+ Count the safe as done\.$/);
  });
});

describe('attachments', () => {
  it('anyone who can see the task adds one; the log records it; others cannot see it', async () => {
    const [t] = await as<{ id: string }>(MO, `select id from tasks where title = 'Count the safe'`);
    expect(await fails(as(MO, `insert into task_attachments (task_id, path, file_name, uploaded_by) values ($1, 'x/y/z.pdf', 'count.pdf', $2)`, [t.id, MO]))).toBe('');
    expect(await as(PAT, `select 1 from task_attachments where task_id = $1`, [t.id])).toHaveLength(1); // mentioned earlier
    expect(await as(RITA, `select 1 from task_attachments where task_id = $1`, [t.id])).toHaveLength(0);
    expect((await rows<{ after_value: string }>(`select after_value from task_activity where task_id = $1 and field = 'attachment'`, [t.id]))[0].after_value).toBe('count.pdf');
  });
});
