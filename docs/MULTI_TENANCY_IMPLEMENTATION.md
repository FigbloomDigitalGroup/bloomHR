# Multi-tenancy: what is implemented (FIG-514 / FIG-515 / FIG-516 backend / FIG-653)

Design: [MULTI_TENANCY_RFC.md](MULTI_TENANCY_RFC.md). This page records what was actually built, how to roll it out, and what is still open.

## What exists now

| Piece | Where |
|---|---|
| `tenants`, `current_tenant_id()`, nullable `tenant_id` on every public table, backfilled with one default tenant (`00000000-0000-0000-0000-000000000001`, "Figbloom HR") | `supabase/migrations/20261002000000_tenants_expand.sql` |
| `NOT NULL` + a **restrictive** `tenant_isolation` RLS policy on every tenant table, locked-down `tenants` / `permissions` / `user_profiles`, per-tenant unique keys (`role_permissions.role_name`, `employees."Work Email"`), `security_invoker` views, tenant-aware `has_permission` / `get_user_permissions` / leave resets | `supabase/migrations/20261002000100_tenant_rls.sql` |
| Admin API scoped to the caller's tenant (list / create / update / delete / reset-email) | `admin_routes.js`, tests in `tests/admin_routes.test.ts` |
| Isolation tests against a real Postgres (PGlite): every table, anon, suspension, helpers, leave resets | `supabase/tests/tenant_isolation.test.ts` (runs in `npm test` and CI) |

The tenant rule is **restrictive**, so it is ANDed with the policies that already exist: intra-tenant rules (chat membership, admin-only writes) keep working, and a stray `USING (true)` policy cannot open a table across tenants.

## Rolling out

1. Take a backup. Run `20261002000000_tenants_expand.sql`, then `20261002000100_tenant_rls.sql`, **together**. The first alone changes no access rules; the second is what isolates tenants.
2. Read the NOTICE lines from the second migration: each `REVIEW:` line is a unique constraint that is still global.
3. Deploy the backend (`admin_routes.js`, `mpesa.js`) and the frontend from the same release. `RolePermissions.tsx` now upserts on `tenant_id,role_name`.
4. Rename the default tenant (`update tenants set name = '...', slug = '...' where id = '0000...0001'`).

Rollback: drop the `tenant_isolation` policies and `alter column tenant_id drop not null`; the added columns are harmless.

## Behaviour changes to expect

- **Service-role code has no tenant default.** Inserts from the backend must set `tenant_id`. `mpesa.js` stamps `DEFAULT_TENANT_ID` (env, defaults to the tenant above) and `send-birthday-sms` copies the employee's tenant, both until per-tenant routing exists (FIG-652). Any other server-side writer will fail with a NOT NULL error.
- **Anonymous reads are denied** on tenant tables, including anything the live database allowed `anon` to read for the login page (towns, branding). Login-page data must move to a backend endpoint (FIG-516, pre-login flows). `Employee_Records_Duplicate` and `kenya_branches_duplicate` are closed to clients entirely.
- **`user_profiles`, `tenants`, `permissions` are read-only for clients.** Writes go through the backend.
- **Views defined with `select *`** froze their column list before `tenant_id` existed. `current_leave_policies` is re-created by the migration; any other such view in the live database (for example `payroll_records_current`) must be re-created too, or it will not expose `tenant_id`.

## Still open

- `employees."Employee Number"` (and other FK-referenced natural keys) are still globally unique, so two companies cannot both have `EMP-001`. Needs composite keys and FK changes; plan from the live schema.
- Per-tenant M-Pesa / email / SMS credentials and callback routing (FIG-652). Until then every backend integration belongs to the default tenant, and `mpesa.js` / `send-birthday-sms` read across tenants.
- Frontend audit for the rest of FIG-517 (upserts naming a changed key, realtime channel names, `rpc()` callers).
- Pre-login flows, the `?org=` sign-up link, onboarding and the tenant-aware shell (FIG-516 frontend, FIG-518, FIG-519).
- Role checks inside a tenant still trust `user_metadata.role`, which a user can edit about themselves (RFC risk 4). Tenant isolation does not depend on it; HR-vs-STAFF restrictions do.
- The test harness only knows the tables in `master_schema.sql` and `supabase/migrations/`. Tables that exist only in the live database are covered by the same loops, but run the migration against a copy of production first.
