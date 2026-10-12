import type { EmployeeRecord } from './profileCompleteness';
import { paymentKind } from './paymentMethods';
import { isValidIdNumber, isValidKraPin, isValidNssfNumber, isValidOnboardingPhone, isValidShaNumber } from './onboardingValidation';

// Upload files built from a month's approved payroll run: the KRA PAYE (iTax P10), SHA and NSSF returns, and the
// bulk-payment files for M-Pesa and the bank. Each row joins a payslip (the amounts payroll saved) with the employee's
// record (who they are and where they are paid). Column names are the portals' own (docs/ONBOARDING.md).

type Payslip = Record<string, unknown>;
export type Rates = Record<string, unknown>;

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value).trim());
const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
/** Amounts as the portals take them: two decimals, no thousands separators. */
const amount = (value: number) => (Math.round(value * 100) / 100).toFixed(2);
const rate = (rates: Rates, code: string, fallback = 0) => {
  const v = Number(rates[code]);
  return Number.isFinite(v) ? v : fallback;
};

const fullName = (e: EmployeeRecord) => [e['First Name'], e['Middle Name'], e['Last Name']].map(text).filter(Boolean).join(' ');
const shaNumber = (e: EmployeeRecord) => text(e['SHIF Number']) || text(e['NHIF Number']);

// ---------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------
/** One CSV cell: quoted when needed; a value that a spreadsheet would run as a formula is kept as text. */
const cell = (value: string) => {
  const safe = /^[=@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const toCsv = (headers: readonly string[], rows: string[][]) =>
  [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

// ---------------------------------------------------------------------------------------------
// the files
// ---------------------------------------------------------------------------------------------
export interface ExportFile {
  headers: readonly string[];
  rows: string[][];
  /** employees on the run whose record lacks something this file needs, with what */
  problems: { name: string; employeeNumber: string; missing: string[] }[];
}

export const P10_HEADERS = [
  'Employee PIN', 'Employee name', 'Resident', 'Type of Employee', 'PWD', 'Exemption certificate No', 'Total cash pay',
  'Value of Car benefit', 'Value of meals', 'Non cash', 'Housing benefit', 'Other benefits', 'Total gross pay',
  'Social health insurance fund', 'NSSF', 'Other pension contribution', 'Post retirement medical fund',
  'Mortgage interest', 'AHL', 'Taxable pay', 'Personal relief', 'Insurance relief', 'PAYE', 'Self assessed PAYE',
] as const;

export const SHA_HEADERS = ['PAYROLL NUMBER', 'FIRSTNAME', 'LASTNAME', 'IDENTITY TYPE', 'ID NO', 'KRA PIN', 'NHIF NO', 'CONTRIBUTION AMOUNT', 'PHONE'] as const;

export const NSSF_HEADERS = ['PAYROLL NUMBER', 'SURNAME', 'OTHER NAMES', 'ID NO', 'KRA PIN', 'NSSF NO', 'GROSS PAY', 'VOLUNTARY'] as const;

export const MPESA_HEADERS = ['Phone Number', 'Name', 'Amount', 'Reference', 'Payroll Number'] as const;

export const BANK_HEADERS = [
  'Payroll Number', 'Employee Name', 'Bank', 'Bank Code', 'Branch', 'Branch Code', 'Account Name', 'Account Number', 'Amount', 'Reference',
] as const;

interface Line {
  payslip: Payslip;
  employee: EmployeeRecord;
}

/** Each payslip with its employee's record (payslips whose employee no longer exists keep an empty record). */
const lines = (payslips: Payslip[], employees: EmployeeRecord[]): Line[] => {
  const byNumber = new Map(employees.map((e) => [text(e['Employee Number']), e]));
  return payslips.map((p) => ({ payslip: p, employee: byNumber.get(text(p.employee_id)) ?? { 'Employee Number': p.employee_id } }));
};

const problemsOf = (ls: Line[], check: (e: EmployeeRecord) => string[]) =>
  ls
    .map(({ employee, payslip }) => ({
      name: fullName(employee) || text(payslip.employee_name),
      employeeNumber: text(employee['Employee Number']),
      missing: check(employee),
    }))
    .filter((p) => p.missing.length > 0);

const need = (checks: [string, boolean][]) => checks.filter(([, ok]) => !ok).map(([label]) => label);

/** The P10 figures for one payslip. Caps and reliefs come from the statutory rates in force that month. */
export function p10Figures(payslip: Payslip, e: EmployeeRecord, rates: Rates) {
  const cashPay = num(payslip.gross_pay);
  const benefits = num(e['car_benefit']) + num(e['meals_benefit']) + num(e['non_cash_benefit']) + num(e['housing_benefit']) + num(e['other_benefits']);
  const totalGross = cashPay + benefits;
  const shif = num(payslip.nhif_deduction);
  const nssf = num(payslip.nssf_deduction);
  const ahl = num(payslip.housing_levy);
  const pension = Math.min(num(e['other_pension_contribution']), rate(rates, 'pension_deduction_cap', Infinity));
  const prmf = Math.min(num(e['post_retirement_medical_fund']), rate(rates, 'prmf_deduction_cap', Infinity));
  const mortgage = Math.min(num(e['mortgage_interest']), rate(rates, 'mortgage_interest_cap', Infinity));
  const deductible =
    nssf + pension + prmf + mortgage + (rate(rates, 'shif_deductible') ? shif : 0) + (rate(rates, 'ahl_deductible') ? ahl : 0);
  const insuranceRelief = Math.min(num(e['insurance_premium']) * rate(rates, 'insurance_relief_rate'), rate(rates, 'insurance_relief_cap', Infinity));
  return {
    cashPay, benefits, totalGross, shif, nssf, ahl, pension, prmf, mortgage,
    taxablePay: Math.max(0, totalGross - deductible),
    personalRelief: num(payslip.tax_relief),
    insuranceRelief,
    paye: num(payslip.paye_tax),
  };
}

export function p10File(payslips: Payslip[], employees: EmployeeRecord[], rates: Rates): ExportFile {
  const ls = lines(payslips, employees);
  return {
    headers: P10_HEADERS,
    rows: ls.map(({ payslip, employee: e }) => {
      const f = p10Figures(payslip, e, rates);
      return [
        text(e['Tax PIN']), fullName(e) || text(payslip.employee_name), text(e['kra_residency']), text(e['kra_employee_type']),
        e['is_pwd'] === true ? 'Yes' : 'No', e['is_pwd'] === true ? text(e['Disability Cert No']) : '',
        amount(f.cashPay), amount(num(e['car_benefit'])), amount(num(e['meals_benefit'])), amount(num(e['non_cash_benefit'])),
        amount(num(e['housing_benefit'])), amount(num(e['other_benefits'])), amount(f.totalGross), amount(f.shif), amount(f.nssf),
        amount(f.pension), amount(f.prmf), amount(f.mortgage), amount(f.ahl), amount(f.taxablePay), amount(f.personalRelief),
        amount(f.insuranceRelief), amount(f.paye), amount(f.paye),
      ];
    }),
    problems: problemsOf(ls, (e) =>
      need([
        ['KRA PIN', isValidKraPin(e['Tax PIN'])],
        ['Residency', Boolean(text(e['kra_residency']))],
        ['Type of employee', Boolean(text(e['kra_employee_type']))],
        ['Exemption certificate number', e['is_pwd'] !== true || Boolean(text(e['Disability Cert No']))],
      ])
    ),
  };
}

export function shaFile(payslips: Payslip[], employees: EmployeeRecord[]): ExportFile {
  const ls = lines(payslips, employees);
  return {
    headers: SHA_HEADERS,
    rows: ls.map(({ payslip, employee: e }) => [
      text(e['Payroll Number']), text(e['First Name']), text(e['Last Name']), text(e['Type of Identification']), text(e['ID Number']),
      text(e['Tax PIN']), shaNumber(e), amount(num(payslip.nhif_deduction)), text(e['Mobile Number']),
    ]),
    problems: problemsOf(ls, (e) =>
      need([
        ['First name', Boolean(text(e['First Name']))],
        ['Surname', Boolean(text(e['Last Name']))],
        ['ID number', isValidIdNumber(text(e['Type of Identification']) || 'National ID', e['ID Number'])],
        ['KRA PIN', isValidKraPin(e['Tax PIN'])],
        ['SHA number', isValidShaNumber(shaNumber(e))],
        ['Phone number', isValidOnboardingPhone(e['Mobile Number'])],
      ])
    ),
  };
}

export function nssfFile(payslips: Payslip[], employees: EmployeeRecord[]): ExportFile {
  const ls = lines(payslips, employees);
  return {
    headers: NSSF_HEADERS,
    rows: ls.map(({ payslip, employee: e }) => [
      text(e['Payroll Number']), text(e['Last Name']), [e['First Name'], e['Middle Name']].map(text).filter(Boolean).join(' '),
      text(e['ID Number']), text(e['Tax PIN']), text(e['NSSF Number']), amount(num(payslip.gross_pay)), amount(num(e['nssf_voluntary_contribution'])),
    ]),
    problems: problemsOf(ls, (e) =>
      need([
        ['Surname', Boolean(text(e['Last Name']))],
        ['ID number', isValidIdNumber(text(e['Type of Identification']) || 'National ID', e['ID Number'])],
        ['KRA PIN', isValidKraPin(e['Tax PIN'])],
        ['NSSF number', isValidNssfNumber(e['NSSF Number'])],
      ])
    ),
  };
}

/** A Kenyan mobile number as M-Pesa takes it (2547XXXXXXXX), or '' when it is not one. */
export const mpesaPhone = (value: unknown) => {
  const digits = text(value).replace(/\D/g, '');
  const phone = /^0[17]\d{8}$/.test(digits) ? `254${digits.slice(1)}` : /^[17]\d{8}$/.test(digits) ? `254${digits}` : digits;
  return /^254[17]\d{8}$/.test(phone) ? phone : '';
};

/** How a payslip is paid: the method saved on it, else the employee's. */
const kindOf = (l: Line) => paymentKind(text(l.payslip.payment_method) || l.employee['payment_method']);

export function mpesaFile(payslips: Payslip[], employees: EmployeeRecord[], payPeriod: string): ExportFile {
  const ls = lines(payslips, employees).filter((l) => kindOf(l) === 'mobile' && num(l.payslip.net_pay) > 0);
  return {
    headers: MPESA_HEADERS,
    rows: ls.map(({ payslip, employee: e }) => [
      mpesaPhone(e['Mobile Number']), fullName(e) || text(payslip.employee_name), amount(num(payslip.net_pay)), `Salary ${payPeriod}`, text(e['Payroll Number']),
    ]),
    problems: problemsOf(ls, (e) => need([['M-Pesa number', Boolean(mpesaPhone(e['Mobile Number']))]])),
  };
}

export function bankFile(payslips: Payslip[], employees: EmployeeRecord[], payPeriod: string): ExportFile {
  const ls = lines(payslips, employees).filter((l) => kindOf(l) === 'bank' && num(l.payslip.net_pay) > 0);
  return {
    headers: BANK_HEADERS,
    rows: ls.map(({ payslip, employee: e }) => [
      text(e['Payroll Number']), fullName(e) || text(payslip.employee_name), text(e['Bank']), text(e['bank_code']), text(e['Bank Branch']),
      text(e['branch_code']), text(e['account_number_name']), text(e['Account Number']), amount(num(payslip.net_pay)), `Salary ${payPeriod}`,
    ]),
    problems: problemsOf(ls, (e) =>
      need([
        ['Bank', Boolean(text(e['Bank']))],
        ['Account name', Boolean(text(e['account_number_name']))],
        ['Account number', Boolean(text(e['Account Number']))],
      ])
    ),
  };
}

/** The last day of a 'YYYY-MM' pay period, for looking up the rates in force that month. */
export const lastDayOf = (payPeriod: string) => {
  const [y, m] = payPeriod.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
