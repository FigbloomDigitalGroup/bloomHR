// @vitest-environment node
//
// Leave forfeit (FIG-877): carried-over days used first and lost at a deadline, the days over the carry-forward cap
// lost or paid out at the yearly reset (and paid by payroll), a report of both, and the company's own leave year
// (here July to June) for everything that maps a date to a year.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const C = '00000000-0000-0000-0000-0000000000c3'; // leave year from July
const HR = '00000000-0000-0000-0000-00000000fa01';
const PAY = '00000000-0000-0000-0000-00000000fa02';
const STAFF = '00000000-0000-0000-0000-00000000fa03';
const HR_B = '00000000-0000-0000-0000-00000000fa04';
const HR_C = '00000000-0000-0000-0000-00000000fa05';

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
const as = (user: string, sql: string) => asUser(db, user, () => run(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const typeId = async (name: string, tenant = A) =>
  (await one<{ id: string }>(`select id from leave_types where tenant_id = '${tenant}' and name = '${name}'`)).id;
const balance = async (emp: string, type: string, year: number, tenant = A) =>
  one<{ accrued_days: string; carried_over_days: string; used_days: string; remaining_days: string; carry_expired_on: string | null }>(
    `select accrued_days, carried_over_days, used_days, remaining_days, carry_expired_on::text from leave_balances
     where employee_number = '${emp}' and leave_type_id = '${await typeId(type, tenant)}' and year = ${year} and month = 0`);
const forfeits = async (emp: string, tenant = A) =>
  rows<{ delta_days: string; forfeit_reason: string; effective_on: string; reason: string }>(
    `select a.delta_days, a.forfeit_reason, a.effective_on::text, a.reason from leave_balance_adjustments a
     join leave_balances b on b.id = a.leave_balance_id
     where a.change_type = 'forfeit' and b.employee_number = '${emp}' and b.tenant_id = '${tenant}' order by a.created_at, a.id`);
const approved = (user: string, emp: string, type: string, start: string, end: string) =>
  as(user, `insert into leave_application ("Employee Number", name, "Leave Type", "Start Date", "End Date", status)
            values ('${emp}', '${emp}', '${type}', '${start}', '${end}', 'approved')`);
const policy = async (type: string, set: string, tenant = A) =>
  db.exec(`update leave_policies set ${set} where leave_type_id = '${await typeId(type, tenant)}'`);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co'), ('${C}', 'July Co', 'july-co');
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co'), ('${PAY}', 'pay@a.co'), ('${STAFF}', 'me@a.co'),
      ('${HR_B}', 'hr@b.co'), ('${HR_C}', 'hr@c.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${PAY}', 'pay@a.co', 'FINANCE', '${A}'), ('${STAFF}', 'me@a.co', 'STAFF', '${A}'),
      ('${HR_B}', 'hr@b.co', 'HR', '${B}'), ('${HR_C}', 'hr@c.co', 'HR', '${C}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['leaves', 'employees'], '${A}'), ('FINANCE', array['payroll'], '${A}'), ('STAFF', array['dashboard'], '${A}'),
      ('HR', array['leaves', 'employees', 'payroll'], '${B}'), ('HR', array['leaves', 'employees'], '${C}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Start Date", onboarding_status, tenant_id) values
      ('E1', 'Ann', 'One', 'e1@a.co', '2019-03-01', 'approved', '${A}'),
      ('E2', 'Ben', 'Two', 'e2@a.co', '2019-03-01', 'approved', '${A}'),
      ('ME', 'Mia', 'Me', 'me@a.co', '2019-03-01', 'approved', '${A}'),
      ('X1', 'Xena', 'Other', 'x1@b.co', '2019-03-01', 'approved', '${B}'),
      ('C1', 'Cleo', 'July', 'c1@c.co', '2019-03-01', 'approved', '${C}'),
      ('CJ', 'Cyrus', 'Joiner', 'cj@c.co', '2026-09-15', 'approved', '${C}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", worker_kind, daily_rate, tenant_id) values
      ('CAS', 'Cas', 'Ual', 'cas@a.co', 'casual', 800, '${A}');
    select seed_default_leave_types('${A}');
    select seed_default_leave_types('${B}');
    select seed_default_leave_types('${C}');
    -- documents are tested elsewhere; no public holidays, so day counts are plain weekdays
    update leave_policies set document_name = null, followup_document_name = null;
    delete from holidays where source = 'auto';
    -- simple numbers: 24 days of annual leave given at the start of the year, usable at once
    update leave_policies set days_allotted = 24, accrual_method = 'annual', service_months_before_use = 0,
      reminder_days_before_year_end = 0
      where leave_type_id in (select id from leave_types where name = 'Annual Leave' and tenant_id in ('${A}', '${B}'));
  `);
}, 120000);

describe('settings', () => {
  it('new policy settings default to: carried days never expire, days over the cap are lost, remind 30 days ahead', async () => {
    const p = await one<{ carry_forward_expiry_months: number; over_cap: string; carry_expiry_reminder_days: number }>(
      `select carry_forward_expiry_months, over_cap, carry_expiry_reminder_days from current_leave_policies where leave_type_id = '${await typeId('Annual Leave')}'`);
    expect(p).toEqual({ carry_forward_expiry_months: 0, over_cap: 'forfeit', carry_expiry_reminder_days: 30 });
    expect(await run(`update leave_policies set over_cap = 'bank' where leave_type_id = '${await typeId('Annual Leave')}'`)).toMatch(/over_cap_check/);
  });

  it('the leave year starts in January unless the company says otherwise', async () => {
    expect(await one(`select leave_year_start_month('${A}') m, leave_year_of('${A}', '2026-06-30') y, leave_month_of('${A}', '2026-06-30') mo`))
      .toEqual({ m: 1, y: 2026, mo: 6 });
    const s = (await read<{ s: { start_month: number; current_year: number } }>(HR, `select leave_year_settings() s`))[0].s;
    expect(s.start_month).toBe(1);
  });
});

describe("the yearly reset: Figbloom's 6 days, the rest lost", () => {
  beforeAll(async () => {
    await policy('Annual Leave', 'carry_forward_max_days = 6, carry_forward_expiry_months = 6');
    const annual = await typeId('Annual Leave');
    await db.exec(`insert into leave_balances (tenant_id, employee_number, leave_type_id, year, month, accrued_days, used_days) values
      ('${A}', 'E1', '${annual}', 2026, 0, 24, 14), ('${A}', 'E2', '${annual}', 2026, 0, 24, 18)`);
  });

  it('carries 6 and records the days over the cap as lost', async () => {
    await asUser(db, HR, () => db.query(`select * from run_annual_leave_reset(2027)`));
    const b = await balance('E1', 'Annual Leave', 2027);
    expect(Number(b.carried_over_days)).toBe(6);
    expect(Number(b.remaining_days)).toBe(30);
    const f = await forfeits('E1');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ forfeit_reason: 'over_cap', effective_on: '2027-01-01' });
    expect(Number(f[0].delta_days)).toBe(-4);
    expect(f[0].reason).toMatch(/4 unused day\(s\) from 2026 were over the carry-forward cap of 6 and were lost/);
    // exactly 6 left: nothing lost
    expect(Number((await balance('E2', 'Annual Leave', 2027)).carried_over_days)).toBe(6);
    expect(await forfeits('E2')).toHaveLength(0);
  });

  it('running the reset again records nothing more', async () => {
    await asUser(db, HR, () => db.query(`select * from run_annual_leave_reset(2027)`));
    expect(await forfeits('E1')).toHaveLength(1);
  });

  it('casual workers get no balance and lose nothing', async () => {
    expect(await rows(`select 1 from leave_balances where employee_number = 'CAS'`)).toHaveLength(0);
    expect(await rows(`select 1 from leave_payouts where employee_number = 'CAS'`)).toHaveLength(0);
  });
});

describe('carried days: used first, lost at the deadline', () => {
  it('leave booked after the deadline cannot count on carried days', async () => {
    const check = async (start: string, end: string) =>
      (await read<{ c: { available: number; problems: string[] } }>(HR, `select leave_request_check('E2', 'Annual Leave', '${start}', '${end}') c`))[0].c;
    expect((await check('2027-03-01', '2027-03-01')).available).toBe(30); // 24 + 6 carried
    expect((await check('2027-08-02', '2027-08-02')).available).toBe(24); // the 6 carried must be taken by 30 June
    const late = await check('2027-08-02', '2027-09-03'); // 25 days
    expect(late.problems[0]).toMatch(/Not enough Annual Leave left: 24 days free to book, and this needs 25\. 6 carried-over days must be taken by 30 Jun 2027/);
    expect(await approved(HR, 'E2', 'Annual Leave', '2027-08-02', '2027-09-03')).toMatch(/Not enough Annual Leave left for E2: 24 days free/);
    expect(await approved(HR, 'E2', 'Annual Leave', '2027-08-02', '2027-09-02')).toBe(''); // 24 days: fine
  });

  it('at the deadline only the carried days not yet used are lost, and recorded', async () => {
    expect(await approved(HR, 'E1', 'Annual Leave', '2027-02-01', '2027-02-02')).toBe(''); // 2 days, from the carried 6
    expect(await approved(HR, 'E1', 'Annual Leave', '2027-08-02', '2027-08-04')).toBe(''); // 3 days after the deadline
    expect(Number((await one<{ n: number }>(`select run_leave_carry_expiry('2027-06-30') n`)).n)).toBe(0);
    expect(Number((await balance('E1', 'Annual Leave', 2027)).carried_over_days)).toBe(6);

    expect(Number((await one<{ n: number }>(`select run_leave_carry_expiry('2027-07-01') n`)).n)).toBe(2); // E1 and E2
    const b = await balance('E1', 'Annual Leave', 2027);
    expect(Number(b.carried_over_days)).toBe(2); // the 2 used before the deadline
    expect(Number(b.remaining_days)).toBe(21); // 24 + 2 - 5: the new year's days untouched
    expect(b.carry_expired_on).toBe('2027-07-01');
    const f = (await forfeits('E1')).filter((x) => x.forfeit_reason === 'carry_expired');
    expect(f).toHaveLength(1);
    expect(Number(f[0].delta_days)).toBe(-4);
    expect(f[0].reason).toMatch(/4 of 6 day\(s\) carried over from 2026 were not taken by 30 Jun 2027 and were lost/);
    // E2 used none of theirs before the deadline: all 6 go, and their 24 booked days still fit
    const b2 = await balance('E2', 'Annual Leave', 2027);
    expect(Number(b2.carried_over_days)).toBe(0);
    expect(Number(b2.remaining_days)).toBe(0);
  });

  it('running it again changes nothing', async () => {
    expect(Number((await one<{ n: number }>(`select run_leave_carry_expiry('2027-08-01') n`)).n)).toBe(0);
    expect(Number((await balance('E1', 'Annual Leave', 2027)).carried_over_days)).toBe(2);
  });
});

describe('days over the cap paid out', () => {
  beforeAll(async () => {
    await policy('Study/Exam Leave', `carry_forward_max_days = 2, over_cap = 'pay_out'`);
    const study = await typeId('Study/Exam Leave');
    await db.exec(`insert into leave_balances (tenant_id, employee_number, leave_type_id, year, month, accrued_days, used_days) values
      ('${A}', 'E1', '${study}', 2026, 0, 10, 3);
      delete from leave_balances where employee_number = 'E1' and leave_type_id = '${study}' and year = 2027`);
    await asUser(db, HR, () => db.query(`select * from run_annual_leave_reset(2027)`));
  });

  it('the reset carries the cap and makes a payout of the rest, for the first payroll of the new year', async () => {
    expect(Number((await balance('E1', 'Study/Exam Leave', 2027)).carried_over_days)).toBe(2);
    const p = await rows<{ days: string; year: number; pay_period: string; status: string }>(
      `select days, year, pay_period, status from leave_payouts where employee_number = 'E1'`);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ year: 2027, pay_period: '2027-01', status: 'pending' });
    expect(Number(p[0].days)).toBe(5);
    expect((await forfeits('E1')).filter((f) => f.reason.includes('Study'))).toHaveLength(0); // not recorded as lost
  });

  it('payroll sees it from its pay month on, with the working days for the daily rate', async () => {
    const due = (period: string) => read<{ id: string; employee_number: string; leave_type: string; days: string; month_working_days: string }>(
      PAY, `select * from leave_payouts_due('${period}')`);
    expect(await due('2026-12')).toHaveLength(0);
    const jan = await due('2027-01');
    expect(jan).toHaveLength(1);
    expect(jan[0]).toMatchObject({ employee_number: 'E1', leave_type: 'Study/Exam Leave' });
    expect(Number(jan[0].days)).toBe(5);
    expect(Number(jan[0].month_working_days)).toBe(21); // January 2027: 21 weekdays
    expect(await due('2027-03')).toHaveLength(1); // not paid yet: still due
  });

  it('approving the payroll month marks it paid with what the payslip paid; reopening undoes it', async () => {
    const id = (await one<{ id: string }>(`select id from leave_payouts where employee_number = 'E1'`)).id;
    const items = JSON.stringify([{ name: 'Leave paid out: 5 days', amount: 5000, taxable: true, pensionable: true, leave_payout_id: id }]);
    expect(await as(PAY, `insert into salary_history (employee_id, pay_period, net_pay, earning_items) values ('E1', '2027-01', 40000, '${items}'::jsonb)`)).toBe('');
    expect(await as(PAY, `update payroll_runs set status = 'approved' where pay_period = '2027-01'`)).toBe('');
    const paid = await one<{ status: string; amount: string; paid_period: string }>(`select status, amount, paid_period from leave_payouts where id = '${id}'`);
    expect(paid).toMatchObject({ status: 'paid', paid_period: '2027-01' });
    expect(Number(paid.amount)).toBe(5000);
    expect(await read(PAY, `select * from leave_payouts_due('2027-02')`)).toHaveLength(0);

    expect(await as(PAY, `update payroll_runs set status = 'draft' where pay_period = '2027-01'`)).toBe('');
    expect(await one(`select status, amount, paid_period from leave_payouts where id = '${id}'`))
      .toEqual({ status: 'pending', amount: null, paid_period: null });
  });
});

describe('the forfeited & paid out report', () => {
  it('lists days lost (when and why) and days paid out, by year', async () => {
    const r = await read<{ kind: string; reason: string; employee_number: string; leave_type: string; year: number; days: string; on_date: string; status: string | null }>(
      HR, `select kind, reason, employee_number, leave_type, year, days, on_date::text, status from leave_forfeit_report(2027)`);
    const e1 = r.filter((x) => x.employee_number === 'E1').map((x) => [x.kind, x.reason, x.leave_type, Number(x.days), x.on_date]);
    expect(e1).toEqual(expect.arrayContaining([
      ['forfeit', 'over_cap', 'Annual Leave', 4, '2027-01-01'],
      ['forfeit', 'carry_expired', 'Annual Leave', 4, '2027-07-01'],
      ['pay_out', 'over_cap', 'Study/Exam Leave', 5, '2027-01-01'],
    ]));
    expect(e1).toHaveLength(3);
    expect(r.find((x) => x.kind === 'pay_out')?.status).toBe('pending');
    expect(await read(HR, `select * from leave_forfeit_report(2026)`)).toHaveLength(0);
  });

  it('each company sees only its own', async () => {
    expect(await read(HR_B, `select * from leave_forfeit_report()`)).toHaveLength(0);
    expect(await read(HR_B, `select * from leave_payouts`)).toHaveLength(0);
  });
});

describe('a leave year from July', () => {
  beforeAll(async () => {
    expect(await as(HR_C, `select set_leave_year_start(7)`)).toBe('');
    // Annual Leave earned monthly (24 = 2 a month); reminders 60 days before the year ends; 6 carried, for 6 months
    await policy('Annual Leave', `days_allotted = 24, service_months_before_use = 0, carry_forward_max_days = 6,
      carry_forward_expiry_months = 6, reminder_days_before_year_end = 60, reminder_min_remaining = 0`, C);
  });

  it('maps dates to leave years that start on 1 July', async () => {
    expect(await one(`select leave_year_of('${C}', '2026-06-30') a, leave_year_of('${C}', '2026-07-01') b,
                             leave_month_of('${C}', '2026-07-01') m1, leave_month_of('${C}', '2027-06-15') m12,
                             leave_year_start('${C}', 2026)::text s, leave_year_end('${C}', 2026)::text e`))
      .toEqual({ a: 2025, b: 2026, m1: 1, m12: 12, s: '2026-07-01', e: '2027-06-30' });
    const s = (await read<{ s: { start_month: number } }>(HR_C, `select leave_year_settings() s`))[0].s;
    expect(s.start_month).toBe(7);
  });

  it('earns by month of the leave year, and a joiner from the month they joined', async () => {
    await db.exec(`select run_leave_accrual(2026, 10)`); // October = month 4 of the leave year 2026
    expect(Number((await balance('C1', 'Annual Leave', 2026, C)).accrued_days)).toBe(8);
    expect(Number((await balance('CJ', 'Annual Leave', 2026, C)).accrued_days)).toBe(4); // September and October
    expect(Number((await one<{ d: string }>(`select leave_year_allowance('${C}', 'CJ', 24, 2026, 12) d`)).d)).toBe(20); // Sep to Jun
    expect(Number((await one<{ m: number }>(`select leave_service_months('2026-09-15', 2026, 12, 7) m`)).m)).toBe(10);
    // company A (January) earned by calendar month as before: nothing here, its Annual Leave is given at once
    expect(Number((await one<{ d: string }>(`select leave_year_allowance('${A}', 'E1', 24, 2026, 10) d`)).d)).toBe(20);
  });

  it('an application counts in the leave year it starts in', async () => {
    expect(await approved(HR_C, 'C1', 'Annual Leave', '2027-03-01', '2027-03-02')).toBe('');
    expect(Number((await balance('C1', 'Annual Leave', 2026, C)).used_days)).toBe(2);
    expect(await rows(`select 1 from leave_balances where employee_number = 'C1' and year = 2027`)).toHaveLength(0);
    expect(await approved(HR_C, 'C1', 'Annual Leave', '2027-07-05', '2027-07-05')).toBe('');
    expect(Number((await balance('C1', 'Annual Leave', 2027, C)).used_days)).toBe(1);
  });

  it('the daily job resets each company on the 1st of its own leave year', async () => {
    await policy('Sick Leave', 'document_name = null', C);
    expect(Number((await one<{ n: number }>(`select run_leave_daily('2026-07-01') n`)).n)).toBe(1); // company C only
    expect(Number((await balance('C1', 'Sick Leave', 2026, C)).accrued_days)).toBe(14);
    expect(await rows(`select 1 from leave_balances b join leave_types t on t.id = b.leave_type_id
                       where t.tenant_id = '${A}' and t.name = 'Sick Leave' and b.year = 2026`)).toHaveLength(0);
    expect(Number((await one<{ n: number }>(`select run_leave_daily('2026-08-01') n`)).n)).toBe(0);
    // every January company (A, B and the seeded one) on 1 January, C not
    expect(Number((await one<{ n: number }>(`select run_leave_daily('2027-01-01') n`)).n)).toBe(await one<{ n: number }>(
      `select count(*)::int n from tenants where id <> '${C}'`).then((x) => x.n));
    expect(await rows(`select 1 from leave_balances where tenant_id = '${C}' and year = 2027 and employee_number = 'C1'
                       and leave_type_id = '${await typeId('Sick Leave', C)}'`)).toHaveLength(0);
  });

  it('reminds before carried days expire, and before the leave year ends (30 June)', async () => {
    const annual = await typeId('Annual Leave', C);
    // C1 carried 6 into 2026. The 2 days above are in March 2027, after the deadline (1 Jan 2027), so they don't use the
    // carried days; 1 day in November does.
    await db.exec(`update leave_balances set carried_over_days = 6, accrued_days = 24 where employee_number = 'C1' and leave_type_id = '${annual}' and year = 2026`);
    expect(await approved(HR_C, 'C1', 'Annual Leave', '2026-11-02', '2026-11-02')).toBe('');
    const reminders = () => rows<{ title: string; message: string }>(
      `select title, message from hr_notifications where employee_number = 'C1' and notification_type = 'leave_year_end_reminder' order by created_at, id`);
    await db.exec(`select run_leave_year_end_reminders('2026-11-15')`);
    expect(await reminders()).toHaveLength(0); // the deadline (1 Jan 2027) is more than 30 days away
    await db.exec(`select run_leave_year_end_reminders('2026-12-05')`);
    const r = await reminders();
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe('Use your carried-over Annual Leave by 31 Dec 2026');
    expect(r[0].message).toMatch(/You carried 6 Annual Leave day\(s\) over from 2025 and 5 of them are still unused\. Carried-over days must be taken by 31 Dec 2026/);

    expect(Number((await one<{ n: number }>(`select run_leave_carry_expiry('2027-01-01') n`)).n)).toBe(1);
    expect(Number((await balance('C1', 'Annual Leave', 2026, C)).carried_over_days)).toBe(1);

    await db.exec(`select run_leave_year_end_reminders('2027-05-15')`);
    const end = (await reminders()).filter((x) => x.title.startsWith('Take your'));
    expect(end).toHaveLength(1);
    // 24 + 1 carried - 3 used = 22 left, 16 of them over the cap of 6
    expect(end[0].message).toMatch(/You have 22(\.0+)? unused Annual Leave day\(s\)\. 16(\.0+)? will be lost on 30 Jun 2027 \(only 6 can be carried forward\)/);
  });

  it("company A's people got no July-year reminders", async () => {
    expect(await rows(`select 1 from hr_notifications where employee_number in ('E1', 'E2') and notification_type = 'leave_year_end_reminder'`)).toHaveLength(0);
  });
});

describe('who can run it', () => {
  it('staff cannot run the jobs, change the leave year, or see the report and payouts', async () => {
    expect(await as(STAFF, `select run_leave_carry_expiry()`)).toMatch(/Only people who run leave/);
    expect(await as(STAFF, `select * from run_annual_leave_reset(2028)`)).toMatch(/row-level security|permission denied/);
    expect(await as(STAFF, `select run_leave_daily()`)).toMatch(/permission denied/);
    expect(await as(HR, `select run_leave_daily()`)).toMatch(/permission denied/);
    expect(await as(STAFF, `select set_leave_year_start(4)`)).toMatch(/Only people who run leave/);
    expect(await as(STAFF, `select * from leave_forfeit_report()`)).toMatch(/Only people who run leave/);
    expect(await as(STAFF, `select * from leave_payouts_due('2027-01')`)).toMatch(/Only payroll/);
    expect(await read(STAFF, `select * from leave_payouts`)).toHaveLength(0);
    expect(await one(`select leave_year_start_month('${A}') m`)).toEqual({ m: 1 });
  });

  it("HR's run stays inside their company", async () => {
    const annualB = await typeId('Annual Leave', B);
    await policy('Annual Leave', 'carry_forward_max_days = 6, carry_forward_expiry_months = 1', B);
    await db.exec(`insert into leave_balances (tenant_id, employee_number, leave_type_id, year, month, accrued_days, used_days, carried_over_days)
                   values ('${B}', 'X1', '${annualB}', 2026, 0, 24, 0, 6)`);
    await asUser(db, HR, () => db.query(`select run_leave_carry_expiry('2026-12-31')`));
    expect(Number((await balance('X1', 'Annual Leave', 2026, B)).carried_over_days)).toBe(6);
    await asUser(db, HR_B, () => db.query(`select run_leave_carry_expiry('2026-12-31')`));
    expect(Number((await balance('X1', 'Annual Leave', 2026, B)).carried_over_days)).toBe(0);
  });
});
