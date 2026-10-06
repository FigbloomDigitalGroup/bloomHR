// @vitest-environment node
//
// Profile pictures in storage. The test database has no storage schema, so a minimal stand-in (objects table, the
// foldername/filename helpers) is created and the real policy SQL from the migration is applied to it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const STAFF = '00000000-0000-0000-0000-00000000c001'; // EMP-001 in A
const OTHER_STAFF = '00000000-0000-0000-0000-00000000c002'; // EMP-002 in A
const HR = '00000000-0000-0000-0000-00000000c003'; // HR in A
const B_STAFF = '00000000-0000-0000-0000-00000000c004'; // EMP-001 in B

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
  // the real policies, applied to the stand-in
  await db.exec(readFileSync(join(__dirname, '..', 'migrations', '20261006000400_employee_avatar_storage.sql'), 'utf8'));

  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values
      ('${STAFF}', 'one@a.co'), ('${OTHER_STAFF}', 'two@a.co'), ('${HR}', 'hr@a.co'), ('${B_STAFF}', 'one@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${STAFF}', 'one@a.co', 'STAFF', '${A}'), ('${OTHER_STAFF}', 'two@a.co', 'STAFF', '${A}'),
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${B_STAFF}', 'one@b.co', 'STAFF', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('STAFF', array['dashboard'], '${A}'), ('HR', array['employees'], '${A}'), ('STAFF', array['dashboard'], '${B}');
    insert into employees ("Employee Number", "First Name", "Work Email", tenant_id) values
      ('EMP-001', 'One', 'one@a.co', '${A}'), ('EMP-002', 'Two', 'two@a.co', '${A}'), ('EMP-001', 'OneB', 'one@b.co', '${B}');
  `);
}, 120000);

describe('employeeavatar storage policies', () => {
  it('a staff member can save their own picture in their own company’s folder', async () => {
    await asUser(db, STAFF, async () => {
      await expect(upload(`${A}/profile_images/EMP-001.png`)).resolves.toBeTruthy();
    });
  });

  it('and replace it', async () => {
    await asUser(db, STAFF, async () => {
      const r = await db.query(`update storage.objects set name = '${A}/profile_images/EMP-001.png' where name = '${A}/profile_images/EMP-001.png' returning 1`);
      expect(r.rows).toHaveLength(1);
    });
  });

  it('cannot save a picture for a colleague', async () => {
    await asUser(db, STAFF, async () => {
      await expect(upload(`${A}/profile_images/EMP-002.png`)).rejects.toThrow(/row-level security/);
    });
  });

  it('HR can save a picture for anyone in their company', async () => {
    await asUser(db, HR, async () => {
      await expect(upload(`${A}/profile_images/EMP-002.jpg`)).resolves.toBeTruthy();
    });
  });

  it('nobody can write into another company’s folder', async () => {
    await asUser(db, STAFF, async () => {
      await expect(upload(`${B}/profile_images/EMP-001.png`)).rejects.toThrow(/row-level security/);
    });
    await asUser(db, HR, async () => {
      await expect(upload(`${B}/profile_images/EMP-002.png`)).rejects.toThrow(/row-level security/);
    });
  });

  it('two companies can each have an EMP-001 picture without touching each other', async () => {
    await asUser(db, B_STAFF, async () => {
      await expect(upload(`${B}/profile_images/EMP-001.png`)).resolves.toBeTruthy();
    });
    const rows = (await db.query(`select name from storage.objects where name like '%EMP-001.png' order by name`)).rows;
    expect(rows).toHaveLength(2);
  });

  it('the old shared folder (no company in the path) is closed to new uploads', async () => {
    await asUser(db, STAFF, async () => {
      await expect(upload('profile_images/EMP-001.png')).rejects.toThrow(/row-level security/);
    });
  });

  it('other buckets are not affected by these policies', async () => {
    await asUser(db, STAFF, async () => {
      await expect(db.query(`insert into storage.objects (bucket_id, name) values ('documents', '${A}/profile_images/EMP-001.png')`)).rejects.toThrow(/row-level security/);
    });
  });

  it('a person only sees their own company’s pictures through the API, and can remove their own', async () => {
    await asUser(db, STAFF, async () => {
      const seen = (await db.query<{ name: string }>(`select name from storage.objects`)).rows.map((r) => r.name);
      expect(seen.every((n) => n.startsWith(`${A}/`))).toBe(true);
      const removed = await db.query(`delete from storage.objects where name = '${A}/profile_images/EMP-001.png' returning 1`);
      expect(removed.rows).toHaveLength(1);
      const others = await db.query(`delete from storage.objects where name = '${A}/profile_images/EMP-002.jpg' returning 1`);
      expect(others.rows).toHaveLength(0); // not theirs
    });
  });

  it('signed-out visitors cannot upload', async () => {
    await asAnon(db, async () => {
      await expect(upload(`${A}/profile_images/EMP-001.png`)).rejects.toThrow(/permission denied|row-level security/);
    });
  });
});
