import { parseDay } from './contract';

// What the HR AI assistant is told about employees. It gets the records the signed-in person could load themselves
// (the employees query runs with their session, so the database's access rules decide which rows and fields come
// back), as a compact table, plus the date-based facts worked out here, because models are unreliable at date maths.

type Employee = Record<string, unknown>;

// columns that say nothing about the person (internal ids, links to pictures)
const NOISE_COLUMNS = new Set(['id', 'tenant_id', 'created_at', 'ProfileImage']);

// used when the full table is too large to send
const CORE_COLUMNS = [
  'Employee Number', 'First Name', 'Last Name', 'Job Title', 'Office', 'Branch', 'Town', 'Gender', 'Employee Type',
  'Status', 'Start Date', 'Date of Birth', 'Contract End Date', 'Probation End Date', 'Manager', 'Basic Salary',
];

/** Characters of employee table to send; the server accepts 200,000 characters of context in all. */
export const TABLE_BUDGET = 150_000;

const cell = (value: unknown) =>
  value === null || value === undefined ? '' : String(value).replace(/[\s|]+/g, ' ').trim();

const hasValue = (value: unknown) => cell(value) !== '';

/** A date stored as text: YYYY-MM-DD (the app's format), or day/month/year as typed in older records. */
export function parseAnyDay(value: unknown): Date | null {
  const text = cell(value);
  if (!text) return null;
  const iso = parseDay(text);
  if (iso) return iso;
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (dmy) {
    const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const fullName = (e: Employee) => [e['First Name'], e['Last Name']].map(cell).filter(Boolean).join(' ') || cell(e['Employee Number']);

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (from: Date, to: Date) => Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);
const dayMonth = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
const fullDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/** The next time a yearly date (birthday, work anniversary) comes round, on or after today. 29 February → 28th. */
function nextYearly(date: Date, today: Date): Date {
  const at = (year: number) => {
    const d = new Date(year, date.getMonth(), date.getDate());
    return d.getMonth() === date.getMonth() ? d : new Date(year, date.getMonth() + 1, 0);
  };
  const thisYear = at(today.getFullYear());
  return thisYear >= startOfDay(today) ? thisYear : at(today.getFullYear() + 1);
}

/** Birthdays, work anniversaries, and contracts and probation periods ending, within `days` of today. */
export function upcomingDates(employees: Employee[], today: Date, days = 30): string {
  const lines: { inDays: number; text: string }[] = [];
  const when = (n: number) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

  for (const e of employees) {
    const name = fullName(e);
    const birth = parseAnyDay(e['Date of Birth']);
    if (birth) {
      const next = nextYearly(birth, today);
      const n = daysBetween(today, next);
      if (n <= days) lines.push({ inDays: n, text: `${name}: birthday ${when(n)} (${dayMonth(next)}), turning ${next.getFullYear() - birth.getFullYear()}` });
    }
    const start = parseAnyDay(e['Start Date']);
    if (start && start < startOfDay(today)) {
      const next = nextYearly(start, today);
      const years = next.getFullYear() - start.getFullYear();
      const n = daysBetween(today, next);
      if (years > 0 && n <= days) lines.push({ inDays: n, text: `${name}: ${years}-year work anniversary ${when(n)} (${dayMonth(next)})` });
    }
    for (const [column, label] of [['Contract End Date', 'contract ends'], ['Probation End Date', 'probation ends']] as const) {
      const end = parseAnyDay(e[column]);
      if (!end) continue;
      const n = daysBetween(today, end);
      if (n >= 0 && n <= days) lines.push({ inDays: n, text: `${name}: ${label} ${when(n)} (${fullDate(end)})` });
    }
  }

  if (lines.length === 0) return `None in the next ${days} days.`;
  return lines.sort((a, b) => a.inDays - b.inDays).map((l) => `- ${l.text}`).join('\n');
}

function table(employees: Employee[], columns: string[]): string {
  return [columns.join(' | '), ...employees.map((e) => columns.map((c) => cell(e[c])).join(' | '))].join('\n');
}

/**
 * The employee records as a table (" | " between fields), leaving out columns that are empty for everyone. If it is
 * too large, falls back to the core columns, then to as many rows as fit, and says what was left out.
 */
export function employeeTable(employees: Employee[], budget = TABLE_BUDGET): string {
  if (employees.length === 0) return 'No employee records.';
  const present = [...new Set(employees.flatMap((e) => Object.keys(e)))].filter(
    (c) => !NOISE_COLUMNS.has(c) && employees.some((e) => hasValue(e[c]))
  );

  const full = table(employees, present);
  if (full.length <= budget) return full;

  const core = CORE_COLUMNS.filter((c) => present.includes(c));
  const coreTable = table(employees, core);
  const left = present.filter((c) => !core.includes(c));
  if (coreTable.length <= budget) return `${coreTable}\n(Too many records to send every field; left out: ${left.join(', ')}.)`;

  const rows = coreTable.split('\n');
  let size = rows[0].length;
  let kept = 1;
  while (kept < rows.length && size + rows[kept].length + 1 <= budget) size += rows[kept++].length + 1;
  return `${rows.slice(0, kept).join('\n')}\n(Only the first ${kept - 1} of ${employees.length} records fit; left out: ${left.join(', ')}.)`;
}
