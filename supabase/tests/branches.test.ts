// @vitest-environment node
//
// Branches with a country (FIG-905 stage 1): seeding existing companies (a default branch, a branch per "Branch" text,
// employees linked), keeping branch_id and the "Branch" text in step, an employee's country and currency, Tanzania and
// Uganda public holidays, leave counted with only the employee's country's holidays, who may change branches, company
// isolation, and running the migration again. Migration 20261020500000.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const T = '00000000-0000-0000-0000-0000000000d5'; // a company in Tanzania
const HR = '00000000-0000-0000-0000-00000000e901';
const SET = '00000000-0000-0000-0000-00000000e902';
const STAFF = '00000000-0000-0000-0000-00000000e903';
const OTHER = '00000000-0000-0000-0000-00000000e904';

const FILE = '20261020500000_branches.sql';
const MIGRATION = join(__dirname, '..', 'migrations', FILE);

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const val = async <T = unknown>(sql: string) => Object.values((await rows<Record<string, T>>(sql))[0])[0];
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const branchId = (tenant: string, name: string) => `(select id from branches where tenant_id = '${tenant}' and name = '${name}')`;
const emp = async (n: string) =>
  (await rows<{ branch: string | null; branch_name: string | null }>(
    `select e."Branch" as branch, b.name as branch_name from employees e left join branches b on b.id = e.branch_id
     where e."Employee Number" = '${n}'`))[0];

beforeAll(async () => {
  db = await bootDb({
    file: FILE,
    // what a company already has when the migration runs: free-text branches
    seed: async (d) => {
      await d.exec(`
        insert into tenants (id, name, slug) values ('${T}', 'Tz Co', 'tz-co');
        insert into company_profile (tenant_id, company_name, country) values ('${T}', 'Tz Co', 'Tanzania')
          on conflict (tenant_id) do update set country = 'Tanzania';
        insert into employees ("Employee Number", "First Name", "Work Email", "Branch", tenant_id) values
          ('E1', 'One', 'e1@a.co', 'Nairobi', '${A}'),
          ('E2', 'Two', 'e2@a.co', 'Nairobi', '${A}'),
          ('E3', 'Three', 'e3@a.co', ' nairobi ', '${A}'),
          ('E4', 'Four', 'e4@a.co', 'Mombasa', '${A}'),
          ('E5', 'Five', 'e5@a.co', null, '${A}'),
          ('E6', 'Six', 'e6@a.co', 'all', '${A}'),
          ('T1', 'Tumaini', 't1@t.co', 'Arusha', '${T}');
      `);
    },
  });
  await db.exec(`
    delete from role_permissions where tenant_id = '${A}';
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co'), ('${SET}', 'set@a.co'), ('${STAFF}', 'e5@a.co'), ('${OTHER}', 'x@t.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${SET}', 'set@a.co', 'SET', '${A}'), ('${STAFF}', 'e5@a.co', 'STAFF', '${A}'),
      ('${OTHER}', 'x@t.co', 'HR', '${T}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees', 'leaves'], '${A}'), ('SET', array['settings'], '${A}'), ('STAFF', array['dashboard'], '${A}'),
      ('HR', array['employees'], '${T}');
  `);
}, 120000);

describe('seeding', () => {
  it('gives every company a default "Head office" in its country', async () => {
    const heads = await rows(`select tenant_id::text, name, country, currency, active from branches where is_default order by tenant_id`);
    expect(heads).toEqual(expect.arrayContaining([
      { tenant_id: A, name: 'Head office', country: 'Kenya', currency: 'KES', active: true },
      { tenant_id: T, name: 'Head office', country: 'Tanzania', currency: 'TZS', active: true },
    ]));
  });

  it('makes a branch per "Branch" text (trimmed, ignoring case) in the company country and links the employees', async () => {
    expect(await rows(`select name, country, currency from branches where tenant_id = '${A}' and not is_default order by name`)).toEqual([
      { name: 'Mombasa', country: 'Kenya', currency: 'KES' },
      { name: 'Nairobi', country: 'Kenya', currency: 'KES' },
    ]);
    expect(await rows(`select name, country, currency from branches where tenant_id = '${T}' and not is_default`)).toEqual([
      { name: 'Arusha', country: 'Tanzania', currency: 'TZS' },
    ]);
    for (const n of ['E1', 'E2', 'E3']) expect((await emp(n)).branch_name).toBe('Nairobi');
    expect((await emp('E4')).branch_name).toBe('Mombasa');
    expect((await emp('T1')).branch_name).toBe('Arusha');
    // no text: the default branch (null); 'all' is not a branch
    expect(await emp('E5')).toEqual({ branch: null, branch_name: null });
    expect(await emp('E6')).toEqual({ branch: 'all', branch_name: null });
    // the seeding only linked: the text people typed is unchanged
    expect((await emp('E3')).branch).toBe(' nairobi ');
  });
});

describe('the branch and the "Branch" text', () => {
  it('choosing a branch sets the text; typing an existing name links it (ignoring case)', async () => {
    await db.exec(`update employees set branch_id = ${branchId(A, 'Mombasa')} where "Employee Number" = 'E5'`);
    expect(await emp('E5')).toEqual({ branch: 'Mombasa', branch_name: 'Mombasa' });
    await db.exec(`update employees set "Branch" = 'NAIROBI' where "Employee Number" = 'E4'`);
    expect(await emp('E4')).toEqual({ branch: 'Nairobi', branch_name: 'Nairobi' });
    // clearing the text: back to the default branch
    await db.exec(`update employees set "Branch" = '' where "Employee Number" = 'E4'`);
    expect((await emp('E4')).branch_name).toBeNull();
  });

  it('a new name adds a branch in the default branch country; a new employee goes in the default branch', async () => {
    await db.exec(`insert into employees ("Employee Number", "First Name", "Branch", tenant_id) values ('E7', 'Seven', 'Kisumu', '${A}')`);
    expect(await rows(`select name, country from branches where tenant_id = '${A}' and name = 'Kisumu'`)).toEqual([{ name: 'Kisumu', country: 'Kenya' }]);
    expect((await emp('E7')).branch_name).toBe('Kisumu');
    await db.exec(`insert into employees ("Employee Number", "First Name", tenant_id) values ('E8', 'Eight', '${A}')`);
    expect(await emp('E8')).toEqual({ branch: 'Head office', branch_name: 'Head office' });
  });

  it("renaming a branch renames it on its people; another company's branch is refused", async () => {
    await db.exec(`update branches set name = 'Kisumu West' where tenant_id = '${A}' and name = 'Kisumu'`);
    expect((await emp('E7')).branch).toBe('Kisumu West');
    await expect(db.exec(`update employees set branch_id = ${branchId(T, 'Arusha')} where "Employee Number" = 'E7'`)).rejects.toThrow();
  });
});

describe("an employee's country", () => {
  it('is the branch country, else the default branch, else the company, else Kenya', async () => {
    await db.exec(`insert into branches (tenant_id, name, country) values ('${A}', 'Dar es Salaam', 'tanzania')`);
    expect(await rows(`select country, currency from branches where name = 'Dar es Salaam'`)).toEqual([{ country: 'Tanzania', currency: 'TZS' }]);
    await db.exec(`update employees set branch_id = ${branchId(A, 'Dar es Salaam')} where "Employee Number" = 'E1'`);
    expect(await val(`select employee_country('${A}', 'E1')`)).toBe('Tanzania');
    expect(await val(`select employee_currency('${A}', 'E1')`)).toBe('TZS');
    // no branch: the default branch's
    expect(await val(`select employee_country('${A}', 'E6')`)).toBe('Kenya');
    expect(await val(`select employee_country('${T}', 'nobody')`)).toBe('Tanzania');
    // a company with no branches and no profile
    expect(await val(`select employee_country('00000000-0000-0000-0000-0000000000ee', 'X')`)).toBe('Kenya');
    expect(await val(`select employee_currency('00000000-0000-0000-0000-0000000000ee', 'X')`)).toBe('KES');
  });

  it('moves the default branch with the company country (when it was in the old one)', async () => {
    await db.exec(`update company_profile set country = 'Uganda' where tenant_id = '${T}'`);
    expect(await rows(`select country, currency from branches where tenant_id = '${T}' and is_default`)).toEqual([{ country: 'Uganda', currency: 'UGX' }]);
    expect(await val(`select employee_country('${T}', 'T1')`)).toBe('Tanzania'); // Arusha stays in Tanzania
    await db.exec(`update company_profile set country = 'Tanzania' where tenant_id = '${T}'`);
  });

  it('the signed-in employee is told their own country', async () => {
    expect(await read(STAFF, `select my_holiday_country() c`)).toEqual([{ c: 'Kenya' }]);
    expect(await read(HR, `select my_holiday_country() c`)).toEqual([{ c: null }]);
  });
});

describe('public holidays per country', () => {
  const list = async (country: string, year: number) =>
    rows<{ name: string; holiday: string }>(`select name, holiday::text from public_holidays_for('${country}', ${year}) order by holiday, name`);

  it("Tanzania's for 2026, with Easter (5 April 2026) and no day in lieu", async () => {
    expect(await list('Tanzania', 2026)).toEqual([
      { name: "New Year's Day", holiday: '2026-01-01' },
      { name: 'Zanzibar Revolution Day', holiday: '2026-01-12' },
      { name: 'Good Friday', holiday: '2026-04-03' },
      { name: 'Easter Monday', holiday: '2026-04-06' },
      { name: 'Karume Day', holiday: '2026-04-07' },
      { name: 'Union Day', holiday: '2026-04-26' },
      { name: "Workers' Day", holiday: '2026-05-01' },
      { name: 'Saba Saba', holiday: '2026-07-07' },
      { name: "Nane Nane (Peasants' Day)", holiday: '2026-08-08' },
      { name: 'Mwalimu Nyerere Day', holiday: '2026-10-14' },
      { name: 'Independence Day', holiday: '2026-12-09' },
      { name: 'Christmas Day', holiday: '2026-12-25' },
      { name: 'Boxing Day', holiday: '2026-12-26' },
    ]);
  });

  it("Uganda's for 2026 (Women's Day on Sunday 8 March gets no Monday)", async () => {
    expect(await list('uganda ', 2026)).toEqual([
      { name: "New Year's Day", holiday: '2026-01-01' },
      { name: 'NRM Liberation Day', holiday: '2026-01-26' },
      { name: 'Archbishop Janani Luwum Day', holiday: '2026-02-16' },
      { name: "International Women's Day", holiday: '2026-03-08' },
      { name: 'Good Friday', holiday: '2026-04-03' },
      { name: 'Easter Monday', holiday: '2026-04-06' },
      { name: 'Labour Day', holiday: '2026-05-01' },
      { name: "Martyrs' Day", holiday: '2026-06-03' },
      { name: "National Heroes' Day", holiday: '2026-06-09' },
      { name: 'Independence Day', holiday: '2026-10-09' },
      { name: 'Christmas Day', holiday: '2026-12-25' },
      { name: 'Boxing Day', holiday: '2026-12-26' },
    ]);
  });

  it("Kenya's are unchanged", async () => {
    expect((await list('Kenya', 2026)).map((h) => h.name)).toContain('Mashujaa Day');
    expect(await list('Rwanda', 2026)).toEqual([]);
  });

  it('a branch in a new country brings its holidays; HR adds a year for every country the company is in', async () => {
    const y = new Date().getFullYear();
    const n = async (country: string, year: number) =>
      Number(await val(`select count(*) from holidays where tenant_id = '${A}' and source = 'auto' and country = '${country}' and extract(year from date) = ${year}`));
    expect(await n('Tanzania', y)).toBe(13);
    expect(await n('Tanzania', y + 1)).toBe(13);
    // the rows added before branches were Kenya's
    expect(Number(await val(`select count(*) from holidays where source = 'auto' and country is null`))).toBe(0);
    const added = (await read<{ n: number }>(HR, `select add_public_holidays(2030) n`))[0].n;
    expect(added).toBe(11 + 13); // Kenya (10 + Mashujaa Day observed) and Tanzania
    expect((await read<{ n: number }>(HR, `select add_public_holidays(2030) n`))[0].n).toBe(0);
    const c = (await read<{ c: { countries: unknown[] } }>(HR, `select public_holidays_country() c`))[0].c;
    expect(c.countries).toEqual([{ country: 'Kenya', supported: true }, { country: 'Tanzania', supported: true }]);
  });
});

describe('leave counting by country', () => {
  // December 2030: Tanzania's Independence Day is Mon 9th, Kenya's Jamhuri Day Thu 12th. E1 is in Dar es Salaam, E2 in
  // Nairobi.
  const days = async (e: string, from: string, to: string) =>
    Number(await val(`select leave_days_for('${A}', '${e}', '${from}', '${to}', false)`));

  it("skips the employee's own country's holidays and counts another country's", async () => {
    expect(await days('E1', '2030-12-09', '2030-12-11')).toBe(2);
    expect(await days('E2', '2030-12-09', '2030-12-11')).toBe(3);
    expect(await days('E1', '2030-12-12', '2030-12-13')).toBe(2);
    expect(await days('E2', '2030-12-12', '2030-12-13')).toBe(1);
  });

  it('a holiday for every country (no country) is skipped for everyone', async () => {
    await db.exec(`insert into holidays (tenant_id, name, date, recurring) values ('${A}', 'Company day', '2030-12-10', false)`);
    expect(await days('E1', '2030-12-09', '2030-12-11')).toBe(1);
    expect(await days('E2', '2030-12-09', '2030-12-11')).toBe(2);
    // a holiday HR adds for one country only
    await db.exec(`insert into holidays (tenant_id, name, date, recurring, country) values ('${A}', 'Eid al-Fitr', '2030-12-11', false, ' tanzania')`);
    expect(await val(`select country from holidays where name = 'Eid al-Fitr'`)).toBe('Tanzania');
    expect(await days('E1', '2030-12-09', '2030-12-11')).toBe(0);
    expect(await days('E2', '2030-12-09', '2030-12-11')).toBe(2);
  });
});

describe('access', () => {
  it('everyone in the company reads branches; HR and Settings change them; staff cannot', async () => {
    expect((await read(STAFF, `select name from branches`)).length).toBeGreaterThanOrEqual(5);
    await expect(as(STAFF, `insert into branches (name, country) values ('Sneaky', 'Kenya')`)).rejects.toThrow();
    await as(STAFF, `update branches set name = 'Hacked'`);
    expect(Number(await val(`select count(*) from branches where name = 'Hacked'`))).toBe(0);
    await as(HR, `insert into branches (name, country, city) values ('Kampala', 'Uganda', 'Kampala')`);
    expect(await rows(`select tenant_id::text, currency from branches where name = 'Kampala'`)).toEqual([{ tenant_id: A, currency: 'UGX' }]);
    await as(SET, `update branches set address = 'Plot 4, Kampala Road' where name = 'Kampala'`);
    expect(await val(`select address from branches where name = 'Kampala'`)).toBe('Plot 4, Kampala Road');
  });

  it("keeps companies apart", async () => {
    expect((await read<{ name: string }>(OTHER, `select name from branches order by name`)).map((r) => r.name)).toEqual(['Arusha', 'Head office']);
    await expect(as(OTHER, `insert into branches (tenant_id, name, country) values ('${A}', 'Intruder', 'Kenya')`)).rejects.toThrow();
    await as(OTHER, `update branches set name = 'Mine' where tenant_id = '${A}'`);
    expect(Number(await val(`select count(*) from branches where name = 'Mine'`))).toBe(0);
    await expect(asUser(db, OTHER, () => db.query(`select move_branch_staff(${branchId(A, 'Nairobi')}, ${branchId(A, 'Mombasa')})`))).rejects.toThrow();
  });

  it('a branch with people is not deactivated until they are moved', async () => {
    await expect(as(HR, `update branches set active = false where name = 'Nairobi'`)).rejects.toThrow(/move them to another branch/);
    await expect(asUser(db, STAFF, () => db.query(`select move_branch_staff(${branchId(A, 'Nairobi')}, ${branchId(A, 'Mombasa')})`))).rejects.toThrow(/Only HR/);
    expect((await read<{ n: number }>(HR, `select move_branch_staff(${branchId(A, 'Nairobi')}, ${branchId(A, 'Mombasa')}) n`))[0].n).toBe(2);
    await as(HR, `update branches set active = false where name = 'Nairobi'`);
    expect((await emp('E2')).branch_name).toBe('Mombasa');
    // no moving people into an inactive branch
    await expect(asUser(db, HR, () => db.query(`select move_branch_staff(${branchId(A, 'Mombasa')}, ${branchId(A, 'Nairobi')})`))).rejects.toThrow();
  });

  it('one default per company: a new default replaces the old; the default is never deactivated or unset directly', async () => {
    await expect(as(HR, `update branches set active = false where is_default`)).rejects.toThrow(/default branch/);
    await expect(as(HR, `update branches set is_default = false where is_default`)).rejects.toThrow(/another branch the default/);
    await as(HR, `update branches set is_default = true where name = 'Mombasa'`);
    expect(await read(HR, `select name from branches where is_default`)).toEqual([{ name: 'Mombasa' }]);
    // people with no branch now follow the new default
    expect(await val(`select employee_country('${A}', 'E6')`)).toBe('Kenya');
    await expect(as(HR, `delete from branches where name = 'Mombasa'`)).rejects.toThrow(/default branch/);
    await as(HR, `update branches set is_default = true where name = 'Head office'`);
  });
});

describe('the migration', () => {
  it('can run again without changing anything', async () => {
    const snapshot = async () => ({
      branches: await rows(`select tenant_id, name, country, currency, active, is_default from branches order by tenant_id, name`),
      employees: await rows(`select "Employee Number", "Branch", branch_id from employees order by 1`),
      holidays: Number(await val(`select count(*) from holidays`)),
    });
    const before = await snapshot();
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    await db.exec('reset search_path');
    expect(await snapshot()).toEqual(before);
  });
});
