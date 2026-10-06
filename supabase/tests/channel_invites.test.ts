// @vitest-environment node
//
// Inviting people to a channel: the creator (or an administrator) adds colleagues of the same company, and a private
// channel becomes visible to exactly the people added.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const ADMIN = '00000000-0000-0000-0000-00000000ff01';
const MANAGER = '00000000-0000-0000-0000-00000000ff02';
const ANNA = '00000000-0000-0000-0000-00000000ff03';
const BEN = '00000000-0000-0000-0000-00000000ff04';
const OTHER_MANAGER = '00000000-0000-0000-0000-00000000ff05';
const OUTSIDER = '00000000-0000-0000-0000-00000000ff06';

let db: PGlite;
let channel: string;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const add = (as: string, ch: string, users: string[]) =>
  asUser(db, as, async () => (await db.query<{ n: number }>(`select add_channel_members('${ch}', array[${users.map((u) => `'${u}'::uuid`).join(',')}]::uuid[]) as n`)).rows[0].n);
const visibleTo = (as: string) => asUser(db, as, async () => (await db.query<{ name: string }>(`select name from channels where name = 'leads'`)).rows.length);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    delete from channels;
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values
      ('${ADMIN}', 'admin@a.co'), ('${MANAGER}', 'mgr@a.co'), ('${ANNA}', 'anna@a.co'), ('${BEN}', 'ben@a.co'),
      ('${OTHER_MANAGER}', 'mgr2@a.co'), ('${OUTSIDER}', 'out@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${ADMIN}', 'admin@a.co', 'ADMIN', '${A}'), ('${MANAGER}', 'mgr@a.co', 'MANAGER', '${A}'),
      ('${ANNA}', 'anna@a.co', 'STAFF', '${A}'), ('${BEN}', 'ben@a.co', 'STAFF', '${A}'),
      ('${OTHER_MANAGER}', 'mgr2@a.co', 'MANAGER', '${A}'), ('${OUTSIDER}', 'out@b.co', 'STAFF', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values ('STAFF', array['dashboard'], '${A}'), ('STAFF', array['dashboard'], '${B}');
  `);
  await asUser(db, MANAGER, async () => {
    const r = await db.query<{ id: string }>(`insert into channels (name, type, is_private, created_by) values ('leads', 'channel', true, '${MANAGER}') returning id`);
    channel = r.rows[0].id;
  });
}, 120000);

describe('add_channel_members', () => {
  it('a private channel is hidden from people who were not added', async () => {
    expect(await visibleTo(ANNA)).toBe(0);
    expect(await visibleTo(BEN)).toBe(0);
  });

  it('the creator adds colleagues, who can then see it and write in it', async () => {
    expect(await add(MANAGER, channel, [ANNA])).toBe(1);
    expect(await visibleTo(ANNA)).toBe(1);
    expect(await visibleTo(BEN)).toBe(0);
    await asUser(db, ANNA, async () => {
      await expect(db.query(`insert into messages (channel_id, author_id, content) values ('${channel}', '${ANNA}', 'hello')`)).resolves.toBeTruthy();
    });
    await asUser(db, BEN, async () => {
      expect((await db.query(`select 1 from messages where channel_id = '${channel}'`)).rows).toHaveLength(0);
    });
  });

  it('adding the same person again does nothing', async () => {
    expect(await add(MANAGER, channel, [ANNA, BEN])).toBe(1);
    expect(await add(MANAGER, channel, [ANNA, BEN])).toBe(0);
    expect(await rows(`select 1 from channel_members where channel_id = '${channel}'`)).toHaveLength(2);
  });

  it('an administrator may add people to anyone else’s channel', async () => {
    expect(await add(ADMIN, channel, [OTHER_MANAGER])).toBe(1);
  });

  it('another manager, or a staff member, cannot add people to a channel that is not theirs', async () => {
    await expect(add(OTHER_MANAGER, channel, [ADMIN])).rejects.toThrow(/cannot add people/);
    await expect(add(ANNA, channel, [ADMIN])).rejects.toThrow(/cannot add people/);
  });

  it('people from another company are ignored', async () => {
    expect(await add(MANAGER, channel, [OUTSIDER])).toBe(0);
    expect(await rows(`select 1 from channel_members where user_id = '${OUTSIDER}'`)).toHaveLength(0);
  });

  it('a direct message cannot be extended', async () => {
    await db.exec(`insert into channels (id, name, type, created_by, tenant_id) values ('00000000-0000-0000-0000-00000000dd99', 'dm', 'dm', '${MANAGER}', '${A}')`);
    await expect(add(MANAGER, '00000000-0000-0000-0000-00000000dd99', [ANNA])).rejects.toThrow(/cannot add people/);
  });
});
