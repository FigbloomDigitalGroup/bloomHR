// @vitest-environment node
//
// Job groups with pay amounts (20261015700000): each company's groups and their dated rates; an employee on a group
// is paid its current rate unless HR overrides it with a reason; only ADMIN, Payroll and Employees see the amounts.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000f911';
const PAY = '00000000-0000-0000-0000-00000000f912';
const STAFF = '00000000-0000-0000-0000-00000000f913';
const LIFECYCLE = '00000000-0000-0000-0000-00000000f914';
const ADMIN_B = '00000000-0000-0000-0000-00000000f915';

type Pay = { job_group_id: string | null; jg: string | null; basic: string | null; house: string | null; travel: string | null; other: string | null };

let db: PGlite;
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
const payOf = async (number: string) =>
  (await rows<Pay>(`select job_group_id, "Job Group" jg, "Basic Salary"::float8::text basic, house_allowance::float8::text house,
    travel_allowance::float8::text travel, other_cash_allowances::float8::text other from employees where "Employee Number" = $1`, [number]))[0];
const group = async (user: string, code: string, name = code) =>
  (await as<{ id: string }>(user, `insert into job_groups (code, name) values ($1, $2) returning id`, [code, name]))[0].id;
// a rate starting `days` from today (negative: in the past)
const rate = (user: string, groupId: string, days: number, basic: number | null, house = 0, travel = 0, other = 0, band?: [number, number]) =>
  as(user, `insert into job_group_rates (job_group_id, effective_from, basic_salary, basic_min, basic_max, house_allowance, travel_allowance, other_allowances)
    values ($1, current_date + $2::integer, $3, $4, $5, $6, $7, $8)`, [groupId, days, basic, band?.[0] ?? null, band?.[1] ?? null, house, travel, other]);
const addEmployee = (user: string, number: string, fields: Record<string, unknown> = {}) => {
  const all = { 'Employee Number': number, 'First Name': 'X', 'Work Email': `${number.toLowerCase()}@a.co`, ...fields };
  const cols = Object.keys(all).map((k) => `"${k}"`).join(', ');
  return as(user, `insert into employees (${cols}) values (${Object.keys(all).map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(all));
};

beforeAll(async () => {
  db = await bootDb({
    file: '20261015700000_job_groups.sql',
    seed: async (d) => {
      // employees from before job groups: free-text groups, in two spellings, and one with none
      await d.exec(`
        insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
        insert into employees ("Employee Number", "First Name", "Job Group", "Basic Salary", tenant_id) values
          ('OLD-1', 'Old', 'JG 5', 40000, '${A}'), ('OLD-2', 'Old', ' jg 5 ', 41000, '${A}'),
          ('OLD-3', 'Old', 'Clerical', 30000, '${A}'), ('OLD-4', 'Old', '', 20000, '${A}'),
          ('OLD-B', 'Old', 'JG 5', 50000, '${B}');
      `);
    },
  });
  await db.exec(`delete from public.role_permissions where tenant_id = '${A}'`);
  for (const [id, email, role, tenant] of [
    [HR, 'hr@a.co', 'HR', A], [PAY, 'pay@a.co', 'FINANCE', A], [STAFF, 'staff@a.co', 'STAFF', A],
    [LIFECYCLE, 'life@a.co', 'LIFE', A], [ADMIN_B, 'admin@b.co', 'ADMIN', B],
  ]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${tenant}');
    `);
  }
  await db.exec(`insert into role_permissions (role_name, permissions, tenant_id) values
    ('HR', array['employees'], '${A}'), ('FINANCE', array['payroll'], '${A}'), ('STAFF', array['dashboard'], '${A}'),
    ('LIFE', array['hr-lifecycle'], '${A}')`);
  await db.exec(`insert into employees ("Employee Number", "First Name", "Work Email", tenant_id) values ('STAFF-1', 'Sam', 'staff@a.co', '${A}')`);
}, 120000);

describe('existing job groups', () => {
  it('are made from each company’s distinct "Job Group" texts, without amounts, and employees linked', async () => {
    const groups = await rows<{ tenant_id: string; code: string }>(`select tenant_id, code from job_groups order by tenant_id, code`);
    expect(groups).toEqual([{ tenant_id: A, code: 'Clerical' }, { tenant_id: A, code: 'JG 5' }, { tenant_id: B, code: 'JG 5' }]);
    expect(await rows(`select 1 from job_group_rates`)).toHaveLength(0);
    const [old1, old2, old3, old4, oldB] = await Promise.all(['OLD-1', 'OLD-2', 'OLD-3', 'OLD-4', 'OLD-B'].map(payOf));
    expect(old1.job_group_id).not.toBeNull();
    expect(old2.job_group_id).toBe(old1.job_group_id);
    expect(old3.job_group_id).not.toBe(old1.job_group_id);
    expect(old4.job_group_id).toBeNull();
    expect(oldB.job_group_id).not.toBe(old1.job_group_id);
    // no amounts yet: the salaries stay as they were
    expect([old1.basic, old2.basic]).toEqual(['40000', '41000']);
  });
});

describe('rates by date', () => {
  it('the current rate is the latest one from on or before today', async () => {
    const g = await group(HR, 'G1', 'Grade 1');
    await rate(PAY, g, -60, 50000, 10000, 5000, 1000);
    await rate(PAY, g, -10, 55000, 11000, 5000, 1000);
    await rate(PAY, g, 30, 60000, 12000, 6000, 1000);
    const [row] = await as<{ effective_from: string; basic_salary: string; next_effective_from: string; employee_count: number }>(
      HR, `select effective_from::text, basic_salary::text, next_effective_from::text, employee_count from job_groups_overview() where code = 'G1'`);
    const today = (await rows<{ d: string }>(`select current_date::text d`))[0].d;
    expect(row.basic_salary).toBe('55000.00');
    expect(row.effective_from < today && row.next_effective_from > today).toBe(true);
    expect(row.employee_count).toBe(0);
  });

  it('a code is unique in the company, ignoring case', async () => {
    expect(await fails(group(HR, ' g1 '))).toMatch(/duplicate|unique/);
    expect(await group(ADMIN_B, 'G1')).toBeTruthy();
  });

  it('a rate is fixed or a band, never both or neither', async () => {
    const g = (await rows<{ id: string }>(`select id from job_groups where code = 'G1' and tenant_id = $1`, [A]))[0].id;
    expect(await fails(rate(HR, g, -5, null))).toMatch(/check/);
    expect(await fails(rate(HR, g, -5, 100, 0, 0, 0, [1, 2]))).toMatch(/check/);
    expect(await fails(rate(HR, g, -5, null, 0, 0, 0, [5, 1]))).toMatch(/check/);
  });

  it('no rate can start in a month whose payroll is approved', async () => {
    const g = (await rows<{ id: string }>(`select id from job_groups where code = 'G1' and tenant_id = $1`, [A]))[0].id;
    await db.exec(`insert into payroll_runs (tenant_id, pay_period, status) values ('${A}', '2020-01', 'approved')`);
    expect(await fails(as(HR, `insert into job_group_rates (job_group_id, effective_from, basic_salary) values ($1, '2020-01-15', 1)`, [g])))
      .toMatch(/approved/);
  });
});

describe('employees on a group', () => {
  it('choosing a group fills the basic salary and allowances from its current rate, and "Job Group" with its code', async () => {
    const g = (await rows<{ id: string }>(`select id from job_groups where code = 'G1' and tenant_id = $1`, [A]))[0].id;
    await addEmployee(HR, 'E-1', { job_group_id: g, 'Basic Salary': 1 });
    expect(await payOf('E-1')).toEqual({ job_group_id: g, jg: 'G1', basic: '55000', house: '11000', travel: '5000', other: '1000' });
  });

  it('typing a group’s code or name (older forms, bulk upload) picks the group', async () => {
    await addEmployee(PAY, 'E-2', { 'Job Group': 'grade 1' });
    expect(await payOf('E-2')).toMatchObject({ jg: 'G1', basic: '55000' });
    await addEmployee(PAY, 'E-3', { 'Job Group': 'Not a group' });
    expect(await payOf('E-3')).toMatchObject({ job_group_id: null, jg: 'Not a group' });
  });

  it('pay set by hand needs a reason and is kept', async () => {
    expect(await fails(as(HR, `update employees set pay_overridden = true, "Basic Salary" = 70000 where "Employee Number" = 'E-2'`)))
      .toMatch(/reason/);
    await as(HR, `update employees set pay_overridden = true, pay_override_reason = 'Specialist', "Basic Salary" = 70000 where "Employee Number" = 'E-2'`);
    expect((await payOf('E-2')).basic).toBe('70000');
  });

  it('a pay that is not overridden follows the group: a hand edit is put back', async () => {
    await as(HR, `update employees set "Basic Salary" = 1 where "Employee Number" = 'E-1'`);
    expect((await payOf('E-1')).basic).toBe('55000');
  });

  it('a new rate in force reaches the employees on the group who are not overridden, and only them', async () => {
    const g = (await rows<{ id: string }>(`select id from job_groups where code = 'G1' and tenant_id = $1`, [A]))[0].id;
    await rate(PAY, g, 0, 58000, 11500, 5000, 1000);
    expect(await payOf('E-1')).toMatchObject({ basic: '58000', house: '11500' });
    expect((await payOf('E-2')).basic).toBe('70000');
    // a rate starting later changes nothing yet
    expect(await as<{ n: number }>(HR, `select apply_job_group_rate($1, current_date + 30) n`, [g])).toEqual([{ n: 0 }]);
    expect((await payOf('E-1')).basic).toBe('58000');
  });

  it('turning the override off brings back the group’s pay', async () => {
    await as(HR, `update employees set pay_overridden = false where "Employee Number" = 'E-2'`);
    expect(await payOf('E-2')).toMatchObject({ basic: '58000' });
    expect((await rows(`select pay_override_reason r from employees where "Employee Number" = 'E-2'`))[0]).toEqual({ r: null });
  });

  it('a band keeps the employee’s salary, moved into the band', async () => {
    const g = await group(HR, 'BAND');
    await rate(HR, g, -1, null, 2000, 0, 0, [30000, 40000]);
    await addEmployee(HR, 'E-4', { job_group_id: g, 'Basic Salary': 35000 });
    await addEmployee(HR, 'E-5', { job_group_id: g, 'Basic Salary': 90000 });
    await addEmployee(HR, 'E-6', { job_group_id: g });
    expect([(await payOf('E-4')).basic, (await payOf('E-5')).basic, (await payOf('E-6')).basic]).toEqual(['35000', '40000', '30000']);
  });

  it('a new code reaches the employees’ "Job Group"; taking the group away clears it', async () => {
    await as(HR, `update job_groups set code = 'G-1' where code = 'G1' and tenant_id = $1`, [A]);
    expect((await payOf('E-1')).jg).toBe('G-1');
    await as(HR, `update employees set job_group_id = null where "Employee Number" = 'E-1'`);
    expect(await payOf('E-1')).toMatchObject({ job_group_id: null, jg: null, basic: '58000' });
  });

  it('the overview counts the employees on each group', async () => {
    const r = await as<{ code: string; employee_count: number }>(HR, `select code, employee_count from job_groups_overview() where code in ('G-1', 'BAND') order by code`);
    expect(r).toEqual([{ code: 'BAND', employee_count: 3 }, { code: 'G-1', employee_count: 1 }]);
  });
});

describe('who may see and change them', () => {
  it('staff see no groups, rates or overview', async () => {
    expect(await as(STAFF, `select * from job_groups`)).toHaveLength(0);
    expect(await as(STAFF, `select * from job_group_rates`)).toHaveLength(0);
    expect(await fails(as(STAFF, `select * from job_groups_overview()`))).toMatch(/may not/);
    expect(await fails(as(STAFF, `select job_group_rate_on(id) from job_groups`))).toMatch(/permission denied/);
    expect(await fails(as(STAFF, `select apply_due_job_group_rates()`))).toMatch(/permission denied/);
  });

  it('staff can’t add groups or rates, nor put themselves on a group or override their pay', async () => {
    expect(await fails(as(STAFF, `insert into job_groups (code, name) values ('X', 'X')`))).toMatch(/row-level security/);
    const g = (await rows<{ id: string }>(`select id from job_groups where code = 'G-1'`))[0].id;
    expect(await fails(as(STAFF, `update employees set job_group_id = $1 where "Employee Number" = 'STAFF-1'`, [g]))).toMatch(/Only HR or payroll|own personal details/);
    expect(await fails(as(STAFF, `update employees set pay_overridden = true, pay_override_reason = 'x' where "Employee Number" = 'STAFF-1'`)))
      .toMatch(/Only HR or payroll|own personal details/);
    expect(await fails(as(STAFF, `select apply_job_group_rate($1)`, [g]))).toMatch(/may not/);
  });

  it('other modules that edit employees (HR lifecycle) don’t see amounts or change groups', async () => {
    expect(await as(LIFECYCLE, `select * from job_group_rates`)).toHaveLength(0);
    const g = (await rows<{ id: string }>(`select id from job_groups where code = 'G-1'`))[0].id;
    expect(await fails(as(LIFECYCLE, `update employees set job_group_id = $1 where "Employee Number" = 'E-3'`, [g]))).toMatch(/Only HR or payroll/);
  });

  it('each company sees only its own groups and can’t use another’s', async () => {
    expect((await as<{ code: string }>(ADMIN_B, `select code from job_groups order by code`)).map((r) => r.code)).toEqual(['G1', 'JG 5']);
    expect((await as<{ code: string }>(HR, `select code from job_groups_overview() order by code`)).map((r) => r.code))
      .toEqual(['BAND', 'Clerical', 'G-1', 'JG 5']);
    const gB = (await rows<{ id: string }>(`select id from job_groups where tenant_id = $1 and code = 'G1'`, [B]))[0].id;
    expect(await fails(as(HR, `update employees set job_group_id = $1 where "Employee Number" = 'E-3'`, [gB]))).toMatch(/foreign key/);
    expect(await fails(as(HR, `insert into job_group_rates (job_group_id, effective_from, basic_salary) values ($1, current_date, 1)`, [gB])))
      .toMatch(/foreign key|row-level security/);
    expect(await fails(as(HR, `select apply_job_group_rate($1)`, [gB]))).toMatch(/may not/);
  });
});
