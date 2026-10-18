// @vitest-environment node
//
// Piece rate stage 2 (FIG-812): recording work. Supervisors enter their team's work (draft, then submitted for
// payroll's approval by default), workers submit their own for their supervisor's approval, payroll uploads a
// spreadsheet (checked row by row), approved work is locked, months whose payroll is approved are locked, rates change
// from a date, and contract jobs go open -> completed -> approved. Migration 20261019800000.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const PAY = '00000000-0000-0000-0000-00000000d001';
const SUP = '00000000-0000-0000-0000-00000000d002';
const W1 = '00000000-0000-0000-0000-00000000d003';
const W3 = '00000000-0000-0000-0000-00000000d004';
const OTHER = '00000000-0000-0000-0000-00000000d005';

const MIGRATION = join(__dirname, '..', 'migrations', '20261019800000_piece_rate_recording.sql');

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const one = async <T = Record<string, unknown>>(user: string, sql: string) => (await read<T>(user, sql))[0];

const TEA = `(select id from work_types where name = 'Tea picked' and tenant_id = '${A}')`;
const insertEntry = async (user: string, values: string) =>
  (await read<{ id: string }>(user, `insert into work_entries ${values} returning id`))[0].id;
const entry = async (id: string) =>
  (await rows<{ status: string; source: string; rate: string; amount: string; decided_by: string | null }>(
    `select status, source, rate, amount, decided_by from work_entries where id = '${id}'`
  ))[0];
const notes = async (to: string, type: string) =>
  rows<{ title: string; message: string }>(
    `select title, message from hr_notifications where employee_number = '${to}' and notification_type = '${type}' order by id`
  );
const PREV_MONTH = `(date_trunc('month', current_date) - interval '1 month')::date + 9`;

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
      ('FINANCE', array['work-records', 'payroll'], '${A}'), ('STAFF', array['dashboard'], '${A}'), ('FINANCE', array['payroll'], '${B}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", manager_email, pay_basis, pay_frequency, tenant_id) values
      ('P1', 'Pauline', 'Pay', 'pay@a.co', null, 'salary', 'monthly', '${A}'),
      ('S1', 'Sam', 'Super', 'sup@a.co', null, 'salary', 'monthly', '${A}'),
      ('W1', 'Wanjiru', 'One', 'w1@a.co', 'sup@a.co', 'work', 'daily', '${A}'),
      ('W2', 'Otieno', 'Two', 'w2@a.co', 'sup@a.co', 'work', 'weekly', '${A}'),
      ('W3', 'Achieng', 'Three', 'w3@a.co', 'someone@a.co', 'work', 'daily', '${A}'),
      ('M1', 'Mary', 'Salaried', 'm1@a.co', 'sup@a.co', 'salary', 'monthly', '${A}'),
      ('X1', 'Xena', 'Other', 'x1@b.co', null, 'work', 'daily', '${B}');
    insert into employees ("Employee Number", "First Name", "Work Email", manager_email, worker_kind, daily_rate, tenant_id) values
      ('C1', 'Chris', 'c1@a.co', 'sup@a.co', 'casual', 700, '${A}');
  `);
  await as(PAY, `insert into work_types (name, unit, rate) values ('Tea picked', 'kg', 12), ('Weeding', 'row', 35)`);
}, 120000);

describe('supervisor daily entry', () => {
  it('a supervisor records only for their own team, never for casuals', async () => {
    await expect(
      as(SUP, `insert into work_entries (employee_number, work_date, work_type_id, quantity, source) values ('W3', current_date, ${TEA}, 5, 'supervisor')`)
    ).rejects.toThrow(/row-level security|only record work/);
    await expect(
      as(SUP, `insert into work_entries (employee_number, work_date, work_type_id, quantity, source) values ('C1', current_date, ${TEA}, 5, 'supervisor')`)
    ).rejects.toThrow(/casual worker/);
    const people = await read<{ employee_number: string }>(SUP, `select employee_number from work_people()`);
    expect(people.map((p) => p.employee_number).sort()).toEqual(['M1', 'W1', 'W2']);
  });

  it('a draft is private, editable, and counts for nothing until submitted', async () => {
    const id = await insertEntry(SUP, `(employee_number, work_date, work_type_id, quantity, status) values ('W1', current_date, ${TEA}, 40, 'draft')`);
    expect(await entry(id)).toMatchObject({ status: 'draft', source: 'supervisor', amount: '480.00', decided_by: null });
    expect(await read(W1, `select 1 from work_entries where id = '${id}'`)).toHaveLength(0);
    await as(SUP, `update work_entries set quantity = 42.5 where id = '${id}'`);
    expect((await entry(id)).amount).toBe('510.00');
    expect(await read(PAY, `select 1 from work_entries where id = '${id}'`)).toHaveLength(1);
  });

  it("by default a supervisor's submission waits for payroll, who is told; the supervisor can't approve it", async () => {
    const [id] = (await rows<{ id: string }>(`select id from work_entries where employee_number = 'W1' and status = 'draft'`)).map((r) => r.id);
    const out = await one<{ r: { submitted: number; approved: number } }>(SUP, `select submit_work_entries(array['${id}'::uuid]) r`);
    expect(out.r).toMatchObject({ submitted: 1, approved: 0 });
    expect((await entry(id)).status).toBe('submitted');
    expect((await notes('P1', 'approval_needed')).at(-1)?.message).toMatch(/Sam Super submitted 1 work entry/);
    // still editable by the supervisor until approved
    await as(SUP, `update work_entries set quantity = 41 where id = '${id}'`);
    const d = await one<{ r: { done: number; failed: { error: string }[] } }>(SUP, `select decide_work_entries(array['${id}'::uuid], 'approved') r`);
    expect(d.r.done).toBe(0);
    expect(d.r.failed[0].error).toMatch(/approved by payroll/);
    await as(PAY, `select decide_work_entries(array['${id}'::uuid], 'approved')`);
    expect(await entry(id)).toMatchObject({ status: 'approved', decided_by: PAY, amount: '492.00' });
  });

  it('with the setting off, what a supervisor submits counts at once', async () => {
    await as(PAY, `select set_work_settings('{"supervisor_work_needs_approval": false}')`);
    const id = await insertEntry(SUP, `(employee_number, work_date, work_type_id, quantity) values ('W2', current_date, ${TEA}, 10)`);
    expect(await entry(id)).toMatchObject({ status: 'approved', decided_by: SUP });
    await as(PAY, `select set_work_settings('{"supervisor_work_needs_approval": true}')`);
    expect((await one<{ s: { supervisor_work_needs_approval: boolean } }>(SUP, `select work_settings() s`)).s.supervisor_work_needs_approval).toBe(true);
    await expect(as(SUP, `select set_work_settings('{"supervisor_work_needs_approval": false}')`)).rejects.toThrow(/Only payroll/);
  });
});

describe('approval locks', () => {
  it('approved work is changed, removed or reopened only by payroll', async () => {
    const id = (await rows<{ id: string }>(`select id from work_entries where employee_number = 'W2' and status = 'approved' limit 1`))[0].id;
    await expect(as(SUP, `update work_entries set quantity = 99 where id = '${id}'`)).rejects.toThrow(/only be changed by payroll/);
    await expect(as(SUP, `delete from work_entries where id = '${id}'`)).rejects.toThrow(/only be removed by payroll/);
    await expect(as(SUP, `select reopen_work_entries(array['${id}'::uuid])`)).rejects.toThrow(/Only payroll/);
    const r = await one<{ r: { done: number } }>(PAY, `select reopen_work_entries(array['${id}'::uuid]) r`);
    expect(r.r.done).toBe(1);
    expect(await entry(id)).toMatchObject({ status: 'submitted', decided_by: null });
    await as(SUP, `update work_entries set quantity = 11 where id = '${id}'`);
    expect((await entry(id)).amount).toBe('132.00');
  });
});

describe("a worker's own submission", () => {
  it('waits for their supervisor, who is told, approves in bulk or rejects with a reason; the worker is told', async () => {
    const a = await insertEntry(W1, `(employee_number, work_date, work_type_id, quantity, status) values ('W1', current_date - 1, ${TEA}, 20, 'draft')`);
    const b = await insertEntry(W1, `(employee_number, work_date, work_type_id, quantity, status) values ('W1', current_date - 2, ${TEA}, 30, 'draft')`);
    await as(W1, `select submit_work_entries(array['${a}'::uuid, '${b}'::uuid])`);
    expect((await entry(a)).status).toBe('submitted');
    expect((await notes('S1', 'approval_needed')).at(-1)?.message).toMatch(/Wanjiru One submitted work/);

    await expect(as(W1, `select decide_work_entries(array['${a}'::uuid], 'approved')`)).resolves.toBeDefined();
    expect((await entry(a)).status).toBe('submitted'); // their own approval was refused
    await expect(as(SUP, `select decide_work_entries(array['${b}'::uuid], 'rejected')`)).rejects.toThrow(/Say why/);
    await as(SUP, `select decide_work_entries(array['${b}'::uuid], 'rejected', 'Scale says 25')`);
    await as(SUP, `select decide_work_entries(array['${a}'::uuid], 'approved')`);
    expect(await entry(a)).toMatchObject({ status: 'approved', decided_by: SUP });
    const told = await notes('W1', 'approval_progress');
    expect(told.map((n) => n.title)).toEqual(['Work not approved', 'Work approved']);
    expect(told[0].message).toMatch(/Reason: Scale says 25/);

    // the worker corrects the rejected one and sends it again; approved work is closed to them
    await as(W1, `update work_entries set quantity = 25 where id = '${b}'`);
    await as(W1, `select submit_work_entries(array['${b}'::uuid])`);
    expect((await entry(b)).status).toBe('submitted');
    await expect(as(W1, `update work_entries set quantity = 1 where id = '${a}'`)).rejects.toThrow(/only be changed by payroll/);
  });

  it("a worker can't touch what their supervisor recorded for them", async () => {
    const id = (await rows<{ id: string }>(`select id from work_entries where employee_number = 'W1' and source = 'supervisor' limit 1`))[0].id;
    await expect(as(W1, `update work_entries set quantity = 1000 where id = '${id}'`)).rejects.toThrow(/payroll/);
  });
});

describe('month lock', () => {
  it("nothing is recorded, changed or imported in a month whose payroll is approved", async () => {
    const id = await insertEntry(PAY, `(employee_number, work_date, work_type_id, quantity) values ('W3', ${PREV_MONTH}, ${TEA}, 10)`);
    await db.exec(`insert into payroll_runs (tenant_id, pay_period, status) values ('${A}', to_char(${PREV_MONTH}, 'YYYY-MM'), 'approved')`);
    await expect(as(PAY, `update work_entries set quantity = 11 where id = '${id}'`)).rejects.toThrow(/is approved/);
    await expect(as(PAY, `select reopen_work_entries(array['${id}'::uuid])`)).resolves.toBeDefined();
    expect((await entry(id)).status).toBe('approved');
    await expect(
      as(SUP, `insert into work_entries (employee_number, work_date, work_type_id, quantity) values ('W1', ${PREV_MONTH}, ${TEA}, 1)`)
    ).rejects.toThrow(/is approved/);
  });
});

describe('spreadsheet import', () => {
  type Row = { row: number; ok: boolean; error: string | null; employee_number: string; amount: number | null };
  const sheet = (r: Record<string, unknown>[]) => `'${JSON.stringify(r).replace(/'/g, "''")}'::jsonb`;
  const today = async () => (await rows<{ d: string }>(`select to_char(current_date, 'YYYY-MM-DD') d`))[0].d;
  const yesterday = async () => (await rows<{ d: string }>(`select to_char(current_date - 1, 'YYYY-MM-DD') d`))[0].d;
  const prev = async () => (await rows<{ d: string }>(`select to_char(${PREV_MONTH}, 'YYYY-MM-DD') d`))[0].d;

  it('checks every row and imports only the good ones, keeping a record', async () => {
    const d = await today();
    const y = await yesterday();
    const input = [
      { employee_number: 'w2', work_date: y, work_type: 'tea PICKED', quantity: '12.5' },     // ok (any case)
      { employee_number: 'NOBODY', work_date: d, work_type: 'Tea picked', quantity: 3 },
      { employee_number: 'W2', work_date: d, work_type: 'Ploughing', quantity: 3 },
      { employee_number: 'W2', work_date: d, work_type: 'Weeding', quantity: 'lots' },
      { employee_number: 'W2', work_date: await prev(), work_type: 'Weeding', quantity: 2 },
      { employee_number: 'W2', work_date: y, work_type: 'Tea picked', quantity: 4 },          // same as row 1
      { employee_number: 'C1', work_date: d, work_type: 'Weeding', quantity: 2 },
      { employee_number: 'M1', work_date: d, work_type: 'Weeding', quantity: 2 },
      { employee_number: 'W3', work_date: '16/10/26', work_type: 'Weeding', quantity: 2 },
      { employee_number: 'W1', work_date: d, work_type: 'Tea picked', quantity: 1 },          // already recorded today
      { employee_number: 'W3', work_date: d, work_type: 'Weeding', quantity: 3, notes: 'North block' },
    ];
    const checked = (await one<{ r: Row[] }>(PAY, `select check_work_import(${sheet(input)}) r`)).r;
    expect(checked.map((r) => r.ok)).toEqual([true, false, false, false, false, false, false, false, false, false, true]);
    expect(checked[0]).toMatchObject({ employee_number: 'W2', amount: 150 });
    const errors = checked.map((r) => r.error ?? '');
    expect(errors[1]).toMatch(/Unknown worker NOBODY/);
    expect(errors[2]).toMatch(/Unknown kind of work "Ploughing"/);
    expect(errors[3]).toMatch(/quantity "lots"/);
    expect(errors[4]).toMatch(/locked/);
    expect(errors[5]).toMatch(/as row 1/);
    expect(errors[6]).toMatch(/casual/);
    expect(errors[7]).toMatch(/paid a salary/);
    expect(errors[8]).toMatch(/should look like/);
    expect(errors[9]).toMatch(/Already recorded/);
    // checking adds nothing
    expect(await rows(`select 1 from work_entries where source = 'upload'`)).toHaveLength(0);

    const out = (await one<{ r: { import_id: string; imported: number; problems: { row: number }[] } }>(
      PAY, `select import_work_entries('october.xlsx', ${sheet(input)}) r`
    )).r;
    expect(out.imported).toBe(2);
    expect(out.problems.map((p) => p.row)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const added = await rows<{ status: string; source: string; notes: string | null }>(
      `select status, source, notes from work_entries where import_id = '${out.import_id}' order by employee_number`
    );
    expect(added).toEqual([
      { status: 'approved', source: 'upload', notes: null },
      { status: 'approved', source: 'upload', notes: 'North block' },
    ]);
    const rec = await one<{ file_name: string; row_count: number; imported_count: number; problem_count: number; imported_by: string }>(
      PAY, `select file_name, row_count, imported_count, problem_count, imported_by from work_imports`
    );
    expect(rec).toEqual({ file_name: 'october.xlsx', row_count: 11, imported_count: 2, problem_count: 9, imported_by: PAY });
  });

  it('only payroll uploads, and the import record is theirs alone', async () => {
    await expect(as(SUP, `select check_work_import('[]'::jsonb)`)).rejects.toThrow(/Only payroll/);
    await expect(as(SUP, `select import_work_entries('x.csv', '[]'::jsonb)`)).rejects.toThrow(/Only payroll/);
    expect(await read(SUP, `select 1 from work_imports`)).toHaveLength(0);
    await expect(as(PAY, `insert into work_imports (file_name) values ('fake')`)).rejects.toThrow(/permission denied/);
  });
});

describe('rates from a date', () => {
  it("work takes the rate in force on its day; a kind of work can be limited to dates", async () => {
    const weeding = `(select id from work_types where name = 'Weeding' and tenant_id = '${A}')`;
    await as(PAY, `select set_work_rate(${weeding}, 40, current_date - 3)`);
    const before = await insertEntry(PAY, `(employee_number, work_date, work_type_id, quantity) values ('W3', current_date - 5, ${weeding}, 1)`);
    const after = await insertEntry(PAY, `(employee_number, work_date, work_type_id, quantity) values ('W3', current_date - 1, ${weeding}, 1)`);
    expect((await entry(before)).rate).toBe('35.00');
    expect((await entry(after)).rate).toBe('40.00');
    expect((await rows<{ rate: string }>(`select rate from work_types where name = 'Weeding'`))[0].rate).toBe('40.00');
    await expect(as(SUP, `select set_work_rate(${weeding}, 99, current_date)`)).rejects.toThrow(/Only payroll/);

    await as(PAY, `update work_types set effective_to = current_date - 10 where name = 'Weeding'`);
    await expect(
      as(PAY, `insert into work_entries (employee_number, work_date, work_type_id, quantity) values ('W3', current_date, ${weeding}, 1)`)
    ).rejects.toThrow(/can only be recorded/);
    await as(PAY, `update work_types set effective_to = null where name = 'Weeding'`);
  });
});

describe('worker pay setup', () => {
  it('payroll sets employee or contractor, salary or work, frequency and withholding tax; never for casuals', async () => {
    await as(PAY, `select set_worker_pay('W3', 'contractor', 'work', 'per_job', 'contractual')`);
    expect(await rows(`select worker_kind, pay_basis, pay_frequency, wht_category from employees where "Employee Number" = 'W3'`)).toEqual([
      { worker_kind: 'contractor', pay_basis: 'work', pay_frequency: 'per_job', wht_category: 'contractual' },
    ]);
    await expect(as(PAY, `select set_worker_pay('W3', 'contractor', 'work', 'daily', null)`)).rejects.toThrow(/withholding tax/);
    await expect(as(PAY, `select set_worker_pay('M1', 'employee', 'salary', 'daily', null)`)).rejects.toThrow(/salary is paid monthly/);
    await expect(as(PAY, `select set_worker_pay('C1', 'employee', 'work', 'daily', null)`)).rejects.toThrow(/Casual workers/);
    await expect(as(SUP, `select set_worker_pay('W1', 'employee', 'work', 'daily', null)`)).rejects.toThrow(/Only payroll/);
    await as(PAY, `select set_worker_pay('W3', 'employee', 'work', 'daily', 'professional')`);
    expect((await rows<{ wht_category: string | null }>(`select wht_category from employees where "Employee Number" = 'W3'`))[0].wht_category).toBeNull();
  });
});

describe('contract jobs', () => {
  const job = async () => (await rows<{ id: string; status: string }>(`select id, status from contract_jobs where title = 'Fence the east block'`))[0];

  it('created, completed, approved; each step tells the right person', async () => {
    await as(SUP, `insert into contract_jobs (employee_number, title, amount, due_date) values ('W1', 'Fence the east block', 15000, current_date + 7)`);
    expect((await notes('W1', 'employment_update')).at(-1)?.message).toMatch(/Fence the east block.*KES 15,000.00/);
    const { id } = await job();
    await as(W1, `update contract_jobs set status = 'completed', completion_notes = 'Done' where id = '${id}'`);
    expect((await notes('S1', 'approval_needed')).at(-1)?.title).toBe('Contract job ready for approval');
    await as(SUP, `update contract_jobs set status = 'approved' where id = '${id}'`);
    expect((await job()).status).toBe('approved');
    expect((await notes('W1', 'approval_progress')).at(-1)?.title).toBe('Contract job approved');
  });

  it('no jobs for casual workers', async () => {
    await expect(as(PAY, `insert into contract_jobs (employee_number, title, amount) values ('C1', 'Dig', 500)`)).rejects.toThrow(/casual worker/);
  });
});

describe('running totals', () => {
  it("per worker: approved quantity and gross, what's waiting, approved jobs; a supervisor sees only their team", async () => {
    const t = await read<{ employee_number: string; approved_amount: string; waiting_amount: string; jobs_approved_amount: string; lines: { work_type: string; quantity: number }[] }>(
      SUP, `select * from work_totals(current_date - 30, current_date)`
    );
    expect(t.map((r) => r.employee_number).sort()).toEqual(['W1', 'W2']);
    const w1 = t.find((r) => r.employee_number === 'W1')!;
    expect(Number(w1.jobs_approved_amount)).toBe(15000);
    expect(Number(w1.waiting_amount)).toBe(300); // the corrected 25 kg sent again
    expect(Number(w1.approved_amount)).toBe(492 + 240);
    expect(w1.lines).toEqual([{ work_type: 'Tea picked', unit: 'kg', quantity: 61, amount: 732 }]);
    const all = await read<{ employee_number: string }>(PAY, `select employee_number from work_totals(current_date - 30, current_date)`);
    expect(all.map((r) => r.employee_number)).toContain('W3');
  });
});

describe('company isolation', () => {
  it('another company sees and changes nothing', async () => {
    expect(await read(OTHER, `select 1 from work_entries`)).toHaveLength(0);
    expect(await read(OTHER, `select 1 from work_type_rates`)).toHaveLength(0);
    expect(await read(OTHER, `select 1 from work_imports`)).toHaveLength(0);
    expect(await read(OTHER, `select employee_number from work_people()`)).toEqual([{ employee_number: 'X1' }]);
    expect(await read(OTHER, `select 1 from work_totals(current_date - 30, current_date)`)).toHaveLength(0);
    const ids = (await rows<{ id: string }>(`select id from work_entries where tenant_id = '${A}' and status = 'submitted'`)).map((r) => `'${r.id}'::uuid`);
    const out = await one<{ r: { done: number } }>(OTHER, `select decide_work_entries(array[${ids.join(',')}], 'approved') r`);
    expect(out.r.done).toBe(0);
    const imp = (await one<{ r: { ok: boolean; error: string }[] }>(
      OTHER, `select check_work_import('[{"employee_number":"W1","work_date":"2026-10-01","work_type":"Tea picked","quantity":1}]'::jsonb) r`
    )).r;
    expect(imp[0].error).toMatch(/Unknown worker/);
  });
});

describe('the migration', () => {
  it('runs again safely, keeping data and rules', async () => {
    const before = await rows(`select count(*)::int n from work_entries`);
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    await db.exec('reset search_path');
    expect(await rows(`select count(*)::int n from work_entries`)).toEqual(before);
    expect((await rows<{ n: number }>(`select count(*)::int n from work_type_rates where work_type_id = ${TEA}`))[0].n).toBe(1);
    await expect(
      as(SUP, `insert into work_entries (employee_number, work_date, work_type_id, quantity) values ('W3', current_date, ${TEA}, 5)`)
    ).rejects.toThrow(/row-level security|only record work/);
  });
});
