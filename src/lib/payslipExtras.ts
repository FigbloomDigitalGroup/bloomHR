import { supabase } from './supabase';
import { tidyCountry } from './payroll/countries';
import { payslipYtd, payslipYtdFromRows, type PayslipYtd, type YtdPayslip, type YtdTotals } from './payroll/payslipYtd';
import {
  type BranchContacts,
  type EmployerBranch,
  type EmployerProfile,
  type PayslipDesign,
  type PayslipEmployer,
  loadBranchContacts,
  loadPayslipDesign,
  payslipEmployer,
} from './payslipDesign';

// What a payslip shows besides its own figures (FIG-814): the employer block (name, logo or letterhead, address and
// contacts, tax number), the employee's numbers (tax number, NSSF, SHA, ID), the year to date, the payroll run and pay
// date, and the company's payslip design. Loaded before the payslip is drawn, so PayslipDocument itself only renders
// (the emailed PDF is drawn off screen in one go). Everything here is optional: the payslip shows what it has.

/* eslint-disable @typescript-eslint/no-explicit-any -- payslip rows are the untyped rows the payroll page uses */
type Payslip = Record<string, any>;

export interface PayslipEmployeeDetails {
  taxNumber: string | null;
  nssfNumber: string | null;
  shaNumber: string | null;
  idNumber: string | null;
  branch: string | null;
  department: string | null;
  position: string | null;
  jobGroup: string | null;
}

export interface PayslipRunInfo {
  runId: string;
  /** "2026-10 · 1A2B3C4D" */
  ref: string;
  status: string;
  approvedAt: string | null;
  paidAt: string | null;
}

export interface PayslipExtras {
  design?: PayslipDesign;
  employer?: PayslipEmployer;
  employee?: PayslipEmployeeDetails;
  ytd?: PayslipYtd | null;
  run?: PayslipRunInfo | null;
  /** leave balances to show when the design asks for them (not loaded yet: a hook for the leave module) */
  leaveBalance?: { label: string; days: number }[] | null;
}

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const orNull = (v: unknown) => text(v) || null;

/** The payslip's country: its own, else Kenya (payslips saved before payslips had one). */
export const payslipCountry = (record: Payslip) => tidyCountry(text(record?.country)) || 'Kenya';

/** "2026-10 · 1A2B3C4D": the month and the start of the run's id, as payroll sees it on the run. */
export const runRef = (runId: string, payPeriod: string) => `${text(payPeriod)} · ${text(runId).replace(/-/g, '').slice(0, 8).toUpperCase()}`;

// ---------------------------------------------------------------------------------------------
// the company's side, loaded once for a batch of payslips
// ---------------------------------------------------------------------------------------------
interface CompanyContext {
  design: PayslipDesign;
  branchContacts: BranchContacts[];
  branches: EmployerBranch[];
  profile: EmployerProfile | null;
  kraPin: string | null;
}

let cached: { at: number; value: Promise<CompanyContext> } | null = null;
const CACHE_MS = 2 * 60 * 1000;

/** Forget the cached design and company details (after the design is saved). */
export const clearPayslipExtrasCache = () => {
  cached = null;
};

async function loadCompanyContext(): Promise<CompanyContext> {
  const [design, branchContacts, branches, profile, pin] = await Promise.all([
    loadPayslipDesign(),
    loadBranchContacts(),
    supabase.from('branches').select('id, name, country, city, address').then((r) => (r.error ? [] : ((r.data ?? []) as EmployerBranch[]))),
    supabase.from('company_profile').select('*').maybeSingle().then((r) => (r.error ? null : (r.data as EmployerProfile | null))),
    supabase.rpc('company_tax_details').then((r) => {
      const row = (Array.isArray(r.data) ? r.data[0] : r.data) as { employer_kra_pin?: string | null } | undefined;
      return r.error ? null : orNull(row?.employer_kra_pin);
    }),
  ]);
  return { design, branchContacts, branches, profile, kraPin: pin };
}

const companyContext = () => {
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    const value = loadCompanyContext().catch((e) => {
      cached = null;
      throw e;
    });
    cached = { at: Date.now(), value };
  }
  return cached.value;
};

// ---------------------------------------------------------------------------------------------
// the employee, the year to date and the run
// ---------------------------------------------------------------------------------------------
async function loadEmployee(employeeNumber: string): Promise<(Payslip & { branch_id?: string | null }) | null> {
  const { data, error } = await supabase
    .from('employees')
    .select('"Employee Number", "Tax PIN", "NSSF Number", "SHIF Number", "NHIF Number", "ID Number", branch_id, "Branch", "Job Title", "Job Group"')
    .eq('"Employee Number"', employeeNumber)
    .maybeSingle();
  return error ? null : (data as Payslip | null);
}

const YTD_COLUMNS = 'employee_id, pay_period, country, currency, gross_pay, taxable_pay, paye_tax, nssf_deduction, net_pay, run_id';

/** The year to date: the database's totals of earlier approved months (payslip_ytd), plus this payslip. */
export async function loadPayslipYtd(record: Payslip): Promise<PayslipYtd | null> {
  const employee = text(record.employee_id);
  const period = text(record.pay_period);
  if (!employee || !/^\d{4}-\d{2}$/.test(period)) return null;
  const current: YtdPayslip = { ...record, country: payslipCountry(record) };
  const { data, error } = await supabase.rpc('payslip_ytd', { p_employee: employee, p_pay_period: period });
  if (!error) return payslipYtd(current, ((data ?? []) as YtdTotals[]).map((t) => ({ ...t, currency: text(t.currency).toUpperCase() })));
  // the function isn't there yet (migration not applied): the same totals from the payslips this person can read
  const rows = await supabase.from('salary_history').select(YTD_COLUMNS).eq('employee_id', employee).lt('pay_period', period);
  if (rows.error) return null;
  const statuses = await supabase.from('payroll_run_countries').select('run_id, country, status');
  // staff read only their own published (approved) payslips; payroll reads every run's status
  const approved = statuses.error
    ? null
    : new Set(((statuses.data ?? []) as { run_id: string; country: string; status: string }[]).filter((s) => s.status === 'approved' || s.status === 'paid').map((s) => `${s.run_id}|${s.country.toLowerCase()}`));
  const marked = ((rows.data ?? []) as Payslip[]).map((r) => ({
    ...r,
    approved: approved ? approved.has(`${r.run_id}|${(text(r.country) || 'Kenya').toLowerCase()}`) : true,
  }));
  return payslipYtdFromRows(current, marked);
}

export async function loadPayslipRun(record: Payslip): Promise<PayslipRunInfo | null> {
  const employee = text(record.employee_id);
  const period = text(record.pay_period);
  if (!employee || !period) return null;
  const { data, error } = await supabase.rpc('payslip_run_details', { p_employee: employee, p_pay_period: period });
  const row = (Array.isArray(data) ? data[0] : data) as { run_id?: string; status?: string; approved_at?: string | null; paid_at?: string | null } | undefined;
  if (error || !row?.run_id) return null;
  return { runId: row.run_id, ref: runRef(row.run_id, period), status: text(row.status), approvedAt: row.approved_at ?? null, paidAt: row.paid_at ?? null };
}

/** The employee's numbers for the payslip, from their record (the payslip's own branch and position first). */
export function employeeDetailsOf(record: Payslip, employee: Payslip | null, branchName: string | null): PayslipEmployeeDetails {
  const e = employee ?? {};
  return {
    taxNumber: orNull(e['Tax PIN']),
    nssfNumber: orNull(e['NSSF Number']),
    shaNumber: orNull(e['SHIF Number']) ?? orNull(e['NHIF Number']),
    idNumber: orNull(e['ID Number']) ?? orNull(record.employeeNat),
    branch: branchName ?? orNull(record.branch) ?? orNull(e['Branch']),
    department: orNull(record.department),
    position: orNull(record.position) ?? orNull(e['Job Title']),
    jobGroup: orNull(record.jobGroup) ?? orNull(e['Job Group']),
  };
}

/** Everything a payslip shows besides its figures. Each part that can't be read is left out. */
export async function loadPayslipExtras(record: Payslip, identity?: { company_name?: string | null; image_url?: string | null } | null): Promise<PayslipExtras> {
  const country = payslipCountry(record);
  const [company, employee, ytd, run] = await Promise.all([
    companyContext().catch(() => null),
    loadEmployee(text(record.employee_id)).catch(() => null),
    loadPayslipYtd(record).catch(() => null),
    loadPayslipRun(record).catch(() => null),
  ]);
  const branch = company?.branches.find((b) => b.id === employee?.branch_id) ?? null;
  const out: PayslipExtras = { employee: employeeDetailsOf(record, employee, orNull(branch?.name)), ytd, run };
  if (company) {
    out.design = company.design;
    out.employer = payslipEmployer({
      design: company.design,
      profile: company.profile,
      identity,
      branch,
      branchContacts: company.branchContacts.find((c) => c.branch_id === branch?.id) ?? null,
      country,
      employerKraPin: company.kraPin,
    });
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
