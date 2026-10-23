// @vitest-environment node
//
// Payments to make (FIG-1209): approved salary advances, loans, expenses and requisitions wait in one list for finance,
// finance is told, and records how each was paid (outside the app), which marks the item paid. Rejecting or cancelling
// an item takes it off the list; one marked paid on its own screen closes its row. Each company sees only its own;
// employees only what is paid to them.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootDb, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000e001';
const FIN = '00000000-0000-0000-0000-00000000e002';
const ADMIN = '00000000-0000-0000-0000-00000000e003';
const S1 = '00000000-0000-0000-0000-00000000e004';
const S2 = '00000000-0000-0000-0000-00000000e005';
const HRB = '00000000-0000-0000-0000-00000000e006';
const today = new Date().toISOString().slice(0, 10);

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const fails = async (user: string, sql: string) => {
  try {
    await as(user, sql);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error(`expected to fail: ${sql}`);
};
type Payment = { id: string; status: string; amount: string; payee_name: string; employee_number: string | null; paid_via: string | null;
  payment_reference: string | null; paid_by: string | null; purpose: string };
const payment = async (source: string, id: string) =>
  (await rows<Payment>(`select * from payment_requests where source = $1 and source_id = $2`, [source, id]))[0];
const notes = (type: string) => rows<{ employee_number: string; message: string }>(
  `select employee_number, message from hr_notifications where notification_type = $1 order by id`, [type]);
// a decision goes through the item's approval chain (20261025600000); the default is one step, anyone with the module
const decide = (user: string, kind: string, id: string, decision: 'approved' | 'rejected', comment: string | null = null) =>
  as(user, `select decide_approval(r.id, '${decision}', ${comment === null ? 'null' : `'${comment}'`})
            from approval_requests r where r.kind = '${kind}' and r.record_id = '${id}'`);
const record = (user: string, id: string, via: string, ref: string | null, on = today) =>
  as(user, `select status from record_payment('${id}', '${via}', ${ref === null ? 'null' : `'${ref}'`}, '${on}')`);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values
      ('${HR}', 'hr@a.co'), ('${FIN}', 'fin@a.co'), ('${ADMIN}', 'admin@a.co'), ('${S1}', 's1@a.co'), ('${S2}', 's2@a.co'),
      ('${HRB}', 'hr@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${FIN}', 'fin@a.co', 'CHECKER', '${A}'), ('${ADMIN}', 'admin@a.co', 'ADMIN', '${A}'),
      ('${S1}', 's1@a.co', 'STAFF', '${A}'), ('${S2}', 's2@a.co', 'STAFF', '${A}'), ('${HRB}', 'hr@b.co', 'HR', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees', 'salaryadmin', 'loans', 'expenses', 'requisitions'], '${A}'),
      ('CHECKER', array['payments'], '${A}'), ('STAFF', array['dashboard'], '${A}'),
      ('HR', array['employees', 'salaryadmin', 'loans', 'requisitions', 'payments'], '${B}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Basic Salary", onboarding_status, tenant_id) values
      ('H1', 'Hana', 'Hr', 'hr@a.co', 100000, 'approved', '${A}'),
      ('F1', 'Faith', 'Finance', 'fin@a.co', 90000, 'approved', '${A}'),
      ('E1', 'Esther', 'One', 's1@a.co', 60000, 'approved', '${A}'),
      ('E2', 'Eric', 'Two', 's2@a.co', 50000, 'approved', '${A}'),
      ('X1', 'Xena', 'Other', 'hr@b.co', 40000, 'approved', '${B}');
  `);
}, 120000);

describe('the modules', () => {
  it('adds "Payments to make" and "Approve requisitions", which STAFF-based roles may not hold', async () => {
    expect((await rows<{ module_id: string }>(`select module_id from permissions where module_id in ('payments', 'requisitions') order by 1`))
      .map((r) => r.module_id)).toEqual(['payments', 'requisitions']);
    const restricted = (await rows<{ m: string[] }>(`select public.staff_restricted_modules() as m`))[0].m;
    expect(restricted).toEqual(expect.arrayContaining(['payments', 'requisitions']));
  });
});

describe('salary advances', () => {
  let adv: string;
  beforeAll(async () => {
    adv = (await rows<{ id: string }>(`insert into salary_advance ("Employee Number", "Full Name", "Amount Requested", "Reason for Advance", tenant_id)
      values ('E1', 'Esther One', 10000, 'School fees', '${A}') returning id`))[0].id;
  });

  it('a waiting advance is not on the list', async () => {
    expect(await payment('salary_advance', adv)).toBeUndefined();
  });

  it('approved (for an adjusted amount): it joins the list and finance is told', async () => {
    await as(HR, `update salary_advance set admin_adjusted_amount = 8000 where id = '${adv}'`);
    await decide(HR, 'salary_advance', adv, 'approved');
    expect(await payment('salary_advance', adv)).toMatchObject({
      status: 'to_pay', employee_number: 'E1', payee_name: 'Esther One', purpose: 'Salary advance: School fees' });
    expect(Number((await payment('salary_advance', adv)).amount)).toBe(8000);
    const due = await notes('payment_due');
    expect(due).toHaveLength(1);
    expect(due[0].message).toBe('KES 8,000.00 to Esther One (Salary advance: School fees) was approved by Hana Hr. Pay it and record it in Payments to make.');
  });

  it('the alert goes to finance and admins by email, and is never shown to the employee paid', async () => {
    expect((await rows<{ b: boolean }>(`select public.hr_only_notification('payment_due') as b`))[0].b).toBe(true);
    const to = (await rows<{ user_id: string }>(`select user_id from public.hr_alert_recipients($1, 'payment_due')`, [A]))
      .map((r) => r.user_id).sort();
    expect(to).toEqual([FIN, ADMIN].sort());
  });

  it('only finance records a payment, never one to themselves, with a reference and a date that has come', async () => {
    const id = (await payment('salary_advance', adv)).id;
    expect(await fails(S1, `select record_payment('${id}', 'mpesa', 'QX1', '${today}')`)).toMatch(/Only finance/);
    expect(await fails(HR, `select record_payment('${id}', 'mpesa', 'QX1', '${today}')`)).toMatch(/Only finance/);
    expect(await fails(FIN, `select record_payment('${id}', 'mpesa', '  ', '${today}')`)).toMatch(/reference/);
    expect(await fails(FIN, `select record_payment('${id}', 'paypal', 'QX1', '${today}')`)).toMatch(/how it was paid/);
    expect(await fails(FIN, `select record_payment('${id}', 'in_app', 'QX1', '${today}')`)).toMatch(/how it was paid/);
    expect(await fails(FIN, `select record_payment('${id}', 'mpesa', 'QX1', '2999-01-01')`)).toMatch(/future/);
  });

  it('recorded: the row is paid and the advance with it, and the employee is told', async () => {
    const id = (await payment('salary_advance', adv)).id;
    await record(FIN, id, 'mpesa', 'QX12AB');
    expect(await payment('salary_advance', adv)).toMatchObject({ status: 'paid', paid_via: 'mpesa', payment_reference: 'QX12AB', paid_by: FIN });
    const a = (await rows<{ status: string; payment_processed: string; paid_by_email: string }>(
      `select status, payment_processed, paid_by_email from salary_advance where id = '${adv}'`))[0];
    expect(a).toEqual({ status: 'paid', payment_processed: 'true', paid_by_email: 'fin@a.co' });
    expect((await notes('salary_advance_paid')).map((n) => n.employee_number)).toEqual(['E1']);
    expect(await fails(FIN, `select record_payment('${id}', 'mpesa', 'QX12AB', '${today}')`)).toMatch(/already recorded/);
  });

  it('cancelled after approval: off the list; its chain decided it, so it is not approved again by hand', async () => {
    const other = (await rows<{ id: string }>(`insert into salary_advance ("Employee Number", "Amount Requested", tenant_id)
      values ('E2', 5000, '${A}') returning id`))[0].id;
    await decide(HR, 'salary_advance', other, 'approved');
    await as(HR, `update salary_advance set status = 'cancelled' where id = '${other}'`);
    const row = await payment('salary_advance', other);
    expect(row.status).toBe('cancelled');
    expect(await fails(FIN, `select record_payment('${row.id}', 'bank', 'B1', '${today}')`)).toMatch(/cancelled/);
    expect(await fails(HR, `update salary_advance set status = 'approved' where id = '${other}'`)).toMatch(/through its approval chain/);
    expect((await payment('salary_advance', other)).status).toBe('cancelled');
  });

  it('marked paid on the Salary Advance screen: its row closes, with no method', async () => {
    const other = (await rows<{ id: string }>(`insert into salary_advance ("Employee Number", "Amount Requested", status, tenant_id)
      values ('E2', 3000, 'approved', '${A}') returning id`))[0].id;
    expect((await payment('salary_advance', other)).status).toBe('to_pay');
    await as(HR, `update salary_advance set status = 'paid', payment_processed = 'true' where id = '${other}'`);
    expect(await payment('salary_advance', other)).toMatchObject({ status: 'paid', paid_via: null, paid_by: HR });
  });
});

describe('loans', () => {
  it('approved: on the list; finance (without the loans module) records it and the loan is paid out', async () => {
    const loan = (await as<{ id: string }>(S1, `insert into employee_loans (employee_number, principal, months, start_period, reason)
      values ('E1', 30000, 6, to_char(now(), 'YYYY-MM'), 'Rent') returning id`))[0].id;
    expect(await payment('loan', loan)).toBeUndefined();
    await decide(HR, 'loan', loan, 'approved');
    const row = await payment('loan', loan);
    expect(row).toMatchObject({ status: 'to_pay', payee_name: 'Esther One', purpose: 'Loan over 6 months: Rent' });
    // on the Loans screen finance can't pay it out: only through the list
    expect(await as(FIN, `update employee_loans set status = 'disbursed' where id = '${loan}' returning id`)).toHaveLength(0);

    await record(FIN, row.id, 'bank', 'TRF-889');
    const l = (await rows<{ status: string; disbursed_by: string }>(`select status, disbursed_by from employee_loans where id = '${loan}'`))[0];
    expect(l).toEqual({ status: 'disbursed', disbursed_by: FIN });
    expect((await notes('loan_disbursed')).map((n) => n.employee_number)).toEqual(['E1']);
    // finance's say-so lasted only for the payment
    expect((await as<{ m: boolean }>(FIN, `select public.manages_loans() as m`))[0].m).toBe(false);
  });

  it('a loan cancelled before it is paid out leaves the list', async () => {
    const loan = (await as<{ id: string }>(HR, `insert into employee_loans (employee_number, principal, months, start_period, status)
      values ('E2', 12000, 3, to_char(now(), 'YYYY-MM'), 'approved') returning id`))[0].id;
    expect((await payment('loan', loan)).status).toBe('to_pay');
    await as(HR, `update employee_loans set status = 'cancelled' where id = '${loan}'`);
    expect((await payment('loan', loan)).status).toBe('cancelled');
  });
});

describe('expenses', () => {
  it('approved: on the list; paid in cash (no reference needed): paid_at is set and the employee told how', async () => {
    const exp = (await rows<{ id: string }>(`insert into expenses (title, amount, employee_id, employee_full_name, tenant_id)
      values ('Taxi to client', 1500, 'E1', 'Esther One', '${A}') returning id`))[0].id;
    await decide(HR, 'expense', exp, 'approved');
    const row = await payment('expense', exp);
    expect(row).toMatchObject({ status: 'to_pay', purpose: 'Expense claim: Taxi to client' });
    await record(FIN, row.id, 'cash', null, '2026-01-15');
    expect((await rows<{ paid: boolean }>(`select paid_at is not null as paid from expenses where id = '${exp}'`))[0].paid).toBe(true);
    const made = await notes('payment_made');
    expect(made.at(-1)).toEqual({ employee_number: 'E1',
      message: 'KES 1,500.00 (Expense claim: Taxi to client) was paid to you by cash, on 15 Jan 2026.' });
  });
});

describe('requisitions', () => {
  it('an employee asks for one for themselves: HR is told; they can neither approve it nor ask on someone else\'s name', async () => {
    const req = (await as<{ id: string; requested_by: string; payee_name: string }>(S1, `insert into requisitions
      (payee_employee_number, amount, purpose, category) values ('E1', 4200, 'Printer toner for the branch', 'Supplies')
      returning id, requested_by, payee_name`))[0];
    expect(req).toMatchObject({ requested_by: 'E1', payee_name: 'Esther One' });
    // HR, the approvers on the default chain, are told (20261025600000)
    expect((await notes('approval_needed')).at(-1)).toEqual({ employee_number: 'H1',
      message: "Esther One's requisition of KES 4,200.00 to Esther One for Printer toner for the branch is waiting for your approval." });
    expect(await fails(S1, `update requisitions set status = 'approved' where id = '${req.id}'`)).toMatch(/approval chain|Only HR/);
    expect(await fails(S1, `insert into requisitions (payee_employee_number, amount, purpose, status)
      values ('E1', 10, 'x', 'approved')`)).toBeTruthy();
    const mine = (await as<{ requested_by: string }>(S2, `insert into requisitions (requested_by, payee_employee_number, amount, purpose)
      values ('E1', 'E2', 10, 'Mine') returning requested_by`))[0];
    expect(mine.requested_by).toBe('E2');
  });

  it('HR approves: it joins the list and the person who asked is told; turning one down needs a reason', async () => {
    const id = (await rows<{ id: string }>(`select id from requisitions where purpose = 'Printer toner for the branch'`))[0].id;
    await decide(HR, 'requisition', id, 'approved');
    expect(await payment('requisition', id)).toMatchObject({ status: 'to_pay', employee_number: 'E1', purpose: 'Requisition: Printer toner for the branch' });
    expect((await notes('requisition_approved')).map((n) => n.employee_number)).toEqual(['E1']);
    expect(await fails(HR, `update requisitions set amount = 9999 where id = '${id}'`)).toMatch(/can't change/);

    const other = (await rows<{ id: string }>(`select id from requisitions where purpose = 'Mine'`))[0].id;
    expect(await fails(HR, `select decide_approval(r.id, 'rejected', null) from approval_requests r where r.record_id = '${other}'`)).toMatch(/reason/);
    await decide(HR, 'requisition', other, 'rejected', 'Not budgeted');
    expect(await payment('requisition', other)).toBeUndefined();
  });

  it('HR raises one to a supplier, approved at once; finance pays it and the requisition is paid', async () => {
    const req = (await as<{ id: string; requested_by: string }>(HR, `insert into requisitions
      (payee_type, payee_name, payee_details, amount, purpose, status)
      values ('other', 'Acme Stationers', 'Till 555123', 25000, 'Office chairs', 'approved') returning id, requested_by`))[0];
    expect(req.requested_by).toBe('H1');
    const row = await payment('requisition', req.id);
    expect(row).toMatchObject({ status: 'to_pay', employee_number: null, payee_name: 'Acme Stationers' });
    await record(FIN, row.id, 'other_app', 'PAYBILL-77');
    expect((await rows<{ status: string }>(`select status from requisitions where id = '${req.id}'`))[0].status).toBe('paid');
    expect(await fails(HR, `update requisitions set status = 'cancelled' where id = '${req.id}'`)).toMatch(/paid can't change/);
  });

  it('nobody approves or records a payment to themselves', async () => {
    const own = (await as<{ id: string }>(HR, `insert into requisitions (payee_employee_number, amount, purpose)
      values ('H1', 800, 'My airtime') returning id`))[0].id;
    expect(await fails(HR, `select decide_approval(r.id, 'approved', null) from approval_requests r where r.record_id = '${own}'`)).toMatch(/your own request/);

    const toFin = (await as<{ id: string }>(HR, `insert into requisitions (payee_employee_number, amount, purpose, status)
      values ('F1', 2000, 'Travel to Nakuru', 'approved') returning id`))[0].id;
    const row = await payment('requisition', toFin);
    expect(await fails(FIN, `select record_payment('${row.id}', 'mpesa', 'Q9', '${today}')`)).toMatch(/Someone else/);
  });
});

describe('who sees the list', () => {
  it('finance and HR see every row; an employee only what is paid to them; another company nothing', async () => {
    const all = (await rows<{ n: number }>(`select count(*)::int as n from payment_requests where tenant_id = '${A}'`))[0].n;
    expect(await as(FIN, `select 1 from payment_requests`)).toHaveLength(all);
    expect(await as(HR, `select 1 from payment_requests`)).toHaveLength(all);
    const own = await as<{ employee_number: string }>(S1, `select employee_number from payment_requests`);
    expect(own.length).toBeGreaterThan(0);
    expect(new Set(own.map((r) => r.employee_number))).toEqual(new Set(['E1']));
    expect(await as(HRB, `select 1 from payment_requests`)).toHaveLength(0);
  });

  it('finance sees how to pay the employees with something waiting, and only them; nobody else sees it', async () => {
    await db.exec(`update employees set payment_method = 'Bank Transfer', "Bank" = 'Equity', "Account Number" = '0123'
      where "Employee Number" = 'E1' and tenant_id = '${A}'`);
    const payees = await as<{ employee_number: string; bank: string | null }>(FIN, `select employee_number, bank from payment_payees() order by 1`);
    const waiting = (await rows<{ employee_number: string }>(`select distinct employee_number from payment_requests
      where tenant_id = '${A}' and status = 'to_pay' and employee_number is not null order by 1`)).map((r) => r.employee_number);
    expect(payees.map((p) => p.employee_number)).toEqual(waiting);
    expect(payees.find((p) => p.employee_number === 'E1')?.bank).toBe('Equity');
    expect(payees.map((p) => p.employee_number)).not.toContain('H1');
    expect(await as(HR, `select 1 from payment_payees()`)).toHaveLength(0);
    expect(await as(S2, `select 1 from payment_payees()`)).toHaveLength(0);
  });

  it('nobody writes the list directly', async () => {
    expect(await fails(FIN, `insert into payment_requests (source, source_id, payee_name, amount)
      values ('requisition', gen_random_uuid(), 'Me', 100)`)).toMatch(/permission denied/);
    expect(await fails(FIN, `update payment_requests set status = 'paid'`)).toMatch(/permission denied/);
  });

  it('the employee\'s bell never shows the alerts meant for finance and HR', async () => {
    expect((await rows<{ b: boolean }>(`select public.hr_only_notification('requisition_requested') and not public.hr_only_notification('payment_made') as b`))[0].b).toBe(true);
  });
});

describe('items approved before this migration', () => {
  it('approved, unpaid advances join the list quietly; paid or waiting ones don\'t', async () => {
    const old = await bootDb({
      file: '20261025400000_payments_to_make.sql',
      seed: async (d) => {
        await d.exec(`
          insert into employees ("Employee Number", "First Name", tenant_id) values
            ('E1', 'Esther', '${A}'), ('E2', 'Eric', '${A}'), ('E3', 'Evans', '${A}');
          insert into salary_advance ("Employee Number", "Amount Requested", admin_adjusted_amount, status, payment_processed, tenant_id) values
            ('E1', 5000, 4000, 'Approved', 'false', '${A}'),
            ('E2', 6000, null, 'approved', 'true', '${A}'),
            ('E3', 7000, null, 'Pending', 'false', '${A}');
        `);
      },
    });
    const got = (await old.query<{ employee_number: string; amount: string; status: string }>(
      `select employee_number, amount, status from payment_requests`)).rows;
    expect(got.map((r) => ({ ...r, amount: Number(r.amount) }))).toEqual([{ employee_number: 'E1', amount: 4000, status: 'to_pay' }]);
    expect((await old.query(`select 1 from hr_notifications where notification_type = 'payment_due'`)).rows).toHaveLength(0);
  }, 120000);
});
