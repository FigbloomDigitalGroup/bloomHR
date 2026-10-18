import { employeeInputs, statutoryFor, type Rates, type StatutoryInput } from './statutoryCalc';
import { statutoryPayWith, summariseEarnings, type EarningItem } from './earnings';
import { basicAfterLeave } from './leavePay';
import type { DeductionItem } from './voluntaryDeductions';
import { payslipOvertimePay } from './overtimePay';
import { arrearsNote, isContractor, isContractorPayslip, isSettlementPayslip, settleMonth, whtOn, whtRateFor } from './workSettlement';

/**
 * Edits to one payslip while its payroll run is a draft (FIG-883; table payslip_overrides). Pure: the database calls
 * are in payslipOverridesDb.
 *
 * Payroll can change the month's earnings on a payslip (basic, allowances, overtime, an earning line's amount), add
 * one-off earnings and deductions for that month only, and add a note. The edits are kept apart from the payslip and
 * applied on top of the calculated payslip every time the run is worked out again, so recalculating never loses them.
 * PAYE, NSSF, SHIF, the housing levy and net pay are never typed in: they are worked out from the edited earnings with
 * the same calculation payroll uses (lib/statutoryCalc, lib/earnings).
 */

export const EDITABLE_FIELDS = [
  { key: 'basic_salary', label: 'Basic salary' },
  { key: 'house_allowance', label: 'House allowance' },
  { key: 'transport_allowance', label: 'Transport allowance' },
  { key: 'medical_allowance', label: 'Medical allowance' },
  { key: 'other_allowances', label: 'Other allowances' },
  { key: 'overtime_amount', label: 'Overtime' },
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number]['key'];

export interface OneOffEarning {
  label: string;
  amount: number;
  /** counts towards PAYE (and NSSF) pay; every one-off earning counts for SHIF and the housing levy */
  taxable: boolean;
}

export interface OneOffDeduction {
  label: string;
  amount: number;
}

/** payslip_overrides.overrides */
export interface PayslipOverride {
  fields?: Partial<Record<EditableField, number>>;
  /** an earning line's new amount, by its name (every line of that name) */
  earning_amounts?: Record<string, number>;
  one_off_earnings?: OneOffEarning[];
  one_off_deductions?: OneOffDeduction[];
  note?: string;
}

/** What working out the statutory deductions needs besides the payslip: the month's rates and the employee's inputs. */
export interface StatutoryContext {
  rates: Rates;
  inputs: Omit<StatutoryInput, 'cashPay' | 'apply'>;
  apply: NonNullable<StatutoryInput['apply']>;
  /** a contractor: withholding tax at this rate instead of PAYE, NSSF, SHIF and AHL (FIG-812) */
  wht?: { rate: number };
  /** Employment Act s.19(3) two-thirds cap on a settlement payslip's deductions (default on) */
  cap?: boolean;
}

/**
 * The context for one employee, as the payroll page works it out: a deduction is left out while the employee's SHA /
 * NSSF number or KRA PIN is missing, unless statutory checks are overridden.
 */
export const statutoryContextFor = (
  employee: Record<string, unknown> | undefined,
  rates: Rates | null | undefined,
  overrideStatutoryChecks: boolean,
  cap = true,
): StatutoryContext => {
  const e = employee ?? {};
  const has = (...keys: string[]) => keys.some((k) => Boolean(e[k]));
  // a contractor pays withholding tax instead (lib/workSettlement)
  if (isContractor(e)) {
    return {
      rates: rates ?? {},
      inputs: employeeInputs(e),
      apply: { shif: false, nssf: false, ahl: false, paye: false },
      wht: { rate: whtRateFor(e, rates ?? {}) },
      cap,
    };
  }
  return {
    cap,
    rates: rates ?? {},
    inputs: employeeInputs(e),
    apply: {
      shif: overrideStatutoryChecks || has('NHIF Number', 'SHIF Number'),
      nssf: overrideStatutoryChecks || has('NSSF Number'),
      ahl: overrideStatutoryChecks || has('Tax PIN'),
      paye: overrideStatutoryChecks || has('Tax PIN'),
    },
  };
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const earningItemsOf = (record: { earning_items?: unknown }): EarningItem[] =>
  Array.isArray(record.earning_items)
    ? (record.earning_items as Partial<EarningItem>[]).map((i) => ({
        name: String(i.name ?? ''),
        amount: num(i.amount),
        taxable: i.taxable !== false,
        pensionable: i.pensionable !== false,
      }))
    : [];

const deductionItemsOf = (record: { deduction_items?: unknown }): DeductionItem[] =>
  Array.isArray(record.deduction_items) ? (record.deduction_items as DeductionItem[]).map((i) => ({ ...i, amount: num(i.amount) })) : [];

/** A cleaned-up override: no blank labels, no amounts at or below 0 on one-offs, no empty note; null when nothing is left. */
export const normaliseOverride = (o: PayslipOverride | null | undefined): PayslipOverride | null => {
  if (!o) return null;
  const fields = Object.fromEntries(
    Object.entries(o.fields ?? {}).filter(([k, v]) => EDITABLE_FIELDS.some((f) => f.key === k) && v !== undefined && v !== null && Number.isFinite(Number(v)) && Number(v) >= 0).map(([k, v]) => [k, round2(Number(v))]),
  ) as PayslipOverride['fields'];
  const earning_amounts = Object.fromEntries(
    Object.entries(o.earning_amounts ?? {}).filter(([k, v]) => k && Number.isFinite(Number(v)) && Number(v) >= 0).map(([k, v]) => [k, round2(Number(v))]),
  );
  const one_off_earnings = (o.one_off_earnings ?? [])
    .map((e) => ({ label: String(e.label ?? '').trim(), amount: round2(num(e.amount)), taxable: e.taxable !== false }))
    .filter((e) => e.label && e.amount > 0);
  const one_off_deductions = (o.one_off_deductions ?? [])
    .map((d) => ({ label: String(d.label ?? '').trim(), amount: round2(num(d.amount)) }))
    .filter((d) => d.label && d.amount > 0);
  const note = String(o.note ?? '').trim();
  const out: PayslipOverride = {};
  if (fields && Object.keys(fields).length) out.fields = fields;
  if (Object.keys(earning_amounts).length) out.earning_amounts = earning_amounts;
  if (one_off_earnings.length) out.one_off_earnings = one_off_earnings;
  if (one_off_deductions.length) out.one_off_deductions = one_off_deductions;
  if (note) out.note = note;
  return Object.keys(out).length ? out : null;
};

export const isEmptyOverride = (o: PayslipOverride | null | undefined) => normaliseOverride(o) === null;

/** The overtime amount on a payslip: its overtime lines (FIG-889), else hours x rate. */
export const overtimeOf = (record: Record<string, unknown>) => payslipOvertimePay(record);

/** A payslip field's amount as the edit form shows it. */
export const fieldValue = (record: Record<string, unknown>, field: EditableField) =>
  field === 'overtime_amount' ? overtimeOf(record) : num(record[field]);

type Payslip = Record<string, any>;
/** a payslip as shown: with its note, and whether it has edits */
export type EditablePayslip<T> = T & { payslip_note?: string | null; payslip_edited?: boolean };

/**
 * The payslip with the edits applied on top: earnings changed, one-offs added, then gross pay, PAYE, NSSF, SHIF, the
 * housing levy, total deductions and net pay worked out again. With no edits the payslip comes back as it is.
 * Other deductions (voluntary deductions, loans, advances) and leave taken off pay stay as calculated.
 */
export function applyPayslipOverride<T extends Payslip>(record: T, override: PayslipOverride | null | undefined, ctx: StatutoryContext): EditablePayslip<T> {
  const o = normaliseOverride(override);
  if (!o) return record;
  const f = o.fields ?? {};
  const next: Payslip = { ...record };

  // the salary and allowances typed in
  let delta = 0;
  for (const key of ['basic_salary', 'house_allowance', 'transport_allowance', 'medical_allowance', 'other_allowances'] as const) {
    const value = f[key];
    if (value === undefined) continue;
    delta += value - num(record[key]);
    next[key] = value;
  }
  // overtime is hours x rate on the payslip: a new amount keeps the hours and changes the rate (1 hour when there were none)
  if (f.overtime_amount !== undefined) {
    const hours = num(record.overtime_hours) > 0 ? num(record.overtime_hours) : 1;
    delta += f.overtime_amount - overtimeOf(record);
    next.overtime_hours = hours;
    next.overtime_rate = f.overtime_amount / hours;
    // the overtime lines become one edited line, so the payslip shows what is paid
    next.overtime_pay = f.overtime_amount;
    next.overtime_items = f.overtime_amount > 0
      ? [{ name: 'Overtime (edited)', day_type: 'normal', hours, hourly_rate: round2(f.overtime_amount / hours), multiplier: 1, amount: f.overtime_amount }]
      : [];
  }

  // earning lines (bonuses, commissions...) with their new amounts, then the one-offs
  const amounts = o.earning_amounts ?? {};
  const items: EarningItem[] = [
    ...earningItemsOf(record).map((i) => (i.name in amounts ? { ...i, amount: amounts[i.name] } : i)),
    ...(o.one_off_earnings ?? []).map((e) => ({ name: e.label, amount: e.amount, taxable: e.taxable, pensionable: e.taxable })),
  ];
  const earnings = summariseEarnings(items);
  delta += earnings.total - (num(record.commission) + num(record.bonus));
  next.earning_items = items;
  next.commission = earnings.commission;
  next.bonus = earnings.bonus;

  const grossPay = round2(num(record.gross_pay) + delta);
  // the per diem is a share of the basic earned this month, not taxed (as payroll works it out)
  const { perDiem } = basicAfterLeave(num(next.basic_salary), num(record.leave_deduction));
  const statutory = statutoryFor(
    { ...statutoryPayWith(grossPay - perDiem - earnings.total, items), ...ctx.inputs, apply: ctx.apply },
    ctx.rates,
  );

  const oneOffDeductions = (o.one_off_deductions ?? []).map((d) => ({ name: d.label, amount: d.amount }));
  const otherDeductions = round2(num(record.other_deductions) + oneOffDeductions.reduce((s, d) => s + d.amount, 0));
  // a contractor's withholding tax on the edited gross (FIG-812)
  const whtTax = ctx.wht ? whtOn(grossPay, ctx.wht.rate) : 0;
  const totalDeductions = round2(
    statutory.paye + statutory.shif + statutory.nssf + statutory.ahl + whtTax +
      num(record.loan_deduction) + num(record.advance_deduction) + num(record.welfare_deduction) + otherDeductions,
  );
  // a payslip settling a month of work: the balance after payouts and arrears, never below 0 (lib/workSettlement)
  const settlement = isSettlementPayslip(record)
    ? settleMonth({
        grossPay,
        totalDeductions,
        statutory: statutory.paye + statutory.shif + statutory.nssf + statutory.ahl + whtTax,
        paidOut: num(record.paid_out),
        arrearsBroughtForward: num(record.arrears_brought_forward),
        cap: ctx.cap !== false && !ctx.wht && !isContractorPayslip(record),
      })
    : null;

  Object.assign(next, {
    per_diem: perDiem,
    gross_pay: grossPay,
    paye_tax: statutory.paye,
    nhif_deduction: statutory.shif,
    nssf_deduction: statutory.nssf,
    housing_levy: statutory.ahl,
    tax_relief: statutory.personalRelief,
    deduction_items: [...deductionItemsOf(record), ...oneOffDeductions],
    other_deductions: otherDeductions,
    total_deductions: totalDeductions,
    net_pay: settlement ? settlement.netPay : round2(grossPay - totalDeductions),
    payslip_note: o.note ?? null,
  });
  if (ctx.wht) Object.assign(next, { wht_rate: ctx.wht.rate, wht_tax: whtTax, tax_relief: 0 });
  if (settlement) Object.assign(next, { arrears_carried_forward: settlement.carriedForward, arrears_note: arrearsNote(settlement) });
  return next as EditablePayslip<T>;
}

/**
 * The month's calculated payslips with each one's edits applied (by employee number), marked payslip_edited.
 * ctxFor gives an employee's statutory context; it is only asked for payslips that have edits.
 */
export function withPayslipEdits<T extends Payslip>(
  records: T[],
  overrides: Map<string, PayslipOverride>,
  ctxFor: (record: T) => StatutoryContext,
): EditablePayslip<T>[] {
  if (!overrides.size) return records;
  return records.map((r) => {
    const o = overrides.get(r.employee_id);
    return o && !isEmptyOverride(o) ? { ...applyPayslipOverride(r, o, ctxFor(r)), payslip_edited: true } : r;
  });
}

/** Saved payslips marked payslip_edited when they have edits. */
export const markEditedPayslips = <T extends Payslip>(records: T[], overrides: Map<string, PayslipOverride>): EditablePayslip<T>[] =>
  overrides.size ? records.map((r) => (overrides.has(r.employee_id) ? { ...r, payslip_edited: true } : r)) : records;

/** The salary_history columns an edit changes (written to the saved payslip along with the edit). */
export const EDITED_COLUMNS = [
  'basic_salary', 'house_allowance', 'transport_allowance', 'medical_allowance', 'other_allowances', 'overtime_hours',
  'overtime_rate', 'commission', 'bonus', 'per_diem', 'gross_pay', 'paye_tax', 'nhif_deduction', 'nssf_deduction',
  'housing_levy', 'tax_relief', 'other_deductions', 'total_deductions', 'net_pay', 'earning_items', 'deduction_items',
  'payslip_note', 'wht_tax', 'arrears_carried_forward', 'arrears_note',
] as const;

export const editedColumnsOf = (record: Payslip) =>
  Object.fromEntries(
    EDITED_COLUMNS.map((k) => [
      k,
      k === 'earning_items' || k === 'deduction_items' ? (Array.isArray(record[k]) ? record[k] : []) : k === 'payslip_note' || k === 'arrears_note' ? (record[k] || null) : num(record[k]),
    ]),
  );

// ---------------------------------------------------------------------------------------------
// before -> after
// ---------------------------------------------------------------------------------------------

export interface PayslipChange {
  field: string;
  before: number | string | null;
  after: number | string | null;
}

/** The figures the preview always shows, before and after. */
export const SUMMARY_LINES = [
  { key: 'gross_pay', label: 'Gross pay' },
  { key: 'paye_tax', label: 'PAYE' },
  { key: 'nssf_deduction', label: 'NSSF' },
  { key: 'nhif_deduction', label: 'SHIF' },
  { key: 'housing_levy', label: 'Housing levy' },
  { key: 'total_deductions', label: 'Total deductions' },
  { key: 'net_pay', label: 'Net pay' },
] as const;

const linesOf = (record: Payslip) => {
  const lines = new Map<string, number | string | null>();
  for (const f of EDITABLE_FIELDS) lines.set(f.label, fieldValue(record, f.key));
  const add = (label: string, amount: number) => lines.set(label, round2(num(lines.get(label)) + amount));
  for (const i of earningItemsOf(record)) add(`Earning: ${i.name}${i.taxable ? '' : ' (not taxed)'}`, i.amount);
  for (const d of deductionItemsOf(record)) add(`Deduction: ${d.name}`, d.amount);
  for (const s of SUMMARY_LINES) lines.set(s.label, round2(num(record[s.key])));
  lines.set('Note', record.payslip_note ? String(record.payslip_note) : null);
  return lines;
};

/** Every line that differs between two versions of a payslip (what the history records). */
export const payslipChanges = (before: Payslip, after: Payslip): PayslipChange[] => {
  const a = linesOf(before);
  const b = linesOf(after);
  const changes: PayslipChange[] = [];
  for (const field of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(field) ?? (field === 'Note' ? null : 0);
    const y = b.get(field) ?? (field === 'Note' ? null : 0);
    if (x !== y) changes.push({ field, before: x, after: y });
  }
  return changes;
};
