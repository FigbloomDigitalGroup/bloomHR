export interface ContractRecord {
  'Employee Type'?: string | null;
  'Job Title'?: string | null;
  'Job Group'?: string | null;
  Manager?: string | null;
  'Start Date'?: string | null;
  'Contract Start Date'?: string | null;
  'Contract End Date'?: string | null;
}

export type ContractState = 'no-end' | 'active' | 'ending-soon' | 'expired' | 'not-started';

export interface ContractSummary {
  state: ContractState;
  /** Whole days until the contract ends (negative once it has), when it has an end date. */
  daysLeft: number | null;
  headline: string;
}

const SOON_DAYS = 60;

/** A stored date (YYYY-MM-DD, possibly with a time) as a local calendar day, so the time zone cannot shift it. */
export function parseDay(value: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((value ?? '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

const wholeDays = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 86_400_000);

/** Where the person's contract stands today, in words they can read. */
export function summarizeContract(record: ContractRecord, today: Date = new Date()): ContractSummary {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = parseDay(record['Contract Start Date']) ?? parseDay(record['Start Date']);
  const end = parseDay(record['Contract End Date']);

  if (start && start > day) return { state: 'not-started', daysLeft: end ? wholeDays(day, end) : null, headline: 'Starts on ' + formatDay(start) };
  if (!end) return { state: 'no-end', daysLeft: null, headline: 'No end date on record' };

  const daysLeft = wholeDays(day, end);
  if (daysLeft < 0) return { state: 'expired', daysLeft, headline: `Ended on ${formatDay(end)}` };
  if (daysLeft === 0) return { state: 'ending-soon', daysLeft, headline: 'Ends today' };
  const plural = daysLeft === 1 ? 'day' : 'days';
  return {
    state: daysLeft <= SOON_DAYS ? 'ending-soon' : 'active',
    daysLeft,
    headline: `Ends in ${daysLeft} ${plural} (${formatDay(end)})`,
  };
}

export function formatDay(date: Date | null): string {
  return date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}
