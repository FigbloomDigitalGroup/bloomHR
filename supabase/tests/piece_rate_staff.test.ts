// @vitest-environment node
//
// Piece rate stage 3 (FIG-812): the staff portal. A worker sees only their own entries and jobs, records their own work
// for today or up to the company's limit back (never a future day), can't change approved work, marks their own jobs
// done (the approver is told), and sees their own gross for a month. Migration 20261020100000.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const PAY = '00000000-0000-0000-0000-00000000e001';
const SUP = '00000000-0000-0000-0000-00000000e002';
const W1 = '00000000-0000-0000-0000-00000000e003';
const W2 = '00000000-0000-0000-0000-00000000e004';
const M1 = '00000000-0000-0000-0000-00000000e005';
const OTHER = '00000000-0000-0000-0000-00000000e006';

const MIGRATION = join(__dirname, '..', 'migrations', '20261020100000_piece_rate_staff.sql');
const TODAY = `(now() at time zone 'Africa/Nairobi')::date`;

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const one = async <T = Record<string, unknown>>(user: string, sql: string) => (await read<T>(user, sql))[0];

const TEA = `(select id from work_types where name = 'Tea picked' and tenant_id = '${A}')`;
const WEED = `(select id from work_types where name = 'Weeding' and tenant_id = '${A}')`;
const mine = async (user: string, emp: string, day: string, type: string, qty: number, status = 'draft') =>
  (await read<{ id: string }>(user, `insert into work_entries (employee_number, work_date, work_type_id, quantity, status)
    values ('${emp}', ${day}, ${type}, ${qty}, '${status}') returning id`))[0].id;
const statusOf = async (id: string) => (await rows<{ status: string; reopened_at: string | null }>(`select status, reopened_at from work_entries where id = '${id}'`))[0];

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values
      ('${PAY}', 'pay@a.co'), ('${SUP}', 'sup@a.co'), ('${W1}', 'w1@a.co'), ('${W2}', 'w2@a.co'), ('${M1}', 'm1@a.co'),
      ('${OTHER}', 'x1@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${PAY}', 'pay@a.co', 'FINANCE', '${A}'), ('${SUP}', 'sup@a.co', 'STAFF', '${A}'), ('${W1}', 'w1@a.co', 'STAFF', '${A}'),
      ('${W2}', 'w2@a.co', 'STAFF', '${A}'), ('${M1}', 'm1@a.co', 'STAFF', '${A}'), ('${OTHER}', 'x1@b.co', 'STAFF', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('FINANCE', array['work-records', 'payroll'], '${A}'), ('STAFF', array['dashboard'], '${A}'), ('STAFF', array['dashboard'], '${B}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", manager_email, pay_basis, pay_frequency, tenant_id) values
      ('P1', 'Pauline', 'Pay', 'pay@a.co', null, 'salary', 'monthly', '${A}'),
      ('S1', 'Sam', 'Super', 'sup@a.co', null, 'salary', 'monthly', '${A}'),
      ('W1', 'Wanjiru', 'One', 'w1@a.co', 'sup@a.co', 'work', 'daily', '${A}'),
      ('W2', 'Otieno', 'Two', 'w2@a.co', 'sup@a.co', 'work', 'weekly', '${A}'),
      ('M1', 'Mary', 'Salaried', 'm1@a.co', 'sup@a.co', 'salary', 'monthly', '${A}'),
      ('X1', 'Xena', 'Other', 'x1@b.co', null, 'work', 'daily', '${B}');
  `);
  await as(PAY, `insert into work_types (name, unit, rate) values ('Tea picked', 'kg', 12), ('Weeding', 'row', 35)`);
}, 120000);

describe('who sees My work', () => {
  it('workers paid by work qualify; salaried staff only once they have a contract job', async () => {
    const w1 = (await one<{ p: Record<string, unknown> }>(W1, `select my_work_profile() p`)).p;
    expect(w1).toMatchObject({ employee_number: 'W1', pay_basis: 'work', has_jobs: false, qualifies: true, past_days: 7, closed_months: [] });
    expect((await one<{ p: { qualifies: boolean } }>(M1, `select my_work_profile() p`)).p.qualifies).toBe(false);
    await as(SUP, `insert into contract_jobs (employee_number, title, amount) values ('M1', 'Paint the store', 4000)`);
    expect((await one<{ p: { qualifies: boolean; has_jobs: boolean } }>(M1, `select my_work_profile() p`)).p).toMatchObject({ qualifies: true, has_jobs: true });
  });
});

describe('recording my own work', () => {
  it('today and up to the limit back; never a future day or older than the limit', async () => {
    await mine(W1, 'W1', TODAY, TEA, 10);
    await mine(W1, 'W1', `${TODAY} - 7`, TEA, 5);
    await expect(mine(W1, 'W1', `${TODAY} + 1`, TEA, 1)).rejects.toThrow(/future day/);
    await expect(mine(W1, 'W1', `${TODAY} - 8`, TEA, 1)).rejects.toThrow(/last 7 days only/);
    // the supervisor isn't limited by it
    await mine(SUP, 'W1', `${TODAY} - 20`, WEED, 2);
  });

  it('payroll changes the limit; a worker cannot', async () => {
    await expect(as(W1, `select set_work_settings('{"self_work_past_days": 30}')`)).rejects.toThrow(/Only payroll/);
    await expect(as(PAY, `select set_work_settings('{"self_work_past_days": 100}')`)).rejects.toThrow(/0 to 62/);
    const s = await one<{ s: { self_work_past_days: number; supervisor_work_needs_approval: boolean } }>(PAY, `select set_work_settings('{"self_work_past_days": 2}') s`);
    expect(s.s).toMatchObject({ self_work_past_days: 2, supervisor_work_needs_approval: true });
    await expect(mine(W1, 'W1', `${TODAY} - 3`, WEED, 1)).rejects.toThrow(/last 2 days only/);
    // moving an entry's day is checked too
    const id = await mine(W1, 'W1', TODAY, WEED, 1);
    await expect(as(W1, `update work_entries set work_date = ${TODAY} - 5 where id = '${id}'`)).rejects.toThrow(/last 2 days/);
    await as(W1, `delete from work_entries where id = '${id}'`);
    await as(PAY, `select set_work_settings('{"self_work_past_days": 7}')`);
  });

  it('submitting tells the supervisor once for the batch; approved work is then closed to the worker', async () => {
    const ids = (await read<{ id: string }>(W1, `select id from work_entries where employee_number = 'W1' and status = 'draft' and source = 'self'`)).map((r) => r.id);
    expect(ids).toHaveLength(2);
    const before = (await rows(`select 1 from hr_notifications where employee_number = 'S1' and notification_type = 'approval_needed'`)).length;
    const out = await one<{ r: { submitted: number } }>(W1, `select submit_work_entries(array[${ids.map((i) => `'${i}'::uuid`).join(',')}]) r`);
    expect(out.r.submitted).toBe(2);
    const after = await rows<{ message: string }>(`select message from hr_notifications where employee_number = 'S1' and notification_type = 'approval_needed' order by id`);
    expect(after.length - before).toBe(1);
    expect(after.at(-1)?.message).toMatch(/Wanjiru One submitted work/);

    await as(SUP, `select decide_work_entries(array['${ids[0]}'::uuid], 'approved')`);
    await expect(as(W1, `update work_entries set quantity = 99 where id = '${ids[0]}'`)).rejects.toThrow(/only be changed by payroll/);
    await expect(as(W1, `delete from work_entries where id = '${ids[0]}'`)).rejects.toThrow(/only be removed by payroll/);

    // reopened by payroll: the worker sees it as reopened
    await as(PAY, `select reopen_work_entries(array['${ids[0]}'::uuid])`);
    expect((await statusOf(ids[0])).reopened_at).not.toBeNull();
    await as(SUP, `select decide_work_entries(array['${ids[0]}'::uuid], 'approved')`);
    expect(await statusOf(ids[0])).toMatchObject({ status: 'approved', reopened_at: null });
  });
});

describe('a worker sees only their own', () => {
  it('entries and jobs', async () => {
    await mine(W2, 'W2', TODAY, TEA, 3);
    await as(SUP, `insert into contract_jobs (employee_number, title, amount) values ('W2', 'Clear the ditch', 2500)`);
    const entries = await read<{ employee_number: string }>(W1, `select distinct employee_number from work_entries`);
    expect(entries.map((e) => e.employee_number)).toEqual(['W1']);
    expect(await read(W1, `select 1 from contract_jobs`)).toHaveLength(0);
    expect((await read<{ employee_number: string }>(W2, `select distinct employee_number from contract_jobs`)).map((r) => r.employee_number)).toEqual(['W2']);
    // and can't record for someone else
    await expect(mine(W1, 'W2', TODAY, TEA, 1)).rejects.toThrow(/row-level security|only record work/);
  });
});

describe('marking a job done', () => {
  it('only my own open job; the approver is told; a file must be in the job folder', async () => {
    await as(SUP, `insert into contract_jobs (employee_number, title, amount, due_date) values ('W1', 'Fence the east block', 15000, ${TODAY} + 7)`);
    const job = (await rows<{ id: string }>(`select id from contract_jobs where title = 'Fence the east block'`))[0].id;
    const ditch = (await rows<{ id: string }>(`select id from contract_jobs where title = 'Clear the ditch'`))[0].id;
    await expect(as(W1, `select complete_my_job('${ditch}', null)`)).rejects.toThrow(/Job not found/);
    await expect(as(W1, `select complete_my_job('${job}', 'done', '${A}/${ditch}/x.jpg', 'x.jpg')`)).rejects.toThrow(/doesn't belong/);
    await as(W1, `select complete_my_job('${job}', '  All posts in  ', '${A}/${job}/photo.jpg', 'photo.jpg')`);
    expect(await rows(`select status, completion_notes, completion_file_name from contract_jobs where id = '${job}'`)).toEqual([
      { status: 'completed', completion_notes: 'All posts in', completion_file_name: 'photo.jpg' },
    ]);
    const told = await rows<{ title: string }>(`select title from hr_notifications where employee_number = 'S1' and notification_type = 'approval_needed' order by id`);
    expect(told.at(-1)?.title).toBe('Contract job ready for approval');
    await expect(as(W1, `select complete_my_job('${job}', null)`)).rejects.toThrow(/Only an open job/);
    await expect(as(W1, `update contract_jobs set status = 'approved' where id = '${job}'`)).rejects.toThrow(/open job|approve/);
    await as(SUP, `update contract_jobs set status = 'approved' where id = '${job}'`);
  });
});

describe('earnings', () => {
  type Earnings = {
    approved_work: number; waiting_work: number; approved_jobs: number; waiting_jobs: number;
    by_type: { work_type: string; quantity: number; amount: number; waiting_amount: number }[];
    by_week: { from: string; to: string; work: number; jobs: number; waiting: number }[];
    from: string; to: string;
  };

  it('my own gross this month: approved and waiting work and jobs, by kind of work and by week', async () => {
    // W1 this month (day 1..today): approved tea 10 kg today (or 5 kg if 7 days back fell in this month too)
    const e = (await one<{ e: Earnings }>(W1, `select my_work_earnings() e`)).e;
    const expected = await rows<{ approved: string; waiting: string }>(`
      select coalesce(sum(amount) filter (where status = 'approved'), 0) approved, coalesce(sum(amount) filter (where status = 'submitted'), 0) waiting
      from work_entries where employee_number = 'W1' and tenant_id = '${A}' and date_trunc('month', work_date) = date_trunc('month', ${TODAY})`);
    expect(Number(e.approved_work)).toBe(Number(expected[0].approved));
    expect(Number(e.waiting_work)).toBe(Number(expected[0].waiting));
    expect(Number(e.approved_jobs)).toBe(15000);
    expect(Number(e.waiting_jobs)).toBe(0);
    const weeks = e.by_week.reduce((s, w) => s + Number(w.work) + Number(w.jobs), 0);
    expect(weeks).toBe(Number(e.approved_work) + Number(e.approved_jobs));
    expect(e.by_week[0].from).toBe(e.from);
    expect(e.by_week.at(-1)?.to).toBe(e.to);
    expect(e.by_type.reduce((s, t) => s + Number(t.amount), 0)).toBe(Number(e.approved_work));
  });

  it('a past month, and nothing of anyone else', async () => {
    const prev = (await one<{ e: Earnings }>(W1, `select my_work_earnings((date_trunc('month', ${TODAY}) - interval '1 month')::date) e`)).e;
    expect(prev.from.endsWith('-01')).toBe(true);
    const w2 = (await one<{ e: Earnings }>(W2, `select my_work_earnings() e`)).e;
    expect(Number(w2.approved_jobs)).toBe(0);
    expect(Number(w2.approved_work)).toBe(0);
    expect(Number(w2.waiting_work)).toBe(0); // their 3 kg is a draft
  });
});

describe('locked months', () => {
  it('are listed for the worker', async () => {
    await db.exec(`insert into payroll_runs (tenant_id, pay_period, status) values ('${A}', to_char(${TODAY} - interval '2 months', 'YYYY-MM'), 'approved')`);
    const p = (await one<{ p: { closed_months: string[] } }>(W1, `select my_work_profile() p`)).p;
    expect(p.closed_months).toHaveLength(1);
  });
});

describe('company isolation', () => {
  it('another company sees nothing of ours', async () => {
    expect(await read(OTHER, `select 1 from work_entries`)).toHaveLength(0);
    expect(await read(OTHER, `select 1 from contract_jobs`)).toHaveLength(0);
    const e = (await one<{ e: { approved_work: number; approved_jobs: number } }>(OTHER, `select my_work_earnings() e`)).e;
    expect(Number(e.approved_work) + Number(e.approved_jobs)).toBe(0);
    const p = (await one<{ p: { closed_months: string[]; employee_number: string } }>(OTHER, `select my_work_profile() p`)).p;
    expect(p).toMatchObject({ employee_number: 'X1', closed_months: [] });
    const job = (await rows<{ id: string }>(`select id from contract_jobs where title = 'Clear the ditch'`))[0].id;
    await expect(as(OTHER, `select complete_my_job('${job}', null)`)).rejects.toThrow(/Job not found/);
  });
});

describe('the migration', () => {
  it('runs again safely, keeping data, settings and rules', async () => {
    await as(PAY, `select set_work_settings('{"self_work_past_days": 3}')`);
    const before = await rows(`select count(*)::int n from work_entries`);
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    await db.exec('reset search_path');
    expect(await rows(`select count(*)::int n from work_entries`)).toEqual(before);
    expect((await one<{ s: { self_work_past_days: number } }>(PAY, `select work_settings() s`)).s.self_work_past_days).toBe(3);
    await expect(mine(W1, 'W1', `${TODAY} - 4`, TEA, 1)).rejects.toThrow(/last 3 days only/);
  });
});
