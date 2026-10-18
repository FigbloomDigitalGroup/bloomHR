// @vitest-environment node
//
// 20261019900000: anon and authenticated can't TRUNCATE public tables (it empties a table and ignores RLS).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootDb } from './db';

const MIGRATION = readFileSync(join(__dirname, '..', 'migrations', '20261019900000_revoke_truncate.sql'), 'utf8');
const SOMEONE = '11111111-1111-1111-1111-111111111111';

// tables with a TRUNCATE grant left for anon or authenticated
async function truncatable(db: PGlite) {
  const { rows } = await db.query<{ t: string; r: string }>(`
    select c.relname as t, r.rolname as r
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    cross join pg_roles r
    where c.relkind in ('r', 'p') and r.rolname in ('anon', 'authenticated')
      and has_table_privilege(r.rolname, c.oid, 'TRUNCATE')`);
  return rows;
}

describe('no TRUNCATE for anon or authenticated', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await bootDb();
  }, 120_000);

  it('leaves no public table truncatable by the API roles', async () => {
    expect(await truncatable(db)).toEqual([]);
  });

  it('refuses TRUNCATE from a signed-in user and from anon, on the tables that had it', async () => {
    for (const table of ['tenants', 'memberships', 'user_profiles', 'permissions']) {
      await expect(asUser(db, SOMEONE, () => db.exec(`truncate public.${table} cascade`))).rejects.toThrow(/permission denied/);
      await expect(asAnon(db, () => db.exec(`truncate public.${table} cascade`))).rejects.toThrow(/permission denied/);
    }
  });

  it('keeps the ordinary grants (row-level security still decides what rows they get)', async () => {
    const { rows } = await db.query<{ ok: boolean }>(
      `select has_table_privilege('authenticated', 'public.employees', 'SELECT, INSERT, UPDATE, DELETE') as ok`
    );
    expect(rows[0].ok).toBe(true);
  });

  it('gives new tables no TRUNCATE either', async () => {
    await db.exec('create table public.zz_new_table (id int)');
    const { rows } = await db.query<{ ok: boolean }>(
      `select has_table_privilege('authenticated', 'public.zz_new_table', 'TRUNCATE') as ok`
    );
    expect(rows[0].ok).toBe(false);
    await db.exec('drop table public.zz_new_table');
  });

  it('can run again', async () => {
    await db.exec(MIGRATION);
    expect(await truncatable(db)).toEqual([]);
  });
});
