// @vitest-environment node
//
// my_unread_counts(): every channel I can see with how many messages in it I have not read, in one query (FIG-817).
// It must agree with the channel rules (only my channels, never another company's) and with my read state.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const ADMIN = '00000000-0000-0000-0000-00000000ee01';
const ANNA = '00000000-0000-0000-0000-00000000ee02';
const BEN = '00000000-0000-0000-0000-00000000ee03';
const CARL = '00000000-0000-0000-0000-00000000ee04';
const OUTSIDER = '00000000-0000-0000-0000-00000000ee05'; // another company

const GENERAL_A = '00000000-0000-0000-0000-0000000c0a01';
const PRIVATE_A = '00000000-0000-0000-0000-0000000c0a02'; // the admin's private channel; Carl is invited
const GENERAL_B = '00000000-0000-0000-0000-0000000c0b01';

let db: PGlite;
let dm: string; // Anna and Ben

const counts = (as: string) =>
  asUser(db, as, async () => {
    const result = await db.query<{ channel_id: string; unread: number }>(`select channel_id, unread from my_unread_counts()`);
    return Object.fromEntries(result.rows.map((r) => [r.channel_id, r.unread]));
  });

/** `n` messages from `author` in `channel`, at `minutesAgo` minutes in the past (as the database, like a send). */
const post = (tenant: string, channel: string, author: string, n: number, minutesAgo: number) =>
  db.exec(`
    insert into messages (tenant_id, channel_id, author_id, content, created_at)
    select '${tenant}', '${channel}', '${author}', 'message ' || i, now() - interval '${minutesAgo} minutes'
    from generate_series(1, ${n}) i;
  `);

const markRead = (user: string, channel: string, minutesAgo: number) =>
  asUser(db, user, () =>
    db.query(`
      insert into user_channel_states (user_id, channel_id, last_read_at)
      values ('${user}', '${channel}', now() - interval '${minutesAgo} minutes')
      on conflict (user_id, channel_id) do update set last_read_at = excluded.last_read_at
    `)
  );

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values
      ('${ADMIN}', 'admin@a.co'), ('${ANNA}', 'anna@a.co'), ('${BEN}', 'ben@a.co'), ('${CARL}', 'carl@a.co'), ('${OUTSIDER}', 'out@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${ADMIN}', 'admin@a.co', 'ADMIN', '${A}'), ('${ANNA}', 'anna@a.co', 'STAFF', '${A}'),
      ('${BEN}', 'ben@a.co', 'STAFF', '${A}'), ('${CARL}', 'carl@a.co', 'STAFF', '${A}'), ('${OUTSIDER}', 'out@b.co', 'STAFF', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values ('STAFF', array['dashboard'], '${A}'), ('STAFF', array['dashboard'], '${B}');
    delete from channels;
    insert into channels (id, tenant_id, name, type, is_private, created_by) values
      ('${GENERAL_A}', '${A}', 'general', 'channel', false, null),
      ('${PRIVATE_A}', '${A}', 'leadership', 'channel', true, '${ADMIN}'),
      ('${GENERAL_B}', '${B}', 'general', 'channel', false, null);
    insert into channel_members (tenant_id, channel_id, user_id) values ('${A}', '${PRIVATE_A}', '${CARL}');
  `);
  dm = await asUser(db, ANNA, async () =>
    (await db.query<{ start_direct_message: string }>(`select start_direct_message('${BEN}')`)).rows[0].start_direct_message
  );

  await post(A, GENERAL_A, BEN, 3, 30);
  await post(A, GENERAL_A, ANNA, 2, 20); // Anna's own: never unread for her
  await post(A, GENERAL_A, BEN, 1, 5);
  await post(A, PRIVATE_A, ADMIN, 4, 10);
  await post(A, dm, BEN, 2, 10);
  await post(B, GENERAL_B, BEN, 7, 10); // (an author id only; Ben cannot see it)
}, 120000);

describe('my_unread_counts', () => {
  it('counts every message in a channel I never opened, except my own', async () => {
    expect(await counts(ANNA)).toEqual({ [GENERAL_A]: 4, [dm]: 2 });
    expect(await counts(BEN)).toEqual({ [GENERAL_A]: 2, [dm]: 0 });
  });

  it('counts only what came after I last read the channel', async () => {
    await markRead(ANNA, GENERAL_A, 15);
    expect((await counts(ANNA))[GENERAL_A]).toBe(1);
    await markRead(ANNA, GENERAL_A, 0);
    expect((await counts(ANNA))[GENERAL_A]).toBe(0);
    // someone else's read state is not mine
    expect((await counts(BEN))[GENERAL_A]).toBe(2);
  });

  it('lists exactly the channels I can see: private ones only if invited, direct messages only my own', async () => {
    for (const person of [ADMIN, ANNA, BEN, CARL, OUTSIDER]) {
      const visible = await asUser(db, person, async () => (await db.query<{ id: string }>(`select id from channels`)).rows.map((r) => r.id));
      expect(Object.keys(await counts(person)).sort()).toEqual(visible.sort());
    }
    expect(Object.keys(await counts(CARL)).sort()).toEqual([GENERAL_A, PRIVATE_A].sort());
    expect((await counts(CARL))[PRIVATE_A]).toBe(4);
    expect(await counts(ADMIN)).not.toHaveProperty(dm); // not even an administrator sees a direct message
  });

  it('never shows another company', async () => {
    expect(await counts(OUTSIDER)).toEqual({ [GENERAL_B]: 7 });
    expect(await counts(ANNA)).not.toHaveProperty(GENERAL_B);
  });

  it('stops counting at 100 (the badge shows 99+)', async () => {
    await post(A, GENERAL_A, BEN, 150, 1);
    expect((await counts(CARL))[GENERAL_A]).toBe(100);
  });

  it('is not open to anonymous callers', async () => {
    await asAnon(db, async () => {
      await expect(db.query(`select * from my_unread_counts()`)).rejects.toThrow(/permission denied/);
    });
  });
});
