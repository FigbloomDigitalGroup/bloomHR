import { supabase } from './supabase';
import { fetchAll } from './fetchAll';
import { DEFAULT_ODD_HOURS_UNTIL, type AttendanceDay, type AttendanceStatus, type AttendanceToday, type DayScan, type ScanKind, type ScanVia } from './attendance';

// Clocking in and out, the days HR sees, corrections and work schedules (migrations 20261023300000, 20261023400000). The database
// decides who may do what; these turn its answers into plain shapes and its refusals into plain messages.

/** A database refusal as something a person can act on. */
export function attendanceError(err: unknown): string {
  const e = (err ?? {}) as { message?: string; code?: string };
  if (e.code === '23505') return 'There is already a schedule for that';
  if (/work_schedules_grace_check/.test(e.message ?? '')) return 'Grace must be between 0 and 240 minutes';
  if (/work_schedules_times_check/.test(e.message ?? '')) return 'The end time must be after the start time';
  if (/work_schedules_days_check/.test(e.message ?? '')) return 'Choose at least one working day';
  if (/attendance_settings_odd_hours_check/.test(e.message ?? '')) return 'Choose a time from 00:00 to 12:00';
  if (e.code === '42501' && /row-level security/.test(e.message ?? '')) return 'You are not allowed to do that';
  return e.message || 'Something went wrong';
}
const fail = (error: unknown): never => {
  throw new Error(attendanceError(error));
};

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

// ---------------------------------------------------------------------------------------------
// clocking in and out
// ---------------------------------------------------------------------------------------------
export interface ClockLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
}

/**
 * Where the phone or computer is, when the person allows it; null when they refuse, the browser can't tell or it takes
 * too long. Clocking in never waits on it for more than a few seconds.
 */
export function currentLocation(timeoutMs = 8000): Promise<ClockLocation | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    const timer = setTimeout(() => resolve(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timer);
        resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 }
    );
  });
}

export const toToday = (r: Record<string, unknown>): AttendanceToday => ({
  date: String(r.date ?? ''),
  status: (r.status as AttendanceStatus | null) ?? null,
  clockIn: (r.clock_in as string | null) ?? null,
  clockOut: (r.clock_out as string | null) ?? null,
  lateMinutes: num(r.late_minutes),
  workingDay: r.working_day !== false,
  startTime: String(r.start_time ?? '08:00'),
  endTime: String(r.end_time ?? '17:00'),
  lateAfter: String(r.late_after ?? '08:30'),
  graceMinutes: Number(r.grace_minutes ?? 30),
});

export async function loadToday(): Promise<AttendanceToday> {
  const { data, error } = await supabase.rpc('attendance_today');
  if (error) fail(error);
  return toToday((data ?? {}) as Record<string, unknown>);
}

export async function clockIn(location: ClockLocation | null): Promise<AttendanceToday> {
  const { data, error } = await supabase.rpc('attendance_clock_in', { p_location: location });
  if (error) fail(error);
  return toToday((data ?? {}) as Record<string, unknown>);
}

export async function clockOut(location: ClockLocation | null): Promise<AttendanceToday> {
  const { data, error } = await supabase.rpc('attendance_clock_out', { p_location: location });
  if (error) fail(error);
  return toToday((data ?? {}) as Record<string, unknown>);
}

// ---------------------------------------------------------------------------------------------
// the days
// ---------------------------------------------------------------------------------------------
export interface AttendanceAccess {
  /** everyone's days (HR, Reports) */
  seesAll: boolean;
  /** corrects days (HR) */
  manages: boolean;
  /** sets the work schedules (HR, Settings) */
  schedules: boolean;
  employeeNumber: string | null;
  /** the employee numbers of the signed-in person's reports */
  team: string[];
}

export async function loadAttendanceAccess(): Promise<AttendanceAccess> {
  const { data, error } = await supabase.rpc('attendance_my_access');
  const d = (error ? {} : data ?? {}) as Record<string, unknown>;
  return {
    seesAll: !!d.sees_all,
    manages: !!d.manages,
    schedules: !!d.schedules,
    employeeNumber: (d.employee_number as string | null) ?? null,
    team: (d.team as string[] | null) ?? [],
  };
}

export const toDay = (r: Record<string, unknown>): AttendanceDay => ({
  employeeNumber: String(r.employee_number ?? ''),
  day: String(r.day ?? ''),
  status: (r.status as AttendanceStatus | null) ?? null,
  clockIn: (r.clock_in as string | null) ?? null,
  clockOut: (r.clock_out as string | null) ?? null,
  hours: num(r.hours),
  lateMinutes: num(r.late_minutes),
  source: (r.source as string | null) ?? null,
  note: (r.note as string | null) ?? null,
  flag: (r.flag as string | null) ?? null,
  counted: r.counted !== false,
});

export const toScan = (r: Record<string, unknown>): DayScan => ({
  at: String(r.punched_at ?? ''),
  via: (r.via as ScanVia) ?? 'scanner',
  scannerName: (r.scanner_name as string | null) ?? null,
  kind: (r.kind as ScanKind) ?? 'between',
  reason: (r.reason as string | null) ?? null,
});

/** Every scan behind one person's day, in time order (migration 20261023800000). */
export async function loadDayScans(employeeNumber: string, date: string): Promise<DayScan[]> {
  const { data, error } = await supabase.rpc('attendance_day_scans', { p_employee: employeeNumber, p_date: date });
  if (error) fail(error);
  return ((data ?? []) as Record<string, unknown>[]).map(toScan);
}

/** One row per person per day from `from` to `to` (one person's when given): who the signed-in person may see. */
export async function loadAttendanceDays(from: string, to: string, employeeNumber?: string): Promise<AttendanceDay[]> {
  const rows = await fetchAll<Record<string, unknown>>((a, b) =>
    supabase
      .rpc('attendance_days', { p_from: from, p_to: to, p_employee: employeeNumber ?? null })
      .order('employee_number')
      .order('day')
      .range(a, b) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>
  ).catch(fail);
  return rows.map(toDay);
}

/** HR records or corrects one day (times as ISO moments; no clock-out yet: null). */
export async function setAttendanceDay(employeeNumber: string, date: string, clockInAt: string, clockOutAt: string | null, note: string) {
  const { error } = await supabase.rpc('attendance_set_day', {
    p_employee: employeeNumber,
    p_date: date,
    p_in: clockInAt,
    p_out: clockOutAt,
    p_note: note,
  });
  if (error) fail(error);
}

export async function removeAttendanceDay(employeeNumber: string, date: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('attendance_remove_day', { p_employee: employeeNumber, p_date: date });
  if (error) fail(error);
  return !!data;
}

// ---------------------------------------------------------------------------------------------
// work schedules
// ---------------------------------------------------------------------------------------------
export interface WorkSchedule {
  id: string;
  /** null: the company default */
  branch_id: string | null;
  work_days: number[];
  /** "HH:MM" */
  start_time: string;
  end_time: string;
  grace_minutes: number;
  updated_at: string;
}

export type WorkScheduleInput = Pick<WorkSchedule, 'work_days' | 'start_time' | 'end_time' | 'grace_minutes'>;

/** The built-in schedule, used when the company hasn't set one. */
export const DEFAULT_SCHEDULE: WorkScheduleInput = { work_days: [1, 2, 3, 4, 5], start_time: '08:00', end_time: '17:00', grace_minutes: 30 };

const hhmm = (t: unknown) => String(t ?? '').slice(0, 5);

export async function loadSchedules(): Promise<WorkSchedule[]> {
  const { data, error } = await supabase
    .from('work_schedules')
    .select('id, branch_id, work_days, start_time, end_time, grace_minutes, updated_at')
    .order('updated_at');
  if (error) fail(error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    branch_id: (r.branch_id as string | null) ?? null,
    work_days: ((r.work_days as number[] | null) ?? []).map(Number),
    start_time: hhmm(r.start_time),
    end_time: hhmm(r.end_time),
    grace_minutes: Number(r.grace_minutes ?? 0),
    updated_at: String(r.updated_at ?? ''),
  }));
}

/** Saves the company default (branchId null) or a branch's own schedule. */
export async function saveSchedule(id: string | null, branchId: string | null, fields: WorkScheduleInput): Promise<void> {
  const row = { ...fields, branch_id: branchId };
  const { error } = id
    ? await supabase.from('work_schedules').update(row).eq('id', id)
    : await supabase.from('work_schedules').insert(row);
  if (error) fail(error);
}

export async function removeSchedule(id: string): Promise<void> {
  const { error } = await supabase.from('work_schedules').delete().eq('id', id);
  if (error) fail(error);
}

// ---------------------------------------------------------------------------------------------
// the day attendance counts from (migration 20261023400000)
// ---------------------------------------------------------------------------------------------
/** The company's "count attendance from" day ("YYYY-MM-DD"), or null when not set (it counts from the day the company was set up). */
export async function loadTrackingFrom(): Promise<string | null> {
  const { data, error } = await supabase.from('attendance_settings').select('tracking_from').maybeSingle();
  if (error) fail(error);
  return (data?.tracking_from as string | undefined) ?? null;
}

export async function saveTrackingFrom(day: string): Promise<void> {
  const { error } = await supabase
    .from('attendance_settings')
    .upsert({ tracking_from: day }, { onConflict: 'tenant_id' });
  if (error) fail(error);
}

// ---------------------------------------------------------------------------------------------
// odd-hours clock-ins (migration 20261023800000)
// ---------------------------------------------------------------------------------------------
/** The company's "odd-hours clock-in before" time ("HH:MM"; 05:00 when not set, 00:00 = never flag). */
export async function loadOddHoursUntil(): Promise<string> {
  const { data, error } = await supabase.from('attendance_settings').select('odd_hours_until').maybeSingle();
  if (error) fail(error);
  return data?.odd_hours_until ? hhmm(data.odd_hours_until) : DEFAULT_ODD_HOURS_UNTIL;
}

/** Saves it (a company without settings yet keeps counting attendance from the day it already did). */
export async function saveOddHoursUntil(time: string): Promise<void> {
  const { error } = await supabase
    .from('attendance_settings')
    .upsert({ odd_hours_until: time }, { onConflict: 'tenant_id' });
  if (error) fail(error);
}
