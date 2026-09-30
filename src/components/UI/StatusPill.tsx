export type StatusTone = 'success' | 'danger' | 'warning' | 'info' | 'purple' | 'neutral';

const toneClasses: Record<StatusTone, string> = {
  success: 'bg-green-tint text-status-success',
  danger: 'bg-orange-tint text-status-danger',
  warning: 'bg-orange-tint-alt text-orange-text-alt',
  info: 'bg-status-info-tint text-status-info',
  purple: 'bg-status-purple-tint text-status-purple',
  neutral: 'bg-secondary text-muted-foreground',
};

interface StatusPillProps {
  label: string;
  tone?: StatusTone;
  className?: string;
}

export default function StatusPill({ label, tone = 'neutral', className = '' }: StatusPillProps) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-pill text-[11px] font-semibold leading-none ${toneClasses[tone]} ${className}`}
    >
      {label}
    </span>
  );
}
