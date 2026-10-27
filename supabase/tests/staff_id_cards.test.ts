// @vitest-environment node
//
// Staff ID cards (20261027400000): every employee sees their own card; the 'staff-id-cards' module (given once to ADMIN
// and HR) sees, prints and reissues anyone's in its company; the public check behind the QR code says only whether the
// person is a current employee, with their name, photo, job title and company. Each company sees only its own.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000f001';
const S1 = '00000000-0000-0000-0000-00000000f002';
const S2 = '00000000-0000-0000-0000-00000000f003';
const HRB = '00000000-0000-0000-0000-00000000f004';
const MIGRATION = readFileSync(join(__dirname, '..', 'migrations', '20261027400000_staff_id_cards.sql'), 'utf8');

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) => asUser(db, user, () => rows<T>(sql, params));
const fails = (user: string, sql: string, params: unknown[] = []) => as(user, sql, params).then(
  () => { throw new Error(`expected to fail: ${sql}`); },
  (e) => (e as Error).message,
);
const idOf = async (number: string, tenant = A) =>
  (await rows<{ id: string }>(`select id from employees where "Employee Number" = $1 and tenant_id = $2`, [number, tenant]))[0].id;
type Card = { employee_number: string; token: string; is_active: boolean; date_of_birth: string | null; department: string | null; branch: string | null };
const verify = (token: string) => asAnon(db, () => rows(`select * from verify_staff_id_card($1)`, [token]));

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co'), ('${S1}', 's1@a.co'), ('${S2}', 's2@a.co'), ('${HRB}', 'hr@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${S1}', 's1@a.co', 'STAFF', '${A}'), ('${S2}', 's2@a.co', 'STAFF', '${A}'),
      ('${HRB}', 'hr@b.co', 'HR', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees', 'staff-id-cards'], '${A}'), ('STAFF', array['dashboard'], '${A}'),
      ('HR', array['employees', 'staff-id-cards'], '${B}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Job Title", "Job Level", "Branch",
                           "Date of Birth", "Profile Image", "Status", tenant_id) values
      ('H1', 'Hana', 'Hr', 'hr@a.co', 'HR Manager', 'People', 'Nairobi', '1990-01-01', null, 'Active', '${A}'),
      ('E1', 'Esther', 'One', 's1@a.co', 'Accountant', 'Finance', 'Nairobi', '1995-05-05', 'https://cdn/e1.png', 'Active', '${A}'),
      ('E2', 'Eric', 'Two', 's2@a.co', 'Driver', 'Logistics', 'Mombasa', '1992-02-02', null, 'Active', '${A}'),
      ('X1', 'Xena', 'Other', 'hr@b.co', 'Clerk', 'Admin', 'Kampala', null, null, 'Active', '${B}');
    update company_profile set company_name = 'Acme Ltd', logo_url = 'https://cdn/logo.png' where tenant_id = '${A}';
  `);
}, 120000);

describe('the module', () => {
  it('is in the catalogue, given once to ADMIN and HR (not other roles), and not again after a company unticks it', async () => {
    const C = '00000000-0000-0000-0000-0000000000c3';
    const holders = async () => (await rows<{ role_name: string }>(
      `select role_name from role_permissions where tenant_id = $1 and 'staff-id-cards' = any (permissions) order by 1`, [C])).map((r) => r.role_name);
    await db.exec(`
      insert into tenants (id, name, slug) values ('${C}', 'Third Co', 'third-co');
      insert into role_permissions (role_name, permissions, tenant_id) values
        ('HR', array['employees'], '${C}'), ('MANAGER', array['employees'], '${C}'), ('STAFF', array['dashboard'], '${C}');
      delete from permissions where module_id = 'staff-id-cards';
    `);
    await db.exec(MIGRATION); // as if for the first time
    expect(await holders()).toEqual(['HR']);
    expect(await rows(`select module_name from permissions where module_id = 'staff-id-cards'`)).toEqual([{ module_name: 'Staff ID cards' }]);

    await db.exec(`update role_permissions set permissions = array_remove(permissions, 'staff-id-cards') where tenant_id = '${C}'`);
    await db.exec(MIGRATION); // and again: safe, and grants nothing
    expect(await holders()).toEqual([]);
  });
});

describe('my_staff_id_card', () => {
  it('gives the employee their own card, with a token made the first time and kept after', async () => {
    const [card] = await as<Card & { first_name: string; job_title: string; photo_url: string }>(S1, `select * from my_staff_id_card()`);
    expect(card).toMatchObject({ employee_number: 'E1', first_name: 'Esther', job_title: 'Accountant', department: 'Finance',
      branch: 'Nairobi', photo_url: 'https://cdn/e1.png', is_active: true });
    expect(card.token).toMatch(/^[0-9a-f]{32}$/);
    expect(card.token).not.toContain('E1');
    const [again] = await as<Card>(S1, `select * from my_staff_id_card()`);
    expect(again.token).toBe(card.token);
  });

  it('leaves the date of birth off unless the company turns it on', async () => {
    expect((await as<Card>(S1, `select * from my_staff_id_card()`))[0].date_of_birth).toBeNull();
    await as(HR, `insert into staff_id_card_settings (show_date_of_birth) values (true)`);
    expect((await as<Card>(S1, `select * from my_staff_id_card()`))[0].date_of_birth).toBe('1995-05-05');
    await as(HR, `update staff_id_card_settings set show_date_of_birth = false`);
  });

  it('staff cannot read anyone else’s card or token, nor write the cards table', async () => {
    await as(S2, `select * from my_staff_id_card()`);
    const seen = await as<{ employee_id: string }>(S1, `select employee_id from staff_id_cards`);
    expect(seen.map((r) => r.employee_id)).toEqual([await idOf('E1')]);
    expect(await fails(S1, `select * from staff_id_cards(array[$1::uuid])`, [await idOf('E2')])).toMatch(/Only people with Staff ID cards/);
    expect(await fails(S1, `select * from regenerate_staff_id_card($1)`, [await idOf('E1')])).toMatch(/Only people with Staff ID cards/);
    expect(await fails(S1, `insert into staff_id_cards (employee_id, token) values ($1, '0123456789abcdef0123456789abcdef')`,
      [await idOf('E2')])).toMatch(/permission denied/);
    // the settings: staff read them but their change touches no row
    const settings = await as<{ show_date_of_birth: boolean }>(S1, `update staff_id_card_settings set show_date_of_birth = true returning show_date_of_birth`).catch(() => []);
    expect(settings).toEqual([]);
  });
});

describe('staff_id_cards (the module)', () => {
  it('HR gets several cards at once, only in its own company', async () => {
    const cards = await as<Card>(HR, `select * from staff_id_cards($1::uuid[])`, [[await idOf('E1'), await idOf('E2'), await idOf('X1', B)]]);
    expect(cards.map((c) => c.employee_number).sort()).toEqual(['E1', 'E2']);
    const otherCompany = await as<Card>(HRB, `select * from staff_id_cards($1::uuid[])`, [[await idOf('E1')]]);
    expect(otherCompany).toEqual([]);
    expect(await as(HRB, `select * from staff_id_cards where tenant_id = '${A}'`)).toEqual([]);
  });

  it('reissuing makes a new token and the old card stops verifying', async () => {
    const [before] = await as<Card>(S1, `select * from my_staff_id_card()`);
    expect(await verify(before.token)).toHaveLength(1);
    const [fresh] = await as<{ token: string }>(HR, `select * from regenerate_staff_id_card($1)`, [await idOf('E1')]);
    expect(fresh.token).toMatch(/^[0-9a-f]{32}$/);
    expect(fresh.token).not.toBe(before.token);
    expect(await verify(before.token)).toEqual([]);
    expect(await verify(fresh.token)).toHaveLength(1);
    expect(await fails(HRB, `select * from regenerate_staff_id_card($1)`, [await idOf('E1')])).toMatch(/No such employee/);
  });

  it('only a drawn PNG signature is kept', async () => {
    expect(await fails(HR, `update staff_id_card_settings set signature = 'javascript:alert(1)'`)).toMatch(/check/);
    await as(HR, `update staff_id_card_settings set signatory_name = 'Hana Hr', signatory_title = 'HR Manager',
                  signature = 'data:image/png;base64,iVBORw0KGgo='`);
    expect((await as(S1, `select signatory_name from staff_id_card_settings`))).toEqual([{ signatory_name: 'Hana Hr' }]);
    expect(await as(HRB, `select * from staff_id_card_settings`)).toEqual([]);
  });
});

describe('verify_staff_id_card (public)', () => {
  it('anyone can check a card: active, name, photo, job title and company only', async () => {
    const [card] = await as<Card>(S1, `select * from my_staff_id_card()`);
    const [shown] = await verify(card.token);
    expect(shown).toEqual({ company_name: 'Acme Ltd', company_logo_url: 'https://cdn/logo.png', full_name: 'Esther One',
      photo_url: 'https://cdn/e1.png', job_title: 'Accountant', is_active: true });
  });

  it('says not active once the person has left or is suspended', async () => {
    const [card] = await as<Card>(S2, `select * from my_staff_id_card()`);
    await db.exec(`insert into hr_suspensions ("Employee Number", suspension_date, is_active, tenant_id) values ('E2', current_date, true, '${A}')`);
    expect((await verify(card.token))[0]).toMatchObject({ is_active: false });
    await db.exec(`update hr_suspensions set is_active = false where "Employee Number" = 'E2'`);
    expect((await verify(card.token))[0]).toMatchObject({ is_active: true });
    await db.exec(`update employees set "Status" = 'Terminated' where "Employee Number" = 'E2' and tenant_id = '${A}'`);
    expect((await verify(card.token))[0]).toMatchObject({ is_active: false });
  });

  it('an unknown or malformed token shows nothing; anon cannot read the tables', async () => {
    expect(await verify('0123456789abcdef0123456789abcdef')).toEqual([]);
    expect(await verify("' or 1=1 --")).toEqual([]);
    await expect(asAnon(db, () => rows(`select * from staff_id_cards`))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, () => rows(`select * from my_staff_id_card()`))).rejects.toThrow(/permission denied/);
  });
});
