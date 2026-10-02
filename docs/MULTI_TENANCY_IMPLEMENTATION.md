# Multi-tenancy: what is implemented (FIG-514 / FIG-515 / FIG-516 backend / FIG-653)

Design: [MULTI_TENANCY_RFC.md](MULTI_TENANCY_RFC.md). This page records what was actually built, how to roll it out, and what is still open.

## What exists now

| Piece | Where |
|---|---|
| `tenants`, `current_tenant_id()`, nullable `tenant_id` on every public table, backfilled with one default tenant (`00000000-0000-0000-0000-000000000001`, "Figbloom HR") | `supabase/migrations/20261002000000_tenants_expand.sql` |
| `NOT NULL` + a **restrictive** `tenant_isolation` RLS policy on every tenant table, locked-down `tenants` / `permissions` / `user_profiles`, per-tenant unique keys (`role_permissions.role_name`, `employees."Work Email"`), `security_invoker` views, tenant-aware `has_permission` / `get_user_permissions` / leave resets | `supabase/migrations/20261002000100_tenant_rls.sql` |
| Employee numbers unique **per company** (`EMP-001` can exist in two tenants): composite primary key and foreign keys, an immutable `employees.id`, and a trigger that carries a renumbering into tables that store the number as plain text | `supabase/migrations/20261002000200_employee_number_per_tenant.sql` |
| Admin API scoped to the caller's tenant (list / create / update / delete / reset-email) | `admin_routes.js`, tests in `tests/admin_routes.test.ts` |
| Isolation tests against a real Postgres (PGlite): every table, anon, suspension, helpers, leave resets | `supabase/tests/tenant_isolation.test.ts` (runs in `npm test` and CI) |

The tenant rule is **restrictive**, so it is ANDed with the policies that already exist: intra-tenant rules (chat membership, admin-only writes) keep working, and a stray `USING (true)` policy cannot open a table across tenants.

## Rolling out

1. Take a backup. Run `20261002000000_tenants_expand.sql`, `20261002000100_tenant_rls.sql` and `20261002000200_employee_number_per_tenant.sql` **together**, in that order. The first alone changes no access rules; the second is what isolates tenants; the third needs PostgreSQL 15+ (`ON DELETE SET NULL (col)`).
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

- Per-tenant M-Pesa / email / SMS credentials and callback routing (FIG-652). Until then every backend integration belongs to the default tenant, and `mpesa.js` / `send-birthday-sms` read across tenants.
- Frontend audit for the rest of FIG-517 (upserts naming a changed key, realtime channel names, `rpc()` callers).
- Pre-login flows, the `?org=` sign-up link, onboarding and the tenant-aware shell (FIG-516 frontend, FIG-518, FIG-519).
- Role checks inside a tenant still trust `user_metadata.role`, which a user can edit about themselves (RFC risk 4). Tenant isolation does not depend on it; HR-vs-STAFF restrictions do.
- `training_progress` `(document_id, employee_number)` is still globally unique. It is safe today because `document_id` is a per-document id, but it is reported as `REVIEW:` by the migration.
- `hr_employment_status` is upserted with `onConflict: "Employee Number"` but has no matching unique constraint, so that upsert already fails on the live schema (unrelated to tenancy).

## Tested against the real schema

`supabase/tests/fixtures/live_schema.sql` is a structure-only snapshot (no rows) of the 79 tables, 2 views, 82 policies and 5 functions in `ziradev` as of 2026-10-02. `tenant_isolation_live.test.ts` and `employee_number.test.ts` run the tenant migrations against it, so the production foreign keys and policies are exercised. Regenerate the snapshot when the live schema changes. This found two problems the repo schema hid, both fixed: `hr_contract_settings.tenant_id` already existed as `text` (kept as `legacy_tenant_id`), and `current_leave_policies` needs DROP + CREATE because the live `leave_policies` column order differs.

## Pre-existing exposure worth knowing

The live database has `public` (anonymous-readable) policies on `hr_notifications` (`ALL ... USING (true)`) and `role_permissions` / `permissions` (`SELECT ... USING (true)`). The tenant policy closes the cross-tenant side of that, but anonymous access to `hr_notifications` within a tenant is a separate hole to close (`create policy ... to authenticated`).

## Access inside a company (FIG-657)

Tenant isolation keeps companies apart; these rules keep staff out of each other's records within one company. All of them are enforced in the database (`supabase/migrations/20261002000500...0700`) and covered by tests in `supabase/tests`.

- **Modules decide access.** `has_module()` / `has_any_module()` check the signed-in user's role (from `user_profiles`) against `role_permissions`, the same module list that shows or hides the sidebar screens. ADMIN always passes.
- **Admin-only tables** (payroll flows, loans, statutory deductions, expenses, M-Pesa, terminations...) are reachable only through their modules.
- **Staff-facing tables** (payslips, advances, loan requests, warnings, incident reports, phone changes, dependents, emergency contact) add "own rows": the employee whose Work Email equals the login email.
- **`employees`**: modules that work with employee data read the whole company; everyone else reads only their own row. Staff may edit only personal and statutory details of their own row (a trigger rejects changes to pay, job, status, organisation, contract); unchanged values in a full-row update are fine. Colleague lookups (chat, task assignment, birthdays, dropdown options, approver lookups) use the `employee_directory` view, which has no pay, ID, tax, bank or personal-contact columns.

Known gaps: the statutory deduction fields that affect payroll (`Tax Exempted`, `NSSF/NHIF/Housing Levy Deduction`, `HELB option`, ...) are still self-editable because the Profile page lets staff change them; managers and regional managers see every employee in the company (town/region scoping is still done in the frontend); tiers 1-3 of FIG-657 are done (money and personal records, HR workflow, configuration and performance/asset tables); tier 4 (chat, notifications, todos, logs, mfa, sign-up requests, profiles) still carries the blanket policy.

Tier 3 specifics: `system_settings` holds the Gmail OAuth tokens, so only the settings / email modules can read it; everyone else asks `mfa_required()` for the one boolean they need at sign-in. The two singleton settings tables (`salary_advance_settings`, `system_settings`, both addressed as `id = 1`) now have primary key `(tenant_id, id)` and are upserted on `tenant_id,id`, otherwise only the first company could ever save its settings. Other globally unique natural keys still in place: `clients.client_id` (primary key, referenced by loans and visits) and `regional_managers.email`.

