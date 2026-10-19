// @vitest-environment node
//
// Document files settings (20261022000000): one file (with extra pages), named slots (ID front and back; a passport's
// bio page) or many labelled files; a company's own files setting and its own document types; old single ID files.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootDb } from './db';

const FILE = '20261022000000_document_parts.sql';
const MIGRATION = join(__dirname, '..', 'migrations', FILE);
const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const U = {
  ME: '00000000-0000-0000-0000-00000000d101', // E-ME, national ID
  PP: '00000000-0000-0000-0000-00000000d102', // E-PP, passport
  OLD: '00000000-0000-0000-0000-00000000d103', // E-OLD, an old ID file HR accepted
  WAIT: '00000000-0000-0000-0000-00000000d104', // E-WAIT, an old ID file waiting for HR
  UG: '00000000-0000-0000-0000-00000000d105', // E-UG, Kampala
  HR: '00000000-0000-0000-0000-00000000d106',
  BS: '00000000-0000-0000-0000-00000000d107', // E-B, company B
  HR_B: '00000000-0000-0000-0000-00000000d108',
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
const ids: Record<string, string> = {};
const q = (v: string | null) => (v === null ? 'null' : `'${v.replace(/'/g, "''")}'`);
const upload = (n: string, user: string, code: string, part: string | null = null, label: string | null = null, tenant = A) =>
  `insert into employee_documents (employee_id, code, part, label, file_path, file_name)
   values ('${ids[n]}', '${code}', ${q(part)}, ${q(label)}, '${tenant}/${user}/onboarding/${code}_${Math.random().toString(36).slice(2)}.pdf', '${code}.pdf')`;
const docId = async (n: string, code: string, part: string | null) =>
  (await rows<{ id: string }>(`select id from employee_documents where employee_id = '${ids[n]}' and code = '${code}'
     and part is not distinct from ${q(part)} and status <> 'rejected' order by uploaded_at desc limit 1`))[0].id;
const review = (id: string, decision: 'accept' | 'reject', note = 'Blurry') =>
  asUser(db, U.HR, () => run(`select review_employee_document('${id}', '${decision}', '${note}')`));
const state = async (n: string, code: string) =>
  (await rows<{ provided: boolean; accepted: boolean; note: string | null }>(
    `select document_provided(e, '${code}') provided, document_accepted(e, '${code}') accepted, document_note(e, '${code}') note
     from employees e where "Employee Number" = '${n}'`))[0];
const lists = async (n: string) => {
  const [r] = await rows<{ outstanding: string[]; essentials: string[] }>(
    `select documents_outstanding(e) outstanding, onboarding_essentials_missing(e, 'employee') essentials from employees e where "Employee Number" = '${n}'`);
  const followups = await rows<{ item: string; note: string | null }>(
    `select f.item, f.note from employees e, onboarding_followups(e) f where e."Employee Number" = '${n}'`);
  return { ...r, followups };
};
const files = async (as: string, n?: string) =>
  asUser(db, as, () => rows<{ code: string; file_mode: string; slots: string[] | null }>(
    `select code, file_mode, slots from document_files(${n ? `'${ids[n]}'` : ''})`));
const filesOf = async (as: string, code: string, n?: string) => (await files(as, n)).find((f) => f.code === code);
const checklist = async (as: string, n?: string) =>
  asUser(db, as, () => rows<{ code: string; label: string; required: boolean; allows_many: boolean }>(
    `select code, label, required, allows_many from document_checklist(${n ? `'${ids[n]}'` : ''})`));

beforeAll(async () => {
  db = await bootDb({
    file: FILE,
    // before this migration: old ID files (one HR accepted, one waiting)
    seed: async (d) => {
      await d.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
      for (const [id, email, role, tenant] of [
        [U.ME, 'me@a.co', 'STAFF', A], [U.PP, 'pp@a.co', 'STAFF', A], [U.OLD, 'old@a.co', 'STAFF', A], [U.WAIT, 'wait@a.co', 'STAFF', A],
        [U.UG, 'ug@a.co', 'STAFF', A], [U.HR, 'hr@a.co', 'HR', A], [U.BS, 'bs@b.co', 'STAFF', B], [U.HR_B, 'hr@b.co', 'HR', B],
      ]) {
        await d.exec(`
          insert into auth.users (id, email) values ('${id}', '${email}');
          insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${tenant}');
        `);
      }
      await d.exec(`
        insert into branches (tenant_id, name, country) values ('${A}', 'Kampala', 'Uganda');
        insert into employees ("Employee Number", "First Name", "Work Email", "Type of Identification", "Branch", tenant_id) values
          ('E-ME', 'Amina', 'me@a.co', 'National ID', null, '${A}'), ('E-PP', 'Pierre', 'pp@a.co', 'Passport Number', null, '${A}'),
          ('E-OLD', 'Otieno', 'old@a.co', 'National ID', null, '${A}'), ('E-WAIT', 'Wanjiku', 'wait@a.co', 'National ID', null, '${A}'),
          ('E-UG', 'Akello', 'ug@a.co', 'National ID', 'Kampala', '${A}'), ('E-B', 'Baraka', 'bs@b.co', 'National ID', null, '${B}');
        insert into employee_documents (tenant_id, employee_id, code, file_path, file_name, status)
          select '${A}', e.id, 'id_document', '${A}/' || u.id || '/onboarding/id_old.pdf', 'id.pdf', s
          from (values ('E-OLD', 'accepted'), ('E-WAIT', 'pending')) v(n, s)
          join employees e on e."Employee Number" = v.n join auth.users u on lower(u.email) = lower(e."Work Email");
      `);
    },
  });
  await db.exec(`
    delete from role_permissions where tenant_id = '${A}';
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('STAFF', array['dashboard'], '${A}'), ('HR', array['employees'], '${A}'), ('HR', array['employees'], '${B}')
    on conflict do nothing;
  `);
  for (const n of ['E-ME', 'E-PP', 'E-OLD', 'E-WAIT', 'E-UG', 'E-B']) {
    ids[n] = (await rows<{ id: string }>(`select id from employees where "Employee Number" = '${n}'`))[0].id;
  }
}, 180000);

describe('defaults', () => {
  it('ID: Front and Back, or the Bio page for a passport; NIN card: Front and Back; certificates many; the rest one file', async () => {
    expect(await filesOf(U.ME, 'id_document')).toEqual({ code: 'id_document', file_mode: 'slots', slots: ['Front', 'Back'] });
    expect(await filesOf(U.PP, 'id_document')).toEqual({ code: 'id_document', file_mode: 'slots', slots: ['Bio page'] });
    expect(await filesOf(U.UG, 'nin_card')).toEqual({ code: 'nin_card', file_mode: 'slots', slots: ['Front', 'Back'] });
    for (const c of ['academic_certificate', 'professional_certificate', 'employment_evidence', 'dependants_documents', 'beneficiary_documents']) {
      expect((await filesOf(U.ME, c))?.file_mode, c).toBe('many');
    }
    expect((await filesOf(U.ME, 'kra_pin_certificate'))?.file_mode).toBe('single');
    expect((await filesOf(U.ME, 'cv'))?.file_mode).toBe('single');
  });
});

describe('named slots: the ID', () => {
  it('a national ID needs the Front and the Back before it stops being missing', async () => {
    expect(await asUser(db, U.ME, () => run(upload('E-ME', U.ME, 'id_document', ' Front ')))).toBe('');
    expect(await state('E-ME', 'id_document')).toEqual({ provided: false, accepted: false, note: 'Back missing' });
    let l = await lists('E-ME');
    expect(l.outstanding).toContain('Proof of identity (Back missing)');
    expect(l.followups).toContainEqual({ item: 'Document: Proof of identity', note: 'Back missing' });
    expect(await asUser(db, U.ME, () => run(upload('E-ME', U.ME, 'id_document', 'Back')))).toBe('');
    expect(await state('E-ME', 'id_document')).toEqual({ provided: true, accepted: false, note: 'waiting for HR' });
    l = await lists('E-ME');
    expect(l.outstanding).toContain('Proof of identity (waiting for HR)');
  });

  it('each slot is filled once, and only with its own names', async () => {
    expect(await asUser(db, U.ME, () => run(upload('E-ME', U.ME, 'id_document', 'Front')))).toMatch(/Front is already uploaded/);
    expect(await asUser(db, U.ME, () => run(upload('E-ME', U.ME, 'id_document', 'Selfie')))).toMatch(/Choose one of: Front, Back/);
  });

  it('a rejected side counts as missing until it is uploaded again', async () => {
    expect(await review(await docId('E-ME', 'id_document', 'Front'), 'accept')).toBe('');
    expect(await review(await docId('E-ME', 'id_document', 'Back'), 'reject')).toBe('');
    expect(await state('E-ME', 'id_document')).toEqual({ provided: false, accepted: false, note: 'Back missing' });
    expect(await asUser(db, U.ME, () => run(upload('E-ME', U.ME, 'id_document', 'Back')))).toBe('');
    expect(await review(await docId('E-ME', 'id_document', 'Back'), 'accept')).toBe('');
    expect(await state('E-ME', 'id_document')).toEqual({ provided: true, accepted: true, note: null });
    const l = await lists('E-ME');
    expect(l.outstanding.join()).not.toContain('Proof of identity');
    expect(l.followups.map((f) => f.item)).not.toContain('Document: Proof of identity');
  });

  it('a passport needs only the bio page', async () => {
    expect(await asUser(db, U.PP, () => run(upload('E-PP', U.PP, 'id_document', 'Front')))).toMatch(/Choose one of: Bio page/);
    expect(await asUser(db, U.PP, () => run(upload('E-PP', U.PP, 'id_document', 'Bio page')))).toBe('');
    expect(await state('E-PP', 'id_document')).toEqual({ provided: true, accepted: false, note: 'waiting for HR' });
  });

  it('essentials respect the slots when documents are essential', async () => {
    await asUser(db, U.HR, () => run(`select save_onboarding_settings(onboarding_default_essentials() || array['documents'])`));
    await db.exec(`insert into employee_documents (tenant_id, employee_id, code, part, file_path, file_name)
                   values ('${A}', '${ids['E-UG']}', 'id_document', 'Front', '${A}/${U.UG}/onboarding/f.pdf', 'f.pdf')`);
    expect((await lists('E-UG')).essentials).toContain('Document: Proof of identity');
    expect((await lists('E-PP')).essentials).not.toContain('Document: Proof of identity');
    await asUser(db, U.HR, () => run(`select save_onboarding_settings(onboarding_default_essentials())`));
  });
});

describe('many files with labels; one file with extra pages', () => {
  it('labels are saved trimmed (blank is none), and one file is enough', async () => {
    expect((await state('E-ME', 'academic_certificate')).provided).toBe(false);
    expect(await asUser(db, U.ME, () => run(upload('E-ME', U.ME, 'academic_certificate', null, '  BSc Commerce  ')))).toBe('');
    expect(await asUser(db, U.ME, () => run(upload('E-ME', U.ME, 'academic_certificate', null, '   ')))).toBe('');
    expect(await asUser(db, U.ME, () => run(upload('E-ME', U.ME, 'dependants_documents', null, 'Zawadi, daughter')))).toBe('');
    expect(await rows(`select label from employee_documents where employee_id = '${ids['E-ME']}' and code = 'academic_certificate' order by label nulls last`))
      .toEqual([{ label: 'BSc Commerce' }, { label: null }]);
    expect((await state('E-ME', 'academic_certificate')).provided).toBe(true);
    expect(await asUser(db, U.ME, () => run(upload('E-ME', U.ME, 'academic_certificate', null, 'x'.repeat(201))))).toMatch(/label_length/);
  });

  it('a single document counts once page 1 is in; extra pages are "Page n"', async () => {
    expect(await asUser(db, U.ME, () => run(upload('E-ME', U.ME, 'kra_pin_certificate', 'Page 2')))).toBe('');
    expect((await state('E-ME', 'kra_pin_certificate')).provided).toBe(false);
    expect(await asUser(db, U.ME, () => run(upload('E-ME', U.ME, 'kra_pin_certificate')))).toBe('');
    expect((await state('E-ME', 'kra_pin_certificate')).provided).toBe(true);
    expect(await asUser(db, U.ME, () => run(upload('E-ME', U.ME, 'kra_pin_certificate', 'Back')))).toMatch(/no part called Back/);
  });
});

describe('old single ID files', () => {
  it('one HR had accepted covers the whole document', async () => {
    expect(await rows(`select complete, status from employee_documents where employee_id = '${ids['E-OLD']}'`)).toEqual([{ complete: true, status: 'accepted' }]);
    expect(await state('E-OLD', 'id_document')).toEqual({ provided: true, accepted: true, note: null });
  });

  it('one waiting for HR is the Front: the Back is missing until HR accepts it as complete', async () => {
    expect(await state('E-WAIT', 'id_document')).toEqual({ provided: false, accepted: false, note: 'Back missing' });
    const id = await docId('E-WAIT', 'id_document', null);
    expect(await asUser(db, U.WAIT, () => run(`select accept_document_as_complete('${id}')`))).toMatch(/Only HR/);
    expect(await asUser(db, U.HR_B, () => run(`select accept_document_as_complete('${id}')`))).toMatch(/not found/);
    expect(await asUser(db, U.HR, () => run(`select accept_document_as_complete('${id}')`))).toBe('');
    expect(await state('E-WAIT', 'id_document')).toEqual({ provided: true, accepted: true, note: null });
  });

  it('an employee can’t mark their own file as complete', async () => {
    await asUser(db, U.UG, () => run(`insert into employee_documents (employee_id, code, part, complete, file_path, file_name)
      values ('${ids['E-UG']}', 'id_document', 'Back', true, '${A}/${U.UG}/onboarding/b.pdf', 'b.pdf')`));
    expect(await rows(`select complete from employee_documents where employee_id = '${ids['E-UG']}' and part = 'Back'`)).toEqual([{ complete: false }]);
  });
});

describe('a company’s files setting', () => {
  it('HR sets professional certificates to named slots and requires them; company B is untouched', async () => {
    expect(await asUser(db, U.ME, () => run(`select set_document_files_setting('professional_certificate', 'slots', array['Certificate', 'Practising licence'])`))).toMatch(/Only HR/);
    expect(await asUser(db, U.HR, () => run(`select set_document_files_setting('professional_certificate', 'slots', array[' Certificate ', 'Practising licence', 'certificate', ''])`))).toBe('');
    expect(await asUser(db, U.HR, () => run(`select set_document_files_setting('professional_certificate', 'slots', array['  '])`))).toMatch(/at least one slot/);
    await asUser(db, U.HR, () => run(`insert into company_document_settings (code, required) values ('professional_certificate', true)
      on conflict (tenant_id, code) do update set required = true`));
    expect(await filesOf(U.ME, 'professional_certificate')).toEqual({ code: 'professional_certificate', file_mode: 'slots', slots: ['Certificate', 'Practising licence'] });
    expect(await filesOf(U.BS, 'professional_certificate')).toEqual({ code: 'professional_certificate', file_mode: 'many', slots: null });
    expect((await checklist(U.BS)).find((c) => c.code === 'professional_certificate')?.required).toBe(false);
    expect(await asUser(db, U.ME, () => run(upload('E-ME', U.ME, 'professional_certificate', 'Certificate')))).toBe('');
    expect(await state('E-ME', 'professional_certificate')).toEqual({ provided: false, accepted: false, note: 'Practising licence missing' });
  });

  it('a company can make the ID one file, and back to the default', async () => {
    expect(await asUser(db, U.HR_B, () => run(`select set_document_files_setting('id_document', 'single')`))).toBe('');
    expect((await filesOf(U.BS, 'id_document'))?.file_mode).toBe('single');
    expect((await filesOf(U.ME, 'id_document'))?.file_mode).toBe('slots');
    expect(await asUser(db, U.HR_B, () => run(`select set_document_files_setting('id_document', null)`))).toBe('');
    expect(await filesOf(U.BS, 'id_document')).toEqual({ code: 'id_document', file_mode: 'slots', slots: ['Front', 'Back'] });
  });
});

describe('a company’s own document types', () => {
  let code = '';

  it('HR creates one; staff can’t', async () => {
    expect(await asUser(db, U.ME, () => run(`select save_company_document_type(null, 'Firearm licence', null, 'role', null, true, 'single')`))).toMatch(/Only HR/);
    expect(await asUser(db, U.HR, () => run(`select save_company_document_type(null, '  ', null, 'role', null, true, 'single')`))).toMatch(/name/);
    expect(await asUser(db, U.HR, () => run(`select save_company_document_type(null, 'X', null, 'claims', null, true, 'single')`))).toMatch(/section/);
    [{ code }] = await asUser(db, U.HR, () => rows<{ code: string }>(
      `select save_company_document_type(null, ' Firearm licence ', 'From the Firearms Licensing Board', 'role', array['kenya'], true, 'slots', array['Licence', 'Training certificate']) code`));
    expect(code).toMatch(/^co_[0-9a-f]{12}$/);
    expect(await rows(`select label, countries, file_mode, active, tenant_id from document_types where code = '${code}'`))
      .toEqual([{ label: 'Firearm licence', countries: ['Kenya'], file_mode: 'slots', active: true, tenant_id: A }]);
  });

  it('it is on the checklist, missing and in the follow-ups, then completes', async () => {
    expect((await checklist(U.ME)).find((c) => c.code === code)).toMatchObject({ label: 'Firearm licence', required: true, allows_many: true });
    expect((await checklist(U.UG)).map((c) => c.code)).not.toContain(code); // Kenya only
    expect((await lists('E-ME')).followups.map((f) => f.item)).toContain('Document: Firearm licence');
    expect(await asUser(db, U.ME, () => run(upload('E-ME', U.ME, code, 'Licence')))).toBe('');
    expect(await asUser(db, U.ME, () => run(upload('E-ME', U.ME, code, 'Training certificate')))).toBe('');
    for (const p of ['Licence', 'Training certificate']) expect(await review(await docId('E-ME', code, p), 'accept')).toBe('');
    expect((await lists('E-ME')).followups.map((f) => f.item)).not.toContain('Document: Firearm licence');
    expect((await lists('E-ME')).outstanding.join()).not.toContain('Firearm licence');
  });

  it('company B never sees it, can’t use it and can’t change it', async () => {
    expect(await asUser(db, U.HR_B, () => rows(`select 1 from document_types where code = '${code}'`))).toEqual([]);
    expect((await checklist(U.BS)).map((c) => c.code)).not.toContain(code);
    expect((await files(U.BS)).map((f) => f.code)).not.toContain(code);
    expect(await asUser(db, U.BS, () => run(upload('E-B', U.BS, code, null, null, B)))).toMatch(/Unknown document type/);
    expect(await asUser(db, U.HR_B, () => run(`select save_company_document_type('${code}', 'Mine now', null, 'role', null, true, 'single')`))).toMatch(/Unknown/);
    expect(await asUser(db, U.HR_B, () => run(`select remove_company_document_type('${code}')`))).toMatch(/Unknown/);
    expect(await asUser(db, U.HR_B, () => run(`select set_document_files_setting('${code}', 'many')`))).toMatch(/Unknown/);
    expect(await asUser(db, U.HR_B, () => run(`update document_types set label = 'x' where code = 'cv'`))).toMatch(/permission denied/);
  });

  it('one with files is deactivated, not deleted; one without is deleted', async () => {
    expect(await asUser(db, U.HR, () => rows(`select remove_company_document_type('${code}') r`))).toEqual([{ r: 'deactivated' }]);
    expect((await checklist(U.ME)).map((c) => c.code)).not.toContain(code);
    expect(await rows(`select count(*)::int n from employee_documents where code = '${code}'`)).toEqual([{ n: 2 }]);
    expect(await asUser(db, U.ME, () => run(upload('E-ME', U.ME, code, 'Licence')))).toMatch(/no longer used/);
    const [{ c2 }] = await asUser(db, U.HR, () => rows<{ c2: string }>(`select save_company_document_type(null, 'Gym waiver', null, 'role', null, false, 'many') c2`));
    expect(await asUser(db, U.HR, () => rows(`select remove_company_document_type('${c2}') r`))).toEqual([{ r: 'deleted' }]);
    expect(await rows(`select 1 from document_types where code = '${c2}'`)).toEqual([]);
  });
});

describe('isolation', () => {
  it('a colleague can’t see, add to or review someone else’s files', async () => {
    expect(await asUser(db, U.PP, () => rows(`select 1 from employee_documents where employee_id = '${ids['E-ME']}'`))).toEqual([]);
    expect(await asUser(db, U.PP, () => run(upload('E-ME', U.PP, 'id_document', 'Front')))).toMatch(/row-level security/);
    expect(await asUser(db, U.PP, () => run(`select * from document_files('${ids['E-ME']}')`))).toMatch(/Only HR/);
    const id = await docId('E-PP', 'id_document', 'Bio page');
    await asUser(db, U.PP, () => run(`update employee_documents set part = 'Front', complete = true where id = '${id}'`));
    expect(await rows(`select part, complete from employee_documents where id = '${id}'`)).toEqual([{ part: 'Bio page', complete: false }]);
  });
});

describe('running the migration again', () => {
  it('keeps every file, flag, setting and type', async () => {
    const snap = async () => ({
      docs: await rows(`select id, code, part, label, complete, status from employee_documents order by id`),
      types: await rows(`select code, file_mode, slots, tenant_id, active from document_types order by code`),
      settings: await rows(`select tenant_id, code, required, file_mode, slots from company_document_settings order by tenant_id, code`),
    });
    const before = await snap();
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    await db.exec('reset search_path');
    expect(await snap()).toEqual(before);
    expect(await state('E-ME', 'id_document')).toEqual({ provided: true, accepted: true, note: null });
    expect(await filesOf(U.PP, 'id_document')).toEqual({ code: 'id_document', file_mode: 'slots', slots: ['Bio page'] });
  });
});
