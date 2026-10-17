// @vitest-environment node
//
// Employee onboarding (20261012100000): formats and uniqueness of the details the KRA, SHA and NSSF returns need,
// generated payroll numbers, who may edit what, draft -> invited -> submitted -> approved, the audit log, and
// statutory rates with effective dates. Real migrations on a real Postgres (PGlite).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootDb, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const U = {
  STAFF: '00000000-0000-0000-0000-00000000f001', // E-ME
  HR: '00000000-0000-0000-0000-00000000f002',
  PAYROLL: '00000000-0000-0000-0000-00000000f003',
  OTHER_CO: '00000000-0000-0000-0000-00000000f004', // payroll in company B
};

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const one = async <T = Record<string, unknown>>(sql: string) => (await rows<T>(sql))[0];
/** Runs the statement in a transaction that is rolled back, and reports whether it worked. */
const attempt = async (sql: string) => {
  await db.exec('begin');
  try {
    await db.query(sql);
    return { ok: true as const, error: '' };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  } finally {
    await db.exec('rollback');
  }
};
/** Runs the statement for real and returns its error message, or '' when it worked. */
const run = async (sql: string) => {
  try {
    await db.query(sql);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const me = () => one<Record<string, unknown>>(`select * from employees where "Employee Number" = 'E-ME'`);
const meId = async () => (await me()).id as string;

// everything the employee's part of the form needs
const EMPLOYEE_PART = `"Last Name" = 'Wanjiru', "First Name" = 'Amina', "Middle Name" = 'Njeri', "Date of Birth" = '1994-02-01',
  "Gender" = 'Female', nationality = 'Kenyan', residential_address = 'Kilimani, Nairobi', "Personal Email" = 'amina@mail.co',
  "Type of Identification" = 'National ID', "ID Number" = '28123456', "Tax PIN" = 'A012345678Z', "SHIF Number" = 'CR1234567',
  "NSSF Number" = '2012345678', "Mobile Number" = '0712345678', kra_residency = 'Resident', is_pwd = false,
  "Bank" = 'KCB', "Bank Branch" = 'Moi Avenue', account_number_name = 'Amina Wanjiru', "Account Number" = '1234567890'`;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
  for (const [id, email, role, tenant] of [
    [U.STAFF, 'me@a.co', 'STAFF', A], [U.HR, 'hr@a.co', 'HR', A], [U.PAYROLL, 'pay@a.co', 'PAYROLL', A], [U.OTHER_CO, 'pay@b.co', 'PAYROLL', B],
  ]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${tenant}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('STAFF', array['dashboard'], '${A}'), ('HR', array['employees'], '${A}'), ('PAYROLL', array['payroll'], '${A}'),
      ('PAYROLL', array['payroll'], '${B}');
    insert into employees ("Employee Number", "First Name", "Work Email", "Job Title", "Basic Salary", payment_method, tenant_id) values
      ('E-ME', 'Amina', 'me@a.co', 'Accountant', 80000, 'Bank Transfer', '${A}'),
      ('E-THEM', 'Otieno', 'them@a.co', 'Driver', 40000, 'MPESA', '${A}'),
      ('E-FAR', 'Far', 'far@b.co', 'Clerk', 30000, 'MPESA', '${B}');
    -- these tests are about the details; documents and referees are tested in onboarding_documents.test.ts
    insert into company_document_settings (tenant_id, code, required) select '${A}', code, false from document_types;
  `);
}, 120000);

describe('formats', () => {
  const save = (set: string) => asUser(db, U.HR, () => attempt(`update employees set ${set} where "Employee Number" = 'E-THEM'`));
  const saved = async (set: string, column: string) =>
    asUser(db, U.HR, async () => {
      await db.exec('begin');
      try {
        await db.query(`update employees set ${set} where "Employee Number" = 'E-THEM'`);
        return (await one<Record<string, unknown>>(`select "${column}" v from employees where "Employee Number" = 'E-THEM'`)).v;
      } finally {
        await db.exec('rollback');
      }
    });

  it('stores the KRA PIN in upper case without spaces, and rejects one that is not an individual PIN', async () => {
    expect(await saved(`"Tax PIN" = ' a012 345678b '`, 'Tax PIN')).toBe('A012345678B');
    for (const pin of ['A12345678B', 'P051234567X', 'A0123456789', '12345678901']) {
      const r = await save(`"Tax PIN" = '${pin}'`);
      expect(r.ok, pin).toBe(false);
      expect(r.error).toMatch(/should look like A123456789B/);
    }
  });

  it('checks the ID number against its identity type (a national ID when none is given)', async () => {
    expect((await save(`"Type of Identification" = 'National ID', "ID Number" = '28123456'`)).ok).toBe(true);
    expect(await saved(`"Type of Identification" = 'Passport Number', "ID Number" = 'ak1234567'`, 'ID Number')).toBe('AK1234567');
    expect((await save(`"Type of Identification" = 'Alien ID', "ID Number" = '1234567'`)).ok).toBe(true);
    expect((await save(`"Type of Identification" = 'Refugee ID', "ID Number" = 'RCK-12345'`)).ok).toBe(true);
    expect((await save(`"Type of Identification" = 'National ID', "ID Number" = 'AB123'`)).error).toMatch(/not a valid National ID number/);
    // the older forms send a national ID number without a type
    expect(await saved(`"Type of Identification" = null, "ID Number" = '28123456'`, 'Type of Identification')).toBe('National ID');
    expect((await save(`"Type of Identification" = 'Driving licence', "ID Number" = '28123456'`)).ok).toBe(false);
  });

  it('accepts Kenyan and international phone numbers, without separators', async () => {
    expect(await saved(`"Mobile Number" = '0712 345-678'`, 'Mobile Number')).toBe('0712345678');
    for (const phone of ['0112345678', '254712345678', '+254712345678', '+447911123456']) {
      expect((await save(`"Mobile Number" = '${phone}'`)).ok, phone).toBe(true);
    }
    for (const phone of ['12345', '0812345678', '07123456789', '+0712345678']) {
      expect((await save(`"Mobile Number" = '${phone}'`)).error, phone).toMatch(/Phone number/);
    }
  });

  it('checks SHA and NSSF numbers', async () => {
    expect(await saved(`"NSSF Number" = '2012-345 678'`, 'NSSF Number')).toBe('2012345678');
    expect((await save(`"NSSF Number" = 'NS12345'`)).error).toMatch(/NSSF number/);
    // a check character X at the end is part of the number (20261012300000)
    expect(await saved(`"NSSF Number" = '206593059x'`, 'NSSF Number')).toBe('206593059X');
    expect((await save(`"NSSF Number" = '2065X3059'`)).error).toMatch(/NSSF number/);
    expect(await saved(`"SHIF Number" = 'cr 1234567'`, 'SHIF Number')).toBe('CR1234567');
    expect((await save(`"SHIF Number" = 'CR#1'`)).error).toMatch(/SHA number/);
  });

  it('only checks a value when it changes, so an old malformed value does not block other edits', async () => {
    await db.exec(`alter table employees disable trigger employees_onboarding_rules;
      update employees set "Tax PIN" = 'A111' where "Employee Number" = 'E-THEM';
      alter table employees enable trigger employees_onboarding_rules;`);
    expect((await save(`"Job Title" = 'Senior Driver'`)).ok).toBe(true);
    expect((await save(`"Tax PIN" = 'A112'`)).ok).toBe(false);
    await db.exec(`update employees set "Tax PIN" = null where "Employee Number" = 'E-THEM'`);
  });

  it('limits KRA type of employee, residency and onboarding status to their options, and amounts to zero or more', async () => {
    expect((await save(`kra_employee_type = 'Secondary Employee', kra_residency = 'Non-Resident'`)).ok).toBe(true);
    expect((await save(`kra_employee_type = 'Casual'`)).ok).toBe(false);
    expect((await save(`kra_residency = 'Kenyan'`)).ok).toBe(false);
    expect((await save(`car_benefit = -1`)).ok).toBe(false);
  });
});

describe('unique within a company', () => {
  beforeAll(async () => {
    await db.exec(`update employees set "Type of Identification" = 'National ID', "ID Number" = '11111111', "Tax PIN" = 'A111111111A',
      "SHIF Number" = 'CR1111111', "NSSF Number" = '111111111' where "Employee Number" = 'E-THEM'`);
  });

  it('refuses an ID, KRA PIN, SHA or NSSF number another employee of the company already has, without saying who', async () => {
    for (const [set, label] of [
      [`"Type of Identification" = 'National ID', "ID Number" = '11111111'`, 'ID number'],
      [`"Tax PIN" = 'a111111111a'`, 'KRA PIN'],
      [`"SHIF Number" = 'CR1111111'`, 'SHA number'],
      [`"NSSF Number" = '111111111'`, 'NSSF number'],
    ]) {
      const r = await asUser(db, U.STAFF, () => attempt(`update employees set ${set} where "Employee Number" = 'E-ME'`));
      expect(r.error, label).toMatch(new RegExp(`Another employee in this company already has ${label}`));
      expect(r.error).not.toMatch(/Otieno|E-THEM/);
    }
  });

  it('lets the same person be on another company’s payroll too', async () => {
    const r = await attempt(`update employees set "Tax PIN" = 'A111111111A', "NSSF Number" = '111111111' where "Employee Number" = 'E-FAR'`);
    expect(r.ok).toBe(true);
  });

  it('lets any number of employees leave them blank', async () => {
    expect((await attempt(`update employees set "Tax PIN" = '' where "Employee Number" in ('E-ME', 'E-THEM')`)).ok).toBe(true);
  });
});

describe('payroll numbers', () => {
  it('are generated per company and ignore what the form sends', async () => {
    const a = await rows<{ n: string; p: string }>(`select "Employee Number" n, "Payroll Number" p from employees where tenant_id = '${A}' order by 1`);
    expect(a).toEqual([{ n: 'E-ME', p: 'PR-00001' }, { n: 'E-THEM', p: 'PR-00002' }]);
    expect((await one<{ p: string }>(`select "Payroll Number" p from employees where "Employee Number" = 'E-FAR'`)).p).toBe('PR-00001');

    await asUser(db, U.HR, async () => {
      await db.exec('begin');
      try {
        await db.query(`insert into employees ("Employee Number", "First Name", "Payroll Number") values ('E-NEW', 'New', 'MY-OWN')`);
        expect((await one<{ p: string }>(`select "Payroll Number" p from employees where "Employee Number" = 'E-NEW'`)).p).toBe('PR-00003');
      } finally {
        await db.exec('rollback');
      }
    });
  });

  it('cannot be edited', async () => {
    await asUser(db, U.HR, async () => {
      await db.exec('begin');
      try {
        await db.query(`update employees set "Payroll Number" = 'PR-99999' where "Employee Number" = 'E-ME'`);
        expect((await one<{ p: string }>(`select "Payroll Number" p from employees where "Employee Number" = 'E-ME'`)).p).toBe('PR-00001');
      } finally {
        await db.exec('rollback');
      }
    });
  });
});

describe('who edits what', () => {
  it('HR enters employment and pay details; the employee cannot', async () => {
    for (const set of [`kra_employee_type = 'Primary Employee'`, `car_benefit = 1`, `meals_benefit = 1`, `non_cash_benefit = 1`,
      `housing_benefit = 1`, `other_benefits = 1`, `other_cash_allowances = 1`, `house_allowance = 1`, `other_pension_contribution = 1`,
      `post_retirement_medical_fund = 1`, `nssf_voluntary_contribution = 1`, `"Pension Deduction" = '1'`, `"Employee AVC" = '1'`,
      `"Tax Exempted" = 'Yes'`, `"NITA" = '1'`, `"Basic Salary" = 1`, `payment_method = 'Cash'`, `onboarding_status = 'approved'`]) {
      expect((await asUser(db, U.STAFF, () => attempt(`update employees set ${set} where "Employee Number" = 'E-ME'`))).ok, set).toBe(false);
      expect((await asUser(db, U.HR, () => attempt(`update employees set ${set} where "Employee Number" = 'E-ME'`))).ok, set)
        .toBe(!set.startsWith('onboarding_status'));
    }
  });

  it('the employee fills in their personal, statutory, claims and bank details', async () => {
    const r = await asUser(db, U.STAFF, () => attempt(`update employees set ${EMPLOYEE_PART}, preferred_name = 'Ami',
      permanent_address = 'Nyeri', mortgage_interest = 20000, insurance_premium = 3000, bank_code = '01', branch_code = '01091',
      bank_paybill = '522522' where "Employee Number" = 'E-ME'`));
    expect(r).toEqual({ ok: true, error: '' });
  });
});

describe('onboarding', () => {
  const submit = (as: string, id = '') => asUser(db, as, () => run(`select submit_onboarding(${id ? `'${id}'` : ''})`));
  const review = async (as: string, decision: string, comment: string | null = null) => {
    const id = await meId();
    return asUser(db, as, () => run(`select review_onboarding('${id}', '${decision}', ${comment === null ? 'null' : `'${comment}'`})`));
  };
  const status = async () => (await me()).onboarding_status;
  const history = async () =>
    (await rows<{ action: string }>(`select action from employee_onboarding_reviews where employee_id = '${await meId()}' order by created_at, action`)).map((r) => r.action);

  it('starts as a draft; HR marks it invited', async () => {
    expect(await status()).toBe('draft');
    expect(await asUser(db, U.STAFF, async () => run(`select start_onboarding('${await meId()}')`))).toMatch(/Only HR/);
    expect(await asUser(db, U.HR, async () => run(`select start_onboarding('${await meId()}')`))).toBe('');
    expect(await status()).toBe('invited');
  });

  it('cannot be submitted while the employee’s part is incomplete, and says what is missing', async () => {
    const error = await submit(U.STAFF);
    expect(error).toMatch(/Still missing: Surname, First name|Still missing: Surname/);
    for (const item of ['KRA PIN', 'SHA number', 'NSSF number', 'Residency', 'Disability \\(PWD\\) status', 'Emergency contact', 'Next of kin']) {
      expect(error).toMatch(new RegExp(item));
    }
  });

  it('needs the exemption certificate when the employee is a person with a disability', async () => {
    expect(await asUser(db, U.STAFF, () => run(`update employees set ${EMPLOYEE_PART.replace('is_pwd = false', 'is_pwd = true')} where "Employee Number" = 'E-ME'`))).toBe('');
    expect(await submit(U.STAFF)).toMatch(/Exemption certificate number/);
    await asUser(db, U.STAFF, () => run(`update employees set "Disability Cert No" = 'PWD/123/2024' where "Employee Number" = 'E-ME'`));
    expect(await submit(U.STAFF)).not.toMatch(/Exemption certificate/);
    // the exemption also needs its certificate uploaded (onboarding_documents.test.ts); back to no claim
    await asUser(db, U.STAFF, () => run(`update employees set is_pwd = false where "Employee Number" = 'E-ME'`));
  });

  it('needs bank details only from someone paid by bank', async () => {
    await asUser(db, U.STAFF, () => run(`update employees set "Account Number" = '' where "Employee Number" = 'E-ME'`));
    expect(await submit(U.STAFF)).toMatch(/Account number/);
    await asUser(db, U.STAFF, () => run(`update employees set "Account Number" = '1234567890' where "Employee Number" = 'E-ME'`));
  });

  it('is submitted once the employee’s part, an emergency contact and a next of kin are in', async () => {
    expect(await asUser(db, U.STAFF, () => run(`insert into emergency_contact ("Employee Number", full_name, relationship, phone_number, alternative_phone, physical_address)
      values ('E-ME', 'Halima Wanjiru', 'Sister', '0722000000', '0733000000', 'Thika')`))).toBe('');
    expect(await submit(U.STAFF)).toMatch(/Still missing: Next of kin, Referee$/);
    expect(await asUser(db, U.STAFF, () => run(`insert into next_of_kin ("Employee Number", full_name, relationship, phone_number, physical_address)
      values ('E-ME', 'Juma Wanjiru', 'Brother', '0744000000', 'Nakuru')`))).toBe('');
    expect(await submit(U.STAFF)).toMatch(/Still missing: Referee$/);
    expect(await asUser(db, U.STAFF, async () => run(`insert into employee_referees (employee_id, full_name, phone)
      values ('${await meId()}', 'Dr Mary Achieng', '0711000000')`))).toBe('');
    expect(await submit(U.STAFF)).toBe('');
    expect(await status()).toBe('submitted');
    expect((await me()).onboarding_submitted_at).not.toBeNull();
    expect(await submit(U.STAFF)).toMatch(/already submitted/);
  });

  it('only HR reviews, and HR cannot approve until its own part is complete', async () => {
    expect(await review(U.STAFF, 'approve')).toMatch(/Only HR/);
    expect(await review(U.PAYROLL, 'approve')).toMatch(/Only HR/);
    expect(await review(U.HR, 'approve')).toMatch(/Still missing: Type of employee/);
  });

  it('sends a record back only with a comment, which the employee sees', async () => {
    expect(await review(U.HR, 'request_changes', '  ')).toMatch(/Say what needs changing/);
    expect(await review(U.HR, 'request_changes', 'Upload a clearer KRA PIN')).toBe('');
    expect(await status()).toBe('changes_requested');
    expect((await me()).onboarding_review_comment).toBe('Upload a clearer KRA PIN');
    const seen = await asUser(db, U.STAFF, () => rows<{ action: string; comment: string }>(
      `select action, comment from employee_onboarding_reviews where action = 'changes_requested'`));
    expect(seen).toEqual([{ action: 'changes_requested', comment: 'Upload a clearer KRA PIN' }]);
  });

  it('is approved once resubmitted and HR has filled its part', async () => {
    expect(await submit(U.STAFF)).toBe('');
    await asUser(db, U.HR, () => run(`update employees set kra_employee_type = 'Primary Employee' where "Employee Number" = 'E-ME'`));
    expect(await review(U.HR, 'approve', 'All good')).toBe('');
    const e = await me();
    expect(e).toMatchObject({ onboarding_status: 'approved', onboarding_reviewed_by: U.HR });
    expect(await history()).toEqual(['invited', 'submitted', 'changes_requested', 'submitted', 'approved']);
  });

  it('nobody moves it by editing the status directly', async () => {
    expect((await asUser(db, U.HR, () => attempt(`update employees set onboarding_status = 'draft' where "Employee Number" = 'E-ME'`))).error)
      .toMatch(/submitting or reviewing/);
  });

  it('goes back to HR when the employee changes a detail the returns or payments use', async () => {
    await asUser(db, U.STAFF, () => run(`update employees set "Personal Email" = 'amina@new.co', preferred_name = 'Mina' where "Employee Number" = 'E-ME'`));
    expect(await status()).toBe('approved');
    await asUser(db, U.STAFF, () => run(`update employees set "Account Number" = '9999999999' where "Employee Number" = 'E-ME'`));
    expect(await status()).toBe('submitted');
    const [last] = await rows<{ action: string; changed_fields: string[]; actor: string }>(
      `select action, changed_fields, actor from employee_onboarding_reviews order by created_at desc limit 1`);
    expect(last).toEqual({ action: 'resubmitted', changed_fields: ['Account Number'], actor: U.STAFF });
  });

  it('HR changes do not send it back', async () => {
    expect(await review(U.HR, 'approve')).toBe('');
    await asUser(db, U.HR, () => run(`update employees set "Basic Salary" = 90000, "Tax PIN" = 'A012345678Y' where "Employee Number" = 'E-ME'`));
    expect(await status()).toBe('approved');
  });
});

describe('audit log', () => {
  it('records each change to an employee record: only the changed fields, who and when', async () => {
    await asUser(db, U.HR, () => run(`update employees set "Job Title" = 'Senior Accountant' where "Employee Number" = 'E-ME'`));
    const [row] = await rows<{ old_data: object; new_data: object; performed_by: string; action_type: string; record_key: string }>(
      `select old_data, new_data, performed_by, action_type, record_key from audit_log
       where table_name = 'employees' and new_data ? 'Job Title' order by performed_at desc limit 1`);
    // (the job title link, job_title_id from 20261019300000, follows the text and is recorded with it)
    expect(row).toEqual({ old_data: { 'Job Title': 'Accountant', job_title_id: expect.any(String) },
      new_data: { 'Job Title': 'Senior Accountant', job_title_id: expect.any(String) },
      performed_by: U.HR, action_type: 'UPDATE', record_key: 'E-ME' });
  });

  it('records emergency contacts and next of kin too', async () => {
    const n = await rows<{ t: string }>(`select table_name t from audit_log where table_name in ('emergency_contact', 'next_of_kin') and action_type = 'INSERT' order by 1`);
    expect(n.map((r) => r.t)).toEqual(['emergency_contact', 'next_of_kin']);
  });

  it('next of kin: the employee sees only their own, HR sees everyone’s', async () => {
    expect((await asUser(db, U.HR, () => rows(`select 1 from next_of_kin`))).length).toBe(1);
    expect(await asUser(db, U.PAYROLL, () => rows(`select 1 from next_of_kin`))).toEqual([]);
    expect((await asUser(db, U.STAFF, () => attempt(`insert into next_of_kin ("Employee Number", full_name, relationship, phone_number)
      values ('E-THEM', 'X', 'Y', '0700000000')`))).ok).toBe(false);
  });

  it('HR reads it; staff and payroll do not; nobody edits it', async () => {
    expect((await asUser(db, U.HR, () => rows(`select 1 from audit_log where table_name = 'employees'`))).length).toBeGreaterThan(0);
    expect(await asUser(db, U.STAFF, () => rows(`select 1 from audit_log`))).toEqual([]);
    expect(await asUser(db, U.PAYROLL, () => rows(`select 1 from audit_log`))).toEqual([]);
    expect(await asUser(db, U.HR, () => rows(`update audit_log set new_data = '{}' returning 1`))).toEqual([]);
    expect(await asUser(db, U.HR, () => rows(`delete from audit_log returning 1`))).toEqual([]);
    expect((await asUser(db, U.HR, () => attempt(`insert into audit_log (table_name, action_type) values ('employees', 'FAKE')`))).ok).toBe(false);
  });
});

describe('statutory rates', () => {
  const ratesOn = (as: string, day: string) =>
    asUser(db, as, async () => (await one<{ r: Record<string, unknown> }>(`select statutory_rates_on('${day}') r`)).r);

  it('gives the rates in force on a day', async () => {
    const before = await ratesOn(U.STAFF, '2025-06-30');
    expect(before).toMatchObject({ nssf_lower_limit: 8000, nssf_upper_limit: 72000, personal_relief: 2400, shif_rate: 0.0275 });
    const after = await ratesOn(U.STAFF, '2026-02-01');
    expect(after).toMatchObject({ nssf_lower_limit: 9000, nssf_upper_limit: 108000 });
    expect((after.paye_bands as { rate: number }[]).map((b) => b.rate)).toEqual([0.1, 0.25, 0.3, 0.325, 0.35]);
  });

  it('lets payroll give its company its own rate from a date, which other companies do not see', async () => {
    expect(await asUser(db, U.PAYROLL, () => run(`insert into statutory_rates (tenant_id, code, value, effective_from)
      values ('${A}', 'personal_relief', 2500, '2026-07-01')`))).toBe('');
    expect((await ratesOn(U.STAFF, '2026-06-30')).personal_relief).toBe(2400);
    expect((await ratesOn(U.STAFF, '2026-07-01')).personal_relief).toBe(2500);
    expect((await ratesOn(U.OTHER_CO, '2026-07-01')).personal_relief).toBe(2400);
    expect(await asUser(db, U.OTHER_CO, () => rows(`select 1 from statutory_rates where tenant_id = '${A}'`))).toEqual([]);
  });

  it('refuses two rates for the same code and company that overlap in time', async () => {
    expect(await asUser(db, U.PAYROLL, () => run(`insert into statutory_rates (tenant_id, code, value, effective_from, effective_to)
      values ('${A}', 'personal_relief', 2600, '2026-01-01', '2026-12-31')`))).toMatch(/already has a rate/);
  });

  it('nobody but migrations changes the defaults; staff change nothing', async () => {
    expect(await asUser(db, U.PAYROLL, () => rows(`update statutory_rates set value = 0 where tenant_id is null returning 1`))).toEqual([]);
    expect((await asUser(db, U.PAYROLL, () => attempt(`insert into statutory_rates (code, value, effective_from) values ('x', 1, '2030-01-01')`))).ok).toBe(false);
    expect((await asUser(db, U.STAFF, () => attempt(`insert into statutory_rates (tenant_id, code, value, effective_from)
      values ('${A}', 'personal_relief', 9999, '2030-01-01')`))).ok).toBe(false);
  });
});

describe('records that existed before onboarding', () => {
  let old: PGlite;
  beforeAll(async () => {
    old = await bootDb({
      file: '20261012100000_employee_onboarding.sql',
      seed: (d) => d.exec(`
        insert into employees ("Employee Number", "First Name", "Tax PIN", "ID Number", "Type of Identification", "NHIF Number",
          "SHIF Number", "NSSF Number", house_allowance, travel_allowance, "Payroll Number", "Mobile Number", created_at, tenant_id) values
          ('OLD-1', 'First',  ' a012345678b ', 28123456, null,       'NH-1', null,     '2012-345', 'KSh 5,000', 'n/a', 'P-7', '0712 345 678', '2024-01-01', '${A}'),
          ('OLD-2', 'Second', 'A012345678B',   28123456, 'passport', null,   'CR-9',   '2012345',  '1500.50',   null,  'P-7', null,           '2024-02-01', '${A}'),
          ('OLD-3', 'Third',  null,            null,     null,       null,   null,     null,       null,        null,  null,  null,           '2024-03-01', '${A}');
      `),
    });
  }, 120000);
  const get = async (n: string) => (await old.query<Record<string, unknown>>(`select * from employees where "Employee Number" = '${n}'`)).rows[0];

  it('tidies identifiers, fills an empty SHA number from the NHIF number, and names the identity type', async () => {
    expect(await get('OLD-1')).toMatchObject({ 'Tax PIN': 'A012345678B', 'ID Number': '28123456', 'SHIF Number': 'NH-1',
      'NSSF Number': '2012345', 'Mobile Number': '0712345678', 'Type of Identification': 'National ID', onboarding_status: 'draft' });
    expect((await get('OLD-2'))['Type of Identification']).toBe('Passport Number');
  });

  it('turns allowances into amounts', async () => {
    expect(await get('OLD-1')).toMatchObject({ house_allowance: '5000.00', travel_allowance: null });
    expect((await get('OLD-2')).house_allowance).toBe('1500.50');
  });

  it('keeps a shared number on the earliest record, clears it on the others and logs what was cleared', async () => {
    expect(await get('OLD-2')).toMatchObject({ 'Tax PIN': null, 'ID Number': null, 'NSSF Number': null });
    const cleared = (await old.query<{ k: string; d: object }>(
      `select record_key k, old_data d from audit_log where action_type = 'MIGRATION_CLEARED_DUPLICATE' order by 2::text`)).rows;
    expect(cleared.map((c) => c.d)).toEqual(expect.arrayContaining([{ 'Tax PIN': 'A012345678B' }, { 'ID Number': '28123456' },
      { 'NSSF Number': '2012345' }, { 'Payroll Number': 'P-7' }]));
  });

  it('gives every record a unique payroll number', async () => {
    const p = (await old.query<{ n: string; p: string }>(`select "Employee Number" n, "Payroll Number" p from employees order by 1`)).rows;
    expect(p).toEqual([{ n: 'OLD-1', p: 'P-7' }, { n: 'OLD-2', p: 'PR-00001' }, { n: 'OLD-3', p: 'PR-00002' }]);
  });
});
