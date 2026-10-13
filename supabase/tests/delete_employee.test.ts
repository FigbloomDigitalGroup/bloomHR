// @vitest-environment node
//
// Deleting an employee (20261013300000): HR checks first, then deletes; refused for your own record and for anyone
// with payslips in an approved month; their records go with them, pending invitations are cancelled, and the files
// and login are handed back for the app to remove.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const HR = '00000000-0000-0000-0000-00000000ad01'; // also employee E-HR
const STAFF = '00000000-0000-0000-0000-00000000ad02'; // E-GONE, has a login
const PAY = '00000000-0000-0000-0000-00000000ad03';

let db: PGlite;
const ids: Record<string, string> = {};
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const run = async (sql: string) => {
  try {
    await db.query(sql);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const check = (as: string, n: string) =>
  asUser(db, as, async () => (await rows<{ r: Record<string, unknown> }>(`select delete_employee('${ids[n]}') r`))[0].r);

beforeAll(async () => {
  db = await bootLiveDb();
  for (const [id, email, role] of [[HR, 'hr@a.co', 'HR'], [STAFF, 'gone@a.co', 'STAFF'], [PAY, 'pay@a.co', 'PAYROLL']]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${A}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees'], '${A}'), ('STAFF', array['dashboard'], '${A}'), ('PAYROLL', array['payroll'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", onboarding_status, tenant_id) values
      ('E-HR', 'Hana', 'Rahma', 'hr@a.co', 'approved', '${A}'),
      ('E-GONE', 'Amina', 'Wanjiru', 'gone@a.co', 'invited', '${A}'),
      ('E-PAID', 'Peter', 'Kamau', 'paid@a.co', 'approved', '${A}');
    insert into leave_application ("Employee Number", status, tenant_id) values ('E-GONE', 'Pending', '${A}');
    insert into emergency_contact ("Employee Number", full_name, phone_number, tenant_id) values ('E-GONE', 'Halima', '0722000000', '${A}');
    insert into invitations (tenant_id, email, role, token_hash) values ('${A}', 'gone@a.co', 'STAFF', 'x');
    insert into salary_history (employee_id, pay_period, net_pay, tenant_id) values ('E-PAID', '2026-09', 1000, '${A}');
    update payroll_runs set status = 'approved' where pay_period = '2026-09';
  `);
  for (const n of ['E-HR', 'E-GONE', 'E-PAID']) ids[n] = (await rows<{ id: string }>(`select id from employees where "Employee Number" = '${n}'`))[0].id;
  await db.exec(`insert into employee_documents (employee_id, code, file_path, file_name, tenant_id) values ('${ids['E-GONE']}', 'cv', '${A}/${STAFF}/onboarding/cv.pdf', 'cv.pdf', '${A}')`);
}, 120000);

describe('checking first', () => {
  it('says what goes with the employee, deleting nothing', async () => {
    expect(await check(HR, 'E-GONE')).toEqual({
      employee_number: 'E-GONE', name: 'Amina Wanjiru', blocked: null, has_login: true, documents: 1, leave_applications: 1,
    });
    expect(await rows(`select 1 from employees where "Employee Number" = 'E-GONE'`)).toHaveLength(1);
  });

  it('says why someone with approved payslips, or your own record, can’t be deleted', async () => {
    expect((await check(HR, 'E-PAID')).blocked).toMatch(/approved payroll months.*Terminate them instead/);
    expect((await check(HR, 'E-HR')).blocked).toMatch(/your own employee record/);
  });
});

describe('deleting', () => {
  it('only HR deletes', async () => {
    expect(await asUser(db, STAFF, () => run(`select delete_employee('${ids['E-HR']}', true)`))).toMatch(/Only HR/);
    expect(await asUser(db, PAY, () => run(`select delete_employee('${ids['E-GONE']}', true)`))).toMatch(/Only HR/);
  });

  it('is refused when they have approved payslips, which stay', async () => {
    expect(await asUser(db, HR, () => run(`select delete_employee('${ids['E-PAID']}', true)`))).toMatch(/Terminate them instead/);
    expect(await rows(`select 1 from salary_history where employee_id = 'E-PAID'`)).toHaveLength(1);
  });

  it('removes the employee and what belongs to them, cancels their invitation, and hands back their files and login', async () => {
    const [{ r }] = await asUser(db, HR, () => rows<{ r: { login_user_id: string; files: string[] } }>(`select delete_employee('${ids['E-GONE']}', true) r`));
    expect(r.login_user_id).toBe(STAFF);
    expect(r.files).toEqual([`${A}/${STAFF}/onboarding/cv.pdf`]);
    expect(await rows(`select 1 from employees where "Employee Number" = 'E-GONE'`)).toEqual([]);
    expect(await rows(`select 1 from leave_application where "Employee Number" = 'E-GONE'`)).toEqual([]);
    expect(await rows(`select 1 from emergency_contact where "Employee Number" = 'E-GONE'`)).toEqual([]);
    expect(await rows(`select 1 from employee_documents`)).toEqual([]);
    expect(await rows(`select status from invitations where email = 'gone@a.co'`)).toEqual([{ status: 'revoked' }]);
  });

  it('is in the audit log', async () => {
    expect(await rows(`select record_key from audit_log where table_name = 'employees' and action_type = 'DELETE'`)).toEqual([{ record_key: 'E-GONE' }]);
  });
});
