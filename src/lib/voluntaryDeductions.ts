import { supabase } from './supabase';
import { fetchAll } from './fetchAll';

/**
 * Voluntary deductions (tables deduction_types, employee_deductions): the company's list of deductions (SACCO,
 * insurance, welfare...) and the amount each employee has taken every month between two pay periods.
 */
export interface DeductionType {
  id: string;
  name: string;
  /** a paused type is not taken from anyone until it is resumed */
  active: boolean;
}

export interface EmployeeDeduction {
  id: string;
  employee_number: string;
  deduction_type_id: string;
  amount: number;
  /** 'YYYY-MM'; null = from the start */
  start_period: string | null;
  /** 'YYYY-MM'; null = until removed */
  end_period: string | null;
  notes: string | null;
}

/** One line on a payslip (salary_history.deduction_items) */
export interface DeductionItem {
  name: string;
  amount: number;
}

export type NewEmployeeDeduction = Omit<EmployeeDeduction, 'id'>;

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export const appliesInPeriod = (d: Pick<EmployeeDeduction, 'start_period' | 'end_period'>, period: string) =>
  (!d.start_period || d.start_period <= period) && (!d.end_period || d.end_period >= period);

/** Each employee's deductions for the pay period ('YYYY-MM'), by employee number, in the order of the type list. */
export const deductionsForPeriod = (types: DeductionType[], deductions: EmployeeDeduction[], period: string) => {
  const order = new Map(types.map((t, i) => [t.id, i]));
  const byType = new Map(types.map((t) => [t.id, t]));
  const result = new Map<string, DeductionItem[]>();
  for (const d of [...deductions].sort((a, b) => (order.get(a.deduction_type_id) ?? 0) - (order.get(b.deduction_type_id) ?? 0))) {
    const type = byType.get(d.deduction_type_id);
    if (!type?.active || !appliesInPeriod(d, period)) continue;
    const items = result.get(d.employee_number) ?? [];
    items.push({ name: type.name, amount: Number(d.amount) });
    result.set(d.employee_number, items);
  }
  return result;
};

export const totalOf = (items: DeductionItem[]) => items.reduce((sum, i) => sum + i.amount, 0);

/**
 * The voluntary deduction lines on a payslip: its itemised deductions, or, for payslips saved before they were
 * itemised, whichever of its loan / welfare / other amounts are set.
 */
export const payslipDeductionLines = (payslip: {
  deduction_items?: DeductionItem[] | null;
  loan_deduction?: number | string | null;
  welfare_deduction?: number | string | null;
  other_deductions?: number | string | null;
}): DeductionItem[] => {
  const items = Array.isArray(payslip.deduction_items) ? payslip.deduction_items : [];
  if (items.length) return items.map((i) => ({ name: i.name, amount: Number(i.amount) || 0 }));
  return (
    [
      ['Loan', payslip.loan_deduction],
      ['Welfare', payslip.welfare_deduction],
      ['Other', payslip.other_deductions],
    ] as const
  )
    .map(([name, amount]) => ({ name, amount: Number(amount) || 0 }))
    .filter((line) => line.amount > 0);
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A month typed into a spreadsheet as 'YYYY-MM': accepts 2026-10, 2026/10, 2026-10-01, 10/2026, Oct 2026,
 * October 2026, and Oct-26 (what Excel shows after turning 2026-10 into a date).
 * Empty gives null; anything else undefined (not understood).
 */
export const parsePeriod = (value: unknown): string | null | undefined => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  let year: number | undefined;
  let month: number | undefined;
  let m = text.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/);
  if (m) [year, month] = [Number(m[1]), Number(m[2])];
  m = text.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) [year, month] = [Number(m[2]), Number(m[1])];
  m = text.match(/^([a-z]+)[\s,-]+(\d{4}|\d{2})$/i);
  if (m) {
    const index = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (index >= 0) [year, month] = [m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]), index + 1];
  }
  if (!year || !month || month < 1 || month > 12) return undefined;
  const period = `${year}-${String(month).padStart(2, '0')}`;
  return PERIOD.test(period) ? period : undefined;
};

export const DEDUCTION_SHEET_COLUMNS = ['Employee Number', 'Deduction', 'Amount', 'From', 'Until'] as const;

export interface ParsedDeductionRow {
  employee_number: string;
  deduction: string;
  amount: number;
  start_period: string | null;
  end_period: string | null;
}

const cell = (row: Record<string, unknown>, column: string) => {
  const key = Object.keys(row).find((k) => k.trim().toLowerCase() === column.toLowerCase());
  return key === undefined ? '' : row[key];
};

/**
 * Rows of an uploaded deductions sheet (columns as DEDUCTION_SHEET_COLUMNS, any order or case), checked against the
 * company's employee numbers. Row numbers in errors count the header as row 1, as in Excel.
 */
export const parseDeductionSheet = (rows: Record<string, unknown>[], employeeNumbers: Set<string>) => {
  const valid: ParsedDeductionRow[] = [];
  const errors: string[] = [];
  rows.forEach((row, index) => {
    const line = `Row ${index + 2}`;
    const employee_number = String(cell(row, 'Employee Number') ?? '').trim();
    const deduction = String(cell(row, 'Deduction') ?? '').trim();
    const rawAmount = String(cell(row, 'Amount') ?? '').replace(/[,\s]|KSh|Ksh|KES/g, '');
    if (!employee_number && !deduction && !rawAmount) return; // blank line
    const amount = Number(rawAmount);
    const start_period = parsePeriod(cell(row, 'From'));
    const end_period = parsePeriod(cell(row, 'Until'));

    const problems: string[] = [];
    if (!employee_number) problems.push('no employee number');
    else if (!employeeNumbers.has(employee_number)) problems.push(`no employee with number ${employee_number}`);
    if (!deduction) problems.push('no deduction name');
    if (!rawAmount || !Number.isFinite(amount) || amount <= 0) problems.push('amount should be a number above 0');
    if (start_period === undefined) problems.push('"From" should be a month like 2026-10');
    if (end_period === undefined) problems.push('"Until" should be a month like 2026-12');
    if (start_period && end_period && start_period > end_period) problems.push('"Until" is before "From"');

    if (problems.length) errors.push(`${line}: ${problems.join(', ')}`);
    else valid.push({ employee_number, deduction, amount, start_period: start_period ?? null, end_period: end_period ?? null });
  });
  return { valid, errors };
};

// ---------------------------------------------------------------------------------------------
// database
// ---------------------------------------------------------------------------------------------

export const loadDeductionSetup = async () => {
  const [types, deductions] = await Promise.all([
    supabase.from('deduction_types').select('id, name, active').order('name'),
    // every employee's deductions, a page at a time (one request returns at most 1000)
    fetchAll<EmployeeDeduction>((from, to) =>
      supabase
        .from('employee_deductions')
        .select('id, employee_number, deduction_type_id, amount, start_period, end_period, notes')
        .order('id')
        .range(from, to)
    ),
  ]);
  if (types.error) throw types.error;
  return { types: (types.data ?? []) as DeductionType[], deductions };
};

export const addDeductionType = async (name: string) => {
  const { data, error } = await supabase.from('deduction_types').insert({ name: name.trim() }).select('id, name, active').single();
  if (error) throw error.code === '23505' ? new Error(`There is already a deduction called "${name.trim()}".`) : error;
  return data as DeductionType;
};

export const setDeductionTypeActive = async (id: string, active: boolean) => {
  const { error } = await supabase.from('deduction_types').update({ active }).eq('id', id);
  if (error) throw error;
};

export const saveEmployeeDeduction = async (deduction: NewEmployeeDeduction & { id?: string }) => {
  const { id, ...fields } = deduction;
  const { error } = id
    ? await supabase.from('employee_deductions').update(fields).eq('id', id)
    : await supabase.from('employee_deductions').insert(fields);
  if (error) throw error;
};

export const removeEmployeeDeduction = async (id: string) => {
  const { error } = await supabase.from('employee_deductions').delete().eq('id', id);
  if (error) throw error;
};

/** Saves uploaded rows, adding any deduction names the company doesn't have yet. Returns how many types were added. */
export const importDeductionRows = async (rows: ParsedDeductionRow[], types: DeductionType[]) => {
  const byName = new Map(types.map((t) => [t.name.trim().toLowerCase(), t.id]));
  let added = 0;
  for (const name of new Set(rows.map((r) => r.deduction))) {
    if (!byName.has(name.toLowerCase())) {
      byName.set(name.toLowerCase(), (await addDeductionType(name)).id);
      added += 1;
    }
  }
  const { error } = await supabase.from('employee_deductions').insert(
    rows.map((r) => ({
      employee_number: r.employee_number,
      deduction_type_id: byName.get(r.deduction.toLowerCase()),
      amount: r.amount,
      start_period: r.start_period,
      end_period: r.end_period,
    }))
  );
  if (error) throw error;
  return added;
};
