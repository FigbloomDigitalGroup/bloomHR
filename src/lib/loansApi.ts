import { supabase } from './supabase';
import { IN_LIST_SIZE, chunks, fetchAll } from './fetchAll';
import { requireUpdatedRows } from './requireUpdated';
import { decideApproval } from './approvals';
import type { MyEmployee } from './salaryAdvanceApi';
import {
  ACTIVE_STATUSES,
  DEFAULT_LOAN_SETTINGS,
  type InterestMethod,
  type LoanInstalment,
  type LoanProduct,
  type LoanRepayment,
  type LoanSettings,
  type LoanStatus,
  type PayrollLoan,
} from './loans';

// Reading and saving employee loans (migration 20261016700000). The database fills in the rate, builds the schedule,
// checks the limits and who may do what; these only read and write. Nothing here pays anyone: "Mark as disbursed"
// records that finance paid the loan outside the app, which is what makes payroll start taking the instalments.

const NOT_SAVED = 'The loan was not saved: you do not have permission to change it, or it no longer exists.';

export interface EmployeeLoan {
  id: string;
  employee_number: string;
  product_id: string | null;
  product_name: string | null;
  principal: number;
  annual_rate: number;
  interest_method: InterestMethod;
  months: number;
  start_period: string;
  monthly_instalment: number | null;
  total_interest: number | null;
  total_repayable: number | null;
  status: LoanStatus;
  reason: string | null;
  decided_by_email: string | null;
  decided_at: string | null;
  decision_comment: string | null;
  disbursed_by_email: string | null;
  disbursed_at: string | null;
  created_at: string;
  /** added on the HR screen: the employee's name */
  employee_name?: string;
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

const toLoan = (row: Record<string, unknown>): EmployeeLoan =>
  ({
    ...row,
    principal: Number(row.principal),
    annual_rate: Number(row.annual_rate),
    months: Number(row.months),
    monthly_instalment: num(row.monthly_instalment),
    total_interest: num(row.total_interest),
    total_repayable: num(row.total_repayable),
  }) as EmployeeLoan;

const toInstalment = (row: Record<string, unknown>): LoanInstalment => ({
  instalment_no: Number(row.instalment_no),
  period: String(row.period),
  payment: Number(row.payment),
  principal: Number(row.principal),
  interest: Number(row.interest),
  balance: Number(row.balance),
});

const friendly = (error: { message?: string } | null) => new Error(error?.message || 'Not saved. Please try again.');

// ---------------------------------------------------------------------------------------------
// settings and loan types
// ---------------------------------------------------------------------------------------------

export async function loadLoanSettings(): Promise<LoanSettings> {
  const { data, error } = await supabase
    .from('loan_settings')
    .select('annual_rate, interest_method, min_months, max_months, max_amount, max_salary_multiple, staff_can_apply')
    .maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_LOAN_SETTINGS;
  return {
    annual_rate: Number(data.annual_rate),
    interest_method: data.interest_method as InterestMethod,
    min_months: Number(data.min_months),
    max_months: Number(data.max_months),
    max_amount: num(data.max_amount),
    max_salary_multiple: num(data.max_salary_multiple),
    staff_can_apply: data.staff_can_apply !== false,
  };
}

export async function saveLoanSettings(settings: LoanSettings): Promise<void> {
  // one row per company: the database fills in the company
  const { error } = await supabase.from('loan_settings').upsert({ ...settings, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id' });
  if (error) throw friendly(error);
}

export async function loadLoanProducts(): Promise<LoanProduct[]> {
  const { data, error } = await supabase.from('loan_products').select('id, name, annual_rate, interest_method, max_months, active').order('name');
  if (error) throw error;
  return (data ?? []).map((p) => ({ ...p, annual_rate: Number(p.annual_rate), max_months: Number(p.max_months) })) as LoanProduct[];
}

export async function saveLoanProduct(product: Omit<LoanProduct, 'id'> & { id?: string }): Promise<void> {
  const { id, ...fields } = product;
  const values = { ...fields, name: fields.name.trim() };
  const { error } = id ? await supabase.from('loan_products').update(values).eq('id', id) : await supabase.from('loan_products').insert(values);
  if (error) throw error.code === '23505' ? new Error(`There is already a loan type called "${values.name}".`) : friendly(error);
}

// ---------------------------------------------------------------------------------------------
// the staff portal
// ---------------------------------------------------------------------------------------------

export interface LoanWithSchedule extends EmployeeLoan {
  schedule: LoanInstalment[];
  repayments: LoanRepayment[];
}

/** Each loan's schedule and repayments, by loan id (the database shows only the ones the signed-in person may see). */
export async function loadSchedules(loanIds: string[]) {
  const schedules: Record<string, LoanInstalment[]> = {};
  const repayments: Record<string, LoanRepayment[]> = {};
  for (const ids of chunks([...new Set(loanIds)], IN_LIST_SIZE)) {
    const [s, r] = await Promise.all([
      fetchAll<Record<string, unknown>>((from, to) =>
        supabase.from('employee_loan_instalments').select('loan_id, instalment_no, period, payment, principal, interest, balance').in('loan_id', ids).order('loan_id').order('instalment_no').range(from, to)
      ),
      fetchAll<Record<string, unknown>>((from, to) =>
        supabase.from('employee_loan_repayments').select('loan_id, pay_period, amount').in('loan_id', ids).order('loan_id').order('pay_period').range(from, to)
      ),
    ]);
    for (const row of s) (schedules[String(row.loan_id)] ??= []).push(toInstalment(row));
    for (const row of r) (repayments[String(row.loan_id)] ??= []).push({ loan_id: String(row.loan_id), pay_period: String(row.pay_period), amount: Number(row.amount) });
  }
  return { schedules, repayments };
}

const withSchedules = async (loans: EmployeeLoan[]): Promise<LoanWithSchedule[]> => {
  const { schedules, repayments } = await loadSchedules(loans.map((l) => l.id));
  return loans.map((l) => ({ ...l, schedule: schedules[l.id] ?? [], repayments: repayments[l.id] ?? [] }));
};

export async function loadMyLoans(employeeNumber: string): Promise<LoanWithSchedule[]> {
  const { data, error } = await supabase.from('employee_loans').select('*').eq('employee_number', employeeNumber).order('created_at', { ascending: false });
  if (error) throw error;
  return withSchedules((data ?? []).map(toLoan));
}

export async function requestLoan(employee: MyEmployee, input: { productId: string | null; amount: number; months: number; reason: string }) {
  const { error } = await supabase.from('employee_loans').insert({
    employee_number: employee.employeeNumber,
    product_id: input.productId,
    principal: input.amount,
    months: input.months,
    reason: input.reason.trim(),
    status: 'requested',
  });
  if (error) throw friendly(error);
}

// ---------------------------------------------------------------------------------------------
// HR
// ---------------------------------------------------------------------------------------------

/** Every loan, newest first, with the employee's name. */
export async function loadAllLoans(): Promise<EmployeeLoan[]> {
  const loans = (
    await fetchAll<Record<string, unknown>>((from, to) =>
      supabase.from('employee_loans').select('*').order('created_at', { ascending: false }).order('id').range(from, to)
    )
  ).map(toLoan);
  const names: Record<string, string> = {};
  for (const part of chunks([...new Set(loans.map((l) => l.employee_number))], IN_LIST_SIZE)) {
    const { data, error } = await supabase.from('employees').select('"Employee Number", "First Name", "Last Name"').in('"Employee Number"', part);
    if (error) throw error;
    for (const e of data ?? []) names[String(e['Employee Number'])] = [e['First Name'], e['Last Name']].filter(Boolean).join(' ');
  }
  return loans.map((l) => ({ ...l, employee_name: names[l.employee_number] || l.employee_number }));
}

async function update(id: string, values: Record<string, unknown>) {
  const { data, error } = await supabase.from('employee_loans').update(values).eq('id', id).select('id');
  if (error) throw friendly(error);
  requireUpdatedRows(data, NOT_SAVED);
}

export interface NewLoan {
  employeeNumber: string;
  productId: string | null;
  amount: number;
  months: number;
  startPeriod: string;
  /** null: the loan type's or the company's rate */
  annualRate: number | null;
  interestMethod: InterestMethod | null;
  reason: string;
}

/** HR sets up a loan for an employee: approved straight away. */
/**
 * HR sets up a loan for an employee, approved at once. When the company's loan approvals have more than one step (or
 * one HR can't decide), the database puts it on the chain instead: the status it got is returned.
 */
export async function createLoan(loan: NewLoan): Promise<LoanStatus> {
  const { data, error } = await supabase.from('employee_loans').insert({
    employee_number: loan.employeeNumber,
    product_id: loan.productId,
    principal: loan.amount,
    months: loan.months,
    start_period: loan.startPeriod,
    annual_rate: loan.annualRate,
    interest_method: loan.interestMethod,
    reason: loan.reason.trim() || null,
    status: 'approved',
  }).select('status').single();
  if (error) throw friendly(error);
  return (data?.status ?? 'approved') as LoanStatus;
}

/**
 * Approves a request's current step on its approval chain (20261025700000); the first repayment month can be changed
 * in the same step. 'approved' once the last step approved it, 'pending' while later steps remain.
 */
export async function approveLoan(id: string, requestId: string, input: { comment: string; startPeriod: string }) {
  await update(id, { start_period: input.startPeriod });
  return decideApproval(requestId, 'approved', input.comment.trim());
}

/** Turns a request down on its approval chain (a reason is needed). */
export async function declineLoan(requestId: string, reason: string) {
  await decideApproval(requestId, 'rejected', reason.trim());
}

/** Finance paid it outside the app: payroll takes the instalments from now on. */
export const markLoanDisbursed = (id: string) => update(id, { status: 'disbursed' });

export const cancelLoan = (id: string) => update(id, { status: 'cancelled' });

/** Staff withdraw their own request while it waits. */
export const withdrawLoan = (id: string) => update(id, { status: 'cancelled' });

// ---------------------------------------------------------------------------------------------
// payroll
// ---------------------------------------------------------------------------------------------

/** Every loan payroll takes instalments for, with its schedule and what has been repaid. */
export async function loadPayrollLoans(): Promise<PayrollLoan[]> {
  const loans = (
    await fetchAll<Record<string, unknown>>((from, to) =>
      supabase.from('employee_loans').select('id, employee_number, product_name, status, created_at').in('status', ACTIVE_STATUSES).order('created_at').order('id').range(from, to)
    )
  ).map((l) => ({ id: String(l.id), employee_number: String(l.employee_number), product_name: (l.product_name as string | null) ?? null, status: l.status as LoanStatus }));
  const { schedules, repayments } = await loadSchedules(loans.map((l) => l.id));
  return loans.map((l) => ({ ...l, schedule: schedules[l.id] ?? [], repayments: repayments[l.id] ?? [] }));
}
