import type { EmployeeRecord } from './profileCompleteness';
import { missingDetails } from './missingPayrollDetails';
import { mpesaPhone } from './payrollExports';
import { isPaidByMpesa, paymentKind } from './paymentMethods';

// Pretend paying for sales demos (PAYMENTS_DEMO in lib/inAppPayments): who would be paid by which channel, and whose
// payment details would stop the payment. Pure: no database, no network. The checks are the payroll ones already
// used elsewhere (missingDetails, the M-Pesa file's phone format, the bank file's account name), plus whether the
// account name matches the employee's.

export type DemoChannel = 'Bank' | 'M-Pesa' | 'Other';

export interface DemoPayLine {
  employeeNumber: string;
  name: string;
  netPay: number;
  channel: DemoChannel;
  /** what stops this person being paid; empty when they can be */
  problems: string[];
}

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value).trim());
/** a name compared without case or spaces */
const squash = (value: unknown) => text(value).toLowerCase().replace(/\s+/g, '');

/** Why an employee's salary could not be sent, in the words payroll uses (empty when it could). */
export function paymentProblems(employee: EmployeeRecord): string[] {
  const problems = missingDetails(employee);
  const kind = paymentKind(employee['payment_method']);
  const phone = text(employee['Mobile Number']);
  if (kind === 'mobile' && phone && !mpesaPhone(phone)) problems.push('Phone number is not a valid M-Pesa number');
  if (kind === 'bank') {
    const accountName = text(employee['account_number_name']);
    if (!accountName) problems.push('Account name');
    else {
      const first = squash(employee['First Name']);
      const last = squash(employee['Last Name']);
      const middle = squash(employee['Middle Name']);
      const names = [first + last, first + middle + last].filter(Boolean);
      if (!names.includes(squash(accountName))) problems.push("Account name doesn't match the employee's name");
    }
  }
  return problems;
}

export const demoChannel = (employee: EmployeeRecord): DemoChannel =>
  isPaidByMpesa(employee) ? 'M-Pesa' : paymentKind(employee['payment_method']) === 'bank' ? 'Bank' : 'Other';

/** One line per payslip of the month, with the employee's channel and problems (no record found is a problem too). */
export function demoPayLines(
  records: { employee_id?: unknown; employee_name?: unknown; net_pay?: unknown }[],
  employees: EmployeeRecord[],
): DemoPayLine[] {
  const byNumber = new Map(employees.map((e) => [text(e['Employee Number']), e]));
  return records.map((r) => {
    const employeeNumber = text(r.employee_id);
    const employee = byNumber.get(employeeNumber);
    return {
      employeeNumber,
      name: text(r.employee_name) || employeeNumber,
      netPay: Number(r.net_pay) || 0,
      channel: employee ? demoChannel(employee) : 'Other',
      problems: employee ? paymentProblems(employee) : ['Employee record not found'],
    };
  });
}

export const totalNet = (lines: DemoPayLine[]) => lines.reduce((sum, l) => sum + l.netPay, 0);
