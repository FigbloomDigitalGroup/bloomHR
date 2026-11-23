# Figbloom HR

Figbloom HR (bloomHR) is Figbloom's HR and payroll system for companies in East Africa. A company runs its people,
time off, pay and approvals in one place, and every employee gets a staff portal for their own payslips, leave,
requests and tasks.

- Live: https://hr.figbloom.org
- Staging: https://hr-staging.figbloom.org

## What it does

Each company chooses what each role may use. Every screen below is a module that can be switched on or off per role
(Settings > Role Permissions, defined in `src/lib/modules.ts`).

| Area | What's in it |
|---|---|
| **People** | Employee records, departments and the organogram, onboarding (HR and the employee each fill in their part, HR approves), bulk upload, inviting people and creating their logins, managers, recruitment, training videos, contracts, probation, suspensions and exits, staff ID cards |
| **Time** | Leave requests, balances, types, holidays and the leave scheduler; attendance from door scanners; possible absences; disciplinary cases and warnings; incident reports |
| **Pay** | Payroll for Kenya, Uganda and Tanzania (PAYE, NSSF, SHIF/SHA and other statutory deductions, P10 and other returns), payslip design, casual workers, overtime and piece rate, salary advances, staff loans, expenses, requisitions, payments to make, assets |
| **Performance** | KPIs, KPI templates by department, job title or job group, review periods |
| **Workspace** | Task manager and projects, team chat and video calls, SMS and email to staff, connecting your own mailbox |
| **Overview** | Dashboard and company calendar, reports, an AI assistant over the data the person may see |
| **System** | Company settings, audit trail, roles and permissions, two-step sign-in |

Requests (leave, salary advances, loans, expenses, requisitions, exits) go through the company's **approval chains**.

**The staff portal** (`/staff`) is what an employee sees: their payslips, leave, contract, ID card, overtime,
contributions, salary advance and loan requests, resignation, tasks, chat and their team (for supervisors).

## Part of Figbloom

Figbloom HR is one of Figbloom's products, and it shares the platform with them:

- **Sign-in** is Figbloom sign-in (Amazon Cognito): one login across Figbloom products.
- **Figbloom Schools and Fleet** can switch HR on for a customer. HR then creates that company, keeps its staff in
  step with the other product, and sends leave and exits back. Their users open HR with one-click sign-in and see
  their own HR details from inside Schools or Fleet.
- **The Figbloom console** (in this app, for Figbloom staff) manages HR companies, and also shows Fleet companies and
  CRM organisations.

The shared AWS setup (database server, API server, sign-in) lives in the `figbloom-platform` repo. `docs/PLATFORM_EVENTS.md`
describes the events between products.

## How it's built

| Part | Technology | Where it runs |
|---|---|---|
| Web app | React, TypeScript, Vite, Tailwind (`src/`) | Vercel, at hr.figbloom.org |
| API | Node.js and Express (`app.js` and the `*_routes.js` files) | AWS, at hr-api.figbloom.org (`api_server.js`). Attendance, careers and door-scanner traffic still go to the Vercel function (`api/index.js`); see `vercel.json`. |
| Database, storage, edge functions | Supabase, self-hosted on AWS (`supabase/`) | hr-db.figbloom.org (staging: hr-db-staging.figbloom.org) |
| Account security, scanner relay, developer access | AWS CDK (`infra/`) | Figbloom's AWS accounts; see `infra/README.md` |

Most rules (who may see or change what, approval steps, limits) are enforced in the database with row-level security
and triggers, not only in the screens. Payroll calculations per country are in `src/lib/payroll/countries/`.

## Running it locally

You need Node.js 20 and, for a local database, Docker and the Supabase CLI.

```bash
npm ci
cp .env.tenant.template .env.tenant   # then fill in the values you need (see the comments in the file)
supabase start                        # a local database built from supabase/migrations
npm run dev:tenant                    # web app on http://localhost:3003, plus the API
```

| Command | What it does |
|---|---|
| `npm test` | All tests (Vitest), including database tests that run the migrations in PGlite |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, against the recorded baseline of known errors |
| `npm run build` | Production build of the web app |

CI runs lint, typecheck, build and the tests on every pull request.

## Working on it

- **Branches and pull requests:** [CONTRIBUTING.md](CONTRIBUTING.md).
- **Database changes:** add a migration in `supabase/migrations/`. Mike applies it to staging and production before
  the pull request is merged; see [docs/DATABASE_CHANGES.md](docs/DATABASE_CHANGES.md).
- **More documentation** is in [docs/](docs/): onboarding, roles and permissions, multi-tenancy, M-Pesa, the Finance
  Bill runbook and the landing page.
