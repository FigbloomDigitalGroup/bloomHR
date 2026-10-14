// @vitest-environment node
//
// Org structure (20261016200000): departments (nested, no loops, one name per company), each employee's department
// and who they report to (same company, not themselves, no loops), the old columns kept in step, the backfill from
// `Job Level` and manager_email, who may change departments, and that companies never see each other's.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootDb, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const ADMIN = '00000000-0000-0000-0000-00000000fa01';
const HR = '00000000-0000-0000-0000-00000000fa02';
const STAFF = '00000000-0000-0000-0000-00000000fa03';
const ADMIN_B = '00000000-0000-0000-0000-00000000fa04';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const idOf = async (email: string) => (await rows<{ id: string }>(`select id from employees where "Work Email" = $1`, [email]))[0].id;
const emp = async (email: string) =>
  (await rows<{ department_id: string | null; reports_to_id: string | null; manager_email: string | null; Manager: string | null; 'Job Level': string | null }>(
    `select department_id, reports_to_id, manager_email, "Manager", "Job Level" from employees where "Work Email" = $1`, [email]))[0];
const addDept = (user: string, name: string, parent: string | null = null) =>
  asUser(db, user, () => rows<{ id: string }>(`insert into departments (name, parent_id) values ($1, $2) returning id`, [name, parent])).then((r) => r[0].id);
const MID = '00000000-0000-0000-0000-00000000fa05';
const BM = '00000000-0000-0000-0000-00000000fa06';
const RM = '00000000-0000-0000-0000-00000000fa07';
const login = (id: string, email: string) => db.exec(`insert into auth.users (id, email) values ('${id}', '${email}');
  insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', 'STAFF', '${A}')`);
const team = (user: string) =>
  asUser(db, user, () => rows<{ n: string }>(`select n from supervised_employee_numbers() n order by 1`)).then((r) => r.map((x) => x.n));
const setReportsTo = (user: string, email: string, manager: string | null) =>
  asUser(db, user, () => db.query(`update employees set reports_to_id = $2 where "Work Email" = $1`, [email, manager]));

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
  for (const [id, email, role, tenant] of [
    [ADMIN, 'admin@a.co', 'ADMIN', A], [HR, 'hr@a.co', 'HR', A], [STAFF, 'staff@a.co', 'STAFF', A], [ADMIN_B, 'admin@b.co', 'ADMIN', B],
  ]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${tenant}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values ('HR', array['employees'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", tenant_id) values
      ('A-1', 'Ann', 'Boss', 'ceo@a.co', '${A}'),
      ('A-2', 'Ben', 'Mid', 'mid@a.co', '${A}'),
      ('A-3', 'Cy', 'Low', 'low@a.co', '${A}'),
      ('A-4', 'Stef', 'Staff', 'staff@a.co', '${A}'),
      ('B-1', 'Bo', 'Other', 'bo@b.co', '${B}');
  `);
}, 120000);

describe('departments', () => {
  it('HR adds them; a name is used once per company, whatever its case', async () => {
    const ops = await addDept(HR, '  Operations ');
    expect((await rows<{ name: string }>(`select name from departments where id = $1`, [ops]))[0].name).toBe('Operations');
    expect(await fails(addDept(HR, 'OPERATIONS'))).toMatch(/duplicate|unique/);
    // another company may use the same name
    await addDept(ADMIN_B, 'Operations');
  });

  it('nest, but never inside themselves or their own sub-departments', async () => {
    const top = await addDept(HR, 'Head Office');
    const mid = await addDept(HR, 'Finance', top);
    const low = await addDept(HR, 'Payables', mid);
    expect(await fails(asUser(db, HR, () => db.query(`update departments set parent_id = $1 where id = $2`, [low, top])))).toMatch(/inside itself/);
    expect(await fails(asUser(db, HR, () => db.query(`update departments set parent_id = id where id = $1`, [top])))).toMatch(/check|inside itself/);
    // moving to a different branch of the tree is fine
    await asUser(db, HR, () => db.query(`update departments set parent_id = null where id = $1`, [low]));
  });

  it('refuse another company’s parent or head', async () => {
    const theirs = (await rows<{ id: string }>(`select id from departments where tenant_id = '${B}'`))[0].id;
    expect(await fails(addDept(HR, 'Sneaky', theirs))).toMatch(/this company/);
    const bo = await idOf('bo@b.co');
    expect(await fails(asUser(db, HR, () => db.query(`insert into departments (name, head_employee_id) values ('Headed', $1)`, [bo])))).toMatch(/this company/);
    await asUser(db, HR, async () => db.query(`insert into departments (name, head_employee_id) values ('Headed', $1)`, [await idOf('ceo@a.co')]));
  });

  it('everyone in the company reads them; only ADMIN and the Employees module change them', async () => {
    const seen = await asUser(db, STAFF, () => rows<{ name: string }>(`select name from departments order by name`));
    expect(seen.map((r) => r.name)).toContain('Operations');
    expect(await fails(addDept(STAFF, 'Mine'))).toMatch(/row-level security/);
    const changed = await asUser(db, STAFF, () => rows(`update departments set active = false returning 1`));
    expect(changed).toHaveLength(0);
    await addDept(ADMIN, 'Admin Made');
  });

  it('each company sees only its own; anonymous users none', async () => {
    const mine = await asUser(db, ADMIN_B, () => rows<{ tenant_id: string }>(`select tenant_id from departments`));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.tenant_id === B)).toBe(true);
    expect(await asUser(db, ADMIN_B, () => rows(`update departments set name = name || '!' where tenant_id = '${A}' returning 1`))).toHaveLength(0);
    const anon = await fails(asAnon(db, () => rows(`select 1 from departments`)));
    expect(anon).toMatch(/permission denied/);
  });
});

describe('an employee’s department', () => {
  it('setting it fills in `Job Level`; renaming the department renames it there', async () => {
    const dept = await addDept(HR, 'Sales');
    await asUser(db, HR, () => db.query(`update employees set department_id = $1 where "Work Email" = 'low@a.co'`, [dept]));
    expect((await emp('low@a.co'))['Job Level']).toBe('Sales');
    await asUser(db, HR, () => db.query(`update departments set name = 'Sales & Marketing' where id = $1`, [dept]));
    expect((await emp('low@a.co'))['Job Level']).toBe('Sales & Marketing');
  });

  it('typing `Job Level` (older screens, bulk upload) finds the department, or creates it', async () => {
    await asUser(db, HR, () => db.query(`update employees set "Job Level" = 'operations' where "Work Email" = 'mid@a.co'`));
    const ops = (await rows<{ id: string }>(`select id from departments where tenant_id = '${A}' and name = 'Operations'`))[0].id;
    expect((await emp('mid@a.co')).department_id).toBe(ops);
    await asUser(db, HR, () => db.query(`update employees set "Job Level" = 'Brand New' where "Work Email" = 'mid@a.co'`));
    const made = await rows<{ id: string }>(`select id from departments where tenant_id = '${A}' and name = 'Brand New'`);
    expect(made).toHaveLength(1);
    expect((await emp('mid@a.co')).department_id).toBe(made[0].id);
  });

  it('must be one of the company’s departments', async () => {
    const theirs = (await rows<{ id: string }>(`select id from departments where tenant_id = '${B}'`))[0].id;
    expect(await fails(asUser(db, HR, () => db.query(`update employees set department_id = $1 where "Work Email" = 'low@a.co'`, [theirs])))).toMatch(/this company/);
  });

  it('staff cannot move themselves', async () => {
    const dept = (await rows<{ id: string }>(`select id from departments where tenant_id = '${A}' and name = 'Operations'`))[0].id;
    expect(await fails(asUser(db, STAFF, () => db.query(`update employees set department_id = $1 where "Work Email" = 'staff@a.co'`, [dept])))).toMatch(/personal details/);
  });
});

describe('who an employee reports to', () => {
  it('sets `Manager` and makes the manager their supervisor, leaving manager_email alone', async () => {
    await setReportsTo(HR, 'mid@a.co', await idOf('ceo@a.co'));
    await setReportsTo(HR, 'low@a.co', await idOf('mid@a.co'));
    // manager_email is Assign Managers' "is a manager" mark: a report must not become an "assigned manager"
    expect(await emp('low@a.co')).toMatchObject({ manager_email: null, Manager: 'Ben Mid' });
    await login(MID, 'mid@a.co');
    expect(await team(MID)).toEqual(['A-3']);
    expect(await asUser(db, MID, () => rows<{ s: boolean }>(`select supervises('A-3') s`))).toEqual([{ s: true }]);
    expect(await asUser(db, MID, () => rows<{ s: boolean }>(`select supervises('A-1') s`))).toEqual([{ s: false }]);
  });

  it('a manager marked the Assign Managers way keeps the mark, and their team, when given a "Reports to"', async () => {
    await db.exec(`
      insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Town", "Branch", manager_email, regional_manager, tenant_id) values
        ('BM-1', 'Bea', 'Branch', 'bm@a.co', 'Nakuru', 'Rift', 'bm@a.co', null, '${A}'),
        ('RM-1', 'Rex', 'Region', 'rm@a.co', 'Nakuru', 'Rift', null, 'rm@a.co', '${A}'),
        ('W-1', 'Wes', 'Worker', 'w1@a.co', 'Nakuru', 'Rift', 'bm@a.co', null, '${A}');
    `);
    await login(BM, 'bm@a.co');
    await login(RM, 'rm@a.co');
    const marked = () => rows<{ n: string; m: string | null; r: string | null }>(`select "Employee Number" n, manager_email m, regional_manager r
      from employees where tenant_id = '${A}' and (manager_email is not null or regional_manager is not null) order by 1`);
    const supervisesW1 = () => asUser(db, BM, () => rows(`select supervises('W-1') s`));
    const before = { marked: await marked(), bm: await team(BM), rm: await team(RM), w1: await supervisesW1() };
    expect(before.marked.map((r) => r.n)).toEqual(['BM-1', 'RM-1', 'W-1']);
    expect(before.bm).toEqual(['BM-1', 'W-1']);

    await setReportsTo(HR, 'bm@a.co', await idOf('rm@a.co'));
    await setReportsTo(HR, 'rm@a.co', await idOf('ceo@a.co'));

    // still marked as managers, exactly as before (Assign Managers lists the same people)
    expect(await marked()).toEqual(before.marked);
    expect(await emp('bm@a.co')).toMatchObject({ manager_email: 'bm@a.co', Manager: 'Rex Region' });
    // Salary Advance finds the branch manager's town by manager_email = their email: the same rows as before
    expect(await rows(`select "Employee Number" from employees where manager_email = 'bm@a.co' order by 1`)).toEqual(
      [{ 'Employee Number': 'BM-1' }, { 'Employee Number': 'W-1' }]);
    // their own team is unchanged
    expect(await team(BM)).toEqual(before.bm);
    expect(await supervisesW1()).toEqual(before.w1);
    // the new reporting line adds Bea to Rex's team; nothing he had before goes
    expect(await team(RM)).toEqual([...new Set([...before.rm, 'BM-1'])].sort());
  });

  it('appointing a manager (Assign Managers) does not change who they report to', async () => {
    const boss = (await emp('low@a.co')).reports_to_id;
    expect(boss).not.toBeNull();
    await asUser(db, HR, () => db.query(`update employees set manager_email = 'low@a.co' where "Work Email" = 'low@a.co'`));
    expect(await emp('low@a.co')).toMatchObject({ reports_to_id: boss, manager_email: 'low@a.co' });
    await asUser(db, HR, () => db.query(`update employees set manager_email = null where "Work Email" = 'low@a.co'`));
    expect((await emp('low@a.co')).reports_to_id).toBe(boss);
  });

  it('a manager’s new name follows to their reports', async () => {
    await asUser(db, HR, () => db.query(`update employees set "Last Name" = 'Middle' where "Work Email" = 'mid@a.co'`));
    expect((await emp('low@a.co')).Manager).toBe('Ben Middle');
    await asUser(db, HR, () => db.query(`update employees set "Last Name" = 'Mid' where "Work Email" = 'mid@a.co'`));
  });

  it('clearing it clears the old manager’s name, and never manager_email', async () => {
    await asUser(db, HR, () => db.query(`update employees set manager_email = 'staff@a.co' where "Work Email" = 'staff@a.co'`));
    await setReportsTo(HR, 'staff@a.co', await idOf('mid@a.co'));
    await setReportsTo(HR, 'staff@a.co', null);
    expect(await emp('staff@a.co')).toMatchObject({ reports_to_id: null, manager_email: 'staff@a.co', Manager: null });
    await asUser(db, HR, () => db.query(`update employees set manager_email = null where "Work Email" = 'staff@a.co'`));
  });

  it('refuses themselves, loops and other companies’ people', async () => {
    expect(await fails(setReportsTo(HR, 'ceo@a.co', await idOf('ceo@a.co')))).toMatch(/themselves|reports_to_not_self/);
    expect(await fails(setReportsTo(HR, 'ceo@a.co', await idOf('low@a.co')))).toMatch(/loop/);
    expect(await fails(setReportsTo(HR, 'ceo@a.co', await idOf('bo@b.co')))).toMatch(/this company/);
  });

  it('staff cannot change their own manager', async () => {
    expect(await fails(setReportsTo(STAFF, 'staff@a.co', await idOf('ceo@a.co')))).toMatch(/personal details/);
  });

  it('the directory shows ids, departments and managers to every role, in their company only', async () => {
    const dir = await asUser(db, STAFF, () => rows<{ id: string; reports_to_id: string | null; tenant_id: string }>(
      `select id, reports_to_id, tenant_id from employee_directory`));
    expect(dir.length).toBe((await rows(`select 1 from employees where tenant_id = '${A}'`)).length);
    expect(dir.every((r) => r.tenant_id === A && r.id)).toBe(true);
    expect(dir.some((r) => r.reports_to_id)).toBe(true);
  });
});

describe('backfill of existing companies', () => {
  it('departments from `Job Level`, reporting lines from manager_email (no self, no loops, no other company)', async () => {
    const old = await bootDb({
      file: '20261016200000_org_structure.sql',
      seed: async (d) => {
        await d.exec(`
          insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
          insert into employees ("Employee Number", "First Name", "Work Email", "Job Level", manager_email, tenant_id) values
            ('E1', 'Boss', 'Boss@a.co', 'Finance', null, '${A}'),
            ('E2', 'Two', 'two@a.co', ' finance ', 'boss@A.co', '${A}'),
            ('E3', 'Three', 'three@a.co', 'Finance', 'two@a.co', '${A}'),
            ('E4', 'Self', 'self@a.co', '', 'self@a.co', '${A}'),
            ('E5', 'LoopA', 'la@a.co', 'IT', 'lb@a.co', '${A}'),
            ('E6', 'LoopB', 'lb@a.co', null, 'la@a.co', '${A}'),
            ('E7', 'Away', 'away@a.co', 'IT', 'bo@b.co', '${A}'),
            ('X1', 'Bo', 'bo@b.co', 'Finance', null, '${B}');
        `);
      },
    });
    const q = async <T>(sql: string) => (await old.query<T>(sql)).rows;
    expect(await q(`select tenant_id, name from departments order by tenant_id, name`)).toEqual([
      { tenant_id: A, name: 'Finance' }, { tenant_id: A, name: 'IT' }, { tenant_id: B, name: 'Finance' },
    ]);
    const got = await q<{ n: string; dept: string | null; boss: string | null; level: string | null; email: string | null }>(`
      select e."Employee Number" n, d.name dept, m."Employee Number" boss, e."Job Level" level, e.manager_email email
      from employees e left join departments d on d.id = e.department_id left join employees m on m.id = e.reports_to_id
      order by 1`);
    expect(got).toEqual([
      { n: 'E1', dept: 'Finance', boss: null, level: 'Finance', email: null },
      { n: 'E2', dept: 'Finance', boss: 'E1', level: ' finance ', email: 'boss@A.co' },
      { n: 'E3', dept: 'Finance', boss: 'E2', level: 'Finance', email: 'two@a.co' },
      { n: 'E4', dept: null, boss: null, level: '', email: 'self@a.co' },
      { n: 'E5', dept: 'IT', boss: 'E6', level: 'IT', email: 'lb@a.co' },
      { n: 'E6', dept: null, boss: null, level: null, email: 'la@a.co' },
      { n: 'E7', dept: 'IT', boss: null, level: 'IT', email: 'bo@b.co' },
      { n: 'X1', dept: 'Finance', boss: null, level: 'Finance', email: null },
    ]);
  }, 120000);
});
