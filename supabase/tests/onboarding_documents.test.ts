// @vitest-environment node
//
// Onboarding, part 3 (20261012400000): which documents each employee must give, the files (uploaded by the employee
// only, reviewed by HR), referees, and how they hold up submitting and approving.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const U = {
  STAFF: '00000000-0000-0000-0000-00000000d101', // E-ME
  OTHER: '00000000-0000-0000-0000-00000000d102', // E-THEM
  HR: '00000000-0000-0000-0000-00000000d103',
  PAYROLL: '00000000-0000-0000-0000-00000000d104',
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
const idOf = async (n: string) => (await rows<{ id: string }>(`select id from employees where "Employee Number" = '${n}'`))[0].id;
const required = async (as: string, employee?: string) =>
  (await asUser(db, as, () => rows<{ code: string }>(`select code from document_checklist(${employee ? `'${employee}'` : ''}) where required order by sort`)))
    .map((r) => r.code);
const ids: Record<string, string> = {};
const upload = (code: string, folderUser = U.STAFF, employee = 'E-ME') =>
  `insert into employee_documents (employee_id, code, file_path, file_name)
   values ('${ids[employee]}', '${code}', '${A}/${folderUser}/onboarding/${code}.pdf', '${code}.pdf')`;
const CORE = ['id_document', 'passport_photo', 'kra_pin_certificate', 'nssf_document', 'sha_membership', 'helb_certificate', 'cv', 'academic_certificate'];

// everything the employee's details part needs, so only documents and referees are left
const DETAILS = `"Last Name" = 'Wanjiru', "First Name" = 'Amina', "Date of Birth" = '1994-02-01', "Gender" = 'Female',
  nationality = 'Kenyan', residential_address = 'Kilimani', "Personal Email" = 'amina@mail.co', "Type of Identification" = 'National ID',
  "ID Number" = '28123456', "Tax PIN" = 'A012345678Z', "SHIF Number" = 'CR1234567', "NSSF Number" = '2012345678',
  "Mobile Number" = '0712345678', kra_residency = 'Resident', is_pwd = false, kra_employee_type = 'Primary Employee',
  "Basic Salary" = 50000, payment_method = 'M-Pesa', "Job Title" = 'Accountant'`;

beforeAll(async () => {
  db = await bootLiveDb();
  for (const [id, email, role] of [[U.STAFF, 'me@a.co', 'STAFF'], [U.OTHER, 'them@a.co', 'STAFF'], [U.HR, 'hr@a.co', 'HR'], [U.PAYROLL, 'pay@a.co', 'PAYROLL']]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${A}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('STAFF', array['dashboard'], '${A}'), ('HR', array['employees'], '${A}'), ('PAYROLL', array['payroll'], '${A}');
    insert into employees ("Employee Number", "First Name", "Work Email", tenant_id) values
      ('E-ME', 'Amina', 'me@a.co', '${A}'), ('E-THEM', 'Otieno', 'them@a.co', '${A}');
    update employees set ${DETAILS} where "Employee Number" = 'E-ME';
    insert into emergency_contact ("Employee Number", full_name, relationship, phone_number, tenant_id) values ('E-ME', 'Halima', 'Sister', '0722000000', '${A}');
    insert into next_of_kin ("Employee Number", full_name, relationship, phone_number, tenant_id) values ('E-ME', 'Juma', 'Brother', '0744000000', '${A}');
  `);
  for (const n of ['E-ME', 'E-THEM']) ids[n] = await idOf(n);
}, 120000);

describe('which documents are required', () => {
  it('by default: the core attachments, CV and academic certificates', async () => {
    expect(await required(U.STAFF)).toEqual(CORE);
  });

  it('a company can turn a default off or another type on', async () => {
    await asUser(db, U.HR, () => run(`insert into company_document_settings (code, required) values ('helb_certificate', false), ('police_clearance', true)`));
    expect(await required(U.STAFF)).toEqual([...CORE.filter((c) => c !== 'helb_certificate'), 'police_clearance']);
    expect(await asUser(db, U.STAFF, () => run(`insert into company_document_settings (code, required) values ('cv', false)`))).toMatch(/row-level security/);
    await db.exec(`delete from company_document_settings`);
  });

  it('HR asks one employee for role-specific documents', async () => {
    const me = await idOf('E-ME');
    expect(await asUser(db, U.HR, () => run(`insert into employee_document_requirements (employee_id, code) values ('${me}', 'driving_licence')`))).toBe('');
    expect(await required(U.STAFF)).toContain('driving_licence');
    expect(await required(U.OTHER)).not.toContain('driving_licence');
    expect(await asUser(db, U.STAFF, () => run(`delete from employee_document_requirements`))).toBe('');
    expect(await required(U.STAFF)).toContain('driving_licence'); // staff can't remove HR's request
    await db.exec(`delete from employee_document_requirements`);
  });

  it('claim documents only while the claim is made', async () => {
    expect(await required(U.STAFF)).not.toContain('pwd_certificate');
    await db.exec(`update employees set is_pwd = true, "Disability Cert No" = 'PWD/1', mortgage_interest = 20000 where "Employee Number" = 'E-ME'`);
    expect(await required(U.STAFF)).toEqual(expect.arrayContaining(['pwd_certificate', 'mortgage_document']));
    expect(await required(U.STAFF)).not.toContain('insurance_document');
    await db.exec(`update employees set is_pwd = false, "Disability Cert No" = null, mortgage_interest = null where "Employee Number" = 'E-ME'`);
  });

  it('HR reads anyone’s checklist; staff only their own', async () => {
    const them = await idOf('E-THEM');
    expect(await required(U.HR, them)).toEqual(CORE);
    expect(await asUser(db, U.STAFF, () => run(`select * from document_checklist('${them}')`))).toMatch(/Only HR/);
  });
});

describe('files', () => {
  it('the employee uploads into their own folder, and the file waits for HR', async () => {
    expect(await asUser(db, U.STAFF, () => run(upload('cv')))).toBe('');
    const [d] = await rows<{ status: string; uploaded_by: string }>(`select status, uploaded_by from employee_documents where code = 'cv'`);
    expect(d).toEqual({ status: 'pending', uploaded_by: U.STAFF });
  });

  it('not into someone else’s folder, not for a colleague, and not already accepted', async () => {
    expect(await asUser(db, U.STAFF, () => run(upload('kra_pin_certificate', U.OTHER)))).toMatch(/your own folder/);
    expect(await asUser(db, U.STAFF, () => run(upload('cv', U.STAFF, 'E-THEM')))).toMatch(/row-level security/);
    await asUser(db, U.STAFF, () => run(`${upload('passport_photo')}`));
    expect((await rows(`select 1 from employee_documents where code = 'passport_photo' and status = 'pending'`)).length).toBe(1);
  });

  it('HR never uploads for an employee', async () => {
    expect(await asUser(db, U.HR, () => run(upload('id_document', U.HR)))).toMatch(/row-level security/);
  });

  it('nobody accepts a file by editing it; HR accepts, or rejects with a reason', async () => {
    const [{ id }] = await rows<{ id: string }>(`select id from employee_documents where code = 'cv'`);
    expect(await asUser(db, U.STAFF, () => run(`update employee_documents set status = 'accepted' where id = '${id}'`))).toBe(''); // filtered out by RLS
    expect(await asUser(db, U.STAFF, () => run(`select review_employee_document('${id}', 'accept')`))).toMatch(/Only HR/);
    expect(await asUser(db, U.PAYROLL, () => run(`select review_employee_document('${id}', 'accept')`))).toMatch(/Only HR/);
    expect(await asUser(db, U.HR, () => run(`select review_employee_document('${id}', 'reject', ' ')`))).toMatch(/Say why/);
    expect(await asUser(db, U.HR, () => run(`select review_employee_document('${id}', 'reject', 'Page 2 missing')`))).toBe('');
    expect(await rows(`select status, review_note, reviewed_by from employee_documents where id = '${id}'`))
      .toEqual([{ status: 'rejected', review_note: 'Page 2 missing', reviewed_by: U.HR }]);
  });

  it('the employee removes a file that is not accepted; an accepted one stays', async () => {
    const [{ id }] = await rows<{ id: string }>(`select id from employee_documents where code = 'passport_photo'`);
    await asUser(db, U.HR, () => run(`select review_employee_document('${id}', 'accept')`));
    expect(await asUser(db, U.STAFF, () => rows(`delete from employee_documents where id = '${id}' returning 1`))).toEqual([]);
    expect(await asUser(db, U.STAFF, () => rows(`delete from employee_documents where code = 'cv' returning 1`))).toHaveLength(1);
  });

  it('colleagues and payroll don’t see an employee’s documents; HR does', async () => {
    expect(await asUser(db, U.OTHER, () => rows(`select 1 from employee_documents`))).toEqual([]);
    expect(await asUser(db, U.PAYROLL, () => rows(`select 1 from employee_documents`))).toEqual([]);
    expect((await asUser(db, U.HR, () => rows(`select 1 from employee_documents`))).length).toBeGreaterThan(0);
  });
});

describe('referees', () => {
  it('the employee adds as many as they like, each with a phone or email', async () => {
    const me = await idOf('E-ME');
    expect(await asUser(db, U.STAFF, () => run(`insert into employee_referees (employee_id, full_name, organisation, position, phone, relationship)
      values ('${me}', 'Dr Mary Achieng', 'KCB', 'Manager', '0711000000', 'Former supervisor')`))).toBe('');
    expect(await asUser(db, U.STAFF, () => run(`insert into employee_referees (employee_id, full_name) values ('${me}', 'No Contact')`))).toMatch(/check/);
    const them = await idOf('E-THEM');
    expect(await asUser(db, U.STAFF, () => run(`insert into employee_referees (employee_id, full_name, phone) values ('${them}', 'X', '0700000000')`))).toMatch(/row-level security/);
  });

  it('HR reads them; colleagues don’t', async () => {
    expect(await asUser(db, U.HR, () => rows(`select full_name from employee_referees`))).toEqual([{ full_name: 'Dr Mary Achieng' }]);
    expect(await asUser(db, U.OTHER, () => rows(`select 1 from employee_referees`))).toEqual([]);
  });
});

describe('submitting and approving (documents can follow later: 20261013400000)', () => {
  const outstanding = async (as: string, employee?: string) =>
    (await asUser(db, as, () => rows<{ documents_outstanding: string[] }>(`select documents_outstanding from onboarding_missing_for(${employee ? `'${employee}'` : ''})`)))[0].documents_outstanding;

  it('missing documents don’t hold up submitting; they are listed as outstanding', async () => {
    expect(await asUser(db, U.STAFF, () => run(`select submit_onboarding()`))).toBe('');
    const left = await outstanding(U.STAFF);
    expect(left).toEqual(expect.arrayContaining(['Proof of identity', 'Updated CV', 'Academic certificates']));
    expect(left).not.toContain('Passport-size photograph'); // accepted above
  });

  it('say where each one is: waiting for HR, or rejected', async () => {
    await asUser(db, U.STAFF, () => run(upload('cv')));
    expect(await outstanding(U.STAFF)).toContain('Updated CV (waiting for HR)');
    const [{ id }] = await rows<{ id: string }>(`select id from employee_documents where code = 'cv' and status = 'pending'`);
    await asUser(db, U.HR, () => run(`select review_employee_document('${id}', 'reject', 'Blurry')`));
    expect(await outstanding(U.STAFF)).toContain('Updated CV (rejected, upload again)');
  });

  it('HR approves (so they are paid) with documents still outstanding, which stay listed', async () => {
    const me = await idOf('E-ME');
    expect(await asUser(db, U.HR, () => run(`select review_onboarding('${me}', 'approve')`))).toBe('');
    expect((await outstanding(U.HR, me)).length).toBeGreaterThan(0);
  });

  it('once accepted, a document is no longer outstanding', async () => {
    await asUser(db, U.STAFF, () => run(upload('id_document')));
    const [{ id }] = await rows<{ id: string }>(`select id from employee_documents where code = 'id_document' and status = 'pending'`);
    await asUser(db, U.HR, () => run(`select review_employee_document('${id}', 'accept')`));
    expect(await outstanding(U.STAFF)).not.toContain('Proof of identity');
  });

  it('the overview tells HR what each employee still needs, and their documents outstanding', async () => {
    const [them] = await asUser(db, U.HR, () => rows<{ employee_part: string[]; documents_outstanding: string[] }>(
      `select employee_part, documents_outstanding from onboarding_overview() where employee_number = 'E-THEM'`));
    expect(them.employee_part).toEqual(expect.arrayContaining(['Referee', 'Emergency contact']));
    expect(them.employee_part.some((m) => m.startsWith('Document'))).toBe(false);
    expect(them.documents_outstanding).toContain('Updated CV');
  });

  it('every file and referee change is in the audit log for HR', async () => {
    const tables = (await asUser(db, U.HR, () => rows<{ t: string }>(`select distinct table_name t from audit_log where table_name like 'employee_%' order by 1`))).map((r) => r.t);
    expect(tables).toEqual(expect.arrayContaining(['employee_documents', 'employee_referees']));
  });
});
