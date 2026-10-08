// @vitest-environment node
//
// Voluntary deductions: each company's own deduction types and per-employee amounts, managed by payroll users only.
// The fixed KSh 300 welfare payroll used to take becomes a real Welfare deduction for companies whose payslips had it.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb, migrationFiles } from './db';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const PAY = '00000000-0000-0000-0000-00000000ad01';
const STAFF = '00000000-0000-0000-0000-00000000ad02';
const OTHER = '00000000-0000-0000-0000-00000000ad03';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const pay = <T>(fn: () => Promise<T>) => asUser(db, PAY, fn);

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

describe('deduction types and employee deductions', () => {
  it('a payroll user sets up a type and an employee deduction', async () => {
    await pay(() => db.exec(`
      insert into deduction_types (name) values ('SACCO');
      insert into employee_deductions (employee_number, deduction_type_id, amount, start_period, end_period)
        select 'E1', id, 2000, '2026-10', '2027-03' from deduction_types where name = 'SACCO';
    `));
    const [row] = await pay(() => rows<{ tenant_id: string; amount: string }>(`select tenant_id, amount from employee_deductions`));
    expect(row.tenant_id).toBe(A);
    expect(Number(row.amount)).toBe(2000);
  });

  it('refuses a second type with the same name (ignoring case), zero amounts and months out of order', async () => {
    await expect(pay(() => db.exec(`insert into deduction_types (name) values (' sacco ')`))).rejects.toThrow(/duplicate|unique/i);
    const sacco = `(select id from deduction_types where name = 'SACCO' and tenant_id = '${A}')`;
    await expect(pay(() => db.exec(`insert into employee_deductions (employee_number, deduction_type_id, amount) values ('E2', ${sacco}, 0)`))).rejects.toThrow(/check/i);
    await expect(
      pay(() => db.exec(`insert into employee_deductions (employee_number, deduction_type_id, amount, start_period, end_period) values ('E2', ${sacco}, 5, '2026-12', '2026-10')`))
    ).rejects.toThrow(/check/i);
    await expect(
      pay(() => db.exec(`insert into employee_deductions (employee_number, deduction_type_id, amount, start_period) values ('E2', ${sacco}, 5, 'Oct')`))
    ).rejects.toThrow(/check/i);
  });

  it('staff see and change nothing', async () => {
    expect(await asUser(db, STAFF, () => rows(`select 1 from deduction_types`))).toHaveLength(0);
    expect(await asUser(db, STAFF, () => rows(`select 1 from employee_deductions`))).toHaveLength(0);
    await expect(asUser(db, STAFF, () => db.exec(`insert into deduction_types (name) values ('Sneaky')`))).rejects.toThrow(/row-level security/);
  });

  it("each company sees only its own, and can't use another company's type", async () => {
    expect(await asUser(db, OTHER, () => rows(`select 1 from deduction_types`))).toHaveLength(0);
    const saccoId = (await rows<{ id: string }>(`select id from deduction_types where name = 'SACCO'`))[0].id;
    await expect(
      asUser(db, OTHER, () => db.exec(`insert into employee_deductions (employee_number, deduction_type_id, amount) values ('X1', '${saccoId}', 5)`))
    ).rejects.toThrow(/Unknown deduction type/);
  });

  it('a type in use cannot be deleted (pause it instead)', async () => {
    await expect(pay(() => db.exec(`delete from deduction_types where name = 'SACCO'`))).rejects.toThrow(/foreign key/);
  });

  it('renumbering an employee follows through to their deductions', async () => {
    await db.exec(`update employees set "Employee Number" = 'E1-NEW' where "Employee Number" = 'E1' and tenant_id = '${A}'`);
    expect(await rows(`select 1 from employee_deductions where employee_number = 'E1-NEW'`)).toHaveLength(1);
    await db.exec(`update employees set "Employee Number" = 'E1' where "Employee Number" = 'E1-NEW' and tenant_id = '${A}'`);
  });
});

describe('the old fixed welfare', () => {
  it('becomes a Welfare deduction for every employee of a company whose payslips took it, and for no one else', async () => {
    // replay the migration's welfare step on a company with welfare on its payslips
    await db.exec(`
      delete from employee_deductions; delete from deduction_types;
      insert into salary_history (employee_id, pay_period, welfare_deduction, tenant_id) values ('E1', '2026-09', 300, '${A}');
    `);
    const file = migrationFiles().find((f) => f.endsWith('_voluntary_deductions.sql'))!;
    const sql = readFileSync(join(__dirname, '..', 'migrations', file), 'utf8');
    await db.exec(sql.slice(sql.indexOf('with welfare as')));
    const seeded = await rows<{ tenant_id: string; employee_number: string; amount: string; name: string }>(`
      select d.tenant_id, d.employee_number, d.amount, t.name
      from employee_deductions d join deduction_types t on t.id = d.deduction_type_id order by d.employee_number`);
    expect(seeded.map((r) => [r.tenant_id, r.employee_number, Number(r.amount), r.name])).toEqual([
      [A, 'E1', 300, 'Welfare'],
      [A, 'E2', 300, 'Welfare'],
    ]);
  });
});
