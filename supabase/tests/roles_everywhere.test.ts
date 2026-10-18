// @vitest-environment node
//
// The app follows the modules ticked for a role, not the role's name (20261021200000_roles_everywhere.sql). The new
// modules are given once to the roles that had each power by name (system roles in every company, and custom roles of
// those bases that already existed); the functions and policies that checked names now check modules. With the
// default modules every system role keeps what it had; a custom role follows its ticks. Real migrations on PGlite.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootDb } from './db';

const FILE = '20261021200000_roles_everywhere.sql';
const A = '00000000-0000-0000-0000-000000000001'; // the default company, default modules
const B = '00000000-0000-0000-0000-0000000000b2'; // a company set up like the default one
const C = '00000000-0000-0000-0000-0000000000c3'; // a company with only some role rows

const u = (n: number) => `00000000-0000-0000-0000-0000000e${String(n).padStart(4, '0')}`;
const ADM = u(1);
const HR1 = u(2);
const HR2 = u(3);
const CHK = u(4);
const MGR = u(5);
const REG = u(6);
const OPS = u(7);
const STF = u(8);
const CU1 = u(9); // STAFF, given custom roles in the tests
const CU2 = u(10); // MANAGER, given custom roles in the tests
const CU3 = u(11); // HR, given custom roles in the tests
const ADMB = u(20); // tenant B's administrator
const CUB = u(21); // tenant B, a custom role with task-oversight and chat-admin
const CHR = u(30); // tenant C's only HR person
const CX = u(31); // tenant C, a custom role

const SYSTEM = { ADM: 'ADMIN', HR1: 'HR', HR2: 'HR', CHK: 'CHECKER', MGR: 'MANAGER', REG: 'REGIONAL', OPS: 'OPERATIONS', STF: 'STAFF' };
const IDS: Record<string, string> = { ADM, HR1, HR2, CHK, MGR, REG, OPS, STF };

let db: PGlite;
// custom roles that existed before the migration ran: key -> { id, role_key }
const before: Record<string, { id: string; role_key: string }> = {};

const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await rows<T>(sql, params))[0];
const as = <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) => asUser(db, user, () => rows<T>(sql, params));
const asOne = async <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) => (await as<T>(user, sql, params))[0];
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const val = async <T>(user: string, sql: string, params: unknown[] = []) => (await asOne<{ v: T }>(user, `select ${sql} v`, params)).v;
const migration = () => readFileSync(join(__dirname, '..', 'migrations', FILE), 'utf8');

const roleId = async (tenant: string, key: string) =>
  (await one<{ id: string }>(`select id from company_roles where tenant_id = $1 and role_key = $2`, [tenant, key])).id;
const createRole = async (admin: string, name: string, base: string, modules: string[]) =>
  (await asOne<{ id: string }>(admin, `select create_company_role($1, $2, null, $3::text[]) id`, [name, base, modules])).id;
const setModules = (admin: string, role: string, modules: string[]) =>
  as(admin, `select set_company_role_modules($1, $2::text[])`, [role, modules]);
const assign = (admin: string, user: string, role: string) => as(admin, `select assign_company_role($1, $2)`, [user, role]);
/** The system roles (in a company) holding a module. */
const holders = async (tenant: string, module: string) =>
  (await rows<{ role_name: string }>(
    `select role_name from role_permissions where tenant_id = $1 and role_name = any (system_role_names()) and $2 = any (permissions) order by 1`,
    [tenant, module])).map((r) => r.role_name);
const modulesOf = async (tenant: string, roleName: string) =>
  (await one<{ p: string[] }>(`select permissions p from role_permissions where tenant_id = $1 and role_name = $2`, [tenant, roleName]))?.p ?? null;

const NEW_MODULES = ['task-oversight', 'kpi-admin', 'loans', 'team-work', 'casual-overtime', 'approve-exits', 'chat-channels',
  'chat-admin', 'sign-in-security', 'employee-edit', 'hr-admin'];
// who gets each new module, among the system roles, with the default modules
const SEEDED: Record<string, string[]> = {
  'task-oversight': ['ADMIN', 'HR'],
  'kpi-admin': ['HR'],
  loans: ['HR'],
  'team-work': ['MANAGER'],
  'casual-overtime': ['HR'],
  'approve-exits': ['HR'],
  'chat-channels': ['HR', 'MANAGER'],
  'chat-admin': [],
  'sign-in-security': [],
  'employee-edit': ['HR', 'MANAGER', 'REGIONAL'],
  'hr-admin': ['HR'],
  'hr-lifecycle': [],
};

let task: string;
let taskB: string;
let secret: string; // a private channel in A, made by the manager
let secretB: string;
let message: string; // the manager's message in it

beforeAll(async () => {
  db = await bootDb({
    file: FILE,
    seed: async (d) => {
      // tenant B: set up like the default company (as create_company does); tenant C: only some role rows
      await d.exec(`
        insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co'), ('${C}', 'Third Co', 'third-co');
        insert into role_permissions (tenant_id, role_name, permissions)
          select '${B}', role_name, permissions from role_permissions
          where tenant_id = '${A}' and role_name = any (system_role_names());
        insert into role_permissions (tenant_id, role_name, permissions) values
          ('${C}', 'STAFF', array['dashboard']), ('${C}', 'CHECKER', array['performance', 'employees']);
      `);
      // custom roles the default company already had
      for (const [key, base, mods] of [
        ['oldHr', 'HR', ['employees']],
        ['oldMgr', 'MANAGER', ['leaves']],
        ['oldOps', 'OPERATIONS', ['performance']],
        ['oldOpsNoPerf', 'OPERATIONS', ['leaves']],
        ['oldStaff', 'STAFF', ['performance']],
        ['oldReg', 'REGIONAL', ['performance']],
        ['oldAdmin', 'ADMIN', ['dashboard']],
      ] as const) {
        const r = (await d.query<{ id: string; role_key: string }>(
          `insert into company_roles (tenant_id, name, base_role, is_system, role_key)
           values ($1, $2, $3, false, 'CR_00000000000000000000000000000000') returning id, role_key`, [A, key, base])).rows[0];
        await d.query(`insert into role_permissions (tenant_id, role_name, permissions) values ($1, $2, $3::text[])`, [A, r.role_key, mods]);
        before[key] = r;
      }
    },
  });

  // people
  const people: [string, string, string, string][] = [
    ...Object.entries(SYSTEM).map(([k, role]) => [IDS[k], `${k.toLowerCase()}@a.co`, role, A] as [string, string, string, string]),
    [CU1, 'cu1@a.co', 'STAFF', A], [CU2, 'cu2@a.co', 'MANAGER', A], [CU3, 'cu3@a.co', 'HR', A],
    [ADMB, 'admb@b.co', 'ADMIN', B], [CUB, 'cub@b.co', 'MANAGER', B],
    [CHR, 'chr@c.co', 'HR', C], [CX, 'cx@c.co', 'MANAGER', C],
  ];
  for (const [id, email, role, tenant] of people) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${tenant}');
    `);
  }
  await db.exec(`
    update memberships set account_status = 'ACTIVE';
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Status", tenant_id) values
      ('A-ADM', 'Ada', 'Admin', 'adm@a.co', 'Active', '${A}'), ('A-CHK', 'Chi', 'Checker', 'chk@a.co', 'Active', '${A}'),
      ('A-MGR', 'Max', 'Manager', 'mgr@a.co', 'Active', '${A}'), ('A-STF', 'Sam', 'Staff', 'stf@a.co', 'Active', '${A}'),
      ('A-CU1', 'Cu', 'One', 'cu1@a.co', 'Active', '${A}'), ('A-CU2', 'Cu', 'Two', 'cu2@a.co', 'Active', '${A}'),
      ('B-ADM', 'Bo', 'Admin', 'admb@b.co', 'Active', '${B}');
  `);

  // a project and a task nobody above is concerned with, in A and in B
  const project = (await one<{ id: string }>(
    `insert into task_projects (key, name, lead_number, tenant_id) values ('OPS', 'Operations', 'A-STF', $1) returning id`, [A])).id;
  task = (await one<{ id: string }>(
    `insert into tasks (project_id, title, assignee_number, created_by, tenant_id) values ($1, 'Count the safe', 'A-STF', $2, $3) returning id`,
    [project, STF, A])).id;
  const projectB = (await one<{ id: string }>(
    `insert into task_projects (key, name, lead_number, tenant_id) values ('BOP', 'B ops', 'B-ADM', $1) returning id`, [B])).id;
  taskB = (await one<{ id: string }>(
    `insert into tasks (project_id, title, assignee_number, created_by, tenant_id) values ($1, 'B task', 'B-ADM', $2, $3) returning id`,
    [projectB, ADMB, B])).id;

  // a private channel in each company, with a message in A's
  secret = (await asOne<{ id: string }>(MGR,
    `insert into channels (name, type, is_private, created_by) values ('secret', 'channel', true, $1) returning id`, [MGR])).id;
  message = (await asOne<{ id: string }>(MGR,
    `insert into messages (channel_id, author_id, content) values ($1, $2, 'hello') returning id`, [secret, MGR])).id;
  secretB = (await asOne<{ id: string }>(ADMB,
    `insert into channels (name, type, is_private, created_by) values ('b-secret', 'channel', true, $1) returning id`, [ADMB])).id;
}, 240000);

describe('the new modules', () => {
  it('are in the catalogue, with hr-lifecycle', async () => {
    const got = await rows<{ module_id: string; module_name: string; category: string }>(
      `select module_id, module_name, category from permissions where module_id = any ($1::text[]) order by module_id`,
      [[...NEW_MODULES, 'hr-lifecycle']]);
    expect(got.map((r) => r.module_id)).toEqual([...NEW_MODULES, 'hr-lifecycle'].sort());
    expect(got.find((r) => r.module_id === 'task-oversight')).toMatchObject({ module_name: 'See every task', category: 'workspace' });
    expect(got.find((r) => r.module_id === 'loans')).toMatchObject({ module_name: 'Staff loans', category: 'finance' });
    expect(got.find((r) => r.module_id === 'hr-lifecycle')).toMatchObject({ module_name: 'HR Lifecycle', category: 'people-hr' });
    expect(got.find((r) => r.module_id === 'team-work')?.module_name).toBe('My team\'s work');
  });

  it('are given to exactly the system roles that had each power, in the default company and another one', async () => {
    for (const tenant of [A, B]) {
      for (const [module, roles] of Object.entries(SEEDED)) {
        expect([module, await holders(tenant, module)]).toEqual([module, roles]);
      }
    }
  });

  it('a company missing a system role row gets one holding just the new modules; CHECKER with Performance gets kpi-admin', async () => {
    expect(await modulesOf(C, 'HR')).toEqual(
      ['approve-exits', 'casual-overtime', 'chat-channels', 'employee-edit', 'hr-admin', 'kpi-admin', 'loans', 'task-oversight']);
    expect(await modulesOf(C, 'MANAGER')).toEqual(['chat-channels', 'employee-edit', 'team-work']);
    expect(await modulesOf(C, 'REGIONAL')).toEqual(['employee-edit']);
    expect(await modulesOf(C, 'ADMIN')).toBeNull(); // administrators have every module anyway
    expect(await modulesOf(C, 'CHECKER')).toEqual(['employees', 'kpi-admin', 'performance']);
    expect(await modulesOf(C, 'STAFF')).toEqual(['dashboard']);
  });

  it('custom roles that existed before get the modules of their base role', async () => {
    const mods = async (k: string) => modulesOf(A, before[k].role_key);
    expect(await mods('oldHr')).toEqual(
      ['approve-exits', 'casual-overtime', 'chat-channels', 'employee-edit', 'employees', 'hr-admin', 'kpi-admin', 'loans', 'task-oversight']);
    expect(await mods('oldMgr')).toEqual(['chat-channels', 'employee-edit', 'leaves', 'team-work']);
    expect(await mods('oldOps')).toEqual(['kpi-admin', 'performance']); // the old KPI rule: Performance, not MANAGER/REGIONAL
    expect(await mods('oldOpsNoPerf')).toEqual(['leaves']);
    expect(await mods('oldStaff')).toEqual(['kpi-admin', 'performance']);
    expect(await mods('oldReg')).toEqual(['employee-edit', 'performance']); // REGIONAL never managed KPIs
    expect(await mods('oldAdmin')).toEqual(['dashboard', 'task-oversight']);
  });

  it('a company created later copies them from the default company', async () => {
    const founder = u(99);
    await db.exec(`insert into auth.users (id, email) values ('${founder}', 'founder@new.co')`);
    const tenant = (await asOne<{ id: string }>(founder, `select create_company('Newer Co') id`)).id;
    expect(await holders(tenant, 'task-oversight')).toEqual(['ADMIN', 'HR']);
    expect(await holders(tenant, 'chat-channels')).toEqual(['HR', 'MANAGER']);
  });

  it('loans, approve-exits, sign-in-security and hr-admin cannot go on a STAFF-based role', async () => {
    expect((await one<{ v: string[] }>(`select staff_restricted_modules() v`)).v).toEqual(
      ['payroll', 'salaryadmin', 'mpesa-zap', 'adminconfirm', 'assign-managers', 'hr-lifecycle', 'loans', 'approve-exits', 'sign-in-security', 'hr-admin']);
    for (const m of ['loans', 'approve-exits', 'sign-in-security', 'hr-admin']) {
      expect([m, await fails(createRole(ADM, `Staff ${m}`, "STAFF", [m]))]).toEqual([m, expect.stringMatching(/cannot be given to a role based on Staff/)]);
    }
    // the others may
    const ok = await createRole(ADM, 'Staff extras', 'STAFF', ['task-oversight', 'kpi-admin', 'chat-admin', 'employee-edit']);
    expect(await modulesOf(A, `CR_${ok.replace(/-/g, '')}`)).toEqual(['chat-admin', 'employee-edit', 'kpi-admin', 'task-oversight']);
  });
});

describe('seeing every task (task-oversight)', () => {
  const sees = async (user: string, id = task) => (await as(user, `select 1 from tasks where id = $1`, [id])).length;

  it('system roles: ADMIN and HR see an unrelated task, the others do not', async () => {
    for (const k of ['ADM', 'HR1']) expect([k, await sees(IDS[k])]).toEqual([k, 1]);
    for (const k of ['CHK', 'MGR', 'REG', 'OPS']) expect([k, await sees(IDS[k])]).toEqual([k, 0]);
    for (const k of ['ADM', 'HR1', 'CHK', 'MGR', 'STF']) {
      expect([k, await val(IDS[k], 'oversees_tasks()')]).toEqual([k, ['ADM', 'HR1'].includes(k)]);
    }
  });

  it('a STAFF-based custom role given task-oversight sees every task, read-only; untick and it does not', async () => {
    const auditors = await createRole(ADM, 'Auditors', 'STAFF', ['dashboard', 'task-manager', 'task-oversight']);
    await assign(ADM, CU1, auditors);
    expect(await val(CU1, 'oversees_tasks()')).toBe(true);
    expect(await sees(CU1)).toBe(1);
    expect(await as(CU1, `update tasks set priority = 'low' where id = $1 returning 1`, [task])).toHaveLength(0);
    expect(await as(CU1, `delete from tasks where id = $1 returning 1`, [task])).toHaveLength(0);
    await setModules(ADM, auditors, ['dashboard', 'task-manager']);
    expect(await sees(CU1)).toBe(0);
    expect(await val(CU1, 'oversees_tasks()')).toBe(false);
  });

  it('a MANAGER-based custom role given task-oversight sees every task, read-only', async () => {
    const leads = await createRole(ADM, 'Leads', 'MANAGER', ['task-manager', 'task-oversight']);
    await assign(ADM, CU2, leads);
    expect(await sees(CU2)).toBe(1);
    expect(await as(CU2, `update tasks set title = 'x' where id = $1 returning 1`, [task])).toHaveLength(0);
    expect(await as(CU2, `delete from tasks where id = $1 returning 1`, [task])).toHaveLength(0);
  });

  it('an HR-based custom role without it does not', async () => {
    const hrLite = await createRole(ADM, 'HR lite', 'HR', ['employees']);
    await assign(ADM, CU3, hrLite);
    expect(await sees(CU3)).toBe(0);
  });

  it('company isolation: a custom role with task-oversight in B sees B tasks only', async () => {
    const watch = await createRole(ADMB, 'B Watch', 'MANAGER', ['task-oversight', 'chat-admin']);
    await assign(ADMB, CUB, watch);
    expect(await sees(CUB, taskB)).toBe(1);
    expect(await sees(CUB, task)).toBe(0);
    expect(await as(CUB, `select 1 from tasks where tenant_id = $1`, [A])).toHaveLength(0);
  });
});

describe('KPIs, job titles and loans', () => {
  it('system roles keep what they had', async () => {
    const expected: Record<string, [boolean, boolean, boolean]> = {
      // manages_kpis, manages_job_titles, manages_loans
      ADM: [true, true, true], HR1: [true, true, true], CHK: [false, true, true], MGR: [false, true, false],
      REG: [false, true, false], OPS: [false, true, false], STF: [false, false, false],
    };
    for (const [k, want] of Object.entries(expected)) {
      const got = [await val(IDS[k], 'manages_kpis()'), await val(IDS[k], 'manages_job_titles()'), await val(IDS[k], 'manages_loans()')];
      expect([k, got]).toEqual([k, want]);
    }
  });

  it('a custom role follows kpi-admin, employees and loans', async () => {
    const r = await createRole(ADM, 'Coach', 'MANAGER', ['performance']);
    await assign(ADM, CU2, r);
    expect([await val(CU2, 'manages_kpis()'), await val(CU2, 'manages_job_titles()'), await val(CU2, 'manages_loans()')]).toEqual([false, false, false]);
    await setModules(ADM, r, ['performance', 'kpi-admin']);
    expect([await val(CU2, 'manages_kpis()'), await val(CU2, 'manages_job_titles()')]).toEqual([true, true]);
    await setModules(ADM, r, ['employees']);
    expect([await val(CU2, 'manages_kpis()'), await val(CU2, 'manages_job_titles()')]).toEqual([false, true]);
    await setModules(ADM, r, ['loans']);
    expect(await val(CU2, 'manages_loans()')).toBe(true);
    await setModules(ADM, r, ['payroll']);
    expect(await val(CU2, 'manages_loans()')).toBe(true);
    await setModules(ADM, r, []);
    expect(await val(CU2, 'manages_loans()')).toBe(false);
  });

  it('HR without kpi-admin (unticked) no longer manages KPIs, but still job titles through employees', async () => {
    const hr = await roleId(A, 'HR');
    const mods = (await modulesOf(A, 'HR')) as string[];
    await setModules(ADM, hr, mods.filter((m) => m !== 'kpi-admin'));
    expect([await val(HR1, 'manages_kpis()'), await val(HR1, 'manages_job_titles()')]).toEqual([false, true]);
    await setModules(ADM, hr, mods);
    expect(await val(HR1, 'manages_kpis()')).toBe(true);
  });
});

describe('exits (approve-exits)', () => {
  const refusal = (user: string, requestedBy: string, decision = 'approved') =>
    val<string | null>(user, 'exit_decision_refusal($1, $2)', [requestedBy, decision]);

  it('system roles: ADMIN and HR decide; the others are refused', async () => {
    expect(await refusal(ADM, STF)).toBeNull();
    expect(await refusal(HR1, STF)).toBeNull();
    for (const k of ['CHK', 'MGR', 'REG', 'OPS', 'STF']) {
      expect([k, await refusal(IDS[k], STF)]).toEqual([k, 'Only HR or an administrator can approve or decline an exit']);
    }
    // someone else can approve, so not the person who started it
    expect(await refusal(HR1, HR1)).toBe('You started this exit, so another HR person or an administrator must approve it');
    expect(await refusal(HR1, HR1, 'declined')).toBeNull();
  });

  it('a custom role follows the module', async () => {
    const r = await createRole(ADM, 'Exit desk', 'MANAGER', ['approve-exits']);
    await assign(ADM, CU2, r);
    expect(await refusal(CU2, STF)).toBeNull();
    await setModules(ADM, r, []);
    expect(await refusal(CU2, STF)).toBe('Only HR or an administrator can approve or decline an exit');
  });

  it('"another approver" counts a custom role holding approve-exits, not one without', async () => {
    // tenant C: one HR person, and CX with a custom role
    const r = (await one<{ id: string; role_key: string }>(
      `insert into company_roles (tenant_id, name, base_role, is_system, role_key)
       values ($1, 'Approvers', 'MANAGER', false, 'CR_00000000000000000000000000000000') returning id, role_key`, [C]));
    await rows(`insert into role_permissions (tenant_id, role_name, permissions) values ($1, $2, array['approve-exits'])`, [C, r.role_key]);
    await rows(`update memberships set company_role_id = $1 where user_id = $2 and tenant_id = $3`, [r.id, CX, C]);
    expect(await refusal(CHR, CHR)).toBe('You started this exit, so another HR person or an administrator must approve it');
    await rows(`update role_permissions set permissions = '{}' where tenant_id = $1 and role_name = $2`, [C, r.role_key]);
    expect(await refusal(CHR, CHR)).toBeNull(); // nobody else can, so they may
  });
});

describe('who gets HR alerts, and who records work for payroll', () => {
  const recipients = async (type: string, among: string[]) =>
    (await rows<{ user_id: string }>(`select user_id from hr_alert_recipients($1, $2)`, [A, type]))
      .map((r) => r.user_id).filter((id) => among.includes(id)).sort();
  const sys = Object.values(IDS);
  const names = (ids: string[]) => ids.map((id) => Object.keys(IDS).find((k) => IDS[k] === id) ?? id).sort();

  it('system roles: as before (loan requests to ADMIN, HR and payroll; others by module)', async () => {
    expect(names(await recipients('loan_requested', sys))).toEqual(['ADM', 'CHK', 'HR1', 'HR2']);
    expect(names(await recipients('application_received', sys))).toEqual(['ADM', 'CHK', 'HR1', 'HR2', 'OPS']);
    expect(names(await recipients('leave_recommended', sys))).toEqual(['ADM', 'HR1', 'HR2', 'MGR', 'OPS', 'REG']);
    expect(names(await recipients('contract_expiring', sys))).toEqual(['ADM', 'CHK', 'HR1', 'HR2', 'MGR', 'OPS', 'REG']);
  });

  it('a custom role follows its own modules (not its base role’s): loans gets loan requests', async () => {
    const r = await createRole(ADM, 'Loan desk', 'MANAGER', ['loans']);
    await assign(ADM, CU2, r);
    expect(await recipients('loan_requested', [CU2])).toEqual([CU2]);
    expect(await recipients('leave_recommended', [CU2])).toEqual([]); // MANAGER has leaves; this role does not
    await setModules(ADM, r, ['leaves']);
    expect(await recipients('loan_requested', [CU2])).toEqual([]);
    expect(await recipients('leave_recommended', [CU2])).toEqual([CU2]);
  });

  it('work_payroll_numbers: the people holding work-records or payroll, custom roles by their own modules', async () => {
    const numbers = async () => (await rows<{ n: string }>(`select n from work_payroll_numbers($1) n`, [A])).map((r) => r.n).sort();
    expect(await numbers()).toEqual(['A-ADM', 'A-CHK']);
    const r = await createRole(ADM, 'Pay clerk', 'MANAGER', ['payroll']);
    await assign(ADM, CU2, r);
    expect(await numbers()).toEqual(['A-ADM', 'A-CHK', 'A-CU2']);
    // a CHECKER-based role without payroll is not counted, though CHECKER has it
    const v = await createRole(ADM, 'Verifier', 'CHECKER', ['staffcheck']);
    await setModules(ADM, r, ['leaves']);
    await assign(ADM, CU2, v);
    expect(await numbers()).toEqual(['A-ADM', 'A-CHK']);
  });
});

describe('chat', () => {
  const create = (user: string, name: string) =>
    fails(as(user, `insert into channels (name, type, is_private, created_by) values ($1, 'channel', false, $2)`, [name, user]));
  const sees = async (user: string, id = secret) => (await as(user, `select 1 from channels where id = $1`, [id])).length;

  it('creating a channel: ADMIN, HR and MANAGER as before; a custom role by chat-channels', async () => {
    for (const k of ['ADM', 'HR1', 'MGR']) expect([k, await create(IDS[k], `c-${k}`)]).toEqual([k, '']);
    for (const k of ['CHK', 'REG', 'OPS', 'STF']) expect([k, await create(IDS[k], `c-${k}`)]).toEqual([k, expect.stringMatching(/row-level security/)]);
    const r = await createRole(ADM, 'Chatters', 'STAFF', ['chat-channels']);
    await assign(ADM, CU1, r);
    expect(await create(CU1, 'c-cu1')).toBe('');
    await setModules(ADM, r, []);
    expect(await create(CU1, 'c-cu1b')).toMatch(/row-level security/);
  });

  it('private channels, managing them and others’ messages: ADMIN only among the system roles', async () => {
    expect(await sees(ADM)).toBe(1);
    for (const k of ['HR1', 'CHK', 'REG', 'OPS', 'STF']) expect([k, await sees(IDS[k])]).toEqual([k, 0]);
    expect(await as(HR1, `update messages set content = 'x' where id = $1 returning 1`, [message])).toHaveLength(0);
    expect(await as(ADM, `update channels set description = 'by admin' where id = $1 returning 1`, [secret])).toHaveLength(1);
    expect(await as(ADM, `update messages set content = 'edited by admin' where id = $1 returning 1`, [message])).toHaveLength(1);
  });

  it('a custom role with chat-admin moderates; untick and it cannot', async () => {
    const r = await createRole(ADM, 'Moderators', 'STAFF', ['chat-admin']);
    await assign(ADM, CU1, r);
    expect(await sees(CU1)).toBe(1);
    expect(await as(CU1, `update channels set description = 'moderated' where id = $1 returning 1`, [secret])).toHaveLength(1);
    expect(await as(CU1, `update messages set content = 'moderated' where id = $1 returning 1`, [message])).toHaveLength(1);
    expect(await val(CU1, 'add_channel_members($1, $2::uuid[])', [secret, [STF]])).toBe(1);
    expect(await as(CU1, `delete from channel_members where channel_id = $1 and user_id = $2 returning 1`, [secret, STF])).toHaveLength(1);
    await setModules(ADM, r, []);
    expect(await sees(CU1)).toBe(0);
    expect(await as(CU1, `update messages set content = 'again' where id = $1 returning 1`, [message])).toHaveLength(0);
    expect(await fails(as(CU1, `select add_channel_members($1, $2::uuid[])`, [secret, [STF]]))).toMatch(/cannot add people/);
    // and someone who is neither the creator nor a moderator never could
    expect(await fails(as(HR1, `select add_channel_members($1, $2::uuid[])`, [secret, [STF]]))).toMatch(/cannot add people/);
  });

  it('chat-admin removes others’ messages (not direct messages)', async () => {
    const r = await createRole(ADM, 'Mods 2', 'MANAGER', ['chat-admin']);
    await assign(ADM, CU2, r);
    const m = (await asOne<{ id: string }>(MGR, `insert into messages (channel_id, author_id, content) values ($1, $2, 'bye') returning id`, [secret, MGR])).id;
    expect(await as(CU2, `delete from messages where id = $1 returning 1`, [m])).toHaveLength(1);
  });

  it('company isolation: a custom role with chat-admin in B sees nothing of A', async () => {
    expect(await sees(CUB, secretB)).toBe(1);
    expect(await sees(CUB, secret)).toBe(0);
    expect(await as(CUB, `select 1 from messages where id = $1`, [message])).toHaveLength(0);
    expect(await as(CUB, `update messages set content = 'x' where id = $1 returning 1`, [message])).toHaveLength(0);
    expect(await fails(as(CUB, `select add_channel_members($1, $2::uuid[])`, [secret, [CUB]]))).toMatch(/cannot add people/);
  });
});

describe('two-step sign-in', () => {
  beforeAll(async () => {
    await db.exec(`insert into company_security_settings (tenant_id, two_step) values ('${A}', 'privileged')
      on conflict (tenant_id) do update set two_step = 'privileged'`);
  });
  const requires = async (user: string) => (await asOne<{ company_requires: boolean }>(user, `select company_requires from my_two_step()`)).company_requires;

  it('"admins, HR and payroll": ADMIN, HR and CHECKER as before, not the others', async () => {
    for (const k of ['ADM', 'HR1', 'CHK']) {
      expect([k, await requires(IDS[k]), await val(IDS[k], 'mfa_required()')]).toEqual([k, true, true]);
    }
    for (const k of ['MGR', 'REG', 'OPS', 'STF']) {
      expect([k, await requires(IDS[k]), await val(IDS[k], 'mfa_required()')]).toEqual([k, false, false]);
    }
    expect((await one<{ v: string[] }>(`select two_step_privileged_modules() v`)).v).toEqual(['payroll', 'settings', 'role-permissions', 'invite-people']);
  });

  it('a MANAGER-based custom role with payroll is asked; an HR-based one without a privileged module is not', async () => {
    const pay = await createRole(ADM, 'Payroll lead', 'MANAGER', ['payroll']);
    await assign(ADM, CU2, pay);
    expect([await requires(CU2), await val(CU2, 'mfa_required()')]).toEqual([true, true]);
    expect(await fails(as(CU2, `select * from set_my_two_step(false)`))).toMatch(/can't be turned off/);
    const hrLite = await createRole(ADM, 'HR no invites', 'HR', ['employees', 'leaves']);
    await assign(ADM, CU3, hrLite);
    expect([await requires(CU3), await val(CU3, 'mfa_required()')]).toEqual([false, false]);
    expect(await fails(as(CU3, `select * from set_my_two_step(false)`))).toBe('');
  });

  it('everyone / off', async () => {
    await db.exec(`update company_security_settings set two_step = 'everyone' where tenant_id = '${A}'`);
    expect(await requires(STF)).toBe(true);
    await db.exec(`update company_security_settings set two_step = 'off' where tenant_id = '${A}'`);
    expect(await requires(ADM)).toBe(false);
    await db.exec(`update company_security_settings set two_step = 'privileged' where tenant_id = '${A}'`);
  });

  it('the company setting, the list and resets need sign-in-security (administrators always)', async () => {
    const canEdit = async (user: string) => (await asOne<{ can_edit: boolean }>(user, `select can_edit from two_step_settings()`)).can_edit;
    expect(await canEdit(ADM)).toBe(true);
    expect(await fails(as(ADM, `select * from set_two_step_settings('privileged', 'email')`))).toBe('');
    expect(await fails(as(ADM, `select * from two_step_people()`))).toBe('');
    expect(await fails(as(ADM, `select reset_two_step($1)`, [STF]))).toBe('');
    for (const k of ['HR1', 'CHK', 'MGR', 'STF']) {
      expect([k, await canEdit(IDS[k])]).toEqual([k, false]);
      expect(await fails(as(IDS[k], `select * from set_two_step_settings('off', 'email')`))).toMatch(/Only an administrator/);
      expect(await fails(as(IDS[k], `select * from two_step_people()`))).toMatch(/Only an administrator/);
      expect(await fails(as(IDS[k], `select reset_two_step($1)`, [STF]))).toMatch(/Only an administrator/);
    }
    const sec = await createRole(ADM, 'Security', 'HR', ['sign-in-security']);
    await assign(ADM, CU3, sec);
    expect(await canEdit(CU3)).toBe(true);
    expect(await fails(as(CU3, `select * from set_two_step_settings('privileged', 'sms')`))).toBe('');
    expect(await fails(as(CU3, `select * from two_step_people()`))).toBe('');
    expect(await fails(as(CU3, `select reset_two_step($1)`, [STF]))).toBe('');
    await setModules(ADM, sec, []);
    expect(await canEdit(CU3)).toBe(false);
    expect(await fails(as(CU3, `select reset_two_step($1)`, [STF]))).toMatch(/Only an administrator/);
  });
});

describe('no name checks left', () => {
  it('only the functions and policies kept on purpose still read the role name', async () => {
    const fns = (await rows<{ n: string }>(String.raw`
      select distinct p.proname n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.prosrc ~* 'current_user_role\(\)' order by 1`)).map((r) => r.n);
    expect(fns).toEqual(['approval_acting_as', 'approval_advance', 'approval_default_steps', 'company_roles_rules',
      'create_company_role', 'delete_company_role', 'kpi_checkins_rules', 'my_approval_chain', 'role_permissions_rules',
      'update_company_role'].filter((n) => fns.includes(n)));
    for (const gone of ['oversees_tasks', 'manages_kpis', 'manages_job_titles', 'manages_loans', 'exit_decision_refusal',
      'mfa_required', 'my_two_step', 'set_my_two_step', 'set_two_step_settings', 'two_step_people', 'reset_two_step',
      'two_step_settings', 'add_channel_members']) {
      expect(fns).not.toContain(gone);
    }
    const pols = (await rows<{ t: string; p: string }>(`
      select tablename t, policyname p from pg_policies
      where coalesce(qual, '') || coalesce(with_check, '') ~* 'current_user_role' order by 1, 2`)).map((r) => `${r.t}.${r.p}`);
    expect(pols).toEqual(['todos.delete_tasks']);
  });
});

describe('running the migration again', () => {
  it('succeeds and does not give back a module a company took away', async () => {
    const hr = await roleId(A, 'HR');
    const mods = ((await modulesOf(A, 'HR')) as string[]).filter((m) => m !== 'task-oversight');
    await setModules(ADM, hr, mods);
    const snapshot = await rows(`select tenant_id, role_name, permissions from role_permissions order by 1, 2`);
    await db.exec(migration());
    await db.exec('reset search_path');
    expect(await modulesOf(A, 'HR')).not.toContain('task-oversight');
    expect(await rows(`select tenant_id, role_name, permissions from role_permissions order by 1, 2`)).toEqual(snapshot);
    expect(await as(HR1, `select 1 from tasks where id = $1`, [task])).toHaveLength(0);
    expect(await val(HR1, 'oversees_tasks()')).toBe(false);
  });
});
