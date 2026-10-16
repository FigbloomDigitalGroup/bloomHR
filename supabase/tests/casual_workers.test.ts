// @vitest-environment node
//
// Casual workers paid by the day (20261017900000): registered by payroll or HR, their days recorded by their
// supervisor or payroll (payroll approves), paid in pay runs (days x daily rate, plus one-off additions and
// deductions) that are fixed once approved; kept out of the monthly payroll, the onboarding queue and leave; and a
// warning when one works more days in a row than the company's limit.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const PAY = '00000000-0000-0000-0000-00000000ca01';
const HR = '00000000-0000-0000-0000-00000000ca02';
const SUP = '00000000-0000-0000-0000-00000000ca03';
const STAFF = '00000000-0000-0000-0000-00000000ca04';
const OTHER = '00000000-0000-0000-0000-00000000ca05';

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
const json = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
/** a date n days before today, as SQL */
const ago = (n: number) => `(current_date - ${n})`;

let C1 = ''; // Wanjiku, supervised by SUP, KSh 800 a day, M-Pesa
let C2 = ''; // Kamau, nobody's team, KSh 600 a day, bank

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values
      ('${PAY}', 'pay@a.co'), ('${HR}', 'hr@a.co'), ('${SUP}', 'sup@a.co'), ('${STAFF}', 'staff@a.co'), ('${OTHER}', 'pay@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${PAY}', 'pay@a.co', 'FINANCE', '${A}'), ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${SUP}', 'sup@a.co', 'STAFF', '${A}'),
      ('${STAFF}', 'staff@a.co', 'STAFF', '${A}'), ('${OTHER}', 'pay@b.co', 'FINANCE', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('FINANCE', array['payroll'], '${A}'), ('HR', array['employees', 'leaves'], '${A}'), ('STAFF', array['dashboard'], '${A}'),
      ('FINANCE', array['payroll'], '${B}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Start Date", onboarding_status, tenant_id) values
      ('S1', 'Sam', 'Supervisor', 'sup@a.co', '2020-01-01', 'approved', '${A}'),
      ('E1', 'Esther', 'Employee', 'staff@a.co', '2020-01-01', 'approved', '${A}'),
      ('X1', 'Xena', 'Other', 'x@b.co', '2020-01-01', 'approved', '${B}');
  `);
}, 120000);

describe('registering casuals', () => {
  it('payroll registers a casual: a casual worker with a daily rate, outside onboarding', async () => {
    C1 = await asUser(db, PAY, async () =>
      (await one<{ n: string }>(`select save_casual(${json({
        first_name: 'Wanjiku', last_name: 'Mwangi', id_number: '23456789', phone: '0712 345 678', daily_rate: 800,
        start_date: '2026-01-05', supervisor_email: 'Sup@A.co',
      })}) n`)).n
    );
    expect(C1).toMatch(/^MCL-\d{6}$/);
    expect(await one(`select worker_kind, daily_rate, payment_method, "Mobile Number" phone, manager_email, "Employee Type" t
                      from employees where "Employee Number" = '${C1}'`))
      .toEqual({ worker_kind: 'casual', daily_rate: '800.00', payment_method: 'M-Pesa', phone: '0712345678', manager_email: 'sup@a.co', t: 'Casual' });
  });

  it('HR uploads a sheet: each row added on its own, problems reported per row', async () => {
    const out = await asUser(db, HR, async () =>
      (await one<{ r: { row: number; employee_number?: string; error?: string }[] }>(`select register_casuals(${json([
        { first_name: 'Kamau', last_name: 'Njoroge', daily_rate: '600', payment_method: 'Bank', bank: 'KCB', account_number: '1100223344',
          account_name: 'Kamau Njoroge', start_date: '2026-01-01' },
        { first_name: 'No', last_name: 'Rate', phone: '0722000111' },
        { first_name: 'Bad', last_name: 'Date', phone: '0722000112', daily_rate: 500, start_date: 'last week' },
      ])}) r`)).r
    );
    expect(out[0].employee_number).toMatch(/^MCL-/);
    expect(out[1]).toEqual({ row: 2, error: 'Add a daily rate of more than 0' });
    expect(out[2].error).toMatch(/should look like 2026-10-16/);
    C2 = out[0].employee_number!;
  });

  it('staff and supervisors cannot register casuals', async () => {
    for (const u of [STAFF, SUP]) {
      expect(await as(u, `select save_casual(${json({ first_name: 'A', last_name: 'B', daily_rate: 1, phone: '0711111111' })})`))
        .toMatch(/Only payroll or HR/);
    }
  });

  it('a casual must have a daily rate of more than 0', async () => {
    expect(await run(`update employees set daily_rate = null where "Employee Number" = '${C1}'`)).toMatch(/employees_daily_rate_check/);
    expect(await run(`update employees set worker_kind = 'casual' where "Employee Number" = 'E1'`)).toMatch(/employees_daily_rate_check/);
    expect(await as(PAY, `select save_casual(${json({ first_name: 'Z', last_name: 'Z', daily_rate: 0, phone: '0711111111' })})`))
      .toMatch(/daily rate of more than 0/);
    // a casual has no withholding tax category
    expect(await run(`update employees set wht_category = 'contractual' where "Employee Number" = '${C1}'`)).toMatch(/wht_category/);
  });

  it('a supervisor sees only their team, without bank details; payroll sees all', async () => {
    expect((await read<{ employee_number: string }>(SUP, `select employee_number from casual_workers()`)).map((r) => r.employee_number)).toEqual([C1]);
    const all = await read<{ employee_number: string; account_number: string | null }>(PAY, `select employee_number, account_number from casual_workers()`);
    expect(all.map((r) => r.employee_number).sort()).toEqual([C1, C2].sort());
    expect(all.find((r) => r.employee_number === C2)?.account_number).toBe('1100223344');
    expect(await read(STAFF, `select 1 from casual_workers()`)).toHaveLength(0);
    expect(await read(OTHER, `select 1 from casual_workers()`)).toHaveLength(0);
  });

  it('casuals are not in the onboarding queue', async () => {
    const names = (await read<{ employee_number: string }>(HR, `select employee_number from onboarding_overview()`)).map((r) => r.employee_number);
    expect(names).toContain('E1');
    expect(names).not.toContain(C1);
  });
});

describe('days worked', () => {
  const day = (who: string, n: number, portion: string) =>
    `insert into casual_days (employee_number, work_date, portion) values ('${who}', ${ago(n)}, '${portion}')`;
  const status = async (who: string, n: number) =>
    (await one<{ status: string; source: string; amount: string }>(
      `select status, source, amount from casual_days where employee_number = '${who}' and work_date = ${ago(n)}`));

  it("a supervisor records their team's days; they wait for payroll's approval", async () => {
    expect(await as(SUP, day(C1, 6, 'full'))).toBe('');
    expect(await status(C1, 6)).toEqual({ status: 'submitted', source: 'supervisor', amount: '800.00' });
    expect(await as(SUP, `update casual_days set status = 'approved' where employee_number = '${C1}'`)).toMatch(/Only payroll can approve/);
    expect(await as(PAY, `update casual_days set status = 'approved' where employee_number = '${C1}' and work_date = ${ago(6)}`)).toBe('');
    expect((await status(C1, 6)).status).toBe('approved');
    expect(await as(SUP, `update casual_days set portion = 'half' where employee_number = '${C1}' and work_date = ${ago(6)}`))
      .toMatch(/Only payroll can change an approved day/);
  });

  it('payroll records days approved at once; half a day is half the rate; absent is nothing', async () => {
    expect(await as(PAY, day(C1, 5, 'half'))).toBe('');
    expect(await as(PAY, day(C1, 4, 'full'))).toBe('');
    expect(await as(PAY, day(C1, 3, 'absent'))).toBe('');
    expect(await status(C1, 5)).toEqual({ status: 'approved', source: 'payroll', amount: '400.00' });
    expect((await status(C1, 3)).amount).toBe('0.00');
    expect(await as(PAY, day(C2, 4, 'full'))).toBe('');
  });

  it('nobody else records days: not staff, not a supervisor outside their team, not another company', async () => {
    expect(await as(SUP, day(C2, 2, 'full'))).toMatch(/row-level security|own team/);
    expect(await as(STAFF, day(C1, 2, 'full'))).toMatch(/row-level security|own team/);
    expect(await as(OTHER, day(C1, 2, 'full'))).toMatch(/row-level security|Unknown worker/);
    expect(await read(OTHER, `select 1 from casual_days`)).toHaveLength(0);
    expect(await read(STAFF, `select 1 from casual_days`)).toHaveLength(0);
  });

  it('refuses days for non-casuals, days ahead, days before they started, and a second entry for a day', async () => {
    expect(await as(PAY, day('E1', 2, 'full'))).toMatch(/not a casual worker/);
    expect(await as(PAY, `insert into casual_days (employee_number, work_date, portion) values ('${C1}', current_date + 1, 'full')`)).toMatch(/ahead/);
    expect(await as(PAY, `insert into casual_days (employee_number, work_date, portion) values ('${C1}', '2025-12-01', 'full')`)).toMatch(/started on/);
    expect(await as(PAY, day(C1, 4, 'half'))).toMatch(/duplicate|unique/i);
  });
});

describe('pay runs', () => {
  let runId = '';
  const line = async (who: string) =>
    one<{ full_days: number; half_days: number; days_amount: string; additions: string; net_pay: string; phone: string }>(
      `select full_days, half_days, days_amount, additions, net_pay, phone from casual_pay_lines where run_id = '${runId}' and employee_number = '${who}'`);

  it("works out each casual's days x rate for the period", async () => {
    runId = await asUser(db, PAY, async () => (await one<{ id: string }>(`select create_casual_pay_run(${ago(7)}, ${ago(1)}, 'Week') id`)).id);
    expect(await line(C1)).toMatchObject({ full_days: 2, half_days: 1, days_amount: '2000.00', net_pay: '2000.00', phone: '0712345678' });
    expect(await line(C2)).toMatchObject({ full_days: 1, half_days: 0, days_amount: '600.00' });
    expect((await one<{ total: string }>(`select total from casual_pay_runs where id = '${runId}'`)).total).toBe('2600.00');
  });

  it('only payroll runs pay; only through the functions', async () => {
    expect(await as(SUP, `select create_casual_pay_run(${ago(7)}, ${ago(1)})`)).toMatch(/Only payroll/);
    expect(await as(PAY, `insert into casual_pay_runs (period_start, period_end) values (${ago(2)}, ${ago(1)})`)).toMatch(/Casual workers page/);
    expect(await as(PAY, `update casual_pay_lines set days_amount = 9999 where run_id = '${runId}'`)).toMatch(/Only additions, deductions/);
    expect(await read(OTHER, `select 1 from casual_pay_runs`)).toHaveLength(0);
  });

  it('one-off additions and deductions need a note and count in the total', async () => {
    expect(await as(PAY, `update casual_pay_lines set additions = 500 where run_id = '${runId}' and employee_number = '${C1}'`)).toMatch(/check/i);
    expect(await as(PAY, `update casual_pay_lines set additions = 500, deductions = 100, adjustment_note = 'Transport; lost gloves'
                          where run_id = '${runId}' and employee_number = '${C1}'`)).toBe('');
    expect((await line(C1)).net_pay).toBe('2400.00');
    // refreshing keeps them
    expect(await as(PAY, `select refresh_casual_pay_run('${runId}')`)).toBe('');
    expect((await line(C1)).net_pay).toBe('2400.00');
    expect((await one<{ total: string }>(`select total from casual_pay_runs where id = '${runId}'`)).total).toBe('3000.00');
  });

  it("can't be approved while days in the period wait for approval", async () => {
    expect(await as(SUP, `insert into casual_days (employee_number, work_date, portion) values ('${C1}', ${ago(2)}, 'full')`)).toBe('');
    expect(await as(PAY, `select approve_casual_pay_run('${runId}')`)).toMatch(/1 day in this period still waits for approval/);
    expect(await as(PAY, `update casual_days set status = 'approved' where employee_number = '${C1}' and work_date = ${ago(2)}`)).toBe('');
    expect(await as(PAY, `select approve_casual_pay_run('${runId}')`)).toBe('');
    expect(await line(C1)).toMatchObject({ full_days: 3, half_days: 1, net_pay: '3200.00' });
  });

  it('an approved run is frozen, and its days are locked', async () => {
    expect(await as(PAY, `update casual_pay_lines set additions = 900 where run_id = '${runId}' and employee_number = '${C1}'`)).toMatch(/approved/);
    expect(await as(PAY, `update casual_days set portion = 'half' where employee_number = '${C1}' and work_date = ${ago(4)}`)).toMatch(/approved pay run/);
    expect(await as(PAY, `delete from casual_days where employee_number = '${C1}' and work_date = ${ago(4)}`)).toMatch(/approved pay run/);
    expect(await as(PAY, `delete from casual_pay_runs where id = '${runId}'`)).toMatch(/Only a draft/);
    // the days are in no other run
    const second = await asUser(db, PAY, async () => (await one<{ id: string }>(`select create_casual_pay_run(${ago(7)}, ${ago(1)}) id`)).id);
    expect(await rows(`select 1 from casual_pay_lines where run_id = '${second}'`)).toHaveLength(0);
    expect(await as(PAY, `delete from casual_pay_runs where id = '${second}'`)).toBe('');
  });

  it('marked paid with the day it was paid; paid days stay locked', async () => {
    expect(await as(PAY, `select mark_casual_pay_run_paid('${runId}', current_date + 1)`)).toMatch(/day it was paid/);
    expect(await as(PAY, `select mark_casual_pay_run_paid('${runId}', current_date)`)).toBe('');
    expect(await one(`select status, paid_on = current_date as today from casual_pay_runs where id = '${runId}'`)).toEqual({ status: 'paid', today: true });
    expect(await rows(`select 1 from casual_days where pay_run_id = '${runId}' and paid_at is null`)).toHaveLength(0);
    expect(await as(PAY, `update casual_days set portion = 'half' where employee_number = '${C1}' and work_date = ${ago(4)}`)).toMatch(/paid/);
    expect(await as(PAY, `select reopen_casual_pay_run('${runId}')`)).toMatch(/paid, not approved/);
  });
});

describe('kept out of the monthly payroll and leave', () => {
  it('no PAYE payslip can be saved for a casual, even an onboarded one', async () => {
    await db.exec(`update employees set onboarding_status = 'approved' where "Employee Number" = '${C1}'`);
    expect(await as(PAY, `insert into salary_history (employee_id, employee_name, pay_period, basic_salary, gross_pay, net_pay)
                          values ('${C1}', 'Wanjiku', '2026-10', 1, 1, 1)`))
      .toMatch(/is a casual worker: pay them from the Casual workers page/);
    expect(await as(PAY, `insert into salary_history (employee_id, employee_name, pay_period, basic_salary, gross_pay, net_pay)
                          values ('E1', 'Esther', '2026-10', 1, 1, 1)`)).toBe('');
  });

  it('casuals earn no leave', async () => {
    await db.exec(`select seed_default_leave_types('${A}')`);
    await db.exec(`select * from run_leave_accrual(2026, 10); select * from run_annual_leave_reset(2026)`);
    const who = (await rows<{ employee_number: string }>(`select distinct employee_number from leave_balances where tenant_id = '${A}'`))
      .map((r) => r.employee_number);
    expect(who).toContain('E1');
    expect(who).not.toContain(C1);
    expect(who).not.toContain(C2);
  });
});

describe('working too many days in a row (Employment Act s.37)', () => {
  it('flags a casual whose latest run of working days is over the limit; a weekend does not break the run', async () => {
    // Kamau: every weekday for the last 7 weeks (a 2-day weekend gap each week)
    await db.exec(`
      insert into casual_days (tenant_id, employee_number, work_date, portion, status)
      select '${A}', '${C2}', d::date, 'full', 'approved'
      from generate_series(current_date - 48, current_date - 5, interval '1 day') d
      where extract(isodow from d) < 6
      on conflict do nothing;
    `);
    const worked = Number((await one<{ n: string }>(
      `select count(*) n from casual_days where employee_number = '${C2}' and work_date >= current_date - 48 and portion <> 'absent'`)).n);
    const alerts = await read<{ employee_number: string; days_in_a_row: number; level: string; day_limit: number }>(
      HR, `select employee_number, days_in_a_row, level, day_limit from casual_limit_alerts()`);
    expect(alerts).toEqual([{ employee_number: C2, days_in_a_row: worked, level: 'over', day_limit: 30 }]);
    // a supervisor only hears about their own team
    expect(await read(SUP, `select 1 from casual_limit_alerts()`)).toHaveLength(0);
  });

  it('a break of 3 days or more starts a new run; the limit is the company setting', async () => {
    expect(await as(STAFF, `select set_casual_day_limit(40)`)).toMatch(/Only payroll or HR/);
    expect(await as(HR, `select set_casual_day_limit(${0})`)).toMatch(/between 1 and 366/);
    const worked = Number((await one<{ n: string }>(`select count(*) n from casual_days where employee_number = '${C2}' and portion <> 'absent'`)).n);
    expect(await as(HR, `select set_casual_day_limit(${worked + 2})`)).toBe('');
    const level = async () => (await read<{ level: string }>(PAY, `select level from casual_limit_alerts() where employee_number = '${C2}'`))[0]?.level;
    expect(await level()).toBe('near');
    // one weekday off next to a weekend: a 3-day break ends the run, so the latest run is short
    await db.exec(`delete from casual_days where employee_number = '${C2}' and work_date = (
      select max(work_date) from casual_days where employee_number = '${C2}' and extract(isodow from work_date) = 1 and work_date < current_date - 5)`);
    expect(await level()).toBeUndefined();
    expect(await as(HR, `select set_casual_day_limit(30)`)).toBe('');
  });

  it('a casual marked finished is no longer flagged', async () => {
    expect(await as(SUP, `select finish_casual('${C1}', current_date)`)).toMatch(/Only payroll or HR/);
    expect(await as(HR, `select finish_casual('${C1}', current_date)`)).toBe('');
    expect(await one(`select "Status" s, "Termination Date" = to_char(current_date, 'YYYY-MM-DD') t from employees where "Employee Number" = '${C1}'`))
      .toEqual({ s: 'Inactive', t: true });
    expect(await as(PAY, `select rejoin_casual('${C1}', current_date)`)).toBe('');
  });
});
