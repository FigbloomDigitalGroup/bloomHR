// @vitest-environment node
//
// FIG-515 / FIG-653: proves tenant isolation against a real Postgres (PGlite). This run builds the
// schema built from every migration in supabase/migrations (the live baseline plus later changes), i.e. from scratch.
import { bootDb } from './db';
import { defineIsolationSuite } from './isolation_suite';

defineIsolationSuite('tenant isolation (all migrations, from the live baseline)', () => bootDb());
