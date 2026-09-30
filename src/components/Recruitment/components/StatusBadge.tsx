interface StatusBadgeProps {
  status: string;
}

export const StatusBadge = ({ status }: StatusBadgeProps) => {
  const statusClasses = {
    'Critically Needed': 'bg-red-100 text-red-800',
    'Urgent': 'bg-orange-100 text-orange-800',
    'Normal': 'bg-green-tint text-brand-dark',
    'Future Hiring': 'bg-gray-100 text-gray-800',
    'New': 'bg-green-tint text-brand-dark',
    'Interview': 'bg-orange-tint text-orange-text-alt',
    'Shortlisted': 'bg-green-100 text-green-800',
    'Rejected': 'bg-red-100 text-red-800',
  };

  return (
    <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${statusClasses[status as keyof typeof statusClasses] || 'bg-gray-100 text-gray-800'}`}>
      {status}
    </span>
  );
};