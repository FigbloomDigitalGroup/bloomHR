/**
 * Overtime on the payslip (FIG-889). Pure: the database calls are in overtimeApi.
 *
 * The database (overtime_month) gives each employee's approved overtime hours in the month by kind of day, after the
 * company's monthly cap. Payroll adds them to gross pay, so PAYE, NSSF, SHIF and the housing levy include them:
 *
 *   hourly rate      the employee's own "Overtime Rate" when set, otherwise basic salary / the company's monthly
 *                    hours (225 by default: 45 hours a week), rounded to the cent
 *   a line           hours x hourly rate x the day's multiplier (1.5 on a working day, 2.0 on a rest day or a public
 *                    holiday by default), rounded to the cent
 *
 * Each kind of day is its own payslip line ("Overtime (normal days): 6 h"). A month in which the company has no
 * approved overtime at all still uses the old employees.overtime hours (x "Overtime Rate"), this release only.
 */

export type DayType = 'normal' | 'rest' | 'holiday';

export const DAY_TYPES: DayType[] = ['normal', 'rest', 'holiday'];

export const DAY_TYPE_LABEL: Record<DayType, string> = { normal: 'Working day', rest: 'Rest day', holiday: 'Public holiday' };

const LINE_NAME: Record<DayType, string> = {
  normal: 'Overtime (normal days)',
  rest: 'Overtime (rest days)',
  holiday: 'Overtime (public holidays)',
};

export interface OvertimeSettings {
  enabled: boolean;
  normalMultiplier: number;
  restMultiplier: number;
  holidayMultiplier: number;
  /** the hours in a month that basic salary pays for */
  monthlyHours: number;
  /** most hours paid in a month per employee; null for no cap */
  monthlyCap: number | null;
  excludedDepartments: string[];
  excludedJobGroups: string[];
}

/** Kenyan defaults: time and a half on a working day, double time on a rest day or public holiday, 45 h a week. */
export const DEFAULT_OVERTIME_SETTINGS: OvertimeSettings = {
  enabled: true,
  normalMultiplier: 1.5,
  restMultiplier: 2,
  holidayMultiplier: 2,
  monthlyHours: 225,
  monthlyCap: null,
  excludedDepartments: [],
  excludedJobGroups: [],
};

/** One approved entry behind the month's figures */
export interface OvertimeMonthEntry {
  id: string;
  work_date: string;
  day_type: DayType;
  hours: number;
  /** its hours paid after the cap */
  paid_hours: number;
}

/** One employee's approved overtime in a month (a row of overtime_month) */
export interface OvertimeMonthRow {
  employee_number: string;
  normal_hours: number | string;
  rest_hours: number | string;
  holiday_hours: number | string;
  over_cap_hours: number | string;
  entries: OvertimeMonthEntry[];
}

/** One payslip line (salary_history.overtime_items) */
export interface OvertimeItem {
  /** e.g. "Overtime (rest days)" (the payslip adds ": 4 h") */
  name: string;
  day_type: DayType;
  hours: number;
  hourly_rate: number;
  multiplier: number;
  amount: number;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const multiplierFor = (settings: OvertimeSettings, type: DayType) =>
  type === 'holiday' ? settings.holidayMultiplier : type === 'rest' ? settings.restMultiplier : settings.normalMultiplier;

/** An hour's pay before the multiplier, to the cent: the employee's own rate when set, else basic / monthly hours. */
export const overtimeHourlyRate = (basic: number, monthlyHours: number, ownRate?: unknown) => {
  const own = num(ownRate);
  if (own > 0) return round2(own);
  const hours = num(monthlyHours) > 0 ? num(monthlyHours) : DEFAULT_OVERTIME_SETTINGS.monthlyHours;
  return round2(Math.max(0, num(basic)) / hours);
};

/**
 * The month's cap, in date order: the first hours of the month are paid until the cap is reached (as the database
 * does). Returns each entry's paid hours and the hours over the cap.
 */
export function capEntries<T extends { work_date: string; hours: number | string }>(entries: T[], cap: number | null) {
  let left = cap == null ? Infinity : Math.max(0, num(cap));
  let over = 0;
  const paid = [...entries]
    .sort((a, b) => a.work_date.localeCompare(b.work_date))
    .map((e) => {
      const hours = num(e.hours);
      const p = Math.min(hours, left);
      left = round2(left - p);
      over = round2(over + hours - p);
      return { ...e, paid_hours: round2(p) };
    });
  return { entries: paid, overCap: over };
}

/** Hours by kind of day */
export const hoursByType = (entries: { day_type: DayType; paid_hours?: number; hours: number | string }[]) => {
  const out: Record<DayType, number> = { normal: 0, rest: 0, holiday: 0 };
  for (const e of entries) out[e.day_type] = round2(out[e.day_type] + num(e.paid_hours ?? e.hours));
  return out;
};

/** The overtime lines on one employee's payslip and their total. No row (or overtime off), no lines. */
export function overtimePayFor(row: OvertimeMonthRow | undefined, basic: number, ownRate: unknown, settings: OvertimeSettings) {
  const hourlyRate = overtimeHourlyRate(basic, settings.monthlyHours, ownRate);
  if (!row || !settings.enabled) return { items: [] as OvertimeItem[], total: 0, hours: 0, hourlyRate };
  const hours: Record<DayType, number> = { normal: num(row.normal_hours), rest: num(row.rest_hours), holiday: num(row.holiday_hours) };
  const items = DAY_TYPES.filter((t) => hours[t] > 0).map((t) => {
    const multiplier = multiplierFor(settings, t);
    return {
      name: LINE_NAME[t],
      day_type: t,
      hours: round2(hours[t]),
      hourly_rate: hourlyRate,
      multiplier,
      amount: round2(hours[t] * hourlyRate * multiplier),
    };
  });
  return {
    items,
    total: round2(items.reduce((s, i) => s + i.amount, 0)),
    hours: round2(items.reduce((s, i) => s + i.hours, 0)),
    hourlyRate,
  };
}

/** The month's overtime as payroll loads it (lib/overtimeApi loadOvertimeMonth) */
export interface OvertimeMonth {
  rows: Map<string, OvertimeMonthRow>;
  settings: OvertimeSettings;
}

/**
 * What one payslip pays for overtime: nothing when the company has turned overtime off; the approved entries' lines
 * when it has any approved overtime this month; otherwise (this release only) the old employees.overtime hours x
 * "Overtime Rate", as one amount.
 * overtime_hours / overtime_rate are what older screens multiply: the hours and their average rate.
 */
export function overtimeForPayslip(month: OvertimeMonth | undefined, employee: Record<string, unknown>, basic: number) {
  const ownRate = employee['Overtime Rate'];
  if (month && !month.settings.enabled) {
    return { source: 'off' as const, hours: 0, rate: 0, pay: 0, items: [] as OvertimeItem[] };
  }
  if (month && month.rows.size > 0) {
    const pay = overtimePayFor(month.rows.get(String(employee['Employee Number'] ?? '')), basic, ownRate, month.settings);
    return {
      source: 'entries' as const,
      hours: pay.hours,
      rate: pay.hours > 0 ? round2(pay.total / pay.hours) : 0,
      pay: pay.total,
      items: pay.items,
    };
  }
  const hours = num(employee.overtime);
  const rate = num(ownRate);
  return { source: 'employee record' as const, hours, rate, pay: round2(hours * rate), items: [] as OvertimeItem[] };
}

const hoursText = (h: number) => `${+num(h).toFixed(2)} h`;
const ksh = (n: number) => `KSh ${num(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "Overtime (normal days): 6 h" */
export const overtimeLineLabel = (item: Pick<OvertimeItem, 'name' | 'hours'>) => `${item.name}: ${hoursText(item.hours)}`;

/** How the line was worked out: "6 h × KSh 177.78 × 1.5" */
export const overtimeLineWorking = (item: Pick<OvertimeItem, 'hours' | 'hourly_rate' | 'multiplier'>) =>
  `${hoursText(item.hours)} × ${ksh(item.hourly_rate)} × ${+num(item.multiplier).toFixed(2)}`;

/** A saved payslip's overtime lines (salary_history.overtime_items); none for payslips saved before FIG-889. */
export const payslipOvertimeLines = (payslip: { overtime_items?: unknown }): OvertimeItem[] =>
  Array.isArray(payslip.overtime_items)
    ? (payslip.overtime_items as Partial<OvertimeItem>[])
        .map((i) => ({
          name: String(i.name ?? 'Overtime'),
          day_type: (DAY_TYPES.includes(i.day_type as DayType) ? i.day_type : 'normal') as DayType,
          hours: num(i.hours),
          hourly_rate: num(i.hourly_rate),
          multiplier: num(i.multiplier),
          amount: num(i.amount),
        }))
        .filter((i) => i.amount > 0)
    : [];

/** A payslip's overtime pay: its lines when it has them, else the old hours x rate. */
export const payslipOvertimePay = (payslip: { overtime_items?: unknown; overtime_pay?: unknown; overtime_hours?: unknown; overtime_rate?: unknown }) => {
  const lines = payslipOvertimeLines(payslip);
  if (lines.length) return round2(lines.reduce((s, l) => s + l.amount, 0));
  if (num(payslip.overtime_pay) > 0) return round2(num(payslip.overtime_pay));
  return round2(num(payslip.overtime_hours) * num(payslip.overtime_rate));
};

/** One text cell for exports: "Overtime (normal days): 6 h 1600.02; Overtime (rest days): 4 h 1422.24" */
export const overtimeLinesText = (payslip: { overtime_items?: unknown }) =>
  payslipOvertimeLines(payslip).map((l) => `${overtimeLineLabel(l)} ${l.amount}`).join('; ');

// ---------------------------------------------------------------------------------------------
// settings as stored (company_payroll_settings.overtime_*)
// ---------------------------------------------------------------------------------------------
export const settingsFromRow = (row: Record<string, unknown> | null | undefined): OvertimeSettings => {
  if (!row) return { ...DEFAULT_OVERTIME_SETTINGS };
  const d = DEFAULT_OVERTIME_SETTINGS;
  const positive = (v: unknown, fallback: number) => (num(v) > 0 ? num(v) : fallback);
  return {
    enabled: row.overtime_enabled !== false,
    normalMultiplier: positive(row.overtime_normal_multiplier, d.normalMultiplier),
    restMultiplier: positive(row.overtime_rest_multiplier, d.restMultiplier),
    holidayMultiplier: positive(row.overtime_holiday_multiplier, d.holidayMultiplier),
    monthlyHours: positive(row.overtime_monthly_hours, d.monthlyHours),
    monthlyCap: num(row.overtime_monthly_cap) > 0 ? num(row.overtime_monthly_cap) : null,
    excludedDepartments: Array.isArray(row.overtime_excluded_departments) ? row.overtime_excluded_departments.map(String) : [],
    excludedJobGroups: Array.isArray(row.overtime_excluded_job_groups) ? row.overtime_excluded_job_groups.map(String) : [],
  };
};

export const settingsToRow = (s: OvertimeSettings) => ({
  overtime_enabled: s.enabled,
  overtime_normal_multiplier: s.normalMultiplier,
  overtime_rest_multiplier: s.restMultiplier,
  overtime_holiday_multiplier: s.holidayMultiplier,
  overtime_monthly_hours: s.monthlyHours,
  overtime_monthly_cap: s.monthlyCap,
  overtime_excluded_departments: s.excludedDepartments,
  overtime_excluded_job_groups: s.excludedJobGroups,
});

/** What's wrong with settings before saving (the database checks the same) */
export function settingsProblems(s: OvertimeSettings): string[] {
  const out: string[] = [];
  for (const [label, m] of [['working day', s.normalMultiplier], ['rest day', s.restMultiplier], ['public holiday', s.holidayMultiplier]] as const) {
    if (!(m >= 1 && m <= 5)) out.push(`The ${label} multiplier should be from 1 to 5`);
  }
  if (!(s.monthlyHours > 0 && s.monthlyHours <= 400)) out.push('Monthly hours should be more than 0 and at most 400');
  if (s.monthlyCap != null && !(s.monthlyCap > 0 && s.monthlyCap <= 400)) out.push('The monthly cap should be more than 0 and at most 400 hours, or empty');
  return out;
}

// ---------------------------------------------------------------------------------------------
// spreadsheet upload
// ---------------------------------------------------------------------------------------------
export const OVERTIME_SHEET_HEADERS = ['Employee Number', 'Date', 'Hours', 'Note'] as const;

export interface SheetOvertime {
  employee_number: string;
  work_date: string;
  hours: number;
  note: string | null;
}

const cell = (r: Record<string, unknown>, ...names: string[]) => {
  const keys = Object.keys(r);
  for (const n of names) {
    const k = keys.find((key) => key.trim().toLowerCase() === n.toLowerCase());
    if (k !== undefined && r[k] != null && String(r[k]).trim() !== '') return String(r[k]).trim();
  }
  return '';
};

/** Rows of an uploaded sheet: the ones to save, and the problems with the rest (row numbers as in the sheet). */
export function overtimeFromSheet(rows: Record<string, unknown>[], people: { employee_number: string }[]) {
  const byNumber = new Map(people.map((p) => [p.employee_number.toLowerCase(), p.employee_number]));
  const entries: SheetOvertime[] = [];
  const problems: { row: number; problem: string }[] = [];
  rows.forEach((r, i) => {
    const who = cell(r, 'Employee Number', 'Employee No', 'Number');
    const date = cell(r, 'Date', 'Work Date');
    const hoursText = cell(r, 'Hours', 'Overtime Hours');
    if (!who && !date && !hoursText) return;
    const number = byNumber.get(who.toLowerCase());
    const hours = Number(hoursText);
    if (!number) problems.push({ row: i + 2, problem: `No employee ${who || '(blank)'} you can record overtime for` });
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push({ row: i + 2, problem: `The date "${date}" should look like 2026-10-16` });
    else if (!(hours > 0 && hours <= 24)) problems.push({ row: i + 2, problem: `Hours should be more than 0 and at most 24 (not "${hoursText}")` });
    else entries.push({ employee_number: number, work_date: date, hours: round2(hours), note: cell(r, 'Note', 'Notes', 'Reason') || null });
  });
  return { entries, problems };
}

/** "KSh 1,234.50" */
export const formatKsh = ksh;
