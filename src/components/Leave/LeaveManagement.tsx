import toast from 'react-hot-toast';
import { useState, useEffect, useMemo, useRef } from 'react';
import { employeeJoined, isYearlyMethod, yearAllowance } from '../../lib/leaveAccrual';
import { BALANCE_RULE_LABELS, BalanceRule, CountDays, useLeaveCheck } from '../../lib/leaveRules';
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
import { WRITE_BATCH_SIZE, chunks, fetchAll, fetchAllResult } from '../../lib/fetchAll';
import { groupBy } from '../../lib/utils';
import { TownProps } from '../../types/supabase';
import RoleButtonWrapper from '../ProtectedRoutes/RoleButton';
import LeaveScheduler from './LeaveScheduler';
import ApprovalChain from '../Approvals/ApprovalChain';
import { ApprovalChain as ApprovalChainData, loadApprovalChains } from '../../lib/approvals';
import { PageHeader, StatCard, Card, TabBar, Button, EmptyState, Modal } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';

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
  accrual_method?: 'annual' | 'monthly_cumulative' | 'monthly_non_cumulative' | 'none';
  carry_forward_max_days?: number;
  // from this many days before the year ends, remind anyone with at least reminder_min_remaining unused days (0 = off)
  reminder_days_before_year_end?: number;
  reminder_min_remaining?: number;
  // the company's rules for applying (FIG-875), checked by the database: see src/lib/leaveRules.ts
  max_days_per_request?: number | null;
  min_notice_days?: number;
  balance_rule?: BalanceRule;
  count_days?: CountDays;
  one_per_month?: boolean;
  // months after joining before it can be taken (FIG-878); days still build up meanwhile
  service_months_before_use?: number;
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
  /** HR's note when approving or rejecting (the employee's own reason stays in Reason) */
  notes?: string;
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
  // this employee's own yearly days for the type: the policy's unless HR set a different one
  yearly_allowance: number;
  has_own_allowance: boolean;
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
const LeaveApplicationDetails = ({ application, onClose, chain, onDecided }: {
  application: LeaveApplication,
  onClose: () => void,
  // its approval chain (FIG-829); the current approver approves or rejects here
  chain?: ApprovalChainData,
  onDecided?: (status: 'pending' | 'approved' | 'rejected') => void | Promise<void>
}) => {
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

            {chain && (
              <div>
                <p className="text-xs text-gray-500 mb-2">Approvals</p>
                <ApprovalChain chain={chain} onDecided={onDecided} />
              </div>
            )}

            {application.notes && (
              <div>
                <p className="text-xs text-gray-500">Decision Notes</p>
                <p className="font-medium text-sm whitespace-pre-line">{application.notes}</p>
              </div>
            )}

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
    <Modal open={isOpen} onClose={onClose} title={newLeaveType.id ? 'Edit Leave Type' : 'Add Leave Type'} hideTitle size="md" className="bg-white rounded-xl shadow-lg p-6">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Accrual Method
              </label>
              <select
                value={newLeaveType.accrual_method || 'annual'}
                onChange={(e) => setNewLeaveType((prev: any) => ({
                  ...prev,
                  accrual_method: e.target.value,
                  ...(!isYearlyMethod(e.target.value) ? { carry_forward_max_days: 0, reminder_days_before_year_end: 0, reminder_min_remaining: 0 } : {})
                }))}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-brand/20 focus:border-brand"
              >
                <option value="annual">Annual (whole allowance on Jan 1)</option>
                <option value="monthly_cumulative">Earned monthly, builds up over the year (resets Jan 1)</option>
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
                disabled={!isYearlyMethod(newLeaveType.accrual_method)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-brand/20 focus:border-brand disabled:bg-gray-100 disabled:text-gray-400"
                min="0"
                placeholder="0"
              />
              <p className="mt-1 text-[11px] text-gray-500">Unused days above this are lost at the new year (0 = none carry over).</p>
            </div>
          </div>

          {isYearlyMethod(newLeaveType.accrual_method) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Remind from (days before year end)</label>
                <input
                  type="number"
                  value={newLeaveType.reminder_days_before_year_end ?? 0}
                  onChange={(e) => setNewLeaveType((prev: any) => ({ ...prev, reminder_days_before_year_end: Math.max(0, Number(e.target.value)) }))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-brand/20 focus:border-brand"
                  min="0"
                  placeholder="0 = no reminders"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">...if they have at least (days left)</label>
                <input
                  type="number"
                  value={newLeaveType.reminder_min_remaining ?? 0}
                  onChange={(e) => setNewLeaveType((prev: any) => ({ ...prev, reminder_min_remaining: Math.max(0, Number(e.target.value)) }))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-brand/20 focus:border-brand"
                  min="0"
                  placeholder="e.g. 14"
                />
              </div>
              <p className="col-span-2 -mt-2 text-[11px] text-gray-500">Employees with unused days that would be lost get a reminder in their notifications to take leave.</p>
            </div>
          )}

          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs font-semibold text-gray-800 mb-3">Rules for applying</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">How far ahead of the balance</label>
                <select
                  value={newLeaveType.balance_rule || 'full_year'}
                  onChange={(e) => setNewLeaveType((prev: any) => ({ ...prev, balance_rule: e.target.value }))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-brand/20 focus:border-brand"
                >
                  {(Object.keys(BALANCE_RULE_LABELS) as BalanceRule[]).map((r) => (
                    <option key={r} value={r}>{BALANCE_RULE_LABELS[r]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Count days as</label>
                <select
                  value={newLeaveType.count_days || 'working'}
                  onChange={(e) => setNewLeaveType((prev: any) => ({ ...prev, count_days: e.target.value }))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-brand/20 focus:border-brand"
                >
                  <option value="working">Working days (Mon-Fri, less holidays)</option>
                  <option value="calendar">Calendar days (every day)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Most days in one application</label>
                <input
                  type="number"
                  value={newLeaveType.max_days_per_request ?? ''}
                  onChange={(e) => setNewLeaveType((prev: any) => ({ ...prev, max_days_per_request: e.target.value === '' ? null : Math.max(1, Number(e.target.value)) }))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-brand/20 focus:border-brand"
                  min="1"
                  placeholder="No limit (all at once is fine)"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Notice needed (days)</label>
                <input
                  type="number"
                  value={newLeaveType.min_notice_days ?? 0}
                  onChange={(e) => setNewLeaveType((prev: any) => ({ ...prev, min_notice_days: Math.max(0, Number(e.target.value)) }))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-brand/20 focus:border-brand"
                  min="0"
                  placeholder="0 = none"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Can be taken after (months of service)</label>
                <input
                  type="number"
                  value={newLeaveType.service_months_before_use ?? 0}
                  onChange={(e) => setNewLeaveType((prev: any) => ({ ...prev, service_months_before_use: Math.min(60, Math.max(0, Number(e.target.value))) }))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-brand/20 focus:border-brand"
                  min="0"
                  max="60"
                  placeholder="0 = from the first day"
                />
                <p className="mt-1 text-[11px] text-gray-500">Counted from the employee's start date. Days still build up meanwhile.</p>
              </div>
            </div>
            <div className="flex items-center mt-3">
              <input
                type="checkbox"
                checked={!!newLeaveType.one_per_month}
                onChange={(e) => setNewLeaveType((prev: any) => ({ ...prev, one_per_month: e.target.checked }))}
                className="rounded border-gray-300 text-brand focus:ring-brand"
              />
              <label className="ml-2 text-xs text-gray-700">Only one application a month</label>
            </div>
            <p className="mt-2 text-[11px] text-gray-500">
              Employees applying for themselves must keep to these. HR entering leave for someone may skip the notice,
              most-days and once-a-month rules, but never the balance. With no notice, people can apply for days already
              past (e.g. sick leave afterwards).
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
    </Modal>
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
    <Modal open={isOpen} onClose={onClose} title={newHoliday.id ? 'Edit Holiday' : 'Add Holiday'} hideTitle size="md" className="bg-white rounded-xl shadow-lg p-6">
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
    </Modal>
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
  handleRunMonthlyReset,
  handleRunAccrual,
  handleSendReminders
}: {
  isOpen: boolean;
  onClose: () => void;
  leaveTypes: LeaveType[];
  employees: Employee[];
  handleRunAnnualReset: () => Promise<void>;
  handleRunMonthlyReset: () => Promise<void>;
  handleRunAccrual: () => Promise<void>;
  handleSendReminders: () => Promise<void>;
}) => {
  if (!isOpen) return null;

  const annualTypes = leaveTypes.filter(t => t.is_deductible && t.accrual_method === 'annual');
  const earnedTypes = leaveTypes.filter(t => t.is_deductible && t.accrual_method === 'monthly_cumulative');
  const reminderTypes = leaveTypes.filter(t => t.is_deductible && isYearlyMethod(t.accrual_method) && (t.reminder_days_before_year_end ?? 0) > 0);
  const monthlyTypes = leaveTypes.filter(t => t.is_deductible && t.accrual_method === 'monthly_non_cumulative');
  const monthName = new Date().toLocaleDateString(undefined, { month: 'long' });

  return (
    <Modal open={isOpen} onClose={onClose} title="Leave Balance Resets" hideTitle size="md" className="bg-white rounded-xl shadow-lg p-6">
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
            <p className="text-xs font-medium text-gray-800">Earn this month's days ({monthName})</p>
            <p className="text-xs text-gray-600">
              Adds the days earned so far this year (a 24-day allowance earns 2 a month), so balances build up through the year. Safe to run again.
              Covers: {earnedTypes.length ? earnedTypes.map(t => t.name).join(', ') : 'no leave types earned monthly yet'}.
            </p>
            <button
              onClick={handleRunAccrual}
              disabled={earnedTypes.length === 0}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-brand hover:bg-brand-dark disabled:opacity-50 text-white rounded-lg text-xs font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              Earn This Month's Days
            </button>
          </div>

          <div className="border border-gray-200 rounded-lg p-4 space-y-2">
            <p className="text-xs font-medium text-gray-800">Year-end reminders</p>
            <p className="text-xs text-gray-600">
              Tells employees with unused days that would be lost to take leave, once the year-end window opens (at most once a month).
              Set per leave type. Covers: {reminderTypes.length ? reminderTypes.map(t => t.name).join(', ') : 'no leave types with reminders turned on'}.
            </p>
            <button
              onClick={handleSendReminders}
              disabled={reminderTypes.length === 0}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-brand hover:bg-brand-dark disabled:opacity-50 text-white rounded-lg text-xs font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              Send Reminders Now
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
    </Modal>
  );
};

const LeaveApplicationFormModal = ({
  isOpen,
  onClose,
  newLeaveApplication,
  setNewLeaveApplication,
  employees,
  leaveTypes,
  handleApplyLeave
}: {
  isOpen: boolean;
  onClose: () => void;
  newLeaveApplication: any;
  setNewLeaveApplication: React.Dispatch<React.SetStateAction<any>>;
  employees: Employee[];
  leaveTypes: LeaveType[];
  handleApplyLeave: () => void;
}) => {
  // the days (working or calendar, per the leave type, less holidays) and the company's leave rules, as the database
  // applies them when this is saved. HR entering leave for someone else may skip the notice, per-application and
  // once-a-month rules, never the balance.
  const { check, checking } = useLeaveCheck(
    newLeaveApplication["Employee Number"], newLeaveApplication["Leave Type"],
    newLeaveApplication["Start Date"], newLeaveApplication["End Date"]
  );
  const problems = check?.problems ?? [];
  useEffect(() => {
    setNewLeaveApplication((prev: any) => ({ ...prev, "Days": check?.days ?? 0 }));
  }, [check, setNewLeaveApplication]);

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
    <Modal open={isOpen} onClose={onClose} title="Assign Leave" hideTitle size="2xl" className="bg-white rounded-xl shadow-lg p-4 sm:p-6 thin-scrollbar">
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
                Days
              </label>
              <input
                type="number"
                value={newLeaveApplication["Days"]}
                readOnly
                className="w-full border border-gray-100 bg-gray-50 rounded-lg px-3 py-2 text-sm font-bold text-brand"
              />
              {check && check.available !== null && (
                <p className="mt-1 text-[11px] text-gray-500">{check.available} day{check.available === 1 ? '' : 's'} free to book</p>
              )}
            </div>
          </div>

          {problems.length > 0 && (
            <div className="rounded-lg border border-orange-text-alt/30 bg-orange-tint-alt px-3 py-2 space-y-1" role="alert">
              {problems.map((p) => (
                <p key={p} className="text-xs text-orange-text-alt">{p}</p>
              ))}
            </div>
          )}

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
            disabled={checking || !check || problems.length > 0}
            className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-sm font-semibold flex items-center gap-2 shadow-lg shadow-primary/20 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            Confirm Assignment
          </button>
        </div>
    </Modal>
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

  // Approval chains (FIG-829), by application id: the database decides who approves each step
  const [chains, setChains] = useState<Record<string, ApprovalChainData>>({});

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
        const { data: employeesData, error: employeesError } = await fetchAllResult((from, to) =>
          supabase.from('employees').select('Branch, Town').order('"Employee Number"').order('id').range(from, to)
        );

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

  // leave is counted from when people joined (FIG-878): who has no date the database can read
  const withoutStartDate = useMemo(() => employees.filter((e) => !employeeJoined(e as Record<string, unknown>)), [employees]);
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

  // Sets one employee's own yearly days for a leave type (the balance for this year follows straight away).
  const handleSaveAllowance = async (balance: EmployeeLeaveBalance) => {
    try {
      const { data, error } = await supabase.rpc('set_leave_entitlement', {
        p_employee_number: balance.employee_number,
        p_leave_type_id: balance.leave_type_id,
        p_days: balance.yearly_allowance,
        p_year: balance.year
      });
      if (error) throw error;
      setLeaveBalances(prev => prev.map(b => b.id === balance.id
        ? { ...b, has_own_allowance: true, accrued_days: data?.accrued_days ?? b.accrued_days, remaining_days: data?.remaining_days ?? b.remaining_days }
        : b));
    } catch (err) {
      setError('Failed to set this employee\'s yearly days. Please try again.');
      console.error(err);
    }
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

      toast.success('Leave balance settings saved successfully!');
    } catch (err) {
      setError('Failed to save balance changes. Please try again.');
      console.error(err);
    } finally {
      setSavingBalances(false);
    }
  };

  // The approval chains of the applications on this page (and the one open), read from the database (FIG-829)
  const refreshChains = async (ids: string[]) => {
    if (!ids.length) return;
    try {
      const loaded = await loadApprovalChains('leave', ids);
      setChains(prev => ({ ...prev, ...loaded }));
    } catch (err) {
      console.error('Failed to load approval chains:', err);
    }
  };

  // After the signed-in approver approved or rejected through the chain (decide_approval writes the status,
  // the recommendation and the notifications, and the database takes the balance): show the application as it now is.
  const handleApprovalDecided = async (application: LeaveApplication, status: 'pending' | 'approved' | 'rejected') => {
    try {
      const { data: row } = await supabase
        .from('leave_application')
        .select('status, recstatus, notes, recommendation_notes')
        .eq('id', application.id)
        .maybeSingle();
      if (row) {
        const localUpdateData: Partial<LeaveApplication> = {
          "Status": (row.status || 'pending').toLowerCase() as LeaveApplication['Status'],
          "recstatus": row.recstatus || null,
          "notes": row.notes || undefined,
          "recommendation_notes": row.recommendation_notes || undefined
        };
        setLeaveApplications(prev => prev.map(app => app.id === application.id ? { ...app, ...localUpdateData } : app));
        setSelectedApplication(prev => prev && prev.id === application.id ? { ...prev, ...localUpdateData } : prev);
      }
      await refreshChains([application.id]);

      // The database takes approved leave off the balance as the final approval is saved (and refuses an approval
      // that would overdraw it): reload the balances to show it.
      if (status === 'approved') {
        setBalancesRefreshKey(k => k + 1);
      }

    } catch (err) {
      setError(`Failed to update status. Please try again.`);
      console.error(err);
    }
  };

  // reload when the page shows other applications, or one of them changed
  const pageChainKey = paginatedApplications.map(app => `${app.id}:${app.Status}:${app.recstatus}`).join(',');
  useEffect(() => {
    refreshChains(pageChainKey ? pageChainKey.split(',').map(k => k.split(':')[0]) : []);
  }, [pageChainKey]);

  // Fetch employees for dropdown
  useEffect(() => {
    const fetchEmployees = async () => {
      try {
        // every employee, a page at a time (one request is capped at 1000 rows)
        const data = await fetchAll((from, to) =>
          supabase.from('employees').select('*').order('First Name').order('"Employee Number"').order('id').range(from, to)
        );
        setEmployees(data);
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

        // one row per employee and leave type, so read every page (one request is capped at 1000 rows);
        // a short read would make existing balances look missing
        const rawRows = await fetchAll((from, to) =>
          supabase
            .from('leave_balances')
            .select('*')
            .eq('year', currentYear)
            .in('month', [0, currentMonth])
            .order('id')
            .range(from, to)
        );

        // employees whose yearly days differ from the policy's (a missing table just means none yet)
        const { data: ownAllowances } = await fetchAllResult((from, to) =>
          supabase.from('leave_entitlements').select('employee_number, leave_type_id, days_allotted').order('id').range(from, to)
        );
        const allowanceByKey = new Map<string, number>(
          (ownAllowances || []).map((a: any) => [`${a.employee_number}::${a.leave_type_id}`, Number(a.days_allotted)])
        );

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

        const bootstrapped: any[] = [];
        if (missing.length > 0) {
          // `status` casing is inconsistent across rows (older/Staff-Portal
          // rows store 'Approved', this file's own writes use lowercase
          // 'approved') - match case-insensitively so historical usage
          // isn't undercounted on bootstrap.
          const { data: applicationsData } = await fetchAllResult((from, to) =>
            supabase.from('leave_application').select('*').ilike('status', 'approved').order('id').range(from, to)
          );

          // each employee's applications, looked up rather than searched (thousands of each)
          const approvedByEmployee = groupBy(applicationsData || [], (app: any) => app["Employee Number"]);

          const rowsToInsert = missing.map(({ employee, leaveType }) => {
            const isMonthly = leaveType.accrual_method === 'monthly_non_cumulative';
            const usedDays = (approvedByEmployee.get(employee["Employee Number"]) || [])
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
              // from when they joined, as the database counts it (leave_seed_days)
              accrued_days: leaveType.accrual_method === 'monthly_cumulative'
                ? yearAllowance(allowanceByKey.get(`${employee["Employee Number"]}::${leaveType.id}`) ?? leaveType.max_days ?? 0, employeeJoined(employee), currentYear, currentMonth)
                : leaveType.accrual_method === 'annual'
                  ? yearAllowance(allowanceByKey.get(`${employee["Employee Number"]}::${leaveType.id}`) ?? leaveType.max_days ?? 0, employeeJoined(employee), currentYear, 12)
                  : (allowanceByKey.get(`${employee["Employee Number"]}::${leaveType.id}`) ?? leaveType.max_days ?? 0),
              used_days: usedDays,
              carried_over_days: 0,
              monthly_accrual: 0
            };
          });

          // in batches, so a large company's rows fit in each request and each reply
          for (const batch of chunks(rowsToInsert, WRITE_BATCH_SIZE)) {
            const { data: inserted, error: insertError } = await supabase
              .from('leave_balances')
              .upsert(batch, { onConflict: 'employee_number,leave_type_id,year,month', ignoreDuplicates: true })
              .select();

            if (insertError) throw insertError;
            bootstrapped.push(...(inserted || []));
          }
        }

        const employeeByNumber = new Map(employees.map(e => [e["Employee Number"], e]));
        const balances: EmployeeLeaveBalance[] = [...existingRows, ...bootstrapped].map((row: any) => {
          const employee = employeeByNumber.get(row.employee_number);
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
            annual_accrual: annualAccrual,
            yearly_allowance: allowanceByKey.get(`${row.employee_number}::${row.leave_type_id}`) ?? leaveType?.max_days ?? 0,
            has_own_allowance: allowanceByKey.has(`${row.employee_number}::${row.leave_type_id}`)
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
            reminder_days_before_year_end: policy?.reminder_days_before_year_end ?? 0,
            reminder_min_remaining: policy?.reminder_min_remaining ?? 0,
            max_days_per_request: policy?.max_days_per_request ?? null,
            min_notice_days: policy?.min_notice_days ?? 0,
            balance_rule: policy?.balance_rule ?? 'full_year',
            count_days: policy?.count_days ?? 'working',
            one_per_month: policy?.one_per_month ?? false,
            service_months_before_use: policy?.service_months_before_use ?? 0,
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

        // Build the query for one page (one request is capped at 1000 rows), newest first
        const page = (from: number, to: number) => {
          let query = supabase
            .from('leave_application')
            .select('*')
            .order('time_added', { ascending: false })
            .order('id', { ascending: false });

          // Apply Office Branch filter if selected
          if (currentTown && currentTown !== 'ADMIN_ALL') {
            query = query.eq('"Office Branch"', currentTown.trim());
          }
          return query.range(from, to);
        };

        // Read every page
        const { data, error } = await fetchAllResult(page);

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
            "recommendation_notes": app.recommendation_notes || undefined,
            "notes": app.notes || undefined
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
      // the database works the days out again from the dates and the leave type
      const days = newLeaveApplication["Days"];

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

      toast.success('Leave assigned successfully!');
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
      // the database refuses leave that breaks one of the company's leave rules, and says which
      const message = (err as { message?: string })?.message;
      setError(message || 'Failed to submit leave application. Please try again.');
      toast.error(message || 'Failed to submit leave application');
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

  // Earns the days due so far this year for monthly-earned types (idempotent: sets what is due, never adds twice).
  const handleRunAccrual = async () => {
    try {
      const today = new Date();
      const { error } = await supabase.rpc('run_leave_accrual', { p_year: today.getFullYear(), p_month: today.getMonth() + 1 });
      if (error) throw error;
      setBalancesRefreshKey(k => k + 1);
      setShowAccrualSettings(false);
    } catch (err) {
      setError('Failed to earn this month\'s leave days. Please try again.');
      console.error(err);
    }
  };

  const handleSendReminders = async () => {
    try {
      const { data, error } = await supabase.rpc('run_leave_year_end_reminders');
      if (error) throw error;
      setShowAccrualSettings(false);
      toast.success(Number(data) > 0 ? `Sent ${data} reminder${Number(data) === 1 ? '' : 's'}.` : 'No reminders to send right now (outside the reminder window, or nobody has enough unused days).');
    } catch (err) {
      setError('Failed to send the reminders. Please try again.');
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
          reminder_days_before_year_end: type.reminder_days_before_year_end ?? 0,
          reminder_min_remaining: type.reminder_min_remaining ?? 0,
          max_days_per_request: type.max_days_per_request || null,
          min_notice_days: type.min_notice_days ?? 0,
          balance_rule: type.balance_rule || 'full_year',
          count_days: type.count_days || 'working',
          one_per_month: type.one_per_month ?? false,
          service_months_before_use: type.service_months_before_use ?? 0,
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
      {withoutStartDate.length > 0 && (
        <div className="mx-4 md:mx-6 mt-4 rounded-lg border border-orange-text-alt/30 bg-orange-tint-alt px-3 py-2" role="status">
          <p className="text-xs text-orange-text-alt">
            {withoutStartDate.length} employee{withoutStartDate.length === 1 ? ' has' : 's have'} no start date (YYYY-MM-DD) on file, so
            their leave is counted from 1 January and any service rule can't be checked:{' '}
            {withoutStartDate.slice(0, 8).map((e) => `${e["First Name"] ?? ''} ${e["Last Name"] ?? ''}`.trim() || e["Employee Number"]).join(', ')}
            {withoutStartDate.length > 8 ? ` and ${withoutStartDate.length - 8} more` : ''}. Add it in Employees → Edit.
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Employee</th>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Leave Type</th>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Office</th>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Yearly days</th>
              <th className="text-left py-3 px-4 text-gray-700 font-base">Earned</th>
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
                  {balance.month === 0 && isYearlyMethod(leaveTypes.find(t => t.id === balance.leave_type_id)?.accrual_method) ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        aria-label={`Yearly days for ${balance.first_name} ${balance.last_name}, ${balance.leave_type_name}`}
                        value={balance.yearly_allowance}
                        onChange={(e) => setLeaveBalances(prev => prev.map(b => b.id === balance.id ? { ...b, yearly_allowance: Number(e.target.value) } : b))}
                        className="w-16 border border-gray-300 rounded px-2 py-1 text-xs"
                        min="0"
                        step="0.5"
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveAllowance(balance)}
                        className="px-2 py-1 text-[11px] rounded border border-gray-300 hover:bg-gray-100"
                      >
                        Set
                      </button>
                      {balance.has_own_allowance && <span className="text-[10px] text-brand" title="Different from the leave type's default">own</span>}
                    </div>
                  ) : (
                    <p className="text-gray-400">-</p>
                  )}
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

  // the first load: the loader in place of the page (later refreshes keep the page on screen)
  if (loading && leaveApplications.length === 0) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <FigbloomLoader label="Loading leave" />
      </div>
    );
  }





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
              <div className="flex items-center gap-1.5 px-2 py-1 bg-white rounded shadow-sm border border-gray-100"><CheckCircle className="w-3 h-3 text-emerald-600" /> Approve or reject (when it is waiting on you)</div>
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
                  <th className="text-left py-3.5 px-6 text-gray-500 font-bold uppercase tracking-wider text-[10px]">Approvals</th>
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
                    // Approval workflows (FIG-829): the company's chain (by default the Leave Approver
                    // recommends, then HR approves) is checked in the database; whoever may decide the
                    // current step gets Approve / Reject in the details.
                    const chain = chains[application.id];
                    const canDecide = !!chain && chain.status === 'pending' && (chain.can_approve || chain.can_reject);

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
                        {chain ? <ApprovalChain chain={chain} compact /> : <RecStatusBadge recstatus={application.recstatus} />}
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
                          {canDecide && (
                            <button
                              onClick={() => setSelectedApplication(application)}
                              className="p-1.5 bg-gray-50 hover:bg-emerald-50 text-emerald-600 rounded-md transition-colors shadow-sm ring-1 ring-gray-200 hover:ring-emerald-200"
                              title="Approve or reject"
                              aria-label={`Approve or reject ${application.Name}'s leave`}
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
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


      {/* Error Alert */}
      {error && (
        <div className="fixed bottom-4 right-4 z-50 max-w-[calc(100vw-2rem)]">
          <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded-lg shadow-lg">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <div className="min-w-0 break-words">
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
          chain={chains[selectedApplication.id]}
          onDecided={(status) => handleApprovalDecided(selectedApplication, status)}
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
          handleRunAccrual={handleRunAccrual}
          handleSendReminders={handleSendReminders}
        />
      )}

    </div>
  );
}