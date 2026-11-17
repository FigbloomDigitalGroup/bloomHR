import type { PayslipContext } from '../payslipCalc';
import type { Rates } from '../statutoryCalc';
import type { EmployeeRecord } from '../profileCompleteness';
import type { Branch } from '../branches';
import { currencyFor, employeeBranch } from '../branches';
import { type ExportFile, bankFile, equityFile, mpesaFile } from '../payrollExports';
import { type CountryPayrollEngine, type EmployeeProblem, type PayslipRecord, engineFor, tidyCountry, waitingLabel } from './countries';
import { currencyOf, moneyShort } from './currency';
import { tanzaniaMobileMoneyFile } from './countries/tanzania';
import { ugandaMobileMoneyFile } from './countries/uganda';
import { type PayCurrencies, USD, calculateInUsd, localPayslip, payCurrencyOf, rateText, usdBankFile } from './usdPay';

// One payroll run for every country (FIG-905 stage 2): "run like they're one country but in the backend they're
// different". The admin presses Run payroll and Approve once; behind that each employee is worked out by their
// branch's country's engine in its currency, each country is approved (and can be reopened) on its own, totals are
// kept per currency and never added across currencies, and each country files its own returns.
//
// Which country pays someone: their branch's country when the payslip is worked out. A payroll run is worked out (and
// recalculated) at month end, so someone who moved branch during the month is paid by the country of the branch they
// are in on the period's last day. A draft payslip saved before they moved is flagged ("moved branch: recalculate")
// and holds its country back until it is recalculated. Once a country is approved its payslips are locked; a move
// after that takes effect from the next month.
//
// FIG-906: a country can be paid in USD (company_pay_currencies) at the rate the company enters for the month
// (payroll_fx_rates). Its engine still works in the local currency (lib/payroll/usdPay); its payslips are in USD with
// the local statutory figures kept for the returns. A USD country without this month's rate is held back.

/* eslint-disable @typescript-eslint/no-explicit-any -- employee rows and payslips are the untyped rows the payroll page uses */
type Employee = Record<string, any>;

export type CountryRunStatus = 'draft' | 'approved' | 'paid';

/** payroll_run_countries: one row per country with payslips in the month's run. */
export interface RunCountry {
  country: string;
  status: CountryRunStatus;
  approved_at?: string | null;
  approved_by?: string | null;
  paid_at?: string | null;
}

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const sameCountry = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const nameOf = (e: Employee) =>
  [e['First Name'], e['Middle Name'], e['Last Name']].map(text).filter(Boolean).join(' ') || text(e['Employee Number']);

/** Kenya first (the company's home country so far), then the others by name. */
export const countryOrder = (a: string, b: string) => (a === 'Kenya' ? -1 : b === 'Kenya' ? 1 : a.localeCompare(b));

/** An employee's payroll country and currency: their branch's (the default branch when they have none), else Kenya. */
export function payrollCountryOf(employee: Employee, branches: Branch[]): { country: string; currency: string; branch?: Branch } {
  const branch = branches.length ? employeeBranch(employee, branches) : undefined;
  const country = tidyCountry(branch?.country) || 'Kenya';
  return { country, currency: text(branch?.currency).toUpperCase() || currencyFor(country), branch };
}

export interface CountryGroup {
  country: string;
  engine: CountryPayrollEngine | null;
  /** the currency the country's branches pay in (the engine's when they agree) */
  currency: string;
  /** the currency its payslips are in: the local one, or USD when the company pays the country in USD (FIG-906) */
  payCurrency: string;
  employees: Employee[];
  /** branches in this country whose currency is not the one the country's payroll is worked out in */
  currencyMismatches: { branch: string; currency: string }[];
}

/** The employees on the payroll by country, each with its engine (null: not supported yet). */
export function groupByCountry(employees: Employee[], branches: Branch[], payCurrencies?: PayCurrencies | null): CountryGroup[] {
  const groups = new Map<string, CountryGroup>();
  for (const e of employees) {
    const { country, currency, branch } = payrollCountryOf(e, branches);
    let g = groups.get(country);
    if (!g) {
      const engine = engineFor(country);
      const local = engine?.currency ?? currency;
      g = { country, engine, currency: local, payCurrency: engine ? payCurrencyOf(country, payCurrencies, local) : local, employees: [], currencyMismatches: [] };
      groups.set(country, g);
    }
    g.employees.push(e);
    // a branch paying in another currency than its country's payroll is worked out in: blocked, never converted (a
    // branch set to USD in a country the company pays in USD is fine)
    if (g.engine && currency !== g.engine.currency && currency !== g.payCurrency && !g.currencyMismatches.some((m) => m.branch === (branch?.name ?? ''))) {
      g.currencyMismatches.push({ branch: branch?.name ?? country, currency });
    }
  }
  return [...groups.values()].sort((a, b) => countryOrder(a.country, b.country));
}

/** The engine's required rates missing from a country's rates for the month. */
export const missingRatesFor = (engine: CountryPayrollEngine, rates: Rates | null | undefined) =>
  engine.requiredRates.filter((code) => !rates || rates[code] === null || rates[code] === undefined);

/** "Enter this month's USD rate for Kenya" */
export const usdRateMissing = (country: string) => `Enter this month's USD rate for ${country}`;

/** Why a country's payslips can't be worked out at all (no engine, mismatched currency, no rates, no USD rate), or null. */
export function cannotCalculate(group: CountryGroup, rates: Rates | null | undefined, fxRate?: number | null): string | null {
  if (!group.engine) return waitingLabel(group.country);
  if (group.currencyMismatches.length) {
    const m = group.currencyMismatches[0];
    return `${m.branch} pays in ${m.currency}, but ${group.country} payroll is worked out in ${group.engine.currency}. Change the branch's currency to ${group.engine.currency}.`;
  }
  if (rates === undefined) return `Loading ${group.country} statutory rates`;
  const missing = missingRatesFor(group.engine, rates);
  if (missing.length) return `${group.country} has no statutory rates for this month: ${missing.join(', ')}. Add them on the Rates tab.`;
  // paid in USD: nothing is worked out until the month's rate is confirmed (FIG-906)
  if (group.payCurrency === USD && !(Number(fxRate) > 0)) return usdRateMissing(group.country);
  return null;
}

/** The pay currency per country and the month's confirmed USD rates (FIG-906); empty: everyone in local currency. */
export interface UsdSetup {
  payCurrencies?: PayCurrencies | null;
  /** this month's rate per country, confirmed for the month (payroll_fx_rates): local currency per 1 USD */
  fxRates?: Map<string, number> | null;
}

/** People in a USD-paid country who can't go on a USD payslip this month (piece rate work, contract jobs), and why. */
export interface HeldBackPerson {
  country: string;
  employeeNumber: string;
  name: string;
  reason: string;
}

export interface RunCalculation {
  /** the payslips worked out, each with its country and currency */
  records: PayslipRecord[];
  /** countries nobody worked out, with why and who */
  notCalculated: { country: string; reason: string; waiting: boolean; employees: Employee[] }[];
  /** people in a USD-paid country left off the USD payslips (FIG-906): their country is held back */
  heldBack: HeldBackPerson[];
}

/**
 * Works out everyone with their own country's engine and rates. Staff in a country without an engine, or whose
 * country can't be worked out this month (no rates, a currency mismatch), are listed in notCalculated: worked out
 * by nobody, never on another country's rules.
 */
export function calculateRun(
  employees: Employee[],
  branches: Branch[],
  ctxFor: (country: string) => PayslipContext | null,
  usd?: UsdSetup
): RunCalculation {
  const records: PayslipRecord[] = [];
  const notCalculated: RunCalculation['notCalculated'] = [];
  const heldBack: HeldBackPerson[] = [];
  for (const g of groupByCountry(employees, branches, usd?.payCurrencies)) {
    const ctx = g.engine ? ctxFor(g.country) : null;
    const fxRate = usd?.fxRates?.get(g.country) ?? null;
    const reason = cannotCalculate(g, ctx ? ctx.rates : g.engine ? null : undefined, fxRate);
    if (reason || !g.engine || !ctx) {
      notCalculated.push({ country: g.country, reason: reason ?? `${g.country} payroll can't be worked out yet`, waiting: !g.engine, employees: g.employees });
      continue;
    }
    // the country's headcount on the run (Tanzania's SDL applies from a number of employees)
    const countryCtx = { ...ctx, countryHeadcount: g.employees.length };
    for (const e of g.employees) {
      if (g.payCurrency === USD && fxRate) {
        // paid in USD: converted to local, worked out by the engine unchanged, back to USD (lib/payroll/usdPay)
        const out = calculateInUsd(g.engine, e, countryCtx, fxRate);
        if (out.record) records.push(out.record);
        else heldBack.push({ country: g.country, employeeNumber: text(e['Employee Number']), name: nameOf(e), reason: out.heldBack });
        continue;
      }
      const r = g.engine.calculate({ employee: e, ctx: countryCtx });
      records.push({ ...r.record, country: g.engine.country, currency: g.engine.currency });
    }
  }
  return { records, notCalculated, heldBack };
}

/** A payslip's country (payslips saved before countries were recorded are Kenya's). */
export const payslipCountry = (p: { country?: unknown }) => tidyCountry(text(p.country)) || 'Kenya';

// ---------------------------------------------------------------------------------------------
// totals: per currency, never added across currencies
// ---------------------------------------------------------------------------------------------
export interface CurrencyTotals {
  currency: string;
  count: number;
  gross: number;
  deductions: number;
  net: number;
}

export function totalsByCurrency(records: PayslipRecord[]): CurrencyTotals[] {
  const by = new Map<string, CurrencyTotals>();
  for (const r of records) {
    const currency = currencyOf(r);
    const t = by.get(currency) ?? { currency, count: 0, gross: 0, deductions: 0, net: 0 };
    t.count += 1;
    t.gross = round2(t.gross + num(r.gross_pay));
    t.deductions = round2(t.deductions + num(r.total_deductions));
    t.net = round2(t.net + num(r.net_pay));
    by.set(currency, t);
  }
  return [...by.values()].sort((a, b) => (a.currency === 'KES' ? -1 : b.currency === 'KES' ? 1 : a.currency.localeCompare(b.currency)));
}

// ---------------------------------------------------------------------------------------------
// readiness per country
// ---------------------------------------------------------------------------------------------
export type ReadinessState = 'waiting' | 'blocked' | 'ready' | 'approved' | 'paid';

export interface CountryReadiness {
  country: string;
  currency: string;
  state: ReadinessState;
  /** people in the country on the payroll */
  employees: number;
  /** payslips worked out (or saved) for the country */
  payslips: number;
  totals: CurrencyTotals;
  /** what holds the country back from approval */
  blocking: string[];
  /** worth checking, but approval can go ahead */
  warnings: string[];
  /** each employee's missing details */
  problems: EmployeeProblem[];
  /** for a country without an engine: who is waiting */
  waitingNames: string[];
  approvedAt?: string | null;
  paidAt?: string | null;
}

export interface ReadinessInput {
  employees: Employee[];
  branches: Branch[];
  /** the month's payslips: the saved run's once started, else the preview */
  payslips: PayslipRecord[];
  /** the run's per-country status; empty before the run is started */
  runCountries: RunCountry[];
  /** whether the run has been started (payslips saved) */
  runStarted: boolean;
  ratesByCountry: Map<string, Rates | null>;
  /** people paid below their country's minimum wage, by country (a warning, never a block) */
  belowMinimum?: Map<string, number>;
  /** the pay currency per country and this month's confirmed USD rates (FIG-906) */
  payCurrencies?: PayCurrencies | null;
  fxRates?: Map<string, number> | null;
  /** people a USD country couldn't put on its USD payslips (calculateRun's heldBack) */
  heldBack?: HeldBackPerson[];
  /** draft countries worked out with other statutory rates than those in force for the month now (FIG-813) */
  ratesChanged?: string[];
}

/** Why a stale draft is held back (FIG-813). */
export const RATES_CHANGED = 'Rates changed since this was calculated: press Recalculate';

/** Before approval: per country, whether it is ready, waiting for its rules, or held back, and why. */
export function countryReadiness(input: ReadinessInput): CountryReadiness[] {
  const groups = groupByCountry(input.employees, input.branches, input.payCurrencies);
  const statusOf = new Map(input.runCountries.map((c) => [tidyCountry(c.country), c]));
  const slipsByCountry = new Map<string, PayslipRecord[]>();
  for (const p of input.payslips) {
    const c = payslipCountry(p);
    slipsByCountry.set(c, [...(slipsByCountry.get(c) ?? []), p]);
  }
  const countries = new Set<string>([...groups.map((g) => g.country), ...slipsByCountry.keys(), ...statusOf.keys()]);
  const groupOf = new Map(groups.map((g) => [g.country, g]));
  const countryOfEmployee = new Map(input.employees.map((e) => [text(e['Employee Number']), payrollCountryOf(e, input.branches).country]));

  return [...countries].sort(countryOrder).map((country) => {
    const g = groupOf.get(country);
    const engine = g?.engine ?? engineFor(country);
    const slips = slipsByCountry.get(country) ?? [];
    const run = statusOf.get(country);
    const currency = g?.payCurrency ?? (engine ? payCurrencyOf(country, input.payCurrencies, engine.currency) : currencyFor(country));
    const fxRate = input.fxRates?.get(country) ?? null;
    const totals = totalsByCurrency(slips).find((t) => t.currency === currency) ?? { currency, count: 0, gross: 0, deductions: 0, net: 0 };
    const blocking: string[] = [];
    const warnings: string[] = [];
    const problems = engine && g ? g.employees.flatMap((e) => engine.validate(e)) : [];
    const base = {
      country, currency, employees: g?.employees.length ?? 0, payslips: slips.length, totals, problems,
      waitingNames: engine ? [] : (g?.employees ?? []).map(nameOf),
      approvedAt: run?.approved_at ?? null, paidAt: run?.paid_at ?? null,
    };
    if (run?.status === 'approved' || run?.status === 'paid') {
      // locked: anyone now in the country who isn't on its approved payslips (joined or moved in after approval)
      const onSlips = new Set(slips.map((p) => text(p.employee_id)));
      const missing = (g?.employees ?? []).filter((e) => !onSlips.has(text(e['Employee Number'])));
      if (missing.length) warnings.push(`${missing.length} ${missing.length === 1 ? 'person is' : 'people are'} not on the approved payslips (joined or moved here after approval). Reopen ${country} to pay them this month.`);
      return { ...base, state: run.status, blocking, warnings };
    }
    if (!engine) return { ...base, state: 'waiting' as const, blocking: [waitingLabel(country)], warnings };

    const reason = g ? cannotCalculate(g, input.ratesByCountry.has(country) ? input.ratesByCountry.get(country) : undefined, fxRate) : null;
    if (reason) blocking.push(reason);
    // paid in USD (FIG-906): payslips worked out at another rate than this month's, and people who can't be paid in USD
    if (currency === USD && fxRate) {
      const stale = slips.filter((p) => currencyOf(p) === USD && Number(p.fx_rate) !== fxRate);
      if (stale.length) {
        blocking.push(`${stale.length} ${stale.length === 1 ? 'payslip was' : 'payslips were'} worked out at another USD rate than this month's ${rateText(fxRate, engine.currency)}: press Recalculate`);
      }
    }
    const held = (input.heldBack ?? []).filter((h) => sameCountry(h.country, country));
    if (held.length) {
      const names = held.map((h) => h.name);
      blocking.push(
        `${names.slice(0, 5).join(', ')}${names.length > 5 ? ` and ${names.length - 5} more` : ''} ${held[0].reason}. Pay ${country} in ${engine.currency} this month, or settle that work outside the USD run.`
      );
    }
    if (input.runStarted && slips.length === 0 && (g?.employees.length ?? 0) > 0 && !reason) blocking.push('Not worked out yet: press Recalculate');
    // a new rate (platform or the company's own) starts on or before this month since its draft was worked out: held
    // back, not just warned, so no one approves payslips on rates that are no longer the law (the database refuses too)
    if (run?.status === 'draft' && (input.ratesChanged ?? []).some((c) => sameCountry(c, country))) blocking.push(RATES_CHANGED);
    // a draft payslip saved before its employee moved to another country's branch
    const moved = slips.filter((p) => {
      const now = countryOfEmployee.get(text(p.employee_id));
      return now !== undefined && !sameCountry(now, country);
    });
    if (moved.length) {
      blocking.push(`${moved.length} ${moved.length === 1 ? 'person has' : 'people have'} moved to a branch in another country since this was worked out: press Recalculate`);
    }
    // a payslip in another currency than the country's
    const wrongCurrency = slips.filter((p) => currencyOf(p) !== currency);
    if (wrongCurrency.length) blocking.push(`${wrongCurrency.length} payslip${wrongCurrency.length === 1 ? ' is' : 's are'} not in ${currency}: press Recalculate`);

    const people = new Set(problems.map((p) => p.employeeNumber)).size;
    if (people) warnings.push(`${people} ${people === 1 ? 'person is' : 'people are'} missing a tax number, statutory number or payment details`);
    const below = input.belowMinimum?.get(country) ?? 0;
    if (below) warnings.push(`${below} ${below === 1 ? 'person is' : 'people are'} paid below the minimum wage`);
    if (slips.length === 0 && blocking.length === 0) blocking.push('No payslips');
    return { ...base, state: blocking.length ? ('blocked' as const) : ('ready' as const), blocking, warnings };
  });
}

/** "Kenya 42 payslips KSh 3.1M ✓ · Tanzania 12 waiting for rules" */
export function approvalSummary(readiness: CountryReadiness[]): string {
  return readiness
    .filter((r) => r.employees > 0 || r.payslips > 0)
    .map((r) => {
      switch (r.state) {
        case 'ready':
          return `${r.country} ${r.payslips} ${r.payslips === 1 ? 'payslip' : 'payslips'} ${moneyShort(r.totals.net, r.currency)} ✓`;
        case 'approved':
          return `${r.country} approved`;
        case 'paid':
          return `${r.country} paid`;
        case 'waiting':
          return `${r.country} ${r.employees} waiting for rules`;
        default:
          return `${r.country} held back`;
      }
    })
    .join(' · ');
}

/** The countries one "Approve" approves: every one that is ready. */
export const countriesToApprove = (readiness: CountryReadiness[]) => readiness.filter((r) => r.state === 'ready').map((r) => r.country);

// ---------------------------------------------------------------------------------------------
// files: returns per country, payment files per currency
// ---------------------------------------------------------------------------------------------
export interface CountryFile {
  key: string;
  label: string;
  name: string;
  what: string;
  authority?: string;
  file: ExportFile;
}

export interface CountryFiles {
  country: string;
  currency: string;
  status: CountryRunStatus;
  payslips: PayslipRecord[];
  /** the same payslips as the tax and social security bodies see them: in local currency (a USD payslip's local figures) */
  statutoryPayslips: PayslipRecord[];
  /** the country's statutory returns (engine.returns()), only for its own staff, always in local currency */
  returns: CountryFile[];
  /** bank and mobile money files in the currency the country is paid in (the Equity file stays KES; USD: by bank) */
  payments: CountryFile[];
}

/** Bank and mobile money files for one currency's payslips: M-Pesa, bank and Equity for KES; bank and mobile money for TZS and UGX; the bank file for others. */
export function paymentFilesFor(currency: string, payslips: PayslipRecord[], employees: EmployeeRecord[], payPeriod: string, debitAccount: string): CountryFile[] {
  const own = payslips.filter((p) => currencyOf(p) === currency);
  const code = currency.toLowerCase();
  if (currency === USD) {
    // paid in USD (FIG-906): one bank file of USD net pay, apart from the local currency files
    return [{ key: 'bank-usd', label: 'Bank bulk pay (USD)', name: 'bulk-pay-bank-usd', what: 'staff paid in USD, by bank', file: usdBankFile(own, employees, payPeriod) }];
  }
  if (currency !== 'KES') {
    const bank = { key: `bank-${code}`, label: 'Bank bulk pay', name: `bulk-pay-bank-${code}`, what: `staff paid by bank, in ${currency}`, file: bankFile(own, employees, payPeriod) };
    // mobile money outside Kenya comes with each country's payroll: M-Pesa, Tigo Pesa and Airtel Money in Tanzania
    // (numbers as 255...), MTN MoMo and Airtel Money in Uganda (256...)
    if (currency === 'TZS') {
      return [bank, { key: 'mobile-tzs', label: 'Mobile money bulk pay', name: 'bulk-pay-mobile-tzs', what: 'staff paid by M-Pesa, Tigo Pesa or Airtel Money, in TZS', file: tanzaniaMobileMoneyFile(own, employees, payPeriod) }];
    }
    if (currency === 'UGX') {
      return [bank, { key: 'mobile-ugx', label: 'Mobile money bulk pay', name: 'bulk-pay-mobile-ugx', what: 'staff paid by MTN MoMo or Airtel Money, in UGX', file: ugandaMobileMoneyFile(own, employees, payPeriod) }];
    }
    return [bank];
  }
  return [
    { key: 'mpesa', label: 'M-Pesa bulk pay', name: 'bulk-pay-mpesa', what: 'staff paid by M-Pesa', file: mpesaFile(own, employees, payPeriod) },
    { key: 'bank', label: 'Bank bulk pay', name: 'bulk-pay-bank', what: 'staff paid by bank', file: bankFile(own, employees, payPeriod) },
    { key: 'equity', label: 'Equity Bank (Eazzy Biz)', name: 'equity-eazzy-biz', what: 'everyone paid by bank or M-Pesa, from the company’s Equity account', file: equityFile(own, employees, debitAccount) },
  ];
}

/**
 * The Files tab, per country: each approved (or paid) country's returns, built from its own staff's payslips only (the
 * P10 never lists someone paid in Tanzania), and its payment files in its currency.
 */
export function filesByCountry(args: {
  payslips: PayslipRecord[];
  employees: EmployeeRecord[];
  runCountries: RunCountry[];
  ratesByCountry: Map<string, Rates>;
  payPeriod: string;
  debitAccount: string;
  /**
   * a draft country's returns too, to check before approving (marked draft; never its payment files: nobody is paid
   * from a draft)
   */
  drafts?: boolean;
}): CountryFiles[] {
  const out: CountryFiles[] = [];
  for (const rc of [...args.runCountries].sort((a, b) => countryOrder(tidyCountry(a.country), tidyCountry(b.country)))) {
    const draft = rc.status !== 'approved' && rc.status !== 'paid';
    if (draft && !args.drafts) continue;
    const country = tidyCountry(rc.country);
    const engine = engineFor(country);
    const slips = args.payslips.filter((p) => sameCountry(payslipCountry(p), country));
    // the currencies its payslips are in (one per month; USD for a country paid in USD), each with its payment files
    const currencies = [...new Set(slips.map((p) => currencyOf(p)))];
    const currency = currencies.length === 1 ? currencies[0] : engine?.currency ?? currencyOf(slips[0]);
    const rates = args.ratesByCountry.get(country) ?? {};
    // returns are filed in local currency: a USD payslip's local statutory figures (FIG-906)
    const statutory = slips.map((p) => localPayslip(p));
    out.push({
      country,
      currency,
      status: rc.status,
      payslips: slips,
      statutoryPayslips: statutory,
      returns: (engine?.returns() ?? [])
        .map((r) => ({ def: r, file: r.build(statutory, args.employees, { payPeriod: args.payPeriod, rates }) }))
        // an optional return (the WHT return) only in a month it has rows
        .filter(({ def, file }) => !def.optional || file.rows.length > 0)
        .map(({ def, file }) => ({ key: def.key, label: def.label, name: def.name, what: def.what, authority: def.authority, file })),
      payments: draft ? [] : (currencies.length ? currencies : [currency]).flatMap((c) => paymentFilesFor(c, slips, args.employees, args.payPeriod, args.debitAccount)),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// guards
// ---------------------------------------------------------------------------------------------
/**
 * A payslip whose currency is not the one its country is paid in (blocked before saving, and by the database): the
 * country's own currency, or USD when the company pays the country in USD (FIG-906).
 */
export function currencyMismatch(
  record: { country?: unknown; currency?: unknown; employee_name?: unknown; employee_id?: unknown },
  payCurrencies?: PayCurrencies | null
): string | null {
  const country = payslipCountry(record);
  const engine = engineFor(country);
  if (!engine) return `${country} payroll isn't supported yet`;
  const expected = payCurrencyOf(country, payCurrencies, engine.currency);
  return currencyOf(record) === expected ? null : `${text(record.employee_name) || text(record.employee_id)}: ${country} payslips are in ${expected}, not ${currencyOf(record)}`;
}

/** Splits the month's payslips into what can still be saved (countries not yet approved) and what is locked. */
export function savableRecords<T extends { country?: unknown }>(records: T[], runCountries: RunCountry[]) {
  const locked = new Set(runCountries.filter((c) => c.status !== 'draft').map((c) => tidyCountry(c.country)));
  return {
    save: records.filter((r) => !locked.has(payslipCountry(r))),
    lockedCountries: [...locked],
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
