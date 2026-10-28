/**
 * Reimbursements (tables reimbursement_types, employee_reimbursements; migration 20261028100000): per diem, mileage
 * and the company's own columns, typed in on the payroll page for each employee each month. They are paid back, not
 * earned: never taxed, never part of gross pay or the pay NSSF, SHIF and the housing levy are worked out on, and added
 * to net pay after deductions. Pure: the database calls are in reimbursementsDb.
 *
 * The payroll page's columns (finance's names): Basic pay is the payslip's gross_pay, Gross pay is what is left after
 * deductions, and Net pay is that plus the reimbursements (the payslip's net_pay, what is paid).
 */
export interface ReimbursementType {
  id: string;
  name: string;
  position: number;
  /** a removed column is paused: it isn't shown or paid until it is added back */
  active: boolean;
}

export interface EmployeeReimbursement {
  id: string;
  employee_number: string;
  reimbursement_type_id: string;
  /** 'YYYY-MM' */
  pay_period: string;
  amount: number;
}

/** One reimbursement on a payslip (salary_history.reimbursement_items) */
export interface ReimbursementItem {
  name: string;
  amount: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/** The columns the payroll page shows, in order. */
export const reimbursementColumns = (types: ReimbursementType[]) =>
  types.filter((t) => t.active).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

/** Each employee's reimbursements for the pay period, by employee number, in column order (paused columns left out). */
export const reimbursementsForPeriod = (types: ReimbursementType[], rows: EmployeeReimbursement[], period: string) => {
  const columns = reimbursementColumns(types);
  const result = new Map<string, ReimbursementItem[]>();
  for (const type of columns) {
    for (const r of rows) {
      if (r.reimbursement_type_id !== type.id || r.pay_period !== period || !(num(r.amount) > 0)) continue;
      const items = result.get(r.employee_number) ?? [];
      items.push({ name: type.name, amount: round2(num(r.amount)) });
      result.set(r.employee_number, items);
    }
  }
  return result;
};

/** A payslip's reimbursements (none on payslips saved before them). */
export const reimbursementItemsOf = (payslip: { reimbursement_items?: unknown }): ReimbursementItem[] =>
  Array.isArray(payslip.reimbursement_items)
    ? (payslip.reimbursement_items as Partial<ReimbursementItem>[])
        .map((i) => ({ name: String(i.name ?? ''), amount: round2(num(i.amount)) }))
        .filter((i) => i.amount > 0)
    : [];

/** What a payslip pays back for the named column, 0 when none. */
export const reimbursementOf = (payslip: { reimbursement_items?: unknown }, name: string) =>
  round2(reimbursementItemsOf(payslip).filter((i) => i.name === name).reduce((s, i) => s + i.amount, 0));

/** The payroll page's Gross pay: what is left of the payslip after deductions, before reimbursements. */
export const afterDeductionsOf = (payslip: { net_pay?: unknown; reimbursements?: unknown }) => round2(num(payslip.net_pay) - num(payslip.reimbursements));

/**
 * The payslip with these reimbursements: their lines and total, and net pay = what is left after deductions + the
 * total. Replaces any reimbursements it already had, so it can be applied again.
 */
export const withReimbursements = <T extends { net_pay?: unknown; reimbursements?: unknown }>(payslip: T, items: ReimbursementItem[]) => {
  const lines = items.filter((i) => num(i.amount) > 0).map((i) => ({ name: i.name, amount: round2(num(i.amount)) }));
  const total = round2(lines.reduce((s, i) => s + i.amount, 0));
  return { ...payslip, reimbursement_items: lines, reimbursements: total, net_pay: round2(afterDeductionsOf(payslip) + total) };
};

/** The payslip with one column's amount set (0 clears it), the other columns as they were, in column order. */
export const withReimbursement = <T extends { net_pay?: unknown; reimbursements?: unknown; reimbursement_items?: unknown }>(
  payslip: T,
  name: string,
  amount: number,
  columns: string[],
) => {
  const others = reimbursementItemsOf(payslip).filter((i) => i.name !== name);
  const next = [...others, { name, amount }];
  const at = (n: string) => (columns.indexOf(n) === -1 ? columns.length : columns.indexOf(n));
  return withReimbursements(payslip, next.sort((a, b) => at(a.name) - at(b.name)));
};

/** Parses what was typed in a reimbursement box: a number of 0 or more (commas allowed), or null when it isn't one. */
export const parseReimbursement = (text: string): number | null => {
  const clean = text.replace(/[,\s]/g, '');
  if (clean === '') return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  return round2(Number(clean));
};

/**
 * The columns a list of payslips needs: the company's active columns, then any other name found on the payslips
 * (a removed column a saved payslip still pays), so every payslip's net pay adds up.
 */
export const reimbursementNamesFor = (columns: string[], payslips: { reimbursement_items?: unknown }[]) => {
  const names = [...columns];
  for (const p of payslips) for (const i of reimbursementItemsOf(p)) if (!names.includes(i.name)) names.push(i.name);
  return names;
};
