import { useEffect, useMemo, useState } from 'react';
import { Building2, CalendarCheck, Users, Wallet } from 'lucide-react';
import { StatCard } from '../UI';
import { useBranches } from '../../hooks/useBranches';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../lib/fetchAll';
import type { AttendanceDay } from '../../lib/attendance';
import { loadAttendanceDays } from '../../lib/attendanceApi';
import { type Row, addMonths, downloadXlsx, monthBounds, monthOf, readReportEmployees, shortMonth } from '../../lib/reports/reportKit';
import {
  BRANCH_SHEET_HEADERS,
  type BranchRow,
  branchPerformance,
  branchSheet,
  branchTotals,
  payrollLabel,
  percentLabel,
} from '../../lib/reports/operationsReports';
import { MonthFilter, ReportFrame, ReportTable, StatGrid, td, tdNum, th, thNum } from './ReportFrame';

// Branch performance: a month's HR numbers per branch (staff, hires, exits, attendance, leave, overtime, payroll).
// Each read stands alone: one that fails (row-level security) is named above the table and the rest still shows.

interface Data {
  employees: Row[];
  exits: Row[];
  attendance: AttendanceDay[] | null;
  leaves: Row[];
  overtime: Row[];
  payslips: Row[] | null;
  problems: string[];
}

const EMPTY: Data = { employees: [], exits: [], attendance: null, leaves: [], overtime: [], payslips: null, problems: [] };

async function readMonth(month: string): Promise<Data> {
  const [first, last] = monthBounds(month);
  const problems: string[] = [];
  const attempt = async <T,>(problem: string, read: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await read();
    } catch {
      problems.push(problem);
      return fallback;
    }
  };
  const [employees, exits, attendance, leaves, overtime, payslips] = await Promise.all([
    attempt("Staff couldn't be read.", readReportEmployees, [] as Row[]),
    attempt(
      "Exits couldn't be read.",
      () =>
        fetchAll<Row>((a, b) =>
          supabase.from('employee_exits').select('id, employee_number, last_working_day, status').gte('last_working_day', first).lte('last_working_day', last).order('id').range(a, b)
        ),
      [] as Row[]
    ),
    attempt<AttendanceDay[] | null>("Attendance couldn't be read, so attendance and punctuality show —.", () => loadAttendanceDays(first, last), null),
    attempt(
      "Leave couldn't be read.",
      () =>
        // leave dates are text: approved leave starting in the six months up to the month's end (longer leave is rare)
        fetchAll<Row>((a, b) =>
          supabase
            .from('leave_application')
            .select('id, "Employee Number", "Start Date", "End Date", days, status')
            .ilike('status', 'approved')
            .gte('"Start Date"', `${addMonths(month, 6)}-01`)
            .lte('"Start Date"', last)
            .order('id')
            .range(a, b)
        ),
      [] as Row[]
    ),
    attempt(
      "Overtime couldn't be read.",
      () =>
        fetchAll<Row>((a, b) =>
          supabase.from('overtime_entries').select('id, employee_number, work_date, hours, status').eq('status', 'approved').gte('work_date', first).lte('work_date', last).order('id').range(a, b)
        ),
      [] as Row[]
    ),
    attempt<Row[] | null>(
      "Payroll cost needs payroll access, so it shows —.",
      () => fetchAll<Row>((a, b) => supabase.from('salary_history').select('id, employee_id, gross_pay, currency').eq('pay_period', month).order('id').range(a, b)),
      null
    ),
  ]);
  return { employees, exits, attendance, leaves, overtime, payslips, problems };
}

function BranchCells({ r }: { r: BranchRow }) {
  return (
    <>
      <td className={td}>{r.name}</td>
      <td className={tdNum}>{r.headcount.toLocaleString()}</td>
      <td className={tdNum}>{r.casual.toLocaleString()}</td>
      <td className={tdNum}>{r.newHires.toLocaleString()}</td>
      <td className={tdNum}>{r.exits.toLocaleString()}</td>
      <td className={tdNum}>{percentLabel(r.attendance?.rate)}</td>
      <td className={tdNum}>{percentLabel(r.punctuality?.share)}</td>
      <td className={tdNum}>{r.leaveDays.toLocaleString()}</td>
      <td className={tdNum}>{r.overtimeHours.toLocaleString()}</td>
      <td className={tdNum}>{payrollLabel(r.payroll)}</td>
    </>
  );
}

export default function BranchPerformanceReport() {
  const thisMonth = monthOf();
  const [month, setMonth] = useState(thisMonth);
  const { branches, loading: branchesLoading, error: branchesError } = useBranches();
  const [data, setData] = useState<Data>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    readMonth(month).then((d) => {
      if (cancelled) return;
      setData(d);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [month]);

  const rows = useMemo(
    () =>
      branchPerformance({
        month,
        branches,
        employees: data.employees,
        exits: data.exits,
        attendance: data.attendance,
        leaves: data.leaves,
        overtime: data.overtime,
        payslips: data.payslips,
      }),
    [month, branches, data]
  );
  const totals = useMemo(() => branchTotals(rows, data.attendance !== null, data.payslips !== null), [rows, data]);
  const problems = branchesError ? [`Branches couldn't be read: ${branchesError}.`, ...data.problems] : data.problems;

  const download = () => downloadXlsx(`Branch performance ${month}`, BRANCH_SHEET_HEADERS, branchSheet(rows, totals), 'Branches');

  const head = (
    <tr>
      <th className={th}>Branch</th>
      <th className={thNum}>Headcount</th>
      <th className={thNum}>Casual workers</th>
      <th className={thNum}>New hires</th>
      <th className={thNum}>Exits</th>
      <th className={thNum}>Attendance</th>
      <th className={thNum}>Punctuality</th>
      <th className={thNum}>Leave days</th>
      <th className={thNum}>Overtime hours</th>
      <th className={thNum}>Payroll cost</th>
    </tr>
  );

  return (
    <ReportFrame
      title="Branch performance report"
      subtitle={`HR numbers for each branch in ${shortMonth(month)}.`}
      filters={<MonthFilter value={month} onChange={setMonth} max={thisMonth} />}
      onDownload={rows.length ? download : undefined}
      loading={loading || branchesLoading}
      problems={problems}
    >
      <div className="space-y-4">
        <StatGrid>
          <StatCard label="Branches" value={rows.length.toLocaleString()} icon={<Building2 className="w-[18px] h-[18px]" strokeWidth={1.8} />} tint="info" />
          <StatCard
            label="Staff"
            value={totals.headcount.toLocaleString()}
            icon={<Users className="w-[18px] h-[18px]" strokeWidth={1.8} />}
            tint="green"
            note={totals.casual ? `Plus ${totals.casual.toLocaleString()} casual` : undefined}
          />
          <StatCard
            label="Average attendance"
            value={percentLabel(totals.attendance?.rate)}
            icon={<CalendarCheck className="w-[18px] h-[18px]" strokeWidth={1.8} />}
            tint="purple"
            note={totals.punctuality?.share != null ? `${totals.punctuality.share}% on time` : undefined}
          />
          <StatCard label="Payroll cost" value={payrollLabel(totals.payroll)} icon={<Wallet className="w-[18px] h-[18px]" strokeWidth={1.8} />} tint="orange" note="Gross pay" />
        </StatGrid>

        <ReportTable
          title="By branch"
          note={branches.some((b) => b.is_default) ? 'Staff with no branch count under the default branch.' : undefined}
          empty={rows.length === 0}
          emptyText="No branches yet"
          head={head}
          foot={
            <tr>
              <BranchCells r={totals} />
            </tr>
          }
        >
          {rows.map((r) => (
            <tr key={r.id || 'none'}>
              <BranchCells r={r} />
            </tr>
          ))}
        </ReportTable>
      </div>
    </ReportFrame>
  );
}
