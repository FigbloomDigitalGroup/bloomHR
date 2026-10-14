import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, UserCheck, UserX, Users } from 'lucide-react';
import { Card, EmptyState, SearchInput, StatCard, TableScroll } from '../UI';
import type { EmployeeRecord } from '../../lib/profileCompleteness';
import { type EmployeeMissingDetails, employeeName } from '../../lib/missingPayrollDetails';
import { paymentMethodLabel } from '../../lib/paymentMethods';

// The Employees' pay tab: who is on payroll (onboarding approved), what each is paid, and who is missing a KRA PIN,
// NSSF or SHA number or payment details. "Fix missing details" opens the existing bulk editor.

interface PayrollEmployeesTabProps {
  onPayroll: EmployeeRecord[];
  notOnboarded: EmployeeRecord[];
  missingDetails: EmployeeMissingDetails[];
  onFixMissing: () => void;
  onGoToOnboarding: () => void;
}

const PAGE = 25;

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

export default function PayrollEmployeesTab({ onPayroll, notOnboarded, missingDetails, onFixMissing, onGoToOnboarding }: PayrollEmployeesTabProps) {
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE);

  const missingByNumber = useMemo(() => new Map(missingDetails.map((m) => [m.employeeNumber, m.missing])), [missingDetails]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return onPayroll
      .map((e) => ({
        key: text(e.id) || text(e['Employee Number']),
        number: text(e['Employee Number']),
        name: employeeName(e) || text(e['Employee Number']),
        team: text(e.Department) || text(e['Job Level']) || text(e.Office) || text(e.branch),
        method: paymentMethodLabel(e.payment_method),
        basic: Number(e['Basic Salary']) || 0,
      }))
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.number.toLowerCase().includes(q) || r.team.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [onPayroll, search]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="On payroll" value={onPayroll.length} icon={<UserCheck className="w-4 h-4" />} />
        <StatCard
          label="Missing details"
          value={missingDetails.length}
          icon={<AlertTriangle className="w-4 h-4" />}
          tint={missingDetails.length ? 'orange' : 'green'}
        />
        <StatCard label="Not onboarded (not paid)" value={notOnboarded.length} icon={<UserX className="w-4 h-4" />} tint={notOnboarded.length ? 'danger' : 'green'} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-64">
          <SearchInput placeholder="Search name, number or department" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onFixMissing}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-tile border text-[11.5px] font-semibold transition-colors ${
            missingDetails.length
              ? 'border-orange-text-alt/40 bg-orange-tint-alt text-orange-text-alt hover:brightness-95'
              : 'border-border bg-white text-ink hover:bg-secondary'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          Fix missing details{missingDetails.length ? ` (${missingDetails.length})` : ''}
        </button>
        {notOnboarded.length > 0 && (
          <button
            type="button"
            onClick={onGoToOnboarding}
            title="These employees are not paid until HR approves their onboarding"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-tile border border-border bg-white text-[11.5px] font-semibold text-ink hover:bg-secondary transition-colors"
          >
            <Users className="w-3.5 h-3.5" />
            Not onboarded ({notOnboarded.length})
          </button>
        )}
      </div>

      <Card padding="none" className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Users className="w-5 h-5" />}
            title={onPayroll.length ? 'Nobody matches that search' : 'Nobody is on payroll yet'}
            description={onPayroll.length ? undefined : 'Employees are paid once HR approves their onboarding.'}
          />
        ) : (
          <TableScroll>
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 border-b border-border">
                <tr className="text-left text-[10px] font-bold uppercase text-subtle">
                  <th className="px-4 py-2.5">Employee</th>
                  <th className="px-4 py-2.5">Department</th>
                  <th className="px-4 py-2.5">Paid by</th>
                  <th className="px-4 py-2.5 text-right">Basic salary</th>
                  <th className="px-4 py-2.5">Payroll details</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map((r) => {
                  const missing = missingByNumber.get(r.number);
                  return (
                    <tr key={r.key} className="border-b border-[#F1F5F2] last:border-0 text-ink">
                      <td className="px-4 py-2.5">
                        <div className="font-bold">{r.name}</div>
                        <div className="text-[10px] text-subtle">{r.number || 'No employee number'}</div>
                      </td>
                      <td className="px-4 py-2.5">{r.team || '—'}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{r.method || '—'}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">KSh {r.basic.toLocaleString()}</td>
                      <td className="px-4 py-2.5">
                        {missing?.length ? (
                          <span className="inline-flex items-start gap-1 text-orange-text-alt font-semibold">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                            Missing {missing.join(', ')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-status-success">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Complete
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>
      {rows.length > shown && (
        <div className="flex justify-center">
          <button type="button" onClick={() => setShown((n) => n + PAGE)} className="text-xs font-semibold text-brand">
            Show more ({rows.length - shown} more)
          </button>
        </div>
      )}
    </div>
  );
}
