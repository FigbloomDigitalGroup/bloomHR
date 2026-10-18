import type { StatutoryContext } from '../../payslipOverrides';
import { employeeInputs } from '../../statutoryCalc';
import { calculatePayslip, type PayslipRules, type StatutoryArgs, type StatutoryOutcome } from '../../payslipCalc';
import { bandsOf, rateOf, taxByBands, type Rates } from '../../statutoryCalc';
import { statutoryPayWith } from '../../earnings';
import { employeeName } from '../../missingPayrollDetails';
import { paymentKind } from '../../paymentMethods';
import { isContractor } from '../../workSettlement';
import { type ExportFile, isContractorSlip } from '../../payrollExports';
import type { EmployeeRecord } from '../../profileCompleteness';
import type { CountryPayrollEngine, EmployeeProblem, PayslipLine, PayslipRecord, PayslipResult, ReturnFile } from './types';

// Tanzania (mainland) payroll (FIG-905 stage 3). Everyone in a Tanzania branch is worked out here, in TZS, with
// Tanzania's dated rates (statutory_rates, country 'Tanzania'; migration 20261021000000_tanzania_payroll.sql has the
// sources). Earnings, unpaid leave, overtime, voluntary deductions, advances, loans and the month-end settlement of
// piece rate work are the shared calculation (lib/payslipCalc); only the statutory part is Tanzania's:
//
//   NSSF            employee 10% and employer 10% of the month's pensionable pay, no ceiling (NSSF Act s.12; the split
//                   may be 5/15 or 0/20: nssf_rate / nssf_employer_rate)
//   taxable pay     a resident: taxable earnings less the employee's NSSF contribution (contributions to an approved
//                   retirement fund come off pay before PAYE; nssf_deductible = 1)
//   PAYE            a resident: the monthly bands; a non-resident: a flat 15% of gross employment income (final,
//                   nonresident_paye_rate); a secondary employment: a flat 30% (the top band, secondary_paye_rate)
//   HESLB           a student loan repayment of 15% of the basic salary earned that month, for employees flagged as
//                   HESLB borrowers, taken after tax
//   employer costs  NSSF (employer); SDL 3.5% of gross emoluments when the company has at least sdl_min_employees
//                   (10) people in Tanzania on the run, casual workers included; WCF 0.5% of gross earnings (basic and
//                   fixed allowances: not overtime or one-off earnings). Never taken from pay.
//   contractors     withholding tax on the fee (resident 5% wht_resident, non-resident 15% wht_nonresident) instead
//                   of PAYE, NSSF and HESLB; no SDL or WCF (they are not employees)
//
// Unlike Kenya, PAYE and NSSF are taken even while the TIN or NSSF number is missing (the tax and contribution are
// owed either way; the employee is listed as missing them so the returns can be filed). Health insurance (NHIF) has no
// set payroll rate for private employers: add it as a voluntary deduction for the employees who have it. Each
// statutory line is rounded to the whole shilling (TZS has no cents in use; GePG takes whole shillings).

/* eslint-disable @typescript-eslint/no-explicit-any -- employee rows and payslips are the untyped rows the payroll page uses */
type Employee = Record<string, any>;

export const TANZANIA = 'Tanzania';
export const TZS = 'TZS';

/** The rate codes Tanzania payroll can't run without (sdl_min_employees defaults to 10 when not set). */
export const TANZANIA_REQUIRED_RATES = ['paye_bands', 'nonresident_paye_rate', 'nssf_rate', 'nssf_employer_rate', 'sdl_rate', 'wcf_rate', 'heslb_rate'] as const;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const pos = (v: unknown) => Math.max(0, num(v));
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** to the whole shilling */
const tzs = (n: number) => Math.round(n + Number.EPSILON);
const nonZero = (lines: PayslipLine[]) => lines.filter((l) => l.amount !== 0);
const yes = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1';

/** Resident for tax unless the employee's residency (for tax) says Non-Resident. */
export const isTaxResident = (e: Employee | null | undefined) => !/^non/i.test(text(e?.['kra_residency']));
/** Flagged as a secondary employment (the employee's main job is elsewhere). */
export const isSecondaryEmployment = (e: Employee | null | undefined) => yes(e?.['secondary_employment']);
/** Flagged as repaying a Higher Education Students' Loans Board loan. */
export const isHeslbBorrower = (e: Employee | null | undefined) => yes(e?.['heslb_borrower']);
/** The employee's NSSF (Tanzania) membership number. */
export const tzNssfNumber = (e: Employee | null | undefined) => text(e?.['tz_nssf_number']);
/** The employee's TRA TIN, digits only (employees.tz_tin: the "Tax PIN" field is checked as a KRA PIN). */
export const tinOf = (e: Employee | null | undefined) => text(e?.['tz_tin']).replace(/[\s-]/g, '');
/** A TRA TIN is 9 digits (often written 123-456-789). */
export const isValidTin = (v: unknown) => /^\d{9}$/.test(text(v).replace(/[\s-]/g, ''));

export interface TanzaniaStatutoryInput {
  /** the month's earnings that are taxed (gross less earnings marked not taxed) */
  taxablePay: number;
  /** the pay NSSF is worked out on (gross less earnings marked not pensionable) */
  pensionablePay: number;
  /** gross pay for SDL (every cash earning) */
  grossPay: number;
  /** what WCF is worked out on: basic and fixed allowances (gross less overtime and one-off earnings); gross when not given */
  wcfPay?: number;
  /** the basic salary earned this month (HESLB) */
  basicPay: number;
  resident: boolean;
  /** a secondary employment: the flat top rate instead of the bands */
  secondary?: boolean;
  heslb: boolean;
  /** whether the company is over the SDL threshold */
  sdl: boolean;
  contractor?: boolean;
}

export interface TanzaniaStatutory {
  nssf: number;
  nssfEmployer: number;
  taxablePay: number;
  paye: number;
  heslb: number;
  sdl: number;
  wcf: number;
  wht: number;
  whtRate: number;
}

/** Whether SDL applies: the company has at least sdl_min_employees people in Tanzania (unknown headcount: it applies). */
export const sdlApplies = (headcount: number | undefined, rates: Rates) =>
  headcount === undefined || headcount >= rateOf(rates, 'sdl_min_employees', 10);

/** Tanzania's statutory figures for one month's pay (see the top of this file). */
export function tanzaniaStatutory(i: TanzaniaStatutoryInput, rates: Rates): TanzaniaStatutory {
  const gross = pos(i.grossPay);
  if (i.contractor) {
    const whtRate = i.resident ? rateOf(rates, 'wht_resident', 0.05) : rateOf(rates, 'wht_nonresident', 0.15);
    return { nssf: 0, nssfEmployer: 0, taxablePay: 0, paye: 0, heslb: 0, sdl: 0, wcf: 0, wht: tzs(gross * whtRate), whtRate };
  }
  const pensionable = Math.min(pos(i.pensionablePay), rateOf(rates, 'nssf_upper_limit', Infinity));
  const nssf = tzs(pensionable * rateOf(rates, 'nssf_rate'));
  const nssfEmployer = tzs(pensionable * rateOf(rates, 'nssf_employer_rate'));
  // a non-resident's 15% is on gross employment income; a resident's (and a secondary employment's) on pay less NSSF
  const taxablePay = i.resident
    ? round2(Math.max(0, pos(i.taxablePay) - (rateOf(rates, 'nssf_deductible', 1) ? nssf : 0)))
    : round2(pos(i.taxablePay));
  const paye = !i.resident
    ? tzs(taxablePay * rateOf(rates, 'nonresident_paye_rate'))
    : i.secondary
      ? tzs(taxablePay * rateOf(rates, 'secondary_paye_rate', 0.3))
      : tzs(taxByBands(taxablePay, bandsOf(rates)));
  const heslb = i.heslb ? tzs(pos(i.basicPay) * rateOf(rates, 'heslb_rate')) : 0;
  const sdl = i.sdl ? tzs(gross * rateOf(rates, 'sdl_rate')) : 0;
  const wcf = tzs((i.wcfPay === undefined ? gross : pos(i.wcfPay)) * rateOf(rates, 'wcf_rate'));
  return { nssf, nssfEmployer, taxablePay, paye, heslb, sdl, wcf, wht: 0, whtRate: 0 };
}

/** The payslip columns Tanzania's figures are saved in (salary_history). */
const tzFields = (s: TanzaniaStatutory, resident: boolean) => ({
  nssf_employer: s.nssfEmployer,
  sdl_levy: s.sdl,
  wcf_levy: s.wcf,
  taxable_pay: s.taxablePay,
  tax_resident: resident,
});

/** Tanzania's rules for the shared payslip calculation. */
export const TANZANIA_RULES: PayslipRules = {
  statutory({ employee, rates, grossPay, basicEarned, overtimePay, earnings, contractor, ctx }: StatutoryArgs): StatutoryOutcome {
    const resident = isTaxResident(employee);
    // salary and allowances are taxed and pensionable; each earning as its type says (lib/earnings)
    const pay = statutoryPayWith(grossPay - earnings.total, earnings.items);
    const s = tanzaniaStatutory(
      {
        taxablePay: pay.cashPay,
        pensionablePay: pay.pensionablePay,
        grossPay,
        // basic and fixed allowances (and piece rate work): not overtime or the month's one-off earnings
        wcfPay: grossPay - pos(overtimePay) - earnings.total,
        basicPay: basicEarned,
        resident,
        secondary: isSecondaryEmployment(employee),
        heslb: isHeslbBorrower(employee),
        sdl: sdlApplies(ctx.countryHeadcount, rates),
        contractor,
      },
      rates
    );
    return {
      paye: s.paye,
      nssf: s.nssf,
      health: 0,
      housingLevy: 0,
      wht: s.wht,
      whtRate: s.whtRate,
      taxRelief: 0,
      otherStatutory: { heslb_deduction: s.heslb },
      fields: tzFields(s, resident),
      perDiem: 0,
      // Kenya's Employment Act two-thirds cap is not Tanzania's law (ELRA s.28 has its own rules, see the migration)
      cap: false,
    };
  },
};

/**
 * The context for working out a hand-edited Tanzania payslip again (lib/payslipOverrides): Tanzania's rules on the
 * edited pay. SDL follows the run's headcount when given, else whether the payslip had SDL.
 */
export function tanzaniaEditContext(employee: Employee | undefined, rates: Rates | null | undefined, headcount?: number): StatutoryContext {
  const e = employee ?? {};
  const r = rates ?? {};
  const resident = isTaxResident(e);
  return {
    rates: r,
    inputs: employeeInputs(e),
    apply: { shif: false, nssf: false, ahl: false, paye: false },
    cap: false,
    country: ({ record, grossPay, basicEarned, items }) => {
      const earningsTotal = items.reduce((t, i) => t + num(i.amount), 0);
      const pay = statutoryPayWith(grossPay - earningsTotal, items);
      const s = tanzaniaStatutory(
        {
          taxablePay: pay.cashPay,
          pensionablePay: pay.pensionablePay,
          grossPay,
          wcfPay: grossPay - num(record.overtime_pay) - earningsTotal,
          basicPay: basicEarned,
          resident,
          secondary: isSecondaryEmployment(e),
          heslb: isHeslbBorrower(e),
          sdl: headcount === undefined ? num(record.sdl_levy) > 0 : sdlApplies(headcount, r),
          contractor: isContractor(e),
        },
        r
      );
      return { paye: s.paye, nssf: s.nssf, wht: s.wht, whtRate: s.whtRate, otherStatutory: { heslb_deduction: s.heslb }, fields: tzFields(s, resident) };
    },
  };
}

/** Tanzania's payslip figures, labelled. */
export function tanzaniaPayslipResult(record: PayslipRecord): PayslipResult {
  const contractor = isContractorSlip(record);
  const grossPay = num(record.gross_pay);
  return {
    country: TANZANIA,
    currency: TZS,
    record,
    earnings: nonZero([
      { label: 'Basic salary', amount: num(record.basic_salary) },
      { label: 'Unpaid leave and absence', amount: -num(record.leave_deduction) },
      { label: 'House allowance', amount: num(record.house_allowance) },
      { label: 'Transport allowance', amount: num(record.transport_allowance) },
      { label: 'Medical allowance', amount: num(record.medical_allowance) },
      { label: 'Other allowances', amount: num(record.other_allowances) },
      { label: 'Overtime', amount: num(record.overtime_pay) },
      { label: 'Commission', amount: num(record.commission) },
      { label: 'Bonuses and other earnings', amount: num(record.bonus) },
      { label: 'Piece rate work', amount: num(record.work_pay) },
      { label: 'Contract jobs', amount: num(record.jobs_pay) },
    ]),
    statutoryDeductions: tanzaniaDeductionLines(record),
    employerCosts: tanzaniaEmployerLines(record),
    grossPay,
    taxablePay: num(record.taxable_pay),
    tax: contractor ? num(record.wht_tax) : num(record.paye_tax),
    netPay: num(record.net_pay),
  };
}

/** A Tanzania payslip's statutory deductions, as the payslip shows them. */
export const tanzaniaDeductionLines = (p: PayslipRecord): PayslipLine[] =>
  nonZero(
    isContractorSlip(p)
      ? [{ label: `Withholding tax (${round2(num(p.wht_rate) * 100)}%)`, amount: num(p.wht_tax) }]
      : [
          { label: p.tax_resident === false ? 'PAYE (non-resident, flat)' : 'PAYE', amount: num(p.paye_tax) },
          { label: 'NSSF (10%)', amount: num(p.nssf_deduction) },
          { label: 'HESLB loan repayment', amount: num(p.heslb_deduction) },
        ]
  );

/** A Tanzania payslip's employer costs (paid on top of pay, never taken from it). */
export const tanzaniaEmployerLines = (p: PayslipRecord): PayslipLine[] =>
  nonZero([
    { label: 'NSSF (employer)', amount: num(p.nssf_employer) },
    { label: 'SDL (skills levy)', amount: num(p.sdl_levy) },
    { label: 'WCF (workers compensation)', amount: num(p.wcf_levy) },
  ]);

// ---------------------------------------------------------------------------------------------
// returns: each from Tanzania's payslips only
// ---------------------------------------------------------------------------------------------
const amount = (value: number) => (Math.round(value * 100) / 100).toFixed(2);
const fullName = (e: EmployeeRecord) => employeeName(e);

interface Line {
  payslip: PayslipRecord;
  employee: EmployeeRecord;
}
const linesOf = (payslips: PayslipRecord[], employees: EmployeeRecord[]): Line[] => {
  const byNumber = new Map(employees.map((e) => [text(e['Employee Number']), e]));
  return payslips.map((p) => ({ payslip: p, employee: byNumber.get(text(p.employee_id)) ?? { 'Employee Number': p.employee_id } }));
};
const employeesOnly = (ps: PayslipRecord[]) => ps.filter((p) => !isContractorSlip(p));
const problemsOf = (ls: Line[], check: (e: EmployeeRecord) => [string, boolean][]) =>
  ls
    .map(({ employee, payslip }) => ({
      name: fullName(employee) || text(payslip.employee_name),
      employeeNumber: text(employee['Employee Number']) || text(payslip.employee_id),
      missing: check(employee).filter(([, ok]) => !ok).map(([label]) => label),
    }))
    .filter((p) => p.missing.length > 0);
const payrollNumber = (l: Line) => text(l.employee['Payroll Number']) || text(l.payslip.employee_id);
const nameOf = (l: Line) => fullName(l.employee) || text(l.payslip.employee_name);
/** Taxable pay as the payslip saved it (payslips worked out before it was saved: gross less NSSF). */
const taxableOf = (p: PayslipRecord) =>
  p.taxable_pay !== undefined && p.taxable_pay !== null ? num(p.taxable_pay) : Math.max(0, num(p.gross_pay) - num(p.nssf_deduction));

// TRA's monthly PAYE return (ITX215.01.E, the employer's monthly PAYE details): one row per employee.
export const TRA_PAYE_HEADERS = [
  'S/No', 'Name of Employee', 'TIN', 'Payroll Number', 'Resident (Y/N)', 'Basic Pay', 'Allowances', 'Gross Pay',
  'Pension (NSSF) Contribution', 'Taxable Amount', 'PAYE',
] as const;

export function traPayeFile(payslips: PayslipRecord[], employees: EmployeeRecord[]): ExportFile {
  const ls = linesOf(employeesOnly(payslips), employees);
  const rows = ls.map((l, i) => {
    const p = l.payslip;
    const basic = Math.max(0, num(p.basic_salary) - num(p.leave_deduction));
    return [
      String(i + 1), nameOf(l), tinOf(l.employee), payrollNumber(l), p.tax_resident === false ? 'N' : 'Y', amount(basic),
      amount(Math.max(0, num(p.gross_pay) - basic)), amount(num(p.gross_pay)), amount(num(p.nssf_deduction)), amount(taxableOf(p)),
      amount(num(p.paye_tax)),
    ];
  });
  return { headers: TRA_PAYE_HEADERS, rows, problems: problemsOf(ls, (e) => [['TIN', isValidTin(e['tz_tin'])]]) };
}

// NSSF Tanzania's monthly contribution schedule (the employer portal's member contributions upload).
export const TZ_NSSF_HEADERS = [
  'S/No', 'Member Number', 'First Name', 'Middle Name', 'Surname', 'Payroll Number', 'Gross Salary', 'Employee Contribution (10%)',
  'Employer Contribution (10%)', 'Total Contribution',
] as const;

export function tzNssfFile(payslips: PayslipRecord[], employees: EmployeeRecord[]): ExportFile {
  const ls = linesOf(employeesOnly(payslips).filter((p) => num(p.nssf_deduction) > 0 || num(p.nssf_employer) > 0), employees);
  const rows = ls.map((l, i) => {
    const p = l.payslip;
    const own = num(p.nssf_deduction);
    const employer = num(p.nssf_employer);
    return [
      String(i + 1), tzNssfNumber(l.employee), text(l.employee['First Name']), text(l.employee['Middle Name']), text(l.employee['Last Name']),
      payrollNumber(l), amount(num(p.gross_pay)), amount(own), amount(employer), amount(own + employer),
    ];
  });
  return {
    headers: TZ_NSSF_HEADERS,
    rows,
    problems: problemsOf(ls, (e) => [['NSSF number', Boolean(tzNssfNumber(e))], ['Surname', Boolean(text(e['Last Name']))]]),
  };
}

// SDL: the employer's levy on gross emoluments, filed with TRA (the SDL return, ITX215.01.E's SDL part). One row per
// employee so the total can be checked; the levy is the employer's, so no employee number is required.
export const SDL_HEADERS = ['S/No', 'Name of Employee', 'TIN', 'Payroll Number', 'Gross Emoluments', 'SDL Rate (%)', 'SDL Amount'] as const;

export function sdlFile(payslips: PayslipRecord[], employees: EmployeeRecord[], rates: Rates): ExportFile {
  const ls = linesOf(employeesOnly(payslips).filter((p) => num(p.sdl_levy) > 0), employees);
  const r = amount(rateOf(rates, 'sdl_rate') * 100);
  const rows = ls.map((l, i) => [String(i + 1), nameOf(l), tinOf(l.employee), payrollNumber(l), amount(num(l.payslip.gross_pay)), r, amount(num(l.payslip.sdl_levy))]);
  return { headers: SDL_HEADERS, rows, problems: [] };
}

// WCF: the employer's contribution on gross earnings (the WCF portal's monthly employee earnings upload).
export const WCF_HEADERS = ['S/No', 'First Name', 'Middle Name', 'Surname', 'Payroll Number', 'Job Title', 'Gross Earnings', 'WCF Contribution'] as const;

export function wcfFile(payslips: PayslipRecord[], employees: EmployeeRecord[]): ExportFile {
  const ls = linesOf(employeesOnly(payslips).filter((p) => num(p.wcf_levy) > 0), employees);
  const rows = ls.map((l, i) => [
    String(i + 1), text(l.employee['First Name']), text(l.employee['Middle Name']), text(l.employee['Last Name']), payrollNumber(l),
    text(l.employee['Job Title']), amount(num(l.payslip.gross_pay)), amount(num(l.payslip.wcf_levy)),
  ]);
  return { headers: WCF_HEADERS, rows, problems: [] };
}

// HESLB: the month's loan repayments, one row per borrower (the HESLB employer portal's repayment schedule).
export const HESLB_HEADERS = ['S/No', 'Form Four Index Number', 'Full Name', 'Payroll Number', 'Basic Salary', 'Deduction Amount'] as const;

export function heslbFile(payslips: PayslipRecord[], employees: EmployeeRecord[]): ExportFile {
  const ls = linesOf(employeesOnly(payslips).filter((p) => num(p.heslb_deduction) > 0), employees);
  const rows = ls.map((l, i) => [
    String(i + 1), text(l.employee['heslb_index_number']), nameOf(l), payrollNumber(l),
    amount(Math.max(0, num(l.payslip.basic_salary) - num(l.payslip.leave_deduction))), amount(num(l.payslip.heslb_deduction)),
  ]);
  return { headers: HESLB_HEADERS, rows, problems: problemsOf(ls, (e) => [['HESLB index number', Boolean(text(e['heslb_index_number']))]]) };
}

// Withholding tax on contractors' fees (TRA's withholding tax return), only in a month with contractors.
export const TZ_WHT_HEADERS = ['S/No', 'Name of Payee', 'TIN', 'Payroll Number', 'Pay Period', 'Resident (Y/N)', 'Gross Amount', 'WHT Rate (%)', 'WHT Amount'] as const;

export function tzWhtFile(payslips: PayslipRecord[], employees: EmployeeRecord[], payPeriod: string): ExportFile {
  const ls = linesOf(payslips.filter((p) => isContractorSlip(p) && num(p.wht_tax) > 0), employees);
  const rows = ls.map((l, i) => [
    String(i + 1), nameOf(l), tinOf(l.employee), payrollNumber(l), payPeriod, isTaxResident(l.employee) ? 'Y' : 'N',
    amount(num(l.payslip.gross_pay)), amount(num(l.payslip.wht_rate) * 100), amount(num(l.payslip.wht_tax)),
  ]);
  return { headers: TZ_WHT_HEADERS, rows, problems: problemsOf(ls, (e) => [['TIN', isValidTin(e['tz_tin'])]]) };
}

/** What the month's Tanzania payroll owes each body, and when (PAYE and SDL to TRA by the 7th, HESLB by the 15th, NSSF and WCF by the month's end). */
export function tanzaniaRemittance(payslips: PayslipRecord[]) {
  const total = (f: (p: PayslipRecord) => number) => round2(payslips.reduce((t, p) => t + f(p), 0));
  return [
    { label: 'PAYE (TRA)', amount: total((p) => num(p.paye_tax) + (isContractorSlip(p) ? num(p.wht_tax) : 0)), note: 'From employees (and contractors’ WHT); by the 7th' },
    { label: 'NSSF', amount: total((p) => num(p.nssf_deduction) + num(p.nssf_employer)), note: `${total((p) => num(p.nssf_deduction)).toLocaleString()} employees + ${total((p) => num(p.nssf_employer)).toLocaleString()} employer` },
    { label: 'SDL (TRA)', amount: total((p) => num(p.sdl_levy)), note: 'Employer only; by the 7th' },
    { label: 'WCF', amount: total((p) => num(p.wcf_levy)), note: 'Employer only; by the end of the month' },
    { label: 'HESLB', amount: total((p) => num(p.heslb_deduction)), note: 'From borrowers; by the 15th' },
  ];
}

const TANZANIA_RETURNS: ReturnFile[] = [
  { key: 'tra-paye', label: 'TRA PAYE', name: 'tra-paye', what: 'monthly PAYE schedule: TIN, gross, taxable pay and PAYE', authority: 'TRA', build: (ps, es) => traPayeFile(ps, es) },
  { key: 'tz-nssf', label: 'NSSF Tanzania', name: 'nssf-tz', what: 'member contributions, employee and employer 10% each', authority: 'NSSF', build: (ps, es) => tzNssfFile(ps, es) },
  { key: 'sdl', label: 'SDL (skills levy)', name: 'tra-sdl', what: 'employer levy on gross emoluments (not taken from pay)', authority: 'TRA', optional: true, build: (ps, es, { rates }) => sdlFile(ps, es, rates) },
  { key: 'wcf', label: 'WCF', name: 'wcf', what: 'employer contribution on gross earnings (not taken from pay)', authority: 'WCF', build: (ps, es) => wcfFile(ps, es) },
  { key: 'heslb', label: 'HESLB', name: 'heslb', what: 'student loan repayments taken from borrowers’ pay', authority: 'HESLB', optional: true, build: (ps, es) => heslbFile(ps, es) },
  { key: 'tz-wht', label: 'TRA withholding tax (contractors)', name: 'tra-wht', what: 'each contractor’s fee, rate and tax', authority: 'TRA', optional: true, build: (ps, es, { payPeriod }) => tzWhtFile(ps, es, payPeriod) },
];

/** What is missing on an employee for Tanzania's payroll and returns (warnings: payroll still goes ahead). */
export function tanzaniaProblems(employee: Employee): string[] {
  const missing: string[] = [];
  if (!tinOf(employee)) missing.push('TIN');
  else if (!isValidTin(employee['tz_tin'])) missing.push('TIN (9 digits)');
  if (!isContractor(employee)) {
    if (!tzNssfNumber(employee)) missing.push('NSSF (Tanzania) number');
    if (isHeslbBorrower(employee) && !text(employee['heslb_index_number'])) missing.push('HESLB index number');
  }
  const kind = paymentKind(employee['payment_method']);
  if (kind === 'mobile' && !text(employee['Mobile Number'])) missing.push('Mobile money number');
  if (kind === 'bank') {
    if (!text(employee['Bank'])) missing.push('Bank');
    if (!text(employee['Account Number'])) missing.push('Account number');
  }
  return missing;
}

export const tanzaniaEngine: CountryPayrollEngine = {
  country: TANZANIA,
  currency: TZS,
  requiredRates: TANZANIA_REQUIRED_RATES,
  calculate({ employee, ctx }) {
    const record = { ...calculatePayslip(employee, ctx, TANZANIA_RULES), country: TANZANIA, currency: TZS };
    return tanzaniaPayslipResult(record);
  },
  returns: () => TANZANIA_RETURNS,
  validate(employee) {
    const number = text(employee['Employee Number']);
    const name = employeeName(employee as EmployeeRecord) || number;
    return tanzaniaProblems(employee).map<EmployeeProblem>((problem) => ({ employeeNumber: number, name, problem, blocking: false }));
  },
};
/* eslint-enable @typescript-eslint/no-explicit-any */
