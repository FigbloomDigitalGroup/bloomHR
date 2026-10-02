// @vitest-environment node
//
// FIG-515 / FIG-653: proves tenant isolation against a real Postgres (PGlite). This run builds the
// schema from master_schema.sql plus every migration in supabase/migrations, i.e. from scratch.
import { bootDb } from './db';
import { defineIsolationSuite } from './isolation_suite';

defineIsolationSuite('tenant isolation (repo schema + all migrations)', () => bootDb());
