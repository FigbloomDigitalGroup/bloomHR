import { rateOf, type Rates } from './statutoryCalc';

/**
 * How common Kenyan pay items are treated for PAYE: a fixed, cited rules table (deterministic, checked first).
 *
 * The CTO's rule for this product: the legal rules come first. The AI (ai_routes.js, feature "tax_treatment") may only
 * explain or suggest when no rule here matches, and nothing is applied to a pay item without a person confirming it.
 *
 * Wording is kept careful on purpose. Where the answer turns on facts we cannot see (who is covered, whether a
 * payment is a genuine business expense, a daily limit), the treatment is 'depends'. Caps are read from the statutory
 * rates in force (statutory_rates) when they are given, so a Finance Act change needs a new rate row, not a code change.
 */

export type PayItemKind = 'deduction' | 'earning' | 'benefit';

export type TaxTreatment = 'taxable' | 'not_taxable' | 'reduces_taxable_pay' | 'relief' | 'depends';

export const TAX_DISCLAIMER = 'A guide, not tax advice. Confirm with your tax adviser or KRA.';

export const TREATMENT_LABELS: Record<TaxTreatment, string> = {
  taxable: 'Taxable',
  not_taxable: 'Not tax-deductible',
  reduces_taxable_pay: 'Reduces taxable pay',
  relief: 'Tax relief',
  depends: 'Depends',
};

/** The badge label for a treatment. For an earning or benefit, 'not_taxable' means the item is not taxed. */
export const treatmentLabel = (treatment: TaxTreatment, kind: PayItemKind) =>
  treatment === 'not_taxable' && kind !== 'deduction' ? 'Not taxable' : TREATMENT_LABELS[treatment];

export interface TaxRule {
  id: string;
  /** the pay item, as shown to the user */
  title: string;
  /** matched against the item's name, lower-cased; the first rule (in table order) that matches wins */
  keywords: RegExp[];
  /** only for these kinds of item (all kinds when left out) */
  kinds?: PayItemKind[];
  treatment: TaxTreatment;
  /** 1–2 plain-English sentences; "{cap}" is replaced by the monthly cap from capCode, when known */
  explanation: string;
  /** the Act section or KRA guidance it rests on */
  legalBasis: string;
  caveats: string[];
  /** statutory_rates code holding the monthly cap, if the treatment is capped */
  capCode?: string;
  /** for a deduction: where the tax effect is recorded in Figbloom (voluntary deductions are taken after tax) */
  inThisApp?: string;
}

const AFTER_TAX = 'Voluntary deductions are taken from net pay, after PAYE, so this one does not change the tax.';

// Order matters: more specific rules come before broader ones (e.g. "SACCO loan" is a loan, not SACCO savings).
export const TAX_RULES: TaxRule[] = [
  {
    id: 'housing_levy',
    title: 'Affordable Housing Levy',
    keywords: [/housing levy/, /\bahl\b/, /affordable housing/],
    treatment: 'reduces_taxable_pay',
    explanation: "The employee's Affordable Housing Levy is deducted from pay before PAYE is worked out (since 27 December 2024).",
    legalBasis: 'Affordable Housing Act 2024; Income Tax Act as amended by the Tax Laws (Amendment) Act 2024',
    caveats: ['Payroll already handles the levy as a statutory deduction; do not set it up again as a voluntary one.'],
  },
  {
    id: 'shif',
    title: 'SHIF contribution',
    keywords: [/\bshif\b/, /\bsha\b/, /social health/, /\bnhif\b/],
    treatment: 'reduces_taxable_pay',
    explanation: 'SHIF contributions are deducted from pay before PAYE is worked out (since 27 December 2024).',
    legalBasis: 'Social Health Insurance Act 2023; Income Tax Act as amended by the Tax Laws (Amendment) Act 2024',
    caveats: ['Payroll already handles SHIF as a statutory deduction; do not set it up again as a voluntary one.'],
  },
  {
    id: 'nssf',
    title: 'NSSF contribution',
    keywords: [/\bnssf\b/, /social security fund/],
    treatment: 'reduces_taxable_pay',
    explanation: "The employee's NSSF contribution is deducted from pay before PAYE is worked out.",
    legalBasis: 'NSSF Act 2013; Income Tax Act s.22A; Tax Laws (Amendment) Act 2024',
    caveats: [
      'Payroll already takes NSSF as a statutory deduction; a voluntary top-up to NSSF may count towards the pension cap instead.',
    ],
  },
  {
    id: 'post_retirement_medical',
    title: 'Post-retirement medical fund',
    keywords: [/post[\s-]?retirement medical/, /\bprmf\b/],
    kinds: ['deduction'],
    treatment: 'reduces_taxable_pay',
    explanation: 'Contributions to a registered post-retirement medical fund are deducted from taxable pay, up to {cap} a month.',
    legalBasis: 'Income Tax Act as amended by the Tax Laws (Amendment) Act 2024',
    capCode: 'prmf_deduction_cap',
    caveats: ['The fund must be registered.', 'Amounts above the cap are not deductible.'],
    inThisApp: `${AFTER_TAX} To lower PAYE, enter the monthly amount as the employee's post-retirement medical fund contribution in their tax details.`,
  },
  {
    id: 'pension',
    title: 'Registered pension or provident fund',
    keywords: [/pension/, /provident/, /retirement (benefit|scheme|fund|annuity)/, /\bavc\b/, /voluntary contribution/],
    kinds: ['deduction'],
    treatment: 'reduces_taxable_pay',
    explanation:
      "The employee's contributions to a registered pension or provident fund are deducted from taxable pay, up to {cap} a month.",
    legalBasis: 'Income Tax Act s.22A; cap as amended by the Tax Laws (Amendment) Act 2024',
    capCode: 'pension_deduction_cap',
    caveats: [
      'The scheme must be registered with the Retirement Benefits Authority and KRA.',
      'The cap covers all registered schemes together, and amounts above it are not deductible.',
    ],
    inThisApp: `${AFTER_TAX} To lower PAYE, enter the monthly amount as the employee's pension contribution in their tax details.`,
  },
  {
    id: 'mortgage_interest',
    title: 'Mortgage interest (owner-occupied home)',
    keywords: [/mortgage/, /home loan/, /housing loan/],
    kinds: ['deduction'],
    treatment: 'reduces_taxable_pay',
    explanation:
      "Interest on a loan to buy or improve the employee's own home, where they live, is deducted from taxable pay, up to {cap} a month. The capital part of the repayment is not.",
    legalBasis: 'Income Tax Act s.15(3)(b); cap as amended by the Tax Laws (Amendment) Act 2024',
    capCode: 'mortgage_interest_cap',
    caveats: [
      'Only the interest counts, only for one owner-occupied home, and the lender must be one the Act recognises (e.g. a bank or building society).',
    ],
    inThisApp: `${AFTER_TAX} To lower PAYE, enter the monthly interest as the employee's mortgage interest in their tax details.`,
  },
  {
    id: 'helb',
    title: 'HELB loan repayment',
    keywords: [/\bhelb\b/, /higher education loan/],
    treatment: 'not_taxable',
    explanation: 'HELB repayments come out of pay after tax; they do not reduce taxable pay.',
    legalBasis: 'Not an allowable deduction under the Income Tax Act; Higher Education Loans Board Act (employer to remit)',
    caveats: [],
  },
  {
    id: 'salary_advance',
    title: 'Salary advance recovery',
    keywords: [/advance/],
    kinds: ['deduction'],
    treatment: 'not_taxable',
    explanation:
      'Recovering a salary advance does not reduce taxable pay. The pay it advanced is taxed as normal in the month it is earned.',
    legalBasis: 'Income Tax Act s.5 (employment income); KRA PAYE guidance',
    caveats: [],
  },
  {
    id: 'loan_repayment',
    title: 'Loan repayment (SACCO, bank or employer)',
    keywords: [/loan/, /\bcredit\b/, /\bborrow/],
    kinds: ['deduction'],
    treatment: 'not_taxable',
    explanation: 'Loan repayments come out of pay after tax; they do not reduce taxable pay.',
    legalBasis: 'Not an allowable deduction under the Income Tax Act',
    caveats: [
      'A loan from the employer at below the market rate can create fringe benefit tax for the employer (Income Tax Act s.12B).',
    ],
  },
  {
    id: 'sacco',
    title: 'SACCO savings or shares',
    keywords: [/sacco/, /\bshares?\b/, /savings/, /chama/],
    kinds: ['deduction'],
    treatment: 'not_taxable',
    explanation: 'SACCO savings and share contributions come out of pay after tax; they do not reduce taxable pay.',
    legalBasis: 'Not an allowable deduction under the Income Tax Act',
    caveats: [],
  },
  {
    id: 'employer_medical',
    title: 'Medical cover provided by the employer',
    keywords: [/medical/, /health (cover|insurance|scheme)/, /\bhospital/, /outpatient|inpatient/],
    kinds: ['benefit', 'earning'],
    treatment: 'depends',
    explanation:
      "Medical services or insurance the employer provides are not taxed on the employee when the scheme covers all full-time staff. A cash medical allowance is taxable.",
    legalBasis: 'Income Tax Act s.5 (medical benefit exemption); KRA guidance',
    caveats: [
      'For directors who are not full-time employees the exemption may be limited.',
      'Cover given only to some employees may be a taxable benefit.',
    ],
  },
  {
    id: 'insurance',
    title: 'Life, education or health insurance premium',
    keywords: [/insurance/, /assurance/, /\bpolicy\b/, /premium/, /\bcover\b/, /education polic/],
    kinds: ['deduction'],
    treatment: 'relief',
    explanation:
      'The premium does not reduce taxable pay, but the employee gets insurance relief: {rate} of the premium off their PAYE, up to {cap} a month.',
    legalBasis: 'Income Tax Act s.31 (insurance relief)',
    capCode: 'insurance_relief_cap',
    caveats: [
      "The policy must be on the employee's own life or health, or their spouse's or child's.",
      'An education policy must run for at least 10 years. General (property, car) insurance does not qualify.',
    ],
    inThisApp: `${AFTER_TAX} To give the relief, enter the monthly premium as the employee's insurance premium in their tax details.`,
  },
  {
    id: 'union_dues',
    title: 'Trade union dues',
    keywords: [/union/, /\bkuppet\b/, /\bknut\b/, /\bcotu\b/],
    kinds: ['deduction'],
    treatment: 'not_taxable',
    explanation: 'Union dues come out of pay after tax; they do not reduce taxable pay.',
    legalBasis: 'Not an allowable deduction under the Income Tax Act',
    caveats: [],
  },
  {
    id: 'welfare',
    title: 'Welfare, benevolent or harambee contribution',
    keywords: [/welfare/, /benevolent/, /harambee/, /merry[\s-]?go[\s-]?round/],
    kinds: ['deduction'],
    treatment: 'not_taxable',
    explanation: 'Welfare and similar staff contributions come out of pay after tax; they do not reduce taxable pay.',
    legalBasis: 'Not an allowable deduction under the Income Tax Act',
    caveats: [],
  },
  {
    id: 'per_diem',
    title: 'Per diem / subsistence allowance',
    keywords: [/per[\s-]?diem/, /subsistence/, /\bdsa\b/, /daily allowance/, /travel allowance/],
    kinds: ['earning', 'benefit'],
    treatment: 'depends',
    explanation:
      'A per diem paid for days the employee works away from their usual place of work is not taxed up to the exempt daily limit; any amount above it is taxable.',
    legalBasis: 'Income Tax Act s.5 (per diem); exempt daily limit as amended by the Tax Laws (Amendment) Act 2024',
    caveats: [
      'It must be for genuine travel on duty, not a regular allowance paid every month.',
      'Check the current exempt daily limit with KRA; amounts above it are taxable.',
    ],
  },
  {
    id: 'reimbursement',
    title: 'Expense reimbursement',
    keywords: [/reimburse/, /refund/, /expense claim/, /\bclaim\b/, /mileage/],
    kinds: ['earning', 'benefit'],
    treatment: 'depends',
    explanation:
      'Repaying an expense the employee spent wholly and exclusively on the job, backed by receipts, is not taxed. A flat amount paid without receipts is treated as a taxable allowance.',
    legalBasis: 'Income Tax Act s.5 (employment income); KRA guidance on reimbursements',
    caveats: ['Keep the receipts: KRA can treat an unsupported reimbursement as taxable pay.'],
  },
  {
    id: 'meals',
    title: 'Meals provided by the employer',
    keywords: [/\bmeals?\b/, /\bfood\b/, /canteen/, /lunch/],
    kinds: ['earning', 'benefit'],
    treatment: 'depends',
    explanation:
      'Meals the employer provides (in a canteen or through a contracted caterer) are not taxed up to {cap} a month; above that, the whole excess is taxable. A cash meal allowance is taxable.',
    legalBasis: 'Income Tax Act s.5 (meals benefit); limit as amended by the Tax Laws (Amendment) Act 2024',
    capCode: 'meals_exempt_limit',
    caveats: ['The exemption is for meals provided, not for cash paid instead.'],
  },
  {
    id: 'car_benefit',
    title: 'Car benefit',
    keywords: [/\bcar\b/, /vehicle/, /motor/],
    kinds: ['earning', 'benefit'],
    treatment: 'taxable',
    explanation:
      "Private use of an employer's car is a taxable non-cash benefit, valued at the rate the Commissioner prescribes (or the hire cost, for a hired car).",
    legalBasis: 'Income Tax Act s.5(2); Commissioner-prescribed car benefit rates (KRA guidance)',
    caveats: ['A car used only for work, with no private use, is not a benefit. A cash car allowance is taxable as pay.'],
  },
  {
    id: 'housing_benefit',
    title: 'Housing benefit',
    keywords: [/hous/, /\brent\b/, /accommodation/, /quarters/],
    kinds: ['earning', 'benefit'],
    treatment: 'taxable',
    explanation:
      'Housing the employer provides is a taxable benefit, valued under the Act (generally the higher of 15% of total income, the fair market rent, or the rent the employer pays). A cash house allowance is taxable as pay.',
    legalBasis: 'Income Tax Act s.5(2)(b) (housing)',
    caveats: ['Different valuation rules apply to directors, agricultural employees and some other cases.'],
  },
  {
    id: 'gratuity',
    title: 'Gratuity',
    keywords: [/gratuity/, /\bterminal\b/, /severance/, /\bservice pay/],
    kinds: ['earning'],
    treatment: 'depends',
    explanation:
      'Gratuity paid in cash is taxable. Gratuity paid into a registered pension scheme can be tax-free up to the pension limits.',
    legalBasis: 'Income Tax Act s.5 (employment income); Income Tax Act s.22A',
    caveats: ['Lump sums on leaving have their own rules; check with your tax adviser.'],
  },
  {
    id: 'bonus_commission',
    title: 'Bonus, commission or incentive',
    keywords: [/bonus/, /commission/, /incentive/, /overtime/, /\bleave pay/, /allowance/, /arrears/, /\bpiece/, /\btips?\b/, /13th/],
    kinds: ['earning', 'benefit'],
    treatment: 'taxable',
    explanation: 'Bonuses, commissions, incentives, overtime and cash allowances are employment income and taxed through PAYE in the month paid.',
    legalBasis: 'Income Tax Act s.5(2)(a) (employment income)',
    caveats: [],
  },
];

/** lower-case, punctuation to spaces, single spaces */
const normalise = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** The first rule in TAX_RULES that matches the item's name and kind, or null when none does. */
export function findTaxRule(name: string, kind: PayItemKind): TaxRule | null {
  const text = normalise(name);
  if (text.length < 2) return null;
  return TAX_RULES.find((r) => (!r.kinds || r.kinds.includes(kind)) && r.keywords.some((k) => k.test(text))) ?? null;
}

const ksh = (n: number) => `KSh ${n.toLocaleString('en-KE')}`;

/** A rule's explanation with its cap (and, for insurance relief, its rate) filled in from the rates in force. */
export function explainRule(rule: TaxRule, rates?: Rates | null): string {
  const cap = rule.capCode && rates ? rateOf(rates, rule.capCode, NaN) : NaN;
  const rate = rates ? rateOf(rates, 'insurance_relief_rate', NaN) : NaN;
  return rule.explanation
    .replace('{cap}', Number.isFinite(cap) ? ksh(cap) : 'the monthly limit in the statutory rates')
    .replace('{rate}', Number.isFinite(rate) ? `${Math.round(rate * 1000) / 10}%` : 'a set percentage');
}
