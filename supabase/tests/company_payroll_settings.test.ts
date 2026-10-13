// @vitest-environment node
//
// A company's payroll settings (20261013100000): the Equity account salaries are paid from. Payroll only.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const PAY = '00000000-0000-0000-0000-00000000a701';
const HR = '00000000-0000-0000-0000-00000000a702';

let db: PGlite;
const run = async (sql: string) => {
  try {
    await db.query(sql);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};

beforeAll(async () => {
  db = await bootLiveDb();
  for (const [id, email, role] of [[PAY, 'pay@a.co', 'FINANCE'], [HR, 'hr@a.co', 'HR']]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${A}');
    `);
  }
  await db.exec(`insert into role_permissions (role_name, permissions, tenant_id) values ('FINANCE', array['payroll'], '${A}'), ('HR', array['employees'], '${A}');`);
}, 120000);

describe('company payroll settings', () => {
  it('payroll saves the Equity account salaries are paid from', async () => {
    expect(await asUser(db, PAY, () => run(`insert into company_payroll_settings (equity_debit_account) values ('0123456789012')`))).toBe('');
    expect((await asUser(db, PAY, () => db.query(`select equity_debit_account from company_payroll_settings`))).rows).toEqual([{ equity_debit_account: '0123456789012' }]);
  });

  it('only digits make an account number', async () => {
    expect(await asUser(db, PAY, () => run(`update company_payroll_settings set equity_debit_account = '0123-ABC'`))).toMatch(/check/);
  });

  it('people without payroll neither see nor change it', async () => {
    expect((await asUser(db, HR, () => db.query(`select 1 from company_payroll_settings`))).rows).toEqual([]);
    expect(await asUser(db, HR, () => run(`insert into company_payroll_settings (equity_debit_account) values ('999999')`))).toMatch(/row-level security|duplicate/);
  });
});

describe('employer KRA PIN (20261013500000)', () => {
  it('payroll saves it in the company’s KRA PIN format', async () => {
    expect(await asUser(db, PAY, () => run(`update company_payroll_settings set employer_kra_pin = 'P051234567X'`))).toBe('');
    expect(await asUser(db, PAY, () => run(`update company_payroll_settings set employer_kra_pin = 'X12'`))).toMatch(/check/);
  });

  it('every member reads the company’s name and PIN for their P9, and nothing else of the settings', async () => {
    const [d] = (await asUser(db, HR, () => db.query<{ company_name: string; employer_kra_pin: string }>(`select * from company_tax_details()`))).rows;
    expect(d.employer_kra_pin).toBe('P051234567X');
    expect(d.company_name).toBeTruthy();
    expect((await asUser(db, HR, () => db.query(`select equity_debit_account from company_payroll_settings`))).rows).toEqual([]);
  });
});

describe('p9_payslips (20261013500000)', () => {
  const STAFF = '00000000-0000-0000-0000-00000000a703';
  const OTHER = '00000000-0000-0000-0000-00000000a704';
  let me = '';
  beforeAll(async () => {
    await db.exec(`
      insert into auth.users (id, email) values ('${STAFF}', 'me@a.co'), ('${OTHER}', 'them@a.co');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${STAFF}', 'me@a.co', 'STAFF', '${A}'), ('${OTHER}', 'them@a.co', 'STAFF', '${A}');
      insert into role_permissions (role_name, permissions, tenant_id) values ('STAFF', array['dashboard'], '${A}');
      insert into employees ("Employee Number", "First Name", "Work Email", onboarding_status, tenant_id) values
        ('E-ME', 'Me', 'me@a.co', 'approved', '${A}'), ('E-THEM', 'Them', 'them@a.co', 'approved', '${A}');
      insert into salary_history (employee_id, pay_period, gross_pay, net_pay, tenant_id) values
        ('E-ME', '2026-08', 100, 90, '${A}'), ('E-ME', '2026-09', 100, 90, '${A}'), ('E-ME', '2025-12', 100, 90, '${A}');
      update payroll_runs set status = 'approved' where pay_period in ('2026-08', '2025-12');
    `);
    me = (await db.query<{ id: string }>(`select id from employees where "Employee Number" = 'E-ME'`)).rows[0].id;
  });

  it('gives the employee their payslips of the year from approved months only', async () => {
    const r = await asUser(db, STAFF, () => db.query<{ pay_period: string }>(`select pay_period from p9_payslips('${me}', 2026)`));
    expect(r.rows.map((x) => x.pay_period)).toEqual(['2026-08']);
  });

  it('payroll sees anyone’s; a colleague sees nobody else’s', async () => {
    expect((await asUser(db, PAY, () => db.query(`select 1 from p9_payslips('${me}', 2026)`))).rows).toHaveLength(1);
    expect(await asUser(db, OTHER, () => run(`select * from p9_payslips('${me}', 2026)`))).toMatch(/only see your own P9/);
  });
});
