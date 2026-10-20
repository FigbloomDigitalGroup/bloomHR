import { ReactNode } from 'react';
import Card from './Card';

export type StatTint = 'green' | 'orange' | 'info' | 'purple' | 'danger';

const tintClasses: Record<StatTint, { bg: string; fg: string }> = {
  green: { bg: 'bg-green-tint', fg: 'text-brand' },
  orange: { bg: 'bg-orange-tint-alt', fg: 'text-orange-text-alt' },
  info: { bg: 'bg-status-info-tint', fg: 'text-status-info' },
  purple: { bg: 'bg-status-purple-tint', fg: 'text-status-purple' },
  danger: { bg: 'bg-orange-tint', fg: 'text-status-danger' },
};

interface StatCardProps {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  tint?: StatTint;
  /** a short line under the value: the change on last month, what is waiting, ... (text colours, never the tint) */
  note?: ReactNode;
  /** a small chart under the figure, such as a sparkline */
  trend?: ReactNode;
  className?: string;
}

export default function StatCard({ label, value, icon, tint = 'green', note, trend, className = '' }: StatCardProps) {
  const { bg, fg } = tintClasses[tint];
  return (
    <Card className={`h-full ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11.5px] font-semibold text-muted-foreground">{label}</div>
          <div className="text-xl sm:text-2xl font-bold text-ink mt-1 break-words leading-tight">{value}</div>
          {note && <div className="text-[11.5px] text-muted-foreground mt-1">{note}</div>}
        </div>
        <div className={`w-[38px] h-[38px] shrink-0 rounded-tile flex items-center justify-center ${bg} ${fg}`} aria-hidden="true">
          {icon}
        </div>
      </div>
      {trend && <div className="mt-3">{trend}</div>}
    </Card>
  );
}
