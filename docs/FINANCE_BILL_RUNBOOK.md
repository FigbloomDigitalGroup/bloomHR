# Finance Bill runbook: changing statutory rates the same day

For the Figbloom team. When a tax, social security or levy rate changes in Kenya, Tanzania or Uganda, we enter it as a
new dated rate on the **Platform rates** screen. We don't change any code. Every company's payroll uses the new rate
from its start date. Months before that date keep their old rates. A company that has set its own rate for that code
keeps its own rate.

How it works (FIG-813, migration `20261021800000_finance_bill_readiness.sql`):

- Every rate is a dated row in `statutory_rates`: PAYE bands, reliefs, percentages, ceilings and levies. That includes
  the per diem share of basic salary (`per_diem_rate`, 33% by default).
- A month's payroll uses the rows in force on the month's last day (`statutory_rates_on`).
- The calculation code holds no copies of any rate. `src/lib/payroll/noHardcodedRates.test.ts` fails if someone adds one.

## 1. Who watches what

Each change below has an owner on the Figbloom team. That person checks the source on the usual dates, and also
whenever a client mentions a change.

| Country | Source | When it usually changes | What it can change (rate codes) |
|---|---|---|---|
| Kenya | **Finance Bill / Finance Act** (National Treasury, Parliament) | Bill read in June, Act assented late June, in force 1 July | `paye_bands`, `personal_relief`, `insurance_relief_*`, deduction caps, `shif_deductible`, `ahl_deductible`, `wht_*` |
| Kenya | **KRA** public notices (kra.go.ke) | Any time, often with the Finance Act or a Tax Laws (Amendment) Act (e.g. 27 Dec 2024) | how the above apply, P10 layout |
| Kenya | **NSSF** (nssf.or.ke): NSSF Act 2013 phase-in | Every February (year 4 from Feb 2026) | `nssf_lower_limit`, `nssf_upper_limit`, `nssf_rate`, `nssf_employer_rate` |
| Kenya | **SHA** (sha.go.ke): Social Health Insurance Act | Any time, by regulation | `shif_rate`, `shif_minimum` |
| Kenya | **NITA**: Industrial Training (Training Levy) Order | Rarely | `nita_levy` |
| Kenya | **Housing Levy** notices (Affordable Housing Act, KRA) | With the Finance Act or a court ruling | `ahl_rate`, `ahl_employer_rate` |
| Tanzania | **Finance Act** (Ministry of Finance, Parliament) | Budget read in June, in force 1 July | `paye_bands`, `nonresident_paye_rate`, `secondary_paye_rate`, `sdl_rate`, `sdl_min_employees`, `wht_*` |
| Tanzania | **TRA** (tra.go.tz) | With the Finance Act; PAYE and SDL guides | the above |
| Tanzania | **NSSF** (nssf.go.tz) | Rarely | `nssf_rate`, `nssf_employer_rate` |
| Tanzania | **WCF** (wcf.go.tz) | By regulation (cut to 0.5% in 2022) | `wcf_rate` |
| Tanzania | **HESLB** (heslb.go.tz) | By amendment to the HESLB Act | `heslb_rate` |
| Uganda | **Finance Act / Income Tax (Amendment) Act** (Parliament, MoFPED) | Budget read in June, in force 1 July, sometimes assented later and **backdated** (the 2026 Act was assented on 20 Aug and applied from 1 July) | `paye_bands`, `paye_bands_non_resident`, `paye_surcharge_*`, `wht_*` |
| Uganda | **URA** (ura.go.ug) public notices | With the Act; PAYE return form changes | the above |
| Uganda | **NSSF Uganda** (nssfug.org) | By amendment to the NSSF Act | `nssf_rate`, `nssf_employer_rate`, `nssf_deductible` |
| Uganda | **Local Service Tax** (Local Governments Act, KCCA and district guides) | Rarely | `lst_bands`, `lst_first_month`, `lst_months`, `lst_deductible` |

Twice a year (June and December), the owner also reads each authority's news page, even when nothing seems to have
changed.

## 2. Who can enter a change: platform admins

Only a **platform admin** can change the platform defaults (the rows with no company). Being a company's ADMIN does
not make someone a platform admin. A platform admin is a row in `platform_admins`, and the table starts empty.

To add the first one, run this in the Supabase SQL editor (or with the service role):

```sql
select public.grant_platform_admin((select id from auth.users where email = 'mikesuperadmin@figbloom.org'), 'Figbloom payroll ops');
```

After that, a platform admin can add or remove others with `grant_platform_admin` and `revoke_platform_admin`.
Nobody can write to `platform_admins` directly.

## 3. Entering a change

1. Sign in as a platform admin and go to **Payroll → Rates**. Choose **Platform rates (Figbloom)**, or open
   `/platform/rates` directly.
2. Choose the country.
3. Find the rate in the list of every version and press **New version**. For a rate the country doesn't have yet, use
   **A rate … doesn't have yet** and type its code. A new code also needs a label in `src/lib/statutoryRates.ts` and
   code that uses it.
4. Enter the new value. Percentages are typed as percentages (2 for 2%). For bands, edit them in the band editor:
   - each band's "up to" must be higher than the one before
   - leave the last band's "up to" empty
5. Enter **From**: the date the law says the change starts, which is often 1 July.
6. Enter **Source**: the Act, section, notice or circular, e.g. "Finance Act 2027, s.12" or "KRA public notice
   45/2027". The source is required and is shown on the Rates tab.
7. Check the **preview**. It shows old and new figures for the month the change starts, for 3 sample salaries in that
   currency (Kenya 30k / 100k / 500k, Tanzania 0.5M / 1.5M / 5M, Uganda 0.5M / 2M / 10M) and one salary you choose:
   - net pay
   - PAYE
   - each deduction
   - employer costs

   The preview runs the country's own payroll engine. Check it against the authority's worked examples where they
   publish them.
8. Press **Save for every company in …**. The database checks everything again:
   - rates are between 0 and 1
   - amounts are not below 0
   - bands go up
   - the source is filled in

   The version in force on that date then ends the day before. A version that starts on the same day as an existing
   one corrects it in place. Every insert or update is recorded in `platform_rate_changes`, with who made it and when.
9. Payroll users then see a banner on the payroll page, e.g. "New Kenya rates from 1 July 2027".

A mistake is corrected by entering the right value with the same From date (it replaces the version in place, and the
change is recorded). Never edit `statutory_rates` by hand: those edits would skip the checks and the audit.

## 4. Checking it: the per-year tests

Each Finance Act year has tests in `src/lib/payroll/financeActYears.test.ts`. They run on the dated rows in
`src/lib/payroll/platformRateRows.ts`, and `supabase/tests/finance_bill_readiness.test.ts` checks that file against the
database. After a change:

1. Add the new row to `platformRateRows.ts`. Also add it to a migration if it should be part of a fresh database:
   copy the values from the screen.
2. Add a test under the country with a worked example from the Act or the authority's guide: one salary before the
   date and one after.
3. Run `npx vitest run src/lib/payroll supabase/tests/finance_bill_readiness.test.ts`.

## 5. Telling customers

- **In the app**: the banner appears for 45 days on the payroll page for companies paying in that country. Each user
  can dismiss it.
- **Email**: for a change that moves net pay (PAYE bands, reliefs, SHIF, NSSF limits), email each company's payroll
  contacts the same day. Say:
  - what changed and from when, with the source
  - that draft payrolls the change reaches must be **recalculated** (the payroll page asks for it)
  - that approved months are not changed
- Note the change in the release notes.

## 6. Recalculating drafts; approved months stay locked

When a draft is saved, the app records the rates each country was worked out with (`payroll_run_rates`). If the rates
in force for that month change later (a new platform version, or the company's own rate), that country is marked
stale:

- The payroll page shows "Rates changed since this was calculated" with a **Recalculate** button.
- Readiness holds the country back. This is a **block**, not a warning, so nobody approves payslips worked out on
  rates that are no longer the law. The database also refuses to approve it until it is recalculated.

**Approved and paid months never change.** Their payslips stay exactly as approved.

## 7. Backdated changes (e.g. Uganda's 2026 Act, applied from 1 July)

1. Enter the change with the backdated **From** date. If any company has already approved a month on or after that
   date, the screen and the database ask you to confirm it.
2. **Draft months** after that date are flagged stale. Companies recalculate them and the new figures apply.
3. **Approved or paid months** keep their payslips. The tax under- or over-deducted for those months is settled
   outside payroll:
   - the company files **amended returns** with the authority (URA asks for amended PAYE returns for the months
     paid before assent)
   - any difference is corrected with the employee, e.g. a one-off deduction or refund in the next open month (add it
     as a voluntary deduction or an earning)
   - a company that prefers to redo a month can reopen it, if no later month depends on it, and then recalculate it
4. Tell the affected companies which months they need to amend (section 5).
