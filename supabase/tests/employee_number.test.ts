// @vitest-environment node
//
// Employee numbers are unique per company ("EMP-001" can exist in two tenants), editable, and
// every table that points at an employee only ever matches an employee of its own tenant.
// Runs against the real (ziradev) schema snapshot so the foreign keys are the production ones.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into employees ("Employee Number", "First Name", "Work Email", tenant_id) values
      ('EMP-001', 'Alice (A)', 'alice@a.co', '${A}'),
      ('EMP-001', 'Bob (B)',   'bob@b.co',   '${B}');
  `);
}, 120000);

describe('employee number is unique per tenant', () => {
  it('two companies can both have EMP-001', async () => {
    const r = await rows<{ tenant_id: string; n: string }>(
      `select tenant_id, "First Name" n from employees where "Employee Number" = 'EMP-001' order by tenant_id`
    );
    expect(r.map((x) => x.n)).toEqual(['Alice (A)', 'Bob (B)']);
  });

  it('but one company cannot use it twice', async () => {
    await expect(
      db.query(`insert into employees ("Employee Number", "First Name", "Work Email", tenant_id) values ('EMP-001', 'Dup', 'dup@a.co', '${A}')`)
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('employees get a stable internal uuid', async () => {
    const r = await rows<{ id: string }>(`select id from employees`);
    expect(r.length).toBe(2);
    expect(new Set(r.map((x) => x.id)).size).toBe(2);
    for (const x of r) expect(x.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('child rows only match an employee of their own tenant', () => {
  it('rejects a row in tenant B pointing at an employee number that exists only in tenant A', async () => {
    await db.exec(`insert into employees ("Employee Number", "First Name", tenant_id) values ('EMP-ONLY-A', 'Only A', '${A}')`);
    await expect(
      db.query(`insert into dependents ("Employee Number", tenant_id) values ('EMP-ONLY-A', '${B}')`)
    ).rejects.toThrow(/foreign key/i);
    // the same number in its own tenant is fine
    await db.exec(`insert into dependents ("Employee Number", tenant_id) values ('EMP-ONLY-A', '${A}')`);
  });

  it('resolves EMP-001 to the right tenant when both tenants have child rows', async () => {
    await db.exec(`
      insert into dependents ("Employee Number", tenant_id) values ('EMP-001', '${A}'), ('EMP-001', '${B}');
    `);
    const r = await rows<{ n: number }>(`select count(*)::int n from dependents where "Employee Number" = 'EMP-001'`);
    expect(r[0].n).toBe(2);
  });
});

describe('renumbering an employee', () => {
  it('follows through foreign-key tables and plain-text tables, in that tenant only', async () => {
    await db.exec(`
      insert into attendance_logs (employee_number, tenant_id) values ('EMP-001', '${A}'), ('EMP-001', '${B}');
      insert into notifications (employee_number, tenant_id)   values ('EMP-001', '${A}'), ('EMP-001', '${B}');
      insert into salary_history (employee_id, pay_period, tenant_id) values ('EMP-001', '2026-09', '${A}'), ('EMP-001', '2026-09', '${B}');
    `);

    await db.exec(`update employees set "Employee Number" = 'ACME-100' where "Employee Number" = 'EMP-001' and tenant_id = '${A}'`);

    const fk = await rows<{ tenant_id: string; n: string }>(`select tenant_id, "Employee Number" n from dependents where "Employee Number" in ('EMP-001','ACME-100') order by tenant_id`);
    expect(fk.map((x) => [x.tenant_id, x.n])).toEqual([[A, 'ACME-100'], [B, 'EMP-001']]);

    for (const [table, col] of [['attendance_logs', 'employee_number'], ['notifications', 'employee_number'], ['salary_history', 'employee_id']]) {
      const r = await rows<{ tenant_id: string; v: string }>(`select tenant_id, ${col} v from ${table} where ${col} in ('EMP-001','ACME-100') order by tenant_id`);
      expect(r.map((x) => [x.tenant_id, x.v]), table).toEqual([[A, 'ACME-100'], [B, 'EMP-001']]);
    }
  });

  it('cannot take a number that is already used in the same tenant', async () => {
    await expect(
      db.query(`update employees set "Employee Number" = 'EMP-ONLY-A' where "Employee Number" = 'ACME-100' and tenant_id = '${A}'`)
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe('deleting an employee keeps each foreign key’s original behaviour', () => {
  it('ON DELETE SET NULL clears only the employee reference and keeps the row in its tenant', async () => {
    await db.exec(`
      insert into employees ("Employee Number", "First Name", tenant_id) values ('LO-1', 'Loan Officer', '${A}');
      insert into clients (client_id, loan_officer, tenant_id) values ('C-1', 'LO-1', '${A}');
    `);
    await db.exec(`delete from employees where "Employee Number" = 'LO-1' and tenant_id = '${A}'`);
    const [c] = await rows<{ loan_officer: string | null; tenant_id: string }>(`select loan_officer, tenant_id from clients where client_id = 'C-1'`);
    expect(c).toEqual({ loan_officer: null, tenant_id: A });
  });

  it('ON DELETE CASCADE removes the child rows of that tenant’s employee only', async () => {
    await db.exec(`delete from employees where "Employee Number" = 'EMP-001' and tenant_id = '${B}'`);
    const r = await rows<{ tenant_id: string }>(`select tenant_id from dependents where "Employee Number" in ('EMP-001','ACME-100')`);
    expect(r.map((x) => x.tenant_id)).toEqual([A]);
  });
});
