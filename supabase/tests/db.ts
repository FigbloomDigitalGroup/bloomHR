import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';

const root = join(__dirname, '..', '..');

// Minimal stand-ins for what Supabase provides: roles, the auth schema, auth.uid().
const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable
    as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
  create function auth.jwt() returns jsonb language sql stable
    as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, jsonb_build_object('sub', auth.uid())) $$;
  create publication supabase_realtime;
  -- Supabase grants new public tables to the API roles by default; mirror that.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  -- Supabase installs extensions in their own schema; the dumped schema refers to them there.
  create schema if not exists extensions;
  create extension if not exists "uuid-ossp" with schema extensions;
  grant usage on schema extensions to anon, authenticated, service_role;
`;

/** Every migration, in the order `supabase db push` applies them: the baseline of the live schema, then the rest. */
export const migrationFiles = () => {
  const all = readdirSync(join(root, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql'));
  const unstamped = all.filter((f) => !/^\d{14}_/.test(f));
  if (unstamped.length) throw new Error(`Migrations need a timestamp prefix (YYYYMMDDHHMMSS_name.sql): ${unstamped.join(', ')}`);
  return all.sort();
};

/** A throwaway Postgres (PGlite) built the way a fresh project is: every migration in supabase/migrations, in order. */
export async function bootDb() {
  const db = new PGlite({ extensions: { uuid_ossp } });
  await db.exec(SUPABASE_STUBS);
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(join(root, 'supabase', 'migrations', file), 'utf8'));
    } catch (e) {
      throw new Error(`migration ${file} failed: ${(e as Error).message}`);
    }
    // the dumped baseline clears the session's search_path; `db push` starts each file in a fresh session
    await db.exec('reset search_path; reset check_function_bodies; reset row_security');
  }
  return db;
}

/** Run SQL as a Supabase end user (role authenticated + JWT sub), then restore the superuser. */
export async function asUser<T>(
  db: PGlite,
  userId: string,
  fn: () => Promise<T>,
  userMetadata: Record<string, unknown> = {}
): Promise<T> {
  const claims = JSON.stringify({ sub: userId, user_metadata: userMetadata }).replace(/'/g, "''");
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false), set_config('request.jwt.claims', '${claims}', false)`
  );
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)`);
  }
}

export async function asAnon<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false)`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}

/**
 * The same database without the seeded default roles, so a test can set up exactly the roles it needs (the tests
 * written against the old schema snapshot, which had no rows, insert their own).
 */
export async function bootLiveDb() {
  const db = await bootDb();
  await db.exec(`delete from public.role_permissions where tenant_id = '00000000-0000-0000-0000-000000000001'`);
  return db;
}
