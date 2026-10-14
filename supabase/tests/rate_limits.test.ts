// @vitest-environment node
//
// Rate limits shared by every server (20261014500100): take_rate_limit() uses a budget atomically, within a sliding
// window, per company and bucket; only the server may call it or read the counts.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const STAFF = '00000000-0000-0000-0000-00000000a301';

let db: PGlite;
const take = async (bucket: string, cost: number, limit = 10, windowSeconds = 3600, tenant = A) =>
  (await db.query<{ ok: boolean }>(`select take_rate_limit($1, $2, $3, $4, $5) as ok`, [tenant, bucket, cost, limit, windowSeconds])).rows[0].ok;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values ('${STAFF}', 'staff@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${STAFF}', 'staff@a.co', 'STAFF', '${A}');
  `);
}, 120000);

beforeEach(async () => {
  await db.exec(`delete from rate_limit_events`);
});

describe('take_rate_limit', () => {
  it('allows up to the limit in the window, then refuses without using anything', async () => {
    expect(await take('ai:u1', 6)).toBe(true);
    expect(await take('ai:u1', 4)).toBe(true);
    expect(await take('ai:u1', 1)).toBe(false);
    expect((await db.query(`select sum(cost)::int as used from rate_limit_events`)).rows[0]).toEqual({ used: 10 });
  });

  it('refuses a single use larger than the whole budget', async () => {
    expect(await take('email:u1', 11)).toBe(false);
    expect(await take('email:u1', 10)).toBe(true);
  });

  it('keeps each bucket and each company separate', async () => {
    expect(await take('ai:u1', 10)).toBe(true);
    expect(await take('ai:u2', 10)).toBe(true);
    expect(await take('ai:u1', 10, 10, 3600, B)).toBe(true);
    expect(await take('ai:u1', 1)).toBe(false);
  });

  it('frees what has dropped out of the window, and deletes it', async () => {
    await db.exec(`insert into rate_limit_events (tenant_id, bucket, cost, at) values ('${A}', 'ai:u1', 10, now() - interval '61 minutes')`);
    expect(await take('ai:u1', 10)).toBe(true);
    expect((await db.query(`select count(*)::int as n from rate_limit_events`)).rows[0]).toEqual({ n: 1 });
  });

  it('counts within a sliding window, not a fixed hour', async () => {
    await db.exec(`insert into rate_limit_events (tenant_id, bucket, cost, at) values ('${A}', 'ai:u1', 10, now() - interval '59 minutes')`);
    expect(await take('ai:u1', 1)).toBe(false);
  });

  it('rejects nonsense arguments', async () => {
    for (const args of [[0, 10, 60], [1, 0, 60], [1, 10, 0], [1, 10, 3 * 86400]]) {
      await expect(take('x', args[0], args[1], args[2])).rejects.toThrow(/invalid arguments/);
    }
    await expect(take('', 1)).rejects.toThrow(/invalid arguments/);
  });

  it('only the server can use or read it', async () => {
    const denied = (sql: string) => asUser(db, STAFF, () => db.query(sql).then(() => '', (e) => (e as Error).message));
    expect(await denied(`select take_rate_limit('${A}', 'ai:x', 1, 10, 60)`)).toMatch(/permission denied/);
    await take('ai:u1', 1);
    const rows = (sql: string) => asUser(db, STAFF, () => db.query(sql).then((r) => r.rows));
    expect(await rows(`select * from rate_limit_events`)).toEqual([]); // no policy lets a signed-in user see any
    expect(await rows(`delete from rate_limit_events returning id`)).toEqual([]);
  });
});
