// @vitest-environment node
//
// Exits (FIG-832): resignations and terminations. Staff resign only themselves, with at least their notice period; HR
// (employees or hr-lifecycle module) starts terminations and runs the checklist, interview and final dues; HR or an
// administrator approves, not the person who started it while someone else can. When the exit ends the employee is
// Terminated, their login to the company is deactivated and payslips after their last month are refused.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR1 = '00000000-0000-0000-0000-00000000e001';
const HR2 = '00000000-0000-0000-0000-00000000e002';
const MGR = '00000000-0000-0000-0000-00000000e003';
const S1 = '00000000-0000-0000-0000-00000000e004';
const S2 = '00000000-0000-0000-0000-00000000e005';
const S3 = '00000000-0000-0000-0000-00000000e006';
const HRB = '00000000-0000-0000-0000-00000000e007';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const insertExit = async (user: string, values: string) =>
  (await read<{ id: string }>(user, `insert into employee_exits ${values} returning id`))[0].id;
const exit = async (id: string) =>
  (
    await rows<{ status: string; notice_days: number; last_working_day: string; decided_by: string | null; requested_by: string; access_ended_at: string | null }>(
      `select status, notice_days, to_char(last_working_day, 'YYYY-MM-DD') last_working_day, decided_by, requested_by, access_ended_at from employee_exits where id = '${id}'`
    )
  )[0];
const day = (offset: number) => `current_date + ${offset}`;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values
      ('${HR1}', 'hr1@a.co'), ('${HR2}', 'hr2@a.co'), ('${MGR}', 'mgr@a.co'), ('${S1}', 's1@a.co'), ('${S2}', 's2@a.co'),
      ('${S3}', 's3@a.co'), ('${HRB}', 'hr@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HR1}', 'hr1@a.co', 'HR', '${A}'), ('${HR2}', 'hr2@a.co', 'HR', '${A}'), ('${MGR}', 'mgr@a.co', 'MANAGER', '${A}'),
      ('${S1}', 's1@a.co', 'STAFF', '${A}'), ('${S2}', 's2@a.co', 'STAFF', '${A}'), ('${S3}', 's3@a.co', 'STAFF', '${A}'),
      ('${HRB}', 'hr@b.co', 'HR', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees', 'hr-lifecycle'], '${A}'), ('MANAGER', array['hr-lifecycle'], '${A}'),
      ('STAFF', array['dashboard'], '${A}'), ('HR', array['employees', 'hr-lifecycle'], '${B}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Basic Salary", notice_days, onboarding_status, tenant_id) values
      ('H1', 'Hana', 'Hr', 'hr1@a.co', 100000, null, 'approved', '${A}'),
      ('E1', 'Esther', 'One', 's1@a.co', 60000, 30, 'approved', '${A}'),
      ('E2', 'Eric', 'Two', 's2@a.co', 50000, null, 'approved', '${A}'),
      ('E3', 'Eve', 'Three', 's3@a.co', 40000, null, 'approved', '${A}'),
      ('X1', 'Xena', 'Other', 'x1@b.co', 40000, null, 'approved', '${B}');
    insert into assets (asset_name, asset_tag, assigned_to, tenant_id) values
      ('Laptop', 'LT-9', 'Eric Two (E2)', '${A}'), ('Phone', null, 'Somebody (E22)', '${A}');
  `);
}, 120000);

describe('resigning (staff)', () => {
  it('staff resign only themselves, and only with their notice period (from the contract, else 28 days)', async () => {
    await expect(
      as(S1, `insert into employee_exits (employee_number, kind, last_working_day) values ('E2', 'resignation', ${day(60)})`)
    ).rejects.toThrow(/row-level security|only resign yourself/);
    await expect(
      as(S1, `insert into employee_exits (employee_number, kind, reason_category, last_working_day) values ('E1', 'termination', 'other', ${day(60)})`)
    ).rejects.toThrow(/Only HR can start a termination/);
    await expect(
      as(S1, `insert into employee_exits (employee_number, kind, last_working_day) values ('E1', 'resignation', ${day(29)})`)
    ).rejects.toThrow(/notice period is 30 days/);

    // whatever they claim, it is a request with today's notice and their contract's notice period, no notice pay
    const id = await insertExit(
      S1,
      `(employee_number, kind, last_working_day, notice_days, notice_pay, status, notice_given_on, reason)
       values ('E1', 'resignation', ${day(30)}, 1, true, 'approved', current_date - 100, 'New job')`
    );
    const row = await exit(id);
    expect(row).toMatchObject({ status: 'requested', notice_days: 30, requested_by: S1, decided_by: null });
    expect((await rows<{ notice_pay: boolean; g: boolean }>(`select notice_pay, notice_given_on = current_date g from employee_exits where id = '${id}'`))[0]).toEqual({ notice_pay: false, g: true });

    // HR hears of it (and the employee's bell doesn't show it)
    expect(await rows(`select title from hr_notifications where employee_number = 'E1' and notification_type = 'exit_requested'`)).toHaveLength(1);
    expect((await rows<{ hr: boolean }>(`select public.hr_only_notification('exit_requested') hr`))[0].hr).toBe(true);

    // one open exit at a time
    await expect(as(S1, `insert into employee_exits (employee_number, kind, last_working_day) values ('E1', 'resignation', ${day(40)})`)).rejects.toThrow(
      /duplicate|unique/i
    );
  });

  it('staff see only their own exit, and cannot approve it; they may withdraw it while it waits', async () => {
    expect(await read(S2, `select 1 from employee_exits`)).toHaveLength(0);
    const [{ id }] = await read<{ id: string }>(S1, `select id from employee_exits where employee_number = 'E1'`);
    await expect(as(S1, `update employee_exits set status = 'approved' where id = '${id}'`)).rejects.toThrow(/Only HR can approve/);
    await as(S1, `update employee_exits set last_working_day = ${day(45)}, reason = 'Relocating' where id = '${id}'`);
    expect((await exit(id)).last_working_day).toBe((await rows<{ d: string }>(`select to_char(${day(45)}, 'YYYY-MM-DD') d`))[0].d);
    await as(S1, `update employee_exits set status = 'cancelled' where id = '${id}'`);
    expect((await exit(id)).status).toBe('cancelled');
    // and can resign again later
    await as(S1, `insert into employee_exits (employee_number, kind, last_working_day) values ('E1', 'resignation', ${day(30)})`);
  });

  it('HR approves or declines (a reason is needed to decline); the employee hears either way', async () => {
    const [{ id }] = await rows<{ id: string }>(`select id from employee_exits where employee_number = 'E1' and status = 'requested'`);
    await expect(as(MGR, `update employee_exits set status = 'approved' where id = '${id}'`)).rejects.toThrow(/Only HR or an administrator/);
    await expect(as(HR1, `update employee_exits set status = 'declined' where id = '${id}'`)).rejects.toThrow(/check/i);
    await as(HR1, `update employee_exits set status = 'approved', decision_note = 'Thank you' where id = '${id}'`);
    expect(await exit(id)).toMatchObject({ status: 'approved', decided_by: HR1 });
    expect(await read(S1, `select title from hr_notifications where notification_type = 'exit_approved'`)).toEqual([{ title: 'Resignation accepted' }]);
    // once decided, the employee can no longer change it
    await expect(as(S1, `update employee_exits set reason = 'x' where id = '${id}'`)).rejects.toThrow(/has been approved/);
  });
});

describe('terminating (HR)', () => {
  it('HR starts it with a reason category; staff and other companies cannot see it', async () => {
    await expect(
      as(HR1, `insert into employee_exits (employee_number, kind, last_working_day) values ('E2', 'termination', ${day(10)})`)
    ).rejects.toThrow(/check/i);
    const id = await insertExit(
      HR1,
      `(employee_number, kind, reason_category, reason, last_working_day, notice_pay) values ('E2', 'termination', 'redundancy', 'Role closed', ${day(10)}, true)`
    );
    expect(await exit(id)).toMatchObject({ status: 'requested', notice_days: 28, requested_by: HR1 });
    expect(await read(S2, `select 1 from employee_exits`)).toHaveLength(0);
    expect(await read(HRB, `select 1 from employee_exits`)).toHaveLength(0);
    await as(HRB, `update employee_exits set status = 'cancelled'`);
    expect((await exit(id)).status).toBe('requested');
    // never in the employee's bell
    expect(await rows(`select 1 from hr_notifications where employee_number = 'E2' and notification_type like 'exit%'`)).toHaveLength(0);
  });

  it('the person who started it cannot approve it while another HR person can; someone else can', async () => {
    const [{ id }] = await rows<{ id: string }>(`select id from employee_exits where employee_number = 'E2'`);
    await expect(as(HR1, `update employee_exits set status = 'approved' where id = '${id}'`)).rejects.toThrow(/another HR person/);
    await as(HR2, `update employee_exits set status = 'approved' where id = '${id}'`);
    expect(await exit(id)).toMatchObject({ status: 'approved', decided_by: HR2 });
  });

  it('a module-only HR user may start one but only HR or an administrator approves', async () => {
    const id = await insertExit(MGR, `(employee_number, kind, reason_category, last_working_day) values ('E3', 'termination', 'misconduct', ${day(0)})`);
    await expect(as(MGR, `update employee_exits set status = 'approved' where id = '${id}'`)).rejects.toThrow(/Only HR or an administrator/);
    await as(HR1, `update employee_exits set status = 'approved' where id = '${id}'`);
    expect((await exit(id)).status).toBe('approved');
  });
});

describe('clearance, interview and final dues', () => {
  it('approval adds the checklist, with one item per asset assigned to them; ticking one starts clearance', async () => {
    const [{ id }] = await rows<{ id: string }>(`select id from employee_exits where employee_number = 'E2'`);
    const items = await read<{ category: string; title: string; asset: boolean }>(
      HR1,
      `select category, title, asset_id is not null asset from employee_exit_clearance_items where exit_id = '${id}' order by sort_order`
    );
    expect(items.map((i) => i.title)).toEqual([
      'Return Laptop (LT-9)',
      'Return any other company property (ID badge, keys)',
      'Close email and system access',
      'Settle salary advances, loans and expense claims',
      'Hand over work, files and passwords',
    ]);
    expect(items[0].asset).toBe(true);
    expect(await read(S2, `select 1 from employee_exit_clearance_items`)).toHaveLength(0);

    await as(HR1, `update employee_exit_clearance_items set done = true, notes = 'Returned' where exit_id = '${id}' and category = 'assets' and asset_id is not null`);
    expect((await exit(id)).status).toBe('clearance');
    const [item] = await rows<{ done_by: string }>(`select done_by from employee_exit_clearance_items where exit_id = '${id}' and asset_id is not null`);
    expect(item.done_by).toBe(HR1);
  });

  it('the exit interview is confidential to HR', async () => {
    const [{ id }] = await rows<{ id: string }>(`select id from employee_exits where employee_number = 'E2'`);
    await as(HR1, `insert into hr_termination_interviews ("Employee Number", exit_id, answers, is_completed) values ('E2', '${id}', '[{"question":"Why?","answer":"Redundancy"}]', true)`);
    expect(await read(HR2, `select 1 from hr_termination_interviews where exit_id = '${id}'`)).toHaveLength(1);
    expect(await read(S2, `select 1 from hr_termination_interviews`)).toHaveLength(0);
    await expect(as(S2, `insert into hr_termination_interviews ("Employee Number") values ('E2')`)).rejects.toThrow(/row-level security/);
  });

  it('final dues: totals from the lines, reviewed, then included in a payroll month by hand', async () => {
    const [{ id }] = await rows<{ id: string }>(`select id from employee_exits where employee_number = 'E2'`);
    const lines = JSON.stringify([
      { code: 'basic', label: 'Basic pay', kind: 'earning', amount: 25000 },
      { code: 'leave', label: 'Leave days', kind: 'earning', amount: 5000.5 },
      { code: 'advance', label: 'Salary advance', kind: 'deduction', amount: 3000 },
    ]);
    await as(HR1, `insert into employee_exit_final_dues (exit_id, employee_number, lines, earnings) values ('${id}', 'E1', '${lines}', 1)`);
    const dues = async () =>
      (await rows<Record<string, unknown>>(`select employee_number, earnings, deductions, net, status, payroll_period from employee_exit_final_dues where exit_id = '${id}'`))[0];
    expect(await dues()).toEqual({ employee_number: 'E2', earnings: '30000.50', deductions: '3000.00', net: '27000.50', status: 'draft', payroll_period: null });

    await expect(as(HR1, `update employee_exit_final_dues set lines = '[{"label":"x","kind":"bonus","amount":1}]' where exit_id = '${id}'`)).rejects.toThrow(/Each line/);
    await expect(as(HR1, `update employee_exit_final_dues set status = 'included' where exit_id = '${id}'`)).rejects.toThrow(/check/i);
    await as(HR1, `update employee_exit_final_dues set status = 'included', payroll_period = '2026-11' where exit_id = '${id}'`);
    expect(await dues()).toMatchObject({ status: 'included', payroll_period: '2026-11' });
    await expect(as(HR1, `update employee_exit_final_dues set lines = '[]' where exit_id = '${id}'`)).rejects.toThrow(/in payroll for 2026-11/);
    expect(await read(S2, `select 1 from employee_exit_final_dues`)).toHaveLength(0);
  });
});

describe('the end', () => {
  it('completing needs HR and a finished checklist; then they are Terminated and their login is deactivated', async () => {
    const [{ id }] = await rows<{ id: string }>(`select id from employee_exits where employee_number = 'E2'`);
    await expect(as(S2, `select public.complete_exit('${id}')`)).rejects.toThrow(/Only HR/);
    await expect(as(HR1, `select public.complete_exit('${id}')`)).rejects.toThrow(/4 clearance item\(s\) are still open/);
    await expect(as(HR1, `update employee_exits set status = 'completed' where id = '${id}'`)).rejects.toThrow(/complete_exit/);

    await as(HR1, `update employee_exit_clearance_items set done = true where exit_id = '${id}'`);
    await as(HR1, `select public.complete_exit('${id}')`);
    const row = await exit(id);
    expect(row.status).toBe('completed');
    expect(row.access_ended_at).not.toBeNull();
    const [emp] = await rows<{ Status: string; td: string; ok: boolean }>(
      `select "Status", "Termination Date" td, "Termination Date" = to_char(${day(10)}, 'YYYY-MM-DD') ok from employees where "Employee Number" = 'E2'`
    );
    expect(emp).toMatchObject({ Status: 'Terminated', ok: true });
    expect(await rows(`select account_status from memberships where user_id = '${S2}'`)).toEqual([{ account_status: 'DEACTIVATED' }]);
    // the sign-in check reads the profile
    expect(await rows(`select account_status from user_profiles where user_id = '${S2}'`)).toEqual([{ account_status: 'DEACTIVATED' }]);
    // the lifecycle records get the leaver
    expect(await rows(`select termination_type, final_payroll_status from hr_terminations where "Employee Number" = 'E2'`)).toEqual([
      { termination_type: 'Redundancy', final_payroll_status: 'Included in 2026-11' },
    ]);
    // and it is history now
    await expect(as(HR1, `update employee_exits set reason = 'x' where id = '${id}'`)).rejects.toThrow(/completed exit/);
    await expect(as(HR1, `update employee_exit_clearance_items set notes = 'x' where exit_id = '${id}'`)).rejects.toThrow(/completed/);
  });

  it('access also ends by itself the day after the last working day', async () => {
    // E3's termination (approved above) ends today: nothing yet
    expect((await read<{ n: number }>(HR1, `select public.end_due_exit_access() n`))[0].n).toBe(0);
    await db.exec(`update employee_exits set notice_given_on = current_date - 5, last_working_day = current_date - 1 where employee_number = 'E3'`);
    await expect(as(S3, `select public.end_due_exit_access()`)).rejects.toThrow(/Only HR/);
    expect((await read<{ n: number }>(HR1, `select public.end_due_exit_access() n`))[0].n).toBe(1);
    expect(await rows(`select "Status" from employees where "Employee Number" = 'E3'`)).toEqual([{ Status: 'Terminated' }]);
    expect(await rows(`select account_status from memberships where user_id = '${S3}'`)).toEqual([{ account_status: 'DEACTIVATED' }]);
    // an exit whose person has gone can't be cancelled any more
    await expect(as(HR1, `update employee_exits set status = 'cancelled' where employee_number = 'E3'`)).rejects.toThrow(/already left/);
  });

  it('no payslip after the month they left in', async () => {
    const left = (await rows<{ m: string; next: string }>(
      `select to_char(${day(10)}, 'YYYY-MM') m, to_char(${day(10)} + interval '1 month', 'YYYY-MM') next`
    ))[0];
    await db.exec(`insert into payroll_runs (pay_period, status, tenant_id) values ('${left.m}', 'draft', '${A}'), ('${left.next}', 'draft', '${A}')`);
    const run = async (p: string) => (await rows<{ id: string }>(`select id from payroll_runs where pay_period = '${p}' and tenant_id = '${A}'`))[0].id;
    // their last month is paid
    await db.exec(`insert into salary_history (employee_id, pay_period, net_pay, run_id, tenant_id) values ('E2', '${left.m}', 1, '${await run(left.m)}', '${A}')`);
    // the month after is not, whoever saves it
    await expect(
      db.exec(`insert into salary_history (employee_id, pay_period, net_pay, run_id, tenant_id) values ('E2', '${left.next}', 1, '${await run(left.next)}', '${A}')`)
    ).rejects.toThrow(/E2 left on .*can't be paid for/);
    // an approved exit counts before access has ended (E1 leaves in 30 days)
    const later = (await rows<{ p: string }>(`select to_char(${day(30)} + interval '1 month', 'YYYY-MM') p`))[0].p;
    await db.exec(`insert into payroll_runs (pay_period, status, tenant_id) values ('${later}', 'draft', '${A}') on conflict do nothing`);
    await expect(
      db.exec(`insert into salary_history (employee_id, pay_period, net_pay, run_id, tenant_id) values ('E1', '${later}', 1, '${await run(later)}', '${A}')`)
    ).rejects.toThrow(/E1 left on/);
    // someone staying is paid as before
    await db.exec(`insert into salary_history (employee_id, pay_period, net_pay, run_id, tenant_id) values ('H1', '${left.next}', 1, '${await run(left.next)}', '${A}')`);
  });

  it('a renumbered employee keeps their exit', async () => {
    await db.exec(`update employees set "Employee Number" = 'E2-NEW' where "Employee Number" = 'E2' and tenant_id = '${A}'`);
    expect(await rows(`select status from employee_exits where employee_number = 'E2-NEW'`)).toEqual([{ status: 'completed' }]);
    expect(await rows(`select 1 from employee_exit_final_dues where employee_number = 'E2-NEW'`)).toHaveLength(1);
  });
});
