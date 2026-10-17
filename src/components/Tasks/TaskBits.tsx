import { CircleDashed, Circle, CircleDot, CircleCheck, CircleX, Eye, AlertTriangle, SignalHigh, SignalMedium, SignalLow, Minus } from 'lucide-react';
import { LABEL_COLORS, PRIORITIES, STATUSES, initialsOf, type TaskLabel, type TaskPriority, type TaskStatus } from '../../lib/tasks';

// Small pieces the task screens share: status and priority icons, label chips, people's initials.

const STATUS_ICONS: Record<TaskStatus, { Icon: typeof Circle; className: string }> = {
  backlog: { Icon: CircleDashed, className: 'text-gray-400' },
  todo: { Icon: Circle, className: 'text-gray-500' },
  in_progress: { Icon: CircleDot, className: 'text-amber-500' },
  in_review: { Icon: Eye, className: 'text-status-purple' },
  done: { Icon: CircleCheck, className: 'text-status-success' },
  cancelled: { Icon: CircleX, className: 'text-status-danger' },
};

export function StatusIcon({ status, size = 14 }: { status: TaskStatus; size?: number }) {
  const { Icon, className } = STATUS_ICONS[status] ?? STATUS_ICONS.todo;
  const label = STATUSES.find((s) => s.value === status)?.label ?? status;
  return <Icon size={size} className={`shrink-0 ${className}`} aria-label={label} role="img" />;
}

const PRIORITY_ICONS: Record<TaskPriority, typeof Minus> = {
  urgent: AlertTriangle,
  high: SignalHigh,
  medium: SignalMedium,
  low: SignalLow,
  none: Minus,
};

export function PriorityIcon({ priority, size = 14 }: { priority: TaskPriority; size?: number }) {
  const Icon = PRIORITY_ICONS[priority] ?? Minus;
  const p = PRIORITIES.find((x) => x.value === priority);
  return <Icon size={size} className={`shrink-0 ${p?.tone ?? 'text-muted-foreground'}`} aria-label={p?.label ?? priority} role="img" />;
}

export function LabelChip({ label }: { label: TaskLabel }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-pill text-[10px] font-medium ${LABEL_COLORS[label.color] ?? LABEL_COLORS.slate}`}>
      {label.name}
    </span>
  );
}

export function PersonBadge({ name, size = 'sm' }: { name: string | null; size?: 'sm' | 'md' }) {
  const dim = size === 'md' ? 'w-7 h-7 text-[11px]' : 'w-5 h-5 text-[9px]';
  if (!name) {
    return <span className={`${dim} inline-flex items-center justify-center rounded-full border border-dashed border-gray-300 text-gray-400`} title="Unassigned">?</span>;
  }
  return (
    <span className={`${dim} inline-flex items-center justify-center rounded-full bg-brand/15 text-brand font-semibold shrink-0`} title={name}>
      {initialsOf(name)}
    </span>
  );
}

export const fieldClass =
  'w-full px-3 py-2 text-xs border border-border rounded-tile bg-white text-ink outline-none focus:border-brand transition-colors disabled:bg-secondary disabled:cursor-not-allowed';

export const labelClass = 'block text-[11px] font-medium text-muted-foreground mb-1';
