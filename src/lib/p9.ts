import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { supabase } from './supabase';
import type { EmployeeRecord } from './profileCompleteness';
import { lastDayOf, p10Figures } from './payrollExports';
import { bandsOf, taxByBands, type Rates } from './statutoryCalc';

// The P9 (tax deduction card, FIG-773): an employee's pay and tax month by month for a year, from their payslips
// in approved (or paid) payroll months. The figures are worked out the way payroll and the P10 work them out
// (lib/statutoryCalc with each month's rates), so all three agree. Employees download their own; HR anyone's.

type Payslip = Record<string, unknown>;

export const P9_COLUMNS = [
  'Month', 'Gross pay', 'Per diem (not taxed)', 'Cash pay', 'Non-cash benefits', 'NSSF', 'SHIF', 'Housing levy',
  'Pension & PRMF', 'Mortgage interest', 'Taxable pay', 'Tax charged', 'Personal relief', 'Insurance relief', 'PAYE',
] as const;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface P9Row {
  month: string;
  values: number[]; // in the order of P9_COLUMNS, after "Month"
}

export interface P9 {
  year: number;
  employer: { name: string; pin: string };
  employee: { name: string; pin: string; payrollNumber: string; employeeNumber: string };
  rows: P9Row[];
  totals: number[];
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

/** The P9 for a year from that year's payslips (any order; one per month), the employee and each month's rates. */
export function buildP9(
  year: number,
  payslips: Payslip[],
  employee: EmployeeRecord,
  ratesByPeriod: Record<string, Rates>,
  employer: { name: string; pin: string }
): P9 {
  const byPeriod = new Map(payslips.map((p) => [text(p.pay_period), p]));
  const rows: P9Row[] = MONTHS.map((month, i) => {
    const period = `${year}-${String(i + 1).padStart(2, '0')}`;
    const p = byPeriod.get(period);
    if (!p) return { month, values: P9_COLUMNS.slice(1).map(() => 0) };
    const rates = ratesByPeriod[period] ?? {};
    const f = p10Figures(p, employee, rates);
    return {
      month,
      values: [
        num(p.gross_pay), num(p.per_diem), f.cashPay, f.benefits, f.nssf, f.shif, f.ahl, f.pension + f.prmf, f.mortgage,
        f.taxablePay, taxByBands(f.taxablePay, bandsOf(rates)), f.personalRelief, f.insuranceRelief, f.paye,
      ].map(round2),
    };
  });
  const totals = P9_COLUMNS.slice(1).map((_, c) => round2(rows.reduce((sum, r) => sum + r.values[c], 0)));
  return {
    year,
    employer,
    employee: {
      name: [employee['First Name'], employee['Middle Name'], employee['Last Name']].map(text).filter(Boolean).join(' '),
      pin: text(employee['Tax PIN']),
      payrollNumber: text(employee['Payroll Number']),
      employeeNumber: text(employee['Employee Number']),
    },
    rows,
    totals,
  };
}

const money = (n: number) => (n ? n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-');

/** The P9 as a PDF (A4 landscape), saved as P9-<year>-<employee number>.pdf. */
export function downloadP9Pdf(p9: P9) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFontSize(14);
  doc.text(`P9 Tax Deduction Card ${p9.year}`, 40, 40);
  doc.setFontSize(9);
  doc.text(`Employer: ${p9.employer.name || '-'}    Employer PIN: ${p9.employer.pin || 'not set'}`, 40, 60);
  doc.text(`Employee: ${p9.employee.name || '-'}    Employee PIN: ${p9.employee.pin || '-'}    Payroll number: ${p9.employee.payrollNumber || '-'}`, 40, 74);
  (doc as unknown as { autoTable: (o: Record<string, unknown>) => void }).autoTable({
    startY: 88,
    head: [P9_COLUMNS as unknown as string[]],
    body: [...p9.rows.map((r) => [r.month, ...r.values.map(money)]), ['Total', ...p9.totals.map(money)]],
    styles: { fontSize: 7, cellPadding: 3 },
    headStyles: { fillColor: [14, 79, 39] },
    columnStyles: Object.fromEntries(P9_COLUMNS.slice(1).map((_, i) => [i + 1, { halign: 'right' }])),
    didParseCell: (data: { row: { index: number }; cell: { styles: Record<string, unknown> } }) => {
      if (data.row.index === 12) data.cell.styles.fontStyle = 'bold';
    },
  });
  doc.setFontSize(7);
  doc.text('Figures from approved payroll months. Taxable pay = cash pay + taxable benefits - NSSF, SHIF and housing levy (when deductible) - pension, PRMF and mortgage interest (capped).', 40, doc.internal.pageSize.getHeight() - 30);
  doc.save(`P9-${p9.year}-${p9.employee.employeeNumber || 'employee'}.pdf`);
}

// ---------------------------------------------------------------------------------------------
// loading
// ---------------------------------------------------------------------------------------------
const fail = (err: unknown, fallback: string): never => {
  const message = (err as { message?: unknown } | null)?.message;
  throw new Error(typeof message === 'string' && message ? message : fallback);
};

async function ratesFor(periods: string[]): Promise<Record<string, Rates>> {
  const entries = await Promise.all(
    periods.map(async (period) => {
      const { data, error } = await supabase.rpc('statutory_rates_on', { p_day: lastDayOf(period) });
      if (error) fail(error, 'Could not load the statutory rates.');
      return [period, (data ?? {}) as Rates] as const;
    })
  );
  return Object.fromEntries(entries);
}

async function employerDetails() {
  const { data, error } = await supabase.rpc('company_tax_details');
  if (error) fail(error, 'Could not load the company’s details.');
  const d = (Array.isArray(data) ? data[0] : data) as { company_name?: string; employer_kra_pin?: string } | null;
  return { name: text(d?.company_name), pin: text(d?.employer_kra_pin) };
}

/** The employer KRA PIN payroll has set ('' until then). */
export async function loadEmployerPin(): Promise<string> {
  const { data, error } = await supabase.from('company_payroll_settings').select('employer_kra_pin').maybeSingle();
  if (error) fail(error, 'Could not load the employer KRA PIN.');
  return text((data as { employer_kra_pin?: string } | null)?.employer_kra_pin);
}

/** Saves the employer KRA PIN (P, 9 digits, a letter); returns it as saved. */
export async function saveEmployerPin(pin: string): Promise<string> {
  const clean = pin.replace(/\s/g, '').toUpperCase();
  if (!/^[AP]\d{9}[A-Z]$/.test(clean)) throw new Error('A KRA PIN is a letter, 9 digits and a letter, like P051234567X.');
  const { error } = await supabase
    .from('company_payroll_settings')
    .upsert({ employer_kra_pin: clean, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id' });
  if (error) fail(error, 'The PIN was not saved.');
  return clean;
}

/** An employee's payslips of a year in approved or paid payroll months (their own, or for HR and payroll anyone's). */
async function approvedPayslips(employeeId: string, year: number): Promise<Payslip[]> {
  const { data, error } = await supabase.rpc('p9_payslips', { p_employee: employeeId, p_year: year });
  if (error) fail(error, 'Could not load the payslips.');
  return (data ?? []) as Payslip[];
}

/** The signed-in employee's P9 for a year (their payslips are visible to them once a month is approved). */
export async function loadMyP9(year: number): Promise<P9> {
  const { data: auth } = await supabase.auth.getUser();
  const email = auth.user?.email;
  if (!email) throw new Error('You are not signed in.');
  const { data: employee, error } = await supabase.from('employees').select('*').eq('Work Email', email).maybeSingle();
  if (error) fail(error, 'Could not load your record.');
  if (!employee) throw new Error('Your login is not linked to an employee record.');
  return loadP9For(employee as EmployeeRecord, year);
}

/** Any employee's P9 for a year (HR and payroll). */
export async function loadP9For(employee: EmployeeRecord, year: number): Promise<P9> {
  const slips = await approvedPayslips(text(employee['id']), year);
  const [rates, employer] = await Promise.all([ratesFor([...new Set(slips.map((s) => text(s.pay_period)))]), employerDetails()]);
  return buildP9(year, slips, employee, rates, employer);
}
