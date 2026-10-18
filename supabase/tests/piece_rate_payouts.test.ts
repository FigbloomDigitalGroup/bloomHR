// @vitest-environment node
//
// Piece rate stage 4 (FIG-812): payout batches. Who is picked by pay frequency, what is held back (employees: AHL and
// the reserve; contractors: withholding tax), the net in whole shillings and never below 0, nothing paid twice
// (approving marks the work paid out; cancelling releases it), the second approver, locked months, missing payment
// details, a worker's own payouts only, company isolation and running the migration again. Migration 20261020200000.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const PAY = '00000000-0000-0000-0000-00000000f001';
const PAY2 = '00000000-0000-0000-0000-00000000f002';
const SUP = '00000000-0000-0000-0000-00000000f003';
const W1 = '00000000-0000-0000-0000-00000000f004';
const C1 = '00000000-0000-0000-0000-00000000f005';
const OTHER = '00000000-0000-0000-0000-00000000f006';

const MIGRATION = join(__dirname, '..', 'migrations', '20261020200000_piece_rate_payouts.sql');
const TODAY = `(now() at time zone 'Africa/Nairobi')::date`;
/** day n (1 = the 1st) of last month: always in the past, and a whole month to work in */
const day = (n: number) => `((date_trunc('month', ${TODAY}) - interval '1 month')::date + ${n - 1})`;
const LAST_MONTH = day(1);

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const one = async <T = Record<string, unknown>>(user: string, sql: string) => (await read<T>(user, sql))[0];

const CRATES = `(select id from work_types where name = 'Crates' and tenant_id = '${A}')`;
const ODD = `(select id from work_types where name = 'Odd job' and tenant_id = '${A}')`;
const TINY = `(select id from work_types where name = 'Tiny' and tenant_id = '${A}')`;
const record = (user: string, emp: string, d: string, type: string, qty: number) =>
  as(user, `insert into work_entries (employee_number, work_date, work_type_id, quantity, status) values ('${emp}', ${d}, ${type}, ${qty}, 'submitted')`);

const create = async (user: string, kind: string, from: string, to: string, workers: string[] | null = null) =>
  (await one<{ id: string }>(user, `select create_work_payout_batch('${kind}', ${from}, ${to},
    ${workers ? `array[${workers.map((w) => `'${w}'`).join(',')}]` : 'null'}) id`)).id;

interface Line {
  employee_number: string; gross: string; ahl: string; reserve: string; wht: string; rounding: string; net: string;
  ahl_rate: string; reserve_rate: string; wht_rate: string; problem: string | null; payment_kind: string; phone: string | null;
  work_amount: string; jobs_amount: string;
}
const linesOf = (batch: string) => rows<Line>(`select * from work_payout_lines where batch_id = '${batch}' order by employee_number`);
const batch = async (id: string) =>
  (await rows<{ status: string; worker_count: number; flagged_count: number; net_total: string; gross_total: string }>(
    `select * from work_payout_batches where id = '${id}'`))[0];
const notes = (emp: string, type: string) =>
  rows<{ title: string; message: string }>(`select title, message from hr_notifications where employee_number = '${emp}' and notification_type = '${type}' order by id`);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values
      ('${PAY}', 'pay@a.co'), ('${PAY2}', 'pay2@a.co'), ('${SUP}', 'sup@a.co'), ('${W1}', 'w1@a.co'), ('${C1}', 'c1@a.co'),
      ('${OTHER}', 'x1@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${PAY}', 'pay@a.co', 'FINANCE', '${A}'), ('${PAY2}', 'pay2@a.co', 'FINANCE', '${A}'), ('${SUP}', 'sup@a.co', 'STAFF', '${A}'),
      ('${W1}', 'w1@a.co', 'STAFF', '${A}'), ('${C1}', 'c1@a.co', 'STAFF', '${A}'), ('${OTHER}', 'x1@b.co', 'FINANCE', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('FINANCE', array['work-records', 'payroll'], '${A}'), ('STAFF', array['dashboard'], '${A}'),
      ('FINANCE', array['work-records', 'payroll'], '${B}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", manager_email, worker_kind, pay_basis, pay_frequency,
                           wht_category, payment_method, "Mobile Number", "Bank", "Account Number", "ID Number", tenant_id) values
      ('P1', 'Pauline', 'Pay', 'pay@a.co', null, 'employee', 'salary', 'monthly', null, null, null, null, null, null, '${A}'),
      ('P2', 'Peter', 'Pay', 'pay2@a.co', null, 'employee', 'salary', 'monthly', null, null, null, null, null, null, '${A}'),
      ('S1', 'Sam', 'Super', 'sup@a.co', null, 'employee', 'salary', 'monthly', null, null, null, null, null, null, '${A}'),
      ('W1', 'Wanjiru', 'One', 'w1@a.co', 'sup@a.co', 'employee', 'work', 'daily', null, 'M-Pesa', '0712 345 678', null, null, 12345678, '${A}'),
      ('R1', 'Rose', 'Round', 'r1@a.co', 'sup@a.co', 'employee', 'work', 'daily', null, 'M-Pesa', '+254 722 000 111', null, null, null, '${A}'),
      ('C1', 'Chege', 'Contract', 'c1@a.co', 'sup@a.co', 'contractor', 'work', 'daily', 'contractual', 'M-Pesa', '0733000222', null, null, null, '${A}'),
      ('NP', 'Nora', 'NoPhone', 'np@a.co', 'sup@a.co', 'employee', 'work', 'daily', null, null, null, null, null, null, '${A}'),
      ('W2', 'Otieno', 'Weekly', 'w2@a.co', 'sup@a.co', 'employee', 'work', 'weekly', null, 'Bank Transfer', null, 'Equity Bank', '0123456789', null, '${A}'),
      ('C2', 'Grace', 'Consult', 'c2@a.co', 'sup@a.co', 'contractor', 'work', 'weekly', 'professional', 'Bank Transfer', null, 'KCB', '1100223344', null, '${A}'),
      ('J1', 'James', 'Jobs', 'j1@a.co', 'sup@a.co', 'employee', 'work', 'per_job', null, 'M-Pesa', '0711000333', null, null, null, '${A}'),
      ('T1', 'Tom', 'Tiny', 't1@a.co', 'sup@a.co', 'employee', 'work', 'monthly', null, 'M-Pesa', '0711000444', null, null, null, '${A}'),
      ('X1', 'Xena', 'Other', 'x1@b.co', null, 'employee', 'work', 'daily', null, 'M-Pesa', '0711000555', null, null, null, '${B}');
  `);
  await as(PAY, `insert into work_types (name, unit, rate) values ('Crates', 'crate', 50), ('Odd job', 'piece', 12.34), ('Tiny', 'piece', 0.5)`);
  // payroll's own entries count at once
  await record(PAY, 'W1', day(14), CRATES, 20); // 1,000
  await record(PAY, 'R1', day(14), ODD, 7); // 86.38
  await record(PAY, 'C1', day(14), CRATES, 20); // 1,000
  await record(PAY, 'NP', day(15), CRATES, 2); // 100
  await record(PAY, 'W2', day(14), CRATES, 10); // 500
  await record(PAY, 'C2', day(15), CRATES, 10); // 500
  await record(PAY, 'T1', day(14), TINY, 1); // 0.50
  // waiting for payroll (a supervisor's entry): not paid until approved
  await record(SUP, 'W1', day(15), CRATES, 4);
  // a contract job, approved last month
  await as(PAY, `insert into contract_jobs (employee_number, title, amount) values ('J1', 'Fence the block', 3000)`);
  await as(PAY, `update contract_jobs set status = 'completed' where title = 'Fence the block'`);
  await as(PAY, `update contract_jobs set status = 'approved' where title = 'Fence the block'`);
  await db.exec(`update contract_jobs set approved_at = ${day(10)}::timestamp + interval '9 hours' where title = 'Fence the block'`);
}, 120000);

let daily: string;

describe('making a batch', () => {
  it('picks workers by pay frequency: daily for daily, weekly for weekly', async () => {
    daily = await create(PAY, 'daily', day(14), day(15));
    expect((await linesOf(daily)).map((l) => l.employee_number)).toEqual(['C1', 'NP', 'R1', 'W1']);
    const b = await batch(daily);
    expect(b).toMatchObject({ status: 'draft', worker_count: 4, flagged_count: 1 });
  });

  it('only approved work: the supervisor entry waiting for payroll is left out', async () => {
    const w1 = (await linesOf(daily)).find((l) => l.employee_number === 'W1')!;
    expect(Number(w1.work_amount)).toBe(1000);
  });

  it('holds back AHL and the reserve from employees, and stores the rates used', async () => {
    const w1 = (await linesOf(daily)).find((l) => l.employee_number === 'W1')!;
    expect(w1).toMatchObject({ gross: '1000.00', ahl: '15.00', reserve: '100.00', wht: '0.00', rounding: '0.00', net: '885.00' });
    expect(w1).toMatchObject({ ahl_rate: '0.0150', reserve_rate: '0.1000', wht_rate: '0.0000', payment_kind: 'mobile', phone: '254712345678' });
  });

  it('rounds the net down to whole shillings, holding the cents back', async () => {
    const r1 = (await linesOf(daily)).find((l) => l.employee_number === 'R1')!;
    // 86.38: AHL 1.30 (1.2957), reserve 8.64 (8.638), 76.44 left: 76 paid, 0.44 held
    expect(r1).toMatchObject({ gross: '86.38', ahl: '1.30', reserve: '8.64', net: '76.00', rounding: '0.44', phone: '254722000111' });
  });

  it('takes withholding tax from contractors instead, with no reserve by default', async () => {
    const c1 = (await linesOf(daily)).find((l) => l.employee_number === 'C1')!;
    expect(c1).toMatchObject({ gross: '1000.00', ahl: '0.00', reserve: '0.00', wht: '30.00', net: '970.00', wht_rate: '0.0300' });
  });

  it('flags anyone with no payment details', async () => {
    const np = (await linesOf(daily)).find((l) => l.employee_number === 'NP')!;
    expect(np.problem).toBe('No valid M-Pesa number');
  });

  it('tells the other payroll people a batch waits for a second approver', async () => {
    const told = await notes('P2', 'approval_needed');
    expect(told.at(-1)?.title).toBe('Payout waiting for approval');
    expect(told.at(-1)?.message).toMatch(/4 workers.*Someone else must approve it/);
    expect(await notes('P1', 'approval_needed')).toHaveLength(0); // not whoever made it
  });

  it('only payroll makes batches', async () => {
    await expect(create(W1, 'daily', day(14), day(15))).rejects.toThrow(/Only payroll/);
    await expect(create(SUP, 'daily', day(14), day(15))).rejects.toThrow(/Only payroll/);
  });

  it('ad hoc needs workers picked; days to come and two months are refused', async () => {
    await expect(create(PAY, 'ad_hoc', day(1), day(20))).rejects.toThrow(/Pick who to pay/);
    await expect(create(PAY, 'daily', TODAY, `${TODAY} + 1`)).rejects.toThrow(/days still to come|one month/);
    await expect(create(PAY, 'weekly', `(${day(1)} - 3)`, day(2))).rejects.toThrow(/one month/);
  });
});

describe('approving', () => {
  it('needs someone other than who made it', async () => {
    await expect(as(PAY, `select approve_work_payout_batch('${daily}')`)).rejects.toThrow(/Someone other than who made/);
  });

  it('not while payment details are missing; removing the line clears it', async () => {
    await expect(as(PAY2, `select approve_work_payout_batch('${daily}')`)).rejects.toThrow(/payment details missing/);
    const np = (await linesOf(daily)).find((l) => l.employee_number === 'NP')!;
    await expect(as(W1, `select remove_work_payout_line((select id from work_payout_lines where employee_number = 'NP' limit 1))`)).rejects.toThrow(/Only payroll|No such line/);
    await as(PAY, `select remove_work_payout_line(id) from work_payout_lines where employee_number = 'NP' and batch_id = '${daily}'`);
    expect((await linesOf(daily)).map((l) => l.employee_number)).not.toContain('NP');
    expect(np).toBeTruthy();
    expect(await batch(daily)).toMatchObject({ worker_count: 3, flagged_count: 0, net_total: String((885 + 76 + 970).toFixed(2)) });
  });

  it('marks the work paid out and linked, and tells each worker once', async () => {
    await as(PAY2, `select approve_work_payout_batch('${daily}')`);
    expect((await batch(daily)).status).toBe('approved');
    const paid = await rows<{ employee_number: string; paid: boolean; linked: boolean }>(`
      select employee_number, paid_out_at is not null paid, payout_line_id is not null linked from work_entries
      where tenant_id = '${A}' and status = 'approved' and employee_number in ('W1', 'R1', 'C1', 'NP') order by employee_number`);
    expect(paid).toEqual([
      { employee_number: 'C1', paid: true, linked: true },
      { employee_number: 'NP', paid: false, linked: false },
      { employee_number: 'R1', paid: true, linked: true },
      { employee_number: 'W1', paid: true, linked: true },
    ]);
    const told = await notes('W1', 'employment_update');
    expect(told).toHaveLength(1);
    expect(told[0].message).toMatch(/^KES 885\.00 is being paid to you for work 14 \w{3}\. KES 115\.00 is held back/);
  });

  it('paid work is fixed: nobody changes it or moves its payout link', async () => {
    const id = (await rows<{ id: string }>(`select id from work_entries where employee_number = 'W1' and paid_out_at is not null`))[0].id;
    await expect(as(PAY, `update work_entries set quantity = 1 where id = '${id}'`)).rejects.toThrow(/paid out/);
    const free = (await rows<{ id: string }>(`select id from work_entries where employee_number = 'NP'`))[0].id;
    await expect(as(PAY, `update work_entries set payout_line_id = (select payout_line_id from work_entries where id = '${id}') where id = '${free}'`))
      .rejects.toThrow(/Payouts/);
    await expect(as(PAY, `update work_payout_lines set net = 0`)).rejects.toThrow(/permission denied/);
  });
});

describe('no double payment', () => {
  it('approved work is left out of later batches', async () => {
    const again = await create(PAY, 'daily', day(1), day(28));
    expect((await linesOf(again)).map((l) => l.employee_number)).toEqual(['NP']);
    await as(PAY, `select cancel_work_payout_batch('${again}', 'made by mistake')`);
    expect((await batch(again)).status).toBe('cancelled');
  });

  it("work in a draft isn't put in a second draft", async () => {
    const first = await create(PAY, 'weekly', day(14), day(20));
    const second = await create(PAY, 'weekly', day(14), day(20));
    expect((await linesOf(first)).map((l) => l.employee_number)).toEqual(['C2', 'W2']);
    expect((await batch(second)).worker_count).toBe(0);
    await as(PAY, `select cancel_work_payout_batch('${second}')`);

    // professional contractor: 5%
    const c2 = (await linesOf(first)).find((l) => l.employee_number === 'C2')!;
    expect(c2).toMatchObject({ gross: '500.00', wht: '25.00', net: '475.00', payment_kind: 'bank' });

    // cancelling an approved batch releases its work, and the workers are told
    await as(PAY2, `select approve_work_payout_batch('${first}')`);
    expect((await rows(`select 1 from work_entries where employee_number = 'W2' and paid_out_at is not null`))).toHaveLength(1);
    await as(PAY, `select cancel_work_payout_batch('${first}', 'wrong week')`);
    expect((await rows(`select 1 from work_entries where employee_number in ('W2', 'C2') and (paid_out_at is not null or payout_line_id is not null)`))).toHaveLength(0);
    expect((await notes('W2', 'employment_update')).map((n) => n.title)).toEqual(['Payout on its way', 'Payout cancelled']);

    const third = await create(PAY, 'weekly', day(14), day(20));
    expect((await linesOf(third)).map((l) => l.employee_number)).toEqual(['C2', 'W2']);
    await as(PAY2, `select approve_work_payout_batch('${third}')`);
    await as(PAY, `select mark_work_payout_exported('${third}')`);
    expect((await batch(third)).status).toBe('exported');
    await expect(as(PAY, `select cancel_work_payout_batch('${third}')`)).rejects.toThrow(/exported/);
  });
});

describe('contract jobs and ad hoc', () => {
  it('job completion pays approved, unpaid jobs of workers paid per job', async () => {
    const jobs = await create(PAY, 'job', day(1), day(28));
    const [j1] = await linesOf(jobs);
    expect(j1).toMatchObject({ employee_number: 'J1', jobs_amount: '3000.00', work_amount: '0.00', ahl: '45.00', reserve: '300.00', net: '2655.00' });
    await as(PAY2, `select approve_work_payout_batch('${jobs}')`);
    expect((await rows(`select 1 from contract_jobs where paid_out_at is not null and payout_line_id is not null`))).toHaveLength(1);
    expect((await notes('J1', 'employment_update')).at(-1)?.message).toMatch(/for a contract job\./);
  });

  it('the net is never below 0, and with the setting off the maker can approve their own', async () => {
    await as(PAY, `select set_work_settings('{"payout_needs_second_approver": false}')`);
    const tiny = await create(PAY, 'ad_hoc', day(1), day(28), ['T1']);
    const [t1] = await linesOf(tiny);
    // 0.50: AHL 0.01, reserve 0.05, 0.44 left: nothing paid now, all held to the month end
    expect(t1).toMatchObject({ gross: '0.50', ahl: '0.01', reserve: '0.05', net: '0.00', rounding: '0.44' });
    await as(PAY, `select approve_work_payout_batch('${tiny}')`);
    expect((await batch(tiny)).status).toBe('approved');
    await as(PAY, `select set_work_settings('{"payout_needs_second_approver": true}')`);
  });

  it('contractors have the reserve held too when the company says so', async () => {
    await as(PAY, `select set_work_settings('{"contractor_reserve": true}')`);
    await record(PAY, 'C1', day(20), CRATES, 10); // 500
    const b = await create(PAY, 'daily', day(20), day(20));
    const [c1] = await linesOf(b);
    expect(c1).toMatchObject({ employee_number: 'C1', wht: '15.00', reserve: '50.00', net: '435.00', reserve_rate: '0.1000' });
    await as(PAY, `select cancel_work_payout_batch('${b}')`);
    await as(PAY, `select set_work_settings('{"contractor_reserve": false}')`);
  });
});

describe('totals for the month end', () => {
  it('per worker: what was paid and what was held back', async () => {
    const t = await read<{ employee_number: string; paid: string; held: string; ahl: string; reserve: string; wht: string; gross: string; payouts: number }>(
      PAY, `select * from work_payout_month_totals(${LAST_MONTH}) order by employee_number`);
    const by = Object.fromEntries(t.map((r) => [r.employee_number, r]));
    expect(by.W1).toMatchObject({ gross: '1000.00', paid: '885.00', ahl: '15.00', reserve: '100.00', held: '115.00', payouts: 1 });
    expect(by.C1).toMatchObject({ paid: '970.00', wht: '30.00', held: '30.00' });
    expect(by.R1).toMatchObject({ paid: '76.00', held: '10.38' });
    // the cancelled weekly batch doesn't count; the exported one does
    expect(by.W2).toMatchObject({ paid: '442.00', payouts: 1 });
    await expect(read(W1, `select * from work_payout_month_totals(${LAST_MONTH})`)).rejects.toThrow(/Only payroll/);
  });
});

describe('a worker sees only their own payouts', () => {
  it('my_payouts: paid and held back in a month; no direct reading of batches or lines', async () => {
    const mine = (await one<{ p: { paid: number; held: number; payouts: unknown[]; pay_period: string } }>(W1, `select my_payouts(${LAST_MONTH}) p`)).p;
    expect(Number(mine.paid)).toBe(885);
    expect(Number(mine.held)).toBe(115);
    expect(mine.payouts).toHaveLength(1);
    const c1 = (await one<{ p: { paid: number; held: number } }>(C1, `select my_payouts(${LAST_MONTH}) p`)).p;
    expect(Number(c1.paid)).toBe(970);
    expect(await read(W1, `select 1 from work_payout_lines`)).toHaveLength(0);
    expect(await read(W1, `select 1 from work_payout_batches`)).toHaveLength(0);
    const sup = (await one<{ p: { paid: number } }>(SUP, `select my_payouts(${LAST_MONTH}) p`)).p;
    expect(Number(sup.paid)).toBe(0);
  });
});

describe('company isolation', () => {
  it("another company's payroll sees and changes nothing of ours", async () => {
    expect(await read(OTHER, `select 1 from work_payout_batches`)).toHaveLength(0);
    expect(await read(OTHER, `select 1 from work_payout_lines`)).toHaveLength(0);
    expect(await read(OTHER, `select * from work_payout_month_totals(${LAST_MONTH})`)).toHaveLength(0);
    await expect(as(OTHER, `select cancel_work_payout_batch('${daily}')`)).rejects.toThrow(/No such payout batch/);
    const b = await create(OTHER, 'daily', day(14), day(15));
    expect((await batch(b)).worker_count).toBe(0);
  });
});

describe('locked months', () => {
  it('no batch for a month whose payroll is approved, and none approved once it is', async () => {
    await db.exec(`insert into payroll_runs (tenant_id, pay_period, status) values ('${A}', to_char(${day(1)} - interval '1 month', 'YYYY-MM'), 'approved')`);
    await expect(create(PAY, 'daily', `(${day(1)} - 20)`, `(${day(1)} - 18)`)).rejects.toThrow(/locked/);

    const draft = await create(PAY, 'daily', day(1), day(28));
    await db.exec(`insert into payroll_runs (tenant_id, pay_period, status) values ('${A}', to_char(${LAST_MONTH}, 'YYYY-MM'), 'approved')`);
    await as(PAY, `select remove_work_payout_line(id) from work_payout_lines where batch_id = '${draft}' and problem is not null`);
    await expect(as(PAY2, `select approve_work_payout_batch('${draft}')`)).rejects.toThrow(/locked|nobody to pay/);
    await expect(create(PAY, 'daily', day(2), day(3))).rejects.toThrow(/locked/);
  });
});

describe('the migration', () => {
  it('runs again safely, keeping batches, settings and the paid-out marks', async () => {
    await as(PAY, `select set_work_settings('{"payout_needs_second_approver": false, "contractor_reserve": true}')`);
    const before = await rows(`select count(*)::int n, sum(net_total) t from work_payout_batches`);
    const paidBefore = await rows(`select count(*)::int n from work_entries where paid_out_at is not null`);
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    await db.exec('reset search_path');
    expect(await rows(`select count(*)::int n, sum(net_total) t from work_payout_batches`)).toEqual(before);
    expect(await rows(`select count(*)::int n from work_entries where paid_out_at is not null`)).toEqual(paidBefore);
    const s = (await one<{ s: Record<string, unknown> }>(PAY, `select work_settings() s`)).s;
    expect(s).toMatchObject({ payout_needs_second_approver: false, contractor_reserve: true, self_work_past_days: 7, supervisor_work_needs_approval: true });
    await expect(as(PAY, `select set_work_settings('{"payout_reserve_rate": 0.9}')`)).rejects.toThrow(/0% to 50%/);
  });
});
