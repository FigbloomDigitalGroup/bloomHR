# Employee onboarding

An employee record must hold everything the three monthly statutory returns need: KRA PAYE (iTax P10), SHA and NSSF.
Generating those files later is meant to be a direct mapping from the columns below.

Database: `supabase/migrations/20261012100000_employee_onboarding.sql` and `20261012200000_onboarding_payroll_gate.sql`.
App-side checks (the same rules): `src/lib/onboardingValidation.ts`; the screens talk to the database through
`src/lib/onboarding.ts`.

## Flow

```
draft ──start_onboarding──▶ invited ──submit_onboarding──▶ submitted ──review_onboarding('approve')──▶ approved
                                         ▲                     │                                            │
                                         └── changes_requested ◀── review_onboarding('request_changes', comment)
                                                                                                             │
                     employee changes a detail the returns or payments use ──▶ submitted (back to HR) ◀────┘
```

- HR creates the record and fills in the employment and pay part, then invites the employee (`start_onboarding`).
- The employee fills in their part and submits (`submit_onboarding`). It refuses while anything is missing and lists what.
- HR approves (`review_onboarding(id, 'approve')`, which needs HR's part complete too) or sends it back with a comment.
- Only HR (the `employees` module) reviews. Nobody moves the status by editing the record.
- Every step is kept in `employee_onboarding_reviews`. Every change to an employee, emergency contact or next of kin is
  kept in `audit_log` (only the changed fields, who, when). HR reads both, and an employee reads their own review history.
- Only `approved` employees are paid. The database refuses a payslip for anyone else (`20261012200000`), the payroll
  page and the P10 export only take approved employees, and "Not onboarded (N)" on the payroll page lists the rest.
- Only the employee uploads their photo. HR may remove one (the employee uploads a new one) but never sets or replaces
  it (`20261012200100` for storage).

## Screens

- **HR, Onboarding** (`/onboarding`, Team menu, `employees` module): every employee's step and what is still missing
  (theirs and HR's), Invite / Resend invite, and a review panel with Approve, Send back (needs a comment), Edit HR
  details and Print. The print view (`/onboarding/:id/print`) has the company, the employee's name and position and the
  date they submitted.
- **HR, add / edit employee**: the pay and KRA fields ("Type of employee (KRA)", allowances, benefits, pension, PRMF,
  NSSF voluntary). Adding an employee (one by one or in bulk) emails the invitation and marks them invited. No photo
  upload; edit has Remove photo.
- **Employee, staff portal → Onboarding**: personal details, identity and statutory numbers, tax exemptions and
  reliefs, bank details, emergency contact and next of kin, their photo; Save, and Submit to HR. Shows HR's comment
  when it was sent back.
- **Employees list**: an onboarding badge on everyone not yet approved, and an onboarding filter.

## Who enters what

| Entered by HR | Entered by the employee |
|---|---|
| Payroll number (generated, `PR-00001`, can't be edited) | Surname, first name, other names, preferred name |
| Position, type of employee (KRA), payment method | Date of birth, sex, nationality, marital status |
| Basic salary and cash allowances | Residential and permanent address, personal email, phone |
| Car, meals, non-cash, housing and other benefits | Identity type and ID number |
| Other pension, post-retirement medical fund | KRA PIN, SHA number, NSSF number |
| NSSF voluntary contribution | Residency, PWD status and exemption certificate number |
| | Mortgage interest and insurance premiums claimed |
| | Bank name, branch, account name and number, bank and branch codes, paybill |
| | Emergency contact and next of kin |

When an employee changes their names, identity, KRA/SHA/NSSF numbers, phone, residency, PWD details, claims or bank
details on an approved record, it goes back to HR for review.

## Field to return

| Field | Column | P10 (KRA) | SHA | NSSF |
|---|---|---|---|---|
| Payroll number | `Payroll Number` | | PAYROLL NUMBER | PAYROLL NUMBER |
| Surname | `Last Name` | Employee name | LASTNAME | SURNAME |
| First name | `First Name` | Employee name | FIRSTNAME | OTHER NAMES |
| Other names | `Middle Name` | Employee name | | OTHER NAMES |
| Identity type | `Type of Identification` | | IDENTITY TYPE | |
| ID number | `ID Number` | | ID NO | ID NO |
| KRA PIN | `Tax PIN` | Employee PIN | KRA PIN | KRA PIN |
| SHA number | `SHIF Number` | | NHIF NO | |
| NSSF number | `NSSF Number` | | | NSSF NO |
| Phone | `Mobile Number` | | PHONE | |
| Residency | `kra_residency` | Resident | | |
| Type of employee | `kra_employee_type` | Type of Employee | | |
| PWD | `is_pwd` | PWD | | |
| Exemption certificate number | `Disability Cert No` | Exemption certificate No | | |
| Basic salary + cash allowances | `Basic Salary`, `house_allowance`, `travel_allowance`, `hardship`, `other_cash_allowances` | Total cash pay | | |
| Car benefit | `car_benefit` | Value of Car benefit | | |
| Meals | `meals_benefit` | Value of meals | | |
| Non-cash benefit | `non_cash_benefit` | Non cash | | |
| Housing benefit | `housing_benefit` | Housing benefit | | |
| Other benefits | `other_benefits` | Other benefits | | |
| Other pension contribution | `other_pension_contribution` | Other pension contribution | | |
| Post-retirement medical fund | `post_retirement_medical_fund` | Post retirement medical fund | | |
| Mortgage interest | `mortgage_interest` | Mortgage interest | | |
| Insurance premiums | `insurance_premium` | (Insurance relief, calculated) | | |
| NSSF voluntary | `nssf_voluntary_contribution` | | | VOLUNTARY |

Calculated by each payroll run, not stored on the employee: Total gross pay, Social health insurance fund, NSSF, AHL,
Taxable pay, Personal relief, Insurance relief, PAYE, Self assessed PAYE, SHA CONTRIBUTION AMOUNT, NSSF GROSS PAY.

## Rules

- **KRA PIN**: an individual's PIN, `A` + 9 digits + a letter, saved in upper case.
- **ID number** by identity type: National ID 6–9 digits; Alien ID 5–12 letters/digits; Refugee ID 5–20 letters,
  digits, `/` or `-`; Passport 6–9 letters/digits. With no type given (older forms), it is taken as a National ID.
- **Phone**: Kenyan mobile (`07…`, `01…`, `2547…`, `+2547…`) or `+` and a country code. Spaces and dashes are dropped.
- **SHA number**: 4–20 letters, digits or dashes. **NSSF number**: 5–12 characters, digits except that the last may be
  X (a check character, e.g. 206593059X).
- ID number, KRA PIN, SHA number and NSSF number are unique within a company. The same person can be on another
  company's payroll (as a secondary employee).
- Formats are checked when a value is saved or changed, so an older malformed value does not block other edits; the
  missing-details list flags it as "not valid".
- PWD = yes needs the exemption certificate number. Paid by bank needs bank name, branch, account name and number.

## Statutory rates

`statutory_rates` holds every rate, cap and relief with `effective_from` / `effective_to`. Rows without a company are
the defaults; payroll can add its company's own row, which wins from its date. Rates for the same code and company
can't overlap. `statutory_rates_on(date)` returns everything in force that day as `{code: value}` (PAYE bands as a list).

Seeded codes (monthly amounts): `paye_bands`, `personal_relief`, `insurance_relief_rate`, `insurance_relief_cap`,
`pension_deduction_cap`, `prmf_deduction_cap`, `mortgage_interest_cap`, `non_cash_benefit_exempt_limit`,
`meals_exempt_limit`, `pwd_exempt_income`, `shif_deductible`, `ahl_deductible`, `shif_rate`, `shif_minimum`,
`ahl_rate`, `ahl_employer_rate`, `nssf_rate`, `nssf_employer_rate`, `nssf_lower_limit`, `nssf_upper_limit`.
Finance should confirm the seeded values, especially the NSSF limits from February 2026.

## Downloads (payroll page)

Once a month's run is approved, **Statutory returns and bulk payments** offers CSV files with everyone on that month's
payroll (`src/lib/payrollExports.ts`): KRA PAYE (P10), SHA and NSSF, with the column names in the table above, and
bulk-payment files for M-Pesa (`Phone Number` as 2547…, `Name`, `Amount`, `Reference`, `Payroll Number`) and the bank
(`Payroll Number`, `Employee Name`, `Bank`, `Bank Code`, `Branch`, `Branch Code`, `Account Name`, `Account Number`,
`Amount`, `Reference`). Amounts are the payslips' (net pay for bulk payments); employee details are the records'.
Each file lists who is missing a detail it needs before you download it.

The P10's taxable pay is worked out from the payslip and the rates in force that month (NSSF, SHIF and AHL when
deductible, capped pension, PRMF and mortgage interest); PAYE is the payslip's. Until payroll itself reads
`statutory_rates`, KRA's checker may flag a month where the two disagree.

## Documents and referees

`20261012400000_onboarding_documents.sql`, `src/lib/employeeDocuments.ts`.

| Section | Documents (required by default in **bold**) |
|---|---|
| Core attachments | **Proof of identity** (ID or passport, several files), **Passport-size photograph**, **KRA PIN certificate**, **NSSF details**, **SHA membership**, **HELB compliance certificate** |
| Qualifications | **Updated CV**, **Academic certificates** (several), Professional certificates (several), Professional membership or practising licence, Previous employment evidence (several) |
| Role-specific | Driving licence, Police clearance certificate, Medical fitness certificate, Dependants' documents, Beneficiary documents |
| Tax claims | KRA PWD exemption certificate, Mortgage interest statement, Insurance policy: required only while the employee claims the exemption or relief |

- **Who uploads:** only the employee, from Onboarding or the staff portal's Documents tab, into their own folder in the private `documents` bucket. Files can be PDF, Word or photos, up to 10 MB each.
- **HR's view:** in the Onboarding review panel, HR opens each file, then accepts it or rejects it with a reason (the employee sees the reason and uploads again). The employee can remove a file that hasn't been accepted.
- **What's required:** HR sets the company's required documents with **Required documents** on the Onboarding page, and can ask one employee for role-specific ones with **Also ask this employee for** in the review panel.
- **Submitting and approving:** the employee can't submit until every required document has a file that wasn't rejected. HR can't approve until each one is accepted.
- **Referees:** as many as the employee likes (name, organisation, position, phone or email, relationship). At least one is needed.
- **Earlier uploads:** files uploaded on the old Documents tab became documents here, waiting for HR.
