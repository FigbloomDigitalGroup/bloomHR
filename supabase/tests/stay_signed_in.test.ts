// @vitest-environment node
//
// How long people stay signed in (20261026100000): a company setting, 7 days unless changed, read by everyone signed in
// and changed by Sign-in security. A passed sign-in code lasts as long (never under 12 hours) when the server passes no
// length of its own.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const ADMIN = '00000000-0000-0000-0000-00000000d001';
const STAFF = '00000000-0000-0000-0000-00000000d002';
const ADMIN_B = '00000000-0000-0000-0000-00000000d0b1';

let db: PGlite;

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const claims = JSON.stringify({ sub: userId, session_id: 's' });
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false), set_config('request.jwt.claims', '${claims}', false)`
  );
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)`);
  }
}
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const settings = (user: string) => asUser(user, () => one(`select * from stay_signed_in_settings()`));
const set = (user: string, minutes: number) =>
  asUser(user, () => db.query(`select * from set_stay_signed_in($1)`, [minutes]).then((r) => r.rows[0], (e) => (e as Error).message));
/** a code issued and checked with the server's arguments; returns how many hours the pass lasts */
async function passHours(user: string, tenant: string, passHoursArg: number | null) {
  await db.query(`select mfa_issue_code($1, $2, 's', 'x@a.co', 'email', 'x@a.co', 'h', 3600)`, [tenant, user]);
  const r = await one<{ outcome: string }>(`select * from mfa_check_code($1, 's', 'h', 5, $2)`, [user, passHoursArg]);
  expect(r.outcome).toBe('ok');
  const p = await one<{ h: number }>(`select round(extract(epoch from expires_at - verified_at) / 3600)::int h from mfa_sessions where user_id = $1`, [user]);
  return p.h;
}

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into role_permissions (role_name, permissions, tenant_id) values ('STAFF', array['dashboard'], '${A}');`);
  for (const [id, role, t] of [[ADMIN, 'ADMIN', A], [STAFF, 'STAFF', A], [ADMIN_B, 'ADMIN', B]]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${role.toLowerCase()}-${id.slice(-4)}@x.co');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${role.toLowerCase()}-${id.slice(-4)}@x.co', '${role}', '${t}');
    `);
  }
}, 120000);

beforeEach(async () => {
  await db.exec(`delete from mfa_codes; delete from mfa_sessions; delete from company_security_settings;`);
});

describe('the setting', () => {
  it('is 7 days unless changed; everyone signed in reads it, only Sign-in security changes it', async () => {
    expect(await settings(STAFF)).toEqual({ minutes: 10080, can_edit: false });
    expect(await settings(ADMIN)).toEqual({ minutes: 10080, can_edit: true });
    expect(await set(STAFF, 30)).toMatch(/Only an administrator/);
    expect(await set(ADMIN, 45)).toMatch(/Choose 30 minutes, 8 hours, 1 day or 7 days/);
    expect(await set(ADMIN, 30)).toEqual({ minutes: 30, can_edit: true });
    expect(await settings(STAFF)).toEqual({ minutes: 30, can_edit: false });
    // the other company keeps its own
    expect(await settings(ADMIN_B)).toEqual({ minutes: 10080, can_edit: true });
  });

  it('keeps the two-step setting it shares a row with', async () => {
    await asUser(ADMIN, () => db.query(`select * from set_two_step_settings('everyone', 'sms')`));
    await set(ADMIN, 480);
    expect(await one(`select two_step, two_step_method, stay_signed_in_minutes from company_security_settings where tenant_id = '${A}'`)).toEqual({
      two_step: 'everyone', two_step_method: 'sms', stay_signed_in_minutes: 480,
    });
    await asUser(ADMIN, () => db.query(`select * from set_two_step_settings('off', 'email')`));
    expect(await settings(ADMIN)).toEqual({ minutes: 480, can_edit: true });
  });
});

describe('how long a passed code lasts', () => {
  it('as long as the company keeps people signed in, never under 12 hours, when the server leaves it to the company', async () => {
    expect(await passHours(ADMIN, A, null)).toBe(168); // 7 days, the default
    await db.exec(`delete from mfa_sessions`);
    await set(ADMIN, 1440);
    expect(await passHours(ADMIN, A, null)).toBe(24);
    await db.exec(`delete from mfa_sessions`);
    await set(ADMIN, 30);
    expect(await passHours(ADMIN, A, null)).toBe(12);
  });

  it('a length the server gives is used as given (1 to 168 hours)', async () => {
    expect(await passHours(ADMIN, A, 12)).toBe(12);
    await expect(db.query(`select * from mfa_check_code($1, 's', 'h', 5, 169)`, [ADMIN])).rejects.toThrow(/invalid arguments/);
  });

  it('a code may last up to an hour', async () => {
    await db.query(`select mfa_issue_code($1, $2, 's', 'x@a.co', 'email', 'x@a.co', 'h', 3600)`, [A, ADMIN]);
    const c = await one<{ m: number }>(`select round(extract(epoch from expires_at - created_at) / 60)::int m from mfa_codes`);
    expect(c.m).toBe(60);
  });
});
