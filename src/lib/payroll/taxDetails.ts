import { rateOf, type Rates, type StatutoryResult } from '../statutoryCalc';

// How a payslip's taxable pay and tax were worked out (FIG-814), saved by each country's engine on the payslip
// (salary_history.tax_details, migration 20261021600000) so the payslip shows the engine's own figures and never works
// them out again:
//
//   gross pay − pay that is not taxed + taxable benefits − deductions allowed before tax = taxable pay
//   tax on taxable pay − reliefs = PAYE
//
// Kenya: NSSF, SHIF and the housing levy (when deductible that month), pension, post-retirement medical fund, mortgage
// interest and the disability exemption before tax; personal relief (the dated rate) and insurance relief.
// Tanzania: NSSF before tax (residents); no reliefs. Uganda: local service tax in the month it is taken; no reliefs.
// A contractor (withholding tax on gross) has none.

/** One line of the working, with a key the payslip uses to group deductions (nssf, shif, ahl, pension, prmf, lst...). */
export interface TaxLine {
  key: string;
  label: string;
  amount: number;
}

export interface TaxDetails {
  /** pay in gross that is not taxed (Kenya's per diem, earnings marked not taxed) */
  not_taxed: TaxLine[];
  /** non-cash benefits (car, housing...) added to pay for tax only, never paid in cash */
  taxable_benefits: TaxLine[];
  /** deductions allowed before tax */
  before_tax: TaxLine[];
  /** tax on taxable pay before reliefs */
  tax_before_reliefs: number | null;
  reliefs: TaxLine[];
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const line = (key: string, label: string, amount: number): TaxLine => ({ key, label, amount: round2(amount) });
const nonZero = (lines: TaxLine[]) => lines.filter((l) => l.amount > 0);

/** Kenya's working, from statutoryFor's result for the month (null for a contractor: withholding tax instead). */
export function kenyaTaxDetails(
  s: StatutoryResult,
  rates: Rates,
  pay: { perDiem: number; nonTaxable: number; benefits?: { car?: number; housing?: number; meals?: number; nonCash?: number; other?: number } },
  contractor: boolean,
): TaxDetails | null {
  if (contractor) return null;
  const b = pay.benefits ?? {};
  const nonCash = num(b.nonCash);
  return {
    not_taxed: nonZero([line('per_diem', 'Per diem (not taxed)', num(pay.perDiem)), line('not_taxed', 'Earnings not taxed', num(pay.nonTaxable))]),
    // the same rules as statutoryFor: meals above their exempt limit, other non-cash benefits above theirs
    taxable_benefits: nonZero([
      line('car', 'Car benefit', num(b.car)),
      line('housing', 'Housing benefit', num(b.housing)),
      line('meals', 'Meals benefit', Math.max(0, num(b.meals) - rateOf(rates, 'meals_exempt_limit'))),
      line('non_cash', 'Non-cash benefits', nonCash > rateOf(rates, 'non_cash_benefit_exempt_limit') ? nonCash : 0),
      line('other_benefits', 'Other benefits', num(b.other)),
    ]),
    before_tax: nonZero([
      line('nssf', 'NSSF', s.nssf),
      line('shif', 'SHIF', rateOf(rates, 'shif_deductible') ? s.shif : 0),
      line('ahl', 'Housing levy (AHL)', rateOf(rates, 'ahl_deductible') ? s.ahl : 0),
      line('pension', 'Pension contribution', s.pension),
      line('prmf', 'Post-retirement medical fund', s.prmf),
      line('mortgage', 'Mortgage interest', s.mortgageInterest),
      line('pwd', 'Disability exemption', s.pwdExemption),
    ]),
    tax_before_reliefs: s.taxBeforeReliefs,
    reliefs: nonZero([line('personal', 'Personal relief', s.personalRelief), line('insurance', 'Insurance relief', s.insuranceRelief)]),
  };
}

/** Tanzania's working: pay not taxed, and NSSF before tax for a resident (when deductible that month). */
export function tanzaniaTaxDetails(
  i: { grossPay: number; taxablePay: number; resident: boolean; contractor?: boolean },
  s: { nssf: number; paye: number },
  rates: Rates,
): TaxDetails | null {
  if (i.contractor) return null;
  return {
    not_taxed: nonZero([line('not_taxed', 'Earnings not taxed', Math.max(0, num(i.grossPay) - num(i.taxablePay)))]),
    taxable_benefits: [],
    before_tax: nonZero([line('nssf', 'NSSF', i.resident && rateOf(rates, 'nssf_deductible', 1) ? s.nssf : 0)]),
    tax_before_reliefs: s.paye,
    reliefs: [],
  };
}

/** Uganda's working: pay not taxed, the local service tax taken this month (and NSSF, if ever deductible). */
export function ugandaTaxDetails(
  i: { nonTaxable: number; lst: number; contractor: boolean },
  s: { nssf: number; paye: number },
  rates: Rates,
): TaxDetails | null {
  if (i.contractor) return null;
  return {
    not_taxed: nonZero([line('not_taxed', 'Earnings not taxed', num(i.nonTaxable))]),
    taxable_benefits: [],
    before_tax: nonZero([
      line('lst', 'Local service tax', rateOf(rates, 'lst_deductible', 1) ? num(i.lst) : 0),
      line('nssf', 'NSSF', rateOf(rates, 'nssf_deductible', 0) ? s.nssf : 0),
    ]),
    tax_before_reliefs: s.paye,
    reliefs: [],
  };
}

const LISTS = ['not_taxed', 'taxable_benefits', 'before_tax', 'reliefs'] as const;

const linesOf = (v: unknown): TaxLine[] =>
  Array.isArray(v)
    ? v
        .filter((l) => l && typeof l === 'object')
        .map((l: Record<string, unknown>) => ({ key: String(l.key ?? ''), label: String(l.label ?? ''), amount: num(l.amount) }))
    : [];

/** The working as saved on a payslip (jsonb, or its text), or null when the payslip has none. */
export function savedTaxDetails(record: Record<string, unknown> | null | undefined): TaxDetails | null {
  let v = record?.tax_details;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  return {
    not_taxed: linesOf(d.not_taxed),
    taxable_benefits: linesOf(d.taxable_benefits),
    before_tax: linesOf(d.before_tax),
    tax_before_reliefs: d.tax_before_reliefs === null || d.tax_before_reliefs === undefined ? null : num(d.tax_before_reliefs),
    reliefs: linesOf(d.reliefs),
  };
}

/** The working in USD at the month's rate (a USD payslip, FIG-906): every amount divided by the rate, to cents. */
export function taxDetailsInUsd(details: unknown, rate: number): TaxDetails | null {
  const d = savedTaxDetails({ tax_details: details });
  if (!d || !(rate > 0)) return d;
  const div = (n: number) => Math.round((n / rate + Math.sign(n) * Number.EPSILON) * 100) / 100;
  const out = { ...d, tax_before_reliefs: d.tax_before_reliefs === null ? null : div(d.tax_before_reliefs) };
  for (const k of LISTS) out[k] = d[k].map((l) => ({ ...l, amount: div(l.amount) }));
  return out;
}

/** The working a payslip shows; `recorded` is false for a payslip saved before its engine kept the working. */
export interface TaxWorking extends TaxDetails {
  recorded: boolean;
}

/**
 * The working of a payslip's taxable pay and tax: what its engine saved, or for a payslip saved before that, what the
 * saved columns say (Tanzania: NSSF before tax for a resident; Uganda: the LST taken; Kenya: the personal relief only).
 * null for a contractor (withholding tax on gross, no taxable pay or reliefs).
 */
export function taxWorkingOf(record: Record<string, unknown>, country: string): TaxWorking | null {
  if (String(record.worker_kind ?? '').trim() === 'contractor') return null;
  const saved = savedTaxDetails(record);
  if (saved) return { ...saved, recorded: true };
  const hasTaxable = record.taxable_pay !== null && record.taxable_pay !== undefined;
  const base = { not_taxed: [], taxable_benefits: [], reliefs: [] as TaxLine[] };
  if (country === 'Tanzania') {
    return {
      ...base,
      before_tax: nonZero([line('nssf', 'NSSF', record.tax_resident === false ? 0 : num(record.nssf_deduction))]),
      tax_before_reliefs: num(record.paye_tax),
      recorded: hasTaxable,
    };
  }
  if (country === 'Uganda') {
    return { ...base, before_tax: nonZero([line('lst', 'Local service tax', num(record.lst_deduction))]), tax_before_reliefs: num(record.paye_tax), recorded: hasTaxable };
  }
  return { ...base, before_tax: [], reliefs: nonZero([line('personal', 'Personal relief', num(record.tax_relief))]), tax_before_reliefs: null, recorded: false };
}
