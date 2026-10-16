// @vitest-environment node
//
// Half-pay and unpaid leave days on the payslip (FIG-880): leave_pay_deductions('YYYY-MM') gives payroll each
// employee's unpaid days and half-pay days that month from approved leave, with the applications behind them.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000f801';
const PAY = '00000000-0000-0000-0000-00000000f802';
const STAFF = '00000000-0000-0000-0000-00000000f803';
const PAY_B = '00000000-0000-0000-0000-00000000f804';

interface Row {
  employee_number: string;
  unpaid_days: string;
  half_pay_days: string;
  month_working_days: string;
  applications: { id: string; leave_type: string; start_date: string; end_date: string; days_in_month: number; unpaid_days: number; half_pay_days: number }[];
}

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
const deductions = (period: string, user = PAY) =>
  asUser(db, user, () => rows<Row>(`select * from leave_pay_deductions('${period}')`));
const forEmployee = async (period: string, emp: string) => (await deductions(period)).find((r) => r.employee_number === emp);
// HR records leave already approved (the balance is taken as it is saved)
const record = (emp: string, type: string, start: string, end: string, status = 'approved') => asUser(db, HR, () => run(
  `insert into leave_application ("Employee Number", name, "Leave Type", "Start Date", "End Date", status)
   values ('${emp}', '${emp}', '${type}', '${start}', '${end}', '${status}')`));

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co'), ('${PAY}', 'pay@a.co'), ('${STAFF}', 'me@a.co'), ('${PAY_B}', 'pay@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${PAY}', 'pay@a.co', 'FINANCE', '${A}'), ('${STAFF}', 'me@a.co', 'STAFF', '${A}'),
      ('${PAY_B}', 'pay@b.co', 'FINANCE', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['leaves', 'employees'], '${A}'), ('FINANCE', array['payroll'], '${A}'), ('STAFF', array['dashboard'], '${A}'),
      ('FINANCE', array['payroll', 'leaves'], '${B}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", tenant_id) values
      ('ME', 'Mia', 'Me', 'me@a.co', '${A}'), ('YOU', 'Yusuf', 'You', 'you@a.co', '${A}'), ('OTHER', 'Otto', 'Other', 'o@b.co', '${B}');
    select seed_default_leave_types('${A}');
    select seed_default_leave_types('${B}');
    -- documents are tested in leave_documents.test.ts; no public holidays, so the day counts are plain weekdays
    update leave_policies set document_name = null, followup_document_name = null;
    delete from holidays where tenant_id = '${A}';
    -- sick leave: 10 days at full pay, then 10 at half pay
    update leave_policies set days_allotted = 10, half_pay_days = 10
      where leave_type_id = (select id from leave_types where tenant_id = '${A}' and name = 'Sick Leave');
    -- an unpaid type counted in calendar days
    insert into leave_types (tenant_id, name, description) values ('${A}', 'Unpaid Sabbatical', 'Time away without pay');
    insert into leave_policies (tenant_id, leave_type_id, days_allotted, accrual_method, count_days)
      select '${A}', id, null, 'none', 'calendar' from leave_types where tenant_id = '${A}' and name = 'Unpaid Sabbatical';
  `);
}, 120000);

describe('paid and unpaid leave types', () => {
  it('"Unpaid ..." types are unpaid, the rest paid', async () => {
    const types = await rows<{ name: string; paid: boolean }>(
      `select name, paid from leave_types where tenant_id = '${A}' and name in ('Unpaid Leave', 'Unpaid Sabbatical', 'Annual Leave', 'Sick Leave') order by name`);
    expect(types).toEqual([
      { name: 'Annual Leave', paid: true },
      { name: 'Sick Leave', paid: true },
      { name: 'Unpaid Leave', paid: false },
      { name: 'Unpaid Sabbatical', paid: false },
    ]);
  });

  it('a day’s pay for leave is basic / 30 unless the company chooses working days', async () => {
    expect(await asUser(db, PAY, () => run(`insert into company_payroll_settings (leave_daily_rate_basis) values ('working_days')`))).toBe('');
    expect(await asUser(db, PAY, () => run(`update company_payroll_settings set leave_daily_rate_basis = 'basic_31'`))).toMatch(/check/);
    expect(await asUser(db, PAY, () => run(`update company_payroll_settings set leave_daily_rate_basis = default`))).toBe('');
    expect((await asUser(db, PAY, () => rows(`select leave_daily_rate_basis from company_payroll_settings`)))).toEqual([{ leave_daily_rate_basis: 'basic_30' }]);
  });
});

describe('leave_pay_deductions', () => {
  it('counts unpaid working days in the month (weekends left out)', async () => {
    expect(await record('ME', 'Unpaid Leave', '2030-03-07', '2030-03-11')).toBe(''); // Thu, Fri, (weekend), Mon
    const me = await forEmployee('2030-03', 'ME');
    expect(me).toMatchObject({ unpaid_days: '3', half_pay_days: '0', month_working_days: '21' });
    expect(me!.applications).toEqual([
      expect.objectContaining({ leave_type: 'Unpaid Leave', start_date: '2030-03-07', end_date: '2030-03-11', days_in_month: 3, unpaid_days: 3, half_pay_days: 0 }),
    ]);
  });

  it('unpaid leave counted in calendar days counts every day, split at the month end', async () => {
    expect(await record('YOU', 'Unpaid Sabbatical', '2030-03-29', '2030-04-02')).toBe('');
    expect((await forEmployee('2030-03', 'YOU'))!.unpaid_days).toBe('3'); // 29, 30, 31 March
    expect((await forEmployee('2030-04', 'YOU'))!.unpaid_days).toBe('2'); // 1, 2 April
  });

  it('half-pay days are the last days of an application spanning two months', async () => {
    // 15 working days: 12 in April (15-30), 3 in May (1-3). 10 at full pay, so the last 5 are at half pay:
    // 3 in May and 2 in April.
    expect(await record('ME', 'Sick Leave', '2030-04-15', '2030-05-03')).toBe('');
    expect(Number((await rows<{ h: string }>(`select half_pay_days h from leave_application where "Leave Type" = 'Sick Leave'`))[0].h)).toBe(5);
    const april = await forEmployee('2030-04', 'ME');
    expect(april).toMatchObject({ unpaid_days: '0', half_pay_days: '2' });
    expect(april!.applications[0]).toMatchObject({ leave_type: 'Sick Leave', days_in_month: 12, half_pay_days: 2, unpaid_days: 0 });
    expect(await forEmployee('2030-05', 'ME')).toMatchObject({ unpaid_days: '0', half_pay_days: '3' });
  });

  it('a month with only full-pay leave has nothing to deduct', async () => {
    expect(await record('YOU', 'Annual Leave', '2030-06-03', '2030-06-04')).toBe('');
    expect(await forEmployee('2030-06', 'YOU')).toBeUndefined();
  });

  it('rejected, cancelled and pending leave is ignored', async () => {
    expect(await record('YOU', 'Unpaid Leave', '2030-03-04', '2030-03-05', 'pending')).toBe('');
    expect(await record('YOU', 'Unpaid Leave', '2030-03-12', '2030-03-13', 'rejected')).toBe('');
    // approved, then cancelled
    expect(await record('YOU', 'Unpaid Leave', '2030-03-18', '2030-03-19')).toBe('');
    expect((await forEmployee('2030-03', 'YOU'))!.unpaid_days).toBe('5');
    await asUser(db, HR, () => db.query(`update leave_application set status = 'cancelled' where "Employee Number" = 'YOU' and "Start Date" = '2030-03-18'`));
    expect((await forEmployee('2030-03', 'YOU'))!.unpaid_days).toBe('3');
  });

  it("another company's leave is invisible", async () => {
    await db.exec(`insert into leave_application (tenant_id, "Employee Number", name, "Leave Type", "Start Date", "End Date", status)
                   values ('${B}', 'OTHER', 'Otto', 'Unpaid Leave', '2030-03-04', '2030-03-05', 'approved')`);
    expect((await deductions('2030-03')).map((r) => r.employee_number)).toEqual(['ME', 'YOU']);
    expect((await deductions('2030-03', PAY_B)).map((r) => r.employee_number)).toEqual(['OTHER']);
  });

  it('only payroll may ask, and only for a month', async () => {
    expect(await asUser(db, STAFF, () => run(`select * from leave_pay_deductions('2030-03')`))).toMatch(/Only payroll/);
    expect(await asUser(db, HR, () => run(`select * from leave_pay_deductions('2030-03')`))).toMatch(/Only payroll/);
    expect(await asUser(db, PAY, () => run(`select * from leave_pay_deductions('March')`))).toMatch(/should look like 2026-09/);
  });

  it('payslips keep the deduction and its lines', async () => {
    await db.exec(`update employees set onboarding_status = 'approved' where "Employee Number" = 'ME'`);
    expect(await asUser(db, PAY, () => run(`insert into salary_history (employee_id, employee_name, pay_period, basic_salary, gross_pay, net_pay, leave_deduction, leave_items)
      values ('ME', 'Mia Me', '2030-03', 30000, 27000, 25000, 3000, '[{"name": "Unpaid Leave", "kind": "unpaid", "days": 3, "daily_rate": 1000, "amount": 3000}]')`))).toBe('');
    expect(await asUser(db, PAY, () => rows(`select leave_deduction, leave_items->0->>'name' n from salary_history where employee_id = 'ME'`))).toEqual([
      { leave_deduction: '3000', n: 'Unpaid Leave' },
    ]);
  });
});
