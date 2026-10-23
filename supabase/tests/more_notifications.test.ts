// @vitest-environment node
//
// Notifications for everything HR, managers and payroll do that concerns an employee (20261013700000): each lands in
// the employee's bell (hr_notifications) with HR's reason where there is one; never for what they did themselves.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const U = {
  STAFF: '00000000-0000-0000-0000-00000000f101', // E-ME
  HR: '00000000-0000-0000-0000-00000000f103',
};

let db: PGlite;
type Note = { notification_type: string; title: string; message: string };
const mine = () => asUser(db, U.STAFF, async () => (await db.query<Note>(`select notification_type, title, message from hr_notifications order by id desc`)).rows);
// the employee's own (not the alerts for HR and finance, e.g. 'payment_due' when their advance is approved)
const latest = async () => (await mine()).filter((n) => n.notification_type !== 'payment_due')[0];
// what HR does in the app: signed in as HR (row-level security is not what these tests are about)
const asHR = async (sql: string) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${U.HR}', false)`);
  try {
    await db.exec(sql);
  } finally {
    await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
  }
};
// a decision on an advance or expense, written as its approval chain writes it (20261025700000): these tests are about
// the employee's notification, not who may decide
const decided = (sql: string) => asHR(`select set_config('app.approval_decision', 'on', false); ${sql}; select set_config('app.approval_decision', '', false)`);

beforeAll(async () => {
  db = await bootLiveDb();
  for (const [id, email, role] of [[U.STAFF, 'me@a.co', 'STAFF'], [U.HR, 'hr@a.co', 'HR']]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${A}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values ('STAFF', array['dashboard'], '${A}'), ('HR', array['employees'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", onboarding_status, tenant_id) values
      ('E-ME', 'Amina', 'Wanjiru', 'me@a.co', 'approved', '${A}'), ('E-THEM', 'Otieno', 'Ouma', 'them@a.co', 'approved', '${A}');
  `);
}, 120000);

describe('notifications for the employee', () => {
  it('salary advance approved, not approved (with the reason), paid', async () => {
    await db.exec(`insert into salary_advance (id, "Employee Number", "Amount Requested", tenant_id) values
      ('00000000-0000-0000-0000-0000000aa001', 'E-ME', 5000, '${A}'), ('00000000-0000-0000-0000-0000000aa002', 'E-ME', 9000, '${A}')`);
    await decided(`update salary_advance set status = 'approved', admin_adjusted_amount = 4000 where id = '00000000-0000-0000-0000-0000000aa001'`);
    expect(await latest()).toEqual({ notification_type: 'salary_advance_approved', title: 'Salary advance approved', message: 'Your salary advance of KES 4,000.00 was approved.' });
    await decided(`update salary_advance set status = 'rejected', admin_notes = 'Over the limit' where id = '00000000-0000-0000-0000-0000000aa002'`);
    expect((await latest()).message).toBe('Your salary advance request of KES 9,000.00 was not approved. Reason: Over the limit.');
    await decided(`update salary_advance set status = 'paid' where id = '00000000-0000-0000-0000-0000000aa001'`); // the M-Pesa callback
    expect(await latest()).toMatchObject({ notification_type: 'salary_advance_paid', message: 'Your salary advance of KES 4,000.00 has been paid.' });
  });

  it('loan not approved, with the reason', async () => {
    await db.exec(`insert into loan_requests (id, "Employee Number", "Loan Amount", tenant_id) values ('00000000-0000-0000-0000-0000000bb001', 'E-ME', 20000, '${A}')`);
    await asHR(`update loan_requests set status = 'Rejected', admin_notes = 'Existing loan' where id = '00000000-0000-0000-0000-0000000bb001'`);
    expect(await latest()).toMatchObject({ notification_type: 'loan_rejected', message: 'Your loan request of KES 20,000.00 was not approved. Reason: Existing loan.' });
  });

  it('payslip ready when the month is approved, salary paid when it is paid; each employee on the payroll', async () => {
    await db.exec(`insert into salary_history (employee_id, pay_period, gross_pay, net_pay, tenant_id) values
      ('E-ME', '2026-09', 100, 90, '${A}'), ('E-THEM', '2026-09', 100, 90, '${A}')`);
    await asHR(`update payroll_runs set status = 'approved' where pay_period = '2026-09'`);
    expect(await latest()).toEqual({ notification_type: 'payslip_ready', title: 'Payslip ready', message: 'Your payslip for September 2026 is ready. Open Payslips to see it.' });
    expect((await db.query(`select 1 from hr_notifications where employee_number = 'E-THEM' and notification_type = 'payslip_ready'`)).rows).toHaveLength(1);
    await asHR(`update payroll_runs set status = 'paid' where pay_period = '2026-09'`);
    expect(await latest()).toMatchObject({ notification_type: 'salary_paid', message: 'Your salary for September 2026 has been paid.' });
  });

  it('expense not approved, phone change approved, incident updated (not anonymous ones)', async () => {
    await db.exec(`insert into expenses (id, title, amount, employee_id, tenant_id) values ('00000000-0000-0000-0000-0000000cc001', 'Fuel', 1500, 'E-ME', '${A}')`);
    await decided(`update expenses set status = 'rejected', rejection_reason = 'No receipt' where id = '00000000-0000-0000-0000-0000000cc001'`);
    expect((await latest()).message).toBe('Your expense Fuel (KES 1,500.00) was not approved. Reason: No receipt.');

    await db.exec(`insert into phone_number_change_requests (id, employee_number, requested_phone, tenant_id) values ('00000000-0000-0000-0000-0000000dd001', 'E-ME', '0711000000', '${A}')`);
    await asHR(`update phone_number_change_requests set status = 'approved' where id = '00000000-0000-0000-0000-0000000dd001'`);
    expect((await latest()).message).toBe('Your phone number was changed to 0711000000.');

    // any allowed incident type will do
    const t = (await db.query<{ t: string }>(`select (regexp_match(pg_get_constraintdef(oid), '''([a-z_]+)'''))[1] as t from pg_constraint where conname = 'incident_reports_incident_type_check'`)).rows[0].t;
    await db.exec(`insert into incident_reports (id, employee_number, incident_type, severity, title, description, is_anonymous, tenant_id) values
      ('00000000-0000-0000-0000-0000000ee001', 'E-ME', '${t}', 'low', 'Broken chair', 'x', false, '${A}'),
      ('00000000-0000-0000-0000-0000000ee002', 'E-ME', '${t}', 'low', 'Anonymous one', 'x', true, '${A}')`);
    await asHR(`update incident_reports set status = 'resolved', resolution = 'Chair replaced' where id = '00000000-0000-0000-0000-0000000ee001'`);
    expect((await latest()).message).toBe('Your incident report "Broken chair" is now resolved. Resolution: Chair replaced.');
    const before = (await mine()).length;
    await asHR(`update incident_reports set status = 'resolved' where id = '00000000-0000-0000-0000-0000000ee002'`);
    expect((await mine()).length).toBe(before);
  });

  it('warning, suspension and its end, an employment change, leave scheduled by HR', async () => {
    await asHR(`insert into warnings (employee_id, type, severity, message, tenant_id) values ('E-ME', 'Lateness', 'medium', 'Late three times this month.', '${A}')`);
    expect(await latest()).toEqual({ notification_type: 'warning_issued', title: 'Warning: Lateness', message: 'Late three times this month.' });

    await asHR(`insert into hr_suspensions ("Employee Number", suspension_date, reactivation_date, suspension_reason, tenant_id) values ('E-ME', '2026-10-01', '2026-10-15', 'Investigation', '${A}')`);
    expect((await latest()).message).toBe('You are suspended from 01 Oct 2026 until 15 Oct 2026. Reason: Investigation.');
    await asHR(`update hr_suspensions set is_active = false where "Employee Number" = 'E-ME'`);
    expect((await latest()).notification_type).toBe('reactivated');

    await asHR(`insert into hr_lifecycle_history ("Employee Number", event_type, tenant_id) values ('E-ME', 'probation_confirmed', '${A}')`);
    expect((await latest()).message).toBe('Your probation is complete and your employment is confirmed.');

    await asHR(`insert into hr_leave_schedules ("Employee Number", leave_type, leave_start_date, leave_end_date, tenant_id) values ('E-ME', 'Annual', '2026-12-21', '2026-12-31', '${A}')`);
    expect((await latest()).message).toBe('HR scheduled Annual from 21 Dec 2026 to 31 Dec 2026 for you.');
  });

  it('a policy to accept, a task and an asset assigned', async () => {
    await asHR(`insert into company_policies (id, title, tenant_id) values ('00000000-0000-0000-0000-0000000ff001', 'Code of conduct', '${A}');
      insert into company_policy_versions (policy_id, version, body, content_hash, tenant_id) values ('00000000-0000-0000-0000-0000000ff001', 1, 'Be kind', 'h1', '${A}')`);
    expect(await latest()).toMatchObject({ notification_type: 'policy_to_accept', message: 'Please read and accept "Code of conduct" in Onboarding.' });

    await asHR(`insert into todos (title, assigned_to, tenant_id) values ('Send the report', 'E-ME', '${A}')`);
    expect((await latest()).message).toBe('You have been given a task: Send the report.');
    await asHR(`insert into todos (title, assigned_to, tenant_id) values ('Call the bank', '${U.STAFF}', '${A}')`); // by login id
    expect((await latest()).message).toBe('You have been given a task: Call the bank.');

    await asHR(`insert into assets (asset_name, asset_tag, assigned_to, tenant_id) values ('Laptop', 'FB-007', 'Amina Wanjiru (E-ME)', '${A}')`);
    expect((await latest()).message).toBe('Laptop (FB-007) is now assigned to you.');
  });

  it('not for what the employee does themselves', async () => {
    const before = (await mine()).length;
    await db.exec(`select set_config('request.jwt.claim.sub', '${U.STAFF}', false)`);
    await db.exec(`insert into todos (title, assigned_to, tenant_id) values ('My own to-do', 'E-ME', '${A}')`);
    await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
    expect((await mine()).length).toBe(before);
  });
});
