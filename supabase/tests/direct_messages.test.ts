// @vitest-environment node
//
// Direct messages: a private two-person conversation. The point of these tests is privacy: only the two people can see
// it or write in it. A colleague, an administrator, or someone from another company cannot.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const ADMIN = '00000000-0000-0000-0000-00000000dd01';
const ANNA = '00000000-0000-0000-0000-00000000dd02';
const BEN = '00000000-0000-0000-0000-00000000dd03';
const CARL = '00000000-0000-0000-0000-00000000dd04';
const OUTSIDER = '00000000-0000-0000-0000-00000000dd05'; // another company

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const attempt = async (sql: string) => {
  try {
    await db.query(sql);
    return true;
  } catch {
    return false;
  }
};
const startDm = (as: string, other: string) =>
  asUser(db, as, async () => (await db.query<{ start_direct_message: string }>(`select start_direct_message('${other}')`)).rows[0].start_direct_message);

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
  `);
}, 120000);

describe('who can be messaged', () => {
  it('lists the logins of my own company only', async () => {
    await asUser(db, ANNA, async () => {
      const emails = (await rows<{ email: string }>(`select email from company_members() order by email`)).map((r) => r.email);
      expect(emails).toEqual(['admin@a.co', 'anna@a.co', 'ben@a.co', 'carl@a.co']);
    });
    await asUser(db, OUTSIDER, async () => {
      expect((await rows(`select 1 from company_members()`)).length).toBe(1);
    });
  });
});

describe('starting a conversation', () => {
  it('creates one between two colleagues, and finds the same one from either side, however many times', async () => {
    const first = await startDm(ANNA, BEN);
    expect(await startDm(ANNA, BEN)).toBe(first);
    expect(await startDm(BEN, ANNA)).toBe(first); // symmetric
    expect((await rows(`select 1 from channels where type = 'dm'`)).length).toBe(1);
    expect((await rows(`select 1 from channel_members where channel_id = '${first}'`)).length).toBe(2);
  });

  it('refuses yourself, someone outside the company, an unknown person and a signed-out caller', async () => {
    await asUser(db, ANNA, async () => {
      await expect(db.query(`select start_direct_message('${ANNA}')`)).rejects.toThrow(/someone else/);
      await expect(db.query(`select start_direct_message('${OUTSIDER}')`)).rejects.toThrow(/not in your company/);
      await expect(db.query(`select start_direct_message('00000000-0000-0000-0000-00000000ffff')`)).rejects.toThrow(/not in your company/);
    });
    await expect(db.query(`select start_direct_message('${ANNA}')`)).rejects.toThrow(/Not signed in/);
    await asAnon(db, async () => {
      await expect(db.query(`select start_direct_message('${ANNA}')`)).rejects.toThrow(/permission denied/);
    });
  });

  it('each side sees the other person in their list of conversations', async () => {
    await asUser(db, ANNA, async () => {
      expect((await rows<{ other_email: string }>(`select other_email from my_direct_messages()`)).map((r) => r.other_email)).toEqual(['ben@a.co']);
    });
    await asUser(db, BEN, async () => {
      expect((await rows<{ other_email: string }>(`select other_email from my_direct_messages()`)).map((r) => r.other_email)).toEqual(['anna@a.co']);
    });
    await asUser(db, CARL, async () => {
      expect(await rows(`select 1 from my_direct_messages()`)).toEqual([]);
    });
  });
});

describe('privacy of a conversation', () => {
  let dm: string;
  beforeAll(async () => {
    dm = await startDm(ANNA, BEN);
    await asUser(db, ANNA, async () => {
      await db.query(`insert into messages (channel_id, author_id, content) values ('${dm}', '${ANNA}', 'hi Ben, private')`);
    });
  });

  it('both people can see the conversation and each other’s messages', async () => {
    for (const person of [ANNA, BEN]) {
      await asUser(db, person, async () => {
        expect((await rows(`select 1 from channels where id = '${dm}'`)).length).toBe(1);
        expect((await rows<{ content: string }>(`select content from messages where channel_id = '${dm}'`)).map((r) => r.content)).toEqual(['hi Ben, private']);
      });
    }
  });

  it('Ben can answer, and Anna sees it', async () => {
    await asUser(db, BEN, async () => {
      expect(await attempt(`insert into messages (channel_id, author_id, content) values ('${dm}', '${BEN}', 'hi Anna')`)).toBe(true);
    });
    await asUser(db, ANNA, async () => {
      expect((await rows(`select 1 from messages where channel_id = '${dm}'`)).length).toBe(2);
    });
  });

  it('a colleague cannot see the conversation, read it, or write into it', async () => {
    await asUser(db, CARL, async () => {
      expect(await rows(`select 1 from channels where id = '${dm}'`)).toEqual([]);
      expect(await rows(`select 1 from messages where channel_id = '${dm}'`)).toEqual([]);
      expect(await attempt(`insert into messages (channel_id, author_id, content) values ('${dm}', '${CARL}', 'eavesdrop')`)).toBe(false);
    });
  });

  it('an ADMINISTRATOR cannot read it either, nor join it, nor moderate or delete it', async () => {
    await asUser(db, ADMIN, async () => {
      expect(await rows(`select 1 from channels where id = '${dm}'`)).toEqual([]);
      expect(await rows(`select 1 from messages where channel_id = '${dm}'`)).toEqual([]);
      expect(await attempt(`insert into channel_members (channel_id, user_id) values ('${dm}', '${ADMIN}')`)).toBe(false);
      expect((await rows(`update messages set content = 'edited by admin' where channel_id = '${dm}' returning 1`)).length).toBe(0);
      expect((await rows(`delete from messages where channel_id = '${dm}' returning 1`)).length).toBe(0);
      expect((await rows(`delete from channels where id = '${dm}' returning 1`)).length).toBe(0);
    });
    expect((await rows(`select 1 from messages where channel_id = '${dm}'`)).length).toBe(2); // untouched
  });

  it('another company cannot see it', async () => {
    await asUser(db, OUTSIDER, async () => {
      expect(await rows(`select 1 from channels where id = '${dm}'`)).toEqual([]);
      expect(await rows(`select 1 from messages where channel_id = '${dm}'`)).toEqual([]);
    });
  });

  it('a member cannot add a third person, remove the other, rename it, or delete it', async () => {
    await asUser(db, ANNA, async () => {
      expect(await attempt(`insert into channel_members (channel_id, user_id) values ('${dm}', '${CARL}')`)).toBe(false);
      expect((await rows(`delete from channel_members where channel_id = '${dm}' and user_id = '${BEN}' returning 1`)).length).toBe(0);
      expect((await rows(`update channels set name = 'renamed' where id = '${dm}' returning 1`)).length).toBe(0);
      expect((await rows(`delete from channels where id = '${dm}' returning 1`)).length).toBe(0);
    });
    expect((await rows(`select 1 from channel_members where channel_id = '${dm}'`)).length).toBe(2);
  });

  it('nobody can create a "direct message" channel by hand to bypass the checks', async () => {
    await asUser(db, ANNA, async () => {
      expect(await attempt(`insert into channels (name, type, is_private, created_by) values ('dm', 'dm', true, '${ANNA}')`)).toBe(false);
    });
  });

  it('a message can only be written as yourself', async () => {
    await asUser(db, ANNA, async () => {
      expect(await attempt(`insert into messages (channel_id, author_id, content) values ('${dm}', '${BEN}', 'as Ben')`)).toBe(false);
    });
  });

  it('administrators still moderate ordinary channels', async () => {
    await db.exec(`insert into channels (id, name, type, is_private, created_by, tenant_id) values ('00000000-0000-0000-0000-00000000cc01', 'general', 'channel', false, '${CARL}', '${A}')`);
    await db.exec(`insert into messages (channel_id, author_id, content, tenant_id) values ('00000000-0000-0000-0000-00000000cc01', '${CARL}', 'oops', '${A}')`);
    await asUser(db, ADMIN, async () => {
      expect((await rows(`delete from messages where channel_id = '00000000-0000-0000-0000-00000000cc01' returning 1`)).length).toBe(1);
    });
    // and everyone still sees public channels
    await asUser(db, BEN, async () => {
      expect((await rows(`select 1 from channels where id = '00000000-0000-0000-0000-00000000cc01'`)).length).toBe(1);
    });
  });
});
