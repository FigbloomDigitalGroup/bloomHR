// @vitest-environment node
//
// Payroll knows when a leaver's final pay was made (20261127300000): final_pay_months() gives, for the signed-in user's
// company, the month each leaver's final dues were included in payroll. Payroll and HR may read it (the month only, not
// the amounts); staff and other companies may not.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000e001';
const PAY = '00000000-0000-0000-0000-00000000e002';
const S1 = '00000000-0000-0000-0000-00000000e004';
const HRB = '00000000-0000-0000-0000-00000000e006';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const months = (user: string) =>
  asUser(db, user, () => rows<{ employee_number: string; payroll_period: string }>(
    `select employee_number, payroll_period from public.final_pay_months() order by employee_number`));

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co'), ('${PAY}', 'pay@a.co'), ('${S1}', 's1@a.co'), ('${HRB}', 'hr@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${PAY}', 'pay@a.co', 'CHECKER', '${A}'), ('${S1}', 's1@a.co', 'STAFF', '${A}'),
      ('${HRB}', 'hr@b.co', 'HR', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees', 'hr-lifecycle'], '${A}'), ('CHECKER', array['payroll'], '${A}'), ('STAFF', array['dashboard'], '${A}'),
      ('HR', array['employees', 'hr-lifecycle'], '${B}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Basic Salary", onboarding_status, tenant_id) values
      ('E1', 'Esther', 'One', 's1@a.co', 60000, 'approved', '${A}'),
      ('E2', 'Eric', 'Two', 'e2@a.co', 50000, 'approved', '${A}'),
      ('E3', 'Eve', 'Three', 'e3@a.co', 40000, 'approved', '${A}'),
      ('X1', 'Xena', 'Other', 'x1@b.co', 40000, 'approved', '${B}');
  `);
  // E1 paid off in October (last day 3 November), E2's final dues not included yet, E3 still employed; X1 in another company
  for (const [tenant, number, status, period] of [
    [A, 'E1', 'included', "'2026-10'"], [A, 'E2', 'reviewed', 'null'], [B, 'X1', 'included', "'2026-09'"],
  ]) {
    const [{ id }] = await rows<{ id: string }>(`insert into employee_exits (tenant_id, employee_number, kind, reason_category, notice_given_on, notice_days, last_working_day, status)
      values ('${tenant}', '${number}', 'termination', 'misconduct', '2026-10-20', 14, '2026-11-03', 'approved') returning id`);
    await db.exec(`insert into employee_exit_final_dues (tenant_id, exit_id, employee_number, status, payroll_period)
      values ('${tenant}', '${id}', '${number}', '${status}', ${period})`);
  }
}, 120000);

describe('final_pay_months', () => {
  it('payroll and HR see the month each leaver was paid off in, for their own company only', async () => {
    expect(await months(PAY)).toEqual([{ employee_number: 'E1', payroll_period: '2026-10' }]);
    expect(await months(HR)).toEqual([{ employee_number: 'E1', payroll_period: '2026-10' }]);
    expect(await months(HRB)).toEqual([{ employee_number: 'X1', payroll_period: '2026-09' }]);
  });

  it('staff see nothing', async () => {
    expect(await months(S1)).toEqual([]);
  });

  it('gives the month only, never the amounts', async () => {
    const cols = await rows<{ name: string }>(
      `select unnest(proargnames) as name from pg_proc where proname = 'final_pay_months' and pronamespace = 'public'::regnamespace`);
    expect(cols.map((c) => c.name).sort()).toEqual(['employee_number', 'payroll_period']);
  });
});
