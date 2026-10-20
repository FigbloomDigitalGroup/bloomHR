import { useEffect, useMemo, useState } from 'react';
import { Globe } from 'lucide-react';
import { Card } from '../UI';
import { usePermissions } from '../../hooks/usePermissions';
import { useBranches } from '../../hooks/useBranches';
import useCountryRates from '../../hooks/useCountryRates';
import type { Branch } from '../../lib/branches';
import type { Rates } from '../../lib/statutoryCalc';
import { payPeriodLabel } from '../../lib/payPeriod';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../lib/fetchAll';
import {
  type ReportScope,
  countByPlace,
  inScope,
  isCurrentEmployee,
  payrollSummary,
  payslipsInScope,
  placeOfEmployee,
  scopeOptions,
  summaryByCurrency,
} from '../../lib/reports/groupReports';
import CurrencyCards from '../Reports/CurrencyCards';
import { previousMonth, useGroupReportData } from '../Reports/useGroupReportData';
import { BarList } from './DashboardCharts';

// The dashboard's group view (FIG-905): a country or branch filter, headcount by country, and the latest month's payroll
// money per currency, with the change on the month before for gross and net pay. A company in one country with one
// branch sees just the payroll cards, as before; nothing at all for a role without payroll.

/* eslint-disable @typescript-eslint/no-explicit-any -- the untyped rows the reports add up */
type Row = Record<string, any>;

export interface GroupOverviewViewProps {
  branches: Branch[];
  employees: Row[];
  payslips: Row[];
  /** the period before's payslips, for the change on it (gross and net pay only: they are on the payslip itself) */
  previousPayslips?: Row[];
  payPeriod: string;
  ratesByCountry: Map<string, Rates | null>;
  canPayroll: boolean;
}

export function GroupOverviewView({ branches, employees, payslips, previousPayslips = [], payPeriod, ratesByCountry, canPayroll }: GroupOverviewViewProps) {
  const [scope, setScope] = useState<ReportScope>('all');
  const options = useMemo(() => scopeOptions(branches, payslips.map((p) => String(p.country ?? '')).filter(Boolean)), [branches, payslips]);
  const headcount = useMemo(
    () => countByPlace(employees.filter(isCurrentEmployee).map((e) => ({ place: placeOfEmployee(e, branches) })).filter((i) => inScope(i.place, scope))),
    [employees, branches, scope]
  );
  const money = useMemo(() => {
    if (!canPayroll) return [];
    const totals = (rows: Row[]) => summaryByCurrency(payrollSummary(payslipsInScope(rows, employees, branches, scope, ratesByCountry)));
    const before = new Map(totals(previousPayslips).map((c) => [c.currency, c]));
    return totals(payslips).map((c) => {
      const prev = before.get(c.currency);
      return {
        currency: c.currency,
        figures: [
          { label: 'Gross pay', amount: c.gross, previous: prev?.gross ?? null },
          { label: 'Net pay', amount: c.net, previous: prev?.net ?? null },
          { label: 'Employer cost', amount: c.totalCost },
        ],
      };
    });
  }, [canPayroll, payslips, previousPayslips, employees, branches, scope, ratesByCountry]);

  const multiCountry = headcount.byCountry.length > 1 || options.length > 1;
  if (!multiCountry && money.length === 0) return null;

  const before = previousMonth(payPeriod);
  return (
    <div className="space-y-3" data-testid="group-overview">
      {multiCountry && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-brand" strokeWidth={1.8} aria-hidden="true" />
              <h2 className="text-[13px] font-bold text-ink">Headcount by country</h2>
              <span className="px-2 py-0.5 rounded-pill bg-secondary text-[11.5px] font-bold text-ink">All {headcount.total}</span>
            </div>
            <select
              aria-label="Country or branch"
              value={scope}
              onChange={(e) => setScope(e.target.value as ReportScope)}
              className="px-3 py-1.5 border border-border rounded-tile text-xs bg-white max-w-full"
            >
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <BarList rows={headcount.byCountry.map((c) => ({ name: c.country, value: c.count }))} caption="Current staff by country" />
        </Card>
      )}
      <CurrencyCards items={money} caption={payPeriodLabel(payPeriod, payPeriod)} previousLabel={payPeriodLabel(before, before)} />
    </div>
  );
}

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** The payslips of the period before `period`, for payroll roles once the period is known; [] when they can't be read. */
function usePreviousPayslips(period: string, enabled: boolean): Row[] {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchAll<Row>((from, to) => supabase.from('salary_history').select('*').eq('pay_period', previousMonth(period)).order('id').range(from, to))
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [period, enabled]);
  return enabled ? rows : [];
}

export default function GroupOverview() {
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const canPayroll = hasPermission('payroll');
  const { branches } = useBranches();
  const [month] = useState(thisMonth);
  const data = useGroupReportData({ month, payroll: canPayroll, people: false, fallBack: true });
  const previousPayslips = usePreviousPayslips(data.payPeriod, canPayroll && !data.loading && data.payslips.length > 0);
  const rateCountries = useMemo(() => [...new Set(data.payslips.map((p) => String(p.country || 'Kenya')))].sort(), [data.payslips]);
  const { ratesByCountry } = useCountryRates(data.payPeriod, rateCountries);
  if (permissionsLoading || data.loading || (rateCountries.length > 0 && !ratesByCountry)) return null;
  return (
    <GroupOverviewView
      branches={branches}
      employees={data.employees}
      payslips={data.payslips}
      previousPayslips={previousPayslips}
      payPeriod={data.payPeriod}
      ratesByCountry={ratesByCountry ?? new Map()}
      canPayroll={canPayroll}
    />
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
