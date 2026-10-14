// @vitest-environment node
//
// Two-step sign-in checked on the server (20261016010000, FIG-834 / FIG-658): codes are closed to the browser, only the
// server records a pass, mfa_required() reads it per sign-in, and each company has its own setting (ADMIN only).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, bootDb, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const ADMIN = '00000000-0000-0000-0000-00000000c001';
const HR = '00000000-0000-0000-0000-00000000c002';
const CHECKER = '00000000-0000-0000-0000-00000000c003';
const STAFF = '00000000-0000-0000-0000-00000000c004';
const ADMIN_B = '00000000-0000-0000-0000-00000000c0b1';

let db: PGlite;

/** As a signed-in user of this sign-in (the session id in their login token). */
async function asSession<T>(userId: string, sessionId: string, fn: () => Promise<T>): Promise<T> {
  const claims = JSON.stringify({ sub: userId, session_id: sessionId });
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false), set_config('request.jwt.claims', '${claims}', false)`
  );
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)`);
  }
}
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const denied = (userId: string, sql: string) =>
  asSession(userId, 's', () => db.query(sql).then(() => '', (e) => (e as Error).message));
const required = (userId: string, sessionId: string) =>
  asSession(userId, sessionId, async () => (await one<{ v: boolean }>(`select mfa_required() v`)).v);
const issue = (user: string, session: string, hash: string, tenant = A) =>
  db.query(`select mfa_issue_code($1, $2, $3, 'x@a.co', 'email', 'x@a.co', $4)`, [tenant, user, session, hash]);
const check = (user: string, session: string, hash: string) =>
  one<{ outcome: string; attempts_left: number }>(`select * from mfa_check_code($1, $2, $3)`, [user, session, hash]);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
  for (const [id, role, t] of [[ADMIN, 'ADMIN', A], [HR, 'HR', A], [CHECKER, 'CHECKER', A], [STAFF, 'STAFF', A], [ADMIN_B, 'ADMIN', B]]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${role.toLowerCase()}-${id.slice(-4)}@x.co');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${role.toLowerCase()}-${id.slice(-4)}@x.co', '${role}', '${t}');
    `);
  }
}, 120000);

beforeEach(async () => {
  await db.exec(`delete from mfa_codes; delete from mfa_sessions; delete from company_security_settings;`);
});

describe('mfa_codes and mfa_sessions are closed to the browser', () => {
  it('a signed-in user can neither read nor write codes or passes, even their own', async () => {
    await issue(STAFF, 's', 'hash');
    expect(await denied(STAFF, `select * from mfa_codes`)).toMatch(/permission denied/);
    expect(await denied(STAFF, `insert into mfa_codes (email, expires_at) values ('x', now())`)).toMatch(/permission denied/);
    expect(await denied(STAFF, `select * from mfa_sessions`)).toMatch(/permission denied/);
    expect(await denied(STAFF, `insert into mfa_sessions (user_id, session_id, tenant_id, method, expires_at) values ('${STAFF}', 's', '${A}', 'email', now() + interval '1 hour')`)).toMatch(/permission denied/);
    expect(await asAnon(db, () => db.query(`select * from mfa_codes`).then(() => '', (e) => (e as Error).message))).toMatch(/permission denied/);
  });

  it('the code is no longer kept in plain text', async () => {
    expect((await db.query(`select 1 from information_schema.columns where table_name = 'mfa_codes' and column_name = 'code'`)).rows).toEqual([]);
  });

  it('only the server can issue or check codes', async () => {
    expect(await denied(ADMIN, `select mfa_issue_code('${A}', '${ADMIN}', 's', 'a', 'email', 'a', 'h')`)).toMatch(/permission denied/);
    expect(await denied(ADMIN, `select * from mfa_check_code('${ADMIN}', 's', 'h')`)).toMatch(/permission denied/);
    expect(await denied(ADMIN, `select * from two_step_policy('${A}')`)).toMatch(/permission denied/);
  });
});

describe('mfa_check_code', () => {
  it('accepts the newest code once and records the pass for that sign-in', async () => {
    await issue(ADMIN, 's1', 'old');
    await issue(ADMIN, 's1', 'new');
    expect(await check(ADMIN, 's1', 'old')).toEqual({ outcome: 'wrong', attempts_left: 4 }); // replaced by the new one
    expect((await check(ADMIN, 's1', 'new')).outcome).toBe('ok');
    expect((await check(ADMIN, 's1', 'new')).outcome).toBe('none');
    expect((await db.query(`select user_id, session_id from mfa_sessions`)).rows).toEqual([{ user_id: ADMIN, session_id: 's1' }]);
  });

  it('stops after 5 tries, even for the right code', async () => {
    await issue(ADMIN, 's1', 'right');
    for (let i = 4; i >= 1; i--) expect(await check(ADMIN, 's1', 'wrong')).toEqual({ outcome: 'wrong', attempts_left: i });
    expect(await check(ADMIN, 's1', 'wrong')).toEqual({ outcome: 'too_many', attempts_left: 0 });
    expect((await check(ADMIN, 's1', 'right')).outcome).toBe('too_many');
  });

  it('refuses an expired code', async () => {
    await issue(ADMIN, 's1', 'right');
    await db.exec(`update mfa_codes set expires_at = now() - interval '1 second'`);
    expect((await check(ADMIN, 's1', 'right')).outcome).toBe('expired');
  });

  it('a code belongs to one user and one sign-in', async () => {
    await issue(ADMIN, 's1', 'right');
    expect((await check(HR, 's1', 'right')).outcome).toBe('none');
    expect((await check(ADMIN, 's2', 'right')).outcome).toBe('none');
  });
});

describe('mfa_required() and the company setting', () => {
  it('is off by default', async () => {
    expect(await required(ADMIN, 's1')).toBe(false);
  });

  it('privileged: admins, HR and checkers until this sign-in passes; staff never', async () => {
    await db.exec(`insert into company_security_settings (tenant_id, two_step) values ('${A}', 'privileged')`);
    expect(await required(ADMIN, 's1')).toBe(true);
    expect(await required(HR, 's1')).toBe(true);
    expect(await required(CHECKER, 's1')).toBe(true);
    expect(await required(STAFF, 's1')).toBe(false);
    await issue(ADMIN, 's1', 'h');
    await check(ADMIN, 's1', 'h');
    expect(await required(ADMIN, 's1')).toBe(false);
    expect(await asSession(ADMIN, 's1', async () => (await one<{ v: boolean }>(`select mfa_satisfied() v`)).v)).toBe(true);
    expect(await required(ADMIN, 's2')).toBe(true); // a new sign-in asks again
    await db.exec(`update mfa_sessions set expires_at = now() - interval '1 second'`);
    expect(await required(ADMIN, 's1')).toBe(true); // and so does an old pass
  });

  it('everyone: staff too', async () => {
    await db.exec(`insert into company_security_settings (tenant_id, two_step) values ('${A}', 'everyone')`);
    expect(await required(STAFF, 's1')).toBe(true);
  });

  it('falls back to the old system_settings switch for a company with no setting yet', async () => {
    await db.exec(`insert into system_settings (id, mfa_enabled, tenant_id) values (1, true, '${A}') on conflict (tenant_id, id) do update set mfa_enabled = true`);
    try {
      expect(await required(ADMIN, 's1')).toBe(true);
      expect(await required(STAFF, 's1')).toBe(false);
      expect(await required(ADMIN_B, 's1')).toBe(false);
    } finally {
      await db.exec(`update system_settings set mfa_enabled = false where tenant_id = '${A}'`);
    }
  });

  it('only an ADMIN changes it, for their own company only', async () => {
    const set = (user: string, mode: string, method = 'email') =>
      asSession(user, 's', () => db.query(`select * from set_two_step_settings($1, $2)`, [mode, method]).then((r) => r.rows[0], (e) => (e as Error).message));
    expect(await set(HR, 'everyone')).toMatch(/Only an administrator/);
    expect(await set(ADMIN, 'sometimes')).toMatch(/Choose off/);
    expect(await set(ADMIN, 'everyone', 'pigeon')).toMatch(/Choose email or SMS/);
    expect(await set(ADMIN, 'everyone', 'sms')).toEqual({ mode: 'everyone', method: 'sms', can_edit: true });
    expect(await asSession(HR, 's', async () => one(`select * from two_step_settings()`))).toEqual({ mode: 'everyone', method: 'sms', can_edit: false });
    // the other company is untouched, and its admin sees only their own setting
    expect(await asSession(ADMIN_B, 's', async () => one(`select * from two_step_settings()`))).toEqual({ mode: 'off', method: 'email', can_edit: true });
    expect(await required(ADMIN_B, 's')).toBe(false);
    expect(await set(ADMIN_B, 'privileged')).toMatchObject({ mode: 'privileged' });
    expect((await db.query(`select tenant_id, two_step from company_security_settings order by tenant_id`)).rows).toEqual([
      { tenant_id: A, two_step: 'everyone' },
      { tenant_id: B, two_step: 'privileged' },
    ]);
  });

  it('the settings table itself is closed to the browser', async () => {
    expect(await denied(ADMIN, `select * from company_security_settings`)).toMatch(/permission denied/);
    expect(await denied(ADMIN, `insert into company_security_settings (two_step) values ('off')`)).toMatch(/permission denied/);
  });
});

describe('migrating the old switch', () => {
  it('a company with mfa_enabled keeps two-step sign-in, by SMS where it had numbers', async () => {
    const migrated = await bootDb({
      file: '20261016010000_mfa_server_side.sql',
      seed: async (d) => {
        await d.exec(`
          insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
          insert into system_settings (id, mfa_enabled, tenant_id) values (1, true, '${A}'), (1, true, '${B}');
          insert into mfa_numbers (email, phone_number, tenant_id) values ('a@a.co', '0711', '${A}');
          insert into mfa_codes (email, code, phone_number, expires_at, tenant_id) values ('a@a.co', '123456', '0711', now(), '${A}');
        `);
      },
    });
    expect((await migrated.query(`select tenant_id, two_step, two_step_method from company_security_settings order by tenant_id`)).rows).toEqual([
      { tenant_id: A, two_step: 'privileged', two_step_method: 'sms' },
      { tenant_id: B, two_step: 'privileged', two_step_method: 'email' },
    ]);
    expect((await migrated.query(`select count(*)::int n from mfa_codes`)).rows[0]).toEqual({ n: 0 }); // plain-text codes gone
    await migrated.close();
  }, 120000);
});
