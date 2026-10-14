import { parseDay } from './contract';

// What the HR AI assistant is told about employees. It gets the records the signed-in person could load themselves
// (the employees query runs with their session, so the database's access rules decide which rows and fields come
// back), as a compact table, plus the date-based facts worked out here, because models are unreliable at date maths.
// A company of thousands does not fit in what the server accepts, so the totals (headcount, counts per department,
// branch, ...) are worked out here over every record and sent whole, and the table holds as many rows as fit (FIG-820).

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

/** Characters of context employeeContext() builds: the server's 200,000 less room for the answer guidelines. */
export const CONTEXT_BUDGET = 190_000;

/** Characters of the "coming up" list; the counts in the totals cover everyone either way. */
const UPCOMING_BUDGET = 25_000;

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
// one formatter each, made once: toLocaleDateString builds a new one per call, which is slow over thousands of records
const dayMonthFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' });
const fullDateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const dayMonth = (d: Date) => dayMonthFormat.format(d);
const fullDate = (d: Date) => fullDateFormat.format(d);

/** The next time a yearly date (birthday, work anniversary) comes round, on or after today. 29 February → 28th. */
function nextYearly(date: Date, today: Date): Date {
  const at = (year: number) => {
    const d = new Date(year, date.getMonth(), date.getDate());
    return d.getMonth() === date.getMonth() ? d : new Date(year, date.getMonth() + 1, 0);
  };
  const thisYear = at(today.getFullYear());
  return thisYear >= startOfDay(today) ? thisYear : at(today.getFullYear() + 1);
}

type EventKind = 'birthday' | 'anniversary' | 'contract' | 'probation';
interface UpcomingEvent { kind: EventKind; inDays: number; text: string }

/** Birthdays, work anniversaries, and contracts and probation periods ending within `days` of today, soonest first. */
function upcomingEvents(employees: Employee[], today: Date, days: number): UpcomingEvent[] {
  const events: UpcomingEvent[] = [];
  const when = (n: number) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

  for (const e of employees) {
    const name = fullName(e);
    const birth = parseAnyDay(e['Date of Birth']);
    if (birth) {
      const next = nextYearly(birth, today);
      const n = daysBetween(today, next);
      if (n <= days) events.push({ kind: 'birthday', inDays: n, text: `${name}: birthday ${when(n)} (${dayMonth(next)}), turning ${next.getFullYear() - birth.getFullYear()}` });
    }
    const start = parseAnyDay(e['Start Date']);
    if (start && start < startOfDay(today)) {
      const next = nextYearly(start, today);
      const years = next.getFullYear() - start.getFullYear();
      const n = daysBetween(today, next);
      if (years > 0 && n <= days) events.push({ kind: 'anniversary', inDays: n, text: `${name}: ${years}-year work anniversary ${when(n)} (${dayMonth(next)})` });
    }
    for (const [column, kind, label] of [['Contract End Date', 'contract', 'contract ends'], ['Probation End Date', 'probation', 'probation ends']] as const) {
      const end = parseAnyDay(e[column]);
      if (!end) continue;
      const n = daysBetween(today, end);
      if (n >= 0 && n <= days) events.push({ kind, inDays: n, text: `${name}: ${label} ${when(n)} (${fullDate(end)})` });
    }
  }
  // stable sort: same-day events keep the order of the records
  return events.sort((a, b) => a.inDays - b.inDays);
}

/**
 * Birthdays, work anniversaries, and contracts and probation periods ending, within `days` of today, one per line.
 * With a large company the list can be longer than `budget` characters: then the soonest that fit are listed and the
 * last line says how many were left out (the counts in employeeTotals() cover all of them).
 */
export function upcomingDates(employees: Employee[], today: Date, days = 30, budget = Infinity): string {
  return listUpcoming(upcomingEvents(employees, today, days), days, budget);
}

function listUpcoming(events: UpcomingEvent[], days: number, budget: number): string {
  if (events.length === 0) return `None in the next ${days} days.`;
  const lines: string[] = [];
  let size = 0;
  for (const ev of events) {
    const line = `- ${ev.text}`;
    if (size + line.length + 1 > budget) break;
    lines.push(line);
    size += line.length + 1;
  }
  if (lines.length < events.length) lines.push(`(Only the soonest ${lines.length} of ${events.length} are listed; the totals above count all of them.)`);
  return lines.join('\n');
}

// the groupings the totals are given for, in this order
const GROUP_COLUMNS = ['Status', 'Department', 'Branch', 'Town', 'Office', 'Job Title', 'Employee Type', 'Gender'];

/** Values listed per grouping; the rest are summed into one "others" entry so a long tail of job titles stays short. */
const MAX_GROUP_VALUES = 60;

const amount = (value: unknown) => {
  const n = Number(cell(value).replace(/,/g, ''));
  return cell(value) !== '' && Number.isFinite(n) ? n : null;
};

/**
 * Totals worked out over every record given (headcount; how many per status, department, branch, town, office, job
 * title, employee type and gender; salary range; what is coming up in the next `days` days), so counts are right
 * even when the table sent with them holds only some of the rows. Groupings nobody has a value for are left out.
 */
export function employeeTotals(employees: Employee[], today: Date, days = 30): string {
  return totalsFor(employees, upcomingEvents(employees, today, days), days);
}

function totalsFor(employees: Employee[], events: UpcomingEvent[], days: number): string {
  const lines = [`- Headcount: ${employees.length}`];
  if (employees.length === 0) return lines[0];

  for (const column of GROUP_COLUMNS) {
    if (!employees.some((e) => column in e)) continue; // not a field this person can see
    const counts = new Map<string, number>();
    for (const e of employees) {
      const value = cell(e[column]) || 'not recorded';
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    if (counts.size === 1 && counts.has('not recorded')) continue;
    const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const shown = sorted.slice(0, MAX_GROUP_VALUES).map(([v, n]) => `${v}: ${n}`);
    const rest = sorted.slice(MAX_GROUP_VALUES);
    if (rest.length) shown.push(`${rest.length} others: ${rest.reduce((n, [, c]) => n + c, 0)}`);
    lines.push(`- By ${column} (${counts.size} values): ${shown.join(', ')}`);
  }

  const salaries = employees.map((e) => amount(e['Basic Salary'])).filter((n): n is number => n !== null && n > 0);
  if (salaries.length) {
    const min = salaries.reduce((a, b) => Math.min(a, b));
    const max = salaries.reduce((a, b) => Math.max(a, b));
    const avg = salaries.reduce((a, b) => a + b, 0) / salaries.length;
    const kes = (n: number) => `KES ${Math.round(n).toLocaleString('en-GB')}`;
    lines.push(`- Basic salary (${salaries.length} recorded): lowest ${kes(min)}, highest ${kes(max)}, average ${kes(avg)}`);
  }

  const count = (kind: EventKind) => events.filter((ev) => ev.kind === kind).length;
  lines.push(
    `- In the next ${days} days: ${count('birthday')} birthdays, ${count('anniversary')} work anniversaries, ` +
      `${count('contract')} contracts ending, ${count('probation')} probation periods ending`
  );
  return lines.join('\n');
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
  const leftOut = left.length ? `; left out: ${left.join(', ')}` : '';
  return `${rows.slice(0, kept).join('\n')}\n(Only the first ${kept - 1} of ${employees.length} records fit${leftOut}.)`;
}

const longDate = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const PARTIAL_RE = /\(Only the first \d+ of \d+ records fit/;

/**
 * Everything the assistant is told about the employees: today's date, the totals over every record, what is coming up,
 * and the records themselves as a table, all within `budget` characters. `scope` says which records these are (e.g.
 * "across all towns"). When the table cannot hold every record it says so, and the model is told to take counts from
 * the totals, which are always complete.
 */
export function employeeContext(employees: Employee[], today: Date, scope: string, budget = CONTEXT_BUDGET): string {
  const events = upcomingEvents(employees, today, 30); // worked out once for both the counts and the list
  const head = [
    `TODAY: ${longDate(today)}`,
    '',
    `SCOPE: ${employees.length} employee records ${scope}. These are all the records the person asking may see.`,
    '',
    `TOTALS (worked out over all ${employees.length} records; always use these for counts and shares, never count table rows):`,
    totalsFor(employees, events, 30),
    '',
    'COMING UP IN THE NEXT 30 DAYS (worked out from the records; use these rather than calculating dates yourself):',
    listUpcoming(events, 30, UPCOMING_BUDGET),
    '',
  ].join('\n');

  const heading = (partial: boolean) =>
    partial
      ? `EMPLOYEE RECORDS - PARTIAL: not every record fits, so this table holds only some of the ${employees.length} people. ` +
        'Use the TOTALS above for any count or share. When asked about someone who is not in the table, say their details ' +
        'were not included here rather than that they do not exist. (One per line, fields separated by " | ", first line ' +
        'is the column names; empty means not recorded.)'
      : 'EMPLOYEE RECORDS (every record; one per line, fields separated by " | ", first line is the column names; empty means not recorded):';

  const room = Math.max(0, budget - head.length - heading(true).length - 1);
  const rows = employeeTable(employees, Math.min(room, TABLE_BUDGET));
  return `${head}\n${heading(PARTIAL_RE.test(rows))}\n${rows}`;
}
