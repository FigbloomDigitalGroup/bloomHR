import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../lib/fetchAll';

// The rows the reports across countries (FIG-905) add up, read for one month: everyone's branch, the month's payslips
// (payroll only, as salary_history's row-level security has it), and the month's leave, absence, exits and casual days
// (people reports). Each is read on its own: one that can't be read is listed in `problems` and left out, the others
// still show.

/* eslint-disable @typescript-eslint/no-explicit-any -- the untyped rows the reports add up */
type Row = Record<string, any>;

export interface GroupReportData {
  employees: Row[];
  payslips: Row[];
  exits: Row[];
  leaves: Row[];
  absences: Row[];
  casualDays: Row[];
  /** the pay period the payslips are for (the month asked, or the month before when `fallBack` and it has none) */
  payPeriod: string;
  loading: boolean;
  problems: string[];
}

const EMPLOYEE_COLUMNS = '"Employee Number", "First Name", "Last Name", "Branch", branch_id, "Job Level", "Status", "Start Date", worker_kind, pay_basis';
const DIRECTORY_COLUMNS = '"Employee Number", "First Name", "Last Name", "Branch", "Job Level", "Status"';

/** "2026-10" -> "2026-09" */
export const previousMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const lastDay = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

async function readEmployees(): Promise<Row[]> {
  try {
    return await fetchAll<Row>((from, to) => supabase.from('employees').select(EMPLOYEE_COLUMNS).order('"Employee Number"').order('id').range(from, to));
  } catch {
    // roles that can't read the employees table still see headcount from the directory (by branch name)
    return await fetchAll<Row>((from, to) => supabase.from('employee_directory').select(DIRECTORY_COLUMNS).order('"Employee Number"').range(from, to));
  }
}

const readPayslips = (period: string) =>
  fetchAll<Row>((from, to) => supabase.from('salary_history').select('*').eq('pay_period', period).order('id').range(from, to));

export function useGroupReportData(args: { month: string; payroll: boolean; people: boolean; fallBack?: boolean }): GroupReportData {
  const { month, payroll, people, fallBack = false } = args;
  const [data, setData] = useState<GroupReportData>({
    employees: [], payslips: [], exits: [], leaves: [], absences: [], casualDays: [], payPeriod: month, loading: true, problems: [],
  });

  useEffect(() => {
    let cancelled = false;
    const problems: string[] = [];
    const attempt = async (label: string, read: () => Promise<Row[]>): Promise<Row[]> => {
      try {
        return await read();
      } catch {
        problems.push(label);
        return [];
      }
    };
    setData((d) => ({ ...d, loading: true }));
    (async () => {
      const from = `${month}-01`;
      const to = lastDay(month);
      const [employees, firstPayslips, exits, leaves, absences, casualDays] = await Promise.all([
        attempt('staff', readEmployees),
        payroll ? attempt('payslips', () => readPayslips(month)) : Promise.resolve([]),
        people
          ? attempt('exits', () => fetchAll<Row>((a, b) => supabase.from('employee_exits').select('employee_number, last_working_day, status').gte('last_working_day', from).lte('last_working_day', to).order('id').range(a, b)))
          : Promise.resolve([]),
        people
          ? attempt('leave', async () => {
              // leave dates are kept as text: read the approved ones and keep the month's
              const rows = await fetchAll<Row>((a, b) => supabase.from('leave_application').select('"Employee Number", "Start Date", days, status').ilike('status', 'approved').order('id').range(a, b));
              return rows;
            })
          : Promise.resolve([]),
        people
          ? attempt('absence', () => fetchAll<Row>((a, b) => supabase.from('leave_absences').select('employee_number, start_date, days, status').gte('start_date', from).lte('start_date', to).order('id').range(a, b)))
          : Promise.resolve([]),
        people
          ? attempt('casual days', () => fetchAll<Row>((a, b) => supabase.from('casual_days').select('employee_number, work_date, portion').gte('work_date', from).lte('work_date', to).order('id').range(a, b)))
          : Promise.resolve([]),
      ]);
      let payslips = firstPayslips;
      let payPeriod = month;
      if (payroll && fallBack && payslips.length === 0) {
        payPeriod = previousMonth(month);
        payslips = await attempt('payslips', () => readPayslips(payPeriod));
        if (payslips.length === 0) payPeriod = month;
      }
      if (!cancelled) setData({ employees, payslips, exits, leaves, absences, casualDays, payPeriod, loading: false, problems: [...new Set(problems)] });
    })();
    return () => {
      cancelled = true;
    };
  }, [month, payroll, people, fallBack]);

  return data;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
