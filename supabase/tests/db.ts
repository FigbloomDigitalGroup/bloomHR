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
`;

// The pre-timestamp migrations were applied by hand in dependency order, which is not
// alphabetical (leave_balances needs leave_types). Replay them in that order, between
// the earlier timestamped files and anything dated 2026-10-01 or later.
const LEGACY_ORDER = [
  'leave_types_policies.sql',
  'leave_balances.sql',
  'leave_balances_engine.sql',
  'hr_notifications.sql',
  'leave_notifications.sql',
  'company_events.sql',
  'chat_realtime.sql',
  'chat_rls_fix.sql',
];

export const migrationFiles = () => {
  const all = readdirSync(join(root, 'supabase', 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const stamped = all.filter((f) => /^\d{14}_/.test(f));
  const unknown = all.filter((f) => !stamped.includes(f) && !LEGACY_ORDER.includes(f));
  if (unknown.length) throw new Error(`Add to LEGACY_ORDER in supabase/tests/db.ts: ${unknown.join(', ')}`);
  return [...stamped.filter((f) => f < '20261001'), ...LEGACY_ORDER, ...stamped.filter((f) => f >= '20261001')];
};

/** A throwaway Postgres (PGlite) with the repo schema + all migrations applied. */
export async function bootDb({ upTo }: { upTo?: string } = {}) {
  const db = new PGlite({ extensions: { uuid_ossp } });
  await db.exec(SUPABASE_STUBS);
  await db.exec(readFileSync(join(root, 'master_schema.sql'), 'utf8'));
  for (const file of migrationFiles()) {
    if (upTo && /^\d{14}_/.test(file) && file > upTo) break;
    try {
      await db.exec(readFileSync(join(root, 'supabase', 'migrations', file), 'utf8'));
    } catch (e) {
      throw new Error(`migration ${file} failed: ${(e as Error).message}`);
    }
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
 * Same stack, but starting from a snapshot of the real ziradev schema instead of master_schema.sql:
 * the live tables plus only the tenant migrations (everything older is already part of the snapshot).
 */
export async function bootLiveDb() {
  const db = new PGlite({ extensions: { uuid_ossp } });
  await db.exec(SUPABASE_STUBS);
  await db.exec('create extension if not exists "uuid-ossp"');
  await db.exec(readFileSync(join(root, 'supabase', 'tests', 'fixtures', 'live_schema.sql'), 'utf8'));
  for (const file of migrationFiles().filter((f) => /^\d{14}_/.test(f) && f >= '20261001')) {
    try {
      await db.exec(readFileSync(join(root, 'supabase', 'migrations', file), 'utf8'));
    } catch (e) {
      throw new Error(`migration ${file} failed on the live schema: ${(e as Error).message}`);
    }
  }
  return db;
}
