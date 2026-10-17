// @vitest-environment node
//
// Editing a payslip while its payroll run is a draft (FIG-883): payroll saves a payslip's edits (payslip_overrides)
// with a history row (payslip_edits) only while the run is a draft; the history is only ever added to; each company
// sees only its own.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const PAY = '00000000-0000-0000-0000-00000000e301'; // finance, payroll module
const HR = '00000000-0000-0000-0000-00000000e302'; // HR without payroll
const OTHER = '00000000-0000-0000-0000-00000000e303'; // payroll user of company B

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const tryAs = async (user: string, sql: string) => {
  try {
    await as(user, sql);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const runId = async (period: string, tenant = A) =>
  (await rows<{ id: string }>(`select id from payroll_runs where tenant_id = '${tenant}' and pay_period = '${period}'`))[0].id;
const save = (run: string, emp = 'E1', reason = 'Arrears agreed', overrides = `{"one_off_earnings": [{"label": "Arrears", "amount": 5000, "taxable": true}]}`) =>
  `select save_payslip_edit('${run}', '${emp}', '${overrides}'::jsonb, '[{"field": "Gross pay", "before": 50000, "after": 55000}]'::jsonb, '${reason}')`;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values ('${PAY}', 'pay@a.co'), ('${HR}', 'hr@a.co'), ('${OTHER}', 'pay@b.co');
    insert into user_profiles (user_id, email, full_name, role, tenant_id) values
      ('${PAY}', 'pay@a.co', 'Pat Payroll', 'FINANCE', '${A}'), ('${HR}', 'hr@a.co', null, 'HR', '${A}'),
      ('${OTHER}', 'pay@b.co', null, 'FINANCE', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('FINANCE', array['payroll'], '${A}'), ('HR', array['hr-lifecycle', 'employees'], '${A}'), ('FINANCE', array['payroll'], '${B}');
    insert into employees ("Employee Number", "First Name", "Work Email", onboarding_status, tenant_id) values
      ('E1', 'Ann', 'e1@a.co', 'approved', '${A}'), ('E2', 'Ben', 'e2@a.co', 'approved', '${A}'),
      ('X1', 'Xan', 'x1@b.co', 'approved', '${B}');
  `);
  // a draft run for October, and one for November, with payslips
  await as(PAY, `
    insert into salary_history (employee_id, pay_period, gross_pay, net_pay) values
      ('E1', '2026-10', 50000, 40000), ('E2', '2026-10', 60000, 48000), ('E1', '2026-11', 50000, 40000);
  `);
  await as(OTHER, `insert into salary_history (employee_id, pay_period, net_pay) values ('X1', '2026-10', 1000)`);
}, 120000);

describe('saving edits on a draft run', () => {
  it('payroll saves a payslip’s edits with a history row (who, when, what, why)', async () => {
    const run = await runId('2026-10');
    expect(await tryAs(PAY, save(run))).toBe('');
    const saved = await asUser(db, PAY, () => rows<{ employee_id: string; overrides: { one_off_earnings: unknown[] }; updated_by: string }>(
      `select employee_id, overrides, updated_by from payslip_overrides`));
    expect(saved).toEqual([{ employee_id: 'E1', overrides: { one_off_earnings: [{ label: 'Arrears', amount: 5000, taxable: true }] }, updated_by: PAY }]);
    const history = await asUser(db, PAY, () => rows<Record<string, unknown>>(
      `select run_id, pay_period, employee_id, action, changes, reason, edited_by, edited_by_name, edited_at from payslip_edits`));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      run_id: run, pay_period: '2026-10', employee_id: 'E1', action: 'edited', reason: 'Arrears agreed', edited_by: PAY,
      edited_by_name: 'Pat Payroll', changes: [{ field: 'Gross pay', before: 50000, after: 55000 }],
    });
    expect(history[0].edited_at).not.toBeNull();
  });

  it('saving again updates the same edits and adds another history row', async () => {
    const run = await runId('2026-10');
    expect(await tryAs(PAY, save(run, 'E1', 'Arrears were 6000', `{"one_off_earnings": [{"label": "Arrears", "amount": 6000, "taxable": true}], "note": "Includes arrears"}`))).toBe('');
    const saved = await asUser(db, PAY, () => rows<{ overrides: { note: string } }>(`select overrides from payslip_overrides where employee_id = 'E1'`));
    expect(saved).toHaveLength(1);
    expect(saved[0].overrides.note).toBe('Includes arrears');
    expect(await asUser(db, PAY, () => rows(`select id from payslip_edits where employee_id = 'E1'`))).toHaveLength(2);
  });

  it('a reason is required', async () => {
    const run = await runId('2026-10');
    expect(await tryAs(PAY, save(run, 'E2', '  '))).toMatch(/Say why/);
    expect(await tryAs(PAY, `insert into payslip_edits (run_id, pay_period, employee_id, reason) values ('${run}', '2026-10', 'E2', '')`)).toMatch(/check/);
  });

  it('the payslip itself carries the note staff see', async () => {
    expect(await tryAs(PAY, `update salary_history set payslip_note = 'Includes arrears' where employee_id = 'E1' and pay_period = '2026-10'`)).toBe('');
    expect(await rows(`select payslip_note from salary_history where employee_id = 'E1' and pay_period = '2026-10'`)).toEqual([{ payslip_note: 'Includes arrears' }]);
  });
});

describe('who can edit', () => {
  it('someone without the payroll module can’t save, read or record edits', async () => {
    const run = await runId('2026-10');
    expect(await tryAs(HR, save(run, 'E2'))).toMatch(/row-level security|permission denied/);
    expect(await asUser(db, HR, () => rows(`select * from payslip_overrides`))).toEqual([]);
    expect(await asUser(db, HR, () => rows(`select * from payslip_edits`))).toEqual([]);
    expect(await tryAs(HR, `insert into payslip_edits (run_id, pay_period, employee_id, reason) values ('${run}', '2026-10', 'E2', 'x')`)).toMatch(/row-level security/);
  });

  it('another company sees none of it and can’t edit this company’s payslips', async () => {
    const run = await runId('2026-10');
    expect(await asUser(db, OTHER, () => rows(`select * from payslip_overrides`))).toEqual([]);
    expect(await asUser(db, OTHER, () => rows(`select * from payslip_edits`))).toEqual([]);
    expect(await tryAs(OTHER, save(run, 'E2'))).toMatch(/not found/);
    expect(await tryAs(OTHER, `insert into payslip_overrides (tenant_id, run_id, employee_id) values ('${A}', '${run}', 'E2')`)).toMatch(/row-level security/);
    // its own payslips it can edit
    expect(await tryAs(OTHER, save(await runId('2026-10', B), 'X1'))).toBe('');
    expect(await asUser(db, PAY, () => rows(`select employee_id from payslip_overrides order by employee_id`))).toEqual([{ employee_id: 'E1' }]);
  });
});

describe('the history is only ever added to', () => {
  it('no one can change or delete a history row', async () => {
    expect(await tryAs(PAY, `update payslip_edits set reason = 'changed'`)).toMatch(/permission denied/);
    expect(await tryAs(PAY, `delete from payslip_edits`)).toMatch(/permission denied/);
    expect(await asUser(db, PAY, () => rows(`select reason from payslip_edits order by edited_at`))).toHaveLength(2);
  });
});

describe('only while the run is a draft', () => {
  it('an approved run’s payslips can’t be edited; reopening allows it again', async () => {
    await as(PAY, `update payroll_runs set status = 'approved' where pay_period = '2026-10'`);
    const run = await runId('2026-10');
    expect(await tryAs(PAY, save(run, 'E2'))).toMatch(/is approved, so its payslips can't be edited/);
    expect(await tryAs(PAY, `update payslip_overrides set overrides = '{}' where employee_id = 'E1'`)).toMatch(/is approved/);
    expect(await tryAs(PAY, `delete from payslip_overrides where employee_id = 'E1'`)).toMatch(/is approved/);
    expect(await tryAs(PAY, `insert into payslip_edits (run_id, pay_period, employee_id, reason) values ('${run}', '2026-10', 'E2', 'x')`)).toMatch(/is approved/);
    // the edits stay with the run while it is approved
    expect(await asUser(db, PAY, () => rows(`select employee_id from payslip_overrides`))).toEqual([{ employee_id: 'E1' }]);

    await as(PAY, `update payroll_runs set status = 'draft' where pay_period = '2026-10'`);
    expect(await tryAs(PAY, save(run, 'E2', 'Damaged laptop', `{"one_off_deductions": [{"label": "Damaged equipment", "amount": 2000}]}`))).toBe('');
  });

  it('a paid run’s payslips can’t be edited', async () => {
    await as(PAY, `update payroll_runs set status = 'approved' where pay_period = '2026-11'`);
    await as(PAY, `update payroll_runs set status = 'paid' where pay_period = '2026-11'`);
    expect(await tryAs(PAY, save(await runId('2026-11'), 'E1'))).toMatch(/is paid, so its payslips can't be edited/);
  });
});

describe('removing edits', () => {
  it('removes the payslip’s edits and records why', async () => {
    const run = await runId('2026-10');
    expect(await tryAs(PAY, `select remove_payslip_edits('${run}', 'E2', '[]'::jsonb, '')`)).toMatch(/Say why/);
    expect(await tryAs(PAY, `select remove_payslip_edits('${run}', 'E2', '[{"field": "Net pay", "before": 46000, "after": 48000}]'::jsonb, 'Laptop was insured')`)).toBe('');
    expect(await asUser(db, PAY, () => rows(`select employee_id from payslip_overrides order by employee_id`))).toEqual([{ employee_id: 'E1' }]);
    const last = await asUser(db, PAY, () => rows<{ action: string; reason: string; overrides: unknown }>(
      `select action, reason, overrides from payslip_edits where employee_id = 'E2' order by edited_at desc, action desc limit 1`));
    expect(last).toEqual([{ action: 'removed', reason: 'Laptop was insured', overrides: {} }]);
    expect(await tryAs(PAY, `select remove_payslip_edits('${run}', 'E2', '[]'::jsonb, 'again')`)).toMatch(/no edits to remove/);
  });

  it('discarding a draft run takes its edits with it but keeps the history', async () => {
    const run = await runId('2026-10');
    await as(PAY, `delete from payroll_runs where id = '${run}'`);
    expect(await asUser(db, PAY, () => rows(`select * from payslip_overrides`))).toEqual([]);
    expect((await asUser(db, PAY, () => rows(`select * from payslip_edits where pay_period = '2026-10'`))).length).toBeGreaterThan(0);
  });
});
