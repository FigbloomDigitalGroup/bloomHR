// @vitest-environment node
//
// Each company's work week, and a department's own (FIG-888): leave counts only the days the employee works (a
// half-worked day counts half), less the company's holidays; a half-day application counts half a day.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const HR = '00000000-0000-0000-0000-00000000fd01';
const STAFF = '00000000-0000-0000-0000-00000000fd02';
const FARM = '00000000-0000-0000-0000-00000000fd10';
const PACKHOUSE = '00000000-0000-0000-0000-00000000fd11';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const run = async (sql: string) => {
  try {
    await db.query(sql);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
// Mon 4 to Sun 10 March 2030
const week = async (emp: string, start = '2030-03-04', end = '2030-03-10', half = false) =>
  Number((await rows<{ n: string }>(`select leave_days_for('${A}', '${emp}', '${start}', '${end}', false, ${half}) n`))[0].n);
const setCompany = (days: string) =>
  db.exec(`insert into company_work_week (tenant_id, days) values ('${A}', '{${days}}')
           on conflict (tenant_id) do update set days = excluded.days`);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co'), ('${STAFF}', 'office@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${STAFF}', 'office@a.co', 'STAFF', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values ('HR', array['leaves', 'employees'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into departments (id, tenant_id, name) values ('${FARM}', '${A}', 'Farm');
    insert into departments (id, tenant_id, name, parent_id) values ('${PACKHOUSE}', '${A}', 'Packhouse', '${FARM}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", department_id, tenant_id) values
      ('OFFICE', 'Olive', 'Office', 'office@a.co', null, '${A}'),
      ('FARMER', 'Fred', 'Farm', 'farm@a.co', '${FARM}', '${A}'),
      ('PACKER', 'Pam', 'Pack', 'pack@a.co', '${PACKHOUSE}', '${A}');
    select seed_default_leave_types('${A}');
    -- documents with leave are tested in leave_documents.test.ts
    update leave_policies set document_name = null, followup_document_name = null;
  `);
}, 120000);

describe('the company work week', () => {
  it('is Monday to Friday until the company sets one', async () => {
    expect(await week('OFFICE')).toBe(5);
  });

  it('a six-day week counts Saturday, a half-day Saturday counts half, a four-day week skips the days off', async () => {
    await setCompany('1,1,1,1,1,1,0');
    expect(await week('OFFICE')).toBe(6);
    await setCompany('1,1,1,1,1,0.5,0');
    expect(await week('OFFICE')).toBe(5.5);
    await setCompany('1,1,1,1,0,0,0');
    expect(await week('OFFICE')).toBe(4);
    await setCompany('1,1,1,1,1,0,0');
  });

  it('public holidays are still left out', async () => {
    await db.exec(`insert into holidays (name, date, recurring, tenant_id) values ('One-off', '2030-03-06', false, '${A}')`);
    expect(await week('OFFICE')).toBe(4);
    await db.exec(`delete from holidays where name = 'One-off'`);
  });

  it('refuses a week that is not seven days of 0, 0.5 or 1, or has no working day', async () => {
    expect(await run(`update company_work_week set days = '{1,1,1,1,1,1}'`)).toMatch(/check/);
    expect(await run(`update company_work_week set days = '{1,1,1,1,0.3,0,0}'`)).toMatch(/check/);
    expect(await run(`update company_work_week set days = '{0,0,0,0,0,0,0}'`)).toMatch(/check/);
  });

  it('HR (leaves) or settings change it; staff only read it', async () => {
    await asUser(db, STAFF, async () => {
      expect(await rows(`select days from company_work_week`)).toHaveLength(1);
      expect(await rows(`update company_work_week set days = '{1,1,1,1,1,1,1}' returning 1`)).toHaveLength(0);
    });
    await asUser(db, HR, async () => {
      expect(await rows(`update company_work_week set days = '{1,1,1,1,1,0,0}' returning 1`)).toHaveLength(1);
    });
  });
});

describe('a department of its own', () => {
  it('the farm works Saturdays, the office does not; a sub-department follows the one above it', async () => {
    await db.exec(`update departments set work_week = '{1,1,1,1,1,1,0}' where id = '${FARM}'`);
    expect(await week('OFFICE')).toBe(5);
    expect(await week('FARMER')).toBe(6);
    expect(await week('PACKER')).toBe(6);
    await db.exec(`update departments set work_week = '{1,1,1,1,1,0.5,0}' where id = '${PACKHOUSE}'`);
    expect(await week('PACKER')).toBe(5.5);
  });
});

describe('half days', () => {
  it('a half-day application counts half of that day, and comes off the balance as such', async () => {
    expect(await week('OFFICE', '2030-03-04', '2030-03-04', true)).toBe(0.5);
    expect(await asUser(db, STAFF, () => run(
      `insert into leave_application ("Employee Number", name, "Leave Type", "Start Date", "End Date", type, status)
       values ('OFFICE', 'Olive Office', 'Sick Leave', '2030-03-05', '2030-03-05', 'Half Day', 'pending')`))).toBe('');
    const leave = (await rows<{ id: string; days: string }>(`select id, days from leave_application where "Employee Number" = 'OFFICE'`))[0];
    expect(Number(leave.days)).toBe(0.5);
    expect((await rows<{ t: string }>(`select approval_leave_text(l) t from leave_application l where id = '${leave.id}'`))[0].t)
      .toBe('Sick Leave application (0.5 days, 2030-03-05 to 2030-03-05)');
    const r = (await rows<{ id: string }>(`select id from approval_requests where record_id = '${leave.id}'`))[0];
    expect(await asUser(db, HR, () => run(`select decide_approval('${r.id}', 'approved', '')`))).toBe('');
    const used = (await rows<{ used_days: string }>(
      `select used_days from leave_balances where employee_number = 'OFFICE' and year = 2030 and month = 0`))[0];
    expect(Number(used.used_days)).toBe(0.5);
  });

  it('a half day is one day', async () => {
    expect(await asUser(db, STAFF, () => run(
      `insert into leave_application ("Employee Number", name, "Leave Type", "Start Date", "End Date", type, status)
       values ('OFFICE', 'Olive Office', 'Sick Leave', '2030-03-11', '2030-03-12', 'Half Day', 'pending')`))).toMatch(/A half day is one day/);
  });

  it('the forms get the same answer', async () => {
    const c = (await asUser(db, STAFF, () =>
      rows<{ c: { days: number } }>(`select leave_request_check('OFFICE', 'Sick Leave', '2030-03-18', '2030-03-18', true) c`)))[0].c;
    expect(c.days).toBe(0.5);
  });
});
