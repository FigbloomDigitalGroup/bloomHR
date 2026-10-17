// @vitest-environment node
//
// Leave rules each company sets per leave type (FIG-875): the days a leave covers worked out in the database, the
// balance checked when someone applies and again when the leave is approved (and taken from the balance then),
// a most-days-per-application limit, notice, once a month, and how far ahead of what is earned people may book.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const HR = '00000000-0000-0000-0000-00000000fb01';
const STAFF = '00000000-0000-0000-0000-00000000fb02';

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
const typeId = async (name: string) => (await rows<{ id: string }>(`select id from leave_types where tenant_id = '${A}' and name = '${name}'`))[0].id;
const setPolicy = async (name: string, set: string) =>
  db.exec(`update leave_policies set ${set} where leave_type_id = '${await typeId(name)}'`);
const day = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1); // a weekday
  return d.toISOString().slice(0, 10);
};
// an application made by the signed-in user; returns '' or the error
const apply = (user: string, employee: string, type: string, start: string, end: string, status = 'pending') =>
  asUser(db, user, () => run(
    `insert into leave_application ("Employee Number", name, "Leave Type", "Start Date", "End Date", days, status)
     values ('${employee}', '${employee}', '${type}', '${start}', '${end}', 99, '${status}')`));
const lastId = async (employee: string, type: string) =>
  (await rows<{ id: string; days: string }>(
    `select id, days from leave_application where "Employee Number" = '${employee}' and "Leave Type" = '${type}' order by time_added desc limit 1`))[0];
const used = async (employee: string, type: string, year: number, month = 0) =>
  Number((await rows<{ used_days: string }>(
    `select used_days from leave_balances where employee_number = '${employee}' and leave_type_id = '${await typeId(type)}' and year = ${year} and month = ${month}`))[0]?.used_days ?? 0);
const approve = async (leaveId: string) => {
  const r = (await rows<{ id: string }>(`select id from approval_requests where record_id = '${leaveId}'`))[0];
  return asUser(db, HR, () => run(`select decide_approval('${r.id}', 'approved', '')`));
};
const clear = (employee: string) => db.exec(`
  delete from leave_application where "Employee Number" = '${employee}';
  delete from leave_balances where employee_number = '${employee}';
  delete from leave_entitlements where employee_number = '${employee}';`);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co'), ('${STAFF}', 'e1@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${STAFF}', 'e1@a.co', 'STAFF', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values ('HR', array['leaves', 'employees'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", tenant_id) values
      ('E1', 'Ann', 'One', 'e1@a.co', '${A}'), ('E2', 'Ben', 'Two', 'e2@a.co', '${A}'), ('E-HR', 'Hana', 'Hr', 'hr@a.co', '${A}');
    select seed_default_leave_types('${A}');
    -- these tests pick dates near today: the country's public holidays are tested in public_holidays.test.ts
    delete from holidays where source = 'auto';
    -- documents with leave are tested in leave_documents.test.ts
    update leave_policies set document_name = null, followup_document_name = null;
    -- the sums below use 24 days of annual leave, and compassionate leave of 3 days a month
    update leave_policies set days_allotted = 24
      where leave_type_id = (select id from leave_types where tenant_id = '${A}' and name = 'Annual Leave');
    insert into leave_types (tenant_id, name, is_deductible) values ('${A}', 'Compassionate Leave', true);
    insert into leave_policies (tenant_id, leave_type_id, days_allotted, accrual_method)
      select '${A}', id, 3, 'monthly_non_cumulative' from leave_types where tenant_id = '${A}' and name = 'Compassionate Leave';
    insert into holidays (name, date, recurring, tenant_id) values ('Madaraka', '2030-06-01', true, '${A}'), ('One-off', '2030-03-05', false, '${A}');
  `);
}, 120000);

describe('policy settings', () => {
  it('every leave type gets the new settings, with maternity and paternity counted in calendar days', async () => {
    const p = await rows<{ name: string; count_days: string; balance_rule: string; one_per_month: boolean; min_notice_days: number; max_days_per_request: string | null }>(
      `select t.name, p.count_days, p.balance_rule, p.one_per_month, p.min_notice_days, p.max_days_per_request
       from current_leave_policies p join leave_types t on t.id = p.leave_type_id where t.tenant_id = '${A}' order by t.name`);
    const by = Object.fromEntries(p.map((r) => [r.name, r]));
    expect(by['Annual Leave']).toMatchObject({ count_days: 'working', balance_rule: 'full_year', one_per_month: false, min_notice_days: 0, max_days_per_request: null });
    expect(by['Maternity Leave'].count_days).toBe('calendar');
    expect(by['Paternity Leave'].count_days).toBe('calendar');
  });

  it('refuses settings that make no sense', async () => {
    expect(await run(`update leave_policies set balance_rule = 'sometimes'`)).toMatch(/leave_policies_rules_check/);
    expect(await run(`update leave_policies set max_days_per_request = 0`)).toMatch(/leave_policies_rules_check/);
    expect(await run(`update leave_policies set min_notice_days = -1`)).toMatch(/leave_policies_rules_check/);
  });
});

describe('counting days', () => {
  it('working days leave out weekends and the company holidays, whatever the form sent', async () => {
    // Mon 4 to Sun 10 March 2030, with a holiday on Tue 5th: 4 working days
    expect(await apply(STAFF, 'E1', 'Sick Leave', '2030-03-04', '2030-03-10')).toBe('');
    expect(Number((await lastId('E1', 'Sick Leave')).days)).toBe(4);
    // a recurring holiday falls on the same day every year: Madaraka Day, Mon 1 June 2026
    expect(Number((await rows<{ n: string }>(`select leave_days_for('${A}', 'E1', '2026-06-01', '2026-06-05', false) n`))[0].n)).toBe(4);
    await clear('E1');
  });

  it('calendar days count every day', async () => {
    expect(await apply(STAFF, 'E1', 'Maternity Leave', '2030-03-04', '2030-03-10')).toBe('');
    expect(Number((await lastId('E1', 'Maternity Leave')).days)).toBe(7);
    await clear('E1');
  });

  it('refuses dates that need no leave, dates the wrong way round, and unknown leave types', async () => {
    expect(await apply(STAFF, 'E1', 'Sick Leave', '2030-03-09', '2030-03-10')).toMatch(/days off or public holidays/);
    expect(await apply(STAFF, 'E1', 'Sick Leave', '2030-03-10', '2030-03-04')).toMatch(/end date that is the same day or later/);
    expect(await apply(STAFF, 'E1', 'Holiday In Spain', '2030-03-04', '2030-03-04')).toMatch(/Choose a leave type/);
  });
});

describe('the balance when applying', () => {
  it('counts what is already waiting for approval', async () => {
    // Sick Leave: 14 days a year, all at once
    expect(await apply(STAFF, 'E1', 'Sick Leave', '2030-04-01', '2030-04-12')).toBe(''); // 10 days
    const err = await apply(STAFF, 'E1', 'Sick Leave', '2030-05-06', '2030-05-10'); // 5 more
    expect(err).toMatch(/Not enough Sick Leave left: 4 days free to book \(10 more waiting for approval\), and this needs 5/);
    expect(await apply(STAFF, 'E1', 'Sick Leave', '2030-05-06', '2030-05-09')).toBe(''); // 4 fits
    await clear('E1');
  });

  it('leave earned month by month: the whole year can be booked ahead, unless the rule says only what is earned', async () => {
    // 2030 is in the future, so one month (2 of the 24 days) counts as earned
    expect(await apply(STAFF, 'E1', 'Annual Leave', '2030-02-04', '2030-02-15')).toBe(''); // 10 days of 24
    await clear('E1');
    await setPolicy('Annual Leave', `balance_rule = 'earned'`);
    expect(await apply(STAFF, 'E1', 'Annual Leave', '2030-02-04', '2030-02-06')).toMatch(/Not enough Annual Leave left: 2 days free to book/);
    expect(await apply(STAFF, 'E1', 'Annual Leave', '2030-02-04', '2030-02-05')).toBe('');
    await clear('E1');
    await setPolicy('Annual Leave', `balance_rule = 'none'`);
    expect(await apply(STAFF, 'E1', 'Annual Leave', '2030-02-04', '2030-03-29')).toBe(''); // 39 working days
    await setPolicy('Annual Leave', `balance_rule = 'full_year'`);
    await clear('E1');
  });

  it('leave not taken from a balance has no limit', async () => {
    // Maternity Leave is not deductible
    expect(await apply(STAFF, 'E1', 'Maternity Leave', '2030-03-01', '2030-06-30')).toBe('');
    await clear('E1');
  });
});

describe('rules for one application', () => {
  it('a most-days limit, which HR entering leave for someone may go past', async () => {
    await setPolicy('Sick Leave', 'max_days_per_request = 3');
    expect(await apply(STAFF, 'E1', 'Sick Leave', '2030-03-11', '2030-03-14')).toMatch(/Sick Leave allows at most 3 days in one application \(this is 4\)/);
    expect(await apply(HR, 'E1', 'Sick Leave', '2030-03-11', '2030-03-14')).toBe('');
    // ...but HR applying for themselves keeps to it
    expect(await apply(HR, 'E-HR', 'Sick Leave', '2030-03-11', '2030-03-14')).toMatch(/at most 3 days/);
    await setPolicy('Sick Leave', 'max_days_per_request = null');
    await clear('E1');
  });

  it('notice: 0 lets people apply for days already past; otherwise the start must be far enough ahead', async () => {
    expect(await apply(STAFF, 'E1', 'Sick Leave', day(-10), day(-10))).not.toMatch(/notice/);
    await setPolicy('Study/Exam Leave', 'min_notice_days = 14');
    expect(await apply(STAFF, 'E1', 'Study/Exam Leave', day(3), day(3))).toMatch(/Study\/Exam Leave needs 14 days' notice/);
    expect(await apply(HR, 'E1', 'Study/Exam Leave', day(3), day(3))).not.toMatch(/notice/);
    await setPolicy('Study/Exam Leave', 'min_notice_days = 0');
    await clear('E1');
  });

  it('once a month is off unless the company turns it on, and a rejected application does not count', async () => {
    expect(await apply(STAFF, 'E1', 'Sick Leave', '2030-03-11', '2030-03-11')).toBe('');
    expect(await apply(STAFF, 'E1', 'Sick Leave', '2030-03-12', '2030-03-12')).toBe('');
    await setPolicy('Sick Leave', 'one_per_month = true');
    expect(await apply(STAFF, 'E1', 'Sick Leave', '2030-03-13', '2030-03-13')).toMatch(/already applied for Sick Leave this month/);
    await db.exec(`select set_config('app.approval_decision', 'on', false);
                   update leave_application set status = 'rejected' where "Employee Number" = 'E1';
                   select set_config('app.approval_decision', '', false);`);
    expect(await apply(STAFF, 'E1', 'Sick Leave', '2030-03-13', '2030-03-13')).toBe('');
    await setPolicy('Sick Leave', 'one_per_month = false');
    await clear('E1');
  });

  it('the service role is not checked', async () => {
    expect(await run(`insert into leave_application ("Employee Number", "Leave Type", "Start Date", "End Date", days, status, tenant_id)
                      values ('E1', 'Sick Leave', '2030-01-01', '2030-12-31', 260, 'pending', '${A}')`)).toBe('');
    await clear('E1');
  });
});

describe('the balance moves on approval', () => {
  it('final approval takes the days; rejecting approved leave gives them back', async () => {
    expect(await apply(STAFF, 'E1', 'Sick Leave', '2030-03-11', '2030-03-13')).toBe('');
    const leave = await lastId('E1', 'Sick Leave');
    expect(await used('E1', 'Sick Leave', 2030)).toBe(0);
    expect(await approve(leave.id)).toBe('');
    expect((await rows<{ status: string }>(`select status from leave_application where id = '${leave.id}'`))[0].status).toBe('approved');
    expect(await used('E1', 'Sick Leave', 2030)).toBe(3);
    await asUser(db, HR, () => db.query(`update leave_application set status = 'rejected' where id = '${leave.id}'`));
    expect(await used('E1', 'Sick Leave', 2030)).toBe(0);
    const kinds = await rows<{ change_type: string }>(
      `select a.change_type from leave_balance_adjustments a join leave_balances b on b.id = a.leave_balance_id
       where b.employee_number = 'E1' order by a.created_at, a.id`);
    expect(kinds.map((k) => k.change_type)).toEqual(['approval_deduction', 'approval_reversal']);
    await clear('E1');
  });

  it('an approval that would overdraw is refused, and nothing changes', async () => {
    expect(await apply(STAFF, 'E1', 'Sick Leave', '2030-03-11', '2030-03-15')).toBe(''); // 5 days
    const leave = await lastId('E1', 'Sick Leave');
    const sick = await typeId('Sick Leave');
    await asUser(db, HR, () => db.query(`select set_leave_entitlement('E1', '${sick}', 2, 2030)`));
    expect(await approve(leave.id)).toMatch(/Not enough Sick Leave left for E1: 2 days free, and this leave needs 5/);
    expect((await rows<{ status: string }>(`select status from leave_application where id = '${leave.id}'`))[0].status).toBe('pending');
    expect(await used('E1', 'Sick Leave', 2030)).toBe(0);
    await clear('E1');
  });

  it('leave HR enters already approved is taken at once, within the balance', async () => {
    expect(await apply(HR, 'E1', 'Sick Leave', '2030-03-11', '2030-03-12', 'approved')).toBe('');
    expect(await used('E1', 'Sick Leave', 2030)).toBe(2);
    expect(await apply(HR, 'E1', 'Sick Leave', '2030-04-01', '2030-04-19', 'approved')).toMatch(/Not enough Sick Leave left for E1: 12 days free/);
    await clear('E1');
  });

  it('leave that resets monthly draws on its month', async () => {
    // Compassionate Leave: 3 days a month
    expect(await apply(HR, 'E1', 'Compassionate Leave', '2030-03-11', '2030-03-13', 'approved')).toBe('');
    expect(await used('E1', 'Compassionate Leave', 2030, 3)).toBe(3);
    expect(await apply(STAFF, 'E1', 'Compassionate Leave', '2030-03-18', '2030-03-18')).toMatch(/Not enough Compassionate Leave left: 0 days/);
    expect(await apply(STAFF, 'E1', 'Compassionate Leave', '2030-04-01', '2030-04-01')).toBe('');
    await clear('E1');
  });

  it('the old browser call no longer deducts a second time', async () => {
    expect(await apply(HR, 'E1', 'Sick Leave', '2030-03-11', '2030-03-12', 'approved')).toBe('');
    const sick = await typeId('Sick Leave');
    await asUser(db, HR, () => db.query(`select increment_leave_balance_used_days('E1', '${sick}', 2030, 2, 0)`));
    expect(await used('E1', 'Sick Leave', 2030)).toBe(2);
    await clear('E1');
  });
});

describe('checking before submitting', () => {
  it('gives the days, what is free and what is wrong, for one’s own leave', async () => {
    const r = (await asUser(db, STAFF, () =>
      rows<{ c: { days: number; available: number; problems: string[] } }>(`select leave_request_check('E1', 'Sick Leave', '2030-03-04', '2030-03-08') c`)))[0].c;
    expect(r).toMatchObject({ days: 4, available: 14, problems: [] });
    const bad = (await asUser(db, STAFF, () =>
      rows<{ c: { problems: string[] } }>(`select leave_request_check('E1', 'Sick Leave', '2030-04-01', '2030-04-30') c`)))[0].c;
    expect(bad.problems[0]).toMatch(/Not enough Sick Leave left/);
  });

  it('only HR may check a colleague', async () => {
    expect(await asUser(db, STAFF, () => run(`select leave_request_check('E2', 'Sick Leave', '2030-03-04', '2030-03-08')`))).toMatch(/only check your own/);
    expect(await asUser(db, HR, () => run(`select leave_request_check('E2', 'Sick Leave', '2030-03-04', '2030-03-08')`))).toBe('');
  });
});
