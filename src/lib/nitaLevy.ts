import { rateOf, type Rates } from './statutoryCalc';

// The NITA training levy (Industrial Training (Training Levy) Order): the EMPLOYER pays a fixed amount a month for each
// employee (statutory_rates 'nita_levy', KES 50 by default). It is an employer cost: never taken from pay, never in
// total deductions or net pay. Casual workers and contractors are not employees on the PAYE payroll, so pay none.
// Saved payslips carry the database's own figure (salary_history.nita_levy, migration 20261019000000).

const NO_LEVY = new Set(['casual', 'contractor']);

/** The month's levy for one person on the payroll, from the month's rates. */
export const nitaLevyFor = (employee: Record<string, unknown> | null | undefined, rates: Rates | null | undefined) =>
  NO_LEVY.has(String(employee?.['worker_kind'] ?? '').trim()) ? 0 : Math.max(0, rateOf(rates ?? {}, 'nita_levy', 0));

/** A payslip's levy (0 when it has none, e.g. saved before the levy was recorded). */
export const payslipNitaLevy = (payslip: { nita_levy?: unknown }) => {
  const n = Number(payslip.nita_levy);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** The month's total payable to NITA, and how many people it is for. */
export const nitaTotal = (payslips: { nita_levy?: unknown }[]) => {
  const levies = payslips.map(payslipNitaLevy).filter((n) => n > 0);
  return { total: Math.round(levies.reduce((s, n) => s + n, 0) * 100) / 100, employees: levies.length };
};
