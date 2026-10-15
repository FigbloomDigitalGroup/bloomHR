// @vitest-environment node
//
// Bonuses and incentives: each company's own earning types (seeded with Bonus, Commission...) and per-employee
// earnings for a month or every month, managed by payroll users only. Staff see theirs on their published payslips.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const PAY = '00000000-0000-0000-0000-00000000ae01';
const STAFF = '00000000-0000-0000-0000-00000000ae02';
const OTHER = '00000000-0000-0000-0000-00000000ae03';

const DEFAULTS = ['Arrears', 'Bonus', 'Commission', 'Gratuity', 'Leave pay', 'Overtime adjustment', 'Performance incentive', 'Sales incentive'];

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const pay = <T>(fn: () => Promise<T>) => asUser(db, PAY, fn);
const bonusOf = (tenant: string) => `(select id from earning_types where name = 'Bonus' and tenant_id = '${tenant}')`;

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

describe('the starting earning types', () => {
  it('every company has them, a company created later too', async () => {
    for (const tenant of [A, B]) {
      const types = await rows<{ name: string }>(`select name from earning_types where tenant_id = '${tenant}' order by name`);
      expect(types.map((t) => t.name)).toEqual(DEFAULTS);
    }
  });

  it('are taxed, and count for NSSF except gratuity', async () => {
    const types = await rows<{ name: string; taxable: boolean; pensionable: boolean; description: string | null }>(
      `select name, taxable, pensionable, description from earning_types where tenant_id = '${A}'`
    );
    expect(types.every((t) => t.taxable)).toBe(true);
    expect(types.filter((t) => !t.pensionable).map((t) => t.name)).toEqual(['Gratuity']);
    expect(types.every((t) => t.description)).toBe(true);
  });

  it('are not added again to a company that already has types', async () => {
    await db.exec(`select public.ensure_earning_types('${A}')`);
    expect(await rows(`select 1 from earning_types where tenant_id = '${A}'`)).toHaveLength(DEFAULTS.length);
  });
});

describe('earning types and employee earnings', () => {
  it('a payroll user adds a one-off and a recurring earning', async () => {
    await pay(() =>
      db.exec(`
        insert into employee_earnings (employee_number, earning_type_id, amount, start_period, end_period, notes)
          values ('E1', ${bonusOf(A)}, 10000, '2026-10', '2026-10', 'Q3 target');
        insert into employee_earnings (employee_number, earning_type_id, amount, start_period)
          select 'E2', id, 2500, '2026-10' from earning_types where name = 'Commission';
      `)
    );
    const saved = await pay(() =>
      rows<{ tenant_id: string; amount: string; created_by: string; end_period: string | null }>(
        `select tenant_id, amount, created_by, end_period from employee_earnings order by amount desc`
      )
    );
    expect(saved.map((r) => [r.tenant_id, Number(r.amount), r.created_by, r.end_period])).toEqual([
      [A, 10000, PAY, '2026-10'],
      [A, 2500, PAY, null],
    ]);
  });

  it('a payroll user adds their own type; the same name twice (ignoring case) is refused', async () => {
    await pay(() => db.exec(`insert into earning_types (name, taxable, pensionable) values ('Meal refund', false, false)`));
    await expect(pay(() => db.exec(`insert into earning_types (name) values (' bonus ')`))).rejects.toThrow(/duplicate|unique/i);
  });

  it('refuses zero amounts, months out of order or not like YYYY-MM, and an earning with no month', async () => {
    const bonus = bonusOf(A);
    const bad = [
      `values ('E2', ${bonus}, 0, '2026-10', '2026-10')`,
      `values ('E2', ${bonus}, 5, '2026-12', '2026-10')`,
      `values ('E2', ${bonus}, 5, 'Oct', null)`,
    ];
    for (const v of bad) {
      await expect(
        pay(() => db.exec(`insert into employee_earnings (employee_number, earning_type_id, amount, start_period, end_period) ${v}`))
      ).rejects.toThrow(/check/i);
    }
    await expect(pay(() => db.exec(`insert into employee_earnings (employee_number, earning_type_id, amount) values ('E2', ${bonus}, 5)`))).rejects.toThrow(
      /null/i
    );
  });

  it('staff see and change nothing', async () => {
    expect(await asUser(db, STAFF, () => rows(`select 1 from earning_types`))).toHaveLength(0);
    expect(await asUser(db, STAFF, () => rows(`select 1 from employee_earnings`))).toHaveLength(0);
    await expect(asUser(db, STAFF, () => db.exec(`insert into earning_types (name) values ('Sneaky')`))).rejects.toThrow(/row-level security/);
    const bonusA = (await rows<{ id: string }>(`select id from earning_types where name = 'Bonus' and tenant_id = '${A}'`))[0].id;
    await expect(
      asUser(db, STAFF, () =>
        db.exec(`insert into employee_earnings (employee_number, earning_type_id, amount, start_period) values ('E1', '${bonusA}', 1000000, '2026-10')`)
      )
    ).rejects.toThrow(/row-level security/);
  });

  it("each company sees only its own, and can't use another company's type", async () => {
    const other = await asUser(db, OTHER, () => rows<{ tenant_id: string }>(`select tenant_id from earning_types`));
    expect(other.length).toBe(DEFAULTS.length);
    expect(other.every((t) => t.tenant_id === B)).toBe(true);
    expect(await asUser(db, OTHER, () => rows(`select 1 from employee_earnings`))).toHaveLength(0);
    const bonusA = (await rows<{ id: string }>(`select id from earning_types where name = 'Bonus' and tenant_id = '${A}'`))[0].id;
    await expect(
      asUser(db, OTHER, () =>
        db.exec(`insert into employee_earnings (employee_number, earning_type_id, amount, start_period) values ('X1', '${bonusA}', 5, '2026-10')`)
      )
    ).rejects.toThrow(/Unknown earning type/);
    // nor change or remove another company's
    await asUser(db, OTHER, () => db.exec(`update employee_earnings set amount = 1; delete from employee_earnings; delete from earning_types where tenant_id = '${A}'`));
    expect(await rows(`select 1 from employee_earnings where tenant_id = '${A}'`)).toHaveLength(2);
  });

  it('a type in use cannot be deleted (pause it instead)', async () => {
    await expect(pay(() => db.exec(`delete from earning_types where name = 'Bonus'`))).rejects.toThrow(/foreign key/);
    await pay(() => db.exec(`update earning_types set active = false where name = 'Bonus'`));
    expect(await rows(`select 1 from earning_types where name = 'Bonus' and tenant_id = '${A}' and not active`)).toHaveLength(1);
  });

  it('renumbering an employee follows through to their earnings', async () => {
    await db.exec(`update employees set "Employee Number" = 'E1-NEW' where "Employee Number" = 'E1' and tenant_id = '${A}'`);
    expect(await rows(`select 1 from employee_earnings where employee_number = 'E1-NEW'`)).toHaveLength(1);
    await db.exec(`update employees set "Employee Number" = 'E1' where "Employee Number" = 'E1-NEW' and tenant_id = '${A}'`);
  });

  it('payslips keep their itemised earnings', async () => {
    await db.exec(`
      insert into salary_history (employee_id, pay_period, bonus, earning_items, tenant_id)
      values ('E1', '2026-10', 10000, '[{"name": "Bonus", "amount": 10000, "taxable": true, "pensionable": true}]', '${A}')`);
    const [row] = await rows<{ earning_items: { name: string }[] }>(`select earning_items from salary_history where employee_id = 'E1'`);
    expect(row.earning_items[0].name).toBe('Bonus');
    const [old] = await rows<{ default: string }>(
      `select column_default as default from information_schema.columns where table_name = 'salary_history' and column_name = 'earning_items'`
    );
    expect(old.default).toMatch(/'\[\]'/);
  });
});
