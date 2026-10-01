# RFC: Shared-schema multi-tenancy for Figbloom HR

- **Status:** Proposed (FIG-512). Unblocks FIG-514, 515, 516, 517, 518, 519.
- **Decided by the product owner:** one company per login; the tenant is resolved from the login (no subdomains).
- **Audience:** engineers building Sprint 5, and whoever signs off the architecture.

## 1. Decision

Run **one Supabase project and one schema for all companies ("tenants")**. Every tenant-owned row carries a `tenant_id`, and **Postgres row-level security (RLS) enforces isolation**, not application code.

Rejected alternatives:

| Option | Why not |
|---|---|
| Project per tenant (today) | Every new customer needs a Supabase project, a schema run, an env file and a deployment. It does not scale to self-service sign-up and every migration must be applied N times. |
| Schema per tenant | Supabase's API (PostgREST), Realtime and Auth are built around `public`. Per-tenant schemas fight all three and multiply migrations. |

### What we found in the codebase

- 81 tables/views in `public`; only `leave_types` and `hr_contract_settings` have a tenant-like column (nullable, no FK).
- RLS today is `USING (true)` for every authenticated user (`master_schema.sql`, "GLOBAL RLS POLICY GENERATOR"), so **any logged-in user can read every row**.
- 533 `supabase.from(...)` call sites in 87 files, 5 `rpc()` calls, 16 realtime channels, 0 storage calls.
- Per-company settings live in **environment variables**: M-Pesa (consumer key/secret, shortcode, initiator, callback URLs), SMTP/Resend, Celcom/SMS sender.
- Live data is seed/dummy data (19 employees), so there is no production data to migrate today.

## 2. Core design

### 2.1 Tenant and membership

```sql
create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  plan        text not null default 'trial',
  status      text not null default 'active' check (status in ('active','suspended')),
  max_employees integer,            -- NULL = unlimited; billing hook, not enforced in Sprint 5
  created_at  timestamptz not null default now()
);
```

**One company per login:** `user_profiles.tenant_id uuid not null references tenants(id)`. The tenant is a property of the profile, not of the token or the URL.

`user_profiles` must be **writable only by the backend (service role)**. The admin API added in PR #2 already writes it; the frontend must never `update` it. Otherwise a user could move themselves into another tenant.

### 2.2 The one helper everything hangs off

```sql
create function public.current_tenant_id() returns uuid
language sql stable security definer set search_path = public as $$
  select p.tenant_id
  from user_profiles p join tenants t on t.id = p.tenant_id
  where p.user_id = auth.uid() and t.status = 'active'
$$;
```

- Looked up from `user_profiles` on each request rather than trusted from a token claim, so moving or suspending a user or tenant takes effect immediately. (A Supabase custom access-token hook is a possible later optimisation; it is not needed for correctness.)
- Returning `NULL` for a suspended tenant makes every policy fail, giving a **one-line tenant kill switch** for billing.
- Policies call it as `(select current_tenant_id())` so Postgres evaluates it once per query, not per row.

### 2.3 Policy pattern for every tenant table

```sql
alter table t add column tenant_id uuid not null default current_tenant_id() references tenants(id);
create index on t (tenant_id);
alter table t enable row level security;
create policy tenant_isolation on t for all to authenticated
  using      (tenant_id = (select current_tenant_id()))
  with check (tenant_id = (select current_tenant_id()));
```

**The `DEFAULT current_tenant_id()` is the key trick.** Reads are filtered automatically by RLS and inserts are stamped automatically by the default, so **most of the 533 frontend call sites need no change**. FIG-517 shrinks from "add a tenant filter everywhere" to the exceptions in section 5.

Service-role code bypasses RLS and therefore must set `tenant_id` explicitly (section 4).

### 2.4 Table classification (proposed, confirm in FIG-514)

| Class | Tables | Rule |
|---|---|---|
| Global catalogue | `permissions` | No `tenant_id`; read-only for everyone, written by migrations only. |
| Tenant root | `tenants` | A user can read only their own tenant row. Written by backend only. |
| Identity | `user_profiles`, `profiles`, `mfa_numbers`, `mfa_codes`, `user_channel_states`, `notifications` | `tenant_id` set; `user_profiles` write-locked to backend. |
| Tenant config | `role_permissions` (PK becomes `(tenant_id, role_name)`), `leave_types`, `leave_policies`, `company_logo`, `system_settings`, `statutory_settings`, `salary_advance_settings`, `hr_contract_settings`, `sender_id_configs`, `sms_templates` | Copied per tenant when the tenant is created. |
| Tenant data | everything else (`employees`, `leave_application`, `leave_balances`, `payroll_records`, `mpesa_*`, `messages`, `channels`, `assets`, `expenses`, ...) | Standard pattern. |
| Views (believed) | `users`, `current_leave_policies`, `payroll_records_current` | Recreate `with (security_invoker = true)`, otherwise they run as the owner and **bypass RLS**. |
| Legacy | `Employee_Records_Duplicate`, `kenya_branches_duplicate` | Drop once `Login.tsx` no longer falls back to them; do not tenant-ify. |

Reference data (holidays, default leave types, default role permissions) is **copied into each new tenant** rather than shared through `NULL` rows. One rule ("every row has an owner") is easier to secure than two.

## 3. Identifying the tenant (login-based)

- **After login:** the app reads the profile and knows the tenant; there is nothing in the URL. The header "company switcher" becomes a static company name.
- **Before login there is no tenant.** This has real consequences for `Login.tsx`, which today queries `kenya_branches`, `regional_managers`, `employees` and `company_logo` while the user is still anonymous:
  - Branding on the login page is Figbloom's, not the tenant's.
  - Town auto-detection from the typed email must go through a **backend endpoint** (or `security definer` RPC) that returns only the town for a matching email, never rows.
  - **Staff sign-up requests** need a tenant. Each tenant gets an invite link `…/login?org=<slug>` used only for sign-up requests; `staff_signup_requests.tenant_id` is resolved from the slug server-side.
- Supabase Auth emails are globally unique, so the same email cannot belong to two companies. That follows from one-company-per-login and is accepted.

## 4. Backend and service-role code

Service-role code ignores RLS, so each path must scope explicitly. Audit list:

| Path | Change |
|---|---|
| `admin_routes.js` (PR #2) | Derive `tenant_id` from the **caller's profile**; list/create/update/delete only within that tenant; new users are forced into the caller's tenant. This is the main cross-tenant privilege boundary. |
| `mpesa.js`, `email_routes.js`, `sms_routes.js` | Load credentials from `tenant_integrations` (below) using the authenticated caller's tenant instead of `process.env`. |
| M-Pesa callbacks (unauthenticated) | Register a per-tenant callback URL containing an unguessable token (`/api/mpesa/callback/<token>`); map token to tenant server-side. Never trust the payload to identify the tenant. |
| `supabase/functions/send-birthday-sms` | Iterate per tenant, using that tenant's sender settings. |
| `src/pages/webhook.js` | Unused today; delete or scope before use. |

**Per-tenant integrations:** a `tenant_integrations (tenant_id, kind, config)` table with **no client policies** (backend-only). Secrets encrypted at rest (Supabase Vault or app-level AES with the key in server env). Until a tenant has its own M-Pesa configuration, disbursement is disabled for it; email/SMS may use platform credentials at first.

## 5. Frontend changes (FIG-517, much smaller than it looked)

Most queries need no change. The exceptions:

- `upsert(..., { onConflict })` and any conflict target that assumed global uniqueness.
- `select` by natural key that assumed uniqueness (for example `"Employee Number"`, `"Work Email"`).
- Realtime subscriptions (RLS applies, but channel names/filters should not collide across tenants).
- `rpc()` calls: every `security definer` function (`has_permission`, `get_user_permissions`, the leave reset functions) must take the tenant into account.
- The pre-login flows in section 3.

## 6. Uniqueness

Every business-key `UNIQUE` becomes `(tenant_id, key)`: employee number, work email, leave type name, branch name, role name. Otherwise company A can detect that company B uses a value (a leak), or be blocked by it (a bug).

## 7. Onboarding (FIG-518)

A public "Create company" form calls one backend endpoint, rate-limited and captcha-protected, that runs a single transaction `create_tenant(name, slug, admin_email)`:

1. insert the `tenants` row;
2. create the auth user and a `user_profiles` row (role `ADMIN`, that tenant);
3. seed the tenant's `role_permissions`, `leave_types` and `leave_policies`, and the default holidays and settings;
4. send the confirmation/set-password email.

## 8. Migration path

1. **Expand:** create `tenants`; insert one "Figbloom" tenant; add nullable `tenant_id` to every tenant table; backfill everything (including the nullable `leave_types.tenant_id` from the FIG-564 migration, where `NULL` means "the single tenant"); set the column default.
2. **Contract:** `SET NOT NULL`, add FK and index, replace unique constraints, recreate views with `security_invoker`, then swap the blanket RLS policy for the tenant policy.
3. **Mularcredit** runs as its own project today and is unaffected. If it should become a tenant, that is a one-off export/import script keyed by table order; it is out of scope for Sprint 5. `.env.tenant.template` and `docs/TENANT_SETUP_GUIDE.md` are deprecated once step 2 lands.

## 9. Verification (acceptance for FIG-515)

- Seed **two tenants** with a user each. An automated script, run as each user, attempts `select`, `insert`, `update` and `delete` on the other tenant's rows in **every table, view and RPC**, and asserts zero rows or an error. Also run as `anon`.
- A CI check fails the build if any `public` table is not classified, lacks `tenant_id`, lacks RLS enabled, or has no policy.
- Test suspension: setting `tenants.status = 'suspended'` locks every user of that tenant out immediately.

## 10. Risks

1. **Views bypass RLS** unless `security_invoker`. Highest-likelihood leak.
2. **Service-role paths** (section 4) bypass RLS and are the largest remaining audit surface.
3. **Global uniqueness** leaks cross-tenant existence (section 6).
4. **Client-side role checks are not authorisation.** Tenant isolation is enforced in the database, but role restrictions inside a tenant (HR vs STAFF) still live in the frontend; that is a follow-up hardening pass.
5. **Performance:** every tenant table needs a `tenant_id` index; policies must call the helper as `(select ...)`.

## 11. Delivery order

| Step | Issue | Notes |
|---|---|---|
| 0 | FIG-512 | This RFC. |
| 1 | FIG-514 | `tenants`, `current_tenant_id()`, expand migration (generated from a table manifest), backfill. |
| 2 | FIG-515 | Tenant RLS, views, RPCs, two-tenant leak test, CI check. **Do not ship 1 to production without 2.** |
| 3 | FIG-516 | Profile tenant, admin API scoping, sign-up via `?org=`, pre-login endpoints. |
| 4 | FIG-517 | Frontend exceptions in section 5. |
| 5 | FIG-518, 519 | Onboarding; tenant name/logo in the shell. |
| new | *Proposed* | Per-tenant integrations and callback routing (section 4). |
| new | *Proposed* | Leak-test and classification CI check (section 9). |

## 12. Billing (not built now, not blocked)

`tenants.plan`, `tenants.status` and `tenants.max_employees` are the hook points: suspension is already a kill switch through `current_tenant_id()`, and an employee cap can be a `before insert` trigger on `employees`.
