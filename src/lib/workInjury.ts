import { rulesFor, type CompensationRule, type DeadlineRule, type WorkInjuryRuleSet } from './workInjuryRules';

/**
 * Work injury cases (WIBA; 20261022800000_work_injury_cases.sql): the legal deadlines of a case and the compensation
 * estimate, worked out from the dated rules in workInjuryRules.ts. Pure functions: no database, no payroll.
 */

export type WorkInjuryStatus = 'reported' | 'notified' | 'claim_lodged' | 'assessed' | 'paid' | 'closed';
export type WorkInjuryKind = 'accident' | 'occupational_disease';

export const STATUS_STEPS: { value: WorkInjuryStatus; label: string }[] = [
  { value: 'reported', label: 'Reported' },
  { value: 'notified', label: 'Notified to authority' },
  { value: 'claim_lodged', label: 'Claim with insurer' },
  { value: 'assessed', label: 'Assessed' },
  { value: 'paid', label: 'Paid' },
  { value: 'closed', label: 'Closed' },
];

export const statusLabel = (status: string) => STATUS_STEPS.find((s) => s.value === status)?.label ?? status;

export interface WorkInjuryCase {
  id: string;
  incident_report_id: string | null;
  employee_number: string;
  employee_name: string | null;
  country: string | null;
  currency: string | null;
  kind: WorkInjuryKind;
  is_fatal: boolean;
  occurred_at: string;
  employer_notified_on: string | null;
  place: string | null;
  what_happened: string | null;
  injury_nature: string | null;
  body_parts: string | null;
  witnesses: string | null;
  first_aid: string | null;
  hospital: string | null;
  doctor: string | null;
  on_duty: boolean;
  stopped_work_on: string | null;
  returned_to_work_on: string | null;
  days_off: number | null;
  incapacity_percent: number | null;
  monthly_earnings: number | null;
  medical_costs: number | null;
  status: WorkInjuryStatus;
  authority_notified_on: string | null;
  authority_reference: string | null;
  claim_lodged_on: string | null;
  insurer_claim_number: string | null;
  assessed_on: string | null;
  assessed_amount: number | null;
  paid_on: string | null;
  paid_amount: number | null;
  closed_on: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------------------------
// dates (YYYY-MM-DD keys, counted in whole calendar days)
// ---------------------------------------------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, '0');

/** The local calendar day of a moment. */
export const dayKeyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const keyToUtc = (key: string) => {
  const [y, m, d] = key.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

export const addDaysToKey = (key: string, days: number) => {
  const t = new Date(keyToUtc(key) + days * 86400000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};

/** Whole days from a to b (b later: positive). */
export const daysBetween = (a: string, b: string) => Math.round((keyToUtc(b) - keyToUtc(a)) / 86400000);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "27 Oct", or "27 Oct 2027" when not this year's. */
export const shortDate = (key: string, today?: string) => {
  const [y, m, d] = key.slice(0, 10).split('-').map(Number);
  const base = `${d} ${MONTHS[m - 1]}`;
  return today && today.slice(0, 4) === String(y) ? base : `${base} ${y}`;
};

/** Whole days off work between stopping and returning (or today, while still off); null when not stopped. */
export function daysOffWork(stoppedOn: string | null, returnedOn: string | null, today: string): number | null {
  if (!stoppedOn) return null;
  const end = returnedOn || today;
  return Math.max(0, daysBetween(stoppedOn, end));
}

// ---------------------------------------------------------------------------------------------
// deadlines
// ---------------------------------------------------------------------------------------------
export type DeadlineState = 'done' | 'overdue' | 'soon' | 'due';

export interface CaseDeadline {
  rule: DeadlineRule;
  /** the last day (YYYY-MM-DD) */
  dueDay: string;
  /** for deadlines counted in hours: the moment */
  dueAt: Date | null;
  state: DeadlineState;
  /** days left (negative: overdue); for hour deadlines, hours */
  left: number;
  unit: 'days' | 'hours';
  /** "Report to DOSH by 27 Oct — 5 days left" */
  message: string;
}

type DeadlineCase = Pick<WorkInjuryCase, 'country' | 'occurred_at' | 'employer_notified_on' | 'is_fatal' | 'authority_notified_on' | 'claim_lodged_on'>;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const verbFor = (rule: DeadlineRule) => (rule.doneWhen === 'claim_lodged_on' ? 'Lodge the claim' : `Report to ${rule.authority}`);

/** The deadlines that apply to a case (fatal or not), soonest first, with how long is left on `now`. */
export function caseDeadlines(c: DeadlineCase, now: Date, rules?: WorkInjuryRuleSet): CaseDeadline[] {
  const occurred = new Date(c.occurred_at);
  const accidentDay = dayKeyOf(occurred);
  const set = rules ?? rulesFor(c.country, accidentDay);
  const today = dayKeyOf(now);
  return set.deadlines
    .filter((r) => (r.fatalOnly ? c.is_fatal : true) && (r.nonFatalOnly ? !c.is_fatal : true))
    .map((rule): CaseDeadline => {
      const doneOn = c[rule.doneWhen];
      const verb = verbFor(rule);
      if (rule.hours) {
        const dueAt = new Date(occurred.getTime() + rule.hours * 3600000);
        const left = Math.floor((dueAt.getTime() - now.getTime()) / 3600000);
        const time = `${pad(dueAt.getHours())}:${pad(dueAt.getMinutes())}`;
        const by = `${verb} by ${shortDate(dayKeyOf(dueAt), today)}, ${time}`;
        if (doneOn) return { rule, dueDay: dayKeyOf(dueAt), dueAt, state: 'done', left, unit: 'hours', message: `${verb}: done on ${shortDate(doneOn, today)}` };
        const late = now.getTime() > dueAt.getTime();
        return {
          rule, dueDay: dayKeyOf(dueAt), dueAt, unit: 'hours', left,
          state: late ? 'overdue' : 'soon',
          message: late ? `${by} — overdue` : `${by} — ${plural(Math.max(0, left), 'hour')} left`,
        };
      }
      const base = rule.from === 'accident' ? accidentDay : (c.employer_notified_on || accidentDay);
      const dueDay = addDaysToKey(base, rule.days ?? 0);
      const left = daysBetween(today, dueDay);
      const by = `${verb} by ${shortDate(dueDay, today)}`;
      if (doneOn) return { rule, dueDay, dueAt: null, state: 'done', left, unit: 'days', message: `${verb}: done on ${shortDate(doneOn, today)}` };
      const state: DeadlineState = left < 0 ? 'overdue' : left <= 2 ? 'soon' : 'due';
      const message =
        left < 0 ? `${by} — ${plural(-left, 'day')} overdue`
          : left === 0 ? `${by} — today is the last day`
            : `${by} — ${plural(left, 'day')} left`;
      return { rule, dueDay, dueAt: null, state, left, unit: 'days', message };
    })
    .sort((a, b) => a.dueDay.localeCompare(b.dueDay));
}

/** The first deadline still open (overdue or not), for the list. */
export const nextDeadline = (deadlines: CaseDeadline[]) => deadlines.find((d) => d.state !== 'done') ?? null;

// ---------------------------------------------------------------------------------------------
// compensation estimate
// ---------------------------------------------------------------------------------------------
export interface EstimateInput {
  monthlyEarnings: number | null | undefined;
  daysOff: number | null | undefined;
  incapacityPercent: number | null | undefined;
  isFatal: boolean;
  medicalCosts?: number | null;
}

export interface EstimateLine {
  code: 'temporary' | 'permanent' | 'death' | 'medical';
  label: string;
  /** how it was worked out, in words */
  working: string;
  amount: number;
  citation: string;
}

export interface Estimate {
  lines: EstimateLine[];
  total: number;
  caveats: string[];
  /** why there is no estimate */
  missing: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString('en-KE', { maximumFractionDigits: 2 });

/**
 * An estimate of the compensation under the Act's formulas. Never posted to payroll: the Director (or the Fund) makes
 * the assessment, and the insurer pays.
 *   temporary   monthly earnings x 12 / 365 a day, for the days off work (up to the Act's limit), x the share paid
 *   permanent   monthly earnings x 96 (Kenya) x the % of incapacity
 *   death       monthly earnings x 96 (Kenya), instead of the above
 *   medical     the medical costs entered
 */
export function estimateCompensation(input: EstimateInput, rule: CompensationRule | null): Estimate {
  if (!rule) return { lines: [], total: 0, caveats: [], missing: 'We don’t estimate compensation for this country: the authority works it out.' };
  const monthly = Number(input.monthlyEarnings) || 0;
  if (monthly <= 0) return { lines: [], total: 0, caveats: rule.caveats, missing: 'Enter the employee’s monthly earnings to see an estimate.' };

  const lines: EstimateLine[] = [];
  const daily = (monthly * 12) / 365;
  const maxDays = Math.round((rule.temporaryMaxMonths * 365) / 12);
  const days = Math.max(0, Math.floor(Number(input.daysOff) || 0));
  if (days > 0) {
    const paidDays = Math.min(days, maxDays);
    const share = rule.temporaryShare === 1 ? '' : ` x ${Math.round(rule.temporaryShare * 100)}%`;
    lines.push({
      code: 'temporary',
      label: 'Temporary incapacity (time off work)',
      working: `${fmt(round2(daily))} a day (${fmt(monthly)} x 12 / 365) x ${paidDays} day${paidDays === 1 ? '' : 's'}${share}`
        + (days > maxDays ? ` (capped at ${rule.temporaryMaxMonths} months)` : ''),
      amount: round2(daily * paidDays * rule.temporaryShare),
      citation: rule.citations.temporary,
    });
  }
  if (input.isFatal) {
    lines.push({
      code: 'death',
      label: 'Death benefit to dependants',
      working: `${fmt(monthly)} x ${rule.deathMonths} months`,
      amount: round2(monthly * rule.deathMonths),
      citation: rule.citations.death,
    });
  } else {
    const pct = Math.min(100, Math.max(0, Number(input.incapacityPercent) || 0));
    if (pct > 0) {
      lines.push({
        code: 'permanent',
        label: 'Permanent incapacity (lump sum)',
        working: `${fmt(monthly)} x ${rule.permanentMonths} months x ${fmt(pct)}%`,
        amount: round2((monthly * rule.permanentMonths * pct) / 100),
        citation: rule.citations.permanent,
      });
    }
  }
  const medical = Math.max(0, Number(input.medicalCosts) || 0);
  if (medical > 0) {
    lines.push({ code: 'medical', label: 'Medical expenses', working: 'as entered', amount: round2(medical), citation: rule.citations.medical });
  }
  const total = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  return {
    lines,
    total,
    caveats: rule.caveats,
    missing: lines.length ? null : 'Enter the days off work, the % of incapacity or the medical costs to see an estimate.',
  };
}

// ---------------------------------------------------------------------------------------------
// the company's cover
// ---------------------------------------------------------------------------------------------
export interface WibaCover {
  insurer_name: string | null;
  policy_number: string | null;
  cover_start: string | null;
  cover_expiry: string | null;
  dosh_registration_no: string | null;
  notes: string | null;
}

export type CoverState = 'missing' | 'expired' | 'expiring' | 'ok';

/** Is the company's work injury cover in place on `today`? Expiring: 30 days or fewer left. */
export function coverState(cover: WibaCover | null | undefined, today: string): { state: CoverState; message: string } {
  if (!cover || !cover.insurer_name || !cover.policy_number) {
    return { state: 'missing', message: 'No work injury (WIBA) insurance recorded. Every employer must insure its employees (WIBA s.7).' };
  }
  if (!cover.cover_expiry) return { state: 'ok', message: `Insured with ${cover.insurer_name}, policy ${cover.policy_number}` };
  const left = daysBetween(today, cover.cover_expiry);
  if (left < 0) {
    return { state: 'expired', message: `The work injury (WIBA) cover with ${cover.insurer_name} expired on ${shortDate(cover.cover_expiry)}. Renew it.` };
  }
  if (left <= 30) {
    return { state: 'expiring', message: `The work injury (WIBA) cover with ${cover.insurer_name} ends on ${shortDate(cover.cover_expiry)} — ${plural(left, 'day')} left.` };
  }
  return { state: 'ok', message: `Insured with ${cover.insurer_name}, policy ${cover.policy_number}, until ${shortDate(cover.cover_expiry)}` };
}

/** Is it an incident a work injury case can be opened from? */
export const isInjuryIncident = (type: string | null | undefined) => type === 'workplace_injury' || type === 'occupational_disease';
