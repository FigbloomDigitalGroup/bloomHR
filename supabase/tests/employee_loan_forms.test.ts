// @vitest-environment node
//
// The loan agreement form (20261118100000): an approved loan gets a form; the borrower, the approver and the HR
// person who accepts the signed copy each put their saved signature on it; the signed copy is uploaded and reviewed;
// and payout waits until HR accepts it, when the company requires the form.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000e001';
const PAY = '00000000-0000-0000-0000-00000000e002';
const S1 = '00000000-0000-0000-0000-00000000e003';
const S2 = '00000000-0000-0000-0000-00000000e004';
const HRB = '00000000-0000-0000-0000-00000000e005';
const SIG = 'data:image/png;base64,iVBORw0KGgo=';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const decide = (user: string, id: string) =>
  as(user, `select decide_approval(r.id, 'approved', null) from approval_requests r where r.kind = 'loan' and r.record_id = '${id}'`);
const ask = async (user: string, values: string) =>
  (await read<{ id: string }>(user, `insert into employee_loans ${values} returning id`))[0].id;
const form = async (id: string) => (await rows<Record<string, unknown>>(`select * from employee_loan_forms where loan_id = '${id}'`))[0];
const payment = async (id: string) =>
  (await rows<{ status: string; payee_details: string | null; amount: string }>(`select status, payee_details, amount from payment_requests where source = 'loan' and source_id = '${id}'`))[0];
const path = (id: string, name = 'signed-1.pdf') => `${A}/${id}/${name}`;

let loanId: string;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values
      ('${HR}', 'hr@a.co'), ('${PAY}', 'pay@a.co'), ('${S1}', 's1@a.co'), ('${S2}', 's2@a.co'), ('${HRB}', 'hr@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${PAY}', 'pay@a.co', 'FINANCE', '${A}'), ('${S1}', 's1@a.co', 'STAFF', '${A}'),
      ('${S2}', 's2@a.co', 'STAFF', '${A}'), ('${HRB}', 'hr@b.co', 'HR', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees', 'loans'], '${A}'), ('FINANCE', array['payroll'], '${A}'), ('STAFF', array['dashboard'], '${A}'),
      ('HR', array['employees', 'loans'], '${B}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Basic Salary", onboarding_status, tenant_id) values
      ('H1', 'Hana', 'Hr', 'hr@a.co', 100000, 'approved', '${A}'),
      ('E1', 'Esther', 'One', 's1@a.co', 60000, 'approved', '${A}'),
      ('E2', 'Eric', 'Two', 's2@a.co', 50000, 'approved', '${A}');
  `);
  await as(HR, `insert into loan_settings (annual_rate, interest_method, min_months, max_months) values (20, 'upfront', 1, 6)`);
}, 120000);

describe('an approved loan gets its form', () => {
  it('a request has none; approving makes one, required by default, and tells the borrower', async () => {
    loanId = await ask(
      S1,
      `(employee_number, principal, months, reason, status, residential_address, other_loan_repayments, disbursement_account)
       values ('E1', 30000, 3, 'school fees', 'requested', 'Kileleshwa, Nairobi', 2000, '0712 345 678')`
    );
    expect(await form(loanId)).toBeUndefined();
    await decide(HR, loanId);
    expect(await form(loanId)).toMatchObject({ required: true, status: 'none', borrower_signature: null });
    const notes = await rows<{ notification_type: string }>(`select notification_type from hr_notifications where employee_number = 'E1'`);
    expect(notes.map((n) => n.notification_type)).toContain('loan_form_to_sign');
  });

  it('finance is not told to pay yet, and nobody can mark it paid out', async () => {
    expect(await payment(loanId)).toBeUndefined();
    await expect(as(HR, `update employee_loans set status = 'disbursed' where id = '${loanId}'`)).rejects.toThrow(/signed loan form/);
  });

  it('the borrower and HR read it; other staff and other companies do not; nobody writes it directly', async () => {
    expect(await read(S1, `select loan_id from employee_loan_forms`)).toHaveLength(1);
    expect(await read(HR, `select loan_id from employee_loan_forms`)).toHaveLength(1);
    expect(await read(S2, `select loan_id from employee_loan_forms`)).toHaveLength(0);
    expect(await read(HRB, `select loan_id from employee_loan_forms`)).toHaveLength(0);
    await expect(as(HR, `update employee_loan_forms set status = 'accepted' where loan_id = '${loanId}'`)).rejects.toThrow();
  });
});

describe('signing', () => {
  it('only the borrower signs as the borrower, with a drawn signature', async () => {
    await expect(as(S2, `select loan_form_sign_borrower('${loanId}', '${SIG}')`)).rejects.toThrow(/Loan not found/);
    await expect(as(HR, `select loan_form_sign_borrower('${loanId}', '${SIG}')`)).rejects.toThrow(/Only the borrower/);
    await expect(as(S1, `select loan_form_sign_borrower('${loanId}', null)`)).rejects.toThrow(/My signature/);
    await expect(as(S1, `select loan_form_sign_borrower('${loanId}', 'data:image/jpeg;base64,xx')`)).rejects.toThrow(/My signature/);
    await as(S1, `select loan_form_sign_borrower('${loanId}', '${SIG}')`);
    expect(await form(loanId)).toMatchObject({ borrower_signature: SIG });
  });

  it('only the approver signs the approval, once', async () => {
    await expect(as(PAY, `select loan_form_sign_approver('${loanId}', '${SIG}', 'Pat Pay', 'Finance')`)).rejects.toThrow(/approved the loan/);
    await as(HR, `select loan_form_sign_approver('${loanId}', '${SIG}', 'Hana Hr', 'HR Manager')`);
    expect(await form(loanId)).toMatchObject({ approver_signature: SIG, approver_name: 'Hana Hr', approver_title: 'HR Manager' });
    await expect(as(HR, `select loan_form_sign_approver('${loanId}', '${SIG}', 'Hana Hr', null)`)).rejects.toThrow(/already signed/);
  });
});

describe('the signed copy', () => {
  it('goes in the loan\'s own folder, as a PDF', async () => {
    await expect(as(S1, `select loan_form_submit('${loanId}', '${A}/other/signed-1.pdf')`)).rejects.toThrow(/own folder/);
    await expect(as(S1, `select loan_form_submit('${loanId}', '${path(loanId, 'signed-1.docx')}')`)).rejects.toThrow(/PDF/);
    await expect(as(S2, `select loan_form_submit('${loanId}', '${path(loanId)}')`)).rejects.toThrow(/Loan not found/);
  });

  it('the borrower uploads it and HR hears of it', async () => {
    await as(S1, `select loan_form_submit('${loanId}', '${path(loanId)}', 'my form.pdf')`);
    expect(await form(loanId)).toMatchObject({ status: 'uploaded', file_path: path(loanId), file_name: 'my form.pdf' });
    const hr = await rows<{ title: string }>(`select title from hr_notifications where notification_type = 'loan_form_signed'`);
    expect(hr).toHaveLength(1);
  });

  it('HR sends it back with a reason; the borrower uploads again', async () => {
    await expect(as(HR, `select loan_form_review('${loanId}', false, '  ')`)).rejects.toThrow(/needs fixing/);
    await expect(as(S1, `select loan_form_review('${loanId}', false, 'no')`)).rejects.toThrow(/Only HR/);
    await as(HR, `select loan_form_review('${loanId}', false, 'The witness did not sign.')`);
    expect(await form(loanId)).toMatchObject({ status: 'sent_back', send_back_reason: 'The witness did not sign.' });
    await as(S1, `select loan_form_submit('${loanId}', '${path(loanId, 'signed-2.pdf')}')`);
    expect(await form(loanId)).toMatchObject({ status: 'uploaded', file_path: path(loanId, 'signed-2.pdf') });
  });

  it('accepting signs the employer undertaking and sends the loan to finance, paid into the borrower\'s account', async () => {
    await expect(as(HR, `select loan_form_review('${loanId}', true)`)).rejects.toThrow(/My signature/);
    await as(HR, `select loan_form_review('${loanId}', true, null, '${SIG}', 'Hana Hr', 'HR Manager')`);
    expect(await form(loanId)).toMatchObject({ status: 'accepted', employer_signature: SIG, employer_officer: 'Hana Hr', reviewed_by: HR });
    // 30,000 less 20% taken off up front
    expect(await payment(loanId)).toMatchObject({ status: 'to_pay', payee_details: '0712 345 678' });
    expect(Number((await payment(loanId)).amount)).toBe(24000);
    await expect(as(S1, `select loan_form_submit('${loanId}', '${path(loanId, 'signed-3.pdf')}')`)).rejects.toThrow(/already accepted/);
  });

  it('then it can be paid out', async () => {
    await as(HR, `update employee_loans set status = 'disbursed' where id = '${loanId}'`);
    expect((await rows<{ status: string }>(`select status from employee_loans where id = '${loanId}'`))[0].status).toBe('disbursed');
  });
});

describe('a company that does not require the form', () => {
  it('pays out as before; the form is there to sign but holds nothing up', async () => {
    await as(HR, `update loan_settings set require_signed_form = false`);
    const id = await ask(S2, `(employee_number, principal, months, status) values ('E2', 10000, 2, 'requested')`);
    await decide(HR, id);
    expect(await form(id)).toMatchObject({ required: false });
    expect(await payment(id)).toMatchObject({ status: 'to_pay' });
    await as(HR, `update employee_loans set status = 'disbursed' where id = '${id}'`);
  });
});
