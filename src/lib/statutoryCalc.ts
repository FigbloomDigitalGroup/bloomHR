// The month's statutory deductions for one employee: SHIF, NSSF, the Affordable Housing Levy and PAYE, worked out
// from the rates in force that month (statutory_rates; statutory_rates_on(date) gives them as {code: value}).
// Payroll, payslips and the KRA P10 download all use this, so they agree.
//
//   cash pay            what SHIF, NSSF and AHL are worked out on: gross pay less the non-taxable per diem
//   taxable pay         cash pay + taxable non-cash benefits − NSSF − SHIF and AHL (when deductible that month)
//                       − pension, post-retirement medical fund and mortgage interest (each up to its cap)
//                       − the PWD exemption, for a person with a disability with an exemption certificate
//   PAYE                tax on taxable pay by the monthly bands − personal relief − insurance relief (not below 0)

export type Rates = Record<string, unknown>;

export interface Band {
  upto: number | null;
  rate: number;
}

export interface Benefits {
  car?: number;
  meals?: number;
  nonCash?: number;
  housing?: number;
  other?: number;
}

export interface StatutoryInput {
  /** gross pay less the per diem */
  cashPay: number;
  benefits?: Benefits;
  pension?: number;
  prmf?: number;
  mortgageInterest?: number;
  insurancePremium?: number;
  isPwd?: boolean;
  /** which deductions apply (payroll leaves one out while the employee has no SHA / NSSF number or KRA PIN, unless overridden) */
  apply?: { shif?: boolean; nssf?: boolean; ahl?: boolean; paye?: boolean };
}

export interface StatutoryResult {
  shif: number;
  nssf: number;
  ahl: number;
  taxableBenefits: number;
  pension: number;
  prmf: number;
  mortgageInterest: number;
  pwdExemption: number;
  taxablePay: number;
  taxBeforeReliefs: number;
  personalRelief: number;
  insuranceRelief: number;
  paye: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const amount = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** A rate from the month's rates, or the fallback when the month has none. */
export const rateOf = (rates: Rates, code: string, fallback = 0) => {
  const v = rates[code];
  const n = typeof v === 'number' ? v : Number(v);
  return v === null || v === undefined || !Number.isFinite(n) ? fallback : n;
};

export const bandsOf = (rates: Rates): Band[] => {
  const bands = rates.paye_bands;
  return Array.isArray(bands) ? (bands as Band[]).map((b) => ({ upto: b.upto === null ? null : Number(b.upto), rate: Number(b.rate) })) : [];
};

/** Tax on a month's taxable pay by the bands (each band taxes the part of pay up to its "upto"). */
export function taxByBands(taxable: number, bands: Band[]): number {
  let tax = 0;
  let from = 0;
  for (const b of bands) {
    const to = b.upto ?? Infinity;
    if (taxable <= from) break;
    tax += (Math.min(taxable, to) - from) * b.rate;
    from = to;
  }
  return round2(tax);
}

/** The rates a payroll needs; names any missing so payroll stops rather than paying with a gap. */
export const REQUIRED_RATES = ['paye_bands', 'personal_relief', 'shif_rate', 'nssf_rate', 'nssf_upper_limit', 'ahl_rate'] as const;
export const missingRates = (rates: Rates) => REQUIRED_RATES.filter((code) => rates[code] === null || rates[code] === undefined);

export function statutoryFor(input: StatutoryInput, rates: Rates): StatutoryResult {
  const apply = { shif: true, nssf: true, ahl: true, paye: true, ...input.apply };
  const cash = amount(input.cashPay);

  const shif = apply.shif && cash > 0 ? round2(Math.max(cash * rateOf(rates, 'shif_rate'), rateOf(rates, 'shif_minimum'))) : 0;
  // NSSF tiers I and II at the same rate: everything up to the upper earnings limit
  const nssf = apply.nssf ? round2(Math.min(cash, rateOf(rates, 'nssf_upper_limit', Infinity)) * rateOf(rates, 'nssf_rate')) : 0;
  const ahl = apply.ahl ? round2(cash * rateOf(rates, 'ahl_rate')) : 0;

  // non-cash benefits up to the exempt limit are not taxed; meals are taxed only above theirs
  const b = input.benefits ?? {};
  const nonCash = amount(b.nonCash);
  const taxableBenefits = round2(
    amount(b.car) + amount(b.housing) + amount(b.other) +
    Math.max(0, amount(b.meals) - rateOf(rates, 'meals_exempt_limit')) +
    (nonCash > rateOf(rates, 'non_cash_benefit_exempt_limit') ? nonCash : 0)
  );

  const pension = Math.min(amount(input.pension), rateOf(rates, 'pension_deduction_cap', Infinity));
  const prmf = Math.min(amount(input.prmf), rateOf(rates, 'prmf_deduction_cap', Infinity));
  const mortgageInterest = Math.min(amount(input.mortgageInterest), rateOf(rates, 'mortgage_interest_cap', Infinity));

  let taxable =
    cash + taxableBenefits - nssf - pension - prmf - mortgageInterest -
    (rateOf(rates, 'shif_deductible') ? shif : 0) - (rateOf(rates, 'ahl_deductible') ? ahl : 0);
  taxable = Math.max(0, taxable);
  const pwdExemption = input.isPwd ? Math.min(taxable, rateOf(rates, 'pwd_exempt_income')) : 0;
  const taxablePay = round2(taxable - pwdExemption);

  const taxBeforeReliefs = taxByBands(taxablePay, bandsOf(rates));
  const personalRelief = rateOf(rates, 'personal_relief');
  const insuranceRelief = round2(Math.min(amount(input.insurancePremium) * rateOf(rates, 'insurance_relief_rate'), rateOf(rates, 'insurance_relief_cap', Infinity)));
  const paye = apply.paye ? round2(Math.max(0, taxBeforeReliefs - personalRelief - insuranceRelief)) : 0;

  return { shif, nssf, ahl, taxableBenefits, pension, prmf, mortgageInterest, pwdExemption, taxablePay, taxBeforeReliefs, personalRelief, insuranceRelief, paye };
}

/** An employee record's inputs (benefits, pension, claims) for statutoryFor. */
export const employeeInputs = (e: Record<string, unknown>): Omit<StatutoryInput, 'cashPay' | 'apply'> => ({
  benefits: { car: amount(e['car_benefit']), meals: amount(e['meals_benefit']), nonCash: amount(e['non_cash_benefit']), housing: amount(e['housing_benefit']), other: amount(e['other_benefits']) },
  pension: amount(e['other_pension_contribution']),
  prmf: amount(e['post_retirement_medical_fund']),
  mortgageInterest: amount(e['mortgage_interest']),
  insurancePremium: amount(e['insurance_premium']),
  isPwd: e['is_pwd'] === true,
});
