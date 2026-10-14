import { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export default function PageHeader({ title, subtitle, actions, className = '' }: PageHeaderProps) {
  return (
    <div
      className={`flex flex-wrap items-end justify-between gap-3 pb-3.5 border-b border-border mb-[18px] ${className}`}
    >
      <div className="min-w-0">
        <h1 className="m-0 text-lg sm:text-[21px] font-bold text-ink break-words">{title}</h1>
        {subtitle && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">{subtitle}</div>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
