import { currencyOf } from './payroll/currency';
import { payslipCountry } from './payroll/multiCountry';
import { afterDeductionsOf, reimbursementOf } from './reimbursements';

/**
 * The Run tab's columns (finance's feedback, Oct 28): each deduction in its own column, as in the P10, and the
 * reimbursements typed in after them.
 *
 *   Basic pay       the payslip's gross_pay (all pay before deductions)
 *   PAYE, NSSF, SHIF, Housing levy, Other deductions (loans, advances, SACCO, another country's LST or HESLB...)
 *   Gross pay       what is left after deductions
 *   Per diem, Mileage...   the reimbursements
 *   Net pay         gross pay + reimbursements: what is paid (the payslip's net_pay)
 */
export const STATUTORY_COLUMNS = [
  { key: 'paye_tax', label: 'PAYE' },
  { key: 'nssf_deduction', label: 'NSSF' },
  { key: 'nhif_deduction', label: 'SHIF' },
  { key: 'housing_levy', label: 'Housing levy' },
] as const;

export type StatutoryColumn = (typeof STATUTORY_COLUMNS)[number];

/* eslint-disable @typescript-eslint/no-explicit-any -- payroll rows are the untyped records PayrollDashboard builds */
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The deduction columns the rows need: PAYE and NSSF always; SHIF and the housing levy with anyone in Kenya or paying them. */
export const statutoryColumnsFor = (records: any[]): StatutoryColumn[] =>
  STATUTORY_COLUMNS.filter(
    (c) =>
      c.key === 'paye_tax' ||
      c.key === 'nssf_deduction' ||
      records.some((r) => payslipCountry(r) === 'Kenya' || num(r[c.key]) !== 0),
  );

/** One row's figures in column order. */
export const runRowFigures = (record: any, statutory: StatutoryColumn[], reimbursements: string[]) => {
  const deductions = statutory.map((c) => num(record[c.key]));
  return {
    basic: num(record.gross_pay),
    deductions,
    other: round2(num(record.total_deductions) - deductions.reduce((s, n) => s + n, 0)),
    gross: afterDeductionsOf(record),
    reimbursements: reimbursements.map((name) => reimbursementOf(record, name)),
    net: num(record.net_pay),
  };
};

export type RunRowFigures = ReturnType<typeof runRowFigures>;

/** The rows' totals in each currency (never added across currencies), in the order the currencies first appear. */
export const runTotalsByCurrency = (records: any[], statutory: StatutoryColumn[], reimbursements: string[]) => {
  const groups = new Map<string, { currency: string; count: number; figures: RunRowFigures }>();
  for (const r of records) {
    const f = runRowFigures(r, statutory, reimbursements);
    const currency = currencyOf(r);
    const g = groups.get(currency);
    if (!g) {
      groups.set(currency, { currency, count: 1, figures: f });
      continue;
    }
    const t = g.figures;
    g.count += 1;
    g.figures = {
      basic: round2(t.basic + f.basic),
      deductions: t.deductions.map((n, i) => round2(n + f.deductions[i])),
      other: round2(t.other + f.other),
      gross: round2(t.gross + f.gross),
      reimbursements: t.reimbursements.map((n, i) => round2(n + f.reimbursements[i])),
      net: round2(t.net + f.net),
    };
  }
  return [...groups.values()];
};
/* eslint-enable @typescript-eslint/no-explicit-any */
