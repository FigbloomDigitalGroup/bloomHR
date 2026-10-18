// @vitest-environment node
//
// "Manage projects" is a module any role can hold, staff-based custom roles included (FIG-901, 20261020000000):
// whoever holds task-projects creates projects, adds members, sets labels and recurring tasks and gives a task to a
// department; nobody else does (a lead still runs their own project). Holding it shows nobody else's tasks; ADMIN/HR
// oversight is unchanged. Existing roles keep what they could do. Real migrations on PGlite.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const ADM = '00000000-0000-0000-0000-00000000d901'; // ADMIN
const HR = '00000000-0000-0000-0000-00000000d902'; // HR
const MGR = '00000000-0000-0000-0000-00000000d903'; // MANAGER (the company unticks Manage projects for it)
const PL = '00000000-0000-0000-0000-00000000d904'; // STAFF, given the "Planners" custom role (Manage projects)
const PAT = '00000000-0000-0000-0000-00000000d905'; // STAFF, plain
const LEAD = '00000000-0000-0000-0000-00000000d906'; // STAFF, leads a project
const MO = '00000000-0000-0000-0000-00000000d907'; // STAFF, gets a task
const OUT = '00000000-0000-0000-0000-00000000d9b1'; // the other company's ADMIN
const FILE = '20261020000000_manage_projects.sql';

let db: PGlite;
let planners: string; // STAFF-based custom role, had Task Manager before the migration
let supervisors: string; // MANAGER-based custom role, had Task Manager before the migration
let leadProject: string; // led by Lena, made by the database
let leadTask: string; // Lena gives Mo a task in it
let otherProject: string; // company B's
let sales: string;

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
const modulesOf = async (tenant: string, role: string) =>
  (await rows<{ permissions: string[] }>(`select permissions from role_permissions where tenant_id = $1 and role_name = $2`, [tenant, role]))[0]?.permissions ?? [];
const roleKey = async (id: string) => (await rows<{ role_key: string }>(`select role_key from company_roles where id = $1`, [id]))[0].role_key;
const manages = async (user: string) => (await as<{ v: boolean }>(user, `select manages_tasks() v`))[0].v;
const rerun = async () => {
  await db.exec(readFileSync(join(__dirname, '..', 'migrations', FILE), 'utf8'));
  await db.exec('reset search_path');
};

beforeAll(async () => {
  db = await bootDb({
    file: FILE,
    // the roles as a company had them before "Manage projects" existed
    seed: async (d) => {
      await d.exec(`
        insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
        insert into auth.users (id, email) values
          ('${ADM}', 'adm@a.co'), ('${HR}', 'hr@a.co'), ('${MGR}', 'mgr@a.co'), ('${PL}', 'pl@a.co'), ('${PAT}', 'pat@a.co'),
          ('${LEAD}', 'lead@a.co'), ('${MO}', 'mo@a.co'), ('${OUT}', 'out@b.co');
        insert into user_profiles (user_id, email, role, full_name, tenant_id) values
          ('${ADM}', 'adm@a.co', 'ADMIN', null, '${A}'), ('${HR}', 'hr@a.co', 'HR', null, '${A}'),
          ('${MGR}', 'mgr@a.co', 'MANAGER', null, '${A}'), ('${PL}', 'pl@a.co', 'STAFF', null, '${A}'),
          ('${PAT}', 'pat@a.co', 'STAFF', null, '${A}'), ('${LEAD}', 'lead@a.co', 'STAFF', null, '${A}'),
          ('${MO}', 'mo@a.co', 'STAFF', null, '${A}'), ('${OUT}', 'out@b.co', 'ADMIN', null, '${B}');
        insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Job Title", "Status", tenant_id) values
          ('A-ADM', 'Ada', 'Admin', 'adm@a.co', 'Administrator', 'Active', '${A}'),
          ('A-HR', 'Hana', 'HR', 'hr@a.co', 'HR Officer', 'Active', '${A}'),
          ('A-MGR', 'Max', 'Manager', 'mgr@a.co', 'Manager', 'Active', '${A}'),
          ('A-PL', 'Pia', 'Planner', 'pl@a.co', 'Planner', 'Active', '${A}'),
          ('A-PAT', 'Pat', 'Peer', 'pat@a.co', 'Loan Officer', 'Active', '${A}'),
          ('A-LEAD', 'Lena', 'Lead', 'lead@a.co', 'Team Lead', 'Active', '${A}'),
          ('A-MO', 'Mo', 'Member', 'mo@a.co', 'Loan Officer', 'Active', '${A}'),
          ('A-RITA', 'Rita', 'Sales', 'rita@a.co', 'Sales Rep', 'Active', '${A}'),
          ('B-1', 'Bo', 'Other', 'out@b.co', 'Admin', 'Active', '${B}');
        delete from role_permissions where tenant_id in ('${A}', '${B}');
        insert into role_permissions (role_name, permissions, tenant_id) values
          ('ADMIN', array['dashboard'], '${A}'),
          ('HR', array['employees', 'task-manager'], '${A}'),
          ('MANAGER', array['dashboard', 'task-manager'], '${A}'),
          ('OPERATIONS', array['dashboard'], '${A}'),
          ('STAFF', array['dashboard', 'task-manager'], '${A}'),
          ('MANAGER', array['task-manager'], '${B}'),
          ('STAFF', array['task-manager'], '${B}');
      `);
      planners = (await d.query<{ id: string }>(
        `insert into company_roles (tenant_id, role_key, name, base_role) values ($1, 'x', 'Planners', 'STAFF') returning id`, [A])).rows[0].id;
      supervisors = (await d.query<{ id: string }>(
        `insert into company_roles (tenant_id, role_key, name, base_role) values ($1, 'x', 'Supervisors', 'MANAGER') returning id`, [A])).rows[0].id;
      await d.query(`insert into role_permissions (tenant_id, role_name, permissions)
                     select tenant_id, role_key, array['dashboard', 'task-manager'] from company_roles where id in ($1, $2)`, [planners, supervisors]);
    },
  });

  sales = (await rows<{ id: string }>(`insert into departments (name, tenant_id) values ('Sales', $1) returning id`, [A]))[0].id;
  await rows(`update employees set department_id = $1 where "Employee Number" in ('A-RITA', 'A-PAT')`, [sales]);
  leadProject = (await rows<{ id: string }>(
    `insert into task_projects (key, name, lead_number, tenant_id) values ('OPS', 'Operations', 'A-LEAD', $1) returning id`, [A]))[0].id;
  await rows(`insert into task_project_members (project_id, employee_number, tenant_id) values ($1, 'A-MO', $2)`, [leadProject, A]);
  leadTask = (await as<{ id: string }>(LEAD,
    `insert into tasks (project_id, title, assignee_number, created_by) values ($1, 'Count the safe', 'A-MO', $2) returning id`, [leadProject, LEAD]))[0].id;
  otherProject = (await rows<{ id: string }>(
    `insert into task_projects (key, name, tenant_id) values ('BOPS', 'Other ops', $1) returning id`, [B]))[0].id;
}, 180000);

describe('existing companies keep what they could do', () => {
  it('ADMIN and every non-STAFF role with Task Manager get "Manage projects"; STAFF and STAFF-based roles do not', async () => {
    expect(await rows(`select module_name, category, description from permissions where module_id = 'task-projects'`)).toEqual([{
      module_name: 'Manage projects', category: 'workspace',
      description: 'Create projects, add members, assign tasks to a department or team, set up recurring tasks and labels.',
    }]);
    expect(await modulesOf(A, 'ADMIN')).toContain('task-projects');
    expect(await modulesOf(A, 'HR')).toContain('task-projects');
    expect(await modulesOf(A, 'MANAGER')).toContain('task-projects');
    expect(await modulesOf(B, 'MANAGER')).toContain('task-projects');
    expect(await modulesOf(A, await roleKey(supervisors))).toContain('task-projects');
    // no Task Manager before, or based on STAFF: nothing new
    expect(await modulesOf(A, 'OPERATIONS')).not.toContain('task-projects');
    expect(await modulesOf(A, 'STAFF')).not.toContain('task-projects');
    expect(await modulesOf(B, 'STAFF')).not.toContain('task-projects');
    expect(await modulesOf(A, await roleKey(planners))).not.toContain('task-projects');
  });

  it('so ADMIN, HR and the manager still manage projects, and plain staff still do not', async () => {
    expect(await manages(ADM)).toBe(true);
    expect(await manages(HR)).toBe(true);
    expect(await manages(MGR)).toBe(true);
    expect(await manages(PAT)).toBe(false);
    expect(await manages(PL)).toBe(false); // STAFF, no custom role yet
  });

  it('new companies copy the default company’s roles, with the module', async () => {
    const founder = '00000000-0000-0000-0000-00000000d9f1';
    await db.exec(`insert into auth.users (id, email) values ('${founder}', 'founder@new.co')`);
    const [{ id }] = await as<{ id: string }>(founder, `select create_company('New Co') id`);
    expect(await modulesOf(id, 'MANAGER')).toContain('task-projects');
    expect(await modulesOf(id, 'STAFF')).not.toContain('task-projects');
  });
});

describe('a STAFF-based role with "Manage projects"', () => {
  beforeAll(async () => {
    await as(ADM, `select set_company_role_modules($1, array['dashboard', 'task-manager', 'task-projects'])`, [planners]);
    await as(ADM, `select assign_company_role($1, $2)`, [PL, planners]);
  });

  it('holds the module through the custom role', async () => {
    expect((await as<{ v: string[] }>(PL, `select my_modules() v`))[0].v).toContain('task-projects');
    expect(await manages(PL)).toBe(true);
    expect((await as<{ v: string }>(PL, `select current_user_role() v`))[0].v).toBe('STAFF');
  });

  it('creates a project, adds members, edits and archives it', async () => {
    const [p] = await as<{ id: string }>(PL, `insert into task_projects (key, name) values ('PLAN', 'Planning') returning id`);
    expect(await fails(as(PL, `insert into task_project_members (project_id, employee_number) values ($1, 'A-MO'), ($1, 'A-PAT')`, [p.id]))).toBe('');
    expect(await as(PL, `select employee_number from task_project_members where project_id = $1 order by 1`, [p.id])).toEqual([
      { employee_number: 'A-MO' }, { employee_number: 'A-PAT' },
    ]);
    // any project, not only their own
    expect(await as(PL, `update task_projects set description = 'Counted weekly' where id = $1 returning 1`, [leadProject])).toHaveLength(1);
    expect(await fails(as(PL, `insert into task_project_members (project_id, employee_number) values ($1, 'A-RITA')`, [leadProject]))).toBe('');
    expect(await as(PL, `update task_projects set archived = true where id = $1 returning 1`, [p.id])).toHaveLength(1);
    await as(PL, `update task_projects set archived = false where id = $1`, [p.id]);
  });

  it('creates labels and recurring tasks, and runs them now', async () => {
    expect(await fails(as(PL, `insert into task_labels (name) values ('Planning')`))).toBe('');
    const [p] = await as<{ id: string }>(PL, `select id from task_projects where key = 'PLAN'`);
    expect(await fails(as(PL, `insert into task_templates (project_id, title, schedule, target_kind, department_id)
                                values ($1, 'Daily sales call', 'daily', 'department', $2)`, [p.id, sales]))).toBe('');
    expect(await as(PL, `select 1 from task_templates where title = 'Daily sales call'`)).toHaveLength(1);
    expect((await as<{ n: number }>(PL, `select run_task_templates('2026-10-20'::date) n`))[0].n).toBe(2); // Pat and Rita
  });

  it('gives a task to a whole department, in a project they are not in', async () => {
    const [{ g }] = await as<{ g: string }>(PL, `select create_group_task($1, 'Read the new price list', null, 'none', null, 'department', $2) g`, [leadProject, sales]);
    expect((await rows<{ a: string }>(`select assignee_number a from tasks where parent_id = $1 order by 1`, [g])).map((r) => r.a)).toEqual(['A-PAT', 'A-RITA']);
    expect(await as(PL, `select 1 from tasks where id = $1 or parent_id = $1`, [g])).toHaveLength(3); // as its creator
  });
});

describe('without "Manage projects"', () => {
  it('a staff member cannot create projects, labels or recurring tasks, or give a department a task', async () => {
    expect(await manages(PAT)).toBe(false);
    expect(await fails(as(PAT, `insert into task_projects (key, name) values ('PAT', 'Mine')`))).toMatch(/row-level security/);
    expect(await fails(as(PAT, `insert into task_labels (name) values ('Pat')`))).toMatch(/row-level security/);
    expect(await fails(as(PAT, `insert into task_templates (project_id, title, schedule, target_kind, department_id)
                                 values ($1, 'Nope', 'daily', 'department', $2)`, [leadProject, sales]))).toMatch(/row-level security/);
    expect(await fails(as(PAT, `select run_task_templates()`))).toMatch(/Only people who run tasks/);
    expect(await fails(as(PAT, `select create_group_task($1, 'Nope', null, 'none', null, 'department', $2)`, [leadProject, sales]))).toMatch(/cannot give tasks/);
    expect(await fails(as(PAT, `insert into task_project_members (project_id, employee_number) values ($1, 'A-PAT')`, [leadProject]))).toMatch(/row-level security/);
    expect(await as(PAT, `select 1 from task_templates`)).toHaveLength(0);
  });

  it('a MANAGER cannot either once the company unticks it for the role', async () => {
    await as(ADM, `update role_permissions set permissions = array['dashboard', 'task-manager'] where role_name = 'MANAGER'`);
    expect(await manages(MGR)).toBe(false);
    expect(await fails(as(MGR, `insert into task_projects (key, name) values ('MGR', 'Mine')`))).toMatch(/row-level security/);
    expect(await fails(as(MGR, `insert into task_labels (name) values ('Max')`))).toMatch(/row-level security/);
    expect(await fails(as(MGR, `select create_group_task($1, 'Nope', null, 'none', null, 'department', $2)`, [leadProject, sales]))).toMatch(/cannot give tasks/);
    expect(await fails(as(MGR, `select run_task_templates()`))).toMatch(/Only people who run tasks/);
    expect(await as(MGR, `update task_projects set archived = true where id = $1 returning 1`, [leadProject])).toHaveLength(0);
  });

  it('a project’s lead still runs their own project', async () => {
    expect(await manages(LEAD)).toBe(false);
    expect(await as(LEAD, `update task_projects set name = 'Operations (cash)' where id = $1 returning 1`, [leadProject])).toHaveLength(1);
    expect(await fails(as(LEAD, `insert into task_project_members (project_id, employee_number) values ($1, 'A-PAT')`, [leadProject]))).toBe('');
    expect(await as(LEAD, `delete from task_project_members where project_id = $1 and employee_number = 'A-PAT' returning 1`, [leadProject])).toHaveLength(1);
    expect(await fails(as(LEAD, `select create_group_task($1, 'Team brief', null, 'none', null, 'people', null, null, array['A-MO'])`, [leadProject]))).toBe('');
    // but makes no projects of their own
    expect(await fails(as(LEAD, `insert into task_projects (key, name) values ('LENA', 'Mine')`))).toMatch(/row-level security/);
  });
});

describe('what people see does not change', () => {
  it('holding the module shows a project’s name, not other people’s tasks, until they join it', async () => {
    const [p] = await as<{ id: string }>(HR, `insert into task_projects (key, name) values ('HRP', 'HR private') returning id`);
    const [t] = await as<{ id: string }>(HR, `insert into tasks (project_id, title, assignee_number, created_by) values ($1, 'Payroll audit', 'A-HR', $2) returning id`, [p.id, HR]);
    expect(await as(PL, `select 1 from task_projects where id = $1`, [p.id])).toHaveLength(1);
    expect(await as(PL, `select 1 from tasks where id = $1`, [t.id])).toHaveLength(0);
    expect(await as(PL, `select 1 from tasks where id = $1`, [leadTask])).toHaveLength(0);
    expect(await as(PL, `update tasks set priority = 'low' where id = $1 returning 1`, [t.id])).toHaveLength(0);
    // once a member, they see the project's tasks, as anyone in it does
    await as(PL, `insert into task_project_members (project_id, employee_number) values ($1, 'A-PL')`, [p.id]);
    expect(await as(PL, `select 1 from tasks where id = $1`, [t.id])).toHaveLength(1);
  });

  it('ADMIN and HR still oversee every task, read-only', async () => {
    for (const who of [ADM, HR]) {
      expect(await as(who, `select 1 from tasks where id = $1`, [leadTask])).toHaveLength(1);
      expect(await as(who, `update tasks set priority = 'low' where id = $1 returning 1`, [leadTask])).toHaveLength(0);
    }
    expect((await as<{ v: boolean }>(PL, `select oversees_tasks() v`))[0].v).toBe(false);
  });
});

describe('company isolation', () => {
  it('managing projects in one company gives nothing in another', async () => {
    expect(await as(PL, `select 1 from task_projects where id = $1`, [otherProject])).toHaveLength(0);
    expect(await as(PL, `update task_projects set name = 'Hacked' where id = $1 returning 1`, [otherProject])).toHaveLength(0);
    expect(await fails(as(PL, `select create_group_task($1, 'Nope', null, 'none', null, 'people', null, null, array['B-1'])`, [otherProject]))).toMatch(/not found/);
    expect(await fails(as(PL, `insert into task_project_members (project_id, employee_number, tenant_id) values ($1, 'B-1', $2)`, [otherProject, B]))).toMatch(/row-level security|violates/);
    expect(await as(OUT, `select 1 from task_projects where id = $1`, [leadProject])).toHaveLength(0);
    expect(await as(OUT, `select 1 from task_labels where name = 'Planning'`)).toHaveLength(0);
    expect(await as(OUT, `select 1 from task_templates`)).toHaveLength(0);
  });
});

describe('running the migration again', () => {
  it('grants nothing a company took away, and keeps the module for those who have it', async () => {
    await rerun();
    await rerun();
    expect(await modulesOf(A, 'MANAGER')).not.toContain('task-projects');
    expect(await manages(MGR)).toBe(false);
    expect(await modulesOf(A, 'HR')).toContain('task-projects');
    expect(await manages(PL)).toBe(true);
    expect(await manages(PAT)).toBe(false);
    expect((await rows<{ n: number }>(`select count(*)::int n from permissions where module_id = 'task-projects'`))[0].n).toBe(1);
    expect((await modulesOf(A, 'HR')).filter((m) => m === 'task-projects')).toHaveLength(1);
  });
});
