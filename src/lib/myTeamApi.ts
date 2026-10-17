import { supabase } from './supabase';
import type { KpiPerson } from './kpiApi';

// My team in the staff portal (migration 20261018900000): the people the signed-in employee supervises, with safe
// details only. The database decides who is on it (supervised_employee_numbers()).

export interface TeamMember {
  employee_number: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  department_id: string | null;
  department: string | null;
  photo: string | null;
  worker_kind: string | null;
  status: string | null;
}

/** A database without the migration yet: nobody on the team rather than an error. */
const notThereYet = (err: unknown) =>
  ['PGRST202', '42883', 'PGRST204', '42P01', 'PGRST205'].includes(String((err as { code?: string })?.code));

export async function loadMyTeam(): Promise<TeamMember[]> {
  const { data, error } = await supabase.rpc('my_team');
  if (error) {
    if (notThereYet(error)) return [];
    throw new Error(error.message || 'Could not load your team');
  }
  return (data ?? []) as TeamMember[];
}

export const memberName = (m: TeamMember) =>
  [m.first_name, m.last_name].map((s) => (s ?? '').trim()).filter(Boolean).join(' ') || m.employee_number;

export const memberInitials = (m: TeamMember) =>
  [m.first_name, m.last_name].map((s) => (s ?? '').trim()[0] ?? '').join('').toUpperCase() || '?';

/** A team member in the shape the KPI screens take. */
export const toKpiPerson = (m: TeamMember): KpiPerson => ({
  employeeNumber: m.employee_number,
  firstName: m.first_name ?? '',
  middleName: '',
  lastName: m.last_name ?? '',
  fullName: memberName(m),
  jobTitle: m.job_title ?? '',
  branch: '',
  town: '',
  email: '',
  id: '',
  departmentId: m.department_id,
  department: m.department ?? '',
  reportsToId: null,
  photo: m.photo ?? '',
  status: m.status ?? '',
  jobGroup: '',
});

/** A report's approved leave (dates and type only). */
export interface TeamLeave {
  employee_number: string;
  name: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days: number;
}

/** The team's approved leave that falls in a month ('YYYY-MM'). */
export async function loadTeamLeave(month: string): Promise<TeamLeave[]> {
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const { data, error } = await supabase.rpc('my_team_leave', { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return (data || []) as TeamLeave[];
}
