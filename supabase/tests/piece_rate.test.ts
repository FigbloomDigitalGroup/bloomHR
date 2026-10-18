// @vitest-environment node
//
// Piece rate and contract jobs (FIG-812, stage 1): kinds of work with rates, daily work entries and contract jobs.
// Payroll does everything, a supervisor (the worker's manager_email / regional_manager) records and approves their
// team's work, a worker submits their own work and marks their own job done. Closed months and paid-out work are fixed.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const PAY = '00000000-0000-0000-0000-00000000c001';
const SUP = '00000000-0000-0000-0000-00000000c002';
const W1 = '00000000-0000-0000-0000-00000000c003';
const W3 = '00000000-0000-0000-0000-00000000c004';
const OTHER = '00000000-0000-0000-0000-00000000c005';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));

const TEA = `(select id from work_types where name = 'Tea picked' and tenant_id = '${A}')`;
const entry = async (id: string) =>
  (await rows<{ status: string; source: string; rate: string; amount: string; decided_by: string | null }>(
    `select status, source, rate, amount, decided_by from work_entries where id = '${id}'`
  ))[0];
const insertEntry = async (user: string, values: string) =>
  (await asUser(db, user, () => rows<{ id: string }>(`insert into work_entries ${values} returning id`)))[0].id;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values
      ('${PAY}', 'pay@a.co'), ('${SUP}', 'sup@a.co'), ('${W1}', 'w1@a.co'), ('${W3}', 'w3@a.co'), ('${OTHER}', 'pay@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${PAY}', 'pay@a.co', 'FINANCE', '${A}'), ('${SUP}', 'sup@a.co', 'STAFF', '${A}'),
      ('${W1}', 'w1@a.co', 'STAFF', '${A}'), ('${W3}', 'w3@a.co', 'STAFF', '${A}'), ('${OTHER}', 'pay@b.co', 'FINANCE', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('FINANCE', array['payroll'], '${A}'), ('STAFF', array['dashboard'], '${A}'), ('FINANCE', array['payroll'], '${B}');
    insert into employees ("Employee Number", "First Name", "Work Email", manager_email, regional_manager, tenant_id) values
      ('S1', 'Sam', 'sup@a.co', null, null, '${A}'),
      ('W1', 'Wanjiru', 'w1@a.co', ' Sup@A.co ', null, '${A}'),
      ('W2', 'Otieno', 'w2@a.co', null, 'sup@a.co', '${A}'),
      ('W3', 'Achieng', 'w3@a.co', 'someone@a.co', null, '${A}'),
      ('X1', 'Xena', 'x1@b.co', null, null, '${B}');
  `);
  await as(PAY, `insert into work_types (name, unit, rate) values ('Tea picked', 'kg', 12), ('Weeding', 'day', 600)`);
}, 120000);

describe('kinds of work', () => {
  it('payroll sets them up; everyone in the company reads them; staff cannot change them', async () => {
    expect(await read(W1, `select name from work_types order by name`)).toEqual([{ name: 'Tea picked' }, { name: 'Weeding' }]);
    await expect(as(W1, `insert into work_types (name, unit, rate) values ('Sneaky', 'kg', 999)`)).rejects.toThrow(/row-level security/);
    await as(W1, `update work_types set rate = 999`);
    expect((await rows<{ rate: string }>(`select rate from work_types where name = 'Tea picked'`))[0].rate).toBe('12.00');
  });

  it('refuses a duplicate name (ignoring case and spaces) and a zero rate', async () => {
    await expect(as(PAY, `insert into work_types (name, unit, rate) values (' tea PICKED ', 'kg', 10)`)).rejects.toThrow(/duplicate|unique/i);
    await expect(as(PAY, `insert into work_types (name, unit, rate) values ('Pruning', 'day', 0)`)).rejects.toThrow(/check/i);
  });

  it('another company sees none of them and cannot record against them', async () => {
    expect(await read(OTHER, `select 1 from work_types`)).toHaveLength(0);
    const teaId = (await rows<{ id: string }>(`select id from work_types where name = 'Tea picked'`))[0].id;
    await expect(
      as(OTHER, `insert into work_entries (employee_number, work_date, work_type_id, quantity, source) values ('X1', current_date, '${teaId}', 5, 'payroll')`)
    ).rejects.toThrow(/Unknown kind of work/);
  });
});

describe('recording work', () => {
  // stage 2 (20261019800000): what a supervisor submits waits for payroll by default (a company setting)
  it("a supervisor records their team's work at the type's rate; it waits for payroll's approval", async () => {
    const id = await insertEntry(SUP, `(employee_number, work_date, work_type_id, quantity, source) values ('W1', current_date, ${TEA}, 42.5, 'self')`);
    expect(await entry(id)).toEqual({ status: 'submitted', source: 'supervisor', rate: '12.00', amount: '510.00', decided_by: null });
    await as(PAY, `update work_entries set status = 'approved' where id = '${id}'`);
    expect(await entry(id)).toMatchObject({ status: 'approved', decided_by: PAY });
    // the regional manager counts as supervisor too
    const id2 = await insertEntry(SUP, `(employee_number, work_date, work_type_id, quantity, source) values ('W2', current_date, ${TEA}, 10, 'supervisor')`);
    expect((await entry(id2)).status).toBe('submitted');
  });

  it('a supervisor cannot record for someone outside their team, and staff cannot record for others', async () => {
    await expect(
      as(SUP, `insert into work_entries (employee_number, work_date, work_type_id, quantity, source) values ('W3', current_date, ${TEA}, 5, 'supervisor')`)
    ).rejects.toThrow(/row-level security|only record work/);
    await expect(
      as(W3, `insert into work_entries (employee_number, work_date, work_type_id, quantity, source) values ('W1', current_date, ${TEA}, 5, 'self')`)
    ).rejects.toThrow(/row-level security|only record work/);
  });

  it("a worker's own entry waits for approval, whatever they claim; only the supervisor approves it", async () => {
    const id = await insertEntry(
      W1,
      `(employee_number, work_date, work_type_id, quantity, source, status, rate) values ('W1', current_date, ${TEA}, 20, 'supervisor', 'approved', 500)`
    );
    expect(await entry(id)).toEqual({ status: 'submitted', source: 'self', rate: '12.00', amount: '240.00', decided_by: null });

    await expect(as(W1, `update work_entries set status = 'approved' where id = '${id}'`)).rejects.toThrow(/Only payroll or the supervisor/);
    // the worker may correct it while it waits
    await as(W1, `update work_entries set quantity = 25 where id = '${id}'`);
    expect((await entry(id)).amount).toBe('300.00');

    await as(SUP, `update work_entries set status = 'approved' where id = '${id}'`);
    expect(await entry(id)).toMatchObject({ status: 'approved', decided_by: SUP });
    await expect(as(W1, `update work_entries set quantity = 99 where id = '${id}'`)).rejects.toThrow(/Approved work/);
    await expect(as(W1, `delete from work_entries where id = '${id}'`)).rejects.toThrow(/only be removed by payroll/);
  });

  it('rejecting needs a reason; the worker corrects and sends it back', async () => {
    const id = await insertEntry(W1, `(employee_number, work_date, work_type_id, quantity, source) values ('W1', current_date, ${TEA}, 80, 'self')`);
    await expect(as(SUP, `update work_entries set status = 'rejected' where id = '${id}'`)).rejects.toThrow(/check/i);
    await as(SUP, `update work_entries set status = 'rejected', rejection_reason = 'Scale says 60' where id = '${id}'`);
    await as(W1, `update work_entries set quantity = 60, status = 'submitted' where id = '${id}'`);
    const [row] = await rows<{ status: string; rejection_reason: string | null; amount: string }>(
      `select status, rejection_reason, amount from work_entries where id = '${id}'`
    );
    expect(row).toEqual({ status: 'submitted', rejection_reason: null, amount: '720.00' });
  });

  it('payroll uploads are approved and marked as uploads', async () => {
    const id = await insertEntry(PAY, `(employee_number, work_date, work_type_id, quantity, source) values ('W3', current_date - 1, ${TEA}, 7, 'upload')`);
    expect(await entry(id)).toMatchObject({ status: 'approved', source: 'upload', decided_by: PAY });
  });

  it("a later rate change doesn't alter recorded work; a paused type can't be used", async () => {
    const id = await insertEntry(PAY, `(employee_number, work_date, work_type_id, quantity, source) values ('W1', current_date, ${TEA}, 10, 'payroll')`);
    await as(PAY, `update work_types set rate = 15 where name = 'Tea picked'`);
    expect((await entry(id)).amount).toBe('120.00');
    await as(PAY, `update work_types set active = false where name = 'Weeding'`);
    const weeding = `(select id from work_types where name = 'Weeding')`;
    await expect(
      as(PAY, `insert into work_entries (employee_number, work_date, work_type_id, quantity, source) values ('W1', current_date, ${weeding}, 1, 'payroll')`)
    ).rejects.toThrow(/paused/);
    await as(PAY, `update work_types set active = true where name = 'Weeding'`);
  });

  it('refuses future days and unknown workers', async () => {
    await expect(
      as(PAY, `insert into work_entries (employee_number, work_date, work_type_id, quantity, source) values ('W1', current_date + 5, ${TEA}, 1, 'payroll')`)
    ).rejects.toThrow(/future/);
    await expect(
      as(PAY, `insert into work_entries (employee_number, work_date, work_type_id, quantity, source) values ('NOBODY', current_date, ${TEA}, 1, 'payroll')`)
    ).rejects.toThrow(/Unknown worker/);
  });

  it("each person sees only what concerns them", async () => {
    const own = await read<{ employee_number: string }>(W1, `select distinct employee_number from work_entries`);
    expect(own.map((r) => r.employee_number)).toEqual(['W1']);
    const team = await read<{ employee_number: string }>(SUP, `select distinct employee_number from work_entries order by 1`);
    expect(team.map((r) => r.employee_number)).toEqual(['W1', 'W2']);
    expect(await read(OTHER, `select 1 from work_entries`)).toHaveLength(0);
  });

  it("nothing changes in a month whose payroll is approved, or once it's paid out", async () => {
    const id = await insertEntry(PAY, `(employee_number, work_date, work_type_id, quantity, source) values ('W1', date '2026-09-15', ${TEA}, 10, 'payroll')`);
    await db.exec(`insert into payroll_runs (tenant_id, pay_period, status) values ('${A}', '2026-09', 'approved')`);
    await expect(as(PAY, `update work_entries set quantity = 11 where id = '${id}'`)).rejects.toThrow(/Payroll for Sep 2026 is approved/);
    await expect(as(PAY, `delete from work_entries where id = '${id}'`)).rejects.toThrow(/Payroll for Sep 2026 is approved/);
    await expect(
      as(SUP, `insert into work_entries (employee_number, work_date, work_type_id, quantity, source) values ('W1', date '2026-09-20', ${TEA}, 1, 'supervisor')`)
    ).rejects.toThrow(/Payroll for Sep 2026 is approved/);

    const paid = await insertEntry(PAY, `(employee_number, work_date, work_type_id, quantity, source) values ('W2', current_date, ${TEA}, 3, 'payroll')`);
    await db.exec(`update work_entries set paid_out_at = now() where id = '${paid}'`);
    await expect(as(PAY, `update work_entries set quantity = 4 where id = '${paid}'`)).rejects.toThrow(/paid out/);
    await expect(as(SUP, `delete from work_entries where id = '${paid}'`)).rejects.toThrow(/paid out/);
  });

  it('renumbering a worker follows through, even in a closed month', async () => {
    await db.exec(`update employees set "Employee Number" = 'W1-NEW' where "Employee Number" = 'W1' and tenant_id = '${A}'`);
    expect(await rows(`select 1 from work_entries where employee_number = 'W1'`)).toHaveLength(0);
    expect((await rows(`select 1 from work_entries where employee_number = 'W1-NEW' and work_date = '2026-09-15'`)).length).toBe(1);
    await db.exec(`update employees set "Employee Number" = 'W1' where "Employee Number" = 'W1-NEW' and tenant_id = '${A}'`);
  });

  it('changes are kept in the audit log', async () => {
    expect((await rows(`select 1 from audit_log where table_name = 'work_entries'`)).length).toBeGreaterThan(0);
  });
});

describe('contract jobs', () => {
  const job = async () => (await rows<{ id: string }>(`select id from contract_jobs where title = 'Fence the east block'`))[0].id;

  it('only payroll or the supervisor gives a job', async () => {
    await expect(as(W1, `insert into contract_jobs (employee_number, title, amount) values ('W1', 'Pay me', 100000)`)).rejects.toThrow(/Only payroll or the supervisor/);
    await as(SUP, `insert into contract_jobs (employee_number, title, amount, status) values ('W1', 'Fence the east block', 15000, 'approved')`);
    const [row] = await rows<{ status: string; created_by: string }>(`select status, created_by from contract_jobs`);
    expect(row).toEqual({ status: 'open', created_by: SUP });
  });

  it('the worker marks it done but cannot change it or approve it', async () => {
    const id = await job();
    await expect(as(W1, `update contract_jobs set amount = 50000 where id = '${id}'`)).rejects.toThrow(/only mark your own open job/);
    await expect(as(W1, `update contract_jobs set status = 'approved' where id = '${id}'`)).rejects.toThrow(/only mark your own open job/);
    await as(W1, `update contract_jobs set status = 'completed', completion_notes = 'Done, 120 posts' where id = '${id}'`);
    const [row] = await rows<{ status: string; completed_at: string | null }>(`select status, completed_at from contract_jobs where id = '${id}'`);
    expect(row.status).toBe('completed');
    expect(row.completed_at).not.toBeNull();
  });

  it('sending it back needs a reason; approving records who', async () => {
    const id = await job();
    await expect(as(SUP, `update contract_jobs set status = 'open' where id = '${id}'`)).rejects.toThrow(/Say why/);
    await as(SUP, `update contract_jobs set status = 'open', sent_back_reason = 'Gate missing' where id = '${id}'`);
    await as(W1, `update contract_jobs set status = 'completed' where id = '${id}'`);
    await as(SUP, `update contract_jobs set status = 'approved' where id = '${id}'`);
    const [row] = await rows<{ status: string; approved_by: string; sent_back_reason: string | null }>(
      `select status, approved_by, sent_back_reason from contract_jobs where id = '${id}'`
    );
    expect(row).toEqual({ status: 'approved', approved_by: SUP, sent_back_reason: null });
    await expect(as(SUP, `update contract_jobs set amount = 1 where id = '${id}'`)).rejects.toThrow(/only be changed by payroll/);
    await expect(as(SUP, `update contract_jobs set status = 'open', sent_back_reason = 'x' where id = '${id}'`)).rejects.toThrow(/can't go from approved to open/);
  });

  it("an approved job can't be deleted, and a paid job can't change", async () => {
    const id = await job();
    await expect(as(PAY, `delete from contract_jobs where id = '${id}'`)).rejects.toThrow(/can't be deleted/);
    await db.exec(`update contract_jobs set paid_out_at = now() where id = '${id}'`);
    await expect(as(PAY, `update contract_jobs set status = 'completed' where id = '${id}'`)).rejects.toThrow(/has been paid/);
  });

  it('others see nothing of it', async () => {
    expect(await read(W3, `select 1 from contract_jobs`)).toHaveLength(0);
    expect(await read(OTHER, `select 1 from contract_jobs`)).toHaveLength(0);
  });
});

describe('worker setup and rates', () => {
  it('new and existing staff are salaried employees paid monthly', async () => {
    const [row] = await rows(`select worker_kind, pay_basis, pay_frequency, wht_category from employees where "Employee Number" = 'S1'`);
    expect(row).toEqual({ worker_kind: 'employee', pay_basis: 'salary', pay_frequency: 'monthly', wht_category: null });
  });

  it('a contractor needs a withholding tax category; an employee has none', async () => {
    await expect(db.exec(`update employees set worker_kind = 'contractor' where "Employee Number" = 'W3'`)).rejects.toThrow(/wht_category/);
    await db.exec(`update employees set worker_kind = 'contractor', wht_category = 'professional', pay_basis = 'work', pay_frequency = 'daily' where "Employee Number" = 'W3'`);
    await expect(db.exec(`update employees set worker_kind = 'employee' where "Employee Number" = 'W3'`)).rejects.toThrow(/wht_category/);
    await expect(db.exec(`update employees set pay_frequency = 'hourly' where "Employee Number" = 'W3'`)).rejects.toThrow(/pay_frequency/);
  });

  it('withholding tax rates are dated defaults', async () => {
    const r = await rows<{ code: string; value: string }>(
      `select code, value from statutory_rates where tenant_id is null and code like 'wht_%' and country = 'Kenya' order by code`
    );
    expect(r).toEqual([{ code: 'wht_contractual', value: '0.03' }, { code: 'wht_professional', value: '0.05' }]);
  });

  it('the payout reserve defaults to 10% and stays between 0 and 50%', async () => {
    await asUser(db, PAY, () => db.exec(`insert into company_payroll_settings default values`));
    expect((await rows<{ payout_reserve_rate: string }>(`select payout_reserve_rate from company_payroll_settings where tenant_id = '${A}'`))[0].payout_reserve_rate).toBe('0.1000');
    await expect(as(PAY, `update company_payroll_settings set payout_reserve_rate = 0.8`)).rejects.toThrow(/check/i);
  });

  it('the module is in the catalogue', async () => {
    expect(await rows(`select 1 from permissions where module_id = 'work-records'`)).toHaveLength(1);
  });
});
