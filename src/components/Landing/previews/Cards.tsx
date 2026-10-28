import { Briefcase, CalendarDays, Check, CheckCircle2, ChevronDown, Clock, FileText, Users, Wallet } from 'lucide-react';
import StatusPill from '../../UI/StatusPill';
import { Initials, Meter, SampleTag } from './parts';

// The small cards that float over the photographs: a module list, the hiring pipeline, what changes, a leave request.
// Same look as the app's cards, with sample data. None of them is interactive.

export function ModuleListCard() {
  const modules = [
    { icon: Users, label: 'People and records', tint: 'bg-status-purple-tint text-status-purple' },
    { icon: CalendarDays, label: 'Leave and attendance', tint: 'bg-green-tint text-brand' },
    { icon: Wallet, label: 'Payroll and returns', tint: 'bg-orange-tint-alt text-orange-text-alt' },
    { icon: Briefcase, label: 'Hiring and onboarding', tint: 'bg-status-info-tint text-status-info' },
  ];
  return (
    <div className="w-[230px]">
      <div className="text-[15px] font-bold leading-tight text-ink">Welcome to Figbloom HR</div>
      <div className="mt-1 text-[11.5px] leading-snug text-muted-foreground">Your people, requests and payroll in one workspace.</div>
      <ul className="m-0 mt-3 list-none space-y-1.5 p-0">
        {modules.map(({ icon: Icon, label, tint }) => (
          <li key={label} className="flex items-center gap-2.5 rounded-tile border border-border bg-white px-2 py-1.5">
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-[9px] ${tint}`}>
              <Icon size={14} />
            </span>
            <span className="text-[12px] font-semibold text-ink">{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// the default stages the pipeline starts with (supabase/migrations/20261015900000_recruitment_pipeline.sql); companies edit them
const STAGES = [
  { name: 'Applied', count: 24, tone: 'info' as const },
  { name: 'Screening', count: 12, tone: 'info' as const },
  { name: 'Interview', count: 8, tone: 'info' as const },
  { name: 'Hired', count: 5, tone: 'success' as const },
];

export function PipelineCard() {
  return (
    <div className="w-[236px]">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[15px] font-bold text-ink">Recruitment</div>
        <SampleTag />
      </div>
      <div className="mt-0.5 text-[11.5px] text-muted-foreground">Sales Officer · Nairobi</div>
      <ul className="m-0 mt-3 list-none space-y-1.5 p-0">
        {STAGES.map((stage) => (
          <li key={stage.name} className="flex items-center justify-between rounded-tile border border-border bg-white px-2.5 py-2">
            <span className="text-[12px] font-semibold text-ink">{stage.name}</span>
            <StatusPill label={String(stage.count)} tone={stage.tone} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OutcomesCard() {
  const points = ['Fewer messages chasing a decision', 'One approved record for every person', 'Every request tracked from ask to answer'];
  return (
    <div className="w-[250px]">
      <div className="text-[15px] font-bold leading-tight text-ink">What changes for your team</div>
      <ul className="m-0 mt-3 list-none space-y-2 p-0">
        {points.map((point) => (
          <li key={point} className="flex items-start gap-2 text-[12px] leading-snug text-ink">
            <CheckCircle2 size={15} className="mt-px shrink-0 text-status-success" />
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LeaveRequestCard() {
  const types = ['Annual', 'Sick', 'Compassionate'];
  const field = (label: string, value: string) => (
    <div>
      <div className="text-[10.5px] font-semibold text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex items-center justify-between rounded-tile border border-border bg-white px-2.5 py-1.5 text-[12px] text-ink">
        {value}
        <CalendarDays size={13} className="text-muted-foreground" />
      </div>
    </div>
  );
  return (
    <div className="w-[258px]">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-green-tint text-brand">
          <CalendarDays size={14} />
        </span>
        <div className="text-[15px] font-bold text-ink">Request leave</div>
      </div>
      <div className="mt-3 flex gap-1 rounded-tile bg-secondary p-1">
        {types.map((type, i) => (
          <span key={type} className={`flex-1 rounded-[9px] px-1.5 py-1 text-center text-[11px] font-semibold ${i === 0 ? 'bg-brand text-white' : 'text-muted-foreground'}`}>
            {type}
          </span>
        ))}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        {field('Start date', '12 Nov 2026')}
        {field('End date', '16 Nov 2026')}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Clock size={12} />5 working days
      </div>
      <div className="mt-2">
        <div className="text-[10.5px] font-semibold text-muted-foreground">Reason</div>
        <div className="mt-0.5 rounded-tile border border-border bg-white px-2.5 py-1.5 text-[12px] text-ink">Family holiday</div>
      </div>
      <div className="mt-3 rounded-tile bg-brand py-2 text-center text-[12px] font-semibold text-white">Submit request</div>
    </div>
  );
}

/** A review of one new hire's onboarding: what HR sees before approving. */
export function OnboardingReviewCard({ className = '' }: { className?: string }) {
  const rows = [
    { label: 'Personal details', state: 'Approved', tone: 'success' as const },
    { label: 'ID and KRA PIN', state: 'Approved', tone: 'success' as const },
    { label: 'Bank details', state: 'Approved', tone: 'success' as const },
    { label: 'Documents', state: 'Sent back', tone: 'warning' as const },
  ];
  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <Initials name="Neema Kileo" />
          <div>
            <div className="text-[13px] font-bold text-ink">Neema Kileo</div>
            <div className="text-[11px] text-muted-foreground">Onboarding review · Kisumu</div>
          </div>
        </div>
        <SampleTag />
      </div>
      <ul className="m-0 mt-3.5 list-none space-y-1.5 p-0">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between rounded-tile border border-border bg-white px-3 py-2">
            <span className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
              <FileText size={14} className="text-muted-foreground" />
              {row.label}
            </span>
            <StatusPill label={row.state} tone={row.tone} />
          </li>
        ))}
      </ul>
      <div className="mt-2.5 rounded-tile bg-orange-tint-alt px-3 py-2 text-[11.5px] leading-snug text-orange-text">
        <span className="font-semibold">Comment to Neema:</span> the photo of your ID is blurred. Please upload it again.
      </div>
      <div className="mt-3 flex items-center justify-between">
        <Meter value={75} label="3 of 4 sections approved" />
        <span className="ml-4 inline-flex shrink-0 items-center gap-1 rounded-tile bg-secondary px-3 py-2 text-[12px] font-semibold text-muted-foreground">
          <Check size={13} /> Approve
        </span>
      </div>
    </div>
  );
}

/** The chain a request follows, one step per row, with who acted and who it is waiting on. */
export function ApprovalChainCard({ className = '' }: { className?: string }) {
  const steps = [
    { label: 'Line manager', detail: 'Approved by Grace Mushi, 23/10/2026, 13:05', tone: 'success' as const, state: 'Approved' },
    { label: 'HR', detail: 'Waiting on Daniel Kiplagat. Alternate: Faith Njeri', tone: 'warning' as const, state: 'Current' },
    { label: 'Payroll informed', detail: 'After HR approves', tone: 'neutral' as const, state: 'Upcoming' },
  ];
  return (
    <div className={className}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[13px] font-bold text-ink">Amina Wanjiru</div>
          <div className="text-[11.5px] text-muted-foreground">Annual leave · 5 days · 12 to 16 Nov</div>
        </div>
        <SampleTag />
      </div>
      <ol className="m-0 mt-3.5 list-none space-y-0 p-0">
        {steps.map((step, i) => (
          <li key={step.label} className="relative flex gap-3 pb-3.5 last:pb-0">
            {i < steps.length - 1 && <span className="absolute left-[11px] top-6 h-[calc(100%-18px)] w-px bg-border" aria-hidden="true" />}
            <span
              className={`z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                step.tone === 'success' ? 'bg-status-success text-white' : step.tone === 'warning' ? 'bg-orange-tint-alt text-orange-text-alt ring-1 ring-orange-text-alt/30' : 'bg-secondary text-muted-foreground'
              }`}
            >
              {step.tone === 'success' ? <Check size={13} strokeWidth={3} /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-semibold text-ink">{step.label}</span>
                <StatusPill label={step.state} tone={step.tone} />
              </div>
              <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{step.detail}</div>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex items-center justify-between rounded-tile border border-border bg-secondary/60 px-3 py-2 text-[11.5px] text-muted-foreground">
        A rejection always says why
        <ChevronDown size={13} />
      </div>
    </div>
  );
}
