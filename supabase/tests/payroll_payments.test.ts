// @vitest-environment node
//
// Payments of an approved payroll run, by M-Pesa or bank (FIG-744): one row per employee per run, written only by
// the server, read by payroll users; each channel's worker claims queued payments of approved runs; a run can't be
// reopened once money has gone out.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const PAY = '00000000-0000-0000-0000-00000000ad01'; // payroll user, company A
const STAFF = '00000000-0000-0000-0000-00000000ad02';
const OTHER = '00000000-0000-0000-0000-00000000ad03'; // payroll user, company B

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const runId = async (period: string, tenant = A) =>
  (await rows<{ id: string }>(`select id from payroll_runs where tenant_id = '${tenant}' and pay_period = '${period}'`))[0].id;
/** as the server (service role bypasses RLS; the test superuser stands in for it) */
const queue = (run: string, emp: string, tenant = A, status = 'queued') =>
  db.exec(`insert into payroll_payments (tenant_id, run_id, employee_number, channel, phone, amount, status)
           values ('${tenant}', '${run}', '${emp}', 'mpesa', '254712345678', 1000, '${status}')`);
const queueBank = (run: string, emp: string) =>
  db.exec(`insert into payroll_payments (tenant_id, run_id, employee_number, channel, bank_name, account_number, amount)
           values ('${A}', '${run}', '${emp}', 'bank', 'KCB', '1100223344', 2500.50)`);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values ('${PAY}', 'pay@a.co'), ('${STAFF}', 'e1@a.co'), ('${OTHER}', 'pay@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${PAY}', 'pay@a.co', 'FINANCE', '${A}'), ('${STAFF}', 'e1@a.co', 'STAFF', '${A}'), ('${OTHER}', 'pay@b.co', 'FINANCE', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('FINANCE', array['payroll'], '${A}'), ('STAFF', array['dashboard'], '${A}'), ('FINANCE', array['payroll'], '${B}');
    insert into employees ("Employee Number", "First Name", "Work Email", tenant_id) values
      ('E1', 'Ann', 'e1@a.co', '${A}'), ('E2', 'Ben', 'e2@a.co', '${A}'), ('E3', 'Cy', 'e3@a.co', '${A}');
  `);
  // October: approved. November: a draft. Company B: approved.
  await asUser(db, PAY, () =>
    db.exec(`
      insert into salary_history (employee_id, pay_period, net_pay) values ('E1', '2026-10', 1000), ('E2', '2026-10', 2000), ('E3', '2026-10', 3000);
      insert into salary_history (employee_id, pay_period, net_pay) values ('E1', '2026-11', 1000);
      update payroll_runs set status = 'approved' where pay_period = '2026-10';
    `)
  );
  await asUser(db, OTHER, () =>
    db.exec(`
      insert into salary_history (employee_id, pay_period, net_pay) values ('X1', '2026-10', 500);
      update payroll_runs set status = 'approved' where pay_period = '2026-10';
    `)
  );
}, 120000);

describe('who sees and writes payment records', () => {
  it('payroll users read their own company only; staff read none', async () => {
    await queue(await runId('2026-10'), 'E1');
    await queue(await runId('2026-10', B), 'X1', B);
    const mine = await asUser(db, PAY, () => rows<{ employee_number: string }>(`select employee_number from payroll_payments`));
    expect(mine.map((r) => r.employee_number)).toEqual(['E1']);
    expect(await asUser(db, STAFF, () => rows(`select * from payroll_payments`))).toHaveLength(0);
  });

  it('only the server writes them: a payroll user can neither add nor mark one paid', async () => {
    const october = await runId('2026-10');
    await expect(
      asUser(db, PAY, () =>
        db.exec(
          `insert into payroll_payments (run_id, employee_number, channel, phone, amount) values ('${october}', 'E2', 'mpesa', '254712345678', 5)`
        )
      )
    ).rejects.toThrow(/row-level security/);
    await asUser(db, PAY, () => db.exec(`update payroll_payments set status = 'paid', receipt = 'FAKE'`));
    await asUser(db, PAY, () => db.exec(`delete from payroll_payments`));
    expect(await rows(`select status, receipt from payroll_payments where employee_number = 'E1'`)).toEqual([{ status: 'queued', receipt: null }]);
  });

  it('allows one payment per employee per run, for more than 0, with somewhere to send it', async () => {
    const october = await runId('2026-10');
    const insert = (cols: string, values: string) =>
      db.exec(`insert into payroll_payments (tenant_id, run_id, employee_number, ${cols}) values ('${A}', '${october}', 'E9', ${values})`);
    await expect(queue(october, 'E1')).rejects.toThrow(/duplicate key|unique/);
    await expect(insert('channel, phone, amount', `'mpesa', '0712345678', 10`)).rejects.toThrow(/check constraint/); // not 2547...
    await expect(insert('channel, phone, amount', `'mpesa', '254712345678', 0`)).rejects.toThrow(/check constraint/);
    await expect(insert('channel, amount', `'bank', 10`)).rejects.toThrow(/check constraint/); // no bank details
    await expect(insert('channel, bank_name, account_number, amount', `'bank', 'KCB', 'ABC', 10`)).rejects.toThrow(/check constraint/);
    await expect(insert('channel, phone, amount', `'cash', '254712345678', 10`)).rejects.toThrow(/check constraint/);
  });
});

describe('a worker claims a batch of its channel', () => {
  it('takes queued payments of approved runs only, marks them sending with a fresh request id each', async () => {
    const october = await runId('2026-10');
    await queue(october, 'E2');
    await queueBank(october, 'E3');
    await queue(await runId('2026-11'), 'E1'); // a draft run: must not be paid
    const claimed = await rows<{ employee_number: string; status: string; attempts: number; request_id: string }>(
      `select employee_number, status, attempts, request_id from claim_payroll_payments('mpesa', 10) order by employee_number`
    );
    expect(claimed.map((c) => `${c.employee_number}:${c.status}:${c.attempts}`)).toEqual(['E1:sending:1', 'E2:sending:1', 'X1:sending:1']);
    expect(new Set(claimed.map((c) => c.request_id)).size).toBe(3);
    expect(claimed.every((c) => c.request_id.startsWith('PAYROLL-'))).toBe(true);
    const bank = await rows<{ employee_number: string; amount: string }>(`select employee_number, amount from claim_payroll_payments('bank', 10)`);
    expect(bank).toEqual([{ employee_number: 'E3', amount: '2500.50' }]);
    const draft = await rows<{ status: string }>(
      `select p.status from payroll_payments p join payroll_runs r on r.id = p.run_id where r.pay_period = '2026-11'`
    );
    expect(draft).toEqual([{ status: 'queued' }]);
  });

  it('respects the batch size and claims nothing twice', async () => {
    await queue(await runId('2026-10', B), 'X2', B);
    await queue(await runId('2026-10', B), 'X3', B);
    expect(await rows(`select * from claim_payroll_payments('mpesa', 0)`)).toHaveLength(0);
    expect(await rows(`select * from claim_payroll_payments('mpesa', 1)`)).toHaveLength(1);
    expect(await rows(`select * from claim_payroll_payments('mpesa', 5)`)).toHaveLength(1);
    expect(await rows(`select * from claim_payroll_payments('mpesa', 5)`)).toHaveLength(0);
  });

  it('is for the server only', async () => {
    await expect(asUser(db, PAY, () => db.exec(`select claim_payroll_payments('mpesa', 10)`))).rejects.toThrow(/permission denied/);
  });
});

describe('reopening an approved run', () => {
  it('is refused once money has gone out', async () => {
    await expect(asUser(db, PAY, () => db.exec(`update payroll_runs set status = 'draft' where pay_period = '2026-10'`))).rejects.toThrow(
      /can't be reopened: payments for it have already been sent/
    );
  });

  it('is allowed while payments are only queued or failed, and clears them so approving again queues fresh amounts', async () => {
    await asUser(db, PAY, () =>
      db.exec(`
        insert into salary_history (employee_id, pay_period, net_pay) values ('E1', '2026-12', 1000);
        update payroll_runs set status = 'approved' where pay_period = '2026-12';
      `)
    );
    const december = await runId('2026-12');
    await queue(december, 'E1');
    await queue(december, 'E2', A, 'failed');
    await asUser(db, PAY, () => db.exec(`update payroll_runs set status = 'draft' where pay_period = '2026-12'`));
    expect(await rows(`select * from payroll_payments where run_id = '${december}'`)).toHaveLength(0);
    // and the draft can then be discarded
    await asUser(db, PAY, () => db.exec(`delete from payroll_runs where pay_period = '2026-12'`));
    expect(await rows(`select * from payroll_runs where pay_period = '2026-12'`)).toHaveLength(0);
  });
});
