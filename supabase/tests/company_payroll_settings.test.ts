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
