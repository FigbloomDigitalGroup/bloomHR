import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CalendarDays, Clock, Plane } from 'lucide-react';
import { StatCard, StatusPill, type StatusTone } from '../UI';
import { useDepartments } from '../../hooks/useDepartments';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../lib/fetchAll';
import { describeLoadError } from '../../lib/employeeDirectory';
import { type Row, byNumber, downloadXlsx, fullName, monthOf, plural, readReportEmployees, shortMonth } from '../../lib/reports/reportKit';
import {
  LEAVE_STATUS_LABEL,
  type LeaveStatus,
  addDays,
  annualBalances,
  annualLeaveType,
  day,
  departmentName,
  leaveByDepartment,
  leaveByType,
  leaveDays,
  leaveInRange,
  leaveMatches,
  leaveStatus,
  leaveSummary,
  onLeaveBetween,
  periodBounds,
} from '../../lib/reports/peopleReports';
import { BranchFilter, DepartmentFilter, MonthFilter, ReportFrame, ReportTable, SearchFilter, StatGrid, td, tdNum, th, thNum } from './ReportFrame';

// Leave management: who asked for leave in a period, what was approved and taken, who is away now and soon, and the
// year's annual leave balances. Everything is read once; the filters only change what is shown.

const TONE: Record<LeaveStatus, StatusTone> = { approved: 'success', pending: 'warning', rejected: 'danger', cancelled: 'neutral', other: 'neutral' };

const APPLICATION_COLUMNS = 'id, "Employee Number", name, "Leave Type", "Start Date", "End Date", days, status, reason, time_added';

interface LeaveData {
  employees: Row[];
  apps: Row[];
  types: Row[];
  balances: Row[];
  loading: boolean;
  problems: string[];
}

function useLeaveData(year: number): LeaveData {
  const [data, setData] = useState<LeaveData>({ employees: [], apps: [], types: [], balances: [], loading: true, problems: [] });
  useEffect(() => {
    let cancelled = false;
    const problems: string[] = [];
    const attempt = async (label: string, read: () => Promise<Row[]>) => {
      try {
        return await read();
      } catch (err) {
        problems.push(`Couldn't read ${label}: ${describeLoadError(err)}.`);
        return [];
      }
    };
    (async () => {
      const [employees, apps, types, balances] = await Promise.all([
        attempt('staff', readReportEmployees),
        attempt('leave requests', () =>
          fetchAll<Row>((from, to) => supabase.from('leave_application').select(APPLICATION_COLUMNS).order('id').range(from, to)),
        ),
        attempt('leave types', () => fetchAll<Row>((from, to) => supabase.from('leave_types').select('id, name, is_deductible, paid').order('id').range(from, to))),
        attempt('leave balances', () =>
          fetchAll<Row>((from, to) =>
            supabase
              .from('leave_balances')
              .select('id, employee_number, leave_type_id, year, month, accrued_days, used_days, carried_over_days, remaining_days')
              .eq('year', year)
              .order('id')
              .range(from, to),
          ),
        ),
      ]);
      if (!cancelled) setData({ employees, apps, types, balances, loading: false, problems });
    })();
    return () => {
      cancelled = true;
    };
  }, [year]);
  return data;
}

const fmtDate = (d: string) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
const num = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

export default function LeaveReport() {
  const now = new Date();
  const thisMonth = monthOf(now);
  const today = day(now);
  const year = now.getFullYear();

  const [from, setFrom] = useState(`${year}-01`);
  const [to, setTo] = useState(thisMonth);
  const [branchId, setBranchId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [search, setSearch] = useState('');

  const { employees, apps, types, balances, loading, problems } = useLeaveData(year);
  const { departments } = useDepartments();

  const people = useMemo(() => byNumber(employees), [employees]);
  const deptNames = useMemo(() => new Map(departments.map((d) => [String(d.id), d.name])), [departments]);
  const filters = useMemo(() => ({ branchId, departmentId, search }), [branchId, departmentId, search]);
  const [start, end] = from <= to ? [from, to] : [to, from];

  const report = useMemo(() => {
    const [first, last] = periodBounds(start, end);
    const inPeriod = leaveInRange(apps, first, last, people, filters).sort(
      (a, b) => day(b['Start Date']).localeCompare(day(a['Start Date'])) || String(b.time_added ?? '').localeCompare(String(a.time_added ?? '')),
    );
    const current = apps.filter((a) => leaveMatches(a, people, filters));
    const annual = annualLeaveType(types);
    return {
      inPeriod,
      summary: leaveSummary(inPeriod, current, today),
      byType: leaveByType(inPeriod),
      byDepartment: leaveByDepartment(inPeriod, people, deptNames),
      soon: onLeaveBetween(current, today, addDays(today, 14)),
      annual,
      balances: annualBalances(balances, annual?.id, year, people, filters),
    };
  }, [apps, types, balances, people, deptNames, filters, start, end, today, year]);

  const nameOf = (app: Row) => {
    const person = people.get(String(app['Employee Number'] ?? ''));
    return (person && fullName(person)) || app.name || app['Employee Number'] || '';
  };
  const deptOf = (number: unknown) => departmentName(people.get(String(number ?? '')), deptNames);
  const periodLabel = start === end ? shortMonth(start) : `${shortMonth(start)} to ${shortMonth(end)}`;

  const download = () =>
    downloadXlsx(
      `leave-requests-${start}-to-${end}`,
      ['Employee number', 'Employee', 'Department', 'Leave type', 'From', 'To', 'Days', 'Status', 'Applied on', 'Reason'],
      report.inPeriod.map((a) => [
        a['Employee Number'],
        nameOf(a),
        deptOf(a['Employee Number']),
        a['Leave Type'],
        day(a['Start Date']),
        day(a['End Date']),
        leaveDays(a),
        LEAVE_STATUS_LABEL[leaveStatus(a.status)],
        day(a.time_added),
        a.reason,
      ]),
    );

  const { summary } = report;
  const typeTotals = report.byType.reduce(
    (t, l) => ({ requests: t.requests + l.requests, approved: t.approved + l.approved, pending: t.pending + l.pending, rejected: t.rejected + l.rejected, days: t.days + l.daysTaken }),
    { requests: 0, approved: 0, pending: 0, rejected: 0, days: 0 },
  );

  return (
    <ReportFrame
      title="Leave management"
      subtitle={`Leave requests, days taken and balances for ${periodLabel}.`}
      loading={loading}
      problems={problems}
      onDownload={download}
      filters={
        <>
          <MonthFilter label="From" value={from} onChange={setFrom} max={thisMonth} />
          <MonthFilter label="To" value={to} onChange={setTo} />
          <BranchFilter value={branchId} onChange={setBranchId} />
          <DepartmentFilter value={departmentId} onChange={setDepartmentId} />
          <SearchFilter value={search} onChange={setSearch} />
        </>
      }
    >
      <div className="space-y-4">
        <StatGrid>
          <StatCard label="Requests" value={summary.requests.toLocaleString()} icon={<CalendarDays className="w-[18px] h-[18px]" />} note={periodLabel} />
          <StatCard label="Days taken" value={num(summary.approvedDays)} icon={<CalendarCheck className="w-[18px] h-[18px]" />} tint="info" note="Approved leave" />
          <StatCard label="Pending requests" value={summary.pending.toLocaleString()} icon={<Clock className="w-[18px] h-[18px]" />} tint="orange" note="Waiting for a decision" />
          <StatCard label="On leave today" value={summary.onLeaveToday.toLocaleString()} icon={<Plane className="w-[18px] h-[18px]" />} tint="purple" note={fmtDate(today)} />
        </StatGrid>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <ReportTable
            title="By leave type"
            empty={report.byType.length === 0}
            head={
              <tr>
                <th className={th}>Leave type</th>
                <th className={thNum}>Requests</th>
                <th className={thNum}>Approved</th>
                <th className={thNum}>Pending</th>
                <th className={thNum}>Rejected</th>
                <th className={thNum}>Days taken</th>
              </tr>
            }
            foot={
              <tr>
                <td className={`${td} font-bold`}>Total</td>
                <td className={`${tdNum} font-bold`}>{typeTotals.requests}</td>
                <td className={`${tdNum} font-bold`}>{typeTotals.approved}</td>
                <td className={`${tdNum} font-bold`}>{typeTotals.pending}</td>
                <td className={`${tdNum} font-bold`}>{typeTotals.rejected}</td>
                <td className={`${tdNum} font-bold`}>{num(typeTotals.days)}</td>
              </tr>
            }
          >
            {report.byType.map((l) => (
              <tr key={l.type}>
                <td className={`${td} font-semibold`}>{l.type}</td>
                <td className={tdNum}>{l.requests}</td>
                <td className={tdNum}>{l.approved}</td>
                <td className={tdNum}>{l.pending}</td>
                <td className={tdNum}>{l.rejected}</td>
                <td className={tdNum}>{num(l.daysTaken)}</td>
              </tr>
            ))}
          </ReportTable>

          <ReportTable
            title="By department"
            note="Approved leave"
            empty={report.byDepartment.length === 0}
            head={
              <tr>
                <th className={th}>Department</th>
                <th className={thNum}>People on leave</th>
                <th className={thNum}>Days taken</th>
              </tr>
            }
          >
            {report.byDepartment.map((l) => (
              <tr key={l.department}>
                <td className={`${td} font-semibold`}>{l.department}</td>
                <td className={tdNum}>{l.people}</td>
                <td className={tdNum}>{num(l.daysTaken)}</td>
              </tr>
            ))}
          </ReportTable>
        </div>

        <ReportTable
          title="On leave now and in the next 14 days"
          note="Approved leave"
          empty={report.soon.length === 0}
          emptyText="No one is on leave in the next 14 days"
          head={
            <tr>
              <th className={th}>Employee</th>
              <th className={th}>Leave type</th>
              <th className={th}>From</th>
              <th className={th}>To</th>
              <th className={thNum}>Days</th>
            </tr>
          }
        >
          {report.soon.map((a) => (
            <tr key={a.id}>
              <td className={`${td} font-semibold`}>{nameOf(a)}</td>
              <td className={td}>{a['Leave Type']}</td>
              <td className={td}>{fmtDate(day(a['Start Date']))}</td>
              <td className={td}>{fmtDate(day(a['End Date']))}</td>
              <td className={tdNum}>{num(leaveDays(a))}</td>
            </tr>
          ))}
        </ReportTable>

        <ReportTable
          title="All requests"
          note={plural(report.inPeriod.length, 'request')}
          empty={report.inPeriod.length === 0}
          head={
            <tr>
              <th className={th}>Employee</th>
              <th className={th}>Department</th>
              <th className={th}>Leave type</th>
              <th className={th}>From</th>
              <th className={th}>To</th>
              <th className={thNum}>Days</th>
              <th className={th}>Status</th>
              <th className={th}>Applied on</th>
            </tr>
          }
        >
          {report.inPeriod.map((a) => {
            const s = leaveStatus(a.status);
            return (
              <tr key={a.id}>
                <td className={td}>
                  <div className="font-semibold">{nameOf(a)}</div>
                  <div className="text-[11px] text-muted-foreground">{a['Employee Number']}</div>
                </td>
                <td className={td}>{deptOf(a['Employee Number'])}</td>
                <td className={td}>{a['Leave Type']}</td>
                <td className={td}>{fmtDate(day(a['Start Date']))}</td>
                <td className={td}>{fmtDate(day(a['End Date']))}</td>
                <td className={tdNum}>{num(leaveDays(a))}</td>
                <td className={td}>
                  <StatusPill label={LEAVE_STATUS_LABEL[s]} tone={TONE[s]} />
                </td>
                <td className={td}>{fmtDate(day(a.time_added))}</td>
              </tr>
            );
          })}
        </ReportTable>

        <ReportTable
          title={`Annual leave balances, ${year}`}
          note={report.annual ? report.annual.name : undefined}
          empty={report.balances.length === 0}
          emptyText={report.annual ? 'No annual leave balances yet' : 'No annual leave type set up'}
          head={
            <tr>
              <th className={th}>Employee</th>
              <th className={thNum}>Accrued</th>
              <th className={thNum}>Carried over</th>
              <th className={thNum}>Used</th>
              <th className={thNum}>Remaining</th>
            </tr>
          }
        >
          {report.balances.map((b) => (
            <tr key={b.employeeNumber}>
              <td className={td}>
                <div className="font-semibold">{fullName(people.get(b.employeeNumber)) || b.employeeNumber}</div>
                <div className="text-[11px] text-muted-foreground">{b.employeeNumber}</div>
              </td>
              <td className={tdNum}>{num(b.accrued)}</td>
              <td className={tdNum}>{num(b.carried)}</td>
              <td className={tdNum}>{num(b.used)}</td>
              <td className={`${tdNum} font-semibold`}>{num(b.remaining)}</td>
            </tr>
          ))}
        </ReportTable>
      </div>
    </ReportFrame>
  );
}
