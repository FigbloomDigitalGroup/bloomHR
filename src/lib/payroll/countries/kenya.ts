import { calculatePayslip } from '../../payslipCalc';
import { REQUIRED_RATES } from '../../statutoryCalc';
import { missingDetails, employeeName } from '../../missingPayrollDetails';
import { isContractor } from '../../workSettlement';
import {
  type ExportFile,
  type Rates,
  employeeNumberOf,
  isContractorSlip,
  nitaFile,
  nssfFile,
  p10File,
  pensionablePayOf,
  shaFile,
  whtFile,
} from '../../payrollExports';
import type { EmployeeRecord } from '../../profileCompleteness';
import { taxWorkingOf } from '../taxDetails';
import type { CountryPayrollEngine, EmployeeProblem, PayslipLine, PayslipRecord, PayslipResult, ReturnFile } from './types';

// Kenya's payroll (FIG-905 stage 2): the calculation the payroll page always used (lib/payslipCalc, unchanged: PAYE,
// NSSF, SHIF and the housing levy on the month's dated statutory_rates, or a contractor's withholding tax; the NITA levy
// as an employer cost), behind the country engine interface. kenyaEngine.test.ts checks every figure against the
// numbers worked out before the move (kenyaGolden.json).

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const nonZero = (lines: PayslipLine[]) => lines.filter((l) => l.amount !== 0);

/** Kenya's payslip figures, labelled (the saved record keeps its own columns; this is for summaries and other countries' screens). */
export function kenyaPayslipResult(record: PayslipRecord, rates: Rates): PayslipResult {
  const contractor = isContractorSlip(record);
  const grossPay = num(record.gross_pay);
  // the employer's share, from the employee's at the employer rate (both are on the same pay)
  const employerShare = (employee: number, employeeRateCode: string, employerRateCode: string) => {
    // without the month's rates (a saved payslip on its own): the employer matches the employee's share, as the law sets both
    if (rates[employeeRateCode] === undefined || rates[employeeRateCode] === null) return employee;
    const r = num(rates[employeeRateCode]);
    const er = rates[employerRateCode] === undefined ? r : num(rates[employerRateCode]);
    return r > 0 ? round2((employee * er) / r) : 0;
  };
  return {
    country: 'Kenya',
    currency: 'KES',
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
    statutoryDeductions: nonZero(
      contractor
        ? [{ label: 'Withholding tax', amount: num(record.wht_tax) }]
        : [
            { label: 'PAYE', amount: num(record.paye_tax) },
            { label: 'NSSF', amount: num(record.nssf_deduction) },
            { label: 'SHIF', amount: num(record.nhif_deduction) },
            { label: 'Housing levy', amount: num(record.housing_levy) },
          ]
    ),
    employerCosts: nonZero([
      { label: 'NSSF (employer)', amount: employerShare(num(record.nssf_deduction), 'nssf_rate', 'nssf_employer_rate') },
      { label: 'Housing levy (employer)', amount: employerShare(num(record.housing_levy), 'ahl_rate', 'ahl_employer_rate') },
      { label: 'NITA levy', amount: num(record.nita_levy) },
    ]),
    grossPay,
    // what PAYE was worked out on, as the engine saved it; payslips saved before then: gross less the per diem
    taxablePay: record.taxable_pay === null || record.taxable_pay === undefined ? round2(Math.max(0, grossPay - num(record.per_diem))) : num(record.taxable_pay),
    tax: contractor ? num(record.wht_tax) : num(record.paye_tax),
    netPay: num(record.net_pay),
    working: taxWorkingOf(record, 'Kenya'),
  };
}

// ---- the housing levy schedule ---------------------------------------------------------------------------------
export const AHL_HEADERS = ['EMPLOYEE NUMBER', 'EMPLOYEE NAME', 'ID NO', 'KRA PIN', 'GROSS PAY', 'EMPLOYEE AHL', 'EMPLOYER AHL', 'TOTAL AHL'] as const;

const amount = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

/** Each employee's housing levy, both shares (the P10 carries the employee's share to iTax; this is the schedule). */
export function ahlFile(payslips: PayslipRecord[], employees: EmployeeRecord[], rates: Rates): ExportFile {
  const byNumber = new Map(employees.map((e) => [text(e['Employee Number']), e]));
  const employeeRate = num(rates.ahl_rate);
  const employerRate = rates.ahl_employer_rate === undefined ? employeeRate : num(rates.ahl_employer_rate);
  const rows = payslips
    .filter((p) => !isContractorSlip(p) && num(p.housing_levy) > 0)
    .map((p) => {
      const e = byNumber.get(text(p.employee_id)) ?? {};
      const own = num(p.housing_levy);
      const employer = employeeRate > 0 ? round2((own * employerRate) / employeeRate) : 0;
      return [
        employeeNumberOf(e as EmployeeRecord, p), employeeName(e as EmployeeRecord) || text(p.employee_name), text(e['ID Number']),
        text(e['Tax PIN']), amount(pensionablePayOf(p)), amount(own), amount(employer), amount(own + employer),
      ];
    });
  return { headers: AHL_HEADERS, rows, problems: [] };
}

const KENYA_RETURNS: ReturnFile[] = [
  { key: 'p10', label: 'KRA PAYE (P10)', name: 'kra-p10', what: 'iTax P10 return', authority: 'KRA', build: (ps, es, { rates }) => p10File(ps, es, rates) },
  { key: 'sha', label: 'SHIF (SHA)', name: 'shif', what: 'SHIF contributions, filed with SHA', authority: 'SHA', build: (ps, es) => shaFile(ps, es) },
  { key: 'nssf', label: 'NSSF', name: 'nssf', what: 'NSSF contributions', authority: 'NSSF', build: (ps, es) => nssfFile(ps, es) },
  { key: 'ahl', label: 'Housing levy (AHL)', name: 'housing-levy', what: 'each employee’s levy, employee and employer shares', authority: 'KRA', build: (ps, es, { rates }) => ahlFile(ps, es, rates) },
  { key: 'nita', label: 'NITA training levy', name: 'nita-levy', what: 'employer levy per employee (not taken from pay)', authority: 'NITA', build: (ps, es) => nitaFile(ps, es) },
  {
    key: 'wht',
    label: 'KRA withholding tax (contractors)',
    name: 'kra-wht',
    what: 'iTax WHT return: each contractor’s gross, rate and tax',
    authority: 'KRA',
    optional: true,
    build: (ps, es, { payPeriod }) => whtFile(ps, es, payPeriod),
  },
];

export const kenyaEngine: CountryPayrollEngine = {
  country: 'Kenya',
  currency: 'KES',
  requiredRates: REQUIRED_RATES,
  calculate({ employee, ctx }) {
    // the same calculation as before the country engines, figure for figure (kenyaEngine.test.ts)
    const record = { ...calculatePayslip(employee, ctx), country: 'Kenya', currency: 'KES' };
    return kenyaPayslipResult(record, ctx.rates ?? {});
  },
  returns: () => KENYA_RETURNS,
  validate(employee) {
    const number = text(employee['Employee Number']);
    const name = employeeName(employee as EmployeeRecord) || number;
    // a contractor files no NSSF or SHA (withholding tax instead); everyone else needs both and a KRA PIN
    const missing = missingDetails(employee as EmployeeRecord).filter(
      (m) => !isContractor(employee) || (m !== 'NSSF number' && m !== 'SHA number')
    );
    // missing details are warnings, as before: payroll leaves the deduction out (unless overridden) and the returns
    // list who is missing what, but approval is not held back
    return missing.map<EmployeeProblem>((m) => ({ employeeNumber: number, name, problem: m, blocking: false }));
  },
};
