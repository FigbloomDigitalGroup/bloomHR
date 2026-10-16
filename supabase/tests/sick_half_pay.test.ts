// @vitest-environment node
//
// Full-pay then half-pay days (FIG-879): sick leave of 30 days at full pay, then 15 at half pay. Days come off full pay
// first; each approved application records how many of its days are at half pay (payroll deducts them, FIG-880).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const HR = '00000000-0000-0000-0000-00000000f201';
const STAFF = '00000000-0000-0000-0000-00000000f202';

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
const check = async (start: string, end: string) =>
  (await asUser(db, STAFF, () => rows<{ c: { days: number; available: number; half_pay_days: number; full_pay_left: number; half_pay_left: number; problems: string[] } }>(
    `select leave_request_check('ME', 'Sick Leave', '${start}', '${end}') c`)))[0].c;
// HR records sick leave already approved (the balance is taken as it is saved)
const record = (start: string, end: string) => asUser(db, HR, () => run(
  `insert into leave_application ("Employee Number", name, "Leave Type", "Start Date", "End Date", status)
   values ('ME', 'Mia Me', 'Sick Leave', '${start}', '${end}', 'approved')`));
const last = async () =>
  (await rows<{ id: string; days: string; half_pay_days: string }>(
    `select id, days, half_pay_days from leave_application where "Employee Number" = 'ME' order by time_added desc limit 1`))[0];

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co'), ('${STAFF}', 'me@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${STAFF}', 'me@a.co', 'STAFF', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values ('HR', array['leaves', 'employees'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", tenant_id) values ('ME', 'Mia', 'Me', 'me@a.co', '${A}');
    select seed_default_leave_types('${A}');
    update leave_policies set days_allotted = 30, half_pay_days = 15, document_name = null
      where leave_type_id = (select id from leave_types where tenant_id = '${A}' and name = 'Sick Leave');
  `);
}, 120000);

describe('full pay, then half pay', () => {
  it('starts with 30 at full pay and 15 at half pay', async () => {
    const c = await check('2030-03-04', '2030-03-04');
    expect(c).toMatchObject({ days: 1, available: 45, full_pay_left: 30, half_pay_left: 15, half_pay_days: 0 });
  });

  it('days come off full pay first', async () => {
    expect(await record('2030-03-04', '2030-04-05')).toBe(''); // 25 working days
    expect(Number((await last()).half_pay_days)).toBe(0);
  });

  it('an application that goes past the full-pay days is part half pay, and says so first', async () => {
    const c = await check('2030-04-08', '2030-04-19'); // 10 days, 5 of full pay left
    expect(c).toMatchObject({ days: 10, half_pay_days: 5, full_pay_left: 5, half_pay_left: 15 });
    expect(await record('2030-04-08', '2030-04-19')).toBe('');
    expect(Number((await last()).half_pay_days)).toBe(5);
    const adj = (await rows<{ reason: string }>(`select reason from leave_balance_adjustments order by created_at desc, id desc limit 1`))[0];
    expect(adj.reason).toBe('Leave application approved (5 at half pay)');
  });

  it('once both are used, sick leave is refused with a pointer to annual leave', async () => {
    const c = await check('2030-05-06', '2030-05-20'); // 11 days, 10 left (all half pay)
    expect(c.problems[0]).toMatch(/Not enough Sick Leave left: 10 days free to book, and this needs 11/);
    expect(await record('2030-05-06', '2030-05-20')).toMatch(/full-pay and half-pay days are used: they can apply for annual leave instead/);
    expect(await record('2030-05-06', '2030-05-17')).toBe(''); // exactly the 10 left
    expect(Number((await last()).half_pay_days)).toBe(10);
  });

  it('rejecting approved leave gives the days back and clears its half-pay days', async () => {
    const l = await last();
    await asUser(db, HR, () => db.query(`update leave_application set status = 'rejected' where id = '${l.id}'`));
    expect(Number((await rows<{ half_pay_days: string }>(`select half_pay_days from leave_application where id = '${l.id}'`))[0].half_pay_days)).toBe(0);
    expect((await check('2030-06-03', '2030-06-03')).half_pay_left).toBe(10);
  });

  it('leave types without half-pay days are as before', async () => {
    const c = (await asUser(db, STAFF, () => rows<{ c: { half_pay_days: number; full_pay_left: number | null } }>(
      `select leave_request_check('ME', 'Annual Leave', '2030-03-04', '2030-03-05') c`)))[0].c;
    expect(c).toMatchObject({ half_pay_days: 0, full_pay_left: null });
  });
});
