// ai_tools.js - what the HR assistant (ai_routes.js, purpose "hr-assistant") may look up and work out while it answers:
// the company's employees, their payslips, and a Kenyan "what if" run through the payroll engine's own calculation.
//
// Who gets them: only a caller with the Payroll module (ADMIN always), as payslips are. Everyone else gets no tools and
// is told the assistant cannot open individual pay records for them. The tools only read and calculate; none writes.
// TOOL_DEFINITIONS are in the Anthropic Messages API shape; runTool takes the tool_use block's input.
//
// The server reads with the service key, which bypasses row-level security, so every query here is pinned to the
// caller's own company (tenant_id) and to the module check above. Bank details never reach the model.

import { admin } from "./admin_routes.js";
import { callerHasModule } from "./authz.js";
import { statutoryFor } from "./generated/statutoryCalc.js";

export const TOOL_MODULES = ["payroll"];

export const MAX_EMPLOYEE_MATCHES = 10;
export const MAX_PAYSLIPS = 3;
const PAGE = 1000;
const MAX_EMPLOYEE_ROWS = 20_000;

// the payslip fields the assistant may see (salary_history); not the bank, account number or internal ids
const PAYSLIP_FIELDS = [
  "pay_period", "employee_id", "employee_name", "country", "currency",
  "basic_salary", "leave_deduction", "house_allowance", "transport_allowance", "medical_allowance", "other_allowances",
  "overtime_pay", "commission", "bonus", "per_diem", "reimbursements", "earning_items", "overtime_items", "leave_items",
  "gross_pay", "taxable_pay", "paye_tax", "tax_relief", "nssf_deduction", "nhif_deduction", "housing_levy",
  "lst_deduction", "loan_deduction", "advance_deduction", "welfare_deduction", "heslb_deduction", "other_deductions",
  "deduction_items", "total_deductions", "net_pay", "tax_details", "tax_resident",
  "employer_nssf", "nita_levy", "sdl_levy", "wcf_levy", "payment_method", "payslip_note",
];

// the employee fields find_employees returns: who they are and their employment, not ID numbers, contacts or pay
const EMPLOYEE_FIELDS = [
  "Employee Number", "First Name", "Middle Name", "Last Name", "Job Title", "Employee Type", "Branch", "Country",
  "Start Date", "Contract End Date", "Probation End Date", "Termination Date",
];

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const text = (v) => (v === null || v === undefined ? "" : String(v).trim());

/** The tool definitions, in the Anthropic Messages API's shape. */
export const TOOL_DEFINITIONS = [
  {
    name: "find_employees",
    description:
      "Find employees of this company by name or employee number. Returns up to 10 matches with their employee number, job, type (e.g. permanent, casual, contract), branch, country and dates. Use it to get the employee number before get_payslips.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Part of a name, or an employee number" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_payslips",
    description:
      "An employee's saved payslips, newest first (up to 3), or the one for a pay period: every earning, the statutory deductions, taxable pay, PAYE, voluntary deductions, net pay and the employer's costs. Use it to explain a payslip with the real figures.",
    input_schema: {
      type: "object",
      properties: {
        employee_number: { type: "string" },
        pay_period: { type: "string", description: "YYYY-MM; leave out for the latest" },
      },
      required: ["employee_number"],
      additionalProperties: false,
    },
  },
  {
    name: "calculate_kenya_pay",
    description:
      "Work out a Kenyan employee's NSSF, SHIF, housing levy, taxable pay, PAYE and net pay with Figbloom HR's payroll engine and the statutory rates in force for the month. Use it for any 'what if' (a raise, a new allowance, a pension or insurance deduction, a loan) and to check figures; do not work PAYE out yourself. To compare, run it for before and after.",
    input_schema: {
      type: "object",
      properties: {
        pay_period: { type: "string", description: "YYYY-MM; the rates in force at the end of that month. Leave out for this month." },
        gross_pay: { type: "number", description: "All cash pay for the month, including any per diem and non-taxed earnings" },
        per_diem: { type: "number", description: "The part of gross pay that is a non-taxed per diem (left out of tax, SHIF and the levy)" },
        non_taxable_earnings: { type: "number", description: "Other parts of gross pay that are not taxed but count for SHIF and the levy" },
        pensionable_pay: { type: "number", description: "The pay NSSF is worked out on, when not all cash pay" },
        benefits: {
          type: "object",
          description: "Monthly non-cash benefits",
          properties: {
            car: { type: "number" }, housing: { type: "number" }, meals: { type: "number" }, non_cash: { type: "number" }, other: { type: "number" },
          },
          additionalProperties: false,
        },
        pension: { type: "number", description: "Employee's monthly registered pension or provident fund contribution, for the tax deduction only" },
        post_retirement_medical_fund: { type: "number", description: "Monthly contribution, for the tax deduction only" },
        mortgage_interest: { type: "number", description: "Monthly interest on an owner-occupied home loan, for the tax deduction only" },
        insurance_premium: { type: "number", description: "Monthly life, education or health insurance premium, for insurance relief only" },
        is_pwd: { type: "boolean", description: "Has a disability exemption certificate" },
        voluntary_deductions: {
          type: "number",
          description:
            "Everything else payroll takes from pay, in total: loans, SACCO, HELB, welfare, and any pension or insurance premium it also collects from pay (the fields above only change the tax)",
        },
      },
      required: ["gross_pay"],
      additionalProperties: false,
    },
  },
];

/** Whether this caller may use the tools (the Payroll module; ADMIN always). */
export const callerMayUseTools = (caller) => callerHasModule(caller, TOOL_MODULES);

const thisMonth = () => new Date().toISOString().slice(0, 7);

/** The last day of a YYYY-MM month. */
export function lastDayOf(period) {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * The rates in force on a day in a country, as statutory_rates_on() gives them ({ code: value or bands }): the
 * company's own rate wins over the default.
 */
export async function ratesOn(tenantId, day, country = "Kenya") {
  const inForce = (r) =>
    String(r.country || "Kenya").toLowerCase() === country.toLowerCase() &&
    String(r.effective_from) <= day &&
    (!r.effective_to || String(r.effective_to) >= day);
  const columns = "country, code, value, bands, effective_from, effective_to";
  const [defaults, own] = await Promise.all([
    admin.from("statutory_rates").select(columns).is("tenant_id", null),
    admin.from("statutory_rates").select(columns).eq("tenant_id", tenantId),
  ]);
  if (defaults.error || own.error) throw new Error("could not read the statutory rates");
  const rates = {};
  for (const r of [...(defaults.data ?? []), ...(own.data ?? [])].filter(inForce)) {
    rates[r.code] = r.value !== null && r.value !== undefined ? Number(r.value) : r.bands;
  }
  return rates;
}

const nameOf = (e) => [e["First Name"], e["Middle Name"], e["Last Name"]].map(text).filter(Boolean).join(" ");

async function findEmployees(caller, { query }) {
  const q = text(query).toLowerCase();
  if (q.length < 2) return { error: "Give at least 2 letters of a name or an employee number." };
  const columns = EMPLOYEE_FIELDS.map((f) => `"${f}"`).join(", ");
  const matches = [];
  for (let from = 0; from < MAX_EMPLOYEE_ROWS && matches.length < MAX_EMPLOYEE_MATCHES; from += PAGE) {
    const { data, error } = await admin
      .from("employees")
      .select(columns)
      .eq("tenant_id", caller.tenantId)
      .order("Employee Number")
      .range(from, from + PAGE - 1);
    if (error) throw new Error("could not read employees");
    for (const e of data ?? []) {
      if (`${text(e["Employee Number"])} ${nameOf(e)}`.toLowerCase().includes(q)) matches.push(e);
    }
    if (!data || data.length < PAGE) break;
  }
  return {
    matches: matches.slice(0, MAX_EMPLOYEE_MATCHES).map((e) => ({
      employee_number: text(e["Employee Number"]),
      name: nameOf(e),
      job_title: text(e["Job Title"]) || null,
      employee_type: text(e["Employee Type"]) || null,
      branch: text(e["Branch"]) || null,
      country: text(e["Country"]) || null,
      start_date: text(e["Start Date"]) || null,
      probation_end_date: text(e["Probation End Date"]) || null,
      contract_end_date: text(e["Contract End Date"]) || null,
      termination_date: text(e["Termination Date"]) || null,
    })),
  };
}

async function getPayslips(caller, { employee_number, pay_period }) {
  const number = text(employee_number);
  if (!number) return { error: "Give the employee number (find_employees finds it)." };
  if (pay_period !== undefined && !PERIOD.test(text(pay_period))) return { error: "pay_period must be YYYY-MM." };
  let query = admin
    .from("salary_history")
    .select(PAYSLIP_FIELDS.join(", "))
    .eq("tenant_id", caller.tenantId)
    .eq("employee_id", number);
  if (pay_period) query = query.eq("pay_period", text(pay_period));
  const { data, error } = await query.order("pay_period", { ascending: false }).limit(MAX_PAYSLIPS);
  if (error) throw new Error("could not read payslips");
  if (!data?.length) return { payslips: [], note: `No saved payslip for ${number}${pay_period ? ` in ${pay_period}` : ""}.` };
  // only the listed fields, and only those with a value (a 0 is kept: "PAYE 0" is an answer)
  const payslips = data.map((p) =>
    Object.fromEntries(PAYSLIP_FIELDS.filter((f) => p[f] !== null && p[f] !== undefined && p[f] !== "").map((f) => [f, p[f]]))
  );
  // a Kenyan payslip does not save the employer's NSSF and housing levy shares: payroll works them out from the month's
  // rates (src/lib/payroll/countries/kenya.ts), so they are worked out here the same way, not shown as 0
  const ratesByPeriod = new Map();
  for (const slip of payslips) {
    if (String(slip.country || "Kenya").toLowerCase() !== "kenya" || !PERIOD.test(text(slip.pay_period))) continue;
    if (!ratesByPeriod.has(slip.pay_period)) ratesByPeriod.set(slip.pay_period, await ratesOn(caller.tenantId, lastDayOf(slip.pay_period)));
    const rates = ratesByPeriod.get(slip.pay_period);
    slip.employer_nssf = kenyaEmployerShare(num(slip.nssf_deduction), rates, "nssf_rate", "nssf_employer_rate");
    slip.employer_housing_levy = kenyaEmployerShare(num(slip.housing_levy), rates, "ahl_rate", "ahl_employer_rate");
  }
  return {
    payslips,
    labels: {
      nhif_deduction: "SHIF",
      heslb_deduction: "HELB",
      tax_relief: "personal and insurance relief",
      employer_nssf: "the employer's NSSF share, on top of pay (worked out from the month's rates for Kenya)",
      employer_housing_levy: "the employer's housing levy share, on top of pay (worked out from the month's rates)",
    },
  };
}

/**
 * The employer's share of a Kenyan contribution, from the employee's, as the payroll engine works it out (kenya.ts
 * kenyaPayslipResult): employee's share x employer rate / employee rate; the same as the employee's without the rates.
 */
export function kenyaEmployerShare(employee, rates, employeeRateCode, employerRateCode) {
  if (rates[employeeRateCode] === undefined || rates[employeeRateCode] === null) return employee;
  const r = num(rates[employeeRateCode]);
  const er = rates[employerRateCode] === undefined ? r : num(rates[employerRateCode]);
  return r > 0 ? round2((employee * er) / r) : 0;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

async function calculateKenyaPay(caller, args) {
  const period = args.pay_period === undefined ? thisMonth() : text(args.pay_period);
  if (!PERIOD.test(period)) return { error: "pay_period must be YYYY-MM." };
  const gross = num(args.gross_pay);
  if (!gross) return { error: "gross_pay must be more than 0." };
  const perDiem = Math.min(num(args.per_diem), gross);
  const nonTaxable = Math.min(num(args.non_taxable_earnings), gross - perDiem);
  const rates = await ratesOn(caller.tenantId, lastDayOf(period));
  if (!Array.isArray(rates.paye_bands)) return { error: `No Kenyan PAYE bands are set for ${period} (Settings > Statutory rates).` };

  const b = args.benefits ?? {};
  const result = statutoryFor(
    {
      cashPay: gross - perDiem - nonTaxable,
      nonTaxableCashPay: nonTaxable,
      ...(args.pensionable_pay === undefined ? {} : { pensionablePay: num(args.pensionable_pay) }),
      benefits: { car: num(b.car), housing: num(b.housing), meals: num(b.meals), nonCash: num(b.non_cash), other: num(b.other) },
      pension: num(args.pension),
      prmf: num(args.post_retirement_medical_fund),
      mortgageInterest: num(args.mortgage_interest),
      insurancePremium: num(args.insurance_premium),
      isPwd: args.is_pwd === true,
    },
    rates
  );
  const statutory = round2(result.nssf + result.shif + result.ahl + result.paye);
  const voluntary = num(args.voluntary_deductions);
  const totalDeductions = round2(statutory + voluntary);
  return {
    pay_period: period,
    gross_pay: gross,
    ...result,
    statutory_deductions: statutory,
    voluntary_deductions: voluntary,
    total_deductions: totalDeductions,
    net_pay: round2(gross - totalDeductions),
    // Employment Act 2007 s.19(3): deductions may not exceed two-thirds of the wages
    within_two_thirds_limit: totalDeductions <= round2((gross * 2) / 3),
    notes: [
      "Figures from Figbloom HR's payroll engine with the statutory rates in force at the end of the month (the company's own rates where set).",
      "pension, prmf and mortgageInterest above are the amounts allowed against tax (after any cap); taxBeforeReliefs less personalRelief and insuranceRelief is PAYE.",
    ],
  };
}

const RUNNERS = { find_employees: findEmployees, get_payslips: getPayslips, calculate_kenya_pay: calculateKenyaPay };

/** Runs one tool for the caller and returns its result as the JSON text the model reads. Never throws. */
export async function runTool(caller, name, rawArgs) {
  const run = RUNNERS[name];
  if (!run) return JSON.stringify({ error: `Unknown tool ${name}` });
  let args;
  try {
    args = typeof rawArgs === "string" ? JSON.parse(rawArgs || "{}") : rawArgs ?? {};
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("not an object");
  } catch {
    return JSON.stringify({ error: "The arguments were not valid JSON." });
  }
  try {
    return JSON.stringify(await run(caller, args));
  } catch (err) {
    console.error(`[ai] tool ${name} failed:`, err);
    return JSON.stringify({ error: "That lookup failed; answer without it and say the figures could not be read." });
  }
}
