import jsPDF from 'jspdf';
// the table plugin is called directly: since jspdf-autotable 5 importing it no longer adds doc.autoTable
import { autoTable } from 'jspdf-autotable';
import { payslipOvertimePay, round2 } from './overtimePay';

// The month's payroll register as a PDF (A4 landscape): one row per payslip with the statutory columns, and the
// totals at the foot. Built from the rows the payroll page already shows, so it matches the screen.

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
}

export const REGISTER_COLUMNS = [
  'No.', 'Employee', 'Department', 'Basic', 'Allowances', 'Overtime', 'Leave deduction', 'Gross pay', 'PAYE', 'SHIF', 'NSSF', 'Housing levy', 'Other deductions', 'Net pay',
] as const;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const money = (v: number) => Math.round(v).toLocaleString('en-KE');

/** The register's figures per row, in REGISTER_COLUMNS order (amounts as numbers), and the totals. */
export function registerFigures(rows: PayrollRegisterRow[]) {
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
    return {
      number: String(r.employeeNu || r.employee_id || ''),
      name: String(r.employee_name || ''),
      department: String((r.department === 'Branch Staff' ? r.branch : r.department) || ''),
      // gross pay = basic + allowances and earnings + overtime − leave
      amounts: [basic, Math.max(0, round2(gross + leave - basic - overtime)), overtime, leave ? -leave : 0, gross, paye, shif, nssf, levy, Math.max(0, total - paye - shif - nssf - levy), num(r.net_pay)],
    };
  });
  const totals = lines.reduce((sum, l) => sum.map((s, i) => s + l.amounts[i]), Array(11).fill(0) as number[]);
  return { lines, totals };
}

/** The register as a jsPDF document. */
export function payrollRegisterPdf(rows: PayrollRegisterRow[], { periodLabel, companyName }: { periodLabel: string; companyName?: string | null }) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const { lines, totals } = registerFigures(rows);

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
    head: [REGISTER_COLUMNS as unknown as string[]],
    body: lines.map((l) => [l.number, l.name, l.department, ...l.amounts.map(money)]),
    foot: [['', 'Total', '', ...totals.map(money)]],
    showFoot: 'lastPage',
    styles: { fontSize: 7, cellPadding: 3 },
    headStyles: { fillColor: [31, 41, 55] },
    footStyles: { fillColor: [243, 244, 246], textColor: [17, 24, 39], fontStyle: 'bold' },
    columnStyles: Object.fromEntries(REGISTER_COLUMNS.slice(3).map((_, i) => [i + 3, { halign: 'right' }])),
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
