import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Card } from '../UI';
import type { EmployeeRecord } from '../../lib/profileCompleteness';
import { returnsReadiness } from '../../lib/payrollExports';

// On the payroll page: whether everyone on this month's payroll has what the KRA P10, SHIF and NSSF returns need, and
// who is missing what. Fix them (Missing details, or the employee's onboarding) before approving the month.

const RETURNS = [
  { key: 'p10', label: 'KRA P10' },
  { key: 'sha', label: 'SHIF' },
  { key: 'nssf', label: 'NSSF' },
] as const;

export default function ReturnsReadiness({ employees }: { employees: EmployeeRecord[] }) {
  const ready = useMemo(() => returnsReadiness(employees), [employees]);
  const [open, setOpen] = useState<(typeof RETURNS)[number]['key'] | null>(null);
  if (employees.length === 0) return null;
  const allReady = RETURNS.every(({ key }) => ready[key].length === 0);

  return (
    <Card padding="sm" className="mb-4">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="font-semibold text-ink">Returns check</span>
        {allReady ? (
          <span className="inline-flex items-center gap-1 text-status-success"><CheckCircle2 className="w-3.5 h-3.5" /> Everyone on payroll has what the P10, SHIF and NSSF returns need</span>
        ) : (
          RETURNS.map(({ key, label }) => (
            <button key={key} type="button" onClick={() => setOpen(open === key ? null : key)}
              className={`inline-flex items-center gap-1 ${ready[key].length ? 'text-orange-text-alt font-semibold' : 'text-status-success'}`}>
              {ready[key].length ? <AlertTriangle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              {label}: {ready[key].length ? `${ready[key].length} missing details` : 'ready'}
            </button>
          ))
        )}
      </div>
      {open && ready[open].length > 0 && (
        <ul className="mt-2 border-t border-border pt-2 space-y-0.5 text-xs text-ink">
          {ready[open].map((p) => (
            <li key={p.employeeNumber}><span className="font-medium">{p.name || p.employeeNumber}</span>: {p.missing.join(', ')}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
