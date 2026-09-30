import { ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export default function EmptyState({ icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center text-center py-6 ${className}`}>
      <div className="w-11 h-11 rounded-full bg-secondary flex items-center justify-center text-subtle mb-2.5">
        {icon}
      </div>
      <div className="text-[13px] font-bold text-ink">{title}</div>
      {description && <div className="text-[11.5px] text-muted-foreground mt-0.5">{description}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
