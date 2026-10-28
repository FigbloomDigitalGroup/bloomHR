import { Check } from 'lucide-react';
import StatusPill from '../../UI/StatusPill';
import { Initials, PreviewFrame, SampleTag } from './parts';

// More sample cards: what is waiting for someone, the finance list of approved payments, and the roles screen.

const WAITING = [
  { name: 'Amina Wanjiru', what: 'Annual leave · 5 days', tone: 'warning' as const, label: 'Pending' },
  { name: 'Brian Otieno', what: 'Salary advance', tone: 'info' as const, label: 'Your step' },
  { name: 'Grace Mushi', what: 'Overtime · 6 hours', tone: 'warning' as const, label: 'Pending' },
];

export function WaitingCard({ title = 'Waiting on you', className = '' }: { title?: string; className?: string }) {
  return (
    <div className={`rounded-card border border-border bg-white p-3.5 ${className}`}>
      <div className="text-[12px] font-bold text-ink">{title}</div>
      <ul className="m-0 mt-2 list-none space-y-2 p-0">
        {WAITING.map((row) => (
          <li key={row.name} className="flex items-center gap-2">
            <Initials name={row.name} tone="tint" size={28} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11.5px] font-semibold text-ink">{row.name}</div>
              <div className="truncate text-[10.5px] text-muted-foreground">{row.what}</div>
            </div>
            <StatusPill label={row.label} tone={row.tone} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PaymentsToMakeCard({ className = '' }: { className?: string }) {
  const rows = [
    { what: 'Salary advance', who: 'Brian Otieno', amount: 'KES 20,000', state: 'Approved', tone: 'info' as const },
    { what: 'Staff loan', who: 'Faith Njeri', amount: 'KES 150,000', state: 'Approved', tone: 'info' as const },
    { what: 'Requisition', who: 'Supplier invoice', amount: 'KES 34,500', state: 'Paid by bank', tone: 'success' as const },
  ];
  return (
    <PreviewFrame label="Sample payments to make: approved advances, loans and requests waiting for finance, and one already recorded as paid." className={className}>
      <div className="rounded-card border border-border bg-white p-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] font-bold text-ink">Payments to make</div>
          <SampleTag />
        </div>
        <ul className="m-0 mt-3 list-none space-y-2 p-0">
          {rows.map((row) => (
            <li key={row.what} className="flex items-center gap-3 rounded-tile border border-border px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold text-ink">{row.what}</div>
                <div className="truncate text-[11px] text-muted-foreground">{row.who}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="whitespace-nowrap font-mono text-[11.5px] text-ink">{row.amount}</span>
                <StatusPill label={row.state} tone={row.tone} />
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-3 text-[11.5px] leading-snug text-muted-foreground">Finance pays outside the app, then records how and the reference.</div>
      </div>
    </PreviewFrame>
  );
}

export function RolesPreview({ className = '' }: { className?: string }) {
  const roles = [
    { name: 'Administrator', modules: ['Every module'], custom: false },
    { name: 'HR', modules: ['Employees', 'Leave', 'Hiring'], custom: false },
    { name: 'Checker', modules: ['Payroll', 'Advances'], custom: false },
    { name: 'Manager', modules: ['My team', 'Leave approvals'], custom: false },
    { name: 'Payroll clerk', modules: ['Payroll', 'Payslips'], custom: true },
  ];
  return (
    <PreviewFrame label="Sample roles: the default roles and one custom role, each with the modules it can open." className={className}>
      <div className="rounded-card border border-border bg-white p-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] font-bold text-ink">Roles</div>
          <SampleTag />
        </div>
        <ul className="m-0 mt-3 list-none space-y-2 p-0">
          {roles.map((role) => (
            <li key={role.name} className="rounded-tile border border-border px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-semibold text-ink">{role.name}</span>
                {role.custom && <StatusPill label="Custom role" tone="purple" />}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {role.modules.map((module) => (
                  <span key={module} className="inline-flex items-center gap-1 rounded-pill bg-secondary px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
                    <Check size={10} strokeWidth={3} />
                    {module}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </PreviewFrame>
  );
}
