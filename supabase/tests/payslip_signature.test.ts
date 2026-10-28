// @vitest-environment node
//
// The approver's signature on payslips (migration 20261028200000_payslip_signature.sql): approving a country keeps the
// approver's drawn signature and name, staff read them with their payslip's run, nobody sets them by hand, reopening
// clears them, a non-image is refused, and NSSF/SHA/ID numbers are off the payslip design by default.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const PAY = '00000000-0000-0000-0000-00000000f101';
const SK = '00000000-0000-0000-0000-00000000f102'; // staff, K2

const MIGRATION = join(__dirname, '..', 'migrations', '20261028200000_payslip_signature.sql');
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgo=';
const PERIOD = '2030-03';

let db: PGlite;
let runId: string;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const kenya = async () =>
  (await rows<{ status: string; approved_signature: string | null; approved_signer: string | null }>(
    `select status, approved_signature, approved_signer from payroll_run_countries where run_id = '${runId}' and country = 'Kenya'`,
  ))[0];
const approve = (signature: string | null, signer: string | null) =>
  as(PAY, `select set_payroll_countries_status('${runId}', array['Kenya'], 'approved', ${signature ? `'${signature}'` : 'null'}, ${signer ? `'${signer}'` : 'null'})`);
const reopen = () => as(PAY, `select set_payroll_countries_status('${runId}', array['Kenya'], 'draft')`);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${PAY}', 'pay@a.co'), ('${SK}', 'k2@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${PAY}', 'pay@a.co', 'FINANCE', '${A}'), ('${SK}', 'k2@a.co', 'STAFF', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('FINANCE', array['payroll'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into employees ("Employee Number", "First Name", "Work Email", onboarding_status, tenant_id) values
      ('K2', 'Kerubo', 'k2@a.co', 'approved', '${A}');
    insert into salary_history (employee_id, employee_name, pay_period, gross_pay, net_pay, tenant_id)
      values ('K2', 'Kerubo', '${PERIOD}', 1000, 1000, '${A}');
  `);
  runId = (await rows<{ id: string }>(`select id from payroll_runs where tenant_id = '${A}' and pay_period = '${PERIOD}'`))[0].id;
}, 120_000);

describe("the approver's signature", () => {
  it('is kept with the country when it is approved, and staff read it with their payslip', async () => {
    await approve(SIGNATURE, 'Wanjiru Kamau');
    expect(await kenya()).toEqual({ status: 'approved', approved_signature: SIGNATURE, approved_signer: 'Wanjiru Kamau' });
    const mine = await read<{ approved_signature: string; approved_signer: string }>(SK, `select * from payslip_run_signature('K2', '${PERIOD}')`);
    expect(mine[0].approved_signature).toBe(SIGNATURE);
    expect(mine[0].approved_signer).toBe('Wanjiru Kamau');
  });

  it("can't be changed by hand", async () => {
    await as(PAY, `update payroll_run_countries set approved_signature = null, approved_signer = 'Someone else' where run_id = '${runId}'`);
    expect(await kenya()).toEqual({ status: 'approved', approved_signature: SIGNATURE, approved_signer: 'Wanjiru Kamau' });
  });

  it('is cleared by reopening, and approving without one leaves it empty', async () => {
    await reopen();
    expect(await kenya()).toEqual({ status: 'draft', approved_signature: null, approved_signer: null });
    await approve(null, null);
    expect(await kenya()).toEqual({ status: 'approved', approved_signature: null, approved_signer: null });
  });

  it('refuses anything but a PNG image', async () => {
    await reopen();
    await expect(approve('javascript:alert(1)', 'X')).rejects.toThrow(/PNG image/);
    expect((await kenya()).status).toBe('draft');
  });

  it("doesn't leak into a later approval in the same session", async () => {
    await approve(SIGNATURE, 'Wanjiru Kamau');
    await reopen();
    await as(PAY, `update payroll_run_countries set status = 'approved' where run_id = '${runId}'`);
    expect(await kenya()).toEqual({ status: 'approved', approved_signature: null, approved_signer: null });
  });

  it('stays the approver\'s when the country is marked paid', async () => {
    await reopen();
    await approve(SIGNATURE, 'Wanjiru Kamau');
    await as(PAY, `select set_payroll_countries_status('${runId}', array['Kenya'], 'paid', '${SIGNATURE}', 'Paid by')`);
    expect(await kenya()).toEqual({ status: 'paid', approved_signature: SIGNATURE, approved_signer: 'Wanjiru Kamau' });
  });
});

describe('the payslip design', () => {
  it('has NSSF, SHA and ID numbers off by default', async () => {
    await as(PAY, `insert into payslip_settings default values`).catch(() => undefined);
    const r = await rows<{ show_statutory_numbers: boolean }>(`select show_statutory_numbers from payslip_settings where tenant_id = '${A}'`);
    expect(r[0]?.show_statutory_numbers ?? false).toBe(false);
  });
});

describe('the migration', () => {
  it('runs again safely', async () => {
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    expect(await kenya()).toEqual({ status: 'paid', approved_signature: SIGNATURE, approved_signer: 'Wanjiru Kamau' });
  });
});
