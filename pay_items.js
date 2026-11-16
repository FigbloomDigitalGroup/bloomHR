// pay_items.js - how pay items are treated for Kenyan PAYE, and the order a Kenyan payslip is worked out in, for the HR
// assistant (ai_routes.js). With hr_law.js it lets the assistant answer like a payroll consultant: whether something is
// taxable, tax-free or deductible, whether it comes off before or after PAYE, and up to what cap.
//
// KENYA_PAY_ITEMS is the same table as TAX_RULES in src/lib/kenyaTaxTreatment.ts (the pay items page uses that one);
// the server cannot import TypeScript, so it is copied here and tests/pay_items.test.ts fails if the two differ. Change
// both together. Caps are not written here: "{cap}" (the statutory_rates code in capCode) and "{rate}" (the insurance
// relief rate) are filled from the statutory rates in force, so a Finance Act change needs a new rate row, not code.
//
// KENYA_PAYSLIP_ORDER follows the payroll engine (src/lib/statutoryCalc.ts and lib/payslipCalc), so what the assistant
// says matches what payroll does. Tanzania and Uganda have no table yet: the assistant says it has no cited rule.

export const KENYA_PAY_ITEMS = [
  {
    id: "housing_levy",
    title: "Affordable Housing Levy",
    keywords: [/housing levy/, /\bahl\b/, /affordable housing/],
    treatment: "reduces_taxable_pay",
    explanation:
      "The employee's Affordable Housing Levy is deducted from pay before PAYE is worked out (since 27 December 2024).",
    legalBasis: "Affordable Housing Act 2024; Income Tax Act as amended by the Tax Laws (Amendment) Act 2024",
    caveats: [
      "Payroll already handles the levy as a statutory deduction; do not set it up again as a voluntary one.",
    ],
    goAhead: { status: "no", note: "Payroll already takes this as a statutory deduction. Do not set it up again." },
  },
  {
    id: "shif",
    title: "SHIF contribution",
    keywords: [/\bshif\b/, /\bsha\b/, /social health/, /\bnhif\b/],
    treatment: "reduces_taxable_pay",
    explanation:
      "SHIF contributions are deducted from pay before PAYE is worked out (since 27 December 2024).",
    legalBasis: "Social Health Insurance Act 2023; Income Tax Act as amended by the Tax Laws (Amendment) Act 2024",
    caveats: [
      "Payroll already handles SHIF as a statutory deduction; do not set it up again as a voluntary one.",
    ],
    goAhead: { status: "no", note: "Payroll already takes this as a statutory deduction. Do not set it up again." },
  },
  {
    id: "nssf",
    title: "NSSF contribution",
    keywords: [/\bnssf\b/, /social security fund/],
    treatment: "reduces_taxable_pay",
    explanation:
      "The employee's NSSF contribution is deducted from pay before PAYE is worked out.",
    legalBasis: "NSSF Act 2013; Income Tax Act s.22A; Tax Laws (Amendment) Act 2024",
    caveats: [
      "Payroll already takes NSSF as a statutory deduction; a voluntary top-up to NSSF may count towards the pension cap instead.",
    ],
    goAhead: { status: "no", note: "Payroll already takes this as a statutory deduction. Do not set it up again." },
  },
  {
    id: "wiba_deduction",
    title: "WIBA cover (work injury insurance)",
    keywords: [/\bwiba\b/, /work (place )?injur/, /workmen/],
    kinds: ["deduction"],
    treatment: "not_taxable",
    explanation:
      "Insuring employees against work injuries is the employer's duty and cost under the Work Injury Benefits Act; it should not be taken from the employee's pay.",
    legalBasis: "Work Injury Benefits Act 2007 s.7 (employer to insure)",
    caveats: [],
    goAhead: { status: "no", note: "WIBA cover is the employer's cost. Do not deduct it from pay; add it as a benefit if you want it on record." },
  },
  {
    id: "wiba",
    title: "WIBA cover (work injury insurance)",
    keywords: [/\bwiba\b/, /work (place )?injur/, /workmen/],
    kinds: ["benefit","earning"],
    treatment: "not_taxable",
    explanation:
      "WIBA cover the employer buys for its employees is the employer's legal duty, not a benefit to the employee, so it is not taxed on them.",
    legalBasis: "Work Injury Benefits Act 2007 s.7 (employer to insure); Income Tax Act s.5",
    caveats: [
      "A cash payment to the employee in place of cover would be taxable pay.",
    ],
  },
  {
    id: "employer_pension",
    title: "Employer's pension or provident fund contribution",
    keywords: [/pension/, /provident/, /retirement (benefit|scheme|fund)/],
    kinds: ["benefit","earning"],
    treatment: "depends",
    explanation:
      "The employer's contributions to a registered pension or provident fund for the employee are not taxed on them up to {cap} a month; above that, or to a scheme that is not registered, they are taxable.",
    legalBasis: "Income Tax Act s.5 and s.22A; limit as amended by the Tax Laws (Amendment) Act 2024",
    capCode: "pension_deduction_cap",
    caveats: [
      "The scheme must be registered with the Retirement Benefits Authority and KRA.",
      "Payroll taxes the whole amount while it is marked taxable or 'Depends'; mark it 'Not taxable' only for a registered scheme within the limit.",
    ],
  },
  {
    id: "post_retirement_medical",
    title: "Post-retirement medical fund",
    keywords: [/post[\s-]?retirement medical/, /\bprmf\b/],
    kinds: ["deduction"],
    treatment: "reduces_taxable_pay",
    explanation:
      "Contributions to a registered post-retirement medical fund are deducted from taxable pay, up to {cap} a month.",
    legalBasis: "Income Tax Act as amended by the Tax Laws (Amendment) Act 2024",
    capCode: "prmf_deduction_cap",
    caveats: [
      "The fund must be registered.",
      "Amounts above the cap are not deductible.",
    ],
    inThisApp: "Voluntary deductions are taken from net pay, after PAYE, so this one does not change the tax. To lower PAYE, enter the monthly amount as the employee's post-retirement medical fund contribution in their tax details.",
  },
  {
    id: "pension",
    title: "Registered pension or provident fund",
    keywords: [/pension/, /provident/, /retirement (benefit|scheme|fund|annuity)/, /\bavc\b/, /voluntary contribution/],
    kinds: ["deduction"],
    treatment: "reduces_taxable_pay",
    explanation:
      "The employee's contributions to a registered pension or provident fund are deducted from taxable pay, up to {cap} a month.",
    legalBasis: "Income Tax Act s.22A; cap as amended by the Tax Laws (Amendment) Act 2024",
    capCode: "pension_deduction_cap",
    caveats: [
      "The scheme must be registered with the Retirement Benefits Authority and KRA.",
      "The cap covers all registered schemes together, and amounts above it are not deductible.",
    ],
    inThisApp: "Voluntary deductions are taken from net pay, after PAYE, so this one does not change the tax. To lower PAYE, enter the monthly amount as the employee's pension contribution in their tax details.",
  },
  {
    id: "mortgage_interest",
    title: "Mortgage interest (owner-occupied home)",
    keywords: [/mortgage/, /home loan/, /housing loan/],
    kinds: ["deduction"],
    treatment: "reduces_taxable_pay",
    explanation:
      "Interest on a loan to buy or improve the employee's own home, where they live, is deducted from taxable pay, up to {cap} a month. The capital part of the repayment is not.",
    legalBasis: "Income Tax Act s.15(3)(b); cap as amended by the Tax Laws (Amendment) Act 2024",
    capCode: "mortgage_interest_cap",
    caveats: [
      "Only the interest counts, only for one owner-occupied home, and the lender must be one the Act recognises (e.g. a bank or building society).",
    ],
    inThisApp: "Voluntary deductions are taken from net pay, after PAYE, so this one does not change the tax. To lower PAYE, enter the monthly interest as the employee's mortgage interest in their tax details.",
  },
  {
    id: "helb",
    title: "HELB loan repayment",
    keywords: [/\bhelb\b/, /higher education loan/],
    treatment: "not_taxable",
    explanation:
      "HELB repayments come out of pay after tax; they do not reduce taxable pay.",
    legalBasis: "Not an allowable deduction under the Income Tax Act; Higher Education Loans Board Act (employer to remit)",
    caveats: [],
  },
  {
    id: "salary_advance",
    title: "Salary advance recovery",
    keywords: [/advance/],
    kinds: ["deduction"],
    treatment: "not_taxable",
    explanation:
      "Recovering a salary advance does not reduce taxable pay. The pay it advanced is taxed as normal in the month it is earned.",
    legalBasis: "Income Tax Act s.5 (employment income); KRA PAYE guidance",
    caveats: [],
  },
  {
    id: "loan_repayment",
    title: "Loan repayment (SACCO, bank or employer)",
    keywords: [/loan/, /\bcredit\b/, /\bborrow/],
    kinds: ["deduction"],
    treatment: "not_taxable",
    explanation:
      "Loan repayments come out of pay after tax; they do not reduce taxable pay.",
    legalBasis: "Not an allowable deduction under the Income Tax Act",
    caveats: [
      "A loan from the employer at below the market rate can create fringe benefit tax for the employer (Income Tax Act s.12B).",
    ],
  },
  {
    id: "sacco",
    title: "SACCO savings or shares",
    keywords: [/sacco/, /\bshares?\b/, /savings/, /chama/],
    kinds: ["deduction"],
    treatment: "not_taxable",
    explanation:
      "SACCO savings and share contributions come out of pay after tax; they do not reduce taxable pay.",
    legalBasis: "Not an allowable deduction under the Income Tax Act",
    caveats: [],
  },
  {
    id: "employer_medical",
    title: "Medical cover provided by the employer",
    keywords: [/medical/, /health (cover|insurance|scheme)/, /\bhospital/, /outpatient|inpatient/],
    kinds: ["benefit","earning"],
    treatment: "depends",
    explanation:
      "Medical services or insurance the employer provides are not taxed on the employee when the scheme covers all full-time staff. A cash medical allowance is taxable.",
    legalBasis: "Income Tax Act s.5 (medical benefit exemption); KRA guidance",
    caveats: [
      "For directors who are not full-time employees the exemption may be limited.",
      "Cover given only to some employees may be a taxable benefit.",
    ],
  },
  {
    id: "insurance",
    title: "Life, education or health insurance premium",
    keywords: [/insurance/, /assurance/, /\bpolicy\b/, /premium/, /\bcover\b/, /education polic/],
    kinds: ["deduction"],
    treatment: "relief",
    explanation:
      "The premium does not reduce taxable pay, but the employee gets insurance relief: {rate} of the premium off their PAYE, up to {cap} a month.",
    legalBasis: "Income Tax Act s.31 (insurance relief)",
    capCode: "insurance_relief_cap",
    caveats: [
      "The policy must be on the employee's own life or health, or their spouse's or child's.",
      "An education policy must run for at least 10 years. General (property, car) insurance does not qualify.",
    ],
    inThisApp: "Voluntary deductions are taken from net pay, after PAYE, so this one does not change the tax. To give the relief, enter the monthly premium as the employee's insurance premium in their tax details.",
  },
  {
    id: "medical_deduction",
    title: "Medical scheme contribution taken from pay",
    keywords: [/medical/, /\bclinic\b/, /\bhospital/],
    kinds: ["deduction"],
    treatment: "depends",
    explanation:
      "What the employee pays towards a health insurance policy earns insurance relief: {rate} of the premium off their PAYE, up to {cap} a month. Other medical charges come out of pay after tax.",
    legalBasis: "Income Tax Act s.31 (insurance relief)",
    capCode: "insurance_relief_cap",
    caveats: [
      "Only a premium on an insurance policy (not a clinic bill or a staff medical fund) earns the relief.",
    ],
    inThisApp: "Voluntary deductions are taken from net pay, after PAYE, so this one does not change the tax. To give the relief, enter the monthly premium as the employee's insurance premium in their tax details.",
  },
  {
    id: "meals_deduction",
    title: "Meals or lunch charged to the employee",
    keywords: [/\bmeals?\b/, /\bfood\b/, /canteen/, /lunch/, /breakfast/, /\btea\b/, /catering/],
    kinds: ["deduction"],
    treatment: "not_taxable",
    explanation:
      "A charge for meals taken from pay comes out after tax; it does not reduce taxable pay.",
    legalBasis: "Not an allowable deduction under the Income Tax Act; Employment Act 2007 s.19 (deductions from wages)",
    caveats: [
      "Keep each worker's written agreement to the charge.",
      "If the company also provides the meals as a benefit, ask your tax adviser how the charge affects the value of that benefit.",
    ],
  },
  {
    id: "union_dues",
    title: "Trade union dues",
    keywords: [/union/, /\bkuppet\b/, /\bknut\b/, /\bcotu\b/],
    kinds: ["deduction"],
    treatment: "not_taxable",
    explanation:
      "Union dues come out of pay after tax; they do not reduce taxable pay.",
    legalBasis: "Not an allowable deduction under the Income Tax Act",
    caveats: [],
  },
  {
    id: "welfare",
    title: "Welfare, benevolent or harambee contribution",
    keywords: [/welfare/, /benevolent/, /harambee/, /merry[\s-]?go[\s-]?round/],
    kinds: ["deduction"],
    treatment: "not_taxable",
    explanation:
      "Welfare and similar staff contributions come out of pay after tax; they do not reduce taxable pay.",
    legalBasis: "Not an allowable deduction under the Income Tax Act",
    caveats: [],
  },
  {
    id: "per_diem",
    title: "Per diem / subsistence allowance",
    keywords: [/per[\s-]?diem/, /subsistence/, /\bdsa\b/, /daily allowance/, /travel allowance/],
    kinds: ["earning","benefit"],
    treatment: "depends",
    explanation:
      "A per diem paid for days the employee works away from their usual place of work is not taxed up to the exempt daily limit; any amount above it is taxable.",
    legalBasis: "Income Tax Act s.5 (per diem); exempt daily limit as amended by the Tax Laws (Amendment) Act 2024",
    caveats: [
      "It must be for genuine travel on duty, not a regular allowance paid every month.",
      "Check the current exempt daily limit with KRA; amounts above it are taxable.",
    ],
  },
  {
    id: "reimbursement",
    title: "Expense reimbursement",
    keywords: [/reimburse/, /refund/, /expense claim/, /\bclaim\b/, /mileage/],
    kinds: ["earning","benefit"],
    treatment: "depends",
    explanation:
      "Repaying an expense the employee spent wholly and exclusively on the job, backed by receipts, is not taxed. A flat amount paid without receipts is treated as a taxable allowance.",
    legalBasis: "Income Tax Act s.5 (employment income); KRA guidance on reimbursements",
    caveats: [
      "Keep the receipts: KRA can treat an unsupported reimbursement as taxable pay.",
    ],
  },
  {
    id: "meals",
    title: "Meals provided by the employer",
    keywords: [/\bmeals?\b/, /\bfood\b/, /canteen/, /lunch/],
    kinds: ["earning","benefit"],
    treatment: "depends",
    explanation:
      "Meals the employer provides (in a canteen or through a contracted caterer) are not taxed up to {cap} a month; above that, the whole excess is taxable. A cash meal allowance is taxable.",
    legalBasis: "Income Tax Act s.5 (meals benefit); limit as amended by the Tax Laws (Amendment) Act 2024",
    capCode: "meals_exempt_limit",
    caveats: [
      "The exemption is for meals provided, not for cash paid instead.",
    ],
  },
  {
    id: "car_benefit",
    title: "Car benefit",
    keywords: [/\bcar\b/, /vehicle/, /motor/],
    kinds: ["earning","benefit"],
    treatment: "taxable",
    explanation:
      "Private use of an employer's car is a taxable non-cash benefit, valued at the rate the Commissioner prescribes (or the hire cost, for a hired car).",
    legalBasis: "Income Tax Act s.5(2); Commissioner-prescribed car benefit rates (KRA guidance)",
    caveats: [
      "A car used only for work, with no private use, is not a benefit. A cash car allowance is taxable as pay.",
    ],
  },
  {
    id: "housing_benefit",
    title: "Housing benefit",
    keywords: [/hous/, /\brent\b/, /accommodation/, /quarters/],
    kinds: ["earning","benefit"],
    treatment: "taxable",
    explanation:
      "Housing the employer provides is a taxable benefit, valued under the Act (generally the higher of 15% of total income, the fair market rent, or the rent the employer pays). A cash house allowance is taxable as pay.",
    legalBasis: "Income Tax Act s.5(2)(b) (housing)",
    caveats: [
      "Different valuation rules apply to directors, agricultural employees and some other cases.",
    ],
  },
  {
    id: "airtime",
    title: "Airtime, phone or data",
    keywords: [/airtime/, /\bphone\b/, /\bmobile\b/, /\bdata (bundles?|allowance)/, /internet/, /\bbundles?\b/],
    kinds: ["earning","benefit"],
    treatment: "depends",
    explanation:
      "Airtime or data given mainly for work is not a benefit. Airtime for private use is a non-cash benefit: non-cash benefits worth {cap} a month or less in total are not taxed. A cash airtime allowance is taxable pay.",
    legalBasis: "Income Tax Act s.5(2) (benefits); non-cash benefit limit as amended by the Tax Laws (Amendment) Act 2024",
    capCode: "non_cash_benefit_exempt_limit",
    caveats: [
      "Keep a record of what the airtime is for if you treat it as for work.",
    ],
  },
  {
    id: "school_fees",
    title: "School fees paid by the employer",
    keywords: [/school/, /tuition/, /education/, /\bfees? for (children|kids)/],
    kinds: ["earning","benefit"],
    treatment: "taxable",
    explanation:
      "School fees the employer pays for the employee or their children are a taxable benefit, taxed through PAYE as part of the employee's pay.",
    legalBasis: "Income Tax Act s.5(2)(a) (employment income includes benefits); KRA guidance",
    caveats: [
      "Training the employee needs for the job is generally not a benefit; check with your tax adviser.",
      "Fees not taxed on the employee may be disallowed as an expense of the company.",
    ],
  },
  {
    id: "gratuity",
    title: "Gratuity",
    keywords: [/gratuity/, /\bterminal\b/, /severance/, /\bservice pay/],
    kinds: ["earning"],
    treatment: "depends",
    explanation:
      "Gratuity paid in cash is taxable. Gratuity paid into a registered pension scheme can be tax-free up to the pension limits.",
    legalBasis: "Income Tax Act s.5 (employment income); Income Tax Act s.22A",
    caveats: [
      "Lump sums on leaving have their own rules; check with your tax adviser.",
    ],
  },
  {
    id: "bonus_commission",
    title: "Bonus, commission or incentive",
    keywords: [/bonus/, /commission/, /incentive/, /overtime/, /\bleave pay/, /allowance/, /arrears/, /\bpiece/, /\btips?\b/, /13th/],
    kinds: ["earning","benefit"],
    treatment: "taxable",
    explanation:
      "Bonuses, commissions, incentives, overtime and cash allowances are employment income and taxed through PAYE in the month paid.",
    legalBasis: "Income Tax Act s.5(2)(a) (employment income)",
    caveats: [],
  },
];

/** The rate codes the table's explanations need: every capCode, and the insurance relief rate. */
export const PAY_ITEM_RATE_CODES = [...new Set([...KENYA_PAY_ITEMS.map((r) => r.capCode).filter(Boolean), "insurance_relief_rate"])];

/** How a Kenyan payslip is worked out, step by step, as the payroll engine does it (src/lib/statutoryCalc.ts). */
export const KENYA_PAYSLIP_ORDER = `How Figbloom HR works out a Kenyan payslip (the payroll engine's order; Income Tax Act; Employment Act 2007 s.19):
1. Gross pay: basic salary (less unpaid leave and absence) + allowances + overtime + commission + bonuses + piece-rate and contract work.
2. Statutory deductions, worked out on cash pay (gross pay less the non-taxable per diem): NSSF (on pensionable pay, Tier I and II), SHIF, and the Affordable Housing Levy.
3. Taxable pay = cash pay + taxable non-cash benefits (car, housing, meals above the exempt limit, non-cash benefits above the exempt limit, other) - NSSF - SHIF - Affordable Housing Levy - registered pension, post-retirement medical fund and owner-occupied mortgage interest (each up to its monthly cap) - the disability exemption (with an exemption certificate). These are the "before tax" deductions: each one lowers PAYE.
4. PAYE = tax on taxable pay by the monthly bands - personal relief - insurance relief (a share of life, education or health insurance premiums, up to a cap); never below 0.
5. Net pay = gross pay - NSSF - SHIF - housing levy - PAYE - voluntary deductions (loans, SACCO, HELB, union dues, welfare, salary advance recovery, meals charged). Voluntary deductions come off after PAYE and do not change the tax.
6. Employer costs, never taken from the employee's pay: the employer's NSSF and housing levy shares (matching the employee's) and the NITA training levy. WIBA insurance is also the employer's cost.
7. Limit: all deductions together may not exceed two-thirds of the wages, so the employee keeps at least one-third (Employment Act 2007 s.19(3)). Voluntary deductions need the employee's written agreement (s.19(1)).
A contractor (not an employee) has withholding tax deducted instead of PAYE, NSSF, SHIF and the levy.`;

// words that make a question about how pay is taxed or deducted, even when it names no item in the table
const PAY_TREATMENT_WORDS =
  /deductib|tax[\s-]?free|tax[\s-]?exempt|\bexempt|taxable|\btax(ed|es)?\b|before (tax|paye)|after (tax|paye)|pre[\s-]?tax|post[\s-]?tax|net pay|take[\s-]?home|\bgross\b|pay ?slip|\bdeduct|\breliefs?\b|\bbenefits?\b|allowances?|cut from|comes? (out of|off)|\bpaye\b|salary|\bwages?\b/i;

/** lower-case, punctuation to spaces, single spaces (as kenyaTaxTreatment.ts matches names) */
const normalise = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const MAX_PAY_ITEMS = 8;

/** The table's items a question names (in table order), and whether it is about pay treatment at all. */
export function selectPayItems(text, max = MAX_PAY_ITEMS) {
  const t = normalise(text);
  const items = t ? KENYA_PAY_ITEMS.filter((r) => r.keywords.some((k) => k.test(t))).slice(0, max) : [];
  return { about: items.length > 0 || PAY_TREATMENT_WORDS.test(String(text || "")), items };
}

const ksh = (n) => `KSh ${Number(n).toLocaleString("en-KE")}`;
const known = (rates, code) => rates[code] !== undefined && rates[code] !== null && Number.isFinite(Number(rates[code]));

/** An item's explanation with its cap (and the insurance relief rate) filled in from { code: value }. */
export function explainPayItem(item, rates = {}) {
  const cap = item.capCode && known(rates, item.capCode) ? ksh(rates[item.capCode]) : "the monthly limit in the statutory rates";
  const rate = known(rates, "insurance_relief_rate") ? `${Math.round(Number(rates.insurance_relief_rate) * 1000) / 10}%` : "a set percentage";
  return item.explanation.replace("{cap}", cap).replace("{rate}", rate);
}

const TREATMENT_TEXT = {
  taxable: "TAXABLE: taxed as pay through PAYE",
  reduces_taxable_pay: "DEDUCTED BEFORE TAX: lowers taxable pay, so lowers PAYE",
  relief: "TAX RELIEF: comes off after tax, but earns a relief off the PAYE",
  depends: "DEPENDS on the facts below",
};

/** not_taxable means "taken after tax" for a deduction and "not taxed" for an earning or benefit. */
const treatmentText = (item) => {
  if (item.treatment !== "not_taxable") return TREATMENT_TEXT[item.treatment];
  if (item.kinds?.every((k) => k === "deduction")) return "AFTER TAX: not tax-deductible, does not reduce taxable pay";
  if (item.kinds && !item.kinds.includes("deduction")) return "NOT TAXED on the employee";
  return "NOT TAX-DEDUCTIBLE / NOT TAXED: as a deduction it comes off after PAYE; as an earning or benefit it is not taxed";
};

const forKinds = (item) => (item.kinds ? ` [${item.kinds.join(", ")}]` : "");

/** The pay-items part of the HR assistant's system prompt; empty when the question is not about pay treatment. */
export function payItemsPrompt({ about, items }, rates = {}) {
  if (!about) return "";
  const lines = [
    "Pay item treatment (Kenya). Answer whether something is taxable, tax-free or deductible, and whether it comes off before or after tax, from this table and the payslip order below, citing the legal basis given. If an item is not in the table, say you have no cited rule for it; give the closest item's rule only if it clearly applies, and suggest checking with a tax adviser or KRA. Tanzania and Uganda are not in the table.",
    "",
    KENYA_PAYSLIP_ORDER,
    "",
  ];
  if (items.length) {
    lines.push("The items in this question:");
    for (const item of items) {
      lines.push(`- ${item.title}${forKinds(item)}: ${treatmentText(item)}. ${explainPayItem(item, rates)} (${item.legalBasis})`);
      for (const c of item.caveats) lines.push(`  - Caveat: ${c}`);
      if (item.goAhead) lines.push(`  - Can the company set it up: ${item.goAhead.status}. ${item.goAhead.note}`);
      if (item.inThisApp) lines.push(`  - In Figbloom HR: ${item.inThisApp}`);
    }
    lines.push("");
  }
  const named = new Set(items.map((i) => i.id));
  lines.push("Other items in the table (treatment only; ask about one for its conditions and cap):");
  for (const item of KENYA_PAY_ITEMS.filter((i) => !named.has(i.id))) lines.push(`- ${item.title}${forKinds(item)}: ${treatmentText(item).split(":")[0]}`);
  return lines.join("\n");
}
