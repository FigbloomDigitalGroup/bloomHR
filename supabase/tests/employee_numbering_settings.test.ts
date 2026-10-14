// @vitest-environment node
//
// Each company chooses how employee numbers are given (20261014700000): the system's numbers in the company's format
// (prefix, digits, next number), or the company's own numbers, which the bulk upload then requires.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootDb, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const ADMIN = '00000000-0000-0000-0000-00000000f901';
const HR = '00000000-0000-0000-0000-00000000f902';
const PAY = '00000000-0000-0000-0000-00000000f903';
const STAFF = '00000000-0000-0000-0000-00000000f904';
const ADMIN_B = '00000000-0000-0000-0000-00000000f905';

type Numbering = { mode: string; prefix: string; digits: number; next_number: number; preview: string };
type Saved = { row_no: number; employee_number: string | null; outcome: string; error_message: string | null };

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const settings = (user: string) => asUser(db, user, () => rows<Numbering>(`select * from employee_numbering()`)).then((r) => r[0]);
const set = (user: string, mode: string, prefix: string | null, digits: number, next: number | null = null) =>
  asUser(db, user, () => rows<Numbering>(`select * from set_employee_numbering($1, $2, $3, $4)`, [mode, prefix, digits, next])).then((r) => r[0]);
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const add = (user: string, email: string, number?: string) =>
  asUser(db, user, () =>
    number === undefined
      ? db.query(`insert into employees ("First Name", "Work Email") values ('X', $1)`, [email])
      : db.query(`insert into employees ("Employee Number", "First Name", "Work Email") values ($1, 'X', $2)`, [number, email]));
const numberOf = async (email: string) => (await rows<{ n: string }>(`select "Employee Number" n from employees where "Work Email" = $1`, [email]))[0]?.n;
const save = (batch: unknown[]) => asUser(db, HR, () => rows<Saved>(`select * from save_employees_batch($1::jsonb)`, [JSON.stringify(batch)]));

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
  for (const [id, email, role, tenant] of [
    [ADMIN, 'admin@a.co', 'ADMIN', A], [HR, 'hr@a.co', 'HR', A], [PAY, 'pay@a.co', 'FINANCE', A],
    [STAFF, 'staff@a.co', 'STAFF', A], [ADMIN_B, 'admin@b.co', 'ADMIN', B],
  ]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${tenant}');
    `);
  }
  await db.exec(`insert into role_permissions (role_name, permissions, tenant_id) values
    ('HR', array['employees'], '${A}'), ('FINANCE', array['payroll'], '${A}'), ('STAFF', array['dashboard'], '${A}')`);
}, 120000);

describe('the system gives the numbers', () => {
  it('by default: MCL-000001, as before, and looking does not use a number up', async () => {
    expect(await settings(HR)).toEqual({ mode: 'system', prefix: 'MCL-', digits: 6, next_number: 1, preview: 'MCL-000001' });
    expect((await settings(HR)).preview).toBe('MCL-000001');
    await add(HR, 'a1@a.co');
    expect(await numberOf('a1@a.co')).toBe('MCL-000001');
    expect(await settings(PAY)).toMatchObject({ next_number: 2, preview: 'MCL-000002' });
  });

  it('the preview skips a number someone already has, like the next number given', async () => {
    await add(HR, 'typed@a.co', 'MCL-000002');
    expect((await settings(HR)).preview).toBe('MCL-000003');
    await add(HR, 'a3@a.co');
    expect(await numberOf('a3@a.co')).toBe('MCL-000003');
  });

  it('in the company’s own format: prefix with its separator, digits and next number', async () => {
    expect(await set(HR, 'system', 'EMP/', 4, 1501)).toEqual({ mode: 'system', prefix: 'EMP/', digits: 4, next_number: 1501, preview: 'EMP/1501' });
    await add(HR, 'e1@a.co');
    expect(await numberOf('e1@a.co')).toBe('EMP/1501');
    await set(HR, 'system', 'FIG', 3, 7);
    await add(HR, 'f1@a.co');
    expect(await numberOf('f1@a.co')).toBe('FIG007');
  });

  it('with no prefix, and a count longer than the digits is not cut', async () => {
    await set(HR, 'system', '', 2, 123);
    await add(HR, 'n1@a.co');
    expect(await numberOf('n1@a.co')).toBe('123');
    await set(HR, 'system', null, 3, 5);
    expect((await settings(HR)).preview).toBe('005');
  });

  it('leaving the next number out keeps the count', async () => {
    const before = await settings(HR);
    expect(await set(HR, 'system', 'MCL-', 6)).toMatchObject({ next_number: before.next_number });
  });

  it('refuses a bad prefix, digits or next number', async () => {
    expect(await fails(set(HR, 'system', 'has space', 6))).toMatch(/prefix/);
    expect(await fails(set(HR, 'system', 'ABCDEFGHIJKLM', 6))).toMatch(/prefix/);
    expect(await fails(set(HR, 'system', 'MCL-', 0))).toMatch(/digits/);
    expect(await fails(set(HR, 'system', 'MCL-', 11))).toMatch(/digits/);
    expect(await fails(set(HR, 'system', 'MCL-', 6, 0))).toMatch(/next number/);
    expect(await fails(set(HR, 'mine', 'MCL-', 6))).toMatch(/system or own/);
  });
});

describe('the company’s own numbers', () => {
  it('the bulk upload keeps a new person’s number from the sheet and requires one', async () => {
    await set(ADMIN, 'own', 'MCL-', 6);
    const result = await save([
      { row: 2, data: { 'Employee Number': 'K-77', 'First Name': 'Kay', 'Work Email': 'kay@a.co' } },
      { row: 3, data: { 'First Name': 'Nobody', 'Work Email': 'nobody@a.co' } },
    ]);
    expect(result.map((r) => [r.outcome, r.employee_number])).toEqual([['created', 'K-77'], ['error', null]]);
    expect(result[1].error_message).toMatch(/missing Employee Number/);
    expect(await numberOf('nobody@a.co')).toBeUndefined();
  });

  it('existing employees are still found by number or work email, and keep their number', async () => {
    const result = await save([
      { row: 2, data: { 'Employee Number': 'K-77', 'Job Title': 'Driver' } },
      { row: 3, data: { 'Employee Number': 'NEW-1', 'Work Email': 'KAY@a.co', 'Job Title': 'Clerk' } },
    ]);
    expect(result.map((r) => [r.outcome, r.employee_number])).toEqual([['updated', 'K-77'], ['updated', 'K-77']]);
    expect(await rows(`select 1 from employees where "Employee Number" = 'NEW-1'`)).toHaveLength(0);
  });

  it('one added at a time keeps a typed number; a blank one still gets a system number', async () => {
    await add(HR, 'own1@a.co', 'OWN-1');
    expect(await numberOf('own1@a.co')).toBe('OWN-1');
    await add(HR, 'own2@a.co');
    expect(await numberOf('own2@a.co')).toMatch(/^MCL-\d{6}$/);
    await set(ADMIN, 'system', 'MCL-', 6);
  });
});

describe('who may see and change it', () => {
  it('Employees and Payroll users see it; staff do not', async () => {
    expect((await settings(PAY)).mode).toBe('system');
    expect(await fails(settings(STAFF))).toMatch(/may not/);
  });

  it('ADMIN and Employees users change it; Payroll and staff do not', async () => {
    expect(await fails(set(PAY, 'own', 'MCL-', 6))).toMatch(/may not change/);
    expect(await fails(set(STAFF, 'own', 'MCL-', 6))).toMatch(/may not change/);
    expect(await fails(asUser(db, STAFF, () => rows(`select next_employee_number('${A}')`)))).toMatch(/permission denied/);
  });

  it('each company has its own settings and count', async () => {
    await set(ADMIN, 'system', 'AAA-', 6, 900);
    expect(await settings(ADMIN_B)).toEqual({ mode: 'system', prefix: 'MCL-', digits: 6, next_number: 1, preview: 'MCL-000001' });
    await set(ADMIN_B, 'own', 'B/', 3, 5);
    expect(await settings(ADMIN)).toMatchObject({ mode: 'system', prefix: 'AAA-', next_number: 900 });
  });

  it('changes are in the audit log, with who made them', async () => {
    await set(HR, 'system', 'AUD-', 6);
    const [log] = await rows<{ new_data: Record<string, unknown>; performed_by: string }>(
      `select new_data, performed_by from audit_log where table_name = 'company_payroll_settings' and tenant_id = '${A}'
       and new_data->>'employee_number_prefix' = 'AUD-'`);
    expect(log).toMatchObject({ new_data: { employee_number_prefix: 'AUD-' }, performed_by: HR });
  });
});

describe('migrating a company that already set a prefix', () => {
  it('its MCL becomes MCL- so its numbers look the same', async () => {
    const old = await bootDb({
      file: '20261014700000_employee_numbering_settings.sql',
      seed: async (d) => {
        await d.exec(`insert into company_payroll_settings (tenant_id, employee_number_prefix) values ('${A}', 'MCL')`);
      },
    });
    expect((await old.query(`select employee_number_prefix p from company_payroll_settings where tenant_id = '${A}'`)).rows).toEqual([{ p: 'MCL-' }]);
    expect((await old.query(`select next_employee_number('${A}') n`)).rows).toEqual([{ n: 'MCL-000001' }]);
  }, 120000);
});
