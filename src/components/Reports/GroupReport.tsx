import { useMemo, useState } from 'react';
import { Download, Users } from 'lucide-react';
import { saveAs } from 'file-saver';
import { Button, Card, EmptyState, PageHeader, TabBar, TableScroll } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import { usePermissions } from '../../hooks/usePermissions';
import { useBranches } from '../../hooks/useBranches';
import useCountryRates from '../../hooks/useCountryRates';
import type { Branch } from '../../lib/branches';
import type { Rates } from '../../lib/statutoryCalc';
import { money } from '../../lib/payroll/currency';
import { payPeriodLabel } from '../../lib/payPeriod';
import { XLSX_TYPE } from '../../lib/xlsxExport';
import {
  type Breakdown,
  type CountryPayrollSummary,
  type HrInput,
  type ReportScope,
  costByBranchDepartment,
  hrReport,
  payrollSummary,
  payrollSummaryWorkbook,
  payslipsInScope,
  remittanceSummary,
  scopeLabel,
  scopeOptions,
  summaryByCurrency,
} from '../../lib/reports/groupReports';
import { PerCurrencyNote } from './CurrencyCards';
import { useGroupReportData } from './useGroupReportData';

// Reports across countries (FIG-905 stage 5): the group view of a company with staff in several countries. People
// numbers are added up across countries; money is shown per currency, never added across currencies.
//
// Gating as the other reports: headcount and HR numbers for the reports or employees modules; the payroll summary,
// remittances and cost by branch for payroll (the payslips behind them are payroll's).

/* eslint-disable @typescript-eslint/no-explicit-any -- the untyped rows the reports add up */
type Row = Record<string, any>;

export type GroupTab = 'people' | 'payroll' | 'remittances' | 'cost';

export interface GroupReportViewProps {
  month: string;
  branches: Branch[];
  employees: Row[];
  payslips: Row[];
  hr?: Pick<HrInput, 'exits' | 'leaves' | 'absences' | 'casualDays'>;
  ratesByCountry: Map<string, Rates | null>;
  canPeople: boolean;
  canPayroll: boolean;
  initialScope?: ReportScope;
  initialTab?: GroupTab;
  onMonthChange?: (month: string) => void;
  problems?: string[];
}

const fmt = (n: number, currency: string) => money(Math.round(n * 100) / 100, currency);
const th = 'px-3 py-2 text-left text-[11px] font-bold text-muted-foreground whitespace-nowrap';
const td = 'px-3 py-2 text-[12.5px] text-ink whitespace-nowrap';
const tdNum = `${td} text-right tabular-nums`;

/** "Payroll summary, October 2026 (2026-10).xlsx" */
export function downloadPayrollSummary(countries: CountryPayrollSummary[], month: string) {
  const bytes = payrollSummaryWorkbook(countries, month);
  saveAs(new Blob([bytes], { type: XLSX_TYPE }), `payroll-summary-${month}.xlsx`);
}

function BreakdownList({ breakdown, unit }: { breakdown: Breakdown; unit?: string }) {
  if (breakdown.byCountry.length === 0) return <p className="text-[12px] text-muted-foreground">None</p>;
  return (
    <ul className="space-y-1">
      {breakdown.byCountry.map((c) => (
        <li key={c.country} className="text-[12px]">
          <span className="font-semibold text-ink">{c.country}</span> <span className="text-ink">{c.count}{unit ? ` ${unit}` : ''}</span>
          {c.branches.length > 1 && (
            <span className="text-muted-foreground"> ({c.branches.map((b) => `${b.name} ${b.count}`).join(', ')})</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function PeopleTab(props: { month: string; employees: Row[]; branches: Branch[]; scope: ReportScope; hr?: GroupReportViewProps['hr'] }) {
  const report = useMemo(() => hrReport({ month: props.month, employees: props.employees, branches: props.branches, scope: props.scope, ...props.hr }), [props]);
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-bold text-ink">Headcount</h2>
          <span className="text-2xl font-bold text-ink" data-testid="headcount-total">{report.headcount.total}</span>
        </div>
        <p className="text-[11.5px] text-muted-foreground mb-3">People are counted across every country.</p>
        <BreakdownList breakdown={report.headcount} />
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {report.metrics.map((m) => (
          <Card key={m.key}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[12.5px] font-bold text-ink">{m.label}</h3>
              <span className="text-lg font-bold text-ink">{m.breakdown.total}{m.unit === 'days' ? ' days' : ''}</span>
            </div>
            <BreakdownList breakdown={m.breakdown} unit={m.unit === 'days' ? 'days' : undefined} />
          </Card>
        ))}
        <Card>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[12.5px] font-bold text-ink">Turnover</h3>
            <span className="text-lg font-bold text-ink">{report.turnover.total}%</span>
          </div>
          <p className="text-[11px] text-muted-foreground mb-1">Leavers this month for every 100 people.</p>
          <ul className="space-y-1">
            {report.turnover.byCountry.map((c) => (
              <li key={c.country} className="text-[12px]"><span className="font-semibold">{c.country}</span> {c.percent}%</li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function CurrencySummaryTable({ countries }: { countries: CountryPayrollSummary[] }) {
  const rows = summaryByCurrency(countries);
  if (rows.length < 2) return null;
  return (
    <Card>
      <h2 className="text-[13px] font-bold text-ink mb-1">Summary by currency</h2>
      <PerCurrencyNote />
      <TableScroll className="mt-3">
        <table className="min-w-full" data-testid="currency-summary">
          <thead>
            <tr>
              {['Currency', 'Countries', 'Headcount', 'Gross pay', 'Deductions', 'Net pay', 'Employer costs', 'Total employer cost'].map((h) => <th key={h} className={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.currency} className="border-t border-border">
                <td className={td}>{r.currency}</td>
                <td className={td}>{r.countries.join(', ')}</td>
                <td className={tdNum}>{r.headcount}</td>
                <td className={tdNum}>{fmt(r.gross, r.currency)}</td>
                <td className={tdNum}>{fmt(r.totalDeductions, r.currency)}</td>
                <td className={tdNum}>{fmt(r.net, r.currency)}</td>
                <td className={tdNum}>{fmt(r.employerCostTotal, r.currency)}</td>
                <td className={tdNum}>{fmt(r.totalCost, r.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </Card>
  );
}

function PayrollTab({ countries, month }: { countries: CountryPayrollSummary[]; month: string }) {
  if (countries.length === 0) {
    return <EmptyState icon={<Users className="w-[18px] h-[18px]" strokeWidth={2} />} title="No payslips for this month" description="Run payroll for the month to see its summary." />;
  }
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="secondary" icon={<Download className="w-3.5 h-3.5" />} onClick={() => downloadPayrollSummary(countries, month)}>
          Download Excel
        </Button>
      </div>
      <CurrencySummaryTable countries={countries} />
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {countries.map((c) => (
          <Card key={`${c.country}-${c.currency}`} data-testid={`payroll-${c.country}`}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[13px] font-bold text-ink">{c.country}</h2>
              <span className="text-[11px] font-semibold text-muted-foreground">{c.currency} · {c.headcount} {c.headcount === 1 ? 'person' : 'people'}</span>
            </div>
            <table className="w-full">
              <tbody>
                <tr><td className={td}>Gross pay</td><td className={tdNum}>{fmt(c.gross, c.currency)}</td></tr>
                {c.statutory.map((l) => (
                  <tr key={l.label}><td className={`${td} pl-6 text-muted-foreground`}>{l.label}</td><td className={tdNum}>{fmt(l.amount, c.currency)}</td></tr>
                ))}
                <tr><td className={`${td} pl-6 text-muted-foreground`}>Loans and advances</td><td className={tdNum}>{fmt(c.loans, c.currency)}</td></tr>
                <tr><td className={`${td} pl-6 text-muted-foreground`}>Other deductions</td><td className={tdNum}>{fmt(c.otherDeductions, c.currency)}</td></tr>
                <tr className="border-t border-border"><td className={`${td} font-bold`}>Net pay</td><td className={`${tdNum} font-bold`}>{fmt(c.net, c.currency)}</td></tr>
                {c.employerCosts.map((l) => (
                  <tr key={l.label}><td className={`${td} pl-6 text-muted-foreground`}>{l.label}</td><td className={tdNum}>{fmt(l.amount, c.currency)}</td></tr>
                ))}
                <tr className="border-t border-border"><td className={`${td} font-bold`}>Total employer cost</td><td className={`${tdNum} font-bold`}>{fmt(c.totalCost, c.currency)}</td></tr>
              </tbody>
            </table>
          </Card>
        ))}
      </div>
    </div>
  );
}

function RemittancesTab({ lines, month }: { lines: ReturnType<typeof payslipsInScope>; month: string }) {
  const countries = remittanceSummary(lines, month);
  if (countries.length === 0) {
    return <EmptyState icon={<Users className="w-[18px] h-[18px]" strokeWidth={2} />} title="Nothing to remit" description="Remittances show once the month's payslips are saved." />;
  }
  return (
    <div className="space-y-4">
      {countries.length > 1 && <PerCurrencyNote />}
      {countries.map((c) => (
        <Card key={`${c.country}-${c.currency}`} data-testid={`remit-${c.country}`}>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[13px] font-bold text-ink">{c.country}</h2>
            <span className="text-[12px] font-semibold text-ink">{fmt(c.total, c.currency)} in all</span>
          </div>
          <TableScroll>
            <table className="min-w-full">
              <thead>
                <tr>{['Pay to', 'For', 'Employees', 'Employer', 'Amount', 'Due'].map((h) => <th key={h} className={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {c.items.map((i) => (
                  <tr key={`${i.authority}-${i.label}`} className="border-t border-border">
                    <td className={`${td} font-semibold`}>{i.authority}</td>
                    <td className={td}>{i.label}</td>
                    <td className={tdNum}>{i.employee === undefined ? '' : fmt(i.employee, c.currency)}</td>
                    <td className={tdNum}>{i.employer === undefined ? '' : fmt(i.employer, c.currency)}</td>
                    <td className={`${tdNum} font-semibold`}>{fmt(i.amount, c.currency)}</td>
                    <td className={`${td} text-muted-foreground`}>{i.dueNote}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      ))}
    </div>
  );
}

function CostTab({ lines, employees }: { lines: ReturnType<typeof payslipsInScope>; employees: Row[] }) {
  const groups = costByBranchDepartment(lines, employees);
  if (groups.length === 0) {
    return <EmptyState icon={<Users className="w-[18px] h-[18px]" strokeWidth={2} />} title="No payroll costs" description="Costs show once the month's payslips are saved." />;
  }
  return (
    <div className="space-y-4">
      {groups.length > 1 && <PerCurrencyNote />}
      {groups.map((g) => (
        <Card key={g.currency} data-testid={`cost-${g.currency}`}>
          <h2 className="text-[13px] font-bold text-ink mb-2">{g.currency}</h2>
          <TableScroll>
            <table className="min-w-full">
              <thead>
                <tr>{['Country', 'Branch', 'Department', 'People', 'Gross pay', 'Employer costs', 'Total employer cost'].map((h) => <th key={h} className={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={`${r.country}-${r.branch}-${r.department}`} className="border-t border-border">
                    <td className={td}>{r.country}</td>
                    <td className={td}>{r.branch}</td>
                    <td className={td}>{r.department}</td>
                    <td className={tdNum}>{r.headcount}</td>
                    <td className={tdNum}>{fmt(r.gross, r.currency)}</td>
                    <td className={tdNum}>{fmt(r.employerCosts, r.currency)}</td>
                    <td className={tdNum}>{fmt(r.totalCost, r.currency)}</td>
                  </tr>
                ))}
                <tr className="border-t border-border font-bold">
                  <td className={`${td} font-bold`} colSpan={3}>Total ({g.currency})</td>
                  <td className={`${tdNum} font-bold`}>{g.total.headcount}</td>
                  <td className={`${tdNum} font-bold`}>{fmt(g.total.gross, g.currency)}</td>
                  <td className={`${tdNum} font-bold`}>{fmt(g.total.employerCosts, g.currency)}</td>
                  <td className={`${tdNum} font-bold`}>{fmt(g.total.totalCost, g.currency)}</td>
                </tr>
              </tbody>
            </table>
          </TableScroll>
        </Card>
      ))}
    </div>
  );
}

/** The report itself, from rows already read (the page reads them; tests hand them in). */
export function GroupReportView(props: GroupReportViewProps) {
  const { month, branches, employees, payslips, ratesByCountry, canPeople, canPayroll } = props;
  const tabs = [
    ...(canPeople ? [{ id: 'people', label: 'People' }] : []),
    ...(canPayroll
      ? [{ id: 'payroll', label: 'Payroll summary' }, { id: 'remittances', label: 'Statutory remittances' }, { id: 'cost', label: 'Cost by branch' }]
      : []),
  ];
  const [tab, setTab] = useState<string>(props.initialTab && tabs.some((t) => t.id === props.initialTab) ? props.initialTab : tabs[0]?.id ?? '');
  const [scope, setScope] = useState<ReportScope>(props.initialScope ?? 'all');
  const payslipCountries = useMemo(() => payslips.map((p) => String(p.country ?? '')).filter(Boolean), [payslips]);
  const options = useMemo(() => scopeOptions(branches, payslipCountries), [branches, payslipCountries]);
  const lines = useMemo(
    () => (canPayroll ? payslipsInScope(payslips, employees, branches, scope, ratesByCountry) : []),
    [canPayroll, payslips, employees, branches, scope, ratesByCountry]
  );
  const countries = useMemo(() => payrollSummary(lines), [lines]);

  if (tabs.length === 0) {
    return <EmptyState icon={<Users className="w-[18px] h-[18px]" strokeWidth={2} />} title="Nothing to show" description="Your role doesn't include the reports, employees or payroll modules." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[11.5px] font-semibold text-muted-foreground">
          Month
          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && props.onMonthChange?.(e.target.value)}
            className="block mt-1 px-3 py-2 border border-border rounded-tile text-xs bg-white"
          />
        </label>
        {options.length > 1 && (
          <label className="text-[11.5px] font-semibold text-muted-foreground">
            Country or branch
            <select
              aria-label="Country or branch"
              value={scope}
              onChange={(e) => setScope(e.target.value as ReportScope)}
              className="block mt-1 px-3 py-2 border border-border rounded-tile text-xs bg-white"
            >
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        )}
        <p className="text-[11.5px] text-muted-foreground pb-2">{scopeLabel(scope, branches)} · {payPeriodLabel(month, month)}</p>
      </div>
      {props.problems && props.problems.length > 0 && (
        <p className="text-[11.5px] text-orange-text">Couldn't read: {props.problems.join(', ')}. Those numbers are left out.</p>
      )}
      <TabBar items={tabs} activeId={tab} onChange={setTab} />
      {tab === 'people' && <PeopleTab month={month} employees={employees} branches={branches} scope={scope} hr={props.hr} />}
      {tab === 'payroll' && <PayrollTab countries={countries} month={month} />}
      {tab === 'remittances' && <RemittancesTab lines={lines} month={month} />}
      {tab === 'cost' && <CostTab lines={lines} employees={employees} />}
    </div>
  );
}

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** /reports/group: reads the month's rows and shows the report. */
export default function GroupReport() {
  const { hasPermission, hasAnyPermission, loading: permissionsLoading } = usePermissions();
  const canPayroll = hasPermission('payroll');
  const canPeople = hasAnyPermission(['reports', 'employees']);
  const [month, setMonth] = useState(thisMonth);
  const { branches, loading: branchesLoading } = useBranches();
  const data = useGroupReportData({ month, payroll: canPayroll, people: canPeople });
  const rateCountries = useMemo(() => [...new Set(data.payslips.map((p) => String(p.country || 'Kenya')))].sort(), [data.payslips]);
  const { ratesByCountry } = useCountryRates(month, rateCountries);
  // Kenya's employer shares need the month's rates: hold the money back until they are in
  const busy = data.loading || (rateCountries.length > 0 && !ratesByCountry);

  return (
    <div className="p-6 bg-background min-h-screen">
      <div className="max-w-7xl mx-auto space-y-4">
        <PageHeader title="Group report" subtitle="People across every country; money per currency" />
        {permissionsLoading || branchesLoading ? (
          <div className="flex justify-center items-center h-64"><FigbloomLoader label="Loading the report" /></div>
        ) : (
          <div className={busy ? 'opacity-50 pointer-events-none' : ''} aria-busy={busy}>
            <GroupReportView
              month={month}
              onMonthChange={setMonth}
              branches={branches}
              employees={data.employees}
              payslips={busy ? [] : data.payslips}
              hr={{ exits: data.exits, leaves: data.leaves, absences: data.absences, casualDays: data.casualDays }}
              ratesByCountry={ratesByCountry ?? new Map()}
              canPeople={canPeople}
              canPayroll={canPayroll}
              problems={data.problems}
            />
          </div>
        )}
      </div>
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
