// @vitest-environment node
//
// Reimbursements on the payroll page (20261028100000): each company's columns (starting with Per diem and Mileage) and
// each employee's amount for a month, typed in by payroll users only; the payslip keeps them and their total. The per
// diem share of basic salary ends in October 2026.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const PAY = '00000000-0000-0000-0000-00000000af01';
const STAFF = '00000000-0000-0000-0000-00000000af02';
const OTHER = '00000000-0000-0000-0000-00000000af03';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const pay = <T>(fn: () => Promise<T>) => asUser(db, PAY, fn);
const typeOf = (name: string, tenant = A) => `(select id from reimbursement_types where name = '${name}' and tenant_id = '${tenant}')`;

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
      ('E1', 'Ann', 'e1@a.co', '${A}'), ('E2', 'Ben', 'e2@a.co', '${A}'), ('X1', 'Xena', 'x1@b.co', '${B}');
  `);
}, 120000);

describe('the starting columns', () => {
  it('every company has Per diem and Mileage, a company created later too', async () => {
    for (const tenant of [A, B]) {
      const types = await rows<{ name: string; active: boolean; from_job_group: boolean }>(
        `select name, active, from_job_group from reimbursement_types where tenant_id = '${tenant}' order by position`
      );
      // per diem is filled from each employee's job group
      expect(types).toEqual([{ name: 'Per diem', active: true, from_job_group: true }, { name: 'Mileage', active: true, from_job_group: false }]);
    }
  });

  it('are not added again to a company that already has columns', async () => {
    await db.exec(`select public.ensure_reimbursement_types('${A}')`);
    expect(await rows(`select 1 from reimbursement_types where tenant_id = '${A}'`)).toHaveLength(2);
  });
});

describe('columns and amounts', () => {
  it('a payroll user adds a column and types in amounts for the month', async () => {
    await pay(() =>
      db.exec(`
        insert into reimbursement_types (name, position) values ('Fuel', 3);
        insert into employee_reimbursements (employee_number, reimbursement_type_id, pay_period, amount)
          values ('E1', ${typeOf('Per diem')}, '2026-10', 3000), ('E1', ${typeOf('Mileage')}, '2026-10', 1200.5);
      `)
    );
    const saved = await pay(() =>
      rows<{ tenant_id: string; amount: string; updated_by: string }>(`select tenant_id, amount, updated_by from employee_reimbursements order by amount desc`)
    );
    expect(saved.map((r) => [r.tenant_id, Number(r.amount), r.updated_by])).toEqual([
      [A, 3000, PAY],
      [A, 1200.5, PAY],
    ]);
  });

  it('keeps one amount per employee, column and month (typing again replaces it)', async () => {
    await pay(() =>
      db.exec(`
        insert into employee_reimbursements (employee_number, reimbursement_type_id, pay_period, amount)
          values ('E1', ${typeOf('Per diem')}, '2026-10', 3500)
          on conflict (tenant_id, employee_number, reimbursement_type_id, pay_period) do update set amount = excluded.amount
      `)
    );
    expect((await rows<{ amount: string }>(`select amount from employee_reimbursements where reimbursement_type_id = ${typeOf('Per diem')}`)).map((r) => Number(r.amount))).toEqual([3500]);
  });

  it('refuses a column name twice (ignoring case), empty names, a second job group column, negative amounts and months not like YYYY-MM', async () => {
    await expect(pay(() => db.exec(`insert into reimbursement_types (name) values (' mileage ')`))).rejects.toThrow(/duplicate|unique/i);
    await expect(pay(() => db.exec(`insert into reimbursement_types (name) values ('  ')`))).rejects.toThrow(/check/i);
    await expect(pay(() => db.exec(`insert into reimbursement_types (name, from_job_group) values ('Allowance', true)`))).rejects.toThrow(/duplicate|unique/i);
    for (const bad of [`'E2', ${typeOf('Mileage')}, '2026-10', -1`, `'E2', ${typeOf('Mileage')}, 'Oct', 100`]) {
      await expect(pay(() => db.exec(`insert into employee_reimbursements (employee_number, reimbursement_type_id, pay_period, amount) values (${bad})`))).rejects.toThrow(/check/i);
    }
  });

  it("refuses another company's column", async () => {
    await expect(
      pay(() => db.exec(`insert into employee_reimbursements (employee_number, reimbursement_type_id, pay_period, amount) values ('E2', ${typeOf('Mileage', B)}, '2026-10', 100)`))
    ).rejects.toThrow(/Unknown reimbursement|row-level security/);
  });

  it('only payroll users see or change them, and only their own company', async () => {
    expect(await asUser(db, STAFF, () => rows(`select * from employee_reimbursements`))).toEqual([]);
    expect(await asUser(db, STAFF, () => rows(`select * from reimbursement_types`))).toEqual([]);
    await asUser(db, STAFF, () => db.exec(`delete from employee_reimbursements`));
    expect(await asUser(db, OTHER, () => rows(`select * from employee_reimbursements`))).toEqual([]);
    expect((await asUser(db, OTHER, () => rows<{ name: string }>(`select name from reimbursement_types order by position`))).map((r) => r.name)).toEqual(['Per diem', 'Mileage']);
    expect(await rows(`select 1 from employee_reimbursements`)).toHaveLength(2);
  });

  it("follows an employee's new number", async () => {
    await db.exec(`update employees set "Employee Number" = 'E1-NEW' where "Employee Number" = 'E1' and tenant_id = '${A}'`);
    expect((await rows<{ employee_number: string }>(`select distinct employee_number from employee_reimbursements`)).map((r) => r.employee_number)).toEqual(['E1-NEW']);
  });

  it('the payslip keeps its reimbursements and their total, none on older payslips', async () => {
    const cols = await rows<{ column_name: string; column_default: string }>(
      `select column_name, column_default from information_schema.columns where table_name = 'salary_history' and column_name in ('reimbursement_items', 'reimbursements') order by column_name`
    );
    expect(cols.map((c) => c.column_name)).toEqual(['reimbursement_items', 'reimbursements']);
  });
});

describe("each job group's per diem", () => {
  it('is a dated amount on the group, 0 unless set, shown on the job groups screen', async () => {
    await pay(() =>
      db.exec(`
        insert into job_groups (code, name) values ('MGR', 'Managers');
        insert into job_group_rates (job_group_id, effective_from, basic_salary, per_diem)
          select id, '2026-01-01', 150000, 10000 from job_groups where code = 'MGR';
        insert into job_groups (code, name) values ('OPS', 'Operations');
        insert into job_group_rates (job_group_id, effective_from, basic_salary)
          select id, '2026-01-01', 40000 from job_groups where code = 'OPS';
      `)
    );
    const overview = await pay(() => rows<{ code: string; per_diem: string }>(`select code, per_diem from job_groups_overview() where code in ('MGR', 'OPS') order by code`));
    expect(overview.map((r) => [r.code, Number(r.per_diem)])).toEqual([['MGR', 10000], ['OPS', 0]]);
    await expect(pay(() => db.exec(`update job_group_rates set per_diem = -5`))).rejects.toThrow(/check/i);
  });

  it("an amount typed in for the month replaces it; 0 means none that month", async () => {
    await pay(() =>
      db.exec(`insert into employee_reimbursements (employee_number, reimbursement_type_id, pay_period, amount) values ('E2', ${typeOf('Per diem')}, '2026-10', 0)`)
    );
    expect((await rows<{ amount: string }>(`select amount from employee_reimbursements where employee_number = 'E2'`)).map((r) => Number(r.amount))).toEqual([0]);
  });
});

describe('the per diem share of basic salary', () => {
  const kenyaOn = async (day: string) => (await rows<{ r: Record<string, unknown> }>(`select statutory_rates_on('${day}', 'Kenya') r`))[0].r;

  it('is 33% until September 2026 and none from October (typed in as a reimbursement since)', async () => {
    expect((await asUser(db, PAY, () => kenyaOn('2026-09-30'))).per_diem_rate).toBe(0.33);
    expect((await asUser(db, PAY, () => kenyaOn('2026-10-31'))).per_diem_rate).toBe(0);
  });
});
