/**
 * The law on workplace accidents and work injuries, per country, as dated data: one rule set per country and the date
 * it applies from. When the law changes, add a new rule set with its `effectiveFrom` (and give the old one an
 * `effectiveTo`); cases are judged by the rules in force on the day of the accident. Nothing else in the app hard-codes
 * a deadline or a formula.
 *
 * A guide, not legal advice. Each rule cites its source; `verified: false` marks a point we could not confirm against
 * the Act's current text (the app shows those with "check this").
 */

export type WorkInjuryCountry = 'Kenya' | 'Tanzania' | 'Uganda';

/** Where a deadline is counted from. */
export type DeadlineFrom = 'accident' | 'employer_notified';

export interface DeadlineRule {
  code: string;
  /** what has to be done, in plain words */
  label: string;
  /** who it goes to, for "Report to DOSH by ..." */
  authority: string;
  from: DeadlineFrom;
  /** the time allowed: hours (fatal accidents) or days */
  hours?: number;
  days?: number;
  /** only for fatal accidents / only for non-fatal ones; neither: all */
  fatalOnly?: boolean;
  nonFatalOnly?: boolean;
  /** the case field that shows it was done */
  doneWhen: 'authority_notified_on' | 'claim_lodged_on';
  citation: string;
  verified: boolean;
}

export interface ChecklistRule {
  code: string;
  label: string;
  citation?: string;
  verified: boolean;
}

/**
 * How compensation is worked out (for the estimate). Months of earnings for permanent total incapacity and death;
 * temporary incapacity as a share of earnings for at most so many months.
 */
export interface CompensationRule {
  /** share of monthly earnings paid while off work (1 = full earnings) */
  temporaryShare: number;
  /** temporary payments stop after this many months */
  temporaryMaxMonths: number;
  /** months of earnings for 100% permanent incapacity; a lower % gets that share */
  permanentMonths: number;
  /** months of earnings paid to dependants on death */
  deathMonths: number;
  citations: { temporary: string; permanent: string; death: string; medical: string };
  /** limits the estimate leaves out */
  caveats: string[];
  verified: boolean;
}

export interface WorkInjuryRuleSet {
  country: WorkInjuryCountry;
  effectiveFrom: string;
  effectiveTo?: string;
  act: string;
  /** who the employer reports to */
  authority: string;
  /** the name of the report form, if any */
  reportForm: string;
  /** who pays the compensation */
  payer: string;
  deadlines: DeadlineRule[];
  checklist: ChecklistRule[];
  /** null: we do not estimate compensation for this country (the formula is not confirmed) */
  compensation: CompensationRule | null;
  /** "How this works", in plain words, one step per line */
  howItWorks: string[];
  notes: string[];
}

export const WORK_INJURY_RULES: WorkInjuryRuleSet[] = [
  {
    country: 'Kenya',
    effectiveFrom: '2008-06-02',
    act: 'Work Injury Benefits Act, 2007 (No. 13 of 2007) and Occupational Safety and Health Act, 2007 (No. 15 of 2007)',
    authority: 'DOSH',
    reportForm: 'DOSH Form 1 (WIBA employer’s report of accident)',
    payer: 'The employer, through its WIBA insurer',
    deadlines: [
      {
        code: 'ke_fatal_24h',
        label: 'Report the fatal accident to the area occupational safety and health officer (DOSH)',
        authority: 'DOSH',
        from: 'accident',
        hours: 24,
        fatalOnly: true,
        doneWhen: 'authority_notified_on',
        citation: 'OSHA 2007 s.21(1)(a); WIBA 2007 s.21',
        verified: false,
      },
      {
        code: 'ke_dosh_7d',
        label: 'Report the accident to the Director of Occupational Safety and Health Services on DOSH Form 1',
        authority: 'DOSH',
        from: 'employer_notified',
        days: 7,
        doneWhen: 'authority_notified_on',
        citation: 'WIBA 2007 s.22(1); OSHA 2007 s.21',
        verified: true,
      },
      {
        code: 'ke_claim_12m',
        label: 'Make sure the claim for compensation is lodged (with the insurer and the Director)',
        authority: 'the insurer',
        from: 'accident',
        days: 365,
        doneWhen: 'claim_lodged_on',
        citation: 'WIBA 2007 s.26 (claims within 12 months of the accident)',
        verified: false,
      },
    ],
    checklist: [
      { code: 'ke_cover', label: 'The company has a current WIBA insurance policy for its employees', citation: 'WIBA s.7(1)', verified: true },
      { code: 'ke_first_aid', label: 'First aid given and the employee taken for treatment', citation: 'WIBA s.47 (medical aid)', verified: false },
      { code: 'ke_employee_notice', label: 'Notice of the accident received from (or for) the employee, as soon as possible', citation: 'WIBA s.21', verified: true },
      { code: 'ke_register', label: 'Entered in the workplace’s register of accidents and dangerous occurrences', citation: 'OSHA 2007 (general register)', verified: false },
      { code: 'ke_dosh_form', label: 'DOSH Form 1 filled in, signed and sent to the area DOSH office (keep a copy)', citation: 'WIBA s.22', verified: true },
      { code: 'ke_insurer', label: 'Insurer told, with a copy of the form, the medical report and any police abstract', verified: true },
      { code: 'ke_medical', label: 'Medical report with the doctor’s assessment of incapacity (DOSH Form 2 / medical report form)', verified: false },
      { code: 'ke_pay', label: 'Pay while off work and the compensation paid to the employee (or dependants)', citation: 'WIBA ss.28–31', verified: false },
    ],
    compensation: {
      temporaryShare: 1,
      temporaryMaxMonths: 12,
      permanentMonths: 96,
      deathMonths: 96,
      citations: {
        temporary: 'WIBA s.30 (temporary total disablement: earnings for up to 12 months)',
        permanent: 'WIBA s.28 and First Schedule (96 months’ earnings for 100% permanent disablement)',
        death: 'WIBA s.31 (death: 96 months’ earnings to dependants, plus funeral expenses)',
        medical: 'WIBA s.47 (reasonable medical expenses, paid by the employer)',
      },
      caveats: [
        'The Third Schedule’s minimum and maximum earnings limits are not applied.',
        'Earnings should include regular allowances (house, etc.), not only basic pay (WIBA s.2 "earnings").',
        'The Director (DOSH) makes the assessment; the degree of incapacity comes from the doctor’s report and the First Schedule.',
      ],
      verified: false,
    },
    howItWorks: [
      'The injured employee (or someone for them) tells the employer as soon as possible after the accident.',
      'The employer gives first aid and gets the employee treated. Medical costs for the injury are the employer’s (through the WIBA insurer).',
      'Within 7 days of hearing about it, the employer reports the accident to the Director of Occupational Safety and Health Services (DOSH) on DOSH Form 1. A death is reported within 24 hours.',
      'The employer tells its WIBA insurer and sends the form, the medical report and any police abstract.',
      'A doctor assesses the injury. The Director (DOSH) works out the compensation using the Act’s formulas.',
      'While the employee is off work they get their earnings (for up to 12 months). Lasting incapacity is paid as a share of 96 months’ earnings; a death is paid to the dependants.',
      'The insurer (or the employer) pays, and the case is closed.',
    ],
    notes: [
      'Every employer must insure its employees against work injury (WIBA s.7). Working without cover is an offence.',
      'Parts of WIBA (such as the Director deciding claims) were challenged in court (Law Society of Kenya v Attorney General, decided on appeal in 2019): check current practice with DOSH or your insurer.',
    ],
  },
  {
    country: 'Tanzania',
    effectiveFrom: '2015-07-01',
    act: 'Workers Compensation Act, 2008 (Cap. 263)',
    authority: 'WCF',
    reportForm: 'WCF notification of accident or disease (online or on the WCF form)',
    payer: 'The Workers Compensation Fund (WCF), from the employer’s monthly contributions',
    deadlines: [
      {
        code: 'tz_wcf_7d',
        label: 'Report the accident or disease to the Workers Compensation Fund (WCF)',
        authority: 'WCF',
        from: 'employer_notified',
        days: 7,
        doneWhen: 'authority_notified_on',
        citation: 'Workers Compensation Act 2008, Part IV (employer’s report within 7 days)',
        verified: false,
      },
      {
        code: 'tz_claim_12m',
        label: 'Make sure the claim is lodged with the WCF',
        authority: 'WCF',
        from: 'accident',
        days: 365,
        doneWhen: 'claim_lodged_on',
        citation: 'Workers Compensation Act 2008 (claims within 12 months)',
        verified: false,
      },
    ],
    checklist: [
      { code: 'tz_registered', label: 'The company is registered with the WCF and its monthly contributions are paid', verified: true },
      { code: 'tz_first_aid', label: 'First aid given and the employee taken for treatment', verified: true },
      { code: 'tz_notice', label: 'Notice of the accident received from (or for) the employee', verified: true },
      { code: 'tz_report', label: 'Accident reported to the WCF (online portal or form) within 7 days', verified: false },
      { code: 'tz_medical', label: 'Medical report from the doctor sent to the WCF', verified: true },
    ],
    compensation: null,
    howItWorks: [
      'The employee tells the employer as soon as possible after the accident.',
      'The employer gets the employee treated and reports the accident to the Workers Compensation Fund (WCF) within 7 days.',
      'The WCF assesses the claim, with the doctor’s report, and pays the employee (or dependants) directly. The employer’s part is its monthly WCF contributions.',
    ],
    notes: ['In Tanzania the WCF, not the employer or a private insurer, pays compensation.'],
  },
  {
    country: 'Uganda',
    effectiveFrom: '2000-01-01',
    act: 'Workers’ Compensation Act, 2000 (Cap. 225)',
    authority: 'the labour officer',
    reportForm: 'Notice of accident to the labour officer (Workers’ Compensation Act form)',
    payer: 'The employer (or its insurer)',
    deadlines: [
      {
        code: 'ug_labour_7d',
        label: 'Report the accident to the labour officer',
        authority: 'the labour officer',
        from: 'employer_notified',
        days: 7,
        doneWhen: 'authority_notified_on',
        citation: 'Workers’ Compensation Act 2000 (employer’s report of accident)',
        verified: false,
      },
    ],
    checklist: [
      { code: 'ug_first_aid', label: 'First aid given and the employee taken for treatment', verified: true },
      { code: 'ug_notice', label: 'Notice of the accident received from (or for) the employee', verified: true },
      { code: 'ug_report', label: 'Accident reported to the labour officer', verified: false },
      { code: 'ug_medical', label: 'Medical assessment of incapacity', verified: true },
    ],
    compensation: null,
    howItWorks: [
      'The employee tells the employer as soon as possible after the accident.',
      'The employer gets the employee treated and reports the accident to the labour officer.',
      'A doctor assesses the incapacity; the employer (or its insurer) pays compensation under the Act, and the labour officer can help settle a dispute.',
    ],
    notes: ['Check the deadlines with the labour office: we have not confirmed them against the Act’s text.'],
  },
];

const tidy = (country: string | null | undefined) => (country || '').trim().toLowerCase();

/** The rules for a country in force on a day (YYYY-MM-DD); Kenya's when the country isn't one we know. */
export function rulesFor(country: string | null | undefined, onDay: string): WorkInjuryRuleSet {
  const known = WORK_INJURY_RULES.filter((r) => tidy(r.country) === tidy(country));
  const pool = known.length ? known : WORK_INJURY_RULES.filter((r) => r.country === 'Kenya');
  const inForce = pool.filter((r) => r.effectiveFrom <= onDay && (!r.effectiveTo || onDay <= r.effectiveTo));
  // the latest that applies; before the first one, the first
  const sorted = (inForce.length ? inForce : pool).slice().sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return inForce.length ? sorted[sorted.length - 1] : sorted[0];
}

/** Do we have the country's own rules (rather than falling back to Kenya's)? */
export const hasOwnRules = (country: string | null | undefined) => WORK_INJURY_RULES.some((r) => tidy(r.country) === tidy(country));
