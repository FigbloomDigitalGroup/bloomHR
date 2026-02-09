import { useState, useEffect, useRef } from 'react';
import {
  Calendar,
  Clock,
  AlertCircle,
  Plus,
  Edit,
  Trash2,
  Filter,
  X,
  User,
  ChevronDown,
  Download,
  FileText,
  CheckCircle,
  XCircle,
  Clock as PendingIcon,
  Sun,
  Heart,
  Baby,
  Activity,
  Zap,
  Gift,
  Eye,
  Save,
  ThumbsUp,
  MapPin,
  RefreshCw,
  Loader2,
  Search as SearchIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@supabase/supabase-js';
import { TownProps } from '../../types/supabase';
import RoleButtonWrapper from '../ProtectedRoutes/RoleButton';
import LeaveScheduler from './LeaveScheduler';

// Initialize Supabase client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Types
type LeaveType = {
  id: string;
  name: string;
  description: string;
  is_deductible: boolean;
  is_continuous: boolean;
  max_days?: number;
  icon: string;
};

type Holiday = {
  id: string;
  name: string;
  date: string;
  recurring: boolean;
};

type LeaveApplication = {
  id: string;
  "Employee Number": string;
  Name: string;
  "Leave Type": string;
  "Start Date": string;
  "End Date": string;
  Days: number;
  Type: string;
  "Application Type": string;
  "Office Branch": string;
  Reason: string;
  Status: 'pending' | 'approved' | 'rejected';
  recstatus: 'recommended' | 'not_recommended' | null;
  time_added: string;
  recommendation_notes?: string;
};

type EmployeeLeaveBalance = {
  id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  office: string;
  leave_type_id: string;
  leave_type_name: string;
  accrued_days: number;
  used_days: number;
  remaining_days: number;
  last_accrual_date: string;
  monthly_accrual: number;
  quarterly_accrual: number;
  annual_accrual: number;
};

// Premium Dropdown Component - Defined outside to prevent re-creation and flickering
const PremiumSearchableDropdown = ({
  options,
  value,
  onChange,
  placeholder,
  label,
  icon: Icon
}: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (val: string) => void;
  placeholder: string;
  label: string;
  icon?: any;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()));
  const selected = options.find(o => o.value === value);

  return (
    <div className="relative" ref={containerRef}>
      <label className="block text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1 ml-1">
        {label}
      </label>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={`w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm transition-all duration-200 hover:bg-white hover:border-indigo-300 focus:outline-none focus:ring-4 focus:ring-indigo-500/5 ${isOpen ? 'border-indigo-500 bg-white ring-4 ring-indigo-500/5' : ''}`}
      >
        <div className="flex items-center gap-2 truncate text-gray-700">
          {Icon && <Icon className={`w-4 h-4 ${isOpen ? 'text-indigo-500' : 'text-gray-400'}`} />}
          <span className={selected ? 'font-medium text-gray-900' : 'text-gray-400'}>
            {selected ? selected.label : placeholder}
          </span>
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute z-[100] left-0 right-0 mt-2 bg-white border border-gray-100 rounded-xl shadow-[0_20px_50px_-12px_rgba(0,0,0,0.15)] overflow-hidden ring-1 ring-black/5"
          >
            <div className="p-2 border-b border-gray-50 bg-gray-50/50" onClick={e => e.stopPropagation()}>
              <div className="relative">
                <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  autoFocus
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Type to search..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10"
                />
              </div>
            </div>
            <div className="max-h-60 overflow-y-auto p-1 thin-scrollbar">
              {filtered.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                    setSearch('');
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors mb-0.5 flex items-center justify-between group ${value === opt.value ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-gray-600 hover:bg-indigo-50/50 hover:text-indigo-600'}`}
                >
                  <span className="truncate">{opt.label}</span>
                  {value === opt.value && (
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
                  )}
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="px-4 py-8 text-center bg-gray-50/30 rounded-lg m-1">
                  <p className="text-xs text-gray-400 font-medium italic">No results found</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

type Employee = {
  id: string;
  "Employee Number": string;
  "First Name": string;
  "Last Name": string;
  "Work Email"?: string;
  Branch?: string;
  Town?: string;
};

interface AreaTownMapping {
  [area: string]: string[];
}

interface BranchAreaMapping {
  [branch: string]: string;
}

// Default leave types (Kenyan standard)
const DEFAULT_LEAVE_TYPES: LeaveType[] = [
  { id: 'annual', name: 'Annual Leave', description: 'Paid time off work', is_deductible: true, is_continuous: true, max_days: 24, icon: 'Sun' },
  { id: 'compassionate', name: 'Compassionate Leave', description: 'Time off due to family bereavement', is_deductible: false, is_continuous: true, max_days: 7, icon: 'Heart' },
  { id: 'maternity', name: 'Maternity Leave', description: 'Time off for new mothers', is_deductible: false, is_continuous: true, max_days: 90, icon: 'Baby' },
  { id: 'paternity', name: 'Paternity Leave', description: 'Time off for new fathers', is_deductible: false, is_continuous: true, max_days: 14, icon: 'Baby' },
  { id: 'sick', name: 'Sick Leave', description: 'Time off due to illness', is_deductible: true, is_continuous: true, max_days: 14, icon: 'Activity' },
  { id: 'overtime', name: 'Overtime Compensation', description: 'Leave awarded for overtime work', is_deductible: false, is_continuous: false, icon: 'Zap' },
  { id: 'other', name: 'Other Leave', description: 'Other types of leave', is_deductible: true, is_continuous: true, icon: 'Gift' },
];

// Sample holidays (Kenyan public holidays)
const SAMPLE_HOLIDAYS: Holiday[] = [
  { id: '1', name: 'New Year', date: '2024-01-01', recurring: true },
  { id: '2', name: 'Good Friday', date: '2024-03-29', recurring: true },
  { id: '3', name: 'Easter Monday', date: '2024-04-01', recurring: true },
  { id: '4', name: 'Labour Day', date: '2024-05-01', recurring: true },
  { id: '5', name: 'Madaraka Day', date: '2024-06-01', recurring: true },
  { id: '6', name: 'Huduma Day', date: '2024-10-10', recurring: true },
  { id: '7', name: 'Mashujaa Day', date: '2024-10-20', recurring: true },
  { id: '8', name: 'Jamhuri Day', date: '2024-12-12', recurring: true },
  { id: '9', name: 'Christmas Day', date: '2024-12-25', recurring: true },
  { id: '10', name: 'Boxing Day', date: '2024-12-26', recurring: true },
];

// Helper functions
const getIconComponent = (iconName: string) => {
  switch (iconName) {
    case 'Sun': return Sun;
    case 'Heart': return Heart;
    case 'Baby': return Baby;
    case 'Activity': return Activity;
    case 'Zap': return Zap;
    case 'Gift': return Gift;
    default: return FileText;
  }
};

const calculateWorkingDays = (startDate: string, endDate: string, holidays: Holiday[]) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  let count = 0;

  if (start.toDateString() === end.toDateString()) {
    return 0.5;
  }

  const current = new Date(start);
  while (current <= end) {
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      const isHoliday = holidays.some(h => {
        const holidayDate = new Date(h.date);
        return holidayDate.getDate() === current.getDate() &&
          holidayDate.getMonth() === current.getMonth() &&
          holidayDate.getFullYear() === current.getFullYear();
      });
      if (!isHoliday) {
        count++;
      }
    }
    current.setDate(current.getDate() + 1);
  }

  return count;
};

const formatDate = (dateString: string) => {
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
  return new Date(dateString).toLocaleDateString(undefined, options);
};

// Status Badge Component
const StatusBadge = ({ status }: { status: string }) => {
  const statusClasses = {
    'pending': 'bg-yellow-100 text-yellow-800',
    'approved': 'bg-green-100 text-green-800',
    'rejected': 'bg-red-100 text-red-800',
    'recommended': 'bg-blue-100 text-blue-800',
    'not_recommended': 'bg-orange-100 text-orange-800',
  };

  const statusIcons = {
    'pending': PendingIcon,
    'approved': CheckCircle,
    'rejected': XCircle,
    'recommended': ThumbsUp,
    'not_recommended': XCircle,
  };

  const Icon = statusIcons[status as keyof typeof statusIcons] || PendingIcon;

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full ${statusClasses[status as keyof typeof statusClasses] || statusClasses.pending}`}>
      <Icon className="w-3 h-3" />
      {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
    </span>
  );
};

// Recommendation Status Badge Component
const RecStatusBadge = ({ recstatus }: { recstatus: string | null }) => {
  if (!recstatus) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-800">
        <Clock className="w-3 h-3" />
        Not Reviewed
      </span>
    );
  }

  const statusClasses = {
    'recommended': 'bg-blue-100 text-blue-800',
    'not_recommended': 'bg-orange-100 text-orange-800',
  };

  const statusIcons = {
    'recommended': ThumbsUp,
    'not_recommended': XCircle,
  };

  const Icon = statusIcons[recstatus as keyof typeof statusIcons] || Clock;

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full ${statusClasses[recstatus as keyof typeof statusClasses]}`}>
      <Icon className="w-3 h-3" />
      {recstatus.charAt(0).toUpperCase() + recstatus.slice(1).replace('_', ' ')}
    </span>
  );
};

// Leave Type Icon Component
const LeaveTypeIcon = ({ type }: { type: LeaveType }) => {
  const Icon = getIconComponent(type.icon);
  return (
    <div className="p-2 rounded-lg bg-blue-100 text-blue-600">
      <Icon className="w-5 h-5" />
    </div>
  );
};

// Detailed View Component
// Detailed View Component
// Detailed View Component
const LeaveApplicationDetails = ({ application, onClose }: { application: LeaveApplication, onClose: () => void }) => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex-shrink-0 flex justify-between items-center p-6 border-b border-gray-200">
          <h3 className="text-lg font-base text-gray-900">Leave Application Details</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 thin-scrollbar">
          <div className="space-y-4">
            {/* ... your existing content ... */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500">Employee Name</p>
                <p className="font-medium">{application.Name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Employee Number</p>
                <p className="font-medium">{application["Employee Number"]}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Office Branch</p>
                <p className="font-medium">{application["Office Branch"] || 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Leave Type</p>
                <p className="font-medium">{application["Leave Type"]}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Start Date</p>
                <p className="font-medium">{formatDate(application["Start Date"])}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">End Date</p>
                <p className="font-medium">{formatDate(application["End Date"])}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Days</p>
                <p className="font-medium">{application.Days}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Type</p>
                <p className="font-medium">{application.Type}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Status</p>
                <div className="font-medium">
                  <StatusBadge status={application.Status} />
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500">Recommendation Status</p>
                <div className="font-medium">
                  <RecStatusBadge recstatus={application.recstatus} />
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500">Applied On</p>
                <p className="font-medium">{formatDate(application.time_added)}</p>
              </div>
            </div>

            <div>
              <p className="text-xs text-gray-500">Reason</p>
              <p className="font-medium text-sm whitespace-pre-line">{application.Reason}</p>
            </div>

            {application.recommendation_notes && (
              <div>
                <p className="text-xs text-gray-500">Recommendation Notes</p>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="font-medium whitespace-pre-line text-blue-800">{application.recommendation_notes}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex-shrink-0 flex justify-end gap-2 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
// Status Update Modal Component
const StatusUpdateModal = ({
  isOpen,
  onClose,
  applicationId,
  action,
  onUpdateStatus
}: {
  isOpen: boolean;
  onClose: () => void;
  applicationId: string | null;
  action: 'approve' | 'reject' | 'recommend' | 'not_recommend' | null;
  onUpdateStatus: (applicationId: string, status: 'approved' | 'rejected' | 'recommended' | 'not_recommended', notes: string) => Promise<void>;
}) => {
  const [notes, setNotes] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  const handleSubmit = async () => {
    if (!applicationId || !action) return;

    setIsUpdating(true);
    try {
      let status: 'approved' | 'rejected' | 'recommended' | 'not_recommended';
      if (action === 'approve') {
        status = 'approved';
      } else if (action === 'reject') {
        status = 'rejected';
      } else if (action === 'recommend') {
        status = 'recommended';
      } else {
        status = 'not_recommended';
      }

      await onUpdateStatus(applicationId, status, notes);
      setNotes('');
      onClose();
    } catch (error) {
      console.error('Error updating status:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  const getModalTitle = () => {
    switch (action) {
      case 'approve': return 'Approve Leave';
      case 'reject': return 'Reject Leave';
      case 'recommend': return 'Recommend Leave';
      case 'not_recommend': return 'Not Recommend Leave';
      default: return 'Update Leave Status';
    }
  };

  const getNotesLabel = () => {
    switch (action) {
      case 'approve': return 'Approval Notes';
      case 'reject': return 'Reason for Rejection';
      case 'recommend': return 'Recommendation Notes';
      case 'not_recommend': return 'Reason for Not Recommending';
      default: return 'Notes';
    }
  };

  const getNotesPlaceholder = () => {
    switch (action) {
      case 'approve': return 'Add any notes about this approval...';
      case 'reject': return 'Explain why this leave application is being rejected...';
      case 'recommend': return 'Add your recommendation notes for this leave application...';
      case 'not_recommend': return 'Explain why you are not recommending this leave application...';
      default: return 'Add notes...';
    }
  };

  const getButtonColor = () => {
    switch (action) {
      case 'approve': return 'bg-green-600 hover:bg-green-700';
      case 'reject': return 'bg-red-600 hover:bg-red-700';
      case 'recommend': return 'bg-blue-600 hover:bg-blue-700';
      case 'not_recommend': return 'bg-orange-600 hover:bg-orange-700';
      default: return 'bg-gray-600 hover:bg-gray-700';
    }
  };

  const getButtonIcon = () => {
    switch (action) {
      case 'approve': return CheckCircle;
      case 'reject': return XCircle;
      case 'recommend': return ThumbsUp;
      case 'not_recommend': return XCircle;
      default: return CheckCircle;
    }
  };

  if (!isOpen) return null;

  const Icon = getButtonIcon();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-base text-gray-900">
            {getModalTitle()}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {getNotesLabel()}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
              rows={4}
              placeholder={getNotesPlaceholder()}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs"
            disabled={isUpdating}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className={`px-4 py-2 ${getButtonColor()} text-white rounded-lg text-xs flex items-center gap-2`}
            disabled={isUpdating}
          >
            {isUpdating ? (
              <span className="inline-block h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
            ) : (
              <Icon className="w-4 h-4" />
            )}
            {action === 'recommend' ? 'Recommend' : action === 'not_recommend' ? 'Not Recommend' : 'Update Status'}
          </button>
        </div>
      </div>
    </div>
  );
};

// Pagination Component
const Pagination = ({
  currentPage,
  totalPages,
  onPageChange,
  itemsPerPage,
  onItemsPerPageChange
}: {
  currentPage: number,
  totalPages: number,
  onPageChange: (page: number) => void,
  itemsPerPage: number,
  onItemsPerPageChange: (value: number) => void
}) => {
  const pageNumbers = [];
  for (let i = 1; i <= totalPages; i++) {
    pageNumbers.push(i);
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t border-gray-200">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-600">Items per page:</span>
        <select
          value={itemsPerPage}
          onChange={(e) => onItemsPerPageChange(Number(e.target.value))}
          className="bg-gray-50 border border-gray-300 text-gray-700 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 p-1"
        >
          <option value={5}>5</option>
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
        </select>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="px-3 py-1 border border-gray-300 rounded-md text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Previous
        </button>

        <div className="flex gap-1">
          {pageNumbers.slice(
            Math.max(0, currentPage - 3),
            Math.min(totalPages, currentPage + 2)
          ).map(number => (
            <button
              key={number}
              onClick={() => onPageChange(number)}
              className={`px-3 py-1 border rounded-md text-xs font-medium ${currentPage === number ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300'}`}
            >
              {number}
            </button>
          ))}
        </div>

        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="px-3 py-1 border border-gray-300 rounded-md text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  );
};

// Function to get branch from town using the reference table
const getBranchFromTown = async (town: string): Promise<string | null> => {
  try {
    const { data, error } = await supabase
      .from('kenya_branches')
      .select('"Branch Office"')
      .ilike('Area', `%${town}%`)
      .limit(1);

    if (error) {
      console.error("Error fetching branch from town:", error);
      return null;
    }

    if (data && data.length > 0) {
      return data[0]['Branch Office'];
    }

    return null;
  } catch (error) {
    console.error("Error in getBranchFromTown:", error);
    return null;
  }
};

// Get town/area display name
const getDisplayName = (currentTown: string, isArea: boolean) => {
  if (!currentTown) return "All Towns";
  if (currentTown === 'ADMIN_ALL') return "All Towns";

  if (isArea) {
    return `${currentTown} Region`;
  }

  return currentTown;
};

// Skeleton Loader Component for Table Rows
const TableSkeletonLoader = ({ rows = 5, columns = 9 }) => {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <tr key={rowIndex} className="border-b border-gray-300 animate-pulse">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <td key={colIndex} className="py-4 px-4">
              <div className="h-4 bg-gray-200 rounded"></div>
            </td>
          ))}
        </tr>
      ))}
    </>
  );
};

// Stats Card Skeleton Loader
const StatsSkeletonLoader = () => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm animate-pulse">
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 rounded-lg bg-gray-200 h-9 w-9"></div>
          </div>
          <div className="space-y-1">
            <div className="h-3 bg-gray-200 rounded w-3/4"></div>
            <div className="h-5 bg-gray-200 rounded w-1/2"></div>
          </div>
        </div>
      ))}
    </div>
  );
};

// Leave Type Form Modal
const LeaveTypeFormModal = ({
  isOpen,
  onClose,
  newLeaveType,
  setNewLeaveType,
  handleSaveLeaveType,
  handleAddLeaveType
}: {
  isOpen: boolean;
  onClose: () => void;
  newLeaveType: any;
  setNewLeaveType: React.Dispatch<React.SetStateAction<any>>;
  handleSaveLeaveType: (type: LeaveType) => void;
  handleAddLeaveType: () => void;
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-base text-gray-900">
            {newLeaveType.id ? 'Edit Leave Type' : 'Add Leave Type'}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Leave Type Name
            </label>
            <input
              type="text"
              value={newLeaveType.name}
              onChange={(e) => setNewLeaveType((prev: any) => ({ ...prev, name: e.target.value }))}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
              placeholder="e.g., Annual Leave"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={newLeaveType.description}
              onChange={(e) => setNewLeaveType((prev: any) => ({ ...prev, description: e.target.value }))}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
              rows={3}
              placeholder="Describe this leave type..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Maximum Days
              </label>
              <input
                type="number"
                value={newLeaveType.max_days || ''}
                onChange={(e) => setNewLeaveType((prev: any) => ({ ...prev, max_days: e.target.value ? Number(e.target.value) : undefined }))}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                placeholder="Unlimited"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Icon
              </label>
              <select
                value={newLeaveType.icon}
                onChange={(e) => setNewLeaveType((prev: any) => ({ ...prev, icon: e.target.value }))}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
              >
                <option value="Sun">Sun</option>
                <option value="Heart">Heart</option>
                <option value="Baby">Baby</option>
                <option value="Activity">Activity</option>
                <option value="Zap">Zap</option>
                <option value="Gift">Gift</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={newLeaveType.is_deductible}
                onChange={(e) => setNewLeaveType((prev: any) => ({ ...prev, is_deductible: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label className="ml-2 text-xs text-gray-700">Deductible from balance</label>
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                checked={newLeaveType.is_continuous}
                onChange={(e) => setNewLeaveType((prev: any) => ({ ...prev, is_continuous: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label className="ml-2 text-xs text-gray-700">Continuous leave</label>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-6">
          <button
            onClick={() => {
              onClose();
              setNewLeaveType({ name: '', description: '', is_deductible: true, is_continuous: true, icon: 'Sun' });
            }}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (newLeaveType.id) {
                handleSaveLeaveType(newLeaveType as LeaveType);
              } else {
                handleAddLeaveType();
              }
            }}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            {newLeaveType.id ? 'Update' : 'Save'} Leave Type
          </button>
        </div>
      </div>
    </div>
  );
};

// Holiday Form Modal
const HolidayFormModal = ({
  isOpen,
  onClose,
  newHoliday,
  setNewHoliday,
  handleSaveHoliday,
  handleAddHoliday
}: {
  isOpen: boolean;
  onClose: () => void;
  newHoliday: any;
  setNewHoliday: React.Dispatch<React.SetStateAction<any>>;
  handleSaveHoliday: (holiday: Holiday) => void;
  handleAddHoliday: () => void;
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-base text-gray-900">
            {newHoliday.id ? 'Edit Holiday' : 'Add Holiday'}
          </h3>
          <button
            onClick={() => {
              onClose();
              setNewHoliday({ name: '', date: new Date().toISOString().split('T')[0], recurring: true });
            }}
            className="text-gray-500 hover:text-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Holiday Name
            </label>
            <input
              type="text"
              value={newHoliday.name}
              onChange={(e) => setNewHoliday((prev: any) => ({ ...prev, name: e.target.value }))}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
              placeholder="e.g., New Year's Day"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Date
            </label>
            <input
              type="date"
              value={newHoliday.date}
              onChange={(e) => setNewHoliday((prev: any) => ({ ...prev, date: e.target.value }))}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              checked={newHoliday.recurring}
              onChange={(e) => setNewHoliday((prev: any) => ({ ...prev, recurring: e.target.checked }))}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label className="ml-2 text-xs text-gray-700">Recurring holiday (every year)</label>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-6">
          <button
            onClick={() => {
              onClose();
              setNewHoliday({ name: '', date: new Date().toISOString().split('T')[0], recurring: true });
            }}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (newHoliday.id) {
                handleSaveHoliday(newHoliday as Holiday);
              } else {
                handleAddHoliday();
              }
            }}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            {newHoliday.id ? 'Update' : 'Save'} Holiday
          </button>
        </div>
      </div>
    </div>
  );
};

// Accrual Settings Modal
const AccrualSettingsModal = ({
  isOpen,
  onClose,
  accrualSettings,
  handleRunAccrual,
  employees
}: {
  isOpen: boolean;
  onClose: () => void;
  accrualSettings: any;
  handleRunAccrual: () => void;
  employees: Employee[];
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-base text-gray-900">Run Leave Accrual</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-yellow-800">Important</p>
                <p className="text-xs text-yellow-700 mt-1">
                  This will add {accrualSettings.accrualAmount} days to all employees' leave balances
                  for deductible leave types. This action cannot be undone.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-gray-700">Accrual Details:</p>
              <ul className="text-xs text-gray-600 space-y-1 mt-2">
                <li>• Amount: {accrualSettings.accrualAmount} days per employee</li>
                <li>• Interval: {accrualSettings.accrualInterval}</li>
                <li>• Next accrual: {formatDate(accrualSettings.nextAccrualDate)}</li>
                <li>• Affected employees: {employees.length}</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs"
          >
            Cancel
          </button>
          <button
            onClick={handleRunAccrual}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Run Accrual Now
          </button>
        </div>
      </div>
    </div>
  );
};

const LeaveApplicationFormModal = ({
  isOpen,
  onClose,
  newLeaveApplication,
  setNewLeaveApplication,
  employees,
  leaveTypes,
  holidays,
  handleApplyLeave
}: {
  isOpen: boolean;
  onClose: () => void;
  newLeaveApplication: any;
  setNewLeaveApplication: React.Dispatch<React.SetStateAction<any>>;
  employees: Employee[];
  leaveTypes: LeaveType[];
  holidays: Holiday[];
  handleApplyLeave: () => void;
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const days = calculateWorkingDays(
      newLeaveApplication["Start Date"],
      newLeaveApplication["End Date"],
      holidays
    );
    setNewLeaveApplication((prev: any) => ({ ...prev, "Days": days }));
  }, [newLeaveApplication["Start Date"], newLeaveApplication["End Date"], holidays, isOpen, setNewLeaveApplication]);

  const handleEmployeeChange = (employeeNumber: string) => {
    const employee = employees.find((e) => e["Employee Number"] === employeeNumber);
    if (employee) {
      setNewLeaveApplication((prev: any) => ({
        ...prev,
        "Employee Number": employee["Employee Number"],
        "Name": `${employee["First Name"]} ${employee["Last Name"]}`,
        "Office Branch": employee.Branch || employee.Town || 'N/A'
      }));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto thin-scrollbar">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-gray-900">Assign Leave</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PremiumSearchableDropdown
              label="Select Employee"
              placeholder="Find a staff member..."
              icon={User}
              options={employees.map(emp => ({
                label: `${emp["First Name"]} ${emp["Last Name"]} (${emp["Employee Number"]})`,
                value: emp["Employee Number"]
              }))}
              value={newLeaveApplication["Employee Number"]}
              onChange={handleEmployeeChange}
            />

            <PremiumSearchableDropdown
              label="Leave Type"
              placeholder="Choose leave type..."
              icon={FileText}
              options={leaveTypes.map(type => ({
                label: type.name,
                value: type.name
              }))}
              value={newLeaveApplication["Leave Type"]}
              onChange={(val) => setNewLeaveApplication((prev: any) => ({ ...prev, "Leave Type": val }))}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Start Date
              </label>
              <input
                type="date"
                value={newLeaveApplication["Start Date"]}
                onChange={(e) => setNewLeaveApplication((prev: any) => ({ ...prev, "Start Date": e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                End Date
              </label>
              <input
                type="date"
                value={newLeaveApplication["End Date"]}
                onChange={(e) => setNewLeaveApplication((prev: any) => ({ ...prev, "End Date": e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Working Days
              </label>
              <input
                type="number"
                value={newLeaveApplication["Days"]}
                readOnly
                className="w-full border border-gray-100 bg-gray-50 rounded-lg px-3 py-2 text-sm font-bold text-blue-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PremiumSearchableDropdown
              label="Leave Duration Type"
              placeholder="Select duration..."
              icon={Clock}
              options={[
                { label: "Full Day", value: "Full Day" },
                { label: "Half Day", value: "Half Day" }
              ]}
              value={newLeaveApplication["Type"]}
              onChange={(val) => setNewLeaveApplication((prev: any) => ({ ...prev, "Type": val }))}
            />

            <PremiumSearchableDropdown
              label="Application Basis"
              placeholder="Select basis..."
              icon={Zap}
              options={[
                { label: "Normal", value: "Normal" },
                { label: "Emergency", value: "Emergency" },
                { label: "Retrospective", value: "Retrospective" }
              ]}
              value={newLeaveApplication["Application Type"]}
              onChange={(val) => setNewLeaveApplication((prev: any) => ({ ...prev, "Application Type": val }))}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Reason / Remarks
            </label>
            <textarea
              value={newLeaveApplication["Reason"]}
              onChange={(e) => setNewLeaveApplication((prev: any) => ({ ...prev, "Reason": e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
              rows={3}
              placeholder="Reason for granting this leave..."
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-8">
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-semibold transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApplyLeave}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 shadow-lg shadow-indigo-600/20 active:scale-[0.98] transition-all"
          >
            <Save className="w-4 h-4" />
            Confirm Assignment
          </button>
        </div>
      </div>
    </div>
  );
};

// Leave Management Dashboard
export default function LeaveManagementSystem({ selectedTown, onTownChange, selectedRegion }: TownProps) {
  // State variables for town filtering
  const [currentTown, setCurrentTown] = useState<string>(selectedTown || '');
  const [areaTownMapping, setAreaTownMapping] = useState<AreaTownMapping>({});
  const [branchAreaMapping, setBranchAreaMapping] = useState<BranchAreaMapping>({});
  const [isArea, setIsArea] = useState<boolean>(false);
  const [townsInArea, setTownsInArea] = useState<string[]>([]);
  const [debugInfo, setDebugInfo] = useState<string>("Initializing...");

  // Original state variables
  const [activeTab, setActiveTab] = useState('applications');
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>(DEFAULT_LEAVE_TYPES);
  const [holidays, setHolidays] = useState<Holiday[]>(SAMPLE_HOLIDAYS);
  const [leaveApplications, setLeaveApplications] = useState<LeaveApplication[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<EmployeeLeaveBalance[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedApplication, setSelectedApplication] = useState<LeaveApplication | null>(null);

  // Status update modal state
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const [statusAction, setStatusAction] = useState<'approve' | 'reject' | 'recommend' | 'not_recommend' | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Pagination states
  const [applicationsPage, setApplicationsPage] = useState(1);
  const [applicationsPerPage, setApplicationsPerPage] = useState(10);
  const [balancesPage, setBalancesPage] = useState(1);
  const [balancesPerPage, setBalancesPerPage] = useState(10);
  const [typesPage, setTypesPage] = useState(1);
  const [typesPerPage, setTypesPerPage] = useState(10);
  const [holidaysPage, setHolidaysPage] = useState(1);
  const [holidaysPerPage, setHolidaysPerPage] = useState(10);

  // Loading states for buttons
  const [savingBalances, setSavingBalances] = useState(false);

  // Form states
  const [showLeaveTypeForm, setShowLeaveTypeForm] = useState(false);
  const [showHolidayForm, setShowHolidayForm] = useState(false);
  const [showLeaveApplicationForm, setShowLeaveApplicationForm] = useState(false);
  const [showAccrualSettings, setShowAccrualSettings] = useState(false);

  // Form data
  const [newLeaveType, setNewLeaveType] = useState<Partial<LeaveType>>({
    name: '',
    description: '',
    is_deductible: true,
    is_continuous: true,
    icon: 'Sun'
  });
  const [newHoliday, setNewHoliday] = useState<Partial<Holiday>>({
    name: '',
    date: new Date().toISOString().split('T')[0],
    recurring: true
  });
  const [newLeaveApplication, setNewLeaveApplication] = useState<Omit<LeaveApplication, 'id' | 'time_added'>>({
    "Employee Number": '',
    "Name": '',
    "Leave Type": '',
    "Start Date": new Date().toISOString().split('T')[0],
    "End Date": new Date().toISOString().split('T')[0],
    "Days": 0,
    "Type": 'Full Day',
    "Application Type": 'Normal',
    "Office Branch": '',
    "Reason": '',
    "Status": 'pending',
    "recstatus": null
  });
  const [accrualSettings, setAccrualSettings] = useState({
    accrualInterval: 'monthly',
    accrualAmount: 2,
    nextAccrualDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString().split('T')[0]
  });

  // Load area-town mapping and saved town from localStorage on component mount
  useEffect(() => {
    const loadMappings = async () => {
      try {
        // Fetch the area-town mapping from the database
        const { data: employeesData, error: employeesError } = await supabase
          .from('employees')
          .select('Branch, Town');

        if (employeesError) {
          console.error("Error loading area-town mapping:", employeesError);
          return;
        }

        // Convert the data to a mapping object
        const mapping: AreaTownMapping = {};
        employeesData?.forEach(item => {
          if (item.Branch && item.Town) {
            if (!mapping[item.Branch]) {
              mapping[item.Branch] = [];
            }
            mapping[item.Branch].push(item.Town);
          }
        });

        setAreaTownMapping(mapping);

        // Fetch branch-area mapping from kenya_branches
        const { data: branchesData, error: branchesError } = await supabase
          .from('kenya_branches')
          .select('"Branch Office", "Area"');

        if (branchesError) {
          console.error("Error loading branch-area mapping:", branchesError);
          return;
        }

        // Convert the data to a mapping object
        const branchMapping: BranchAreaMapping = {};
        branchesData?.forEach(item => {
          if (item['Branch Office'] && item['Area']) {
            branchMapping[item['Branch Office']] = item['Area'];
          }
        });

        setBranchAreaMapping(branchMapping);
        setDebugInfo("Mappings loaded successfully");
      } catch (error) {
        console.error("Error in loadMappings:", error);
        setDebugInfo(`Error loading mappings: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    };

    loadMappings();

    const savedTown = localStorage.getItem('selectedTown');
    if (savedTown && (!selectedTown || selectedTown === 'ADMIN_ALL')) {
      setCurrentTown(savedTown);
      if (onTownChange) {
        onTownChange(savedTown);
      }
      setDebugInfo(`Loaded saved town from storage: "${savedTown}"`);
    } else if (selectedTown) {
      setCurrentTown(selectedTown);
      localStorage.setItem('selectedTown', selectedTown);
      setDebugInfo(`Using town from props: "${selectedTown}"`);
    }
  }, [selectedTown, onTownChange]);

  // Check if current selection is an area and get its towns
  useEffect(() => {
    if (currentTown && areaTownMapping[currentTown]) {
      setIsArea(true);
      setTownsInArea(areaTownMapping[currentTown]);
      setDebugInfo(`"${currentTown}" is an area containing towns: ${areaTownMapping[currentTown].join(', ')}`);
    } else {
      setIsArea(false);
      setTownsInArea([]);
    }
  }, [currentTown, areaTownMapping]);

  // Calculate paginated data
  const paginatedApplications = leaveApplications.slice(
    (applicationsPage - 1) * applicationsPerPage,
    applicationsPage * applicationsPerPage
  );
  const totalApplicationPages = Math.ceil(leaveApplications.length / applicationsPerPage);

  const paginatedBalances = leaveBalances.slice(
    (balancesPage - 1) * balancesPerPage,
    balancesPage * balancesPerPage
  );
  const totalBalancePages = Math.ceil(leaveBalances.length / balancesPerPage);

  const paginatedTypes = leaveTypes.slice(
    (typesPage - 1) * typesPerPage,
    typesPage * typesPerPage
  );
  const totalTypePages = Math.ceil(leaveTypes.length / typesPerPage);

  const paginatedHolidays = holidays.slice(
    (holidaysPage - 1) * holidaysPerPage,
    holidaysPage * holidaysPerPage
  );
  const totalHolidayPages = Math.ceil(holidays.length / holidaysPerPage);

  // Function to create leave balance records
  const createLeaveBalances = (employeesData: Employee[], applicationsData: LeaveApplication[]) => {
    const balances: EmployeeLeaveBalance[] = [];

    const deductibleLeaveTypes = DEFAULT_LEAVE_TYPES.filter(type => type.is_deductible);

    employeesData.forEach(employee => {
      deductibleLeaveTypes.forEach(leaveType => {
        const usedDays = applicationsData
          .filter(app =>
            app["Employee Number"] === employee["Employee Number"] &&
            app["Leave Type"] === leaveType.name &&
            app.Status === 'approved'
          )
          .reduce((sum, app) => sum + (app.Days || 0), 0);

        let monthlyAccrual = 0;
        let quarterlyAccrual = 0;
        let annualAccrual = 0;

        if (leaveType.name === 'Annual Leave') {
          monthlyAccrual = 2;
          quarterlyAccrual = 6;
          annualAccrual = 24;
        } else if (leaveType.name === 'Sick Leave') {
          monthlyAccrual = 1;
          quarterlyAccrual = 3;
          annualAccrual = 14;
        }

        const accruedDays = leaveType.max_days || annualAccrual;
        const remainingDays = accruedDays - usedDays;

        balances.push({
          id: `${employee["Employee Number"]}-${leaveType.id}`,
          employee_number: employee["Employee Number"],
          first_name: employee["First Name"],
          last_name: employee["Last Name"],
          office: employee.Branch || employee.Town || 'N/A',
          leave_type_id: leaveType.id,
          leave_type_name: leaveType.name,
          accrued_days: accruedDays,
          used_days: usedDays,
          remaining_days: remainingDays,
          last_accrual_date: new Date().toISOString().split('T')[0],
          monthly_accrual: monthlyAccrual,
          quarterly_accrual: quarterlyAccrual,
          annual_accrual: annualAccrual
        });
      });
    });

    return balances;
  };

  // Function to update balance accruals
  const updateBalanceAccrual = (balanceIndex: number, field: 'monthly_accrual' | 'quarterly_accrual' | 'annual_accrual', value: number) => {
    setLeaveBalances(prev => {
      const updated = [...prev];
      updated[balanceIndex] = {
        ...updated[balanceIndex],
        [field]: value
      };
      return updated;
    });
  };

  // Function to save balance changes
  const saveBalanceChanges = async () => {
    setSavingBalances(true);
    try {
      console.log('Saving balance changes:', leaveBalances);
      await new Promise(resolve => setTimeout(resolve, 1000));
      alert('Leave balance settings saved successfully!');
    } catch (err) {
      setError('Failed to save balance changes. Please try again.');
      console.error(err);
    } finally {
      setSavingBalances(false);
    }
  };

  // Function to open status update modal
  const openStatusModal = (applicationId: string, action: 'approve' | 'reject' | 'recommend' | 'not_recommend') => {
    setSelectedApplicationId(applicationId);
    setStatusAction(action);
    setShowStatusModal(true);
  };

  // Function to update leave status with reason
  const handleUpdateStatus = async (applicationId: string, status: 'approved' | 'rejected' | 'recommended' | 'not_recommended', notes: string) => {
    setUpdatingStatus(true);
    try {
      let updateData: any = {};

      if (status === 'approved' || status === 'rejected') {
        updateData = {
          "Status": status,
          "Reason": notes
        };
      } else if (status === 'recommended' || status === 'not_recommended') {
        updateData = {
          "recstatus": status,
          "recommendation_notes": notes
        };
      }

      const { error } = await supabase
        .from('leave_application')
        .update(updateData)
        .eq('id', applicationId);

      if (error) throw error;

      setLeaveApplications(prev => prev.map(app =>
        app.id === applicationId ? {
          ...app,
          ...updateData
        } : app
      ));

    } catch (err) {
      setError(`Failed to update status. Please try again.`);
      console.error(err);
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Fetch employees for dropdown
  useEffect(() => {
    const fetchEmployees = async () => {
      try {
        const { data, error } = await supabase
          .from('employees')
          .select('*')
          .order('First Name');

        if (error) throw error;
        setEmployees(data || []);
      } catch (err) {
        console.error('Error fetching employees:', err);
      }
    };

    fetchEmployees();
  }, []);

  // Fetch leave balances
  useEffect(() => {
    const fetchLeaveBalances = async () => {
      try {
        // In a real app, you'd fetch from a leave_balances table
        // For now, we'll create them from employees and applications
        const { data: employeesData } = await supabase
          .from('employees')
          .select('*');

        const { data: applicationsData } = await supabase
          .from('leave_application')
          .select('*');

        if (employeesData && applicationsData) {
          const balances = createLeaveBalances(employeesData, applicationsData);
          setLeaveBalances(balances);
        }
      } catch (err) {
        console.error('Error fetching leave balances:', err);
      }
    };

    if (activeTab === 'balances') {
      fetchLeaveBalances();
    }
  }, [activeTab]);

  // Fetch leave types from Supabase
  useEffect(() => {
    const fetchLeaveTypes = async () => {
      try {
        const { data, error } = await supabase
          .from('leave_types')
          .select('*')
          .order('name');

        if (error) throw error;
        if (data && data.length > 0) {
          setLeaveTypes(data);
        }
      } catch (err) {
        console.error('Error fetching leave types:', err);
        // Fallback to default types if table doesn't exist
      }
    };

    if (activeTab === 'types') {
      fetchLeaveTypes();
    }
  }, [activeTab]);

  // Fetch holidays from Supabase
  useEffect(() => {
    const fetchHolidays = async () => {
      try {
        const { data, error } = await supabase
          .from('holidays')
          .select('*')
          .order('date');

        if (error) throw error;
        if (data && data.length > 0) {
          setHolidays(data);
        }
      } catch (err) {
        console.error('Error fetching holidays:', err);
        // Fallback to sample holidays if table doesn't exist
      }
    };

    if (activeTab === 'holidays') {
      fetchHolidays();
    }
  }, [activeTab]);

  // Fetch data from Supabase
  useEffect(() => {
    const fetchLeaveApplications = async () => {
      setLoading(true);
      try {
        console.log('[DEBUG] Fetching applications for town:', currentTown);

        // Build base query
        let query = supabase
          .from('leave_application')
          .select('*')
          .order('time_added', { ascending: false });

        // Apply Office Branch filter if selected
        if (currentTown && currentTown !== 'ADMIN_ALL') {
          console.log('[DEBUG] Applying filter for town:', currentTown);
          query = query.eq('"Office Branch"', currentTown.trim());
        }

        // Execute query
        const { data, error } = await query;

        console.log('[DEBUG] Query results:', data);

        if (error) {
          console.error('[DEBUG] Query error:', error);
          throw error;
        }

        // Type cast and transform the data
        const applications = (data as LeaveApplication[]).map(app => {
          console.log('[DEBUG] Processing application:', app.id, 'with branch:', app["Office Branch"]);
          return {
            id: app.id,
            "Employee Number": app["Employee Number"],
            "Name": app["Name"],
            "Leave Type": app["Leave Type"],
            "Start Date": app["Start Date"],
            "End Date": app["End Date"],
            "Days": app["Days"],
            "Type": app["Type"],
            "Application Type": app["Application Type"],
            "Office Branch": app["Office Branch"] || 'N/A',
            "Reason": app["Reason"],
            "Status": app["Status"].toLowerCase() as 'pending' | 'approved' | 'rejected',
            "recstatus": app.recstatus || null,
            "time_added": app.time_added,
            "recommendation_notes": app.recommendation_notes || undefined
          };
        });

        setLeaveApplications(applications);

      } catch (err) {
        console.error('[DEBUG] Fetch error:', err);
        setError('Failed to fetch leave applications');
      } finally {
        setLoading(false);
      }
    };

    fetchLeaveApplications();

    // Realtime subscription for leave applications
    const subscription = supabase
      .channel('leave_applications_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'leave_application',
          filter: currentTown && currentTown !== 'ADMIN_ALL'
            ? `"Office Branch"=eq.${currentTown.trim()}`
            : undefined
        },
        (payload) => {
          console.log('[DEBUG] Realtime update:', payload);

          if (!payload.new) return;
          const application = payload.new as LeaveApplication;

          if (payload.eventType === 'INSERT') {
            setLeaveApplications(prev => [{
              id: application.id,
              "Employee Number": application["Employee Number"],
              "Name": application["Name"],
              "Leave Type": application["Leave Type"],
              "Start Date": application["Start Date"],
              "End Date": application["End Date"],
              "Days": application["Days"],
              "Type": application["Type"],
              "Application Type": application["Application Type"],
              "Office Branch": application["Office Branch"] || 'N/A',
              "Reason": application["Reason"],
              "Status": application["Status"].toLowerCase() as 'pending' | 'approved' | 'rejected',
              "recstatus": application.recstatus || null,
              "time_added": application.time_added,
              "recommendation_notes": application.recommendation_notes
            }, ...prev]);
          }
          else if (payload.eventType === 'UPDATE') {
            setLeaveApplications(prev => prev.map(app =>
              app.id === application.id ? {
                ...app,
                "Status": application["Status"].toLowerCase() as 'pending' | 'approved' | 'rejected',
                "recstatus": application.recstatus || null,
                "Reason": application["Reason"],
                "Days": application["Days"],
                "recommendation_notes": application.recommendation_notes
              } : app
            ));
          }
          else if (payload.eventType === 'DELETE') {
            setLeaveApplications(prev => prev.filter(app => app.id !== application.id));
          }
        }
      )
      .subscribe();

    return () => {
      console.log('[DEBUG] Cleaning up subscription');
      supabase.removeChannel(subscription);
    };
  }, [currentTown]);

  // Form handlers
  const handleAddLeaveType = () => {
    const newType: LeaveType = {
      ...newLeaveType as Omit<LeaveType, 'id'>,
      id: `custom-${Date.now()}`,
    };
    setLeaveTypes([...leaveTypes, newType]);
    setShowLeaveTypeForm(false);
    setNewLeaveType({ name: '', description: '', is_deductible: true, is_continuous: true, icon: 'Sun' });
  };

  const handleAddHoliday = () => {
    const newHolidayWithId: Holiday = {
      ...newHoliday as Omit<Holiday, 'id'>,
      id: `holiday-${Date.now()}`,
    };
    setHolidays([...holidays, newHolidayWithId]);
    setShowHolidayForm(false);
    setNewHoliday({ name: '', date: new Date().toISOString().split('T')[0], recurring: true });
  };

  const handleApplyLeave = async () => {
    const leaveType = leaveTypes.find(lt => lt.name === newLeaveApplication["Leave Type"]);
    const employee = employees.find(e => e["Employee Number"] === newLeaveApplication["Employee Number"]);

    if (!leaveType || !employee) return;

    try {
      const days = calculateWorkingDays(
        newLeaveApplication["Start Date"],
        newLeaveApplication["End Date"],
        holidays
      );

      const { error } = await supabase
        .from('leave_application')
        .insert([{
          "Employee Number": newLeaveApplication["Employee Number"],
          "Name": `${employee["First Name"]} ${employee["Last Name"]}`,
          "Leave Type": newLeaveApplication["Leave Type"],
          "Start Date": newLeaveApplication["Start Date"],
          "End Date": newLeaveApplication["End Date"],
          "Days": days,
          "Type": newLeaveApplication["Type"],
          "Application Type": newLeaveApplication["Application Type"],
          "Office Branch": employee.Branch || employee.Town || 'N/A',
          "Reason": newLeaveApplication["Reason"],
          "Status": newLeaveApplication["Status"],
          "recstatus": newLeaveApplication["recstatus"],
          "time_added": new Date().toISOString()
        }])
        .select();

      if (error) throw error;

      alert('Leave assigned successfully!');
      setShowLeaveApplicationForm(false);
      setNewLeaveApplication({
        "Employee Number": '',
        "Name": '',
        "Leave Type": '',
        "Start Date": new Date().toISOString().split('T')[0],
        "End Date": new Date().toISOString().split('T')[0],
        "Days": 0,
        "Type": 'Full Day',
        "Application Type": 'Normal',
        "Office Branch": '',
        "Reason": '',
        "Status": 'pending',
        "recstatus": null
      });

    } catch (err) {
      setError('Failed to submit leave application. Please try again.');
      console.error(err);
    }
  };

  const handleRunAccrual = () => {
    const newBalances = leaveBalances.map(balance => {
      const leaveType = leaveTypes.find(lt => lt.id === balance.leave_type_id);
      if (leaveType?.is_deductible) {
        return {
          ...balance,
          accrued_days: balance.accrued_days + accrualSettings.accrualAmount,
          remaining_days: balance.remaining_days + accrualSettings.accrualAmount,
          last_accrual_date: new Date().toISOString().split('T')[0]
        };
      }
      return balance;
    });

    setLeaveBalances(newBalances);
    setShowAccrualSettings(false);
    console.log(`Leave days accrued. Next accrual would be on ${accrualSettings.nextAccrualDate}`);
  };

  // Add these new form handlers for the missing tabs:

  // Leave Types Tab Handlers
  const handleSaveLeaveType = async (type: LeaveType) => {
    try {
      if (type.id.startsWith('custom-')) {
        // New type - insert
        const { data, error } = await supabase
          .from('leave_types')
          .insert([{
            name: type.name,
            description: type.description,
            is_deductible: type.is_deductible,
            is_continuous: type.is_continuous,
            max_days: type.max_days,
            icon: type.icon
          }])
          .select();

        if (error) throw error;

        if (data) {
          setLeaveTypes(prev => prev.map(t => t.id === type.id ? { ...type, id: data[0].id } : t));
        }
      } else {
        // Existing type - update
        const { error } = await supabase
          .from('leave_types')
          .update({
            name: type.name,
            description: type.description,
            is_deductible: type.is_deductible,
            is_continuous: type.is_continuous,
            max_days: type.max_days,
            icon: type.icon
          })
          .eq('id', type.id);

        if (error) throw error;
      }
    } catch (err) {
      setError('Failed to save leave type. Please try again.');
      console.error(err);
    }
  };

  const handleDeleteLeaveType = async (typeId: string) => {
    if (!typeId.startsWith('custom-')) {
      try {
        const { error } = await supabase
          .from('leave_types')
          .delete()
          .eq('id', typeId);

        if (error) throw error;
      } catch (err) {
        setError('Failed to delete leave type. Please try again.');
        console.error(err);
        return;
      }
    }

    setLeaveTypes(prev => prev.filter(type => type.id !== typeId));
  };

  // Holidays Tab Handlers
  const handleSaveHoliday = async (holiday: Holiday) => {
    try {
      if (holiday.id.startsWith('holiday-')) {
        // New holiday - insert
        const { data, error } = await supabase
          .from('holidays')
          .insert([{
            name: holiday.name,
            date: holiday.date,
            recurring: holiday.recurring
          }])
          .select();

        if (error) throw error;

        if (data) {
          setHolidays(prev => prev.map(h => h.id === holiday.id ? { ...holiday, id: data[0].id } : h));
        }
      } else {
        // Existing holiday - update
        const { error } = await supabase
          .from('holidays')
          .update({
            name: holiday.name,
            date: holiday.date,
            recurring: holiday.recurring
          })
          .eq('id', holiday.id);

        if (error) throw error;
      }
    } catch (err) {
      setError('Failed to save holiday. Please try again.');
      console.error(err);
    }
  };

  const handleDeleteHoliday = async (holidayId: string) => {
    if (!holidayId.startsWith('holiday-')) {
      try {
        const { error } = await supabase
          .from('holidays')
          .delete()
          .eq('id', holidayId);

        if (error) throw error;
      } catch (err) {
        setError('Failed to delete holiday. Please try again.');
        console.error(err);
        return;
      }
    }

    setHolidays(prev => prev.filter(holiday => holiday.id !== holidayId));
  };

  // Calculate leave statistics for dashboard
  const pendingApplications = leaveApplications.filter(app => app.Status === 'pending').length;
  const approvedApplications = leaveApplications.filter(app => app.Status === 'approved').length;
  const recommendedApplications = leaveApplications.filter(app => app.recstatus === 'recommended').length;
  const notRecommendedApplications = leaveApplications.filter(app => app.recstatus === 'not_recommended').length;
  const totalLeaveDaysUsed = leaveBalances.reduce((sum, balance) => sum + balance.used_days, 0);
  const totalLeaveDaysRemaining = leaveBalances.reduce((sum, balance) => sum + balance.remaining_days, 0);

  // Refresh function
  const handleRefresh = () => {
    window.location.reload();
  };

  // Add these components before the return statement:

  // Leave Types Tab Content
  const renderLeaveTypesTab = () => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-4 md:p-6 border-b border-gray-200">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-base text-gray-900">Leave Types</h2>
            <p className="text-gray-600 text-xs">{leaveTypes.length} leave types configured</p>
          </div>
          <RoleButtonWrapper allowedRoles={['ADMIN', 'HR']}>
            <button
              onClick={() => setShowLeaveTypeForm(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-medium"
            >
              <Plus className="w-3 h-3" />
              Add Leave Type
            </button>
          </RoleButtonWrapper>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Type</th>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Description</th>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Max Days</th>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Deductible</th>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Continuous</th>
              <th className="text-center py-3 px-4 text-gray-700 font-base">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedTypes.map((type) => (
              <tr key={type.id} className="border-b border-gray-300 hover:bg-gray-50">
                <td className="py-4 px-4">
                  <div className="flex items-center gap-3">
                    <LeaveTypeIcon type={type} />
                    <div>
                      <p className="text-gray-900 font-base">{type.name}</p>
                    </div>
                  </div>
                </td>
                <td className="py-4 px-4">
                  <p className="text-gray-700">{type.description}</p>
                </td>
                <td className="py-4 px-4">
                  <p className="text-gray-700">{type.max_days || 'Unlimited'}</p>
                </td>
                <td className="py-4 px-4">
                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full ${type.is_deductible ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                    {type.is_deductible ? 'Yes' : 'No'}
                  </span>
                </td>
                <td className="py-4 px-4">
                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full ${type.is_continuous ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                    {type.is_continuous ? 'Yes' : 'No'}
                  </span>
                </td>
                <td className="py-4 px-4">
                  <div className="flex justify-center gap-1">
                    <RoleButtonWrapper allowedRoles={['ADMIN', 'HR']}>
                      <button
                        onClick={() => {
                          setNewLeaveType(type);
                          setShowLeaveTypeForm(true);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded text-xs"
                      >
                        <Edit className="w-3 h-3" />
                        Edit
                      </button>
                    </RoleButtonWrapper>
                    <RoleButtonWrapper allowedRoles={['ADMIN', 'HR']}>
                      <button
                        onClick={() => handleDeleteLeaveType(type.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded text-xs"
                      >
                        <Trash2 className="w-3 h-3" />
                        Delete
                      </button>
                    </RoleButtonWrapper>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        currentPage={typesPage}
        totalPages={totalTypePages}
        onPageChange={setTypesPage}
        itemsPerPage={typesPerPage}
        onItemsPerPageChange={setTypesPerPage}
      />
    </div>
  );

  // Leave Balances Tab Content
  const renderLeaveBalancesTab = () => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-4 md:p-6 border-b border-gray-200">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-base text-gray-900">Leave Balances</h2>
            <p className="text-gray-600 text-xs">Employee leave balances and accruals</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowAccrualSettings(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium"
            >
              <RefreshCw className="w-3 h-3" />
              Run Accrual
            </button>
            <button
              onClick={saveBalanceChanges}
              disabled={savingBalances}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-medium disabled:opacity-50"
            >
              {savingBalances ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Save className="w-3 h-3" />
              )}
              {savingBalances ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Employee</th>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Leave Type</th>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Office</th>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Accrued</th>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Used</th>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Remaining</th>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Monthly Accrual</th>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Last Accrual</th>
            </tr>
          </thead>
          <tbody>
            {paginatedBalances.map((balance, index) => (
              <tr key={balance.id} className="border-b border-gray-300 hover:bg-gray-50">
                <td className="py-4 px-4">
                  <div className="space-y-1">
                    <p className="text-gray-900 font-base">{balance.first_name} {balance.last_name}</p>
                    <p className="text-gray-500 text-xs">{balance.employee_number}</p>
                  </div>
                </td>
                <td className="py-4 px-4">
                  <p className="text-gray-700">{balance.leave_type_name}</p>
                </td>
                <td className="py-4 px-4">
                  <p className="text-gray-700">{balance.office}</p>
                </td>
                <td className="py-4 px-4">
                  <p className="text-gray-700">{balance.accrued_days}</p>
                </td>
                <td className="py-4 px-4">
                  <p className="text-gray-700">{balance.used_days}</p>
                </td>
                <td className="py-4 px-4">
                  <p className={`font-medium ${balance.remaining_days < 5 ? 'text-red-600' : 'text-green-600'
                    }`}>
                    {balance.remaining_days}
                  </p>
                </td>
                <td className="py-4 px-4">
                  <input
                    type="number"
                    value={balance.monthly_accrual}
                    onChange={(e) => updateBalanceAccrual(index, 'monthly_accrual', Number(e.target.value))}
                    className="w-16 border border-gray-300 rounded px-2 py-1 text-xs"
                    min="0"
                    step="0.5"
                  />
                </td>
                <td className="py-4 px-4">
                  <p className="text-gray-700">{formatDate(balance.last_accrual_date)}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        currentPage={balancesPage}
        totalPages={totalBalancePages}
        onPageChange={setBalancesPage}
        itemsPerPage={balancesPerPage}
        onItemsPerPageChange={setBalancesPerPage}
      />
    </div>
  );

  // Holidays Tab Content
  const renderHolidaysTab = () => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-4 md:p-6 border-b border-gray-200">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-base text-gray-900">Holidays</h2>
            <p className="text-gray-600 text-xs">{holidays.length} holidays configured</p>
          </div>
          <RoleButtonWrapper allowedRoles={['ADMIN', 'HR']}>
            <button
              onClick={() => setShowHolidayForm(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-medium"
            >
              <Plus className="w-3 h-3" />
              Add Holiday
            </button>
          </RoleButtonWrapper>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Holiday Name</th>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Date</th>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Recurring</th>
              <th className="text-center py-3 px-4 text-gray-700 font-base">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedHolidays.map((holiday) => (
              <tr key={holiday.id} className="border-b border-gray-300 hover:bg-gray-50">
                <td className="py-4 px-4">
                  <p className="text-gray-900 font-base">{holiday.name}</p>
                </td>
                <td className="py-4 px-4">
                  <p className="text-gray-700">{formatDate(holiday.date)}</p>
                </td>
                <td className="py-4 px-4">
                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full ${holiday.recurring ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                    {holiday.recurring ? 'Yes' : 'No'}
                  </span>
                </td>
                <td className="py-4 px-4">
                  <div className="flex justify-center gap-1">
                    <RoleButtonWrapper allowedRoles={['ADMIN', 'HR']}>
                      <button
                        onClick={() => {
                          setNewHoliday(holiday);
                          setShowHolidayForm(true);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded text-xs"
                      >
                        <Edit className="w-3 h-3" />
                        Edit
                      </button>
                    </RoleButtonWrapper>
                    <RoleButtonWrapper allowedRoles={['ADMIN', 'HR']}>
                      <button
                        onClick={() => handleDeleteHoliday(holiday.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded text-xs"
                      >
                        <Trash2 className="w-3 h-3" />
                        Delete
                      </button>
                    </RoleButtonWrapper>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        currentPage={holidaysPage}
        totalPages={totalHolidayPages}
        onPageChange={setHolidaysPage}
        itemsPerPage={holidaysPerPage}
        onItemsPerPageChange={setHolidaysPerPage}
      />
    </div>
  );

  // Settings Tab Content
  const renderSettingsTab = () => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-base text-gray-900 mb-4">Accrual Settings</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Accrual Interval
                </label>
                <select
                  value={accrualSettings.accrualInterval}
                  onChange={(e) => setAccrualSettings(prev => ({ ...prev, accrualInterval: e.target.value }))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Accrual Amount (Days)
                </label>
                <input
                  type="number"
                  value={accrualSettings.accrualAmount}
                  onChange={(e) => setAccrualSettings(prev => ({ ...prev, accrualAmount: Number(e.target.value) }))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                  min="0"
                  step="0.5"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Next Accrual Date
                </label>
                <input
                  type="date"
                  value={accrualSettings.nextAccrualDate}
                  onChange={(e) => setAccrualSettings(prev => ({ ...prev, nextAccrualDate: e.target.value }))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                />
              </div>

              <button
                onClick={handleRunAccrual}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-medium mt-6"
              >
                <RefreshCw className="w-4 h-4" />
                Run Accrual Now
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-6">
          <h3 className="text-lg font-base text-gray-900 mb-4">System Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
            <div className="space-y-2">
              <p><span className="font-medium">Total Employees:</span> {employees.length}</p>
              <p><span className="font-medium">Total Leave Types:</span> {leaveTypes.length}</p>
              <p><span className="font-medium">Total Holidays:</span> {holidays.length}</p>
            </div>
            <div className="space-y-2">
              <p><span className="font-medium">Current Town/Area:</span> {getDisplayName(currentTown, isArea)}</p>
              <p><span className="font-medium">Towns in Area:</span> {townsInArea.length}</p>
              <p><span className="font-medium">Last Updated:</span> {new Date().toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Add these modals before the return statement:

  // Add these modals before the return statement:





  return (
    <div className="p-4 space-y-6 bg-gray-50 min-h-screen max-w-screen-2xl mx-auto">
      {/* Header Section with Town Filter */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">Leave Management System</h1>
            <p className="text-gray-600 text-xs">Manage employee leave applications, balances, and settings</p>
            <div className="flex items-center mt-2">
              <span className="text-xs text-gray-600 mr-2">Viewing:</span>
              <span className="font-medium text-indigo-600 flex items-center">
                <MapPin className="w-4 h-4 mr-1" />
                {getDisplayName(currentTown, isArea)}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 w-full md:w-auto">
            <button
              onClick={handleRefresh}
              className="inline-flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-medium border border-gray-300"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      {loading ? (
        <StatsSkeletonLoader />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 rounded-lg bg-yellow-100 text-yellow-600">
                <Clock className="w-5 h-5" />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-gray-600 text-xs font-base tracking-wide">Pending Applications</p>
              <p className="text-gray-900 text-xl font-bold">{pendingApplications}</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 rounded-lg bg-green-100 text-green-600">
                <CheckCircle className="w-5 h-5" />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-gray-600 text-xs font-base tracking-wide">Approved Applications</p>
              <p className="text-gray-900 text-xl font-bold">{approvedApplications}</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 rounded-lg bg-blue-100 text-blue-600">
                <ThumbsUp className="w-5 h-5" />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-gray-600 text-xs font-base tracking-wide">Recommended</p>
              <p className="text-gray-900 text-xl font-bold">{recommendedApplications}</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 rounded-lg bg-orange-100 text-orange-600">
                <XCircle className="w-5 h-5" />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-gray-600 text-xs font-base tracking-wide">Not Recommended</p>
              <p className="text-gray-900 text-xl font-bold">{notRecommendedApplications}</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 rounded-lg bg-orange-100 text-orange-600">
                <Calendar className="w-5 h-5" />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-gray-600 text-xs font-base tracking-wide">Leave Days Used</p>
              <p className="text-gray-900 text-xl font-bold">{totalLeaveDaysUsed}</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 rounded-lg bg-purple-100 text-purple-600">
                <User className="w-5 h-5" />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-gray-600 text-xs font-base tracking-wide">Leave Days Remaining</p>
              <p className="text-gray-900 text-xl font-bold">{totalLeaveDaysRemaining}</p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs Navigation */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px">
            <button
              onClick={() => setActiveTab('applications')}
              className={`py-4 px-6 text-center border-b-2 font-medium text-xs ${activeTab === 'applications' ? 'border-green-500 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
            >
              Leave Applications
            </button>
            <button
              onClick={() => setActiveTab('scheduler')}
              className={`py-4 px-6 text-center border-b-2 font-medium text-xs ${activeTab === 'scheduler' ? 'border-green-500 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
            >
              Scheduler
            </button>
            <button
              onClick={() => setActiveTab('balances')}
              className={`py-4 px-6 text-center border-b-2 font-medium text-xs ${activeTab === 'balances' ? 'border-green-500 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
            >
              Leave Balances
            </button>
            <button
              onClick={() => setActiveTab('types')}
              className={`py-4 px-6 text-center border-b-2 font-medium text-xs ${activeTab === 'types' ? 'border-green-500 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
            >
              Leave Types
            </button>
            <button
              onClick={() => setActiveTab('holidays')}
              className={`py-4 px-6 text-center border-b-2 font-medium text-xs ${activeTab === 'holidays' ? 'border-green-500 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
            >
              Holidays
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`py-4 px-6 text-center border-b-2 font-medium text-xs ${activeTab === 'settings' ? 'border-green-500 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
            >
              Settings
            </button>
          </nav>
        </div>
      </div>

      {/* Content based on selected tab */}
      {activeTab === 'scheduler' && (
        <LeaveScheduler
          selectedTown={currentTown === 'ADMIN_ALL' ? undefined : currentTown}
          onSelectDate={(employeeNumber, date) => {
            const employee = employees.find(e => e["Employee Number"] === employeeNumber);
            setNewLeaveApplication(prev => ({
              ...prev,
              "Employee Number": employeeNumber,
              "Name": employee ? `${employee["First Name"]} ${employee["Last Name"]}` : '',
              "Office Branch": employee ? (employee.Branch || employee.Town || 'N/A') : '',
              "Start Date": date.toISOString().split('T')[0],
              "End Date": date.toISOString().split('T')[0]
            }));
            setShowLeaveApplicationForm(true);
          }}
          onAssignLeave={() => setShowLeaveApplicationForm(true)}
        />
      )}

      {activeTab === 'applications' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 md:p-6 border-b border-gray-200">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-base text-gray-900">Leave Applications</h2>
                <p className="text-gray-600 text-xs">{leaveApplications.length} applications found</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setShowLeaveApplicationForm(true)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium shadow-sm active:scale-95 transition-all"
                >
                  <Plus className="w-3 h-3" />
                  Apply Leave
                </button>
                <button className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-medium border border-gray-300">
                  <Filter className="w-3 h-3" />
                  Filter
                </button>
                <button className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-medium border border-gray-300">
                  <Download className="w-3 h-3" />
                  Export
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left py-3 px-4 text-gray-700 font-base">Employee</th>
                  <th className="text-left py-3 px-4 text-gray-700 font-base">Leave Type</th>
                  <th className="text-left py-3 px-4 text-gray-700 font-base">Dates</th>
                  <th className="text-left py-3 px-4 text-gray-700 font-base">Days</th>
                  <th className="text-left py-3 px-4 text-gray-700 font-base">Office Branch</th>
                  <th className="text-left py-3 px-4 text-gray-700 font-base">Status</th>
                  <th className="text-left py-3 px-4 text-gray-700 font-base">Recommendation</th>
                  <th className="text-left py-3 px-4 text-gray-700 font-base">Applied On</th>
                  <th className="text-center py-3 px-4 text-gray-700 font-base">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableSkeletonLoader rows={5} columns={9} />
                ) : (
                  paginatedApplications.map((application) => (
                    <tr key={application.id} className="border-b border-gray-300 hover:bg-gray-50">
                      <td className="py-4 px-4">
                        <div className="space-y-1">
                          <p className="text-gray-900 font-base">{application.Name}</p>
                          <p className="text-gray-500 text-xs">{application["Employee Number"]}</p>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <p className="text-gray-700">{application["Leave Type"]}</p>
                      </td>
                      <td className="py-4 px-4">
                        <p className="text-gray-700">
                          {formatDate(application["Start Date"])}
                          {application["End Date"] !== application["Start Date"] && ` - ${formatDate(application["End Date"])}`}
                          {application["Type"] === 'Half Day' && ' (Half day)'}
                        </p>
                      </td>
                      <td className="py-4 px-4">
                        <p className="text-gray-700">{application.Days}</p>
                      </td>
                      <td className="py-4 px-4">
                        <p className="text-gray-700">{application["Office Branch"]}</p>
                      </td>
                      <td className="py-4 px-4">
                        <StatusBadge status={application.Status} />
                      </td>
                      <td className="py-4 px-4">
                        <RecStatusBadge recstatus={application.recstatus} />
                      </td>
                      <td className="py-4 px-4">
                        <p className="text-gray-700">{formatDate(application.time_added)}</p>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex justify-center gap-1">
                          <button
                            onClick={() => setSelectedApplication(application)}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded text-xs"
                          >
                            <Eye className="w-3 h-3" />
                            View
                          </button>
                          {application.Status === 'pending' && (
                            <>
                              <RoleButtonWrapper allowedRoles={['ADMIN', 'HR']}>
                                <button
                                  onClick={() => openStatusModal(application.id, 'approve')}
                                  className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 hover:bg-green-200 text-green-700 rounded text-xs"
                                >
                                  <CheckCircle className="w-3 h-3" />
                                  Approve
                                </button>
                              </RoleButtonWrapper>
                              <RoleButtonWrapper allowedRoles={['ADMIN', 'HR']}>
                                <button
                                  onClick={() => openStatusModal(application.id, 'reject')}
                                  className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded text-xs"
                                >
                                  <XCircle className="w-3 h-3" />
                                  Reject
                                </button>
                              </RoleButtonWrapper>
                              <button
                                onClick={() => openStatusModal(application.id, 'recommend')}
                                className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded text-xs"
                              >
                                <ThumbsUp className="w-3 h-3" />
                                Recommend
                              </button>
                              <button
                                onClick={() => openStatusModal(application.id, 'not_recommend')}
                                className="inline-flex items-center gap-1 px-2 py-1 bg-orange-100 hover:bg-orange-200 text-orange-700 rounded text-xs"
                              >
                                <XCircle className="w-3 h-3" />
                                Not Recommend
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <Pagination
            currentPage={applicationsPage}
            totalPages={totalApplicationPages}
            onPageChange={setApplicationsPage}
            itemsPerPage={applicationsPerPage}
            onItemsPerPageChange={setApplicationsPerPage}
          />
        </div>
      )}

      {activeTab === 'balances' && renderLeaveBalancesTab()}

      {activeTab === 'types' && renderLeaveTypesTab()}

      {activeTab === 'holidays' && renderHolidaysTab()}

      {activeTab === 'settings' && renderSettingsTab()}

      {/* Status Update Modal */}
      <StatusUpdateModal
        isOpen={showStatusModal}
        onClose={() => setShowStatusModal(false)}
        applicationId={selectedApplicationId}
        action={statusAction}
        onUpdateStatus={handleUpdateStatus}
      />

      {/* Error Alert */}
      {error && (
        <div className="fixed bottom-4 right-4 z-50">
          <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded-lg shadow-lg">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              <div>
                <p className="font-medium">Error</p>
                <p className="text-xs">{error}</p>
              </div>
              <button
                onClick={() => setError(null)}
                className="ml-4 text-red-500 hover:text-red-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Application Details Modal */}
      {selectedApplication && (
        <LeaveApplicationDetails
          application={selectedApplication}
          onClose={() => setSelectedApplication(null)}
        />
      )}

      {/* Modals */}
      {showLeaveApplicationForm && (
        <LeaveApplicationFormModal
          isOpen={showLeaveApplicationForm}
          onClose={() => setShowLeaveApplicationForm(false)}
          newLeaveApplication={newLeaveApplication}
          setNewLeaveApplication={setNewLeaveApplication}
          employees={employees}
          leaveTypes={leaveTypes}
          holidays={holidays}
          handleApplyLeave={handleApplyLeave}
        />
      )}
      {showLeaveTypeForm && (
        <LeaveTypeFormModal
          isOpen={showLeaveTypeForm}
          onClose={() => setShowLeaveTypeForm(false)}
          newLeaveType={newLeaveType}
          setNewLeaveType={setNewLeaveType}
          handleSaveLeaveType={handleSaveLeaveType}
          handleAddLeaveType={handleAddLeaveType}
        />
      )}
      {showHolidayForm && (
        <HolidayFormModal
          isOpen={showHolidayForm}
          onClose={() => setShowHolidayForm(false)}
          newHoliday={newHoliday}
          setNewHoliday={setNewHoliday}
          handleSaveHoliday={handleSaveHoliday}
          handleAddHoliday={handleAddHoliday}
        />
      )}
      {showAccrualSettings && (
        <AccrualSettingsModal
          isOpen={showAccrualSettings}
          onClose={() => setShowAccrualSettings(false)}
          accrualSettings={accrualSettings}
          handleRunAccrual={handleRunAccrual}
          employees={employees}
        />
      )}

      {/* Global Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg p-6 flex flex-col items-center">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-3" />
            <p className="text-gray-700">Loading data...</p>
          </div>
        </div>
      )}
    </div>
  );
}