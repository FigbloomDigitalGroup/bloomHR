// @vitest-environment node
//
// Chat replies, reactions and files (20261027300000_chat_replies_media.sql). Who may react, see reactions and open a
// chat's files is whoever may read the chat: a direct message's two people, never a colleague, an administrator or
// another company. A reply quotes a message in the same chat, a file must sit in the chat's own folder, and an edit
// changes only the text.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const ADMIN = '00000000-0000-0000-0000-00000000ee01';
const ANNA = '00000000-0000-0000-0000-00000000ee02';
const BEN = '00000000-0000-0000-0000-00000000ee03';
const CARL = '00000000-0000-0000-0000-00000000ee04';
const OUTSIDER = '00000000-0000-0000-0000-00000000ee05'; // another company
const GENERAL = '00000000-0000-0000-0000-00000000ec01'; // a public channel in company A

const MIGRATION = readFileSync(join(__dirname, '..', 'migrations', '20261027300000_chat_replies_media.sql'), 'utf8');

let db: PGlite;
let dm: string;
let hello: string; // Anna's first message in the conversation

const as = <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) =>
  asUser(db, user, async () => (await db.query<T>(sql, params)).rows);
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const say = async (user: string, channel: string, content: string, opts: { replyTo?: string; files?: unknown[] } = {}) =>
  (await as<{ id: string }>(
    user,
    `insert into messages (channel_id, author_id, content, reply_to, attachments) values ($1, $2, $3, $4, $5::jsonb) returning id`,
    [channel, user, content, opts.replyTo ?? null, JSON.stringify(opts.files ?? [])]
  ))[0].id;

beforeAll(async () => {
  db = await bootLiveDb();
  // the test database has no storage schema: add a stand-in, then run the migration again (it must be safe to) so
  // its bucket policies are created on it
  await db.exec(`
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid());
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as
      $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
    grant usage on schema storage to anon, authenticated;
    grant all on storage.objects to anon, authenticated;
  `);
  await db.exec(MIGRATION);
  await db.exec('reset search_path');
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values
      ('${ADMIN}', 'admin@a.co'), ('${ANNA}', 'anna@a.co'), ('${BEN}', 'ben@a.co'), ('${CARL}', 'carl@a.co'), ('${OUTSIDER}', 'out@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${ADMIN}', 'admin@a.co', 'ADMIN', '${A}'), ('${ANNA}', 'anna@a.co', 'STAFF', '${A}'),
      ('${BEN}', 'ben@a.co', 'STAFF', '${A}'), ('${CARL}', 'carl@a.co', 'STAFF', '${A}'), ('${OUTSIDER}', 'out@b.co', 'STAFF', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('STAFF', array['dashboard'], '${A}'), ('STAFF', array['dashboard'], '${B}'), ('ADMIN', array['dashboard', 'chat-admin'], '${A}');
    delete from channels;
    insert into channels (id, name, type, is_private, created_by, tenant_id) values ('${GENERAL}', 'general', 'channel', false, '${CARL}', '${A}');
  `);
  dm = (await as<{ id: string }>(ANNA, `select start_direct_message($1) as id`, [BEN]))[0].id;
  hello = await say(ANNA, dm, 'hi Ben');
}, 120000);

describe('the migration', () => {
  it('runs again without harm, and publishes reactions for live updates', async () => {
    await db.exec(MIGRATION);
    await db.exec('reset search_path');
    expect(await db.query(`select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'message_reactions'`))
      .toHaveProperty('rows.length', 1);
    expect((await db.query<{ public: boolean }>(`select public from storage.buckets where id = 'chat-attachments'`)).rows).toEqual([{ public: false }]);
  });
});

describe('reactions', () => {
  it('both people in a conversation can react, and see who reacted with what', async () => {
    await as(BEN, `insert into message_reactions (message_id, user_id, emoji) values ($1, $2, '👍')`, [hello, BEN]);
    await as(ANNA, `insert into message_reactions (message_id, user_id, emoji) values ($1, $2, '👍')`, [hello, ANNA]);
    for (const person of [ANNA, BEN]) {
      const seen = await as<{ user_id: string }>(person, `select user_id from message_reactions where message_id = $1 order by user_id`, [hello]);
      expect(seen.map((r) => r.user_id)).toEqual([ANNA, BEN]);
    }
  });

  it('the same person cannot add the same emoji twice, but can add another', async () => {
    expect(await fails(as(BEN, `insert into message_reactions (message_id, user_id, emoji) values ($1, $2, '👍')`, [hello, BEN]))).toMatch(/duplicate|unique/);
    await as(BEN, `insert into message_reactions (message_id, user_id, emoji) values ($1, $2, '❤️')`, [hello, BEN]);
  });

  it('nobody reacts as someone else, or removes someone else’s reaction', async () => {
    expect(await fails(as(ANNA, `insert into message_reactions (message_id, user_id, emoji) values ($1, $2, '😮')`, [hello, BEN]))).toMatch(/row-level security/);
    expect(await as(ANNA, `delete from message_reactions where user_id = $1 returning 1`, [BEN])).toHaveLength(0);
    expect(await as(BEN, `delete from message_reactions where message_id = $1 and user_id = $2 and emoji = '❤️' returning 1`, [hello, BEN])).toHaveLength(1);
  });

  it('a colleague, an administrator and another company cannot see or add reactions in the conversation', async () => {
    for (const person of [CARL, ADMIN, OUTSIDER]) {
      expect(await as(person, `select 1 from message_reactions where message_id = $1`, [hello])).toEqual([]);
      expect(await fails(as(person, `insert into message_reactions (message_id, user_id, emoji) values ($1, $2, '👀')`, [hello, person])))
        .toMatch(/row-level security/);
    }
  });

  it('everyone in the company can react in a public channel; another company cannot', async () => {
    const note = await say(CARL, GENERAL, 'lunch at 1');
    await as(ANNA, `insert into message_reactions (message_id, user_id, emoji) values ($1, $2, '😄')`, [note, ANNA]);
    expect(await as(BEN, `select 1 from message_reactions where message_id = $1`, [note])).toHaveLength(1);
    expect(await as(OUTSIDER, `select 1 from message_reactions where message_id = $1`, [note])).toEqual([]);
  });
});

describe('replies', () => {
  it('a reply quotes a message in the same chat', async () => {
    const reply = await say(BEN, dm, 'hello!', { replyTo: hello });
    expect(await as(ANNA, `select reply_to from messages where id = $1`, [reply])).toEqual([{ reply_to: hello }]);
  });

  it('cannot quote a message from another chat', async () => {
    const elsewhere = await say(CARL, GENERAL, 'in general');
    expect(await fails(say(ANNA, dm, 'sneaky', { replyTo: elsewhere }))).toMatch(/same chat/);
  });

  it('a reply stays when the quoted message is deleted, without its quote', async () => {
    const doomed = await say(ANNA, dm, 'typo');
    const reply = await say(BEN, dm, 'what?', { replyTo: doomed });
    expect(await as(ANNA, `delete from messages where id = $1 returning 1`, [doomed])).toHaveLength(1);
    expect(await as(BEN, `select reply_to from messages where id = $1`, [reply])).toEqual([{ reply_to: null }]);
  });
});

describe('files on messages', () => {
  it('a message can carry files from its own chat’s folder, with or without text', async () => {
    const files = [{ path: `${A}/${dm}/x.png`, name: 'photo.png', type: 'image/png', size: 1200 }];
    const id = await say(ANNA, dm, '', { files });
    expect((await as<{ attachments: unknown[] }>(BEN, `select attachments from messages where id = $1`, [id]))[0].attachments).toHaveLength(1);
  });

  it('cannot point at another chat’s or company’s file, and cannot be empty', async () => {
    for (const path of [`${A}/${GENERAL}/x.png`, `${B}/${dm}/x.png`, `${A}/${dm}/../${GENERAL}/x.png`]) {
      const files = [{ path, name: 'x.png', type: 'image/png', size: 1 }];
      expect(await fails(say(ANNA, dm, 'look', { files }))).toMatch(/folder/);
    }
    expect(await fails(say(ANNA, dm, '   '))).toMatch(/some text or a file/);
  });
});

describe('editing', () => {
  it('the author can change the text, and the message is marked as edited', async () => {
    const id = await say(BEN, dm, 'teh plan');
    await as(BEN, `update messages set content = 'the plan' where id = $1`, [id]);
    expect(await as(ANNA, `select content, is_edited from messages where id = $1`, [id])).toEqual([{ content: 'the plan', is_edited: true }]);
  });

  it('cannot move a message to another chat, change who wrote it, or swap its files', async () => {
    const id = await say(BEN, dm, 'stay here');
    expect(await fails(as(BEN, `update messages set channel_id = $1 where id = $2`, [GENERAL, id]))).toMatch(/Only the text/);
    expect(await fails(as(BEN, `update messages set attachments = $1::jsonb where id = $2`,
      [JSON.stringify([{ path: `${A}/${dm}/y.pdf`, name: 'y.pdf' }]), id]))).toMatch(/files/);
  });

  it('the other person cannot edit or delete it', async () => {
    expect(await as(BEN, `update messages set content = 'changed' where id = $1 returning 1`, [hello])).toHaveLength(0);
    expect(await as(BEN, `delete from messages where id = $1 returning 1`, [hello])).toHaveLength(0);
  });
});

describe('the chat-attachments bucket', () => {
  const put = (user: string, name: string) => as(user, `insert into storage.objects (bucket_id, name) values ('chat-attachments', $1) returning 1`, [name]);
  const list = (user: string, folder: string) => as(user, `select 1 from storage.objects where bucket_id = 'chat-attachments' and name like $1`, [`${folder}/%`]);

  it('the people in a conversation can upload to and open its folder', async () => {
    await put(ANNA, `${A}/${dm}/a.pdf`);
    expect(await list(BEN, `${A}/${dm}`)).toHaveLength(1);
  });

  it('a colleague, an administrator and another company cannot open or upload to it', async () => {
    for (const person of [CARL, ADMIN, OUTSIDER]) {
      expect(await list(person, `${A}/${dm}`)).toEqual([]);
      expect(await fails(put(person, `${A}/${dm}/${person}.pdf`))).toMatch(/row-level security/);
    }
    // nor upload into another company's folder for a chat they can see
    expect(await fails(put(OUTSIDER, `${B}/${GENERAL}/z.pdf`))).toMatch(/row-level security/);
  });

  it('everyone in the company can open a public channel’s files', async () => {
    await put(CARL, `${A}/${GENERAL}/menu.pdf`);
    expect(await list(BEN, `${A}/${GENERAL}`)).toHaveLength(1);
    expect(await list(OUTSIDER, `${A}/${GENERAL}`)).toEqual([]);
  });

  it('only the uploader can delete a file', async () => {
    expect(await as(BEN, `delete from storage.objects where name = $1 returning 1`, [`${A}/${dm}/a.pdf`])).toHaveLength(0);
    expect(await as(ANNA, `delete from storage.objects where name = $1 returning 1`, [`${A}/${dm}/a.pdf`])).toHaveLength(1);
  });
});
