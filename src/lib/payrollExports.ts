import type { EmployeeRecord } from './profileCompleteness';
import { paymentKind } from './paymentMethods';
import { employeeInputs, statutoryFor } from './statutoryCalc';
import { nonTaxableEarningsOf, pensionableAdjustmentOf } from './earnings';
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

// Spelled exactly as in the P10 file finance uploads to iTax (FIGBLOOM SEPTEMBER 2026 PAYE), typos included.
export const P10_HEADERS = [
  'Employee pin', 'Employee name', 'Resident', 'Type of Employee', 'PWD', 'Exemption certificate No', 'Total cash pay',
  'Value of Car benefit', 'Value of meals', 'Non cash', 'Housing benefit', 'Other benefits', 'Total gross pay',
  'Social health insuarance fund', 'NSSF', 'other pension contribution', 'Post retirement medical fund',
  'Mortgage Intrest', 'AHL', 'Taxable pay', 'Personal relief', 'Insuarance relief', 'Paye', 'Self assessed paye',
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

/**
 * Cash pay as the returns report it: gross pay less the non-taxable per diem and any earnings that are not taxed
 * (lib/earnings). What SHIF, NSSF and AHL are worked on, unless the payslip has untaxed or non-pensionable earnings.
 */
export const cashPayOf = (payslip: Payslip) =>
  Math.max(0, num(payslip.gross_pay) - num(payslip.per_diem) - nonTaxableEarningsOf(payslip));

/** The pay NSSF was worked out on: cash pay, adjusted for earnings that are pensionable but untaxed, or the reverse. */
export const pensionablePayOf = (payslip: Payslip) => Math.max(0, cashPayOf(payslip) + pensionableAdjustmentOf(payslip));

/**
 * The P10 figures for one payslip: SHIF, NSSF, AHL and PAYE as the payslip has them, and taxable pay worked out the
 * way payroll worked it out (lib/statutoryCalc, with the rates in force that month).
 */
export function p10Figures(payslip: Payslip, e: EmployeeRecord, rates: Rates) {
  const cashPay = cashPayOf(payslip);
  const benefits = num(e['car_benefit']) + num(e['meals_benefit']) + num(e['non_cash_benefit']) + num(e['housing_benefit']) + num(e['other_benefits']);
  const totalGross = cashPay + benefits;
  const shif = num(payslip.nhif_deduction);
  const nssf = num(payslip.nssf_deduction);
  const ahl = num(payslip.housing_levy);
  // benefits, caps, the PWD exemption and insurance relief as payroll applies them
  const calc = statutoryFor({ cashPay, ...employeeInputs(e) }, rates);
  const beforeExemption = Math.max(
    0,
    cashPay + calc.taxableBenefits - nssf - calc.pension - calc.prmf - calc.mortgageInterest -
      (rate(rates, 'shif_deductible') ? shif : 0) - (rate(rates, 'ahl_deductible') ? ahl : 0)
  );
  const pwd = e['is_pwd'] === true ? Math.min(beforeExemption, rate(rates, 'pwd_exempt_income')) : 0;
  return {
    cashPay, benefits, totalGross, shif, nssf, ahl,
    pension: calc.pension, prmf: calc.prmf, mortgage: calc.mortgageInterest,
    taxablePay: Math.round((beforeExemption - pwd) * 100) / 100,
    personalRelief: rate(rates, 'personal_relief', num(payslip.tax_relief)),
    insuranceRelief: calc.insuranceRelief,
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
      text(e['ID Number']), text(e['Tax PIN']), text(e['NSSF Number']), amount(pensionablePayOf(payslip)), amount(num(e['nssf_voluntary_contribution'])),
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

// The employer's NITA training levy (FIG-898): one row per person the levy is paid for (payslips with a levy; not
// casual workers or contractors), for the NITA levy return. Not taken from pay.
export const NITA_HEADERS = ['PAYROLL NUMBER', 'EMPLOYEE NAME', 'ID NO', 'KRA PIN', 'NITA NO', 'LEVY'] as const;

export function nitaFile(payslips: Payslip[], employees: EmployeeRecord[]): ExportFile {
  const ls = lines(payslips.filter((p) => num(p.nita_levy) > 0), employees);
  return {
    headers: NITA_HEADERS,
    rows: ls.map(({ payslip, employee: e }) => [
      text(e['Payroll Number']), fullName(e) || text(payslip.employee_name), text(e['ID Number']), text(e['Tax PIN']), text(e['NITA']),
      amount(num(payslip.nita_levy)),
    ]),
    // the levy is paid per employer, so a missing NITA number on an employee is not a problem for the return
    problems: [],
  };
}

/**
 * What the month's payroll owes each body: PAYE to KRA; SHIF to SHA; NSSF and the housing levy, employee and employer
 * shares (the employer's worked out from the employee's at the employer rate, as both are on the same pay); and the
 * employer's NITA levy.
 */
export function remittanceTotals(payslips: Payslip[], rates: Rates) {
  const sum = (key: string) => payslips.reduce((t, p) => t + num(p[key]), 0);
  const round = (n: number) => Math.round(n * 100) / 100;
  const share = (employee: number, employeeRate: string, employerRate: string) => {
    const r = rate(rates, employeeRate);
    return r > 0 ? round((employee * rate(rates, employerRate, r)) / r) : 0;
  };
  const nssf = round(sum('nssf_deduction'));
  const ahl = round(sum('housing_levy'));
  return {
    paye: round(sum('paye_tax')),
    shif: round(sum('nhif_deduction')),
    nssf: { employee: nssf, employer: share(nssf, 'nssf_rate', 'nssf_employer_rate') },
    ahl: { employee: ahl, employer: share(ahl, 'ahl_rate', 'ahl_employer_rate') },
    nita: { total: round(sum('nita_levy')), employees: payslips.filter((p) => num(p.nita_levy) > 0).length },
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

export interface ReturnsReadiness {
  p10: ExportFile['problems'];
  sha: ExportFile['problems'];
  nssf: ExportFile['problems'];
}

/** Before a month is approved: who on payroll is missing a detail each return needs (the same checks as the files). */
export function returnsReadiness(employees: EmployeeRecord[]): ReturnsReadiness {
  const slips = employees.map((e) => ({ employee_id: e['Employee Number'] }));
  return { p10: p10File(slips, employees, {}).problems, sha: shaFile(slips, employees).problems, nssf: nssfFile(slips, employees).problems };
}

// ---------------------------------------------------------------------------------------------
// Equity Bank Eazzy Biz bulk payment (finance's "EAZZY BIZ TEMPLATE"): one file for every way staff are paid,
// debited from the company's Equity account. BT = to an Equity account, LBT = to another Kenyan bank, MW = to M-Pesa.
// ---------------------------------------------------------------------------------------------
/** Spelled as in the Eazzy Biz template, including its trailing empty column. */
export const EQUITY_HEADERS = [
  'Transaction Type Code', 'Debit Account No.', 'Beneficiary Account No.', 'Beneficiary Name',
  'Beneficiary Bank Swift Code / Local Bank Code', 'Purpose Code', 'Transaction Currency', 'Payment Amount', 'Payment Type',
  'Service Provider', 'Beneficiary Mobile No', '',
] as const;

/** Equity Bank's own local bank code, used for transfers between Equity accounts. */
export const EQUITY_BANK_CODE = '68000';
/** Kenyan EFT payments go up to KSh 999,999.99; larger ones go by RTGS. */
const EFT_LIMIT = 1_000_000;

const isEquity = (e: EmployeeRecord) => /equity/i.test(text(e['Bank'])) || /^68/.test(text(e['bank_code']));

/** The 5-digit local bank code (2-digit bank + 3-digit branch), or '' when the record doesn't have both. */
export const localBankCode = (e: EmployeeRecord) => {
  const bank = text(e['bank_code']).replace(/\D/g, '');
  const branch = text(e['branch_code']).replace(/\D/g, '');
  if (/^\d{5}$/.test(branch)) return branch;
  if (/^\d{2}$/.test(bank) && /^\d{3}$/.test(branch)) return bank + branch;
  return '';
};

/** A Kenyan mobile number as Eazzy Biz shows it (07XXXXXXXX), or '' when it is not one. */
const localPhone = (value: unknown) => {
  const intl = mpesaPhone(value);
  return intl ? `0${intl.slice(3)}` : '';
};

/** "20,000.00", as in the template. */
const eazzyAmount = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function equityFile(payslips: Payslip[], employees: EmployeeRecord[], debitAccount: string): ExportFile {
  const ls = lines(payslips, employees).filter((l) => kindOf(l) !== 'cash' && num(l.payslip.net_pay) > 0);
  const debit = text(debitAccount);
  return {
    headers: EQUITY_HEADERS,
    rows: ls.map(({ payslip, employee: e }) => {
      const pay = num(payslip.net_pay);
      const name = fullName(e) || text(payslip.employee_name);
      if (kindOf({ payslip, employee: e }) === 'mobile') {
        return ['MW', debit, '', name, '', 'SAL', 'KES', eazzyAmount(pay), '', 'MPESA', localPhone(e['Mobile Number']), ''];
      }
      const accountName = text(e['account_number_name']) || name;
      if (isEquity(e)) {
        return ['BT', debit, text(e['Account Number']), accountName, EQUITY_BANK_CODE, 'SAL', 'KES', eazzyAmount(pay), '', '', '', ''];
      }
      return ['LBT', debit, text(e['Account Number']), accountName, localBankCode(e), 'SAL', 'KES', eazzyAmount(pay), pay >= EFT_LIMIT ? 'RTGS' : 'EFT', '', '', ''];
    }),
    problems: problemsOf(ls, (e) => {
      const l = ls.find((x) => x.employee === e);
      if (l && kindOf(l) === 'mobile') return need([['M-Pesa number', Boolean(localPhone(e['Mobile Number']))]]);
      return need([
        ['Account number', Boolean(text(e['Account Number']))],
        ['Bank and branch code (5 digits)', isEquity(e) || Boolean(localBankCode(e))],
      ]);
    }),
  };
}
