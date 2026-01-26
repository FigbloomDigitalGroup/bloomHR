import { AlertCircle, Clock, Briefcase } from 'lucide-react';

interface SummaryCardProps {
  label: string;
  value: number;
  icon: string;
  color: string;
  isCount?: boolean;
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  AlertCircle,
  Clock,
  Briefcase
};

export const SummaryCard = ({
  label,
  value,
  icon,
  color,
  isCount = false,
}: SummaryCardProps) => {
  const colorClasses = {
    red: 'bg-red-100 text-red-600',
    orange: 'bg-orange-100 text-orange-600',
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    purple: 'bg-purple-100 text-purple-600'
  };

  const IconComponent = iconMap[icon];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className={`p-2 rounded-lg ${colorClasses[color as keyof typeof colorClasses]}`}>
          {IconComponent && <IconComponent className="w-5 h-5" />}
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-gray-600 text-xs font-semibold uppercase tracking-wide">{label}</p>
        <p className="text-gray-900 text-xl font-bold">
          {isCount ? value : value.toLocaleString()}
        </p>
      </div>
    </div>
  );
};