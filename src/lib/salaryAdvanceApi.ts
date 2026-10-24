import { supabase } from './supabase';
import { fetchAll, IN_LIST_SIZE, chunks } from './fetchAll';
import { requireUpdatedRows } from './requireUpdated';
import type { AdvanceRow, AdvanceTaken, PayeeRecord } from './salaryAdvance';

// Reading and saving salary advances for the staff request screen, the approver queue and payroll. Nothing here pays
// anyone: finance pays outside the app and records it in Payments to make, which is what makes payroll take it back.

const NOT_SAVED = 'The request was not saved: you do not have permission to change it, or it no longer exists.';

export interface MyEmployee {
  employeeNumber: string;
  fullName: string;
  office: string;
  basicSalary: string;
  terminated: boolean;
}

/** The signed-in staff member's employee record (matched on Work Email, as the rest of the portal does). */
export async function loadMyEmployee(): Promise<MyEmployee | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return null;
  const { data, error } = await supabase
    .from('employees')
    .select('"Employee Number", "First Name", "Last Name", "Office", "Basic Salary", "Termination Date"')
    .eq('"Work Email"', user.email)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    employeeNumber: String(data['Employee Number'] ?? ''),
    fullName: [data['First Name'], data['Last Name']].filter(Boolean).join(' '),
    office: data['Office'] ?? '',
    basicSalary: String(data['Basic Salary'] ?? '0'),
    terminated: Boolean(data['Termination Date']),
  };
}

/** Whether the company has advance requests open, and the message to show when they are not. */
export async function loadAdvanceWindow(): Promise<{ open: boolean; message: string }> {
  const { data } = await supabase.from('salary_advance_settings').select('applications_active, custom_message').eq('id', 1).maybeSingle();
  return {
    // no settings row: requests are open
    open: data ? data.applications_active !== false : true,
    message: data?.custom_message || 'Salary advance requests are closed for now. They reopen at the start of next month.',
  };
}

export async function loadMyAdvances(employeeNumber: string): Promise<AdvanceRow[]> {
  const { data, error } = await supabase
    .from('salary_advance')
    .select('*')
    .eq('"Employee Number"', employeeNumber)
    .order('time_added', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Calls `onChange` when one of the employee's requests changes (approved, paid...). Returns the unsubscribe. */
export function watchMyAdvances(employeeNumber: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`salary_advance_${employeeNumber}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'salary_advance', filter: `"Employee Number"=eq.${employeeNumber}` }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

export async function requestAdvance(employee: MyEmployee, input: { amount: number; reason: string; months: number }) {
  const { error } = await supabase.from('salary_advance').insert([{
    'Employee Number': employee.employeeNumber,
    'Full Name': employee.fullName,
    'Office Branch': employee.office,
    'Basic Salary': employee.basicSalary,
    'Amount Requested': input.amount,
    'Net Salary': String((parseFloat(employee.basicSalary) || 0) - input.amount),
    'Reason for Advance': input.reason.trim(),
    // one month is the column's default; leaving it out keeps one-month requests working on a database without it
    ...(input.months > 1 ? { repayment_months: input.months } : {}),
    status: 'Pending',
    time_added: new Date().toISOString(),
  }]);
  if (error) throw error;
}

/** Every request the approver may see (the database limits it to their company and access). */
export async function loadAdvanceQueue(): Promise<AdvanceRow[]> {
  return fetchAll<AdvanceRow>((from, to) => supabase
    .from('salary_advance')
    .select('*')
    .order('time_added', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to));
}

const APPROVED = ['approved', 'paid'];

/**
 * What these people's approved payslips took back for advances, month by month, for payroll to catch up on parts it
 * missed. A payslip counts once its country of the run is approved (payroll_run_countries), or the run is when it has
 * no countries; payslips of draft runs and those outside any run don't.
 */
export async function loadAdvancesTaken(employeeNumbers: string[]): Promise<AdvanceTaken[]> {
  const unique = [...new Set(employeeNumbers.map(String).filter(Boolean))];
  if (unique.length === 0) return [];
  const [runs, countries] = await Promise.all([
    supabase.from('payroll_runs').select('id, status'),
    supabase.from('payroll_run_countries').select('run_id, country, status'),
  ]);
  if (runs.error) throw runs.error;
  const runApproved = new Map((runs.data ?? []).map((r) => [String(r.id), APPROVED.includes(String(r.status))]));
  const byCountry = new Map<string, boolean>();
  const runsWithCountries = new Set<string>();
  // a database without payroll_run_countries yet: the runs' own status
  for (const c of countries.error ? [] : countries.data ?? []) {
    runsWithCountries.add(String(c.run_id));
    byCountry.set(`${c.run_id}|${String(c.country ?? '').toLowerCase()}`, APPROVED.includes(String(c.status)));
  }
  const out: AdvanceTaken[] = [];
  for (const part of chunks(unique, IN_LIST_SIZE)) {
    const rows = await fetchAll<{ employee_id: string; pay_period: string; advance_deduction: number | string | null; run_id: string | null; country: string | null }>(
      (from, to) =>
        supabase
          .from('salary_history')
          .select('id, employee_id, pay_period, advance_deduction, run_id, country')
          .in('employee_id', part)
          .order('id')
          .range(from, to),
    );
    for (const r of rows) {
      if (!r.run_id || !r.pay_period) continue;
      const run = String(r.run_id);
      const approved = runsWithCountries.has(run) ? byCountry.get(`${run}|${String(r.country ?? '').toLowerCase()}`) : runApproved.get(run);
      if (!approved) continue;
      out.push({ employee_number: String(r.employee_id), pay_period: r.pay_period, amount: Number(r.advance_deduction) || 0 });
    }
  }
  return out;
}

/** Payment details of the people in the queue, by employee number. */
export async function loadPayees(employeeNumbers: string[]): Promise<Record<string, PayeeRecord>> {
  const out: Record<string, PayeeRecord> = {};
  const unique = [...new Set(employeeNumbers.filter(Boolean))];
  for (const part of chunks(unique, IN_LIST_SIZE)) {
    const { data, error } = await supabase
      .from('employees')
      .select('"Employee Number", "First Name", "Middle Name", "Last Name", payment_method, "Mobile Number", "Bank", "Account Number", account_number_name')
      .in('"Employee Number"', part);
    if (error) throw error;
    for (const e of data ?? []) out[String(e['Employee Number'])] = e;
  }
  return out;
}

async function who() {
  const { data: { user } } = await supabase.auth.getUser();
  return { id: user?.id ?? null, email: user?.email ?? null };
}

async function update(id: string, values: Record<string, unknown>) {
  const { data, error } = await supabase
    .from('salary_advance')
    .update({ ...values, last_updated: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  requireUpdatedRows(data, NOT_SAVED);
}

export async function approveAdvance(id: string) {
  const me = await who();
  await update(id, {
    status: 'approved',
    admin_approval: 'true',
    admin_approval_date: new Date().toISOString(),
    approved_by: me.id,
    approved_by_email: me.email,
  });
}

export async function declineAdvance(id: string, reason: string) {
  const me = await who();
  await update(id, {
    status: 'rejected',
    admin_approval: 'false',
    admin_notes: reason.trim(),
    admin_rejection_date: new Date().toISOString(),
    rejected_by: me.id,
    rejected_by_email: me.email,
  });
}

/** Finance paid it outside the app: payroll takes it back from now on. */
export async function markAdvancePaid(id: string) {
  const me = await who();
  const paid = { status: 'paid', payment_processed: 'true', payment_date: new Date().toISOString() };
  try {
    await update(id, { ...paid, paid_by: me.id, paid_by_email: me.email });
  } catch (error) {
    // a database without the paid_by columns (20261015600000 not applied yet): record the payment without who
    if (!isMissingColumn(error)) throw error;
    await update(id, paid);
  }
}

const isMissingColumn = (error: unknown) => {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === '42703' || e?.code === 'PGRST204' || /column .* does not exist|Could not find the '.*' column/i.test(e?.message ?? '');
};
