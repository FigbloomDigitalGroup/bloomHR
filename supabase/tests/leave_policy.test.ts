// @vitest-environment node
//
// Company-set leave rules: a yearly allowance earned month by month (24 days = 2 a month), unused days lost at the new
// year (apart from a carry-forward cap), a different allowance for one employee, and year-end "please take leave"
// reminders. All of it is a setting on the leave type or the employee, not wired to one company's policy.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000ab01';
const STAFF = '00000000-0000-0000-0000-00000000ab02';
const FOUNDER = '00000000-0000-0000-0000-00000000ab03';

let db: PGlite;
let annual: string; // Annual Leave type id in company A
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const balance = async (emp: string, year: number) =>
  (await rows<{ accrued_days: string; carried_over_days: string; used_days: string; remaining_days: string }>(
    `select accrued_days, carried_over_days, used_days, remaining_days from leave_balances where employee_number = '${emp}' and leave_type_id = '${annual}' and year = ${year} and month = 0`
  ))[0];
const setPolicy = (carry: number, remindDays = 0, remindMin = 0) =>
  db.exec(`update leave_policies set carry_forward_max_days = ${carry}, reminder_days_before_year_end = ${remindDays}, reminder_min_remaining = ${remindMin} where leave_type_id = '${annual}'`);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co'), ('${STAFF}', 'staff@a.co'), ('${FOUNDER}', 'founder@new.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${STAFF}', 'staff@a.co', 'STAFF', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['leaves', 'employees'], '${A}'), ('STAFF', array['dashboard'], '${A}'), ('ADMIN', array['leaves'], '00000000-0000-0000-0000-000000000001');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", tenant_id) values
      ('E1', 'Ann', 'One', 'e1@a.co', '${A}'), ('E2', 'Ben', 'Two', 'e2@a.co', '${A}'), ('X1', 'Xena', 'Other', 'x1@b.co', '${B}');
    select seed_default_leave_types('${A}');
    select seed_default_leave_types('${B}');
  `);
  annual = (await rows<{ id: string }>(`select id from leave_types where tenant_id = '${A}' and name = 'Annual Leave'`))[0].id;
}, 120000);

describe('standard leave types', () => {
  it('a company gets the standard set once, with Annual Leave earned monthly and reminders on', async () => {
    const types = await rows<{ name: string }>(`select name from leave_types where tenant_id = '${A}' order by name`);
    expect(types.map((t) => t.name)).toContain('Annual Leave');
    const policy = (await rows<{ days_allotted: string; accrual_method: string; carry_forward_max_days: string; reminder_days_before_year_end: number; reminder_min_remaining: string }>(
      `select * from current_leave_policies where leave_type_id = '${annual}'`
    ))[0];
    expect(policy).toMatchObject({ accrual_method: 'monthly_cumulative', reminder_days_before_year_end: 60 });
    expect(Number(policy.days_allotted)).toBe(24);
    expect(Number(policy.carry_forward_max_days)).toBe(0);
    expect(Number(policy.reminder_min_remaining)).toBe(14);
    await db.exec(`select seed_default_leave_types('${A}')`);
    expect(await rows(`select 1 from leave_types where tenant_id = '${A}' and name = 'Annual Leave'`)).toHaveLength(1);
  });

  it('every company has its own, and creating a company seeds them', async () => {
    expect(await rows(`select 1 from leave_types where tenant_id = '${B}'`)).not.toHaveLength(0);
    await asUser(db, FOUNDER, async () => {
      await db.query(`select create_company('Fresh Farm')`);
    });
    const fresh = await rows<{ name: string }>(
      `select lt.name from leave_types lt join tenants t on t.id = lt.tenant_id where t.name = 'Fresh Farm' order by lt.name`
    );
    expect(fresh.map((r) => r.name)).toContain('Annual Leave');
    expect(fresh.map((r) => r.name)).toContain('Sick Leave');
  });
});

describe('earning a yearly allowance month by month', () => {
  it('24 days earns 2 a month, and running it again changes nothing', async () => {
    await db.exec(`select run_leave_accrual(2026, 3)`);
    expect(Number((await balance('E1', 2026)).accrued_days)).toBe(6);
    await db.exec(`select run_leave_accrual(2026, 3)`);
    expect(Number((await balance('E1', 2026)).accrued_days)).toBe(6);
    await db.exec(`select run_leave_accrual(2026, 6)`);
    expect(Number((await balance('E1', 2026)).accrued_days)).toBe(12);
  });

  it('never lowers what has been earned, and only counts the company\'s own employees', async () => {
    await db.exec(`select run_leave_accrual(2026, 2)`);
    expect(Number((await balance('E1', 2026)).accrued_days)).toBe(12);
    expect(await rows(`select 1 from leave_balances where employee_number = 'X1' and leave_type_id = '${annual}'`)).toHaveLength(0);
  });

  it('days taken come off, and unused days simply stay available through the year', async () => {
    await asUser(db, HR, async () => {
      await db.query(`select increment_leave_balance_used_days('E1', '${annual}', 2026, 5, 0)`);
    });
    const b = await balance('E1', 2026);
    expect(Number(b.used_days)).toBe(5);
    expect(Number(b.remaining_days)).toBe(7);
    await db.exec(`select run_leave_accrual(2026, 12)`);
    expect(Number((await balance('E1', 2026)).accrued_days)).toBe(24);
    expect(Number((await balance('E1', 2026)).remaining_days)).toBe(19);
  });
});

describe('the new year', () => {
  it('with no carry-forward the unused days are lost', async () => {
    await setPolicy(0);
    await db.exec(`select run_leave_accrual(2027, 1)`);
    const b = await balance('E1', 2027);
    expect(Number(b.carried_over_days)).toBe(0);
    expect(Number(b.accrued_days)).toBe(2);
    expect(Number(b.remaining_days)).toBe(2);
  });

  it('a carry-forward cap keeps only that many days', async () => {
    await setPolicy(5);
    await db.exec(`delete from leave_balances where year = 2027`);
    await db.exec(`select run_leave_accrual(2027, 1)`);
    const b = await balance('E1', 2027);
    expect(Number(b.carried_over_days)).toBe(5); // 19 left over, capped at 5
    expect(Number(b.remaining_days)).toBe(7);
  });
});

describe('a different allowance for one employee', () => {
  it('HR sets it, the balance follows, and later months use it', async () => {
    await setPolicy(0);
    await asUser(db, HR, async () => {
      await db.query(`select set_leave_entitlement('E2', '${annual}', 36, 2026)`);
    });
    const monthsSoFar = new Date().getMonth() + 1; // this year's balance is what has been earned so far
    expect(Number((await balance('E2', 2026)).accrued_days)).toBe(Math.round((36 * monthsSoFar) / 12 * 100) / 100);
    await db.exec(`delete from leave_balances where year = 2027`);
    await db.exec(`select run_leave_accrual(2027, 6)`);
    expect(Number((await balance('E2', 2027)).accrued_days)).toBe(18); // 36 a year
    expect(Number((await balance('E1', 2027)).accrued_days)).toBe(12); // the policy's 24
  });

  it('staff cannot change anyone\'s allowance', async () => {
    await asUser(db, STAFF, async () => {
      await expect(db.query(`select set_leave_entitlement('E1', '${annual}', 99, 2026)`)).rejects.toThrow(/row-level security|permission denied/);
    });
  });

  it('a negative allowance is refused', async () => {
    await asUser(db, HR, async () => {
      await expect(db.query(`select set_leave_entitlement('E1', '${annual}', -1, 2026)`)).rejects.toThrow(/zero or more/);
    });
  });
});

describe('year-end reminders', () => {
  const reminders = (emp: string) =>
    rows<{ title: string; message: string; is_read_admin: boolean }>(
      `select title, message, is_read_admin from hr_notifications where employee_number = '${emp}' and notification_type = 'leave_year_end_reminder'`
    );

  beforeAll(async () => {
    await db.exec(`delete from leave_balances where year = 2026; delete from hr_notifications;`);
    await setPolicy(0, 60, 14);
    await db.exec(`insert into leave_balances (tenant_id, employee_number, leave_type_id, year, month, accrued_days, used_days)
      values ('${A}', 'E1', '${annual}', 2026, 0, 24, 6), ('${A}', 'E2', '${annual}', 2026, 0, 24, 14)`);
  });

  it('nothing is sent before the reminder window opens', async () => {
    expect(Number((await rows<{ n: number }>(`select run_leave_year_end_reminders('2026-09-01') as n`))[0].n)).toBe(0);
    expect(await reminders('E1')).toHaveLength(0);
  });

  it('inside the window, only people with enough unused days are reminded, and the admin bell stays quiet', async () => {
    expect(Number((await rows<{ n: number }>(`select run_leave_year_end_reminders('2026-11-15') as n`))[0].n)).toBe(1);
    const e1 = await reminders('E1');
    expect(e1).toHaveLength(1);
    expect(e1[0].message).toMatch(/18 unused Annual Leave day\(s\)/);
    expect(e1[0].message).toMatch(/18 will be lost on 31 Dec 2026/);
    expect(e1[0].is_read_admin).toBe(true);
    expect(await reminders('E2')).toHaveLength(0); // 10 left, under the 14 threshold
  });

  it('is not repeated within the same month, but comes again next month', async () => {
    await db.exec(`select run_leave_year_end_reminders('2026-11-28')`);
    expect(await reminders('E1')).toHaveLength(1);
    await db.exec(`select run_leave_year_end_reminders('2026-12-01')`);
    expect(await reminders('E1')).toHaveLength(2);
  });

  it('only the days above the carry-forward cap count as lost', async () => {
    await db.exec(`delete from hr_notifications`);
    await setPolicy(5, 60, 14);
    await db.exec(`select run_leave_year_end_reminders('2026-11-15')`);
    const e1 = await reminders('E1');
    expect(e1[0].message).toMatch(/13 will be lost/);
    expect(e1[0].message).toMatch(/only 5 can be carried forward/);
  });

  it('a policy with reminders off sends nothing', async () => {
    await db.exec(`delete from hr_notifications`);
    await setPolicy(0, 0, 0);
    await db.exec(`select run_leave_year_end_reminders('2026-12-20')`);
    expect(await reminders('E1')).toHaveLength(0);
  });
});
