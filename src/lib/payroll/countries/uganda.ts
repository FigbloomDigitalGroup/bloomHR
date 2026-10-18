import type { PayslipContext } from '../../payslipCalc';
import { rateOf, taxByBands, type Band, type Rates } from '../../statutoryCalc';
import { summariseEarnings } from '../../earnings';
import { leavePayFor, leavePayoutItems } from '../../leavePay';
import { withAbsencePay } from '../../absencePay';
import { overtimeForPayslip } from '../../overtimePay';
import { totalOf } from '../../voluntaryDeductions';
import { loanDeductionsFor } from '../../loans';
import { paymentKind, paymentMethodLabel } from '../../paymentMethods';
import { employeeName } from '../../missingPayrollDetails';
import { NO_WORK, isContractor, settlementFields, whtRateFor, workMonthOf, type WorkMonth } from '../../workSettlement';
import type { ExportFile } from '../../payrollExports';
import type { EmployeeRecord } from '../../profileCompleteness';
import type { CountryPayrollEngine, EmployeeProblem, PayslipLine, PayslipRecord, PayslipResult, ReturnFile } from './types';

// Uganda's payroll (FIG-905 stage 4). Every figure comes from the month's dated statutory_rates for Uganda
// (supabase/migrations/20261021100000_uganda_payroll.sql has the sources), so a Finance Act changes a row, not code.
//
//   gross pay          basic (less unpaid leave and absence) + allowances + overtime + bonuses and commissions
//                      + the month's piece rate work and contract jobs. No per diem share (that is Kenya's).
//   NSSF               5% of gross pay from the employee, 10% from the employer (NSSF Act Cap 222 s.11), no ceiling.
//                      Not deducted before PAYE: the employee's 5% comes out of taxed pay.
//   LST                Local Service Tax: an annual amount by monthly gross pay band (Local Governments Act, Fifth
//                      Schedule), taken in the first four months of the financial year (July to October): in four
//                      instalments (the default) or all at once (company setting). Each instalment is what is still
//                      owed this financial year spread over the instalments left, so it stops once the year's amount
//                      is paid (here, with another employer or straight to the council: lst_years).
//   chargeable income  gross pay − earnings that are not taxed − the LST taken this month (an allowable deduction)
//   PAYE               resident: the monthly bands (nil up to 335,000 from July 2026); non-resident: the
//                      non-resident bands (no nil band); both plus 10% of chargeable income above 10,000,000
//   contractors        withholding tax on gross (6%), no NSSF, PAYE or LST
//
// Amounts are whole shillings (UGX has no cents in use; URA and NSSF take whole amounts): each statutory figure is
// rounded to the nearest shilling.

/* eslint-disable @typescript-eslint/no-explicit-any -- employee rows and payslip records are the untyped rows the payroll page uses */

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const whole = (n: number) => Math.round(n + Number.EPSILON);
const nonZero = (lines: PayslipLine[]) => lines.filter((l) => l.amount !== 0);

export const UGANDA_REQUIRED_RATES = ['paye_bands', 'paye_bands_non_resident', 'nssf_rate', 'nssf_employer_rate', 'lst_bands'] as const;

// ---------------------------------------------------------------------------------------------
// PAYE
// ---------------------------------------------------------------------------------------------
const bandsFrom = (v: unknown): Band[] =>
  Array.isArray(v) ? (v as Band[]).map((b) => ({ upto: b.upto === null || b.upto === undefined ? null : Number(b.upto), rate: Number(b.rate) })) : [];

/** Whether the employee is taxed as a Ugandan resident (the default; kra_residency holds the residency for every country). */
export const isTaxResident = (employee: Record<string, unknown> | null | undefined) =>
  !(employee?.['tax_resident'] === false || text(employee?.['kra_residency']).toLowerCase() === 'non-resident');

/**
 * PAYE on a month's chargeable income: the resident or non-resident bands, plus the surcharge (10% of the part above
 * 10,000,000 a month), to the nearest shilling.
 */
export function ugandaPaye(chargeable: number, rates: Rates, resident = true): number {
  const income = Math.max(0, chargeable);
  const bands = bandsFrom(resident ? rates.paye_bands : rates.paye_bands_non_resident);
  const threshold = rateOf(rates, 'paye_surcharge_threshold', Infinity);
  const surcharge = income > threshold ? (income - threshold) * rateOf(rates, 'paye_surcharge_rate') : 0;
  return whole(taxByBands(income, bands) + surcharge);
}

// ---------------------------------------------------------------------------------------------
// LST
// ---------------------------------------------------------------------------------------------
/** An LST band: the annual amount for monthly gross pay up to `upto` (null: above the last band). */
export interface LstBand {
  upto: number | null;
  amount: number;
}

export const lstBandsOf = (rates: Rates): LstBand[] =>
  Array.isArray(rates.lst_bands)
    ? (rates.lst_bands as { upto: unknown; amount: unknown }[]).map((b) => ({ upto: b.upto === null || b.upto === undefined ? null : Number(b.upto), amount: num(b.amount) }))
    : [];

/** The year's LST for a month's gross pay: the amount of the first band the pay is within. */
export function lstAnnual(monthlyGross: number, rates: Rates): number {
  for (const b of lstBandsOf(rates)) if (b.upto === null || monthlyGross <= b.upto) return whole(b.amount);
  return 0;
}

/** Uganda's financial year (July to June) a pay period is in: 2026-10 -> {start: 2026, label: '2026/27'}. */
export function ugandaFinancialYear(period: string, firstMonth = 7) {
  const [y, m] = period.split('-').map(Number);
  const start = m >= firstMonth ? y : y - 1;
  return { start, label: `${start}/${String((start + 1) % 100).padStart(2, '0')}` };
}

export type LstCollection = 'instalments' | 'lump_sum';

export interface LstInput {
  monthlyGross: number;
  period: string;
  /** LST already paid this financial year: earlier payslips, another employer, the council */
  paidThisYear: number;
  collection: LstCollection;
  rates: Rates;
}

export interface LstResult {
  annual: number;
  /** taken this month */
  amount: number;
  /** 1 to 4 in July to October; 0 in a month LST is not taken */
  instalment: number;
  financialYear: string;
}

/**
 * This month's LST. In the collection months (July to October by default) the year's amount still owed is spread over
 * the instalments left (four instalments) or taken at once (lump sum); in any other month nothing. Never more than
 * the year's amount: once paid, it stops.
 */
export function lstFor(i: LstInput): LstResult {
  const firstMonth = rateOf(i.rates, 'lst_first_month', 7);
  const months = Math.max(1, rateOf(i.rates, 'lst_months', 4));
  const fy = ugandaFinancialYear(i.period, firstMonth);
  const annual = lstAnnual(i.monthlyGross, i.rates);
  const m = Number(i.period.split('-')[1]);
  const instalment = ((m - firstMonth + 12) % 12) + 1;
  if (instalment > months) return { annual, amount: 0, instalment: 0, financialYear: fy.label };
  const owed = Math.max(0, annual - Math.max(0, i.paidThisYear));
  const amount = i.collection === 'lump_sum' ? owed : whole(owed / (months - instalment + 1));
  return { annual, amount: Math.min(owed, amount), instalment, financialYear: fy.label };
}

// ---------------------------------------------------------------------------------------------
// statutory deductions on a month's pay (shared by the calculation and hand edits)
// ---------------------------------------------------------------------------------------------
export interface UgandaStatutoryInput {
  grossPay: number;
  /** earnings in gross pay that are not taxed */
  nonTaxable: number;
  /** LST taken this month */
  lst: number;
  resident: boolean;
  contractor: boolean;
  whtRate: number;
}

export interface UgandaStatutory {
  nssf: number;
  employerNssf: number;
  chargeableIncome: number;
  paye: number;
  wht: number;
}

export function ugandaStatutory(i: UgandaStatutoryInput, rates: Rates): UgandaStatutory {
  const gross = Math.max(0, i.grossPay);
  if (i.contractor) return { nssf: 0, employerNssf: 0, chargeableIncome: 0, paye: 0, wht: whole(gross * Math.max(0, i.whtRate)) };
  const nssf = whole(gross * rateOf(rates, 'nssf_rate'));
  const employerNssf = whole(gross * rateOf(rates, 'nssf_employer_rate'));
  // the employee's NSSF is not deductible (nssf_deductible 0); LST is, in the month it is taken (lst_deductible 1)
  const chargeableIncome = Math.max(
    0,
    gross - Math.max(0, i.nonTaxable) - (rateOf(rates, 'lst_deductible', 1) ? i.lst : 0) - (rateOf(rates, 'nssf_deductible', 0) ? nssf : 0)
  );
  return { nssf, employerNssf, chargeableIncome, paye: ugandaPaye(chargeableIncome, rates, i.resident), wht: 0 };
}

// ---------------------------------------------------------------------------------------------
// one employee's month
// ---------------------------------------------------------------------------------------------
export function calculateUgandaPayslip(employee: Record<string, any>, ctx: PayslipContext): PayslipRecord {
  const rates = ctx.rates ?? {};
  const period = ctx.period;
  const employeeId = text(employee['Employee Number']);
  const basicSalary = num(employee['Basic Salary']);
  const houseAllowance = num(employee.house_allowance);
  const transportAllowance = num(employee.travel_allowance);
  const medicalAllowance = num(employee.medical_allowance);
  const overtime = overtimeForPayslip(ctx.overtimeMonth, employee, basicSalary);
  const earnings = summariseEarnings([
    ...(ctx.earningsByEmployee.get(employeeId) ?? []),
    ...leavePayoutItems(ctx.leavePayouts.get(employeeId), basicSalary, ctx.leaveBasis),
  ]);
  const leave = withAbsencePay(leavePayFor(ctx.leaveByEmployee.get(employeeId), basicSalary, ctx.leaveBasis), ctx.absenceByEmployee.get(employeeId), basicSalary, ctx.leaveBasis);
  const work: WorkMonth = ctx.workByEmployee ? workMonthOf(ctx.workByEmployee.get(employeeId)) : NO_WORK;
  const workPay = work.workPay + work.jobsPay;
  const contractor = isContractor(employee);

  const grossPay = whole(
    basicSalary + houseAllowance + transportAllowance + medicalAllowance + overtime.pay + earnings.total - leave.total + workPay
  );

  // LST: employees only, unless exempt (soldiers, and anyone payroll marks exempt)
  const lst =
    contractor || employee.lst_exempt === true
      ? { annual: 0, amount: 0, instalment: 0, financialYear: ugandaFinancialYear(period).label }
      : lstFor({ monthlyGross: grossPay, period, paidThisYear: ctx.lstPaidThisYear?.get(employeeId) ?? 0, collection: ctx.lstCollection ?? 'instalments', rates });

  const whtRate = contractor ? whtRateFor(employee, rates) : 0;
  const s = ugandaStatutory({ grossPay, nonTaxable: earnings.nonTaxable, lst: lst.amount, resident: isTaxResident(employee), contractor, whtRate }, rates);
  const statutory = s.paye + s.nssf + lst.amount + s.wht;

  const pensionItems = [{ name: 'Pension contribution', amount: num(employee.other_pension_contribution) }].filter((i) => i.amount > 0);
  const advanceDeduction = ctx.advanceFor(employeeId, period);
  const voluntaryItems = [...pensionItems, ...(ctx.voluntaryByEmployee.get(employeeId) ?? [])];
  const otherDeductions = totalOf(voluntaryItems);
  const loanItems = loanDeductionsFor(
    ctx.payrollLoans,
    employeeId,
    period,
    grossPay - work.paidOut - work.arrearsBroughtForward - (statutory + advanceDeduction + otherDeductions)
  );
  const loanDeduction = totalOf(loanItems);
  const totalDeductions = statutory + loanDeduction + advanceDeduction + otherDeductions;

  const settlement = settlementFields({
    employee,
    work,
    grossPay,
    totalDeductions,
    statutory,
    netPay: grossPay - totalDeductions,
    whtRate,
    whtTax: s.wht,
    cap: ctx.deductionCap !== false,
  });

  return {
    id: employee.id || '',
    employee_id: employeeId,
    employeeNat: employee['ID Number'] || '',
    employeeNu: employee['Mobile Number'] || '',
    jobGroup: employee['Job Group'] || '',
    employee_name: [employee['First Name'], employee['Middle Name'], employee['Last Name']].map(text).filter(Boolean).join(' '),
    branch: employee.Office || employee.branch || '',
    department: employee.Department || employee['Job Level'] || '',
    position: employee['Job Title'] || '',
    basic_salary: basicSalary,
    house_allowance: houseAllowance,
    transport_allowance: transportAllowance,
    medical_allowance: medicalAllowance,
    other_allowances: 0,
    overtime_hours: overtime.hours,
    overtime_rate: overtime.rate,
    commission: earnings.commission,
    bonus: earnings.bonus,
    per_diem: 0,
    gross_pay: grossPay,
    paye_tax: s.paye,
    nhif_deduction: 0,
    nssf_deduction: s.nssf,
    housing_levy: 0,
    tax_relief: 0,
    lst_deduction: lst.amount,
    employer_nssf: s.employerNssf,
    chargeable_income: s.chargeableIncome,
    loan_deduction: loanDeduction,
    advance_deduction: advanceDeduction,
    welfare_deduction: 0,
    other_deductions: otherDeductions,
    deduction_items: [...voluntaryItems, ...loanItems],
    earning_items: earnings.items,
    leave_deduction: leave.total,
    leave_items: leave.items,
    overtime_pay: overtime.pay,
    overtime_items: overtime.items,
    total_deductions: totalDeductions,
    ...settlement,
    nita_levy: 0,
    pay_period: period,
    payment_method: paymentMethodLabel(employee.payment_method),
    bank_name: employee.Bank || '',
    account_number: employee['Account Number'] || '',
    country: 'Uganda',
    currency: 'UGX',
  };
}

/** A payslip whose earnings were edited by hand: NSSF, PAYE and net pay again on the new gross (LST stays as worked out). */
export function recalculateUgandaPayslip(record: PayslipRecord, rates: Rates, employee: Record<string, unknown> | undefined): PayslipRecord {
  const contractor = text(record.worker_kind) === 'contractor';
  const items = Array.isArray(record.earning_items) ? record.earning_items : [];
  const nonTaxable = summariseEarnings(items.map((i: any) => ({ name: String(i.name ?? ''), amount: num(i.amount), taxable: i.taxable !== false, pensionable: i.pensionable !== false }))).nonTaxable;
  const lst = num(record.lst_deduction);
  const s = ugandaStatutory(
    { grossPay: num(record.gross_pay), nonTaxable, lst, resident: isTaxResident(employee), contractor, whtRate: num(record.wht_rate) },
    rates
  );
  return { ...record, paye_tax: s.paye, nssf_deduction: s.nssf, employer_nssf: s.employerNssf, chargeable_income: s.chargeableIncome, wht_tax: contractor ? s.wht : 0 };
}

/** Uganda's payslip figures, labelled. */
export function ugandaPayslipResult(record: PayslipRecord): PayslipResult {
  const contractor = text(record.worker_kind) === 'contractor';
  const grossPay = num(record.gross_pay);
  return {
    country: 'Uganda',
    currency: 'UGX',
    record,
    earnings: nonZero([
      { label: 'Basic salary', amount: num(record.basic_salary) },
      { label: 'Unpaid leave and absence', amount: -num(record.leave_deduction) },
      { label: 'House allowance', amount: num(record.house_allowance) },
      { label: 'Transport allowance', amount: num(record.transport_allowance) },
      { label: 'Medical allowance', amount: num(record.medical_allowance) },
      { label: 'Overtime', amount: num(record.overtime_pay) },
      { label: 'Commission', amount: num(record.commission) },
      { label: 'Bonuses and other earnings', amount: num(record.bonus) },
      { label: 'Piece rate work', amount: num(record.work_pay) },
      { label: 'Contract jobs', amount: num(record.jobs_pay) },
    ]),
    statutoryDeductions: nonZero(
      contractor
        ? [{ label: 'Withholding tax', amount: num(record.wht_tax) }]
        : [
            { label: 'PAYE', amount: num(record.paye_tax) },
            { label: 'NSSF (5%)', amount: num(record.nssf_deduction) },
            { label: 'Local service tax', amount: num(record.lst_deduction) },
          ]
    ),
    employerCosts: nonZero([{ label: 'NSSF (employer, 10%)', amount: num(record.employer_nssf) }]),
    grossPay,
    taxablePay: record.chargeable_income === undefined || record.chargeable_income === null ? grossPay : num(record.chargeable_income),
    tax: contractor ? num(record.wht_tax) : num(record.paye_tax),
    netPay: num(record.net_pay),
  };
}

// ---------------------------------------------------------------------------------------------
// returns
// ---------------------------------------------------------------------------------------------
const byNumber = (employees: EmployeeRecord[]) => new Map(employees.map((e) => [text(e['Employee Number']), e]));
const nameOf = (e: EmployeeRecord, p: PayslipRecord) => employeeName(e) || text(p.employee_name);
const ugx = (n: number) => String(whole(n));
const employeesOnly = (ps: PayslipRecord[]) => ps.filter((p) => text(p.worker_kind) !== 'contractor');
const problemsFor = (ps: PayslipRecord[], employees: EmployeeRecord[], checks: [string, (e: EmployeeRecord) => boolean][]) => {
  const map = byNumber(employees);
  return ps
    .map((p) => {
      const e = map.get(text(p.employee_id)) ?? {};
      return { name: nameOf(e, p), employeeNumber: text(p.employee_id), missing: checks.filter(([, ok]) => !ok(e)).map(([label]) => label) };
    })
    .filter((x) => x.missing.length > 0);
};
const hasTin = (e: EmployeeRecord) => isValidUgandaTin(e['Tax PIN']);
const hasNssf = (e: EmployeeRecord) => isValidUgandaNssfNumber(e['NSSF Number']);

/**
 * URA monthly PAYE return (DT-2008), the employee schedule: one row per employee with PAYE. The columns follow the
 * schedule's order (TIN, name, employment income, allowable deductions, chargeable income, tax); check the header row
 * against the current template from the URA portal before uploading, as URA revises it (last in 2026).
 */
export const URA_PAYE_HEADERS = [
  'TIN', 'NIN / Passport No', 'Employee Name', 'Designation', 'Residency', 'Basic Salary', 'Allowances and Other Earnings',
  'Gross Employment Income', 'Untaxed Income', 'Allowable Deductions (LST)', 'Chargeable Income', 'PAYE',
] as const;

export function uraPayeFile(payslips: PayslipRecord[], employees: EmployeeRecord[]): ExportFile {
  const map = byNumber(employees);
  const ps = employeesOnly(payslips);
  const rows = ps.map((p) => {
    const e = map.get(text(p.employee_id)) ?? {};
    const gross = num(p.gross_pay);
    const basic = Math.max(0, num(p.basic_salary) - num(p.leave_deduction));
    const lst = num(p.lst_deduction);
    const chargeable = p.chargeable_income === undefined || p.chargeable_income === null ? Math.max(0, gross - lst) : num(p.chargeable_income);
    const untaxed = Math.max(0, gross - lst - chargeable);
    return [
      text(e['Tax PIN']), text(e['ID Number']), nameOf(e, p), text(e['Job Title']) || text(p.position), isTaxResident(e) ? 'Resident' : 'Non-Resident',
      ugx(basic), ugx(Math.max(0, gross - basic)), ugx(gross), ugx(untaxed), ugx(lst), ugx(chargeable), ugx(num(p.paye_tax)),
    ];
  });
  return { headers: URA_PAYE_HEADERS, rows, problems: problemsFor(ps, employees, [['TIN', hasTin]]) };
}

/**
 * NSSF Uganda contribution schedule (e-services upload): member number, names, gross wages and both shares. Column
 * names follow the schedule employers fill in; check them against the template on the NSSF employer portal.
 */
export const NSSF_UG_HEADERS = [
  'NSSF NUMBER', 'SURNAME', 'OTHER NAMES', 'NIN', 'GROSS WAGES', 'EMPLOYEE CONTRIBUTION (5%)', 'EMPLOYER CONTRIBUTION (10%)', 'TOTAL CONTRIBUTION (15%)',
] as const;

export function nssfUgandaFile(payslips: PayslipRecord[], employees: EmployeeRecord[]): ExportFile {
  const map = byNumber(employees);
  const ps = employeesOnly(payslips).filter((p) => num(p.nssf_deduction) > 0 || num(p.employer_nssf) > 0);
  const rows = ps.map((p) => {
    const e = map.get(text(p.employee_id)) ?? {};
    const own = num(p.nssf_deduction);
    const employer = num(p.employer_nssf);
    return [
      text(e['NSSF Number']), text(e['Last Name']), [e['First Name'], e['Middle Name']].map(text).filter(Boolean).join(' ') || text(p.employee_name), text(e['ID Number']),
      ugx(num(p.gross_pay)), ugx(own), ugx(employer), ugx(own + employer),
    ];
  });
  return { headers: NSSF_UG_HEADERS, rows, problems: problemsFor(ps, employees, [['NSSF number', hasNssf]]) };
}

/**
 * Local Service Tax schedule for the local government (the employee's work station): each employee with LST this
 * month, the year's amount for their band, what was taken this month and the balance. Councils take a list like this
 * with the payment; there is no national upload format.
 */
export const LST_HEADERS = [
  'Employee Number', 'Employee Name', 'TIN', 'NIN', 'Designation', 'Work Station', 'Monthly Gross Pay', 'Annual LST (band)', 'LST This Month',
] as const;

export function lstFile(payslips: PayslipRecord[], employees: EmployeeRecord[], rates: Rates): ExportFile {
  const map = byNumber(employees);
  const ps = employeesOnly(payslips).filter((p) => num(p.lst_deduction) > 0);
  const rows = ps.map((p) => {
    const e = map.get(text(p.employee_id)) ?? {};
    return [
      text(p.employee_id), nameOf(e, p), text(e['Tax PIN']), text(e['ID Number']), text(e['Job Title']) || text(p.position),
      text(e['Branch']) || text(p.branch), ugx(num(p.gross_pay)), ugx(lstAnnual(num(p.gross_pay), rates)), ugx(num(p.lst_deduction)),
    ];
  });
  return { headers: LST_HEADERS, rows, problems: [] };
}

/** URA withholding tax on payments to Ugandan contractors (6%), for the month's contractors. */
export const UG_WHT_HEADERS = ['TIN', 'Payee Name', 'Nature of Payment', 'Gross Amount', 'WHT Rate', 'WHT Amount'] as const;

export function ugandaWhtFile(payslips: PayslipRecord[], employees: EmployeeRecord[]): ExportFile {
  const map = byNumber(employees);
  const ps = payslips.filter((p) => text(p.worker_kind) === 'contractor' && num(p.wht_tax) > 0);
  const rows = ps.map((p) => {
    const e = map.get(text(p.employee_id)) ?? {};
    return [text(e['Tax PIN']), nameOf(e, p), text(e['wht_category']) === 'professional' ? 'Professional services' : 'Services', ugx(num(p.gross_pay)), `${+(num(p.wht_rate) * 100).toFixed(2)}%`, ugx(num(p.wht_tax))];
  });
  return { headers: UG_WHT_HEADERS, rows, problems: problemsFor(ps, employees, [['TIN', hasTin]]) };
}

/** A Ugandan mobile number as MTN MoMo and Airtel Money take it (2567XXXXXXXX), or ''. */
export const ugandaPhone = (value: unknown) => {
  const digits = text(value).replace(/\D/g, '');
  const phone = /^07\d{8}$/.test(digits) ? `256${digits.slice(1)}` : /^7\d{8}$/.test(digits) ? `256${digits}` : digits;
  return /^2567\d{8}$/.test(phone) ? phone : '';
};

export const UG_MOBILE_HEADERS = ['Phone Number', 'Name', 'Amount', 'Reference', 'Payroll Number'] as const;

/** Bulk pay by mobile money in UGX (MTN MoMo, Airtel Money): staff paid by mobile money. */
export function ugandaMobileMoneyFile(payslips: PayslipRecord[], employees: EmployeeRecord[], payPeriod: string): ExportFile {
  const map = byNumber(employees);
  const ps = payslips.filter((p) => {
    const e = map.get(text(p.employee_id)) ?? {};
    return paymentKind(text(p.payment_method) || e['payment_method']) === 'mobile' && num(p.net_pay) > 0;
  });
  const rows = ps.map((p) => {
    const e = map.get(text(p.employee_id)) ?? {};
    return [ugandaPhone(e['Mobile Number']), nameOf(e, p), ugx(num(p.net_pay)), `Salary ${payPeriod}`, text(e['Payroll Number'])];
  });
  return { headers: UG_MOBILE_HEADERS, rows, problems: problemsFor(ps, employees, [['Mobile money number', (e) => Boolean(ugandaPhone(e['Mobile Number']))]]) };
}

const UGANDA_RETURNS: ReturnFile[] = [
  { key: 'ura-paye', label: 'URA PAYE return', name: 'ura-paye', what: 'DT-2008 employee schedule: TIN, income, chargeable income and PAYE', authority: 'URA', build: (ps, es) => uraPayeFile(ps, es) },
  { key: 'nssf-ug', label: 'NSSF Uganda', name: 'nssf-uganda', what: 'contribution schedule: 5% employee and 10% employer', authority: 'NSSF Uganda', build: (ps, es) => nssfUgandaFile(ps, es) },
  { key: 'lst', label: 'Local service tax', name: 'local-service-tax', what: 'LST taken this month, by employee, for the local government', authority: 'Local government', optional: true, build: (ps, es, { rates }) => lstFile(ps, es, rates) },
  { key: 'ura-wht', label: 'URA withholding tax (contractors)', name: 'ura-wht', what: 'each contractor’s gross and 6% withholding tax', authority: 'URA', optional: true, build: (ps, es) => ugandaWhtFile(ps, es) },
];

// ---------------------------------------------------------------------------------------------
// details
// ---------------------------------------------------------------------------------------------
/** A URA TIN: ten digits. */
export const isValidUgandaTin = (value: unknown) => /^\d{10}$/.test(text(value).replace(/\s/g, ''));
/** An NSSF Uganda member number: 6 to 15 letters and digits (the format is not published; this only catches typos). */
export const isValidUgandaNssfNumber = (value: unknown) => /^[A-Z0-9]{6,15}$/i.test(text(value).replace(/[\s-]/g, ''));

export function ugandaMissingDetails(employee: Record<string, unknown>): string[] {
  const m: string[] = [];
  const contractor = isContractor(employee);
  if (!text(employee['Tax PIN'])) m.push('TIN');
  else if (!isValidUgandaTin(employee['Tax PIN'])) m.push('TIN (not valid)');
  if (!contractor) {
    if (!text(employee['NSSF Number'])) m.push('NSSF number');
    else if (!isValidUgandaNssfNumber(employee['NSSF Number'])) m.push('NSSF number (not valid)');
  }
  const kind = paymentKind(employee['payment_method']);
  if (kind === 'mobile' && !ugandaPhone(employee['Mobile Number'])) m.push('Mobile money number');
  if (kind === 'bank') {
    if (!text(employee['Bank'])) m.push('Bank');
    if (!text(employee['Account Number'])) m.push('Account number');
    if (!text(employee['account_number_name'])) m.push('Account name');
  }
  return m;
}

export const ugandaEngine: CountryPayrollEngine = {
  country: 'Uganda',
  currency: 'UGX',
  requiredRates: UGANDA_REQUIRED_RATES,
  calculate({ employee, ctx }) {
    return ugandaPayslipResult(calculateUgandaPayslip(employee, ctx));
  },
  returns: () => UGANDA_RETURNS,
  validate(employee) {
    const number = text(employee['Employee Number']);
    const name = employeeName(employee as EmployeeRecord) || number;
    // warnings, as for Kenya: PAYE and NSSF are still worked out (and owed) without the numbers; the returns list who
    // is missing what
    return ugandaMissingDetails(employee).map<EmployeeProblem>((problem) => ({ employeeNumber: number, name, problem, blocking: false }));
  },
};
/* eslint-enable @typescript-eslint/no-explicit-any */
