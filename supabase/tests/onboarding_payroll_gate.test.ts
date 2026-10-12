// @vitest-environment node
//
// Onboarding, part 2 (20261012200000): only approved employees go on payroll, the photo on a record is the employee's
// own, and the onboarding screens' "what is missing" queries.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const U = {
  STAFF: '00000000-0000-0000-0000-00000000f101', // E-ME, approved
  NEW: '00000000-0000-0000-0000-00000000f102', // E-NEW, still a draft
  HR: '00000000-0000-0000-0000-00000000f103',
  PAYROLL: '00000000-0000-0000-0000-00000000f104',
};

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const run = async (sql: string) => {
  try {
    await db.query(sql);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const payslip = (employee: string, period = '2026-10') =>
  `insert into salary_history (employee_id, employee_name, pay_period, basic_salary, gross_pay, net_pay) values ('${employee}', 'x', '${period}', 1, 1, 1)`;
const idOf = async (n: string) => (await rows<{ id: string }>(`select id from employees where "Employee Number" = '${n}'`))[0].id;
const photo = async (n: string) => (await rows<{ p: string | null }>(`select "Profile Image" p from employees where "Employee Number" = '${n}'`))[0].p;

beforeAll(async () => {
  db = await bootLiveDb();
  for (const [id, email, role] of [[U.STAFF, 'me@a.co', 'STAFF'], [U.NEW, 'new@a.co', 'STAFF'], [U.HR, 'hr@a.co', 'HR'], [U.PAYROLL, 'pay@a.co', 'PAYROLL']]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${A}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('STAFF', array['dashboard'], '${A}'), ('HR', array['employees'], '${A}'), ('PAYROLL', array['payroll'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Job Title", onboarding_status, tenant_id) values
      ('E-ME', 'Amina', 'Wanjiru', 'me@a.co', 'Accountant', 'approved', '${A}'),
      ('E-NEW', 'Otieno', 'Juma', 'new@a.co', 'Driver', 'draft', '${A}');
  `);
}, 120000);

describe('only approved employees are paid', () => {
  it('payroll can add a payslip for an approved employee', async () => {
    expect(await asUser(db, U.PAYROLL, () => run(payslip('E-ME')))).toBe('');
  });

  it('but not for anyone still being onboarded, and says why', async () => {
    for (const status of ['draft', 'invited', 'submitted', 'changes_requested']) {
      await db.exec(`update employees set onboarding_status = '${status}' where "Employee Number" = 'E-NEW'`);
      expect(await asUser(db, U.PAYROLL, () => run(payslip('E-NEW'))), status)
        .toBe(`Otieno Juma (E-NEW) can't be paid yet: their onboarding is ${status.replace('_', ' ')}, not approved`);
    }
    await db.exec(`update employees set onboarding_status = 'draft' where "Employee Number" = 'E-NEW'`);
  });

  it('nor for an employee number the company does not have', async () => {
    expect(await asUser(db, U.PAYROLL, () => run(payslip('E-GHOST')))).toMatch(/No employee E-GHOST/);
  });

  it('existing payslips follow an employee who is renumbered', async () => {
    expect(await run(`update employees set "Employee Number" = 'E-ME2' where "Employee Number" = 'E-ME'`)).toBe('');
    expect(await rows(`select 1 from salary_history where employee_id = 'E-ME2'`)).toHaveLength(1);
    await db.exec(`update employees set "Employee Number" = 'E-ME' where "Employee Number" = 'E-ME2'`);
  });
});

describe('the photo is the employee’s', () => {
  it('the employee sets and replaces their own photo', async () => {
    expect(await asUser(db, U.STAFF, () => run(`update employees set "Profile Image" = 'https://x/me1.png' where "Employee Number" = 'E-ME'`))).toBe('');
    expect(await asUser(db, U.STAFF, () => run(`update employees set "Profile Image" = 'https://x/me2.png' where "Employee Number" = 'E-ME'`))).toBe('');
    expect(await photo('E-ME')).toBe('https://x/me2.png');
  });

  it('HR cannot set or replace it, on a new record or an existing one', async () => {
    expect(await asUser(db, U.HR, () => run(`update employees set "Profile Image" = 'https://x/hr.png' where "Employee Number" = 'E-ME'`)))
      .toMatch(/Only the employee can upload their own photo/);
    expect(await asUser(db, U.HR, () => run(`insert into employees ("Employee Number", "First Name", "Profile Image") values ('E-X', 'X', 'https://x/x.png')`)))
      .toMatch(/Only the employee can upload their own photo/);
    expect(await photo('E-ME')).toBe('https://x/me2.png');
  });

  it('HR can remove it, and saving the record with the photo unchanged is fine', async () => {
    expect(await asUser(db, U.HR, () => run(`update employees set "Profile Image" = "Profile Image", "Job Title" = 'Senior Accountant' where "Employee Number" = 'E-ME'`))).toBe('');
    expect(await asUser(db, U.HR, () => run(`update employees set "Profile Image" = null where "Employee Number" = 'E-ME'`))).toBe('');
    expect(await photo('E-ME')).toBeNull();
  });
});

describe('what is missing', () => {
  it('an employee asks about their own record', async () => {
    const [r] = await asUser(db, U.NEW, () => rows<{ employee_part: string[]; employer_part: string[] }>(`select * from onboarding_missing_for()`));
    expect(r.employee_part).toContain('KRA PIN');
    expect(r.employer_part).toEqual(['Type of employee', 'Basic salary', 'Payment method']);
  });

  it('HR asks about anyone; an employee cannot ask about a colleague', async () => {
    const id = await idOf('E-NEW');
    expect((await asUser(db, U.HR, () => rows(`select * from onboarding_missing_for('${id}')`)))).toHaveLength(1);
    expect(await asUser(db, U.STAFF, () => run(`select * from onboarding_missing_for('${id}')`))).toMatch(/Only HR/);
  });

  it('HR sees where every employee is and what each still needs', async () => {
    const list = await asUser(db, U.HR, () => rows<{ employee_number: string; status: string; name: string; payroll_number: string; employee_part: string[] }>(
      `select employee_number, status, name, payroll_number, employee_part from onboarding_overview()`));
    expect(list.map((r) => [r.employee_number, r.status, r.name])).toEqual([['E-ME', 'approved', 'Amina Wanjiru'], ['E-NEW', 'draft', 'Otieno Juma']]);
    expect(list[1].payroll_number).toMatch(/^PR-\d{5}$/);
    expect(list[1].employee_part).toContain('NSSF number');
  });

  it('staff and payroll cannot list everyone', async () => {
    expect(await asUser(db, U.STAFF, () => run(`select * from onboarding_overview()`))).toMatch(/Only HR/);
    expect(await asUser(db, U.PAYROLL, () => run(`select * from onboarding_overview()`))).toMatch(/Only HR/);
  });
});
