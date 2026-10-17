// @vitest-environment node
//
// Overtime (FIG-889): hours per day, rated by the kind of day (a working day, a day off in the employee's week, a
// company holiday), entered by the supervisor or payroll (approved at once) or requested by the employee (waits for
// approval), locked once the month's payroll is approved, and given to payroll per employee for the month.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const PAY = '00000000-0000-0000-0000-00000000e801';
const SUP = '00000000-0000-0000-0000-00000000e802';
const W1 = '00000000-0000-0000-0000-00000000e803';
const W3 = '00000000-0000-0000-0000-00000000e804';
const PAY_B = '00000000-0000-0000-0000-00000000e805';
const FARM = '00000000-0000-0000-0000-00000000e8d1';

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
const as = (user: string, sql: string) => asUser(db, user, () => run(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const add = (user: string, emp: string, day: string, hours: number | string, extra = '') =>
  as(user, `insert into overtime_entries (employee_number, work_date, hours${extra ? ', note' : ''})
            values ('${emp}', '${day}', ${hours}${extra ? `, '${extra}'` : ''})`);
const entry = async (emp: string, day: string) =>
  (await rows<{ id: string; status: string; source: string; day_type: string; hours: string; decided_by: string | null }>(
    `select id, status, source, day_type, hours, decided_by from overtime_entries where employee_number = '${emp}' and work_date = '${day}'`))[0];

interface MonthRow {
  employee_number: string;
  normal_hours: string;
  rest_hours: string;
  holiday_hours: string;
  over_cap_hours: string;
  entries: { id: string; work_date: string; day_type: string; hours: number; paid_hours: number }[];
}
const month = (period: string, user = PAY) => read<MonthRow>(user, `select * from overtime_month('${period}')`);
const monthFor = async (period: string, emp: string) => (await month(period)).find((r) => r.employee_number === emp);

// September 2026: Tuesday 1st, Saturday 5th, Sunday 6th, Monday 7th
beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values
      ('${PAY}', 'pay@a.co'), ('${SUP}', 'sup@a.co'), ('${W1}', 'w1@a.co'), ('${W3}', 'w3@a.co'), ('${PAY_B}', 'pay@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${PAY}', 'pay@a.co', 'FINANCE', '${A}'), ('${SUP}', 'sup@a.co', 'STAFF', '${A}'),
      ('${W1}', 'w1@a.co', 'STAFF', '${A}'), ('${W3}', 'w3@a.co', 'STAFF', '${A}'), ('${PAY_B}', 'pay@b.co', 'FINANCE', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('FINANCE', array['payroll'], '${A}'), ('STAFF', array['dashboard'], '${A}'), ('FINANCE', array['payroll'], '${B}');
    insert into departments (id, tenant_id, name, work_week) values ('${FARM}', '${A}', 'Farm', '{1,1,1,1,1,0.5,0}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", manager_email, regional_manager, department_id, tenant_id) values
      ('S1', 'Sam', 'Sup', 'sup@a.co', null, null, null, '${A}'),
      ('W1', 'Wanjiru', 'One', 'w1@a.co', ' Sup@A.co ', null, null, '${A}'),
      ('W2', 'Otieno', 'Two', 'w2@a.co', null, 'sup@a.co', '${FARM}', '${A}'),
      ('W3', 'Achieng', 'Three', 'w3@a.co', 'someone@a.co', null, null, '${A}'),
      ('X1', 'Xena', 'Other', 'x1@b.co', null, null, null, '${B}');
    insert into employees ("Employee Number", "First Name", "Last Name", worker_kind, daily_rate, tenant_id) values
      ('C1', 'Kamau', 'Casual', 'casual', 800, '${A}');
    delete from holidays where tenant_id = '${A}';
    insert into holidays (tenant_id, name, date, recurring) values
      ('${A}', 'A company holiday', '2026-09-08', false),
      ('${A}', 'Every year on 10 September', '2020-09-10', true);
  `);
}, 120000);

describe('the kind of day', () => {
  it('a working day, a day off in the week, a company holiday (also one that recurs every year)', async () => {
    expect(await add(SUP, 'W1', '2026-09-07', 2)).toBe(''); // Monday
    expect(await add(SUP, 'W1', '2026-09-05', 4)).toBe(''); // Saturday
    expect(await add(SUP, 'W1', '2026-09-08', 3)).toBe(''); // the holiday
    expect(await add(SUP, 'W1', '2026-09-10', 1)).toBe(''); // the recurring holiday
    expect((await entry('W1', '2026-09-07')).day_type).toBe('normal');
    expect((await entry('W1', '2026-09-05')).day_type).toBe('rest');
    expect((await entry('W1', '2026-09-08')).day_type).toBe('holiday');
    expect((await entry('W1', '2026-09-10')).day_type).toBe('holiday');
  });

  it("a half-day Saturday in the department's week counts as a working day; Sunday is a rest day", async () => {
    expect(await add(SUP, 'W2', '2026-09-12', 2)).toBe('');
    expect(await add(SUP, 'W2', '2026-09-13', 5)).toBe('');
    expect((await entry('W2', '2026-09-12')).day_type).toBe('normal');
    expect((await entry('W2', '2026-09-13')).day_type).toBe('rest');
  });

  it('a holiday added later changes the kind of day of open entries', async () => {
    expect(await add(SUP, 'W1', '2026-09-14', 2)).toBe('');
    expect((await entry('W1', '2026-09-14')).day_type).toBe('normal');
    await db.exec(`insert into holidays (tenant_id, name, date) values ('${A}', 'Late holiday', '2026-09-14')`);
    expect((await entry('W1', '2026-09-14')).day_type).toBe('holiday');
    await db.exec(`delete from holidays where name = 'Late holiday'`);
    expect((await entry('W1', '2026-09-14')).day_type).toBe('normal');
  });
});

describe('who enters and approves', () => {
  it("the supervisor's entries are approved at once; they can't enter for someone outside their team", async () => {
    expect(await entry('W1', '2026-09-07')).toMatchObject({ status: 'approved', source: 'supervisor', decided_by: SUP });
    expect(await add(SUP, 'W3', '2026-09-07', 2)).toMatch(/row-level security|your team/);
    expect(await add(W3, 'W1', '2026-09-15', 2)).toMatch(/row-level security|your team/);
  });

  it("payroll enters anyone's overtime, approved", async () => {
    expect(await add(PAY, 'W3', '2026-09-07', 1.5)).toBe('');
    expect(await entry('W3', '2026-09-07')).toMatchObject({ status: 'approved', source: 'payroll', hours: '1.50' });
  });

  it('an employee requests their own: it waits, they cannot approve it, the supervisor does and they hear', async () => {
    expect(await asUser(db, W1, () => run(`insert into overtime_entries (work_date, hours, note) values ('2026-09-16', 3, 'Harvest')`))).toBe('');
    const e = await entry('W1', '2026-09-16');
    expect(e).toMatchObject({ status: 'submitted', source: 'self', decided_by: null });
    expect(await as(W1, `update overtime_entries set status = 'approved' where id = '${e.id}'`)).toMatch(/Someone else must approve/);
    expect(await as(SUP, `update overtime_entries set status = 'approved' where id = '${e.id}'`)).toBe('');
    expect((await entry('W1', '2026-09-16')).status).toBe('approved');
    const notes = await rows<{ title: string; message: string }>(
      `select title, message from hr_notifications where employee_number = 'W1' and notification_type = 'approval_progress'`);
    expect(notes).toEqual([expect.objectContaining({ title: 'Overtime approved', message: expect.stringContaining('3 hours on 16 Sep 2026') })]);
    // once approved, the employee can't change it
    expect(await as(W1, `update overtime_entries set hours = 8 where id = '${e.id}'`)).toMatch(/Approved overtime/);
  });

  it('a rejection needs a reason; the employee can correct it and send it again', async () => {
    expect(await asUser(db, W1, () => run(`insert into overtime_entries (work_date, hours) values ('2026-09-17', 6)`))).toBe('');
    const e = await entry('W1', '2026-09-17');
    expect(await as(SUP, `update overtime_entries set status = 'rejected' where id = '${e.id}'`)).toMatch(/check/);
    expect(await as(SUP, `update overtime_entries set status = 'rejected', rejection_reason = 'Only 2 hours' where id = '${e.id}'`)).toBe('');
    expect((await rows<{ message: string }>(`select message from hr_notifications where title = 'Overtime not approved'`))[0].message)
      .toMatch(/Reason: Only 2 hours/);
    expect(await as(W1, `update overtime_entries set hours = 2 where id = '${e.id}'`)).toBe('');
    expect((await entry('W1', '2026-09-17')).status).toBe('submitted');
    expect(await as(PAY, `update overtime_entries set status = 'approved' where id = '${e.id}'`)).toBe('');
  });

  it('a supervisor requesting their own overtime waits for someone else', async () => {
    expect(await asUser(db, SUP, () => run(`insert into overtime_entries (work_date, hours) values ('2026-09-07', 2)`))).toBe('');
    expect((await entry('S1', '2026-09-07')).status).toBe('submitted');
  });

  it('refuses 0 hours, more than 24, a day still to come and a second entry for the same day', async () => {
    expect(await add(PAY, 'W3', '2026-09-08', 0)).toMatch(/check/);
    expect(await add(PAY, 'W3', '2026-09-08', 24.5)).toMatch(/check/);
    expect(await as(PAY, `insert into overtime_entries (employee_number, work_date, hours) values ('W3', current_date + 5, 2)`)).toMatch(/still to come/);
    expect(await add(PAY, 'W3', '2026-09-07', 2)).toMatch(/duplicate|unique/i);
  });

  it('the people list: a supervisor sees their team, payroll everyone (not casuals)', async () => {
    expect((await read<{ employee_number: string }>(SUP, `select employee_number from overtime_people()`)).map((r) => r.employee_number).sort())
      .toEqual(['W1', 'W2']);
    expect((await read<{ employee_number: string }>(PAY, `select employee_number from overtime_people()`)).map((r) => r.employee_number).sort())
      .toEqual(['S1', 'W1', 'W2', 'W3']);
    expect(await read(W3, `select employee_number from overtime_people()`)).toEqual([]);
  });
});

describe("the month's figures", () => {
  it('hours by kind of day per employee, with the entries behind them', async () => {
    const w1 = await monthFor('2026-09', 'W1');
    // normal: 7th (2) + 14th (2) + 16th (3) + 17th (2); rest: 5th (4); holiday: 8th (3) + 10th (1)
    expect(w1).toMatchObject({ normal_hours: '9', rest_hours: '4', holiday_hours: '4', over_cap_hours: '0' });
    expect(w1!.entries).toHaveLength(7);
    expect(w1!.entries[0]).toMatchObject({ work_date: '2026-09-05', day_type: 'rest', hours: 4, paid_hours: 4 });
    // waiting requests are not paid
    expect(await monthFor('2026-09', 'S1')).toBeUndefined();
    expect(await monthFor('2026-08', 'W1')).toBeUndefined();
  });

  it('a monthly cap pays the first hours of the month and shows the rest as over the cap', async () => {
    expect(await as(PAY, `insert into company_payroll_settings (overtime_monthly_cap) values (10)`)).toBe('');
    // in date order: 5th 4 (rest), 7th 2, 8th 3 (holiday), 10th 1 (holiday) = 10; the rest is over the cap
    expect(await monthFor('2026-09', 'W1')).toMatchObject({ normal_hours: '2', rest_hours: '4', holiday_hours: '4', over_cap_hours: '7' });
    expect(await as(PAY, `update company_payroll_settings set overtime_monthly_cap = null`)).toBe('');
  });

  it('settings are checked: multipliers from 1 to 5, monthly hours more than 0', async () => {
    expect(await as(PAY, `update company_payroll_settings set overtime_normal_multiplier = 0.5`)).toMatch(/check/);
    expect(await as(PAY, `update company_payroll_settings set overtime_monthly_hours = 0`)).toMatch(/check/);
    expect(await read(PAY, `select overtime_normal_multiplier, overtime_rest_multiplier, overtime_holiday_multiplier, overtime_monthly_hours from company_payroll_settings`))
      .toEqual([{ overtime_normal_multiplier: '1.50', overtime_rest_multiplier: '2.00', overtime_holiday_multiplier: '2.00', overtime_monthly_hours: '225.00' }]);
  });

  it('casual workers get no overtime: refused when entered, and left out if they became casual later', async () => {
    expect(await add(PAY, 'C1', '2026-09-07', 2)).toMatch(/Casual workers are paid by the day/);
    expect(await add(PAY, 'W3', '2026-09-09', 2)).toBe('');
    expect((await monthFor('2026-09', 'W3'))!.normal_hours).toBe('3.5');
    await db.exec(`update employees set worker_kind = 'casual', daily_rate = 900 where "Employee Number" = 'W3'`);
    expect(await monthFor('2026-09', 'W3')).toBeUndefined();
    await db.exec(`update employees set worker_kind = 'employee', daily_rate = null where "Employee Number" = 'W3'`);
  });

  it('an excluded department (and the departments under it) gets no overtime', async () => {
    expect(await as(PAY, `update company_payroll_settings set overtime_excluded_departments = '{${FARM}}'`)).toBe('');
    expect(await monthFor('2026-09', 'W2')).toBeUndefined();
    expect(await add(SUP, 'W2', '2026-09-15', 1)).toMatch(/department doesn't get overtime/);
    expect((await read<{ employee_number: string; excluded_reason: string | null }>(SUP, `select employee_number, excluded_reason from overtime_people() where employee_number = 'W2'`))[0].excluded_reason)
      .toMatch(/department/);
    expect(await as(PAY, `update company_payroll_settings set overtime_excluded_departments = '{}'`)).toBe('');
    expect((await monthFor('2026-09', 'W2'))!.normal_hours).toBe('2');
  });

  it('turned off: nothing is paid and nothing can be entered', async () => {
    expect(await as(PAY, `update company_payroll_settings set overtime_enabled = false`)).toBe('');
    expect(await month('2026-09')).toEqual([]);
    expect(await add(PAY, 'W3', '2026-09-15', 1)).toMatch(/turned off/);
    expect(await as(PAY, `update company_payroll_settings set overtime_enabled = true`)).toBe('');
  });

  it('only payroll may ask, for a month', async () => {
    expect(await as(SUP, `select * from overtime_month('2026-09')`)).toMatch(/Only payroll/);
    expect(await as(PAY, `select * from overtime_month('September')`)).toMatch(/should look like 2026-09/);
  });

  it("another company's overtime is invisible, and its payroll can't record for this company's people", async () => {
    expect(await add(PAY_B, 'X1', '2026-09-07', 2)).toBe('');
    expect((await month('2026-09')).map((r) => r.employee_number)).toEqual(['W1', 'W2', 'W3']);
    expect((await month('2026-09', PAY_B)).map((r) => r.employee_number)).toEqual(['X1']);
    expect(await read(PAY_B, `select 1 from overtime_entries where employee_number = 'W1'`)).toEqual([]);
    expect(await add(PAY_B, 'W1', '2026-09-21', 2)).toMatch(/Unknown employee/);
  });

  it("payroll sets an employee's own hourly rate; staff can't", async () => {
    expect(await as(PAY, `select set_overtime_rate('W1', 250.456)`)).toBe('');
    expect((await rows<{ r: string }>(`select "Overtime Rate" r from employees where "Employee Number" = 'W1'`))[0].r).toBe('250.46');
    expect(await as(W3, `select set_overtime_rate('W1', 999)`)).toMatch(/Only payroll/);
    expect(await as(PAY, `select set_overtime_rate('W1', 0)`)).toMatch(/more than 0/);
    expect(await as(PAY, `select set_overtime_rate('W1', null)`)).toBe('');
  });

  it('payslips keep the overtime pay and its lines', async () => {
    await db.exec(`update employees set onboarding_status = 'approved' where "Employee Number" = 'W1'`);
    expect(await as(PAY, `insert into salary_history (employee_id, employee_name, pay_period, basic_salary, gross_pay, net_pay, overtime_pay, overtime_items)
      values ('W1', 'Wanjiru One', '2026-09', 45000, 47000, 40000, 2000, '[{"name": "Overtime (normal days)", "day_type": "normal", "hours": 6, "amount": 2000}]')`)).toBe('');
    expect(await read(PAY, `select overtime_pay, overtime_items->0->>'name' n from salary_history where employee_id = 'W1'`))
      .toEqual([{ overtime_pay: '2000', n: 'Overtime (normal days)' }]);
  });
});

describe('locked once payroll is approved', () => {
  it("no adding, changing or removing in an approved month; other months stay open", async () => {
    await db.exec(`insert into payroll_runs (tenant_id, pay_period, status) values ('${A}', '2026-09', 'approved') on conflict (tenant_id, pay_period) do update set status = 'approved'`);
    const e = await entry('W1', '2026-09-07');
    expect(await as(PAY, `update overtime_entries set hours = 5 where id = '${e.id}'`)).toMatch(/Payroll for Sep 2026 is approved/);
    expect(await as(SUP, `delete from overtime_entries where id = '${e.id}'`)).toMatch(/Payroll for Sep 2026 is approved/);
    expect(await add(PAY, 'W3', '2026-09-22', 1)).toMatch(/record this overtime in an open month/);
    // a holiday added now leaves the approved month's entries alone
    await db.exec(`insert into holidays (tenant_id, name, date) values ('${A}', 'Too late', '2026-09-07')`);
    expect((await entry('W1', '2026-09-07')).day_type).toBe('normal');
    expect(await add(PAY, 'W3', '2026-10-01', 1)).toBe('');
  });
});
