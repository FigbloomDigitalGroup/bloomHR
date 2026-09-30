interface SummaryCardProps {
  label: string;
  value: number;
  icon?: string;
  color: string;
  isCount?: boolean;
}

const dotClasses: Record<string, string> = {
  blue: 'bg-status-info',
  orange: 'bg-orange',
  green: 'bg-status-success',
  red: 'bg-status-danger',
  purple: 'bg-status-purple',
};

export const SummaryCard = ({ label, value, color, isCount = false }: SummaryCardProps) => {
  return (
    <div className="bg-white rounded-card border border-border p-4">
      <div className={`w-[9px] h-[9px] rounded-pill mb-2.5 ${dotClasses[color] || 'bg-subtle'}`} />
      <p className="text-[10.5px] font-bold text-subtle uppercase tracking-wide">{label}</p>
      <p className="text-[22px] font-bold text-ink">
        {isCount ? value : value.toLocaleString()}
      </p>
    </div>
  );
};
