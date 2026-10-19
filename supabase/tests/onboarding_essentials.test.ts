// @vitest-environment node
//
// Onboarding essentials (20261021700000): the employee submits and HR approves once the essentials are in; documents,
// referees, policies and the other items can follow later, listed as "still to provide" with HR's due dates and
// reminders. The company chooses what is essential (all of it = all or nothing). Approved still means payable.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const U = {
  STAFF: '00000000-0000-0000-0000-00000000e101', // E-ME, Kenya
  TWO: '00000000-0000-0000-0000-00000000e102', // E-TWO, Kenya
  TZ: '00000000-0000-0000-0000-00000000e103', // E-TZ, Dar es Salaam
  UG: '00000000-0000-0000-0000-00000000e104', // E-UG, Kampala
  HR: '00000000-0000-0000-0000-00000000e105',
  PAYROLL: '00000000-0000-0000-0000-00000000e106',
  HR_B: '00000000-0000-0000-0000-00000000e107', // HR in company B
};
const MIGRATION = join(__dirname, '..', 'migrations', '20261021700000_onboarding_essentials.sql');

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
const ids: Record<string, string> = {};
const idOf = async (n: string) => (await rows<{ id: string }>(`select id from employees where "Employee Number" = '${n}'`))[0].id;
const status = async (n: string) => (await rows<{ s: string }>(`select onboarding_status s from employees where "Employee Number" = '${n}'`))[0].s;
const submit = (as: string) => asUser(db, as, () => run(`select submit_onboarding()`));
const approve = (n: string, as = U.HR) => asUser(db, as, () => run(`select review_onboarding('${ids[n]}', 'approve')`));
const followups = async (n: string) =>
  rows<{ item_key: string; item: string; note: string | null; due_date: string | null; overdue: boolean }>(
    `select item_key, item, note, due_date::text, overdue from employees e, onboarding_followups(e) where e."Employee Number" = '${n}'`);
const items = async (n: string) => (await followups(n)).map((f) => f.item);
const essentials = async (n: string, part = 'all') =>
  (await rows<{ m: string[] }>(`select onboarding_essentials_missing(e, '${part}') m from employees e where "Employee Number" = '${n}'`))[0].m;
const saveSettings = (as: string, keys: string, days = 'null') => asUser(db, as, () => run(`select save_onboarding_settings(${keys}, ${days})`));
const remind = async (dayOffset: number) =>
  (await rows<{ n: number }>(`select run_onboarding_followup_reminders(current_date + ${dayOffset}) n`))[0].n;
const notices = async (type: string, n: string) =>
  rows<{ message: string }>(`select message from hr_notifications where notification_type = '${type}' and employee_number = '${n}' order by id`);
const upload = (code: string, user: string, n: string) =>
  `insert into employee_documents (employee_id, code, file_path, file_name) values ('${ids[n]}', '${code}', '${A}/${user}/onboarding/${code}.pdf', '${code}.pdf')`;

// the default essentials, Kenya: names, date of birth, phone, ID, KRA PIN, NSSF and SHA numbers (next of kin added below)
const KENYA_ESSENTIALS = `"Last Name" = 'Wanjiru', "Date of Birth" = '1994-02-01', "Mobile Number" = '0712345678',
  "Type of Identification" = 'National ID', "ID Number" = '28123456', "Tax PIN" = 'A012345678Z', "SHIF Number" = 'CR1234567',
  "NSSF Number" = '2012345678'`;
// HR's part (always needed); paid by M-Pesa, so no bank details
const HR_PART = `"Job Title" = 'Clerk', kra_employee_type = 'Primary Employee', "Basic Salary" = 50000, payment_method = 'M-Pesa'`;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
  for (const [id, email, role, tenant] of [
    [U.STAFF, 'me@a.co', 'STAFF', A], [U.TWO, 'two@a.co', 'STAFF', A], [U.TZ, 'tz@a.co', 'STAFF', A], [U.UG, 'ug@a.co', 'STAFF', A],
    [U.HR, 'hr@a.co', 'HR', A], [U.PAYROLL, 'pay@a.co', 'PAYROLL', A], [U.HR_B, 'hr@b.co', 'HR', B],
  ]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${tenant}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('STAFF', array['dashboard'], '${A}'), ('HR', array['employees'], '${A}'), ('PAYROLL', array['payroll'], '${A}'),
      ('HR', array['employees'], '${B}');
    insert into branches (tenant_id, name, country) values ('${A}', 'Dar es Salaam', 'Tanzania'), ('${A}', 'Kampala', 'Uganda');
    insert into employees ("Employee Number", "First Name", "Work Email", "Branch", tenant_id) values
      ('E-ME', 'Amina', 'me@a.co', null, '${A}'), ('E-TWO', 'Brian', 'two@a.co', null, '${A}'),
      ('E-THREE', 'Chao', 'three@a.co', null, '${A}'),
      ('E-TZ', 'Neema', 'tz@a.co', 'Dar es Salaam', '${A}'), ('E-UG', 'Akello', 'ug@a.co', 'Kampala', '${A}'),
      ('E-FAR', 'Far', 'far@b.co', null, '${B}');
    update employees set ${KENYA_ESSENTIALS}, ${HR_PART} where "Employee Number" = 'E-ME';
    update employees set ${KENYA_ESSENTIALS.replace("'28123456'", "'28123457'").replace("'A012345678Z'", "'A012345679Z'")
      .replace("'CR1234567'", "'CR1234568'").replace("'2012345678'", "null")}, "Job Title" = 'Driver' where "Employee Number" = 'E-TWO';
    update employees set ${KENYA_ESSENTIALS.replace("'28123456'", "'28123458'").replace("'A012345678Z'", "'A012345670Z'")
      .replace("'CR1234567'", "'CR1234569'").replace("'2012345678'", "'2012345670'")}, ${HR_PART} where "Employee Number" = 'E-THREE';
    insert into next_of_kin ("Employee Number", full_name, relationship, phone_number, tenant_id) values
      ('E-ME', 'Juma', 'Brother', '0744000000', '${A}'), ('E-TWO', 'Jane', 'Sister', '0744000001', '${A}'),
      ('E-THREE', 'Joy', 'Sister', '0744000002', '${A}'), ('E-TZ', 'Baraka', 'Brother', '0744000003', '${A}'),
      ('E-UG', 'Okello', 'Brother', '0744000004', '${A}');
  `);
  // a policy every employee must accept
  await asUser(db, U.HR, async () => {
    const [{ id }] = await rows<{ id: string }>(`insert into company_policies (title) values ('Code of conduct') returning id`);
    await db.exec(`insert into company_policy_versions (policy_id, body) values ('${id}', 'Be honest.')`);
  });
  for (const n of ['E-ME', 'E-TWO', 'E-THREE', 'E-TZ', 'E-UG', 'E-FAR']) ids[n] = await idOf(n);
}, 120000);

describe('approving with the essentials', () => {
  it('the employee submits with only the essentials, while documents, referees and policies are outstanding', async () => {
    expect(await essentials('E-ME', 'employee')).toEqual([]);
    expect(await submit(U.STAFF)).toBe('');
    expect(await status('E-ME')).toBe('submitted');
  });

  it('HR approves it, and what can follow later stays listed', async () => {
    expect(await approve('E-ME')).toBe('');
    expect(await status('E-ME')).toBe('approved');
    const left = await items('E-ME');
    expect(left).toEqual(expect.arrayContaining(['Sex', 'Nationality', 'Emergency contact', 'Referee', 'Agreement: Code of conduct',
      'Document: Updated CV', 'Document: Proof of identity']));
    expect(left).not.toContain('NSSF number');
    // onboarding_missing still returns everything, for display
    const all = (await rows<{ m: string[] }>(`select onboarding_missing(e, 'employee') m from employees e where "Employee Number" = 'E-ME'`))[0].m;
    expect(all).toEqual(expect.arrayContaining(['Referee', 'Agreement: Code of conduct', 'Sex']));
  });

  it('a missing essential still blocks submitting, and HR’s part still blocks approving', async () => {
    expect(await submit(U.TWO)).toBe('Still missing: NSSF number');
    await db.exec(`update employees set "NSSF Number" = '2012345671' where "Employee Number" = 'E-TWO'`);
    expect(await submit(U.TWO)).toBe('');
    expect(await approve('E-TWO')).toMatch(/^Still missing: Type of employee, Basic salary, Payment method$/);
    expect(await status('E-TWO')).toBe('submitted');
  });

  it('only HR approves, and only a submitted record', async () => {
    expect(await approve('E-TWO', U.STAFF)).toMatch(/Only HR/);
    expect(await approve('E-ME')).toMatch(/Only a submitted record/);
  });

  it('the screens get the essentials and the follow-ups separately', async () => {
    const [mine] = await asUser(db, U.STAFF, () => rows<{ essentials_employee: string[]; essentials_employer: string[]; followups: { item: string }[] }>(
      `select essentials_employee, essentials_employer, followups from onboarding_missing_for()`));
    expect(mine.essentials_employee).toEqual([]);
    expect(mine.essentials_employer).toEqual([]);
    expect(mine.followups.map((f) => f.item)).toContain('Referee');
    const overview = await asUser(db, U.HR, () => rows<{ employee_number: string; essentials_missing: string[]; followups: string[]; followups_overdue: number }>(
      `select employee_number, essentials_missing, followups, followups_overdue from onboarding_overview() where employee_number in ('E-ME', 'E-TWO') order by 1`));
    expect(overview[0].employee_number).toBe('E-ME');
    expect(overview[0].essentials_missing).toEqual([]);
    expect(overview[0].followups).toContain('Referee');
    expect(overview[0].followups_overdue).toBe(0);
    expect(overview[1].essentials_missing).toEqual(['Type of employee', 'Basic salary', 'Payment method']);
  });
});

describe('the company decides what is essential', () => {
  it('Settings lists every item, the default essentials, and what payroll needs', async () => {
    const s = (await asUser(db, U.STAFF, () => rows<{ s: { reminder_every_days: number; items: { item_key: string; essential: boolean; payroll_note: string | null }[] } }>(
      `select onboarding_settings() s`)))[0].s;
    expect(s.reminder_every_days).toBe(7);
    expect(s.items.filter((i) => i.essential).map((i) => i.item_key)).toEqual(
      ['full_name', 'date_of_birth', 'phone_number', 'identity', 'tax_number', 'nssf_number', 'sha_number', 'bank_account', 'next_of_kin']);
    expect(s.items.find((i) => i.item_key === 'tax_number')?.payroll_note).toMatch(/PAYE/);
  });

  it('only HR changes it, with known items and a sensible interval', async () => {
    expect(await saveSettings(U.STAFF, `array['full_name']`)).toMatch(/Only HR/);
    expect(await saveSettings(U.PAYROLL, `array['full_name']`)).toMatch(/Only HR/);
    expect(await saveSettings(U.HR, `array['full_name', 'shoe_size']`)).toMatch(/Unknown onboarding item "shoe_size"/);
    expect(await saveSettings(U.HR, `onboarding_default_essentials()`, '0')).toMatch(/1 to 90 days/);
    expect(await asUser(db, U.HR, () => run(`insert into company_onboarding_settings (essential_items) values ('{}')`))).toMatch(/permission denied|row-level security/);
  });

  it('ticking everything makes it all or nothing again', async () => {
    expect(await saveSettings(U.HR, `(select array_agg(item_key) from onboarding_item_catalogue())`)).toBe('');
    const error = await asUser(db, U.HR, () => run(`select submit_onboarding('${ids['E-THREE']}')`));
    for (const item of ['Sex', 'Emergency contact', 'Referee', 'Agreement: Code of conduct', 'Document: Proof of identity']) {
      expect(error).toContain(item);
    }
    expect(await items('E-THREE')).toEqual([]); // nothing can follow later
  });

  it('unticking an item makes it optional', async () => {
    expect(await saveSettings(U.HR, `array['full_name', 'date_of_birth', 'phone_number', 'identity', 'tax_number', 'sha_number', 'bank_account', 'next_of_kin']`)).toBe('');
    await db.exec(`update employees set "NSSF Number" = null where "Employee Number" = 'E-THREE'`);
    expect(await essentials('E-THREE', 'employee')).toEqual([]);
    expect(await items('E-THREE')).toContain('NSSF number');
    // back to the default
    expect(await saveSettings(U.HR, `onboarding_default_essentials()`)).toBe('');
    expect(await essentials('E-THREE', 'employee')).toEqual(['NSSF number']);
    await db.exec(`update employees set "NSSF Number" = '2012345670' where "Employee Number" = 'E-THREE'`);
  });

  it('when documents are essential, approving needs each one accepted', async () => {
    await saveSettings(U.HR, `onboarding_default_essentials() || array['documents']`);
    await db.exec(`insert into company_document_settings (tenant_id, code, required) select '${A}', code, code = 'cv' from document_types`);
    expect(await essentials('E-THREE', 'employee')).toEqual(['Document: Updated CV']);
    // uploaded: the employee can submit; HR has to review it before approving
    await db.exec(`insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000e108', 'three@a.co');
      insert into user_profiles (user_id, email, role, tenant_id) values ('00000000-0000-0000-0000-00000000e108', 'three@a.co', 'STAFF', '${A}')`);
    expect(await asUser(db, '00000000-0000-0000-0000-00000000e108', () => run(upload('cv', '00000000-0000-0000-0000-00000000e108', 'E-THREE')))).toBe('');
    expect(await essentials('E-THREE', 'employee')).toEqual([]);
    expect(await essentials('E-THREE', 'employer')).toEqual(['Review document: Updated CV']);
    await db.exec(`delete from company_document_settings where tenant_id = '${A}'; delete from employee_documents where employee_id = '${ids['E-THREE']}'`);
    await saveSettings(U.HR, `onboarding_default_essentials()`);
  });
});

  // (the KRA PIN certificate: one file. Proof of identity takes the front and the back since 20261022000000_document_parts)
describe('follow-ups after approval', () => {
  it('providing them never sends the record back', async () => {
    await asUser(db, U.STAFF, () => run(`update employees set "Gender" = 'Female', nationality = 'Kenyan', residential_address = 'Kilimani',
      "Personal Email" = 'amina@mail.co', kra_residency = 'Resident', is_pwd = false where "Employee Number" = 'E-ME'`));
    expect(await asUser(db, U.STAFF, () => run(`insert into employee_referees (employee_id, full_name, phone) values ('${ids['E-ME']}', 'Dr Mary', '0711000000')`))).toBe('');
    expect(await asUser(db, U.STAFF, () => run(`insert into emergency_contact ("Employee Number", full_name, relationship, phone_number) values ('E-ME', 'Halima', 'Sister', '0722000000')`))).toBe('');
    const [{ version_id }] = await asUser(db, U.STAFF, () => rows<{ version_id: string }>(`select version_id from policy_checklist()`));
    expect(await asUser(db, U.STAFF, () => run(`select accept_policy('${version_id}')`))).toBe('');
    expect(await asUser(db, U.STAFF, () => run(upload('kra_pin_certificate', U.STAFF, 'E-ME')))).toBe('');
    expect(await status('E-ME')).toBe('approved');
    expect(await rows(`select 1 from employee_onboarding_reviews where employee_id = '${ids['E-ME']}' and action = 'resubmitted'`)).toEqual([]);
    const left = await followups('E-ME');
    expect(left.map((f) => f.item)).not.toContain('Sex');
    expect(left.map((f) => f.item)).not.toContain('Referee');
    expect(left.map((f) => f.item)).not.toContain('Agreement: Code of conduct');
    expect(left.find((f) => f.item === 'Document: KRA PIN certificate')?.note).toBe('waiting for HR');
  });

  it('HR reviews the document itself, as before, and the record stays approved', async () => {
    const [{ id }] = await rows<{ id: string }>(`select id from employee_documents where employee_id = '${ids['E-ME']}' and code = 'kra_pin_certificate'`);
    expect(await asUser(db, U.HR, () => run(`select review_employee_document('${id}', 'reject', 'Blurry')`))).toBe('');
    expect((await followups('E-ME')).find((f) => f.item === 'Document: KRA PIN certificate')?.note).toBe('rejected, upload again');
    await asUser(db, U.STAFF, () => run(upload('kra_pin_certificate', U.STAFF, 'E-ME')));
    const [{ id: again }] = await rows<{ id: string }>(`select id from employee_documents where employee_id = '${ids['E-ME']}' and code = 'kra_pin_certificate' and status = 'pending'`);
    expect(await asUser(db, U.HR, () => run(`select review_employee_document('${again}', 'accept')`))).toBe('');
    expect(await items('E-ME')).not.toContain('Document: KRA PIN certificate');
    expect(await status('E-ME')).toBe('approved');
  });

  it('changing an essential detail still sends it back', async () => {
    await asUser(db, U.STAFF, () => run(`update employees set "NSSF Number" = '2099999999' where "Employee Number" = 'E-ME'`));
    expect(await status('E-ME')).toBe('submitted');
    const [last] = await rows<{ changed_fields: string[] }>(
      `select changed_fields from employee_onboarding_reviews where employee_id = '${ids['E-ME']}' order by created_at desc limit 1`);
    expect(last.changed_fields).toEqual(['NSSF Number']);
    expect(await approve('E-ME')).toBe('');
  });

  it('so does changing a follow-up detail that was already given', async () => {
    await asUser(db, U.STAFF, () => run(`update employees set kra_residency = 'Non-Resident' where "Employee Number" = 'E-ME'`));
    expect(await status('E-ME')).toBe('submitted');
    expect(await approve('E-ME')).toBe('');
  });
});

describe('due dates and reminders', () => {
  it('the employee is reminded on approval of what is still to provide', async () => {
    const got = await notices('document_requested', 'E-ME');
    expect(got.length).toBeGreaterThan(0);
    expect(got[0].message).toMatch(/^Your onboarding is approved and you are on payroll\. Still to provide: .*Referee.*\. Add them in Onboarding/);
    // at most one a day, however often it is approved
    expect((await rows(`select 1 from onboarding_followup_reminders where employee_id = '${ids['E-ME']}'`)).length).toBe(1);
  });

  it('HR sets a due date per item; nobody else can, and only for an item still to provide', async () => {
    const set = (as: string, item: string, due: string) => asUser(db, as, () => run(`select set_onboarding_followup_due('${ids['E-ME']}', '${item}', ${due})`));
    expect(await set(U.STAFF, 'Document: Updated CV', 'current_date + 5')).toMatch(/Only HR/);
    expect(await set(U.HR, 'Referee', 'current_date + 5')).toMatch(/not still to provide/);
    expect(await set(U.HR, 'Document: Updated CV', 'current_date + 5')).toBe('');
    expect(await set(U.HR, 'Document: Academic certificates', 'current_date + 1')).toBe('');
    expect(await set(U.HR, 'Document: Academic certificates', 'null')).toBe(''); // cleared
    const cv = (await followups('E-ME')).find((f) => f.item === 'Document: Updated CV');
    expect(cv?.due_date).toBe((await rows<{ d: string }>(`select (current_date + 5)::text d`))[0].d);
    expect(cv?.overdue).toBe(false);
    expect((await followups('E-ME')).find((f) => f.item === 'Document: Academic certificates')?.due_date).toBeNull();
    expect(await asUser(db, U.STAFF, () => rows(`select item from onboarding_followup_due_dates`))).toEqual([{ item: 'Document: Updated CV' }]);
  });

  it('reminds every 7 days, on the due date, and tells HR once it is overdue; at most once a day', async () => {
    await db.exec(`update employees set "Status" = 'Inactive' where "Employee Number" in ('E-TWO', 'E-THREE', 'E-TZ', 'E-UG')`);
    const counts = async () => ({
      employee: (await notices('document_requested', 'E-ME')).length,
      hr: (await notices('onboarding_followups_overdue', 'E-ME')).length,
    });
    const start = await counts();
    expect(await remind(0)).toBe(0); // reminded on approval today
    expect(await remind(3)).toBe(0);
    expect(await remind(5)).toBe(1); // the CV is due
    expect(await remind(5)).toBe(0); // again the same day: nothing
    expect(await remind(6)).toBe(1); // overdue: HR hears
    expect(await remind(6)).toBe(0);
    const hr = await notices('onboarding_followups_overdue', 'E-ME');
    expect(hr[hr.length - 1].message).toMatch(/^Amina Wanjiru has not yet provided: Document: Updated CV \(due .+\)\. Follow it up in Onboarding\.$/);
    expect(await remind(11)).toBe(0);
    expect(await remind(12)).toBe(1); // 7 days after the last reminder
    expect(await remind(13)).toBe(1); // 7 days after HR last heard
    expect(await counts()).toEqual({ employee: start.employee + 2, hr: start.hr + 2 });
    expect((await rows<{ v: boolean }>(`select hr_only_notification('onboarding_followups_overdue') v`))[0].v).toBe(true);
    expect((await rows<{ v: boolean }>(`select hr_only_notification('document_requested') v`))[0].v).toBe(false);
  });

  it('the interval is a company setting', async () => {
    expect(await saveSettings(U.HR, `onboarding_default_essentials()`, '3')).toBe('');
    expect(await remind(15)).toBe(1); // 3 days after the last reminder (day 12)
    await saveSettings(U.HR, `onboarding_default_essentials()`, '7');
  });

  it('the overview counts what is overdue', async () => {
    const [me] = await asUser(db, U.HR, () => rows<{ followups_overdue: number }>(`select followups_overdue from onboarding_overview() where employee_number = 'E-ME'`));
    expect(me.followups_overdue).toBe(0); // due in 5 days from today
    await db.exec(`update onboarding_followup_due_dates set due_date = current_date - 1 where employee_id = '${ids['E-ME']}'`);
    const [later] = await asUser(db, U.HR, () => rows<{ followups_overdue: number }>(`select followups_overdue from onboarding_overview() where employee_number = 'E-ME'`));
    expect(later.followups_overdue).toBe(1);
  });
});

describe('payroll', () => {
  it('pays an approved employee with follow-ups outstanding', async () => {
    expect((await items('E-ME')).length).toBeGreaterThan(0);
    expect(await asUser(db, U.PAYROLL, () => run(`insert into salary_history (employee_id, employee_name, pay_period, basic_salary, gross_pay, net_pay)
      values ('E-ME', 'Amina', '2026-10', 50000, 50000, 40000)`))).toBe('');
  });

  it('still not someone waiting for approval', async () => {
    expect(await asUser(db, U.PAYROLL, () => run(`insert into salary_history (employee_id, employee_name, pay_period, basic_salary, gross_pay, net_pay)
      values ('E-TWO', 'Brian', '2026-10', 1, 1, 1)`))).toMatch(/can't be paid yet/);
  });
});

describe('Tanzania and Uganda', () => {
  it('a Tanzanian employee’s essentials are a TIN and NSSF number, no KRA PIN or SHA number', async () => {
    const m = await essentials('E-TZ', 'employee');
    expect(m).toContain('TIN');
    expect(m).toContain('NSSF number');
    expect(m).not.toContain('KRA PIN');
    expect(m).not.toContain('SHA number');
    await db.exec(`update employees set "Last Name" = 'Mushi', "Date of Birth" = '1990-01-01', "Mobile Number" = '+255712345678',
      "Type of Identification" = 'Passport Number', "ID Number" = 'TZ1234567', "Tax PIN" = '123-456-789', "NSSF Number" = 'TZ123456' where "Employee Number" = 'E-TZ'`);
    expect(await essentials('E-TZ', 'employee')).toEqual([]);
    expect(await submit(U.TZ)).toBe('');
  });

  it('a Ugandan employee’s essentials are a URA TIN and NSSF number', async () => {
    const m = await essentials('E-UG', 'employee');
    expect(m).toContain('TIN');
    expect(m).not.toContain('SHA number');
    await db.exec(`update employees set "Last Name" = 'Grace', "Date of Birth" = '1990-01-01', "Mobile Number" = '+256712345678',
      "Type of Identification" = 'National ID', "ID Number" = 'CF90012345ABCD', "Tax PIN" = '1000123456', "NSSF Number" = 'NS12345678' where "Employee Number" = 'E-UG'`);
    expect(await submit(U.UG)).toBe('');
    // the tax number is one essential whatever it is called
    expect((await rows<{ k: string }>(`select onboarding_item_key('TIN') k`))[0].k).toBe('tax_number');
  });
});

describe('company isolation', () => {
  it('another company sees none of it and keeps its own setting', async () => {
    expect(await asUser(db, U.HR_B, () => rows(`select 1 from onboarding_followup_due_dates`))).toEqual([]);
    expect(await asUser(db, U.HR_B, () => rows(`select 1 from onboarding_followup_reminders`))).toEqual([]);
    expect(await asUser(db, U.HR_B, () => rows<{ employee_number: string }>(`select employee_number from onboarding_overview()`))).toEqual([{ employee_number: 'E-FAR' }]);
    expect(await asUser(db, U.HR_B, () => run(`select set_onboarding_followup_due('${ids['E-ME']}', 'Document: Updated CV', current_date)`))).toMatch(/not found/);
    expect(await asUser(db, U.HR_B, () => run(`select review_onboarding('${ids['E-TWO']}', 'approve')`))).toMatch(/not found/);
    expect(await saveSettings(U.HR_B, `(select array_agg(item_key) from onboarding_item_catalogue())`)).toBe('');
    expect((await rows<{ n: number }>(`select cardinality(onboarding_essential_keys('${A}')) n`))[0].n).toBe(9);
    expect(await asUser(db, U.HR, () => rows<{ tenant_id: string }>(`select tenant_id from company_onboarding_settings`))).toEqual([{ tenant_id: A }]);
  });
});

describe('running the migration again', () => {
  it('keeps the settings, due dates and reminders, and still works', async () => {
    const before = {
      settings: await rows(`select tenant_id, essential_items, reminder_every_days from company_onboarding_settings order by tenant_id`),
      due: await rows(`select employee_id, item, due_date from onboarding_followup_due_dates order by 1, 2`),
      reminders: await rows(`select employee_id, reminded_on from onboarding_followup_reminders order by 1, 2`),
    };
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    await db.exec('reset search_path');
    expect(await rows(`select tenant_id, essential_items, reminder_every_days from company_onboarding_settings order by tenant_id`)).toEqual(before.settings);
    expect(await rows(`select employee_id, item, due_date from onboarding_followup_due_dates order by 1, 2`)).toEqual(before.due);
    expect(await rows(`select employee_id, reminded_on from onboarding_followup_reminders order by 1, 2`)).toEqual(before.reminders);
    expect(await approve('E-TZ')).toMatch(/^Still missing: Position, Type of employee/);
    expect(await submit(U.STAFF)).toMatch(/already approved/);
  });
});
