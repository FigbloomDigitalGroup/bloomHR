// @vitest-environment node
//
// Approval chains for money (FIG-1216): loans, salary advances, expenses and requisitions go through the company's
// approval workflow, as leave does. The default chain is one step, "anyone with the module" that approved it before;
// a company can make it longer (line manager, then HR, then a named person). The last approval writes the item's
// approval (and so it joins Payments to make); a rejection needs a reason; deciding outside the chain is refused.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootDb, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const HR = '00000000-0000-0000-0000-00000000c001';
const MGR = '00000000-0000-0000-0000-00000000c002';
const DIR = '00000000-0000-0000-0000-00000000c003';
const S1 = '00000000-0000-0000-0000-00000000c004';
const S2 = '00000000-0000-0000-0000-00000000c005';
const ADMIN = '00000000-0000-0000-0000-00000000c006';
const SET = '00000000-0000-0000-0000-00000000c007';

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
type Req = { id: string; status: string; current_step: number };
const request = async (kind: string, record: string) =>
  (await rows<Req>(`select id, status, current_step from approval_requests where kind = $1 and record_id = $2`, [kind, record]))[0];
const decide = (user: string, req: string, decision: string, comment: string | null = null) =>
  as<{ status: string }>(user, `select status from decide_approval('${req}', '${decision}', ${comment === null ? 'null' : `'${comment}'`})`);
const notes = (employee: string, type: string) => rows<{ title: string; message: string }>(
  `select title, message from hr_notifications where employee_number = $1 and notification_type = $2 order by id`, [employee, type]);
const saveChain = (kind: string, steps: unknown[]) => as(SET, `select save_approval_workflow('${kind}', '${JSON.stringify(steps)}'::jsonb, true)`);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values
      ('${HR}', 'hr@a.co'), ('${MGR}', 'mgr@a.co'), ('${DIR}', 'dir@a.co'), ('${S1}', 's1@a.co'), ('${S2}', 's2@a.co'),
      ('${ADMIN}', 'admin@a.co'), ('${SET}', 'set@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${MGR}', 'mgr@a.co', 'MANAGER', '${A}'), ('${DIR}', 'dir@a.co', 'OPERATIONS', '${A}'),
      ('${S1}', 's1@a.co', 'STAFF', '${A}'), ('${S2}', 's2@a.co', 'STAFF', '${A}'), ('${ADMIN}', 'admin@a.co', 'ADMIN', '${A}'),
      ('${SET}', 'set@a.co', 'CHECKER', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees', 'salaryadmin', 'loans', 'expenses', 'requisitions'], '${A}'),
      ('MANAGER', array['dashboard'], '${A}'), ('OPERATIONS', array['dashboard'], '${A}'), ('STAFF', array['dashboard'], '${A}'),
      ('CHECKER', array['settings', 'payments'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Basic Salary", manager_email, onboarding_status, tenant_id) values
      ('H1', 'Hana', 'Hr', 'hr@a.co', 100000, null, 'approved', '${A}'),
      ('M1', 'Max', 'Manager', 'mgr@a.co', 90000, null, 'approved', '${A}'),
      ('D1', 'Dana', 'Director', 'dir@a.co', 150000, null, 'approved', '${A}'),
      ('E1', 'Esther', 'One', 's1@a.co', 60000, 'mgr@a.co', 'approved', '${A}'),
      ('E2', 'Eric', 'Two', 's2@a.co', 50000, null, 'approved', '${A}'),
      ('S9', 'Sam', 'Settings', 'set@a.co', 50000, null, 'approved', '${A}');
  `);
}, 120000);

describe('the default chain: anyone with the module that approved it before', () => {
  let adv: string;

  it('a new salary advance starts on a one-step chain of "anyone with Salary Advance", and they are told', async () => {
    adv = (await rows<{ id: string }>(`insert into salary_advance ("Employee Number", "Full Name", "Amount Requested", tenant_id)
      values ('E1', 'Esther One', 10000, '${A}') returning id`))[0].id;
    const r = await request('salary_advance', adv);
    expect(r).toMatchObject({ status: 'pending', current_step: 1 });
    const told = await notes('H1', 'approval_needed');
    expect(told.at(-1)).toEqual({ title: 'Salary advance awaiting your approval',
      message: 'Esther One\'s salary advance of KES 10,000.00 is waiting for your approval.' });
  });

  it('someone without the module may not decide; HR may, and the advance is approved and goes to finance', async () => {
    const r = await request('salary_advance', adv);
    expect(await fails(S2, `select decide_approval('${r.id}', 'approved', null)`)).toMatch(/not the approver/);
    expect(await fails(HR, `update salary_advance set status = 'approved' where id = '${adv}'`)).toMatch(/waiting on its approvers/);
    expect((await decide(HR, r.id, 'approved'))[0].status).toBe('approved');
    const a = (await rows<{ status: string; approved_by_email: string }>(`select status, approved_by_email from salary_advance where id = '${adv}'`))[0];
    expect(a).toEqual({ status: 'approved', approved_by_email: 'hr@a.co' });
    expect((await rows<{ status: string }>(`select status from payment_requests where source = 'salary_advance' and source_id = '${adv}'`))[0].status).toBe('to_pay');
    expect((await notes('E1', 'salary_advance_approved'))).toHaveLength(1);
  });

  it('a requisition an employee asks for goes to HR; turning it down needs a reason, which the employee sees', async () => {
    const q = (await as<{ id: string }>(S1, `insert into requisitions (payee_employee_number, amount, purpose) values ('E1', 900, 'Bus fare') returning id`))[0].id;
    const r = await request('requisition', q);
    expect(r.status).toBe('pending');
    expect(await fails(HR, `select decide_approval('${r.id}', 'rejected', null)`)).toMatch(/reason/);
    await decide(HR, r.id, 'rejected', 'Claim it as an expense');
    expect((await rows<{ status: string; decision_comment: string }>(`select status, decision_comment from requisitions where id = '${q}'`))[0])
      .toEqual({ status: 'rejected', decision_comment: 'Claim it as an expense' });
    expect((await notes('E1', 'requisition_rejected')).at(-1)?.message).toMatch(/Reason: Claim it as an expense\./);
    expect(await rows(`select 1 from payment_requests where source_id = '${q}'`)).toHaveLength(0);
  });

  it('HR raising a requisition already approved on a one-step chain they decide: it stays approved', async () => {
    const q = (await as<{ id: string; status: string }>(HR, `insert into requisitions (payee_type, payee_name, amount, purpose, status)
      values ('other', 'Acme', 5000, 'Chairs', 'approved') returning id, status`))[0];
    expect(q.status).toBe('approved');
    expect(await request('requisition', q.id)).toBeUndefined();
  });
});

describe('a longer chain: line manager, then anyone with Staff loans, then the director', () => {
  let loan: string;
  let req: string;

  beforeAll(async () => {
    await saveChain('loan', [
      { approver_type: 'reports_to' },
      { approver_type: 'module', approver_module: 'loans' },
      { approver_type: 'person', approver_employee_number: 'D1', label: 'Finance director' },
    ]);
  });

  it('only someone with Settings saves it, and a module step needs a module that exists', async () => {
    expect(await fails(HR, `select save_approval_workflow('loan', '[{"approver_type":"module","approver_module":"loans"}]'::jsonb, true)`)).toMatch(/Settings/);
    expect(await fails(SET, `select save_approval_workflow('loan', '[{"approver_type":"module","approver_module":"nope"}]'::jsonb, true)`))
      .toMatch(/what the approvers at step 1 can do/);
    const preview = (await as<{ c: { steps: { label: string; who: string }[] } }>(S1, `select my_approval_chain('loan') as c`))[0].c;
    expect(preview.steps.map((s) => [s.label, s.who])).toEqual([
      ['Line manager', 'Max Manager'], ['Staff loans', 'anyone with Staff loans'], ['Finance director', 'Dana Director']]);
  });

  it('a loan request goes to the line manager first', async () => {
    loan = (await as<{ id: string }>(S1, `insert into employee_loans (employee_number, principal, months, start_period)
      values ('E1', 30000, 6, to_char(now(), 'YYYY-MM')) returning id`))[0].id;
    req = (await request('loan', loan)).id;
    expect((await notes('M1', 'approval_needed')).at(-1)?.title).toBe('Loan request awaiting your approval');
    expect((await as<{ kind: string; step_label: string }>(MGR, `select kind, step_label from my_money_approvals()`)))
      .toEqual([{ kind: 'loan', step_label: 'Line manager' }]);
    // HR is a later step: not yet theirs to approve, though they may turn it down early
    expect(await fails(HR, `select decide_approval('${req}', 'approved', null)`)).toMatch(/not the approver/);
    // nor approve it on the Loans screen, round the chain
    expect(await fails(HR, `update employee_loans set status = 'approved' where id = '${loan}'`)).toMatch(/waiting on its approvers/);
  });

  it('each approval moves it on and tells the employee; the loan stays a request until the last', async () => {
    await decide(MGR, req, 'approved');
    expect((await notes('E1', 'approval_progress')).at(-1)).toEqual({ title: 'Loan request moving on',
      message: 'Your loan request was approved by Max Manager. It is now waiting on Staff loans.' });
    expect((await notes('H1', 'approval_needed')).at(-1)?.message).toMatch(/Esther One's loan request of KES 30,000.00 over 6 months is waiting for your approval \(Max Manager approved the step before\)\./);
    await decide(HR, req, 'approved');
    expect((await rows<{ status: string }>(`select status from employee_loans where id = '${loan}'`))[0].status).toBe('requested');
    expect((await notes('D1', 'approval_needed'))).toHaveLength(1);
    expect(await rows(`select 1 from payment_requests where source_id = '${loan}'`)).toHaveLength(0);

    await decide(DIR, req, 'approved', 'Fine');
    const l = (await rows<{ status: string; decided_by: string; decision_comment: string }>(
      `select status, decided_by, decision_comment from employee_loans where id = '${loan}'`))[0];
    expect(l).toEqual({ status: 'approved', decided_by: DIR, decision_comment: 'Fine' });
    expect((await rows<{ status: string }>(`select status from payment_requests where source = 'loan' and source_id = '${loan}'`))[0].status).toBe('to_pay');
  });

  it('the chain is shown to HR, the employee and the approvers, not to others', async () => {
    const chain = async (user: string) => as<{ status: string; steps: { status: string }[] }>(user,
      `select status, steps from approval_chains('loan', array['${loan}']::uuid[])`);
    expect((await chain(HR))[0].steps.map((s) => s.status)).toEqual(['approved', 'approved', 'approved']);
    expect(await chain(S1)).toHaveLength(1);
    expect(await chain(MGR)).toHaveLength(1);
    expect(await chain(S2)).toHaveLength(0);
  });

  it('HR setting up a loan already approved can\'t step round a longer chain: it goes on the chain', async () => {
    const l = (await as<{ id: string; status: string }>(HR, `insert into employee_loans (employee_number, principal, months, start_period, status)
      values ('E2', 8000, 4, to_char(now(), 'YYYY-MM'), 'approved') returning id, status`))[0];
    expect(l.status).toBe('requested');
    expect((await request('loan', l.id)).status).toBe('pending');
  });

  it('a rejection at any step ends it, with the reason on the loan', async () => {
    const other = (await as<{ id: string }>(S1, `insert into employee_loans (employee_number, principal, months, start_period)
      values ('E1', 5000, 2, to_char(now(), 'YYYY-MM')) returning id`))[0].id;
    const r = (await request('loan', other)).id;
    await decide(MGR, r, 'rejected', 'Too soon after the last one');
    const l = (await rows<{ status: string; decision_comment: string }>(`select status, decision_comment from employee_loans where id = '${other}'`))[0];
    expect(l).toEqual({ status: 'rejected', decision_comment: 'Too soon after the last one' });
    expect((await request('loan', other)).status).toBe('rejected');
  });

  it('withdrawing a request ends its chain', async () => {
    const other = (await as<{ id: string }>(S1, `insert into employee_loans (employee_number, principal, months, start_period)
      values ('E1', 4000, 2, to_char(now(), 'YYYY-MM')) returning id`))[0].id;
    expect(await request('loan', other)).toBeTruthy();
    await as(S1, `update employee_loans set status = 'cancelled' where id = '${other}'`);
    expect(await request('loan', other)).toBeUndefined();
  });
});

describe('leave is as before', () => {
  it('the leave chain still starts with the leave approver, then HR', async () => {
    const c = (await as<{ c: { steps: { label: string }[] } }>(S1, `select my_approval_chain('leave') as c`))[0].c;
    expect(c.steps.map((s) => s.label).at(-1)).toBe('HR');
  });
});

describe('items waiting when this migration runs', () => {
  it('go on the default chain quietly', async () => {
    const old = await bootDb({
      file: '20261025700000_money_approval_chains.sql',
      seed: async (d) => {
        await d.exec(`
          insert into employees ("Employee Number", "First Name", tenant_id) values ('E1', 'Esther', '${A}');
          insert into salary_advance ("Employee Number", "Amount Requested", status, tenant_id) values
            ('E1', 5000, 'Pending', '${A}'), ('E1', 6000, 'approved', '${A}');
        `);
      },
    });
    const got = (await old.query<{ kind: string; status: string; steps: { approver_module: string }[] }>(
      `select kind, status, steps from approval_requests where kind = 'salary_advance'`)).rows;
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ status: 'pending', steps: [{ approver_module: 'salaryadmin' }] });
    expect((await old.query(`select 1 from hr_notifications where notification_type = 'approval_needed'`)).rows).toHaveLength(0);
  }, 120000);
});
