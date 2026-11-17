import { supabase } from './supabase';
import { fetchAllResult } from './fetchAll';
import { currentUserAndTenant } from './privateFiles';
import { MONDAY_TO_FRIDAY } from './workWeek';
import { holidaysForCountry, type EventRow, type HolidayRow, type LeaveDayRules, type LeaveRow, type TaskRow } from './upcoming';

// Reading what the calendar's "Coming up" list and the leave form's hints need. Everyone can read the company's
// holidays and events; tasks and leave are limited by row-level security, and asked for by employee number here.

export async function loadHolidays(): Promise<HolidayRow[]> {
  const { data, error } = await supabase.from('holidays').select('name, date, recurring, country');
  if (error) throw error;
  return holidaysForCountry((data ?? []) as HolidayRow[], await myHolidayCountry());
}

/** The signed-in employee's country (their branch's, FIG-905), or null when they aren't an employee or it can't be told. */
export async function myHolidayCountry(): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('my_holiday_country');
    if (error) return null;
    return (data as string | null) || null;
  } catch {
    return null;
  }
}

export async function loadCompanyEvents(): Promise<EventRow[]> {
  const { data, error } = await supabase.from('company_events').select('id, title, date, description').order('date');
  if (error) throw error;
  return (data ?? []) as EventRow[];
}

/** The signed-in person's employee number, when they are an employee. */
export async function currentEmployeeNumber(): Promise<string | null> {
  const { data, error } = await supabase.rpc('current_employee_number');
  if (error) throw error;
  return (data as string | null) || null;
}

/** Tasks assigned to this employee (open or not; see myOpenTasks). */
export async function loadMyTasks(employeeNumber: string): Promise<TaskRow[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, key, title, description, status, due_date, assignee_number, is_group')
    .eq('assignee_number', employeeNumber);
  if (error) throw error;
  return (data ?? []) as TaskRow[];
}

/** The employee's leave applications (every status; see myLeaveRanges). */
export async function loadMyLeave(employeeNumber: string): Promise<LeaveRow[]> {
  const { data, error } = await supabase
    .from('leave_application')
    .select('"Leave Type", "Start Date", "End Date", status')
    .eq('"Employee Number"', employeeNumber);
  if (error) throw error;
  return ((data ?? []) as Record<string, string | null>[]).map((l) => ({
    type: l['Leave Type'] || 'Leave',
    start: l['Start Date'],
    end: l['End Date'],
    status: l.status,
  }));
}

/**
 * How this employee's leave is counted, for drawing it on the calendar: their work week (their department's, else the
 * company's) and the leave types counted in calendar days. Monday to Friday, every type in working days, when unknown.
 */
export async function loadMyLeaveDayRules(employeeNumber: string): Promise<LeaveDayRules> {
  const [week, types, policies] = await Promise.all([
    currentUserAndTenant()
      .then(({ tenantId }) => supabase.rpc('work_week_for', { p_tenant: tenantId, p_employee: employeeNumber }))
      .catch(() => ({ data: null })),
    supabase.from('leave_types').select('id, name'),
    supabase.from('current_leave_policies').select('leave_type_id, count_days'),
  ]);
  const days = Array.isArray(week.data) && week.data.length === 7 ? (week.data as unknown[]).map(Number) : MONDAY_TO_FRIDAY;
  const calendarIds = new Set(
    ((policies.data ?? []) as { leave_type_id: string; count_days: string | null }[]).filter((p) => p.count_days === 'calendar').map((p) => p.leave_type_id)
  );
  const calendarTypes = new Set(
    ((types.data ?? []) as { id: string; name: string | null }[]).filter((t) => calendarIds.has(t.id)).map((t) => (t.name || '').trim().toLowerCase())
  );
  return { workWeek: days, calendarTypes };
}

/** Everyone's name, birthday ('MM-DD': the directory never gives colleagues the year) and work email. */
export async function loadBirthdayPeople(): Promise<{ name: string; birthday: string | null; email: string | null }[]> {
  // every employee, a page at a time (one request is capped at 1000 rows)
  const { data } = await fetchAllResult((from, to) =>
    supabase.from('employee_directory').select('"First Name", "Last Name", birthday, "Work Email"').order('"Employee Number"').range(from, to)
  );
  return ((data || []) as Record<string, string | null>[]).map((p) => ({
    name: `${p['First Name'] || ''} ${p['Last Name'] || ''}`,
    birthday: p.birthday,
    email: p['Work Email'],
  }));
}
