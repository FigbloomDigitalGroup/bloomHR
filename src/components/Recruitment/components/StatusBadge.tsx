interface StatusBadgeProps {
  status: string;
}

export const StatusBadge = ({ status }: StatusBadgeProps) => {
  const statusClasses = {
    'Critically Needed': 'bg-red-100 text-red-800',
    'Urgent': 'bg-orange-100 text-orange-800',
    'Normal': 'bg-blue-100 text-blue-800',
    'Future Hiring': 'bg-gray-100 text-gray-800',
    'New': 'bg-blue-100 text-blue-800',
    'Interview': 'bg-purple-100 text-purple-800',
    'Shortlisted': 'bg-green-100 text-green-800',
    'Rejected': 'bg-red-100 text-red-800',
  };

  return (
    <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${statusClasses[status as keyof typeof statusClasses] || 'bg-gray-100 text-gray-800'}`}>
      {status}
    </span>
  );
};