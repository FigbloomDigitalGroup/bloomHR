// @vitest-environment node
//
// Employee loans: the company's terms and loan types, staff asking for their own loan within the limits, HR (or admins,
// or payroll users) deciding, the schedule the database builds, and payroll recording repayments when a month is
// approved. Each company sees only its own; staff only their own loans.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000f001';
const PAY = '00000000-0000-0000-0000-00000000f002';
const S1 = '00000000-0000-0000-0000-00000000f003';
const S2 = '00000000-0000-0000-0000-00000000f004';
const MGR = '00000000-0000-0000-0000-00000000f005';
const HRB = '00000000-0000-0000-0000-00000000f006';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const month = (offset: number) => {
  const d = new Date();
  const total = d.getFullYear() * 12 + d.getMonth() + offset;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
};
const loan = async (id: string) =>
  (
    await rows<{
      status: string; annual_rate: string; interest_method: string; monthly_instalment: string; total_interest: string;
      total_repayable: string; start_period: string; decided_by: string | null; product_name: string | null;
    }>(`select * from employee_loans where id = '${id}'`)
  )[0];
const ask = async (user: string, values: string) =>
  (await read<{ id: string }>(user, `insert into employee_loans ${values} returning id`))[0].id;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values
      ('${HR}', 'hr@a.co'), ('${PAY}', 'pay@a.co'), ('${S1}', 's1@a.co'), ('${S2}', 's2@a.co'), ('${MGR}', 'mgr@a.co'), ('${HRB}', 'hr@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${PAY}', 'pay@a.co', 'FINANCE', '${A}'), ('${S1}', 's1@a.co', 'STAFF', '${A}'),
      ('${S2}', 's2@a.co', 'STAFF', '${A}'), ('${MGR}', 'mgr@a.co', 'MANAGER', '${A}'), ('${HRB}', 'hr@b.co', 'HR', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees', 'loans'], '${A}'), ('FINANCE', array['payroll'], '${A}'), ('STAFF', array['dashboard'], '${A}'),
      ('MANAGER', array['salaryadmin', 'employees'], '${A}'), ('HR', array['employees', 'loans'], '${B}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Basic Salary", onboarding_status, tenant_id) values
      ('H1', 'Hana', 'Hr', 'hr@a.co', 100000, 'approved', '${A}'),
      ('E1', 'Esther', 'One', 's1@a.co', 60000, 'approved', '${A}'),
      ('E2', 'Eric', 'Two', 's2@a.co', 50000, 'approved', '${A}'),
      ('X1', 'Xena', 'Other', 'x1@b.co', 40000, 'approved', '${B}');
  `);
}, 120000);

describe('the schedule', () => {
  it('reducing balance: 100,000 at 12% over 12 months is KSh 8,885 a month, the last instalment evening out', async () => {
    const s = await rows<{ instalment_no: number; period: string; payment: string; principal: string; interest: string; balance: string }>(
      `select * from loan_schedule(100000, 12, 'reducing_balance', 12, '2026-11')`
    );
    expect(s).toHaveLength(12);
    expect(s[0]).toMatchObject({ instalment_no: 1, period: '2026-11' });
    expect(Number(s[0].payment)).toBe(8885);
    expect(Number(s[0].interest)).toBe(1000);
    expect(s[11].period).toBe('2027-10');
    expect(Number(s[11].balance)).toBe(0);
    expect(s.reduce((t, r) => t + Number(r.principal), 0)).toBe(100000);
    expect(s.reduce((t, r) => t + Number(r.interest), 0)).toBe(6619);
  });

  it('flat: 100,000 at 12% over 12 months is 12,000 interest, KSh 9,333 a month and 9,337 last', async () => {
    const s = await rows<{ payment: string }>(`select payment from loan_schedule(100000, 12, 'flat', 12, '2026-11') order by instalment_no`);
    expect(s.map((r) => Number(r.payment))).toEqual([...Array(11).fill(9333), 9337]);
  });

  it('0%: the amount in equal parts', async () => {
    const s = await rows<{ payment: string }>(`select payment from loan_schedule(10000, 0, 'reducing_balance', 3, '2026-11') order by instalment_no`);
    expect(s.map((r) => Number(r.payment))).toEqual([3333, 3333, 3334]);
  });
});

describe('settings and loan types', () => {
  it('with no settings, a request is on 12% a year, reducing balance, starting next month', async () => {
    const id = await ask(S1, `(employee_number, principal, months, reason) values ('E1', 100000, 12, 'School fees for my children')`);
    const l = await loan(id);
    expect(l).toMatchObject({ status: 'requested', interest_method: 'reducing_balance', start_period: month(1) });
    expect(Number(l.annual_rate)).toBe(12);
    expect(Number(l.monthly_instalment)).toBe(8885);
    expect(Number(l.total_repayable)).toBe(106619);
    expect(await rows(`select 1 from employee_loan_instalments where loan_id = '${id}'`)).toHaveLength(12);
    await as(S1, `update employee_loans set status = 'cancelled' where id = '${id}'`);
    expect((await loan(id)).status).toBe('cancelled');
  });

  it('HR and payroll users set the terms; staff and other managers only read them; other companies see nothing', async () => {
    await as(HR, `insert into loan_settings (annual_rate, interest_method, min_months, max_months, max_salary_multiple) values (10, 'reducing_balance', 2, 24, 2)`);
    await as(PAY, `update loan_settings set max_months = 18`);
    expect(await read(S1, `select annual_rate::int, max_months from loan_settings`)).toEqual([{ annual_rate: 10, max_months: 18 }]);
    await as(S1, `update loan_settings set annual_rate = 0`);
    await as(MGR, `update loan_settings set annual_rate = 0`);
    expect(Number((await rows<{ annual_rate: string }>(`select annual_rate from loan_settings`))[0].annual_rate)).toBe(10);
    await expect(as(S1, `insert into loan_products (name, annual_rate, max_months) values ('Sneaky', 0, 60)`)).rejects.toThrow(/row-level security/);
    expect(await read(HRB, `select 1 from loan_settings`)).toHaveLength(0);
  });

  it('refuses impossible terms', async () => {
    await expect(as(HR, `update loan_settings set min_months = 30`)).rejects.toThrow(/check/);
    await expect(as(HR, `insert into loan_products (name, annual_rate, max_months) values ('Bad', 150, 6)`)).rejects.toThrow(/check/);
  });

  it('a loan type has its own rate, method and longest term', async () => {
    await as(HR, `insert into loan_products (name, annual_rate, interest_method, max_months) values ('School fees loan', 6, 'flat', 6)`);
    expect(await read(S2, `select name from loan_products`)).toEqual([{ name: 'School fees loan' }]);
    const product = `(select id from loan_products where name = 'School fees loan')`;
    await expect(as(S2, `insert into employee_loans (employee_number, product_id, principal, months) values ('E2', ${product}, 30000, 12)`)).rejects.toThrow(
      /between 2 and 6 months/
    );
    const id = await ask(S2, `(employee_number, product_id, principal, months) select 'E2', id, 30000, 6 from loan_products where name = 'School fees loan'`);
    const l = await loan(id);
    expect(l).toMatchObject({ interest_method: 'flat', product_name: 'School fees loan' });
    expect(Number(l.annual_rate)).toBe(6);
    expect(Number(l.total_interest)).toBe(900);
    await as(S2, `update employee_loans set status = 'cancelled' where id = '${id}'`);
  });
});

describe('asking for a loan (staff)', () => {
  it('only for themselves, on the company terms, within the limits, one request at a time', async () => {
    await expect(as(S1, `insert into employee_loans (employee_number, principal, months) values ('E2', 1000, 3)`)).rejects.toThrow(/for yourself/);
    // twice the basic salary of 60,000
    await expect(as(S1, `insert into employee_loans (employee_number, principal, months) values ('E1', 130000, 6)`)).rejects.toThrow(
      /most you can borrow is KES 120,000.00/
    );
    await expect(as(S1, `insert into employee_loans (employee_number, principal, months) values ('E1', 1000, 1)`)).rejects.toThrow(/between 2 and 18/);
    // a rate of their own is ignored
    const id = await ask(S1, `(employee_number, principal, months, annual_rate, interest_method) values ('E1', 60000, 6, 0, 'flat')`);
    const l = await loan(id);
    expect(Number(l.annual_rate)).toBe(10);
    expect(l.interest_method).toBe('reducing_balance');
    await expect(as(S1, `insert into employee_loans (employee_number, principal, months) values ('E1', 1000, 3)`)).rejects.toThrow(/already have a loan request/);
    await expect(as(S1, `insert into employee_loans (employee_number, principal, months, status) values ('E1', 1000, 3, 'approved')`)).rejects.toThrow(
      /starts as a request/
    );
  });

  it('HR hears of the request', async () => {
    const [n] = await rows<{ title: string; message: string; employee_number: string }>(
      `select title, message, employee_number from hr_notifications where notification_type = 'loan_requested' and message like '%60,000%'`
    );
    expect(n).toMatchObject({ title: 'Loan request to review', employee_number: 'E1' });
    expect(n.message).toBe('Esther One asked for a loan of KES 60,000.00 over 6 months.');
  });

  it('staff see only their own loans and schedules; other companies nothing', async () => {
    expect((await read<{ employee_number: string }>(S1, `select distinct employee_number from employee_loans`)).map((r) => r.employee_number)).toEqual(['E1']);
    expect((await read<{ employee_number: string }>(S2, `select distinct employee_number from employee_loans`)).map((r) => r.employee_number)).toEqual(['E2']);
    const s1Schedules = await read<{ n: number }>(S1, `select count(distinct loan_id)::int n from employee_loan_instalments`);
    expect(s1Schedules[0].n).toBe(2);
    expect(await read(HRB, `select 1 from employee_loans`)).toHaveLength(0);
    expect(await read(HRB, `select 1 from employee_loan_instalments`)).toHaveLength(0);
    // a manager without payroll sees none
    expect(await read(MGR, `select 1 from employee_loans`)).toHaveLength(0);
  });

  it('staff cannot approve, change the amount, or touch the schedule', async () => {
    const id = (await rows<{ id: string }>(`select id from employee_loans where employee_number = 'E1' and status = 'requested'`))[0].id;
    await expect(as(S1, `update employee_loans set status = 'approved' where id = '${id}'`)).rejects.toThrow(/Only HR can change a loan/);
    await expect(as(S1, `update employee_loans set principal = 1 where id = '${id}'`)).rejects.toThrow(/Only HR can change a loan/);
    await as(S1, `delete from employee_loan_instalments where loan_id = '${id}'`);
    expect(await rows(`select 1 from employee_loan_instalments where loan_id = '${id}'`)).toHaveLength(6);
  });

  it('closed applications stop staff, not HR', async () => {
    await as(HR, `update loan_settings set staff_can_apply = false`);
    await expect(as(S2, `insert into employee_loans (employee_number, principal, months) values ('E2', 1000, 3)`)).rejects.toThrow(/applications are closed/);
    await as(HR, `update loan_settings set staff_can_apply = true`);
  });
});

describe('deciding', () => {
  it('approval copies the terms in force then; the employee hears of it', async () => {
    const id = (await rows<{ id: string }>(`select id from employee_loans where employee_number = 'E1' and status = 'requested'`))[0].id;
    await as(HR, `update loan_settings set annual_rate = 14`);
    await as(HR, `update employee_loans set status = 'approved', decision_comment = 'Fine' where id = '${id}'`);
    const l = await loan(id);
    expect(l.status).toBe('approved');
    expect(Number(l.annual_rate)).toBe(14);
    expect(l.decided_by).toBe(HR);
    const [n] = await rows<{ title: string; message: string }>(`select title, message from hr_notifications where notification_type = 'loan_approved' and employee_number = 'E1'`);
    expect(n.title).toBe('Loan approved');
    expect(n.message).toMatch(/^Your loan of KES 60,000.00 was approved: KES [\d,.]+ a month for 6 months from \w+ \d{4} pay\. Notes: Fine\.$/);
    // later setting changes leave it alone
    await as(HR, `update loan_settings set annual_rate = 20`);
    expect(Number((await loan(id)).annual_rate)).toBe(14);
  });

  it('a decline needs a reason; nobody decides on their own loan', async () => {
    const id = await ask(S2, `(employee_number, principal, months) values ('E2', 5000, 3)`);
    await expect(as(HR, `update employee_loans set status = 'rejected' where id = '${id}'`)).rejects.toThrow(/Give a reason/);
    await as(HR, `update employee_loans set status = 'rejected', decision_comment = 'Still on probation' where id = '${id}'`);
    expect((await rows<{ message: string }>(`select message from hr_notifications where notification_type = 'loan_rejected'`))[0].message).toBe(
      'Your loan request of KES 5,000.00 was not approved. Reason: Still on probation.'
    );
    await expect(as(HR, `update employee_loans set status = 'approved' where id = '${id}'`)).rejects.toThrow(/rejected can't become approved/);

    await expect(as(HR, `insert into employee_loans (employee_number, principal, months, status) values ('H1', 5000, 3, 'approved')`)).rejects.toThrow(
      /Someone else must decide on your own loan/
    );
  });

  it('HR can set up an approved loan for an employee, with a rate of their own', async () => {
    const id = await ask(PAY, `(employee_number, principal, months, status, annual_rate, start_period) values ('E2', 12000, 3, 'approved', 0, '${month(0)}')`);
    const l = await loan(id);
    expect(Number(l.annual_rate)).toBe(0);
    expect(Number(l.monthly_instalment)).toBe(4000);
  });
});

describe('paying out and repaying through payroll', () => {
  let paid: string;

  it('disbursing locks the terms and moves a past start to this month', async () => {
    paid = (await rows<{ id: string }>(`select id from employee_loans where employee_number = 'E2' and status = 'approved'`))[0].id;
    await as(HR, `update employee_loans set start_period = '${month(-2)}' where id = '${paid}'`);
    await as(HR, `update employee_loans set status = 'disbursed' where id = '${paid}'`);
    expect((await loan(paid)).start_period).toBe(month(0));
    expect((await rows<{ period: string }>(`select period from employee_loan_instalments where loan_id = '${paid}' order by instalment_no`)).map((r) => r.period)).toEqual([
      month(0), month(1), month(2),
    ]);
    await expect(as(HR, `update employee_loans set principal = 1 where id = '${paid}'`)).rejects.toThrow(/can't change once it is disbursed/);
    await expect(as(HR, `update employee_loans set status = 'cancelled' where id = '${paid}'`)).rejects.toThrow(/disbursed can't become cancelled/);
    await expect(as(HR, `update employee_loans set status = 'completed' where id = '${paid}'`)).rejects.toThrow(/disbursed can't become completed/);
    expect((await rows<{ title: string }>(`select title from hr_notifications where notification_type = 'loan_disbursed'`))[0].title).toBe('Loan paid out');
  });

  const payMonth = async (period: string, amount: number) => {
    await as(PAY, `
      insert into salary_history (employee_id, pay_period, net_pay, deduction_items)
      values ('E2', '${period}', 1000, '[{"name": "Loan repayment: Staff loan", "amount": ${amount}, "loan_id": "${paid}"}]');
      update payroll_runs set status = 'approved' where pay_period = '${period}';
    `);
  };

  it('an approved month records the repayment; reopening it takes it back', async () => {
    await payMonth(month(0), 4000);
    expect((await loan(paid)).status).toBe('repaying');
    expect(await read(S2, `select amount::int from employee_loan_repayments`)).toEqual([{ amount: 4000 }]);
    expect(await read(S1, `select 1 from employee_loan_repayments`)).toHaveLength(0);
    await as(PAY, `update payroll_runs set status = 'draft' where pay_period = '${month(0)}'`);
    expect(await rows(`select 1 from employee_loan_repayments where loan_id = '${paid}'`)).toHaveLength(0);
    expect((await loan(paid)).status).toBe('disbursed');
    await as(PAY, `update payroll_runs set status = 'approved' where pay_period = '${month(0)}'`);
  });

  it('the loan is completed when the repayments reach the total', async () => {
    await payMonth(month(1), 4000);
    await payMonth(month(2), 4000);
    expect((await loan(paid)).status).toBe('completed');
    expect((await rows<{ message: string }>(`select message from hr_notifications where notification_type = 'loan_repaid'`))[0].message).toBe(
      'Your loan of KES 12,000.00 is fully repaid.'
    );
  });
});
