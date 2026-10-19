// @vitest-environment node
//
// Extra documents and country checklists (20261021900000): an employee adds documents beyond what they are asked for
// (any type not required of them, or "other" with their own title), HR reviews them, and they never count as missing;
// the core list follows the employee's country (Kenya, Tanzania, Uganda).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const U = {
  KE: '00000000-0000-0000-0000-00000000f101', // E-KE, Kenya (no branch: the company's country)
  TZ: '00000000-0000-0000-0000-00000000f102', // E-TZ, Dar es Salaam
  UG: '00000000-0000-0000-0000-00000000f103', // E-UG, Kampala
  HR: '00000000-0000-0000-0000-00000000f104',
  HR_B: '00000000-0000-0000-0000-00000000f105', // HR in company B
};
const MIGRATION = join(__dirname, '..', 'migrations', '20261021900000_extra_documents.sql');

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
const upload = (n: string, user: string, code: string, title: string | null = null, description: string | null = null) =>
  `insert into employee_documents (employee_id, code, title, description, file_path, file_name)
   values ('${ids[n]}', '${code}', ${title === null ? 'null' : `'${title}'`}, ${description === null ? 'null' : `'${description}'`},
           '${A}/${user}/onboarding/${code}_${Math.random().toString(36).slice(2)}.pdf', '${code}.pdf')`;
const checklist = async (as: string, n?: string) =>
  asUser(db, as, () => rows<{ code: string; required: boolean }>(`select code, required from document_checklist(${n ? `'${ids[n]}'` : ''}) order by sort`));
const codes = async (as: string, n?: string) => (await checklist(as, n)).map((c) => c.code);
const requiredCodes = async (as: string, n?: string) => (await checklist(as, n)).filter((c) => c.required).map((c) => c.code);
const lists = async (n: string) => {
  const [r] = await rows<{ missing: string[]; outstanding: string[]; essentials: string[] }>(
    `select onboarding_missing(e, 'all') missing, documents_outstanding(e) outstanding, onboarding_essentials_missing(e, 'all') essentials
     from employees e where "Employee Number" = '${n}'`);
  const followups = (await rows<{ item: string }>(`select f.item from employees e, onboarding_followups(e) f where e."Employee Number" = '${n}'`)).map((f) => f.item);
  return [...r.missing, ...r.outstanding, ...r.essentials, ...followups].join(' | ');
};

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
  for (const [id, email, role, tenant] of [
    [U.KE, 'ke@a.co', 'STAFF', A], [U.TZ, 'tz@a.co', 'STAFF', A], [U.UG, 'ug@a.co', 'STAFF', A],
    [U.HR, 'hr@a.co', 'HR', A], [U.HR_B, 'hr@b.co', 'HR', B],
  ]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${tenant}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('STAFF', array['dashboard'], '${A}'), ('HR', array['employees'], '${A}'), ('HR', array['employees'], '${B}');
    insert into branches (tenant_id, name, country) values ('${A}', 'Dar es Salaam', 'Tanzania'), ('${A}', 'Kampala', 'Uganda');
    insert into employees ("Employee Number", "First Name", "Work Email", "Branch", tenant_id) values
      ('E-KE', 'Amina', 'ke@a.co', null, '${A}'), ('E-TZ', 'Neema', 'tz@a.co', 'Dar es Salaam', '${A}'),
      ('E-UG', 'Akello', 'ug@a.co', 'Kampala', '${A}');
  `);
  for (const n of ['E-KE', 'E-TZ', 'E-UG']) ids[n] = await idOf(n);
}, 120000);

describe('the core list follows the employee’s country', () => {
  it('Kenya: KRA PIN certificate, NSSF details, SHA membership and HELB; nothing from Tanzania or Uganda', async () => {
    const all = await codes(U.KE);
    expect(await requiredCodes(U.KE)).toEqual(expect.arrayContaining(['kra_pin_certificate', 'nssf_document', 'sha_membership', 'helb_certificate']));
    for (const c of ['tra_tin_certificate', 'tz_nssf_document', 'heslb_document', 'ura_tin_certificate', 'ug_nssf_document', 'nin_card']) {
      expect(all).not.toContain(c);
    }
  });

  it('Tanzania: TRA TIN and NSSF Tanzania, never a KRA PIN certificate; the HESLB letter only for loan holders', async () => {
    const all = await codes(U.TZ);
    expect(await requiredCodes(U.TZ)).toEqual(expect.arrayContaining(['id_document', 'tra_tin_certificate', 'tz_nssf_document', 'cv']));
    for (const c of ['kra_pin_certificate', 'nssf_document', 'sha_membership', 'helb_certificate', 'pwd_certificate', 'ura_tin_certificate', 'nin_card']) {
      expect(all).not.toContain(c);
    }
    expect(await requiredCodes(U.TZ)).not.toContain('heslb_document');
    await db.exec(`update employees set heslb_borrower = true, heslb_index_number = 'S0101/0001/2010' where "Employee Number" = 'E-TZ'`);
    expect(await requiredCodes(U.TZ)).toContain('heslb_document');
    expect(await lists('E-TZ')).toContain('HESLB letter (loan beneficiaries)');
    expect(await lists('E-TZ')).not.toMatch(/KRA|SHA|HELB clearance/);
  });

  it('Uganda: URA TIN, NSSF Uganda and the NIN card', async () => {
    const all = await codes(U.UG);
    expect(all).toEqual(expect.arrayContaining(['ura_tin_certificate', 'ug_nssf_document', 'nin_card']));
    expect(await requiredCodes(U.UG)).toEqual(expect.arrayContaining(['ura_tin_certificate', 'ug_nssf_document']));
    for (const c of ['kra_pin_certificate', 'tra_tin_certificate', 'heslb_document', 'helb_certificate']) expect(all).not.toContain(c);
    expect(await lists('E-UG')).toContain('URA TIN certificate');
    expect(await lists('E-UG')).not.toContain('KRA PIN certificate');
  });

  it('HR sees each employee’s own country list', async () => {
    expect(await codes(U.HR, 'E-TZ')).toContain('tra_tin_certificate');
    expect(await codes(U.HR, 'E-TZ')).not.toContain('kra_pin_certificate');
    expect(await codes(U.HR, 'E-KE')).toContain('kra_pin_certificate');
  });

  it('"other" is never on a checklist', async () => {
    for (const as of [U.KE, U.TZ, U.UG]) expect(await codes(as)).not.toContain('other');
  });
});

describe('extra documents', () => {
  it('the employee uploads a type not asked of them, and "other" only with a title', async () => {
    expect(await asUser(db, U.KE, () => run(upload('E-KE', U.KE, 'professional_certificate')))).toBe('');
    expect(await asUser(db, U.KE, () => run(upload('E-KE', U.KE, 'other')))).toMatch(/Give the document a title/);
    expect(await asUser(db, U.KE, () => run(upload('E-KE', U.KE, 'other', '   ')))).toMatch(/Give the document a title/);
    expect(await asUser(db, U.KE, () => run(upload('E-KE', U.KE, 'other', ' First Aid certificate ', 'Red Cross, 2025')))).toBe('');
    expect(await asUser(db, U.KE, () => run(upload('E-KE', U.KE, 'other', 'Forklift licence')))).toBe(''); // many allowed
    expect(await rows(`select title, description, status from employee_documents where code = 'other' order by title`)).toEqual([
      { title: 'First Aid certificate', description: 'Red Cross, 2025', status: 'pending' },
      { title: 'Forklift licence', description: null, status: 'pending' },
    ]);
  });

  it('even a type from another country, which is not on their checklist', async () => {
    expect(await asUser(db, U.TZ, () => run(upload('E-TZ', U.TZ, 'kra_pin_certificate')))).toBe('');
  });

  it('HR accepts one, and rejects another with a reason; the notice names the title', async () => {
    const [{ id: aid }] = await rows<{ id: string }>(`select id from employee_documents where title = 'First Aid certificate'`);
    const [{ id: fid }] = await rows<{ id: string }>(`select id from employee_documents where title = 'Forklift licence'`);
    expect(await asUser(db, U.HR, () => run(`select review_employee_document('${aid}', 'accept')`))).toBe('');
    expect(await asUser(db, U.HR, () => run(`select review_employee_document('${fid}', 'reject')`))).toMatch(/Say why/);
    expect(await asUser(db, U.HR, () => run(`select review_employee_document('${fid}', 'reject', 'Expired')`))).toBe('');
    expect(await rows(`select status, review_note from employee_documents where id in ('${aid}', '${fid}') order by title`)).toEqual([
      { status: 'accepted', review_note: null }, { status: 'rejected', review_note: 'Expired' },
    ]);
    const notes = await rows<{ message: string }>(`select message from hr_notifications where employee_number = 'E-KE' and notification_type like 'document_%' order by id`);
    expect(notes.map((n) => n.message).join(' ')).toMatch(/First Aid certificate.*Forklift licence/);
  });

  it('they never count as missing, outstanding or follow-ups', async () => {
    const text = await lists('E-KE');
    expect(text).not.toMatch(/First Aid|Forklift|Other document|Professional certificates/);
    expect(await lists('E-TZ')).not.toContain('KRA PIN certificate');
  });

  it('a colleague can’t see or upload someone else’s documents', async () => {
    expect(await asUser(db, U.TZ, () => rows(`select 1 from employee_documents where employee_id = '${ids['E-KE']}'`))).toEqual([]);
    expect(await asUser(db, U.TZ, () => run(upload('E-KE', U.TZ, 'other', 'Sneaky')))).toMatch(/row-level security/);
    expect(await asUser(db, U.TZ, () => run(`select * from document_checklist('${ids['E-KE']}')`))).toMatch(/Only HR/);
  });

  it('another company’s HR sees none of them and can’t review them', async () => {
    expect(await asUser(db, U.HR_B, () => rows(`select 1 from employee_documents`))).toEqual([]);
    const [{ id }] = await rows<{ id: string }>(`select id from employee_documents where code = 'professional_certificate'`);
    expect(await asUser(db, U.HR_B, () => run(`select review_employee_document('${id}', 'accept')`))).toMatch(/not found/);
  });
});

describe('running the migration again', () => {
  it('keeps the files and types, and still works', async () => {
    const before = {
      docs: await rows(`select id, code, title, status from employee_documents order by id`),
      types: await rows(`select code, countries, required_by_default, required_when from document_types order by code`),
    };
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    await db.exec('reset search_path');
    expect(await rows(`select id, code, title, status from employee_documents order by id`)).toEqual(before.docs);
    expect(await rows(`select code, countries, required_by_default, required_when from document_types order by code`)).toEqual(before.types);
    expect(await codes(U.TZ)).not.toContain('kra_pin_certificate');
    expect(await asUser(db, U.UG, () => run(upload('E-UG', U.UG, 'other')))).toMatch(/title/);
  });
});
