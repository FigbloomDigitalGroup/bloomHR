// @vitest-environment node
//
// The loan form completed by the people on it (20261118400000): a colleague witnesses from their own portal, the
// borrower or HR correct values the employee record has wrong, finance reads the forms, and HR deletes cancelled loans.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const HR = '00000000-0000-0000-0000-00000000c101';
const FIN = '00000000-0000-0000-0000-00000000c102';
const S1 = '00000000-0000-0000-0000-00000000c103';
const S2 = '00000000-0000-0000-0000-00000000c104';
const S3 = '00000000-0000-0000-0000-00000000c105';
const SIG = 'data:image/png;base64,iVBORw0KGgo=';

let db: PGlite;
let loanId: string;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const decide = (id: string) =>
  as(HR, `select decide_approval(r.id, 'approved', null) from approval_requests r where r.kind = 'loan' and r.record_id = '${id}'`);
const ask = async (user: string, employee: string) =>
  (await read<{ id: string }>(user, `insert into employee_loans (employee_number, principal, months, reason, status)
                                     values ('${employee}', 9000, 3, 'school fees', 'requested') returning id`))[0].id;
const form = async (id: string) => (await rows<Record<string, unknown>>(`select * from employee_loan_forms where loan_id = '${id}'`))[0];

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co'), ('${FIN}', 'fin@a.co'), ('${S1}', 's1@a.co'), ('${S2}', 's2@a.co'), ('${S3}', 's3@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${FIN}', 'fin@a.co', 'CHECKER', '${A}'), ('${S1}', 's1@a.co', 'STAFF', '${A}'),
      ('${S2}', 's2@a.co', 'STAFF', '${A}'), ('${S3}', 's3@a.co', 'STAFF', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees', 'loans'], '${A}'), ('CHECKER', array['payments'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Basic Salary", onboarding_status, tenant_id) values
      ('H1', 'Hana', 'Hr', 'hr@a.co', 100000, 'approved', '${A}'),
      ('F1', 'Faith', 'Finance', 'fin@a.co', 90000, 'approved', '${A}'),
      ('E1', 'Esther', 'One', 's1@a.co', 60000, 'approved', '${A}'),
      ('E2', 'Eric', 'Two', 's2@a.co', 50000, 'approved', '${A}'),
      ('E3', 'Ella', 'Three', 's3@a.co', 50000, 'approved', '${A}');
    update employees set "ID Number" = 11223344 where "Employee Number" = 'E2';
  `);
  loanId = await ask(S1, 'E1');
}, 120000);

describe('the witness, a colleague', () => {
  it('the borrower asks a colleague, never themselves; the colleague hears of it', async () => {
    await expect(as(S1, `select loan_set_witness('${loanId}', 'E1')`)).rejects.toThrow(/own signature/);
    await expect(as(S3, `select loan_set_witness('${loanId}', 'E2')`)).rejects.toThrow(/Loan not found/);
    await as(S1, `select loan_set_witness('${loanId}', 'E2')`);
    expect(await rows(`select 1 from hr_notifications where employee_number = 'E2' and notification_type = 'loan_witness_asked'`)).toHaveLength(1);
  });

  it('they sign only after the loan is approved and the borrower has signed', async () => {
    // the form exists from the request on (20261118600000): the witness waits for the borrower, not the approval
    await decide(loanId);
    await expect(as(S2, `select loan_witness_sign('${loanId}', '${SIG}')`)).rejects.toThrow(/borrower hasn't signed/);
    await as(S1, `select loan_form_sign_borrower('${loanId}', '${SIG}')`);
    await expect(as(S3, `select loan_witness_sign('${loanId}', '${SIG}')`)).rejects.toThrow(/Loan not found/);
    // what they see: whose signature and the loan, nothing personal
    const [{ v }] = await read<{ v: Record<string, unknown> }>(S2, `select loan_witness_view('${loanId}') v`);
    expect(v).toMatchObject({ borrower_name: 'Esther One', principal: 9000, borrower_signed: true });
    await as(S2, `select loan_witness_sign('${loanId}', '${SIG}')`);
    // their name and ID number go on the form from their record
    expect(await form(loanId)).toMatchObject({ witness_name: 'Eric Two', witness_id_number: '11223344', witness_signature: SIG });
  });

  it('once approved, a witness who signed stays (20261119000000), until HR sends the form back to be fixed', async () => {
    await expect(as(S1, `select loan_set_witness('${loanId}', 'E3')`)).rejects.toThrow(/can't be changed/);
    await expect(as(HR, `select loan_form_witness('${loanId}', 'Outside Person', '555', '${SIG}')`)).rejects.toThrow(/can't be changed/);
    await db.exec(`update employee_loan_forms set status = 'sent_back', send_back_reason = 'Wrong witness' where loan_id = '${loanId}'`);
  });

  it('asking another witness takes the last one off the form; HR can enter one not on staff', async () => {
    await as(S1, `select loan_set_witness('${loanId}', 'E3')`);
    expect(await form(loanId)).toMatchObject({ witness_name: null, witness_signature: null });
    await as(S3, `select loan_witness_decline('${loanId}', 'I wasn''t there')`);
    expect(await rows(`select 1 from hr_notifications where employee_number = 'E1' and notification_type = 'loan_witness_declined'`)).toHaveLength(1);
    await as(HR, `select loan_form_witness('${loanId}', 'Outside Person', '555', '${SIG}')`);
    expect(await rows(`select 1 from employee_loan_witnesses where loan_id = '${loanId}'`)).toHaveLength(0);
    expect(await form(loanId)).toMatchObject({ witness_name: 'Outside Person' });
  });
});

describe('correcting the form’s values', () => {
  it('the borrower or HR set them; other staff can’t; only known fields; salaries are amounts', async () => {
    // the form was sent back to be fixed (above): corrections are open again
    await as(S1, `select loan_form_set_values('${loanId}', '{"net_salary": "84000", "contract_end_date": "2027-06-30", "town": " "}')`);
    expect((await rows<{ values: unknown }>(`select "values" from employee_loan_form_values where loan_id = '${loanId}'`))[0].values).toEqual({
      net_salary: '84000', contract_end_date: '2027-06-30',
    });
    await expect(as(S3, `select loan_form_set_values('${loanId}', '{"net_salary": "1"}')`)).rejects.toThrow(/Loan not found/);
    await expect(as(S1, `select loan_form_set_values('${loanId}', '{"principal": "1"}')`)).rejects.toThrow(/no field principal/);
    await expect(as(S1, `select loan_form_set_values('${loanId}', '{"net_salary": "84k"}')`)).rejects.toThrow(/amount in KSh/);
    await as(HR, `select loan_form_set_values('${loanId}', '{"net_salary": "84000", "gross_salary": "110000"}')`);
    expect(await read(S1, `select 1 from employee_loan_form_values`)).toHaveLength(1);
    expect(await read(S3, `select 1 from employee_loan_form_values`)).toHaveLength(0);
  });

  it('on an approved loan whose form isn’t sent back, nobody corrects anything (20261119000000)', async () => {
    await db.exec(`update employee_loan_forms set status = 'none', send_back_reason = null where loan_id = '${loanId}'`);
    await expect(as(S1, `select loan_form_set_values('${loanId}', '{"net_salary": "99000"}')`)).rejects.toThrow(/can't be changed/);
    await expect(as(HR, `select loan_form_set_values('${loanId}', '{"net_salary": "99000"}')`)).rejects.toThrow(/can't be changed/);
    await expect(as(HR, `update employee_loans set principal = 1 where id = '${loanId}'`)).rejects.toThrow(/agreement can't be changed/);
  });
});

describe('finance reads loan forms', () => {
  it('Payments reads the loans, forms and corrections; it changes nothing', async () => {
    expect(await read(FIN, `select id from employee_loans`)).toHaveLength(1);
    expect(await read(FIN, `select loan_id from employee_loan_forms`)).toHaveLength(1);
    expect(await read(FIN, `select loan_id from employee_loan_form_values`)).toHaveLength(1);
    await expect(as(FIN, `select loan_form_set_values('${loanId}', '{"net_salary": "1"}')`)).rejects.toThrow(/Loan not found/);
    await expect(as(FIN, `select delete_cancelled_loan('${loanId}')`)).rejects.toThrow(/Only HR/);
    // other staff still see nothing
    expect(await read(S3, `select loan_id from employee_loan_forms`)).toHaveLength(0);
  });
});

describe('deleting a cancelled loan', () => {
  it('only a cancelled one, with everything that belongs to it', async () => {
    await expect(as(HR, `select delete_cancelled_loan('${loanId}')`)).rejects.toThrow(/Only a cancelled loan/);
    await as(HR, `update employee_loans set status = 'cancelled' where id = '${loanId}'`);
    await as(HR, `select delete_cancelled_loan('${loanId}')`);
    for (const t of ['employee_loans', 'employee_loan_forms', 'employee_loan_form_values', 'employee_loan_instalments']) {
      expect(await rows(`select 1 from ${t} where ${t === 'employee_loans' ? 'id' : 'loan_id'} = '${loanId}'`)).toHaveLength(0);
    }
    expect(await rows(`select 1 from approval_requests where record_id = '${loanId}'`)).toHaveLength(0);
  });
});
