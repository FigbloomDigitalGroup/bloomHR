// @vitest-environment node
//
// The loan form signed online from the request on, the guarantor's details from their record, and the borrower's
// details as the database reads them (20261118600000).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const HR = '00000000-0000-0000-0000-00000000a601';
const S1 = '00000000-0000-0000-0000-00000000a602';
const S2 = '00000000-0000-0000-0000-00000000a603';
const S3 = '00000000-0000-0000-0000-00000000a604';
const SIG = 'data:image/png;base64,iVBORw0KGgo=';

let db: PGlite;
let loanId: string;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const borrower = async (user: string) =>
  (await read<{ v: Record<string, unknown> }>(user, `select loan_form_borrower('${loanId}') v`))[0].v;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co'), ('${S1}', 's1@a.co'), ('${S2}', 's2@a.co'), ('${S3}', 's3@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${S1}', 's1@a.co', 'STAFF', '${A}'), ('${S2}', 's2@a.co', 'STAFF', '${A}'), ('${S3}', 's3@a.co', 'STAFF', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values ('HR', array['employees', 'loans'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Basic Salary", "Employee Type", onboarding_status, tenant_id) values
      ('H1', 'Hana', 'Hr', 'hr@a.co', 100000, 'Permanent', 'approved', '${A}'),
      ('E1', 'Esther', 'One', 's1@a.co', 74784, 'Probation', 'approved', '${A}'),
      ('E2', 'Eric', 'Two', 's2@a.co', 50000, 'Permanent', 'approved', '${A}'),
      ('E3', 'Ella', 'Three', 's3@a.co', 50000, 'Permanent', 'approved', '${A}');
    update employees set "ID Number" = 22334455, "Tax PIN" = 'A123456789B', "Mobile Number" = '0722111222', "Date of Birth" = '1990-01-02',
      "Town" = 'Kiambu', "Postal Address" = 'Ruaka' where "Employee Number" = 'E2';
  `);
  loanId = (await read<{ id: string }>(S1, `insert into employee_loans (employee_number, principal, months, reason, status)
                                            values ('E1', 30000, 3, 'school fees', 'requested') returning id`))[0].id;
}, 120000);

describe('signed online from the request on', () => {
  it('a request has its form; the borrower signs it, and their witness after them, before approval', async () => {
    expect((await rows(`select status from employee_loan_forms where loan_id = '${loanId}'`))).toHaveLength(1);
    await as(S1, `select loan_set_witness('${loanId}', 'E3')`);
    await expect(as(S3, `select loan_witness_sign('${loanId}', '${SIG}')`)).rejects.toThrow(/borrower hasn't signed/);
    await as(S1, `select loan_form_sign_borrower('${loanId}', '${SIG}')`);
    await as(S3, `select loan_witness_sign('${loanId}', '${SIG}')`);
    expect((await rows(`select borrower_signature, witness_name from employee_loan_forms where loan_id = '${loanId}'`))[0]).toEqual({
      borrower_signature: SIG, witness_name: 'Ella Three',
    });
  });

  it('a paper copy still waits for approval', async () => {
    await expect(as(S1, `select loan_form_submit('${loanId}', '${A}/${loanId}/signed-1.pdf')`)).rejects.toThrow(/approved/);
  });
});

describe('the guarantor’s details from their record', () => {
  it('fill in as soon as they are asked; they add only the relationship and another number', async () => {
    await as(S1, `select loan_set_guarantor('${loanId}', 'E2')`);
    expect((await rows(`select * from employee_loan_guarantors where loan_id = '${loanId}'`))[0]).toMatchObject({
      status: 'asked', id_number: '22334455', kra_pin: 'A123456789B', mobile: '0722111222', date_of_birth: '1990-01-02',
      email: 's2@a.co', town: 'Kiambu', residential_address: 'Ruaka',
    });
    await as(S2, `select loan_guarantor_sign('${loanId}', '${SIG}', 'Colleague', '0733000000')`);
    expect((await rows(`select status, residential_address from employee_loan_guarantors where loan_id = '${loanId}'`))[0]).toEqual({
      status: 'signed', residential_address: 'Ruaka',
    });
  });
});

describe('the borrower’s details for the form', () => {
  it('employment type: HR Lifecycle’s, confirmed after probation is Permanent', async () => {
    expect(await borrower(S1)).toMatchObject({ employment_type: 'Probation' });
    await db.exec(`update hr_employment_status set employment_type = 'Probation', is_confirmed = true where "Employee Number" = 'E1'`);
    expect(await borrower(S1)).toMatchObject({ employment_type: 'Permanent' });
  });

  it('pay: the latest payslip while its basic pay is the record’s; after a raise, the record’s salary and no net', async () => {
    await db.exec(`insert into salary_history (tenant_id, employee_id, pay_period, basic_salary, gross_pay, net_pay)
                   values ('${A}', 'E1', '2026-10', 52026, 52026, 62002.98)`);
    // a raise since October's payslip
    expect(await borrower(S1)).toMatchObject({ gross: 74784, net: null, pay_changed: true });
    await db.exec(`insert into salary_history (tenant_id, employee_id, pay_period, basic_salary, gross_pay, net_pay)
                   values ('${A}', 'E1', '2026-11', 74784, 74784, 84120)`);
    expect(await borrower(S1)).toMatchObject({ gross: 74784, net: 84120, pay_changed: false });
  });

  it('for the borrower and those who read loans only', async () => {
    expect(await borrower(HR)).toMatchObject({ gross: 74784 });
    await expect(read(S2, `select loan_form_borrower('${loanId}')`)).rejects.toThrow(/Loan not found/);
  });
});
