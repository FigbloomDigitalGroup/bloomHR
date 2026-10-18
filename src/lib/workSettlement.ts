import { rateOf, type Rates } from './statutoryCalc';

/**
 * The month-end settlement for workers paid by work and contract jobs (FIG-812 stage 5; migration 20261020300000).
 * Pure: the database call is in workSettlementApi.
 *
 * The monthly payroll run adds the month's approved work and jobs (paid out during the month or not) to the payslip
 * as earnings, works out PAYE, NSSF, SHIF and AHL on the month's total with the usual calculation (lib/statutoryCalc),
 * then pays the balance:
 *
 *   net to pay = gross pay − total deductions − paid out during the month − arrears brought forward + carried forward
 *
 * What payouts held back is part of gross pay and never deducted again: the AHL they withheld counts towards the
 * month's AHL, the reserve and rounding cents are released into the balance, a contractor's WHT withheld counts
 * towards the month's WHT. Net pay is never below 0: what can't be taken is carried forward as an arrear. With the cap
 * on (Employment Act s.19(3)), deductions plus arrears above two-thirds of the month's wages are carried forward too;
 * the statutory deductions are always taken in full. Contractors pay withholding tax instead of PAYE, NSSF, SHIF and
 * AHL, and the cap (an employee's protection) does not apply to them.
 */

/** One worker's row from work_month_settlement(month). */
export interface WorkSettlementRow {
  employee_number: string;
  worker_name?: string | null;
  worker_kind?: string | null;
  pay_basis?: string | null;
  wht_category?: string | null;
  work_gross: number | string;
  jobs_gross: number | string;
  paid_out_gross?: number | string;
  work_lines?: WorkLine[] | null;
  job_count?: number;
  payouts?: number;
  paid: number | string;
  ahl: number | string;
  reserve: number | string;
  wht: number | string;
  rounding: number | string;
  arrears: number | string;
}

/** A kind of work on the payslip: "Crates, 600 crate". */
export interface WorkLine {
  name: string;
  unit?: string;
  quantity?: number;
  amount: number;
}

/** What the month's work and payouts add to a payslip. */
export interface WorkMonth {
  workPay: number;
  jobsPay: number;
  workLines: WorkLine[];
  jobCount: number;
  /** what payouts actually paid during the month */
  paidOut: number;
  ahlWithheld: number;
  /** the reserve and the rounding cents payouts held back */
  reserveReleased: number;
  whtWithheld: number;
  arrearsBroughtForward: number;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const NO_WORK: WorkMonth = {
  workPay: 0, jobsPay: 0, workLines: [], jobCount: 0, paidOut: 0, ahlWithheld: 0, reserveReleased: 0, whtWithheld: 0, arrearsBroughtForward: 0,
};

/** A settlement row as payslip figures (NO_WORK when the worker has none). */
export const workMonthOf = (row: WorkSettlementRow | null | undefined): WorkMonth =>
  row
    ? {
        workPay: round2(num(row.work_gross)),
        jobsPay: round2(num(row.jobs_gross)),
        workLines: Array.isArray(row.work_lines)
          ? row.work_lines.map((l) => ({ name: String(l.name ?? ''), unit: l.unit ? String(l.unit) : undefined, quantity: num(l.quantity), amount: round2(num(l.amount)) }))
          : [],
        jobCount: num(row.job_count),
        paidOut: round2(num(row.paid)),
        ahlWithheld: round2(num(row.ahl)),
        reserveReleased: round2(num(row.reserve) + num(row.rounding)),
        whtWithheld: round2(num(row.wht)),
        arrearsBroughtForward: round2(num(row.arrears)),
      }
    : NO_WORK;

export const isContractor = (employee: Record<string, unknown> | null | undefined) => String(employee?.['worker_kind'] ?? '').trim() === 'contractor';

const hasWork = (w: WorkMonth) =>
  w.workPay > 0 || w.jobsPay > 0 || w.paidOut > 0 || w.ahlWithheld > 0 || w.reserveReleased > 0 || w.whtWithheld > 0 || w.arrearsBroughtForward > 0;

/**
 * Whether a payslip settles a month of work (and so gets arrears and the cap): contractors, workers paid by work, and
 * anyone with work, jobs, payouts or arrears that month. A salaried employee with none is worked out as before.
 */
export const settlementApplies = (employee: Record<string, unknown> | null | undefined, work: WorkMonth) =>
  isContractor(employee) || String(employee?.['pay_basis'] ?? '') === 'work' || hasWork(work);

/** A contractor's withholding tax rate from the month's rates: professional 5%, contractual 3% (Third Schedule). */
export const whtRateFor = (employee: Record<string, unknown> | null | undefined, rates: Rates) =>
  String(employee?.['wht_category'] ?? '') === 'professional' ? rateOf(rates, 'wht_professional', 0.05) : rateOf(rates, 'wht_contractual', 0.03);

/** Withholding tax on a month's gross. */
export const whtOn = (gross: number, rate: number) => round2(Math.max(0, gross) * Math.max(0, rate));

export interface SettleInput {
  grossPay: number;
  /** every deduction on the payslip: statutory (or WHT) and the rest */
  totalDeductions: number;
  /** PAYE + NSSF + SHIF + AHL, or a contractor's WHT: always taken in full */
  statutory: number;
  paidOut: number;
  arrearsBroughtForward: number;
  /** Employment Act s.19(3): deductions within two-thirds of the month's wages */
  cap: boolean;
}

export interface SettleResult {
  netPay: number;
  carriedForward: number;
  /** the part carried forward because of the two-thirds cap */
  deferredByCap: number;
  /** the part carried forward because there was not enough left to pay */
  shortfall: number;
  /** two-thirds of the month's wages, when the cap applies */
  capLimit: number | null;
}

/** The month-end balance: what is paid now and what carries forward to next month (see the top of this file). */
export function settleMonth(i: SettleInput): SettleResult {
  const gross = round2(num(i.grossPay));
  const due = round2(num(i.totalDeductions) + num(i.arrearsBroughtForward));
  const capLimit = i.cap ? round2((Math.max(0, gross) * 2) / 3) : null;
  // the statutory deductions are taken in full; the rest up to the cap
  const allowed = capLimit === null ? due : Math.min(due, Math.max(round2(num(i.statutory)), capLimit));
  const deferredByCap = round2(Math.max(0, due - allowed));
  const available = round2(Math.max(0, gross - num(i.paidOut)));
  const shortfall = round2(Math.max(0, allowed - available));
  return {
    netPay: round2(Math.max(0, available - allowed)),
    carriedForward: round2(deferredByCap + shortfall),
    deferredByCap,
    shortfall,
    capLimit,
  };
}

/** Why an arrear was carried forward, as the payslip and the arrears list say it. */
export const arrearsNote = (r: Pick<SettleResult, 'deferredByCap' | 'shortfall'>) =>
  [
    r.shortfall > 0 ? `KSh ${r.shortfall.toLocaleString()} more than was left to pay` : '',
    r.deferredByCap > 0 ? `KSh ${r.deferredByCap.toLocaleString()} over the two-thirds limit (Employment Act s.19(3))` : '',
  ]
    .filter(Boolean)
    .join('; ') || null;

/** The settlement fields of a payslip record (zeros for a salaried-only payslip). */
export interface SettlementFields {
  work_pay: number;
  jobs_pay: number;
  work_items: WorkLine[];
  paid_out: number;
  ahl_withheld: number;
  reserve_released: number;
  wht_withheld: number;
  wht_rate: number;
  wht_tax: number;
  arrears_brought_forward: number;
  arrears_carried_forward: number;
  arrears_note: string | null;
  worker_kind: string | null;
  work_settlement: boolean;
}

/** Applies the settlement to a calculated payslip's net pay; a payslip it doesn't apply to keeps its net pay. */
export function settlementFields(input: {
  employee: Record<string, unknown> | null | undefined;
  work: WorkMonth;
  grossPay: number;
  totalDeductions: number;
  statutory: number;
  netPay: number;
  whtRate: number;
  whtTax: number;
  cap: boolean;
}): SettlementFields & { net_pay: number } {
  const { employee, work } = input;
  const applies = settlementApplies(employee, work);
  const base: SettlementFields = {
    work_pay: work.workPay,
    jobs_pay: work.jobsPay,
    work_items: work.workLines,
    paid_out: work.paidOut,
    ahl_withheld: work.ahlWithheld,
    reserve_released: work.reserveReleased,
    wht_withheld: work.whtWithheld,
    wht_rate: input.whtRate,
    wht_tax: input.whtTax,
    arrears_brought_forward: work.arrearsBroughtForward,
    arrears_carried_forward: 0,
    arrears_note: null,
    worker_kind: employee ? String(employee['worker_kind'] ?? 'employee') || 'employee' : null,
    work_settlement: applies,
  };
  if (!applies) return { ...base, net_pay: input.netPay };
  const s = settleMonth({
    grossPay: input.grossPay,
    totalDeductions: input.totalDeductions,
    statutory: input.statutory,
    paidOut: work.paidOut,
    arrearsBroughtForward: work.arrearsBroughtForward,
    // the Employment Act protects employees' wages, not a contractor's fees
    cap: input.cap && !isContractor(employee),
  });
  return { ...base, arrears_carried_forward: s.carriedForward, arrears_note: arrearsNote(s), net_pay: s.netPay };
}

// ---------------------------------------------------------------------------------------------
// on the payslip
// ---------------------------------------------------------------------------------------------
type Payslip = Record<string, unknown>;

/** The payslip's work earnings: "Piece rate work" (with its kinds of work) and "Contract jobs". */
export const payslipWorkLines = (p: Payslip): { name: string; amount: number; detail: string[] }[] => {
  const items = Array.isArray(p.work_items) ? (p.work_items as WorkLine[]) : [];
  return [
    {
      name: 'Piece rate work',
      amount: round2(num(p.work_pay)),
      detail: items.map((l) => `${l.name}: ${num(l.quantity).toLocaleString()}${l.unit ? ` ${l.unit}` : ''}, KSh ${num(l.amount).toLocaleString()}`),
    },
    { name: 'Contract jobs', amount: round2(num(p.jobs_pay)), detail: [] },
  ].filter((l) => l.amount > 0);
};

export const isSettlementPayslip = (p: Payslip) => p.work_settlement === true || p.work_settlement === 'true';
export const isContractorPayslip = (p: Payslip) => String(p.worker_kind ?? '') === 'contractor';

export interface SettlementLine {
  label: string;
  amount: number;
  /** minus: taken off the balance; plus: added back; info: already counted above, shown so it is clear */
  kind: 'minus' | 'plus' | 'info' | 'total';
  note?: string;
}

/**
 * The settlement block of a payslip: from the month's net pay to what is paid at month end. Empty for a payslip that
 * doesn't settle work.
 */
export function payslipSettlementLines(p: Payslip): SettlementLine[] {
  if (!isSettlementPayslip(p)) return [];
  const contractor = isContractorPayslip(p);
  const monthNet = round2(num(p.gross_pay) - num(p.total_deductions));
  const lines: SettlementLine[] = [{ label: 'Net pay for the month', amount: monthNet, kind: 'total' }];
  if (num(p.paid_out) > 0) lines.push({ label: 'Already paid during the month', amount: round2(num(p.paid_out)), kind: 'minus' });
  if (num(p.reserve_released) > 0) {
    lines.push({ label: 'Held back (reserve) released', amount: round2(num(p.reserve_released)), kind: 'info', note: 'part of the net pay above; not taken again' });
  }
  if (num(p.ahl_withheld) > 0) {
    lines.push({ label: 'AHL already withheld', amount: round2(num(p.ahl_withheld)), kind: 'info', note: "counted towards this month's AHL" });
  }
  if (num(p.wht_withheld) > 0) {
    lines.push({ label: 'WHT already withheld', amount: round2(num(p.wht_withheld)), kind: 'info', note: contractor ? "counted towards this month's withholding tax" : undefined });
  }
  if (num(p.arrears_brought_forward) > 0) lines.push({ label: 'Arrears brought forward', amount: round2(num(p.arrears_brought_forward)), kind: 'minus' });
  if (num(p.arrears_carried_forward) > 0) {
    lines.push({ label: 'Carried forward', amount: round2(num(p.arrears_carried_forward)), kind: 'plus', note: p.arrears_note ? String(p.arrears_note) : 'owed, taken from next month’s pay' });
  }
  lines.push({ label: 'Net to pay at month end', amount: round2(num(p.net_pay)), kind: 'total' });
  return lines;
}

/** "Withholding tax (3%)" for a contractor's payslip. */
export const whtLabel = (p: Payslip) => `Withholding tax (${round2(num(p.wht_rate) * 100)}%)`;
