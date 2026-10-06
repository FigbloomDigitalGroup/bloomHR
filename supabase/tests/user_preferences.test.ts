// @vitest-environment node
//
// Per-login preferences (theme, picture): each login reads and writes only its own row, colleagues see only the
// picture (through company_members), and a login can store a picture only under its own id.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const ADMIN = '00000000-0000-0000-0000-00000000ee01';
const ANNA = '00000000-0000-0000-0000-00000000ee02';
const OUTSIDER = '00000000-0000-0000-0000-00000000ee03';

let db: PGlite;
const upload = (name: string) => db.query(`insert into storage.objects (bucket_id, name) values ('employeeavatar', '${name}')`);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as
      $$ select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $$;
    create function storage.filename(name text) returns text language sql immutable as
      $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
    grant usage on schema storage to anon, authenticated;
    grant all on storage.objects to anon, authenticated;
  `);
  // the company-folder policies from before (they supply the "see the object" rule), then ours
  await db.exec(readFileSync(join(__dirname, '..', 'migrations', '20261006000400_employee_avatar_storage.sql'), 'utf8'));
  // re-apply so the storage policies are created against the stand-in
  await db.exec(readFileSync(join(__dirname, '..', 'migrations', '20261006000900_user_preferences.sql'), 'utf8'));
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values ('${ADMIN}', 'admin@a.co'), ('${ANNA}', 'anna@a.co'), ('${OUTSIDER}', 'out@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${ADMIN}', 'admin@a.co', 'ADMIN', '${A}'), ('${ANNA}', 'anna@a.co', 'STAFF', '${A}'), ('${OUTSIDER}', 'out@b.co', 'STAFF', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values ('STAFF', array['dashboard'], '${A}'), ('STAFF', array['dashboard'], '${B}');
  `);
}, 120000);

describe('user_preferences', () => {
  it('a login saves and reads its own theme and picture', async () => {
    await asUser(db, ADMIN, async () => {
      await db.query(`insert into user_preferences (user_id, theme, avatar_url) values ('${ADMIN}', '{"sidebar":"#112233"}', 'https://x/admin.png')`);
      const r = await db.query<{ theme: { sidebar: string } }>(`select theme from user_preferences`);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].theme.sidebar).toBe('#112233');
    });
  });

  it('nobody can read, write or take over someone else’s row', async () => {
    await asUser(db, ANNA, async () => {
      expect((await db.query(`select 1 from user_preferences`)).rows).toHaveLength(0);
      await expect(db.query(`insert into user_preferences (user_id, theme) values ('${ADMIN}', '{}')`)).rejects.toThrow(/row-level security/);
      const upd = await db.query(`update user_preferences set theme = '{}' where user_id = '${ADMIN}' returning 1`);
      expect(upd.rows).toHaveLength(0);
    });
  });

  it('signed-out visitors have no access', async () => {
    await asAnon(db, async () => {
      await expect(db.query(`select 1 from user_preferences`)).rejects.toThrow(/permission denied/);
    });
  });

  it('colleagues see the picture (not the theme) through company_members, other companies see nothing', async () => {
    await asUser(db, ANNA, async () => {
      const r = await db.query<{ email: string; avatar_url: string | null }>(`select email, avatar_url from company_members() order by email`);
      expect(r.rows.find((m) => m.email === 'admin@a.co')?.avatar_url).toBe('https://x/admin.png');
      expect(Object.keys(r.rows[0])).not.toContain('theme');
    });
    await asUser(db, OUTSIDER, async () => {
      const r = await db.query<{ email: string }>(`select email from company_members()`);
      expect(r.rows.map((m) => m.email)).toEqual(['out@b.co']);
    });
  });
});

describe('user avatar storage', () => {
  it('a login stores its picture under its own id, in its own company folder', async () => {
    await asUser(db, ANNA, async () => {
      await expect(upload(`${A}/user_avatars/${ANNA}.png`)).resolves.toBeTruthy();
    });
  });

  it('not under someone else’s id, or in another company’s folder', async () => {
    await asUser(db, ANNA, async () => {
      await expect(upload(`${A}/user_avatars/${ADMIN}.png`)).rejects.toThrow(/row-level security/);
      await expect(upload(`${B}/user_avatars/${ANNA}.png`)).rejects.toThrow(/row-level security/);
    });
  });

  it('and a staff login can remove only its own', async () => {
    await asUser(db, ADMIN, async () => {
      await upload(`${A}/user_avatars/${ADMIN}.jpg`);
    });
    await asUser(db, ANNA, async () => {
      const del = (name: string) => db.query(`delete from storage.objects where name = '${name}' returning 1`);
      expect((await del(`${A}/user_avatars/${ADMIN}.jpg`)).rows).toHaveLength(0);
      expect((await del(`${A}/user_avatars/${ANNA}.png`)).rows).toHaveLength(1);
    });
  });
});
