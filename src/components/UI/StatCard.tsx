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
  className?: string;
}

export default function StatCard({ label, value, icon, tint = 'green', className = '' }: StatCardProps) {
  const { bg, fg } = tintClasses[tint];
  return (
    <Card className={className}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11.5px] font-semibold text-muted-foreground">{label}</div>
          <div className="text-2xl font-bold text-ink mt-1">{value}</div>
        </div>
        <div className={`w-[38px] h-[38px] rounded-tile flex items-center justify-center ${bg} ${fg}`}>
          {icon}
        </div>
      </div>
    </Card>
  );
}
