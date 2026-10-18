// @vitest-environment node
//
// Piece rate stage 5 (FIG-812): the month-end settlement in the monthly payroll run. The month's gross includes work
// and jobs whether paid out or not; what payouts held back is reported for the payslip to credit, never counted
// twice; approving the run marks what it settled (so nothing counts twice) and records arrears, reopening undoes it;
// changed work blocks approval; catch-up of work left off an approved run; locked months; contractor WHT; company
// isolation; a worker's own view; running the migration again. Migration 20261020300000.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const PAY = '00000000-0000-0000-0000-00000000e001';
const PAY2 = '00000000-0000-0000-0000-00000000e002';
const W1U = '00000000-0000-0000-0000-00000000e003';
const OTHER = '00000000-0000-0000-0000-00000000e004';

const MIGRATION = join(__dirname, '..', 'migrations', '20261020300000_piece_rate_settlement.sql');
const TODAY = `(now() at time zone 'Africa/Nairobi')::date`;
/** day n of last month (the month being settled, M): always in the past */
const day = (n: number) => `((date_trunc('month', ${TODAY}) - interval '1 month')::date + ${n - 1})`;
const M_DAY = day(1);
const M = `to_char(${M_DAY}, 'YYYY-MM')`;
const THIS_MONTH = `to_char(${TODAY}, 'YYYY-MM')`;

let db: PGlite;
let m: string;
let now: string;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const one = async <T = Record<string, unknown>>(user: string, sql: string) => (await read<T>(user, sql))[0];

const CRATES = `(select id from work_types where name = 'Crates' and tenant_id = '${A}')`;
const record = (emp: string, d: string, qty: number) =>
  as(PAY, `insert into work_entries (employee_number, work_date, work_type_id, quantity, status) values ('${emp}', ${d}, ${CRATES}, ${qty}, 'submitted')`);
const job = async (emp: string, title: string, amount: number, approvedOn: string) => {
  await as(PAY, `insert into contract_jobs (employee_number, title, amount) values ('${emp}', '${title}', ${amount})`);
  await as(PAY, `update contract_jobs set status = 'completed' where title = '${title}'`);
  await as(PAY, `update contract_jobs set status = 'approved' where title = '${title}'`);
  await db.exec(`update contract_jobs set approved_at = ${approvedOn}::timestamp + interval '9 hours' where title = '${title}'`);
};
const payout = async (kind: string, from: string, to: string, workers: string[] | null = null) => {
  const { id } = await one<{ id: string }>(PAY, `select create_work_payout_batch('${kind}', ${from}, ${to},
    ${workers ? `array[${workers.map((w) => `'${w}'`).join(',')}]` : 'null'}) id`);
  await as(PAY2, `select approve_work_payout_batch('${id}')`);
  return id;
};

interface Settlement {
  employee_number: string; worker_kind: string; work_gross: string; jobs_gross: string; gross: string; paid_out_gross: string;
  paid: string; ahl: string; reserve: string; wht: string; rounding: string; held: string; arrears: string; payouts: number;
  job_count: number; work_lines: { name: string; quantity: number; amount: number }[];
}
const settlement = async (period: string) => {
  const list = await read<Settlement>(PAY, `select * from work_month_settlement(${period}) order by employee_number`);
  return Object.fromEntries(list.map((s) => [s.employee_number, s]));
};

/** a payslip as the payroll page saves it, from the settlement figures (the maths is the browser's, tested in lib) */
const savePayslip = async (period: string, emp: string, s: Partial<Settlement> | undefined, extra: Record<string, string | number> = {}) => {
  const n = (v: unknown) => Number(v ?? 0);
  const cols: Record<string, string | number> = {
    employee_id: `'${emp}'`, employee_name: `'${emp}'`, pay_period: `'${period}'`, tenant_id: `'${A}'`,
    gross_pay: n(s?.gross), net_pay: 0, work_pay: n(s?.work_gross), jobs_pay: n(s?.jobs_gross), paid_out: n(s?.paid),
    ahl_withheld: n(s?.ahl), reserve_released: n(s?.reserve) + n(s?.rounding), wht_withheld: n(s?.wht),
    arrears_brought_forward: n(s?.arrears), work_settlement: 'true', ...extra,
  };
  await db.exec(`insert into salary_history (${Object.keys(cols).join(', ')}) values (${Object.values(cols).join(', ')})
    on conflict (tenant_id, employee_id, pay_period) do update set ${Object.keys(cols).filter((k) => !['employee_id', 'pay_period', 'tenant_id'].includes(k)).map((k) => `${k} = excluded.${k}`).join(', ')}`);
};
const setRun = (period: string, status: string) => as(PAY, `update payroll_runs set status = '${status}' where pay_period = '${period}'`);
const settled = (table: string, emp: string) =>
  rows<{ settled_pay_period: string | null }>(`select settled_pay_period from ${table} where employee_number = '${emp}' order by 1`);

beforeAll(async () => {
  db = await bootLiveDb();
  m = (await rows<{ m: string }>(`select ${M} m`))[0].m;
  now = (await rows<{ m: string }>(`select ${THIS_MONTH} m`))[0].m;
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values ('${PAY}', 'pay@a.co'), ('${PAY2}', 'pay2@a.co'), ('${W1U}', 'w1@a.co'), ('${OTHER}', 'x@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${PAY}', 'pay@a.co', 'FINANCE', '${A}'), ('${PAY2}', 'pay2@a.co', 'FINANCE', '${A}'), ('${W1U}', 'w1@a.co', 'STAFF', '${A}'),
      ('${OTHER}', 'x@b.co', 'FINANCE', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('FINANCE', array['work-records', 'payroll'], '${A}'), ('STAFF', array['dashboard'], '${A}'),
      ('FINANCE', array['work-records', 'payroll'], '${B}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", worker_kind, pay_basis, pay_frequency,
                           wht_category, payment_method, "Mobile Number", tenant_id) values
      ('P1', 'Pauline', 'Pay', 'pay@a.co', 'employee', 'salary', 'monthly', null, null, null, '${A}'),
      ('P2', 'Peter', 'Pay', 'pay2@a.co', 'employee', 'salary', 'monthly', null, null, null, '${A}'),
      ('W1', 'Wanjiru', 'One', 'w1@a.co', 'employee', 'work', 'daily', null, 'M-Pesa', '0712345678', '${A}'),
      ('W3', 'Wairimu', 'Late', 'w3@a.co', 'employee', 'work', 'daily', null, 'M-Pesa', '0712345670', '${A}'),
      ('C1', 'Chege', 'Contract', 'c1@a.co', 'contractor', 'work', 'daily', 'contractual', 'M-Pesa', '0733000222', '${A}'),
      ('J1', 'James', 'Jobs', 'j1@a.co', 'employee', 'work', 'per_job', null, 'M-Pesa', '0711000333', '${A}'),
      ('J2', 'Jane', 'Jobs', 'j2@a.co', 'employee', 'work', 'per_job', null, 'M-Pesa', '0711000334', '${A}'),
      ('X1', 'Xena', 'Other', 'x1@b.co', 'employee', 'work', 'daily', null, 'M-Pesa', '0711000555', '${B}');
  `);
  await as(PAY, `insert into work_types (name, unit, rate) values ('Crates', 'crate', 50)`);
  // W1: 30,000 of work in M; 20,000 of it paid out (AHL 300 and the 10% reserve 2,000 held back: 17,700 paid)
  await record('W1', day(3), 200);
  await record('W1', day(10), 200);
  await record('W1', day(20), 200);
  // C1, a contractor: 5,000 paid out (3% WHT, 150), 5,000 not
  await record('C1', day(5), 100);
  await record('C1', day(21), 100);
  // W3: 1,000 of work, but W3 won't be on M's payroll
  await record('W3', day(6), 20);
  await payout('ad_hoc', day(1), day(10), ['W1', 'C1']);
  // J1: a 3,000 job paid out, and a 5,000 job approved in M but not paid out
  await job('J1', 'Fence the block', 3000, day(8));
  await payout('job', day(1), day(9), ['J1']);
  await job('J1', 'Dig the drain', 5000, day(25));
  // J2: a job approved at the end of M, paid out in a payout of this month: it settles with this month
  await job('J2', 'Paint the store', 2000, day(28));
  await payout('ad_hoc', `date_trunc('month', ${TODAY})::date`, TODAY, ['J2']);
}, 120000);

describe('the month gross', () => {
  it('includes paid-out and unpaid work, with what payouts paid and held back', async () => {
    const s = await settlement(M_DAY);
    expect(s.W1).toMatchObject({
      worker_kind: 'employee', work_gross: '30000.00', jobs_gross: '0', gross: '30000.00', paid_out_gross: '20000.00',
      paid: '17700.00', ahl: '300.00', reserve: '2000.00', wht: '0.00', rounding: '0.00', held: '2300.00', payouts: 1, arrears: '0',
    });
    expect(s.W1.work_lines).toEqual([{ name: 'Crates', unit: 'crate', quantity: 600, amount: 30000 }]);
  });

  it('includes contract jobs approved in the month, paid out or not', async () => {
    const s = await settlement(M_DAY);
    expect(s.J1).toMatchObject({ work_gross: '0', jobs_gross: '8000.00', paid_out_gross: '3000.00', paid: '2655.00', ahl: '45.00', reserve: '300.00', job_count: 2 });
  });

  it("a job paid out in a later month's payout counts in that month, with its payout", async () => {
    expect((await settlement(M_DAY)).J2).toBeUndefined();
    expect((await settlement(TODAY)).J2).toMatchObject({ jobs_gross: '2000.00', paid_out_gross: '2000.00', paid: '1770.00' });
  });

  it("contractors: the WHT payouts already withheld, to credit against the month's WHT", async () => {
    expect((await settlement(M_DAY)).C1).toMatchObject({ worker_kind: 'contractor', work_gross: '10000.00', paid: '4850.00', wht: '150.00', ahl: '0.00', reserve: '0.00' });
  });

  it('holds the same payout figures as work_payout_month_totals', async () => {
    const totals = await read<{ employee_number: string; paid: string; ahl: string; reserve: string; wht: string; rounding: string }>(
      PAY, `select * from work_payout_month_totals(${M_DAY})`);
    const s = await settlement(M_DAY);
    for (const t of totals) {
      expect(s[t.employee_number]).toMatchObject({ paid: t.paid, ahl: t.ahl, reserve: t.reserve, wht: t.wht, rounding: t.rounding });
    }
  });

  it('only payroll sees it', async () => {
    await expect(read(W1U, `select * from work_month_settlement(${M_DAY})`)).rejects.toThrow(/Only payroll/);
  });
});

describe('approving the month', () => {
  it('is refused when work changed after the payslips were worked out', async () => {
    const s = await settlement(M_DAY);
    for (const emp of ['W1', 'C1', 'J1']) await savePayslip(m, emp, s[emp]);
    await savePayslip(m, 'P1', undefined, { work_settlement: 'false', gross_pay: 50000, net_pay: 40000 });
    await record('W1', day(22), 10);
    await expect(setRun(m, 'approved')).rejects.toThrow(/changed after payroll .* was worked out\. Recalculate/);
    await as(PAY, `delete from work_entries where employee_number = 'W1' and work_date = ${day(22)}`);
  });

  it('marks what it settled, records the arrear carried forward, and leaves the salaried payslip alone', async () => {
    await savePayslip(m, 'W1', (await settlement(M_DAY)).W1, { arrears_carried_forward: 500, arrears_note: "'Deductions more than the pay left'" });
    await setRun(m, 'approved');
    expect(await settled('work_entries', 'W1')).toEqual([{ settled_pay_period: m }, { settled_pay_period: m }, { settled_pay_period: m }]);
    expect(await settled('contract_jobs', 'J1')).toEqual([{ settled_pay_period: m }, { settled_pay_period: m }]);
    expect(await settled('work_payout_lines', 'W1')).toEqual([{ settled_pay_period: m }]);
    expect(await rows(`select employee_number, pay_period, amount, reason, settled_in from pay_arrears`)).toEqual([
      { employee_number: 'W1', pay_period: m, amount: '500.00', reason: 'Deductions more than the pay left', settled_in: null },
    ]);
    expect(await rows(`select net_pay, work_pay from salary_history where employee_id = 'P1'`)).toEqual([{ net_pay: '40000', work_pay: '0.00' }]);
  });

  it('settled items never count twice: not again in this month, nor in the next', async () => {
    const again = await settlement(M_DAY);
    expect(again.W1).toBeUndefined();
    expect(again.J1).toBeUndefined();
    const next = await settlement(TODAY);
    expect(next.W1).toMatchObject({ work_gross: '0', paid: '0', arrears: '500.00' });
    expect(next.J1).toBeUndefined();
  });

  it("catch-up: work of someone left off the approved run is settled by the next one", async () => {
    expect(await settled('work_entries', 'W3')).toEqual([{ settled_pay_period: null }]);
    expect((await settlement(TODAY)).W3).toMatchObject({ work_gross: '1000.00' });
  });
});

describe('locked months', () => {
  it('settled work and jobs are fixed; nobody marks work settled by hand', async () => {
    await expect(as(PAY, `update work_entries set quantity = 1 where employee_number = 'W1' and work_date = ${day(20)}`)).rejects.toThrow(/approved|settled/);
    await expect(as(PAY, `update contract_jobs set status = 'completed' where title = 'Dig the drain'`)).rejects.toThrow(/settled in the payroll for/);
    await expect(as(PAY, `update contract_jobs set amount = 1 where title = 'Dig the drain'`)).rejects.toThrow(/settled in the payroll for/);
    await expect(as(PAY, `update work_entries set settled_pay_period = '${m}' where employee_number = 'W3'`)).rejects.toThrow(/approved|settled by approving/);
    await expect(db.exec(`update work_entries set settled_pay_period = null where employee_number = 'W1'`)).rejects.toThrow(/approved|paid out|settled in the payroll for/);
    await expect(db.exec(`update work_payout_lines set settled_pay_period = null where employee_number = 'W1'`)).rejects.toThrow(/settled in the payroll for/);
  });

  it('renumbering a worker still follows through settled work', async () => {
    await db.exec(`update employees set "Employee Number" = 'W1X' where "Employee Number" = 'W1' and tenant_id = '${A}'`);
    expect((await settled('work_entries', 'W1X'))).toHaveLength(3);
    expect(await rows(`select employee_number from pay_arrears`)).toEqual([{ employee_number: 'W1X' }]);
    await db.exec(`update employees set "Employee Number" = 'W1' where "Employee Number" = 'W1X' and tenant_id = '${A}'`);
  });
});

describe('arrears', () => {
  it('are brought forward next month and marked recovered when it is approved', async () => {
    const next = await settlement(TODAY);
    await savePayslip(now, 'W1', next.W1);
    await setRun(now, 'approved');
    expect(await rows(`select pay_period, settled_in from pay_arrears`)).toEqual([{ pay_period: m, settled_in: now }]);
    expect((await settlement(TODAY)).W1).toBeUndefined();
  });

  it("a month whose arrear a later month recovered can't be reopened before that month", async () => {
    await expect(setRun(m, 'draft')).rejects.toThrow(/already recovered in the payroll for/);
    await setRun(now, 'draft');
    expect(await rows(`select pay_period, settled_in from pay_arrears`)).toEqual([{ pay_period: m, settled_in: null }]);
  });

  it('reopening a month takes back its arrears and settled marks', async () => {
    await setRun(m, 'draft');
    expect(await rows(`select 1 from pay_arrears`)).toHaveLength(0);
    expect(await rows(`select 1 from work_entries where settled_pay_period is not null`)).toHaveLength(0);
    expect(await rows(`select 1 from contract_jobs where settled_pay_period is not null`)).toHaveLength(0);
    expect((await settlement(M_DAY)).W1).toMatchObject({ work_gross: '30000.00', paid: '17700.00' });
    // approved again for the tests below
    await setRun(m, 'approved');
  });

  it('the two-thirds cap is a company setting, on by default', async () => {
    expect(await rows(`select deduction_cap from company_payroll_settings where tenant_id = '${A}'`)).toEqual([]);
    expect(await rows(`select deduction_cap('${A}') v`)).toEqual([{ v: true }]);
    await as(PAY, `insert into company_payroll_settings (tenant_id, deduction_cap) values ('${A}', false)
                   on conflict (tenant_id) do update set deduction_cap = false`);
    expect(await rows(`select deduction_cap('${A}') v`)).toEqual([{ v: false }]);
  });

  it('a worker reads only their own; nobody writes them by hand', async () => {
    expect(await read(W1U, `select employee_number, amount from pay_arrears`)).toEqual([{ employee_number: 'W1', amount: '500.00' }]);
    await expect(as(PAY, `insert into pay_arrears (employee_number, pay_period, amount) values ('W1', '${m}', 1)`)).rejects.toThrow(/permission denied/);
    await expect(as(PAY, `update pay_arrears set amount = 1`)).rejects.toThrow(/permission denied/);
  });
});

describe("the worker's view", () => {
  it('my_work_settlement: settled once the month is approved', async () => {
    const mine = (await one<{ s: Record<string, unknown> }>(W1U, `select my_work_settlement(${M_DAY}) s`)).s;
    expect(mine).toMatchObject({ pay_period: m, settled: true, paid_out: 17700, arrears_carried_forward: 500 });
    const open = (await one<{ s: Record<string, unknown> }>(W1U, `select my_work_settlement(${TODAY}) s`)).s;
    expect(open).toMatchObject({ pay_period: now, settled: false });
  });
});

describe('company isolation', () => {
  it("another company's payroll sees none of our settlement or arrears", async () => {
    expect(await read(OTHER, `select * from work_month_settlement(${M_DAY})`)).toHaveLength(0);
    expect(await read(OTHER, `select * from pay_arrears`)).toHaveLength(0);
    expect((await one<{ s: { settled: boolean } }>(OTHER, `select my_work_settlement(${M_DAY}) s`)).s.settled).toBe(false);
  });
});

describe('the migration', () => {
  it('runs again safely, keeping settled marks and arrears, without doubling the rules triggers', async () => {
    const marks = await rows(`select count(*)::int n from work_entries where settled_pay_period is not null`);
    const owed = await rows(`select count(*)::int n, sum(amount) t from pay_arrears`);
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    await db.exec('reset search_path');
    expect(await rows(`select count(*)::int n from work_entries where settled_pay_period is not null`)).toEqual(marks);
    expect(await rows(`select count(*)::int n, sum(amount) t from pay_arrears`)).toEqual(owed);
    const triggers = await rows<{ tgname: string }>(`select tgname from pg_trigger where tgrelid = 'public.work_entries'::regclass and tgname like 'work_entry_rules%' order by 1`);
    expect(triggers.map((t) => t.tgname)).toEqual(['work_entry_rules', 'work_entry_rules_update']);
    // the rules still apply to ordinary changes
    await expect(as(PAY, `update work_entries set quantity = 1 where employee_number = 'W1' and work_date = ${day(20)}`)).rejects.toThrow();
    await expect(as(W1U, `insert into work_entries (employee_number, work_date, work_type_id, quantity) values ('W1', ${TODAY}, ${CRATES}, 1)`))
      .resolves.toBeDefined();
  });
});
