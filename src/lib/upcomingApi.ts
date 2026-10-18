import { supabase } from './supabase';
import { fetchAllResult } from './fetchAll';
import type { EventRow, HolidayRow, LeaveRow, TaskRow } from './upcoming';

// Reading what the calendar's "Coming up" list and the leave form's hints need. Everyone can read the company's
// holidays and events; tasks and leave are limited by row-level security, and asked for by employee number here.

export async function loadHolidays(): Promise<HolidayRow[]> {
  const { data, error } = await supabase.from('holidays').select('name, date, recurring');
  if (error) throw error;
  return (data ?? []) as HolidayRow[];
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
