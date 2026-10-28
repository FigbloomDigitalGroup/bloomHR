// Everything the public landing page says, in one place. The page uses as few words as it can: a short line says what a
// part is for, and the picture of the product does the rest. Claims about the product are Facts: the sentence and the files
// that show the product really does it. landing.test.ts opens each file and refuses wording the owner ruled out (made-up
// numbers, uptime or certification claims, free trials, paying salaries from the app, ...), so a sentence cannot drift away
// from the product without a failing test. Every sentence was also put to skeptics who tried to refute it against the
// code; where it said more than the code does, it was narrowed. When a line is shortened, keep it a narrower version of
// what was checked, never a broader one.
//
// What the page must NOT say, and why (each one was checked against the code):
//   - that Figbloom pays salaries or advances: IN_APP_PAYMENTS is false (src/lib/inAppPayments.ts); finance downloads files
//   - that it files with KRA, SHA, NSSF, TRA or URA: the returns are files for finance to upload
//   - that attendance feeds payroll: leave, overtime and other pay items do; attendance does not
//   - that an approved month "never changes": someone with payroll access can reopen it (a month marked paid stays locked)
//   - that two-step codes come by SMS: nothing in the app registers a phone number for it, so codes arrive by email
//   - "compliant", "accurate", "certified": no sign-off or certificate exists; Tanzania and Uganda say so in their migrations
//   - a list of countries, or "any country": the owner chose not to fence the page in (2026-10-28). Kenya is named only where
//     the thing really is Kenyan (PAYE, SHIF, NSSF, KRA files, P9). Tanzania and Uganda payroll rests on unreviewed
//     assumptions, and a country without an engine is "waiting for its rules" (src/lib/payroll/countries/index.ts)
//   - uptime, support hours, where data is hosted, SOC 2, ISO, ODPC, penetration tests: nothing in the repo backs them
//   - prices, plans, a free trial: none exist (tenants.plan is only a label)
//   - customers, logos, testimonials, numbers of companies or staff: none are published
//   - "the best", "leading", "number one", "faster than ...": no customers, benchmarks or reviews back a ranking, so the page
//     lists what Figbloom is built around (WHY) and lets the visitor check it
//   - Expenses (hidden), e-signatures, mobile apps, SSO, accounting or WhatsApp integrations, posting jobs from the app

/** A claim about the product, with the files that show it. */
export interface Fact {
  text: string;
  evidence: readonly string[];
}
const fact = (text: string, ...evidence: string[]): Fact => ({ text, evidence });

export const SITE = {
  name: 'Figbloom HR',
  legalName: 'Figbloom Digital Group',
  email: 'hr@figbloom.org',
  origin: 'https://hr.figbloom.org',
} as const;

export const LINKS = {
  signIn: '/login',
  create: '/create-company',
  mail: `mailto:${SITE.email}?subject=${encodeURIComponent('Figbloom HR: a walkthrough')}`,
} as const;

export const SEO = {
  title: 'Figbloom HR | HR and payroll in one workspace',
  // index.html carries the same sentence for crawlers that do not run scripts (landing.test.ts keeps them equal)
  description: 'HR and payroll software for employers: employee records, leave, attendance, approvals and monthly payroll in one workspace.',
} as const;

export const CTA = {
  primary: 'Create your company',
  secondary: 'Explore the platform',
  signIn: 'Sign in',
  talk: 'Talk to us',
} as const;

export const NAV = {
  links: [
    { id: 'why', label: 'Why Figbloom' },
    { id: 'how', label: 'How it works' },
    { id: 'roles', label: "Who it's for" },
    { id: 'faq', label: 'FAQ' },
  ],
} as const;

// the headline is set in two weights: the lead in semibold, the tail light
const HERO_LEAD = 'Run your people and your payroll';
const HERO_TAIL = 'from one place.';

export const HERO = {
  eyebrow: 'HR and payroll software',
  lead: HERO_LEAD,
  tail: HERO_TAIL,
  title: `${HERO_LEAD} ${HERO_TAIL}`,
  // the problem first, then what Figbloom does about it
  problem: 'No more chasing for details, approvals and month-end numbers.',
  text: 'Records, leave, attendance, approvals and monthly payroll, together.',
  trust: [
    fact('Optional two-step sign-in', 'mfa_routes.js'),
    fact("Each company's data kept separate", 'supabase/tests/isolation_suite.ts'),
    fact('Roles you define', 'src/lib/roles.ts'),
  ],
} as const;

// A strip of things a visitor can check for themselves. No logos, no numbers.
export const BUILT_IN: { label: string; fact: Fact }[] = [
  { label: 'Payroll', fact: fact("Pay worked out by each branch's country", 'src/lib/payroll/multiCountry.ts', 'src/lib/payroll/countries/index.ts') },
  { label: 'Statutory', fact: fact('Kenyan PAYE, SHIF, NSSF, Housing Levy and NITA', 'src/lib/statutoryCalc.ts') },
  { label: 'Returns', fact: fact('KRA iTax, SHA and NSSF files to upload', 'src/lib/payrollExports.ts') },
  { label: 'History', fact: fact('An audit trail of changes', 'src/lib/auditTrail.ts') },
];

export interface Outcome {
  id: 'records' | 'approvals' | 'month-end' | 'visibility';
  from: string;
  /** the line under "From ...": what changes */
  text: Fact;
}

export const OUTCOMES: Outcome[] = [
  {
    id: 'records',
    from: 'Scattered records',
    text: fact('One approved record for every employee.', 'docs/ONBOARDING.md', 'src/components/Onboarding/OnboardingForm.tsx'),
  },
  {
    id: 'approvals',
    from: 'Chasing approvals',
    text: fact('Approvals that find the right person.', 'src/lib/approvals.ts', 'src/components/Settings/ApprovalWorkflows.tsx'),
  },
  {
    id: 'month-end',
    from: 'Month-end worry',
    text: fact('A payroll you can check before you run it.', 'src/components/Payroll/PayrollDashboard.tsx', 'src/lib/payroll/multiCountry.ts'),
  },
  {
    id: 'visibility',
    from: 'Blind spots',
    text: fact('Who is in, who is away, what is waiting.', 'src/components/Dashboard/Dashboard.tsx', 'src/components/Reports/GroupReport.tsx'),
  },
];

// What sets it apart, said as things a visitor can check and never as a ranking. There are no customers, benchmarks or
// reviews to back "the best", so the page does not say it (landing.test.ts refuses superlatives).
export const WHY = {
  eyebrow: 'Why Figbloom HR',
  title: 'Built around real payroll rules.',
  points: [
    {
      title: 'Local rules, local files',
      text: fact(
        'Kenyan deductions worked out. KRA, SHA and NSSF files laid out.',
        'src/lib/statutoryCalc.ts',
        'src/lib/payrollExports.ts',
        'src/lib/payroll/countries/kenya.ts'
      ),
    },
    {
      title: 'Rates you can read and change',
      text: fact(
        'Every rate is dated and sourced. Set your own for your company.',
        'src/lib/statutoryRates.ts',
        'src/components/Payroll/PayrollRatesTab.tsx',
        'docs/FINANCE_BILL_RUNBOOK.md'
      ),
    },
    {
      title: 'Paid the way people work',
      text: fact(
        'Monthly, daily and piece-rate pay in one workspace.',
        'src/components/Casual/CasualPayRuns.tsx',
        'src/components/PieceRate/PieceRatePage.tsx',
        'src/lib/pieceRate.ts'
      ),
    },
    {
      title: 'One record, hire to payslip',
      text: fact(
        'Hiring, leave, attendance and payroll share one employee record.',
        'docs/ONBOARDING.md',
        'src/lib/leavePay.ts',
        'src/lib/overtimePay.ts'
      ),
    },
    {
      title: 'Shaped to your rules',
      text: fact(
        'Your own roles, approval chains and leave rules.',
        'src/lib/roles.ts',
        'src/lib/approvals.ts',
        'src/lib/leaveRules.ts'
      ),
    },
  ],
  close: 'Check each one in your own workspace.',
} as const;

export type PreviewKey = 'people' | 'leave' | 'attendance' | 'payroll' | 'work' | 'approvals' | 'hiring' | 'performance' | 'portal';

export interface FeatureTab {
  id: PreviewKey;
  label: string;
  title: string;
  benefits: Fact[];
}

export const FEATURES: FeatureTab[] = [
  {
    id: 'people',
    label: 'People',
    title: 'Records people fill in themselves.',
    benefits: [
      fact('Import staff from a spreadsheet. Each person completes their own details.', 'src/lib/bulkEmployees.ts', 'src/components/Payroll/fog.tsx'),
      fact('HR approves each record, or sends it back with a reason.', 'src/components/Onboarding/DocumentsSection.tsx', 'docs/ONBOARDING.md'),
      fact('An organogram you can search, zoom and print.', 'src/components/Employees/Organogram.tsx'),
    ],
  },
  {
    id: 'leave',
    label: 'Leave',
    title: 'Leave rules that match your company.',
    benefits: [
      fact('Rules per leave type: accrual, carry-forward, payout.', 'src/lib/leaveRules.ts', 'src/lib/leaveAccrual.ts'),
      fact('Standard public holidays added for you. You add the rest.', 'src/components/Calendar/CompanyCalendar.tsx'),
      fact('Unpaid and half-pay leave come off the payslip.', 'src/lib/leavePay.ts'),
    ],
  },
  {
    id: 'attendance',
    label: 'Attendance',
    title: 'Attendance against your working hours.',
    benefits: [
      fact('Clock in from the portal or a ZKTeco fingerprint terminal.', 'src/lib/attendance.ts', 'iclock_routes.js', 'src/components/Attendance/Scanners.tsx'),
      fact('Limit app clock-ins to your office network or near a branch.', 'src/components/Attendance/ClockInPolicy.tsx'),
      fact('Missed punches are requested with a reason, then approved.', 'src/components/Attendance/MissedScanApprovals.tsx'),
    ],
  },
  {
    id: 'payroll',
    label: 'Payroll',
    title: 'Run the month with a readiness check.',
    benefits: [
      fact('Kenyan PAYE, SHIF, NSSF, Housing Levy and NITA from dated rates.', 'src/lib/statutoryCalc.ts', 'src/lib/statutoryRates.ts'),
      fact('Return and bulk-pay files for finance to upload.', 'src/lib/payrollExports.ts'),
      fact('Staff read approved payslips in the portal.', 'src/components/staff portal/StaffPortal.tsx', 'src/lib/payslipDesign.ts'),
    ],
  },
  {
    id: 'work',
    label: 'Casual & piece rate',
    title: 'Paid by the day, the piece or the job.',
    benefits: [
      fact(
        'Casual workers: days on a weekly grid, paid in their own pay runs.',
        'src/components/Casual/CasualWorkers.tsx',
        'src/components/Casual/CasualPayRuns.tsx',
        'src/lib/casualPay.ts'
      ),
      fact(
        'Piece rates per kg or crate. Submitted work is approved first.',
        'src/components/PieceRate/WorkTypes.tsx',
        'src/components/PieceRate/DailyEntry.tsx',
        'src/components/PieceRate/WorkApprovals.tsx'
      ),
      fact('Contract jobs are paid once marked done and approved.', 'src/components/PieceRate/ContractJobs.tsx'),
    ],
  },
  {
    id: 'approvals',
    label: 'Approvals',
    title: 'Requests that reach the right person.',
    benefits: [
      fact('Your own chains for leave, advances, loans and requisitions.', 'src/lib/approvals.ts'),
      fact('Paid advances and loans are repaid through payroll.', 'src/lib/salaryAdvance.ts', 'src/lib/loans.ts'),
      fact('Approved payments wait in one list for finance.', 'src/components/Payments/PaymentsToMake.tsx'),
    ],
  },
  {
    id: 'hiring',
    label: 'Hiring',
    title: 'From candidate to accepted offer.',
    benefits: [
      fact('Candidates move through stages you set.', 'src/components/Recruitment/pipeline/RecruitmentPipeline.tsx'),
      fact('Interviews scheduled, panel scorecards recorded.', 'src/components/Recruitment/pipeline/RecruitmentPipeline.tsx'),
      fact('Offer letters sent by private link.', 'src/components/AfterHiring/OffersPage.tsx'),
    ],
  },
  {
    id: 'performance',
    label: 'Performance',
    title: 'Scorecards on your own measures.',
    benefits: [
      fact('KPIs your company defines, weighted into scorecards.', 'src/lib/kpis.ts', 'src/components/Perfomance/KpiPerformancePage.tsx'),
      fact('Some are calculated from tasks and attendance.', 'src/lib/kpis.ts'),
      fact('Warnings from templates, with a history.', 'src/components/Warning/StaffCheck.tsx'),
    ],
  },
  {
    id: 'portal',
    label: 'Staff portal',
    title: 'One place for every employee.',
    benefits: [
      fact('Payslips, leave, requests, documents and profile.', 'src/components/staff portal/StaffPortal.tsx'),
      fact('Kenyan staff download their own P9.', 'src/components/Payroll/DownloadP9.tsx'),
      fact('Works in a phone browser. Nothing to install.', 'src/components/staff portal/StaffMobileHeader.tsx'),
    ],
  },
];

// A line under the showcase for the parts of the menu that have no tab of their own. Only screens that are in the app's menu.
export const ALSO = fact('Also: tasks, video calls, SMS and email, training, assets and reports.', 'src/lib/sidebarMenu.ts', 'src/lib/routeModules.ts');

export const PAYROLL = {
  eyebrow: 'Payroll',
  title: 'Payroll you can check, line by line.',
  text: 'Every rate is a dated row with its source. Read it, or override it for your company.',
  steps: [
    {
      title: 'Check readiness',
      text: fact('Spot missing tax PINs and payment details first.', 'src/lib/missingPayrollDetails.ts', 'src/lib/minimumWage.ts'),
    },
    {
      title: 'Approve by country',
      text: fact('Each country is approved on its own.', 'src/lib/payroll/multiCountry.ts'),
    },
    {
      title: 'Download and upload',
      text: fact('Return and bulk-pay files, laid out for finance to upload.', 'src/lib/payrollExports.ts'),
    },
    {
      title: 'Pay, then mark it paid',
      text: fact("Payroll doesn't send the money. Your team pays, then marks the month paid.", 'src/lib/inAppPayments.ts'),
    },
  ],
  sampleNote: "Sample data, worked out by the product's Kenyan payroll engine.",
} as const;

export const STEPS = [
  {
    title: 'Create your company',
    text: fact('Sign up and become the administrator.', 'src/pages/CreateCompany.tsx'),
  },
  {
    title: 'Set it up',
    text: fact('Add branches, departments, roles and approval chains.', 'src/components/Settings/Branches.tsx', 'src/components/Settings/ApprovalWorkflows.tsx'),
  },
  {
    title: 'Add your people',
    text: fact('Upload a spreadsheet or invite them. HR approves.', 'src/lib/bulkEmployees.ts', 'docs/ONBOARDING.md'),
  },
  {
    title: 'Run the month',
    text: fact('Approve payroll, download the files, pay, mark it paid.', 'src/components/Payroll/PayrollDashboard.tsx'),
  },
] as const;

export interface Role {
  id: 'admin' | 'hr' | 'finance' | 'managers' | 'employees';
  label: string;
  title: string;
  points: Fact[];
}

export const ROLES: Role[] = [
  {
    id: 'admin',
    label: 'Administrators',
    title: 'Set the rules once. Keep a trail of changes.',
    points: [
      fact('Build your own roles from permission modules.', 'src/lib/roles.ts', 'admin_routes.js'),
      fact('An audit trail of changes to records, pay settings and roles.', 'src/lib/auditTrail.ts'),
    ],
  },
  {
    id: 'hr',
    label: 'HR',
    title: 'Onboarding, offers and exits in one place.',
    points: [
      fact("Review each new hire's details and documents.", 'docs/ONBOARDING.md'),
      fact('Run exits through approval, clearance and final dues.', 'src/components/HR/ExitsModule.tsx'),
    ],
  },
  {
    id: 'finance',
    label: 'Finance and payroll',
    title: 'Run the month, then pay it your way.',
    points: [
      fact('Check readiness, approve by country, download files.', 'src/components/Payroll/PayrollDashboard.tsx', 'src/lib/payrollExports.ts'),
      fact('Record how advances, loans and payments were made.', 'src/components/Payments/PaymentsToMake.tsx'),
    ],
  },
  {
    id: 'managers',
    label: 'Managers',
    title: 'Your team, without the spreadsheets.',
    points: [
      fact('See what is waiting for your decision.', 'src/hooks/useWorkBadges.ts', 'src/lib/approvals.ts'),
      fact("Approve your team's leave, overtime and missed scans.", 'src/components/staff portal/MyTeam.tsx'),
    ],
  },
  {
    id: 'employees',
    label: 'Employees',
    title: 'Your leave, payslips and details, on your phone.',
    points: [
      fact('Apply for leave and see your balance first.', 'src/components/staff portal/StaffPortal.tsx'),
      fact('Read your payslips once payroll is approved.', 'src/components/Payroll/DownloadP9.tsx', 'src/components/staff portal/StaffPortal.tsx'),
    ],
  },
];

export const SECURITY = {
  title: 'Sensitive data, handled with care.',
  points: [
    fact("Each company's data is kept apart, and tested on every change.", 'supabase/tests/isolation_suite.ts', 'docs/MULTI_TENANCY_IMPLEMENTATION.md'),
    fact('Roles are checked in the database, not only in the menus.', 'src/lib/routeModules.ts'),
    fact('Optional two-step sign-in with a code sent by email.', 'mfa_routes.js'),
    fact('Signed out after 30 minutes without activity.', 'src/lib/idleLogout.ts'),
    fact('Documents sit in private storage and open by expiring links.', 'supabase/migrations/20261007000100_private_files_storage.sql', 'src/lib/privateFiles.ts'),
  ],
} as const;

export const TALK = {
  eyebrow: 'Pricing and set-up',
  title: 'Talk to us.',
  text: 'Pricing, set-up or moving from spreadsheets? Write to us.',
} as const;

export interface Question {
  q: string;
  a: Fact;
}

export const FAQ: Question[] = [
  {
    q: 'How do we get started?',
    a: fact(
      'Create your company and you become its administrator. Then invite your team or upload a spreadsheet of staff.',
      'src/pages/CreateCompany.tsx',
      'src/components/Dashboard/GetStarted.tsx'
    ),
  },
  {
    q: 'Which countries does payroll cover?',
    a: fact(
      "Kenya's PAYE, SHIF, NSSF, Housing Levy and NITA are built in. Each employee is paid by the rules of their branch's country. Working in another country? Write to us.",
      'src/lib/statutoryCalc.ts',
      'src/lib/payroll/countries/index.ts',
      'src/lib/payroll/usdPay.ts'
    ),
  },
  {
    q: 'Does Figbloom pay our staff?',
    a: fact(
      'No. Figbloom works out pay and produces the bank and mobile-money files. Your finance team uploads them, then marks the month paid.',
      'src/lib/inAppPayments.ts',
      'src/lib/payrollExports.ts'
    ),
  },
  {
    q: 'Can it handle casual and piece-rate workers?',
    a: fact(
      'Yes. They have their own pay runs, with M-Pesa and bank files for your team to upload.',
      'src/components/Casual/CasualPayRuns.tsx',
      'src/components/PieceRate/Payouts.tsx',
      'src/lib/pieceRate.ts'
    ),
  },
  {
    q: 'How are statutory rates kept up to date?',
    a: fact(
      'Every rate is a dated row with a source. Figbloom staff enter changes from official notices, and you can set your own. There is no automatic feed.',
      'docs/FINANCE_BILL_RUNBOOK.md',
      'src/lib/statutoryRates.ts'
    ),
  },
];

// Not a claim about the product, so it has no evidence: prices and set-up are a conversation, not a published fact.
export const PRICING_QUESTION = {
  q: 'What does it cost?',
  a: `Write to ${SITE.email} and we will talk it through.`,
} as const;

export const FINAL = {
  title: 'Bring your HR and payroll into one workspace.',
} as const;

export const FOOTER = {
  tagline: 'HR and payroll in one workspace.',
  illustrative: 'People shown in photographs are illustrative. Product screens show sample data.',
} as const;

/** Every sentence a visitor can read, for the tests that look for words the page must never use. */
export function allCopy(): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      for (const [key, inner] of entries) if (key !== 'evidence' && key !== 'id') walk(inner);
    }
  };
  [SEO, CTA, NAV, HERO, BUILT_IN, OUTCOMES, WHY, FEATURES, ALSO, PAYROLL, STEPS, ROLES, SECURITY, TALK, FAQ, PRICING_QUESTION, FINAL, FOOTER].forEach(walk);
  return out;
}

/** Every Fact on the page, so the test can open the files that back it. */
export function allFacts(): Fact[] {
  const out: Fact[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.text === 'string' && Array.isArray(record.evidence)) out.push(record as unknown as Fact);
      else Object.values(record).forEach(walk);
    }
  };
  [HERO, BUILT_IN, OUTCOMES, WHY, FEATURES, ALSO, PAYROLL, STEPS, ROLES, SECURITY, FAQ].forEach(walk);
  return out;
}
