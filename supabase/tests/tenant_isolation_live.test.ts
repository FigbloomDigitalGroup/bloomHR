// @vitest-environment node
//
// Same assertions, but starting from a snapshot of the real ziradev schema (79 tables), the way
// the tenant migrations will meet it in production.
import { bootLiveDb } from './db';
import { defineIsolationSuite } from './isolation_suite';

defineIsolationSuite('tenant isolation (live schema snapshot + tenant migrations)', () => bootLiveDb());
