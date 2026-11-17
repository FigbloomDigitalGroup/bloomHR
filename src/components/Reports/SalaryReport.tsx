import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Landmark, Users, Wallet } from 'lucide-react';
import { StatCard, StatusPill, type StatusTone } from '../UI';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../lib/fetchAll';
import { money } from '../../lib/payroll/currency';
import { payPeriodLabel } from '../../lib/payPeriod';
import { useDepartments } from '../../hooks/useDepartments';
import { type Row, addMonths, downloadXlsx, monthsBetween, plural, readReportEmployees, shortMonth } from '../../lib/reports/reportKit';
import {
  type RunStatus,
  SALARY_AMOUNTS,
  currencyEntries,
  defaultMonth,
  filterPayslips,
  latestPeriod,
  monthTrend,
  runStatus,
  salaryLines,
  salarySheet,
  salarySummary,
  salaryTotals,
} from '../../lib/reports/payrollReports';
import { BranchFilter, DepartmentFilter, MonthFilter, ReportFrame, ReportTable, SearchFilter, td, tdNum, th, thNum } from './ReportFrame';

// /reports/staff-salary: every payslip of a month with its pay, statutory and other deductions and net, the month's
// totals and payroll status, and the six months before. Money is totalled per currency, never across currencies.

const PAYSLIP_COLUMNS =
  'id, employee_id, employee_name, pay_period, currency, basic_salary, house_allowance, transport_allowance, medical_allowance, ' +
  'other_allowances, overtime_pay, work_pay, jobs_pay, gross_pay, paye_tax, nhif_deduction, nssf_deduction, housing_levy, ' +
  'loan_deduction, advance_deduction, welfare_deduction, other_deductions, net_pay, payment_method';

const problemOf = (what: string, error: unknown) =>
  error ? `Couldn't read ${what}: ${(error as { message?: string })?.message ?? String(error)}.` : null;

/** Per-currency amounts: one line each, KES first. */
function Amounts({ totals }: { totals: Record<string, number> }) {
  const entries = currencyEntries(totals);
  if (entries.length === 0) return <>{money(0, 'KES')}</>;
  if (entries.length === 1) return <>{money(entries[0][1], entries[0][0])}</>;
  return (
    <span className="flex flex-col">
      {entries.map(([c, n]) => (
        <span key={c}>{money(n, c)}</span>
      ))}
    </span>
  );
}

const STATUS: Record<RunStatus, { label: string; tone: StatusTone }> = {
  draft: { label: 'Draft', tone: 'warning' },
  approved: { label: 'Approved', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
};

export default function SalaryReport() {
  const { departments } = useDepartments();
  const [picked, setPicked] = useState<string | null>(null);
  const [branchId, setBranchId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [search, setSearch] = useState('');

  const latest = useQuery({
    queryKey: ['reports', 'latest-pay-period'],
    queryFn: async () => {
      const { data, error } = await supabase.from('salary_history').select('pay_period').order('pay_period', { ascending: false }).limit(1);
      if (error) throw error;
      return latestPeriod((data ?? []).map((r: Row) => r.pay_period));
    },
  });
  const month = picked ?? defaultMonth(latest.data ?? null);
  const firstMonth = addMonths(month, 5);

  const payslips = useQuery({
    queryKey: ['reports', 'staff-salary', firstMonth, month],
    enabled: !latest.isLoading,
    queryFn: () =>
      fetchAll<Row>((from, to) =>
        supabase.from('salary_history').select(PAYSLIP_COLUMNS).gte('pay_period', firstMonth).lte('pay_period', month).order('id').range(from, to)
      ),
  });
  const employees = useQuery({ queryKey: ['reports', 'employees'], queryFn: readReportEmployees });
  const runs = useQuery({
    queryKey: ['reports', 'payroll-runs', month],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_runs').select('id, pay_period, status').eq('pay_period', month);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const filters = useMemo(() => ({ branchId, departmentId, search }), [branchId, departmentId, search]);
  const inRange = useMemo(() => filterPayslips(payslips.data ?? [], employees.data ?? [], filters), [payslips.data, employees.data, filters]);
  const lines = useMemo(
    () => salaryLines(inRange.filter((p) => String(p.pay_period).slice(0, 7) === month), employees.data ?? [], departments),
    [inRange, month, employees.data, departments]
  );
  const totals = useMemo(() => salaryTotals(lines), [lines]);
  const summary = useMemo(() => salarySummary(lines), [lines]);
  const trend = useMemo(() => monthTrend(inRange, monthsBetween(firstMonth, month)).reverse(), [inRange, firstMonth, month]);
  const status = runStatus(runs.data ?? [], month);

  const problems = [
    problemOf('payslips', latest.error ?? payslips.error),
    problemOf('staff details', employees.error),
    problemOf('payroll status', runs.error),
  ].filter((p): p is string => !!p);

  const download = () => {
    const sheet = salarySheet(lines);
    downloadXlsx(`staff-salary-${month}.xlsx`, sheet.headers, sheet.rows, 'Staff salary');
  };
  const several = totals.length > 1;

  return (
    <ReportFrame
      title="Staff salary"
      subtitle={`${payPeriodLabel(month)} · ${plural(lines.length, 'payslip')}`}
      onDownload={lines.length ? download : undefined}
      loading={latest.isLoading || payslips.isLoading || employees.isLoading}
      problems={problems}
      filters={
        <>
          <MonthFilter value={month} onChange={setPicked} />
          <BranchFilter value={branchId} onChange={setBranchId} />
          <DepartmentFilter value={departmentId} onChange={setDepartmentId} />
          <SearchFilter value={search} onChange={setSearch} />
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatCard label="Staff paid" value={summary.staff.toLocaleString()} icon={<Users className="w-[18px] h-[18px]" strokeWidth={1.8} />} tint="info" />
          <StatCard label="Total gross" value={<Amounts totals={summary.gross} />} icon={<Wallet className="w-[18px] h-[18px]" strokeWidth={1.8} />} />
          <StatCard label="Total net" value={<Amounts totals={summary.net} />} icon={<Wallet className="w-[18px] h-[18px]" strokeWidth={1.8} />} />
          <StatCard
            label="Total statutory"
            value={<Amounts totals={summary.statutory} />}
            note="PAYE, SHIF, NSSF and Housing Levy"
            icon={<Landmark className="w-[18px] h-[18px]" strokeWidth={1.8} />}
            tint="orange"
          />
          <StatCard
            label="Payroll status"
            value={status ? <StatusPill label={STATUS[status].label} tone={STATUS[status].tone} /> : <StatusPill label="Not run" />}
            icon={<ClipboardCheck className="w-[18px] h-[18px]" strokeWidth={1.8} />}
            tint="purple"
          />
        </div>

        <ReportTable
          title="Payslips"
          note={several ? 'Totals are per currency' : undefined}
          empty={lines.length === 0}
          emptyText="No payslips for this month"
          head={
            <tr>
              <th className={th}>Employee no.</th>
              <th className={th}>Name</th>
              <th className={th}>Department</th>
              <th className={th}>Job group</th>
              {SALARY_AMOUNTS.map((a) => (
                <th key={a.key} className={thNum}>
                  {a.label}
                </th>
              ))}
              <th className={th}>Payment method</th>
            </tr>
          }
          foot={totals.map((t) => (
            <tr key={t.currency}>
              <td className={`${td} font-bold`} colSpan={4}>
                {several ? `Total (${t.currency})` : 'Total'}
              </td>
              {SALARY_AMOUNTS.map((a) => (
                <td key={a.key} className={`${tdNum} font-bold`}>
                  {money(t[a.key], t.currency)}
                </td>
              ))}
              <td className={td} />
            </tr>
          ))}
        >
          {lines.map((l, i) => (
            <tr key={`${l.employeeNumber}-${i}`}>
              <td className={td}>{l.employeeNumber}</td>
              <td className={`${td} font-semibold`}>{l.name}</td>
              <td className={td}>{l.department}</td>
              <td className={td}>{l.jobGroup}</td>
              {SALARY_AMOUNTS.map((a) => (
                <td key={a.key} className={`${tdNum} ${a.key === 'net' ? 'font-semibold' : ''}`}>
                  {money(l[a.key], l.currency)}
                </td>
              ))}
              <td className={td}>{l.paymentMethod}</td>
            </tr>
          ))}
        </ReportTable>

        <div className="max-w-2xl">
          <ReportTable
            title="Last 6 months"
            head={
              <tr>
                <th className={th}>Month</th>
                <th className={thNum}>Staff paid</th>
                <th className={thNum}>Gross</th>
                <th className={thNum}>Net</th>
              </tr>
            }
          >
            {trend.map((t) => (
              <tr key={t.month}>
                <td className={td}>{shortMonth(t.month)}</td>
                <td className={tdNum}>{t.staff.toLocaleString()}</td>
                <td className={tdNum}>
                  <Amounts totals={t.gross} />
                </td>
                <td className={tdNum}>
                  <Amounts totals={t.net} />
                </td>
              </tr>
            ))}
          </ReportTable>
        </div>
      </div>
    </ReportFrame>
  );
}
