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
