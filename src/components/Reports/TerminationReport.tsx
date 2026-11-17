import { useEffect, useMemo, useState } from 'react';
import { DoorOpen, Hourglass, TrendingDown, UserMinus } from 'lucide-react';
import { StatCard, StatusPill, type StatusTone } from '../UI';
import { useDepartments } from '../../hooks/useDepartments';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../lib/fetchAll';
import { describeLoadError } from '../../lib/employeeDirectory';
import { type Row, addMonths, byNumber, downloadXlsx, fullName, monthOf, plural, readReportEmployees, shortMonth } from '../../lib/reports/reportKit';
import {
  EXIT_STATUS_LABEL,
  type ExitRecord,
  type ExitStatus,
  averageHeadcount,
  departmentName,
  exitRecords,
  exitSummary,
  exitsByMonth,
  exitsByReason,
  exitsInPeriod,
  isExit,
  olderExitRecords,
  reasonLabel,
} from '../../lib/reports/peopleReports';
import { BranchFilter, DepartmentFilter, MonthFilter, ReportFrame, ReportTable, StatGrid, td, tdNum, th, thNum } from './ReportFrame';

// Terminations: who left in a period (by their last working day), why, how fast people are leaving (turnover), and
// where each exit stands on clearance and final dues. Declined and cancelled exits are listed apart and not counted.

const TONE: Record<ExitStatus, StatusTone> = {
  requested: 'warning',
  approved: 'info',
  clearance: 'purple',
  completed: 'success',
  declined: 'danger',
  cancelled: 'neutral',
};

const DUES_LABEL: Record<string, string> = { draft: 'Draft', reviewed: 'Reviewed', included: 'In payroll' };

interface ExitData {
  employees: Row[];
  exits: ExitRecord[];
  loading: boolean;
  problems: string[];
}

function useExitData(): ExitData {
  const [data, setData] = useState<ExitData>({ employees: [], exits: [], loading: true, problems: [] });
  useEffect(() => {
    let cancelled = false;
    const problems: string[] = [];
    const attempt = async (label: string | null, read: () => Promise<Row[]>) => {
      try {
        return await read();
      } catch (err) {
        if (label) problems.push(`Couldn't read ${label}: ${describeLoadError(err)}.`);
        return [];
      }
    };
    const all = (table: string, columns: string) => () =>
      fetchAll<Row>((from, to) => supabase.from(table).select(columns).order('id').range(from, to));
    (async () => {
      const [employees, exits, clearance, dues, older] = await Promise.all([
        attempt('staff', readReportEmployees),
        attempt(
          'exits',
          all('employee_exits', 'id, employee_number, kind, reason_category, reason, notice_given_on, notice_days, last_working_day, notice_pay, status, created_at, completed_at'),
        ),
        attempt('clearance checklists', all('employee_exit_clearance_items', 'id, exit_id, done')),
        attempt('final dues', all('employee_exit_final_dues', 'id, exit_id, earnings, deductions, net, status, payroll_period')),
        // the older terminations table: left out quietly when it can't be read
        attempt(null, all('hr_terminations', 'id, "Employee Number", termination_date, termination_type, termination_reason, final_payroll_status, clearance_status, is_archived')),
      ]);
      const records = exitRecords(exits, clearance, dues);
      if (!cancelled) setData({ employees, exits: [...records, ...olderExitRecords(older, records)], loading: false, problems });
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return data;
}

const fmtDate = (d: string) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
const fmtAmount = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
const kindLabel = (e: ExitRecord) => (e.kind === 'resignation' ? 'Resignation' : 'Termination');
const duesLabel = (e: ExitRecord) => (e.duesStatus ? (DUES_LABEL[e.duesStatus] ?? e.duesStatus) : '');

export default function TerminationReport() {
  const thisMonth = monthOf();
  const [from, setFrom] = useState(addMonths(thisMonth, 11));
  const [to, setTo] = useState(thisMonth);
  const [branchId, setBranchId] = useState('');
  const [departmentId, setDepartmentId] = useState('');

  const { employees, exits, loading, problems } = useExitData();
  const { departments } = useDepartments();

  const people = useMemo(() => byNumber(employees), [employees]);
  const deptNames = useMemo(() => new Map(departments.map((d) => [String(d.id), d.name])), [departments]);
  const [start, end] = from <= to ? [from, to] : [to, from];

  const report = useMemo(() => {
    const filters = { branchId, departmentId };
    const inPeriod = exitsInPeriod(exits, start, end, people, filters);
    const everyExit = exitsInPeriod(exits, '1900-01', '2999-12', people, filters);
    const headcount = averageHeadcount(employees, start, end, filters);
    const real = inPeriod.filter(isExit);
    return {
      real,
      notExits: inPeriod.filter((e) => !isExit(e)),
      headcount,
      summary: exitSummary(inPeriod, everyExit, headcount),
      byMonth: exitsByMonth(inPeriod, start, end),
      byReason: exitsByReason(inPeriod),
    };
  }, [exits, employees, people, branchId, departmentId, start, end]);

  const nameOf = (e: ExitRecord) => fullName(people.get(e.employeeNumber)) || e.employeeNumber;
  const deptOf = (e: ExitRecord) => departmentName(people.get(e.employeeNumber), deptNames);
  const periodLabel = start === end ? shortMonth(start) : `${shortMonth(start)} to ${shortMonth(end)}`;
  const clearanceLabel = (e: ExitRecord) => (e.older ? (e.clearanceDone ? 'Done' : 'Not done') : e.clearanceTotal ? `${e.clearanceDone} of ${e.clearanceTotal}` : 'None');

  const download = () =>
    downloadXlsx(
      `exits-${start}-to-${end}`,
      ['Employee number', 'Employee', 'Department', 'Kind', 'Reason category', 'Reason', 'Notice given on', 'Notice days', 'Last working day', 'Status', 'Clearance done', 'Clearance items', 'Final dues net', 'Final dues status', 'Older record'],
      report.real.map((e) => [
        e.employeeNumber,
        nameOf(e),
        deptOf(e),
        kindLabel(e),
        reasonLabel(e.reasonCategory),
        e.reason,
        e.noticeGivenOn,
        e.noticeDays,
        e.lastWorkingDay,
        EXIT_STATUS_LABEL[e.status],
        e.clearanceDone,
        e.clearanceTotal,
        e.duesNet,
        duesLabel(e),
        e.older ? 'Yes' : '',
      ]),
    );

  const { summary, headcount } = report;
  const monthTotals = report.byMonth.reduce((t, m) => ({ r: t.r + m.resignations, t: t.t + m.terminations, all: t.all + m.total }), { r: 0, t: 0, all: 0 });

  const exitRows = (list: ExitRecord[]) =>
    list.map((e) => (
      <tr key={e.id}>
        <td className={td}>
          <div className="font-semibold">{nameOf(e)}</div>
          <div className="text-[11px] text-muted-foreground">
            {e.employeeNumber}
            {e.older && ' · older record'}
          </div>
        </td>
        <td className={td}>{deptOf(e)}</td>
        <td className={td}>{kindLabel(e)}</td>
        <td className={`${td} max-w-[16rem] whitespace-normal`}>
          <div>{reasonLabel(e.reasonCategory)}</div>
          {e.reason && <div className="text-[11px] text-muted-foreground">{e.reason}</div>}
        </td>
        <td className={td}>{fmtDate(e.noticeGivenOn)}</td>
        <td className={tdNum}>{e.noticeDays ?? ''}</td>
        <td className={td}>{fmtDate(e.lastWorkingDay)}</td>
        <td className={td}>
          <StatusPill label={EXIT_STATUS_LABEL[e.status]} tone={TONE[e.status]} />
        </td>
        <td className={td}>{clearanceLabel(e)}</td>
        <td className={tdNum}>
          {e.duesNet === null ? '' : fmtAmount(e.duesNet)}
          {duesLabel(e) && <div className="text-[11px] text-muted-foreground">{duesLabel(e)}</div>}
        </td>
      </tr>
    ));

  const exitHead = (
    <tr>
      <th className={th}>Employee</th>
      <th className={th}>Department</th>
      <th className={th}>Kind</th>
      <th className={th}>Reason</th>
      <th className={th}>Notice given on</th>
      <th className={thNum}>Notice days</th>
      <th className={th}>Last working day</th>
      <th className={th}>Status</th>
      <th className={th}>Clearance</th>
      <th className={thNum}>Final dues (net)</th>
    </tr>
  );

  return (
    <ReportFrame
      title="Termination report"
      subtitle={`Resignations and terminations by last working day, ${periodLabel}.`}
      loading={loading}
      problems={problems}
      onDownload={download}
      filters={
        <>
          <MonthFilter label="From" value={from} onChange={setFrom} />
          <MonthFilter label="To" value={to} onChange={setTo} />
          <BranchFilter value={branchId} onChange={setBranchId} />
          <DepartmentFilter value={departmentId} onChange={setDepartmentId} />
        </>
      }
    >
      <div className="space-y-4">
        <StatGrid>
          <StatCard label="Exits" value={summary.exits.toLocaleString()} icon={<UserMinus className="w-[18px] h-[18px]" />} note={periodLabel} />
          <StatCard
            label="Resignations / terminations"
            value={`${summary.resignations} / ${summary.terminations}`}
            icon={<DoorOpen className="w-[18px] h-[18px]" />}
            tint="info"
          />
          <StatCard
            label="Turnover rate"
            value={summary.turnover === null ? '–' : `${summary.turnover}%`}
            icon={<TrendingDown className="w-[18px] h-[18px]" />}
            tint="purple"
            note={`Average headcount ${headcount.average.toLocaleString(undefined, { maximumFractionDigits: 1 })}`}
          />
          <StatCard label="Still open" value={summary.open.toLocaleString()} icon={<Hourglass className="w-[18px] h-[18px]" />} tint="orange" note="Requested, approved or in clearance" />
        </StatGrid>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <ReportTable
            title="By month"
            empty={report.byMonth.length === 0}
            head={
              <tr>
                <th className={th}>Month</th>
                <th className={thNum}>Resignations</th>
                <th className={thNum}>Terminations</th>
                <th className={thNum}>Total</th>
              </tr>
            }
            foot={
              <tr>
                <td className={`${td} font-bold`}>Total</td>
                <td className={`${tdNum} font-bold`}>{monthTotals.r}</td>
                <td className={`${tdNum} font-bold`}>{monthTotals.t}</td>
                <td className={`${tdNum} font-bold`}>{monthTotals.all}</td>
              </tr>
            }
          >
            {report.byMonth.map((m) => (
              <tr key={m.month}>
                <td className={`${td} font-semibold`}>{shortMonth(m.month)}</td>
                <td className={tdNum}>{m.resignations}</td>
                <td className={tdNum}>{m.terminations}</td>
                <td className={tdNum}>{m.total}</td>
              </tr>
            ))}
          </ReportTable>

          <ReportTable
            title="By reason"
            empty={report.byReason.length === 0}
            head={
              <tr>
                <th className={th}>Reason</th>
                <th className={thNum}>Exits</th>
                <th className={thNum}>Share</th>
              </tr>
            }
          >
            {report.byReason.map((r) => (
              <tr key={r.category}>
                <td className={`${td} font-semibold`}>{r.label}</td>
                <td className={tdNum}>{r.count}</td>
                <td className={tdNum}>{r.share === null ? '' : `${r.share}%`}</td>
              </tr>
            ))}
          </ReportTable>
        </div>

        <ReportTable title="Exits" note={plural(report.real.length, 'exit')} empty={report.real.length === 0} emptyText="No exits in this period" head={exitHead}>
          {exitRows(report.real)}
        </ReportTable>

        {report.notExits.length > 0 && (
          <ReportTable title="Declined or cancelled" note="Not counted as exits" head={exitHead}>
            {exitRows(report.notExits)}
          </ReportTable>
        )}
      </div>
    </ReportFrame>
  );
}
