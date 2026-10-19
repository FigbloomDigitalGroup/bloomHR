import { employeeInputs, perDiemRateOf, statutoryFor, type Rates } from './statutoryCalc';
import { statutoryPayWith, summariseEarnings, type EarningItem } from './earnings';
import { basicAfterLeave, leavePayFor, leavePayoutItems, type LeavePayRow, type LeavePayoutDue, type LeaveRateBasis } from './leavePay';
import { withAbsencePay } from './absencePay';
import type { AbsencePayRow } from './absencePay';
import { overtimeForPayslip, type OvertimeMonth } from './overtimePay';
import { totalOf, type DeductionItem } from './voluntaryDeductions';
import { loanDeductionsFor, type PayrollLoan } from './loans';
import { nitaLevyFor } from './nitaLevy';
import { paymentMethodLabel } from './paymentMethods';
import { kenyaTaxDetails } from './payroll/taxDetails';
import { NO_WORK, isContractor, round2, settlementFields, whtOn, whtRateFor, type WorkMonth, type WorkSettlementRow, workMonthOf } from './workSettlement';

/**
 * One employee's payslip for the month, as the payroll page works it out (moved here from PayrollDashboard, unchanged
 * for salaried employees; FIG-812 stage 5 adds the month-end settlement of work and contract jobs).
 *
 * Earnings: basic (less unpaid leave and absence), allowances, overtime, bonuses and commissions, and the month's
 * piece rate work and contract jobs. SHIF, NSSF, AHL and PAYE with the month's rates (lib/statutoryCalc), or a
 * contractor's withholding tax instead. Then voluntary deductions, advances and loans, and net pay; for a worker paid
 * by work, the balance after what payouts already paid and any arrears (lib/workSettlement).
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- employee rows and payslip records are the untyped rows the payroll page uses */
export interface PayslipContext {
  period: string;
  rates: Rates;
  overrideStatutoryChecks: boolean;
  voluntaryByEmployee: Map<string, DeductionItem[]>;
  payrollLoans: PayrollLoan[];
  earningsByEmployee: Map<string, EarningItem[]>;
  leaveByEmployee: Map<string, LeavePayRow>;
  leaveBasis: LeaveRateBasis;
  absenceByEmployee: Map<string, AbsencePayRow>;
  leavePayouts: Map<string, LeavePayoutDue[]>;
  overtimeMonth: OvertimeMonth | undefined;
  /** what comes off this pay for salary advances */
  advanceFor: (employeeNumber: string, period: string) => number;
  /** the month's work, jobs, payouts and arrears, by employee number (work_month_settlement); empty for none */
  workByEmployee?: Map<string, WorkSettlementRow>;
  /** Employment Act s.19(3) two-thirds cap (company setting, on by default) */
  deductionCap?: boolean;
  /** Uganda (FIG-905): Local Service Tax already paid this financial year, by employee number, and how it is collected */
  lstPaidThisYear?: Map<string, number>;
  lstCollection?: 'instalments' | 'lump_sum';
  /** how many people the run pays in the employee's country (FIG-905: Tanzania's SDL applies from 10 employees) */
  countryHeadcount?: number;
}

/** What a country's rules work out on the month's pay (FIG-905): its tax and social security, in place of Kenya's. */
export interface StatutoryArgs {
  employee: Record<string, any>;
  rates: Rates;
  overrideStatutoryChecks: boolean;
  /** gross pay for the month (all earnings, less unpaid leave and absence) */
  grossPay: number;
  /** the basic salary earned this month (after unpaid leave and absence) */
  basicEarned: number;
  /** overtime paid this month */
  overtimePay: number;
  /** the month's earnings summary (taxable, not taxed, pensionable...) */
  earnings: ReturnType<typeof summariseEarnings>;
  contractor: boolean;
  /** extra figures the run knows about the country (e.g. its headcount for a levy threshold) */
  ctx: PayslipContext;
}

/** A country's statutory figures for one payslip. Everything in `deductions` is taken from pay and always in full. */
export interface StatutoryOutcome {
  paye: number;
  nssf: number;
  /** Kenya's SHIF; 0 elsewhere unless a country has a health levy in the same place */
  health: number;
  housingLevy: number;
  wht: number;
  whtRate: number;
  taxRelief: number;
  /** other statutory deductions taken from pay (Tanzania's HESLB repayment), by the payslip column that keeps each */
  otherStatutory: Record<string, number>;
  /** extra columns saved on the payslip (employer costs, taxable pay, flags) */
  fields: Record<string, unknown>;
  /** the per diem share of basic that is not taxed (Kenya's company practice), 0 elsewhere */
  perDiem: number;
  /** whether the Employment Act two-thirds cap applies to a settlement payslip */
  cap: boolean;
}

/** A country's rules for the shared payslip calculation (earnings, leave, loans and settlement are the same everywhere). */
export interface PayslipRules {
  statutory(args: StatutoryArgs): StatutoryOutcome;
}

export function calculatePayslip(employee: Record<string, any>, ctx: PayslipContext, rules?: PayslipRules): Record<string, any> {
  const { rates, overrideStatutoryChecks, period: actualPeriod, leaveBasis } = ctx;
  const basicSalary = employee["Basic Salary"] || 0;
  const employeeId = employee["Employee Number"] || "";
  const jobGroup = employee["Job Group"] || "";
  const employeeNat = employee["ID Number"] || "";
  const employeeNu = employee["Mobile Number"] || "";
  const firstName = employee["First Name"] || "";
  const middleName = employee["Middle Name"] || "";
  const branch = employee.Office || employee.branch || "";
  const lastName = employee["Last Name"] || "";
  const department = employee.Department || employee["Job Level"] || "";
  const position = employee["Job Title"] || "";

  const houseAllowance = employee.house_allowance || 0;
  const transportAllowance = employee.travel_allowance || 0;
  // approved overtime entries (a line per kind of day); the old employees.overtime field only in a month
  // when the company has no approved overtime at all (lib/overtimePay)
  const overtime = overtimeForPayslip(ctx.overtimeMonth, employee, basicSalary);
  const overtimeHours = overtime.hours;
  const overtimeRate = overtime.rate;

  const nhifNumber = employee["NHIF Number"] || employee["SHIF Number"] || "";
  const nssfNumber = employee["NSSF Number"] || "";
  const taxPin = employee["Tax PIN"] || "";

  const medicalAllowance = employee.medical_allowance || 0;
  const otherAllowances = 0;
  // this month's earnings: commissions in commission, every other earning in bonus (lib/earnings)
  const earnings = summariseEarnings([
    ...(ctx.earningsByEmployee.get(employeeId) ?? []),
    ...leavePayoutItems(ctx.leavePayouts.get(employeeId), basicSalary, leaveBasis),
  ]);
  const commission = earnings.commission;
  const bonus = earnings.bonus;

  // unpaid leave days, and half a day for each half-pay leave day, come off the basic salary earned this
  // month, so gross pay and everything worked out from it (PAYE, NSSF, SHIF, housing levy) is on what is left
  const leave = withAbsencePay(leavePayFor(ctx.leaveByEmployee.get(employeeId), basicSalary, leaveBasis), ctx.absenceByEmployee.get(employeeId), basicSalary, leaveBasis);
  const leaveDeduction = leave.total;

  // Per diem is PART of basic salary, not extra payment: the month's per diem share (per_diem_rate, 33% by default) of
  // the basic earned this month
  const { perDiem } = basicAfterLeave(basicSalary, leaveDeduction, perDiemRateOf(rates ?? {}));

  const overtimePay = overtime.pay;

  // the month's approved piece rate work and contract jobs, paid out during the month or not (FIG-812): earnings like
  // salary, so PAYE, NSSF, SHIF and AHL are worked out on the month's total. 0 for everyone else.
  const work: WorkMonth = ctx.workByEmployee ? workMonthOf(ctx.workByEmployee.get(employeeId)) : NO_WORK;
  const workPay = round2(work.workPay + work.jobsPay);
  const contractor = isContractor(employee);

  // Gross pay (basic salary already includes per diem)
  const grossPay =
    basicSalary +
    houseAllowance +
    transportAllowance +
    medicalAllowance +
    otherAllowances +
    overtimePay +
    commission +
    bonus -
    leaveDeduction +
    workPay;

  // Kenya (the default rules): Kenya's statutory deductions exactly as before the country engines; another country's
  // engine passes its own rules (FIG-905)
  const outcome: StatutoryOutcome = rules
    ? rules.statutory({ employee, rates: rates ?? {}, overrideStatutoryChecks, grossPay, basicEarned: Math.max(0, basicSalary - leaveDeduction), overtimePay, earnings, contractor, ctx })
    : kenyaStatutory();
  function kenyaStatutory(): StatutoryOutcome {
    // Taxable amount EXCLUDES the per diem portion and earnings that are not taxed
    const taxableGross = grossPay - perDiem - earnings.nonTaxable;

    // SHIF, NSSF, AHL and PAYE with this month's rates (lib/statutoryCalc): pension, PRMF and mortgage
    // interest come off taxable pay, insurance relief and the PWD exemption apply. A deduction is left out
    // while its number or PIN is missing, unless statutory checks are overridden. A contractor pays none of them:
    // withholding tax instead.
    const inputs = employeeInputs(employee);
    const statutory = statutoryFor(
      {
        ...statutoryPayWith(taxableGross - earnings.taxable, earnings.items),
        ...inputs,
        apply: contractor
          ? { shif: false, nssf: false, ahl: false, paye: false }
          : {
              shif: overrideStatutoryChecks || Boolean(nhifNumber),
              nssf: overrideStatutoryChecks || Boolean(nssfNumber),
              ahl: overrideStatutoryChecks || Boolean(taxPin),
              paye: overrideStatutoryChecks || Boolean(taxPin),
            },
      },
      rates ?? {},
    );
    const nhifDeduction = statutory.shif;
    const nssfDeduction = statutory.nssf;
    const housingLevy = statutory.ahl;
    const payeTax = statutory.paye;
    // the monthly personal relief, as the P10 reports it
    const taxRelief = contractor ? 0 : statutory.personalRelief;
    const whtRate = contractor ? whtRateFor(employee, rates ?? {}) : 0;
    const whtTax = contractor ? whtOn(grossPay, whtRate) : 0;
    return {
      paye: payeTax, nssf: nssfDeduction, health: nhifDeduction, housingLevy, wht: whtTax, whtRate, taxRelief,
      otherStatutory: {},
      // how taxable pay and PAYE were worked out, for the payslip (FIG-814); none for a contractor (WHT on gross)
      fields: contractor
        ? {}
        : {
            taxable_pay: statutory.taxablePay,
            tax_details: kenyaTaxDetails(statutory, rates ?? {}, { perDiem, nonTaxable: earnings.nonTaxable, benefits: inputs.benefits }, contractor),
          },
      perDiem, cap: true,
    };
  }
  const { paye: payeTax, nssf: nssfDeduction, health: nhifDeduction, housingLevy, wht: whtTax, whtRate, taxRelief } = outcome;
  const otherStatutory = Object.values(outcome.otherStatutory).reduce((s, n) => s + n, 0);

  // the employee's pension and post-retirement medical fund contributions come out of their pay
  const pensionItems = [
    { name: "Pension contribution", amount: Number(employee.other_pension_contribution) || 0 },
    { name: "Post-retirement medical fund", amount: Number(employee.post_retirement_medical_fund) || 0 },
  ].filter((i) => i.amount > 0);

  const advanceDeduction = ctx.advanceFor(employeeId, actualPeriod);

  // voluntary deductions are itemised (deduction_items); welfare is kept for older payslips
  const voluntaryItems = [...pensionItems, ...(ctx.voluntaryByEmployee.get(employeeId) ?? [])];
  const welfareDeduction = 0;
  const otherDeductions = totalOf(voluntaryItems);
  // loan instalments come last, out of what is left (after what payouts already paid and arrears, for a worker paid
  // by work), so they never take net pay below 0; what doesn't fit is still owed next month. Each is a "Loan
  // repayment: <type>" line (with its loan_id, which approving the month records as repaid) and their total is
  // loan_deduction.
  const loanItems = loanDeductionsFor(
    ctx.payrollLoans,
    employeeId,
    actualPeriod,
    grossPay - work.paidOut - work.arrearsBroughtForward -
      (payeTax + nhifDeduction + nssfDeduction + housingLevy + whtTax + otherStatutory + advanceDeduction + welfareDeduction + otherDeductions),
  );
  const loanDeduction = totalOf(loanItems);
  const deductionItems = [...voluntaryItems, ...loanItems];

  // Total deductions include statutory and advance deduction
  const totalDeductions =
    payeTax +
    nhifDeduction +
    nssfDeduction +
    housingLevy +
    whtTax +
    otherStatutory +
    loanDeduction +
    advanceDeduction +
    welfareDeduction +
    otherDeductions;

  // salaried employees: gross less deductions, as always; a month of work: the balance (lib/workSettlement)
  const settlement = settlementFields({
    employee,
    work,
    grossPay,
    totalDeductions,
    statutory: payeTax + nhifDeduction + nssfDeduction + housingLevy + whtTax + otherStatutory,
    netPay: grossPay - totalDeductions,
    whtRate,
    whtTax,
    cap: ctx.deductionCap !== false && outcome.cap,
  });

  return {
    id: employee.id || "",
    employee_id: employeeId,
    employeeNat: employeeNat,
    employeeNu: employeeNu,
    jobGroup: jobGroup,
    employee_name: `${firstName} ${middleName} ${lastName}`.trim(),
    branch: branch,
    department: department,
    position: position,
    basic_salary: basicSalary,
    house_allowance: houseAllowance,
    transport_allowance: transportAllowance,
    medical_allowance: medicalAllowance,
    other_allowances: otherAllowances,
    overtime_hours: overtimeHours,
    overtime_rate: overtimeRate,
    commission: commission,
    bonus: bonus,
    per_diem: outcome.perDiem,
    gross_pay: grossPay,
    paye_tax: payeTax,
    nhif_deduction: nhifDeduction,
    nssf_deduction: nssfDeduction,
    housing_levy: housingLevy,
    tax_relief: taxRelief,
    loan_deduction: loanDeduction,
    advance_deduction: advanceDeduction,
    welfare_deduction: welfareDeduction,
    other_deductions: otherDeductions,
    deduction_items: deductionItems,
    earning_items: earnings.items,
    leave_deduction: leaveDeduction,
    leave_items: leave.items,
    overtime_pay: overtimePay,
    overtime_items: overtime.items,
    total_deductions: totalDeductions,
    ...settlement,
    // the employer's NITA training levy (FIG-898): an employer cost, not in deductions or net pay (Kenya's only)
    nita_levy: rules ? 0 : nitaLevyFor(employee, rates),
    ...outcome.otherStatutory,
    ...outcome.fields,
    pay_period: actualPeriod,
    payment_method: paymentMethodLabel(employee.payment_method),
    bank_name: employee.Bank || "",
    account_number: employee["Account Number"] || "",
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
