import jsPDF from 'jspdf';
// the table plugin is called directly: since jspdf-autotable 5 importing it no longer adds doc.autoTable
import { autoTable } from 'jspdf-autotable';
import { payslipOvertimePay, round2 } from './overtimePay';

// The month's payroll register as a PDF (A4 landscape): one row per payslip with the statutory columns, and the
// totals at the foot. Built from the rows the payroll page already shows, so it matches the screen. The last column
// is the employer's NITA training levy (FIG-898): an employer cost, after net pay, not part of the deductions. With
// workers paid by work on it, the settlement columns too (FIG-812).

/** The figures of one payslip row the register prints (the payroll page's records have these fields). */
export interface PayrollRegisterRow {
  employee_id?: string | number | null;
  employeeNu?: string | null;
  employee_name?: string | null;
  department?: string | null;
  branch?: string | null;
  basic_salary?: number | null;
  gross_pay?: number | null;
  /** unpaid and half-pay leave taken off gross pay (FIG-880) */
  leave_deduction?: number | null;
  /** overtime paid (FIG-889): its lines, or hours x rate on older payslips */
  overtime_items?: unknown;
  overtime_pay?: number | null;
  overtime_hours?: number | null;
  overtime_rate?: number | null;
  paye_tax?: number | null;
  nhif_deduction?: number | null;
  nssf_deduction?: number | null;
  housing_levy?: number | null;
  total_deductions?: number | null;
  net_pay?: number | null;
  /** the employer's NITA training levy for the payslip (not taken from pay) */
  nita_levy?: number | null;
  /** the month-end settlement of piece rate work and contract jobs (FIG-812, lib/workSettlement) */
  work_pay?: number | null;
  jobs_pay?: number | null;
  wht_tax?: number | null;
  paid_out?: number | null;
  arrears_brought_forward?: number | null;
  arrears_carried_forward?: number | null;
  work_settlement?: boolean | null;
}

export const REGISTER_COLUMNS = [
  'No.', 'Employee', 'Department', 'Basic', 'Allowances', 'Overtime', 'Leave deduction', 'Gross pay', 'PAYE', 'SHIF', 'NSSF', 'Housing levy', 'Other deductions', 'Net pay', 'NITA levy (employer)',
] as const;

/**
 * With anyone on the register paid for work or contract jobs (FIG-812), the register also shows their work, a
 * contractor's withholding tax, what payouts already paid during the month and arrears brought and carried forward.
 * A register with none keeps the columns above.
 */
export const WORK_REGISTER_COLUMNS = [
  'No.', 'Employee', 'Department', 'Basic', 'Allowances', 'Overtime', 'Work & jobs', 'Leave deduction', 'Gross pay', 'PAYE', 'SHIF', 'NSSF',
  'Housing levy', 'WHT', 'Other deductions', 'Paid during month', 'Arrears b/f', 'Carried forward', 'Net pay', 'NITA levy (employer)',
] as const;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const settlesWork = (r: PayrollRegisterRow) =>
  r.work_settlement === true || num(r.work_pay) + num(r.jobs_pay) + num(r.wht_tax) + num(r.paid_out) + num(r.arrears_brought_forward) + num(r.arrears_carried_forward) > 0;
const money = (v: number) => Math.round(v).toLocaleString('en-KE');

/** The register's figures per row, in REGISTER_COLUMNS order (amounts as numbers), and the totals. */
export function registerFigures(rows: PayrollRegisterRow[]) {
  const withWork = rows.some(settlesWork);
  const columns: readonly string[] = withWork ? WORK_REGISTER_COLUMNS : REGISTER_COLUMNS;
  const lines = rows.map((r) => {
    const basic = num(r.basic_salary);
    const gross = num(r.gross_pay);
    const leave = num(r.leave_deduction);
    const overtime = payslipOvertimePay(r);
    const paye = num(r.paye_tax);
    const shif = num(r.nhif_deduction);
    const nssf = num(r.nssf_deduction);
    const levy = num(r.housing_levy);
    const total = num(r.total_deductions);
    const who = {
      number: String(r.employeeNu || r.employee_id || ''),
      name: String(r.employee_name || ''),
      department: String((r.department === 'Branch Staff' ? r.branch : r.department) || ''),
    };
    if (!withWork) {
      // gross pay = basic + allowances and earnings + overtime − leave
      return { ...who, amounts: [basic, Math.max(0, round2(gross + leave - basic - overtime)), overtime, leave ? -leave : 0, gross, paye, shif, nssf, levy, Math.max(0, total - paye - shif - nssf - levy), num(r.net_pay), num(r.nita_levy)] };
    }
    const work = round2(num(r.work_pay) + num(r.jobs_pay));
    const wht = num(r.wht_tax);
    return {
      ...who,
      amounts: [
        basic, Math.max(0, round2(gross + leave - basic - overtime - work)), overtime, work, leave ? -leave : 0, gross, paye, shif, nssf, levy, wht,
        Math.max(0, round2(total - paye - shif - nssf - levy - wht)), num(r.paid_out), num(r.arrears_brought_forward), num(r.arrears_carried_forward),
        num(r.net_pay), num(r.nita_levy),
      ],
    };
  });
  const totals = lines.reduce((sum, l) => sum.map((s, i) => s + l.amounts[i]), Array(columns.length - 3).fill(0) as number[]);
  return { columns, lines, totals };
}

/** The register as a jsPDF document. */
export function payrollRegisterPdf(rows: PayrollRegisterRow[], { periodLabel, companyName }: { periodLabel: string; companyName?: string | null }) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const { columns, lines, totals } = registerFigures(rows);

  doc.setFontSize(14);
  doc.text(`Payroll register: ${periodLabel}`, 40, 40);
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(
    [companyName, `${lines.length} ${lines.length === 1 ? 'employee' : 'employees'}`, `Generated ${new Date().toLocaleDateString('en-KE')}`, 'Amounts in KSh']
      .filter(Boolean)
      .join('    '),
    40,
    56,
  );
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 70,
    head: [[...columns]],
    body: lines.map((l) => [l.number, l.name, l.department, ...l.amounts.map(money)]),
    foot: [['', 'Total', '', ...totals.map(money)]],
    showFoot: 'lastPage',
    styles: { fontSize: columns.length > REGISTER_COLUMNS.length ? 6 : 7, cellPadding: columns.length > REGISTER_COLUMNS.length ? 2 : 3 },
    headStyles: { fillColor: [31, 41, 55] },
    footStyles: { fillColor: [243, 244, 246], textColor: [17, 24, 39], fontStyle: 'bold' },
    columnStyles: Object.fromEntries(columns.slice(3).map((_, i) => [i + 3, { halign: 'right' }])),
    margin: { left: 40, right: 40 },
    didDrawPage: () => {
      const page = doc.getNumberOfPages();
      doc.setFontSize(7);
      doc.setTextColor(120);
      doc.text(`Page ${page}`, doc.internal.pageSize.getWidth() - 70, doc.internal.pageSize.getHeight() - 20);
      doc.setTextColor(0);
    },
  });
  return doc;
}

/** Saves the register as payroll-register-<period>.pdf. */
export function downloadPayrollRegisterPdf(rows: PayrollRegisterRow[], options: { periodLabel: string; companyName?: string | null }) {
  const slug = options.periodLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  payrollRegisterPdf(rows, options).save(`payroll-register-${slug || 'period'}.pdf`);
}
