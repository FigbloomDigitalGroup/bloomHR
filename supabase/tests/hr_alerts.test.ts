// @vitest-environment node
//
// HR is alerted when an employee has used all their sick and annual leave for the year (FIG-879): once, when the leave
// that uses the last day is approved, for the people who run leave, and never to the employee.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const HR = '00000000-0000-0000-0000-00000000f301';

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
// HR records leave already approved: its days come off at once
const record = (type: string, start: string, end: string) => asUser(db, HR, () => run(
  `insert into leave_application ("Employee Number", name, "Leave Type", "Start Date", "End Date", status)
   values ('ME', 'Mia Me', '${type}', '${start}', '${end}', 'approved')`));
const alerts = async () =>
  (await rows<{ title: string; message: string }>(
    `select title, message from hr_notifications where employee_number = 'ME' and notification_type = 'leave_exhausted'`));

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${HR}', 'hr@a.co', 'HR', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values ('HR', array['leaves', 'employees'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", tenant_id) values ('ME', 'Mia', 'Me', 'me@a.co', '${A}');
    select seed_default_leave_types('${A}');
    -- small allowances: 2 days of sick leave, 3 of annual leave (the whole year can be booked ahead)
    update leave_policies set days_allotted = 2 where leave_type_id = (select id from leave_types where tenant_id = '${A}' and name = 'Sick Leave');
    update leave_policies set days_allotted = 3 where leave_type_id = (select id from leave_types where tenant_id = '${A}' and name = 'Annual Leave');
  `);
}, 120000);

describe('all sick and annual leave used', () => {
  it('no alert while either still has days', async () => {
    expect(await record('Sick Leave', '2030-03-04', '2030-03-05')).toBe(''); // sick used up
    expect(await alerts()).toEqual([]);
    expect(await record('Annual Leave', '2030-03-11', '2030-03-12')).toBe(''); // 1 annual day left
    expect(await alerts()).toEqual([]);
  });

  it('alerts HR once the last day is used', async () => {
    expect(await record('Annual Leave', '2030-03-18', '2030-03-18')).toBe('');
    const a = await alerts();
    expect(a).toHaveLength(1);
    expect(a[0].title).toBe('All sick and annual leave used');
    expect(a[0].message).toMatch(/^Mia Me has used all their sick leave \(half-pay days included\) and all their annual leave for 2030/);
  });

  it('only once a year', async () => {
    await db.exec(`update leave_policies set days_allotted = 4 where leave_type_id = (select id from leave_types where tenant_id = '${A}' and name = 'Annual Leave')`);
    expect(await record('Annual Leave', '2030-03-25', '2030-03-25')).toBe('');
    expect(await alerts()).toHaveLength(1);
  });

  it('is for HR: not shown or emailed to the employee, emailed to people who run leave', async () => {
    expect((await rows<{ v: boolean }>(`select hr_only_notification('leave_exhausted') v`))[0].v).toBe(true);
    expect((await rows<{ v: string[] }>(`select hr_alert_modules('leave_exhausted') v`))[0].v).toEqual(['leaves']);
    expect((await rows<{ v: string[] }>(`select hr_alert_modules('casual_limit') v`))[0].v).toEqual(['work-records', 'payroll']);
  });
});
