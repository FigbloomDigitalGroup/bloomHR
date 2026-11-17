// @vitest-environment node
//
// Figbloom sign-in (20261117100000, ERP/HR_COGNITO_CONTRACT.md section 2): identity_sign_in() links a Cognito account
// to a bloomHR login on its first sign-in by a verified email, finds it by sub after that, keeps the staff pool to
// platform admins, and never hands a login over on an unverified email. Only the backend may call it or see the links.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootLiveDb } from './db';

const AMINA = '00000000-0000-0000-0000-00000000e001';
const BEN = '00000000-0000-0000-0000-00000000e002';
const STAFF = '00000000-0000-0000-0000-00000000e003';

let db: PGlite;
type SignIn = { outcome: string; user_id: string | null; newly_linked: boolean };
const signIn = async (pool: string, sub: string, email: string | null, verified = true) =>
  (await db.query<SignIn>(`select * from identity_sign_in($1, $2, $3, $4)`, [pool, sub, email, verified])).rows[0];
const links = async () => (await db.query<{ user_id: string; pool: string; sub: string }>(`select user_id, pool, sub from identity_links order by pool, sub`)).rows;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values
      ('${AMINA}', 'amina@acme.example'), ('${BEN}', 'Ben@Acme.Example'), ('${STAFF}', 'staff@figbloom.org');
    insert into platform_admins (user_id) values ('${STAFF}');
  `);
}, 120000);

describe('identity_sign_in', () => {
  it('links a login on its first Figbloom sign-in by verified email (any case), then finds it by sub', async () => {
    expect(await signIn('customers', 'sub-amina', 'AMINA@acme.example')).toEqual({ outcome: 'linked', user_id: AMINA, newly_linked: true });
    expect(await signIn('customers', 'sub-amina', 'whatever@else.example')).toEqual({ outcome: 'linked', user_id: AMINA, newly_linked: false });
    expect(await signIn('customers', 'sub-ben', 'ben@acme.example')).toEqual({ outcome: 'linked', user_id: BEN, newly_linked: true });
  });

  it('never hands a login over on an unverified email', async () => {
    await db.exec(`delete from identity_links where sub = 'sub-x'`);
    expect(await signIn('customers', 'sub-x', 'staff@figbloom.org', false)).toEqual({ outcome: 'no_account', user_id: null, newly_linked: false });
  });

  it('answers no_account for an email bloomHR has no login for', async () => {
    expect(await signIn('customers', 'sub-new', 'new@acme.example')).toEqual({ outcome: 'no_account', user_id: null, newly_linked: false });
  });

  it('refuses a second Figbloom account for a login that is already linked', async () => {
    expect(await signIn('customers', 'sub-amina-2', 'amina@acme.example')).toEqual({ outcome: 'email_in_use', user_id: null, newly_linked: false });
  });

  it('lets only platform admins in through the staff pool, and checks again on every sign-in', async () => {
    expect(await signIn('staff', 'staff-amina', 'amina@acme.example')).toMatchObject({ outcome: 'no_console_access' });
    expect(await signIn('staff', 'staff-1', 'staff@figbloom.org')).toEqual({ outcome: 'linked', user_id: STAFF, newly_linked: true });
    await db.exec(`delete from platform_admins where user_id = '${STAFF}'`);
    expect(await signIn('staff', 'staff-1', 'staff@figbloom.org')).toMatchObject({ outcome: 'no_console_access', user_id: null });
    await db.exec(`insert into platform_admins (user_id) values ('${STAFF}')`);
  });

  it('keeps the customers and staff links apart', async () => {
    expect((await links()).map((l) => `${l.pool}:${l.sub}`)).toEqual(['customers:sub-amina', 'customers:sub-ben', 'staff:staff-1']);
  });

  it('identity_link() links a login HR just made, at once, and never takes over another link', async () => {
    const NEW = '00000000-0000-0000-0000-00000000e004';
    await db.exec(`insert into auth.users (id, email) values ('${NEW}', 'new@acme.example')`);
    const link = async (user: string, sub: string, madeHere = true) =>
      (await db.query<{ identity_link: string }>(`select identity_link($1, 'customers', $2, $3)`, [user, sub, madeHere])).rows[0].identity_link;
    expect(await link(NEW, 'sub-new')).toBe('linked');
    expect(await link(NEW, 'sub-new')).toBe('already');
    // the login already has another Figbloom account, or this account is someone else's
    expect(await link(NEW, 'sub-other')).toBe('taken');
    expect(await link(BEN, 'sub-new')).toBe('taken');
    const of = async (user: string) => (await db.query<{ sub: string; made_here: boolean }>(`select * from identity_of($1, 'customers')`, [user])).rows;
    expect(await of(NEW)).toEqual([{ sub: 'sub-new', made_here: true }]);
    // linked at their first Figbloom sign-in, not made by HR
    expect(await of(AMINA)).toEqual([{ sub: 'sub-amina', made_here: false }]);
    // and a sign-in finds the new one by its sub
    expect(await signIn('customers', 'sub-new', null, false)).toEqual({ outcome: 'linked', user_id: NEW, newly_linked: false });
  });

  it('is for the backend only: people and visitors can neither call it nor read the links', async () => {
    await expect(asUser(db, AMINA, () => db.query(`select * from identity_sign_in('customers', 'sub-amina', null, false)`))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, () => db.query(`select * from identity_sign_in('customers', 'sub-amina', null, false)`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, AMINA, () => db.query(`select * from identity_links`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, AMINA, () => db.query(`select identity_link('${AMINA}', 'customers', 'mine', true)`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, AMINA, () => db.query(`select * from identity_of('${AMINA}', 'customers')`))).rejects.toThrow(/permission denied/);
  });
});
