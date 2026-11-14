import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HandCoins, Layers, Users, Wallet } from 'lucide-react';
import { StatCard, StatusPill } from '../UI';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../lib/fetchAll';
import { money } from '../../lib/payroll/currency';
import { useBranches } from '../../hooks/useBranches';
import { useDepartments } from '../../hooks/useDepartments';
import { type Row, downloadXlsx, monthOf, monthsBetween, plural, readReportEmployees, shortMonth } from '../../lib/reports/reportKit';
import {
  byDeduction,
  byEmployee,
  currencyEntries,
  deductionEntries,
  deductionSheet,
  deductionSummary,
  defaultRange,
  filterPayslips,
  latestPeriod,
  standingDeductions,
} from '../../lib/reports/payrollReports';
import { BranchFilter, DepartmentFilter, MonthFilter, ReportFrame, ReportTable, SearchFilter, StatGrid, td, tdNum, th, thNum } from './ReportFrame';

// /reports/other-deductions: what was taken from pay besides the statutory deductions over a range of months (each
// deduction line, loan repayments, salary advances and welfare), by deduction and by employee, and the standing
// deductions set up now. Money is totalled per currency, never across currencies.

const PAYSLIP_COLUMNS = 'id, employee_id, employee_name, pay_period, currency, loan_deduction, advance_deduction, welfare_deduction, other_deductions, deduction_items';

const problemOf = (what: string, error: unknown) =>
  error ? `Couldn't read ${what}: ${(error as { message?: string })?.message ?? String(error)}.` : null;

/** Per-currency amounts: one line each, KES first; a dash for none. */
function Amounts({ totals, zero = '-' }: { totals: Record<string, number> | undefined; zero?: string }) {
  const entries = currencyEntries(totals ?? {}).filter(([, n]) => n !== 0);
  if (entries.length === 0) return <>{zero}</>;
  if (entries.length === 1) return <>{money(entries[0][1], entries[0][0])}</>;
  return (
    <span className="flex flex-col">
      {entries.map(([c, n]) => (
        <span key={c}>{money(n, c)}</span>
      ))}
    </span>
  );
}

const periodText = (p: string | null, open: string) => (p ? shortMonth(p) : open);

export default function OtherDeductionsReport() {
  const { departments } = useDepartments();
  const { branches } = useBranches();
  const [pickedFrom, setFrom] = useState<string | null>(null);
  const [pickedTo, setTo] = useState<string | null>(null);
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
  const range = defaultRange(latest.data ?? null);
  const chosenFrom = pickedFrom ?? range.from;
  const chosenTo = pickedTo ?? range.to;
  const [from, to] = chosenFrom <= chosenTo ? [chosenFrom, chosenTo] : [chosenTo, chosenFrom];
  const months = useMemo(() => monthsBetween(from, to), [from, to]);

  const payslips = useQuery({
    queryKey: ['reports', 'other-deductions', from, to],
    enabled: !latest.isLoading,
    queryFn: () =>
      fetchAll<Row>((a, b) => supabase.from('salary_history').select(PAYSLIP_COLUMNS).gte('pay_period', from).lte('pay_period', to).order('id').range(a, b)),
  });
  const employees = useQuery({ queryKey: ['reports', 'employees'], queryFn: readReportEmployees });
  const setup = useQuery({
    queryKey: ['reports', 'deduction-setup'],
    queryFn: async () => {
      const [types, deductions] = await Promise.all([
        supabase.from('deduction_types').select('id, name, active').order('name'),
        fetchAll<Row>((a, b) =>
          supabase.from('employee_deductions').select('id, employee_number, deduction_type_id, amount, start_period, end_period, notes').order('id').range(a, b)
        ),
      ]);
      if (types.error) throw types.error;
      return { types: (types.data ?? []) as Row[], deductions };
    },
  });

  const filters = useMemo(() => ({ branchId, departmentId, search }), [branchId, departmentId, search]);
  const entries = useMemo(
    () => deductionEntries(filterPayslips(payslips.data ?? [], employees.data ?? [], filters), employees.data ?? [], departments),
    [payslips.data, employees.data, filters, departments]
  );
  const summary = useMemo(() => deductionSummary(entries), [entries]);
  const kinds = useMemo(() => byDeduction(entries, months), [entries, months]);
  const people = useMemo(() => byEmployee(entries), [entries]);
  const currencies = useMemo(() => currencyEntries(summary.total).map(([c]) => c), [summary.total]);
  const standing = useMemo(() => {
    const currencyOf = new Map(branches.map((b) => [b.id, b.currency]));
    return standingDeductions(
      setup.data?.deductions ?? [],
      setup.data?.types ?? [],
      employees.data ?? [],
      departments,
      filters,
      monthOf(),
      (id) => (id && currencyOf.get(id)) || 'KES'
    );
  }, [setup.data, employees.data, departments, filters, branches]);

  const problems = [
    problemOf('payslips', latest.error ?? payslips.error),
    problemOf('staff details', employees.error),
    problemOf('deductions set up', setup.error),
  ].filter((p): p is string => !!p);

  const download = () => {
    const sheet = deductionSheet(people);
    downloadXlsx(`other-deductions-${from}-to-${to}.xlsx`, sheet.headers, sheet.rows, 'By employee');
  };
  const several = currencies.length > 1;
  const icon = 'w-[18px] h-[18px]';

  return (
    <ReportFrame
      title="Staff other deductions"
      subtitle={`${from === to ? shortMonth(from) : `${shortMonth(from)} to ${shortMonth(to)}`} · loans, advances, welfare and other deductions`}
      onDownload={people.rows.length ? download : undefined}
      loading={latest.isLoading || payslips.isLoading || employees.isLoading}
      problems={problems}
      filters={
        <>
          <MonthFilter label="From" value={from} onChange={setFrom} />
          <MonthFilter label="To" value={to} onChange={setTo} />
          <BranchFilter value={branchId} onChange={setBranchId} />
          <DepartmentFilter value={departmentId} onChange={setDepartmentId} />
          <SearchFilter value={search} onChange={setSearch} />
        </>
      }
    >
      <div className="space-y-4">
        <StatGrid>
          <StatCard label="Total deducted" value={<Amounts totals={summary.total} zero={money(0, 'KES')} />} icon={<Wallet className={icon} strokeWidth={1.8} />} />
          <StatCard label="Staff with deductions" value={summary.staff.toLocaleString()} icon={<Users className={icon} strokeWidth={1.8} />} tint="info" />
          <StatCard label="Kinds of deduction" value={summary.kinds.toLocaleString()} icon={<Layers className={icon} strokeWidth={1.8} />} tint="purple" />
          <StatCard
            label="Salary advances recovered"
            value={<Amounts totals={summary.advances} zero={money(0, 'KES')} />}
            icon={<HandCoins className={icon} strokeWidth={1.8} />}
            tint="orange"
          />
        </StatGrid>

        <ReportTable
          title="By deduction"
          note={several ? 'Totals are per currency' : undefined}
          empty={kinds.length === 0}
          emptyText="No deductions in these months"
          head={
            <tr>
              <th className={th}>Deduction</th>
              <th className={thNum}>Staff</th>
              {months.map((m) => (
                <th key={m} className={thNum}>
                  {shortMonth(m)}
                </th>
              ))}
              <th className={thNum}>Total</th>
            </tr>
          }
        >
          {kinds.map((k) => (
            <tr key={k.kind}>
              <td className={`${td} font-semibold`}>{k.kind}</td>
              <td className={tdNum}>{k.staff.toLocaleString()}</td>
              {months.map((m) => (
                <td key={m} className={tdNum}>
                  <Amounts totals={k.byMonth[m]} />
                </td>
              ))}
              <td className={`${tdNum} font-semibold`}>
                <Amounts totals={k.total} />
              </td>
            </tr>
          ))}
        </ReportTable>

        <ReportTable
          title="By employee"
          note={plural(people.rows.length, 'person', 'people')}
          empty={people.rows.length === 0}
          emptyText="No deductions in these months"
          head={
            <tr>
              <th className={th}>Employee</th>
              <th className={th}>Department</th>
              {people.kinds.map((k) => (
                <th key={k} className={thNum}>
                  {k}
                </th>
              ))}
              <th className={thNum}>Total</th>
            </tr>
          }
          foot={currencies.map((c) => (
            <tr key={c}>
              <td className={`${td} font-bold`} colSpan={2}>
                {several ? `Total (${c})` : 'Total'}
              </td>
              {kinds.map((k) => (
                <td key={k.kind} className={`${tdNum} font-bold`}>
                  {k.total[c] ? money(k.total[c], c) : '-'}
                </td>
              ))}
              <td className={`${tdNum} font-bold`}>{money(summary.total[c] ?? 0, c)}</td>
            </tr>
          ))}
        >
          {people.rows.map((r) => (
            <tr key={`${r.employeeNumber}-${r.currency}`}>
              <td className={td}>
                <span className="font-semibold">{r.name}</span> <span className="text-muted-foreground">{r.employeeNumber}</span>
              </td>
              <td className={td}>{r.department}</td>
              {people.kinds.map((k) => (
                <td key={k} className={tdNum}>
                  {r.amounts[k] ? money(r.amounts[k], r.currency) : '-'}
                </td>
              ))}
              <td className={`${tdNum} font-semibold`}>{money(r.total, r.currency)}</td>
            </tr>
          ))}
        </ReportTable>

        <ReportTable
          title="Set up now"
          note="Deductions taken every month until they end"
          empty={standing.length === 0}
          emptyText={setup.isLoading ? 'Loading' : 'No deductions set up'}
          head={
            <tr>
              <th className={th}>Employee</th>
              <th className={th}>Department</th>
              <th className={th}>Deduction</th>
              <th className={thNum}>Amount</th>
              <th className={th}>From</th>
              <th className={th}>To</th>
              <th className={th}>Notes</th>
            </tr>
          }
        >
          {standing.map((d, i) => (
            <tr key={`${d.employeeNumber}-${d.kind}-${i}`}>
              <td className={td}>
                <span className="font-semibold">{d.name}</span> <span className="text-muted-foreground">{d.employeeNumber}</span>
              </td>
              <td className={td}>{d.department}</td>
              <td className={td}>
                {d.kind} {d.paused && <StatusPill label="Paused" className="ml-1" />}
              </td>
              <td className={tdNum}>{money(d.amount, d.currency)}</td>
              <td className={td}>{periodText(d.from, 'Start')}</td>
              <td className={td}>{periodText(d.to, 'No end')}</td>
              <td className={`${td} text-muted-foreground`}>{d.notes}</td>
            </tr>
          ))}
        </ReportTable>
      </div>
    </ReportFrame>
  );
}
