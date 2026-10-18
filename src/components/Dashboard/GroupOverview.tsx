import { useMemo, useState } from 'react';
import { Globe } from 'lucide-react';
import { Card } from '../UI';
import { usePermissions } from '../../hooks/usePermissions';
import { useBranches } from '../../hooks/useBranches';
import useCountryRates from '../../hooks/useCountryRates';
import type { Branch } from '../../lib/branches';
import type { Rates } from '../../lib/statutoryCalc';
import { payPeriodLabel } from '../../lib/payPeriod';
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
import { useGroupReportData } from '../Reports/useGroupReportData';

// The dashboard's group view (FIG-905): a country or branch filter, headcount by country, and the latest month's payroll
// money per currency. A company in one country with one branch sees just the payroll cards, as before; nothing at all
// for a role without payroll.

/* eslint-disable @typescript-eslint/no-explicit-any -- the untyped rows the reports add up */
type Row = Record<string, any>;

export interface GroupOverviewViewProps {
  branches: Branch[];
  employees: Row[];
  payslips: Row[];
  payPeriod: string;
  ratesByCountry: Map<string, Rates | null>;
  canPayroll: boolean;
}

export function GroupOverviewView({ branches, employees, payslips, payPeriod, ratesByCountry, canPayroll }: GroupOverviewViewProps) {
  const [scope, setScope] = useState<ReportScope>('all');
  const options = useMemo(() => scopeOptions(branches, payslips.map((p) => String(p.country ?? '')).filter(Boolean)), [branches, payslips]);
  const headcount = useMemo(
    () => countByPlace(employees.filter(isCurrentEmployee).map((e) => ({ place: placeOfEmployee(e, branches) })).filter((i) => inScope(i.place, scope))),
    [employees, branches, scope]
  );
  const money = useMemo(() => {
    if (!canPayroll) return [];
    return summaryByCurrency(payrollSummary(payslipsInScope(payslips, employees, branches, scope, ratesByCountry))).map((c) => ({
      currency: c.currency,
      figures: [
        { label: 'Gross pay', amount: c.gross },
        { label: 'Net pay', amount: c.net },
        { label: 'Employer cost', amount: c.totalCost },
      ],
    }));
  }, [canPayroll, payslips, employees, branches, scope, ratesByCountry]);

  const multiCountry = headcount.byCountry.length > 1 || options.length > 1;
  if (!multiCountry && money.length === 0) return null;

  return (
    <div className="space-y-3" data-testid="group-overview">
      {multiCountry && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-brand" strokeWidth={1.8} />
              <h2 className="text-[13px] font-bold text-ink">Headcount by country</h2>
            </div>
            <select
              aria-label="Country or branch"
              value={scope}
              onChange={(e) => setScope(e.target.value as ReportScope)}
              className="px-3 py-1.5 border border-border rounded-tile text-xs bg-white"
            >
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <span className="px-2.5 py-1 rounded-pill bg-secondary text-[12px] font-bold text-ink">All {headcount.total}</span>
            {headcount.byCountry.map((c) => (
              <span key={c.country} className="px-2.5 py-1 rounded-pill bg-secondary text-[12px] text-ink">{c.country} {c.count}</span>
            ))}
          </div>
        </Card>
      )}
      <CurrencyCards items={money} caption={payPeriodLabel(payPeriod, payPeriod)} />
    </div>
  );
}

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function GroupOverview() {
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const canPayroll = hasPermission('payroll');
  const { branches } = useBranches();
  const [month] = useState(thisMonth);
  const data = useGroupReportData({ month, payroll: canPayroll, people: false, fallBack: true });
  const rateCountries = useMemo(() => [...new Set(data.payslips.map((p) => String(p.country || 'Kenya')))].sort(), [data.payslips]);
  const { ratesByCountry } = useCountryRates(data.payPeriod, rateCountries);
  if (permissionsLoading || data.loading || (rateCountries.length > 0 && !ratesByCountry)) return null;
  return (
    <GroupOverviewView
      branches={branches}
      employees={data.employees}
      payslips={data.payslips}
      payPeriod={data.payPeriod}
      ratesByCountry={ratesByCountry ?? new Map()}
      canPayroll={canPayroll}
    />
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
