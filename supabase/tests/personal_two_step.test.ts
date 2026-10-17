// @vitest-environment node
//
// Two-step sign-in anyone can turn on for themselves (FIG-891): the company's setting is the minimum; a person can add
// it, can't drop it while the company asks it of them, and an admin can see who has it and reset someone.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const ADMIN = '00000000-0000-0000-0000-00000000d001';
const STAFF = '00000000-0000-0000-0000-00000000d002';

let db: PGlite;

async function asSession<T>(userId: string, sessionId: string, fn: () => Promise<T>): Promise<T> {
  const claims = JSON.stringify({ sub: userId, session_id: sessionId });
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false), set_config('request.jwt.claims', '${claims}', false)`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)`);
  }
}
const one = async <T>(sql: string) => (await db.query<T>(sql)).rows[0];
const as = (user: string, sql: string) => asSession(user, 's1', () => db.query(sql).then(() => '', (e) => (e as Error).message));
const mine = (user: string) => asSession(user, 's1', () => one<{ enabled: boolean; method: string; company_requires: boolean }>(`select * from my_two_step()`));
const required = (user: string) => asSession(user, 's1', async () => (await one<{ v: boolean }>(`select mfa_required() v`)).v);
const setCompany = (mode: string) => db.exec(`insert into company_security_settings (tenant_id, two_step, two_step_method) values ('${A}', '${mode}', 'email')
  on conflict (tenant_id) do update set two_step = excluded.two_step`);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${ADMIN}', 'adm@a.co'), ('${STAFF}', 'me@a.co');
    insert into user_profiles (user_id, email, role, tenant_id, full_name) values
      ('${ADMIN}', 'adm@a.co', 'ADMIN', '${A}', 'Ada Admin'), ('${STAFF}', 'me@a.co', 'STAFF', '${A}', 'Mia Staff');
    insert into mfa_numbers (email, phone_number, tenant_id) values ('me@a.co', '0712345678', '${A}');
  `);
}, 120000);

beforeEach(async () => {
  await db.exec(`delete from user_two_step; delete from mfa_sessions;`);
  await setCompany('privileged');
});

describe('my own two-step sign-in', () => {
  it('a staff member whose company only asks admins can turn it on for themselves; then a code is needed', async () => {
    expect(await mine(STAFF)).toMatchObject({ enabled: false, company_requires: false });
    expect(await required(STAFF)).toBe(false);
    expect(await as(STAFF, `select set_my_two_step(true, 'sms')`)).toBe('');
    expect(await mine(STAFF)).toMatchObject({ enabled: true, method: 'sms', company_requires: false });
    expect(await required(STAFF)).toBe(true);
    // the server reads it
    expect(await one(`select * from personal_two_step('${A}', '${STAFF}')`)).toEqual({ enabled: true, method: 'sms' });
  });

  it('…and off again', async () => {
    await as(STAFF, `select set_my_two_step(true)`);
    expect(await as(STAFF, `select set_my_two_step(false)`)).toBe('');
    expect(await required(STAFF)).toBe(false);
  });

  it("can't be turned off when the company asks it of them", async () => {
    expect(await mine(ADMIN)).toMatchObject({ enabled: true, company_requires: true });
    expect(await as(ADMIN, `select set_my_two_step(false)`)).toMatch(/Your company asks for a code/);
    await setCompany('everyone');
    expect(await as(STAFF, `select set_my_two_step(false)`)).toMatch(/Your company asks for a code/);
  });

  it('refuses an unknown method; the table is closed to the browser', async () => {
    expect(await as(STAFF, `select set_my_two_step(true, 'pigeon')`)).toMatch(/Choose email or SMS/);
    expect(await as(STAFF, `select * from user_two_step`)).toMatch(/permission denied/);
    expect(await as(STAFF, `select * from personal_two_step('${A}', '${STAFF}')`)).toMatch(/permission denied/);
  });
});

describe('the admin', () => {
  it('sees who turned it on, and can reset someone (their SMS number goes too)', async () => {
    await as(STAFF, `select set_my_two_step(true, 'sms')`);
    const people = await asSession(ADMIN, 's1', async () => (await db.query<{ name: string; method: string }>(`select name, method from two_step_people()`)).rows);
    expect(people).toEqual([{ name: 'Mia Staff', method: 'sms' }]);
    expect(await as(STAFF, `select * from two_step_people()`)).toMatch(/Only an administrator/);
    expect(await as(STAFF, `select reset_two_step('${ADMIN}')`)).toMatch(/Only an administrator/);
    expect(await as(ADMIN, `select reset_two_step('${STAFF}')`)).toBe('');
    expect(await mine(STAFF)).toMatchObject({ enabled: false });
    expect((await db.query(`select 1 from mfa_numbers where email = 'me@a.co'`)).rows).toHaveLength(0);
  });
});
