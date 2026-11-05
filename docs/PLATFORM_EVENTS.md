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
