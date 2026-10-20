import type { DeductionItem } from './voluntaryDeductions';
import type { EarningItem } from './earnings';
import { TAX_RULES, findTaxRule, type BenefitBucket, type PayItemKind, type TaxRule, type TaxTreatment } from './kenyaTaxTreatment';
import type { WorkWeek } from './workWeek';

/**
 * The company's standard pay items (table company_pay_items, migration 20261022700000): deductions, allowances and
 * benefits set once for the company and applied automatically to whoever they cover, on the monthly payroll and on
 * casual pay runs. Pure: the database calls are in payItemsApi.
 *
 * They reuse the payroll's own item mechanisms rather than a second engine:
 *   deduction  a voluntary deduction line (lib/voluntaryDeductions), taken after PAYE. A pension, post-retirement
 *              medical fund or insurance item (by its tax rule) also goes into the employee's tax details, so PAYE
 *              comes down (pension, PRMF) or the insurance relief is given, each up to its cap, exactly as when HR
 *              types it into the employee's tax details.
 *   allowance  an earning (lib/earnings): cash pay, taxed unless confirmed 'Not taxable'. A taxable allowance counts for
 *              NSSF; one that is not taxed doesn't.
 *   benefit    a non-cash benefit (lib/statutoryCalc Benefits): not paid in cash, but added to taxable pay by the
 *              engine's own rules (meals above the meals limit, small non-cash benefits under theirs, car, housing and
 *              everything else in full). Kenya only: other countries' engines have no non-cash benefits yet.
 *
 * Defaults chosen for the company (no finance sign-off; each is a setting on the item):
 *   - 'Depends' is treated as taxable until someone chooses: under-taxing is the costly mistake.
 *   - 'Per day worked' on the monthly payroll is the month's working days (the company work week, or the leave
 *     engine's count) less unpaid leave, half-pay leave and unexcused absence days; on a casual run it is full days
 *     plus half of each half day.
 *   - '% of basic' is of the contract basic salary on the monthly payroll and of the days' pay on a casual run.
 *   - 'Fixed' is a month's amount on the monthly payroll and once per pay run for casuals.
 *   - 'All employees', a department, branch or job group cover the monthly payroll only; casuals are covered by
 *     'Casual workers' or by being chosen by name.
 *   - Deductions are kept within two-thirds of wages (Employment Act s.19(3)) on casual runs and on month-end
 *     settlements when the company's deduction cap is on (the default); salaried staff over it are flagged.
 */

export type CatalogueKind = 'deduction' | 'allowance' | 'benefit';
export type AmountType = 'fixed_monthly' | 'per_day' | 'percent_of_basic';
export type AppliesTo = 'all' | 'department' | 'branch' | 'job_group' | 'casuals' | 'chosen';

export interface CompanyPayItem {
  id: string;
  name: string;
  kind: CatalogueKind;
  amount_type: AmountType;
  /** KSh (fixed or per day), or a percentage (0-100) of basic */
  amount: number;
  applies_to: AppliesTo;
  /** the department, branch or job group (its id) for those scopes */
  scope_id: string | null;
  /** for 'chosen': the employee numbers it applies to (casual workers included) */
  employee_numbers: string[];
  tax_treatment: TaxTreatment;
  /** the TAX_RULES id the treatment came from, when it came from the rules table */
  tax_rule_id: string | null;
  /** where the treatment came from: the rule and its legal basis, or the AI's suggestion and who confirmed it */
  tax_source: string | null;
  tax_confirmed_at?: string | null;
  active: boolean;
  notes: string | null;
}

export type NewCompanyPayItem = Omit<CompanyPayItem, 'id' | 'tax_confirmed_at'>;

export const KIND_LABELS: Record<CatalogueKind, string> = { deduction: 'Deduction', allowance: 'Allowance (cash)', benefit: 'Benefit (non-cash)' };
export const AMOUNT_TYPE_LABELS: Record<AmountType, string> = {
  fixed_monthly: 'Fixed a month (once per casual pay run)',
  per_day: 'Per day worked',
  percent_of_basic: '% of basic pay',
};
export const APPLIES_TO_LABELS: Record<AppliesTo, string> = {
  all: 'All employees on the monthly payroll',
  department: 'A department',
  branch: 'A branch',
  job_group: 'A job group',
  casuals: 'All casual workers',
  chosen: 'Chosen people',
};

/** The kind of pay item the tax rules (and the AI) know it as. */
export const ruleKindOf = (kind: CatalogueKind): PayItemKind => (kind === 'allowance' ? 'earning' : kind);

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

/** How payroll taxes an item: as confirmed, with 'Depends' (still undecided) taken as taxable. */
export const engineTaxable = (item: Pick<CompanyPayItem, 'tax_treatment'>) => item.tax_treatment !== 'not_taxable';

/** The rule an item's treatment came from (by its saved id; else matched again by its name). */
export const ruleOf = (item: Pick<CompanyPayItem, 'tax_rule_id' | 'name' | 'kind'>): TaxRule | null =>
  (item.tax_rule_id && TAX_RULES.find((r) => r.id === item.tax_rule_id)) || findTaxRule(item.name, ruleKindOf(item.kind));

/** Why an item can't be saved, or null. */
export function payItemError(item: Partial<NewCompanyPayItem>): string | null {
  const name = text(item.name);
  if (name.length < 2) return 'Give it a name.';
  if (name.length > 100) return 'Keep the name under 100 characters.';
  const amount = Number(item.amount);
  if (!Number.isFinite(amount) || amount < 0) return 'The amount should be a number, 0 or more.';
  if (item.amount_type === 'percent_of_basic' && amount > 100) return 'A percentage can be at most 100.';
  if (['department', 'branch', 'job_group'].includes(String(item.applies_to)) && !item.scope_id) return 'Choose who it applies to.';
  if (item.applies_to === 'chosen' && !(item.employee_numbers ?? []).length) return 'Choose at least one person.';
  if (!item.tax_treatment) return 'Confirm how it is taxed.';
  return null;
}

// ---------------------------------------------------------------------------------------------
// who an item covers
// ---------------------------------------------------------------------------------------------

/** What scope matching needs to know about one employee record. */
export interface Coverage {
  /** the employee's branch id (lib/branches employeeBranch), when known */
  branchId?: string | null;
}

/** Whether an item covers an employee record (casual workers only by 'casuals' or by name). */
export function itemCovers(item: Pick<CompanyPayItem, 'applies_to' | 'scope_id' | 'employee_numbers'>, employee: Record<string, unknown>, coverage: Coverage = {}) {
  const number = text(employee['Employee Number']);
  const casual = text(employee['worker_kind']) === 'casual';
  switch (item.applies_to) {
    case 'chosen':
      return (item.employee_numbers ?? []).includes(number);
    case 'casuals':
      return casual;
    case 'all':
      return !casual;
    case 'department':
      return !casual && Boolean(item.scope_id) && text(employee['department_id']) === item.scope_id;
    case 'branch':
      return !casual && Boolean(item.scope_id) && (coverage.branchId ?? text(employee['branch_id'])) === item.scope_id;
    case 'job_group':
      return !casual && Boolean(item.scope_id) && text(employee['job_group_id']) === item.scope_id;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------------------------
// the monthly payroll
// ---------------------------------------------------------------------------------------------

/** Working days in a month ('YYYY-MM') by a work week (Monday first; half days count a half). */
export function workingDaysInMonth(period: string, week: WorkWeek): number {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return 0;
  const days = new Date(y, m, 0).getDate();
  let total = 0;
  for (let d = 1; d <= days; d++) total += week[(new Date(y, m - 1, d).getDay() + 6) % 7] ?? 0;
  return total;
}

/** Days worked in the month: working days less unpaid, half-pay and absent days (never below 0). */
export const daysWorkedInMonth = (workingDays: number, daysOff: number) => Math.max(0, round2(num(workingDays) - num(daysOff)));

/** One item's amount for an employee this month. */
export const monthlyAmount = (item: Pick<CompanyPayItem, 'amount_type' | 'amount'>, basic: number, daysWorked: number) =>
  item.amount_type === 'per_day'
    ? round2(num(item.amount) * num(daysWorked))
    : item.amount_type === 'percent_of_basic'
      ? round2((num(basic) * num(item.amount)) / 100)
      : round2(num(item.amount));

/** The employee fields the engine reads non-cash benefits and tax details from (lib/statutoryCalc employeeInputs). */
const BENEFIT_FIELDS: Record<BenefitBucket, string> = {
  car: 'car_benefit',
  meals: 'meals_benefit',
  housing: 'housing_benefit',
  nonCash: 'non_cash_benefit',
  other: 'other_benefits',
};

export interface AppliedPayItem {
  id: string;
  name: string;
  kind: CatalogueKind;
  amount: number;
}

/** What the catalogue adds to one employee's month. */
export interface CatalogueEffect {
  deductions: DeductionItem[];
  earnings: EarningItem[];
  /** amounts to add to the employee's own benefit and tax detail fields (e.g. meals_benefit, insurance_premium) */
  fields: Record<string, number>;
  applied: AppliedPayItem[];
}

export interface EmployeeMonth {
  /** the country the employee is paid in (non-cash benefits and tax details are Kenya's only) */
  country: string;
  basic: number;
  daysWorked: number;
  coverage?: Coverage;
}

/** The catalogue's items for one employee for the month, as payroll items. */
export function catalogueFor(items: CompanyPayItem[], employee: Record<string, unknown>, month: EmployeeMonth): CatalogueEffect {
  const effect: CatalogueEffect = { deductions: [], earnings: [], fields: {}, applied: [] };
  const kenya = month.country === 'Kenya';
  const addField = (field: string, amount: number) => {
    effect.fields[field] = round2((effect.fields[field] ?? 0) + amount);
  };
  for (const item of items) {
    if (!item.active || !itemCovers(item, employee, month.coverage)) continue;
    const amount = monthlyAmount(item, month.basic, month.daysWorked);
    if (amount <= 0) continue;
    const rule = ruleOf(item);
    if (item.kind === 'allowance') {
      const taxable = engineTaxable(item);
      effect.earnings.push({ name: item.name, amount, taxable, pensionable: taxable });
    } else if (item.kind === 'benefit') {
      // a non-cash benefit only changes tax; not taxed (confirmed so) or outside Kenya, it is not on the payslip
      if (!kenya || !engineTaxable(item)) continue;
      addField(BENEFIT_FIELDS[rule?.benefitBucket ?? 'other'], amount);
    } else {
      const field = kenya && item.tax_treatment !== 'not_taxable' ? rule?.taxField : undefined;
      // the engine itself puts a pension or PRMF contribution on the payslip as a deduction line
      if (field === 'pension') addField('other_pension_contribution', amount);
      else if (field === 'prmf') addField('post_retirement_medical_fund', amount);
      else {
        if (field === 'insurance') addField('insurance_premium', amount);
        effect.deductions.push({ name: item.name, amount });
      }
    }
    effect.applied.push({ id: item.id, name: item.name, kind: item.kind, amount });
  }
  return effect;
}

/** An employee record with the catalogue's benefit and tax detail amounts added to its own. */
export const withCatalogueFields = <T extends Record<string, unknown>>(employee: T, fields: Record<string, number>): T => {
  if (!Object.keys(fields).length) return employee;
  const next: Record<string, unknown> = { ...employee };
  for (const [field, amount] of Object.entries(fields)) next[field] = round2(num(employee[field]) + amount);
  return next as T;
};

export interface RunInputs<E extends Record<string, unknown>> {
  employees: E[];
  items: CompanyPayItem[];
  voluntaryByEmployee: Map<string, DeductionItem[]>;
  earningsByEmployee: Map<string, EarningItem[]>;
  /** the month for each employee: country, basic, days worked, branch */
  monthOf: (employee: E) => EmployeeMonth;
}

/**
 * The month's run inputs with the catalogue applied: each employee's deduction and earning lines (after their own),
 * and employee records carrying the catalogue's benefits and tax details. Nothing changes when the catalogue is empty.
 */
export function applyCatalogue<E extends Record<string, unknown>>(input: RunInputs<E>) {
  const voluntaryByEmployee = new Map(input.voluntaryByEmployee);
  const earningsByEmployee = new Map(input.earningsByEmployee);
  const applied = new Map<string, AppliedPayItem[]>();
  const live = input.items.filter((i) => i.active);
  if (!live.length) return { employees: input.employees, voluntaryByEmployee, earningsByEmployee, applied };
  const employees = input.employees.map((e) => {
    const number = text(e['Employee Number']);
    const effect = catalogueFor(live, e, input.monthOf(e));
    if (!effect.applied.length) return e;
    if (effect.deductions.length) voluntaryByEmployee.set(number, [...(voluntaryByEmployee.get(number) ?? []), ...effect.deductions]);
    if (effect.earnings.length) earningsByEmployee.set(number, [...(earningsByEmployee.get(number) ?? []), ...effect.earnings]);
    applied.set(number, effect.applied);
    return withCatalogueFields(e, effect.fields);
  });
  return { employees, voluntaryByEmployee, earningsByEmployee, applied };
}

/** Payslips whose deductions are more than two-thirds of gross pay (Employment Act s.19(3)): a warning for salaried staff. */
export function overTwoThirds(records: { employee_id?: unknown; employee_name?: unknown; gross_pay?: unknown; total_deductions?: unknown }[]) {
  return records
    .map((r) => ({ employeeNumber: text(r.employee_id), name: text(r.employee_name), gross: num(r.gross_pay), deductions: num(r.total_deductions) }))
    .filter((r) => r.gross > 0 && r.deductions > round2((r.gross * 2) / 3));
}

// ---------------------------------------------------------------------------------------------
// casual pay runs (the database works out the same in casual_pay_run_lines; this is for the screens and the tests)
// ---------------------------------------------------------------------------------------------

export interface StandingItem {
  name: string;
  kind: 'deduction' | 'allowance';
  /** what was taken or added */
  amount: number;
  /** what the item came to before the two-thirds limit or the pay ran out */
  full: number;
}

export interface CasualStanding {
  items: StandingItem[];
  additions: number;
  deductions: number;
}

/** Two-thirds of a sum, to the cent (s.19(3)), or all of it when the cap is off. */
export const deductionLimit = (wages: number, capOn: boolean) => (capOn ? round2((Math.max(0, wages) * 2) / 3) : round2(Math.max(0, wages)));

/**
 * A casual pay-run line's standing items: allowances first, then deductions in name order, each per day worked (full
 * days plus half of each half day), once per run, or a % of the days' pay. Deductions stop at two-thirds of the
 * days' pay plus the standing allowances (all of it with the cap off); what doesn't fit is not taken. A line with no
 * days worked gets none.
 */
export function casualStanding(
  line: { full_days: number | string; half_days: number | string; days_amount: number | string; employee_number: string },
  items: CompanyPayItem[],
  capOn: boolean,
): CasualStanding {
  const days = num(line.full_days) + num(line.half_days) * 0.5;
  const result: CasualStanding = { items: [], additions: 0, deductions: 0 };
  if (days <= 0) return result;
  const covered = items
    .filter((i) => i.active && i.kind !== 'benefit' && (i.applies_to === 'casuals' || (i.applies_to === 'chosen' && (i.employee_numbers ?? []).includes(line.employee_number))))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'allowance' ? -1 : 1;
      const [x, y] = [a.name.toLowerCase(), b.name.toLowerCase()];
      return x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  const daysPay = num(line.days_amount);
  for (const item of covered) {
    const full =
      item.amount_type === 'per_day'
        ? round2(num(item.amount) * days)
        : item.amount_type === 'percent_of_basic'
          ? round2((daysPay * num(item.amount)) / 100)
          : round2(num(item.amount));
    if (item.kind === 'allowance') {
      result.additions = round2(result.additions + full);
      result.items.push({ name: item.name, kind: 'allowance', amount: full, full });
    } else {
      const room = Math.max(0, round2(deductionLimit(daysPay + result.additions, capOn) - result.deductions));
      const amount = Math.min(full, room);
      result.deductions = round2(result.deductions + amount);
      result.items.push({ name: item.name, kind: 'deduction', amount, full });
    }
  }
  return result;
}

/** The most a line's one-off deduction can be: what is left under the limit after its standing deductions. */
export const maxOneOffDeduction = (
  line: { days_amount: number | string; standing_additions?: number | string | null; standing_deductions?: number | string | null },
  additions: number,
  capOn: boolean,
) => Math.max(0, round2(deductionLimit(num(line.days_amount) + num(line.standing_additions) + num(additions), capOn) - num(line.standing_deductions)));
