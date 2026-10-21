// @vitest-environment node
//
// A new employee-number prefix for everyone (MCL-000123 -> FBL-000123), with everything keyed by the number following.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-000000000002';
const ADMIN = '00000000-0000-0000-0000-00000000f301';
const HR = '00000000-0000-0000-0000-00000000f302';
const ME = '00000000-0000-0000-0000-00000000f303';
const BOSS = '00000000-0000-0000-0000-00000000f304';

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
const numbers = async (tenant = A) =>
  (await rows<{ n: string }>(`select "Employee Number" n from employees where tenant_id = '${tenant}' order by 1`)).map((r) => r.n);
const renumber = (user: string, from: string, to: string) =>
  asUser(db, user, () => run(`select renumber_employees('${from}', '${to}')`));

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co') on conflict do nothing`);
  for (const [id, email, role, num, first] of [
    [ADMIN, 'adm@a.co', 'ADMIN', 'MCL-000001', 'Ada'], [HR, 'hr@a.co', 'HR', 'MCL-000002', 'Hana'],
    [ME, 'me@a.co', 'STAFF', 'MCL-000003', 'Mia'], [BOSS, 'boss@a.co', 'STAFF', 'MCL-000004', 'Bo'],
  ]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id, full_name) values ('${id}', '${email}', '${role}', '${A}', '${first}');
      insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", tenant_id) values ('${num}', '${first}', 'X', '${email}', '${A}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['leaves', 'employees'], '${A}'), ('STAFF', array['dashboard'], '${A}'), ('ADMIN', array['settings'], '${A}');
    -- someone kept their own number, and another company uses MCL too
    insert into employees ("Employee Number", "First Name", "Last Name", tenant_id) values ('OWN-7', 'Olu', 'X', '${A}'), ('MCL-000001', 'Bea', 'X', '${B}');
    update employees set "Leave Approver" = 'MCL-000004' where "Employee Number" = 'MCL-000003' and tenant_id = '${A}';
    select seed_default_leave_types('${A}');
    update leave_policies set balance_rule = 'none';
    insert into company_payroll_settings (tenant_id, employee_number_prefix) values ('${A}', 'MCL-')
      on conflict (tenant_id) do update set employee_number_prefix = 'MCL-';
    insert into payroll_runs (pay_period, status, tenant_id) values ('2026-09', 'draft', '${A}');
    insert into payroll_payments (tenant_id, run_id, employee_number, channel, phone, amount)
      select '${A}', id, 'MCL-000003', 'mpesa', '254700000000', 100 from payroll_runs where tenant_id = '${A}' and pay_period = '2026-09';
  `);
  const sick = (await rows<{ id: string }>(`select id from leave_types where tenant_id = '${A}' and name = 'Sick Leave'`))[0].id;
  await asUser(db, HR, () => db.query(`select set_leave_entitlement('MCL-000003', '${sick}', 28, 2026)`));
  await asUser(db, ME, () => db.query(
    `insert into leave_application ("Employee Number", name, "Leave Type", "Start Date", "End Date", status)
     values ('MCL-000003', 'Mia X', 'Annual Leave', '2030-11-04', '2030-11-06', 'pending')`));
}, 120000);

describe('renumber_employees', () => {
  it('only an administrator or Settings', async () => {
    expect(await renumber(HR, 'MCL-', 'FBL-')).toMatch(/Only an administrator/);
    expect(await renumber(ME, 'MCL-', 'FBL-')).toMatch(/Only an administrator/);
    expect(await numbers()).toContain('MCL-000001');
  });

  it('refuses, changing nothing, when a new number is already someone\'s', async () => {
    await db.exec(`insert into employees ("Employee Number", "First Name", tenant_id) values ('FBL-000002', 'Dup', '${A}')`);
    expect(await renumber(ADMIN, 'MCL-', 'FBL-')).toMatch(/Nothing was changed: these numbers are already someone's: FBL-000002/);
    expect(await numbers()).toContain('MCL-000002');
    await db.exec(`delete from employees where "Employee Number" = 'FBL-000002' and tenant_id = '${A}'`);
  });

  it('changes the prefix of everyone who has it, and everything keyed by the number follows', async () => {
    const n = await asUser(db, ADMIN, () => rows<{ n: number }>(`select renumber_employees('MCL-', 'FBL-') n`));
    expect(n[0].n).toBe(4);
    expect(await numbers()).toEqual(['FBL-000001', 'FBL-000002', 'FBL-000003', 'FBL-000004', 'OWN-7']);
    // the other company is untouched
    expect(await numbers(B)).toEqual(['MCL-000001']);

    const has = async (sql: string) => (await rows(sql)).length;
    expect(await has(`select 1 from leave_application where "Employee Number" = 'FBL-000003'`)).toBe(1);
    expect(await has(`select 1 from approval_requests where requester_employee_number = 'FBL-000003'`)).toBe(1);
    expect(await has(`select 1 from leave_entitlements where employee_number = 'FBL-000003'`)).toBe(1);
    expect(await has(`select 1 from payroll_payments where employee_number = 'FBL-000003'`)).toBe(1);
    expect(await has(`select 1 from employees where "Leave Approver" = 'FBL-000004'`)).toBe(1);
    for (const [table, col] of [['leave_application', '"Employee Number"'], ['leave_entitlements', 'employee_number'],
      ['payroll_payments', 'employee_number'], ['approval_requests', 'requester_employee_number']]) {
      expect(await has(`select 1 from ${table} where tenant_id = '${A}' and ${col} like 'MCL-%'`)).toBe(0);
    }
  });

  it('new employees get the new prefix', async () => {
    expect((await rows<{ p: string }>(`select employee_number_prefix p from company_payroll_settings where tenant_id = '${A}'`))[0].p).toBe('FBL-');
    await asUser(db, HR, () => db.query(`insert into employees ("First Name", "Last Name", "Work Email") values ('New', 'Hire', 'new@a.co')`));
    expect((await rows<{ n: string }>(`select "Employee Number" n from employees where "Work Email" = 'new@a.co'`))[0].n).toMatch(/^FBL-\d{6}$/);
  });

  it('checks the prefixes', async () => {
    expect(await renumber(ADMIN, '', 'FBL-')).toMatch(/up to 12 letters/);
    expect(await renumber(ADMIN, 'FBL-', 'FBL-')).toMatch(/the same as the old one/);
    expect(await renumber(ADMIN, 'FBL-', 'no spaces')).toMatch(/up to 12 letters/);
  });
});
