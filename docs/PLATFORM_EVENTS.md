# Platform events: Figbloom Schools + HR (phase 1)

What bloomHR does in ERP/SCHOOLS_HR_PHASE1_CONTRACT.md section 2, and how to switch it on.

## What it does

| Event | Where | What HR does |
|---|---|---|
| `platform.module.enabled` (module `hr`) | `POST /api/platform/events` | Creates the school's HR company (`platform_enable_hr()`: active, `tenants.platform_tenant_id` set), queues an ADMIN invitation for each admin listed (sent by the `send-invites` job), then `PUT /tenants/{id}/links/hr` on the platform. A repeat creates and invites nothing and links again. |
| `schools.staff.created` / `.updated` | same | The person's **draft** employee (`platform_upsert_school_staff()`): the company's next Employee Number, name, phone (if valid), work email (only if real and not another employee's), job title, `onboarding_status = 'draft'`, mapped in `external_people (tenant_id, employee_number, 'schools', person_id)`. Never matched by email. |
| `schools.staff.left` | same | Starts HR's exit for the mapped employee (termination, `requested`, last working day = `left_on`). Nothing is deleted. |
| `hr.employee.left` (sent) | `platform_event_outbox`, sent by `POST /api/platform/outbox/flush` | Queued when an exit ends a mapped employee's employment (`complete_exit()`, or the daily job after their last day). Sent as `POST /events` with the HR company as `tenant_local_id`, retried with backoff. |
| anything else | | 200, ignored |

**Draft employees:** HR's onboarding status is the draft flag. Payroll refuses a payslip for anyone whose onboarding
is not `approved` (`salary_history_approved_employee()`), so draft employees are never paid until HR completes and
approves their record.

Every delivery is verified (`x-figbloom-signature` = `sha256=` HMAC of `"<x-figbloom-timestamp>.<raw body>"`, within
5 minutes, constant time) and applied once (`platform_event_receipts`, keyed by `x-figbloom-delivery`). Answers: 200
applied (or already applied, or ignored); 401 bad signature; 400 not a valid event; 425 a staff event for a school
with no HR company yet (the platform retries); 502 the platform couldn't be told (the link; retried); 500 retried;
503 switched off.

In the console, the Schools and School groups pages show **HR & Payroll: Off / Enabling / On** per school, with
**Enable** for Owners and Admins (`approve_companies`). Enable sends `PUT /tenants/{id}/modules/hr` with the school's
admin (Schools' `admin_email`, when real) and the caller's email.

## Settings (Vercel, server only: never `VITE_`)

| Name | Value |
|---|---|
| `PLATFORM_API_URL`, `PLATFORM_TOKEN_URL` | already set for the console |
| `PLATFORM_CLIENT_ID`, `PLATFORM_CLIENT_SECRET` | the `hr` service client (scope `platform/tenants.write`) |
| `PLATFORM_WEBHOOK_SECRET` | `figbloom/platform/webhook/hr` |
| `PLATFORM_OUTBOX_CRON_SECRET` | a random value of 32+ characters, the same as Vault `platform_outbox_cron_secret` |
| `PLATFORM_EVENTS_ENABLED` | `true` to switch on (anything else: 503) |

## Switching on (per environment)

1. Apply the migration (`docs/DATABASE_CHANGES.md`).
2. In the database: `select public.set_platform_outbox_settings('https://<hr site>', '<PLATFORM_OUTBOX_CRON_SECRET>');`
3. Set the Vercel settings above and redeploy.
4. Register HR's event URL once: `ENV_FILE=<file with the settings> node scripts/register-platform-event-webhook.mjs`
   (`PUT /products/hr/event-webhook` with `<SITE_URL>/api/platform/events`).
5. Set `PLATFORM_EVENTS_ENABLED=true`.

## One-click sign-in from Figbloom Schools ("handoff")

What bloomHR does in ERP/SCHOOLS_HR_HANDOFF_CONTRACT.md section 2 (`platform_handoff_routes.js`, migration
`20261106200000_platform_handoff.sql`).

A school admin clicks **HR & Payroll** in Schools; the platform opens `GET /api/platform/handoff?code=...` in their
browser. HR redeems the code (`POST /handoffs/redeem`, the `hr` service client; single use, 60 seconds), finds the HR
company by `tenant_local_id` (it must be the company of that `platform_tenant_id`), then the HR login for this person
in `external_logins (tenant_id, source, external_id, user_id, linked_at)`:

| Case | What happens |
|---|---|
| Linked, and still an active member of that active company | Switched into that company, then signed in as exactly that login: a one-time token from Supabase's admin `generateLink` (magiclink, for that login's own address), sent to the app's `/handoff#token_hash=...&next=...` page, which verifies it (`verifyOtp`) and opens `next`: `return_to` when it is a path on this site, else `/dashboard`. Two-step sign-in still applies when the company asks for it. |
| Linked, but no access (left, suspended, company not active, login blocked) | "You don't have access to HR for this school. Ask your HR administrator." Nobody is signed in. |
| Not linked yet | **Never matched by email.** A pending record (random id, only its SHA-256 kept, 10 minutes, used once, holding the redeemed claims) bound to this browser by an HttpOnly cookie (`fb_hr_handoff`, path `/api/platform/handoff`), then HR's normal sign-in with "Sign in to HR once to connect your Figbloom Schools account". After any normal sign-in (a password, or accepting an invitation and choosing a password) the app shows who would be connected and asks; **Connect** calls `POST /api/platform/handoff/link`, which links the login only if it is an active member of that same company, uses the record up and opens the company (then `return_to`). Another company's login is told so and nothing is linked. |
| Unknown or used code, unknown company, switched off | A page saying so (`/handoff?status=invalid / not_set_up / off / error`). The code is not redeemed when switched off. |

People see and remove their own connection under **Appearance, Connected accounts** (`DELETE
/api/platform/handoff/link`). Every outcome is written to `platform_handoff_log` (never the code, the pending id, the
cookie or the token); links and removals are also in `audit_log`. `external_logins` is readable by its own person only
(row-level security) and written by the backend only.

### Settings (server only: never `VITE_`)

| Name | Value |
|---|---|
| `PLATFORM_HANDOFF_ENABLED` | `true` to switch on; anything else shows "not available yet" |
| `PLATFORM_API_URL`, `PLATFORM_TOKEN_URL`, `PLATFORM_CLIENT_ID`, `PLATFORM_CLIENT_SECRET` | as for the events above (the `hr` service client) |
| `SITE_URL` | the HR website people are sent back to (already set for invitations); without it, the same address |
| `CORS_ORIGIN` | only when the app calls the API from another address (`VITE_API_URL`): the link endpoints then accept the cookie from these origins only |
| `PLATFORM_HANDOFF_URL` | only for the registration script (default `SITE_URL` + `/api/platform/handoff`) |

### Switching on (per environment)

1. Apply the migration (`docs/DATABASE_CHANGES.md`).
2. Deploy the backend and the app with this change.
3. Register HR's handoff URL once: `ENV_FILE=<file with the settings> node scripts/register-platform-handoff-url.mjs`
   (`PUT /products/hr/handoff-url` with `<SITE_URL>/api/platform/handoff`).
4. Set `PLATFORM_HANDOFF_ENABLED=true` on the backend.

## "My HR" for Figbloom Schools staff (phase 2, step 1: view only)

What bloomHR does in ERP/SCHOOLS_HR_PHASE2_CONTRACT.md section 2 (`my_hr_routes.js`, migration
`20261107100000_my_hr_api.sql`). Schools' `my-hr` function calls, server to server, for one of its staff:
`GET /api/integrations/my-hr/<route>` with `Authorization: Bearer <Schools' platform access token>`,
`x-figbloom-school: <Schools tenants.id>` and `x-figbloom-person: <Schools profiles.id>`.

Each call: the switch (off: 503 `my_hr_off`); the token, checked against the platform pool's JWKS (RS256, issuer,
`token_use` access, `client_id` = Schools' client, not expired: else 401 `invalid_token`); the school through the
platform's `GET /links/resolve?module=schools&local_id=<school>` (the `hr` service client, kept 10 minutes; unknown: 403
`school_not_linked`), whose `caller_local_id` must be an active HR company with that `platform_tenant_id` (else 403);
the person only through `external_people (company, 'schools', person)` (else 404 `not_linked`; never by email, never an
employee number from the caller); 120 calls per person per 10 minutes (429); a draft employee (onboarding not approved)
gets `200 {"status": "pending_hr"}` and nothing else. Every call is written to `my_hr_api_log` once its company is
known (company, employee number, route, status; no payload, no token; a per-company table with the usual
`tenant_isolation` policy); calls refused before that (switch, token, school) are only in the server's log.

| Route | Answer (`status: "active"` plus) |
|---|---|
| `GET summary` | `employee` (number, name, job, department, branch, start date, status), `company.name`, `latest_payslip`, `leave_pending` |
| `GET payslips` | `payslips[]`: id, pay_period, country, currency, basic, gross, deductions, net, run_status, approved_at, paid_at. Only months whose country is approved or paid (the staff portal's rule). |
| `GET payslips/:id` | `payslip`: every saved figure of that payslip (as the staff portal reads it), the bank account as `account_number_last4` |
| `GET payslips/:id/pdf` | 501 `pdf_not_available`: HR makes payslip PDFs in the browser (html2pdf); there is no server-side PDF, so Schools renders `payslips/:id` |
| `GET leave` | `leave_types[]`, `balances[]` (per type: available_days free to book today less pending_days, accrued, carried over, used), `applications[]` (status, days, reason, `approval` with each step's label, status, who it waits on, who decided) |
| `GET attendance?from&to` | `days[]` (status present/late/absent/leave/holiday/off, clock in/out, hours, late_minutes), `possible_absence_notices[]`, `missed_scan_requests[]`, `absences_recorded[]`; YYYY-MM-DD, up to 93 days, default the last 30 |
| `GET kpis` | `period` (open now, else the latest out of draft), `items[]` (target, weight, self, final, calculated, `actual`, `achievement`), `overall` (the staff portal's weighted score), `attendance` over the period |

### Settings (server only)

| Name | Value |
|---|---|
| `MY_HR_API_ENABLED` | `true` to answer |
| `PLATFORM_JWKS_URL` | `https://cognito-idp.<region>.amazonaws.com/<pool id>/.well-known/jwks.json` (the platform's customers pool) |
| `PLATFORM_ISSUER` | `https://cognito-idp.<region>.amazonaws.com/<pool id>` |
| `PLATFORM_SCHOOLS_CLIENT_ID` | the Schools service client's app client id |
| `PLATFORM_API_URL`, `PLATFORM_TOKEN_URL`, `PLATFORM_CLIENT_ID`, `PLATFORM_CLIENT_SECRET` | as above (the `hr` service client, for `/links/resolve`) |

### Switching on (per environment)

1. Apply the migration (`docs/DATABASE_CHANGES.md`), then merge.
2. Deploy the backend with this change and the settings above.
3. Set `MY_HR_API_ENABLED=true`; give Schools the URL `<HR API>/api/integrations/my-hr`.
