import { useState, useEffect, useRef } from 'react';
import EmployeePicker from '../UI/EmployeePicker';
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
  ThumbsDown,
  RefreshCw,
  Loader2,
  Search as SearchIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@supabase/supabase-js';
import { TownProps } from '../../types/supabase';
import RoleButtonWrapper from '../ProtectedRoutes/RoleButton';
import { useUser } from '../ProtectedRoutes/UserContext';
import LeaveScheduler from './LeaveScheduler';
import { PageHeader, StatCard, Card, TabBar, Button, EmptyState } from '../UI';

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
  // Joined in from leave_policies (see current_leave_policies view) and
  // editable via the Leave Type form - see handleSaveLeaveType.
  accrual_method?: 'annual' | 'monthly_non_cumulative' | 'none';
  carry_forward_max_days?: number;
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
  year: number;
  month: number;
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
        className={`w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm transition-all duration-200 hover:bg-white hover:border-primary/30 focus:outline-none focus:ring-4 focus:ring-primary/5 ${isOpen ? 'border-primary bg-white ring-4 ring-primary/5' : ''}`}
      >
        <div className="flex items-center gap-2 truncate text-gray-700">
          {Icon && <Icon className={`w-4 h-4 ${isOpen ? 'text-primary' : 'text-gray-400'}`} />}
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
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
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
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors mb-0.5 flex items-center justify-between group ${value === opt.value ? 'bg-primary/10 text-primary font-semibold' : 'text-gray-600 hover:bg-primary/5 hover:text-primary'}`}
                >
                  <span className="truncate">{opt.label}</span>
                  {value === opt.value && (
                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
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
  // Two-level leave approval (see FIG-573): the department head who must
  // recommend before HR/Admin can give final approval. Stored as a plain
  // "First Last" name string (matched against employees, not a FK) - see
  // the "Leave Approvers" section of Add/Edit Employee.
  "Leave Approver"?: string;
  "Alternate Approver"?: string;
};

interface AreaTownMapping {
  [area: string]: string[];
}

interface BranchAreaMapping {
  [branch: string]: string;
}

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
const getInitials = (name: string) => {
  if (!name) return '??';
  const parts = name.split(' ');
  const f = parts[0] || '';
  const l = parts.length > 1 ? parts[parts.length - 1] : '';
  return `${f.charAt(0)}${l.charAt(0)}`.toUpperCase();
};

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
    'recommended': 'bg-green-tint text-brand-dark',
    'not_recommended': 'bg-orange-100 text-orange-800',
  };

  const statusIcons = {
    'pending': PendingIcon,
    'approved': CheckCircle,
    'rejected': XCircle,
    'recommended': ThumbsUp,
    'not_recommended': ThumbsDown,
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
    'recommended': 'bg-green-tint text-brand-dark',
    'not_recommended': 'bg-orange-100 text-orange-800',
  };

  const statusIcons = {
    'recommended': ThumbsUp,
    'not_recommended': ThumbsDown,
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
    <div className="p-2 rounded-lg bg-green-tint text-brand">
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
                <div className="bg-green-tint border border-brand/20 rounded-lg p-3">
                  <p className="font-medium whitespace-pre-line text-brand-dark">{application.recommendation_notes}</p>
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
      case 'recommend': return 'bg-brand hover:bg-brand-dark';
      case 'not_recommend': return 'bg-orange-600 hover:bg-orange-700';
      default: return 'bg-gray-600 hover:bg-gray-700';
    }
  };

  const getButtonIcon = () => {
    switch (action) {
      case 'approve': return CheckCircle;
      case 'reject': return XCircle;
      case 'recommend': return ThumbsUp;
      case 'not_recommend': return ThumbsDown;
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
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-brand/20 focus:border-brand"
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
          className="bg-gray-50 border border-gray-300 text-gray-700 text-xs rounded-lg focus:ring-brand focus:border-brand p-1"
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
              className={`px-3 py-1 border rounded-md text-xs font-medium ${currentPage === number ? 'bg-brand text-white border-brand' : 'border-gray-300'}`}
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
  handleSaveLeaveType
}: {
  isOpen: boolean;
  onClose: () => void;
  newLeaveType: any;
  setNewLeaveType: React.Dispatch<React.SetStateAction<any>>;
  handleSaveLeaveType: (type: LeaveType) => Promise<void>;
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
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-brand/20 focus:border-brand"
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
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-brand/20 focus:border-brand"
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
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-brand/20 focus:border-brand"
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
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-brand/20 focus:border-brand"
              >
                <option value="Sun">Sun</option>
                <option value="Heart">Heart</option>
                <option value="Baby">Baby</option>
                <option value="Activity">Activity</option>
                <option value="Zap">Zap</option>
                <option value="Gift">Gift</option>
                <option value="FileText">FileText</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Accrual Method
              </label>
              <select
                value={newLeaveType.accrual_method || 'annual'}
                onChange={(e) => setNewLeaveType((prev: any) => ({
                  ...prev,
                  accrual_method: e.target.value,
                  ...(e.target.value !== 'annual' ? { carry_forward_max_days: 0 } : {})
                }))}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-brand/20 focus:border-brand"
              >
                <option value="annual">Annual (resets Jan 1)</option>
                <option value="monthly_non_cumulative">Monthly (resets every month, no carry-over)</option>
                <option value="none">None (not accrual-based)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Carry-Forward Cap (days)
              </label>
              <input
                type="number"
                value={newLeaveType.carry_forward_max_days ?? 0}
                onChange={(e) => setNewLeaveType((prev: any) => ({ ...prev, carry_forward_max_days: Number(e.target.value) }))}
                disabled={newLeaveType.accrual_method !== 'annual'}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-brand/20 focus:border-brand disabled:bg-gray-100 disabled:text-gray-400"
                min="0"
                placeholder="0"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={newLeaveType.is_deductible}
                onChange={(e) => setNewLeaveType((prev: any) => ({ ...prev, is_deductible: e.target.checked }))}
                className="rounded border-gray-300 text-brand focus:ring-brand"
              />
              <label className="ml-2 text-xs text-gray-700">Deductible from balance</label>
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                checked={newLeaveType.is_continuous}
                onChange={(e) => setNewLeaveType((prev: any) => ({ ...prev, is_continuous: e.target.checked }))}
                className="rounded border-gray-300 text-brand focus:ring-brand"
              />
              <label className="ml-2 text-xs text-gray-700">Continuous leave</label>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-6">
          <button
            onClick={() => {
              onClose();
              setNewLeaveType({ name: '', description: '', is_deductible: true, is_continuous: true, icon: 'Sun', accrual_method: 'annual', carry_forward_max_days: 0 });
            }}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              const payload: LeaveType = newLeaveType.id
                ? (newLeaveType as LeaveType)
                : { ...newLeaveType, id: `custom-${Date.now()}` };
              await handleSaveLeaveType(payload);
              onClose();
              setNewLeaveType({ name: '', description: '', is_deductible: true, is_continuous: true, icon: 'Sun', accrual_method: 'annual', carry_forward_max_days: 0 });
            }}
            className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg text-xs flex items-center gap-2"
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
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-brand/20 focus:border-brand"
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
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-brand/20 focus:border-brand"
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              checked={newHoliday.recurring}
              onChange={(e) => setNewHoliday((prev: any) => ({ ...prev, recurring: e.target.checked }))}
              className="rounded border-gray-300 text-brand focus:ring-brand"
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
            className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg text-xs flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            {newHoliday.id ? 'Update' : 'Save'} Holiday
          </button>
        </div>
      </div>
    </div>
  );
};

// Leave Reset Modal. Each leave type resets on its own schedule (see
// leave_policies.accrual_method): Annual/Sick/Maternity/Paternity/Study-Exam
// reset once a year with a capped carry-forward, while Compassionate Leave
// resets every month with nothing carried over. Both jobs are idempotent -
// running one for a period that's already been reset just does nothing, so
// these on-demand buttons are safe as a backstop if the scheduled job (see
// the migration) doesn't fire, not just for testing.
const AccrualSettingsModal = ({
  isOpen,
  onClose,
  leaveTypes,
  employees,
  handleRunAnnualReset,
  handleRunMonthlyReset
}: {
  isOpen: boolean;
  onClose: () => void;
  leaveTypes: LeaveType[];
  employees: Employee[];
  handleRunAnnualReset: () => Promise<void>;
  handleRunMonthlyReset: () => Promise<void>;
}) => {
  if (!isOpen) return null;

  const annualTypes = leaveTypes.filter(t => t.is_deductible && t.accrual_method !== 'monthly_non_cumulative' && t.accrual_method !== 'none');
  const monthlyTypes = leaveTypes.filter(t => t.is_deductible && t.accrual_method === 'monthly_non_cumulative');
  const monthName = new Date().toLocaleDateString(undefined, { month: 'long' });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-base text-gray-900">Leave Balance Resets</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="border border-gray-200 rounded-lg p-4 space-y-2">
            <p className="text-xs font-medium text-gray-800">Annual reset ({employees.length} employees)</p>
            <p className="text-xs text-gray-600">
              Grants each type's yearly allotment, carrying forward unused days up to each type's cap.
              Covers: {annualTypes.length ? annualTypes.map(t => t.name).join(', ') : 'no deductible annual leave types yet'}.
            </p>
            <button
              onClick={handleRunAnnualReset}
              disabled={annualTypes.length === 0}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white rounded-lg text-xs font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              Run Annual Reset
            </button>
          </div>

          <div className="border border-gray-200 rounded-lg p-4 space-y-2">
            <p className="text-xs font-medium text-gray-800">Monthly reset ({monthName})</p>
            <p className="text-xs text-gray-600">
              Grants a fresh monthly allotment that does not carry over.
              Covers: {monthlyTypes.length ? monthlyTypes.map(t => t.name).join(', ') : 'no monthly leave types yet'}.
            </p>
            <button
              onClick={handleRunMonthlyReset}
              disabled={monthlyTypes.length === 0}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-brand hover:bg-brand-dark disabled:opacity-50 text-white rounded-lg text-xs font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              Run Monthly Reset
            </button>
          </div>
        </div>

        <div className="flex justify-end pt-6">
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
            <EmployeePicker
              label="Select Employee"
              placeholder="Find a staff member..."
              value={newLeaveApplication["Employee Number"]}
              allowedNumbers={employees.map(emp => emp["Employee Number"])}
              onChange={emp => handleEmployeeChange(emp?.employeeNumber ?? '')}
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
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand/20 focus:border-brand"
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
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand/20 focus:border-brand"
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
                className="w-full border border-gray-100 bg-gray-50 rounded-lg px-3 py-2 text-sm font-bold text-brand"
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
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand/20 focus:border-brand"
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
            className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-sm font-semibold flex items-center gap-2 shadow-lg shadow-primary/20 active:scale-[0.98] transition-all"
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
export default function LeaveManagementSystem({ selectedTown, onTownChange }: TownProps) {
  // State variables for town filtering
  const [currentTown, setCurrentTown] = useState<string>(selectedTown || '');
  const [areaTownMapping, setAreaTownMapping] = useState<AreaTownMapping>({});
  const [, setBranchAreaMapping] = useState<BranchAreaMapping>({});
  const [isArea, setIsArea] = useState<boolean>(false);
  const [townsInArea, setTownsInArea] = useState<string[]>([]);
  const [, setDebugInfo] = useState<string>("Initializing...");

  // Two-level leave approval (FIG-573): who is the logged-in user, for
  // matching against an applicant's assigned "Leave Approver" below.
  const { user: currentAuthUser } = useUser();

  // Original state variables
  const [activeTab, setActiveTab] = useState('applications');
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leaveTypesError, setLeaveTypesError] = useState<string | null>(null);
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
  const [, setUpdatingStatus] = useState(false);

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
    icon: 'Sun',
    accrual_method: 'annual',
    carry_forward_max_days: 0
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
  // Bumped after a manual reset to force the balances effect to refetch.
  const [balancesRefreshKey, setBalancesRefreshKey] = useState(0);

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

  // Two-level leave approval (FIG-573): the logged-in user's own name, for
  // matching against each application's assigned "Leave Approver"/
  // "Alternate Approver". Only meaningful once `employees` has loaded.
  const currentUserEmployee = employees.find(e => e["Work Email"] === currentAuthUser?.email);
  const currentUserFullName = currentUserEmployee
    ? `${currentUserEmployee["First Name"]} ${currentUserEmployee["Last Name"]}`
    : null;

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

  // Persists the one thing this tab actually lets someone edit per row: the
  // monthly accrual rate override. accrued_days/used_days are read-only here
  // and are never touched by this save (they change via approvals and
  // "Run Accrual Now" instead).
  const saveBalanceChanges = async () => {
    setSavingBalances(true);
    try {
      const results = await Promise.all(
        leaveBalances.map(balance =>
          supabase
            .from('leave_balances')
            .update({ monthly_accrual: balance.monthly_accrual })
            .eq('id', balance.id)
        )
      );

      const failed = results.find(r => r.error);
      if (failed?.error) throw failed.error;

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
    // Two-level leave approval (FIG-573): defense-in-depth mirror of the
    // disabled Approve button - refuse final approval here too if the
    // applicant has an assigned Leave Approver who hasn't recommended it
    // yet, in case this ever gets called from somewhere other than that
    // button. (This is a client-side guard only, same as every other role
    // check in this file - real enforcement needs RLS, see FIG-515.)
    if (status === 'approved') {
      const application = leaveApplications.find(app => app.id === applicationId);
      const applicantEmployee = application
        ? employees.find(e => e["Employee Number"] === application["Employee Number"])
        : undefined;
      const deptHeadName = applicantEmployee?.["Leave Approver"];
      if (deptHeadName && application?.recstatus !== 'recommended') {
        setError(`Cannot approve: awaiting ${deptHeadName}'s recommendation first.`);
        return;
      }
    }

    setUpdatingStatus(true);
    try {
      // DB payload: `leave_application` stores status/reason as lowercase columns
      // (see fetchLeaveApplications above); local state uses the capitalized shape.
      let dbUpdateData: any = {};
      let localUpdateData: Partial<LeaveApplication> = {};

      if (status === 'approved' || status === 'rejected') {
        dbUpdateData = {
          "status": status,
          "reason": notes
        };
        localUpdateData = {
          "Status": status,
          "Reason": notes
        };
      } else if (status === 'recommended' || status === 'not_recommended') {
        dbUpdateData = {
          "recstatus": status,
          "recommendation_notes": notes
        };
        localUpdateData = {
          "recstatus": status,
          "recommendation_notes": notes
        };
      }

      const { error } = await supabase
        .from('leave_application')
        .update(dbUpdateData)
        .eq('id', applicationId);

      if (error) throw error;

      setLeaveApplications(prev => prev.map(app =>
        app.id === applicationId ? {
          ...app,
          ...localUpdateData
        } : app
      ));

      // Deduct from the real leave_balances row on approval (see FIG-563).
      // Rejecting needs no reversal here: nothing is deducted until
      // approval, so there's nothing to undo on rejection.
      if (status === 'approved') {
        const application = leaveApplications.find(app => app.id === applicationId);
        const leaveType = application ? leaveTypes.find(lt => lt.name === application["Leave Type"]) : undefined;

        if (application && leaveType?.is_deductible) {
          const startDate = new Date(application["Start Date"]);
          const isMonthly = leaveType.accrual_method === 'monthly_non_cumulative';

          const { data: updatedBalance, error: balanceError } = await supabase.rpc(
            'increment_leave_balance_used_days',
            {
              p_employee_number: application["Employee Number"],
              p_leave_type_id: leaveType.id,
              p_year: startDate.getFullYear(),
              p_days: application.Days,
              p_month: isMonthly ? startDate.getMonth() + 1 : 0
            }
          );

          if (balanceError) {
            console.error('Failed to update leave balance:', balanceError);
            setError('Status updated, but the leave balance could not be adjusted. Check the Balances tab.');
          } else if (updatedBalance) {
            setLeaveBalances(prev => {
              const exists = prev.some(b => b.id === updatedBalance.id);
              if (!exists) return prev; // balance is for a different period than what's loaded
              return prev.map(b => b.id === updatedBalance.id ? {
                ...b,
                accrued_days: updatedBalance.accrued_days,
                used_days: updatedBalance.used_days,
                remaining_days: updatedBalance.remaining_days
              } : b);
            });
          }
        }
      }

      // Notify (FIG-574): recommending alerts HR/Admin via the existing
      // admin bell (fetchAdminHRNotifications has no type filter, so a new
      // notification_type shows up there with no other wiring needed);
      // approving/rejecting alerts the employee via the Staff Portal's
      // notification panel. "Leave submitted" has no new notification here
      // - Header.tsx already shows a generic one for any new application.
      if (status === 'recommended' || status === 'approved' || status === 'rejected') {
        const application = leaveApplications.find(app => app.id === applicationId);
        if (application) {
          const dayLabel = `${application.Days} day${application.Days !== 1 ? 's' : ''}`;
          const notificationsToInsert =
            status === 'recommended'
              ? [{
                notification_type: 'leave_recommended',
                title: 'Leave application recommended - awaiting final approval',
                message: `${currentUserFullName || 'The department head'} recommended ${application.Name}'s ${application["Leave Type"]} application (${dayLabel}). Awaiting HR/Admin approval.`
              }]
              : [{
                notification_type: status === 'approved' ? 'leave_approved' : 'leave_rejected',
                title: status === 'approved' ? 'Leave application approved' : 'Leave application rejected',
                message: status === 'approved'
                  ? `Your ${application["Leave Type"]} application (${dayLabel}, ${application["Start Date"]} to ${application["End Date"]}) has been approved.`
                  : `Your ${application["Leave Type"]} application (${dayLabel}) has been rejected.${notes ? ` Reason: ${notes}` : ''}`
              }];

          const { error: notifyError } = await supabase.from('hr_notifications').insert(
            notificationsToInsert.map(n => ({
              employee_number: application["Employee Number"],
              employee_name: application.Name,
              end_date: application["End Date"],
              is_read_admin: false,
              is_read_staff: false,
              email_sent: false,
              ...n
            }))
          );

          if (notifyError) console.error('Failed to create leave notification:', notifyError);
        }
      }

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

  // Fetch leave balances from the real leave_balances table (see FIG-563).
  // Each leave type reads from its own bucket: annual-cadence types use
  // month 0 (the whole year), Compassionate Leave (monthly_non_cumulative)
  // uses the current calendar month - see run_annual_leave_reset /
  // run_monthly_leave_reset in the migration for how those buckets get
  // created and rolled over (FIG-565). Missing rows are bootstrapped once,
  // seeding used_days from already-approved applications in that same
  // bucket so pre-existing leave taken isn't lost; every increment after
  // that goes through increment_leave_balance_used_days at approval time
  // instead of being recomputed on each render.
  useEffect(() => {
    const fetchLeaveBalances = async () => {
      try {
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth() + 1;
        const deductibleLeaveTypes = leaveTypes.filter(type => type.is_deductible);
        const bucketFor = (lt: LeaveType) => lt.accrual_method === 'monthly_non_cumulative' ? currentMonth : 0;

        if (deductibleLeaveTypes.length === 0 || employees.length === 0) {
          setLeaveBalances([]);
          return;
        }

        const { data: rawRows, error: balancesError } = await supabase
          .from('leave_balances')
          .select('*')
          .eq('year', currentYear)
          .in('month', [0, currentMonth]);

        if (balancesError) throw balancesError;

        const existingRows = (rawRows || []).filter((r: any) => {
          const lt = deductibleLeaveTypes.find(t => t.id === r.leave_type_id);
          return lt && r.month === bucketFor(lt);
        });

        const existingByKey = new Set(
          existingRows.map((r: any) => `${r.employee_number}::${r.leave_type_id}`)
        );

        const missing = employees.flatMap(employee =>
          deductibleLeaveTypes
            .filter(lt => !existingByKey.has(`${employee["Employee Number"]}::${lt.id}`))
            .map(leaveType => ({ employee, leaveType }))
        );

        let bootstrapped: any[] = [];
        if (missing.length > 0) {
          // `status` casing is inconsistent across rows (older/Staff-Portal
          // rows store 'Approved', this file's own writes use lowercase
          // 'approved') - match case-insensitively so historical usage
          // isn't undercounted on bootstrap.
          const { data: applicationsData } = await supabase
            .from('leave_application')
            .select('*')
            .ilike('status', 'approved');

          const rowsToInsert = missing.map(({ employee, leaveType }) => {
            const isMonthly = leaveType.accrual_method === 'monthly_non_cumulative';
            const usedDays = (applicationsData || [])
              .filter((app: any) => {
                if (app["Employee Number"] !== employee["Employee Number"] || app["Leave Type"] !== leaveType.name) return false;
                const start = new Date(app["Start Date"]);
                if (start.getFullYear() !== currentYear) return false;
                return isMonthly ? start.getMonth() + 1 === currentMonth : true;
              })
              .reduce((sum: number, app: any) => sum + (Number(app.days) || 0), 0);

            return {
              employee_number: employee["Employee Number"],
              leave_type_id: leaveType.id,
              year: currentYear,
              month: bucketFor(leaveType),
              accrued_days: leaveType.max_days || 0,
              used_days: usedDays,
              carried_over_days: 0,
              monthly_accrual: 0
            };
          });

          const { data: inserted, error: insertError } = await supabase
            .from('leave_balances')
            .upsert(rowsToInsert, { onConflict: 'employee_number,leave_type_id,year,month', ignoreDuplicates: true })
            .select();

          if (insertError) throw insertError;
          bootstrapped = inserted || [];
        }

        const balances: EmployeeLeaveBalance[] = [...existingRows, ...bootstrapped].map((row: any) => {
          const employee = employees.find(e => e["Employee Number"] === row.employee_number);
          const leaveType = deductibleLeaveTypes.find(lt => lt.id === row.leave_type_id);
          const isMonthly = leaveType?.accrual_method === 'monthly_non_cumulative';
          const annualAccrual = isMonthly ? 0 : (leaveType?.max_days || 0);
          const quarterlyAccrual = isMonthly ? 0 : Math.round((annualAccrual / 4) * 10) / 10;

          return {
            id: row.id,
            employee_number: row.employee_number,
            first_name: employee?.["First Name"] || '',
            last_name: employee?.["Last Name"] || '',
            office: employee?.Branch || employee?.Town || 'N/A',
            leave_type_id: row.leave_type_id,
            leave_type_name: leaveType?.name || '',
            year: row.year,
            month: row.month,
            accrued_days: row.accrued_days,
            used_days: row.used_days,
            remaining_days: row.remaining_days,
            last_accrual_date: row.last_accrual_date || new Date().toISOString().split('T')[0],
            monthly_accrual: row.monthly_accrual,
            quarterly_accrual: quarterlyAccrual,
            annual_accrual: annualAccrual
          };
        });

        setLeaveBalances(balances);
      } catch (err) {
        console.error('Error fetching leave balances:', err);
        setError('Failed to load leave balances.');
      }
    };

    if (activeTab === 'balances') {
      fetchLeaveBalances();
    }
  }, [activeTab, leaveTypes, employees, balancesRefreshKey]);

  // Fetch leave types + their current policy from Supabase. Runs on mount
  // (not gated behind the "types" tab) since the new-application form's leave
  // type dropdown depends on this too. No hardcoded fallback: if this fails,
  // the UI shows an error instead of quietly using fake defaults.
  useEffect(() => {
    const fetchLeaveTypes = async () => {
      try {
        const [typesResult, policiesResult] = await Promise.all([
          supabase.from('leave_types').select('*').order('name'),
          supabase.from('current_leave_policies').select('*'),
        ]);

        if (typesResult.error) throw typesResult.error;
        if (policiesResult.error) throw policiesResult.error;

        const policyByTypeId = new Map(
          (policiesResult.data || []).map((p: any) => [p.leave_type_id, p])
        );

        const merged: LeaveType[] = (typesResult.data || []).map((t: any) => {
          const policy = policyByTypeId.get(t.id);
          return {
            id: t.id,
            name: t.name,
            description: t.description || '',
            is_deductible: t.is_deductible,
            is_continuous: t.is_continuous,
            icon: t.icon,
            max_days: policy?.days_allotted ?? undefined,
            accrual_method: policy?.accrual_method || 'none',
            carry_forward_max_days: policy?.carry_forward_max_days ?? 0,
          };
        });

        setLeaveTypes(merged);
        setLeaveTypesError(null);
      } catch (err) {
        console.error('Error fetching leave types/policies:', err);
        setLeaveTypesError('Failed to load leave types. Confirm the leave_types/leave_policies migration has been applied.');
        setLeaveTypes([]);
      }
    };

    fetchLeaveTypes();
  }, []);

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
      setError(null);
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

        // Type cast and transform the data. The `leave_application` table stores
        // name/status/reason/days/type as lowercase columns (everything else is a
        // quoted, capitalized column) - read the raw row as `any` and map explicitly
        // rather than casting straight to LeaveApplication, which silently produced
        // `undefined` for these fields and crashed the whole fetch on `.toLowerCase()`.
        const applications = ((data || []) as any[]).map(app => {
          console.log('[DEBUG] Processing application:', app.id, 'with branch:', app["Office Branch"]);
          return {
            id: app.id,
            "Employee Number": app["Employee Number"],
            "Name": app.name,
            "Leave Type": app["Leave Type"],
            "Start Date": app["Start Date"],
            "End Date": app["End Date"],
            "Days": app.days,
            "Type": app.type,
            "Application Type": app["Application Type"],
            "Office Branch": app["Office Branch"] || 'N/A',
            "Reason": app.reason,
            "Status": (app.status || 'pending').toLowerCase() as 'pending' | 'approved' | 'rejected',
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
          // Raw realtime payload, not yet mapped - see the fetch above for why this
          // can't be cast straight to LeaveApplication (name/status/reason/days/type
          // are lowercase columns in the DB, everything else is capitalized).
          const application = payload.new as any;

          if (payload.eventType === 'INSERT') {
            setLeaveApplications(prev => [{
              id: application.id,
              "Employee Number": application["Employee Number"],
              "Name": application.name,
              "Leave Type": application["Leave Type"],
              "Start Date": application["Start Date"],
              "End Date": application["End Date"],
              "Days": application.days,
              "Type": application.type,
              "Application Type": application["Application Type"],
              "Office Branch": application["Office Branch"] || 'N/A',
              "Reason": application.reason,
              "Status": (application.status || 'pending').toLowerCase() as 'pending' | 'approved' | 'rejected',
              "recstatus": application.recstatus || null,
              "time_added": application.time_added,
              "recommendation_notes": application.recommendation_notes
            }, ...prev]);
          }
          else if (payload.eventType === 'UPDATE') {
            setLeaveApplications(prev => prev.map(app =>
              app.id === application.id ? {
                ...app,
                "Status": (application.status || 'pending').toLowerCase() as 'pending' | 'approved' | 'rejected',
                "recstatus": application.recstatus || null,
                "Reason": application.reason,
                "Days": application.days,
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

      // `leave_application` stores name/days/type/reason/status as lowercase
      // columns (see fetchLeaveApplications above); everything else is quoted/capitalized.
      const { error } = await supabase
        .from('leave_application')
        .insert([{
          "Employee Number": newLeaveApplication["Employee Number"],
          "name": `${employee["First Name"]} ${employee["Last Name"]}`,
          "Leave Type": newLeaveApplication["Leave Type"],
          "Start Date": newLeaveApplication["Start Date"],
          "End Date": newLeaveApplication["End Date"],
          "days": days,
          "type": newLeaveApplication["Type"],
          "Application Type": newLeaveApplication["Application Type"],
          "Office Branch": employee.Branch || employee.Town || 'N/A',
          "reason": newLeaveApplication["Reason"],
          "status": newLeaveApplication["Status"],
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

  // Runs the real, policy-driven engine (see run_annual_leave_reset /
  // run_monthly_leave_reset in the migration) instead of adding a flat,
  // admin-chosen number to every balance regardless of leave type. Both are
  // idempotent server-side, so re-running for an already-reset period is a
  // safe no-op.
  const handleRunAnnualReset = async () => {
    try {
      const { error } = await supabase.rpc('run_annual_leave_reset', { p_year: new Date().getFullYear() });
      if (error) throw error;
      setBalancesRefreshKey(k => k + 1);
      setShowAccrualSettings(false);
    } catch (err) {
      setError('Failed to run the annual leave reset. Please try again.');
      console.error(err);
    }
  };

  const handleRunMonthlyReset = async () => {
    try {
      const today = new Date();
      const { error } = await supabase.rpc('run_monthly_leave_reset', {
        p_year: today.getFullYear(),
        p_month: today.getMonth() + 1
      });
      if (error) throw error;
      setBalancesRefreshKey(k => k + 1);
      setShowAccrualSettings(false);
    } catch (err) {
      setError('Failed to run the monthly leave reset. Please try again.');
      console.error(err);
    }
  };

  // Add these new form handlers for the missing tabs:

  // Leave Types Tab Handlers
  // Saves both the leave_types row and its current leave_policies row
  // (name/description/max days/accrual method/carry-forward cap/deductible/
  // continuous/icon - see FIG-566). Writing a new leave_policies row here
  // (rather than updating in place) is what lets a change take effect only
  // from today onward without rewriting history - current_leave_policies
  // always resolves to the latest effective_from <= today.
  const handleSaveLeaveType = async (type: LeaveType) => {
    try {
      let leaveTypeId = type.id;

      if (type.id.startsWith('custom-')) {
        const { data, error } = await supabase
          .from('leave_types')
          .insert([{
            name: type.name,
            description: type.description,
            is_deductible: type.is_deductible,
            is_continuous: type.is_continuous,
            icon: type.icon
          }])
          .select();

        if (error) throw error;
        leaveTypeId = data[0].id;
      } else {
        const { error } = await supabase
          .from('leave_types')
          .update({
            name: type.name,
            description: type.description,
            is_deductible: type.is_deductible,
            is_continuous: type.is_continuous,
            icon: type.icon
          })
          .eq('id', type.id);

        if (error) throw error;
      }

      const { error: policyError } = await supabase
        .from('leave_policies')
        .upsert([{
          leave_type_id: leaveTypeId,
          days_allotted: type.max_days ?? null,
          accrual_method: type.accrual_method || 'annual',
          carry_forward_max_days: type.carry_forward_max_days ?? 0,
          effective_from: new Date().toISOString().split('T')[0]
        }], { onConflict: 'leave_type_id,effective_from' });

      if (policyError) throw policyError;

      const savedType: LeaveType = { ...type, id: leaveTypeId };
      setLeaveTypes(prev =>
        type.id.startsWith('custom-')
          ? [...prev, savedType]
          : prev.map(t => (t.id === leaveTypeId ? savedType : t))
      );
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
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-xs font-medium"
            >
              <Plus className="w-3 h-3" />
              Add Leave Type
            </button>
          </RoleButtonWrapper>
        </div>
        {leaveTypesError && (
          <div className="mt-4 flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {leaveTypesError}
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Type</th>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Description</th>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Max Days</th>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Accrual</th>
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
                  <p className="text-gray-700">
                    {type.accrual_method === 'monthly_non_cumulative' && 'Monthly (no carry-over)'}
                    {type.accrual_method === 'annual' && (
                      type.carry_forward_max_days ? `Annual · carries up to ${type.carry_forward_max_days}d` : 'Annual · no carry-over'
                    )}
                    {(!type.accrual_method || type.accrual_method === 'none') && 'None'}
                  </p>
                </td>
                <td className="py-4 px-4">
                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full ${type.is_deductible ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                    {type.is_deductible ? 'Yes' : 'No'}
                  </span>
                </td>
                <td className="py-4 px-4">
                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full ${type.is_continuous ? 'bg-green-tint text-brand-dark' : 'bg-gray-100 text-gray-800'
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
                        className="inline-flex items-center gap-1 px-2 py-1 bg-green-tint hover:bg-brand/20 text-brand-dark rounded text-xs"
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
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-brand hover:bg-brand-dark text-white rounded-lg text-xs font-medium"
            >
              <RefreshCw className="w-3 h-3" />
              Run Accrual
            </button>
            <button
              onClick={saveBalanceChanges}
              disabled={savingBalances}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-xs font-medium disabled:opacity-50"
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
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-xs font-medium"
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
                        className="inline-flex items-center gap-1 px-2 py-1 bg-green-tint hover:bg-brand/20 text-brand-dark rounded text-xs"
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
          <h3 className="text-lg font-base text-gray-900 mb-4">Leave Balance Resets</h3>
          <p className="text-xs text-gray-500 mb-4">
            Each leave type resets on its own schedule, defined per policy in the Types tab.
            These run automatically (see the scheduled job), but can also be triggered on demand -
            safe to click even if a period has already been reset.
          </p>
          <button
            onClick={() => setShowAccrualSettings(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg text-xs font-medium"
          >
            <RefreshCw className="w-4 h-4" />
            Open Reset Controls
          </button>
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
    <div className="p-4 space-y-[18px] max-w-screen-2xl mx-auto">
      <PageHeader
        title="Leave Management System"
        subtitle={`Manage employee leave applications, balances, and settings · Viewing: ${getDisplayName(currentTown, isArea)}`}
        actions={
          <Button variant="secondary" onClick={handleRefresh} icon={<RefreshCw className="w-3.5 h-3.5" />}>
            Refresh
          </Button>
        }
      />

      {/* Stats Cards */}
      {loading ? (
        <StatsSkeletonLoader />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Pending Applications" value={pendingApplications} tint="orange" icon={<Clock className="w-[18px] h-[18px]" strokeWidth={1.8} />} />
          <StatCard label="Approved Applications" value={approvedApplications} tint="green" icon={<CheckCircle className="w-[18px] h-[18px]" strokeWidth={1.8} />} />
          <StatCard label="Recommended" value={recommendedApplications} tint="info" icon={<ThumbsUp className="w-[18px] h-[18px]" strokeWidth={1.8} />} />
          <StatCard label="Not Recommended" value={notRecommendedApplications} tint="orange" icon={<ThumbsDown className="w-[18px] h-[18px]" strokeWidth={1.8} />} />
          <StatCard label="Leave Days Used" value={totalLeaveDaysUsed} tint="orange" icon={<Calendar className="w-[18px] h-[18px]" strokeWidth={1.8} />} />
          <StatCard label="Leave Days Remaining" value={totalLeaveDaysRemaining} tint="purple" icon={<User className="w-[18px] h-[18px]" strokeWidth={1.8} />} />
        </div>
      )}

      {/* Tabs Navigation */}
      <Card padding="none">
        <div className="px-3.5 pt-2.5">
          <TabBar
            items={[
              { id: 'applications', label: 'Leave Applications' },
              { id: 'scheduler', label: 'Scheduler' },
              { id: 'balances', label: 'Leave Balances' },
              { id: 'types', label: 'Leave Types' },
              { id: 'holidays', label: 'Holidays' },
              { id: 'settings', label: 'Settings' },
            ]}
            activeId={activeTab}
            onChange={setActiveTab}
          />
        </div>
      </Card>

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
        <div className="bg-white rounded-card border border-border overflow-hidden">
          <div className="p-4 md:p-[18px] border-b border-border">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div>
                <h2 className="text-[14px] font-bold text-ink">Leave Applications</h2>
                <p className="text-muted-foreground text-[11px]">{leaveApplications.length} applications found</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => setShowLeaveApplicationForm(true)} icon={<Plus className="w-3 h-3" />}>
                  Apply Leave
                </Button>
                <Button variant="secondary" icon={<Filter className="w-3 h-3" />}>
                  Filter
                </Button>
                <Button variant="secondary" icon={<Download className="w-3 h-3" />}>
                  Export
                </Button>
              </div>
            </div>
            {/* Actions & Status Legend */}
            <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-4 text-[10px] text-gray-500 font-medium bg-gray-50/50 p-2 rounded-xl">
              <span className="uppercase tracking-widest font-bold text-gray-400">Icon Guide:</span>
              <div className="flex items-center gap-1.5 px-2 py-1 bg-white rounded shadow-sm border border-gray-100"><Eye className="w-3 h-3 text-brand" /> View</div>
              <div className="flex items-center gap-1.5 px-2 py-1 bg-white rounded shadow-sm border border-gray-100"><CheckCircle className="w-3 h-3 text-emerald-600" /> Approve</div>
              <div className="flex items-center gap-1.5 px-2 py-1 bg-white rounded shadow-sm border border-gray-100"><XCircle className="w-3 h-3 text-rose-600" /> Reject</div>
              <div className="flex items-center gap-1.5 px-2 py-1 bg-white rounded shadow-sm border border-gray-100"><ThumbsUp className="w-3 h-3 text-brand" /> Recommend</div>
              <div className="flex items-center gap-1.5 px-2 py-1 bg-white rounded shadow-sm border border-gray-100"><ThumbsDown className="w-3 h-3 text-orange-600" /> Not Recommend</div>
            </div>
          </div>

          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-xs whitespace-nowrap">
              <thead className="bg-gray-50/80 border-b border-gray-100 backdrop-blur-sm sticky top-0 z-10">
                <tr>
                  <th className="text-left py-3.5 px-6 text-gray-500 font-bold uppercase tracking-wider text-[10px]">Employee</th>
                  <th className="text-left py-3.5 px-6 text-gray-500 font-bold uppercase tracking-wider text-[10px]">Leave Type</th>
                  <th className="text-left py-3.5 px-6 text-gray-500 font-bold uppercase tracking-wider text-[10px]">Dates</th>
                  <th className="text-left py-3.5 px-6 text-gray-500 font-bold uppercase tracking-wider text-[10px]">Duration</th>
                  <th className="text-left py-3.5 px-6 text-gray-500 font-bold uppercase tracking-wider text-[10px]">Branch</th>
                  <th className="text-left py-3.5 px-6 text-gray-500 font-bold uppercase tracking-wider text-[10px]">Status</th>
                  <th className="text-left py-3.5 px-6 text-gray-500 font-bold uppercase tracking-wider text-[10px]">Recommendation</th>
                  <th className="text-left py-3.5 px-6 text-gray-500 font-bold uppercase tracking-wider text-[10px]">Applied</th>
                  <th className="text-center py-3.5 px-6 text-gray-500 font-bold uppercase tracking-wider text-[10px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableSkeletonLoader rows={5} columns={9} />
                ) : paginatedApplications.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <EmptyState
                        icon={<Calendar className="w-[18px] h-[18px]" strokeWidth={2} />}
                        title="No leave applications found"
                        description="Applications will appear here once submitted."
                      />
                    </td>
                  </tr>
                ) : (
                  paginatedApplications.map((application) => {
                    // Two-level leave approval (FIG-573): dept head must
                    // recommend before HR/Admin can give final approval -
                    // unless the applicant has no Leave Approver assigned,
                    // in which case it goes straight to HR (today's
                    // pre-existing behavior, unchanged for anyone not yet
                    // set up in Add/Edit Employee's "Leave Approvers").
                    const applicantEmployee = employees.find(e => e["Employee Number"] === application["Employee Number"]);
                    const deptHeadName = applicantEmployee?.["Leave Approver"] || null;
                    const altDeptHeadName = applicantEmployee?.["Alternate Approver"] || null;
                    const isDeptHeadForApp = currentAuthUser?.role === 'ADMIN' ||
                      (!!currentUserFullName && (currentUserFullName === deptHeadName || currentUserFullName === altDeptHeadName));
                    const requiresDeptHeadApproval = !!deptHeadName;
                    const canFinalApprove = !requiresDeptHeadApproval || application.recstatus === 'recommended';

                    return (
                    <tr key={application.id} className="border-b border-gray-50 hover:bg-primary/5 transition-colors group">
                      <td className="py-3 px-6">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 flex-shrink-0 rounded-full bg-gradient-to-br from-primary/10 to-primary/20 flex items-center justify-center text-primary font-bold shadow-sm ring-2 ring-white">
                            {getInitials(application.Name)}
                          </div>
                          <div>
                            <p className="text-gray-900 font-bold text-sm group-hover:text-primary transition-colors">{application.Name}</p>
                            <span className="font-mono text-[10px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-500 border border-gray-200">{application["Employee Number"]}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-6">
                        <span className="font-medium text-gray-700 bg-gray-50 px-2 py-1 rounded-md border border-gray-100">{application["Leave Type"]}</span>
                      </td>
                      <td className="py-3 px-6">
                        <div className="flex flex-col">
                          <span className="text-gray-900 font-medium">{formatDate(application["Start Date"])}</span>
                          {application["End Date"] !== application["Start Date"] && (
                            <span className="text-gray-500 text-[10px]">to {formatDate(application["End Date"])}</span>
                          )}
                          {application["Type"] === 'Half Day' && <span className="text-amber-600 text-[10px] font-medium">Half day</span>}
                        </div>
                      </td>
                      <td className="py-3 px-6">
                        <div className="flex items-center gap-1.5">
                          <div className="w-6 h-6 rounded bg-primary/10 text-primary flex items-center justify-center font-bold">{application.Days}</div>
                          <span className="text-gray-500 text-[10px]">days</span>
                        </div>
                      </td>
                      <td className="py-3 px-6 text-gray-600">
                        {application["Office Branch"]}
                      </td>
                      <td className="py-3 px-6">
                        <StatusBadge status={application.Status} />
                      </td>
                      <td className="py-3 px-6">
                        <RecStatusBadge recstatus={application.recstatus} />
                      </td>
                      <td className="py-3 px-6 text-gray-500 text-[11px]">
                        {formatDate(application.time_added)}
                      </td>
                      <td className="py-3 px-6">
                        <div className="flex justify-center gap-2 opacity-80 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setSelectedApplication(application)}
                            className="p-1.5 bg-gray-50 hover:bg-green-tint text-brand rounded-md transition-colors shadow-sm ring-1 ring-gray-200 hover:ring-brand/20"
                            title="View Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {application.Status === 'pending' && (
                            <>
                              <RoleButtonWrapper allowedRoles={['ADMIN', 'HR']}>
                                <button
                                  onClick={() => canFinalApprove && openStatusModal(application.id, 'approve')}
                                  disabled={!canFinalApprove}
                                  className={`p-1.5 rounded-md transition-colors shadow-sm ring-1 ${canFinalApprove
                                    ? 'bg-gray-50 hover:bg-emerald-50 text-emerald-600 ring-gray-200 hover:ring-emerald-200'
                                    : 'bg-gray-50 text-gray-300 ring-gray-100 cursor-not-allowed'
                                    }`}
                                  title={canFinalApprove ? 'Approve' : `Awaiting ${deptHeadName}'s recommendation`}
                                >
                                  <CheckCircle className="w-4 h-4" />
                                </button>
                              </RoleButtonWrapper>
                              <RoleButtonWrapper allowedRoles={['ADMIN', 'HR']}>
                                <button
                                  onClick={() => openStatusModal(application.id, 'reject')}
                                  className="p-1.5 bg-gray-50 hover:bg-rose-50 text-rose-600 rounded-md transition-colors shadow-sm ring-1 ring-gray-200 hover:ring-rose-200"
                                  title="Reject"
                                >
                                  <XCircle className="w-4 h-4" />
                                </button>
                              </RoleButtonWrapper>
                              {isDeptHeadForApp && (
                                <>
                                  <button
                                    onClick={() => openStatusModal(application.id, 'recommend')}
                                    className="p-1.5 bg-gray-50 hover:bg-green-tint text-brand rounded-md transition-colors shadow-sm ring-1 ring-gray-200 hover:ring-brand/20"
                                    title="Recommend"
                                  >
                                    <ThumbsUp className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => openStatusModal(application.id, 'not_recommend')}
                                    className="p-1.5 bg-gray-50 hover:bg-orange-50 text-orange-600 rounded-md transition-colors shadow-sm ring-1 ring-gray-200 hover:ring-orange-200"
                                    title="Not Recommend"
                                  >
                                    <ThumbsDown className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })
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
          leaveTypes={leaveTypes}
          employees={employees}
          handleRunAnnualReset={handleRunAnnualReset}
          handleRunMonthlyReset={handleRunMonthlyReset}
        />
      )}

      {/* Global Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg p-6 flex flex-col items-center">
            <Loader2 className="w-8 h-8 text-brand animate-spin mb-3" />
            <p className="text-gray-700">Loading data...</p>
          </div>
        </div>
      )}
    </div>
  );
}