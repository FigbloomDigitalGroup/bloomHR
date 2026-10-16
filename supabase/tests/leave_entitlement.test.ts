// @vitest-environment node
//
// Leave counted from when someone joined, annual leave usable only after some months of service, and the Kenyan
// defaults new companies start with (FIG-878).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const HR = '00000000-0000-0000-0000-00000000fc01';
const NEWBIE = '00000000-0000-0000-0000-00000000fc02';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const one = async <T = Record<string, unknown>>(sql: string) => (await rows<T>(sql))[0];
const run = async (sql: string) => {
  try {
    await db.query(sql);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const typeId = async (name: string, tenant = A) => (await one<{ id: string }>(`select id from leave_types where tenant_id = '${tenant}' and name = '${name}'`)).id;
const accrued = async (emp: string, type: string, year: number) =>
  Number((await one<{ accrued_days: string }>(
    `select accrued_days from leave_balances where employee_number = '${emp}' and leave_type_id = '${await typeId(type)}' and year = ${year} and month = 0`))?.accrued_days ?? NaN);
const apply = (user: string, employee: string, type: string, start: string, end: string) =>
  asUser(db, user, () => run(
    `insert into leave_application ("Employee Number", name, "Leave Type", "Start Date", "End Date", status)
     values ('${employee}', '${employee}', '${type}', '${start}', '${end}', 'pending')`));

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co'), ('${NEWBIE}', 'new@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${NEWBIE}', 'new@a.co', 'STAFF', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values ('HR', array['leaves', 'employees'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Start Date", "Contract Start Date", tenant_id) values
      ('OLD', 'Olga', 'Old', 'old@a.co', '2019-03-01', null, '${A}'),
      ('OCT', 'Otto', 'October', 'oct@a.co', '2026-10-05', null, '${A}'),
      ('RENEWED', 'Rita', 'Renewed', 'ren@a.co', '2020-02-01', '2026-09-01', '${A}'),
      ('CONTRACT', 'Carl', 'Contract', 'con@a.co', null, '2026-07-20', '${A}'),
      ('ODD', 'Odd', 'Date', 'odd@a.co', '5th Oct 2026', null, '${A}'),
      ('NEW', 'Nia', 'New', 'new@a.co', '2030-01-15', null, '${A}');
    select seed_default_leave_types('${A}');
  `);
}, 120000);

describe('when someone joined', () => {
  it('is the start date, else the contract start date; a renewed contract does not restart it; odd text is unknown', async () => {
    const joined = async (emp: string) => (await one<{ d: string | null }>(`select employee_joined('${A}', '${emp}')::text d`)).d;
    expect(await joined('OCT')).toBe('2026-10-05');
    expect(await joined('RENEWED')).toBe('2020-02-01');
    expect(await joined('CONTRACT')).toBe('2026-07-20');
    expect(await joined('ODD')).toBeNull();
  });

  it('counts the months of a year they were here, the month they joined in full', async () => {
    const months = async (joined: string | null, year: number, upto: number) =>
      (await one<{ m: number }>(`select leave_service_months(${joined ? `'${joined}'::date` : 'null'}, ${year}, ${upto}) m`)).m;
    expect(await months('2019-03-01', 2026, 10)).toBe(10);
    expect(await months(null, 2026, 10)).toBe(10);
    expect(await months('2026-10-05', 2026, 12)).toBe(3);
    expect(await months('2026-10-05', 2026, 9)).toBe(0);
    expect(await months('2027-01-10', 2026, 12)).toBe(0);
  });
});

describe('leave counted from when they joined', () => {
  it('leave earned monthly builds up from the month they joined', async () => {
    await db.exec(`select run_leave_accrual(2026, 12)`);
    expect(await accrued('OLD', 'Annual Leave', 2026)).toBe(21);
    expect(await accrued('OCT', 'Annual Leave', 2026)).toBe(5.25); // Oct, Nov, Dec: 3 x 1.75
    expect(await accrued('RENEWED', 'Annual Leave', 2026)).toBe(21);
    expect(await accrued('CONTRACT', 'Annual Leave', 2026)).toBe(10.5); // July to December
    expect(await accrued('ODD', 'Annual Leave', 2026)).toBe(21); // unknown: the whole year, as before
  });

  it('a whole allowance given at once is cut to the part of the first year they are here', async () => {
    await db.exec(`select run_annual_leave_reset(2026)`);
    expect(await accrued('OLD', 'Sick Leave', 2026)).toBe(14);
    expect(await accrued('CONTRACT', 'Sick Leave', 2026)).toBe(7); // 6 of 12 months
    expect(await accrued('OCT', 'Sick Leave', 2026)).toBe(3.5);
  });

  it('a per-employee allowance follows the same rule', async () => {
    // Otto joined in October: 28 days of sick leave a year is 7 for his first year
    const sick = await typeId('Sick Leave');
    await asUser(db, HR, () => db.query(`select set_leave_entitlement('OCT', '${sick}', 28, 2026)`));
    expect(await accrued('OCT', 'Sick Leave', 2026)).toBe(7);
  });
});

describe('annual leave only after two months of service', () => {
  it('new companies have it on Annual Leave only', async () => {
    const p = await rows<{ name: string; service_months_before_use: number }>(
      `select t.name, p.service_months_before_use from current_leave_policies p join leave_types t on t.id = p.leave_type_id
       where t.tenant_id = '${A}' and p.service_months_before_use > 0`);
    expect(p).toEqual([{ name: 'Annual Leave', service_months_before_use: 2 }]);
  });

  it('an employee can apply for annual leave from two months after joining; sick leave straight away', async () => {
    // Nia joins on 15 Jan 2030
    expect(await apply(NEWBIE, 'NEW', 'Annual Leave', '2030-02-04', '2030-02-05'))
      .toMatch(/Annual Leave can be taken from 15 Mar 2030, 2 months after joining \(15 Jan 2030\)/);
    expect(await apply(NEWBIE, 'NEW', 'Annual Leave', '2030-03-18', '2030-03-19')).toBe('');
    expect(await apply(NEWBIE, 'NEW', 'Sick Leave', '2030-01-21', '2030-01-22')).toBe('');
  });

  it('HR entering leave for them may go ahead', async () => {
    expect(await apply(HR, 'NEW', 'Annual Leave', '2030-02-11', '2030-02-12')).toBe('');
  });
});

describe('Kenyan defaults for new companies', () => {
  it('21 days annual, maternity and paternity in calendar days, adoption leave, compassionate per bereavement', async () => {
    const p = await rows<{ name: string; days_allotted: string | null; accrual_method: string; count_days: string; max_days_per_request: string | null; min_notice_days: number; is_deductible: boolean }>(
      `select t.name, p.days_allotted, p.accrual_method, p.count_days, p.max_days_per_request, p.min_notice_days, t.is_deductible
       from current_leave_policies p join leave_types t on t.id = p.leave_type_id where t.tenant_id = '${A}'`);
    const by = Object.fromEntries(p.map((r) => [r.name, r]));
    expect(Number(by['Annual Leave'].days_allotted)).toBe(21);
    expect(by['Maternity Leave']).toMatchObject({ count_days: 'calendar', min_notice_days: 7, is_deductible: false });
    expect(Number(by['Maternity Leave'].days_allotted)).toBe(90);
    expect(by['Paternity Leave'].count_days).toBe('calendar');
    expect(by['Adoption Leave']).toMatchObject({ count_days: 'calendar', is_deductible: false });
    expect(Number(by['Adoption Leave'].days_allotted)).toBe(30);
    expect(by['Compassionate Leave (immediate family)']).toMatchObject({ accrual_method: 'none', days_allotted: null });
    expect(Number(by['Compassionate Leave (immediate family)'].max_days_per_request)).toBe(10);
    expect(Number(by['Compassionate Leave (extended family)'].max_days_per_request)).toBe(3);
  });

  it('compassionate leave is per bereavement: up to 10 days each time, no yearly limit', async () => {
    const type = 'Compassionate Leave (immediate family)';
    expect(await apply(NEWBIE, 'NEW', type, '2030-04-01', '2030-04-12')).toBe(''); // 10 working days
    expect(await apply(NEWBIE, 'NEW', type, '2030-06-03', '2030-06-14')).toBe(''); // another 10
    expect(await apply(NEWBIE, 'NEW', type, '2030-09-02', '2030-09-16')).toMatch(/at most 10 days in one application/);
  });
});
