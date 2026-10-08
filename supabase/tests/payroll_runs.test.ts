// @vitest-environment node
//
// Payroll runs: each month's payslips belong to one run that goes Draft -> Approved -> Paid. Payslips change only while
// the run is a draft, and staff see theirs only once it is approved.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const PAY = '00000000-0000-0000-0000-00000000ac01'; // finance, payroll module
const HR = '00000000-0000-0000-0000-00000000ac02'; // HR without payroll
const STAFF = '00000000-0000-0000-0000-00000000ac03'; // employee E1
const OTHER = '00000000-0000-0000-0000-00000000ac04'; // payroll user of company B

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const run = async (period: string, tenant = A) =>
  (await rows<{ id: string; status: string; approved_by: string | null; approved_at: string | null; paid_by: string | null }>(
    `select * from payroll_runs where tenant_id = '${tenant}' and pay_period = '${period}'`
  ))[0];
const pay = (sql: string) => asUser(db, PAY, () => db.exec(sql));
const payslip = (emp: string, period: string, net = 1000) =>
  `insert into salary_history (employee_id, pay_period, net_pay) values ('${emp}', '${period}', ${net})
   on conflict (tenant_id, employee_id, pay_period) do update set net_pay = excluded.net_pay`;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values
      ('${PAY}', 'pay@a.co'), ('${HR}', 'hr@a.co'), ('${STAFF}', 'e1@a.co'), ('${OTHER}', 'pay@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${PAY}', 'pay@a.co', 'FINANCE', '${A}'), ('${HR}', 'hr@a.co', 'HR', '${A}'),
      ('${STAFF}', 'e1@a.co', 'STAFF', '${A}'), ('${OTHER}', 'pay@b.co', 'FINANCE', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('FINANCE', array['payroll'], '${A}'), ('HR', array['hr-lifecycle'], '${A}'),
      ('STAFF', array['dashboard'], '${A}'), ('FINANCE', array['payroll'], '${B}');
    insert into employees ("Employee Number", "First Name", "Work Email", tenant_id) values
      ('E1', 'Ann', 'e1@a.co', '${A}'), ('E2', 'Ben', 'e2@a.co', '${A}');
  `);
}, 120000);

describe('saving payslips', () => {
  it('starts a draft run for the month, and later saves join it', async () => {
    await pay(payslip('E1', '2026-09'));
    await pay(payslip('E2', '2026-09'));
    const r = await run('2026-09');
    expect(r.status).toBe('draft');
    const attached = await rows<{ run_id: string }>(`select run_id from salary_history where pay_period = '2026-09' and tenant_id = '${A}'`);
    expect(attached.map((x) => x.run_id)).toEqual([r.id, r.id]);
  });

  it('refuses a pay period that is not year-month', async () => {
    await expect(pay(payslip('E1', 'Sept 2026'))).rejects.toThrow(/should look like 2026-09/);
  });

  it('keeps each company to its own runs', async () => {
    await asUser(db, OTHER, () => db.exec(`insert into salary_history (employee_id, pay_period) values ('X1', '2026-09')`));
    expect((await run('2026-09', B)).status).toBe('draft');
    const seen = await asUser(db, OTHER, () => rows<{ tenant_id: string }>(`select tenant_id from payroll_runs`));
    expect(seen.map((x) => x.tenant_id)).toEqual([B]);
  });
});

describe('staff see their payslip only once the run is approved', () => {
  const mine = () => asUser(db, STAFF, () => rows(`select employee_id from salary_history`));

  it('a draft is hidden from staff', async () => {
    expect(await mine()).toHaveLength(0);
  });

  it('approving shows staff their own payslip (and only theirs), and records who approved', async () => {
    await pay(`update payroll_runs set status = 'approved' where pay_period = '2026-09'`);
    const r = await run('2026-09');
    expect(r).toMatchObject({ status: 'approved', approved_by: PAY });
    expect(r.approved_at).not.toBeNull();
    expect(await mine()).toEqual([{ employee_id: 'E1' }]);
  });
});

describe('an approved run is locked', () => {
  it('payslips cannot be added, changed or removed', async () => {
    await expect(pay(payslip('E1', '2026-09', 5))).rejects.toThrow(/approved, so its payslips can't be changed/);
    await expect(pay(`update salary_history set net_pay = 5 where employee_id = 'E2'`)).rejects.toThrow(/Reopen it first/);
    await expect(pay(`delete from salary_history where employee_id = 'E2'`)).rejects.toThrow(/Reopen it first/);
    await expect(pay(payslip('E9', '2026-09'))).rejects.toThrow(/Reopen it first/);
  });

  it('the run cannot be deleted', async () => {
    await expect(pay(`delete from payroll_runs where pay_period = '2026-09'`)).rejects.toThrow(/can't be deleted/);
  });

  it('renumbering an employee still renumbers their locked payslips', async () => {
    await db.exec(`update employees set "Employee Number" = 'E2-NEW' where "Employee Number" = 'E2' and tenant_id = '${A}'`);
    expect(await rows(`select 1 from salary_history where employee_id = 'E2-NEW'`)).toHaveLength(1);
  });

  it('reopening unlocks it and hides it from staff again', async () => {
    await pay(`update payroll_runs set status = 'draft' where pay_period = '2026-09'`);
    expect(await run('2026-09')).toMatchObject({ status: 'draft', approved_by: null, approved_at: null });
    await pay(payslip('E1', '2026-09', 1200));
    expect(await asUser(db, STAFF, () => rows(`select 1 from salary_history`))).toHaveLength(0);
  });
});

describe('paying', () => {
  it('a draft cannot be marked paid without approval', async () => {
    await expect(pay(`update payroll_runs set status = 'paid' where pay_period = '2026-09'`)).rejects.toThrow(/can't go from draft to paid/);
  });

  it('an approved run can be marked paid; then it cannot be reopened or changed', async () => {
    await pay(`update payroll_runs set status = 'approved' where pay_period = '2026-09'`);
    await pay(`update payroll_runs set status = 'paid' where pay_period = '2026-09'`);
    expect(await run('2026-09')).toMatchObject({ status: 'paid', paid_by: PAY });
    await expect(pay(`update payroll_runs set status = 'draft' where pay_period = '2026-09'`)).rejects.toThrow(/can't go from paid to draft/);
    await expect(pay(payslip('E1', '2026-09', 1))).rejects.toThrow(/is paid/);
    expect(await asUser(db, STAFF, () => rows(`select 1 from salary_history`))).toHaveLength(1);
  });

  it('a run with no payslips cannot be approved', async () => {
    await pay(`insert into payroll_runs (pay_period) values ('2026-10')`);
    await expect(pay(`update payroll_runs set status = 'approved' where pay_period = '2026-10'`)).rejects.toThrow(/no payslips to approve/);
  });
});

describe('who can manage runs', () => {
  it('a discarded draft takes its payslips with it', async () => {
    await pay(payslip('E1', '2026-11'));
    await pay(`delete from payroll_runs where pay_period = '2026-11'`);
    expect(await rows(`select 1 from salary_history where pay_period = '2026-11'`)).toHaveLength(0);
  });

  it('HR without the payroll module can see runs but not approve them; staff see none', async () => {
    const seen = await asUser(db, HR, () => rows(`select 1 from payroll_runs`));
    expect(seen.length).toBeGreaterThan(0);
    await asUser(db, HR, () => db.exec(`update payroll_runs set notes = 'x' where pay_period = '2026-10'`));
    expect((await rows<{ notes: string | null }>(`select notes from payroll_runs where tenant_id = '${A}' and pay_period = '2026-10'`))[0].notes).toBeNull();
    expect(await asUser(db, STAFF, () => rows(`select 1 from payroll_runs`))).toHaveLength(0);
  });
});
