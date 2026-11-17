import { AlertCircle, CalendarDays, Clock, Download, Fingerprint, Plane, Smartphone, UserCheck, Users } from 'lucide-react';
import StatCard from '../../UI/StatCard';
import StatusPill from '../../UI/StatusPill';
import BrandMark from '../BrandMark';
import { Initials, Meter, PreviewFrame, SampleTag } from './parts';

// The larger previews: employee records, attendance, a payroll month, KPI scorecards, the staff portal on a phone and
// the admin menu. Drawn with the app's own components and menu text, filled with sample data.

const PEOPLE = [
  { name: 'Amina Wanjiru', number: 'EMP-014', role: 'Accountant', branch: 'Nairobi HQ', status: 'Active', tone: 'success' as const, done: 100 },
  { name: 'Joseph Okello', number: 'EMP-027', role: 'Field Officer', branch: 'Mombasa', status: 'Active', tone: 'success' as const, done: 85 },
  { name: 'Neema Kileo', number: 'EMP-031', role: 'Sales Officer', branch: 'Kisumu', status: 'Onboarding', tone: 'info' as const, done: 60 },
];

export function EmployeesPreview({ className = '', count = 3 }: { className?: string; count?: 1 | 2 | 3 }) {
  return (
    <PreviewFrame label="Sample employee records: three people with their branch, status and how complete their profile is." className={className}>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[13px] font-bold text-ink">Employees</div>
        <SampleTag />
      </div>
      <div className={`grid gap-2.5 ${count === 3 ? 'sm:grid-cols-3' : count === 2 ? 'sm:grid-cols-2' : ''}`}>
        {PEOPLE.slice(0, count).map((p) => (
          <div key={p.number} className="rounded-card border border-border bg-white p-3">
            <div className="flex items-start gap-2.5">
              <Initials name={p.name} size={38} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-bold text-ink">{p.name}</div>
                <div className="text-[10.5px] text-subtle">{p.number}</div>
              </div>
              <StatusPill label={p.status} tone={p.tone} />
            </div>
            <dl className="m-0 mt-3 grid grid-cols-2 gap-2">
              <div>
                <dt className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">Position</dt>
                <dd className="m-0 truncate text-[11.5px] text-ink">{p.role}</dd>
              </div>
              <div>
                <dt className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">Branch</dt>
                <dd className="m-0 truncate text-[11.5px] text-ink">{p.branch}</dd>
              </div>
            </dl>
            <div className="mt-3">
              <Meter value={p.done} label={`Profile ${p.done}% complete`} />
            </div>
          </div>
        ))}
      </div>
    </PreviewFrame>
  );
}

export function AttendancePreview({ className = '' }: { className?: string }) {
  const rows = [
    { name: 'Amina Wanjiru', time: '07:52', source: 'App', icon: Smartphone, label: 'On time', tone: 'success' as const },
    { name: 'Brian Otieno', time: '08:41', source: 'Terminal', icon: Fingerprint, label: 'Late', tone: 'warning' as const },
    { name: 'Faith Njeri', time: '', source: '', icon: Plane, label: 'On leave', tone: 'neutral' as const },
  ];
  return (
    <PreviewFrame label="Sample attendance for today: how many are in, late, not in yet or on leave, and the latest clock-ins." className={className}>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[13px] font-bold text-ink">Attendance today</div>
        <SampleTag />
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCard label="In" value="41" icon={<UserCheck size={17} />} tint="green" />
        <StatCard label="Late" value="4" icon={<Clock size={17} />} tint="orange" />
        <StatCard label="Not in yet" value="2" icon={<Users size={17} />} tint="info" />
        <StatCard label="On leave" value="3" icon={<Plane size={17} />} tint="purple" />
      </div>
      <div className="mt-2.5 overflow-hidden rounded-card border border-border bg-white">
        {rows.map((row, i) => (
          <div key={row.name} className={`flex items-center gap-3 px-3.5 py-2.5 ${i > 0 ? 'border-t border-border' : ''}`}>
            <Initials name={row.name} tone="tint" size={28} />
            <div className="min-w-0 flex-1 text-[12px] font-semibold text-ink">{row.name}</div>
            <div className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
              {row.source && <row.icon size={13} />}
              {row.time ? `${row.time} · ${row.source}` : 'No clock-in'}
            </div>
            <StatusPill label={row.label} tone={row.tone} />
          </div>
        ))}
      </div>
    </PreviewFrame>
  );
}

export function PayrollRunPreview({ className = '' }: { className?: string }) {
  const countries = [
    { name: 'Kenya', currency: 'KES', icon: AlertCircle, label: '2 details missing', tone: 'warning' as const },
  ];
  const files = ['KRA P10', 'SHA', 'NSSF', 'Housing Levy', 'NITA', 'Bank file', 'M-Pesa file'];
  return (
    <PreviewFrame label="Sample payroll month: Kenya is waiting on two missing details, with the files finance downloads." className={className}>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[13px] font-bold text-ink">October 2026 payroll</div>
        <SampleTag />
      </div>
      <div className="overflow-hidden rounded-card border border-border bg-white">
        {countries.map((c, i) => (
          <div key={c.name} className={`flex items-center gap-3 px-3.5 py-3 ${i > 0 ? 'border-t border-border' : ''}`}>
            <c.icon size={16} className="shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-semibold text-ink">{c.name}</div>
              <div className="font-mono text-[10.5px] text-muted-foreground">{c.currency}</div>
            </div>
            <StatusPill label={c.label} tone={c.tone} />
          </div>
        ))}
      </div>
      <div className="mt-2.5 rounded-card border border-border bg-white p-3.5">
        <div className="text-[11.5px] font-semibold text-muted-foreground">Readiness, Kenya</div>
        <ul className="m-0 mt-1.5 list-none space-y-1 p-0 text-[12px] text-ink">
          <li className="flex items-center gap-2">
            <AlertCircle size={13} className="text-orange-text-alt" />
            Neema Kileo: no tax PIN
          </li>
          <li className="flex items-center gap-2">
            <AlertCircle size={13} className="text-orange-text-alt" />
            Baraka Mushi: no payment detail
          </li>
        </ul>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {files.map((file) => (
          <span key={file} className="inline-flex items-center gap-1 rounded-pill border border-border bg-white px-2.5 py-1 text-[11px] font-semibold text-ink">
            <Download size={11} className="text-muted-foreground" />
            {file}
          </span>
        ))}
      </div>
    </PreviewFrame>
  );
}

export function KpiPreview({ className = '' }: { className?: string }) {
  const rows = [
    { name: 'Tasks completed on time', source: 'Calculated from tasks', value: 92 },
    { name: 'Attendance rate', source: 'Calculated from attendance', value: 96 },
    { name: 'Targets met', source: 'Entered by the manager', value: 78 },
  ];
  return (
    <PreviewFrame label="Sample KPI scorecard: three measures, two of them calculated from tasks and attendance, with an overall rating." className={className}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-[13px] font-bold text-ink">Scorecard, Brian Otieno</div>
          <div className="text-[11px] text-muted-foreground">Third quarter</div>
        </div>
        <SampleTag />
      </div>
      <div className="rounded-card border border-border bg-white p-3.5">
        <ul className="m-0 list-none space-y-3.5 p-0">
          {rows.map((row) => (
            <li key={row.name}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12.5px] font-semibold text-ink">{row.name}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{row.value} of 100</span>
              </div>
              <div className="mt-1.5">
                <Meter value={row.value} label={row.source} />
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
          <span className="text-[12px] font-semibold text-ink">Overall rating</span>
          <StatusPill label="Meets" tone="success" />
        </div>
      </div>
    </PreviewFrame>
  );
}

export function PhonePortalPreview({ className = '' }: { className?: string }) {
  return (
    <PreviewFrame label="Sample staff portal on a phone: clock in, leave balance and the latest payslip." className={className}>
      <div className="mx-auto w-[236px] rounded-[34px] border-[7px] border-ink bg-page p-3 shadow-[0_30px_70px_-30px_rgba(14,38,25,0.6)]">
        <div className="mx-auto mb-2.5 h-1 w-14 rounded-full bg-ink/20" />
        <div className="flex items-center justify-between">
          <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-brand text-white">
            <BrandMark className="h-4 w-4" />
          </span>
          <SampleTag />
        </div>
        <div className="mt-3 text-[15px] font-bold leading-tight text-ink">Good morning, Amina</div>
        <div className="text-[11px] text-muted-foreground">Here is your day.</div>
        <div className="mt-3 rounded-tile bg-brand py-2.5 text-center text-[12.5px] font-semibold text-white">Clock in</div>
        <div className="mt-2.5 rounded-card border border-border bg-white p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <CalendarDays size={12} /> Annual leave
          </div>
          <div className="mt-1 text-[20px] font-bold leading-none text-ink">
            16 <span className="text-[12px] font-medium text-muted-foreground">days left</span>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between rounded-card border border-border bg-white p-3">
          <div>
            <div className="text-[11px] font-semibold text-muted-foreground">Payslip</div>
            <div className="text-[12.5px] font-semibold text-ink">September 2026</div>
          </div>
          <Download size={15} className="text-brand" />
        </div>
        <div className="mt-2 rounded-card border border-border bg-white p-3">
          <div className="text-[11px] font-semibold text-muted-foreground">Waiting for you</div>
          <div className="mt-0.5 text-[12px] text-ink">Sign your contract by Friday</div>
        </div>
      </div>
    </PreviewFrame>
  );
}
