// Year-to-date totals on a payslip (FIG-814): gross pay, taxable pay, PAYE, NSSF and net pay, added up over the tax
// year of the payslip's country, in the payslip's own currency.
//
//   Kenya     January to December (Income Tax Act: the year of income is the calendar year)
//   Tanzania  January to December (Income Tax Act 2004: an individual's year of income is the calendar year)
//   Uganda    July to June (the Ugandan financial year; URA's PAYE year)
//
// What is added: this payslip, plus the employee's APPROVED (or paid) payslips earlier in the same tax year and the same
// country. Draft payslips of earlier months are not. Currencies are never added together: the totals are in the
// payslip's currency (USD for a USD payslip), and months paid in another currency that year are counted apart and
// named in a note. The database function payslip_ytd (migration 20261021600000) returns the earlier months' totals by
// currency, so staff, who read only their own payslips, get the same figures as payroll.

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const tidy = (country: unknown) => {
  const t = text(country);
  const known = ['Kenya', 'Tanzania', 'Uganda', 'Rwanda'].find((c) => c.toLowerCase() === t.toLowerCase());
  return known ?? (t || 'Kenya');
};
const currencyOfRow = (r: { currency?: unknown }) => {
  const c = text(r.currency).toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : 'KES';
};

/** The month a country's tax year starts in (1 = January). */
export const taxYearFirstMonth = (country: string | null | undefined): number => (tidy(country) === 'Uganda' ? 7 : 1);

export interface TaxYear {
  /** first pay period of the tax year, "2026-07" */
  start: string;
  /** last pay period of the tax year, "2027-06" */
  end: string;
  /** "2026" or "2026/27" */
  label: string;
}

/** The tax year a pay period falls in, for a country. */
export function taxYearOf(country: string | null | undefined, payPeriod: string): TaxYear {
  const m = /^(\d{4})-(\d{2})/.exec(text(payPeriod));
  const year = m ? Number(m[1]) : new Date().getFullYear();
  const month = m ? Number(m[2]) : 1;
  const first = taxYearFirstMonth(country);
  if (first === 1) return { start: `${year}-01`, end: `${year}-12`, label: String(year) };
  const startYear = month >= first ? year : year - 1;
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastMonth = first - 1;
  return {
    start: `${startYear}-${pad(first)}`,
    end: `${startYear + 1}-${pad(lastMonth)}`,
    label: `${startYear}/${String(startYear + 1).slice(2)}`,
  };
}

/** The totals of some months in one currency (a row of payslip_ytd). */
export interface YtdTotals {
  currency: string;
  months: number;
  gross_pay: number;
  taxable_pay: number;
  /** months whose taxable pay was recorded (older Kenya payslips have none) */
  taxable_months: number;
  paye_tax: number;
  nssf_deduction: number;
  net_pay: number;
}

/** A saved payslip, as far as the year to date needs it. */
export interface YtdPayslip {
  employee_id?: unknown;
  pay_period?: unknown;
  country?: unknown;
  currency?: unknown;
  gross_pay?: unknown;
  taxable_pay?: unknown;
  paye_tax?: unknown;
  nssf_deduction?: unknown;
  net_pay?: unknown;
  /** whether its country's payroll for that month is approved or paid */
  approved?: boolean;
}

export interface PayslipYtd {
  currency: string;
  country: string;
  taxYear: TaxYear;
  months: number;
  gross_pay: number;
  /** null when no month in the total has its taxable pay recorded */
  taxable_pay: number | null;
  /** months in the total without taxable pay recorded */
  taxable_missing: number;
  paye_tax: number;
  nssf_deduction: number;
  net_pay: number;
  /** months of the same tax year paid in another currency, left out of the totals */
  other_currencies: { currency: string; months: number }[];
}

const empty = (currency: string): YtdTotals => ({ currency, months: 0, gross_pay: 0, taxable_pay: 0, taxable_months: 0, paye_tax: 0, nssf_deduction: 0, net_pay: 0 });

const addRow = (t: YtdTotals, r: YtdPayslip): YtdTotals => {
  const hasTaxable = r.taxable_pay !== null && r.taxable_pay !== undefined && text(r.taxable_pay) !== '';
  return {
    currency: t.currency,
    months: t.months + 1,
    gross_pay: round2(t.gross_pay + num(r.gross_pay)),
    taxable_pay: round2(t.taxable_pay + (hasTaxable ? num(r.taxable_pay) : 0)),
    taxable_months: t.taxable_months + (hasTaxable ? 1 : 0),
    paye_tax: round2(t.paye_tax + num(r.paye_tax)),
    nssf_deduction: round2(t.nssf_deduction + num(r.nssf_deduction)),
    net_pay: round2(t.net_pay + num(r.net_pay)),
  };
};

/**
 * The earlier months' totals by currency, from saved payslips (what payslip_ytd returns): approved payslips of the same
 * employee and country, in the tax year of `payPeriod`, before `payPeriod`.
 */
export function earlierTotals(rows: YtdPayslip[], current: { employee_id?: unknown; pay_period?: unknown; country?: unknown }): YtdTotals[] {
  const period = text(current.pay_period);
  const country = tidy(current.country);
  const year = taxYearOf(country, period);
  const byCurrency = new Map<string, YtdTotals>();
  for (const r of rows) {
    const p = text(r.pay_period);
    if (r.approved !== true) continue;
    if (current.employee_id !== undefined && text(r.employee_id) !== text(current.employee_id)) continue;
    if (tidy(r.country) !== country) continue;
    if (p < year.start || p >= period) continue;
    const c = currencyOfRow(r);
    byCurrency.set(c, addRow(byCurrency.get(c) ?? empty(c), r));
  }
  return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/** The payslip's year to date: this payslip plus the earlier months' totals in its currency (others named apart). */
export function payslipYtd(current: YtdPayslip, earlier: YtdTotals[]): PayslipYtd {
  const currency = currencyOfRow(current);
  const country = tidy(current.country);
  const same = earlier.find((t) => t.currency === currency) ?? empty(currency);
  const t = addRow(
    {
      ...same,
      gross_pay: num(same.gross_pay),
      taxable_pay: num(same.taxable_pay),
      paye_tax: num(same.paye_tax),
      nssf_deduction: num(same.nssf_deduction),
      net_pay: num(same.net_pay),
      months: num(same.months),
      taxable_months: num(same.taxable_months),
    },
    current,
  );
  return {
    currency,
    country,
    taxYear: taxYearOf(country, text(current.pay_period)),
    months: t.months,
    gross_pay: t.gross_pay,
    taxable_pay: t.taxable_months > 0 ? t.taxable_pay : null,
    taxable_missing: t.months - t.taxable_months,
    paye_tax: t.paye_tax,
    nssf_deduction: t.nssf_deduction,
    net_pay: t.net_pay,
    other_currencies: earlier.filter((e) => e.currency !== currency && num(e.months) > 0).map((e) => ({ currency: e.currency, months: num(e.months) })),
  };
}

/** The year to date straight from saved payslips (tests, and when the database function can't be reached). */
export const payslipYtdFromRows = (current: YtdPayslip, rows: YtdPayslip[]): PayslipYtd => payslipYtd(current, earlierTotals(rows, current));
