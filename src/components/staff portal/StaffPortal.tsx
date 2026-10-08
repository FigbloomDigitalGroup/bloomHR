import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Phosphor Icons - Premium icon set
import {
  ChatCircleDots as PhChatCircleDots,
  FileText as PhFileText,
  SquaresFour as PhSquaresFour,
  GraduationCap as PhGraduationCap,
  TrendUp as PhTrendUp,
  ShieldCheck as PhShieldCheck,
  Wallet as PhWallet,
  UserCircle as PhUserCircle,
  CalendarBlank as PhCalendarBlank,
  File as PhFile,
  Upload as PhUpload,
  Palette as PhPalette,
  Phone as PhPhone,
  Briefcase as PhBriefcase,
  Clock as PhClock,
  CurrencyDollar as PhCurrencyDollar,
  Warning as PhWarning
} from '@phosphor-icons/react';

// Keep Lucide icons for UI elements only
import {
  X,
  ChevronRight,
  ChevronLeft,
  Trash2,
  Bell,
  Menu,
  Lock,
  CheckCircle2,
  Search,
  WalletCards,
  HandCoins,
  ReceiptText,
  MessageSquarePlus,
  CalendarClock,
  History,
  FileSignature,
  Fingerprint,
  FolderClosed,
  ShieldAlert,
  BriefcaseBusiness,
  AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import StatusPill from '../UI/StatusPill';
import { fetchStaffHRNotifications } from '../../hooks/useHRNotifications';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';
import TrainingModule from './Training';
import Profile from './Profile';
import { ChatLayout } from '../chat/ChatLayout';
import { useOnlinePeople } from '../chat/lib/presence';
import VideoConferenceComponent from './VideoConf';
import UserProfileDropdown from './UserProfile';
import PasswordResetModal from './PasswordRestModal';
import DocumentsUploadPage from './Documents';
import Appearance from '../Settings/Appearance';
import MyContract from './MyContract';
import { leaveDays, NO_EMPLOYEE_RECORD_MESSAGE } from '../../lib/leaveDays';
import CompleteProfileCard from './CompleteProfileCard';
import PayslipViewer from './PayslipViewer';
import EmployeeBioPage from './Bio';
import IncidentReport from './IncidentReport';
import JobApplications from './JobApplications';
import bloomMark from '../../../public/bloom-mark.png';

interface CompanyProfile {
  id: number;
  image_url: string | null;
  company_name: string | null;
  company_tagline: string | null;
}

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  timestamp: Date;
  isRead: boolean;
}

interface NotificationState {
  items: NotificationItem[];
  lastUpdated: Date | null;
}

// Robust Helper function to safely parse date from application/record
const parseApplicationDate = (app: any): Date => {
  if (!app) return new Date();

  // Try multiple date fields in order of preference
  // Many records use 'time_added' or 'created_at' or 'application_date'
  const dateValue = app.time_added || app.created_at || app.application_date || app["Start Date"];

  if (!dateValue) return new Date();

  let parsedDate: Date;
  if (typeof dateValue === 'number') {
    parsedDate = new Date(dateValue);
  } else {
    parsedDate = new Date(dateValue);
  }

  // Validate the parsed date - if invalid or suspiciously old (epoch 1970), fallback to created_at if possible, then now
  if (isNaN(parsedDate.getTime()) || parsedDate.getFullYear() < 2000) {
    // If we have created_at as a fallback
    if (app.created_at && app.created_at !== dateValue) {
      const fallbackDate = new Date(app.created_at);
      if (!isNaN(fallbackDate.getTime()) && fallbackDate.getFullYear() >= 2000) {
        return fallbackDate;
      }
    }
    return new Date();
  }

  return parsedDate;
};

// Elevated PortalCard Component — matches Employee card design
function PortalCard({ icon, title, description, onClick, color = 'green' }: {
  icon: React.ReactNode,
  title: string,
  description: string,
  onClick: () => void,
  color?: 'green' | 'blue' | 'purple' | 'amber' | 'rose' | 'indigo' | 'cyan',
  active?: boolean
}) {
  const themes = {
    green: { avatarBg: 'bg-gradient-to-br from-brand to-brand-dark', headerBg: 'bg-gradient-to-r from-brand/80 to-brand-dark/80', iconText: 'text-brand', rowHover: 'group-hover:border-green-tint group-hover:bg-green-tint/10', dot: 'bg-status-success' },
    blue: { avatarBg: 'bg-gradient-to-br from-blue-600 to-blue-700', headerBg: 'bg-gradient-to-r from-blue-600/80 to-blue-500/80', iconText: 'text-blue-600', rowHover: 'group-hover:border-blue-100 group-hover:bg-blue-50/10', dot: 'bg-blue-500' },
    purple: { avatarBg: 'bg-gradient-to-br from-purple-600 to-purple-700', headerBg: 'bg-gradient-to-r from-purple-600/80 to-purple-500/80', iconText: 'text-purple-600', rowHover: 'group-hover:border-purple-100 group-hover:bg-purple-50/10', dot: 'bg-purple-500' },
    amber: { avatarBg: 'bg-gradient-to-br from-amber-500 to-amber-700', headerBg: 'bg-gradient-to-r from-amber-600/80 to-amber-500/80', iconText: 'text-amber-600', rowHover: 'group-hover:border-amber-100 group-hover:bg-amber-50/10', dot: 'bg-amber-500' },
    rose: { avatarBg: 'bg-gradient-to-br from-rose-500 to-rose-700', headerBg: 'bg-gradient-to-r from-rose-600/80 to-rose-500/80', iconText: 'text-rose-600', rowHover: 'group-hover:border-rose-100 group-hover:bg-rose-50/10', dot: 'bg-rose-500' },
    indigo: { avatarBg: 'bg-gradient-to-br from-indigo-600 to-indigo-700', headerBg: 'bg-gradient-to-r from-indigo-600/80 to-indigo-500/80', iconText: 'text-indigo-600', rowHover: 'group-hover:border-indigo-100 group-hover:bg-indigo-50/10', dot: 'bg-indigo-500' },
    cyan: { avatarBg: 'bg-gradient-to-br from-cyan-500 to-cyan-700', headerBg: 'bg-gradient-to-r from-cyan-600/80 to-cyan-500/80', iconText: 'text-cyan-600', rowHover: 'group-hover:border-cyan-100 group-hover:bg-cyan-50/10', dot: 'bg-cyan-500' },
  };

  const theme = themes[color];

  return (
    <motion.div
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      className="group flex flex-col bg-white rounded-2xl border border-gray-200/60 shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] hover:border-brand/20 transition-all duration-300 overflow-hidden cursor-pointer"
      onClick={onClick}
    >
      {/* Header */}
      <div className="relative h-14 px-4 flex items-center bg-gradient-to-r from-brand/10 to-white">
        <div className="flex items-center space-x-3 w-full">
          {/* Avatar-style icon circle */}
          <div className="relative">
            <div className="w-8 h-8 bg-transparent rounded-full flex items-center justify-center text-black border border-black/20">
              <div className="[&_svg]:w-[18px] [&_svg]:h-[18px]">{icon}</div>
            </div>
            <div className={`absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${theme.dot}`} />
          </div>
          {/* Title & label */}
          <div className="space-y-0.5 min-w-0">
            <h3 className="text-gray-900 font-normal text-[13px] leading-tight group-hover:text-brand transition-colors truncate">
              {title}
            </h3>
            <span className="px-1.5 py-0.5 rounded-md bg-gray-50 text-gray-500 text-[9px] font-medium tracking-wide border border-gray-200">
              Staff Portal
            </span>
          </div>
        </div>
      </div>

      {/* Slick Separator */}
      <div className="h-px w-full bg-gray-200" />

      {/* Body */}
      <div className="px-4 py-4 flex-grow bg-white">
        <div className={`flex items-center p-2 rounded-lg bg-gray-50/50 border border-gray-100 ${theme.rowHover} transition-colors`}>
          <div className="ml-1 min-w-0">
            <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Description</p>
            <p className="text-xs font-medium text-gray-700 truncate">{description}</p>
          </div>
        </div>
      </div>

      {/* Separator */}
      <div className="h-px w-full bg-gray-200" />

      {/* Footer */}
      <div className="h-11 px-4 flex items-center bg-white">
        <div className="flex items-center justify-between w-full">
          <span className="text-[10px] font-bold text-gray-500 group-hover:text-brand transition-colors">Open</span>
          <div className={`w-6 h-6 rounded-full bg-gray-100 group-hover:bg-green-tint flex items-center justify-center ${theme.iconText} transition-colors`}>
            <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// Header Status Component
function HeaderStatus({
  isLoggedIn,
  lastLogin,
}: {
  isLoggedIn: boolean;
  lastLogin: string | null;
  userName: string;
}) {

  return (
    <div className="flex items-center space-x-4">
      {/* Login Status */}
      <div className="flex items-center text-xs">
        <PhClock className="h-4 w-4 text-gray-500 mr-1" weight="duotone" />
        {isLoggedIn ? (
          <span className="text-brand font-medium">
            Logged in at {lastLogin ? new Date(lastLogin).toLocaleTimeString() : 'recently'}
          </span>
        ) : (
          <span className="text-gray-500 font-medium">Not logged in</span>
        )}
      </div>
    </div>
  );
}

// Time Tracking Functions
async function logLoginTime(employeeNumber: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('attendance_logs')
      .insert([{
        employee_number: employeeNumber,
        login_time: new Date().toISOString(),
        logout_time: null,
        status: 'logged_in'
      }])
      .select()
      .single();

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error logging login time:', error);
    return false;
  }
}

// NotificationSidebar Component
function NotificationSidebar({
  isOpen,
  onClose,
  notifications,
  onMarkRead,
  onClearAll,
  onRemove
}: {
  isOpen: boolean;
  onClose: () => void;
  notifications: NotificationItem[];
  onMarkRead: (n: NotificationItem) => void;
  onClearAll: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[60]"
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 h-full w-full max-w-sm bg-white shadow-2xl z-[70] flex flex-col"
          >
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Notifications</h3>
                <p className="text-xs text-gray-500">{notifications.length} updates pending</p>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-center">
                  <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4 text-gray-300">
                    <Bell className="w-8 h-8" />
                  </div>
                  <p className="text-sm text-gray-500 font-medium">All caught up!</p>
                  <p className="text-xs text-gray-400">No new notifications at the moment.</p>
                </div>
              ) : (
                notifications.map((n) => (
                  <motion.div
                    key={n.id}
                    layout="position"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`p-4 rounded-2xl border transition-all ${n.isRead ? 'bg-white border-gray-100' : 'bg-green-tint/50 border-green-tint'}`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <h4 className={`text-[11px] font-bold ${n.isRead ? 'text-gray-700' : 'text-brand'}`}>{n.title}</h4>
                      <button onClick={() => onRemove(n.id)} className="text-gray-400 hover:text-status-danger p-1">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-600 mb-3 leading-relaxed">{n.message}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-gray-400">{new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      {!n.isRead && (
                        <button
                          onClick={() => onMarkRead(n)}
                          className="text-[10px] font-bold text-brand hover:text-brand-dark"
                        >
                          Mark as read
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))
              )}
            </div>

            {notifications.length > 0 && (
              <div className="p-6 border-t border-gray-100">
                <button
                  onClick={onClearAll}
                  className="w-full py-3 text-xs font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-xl transition-all border border-gray-100"
                >
                  Clear all notifications
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

const LeaveApplicationForm = () => {
  const [formData, setFormData] = useState({
    "Employee Number": '',
    "Name": '',
    "Office Branch": '',
    "Leave Type": '',
    "Start Date": '',
    "End Date": '',
    "Days": 0,
    "Type": 'Full Day',
    "Application Type": 'First Application',
    "Reason": '',
    "Status": 'Pending',
    time_added: new Date().toISOString()
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  // Tracked but never displayed anywhere (pre-existing) - only the setter is
  // used, so the read binding is intentionally skipped rather than kept
  // unused.
  const [, setUserLeavesThisMonth] = useState(0);
  const [userLeaveTypesThisMonth, setUserLeaveTypesThisMonth] = useState<string[]>([]);
  // Real leave types from the leave_types catalog (see FIG-564) - replaces a
  // hardcoded dropdown whose lowercase values ("sick", "maternity", "month")
  // never matched the catalog's real names, silently breaking balance
  // deduction for any leave submitted from this form (only admin-submitted
  // applications, which already used real names, worked with the balance
  // engine). "month"/"Monthly Leave" was a separate, mislabeled concept that
  // belonged to Annual Leave (2 days/month accrual) all along - see FIG-571.
  const [leaveTypeOptions, setLeaveTypeOptions] = useState<{ id: string; name: string }[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchLeaveTypes = async () => {
      const { data, error } = await supabase.from('leave_types').select('id, name').order('name');
      if (error) {
        console.error('Error fetching leave types:', error);
        return;
      }
      if (data && data.length > 0) {
        setLeaveTypeOptions(data);
        setFormData(prev => ({
          ...prev,
          "Leave Type": prev["Leave Type"] || data.find(t => t.name === 'Annual Leave')?.name || data[0].name
        }));
      }
    };

    fetchLeaveTypes();
  }, []);

  useEffect(() => {
    const fetchEmployeeData = async () => {
      const { data: { user } } = await supabase.auth.getUser();

      if (user?.email) {
        try {
          const { data, error } = await supabase
            .from('employees')
            .select('"Employee Number", "First Name", "Last Name", "Town"')
            .eq('"Work Email"', user.email)
            .single();

          if (error) throw error;

          if (data) {
            const officeBranch = data["Town"] || '';
            setFormData(prev => ({
              ...prev,
              "Employee Number": data["Employee Number"] || '',
              "Name": `${data["First Name"]} ${data["Last Name"]}`,
              "Office Branch": officeBranch
            }));

            await checkLeaveRules(data["Employee Number"]);
          }
        } catch (error) {
          console.error('Error fetching employee data:', error);
        }
      }
    };

    fetchEmployeeData();
  }, []);

  // Personal rate limit only: an employee can't apply for the same leave
  // type twice in the same calendar month. The previous per-branch
  // "only one person on leave at a time" restriction was removed - the
  // leave_balances/carry-forward system (FIG-563/565) is the real
  // constraint on how much leave someone can take.
  const checkLeaveRules = async (employeeNumber: string) => {
    try {
      const now = new Date();
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const { data: userLeaves } = await supabase
        .from('leave_application')
        .select('*,"Leave Type"')
        .eq('"Employee Number"', employeeNumber)
        .gte('time_added', firstDayOfMonth.toISOString())
        .lte('time_added', lastDayOfMonth.toISOString());

      setUserLeavesThisMonth(userLeaves?.length || 0);

      const types = userLeaves?.map(leave => leave["Leave Type"]) || [];
      setUserLeaveTypesThisMonth(types);

      console.log('User leaves this month:', userLeaves);
      console.log('User leave types this month:', types);

    } catch (error) {
      console.error('Error checking leave rules:', error);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));

    if (name === "Start Date" || name === "End Date") {
      const days = leaveDays(
        name === "Start Date" ? value : formData["Start Date"],
        name === "End Date" ? value : formData["End Date"]
      );
      setFormData(prev => ({
        ...prev,
        "Days": days
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (userLeaveTypesThisMonth.includes(formData["Leave Type"])) {
      toast.error(`You have already applied for ${formData["Leave Type"]} this month.`);
      return;
    }

    setIsSubmitting(true);

    if (!formData["Employee Number"]) {
      toast.error(NO_EMPLOYEE_RECORD_MESSAGE);
      setIsSubmitting(false);
      return;
    }

    if (formData["Days"] <= 0) {
      toast.error('Choose a start date, and an end date that is the same day or later');
      setIsSubmitting(false);
      return;
    }

    if (!formData["Reason"] || formData["Reason"].trim().length < 10) {
      toast.error('Please provide a detailed reason (minimum 10 characters)');
      setIsSubmitting(false);
      return;
    }

    try {
      const { error } = await supabase
        .from('leave_application')
        .insert([{
          "Employee Number": formData["Employee Number"],
          "name": formData["Name"],
          "Office Branch": formData["Office Branch"],
          "Leave Type": formData["Leave Type"],
          "Start Date": formData["Start Date"],
          "End Date": formData["End Date"],
          "days": formData["Days"],
          "type": formData["Type"],
          "Application Type": formData["Application Type"],
          "reason": formData["Reason"],
          "status": formData["Status"],
          time_added: new Date().toISOString()
        }])
        .select();

      if (error) throw error;

      toast.success('Leave application submitted successfully!');

      // Redirect to leave history
      navigate('/staff?tab=leave-history');

      setFormData(prev => ({
        ...prev,
        "Start Date": '',
        "End Date": '',
        "Days": 0,
        "Type": 'Full Day',
        "Application Type": 'First Application',
        "Reason": '',
        time_added: new Date().toISOString()
      }));

    } catch (error) {
      console.error('Error submitting leave application:', error);
      toast.error('Failed to submit leave application');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Check if submit should be disabled - FIXED LOGIC
  const isSubmitDisabled = () => {
    if (isSubmitting) return true;

    if (userLeaveTypesThisMonth.includes(formData["Leave Type"])) {
      return true;
    }

    // Basic form validation
    if (!formData["Leave Type"] || !formData["Start Date"] || !formData["End Date"] || !formData["Reason"]) {
      return true;
    }

    return false;
  };

  // Get the current restriction message
  const getRestrictionMessage = () => {
    if (userLeaveTypesThisMonth.includes(formData["Leave Type"])) {
      return `You have already applied for ${formData["Leave Type"]} this month`;
    }
    return null;
  };

  const restrictionMessage = getRestrictionMessage();

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-gray-800">Leave Application</h2>
        <div className="flex items-center mt-2">
          <div className="h-1 w-8 bg-brand rounded-full mr-2"></div>
          <p className="text-xs text-brand">Staff members accrue two leave days each calendar month.</p>
        </div>

        {/* Show warning messages */}
        {userLeaveTypesThisMonth.includes(formData["Leave Type"]) && (
          <div className="mt-4 bg-orange-tint-alt border-l-4 border-orange-text-alt p-4 rounded-r-lg">
            <div className="flex">
              <PhWarning className="h-5 w-5 text-orange-text-alt" weight="duotone" />
              <div className="ml-3">
                <p className="text-xs text-orange-text-alt">
                  You have already applied for {formData["Leave Type"]} this month.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Employee Number</label>
              <input
                type="text"
                name="Employee Number"
                value={formData["Employee Number"]}
                className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg bg-gray-50"
                readOnly
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Full Name</label>
              <input
                type="text"
                name="Name"
                value={formData["Name"]}
                className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg bg-gray-50"
                readOnly
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Office Branch (Town)</label>
              <input
                type="text"
                name="Office Branch"
                value={formData["Office Branch"]}
                className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg bg-gray-50"
                readOnly
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Leave Type</label>
              <select
                name="Leave Type"
                value={formData["Leave Type"]}
                onChange={handleChange}
                className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                required
              >
                {leaveTypeOptions.length === 0 && <option value="">Loading...</option>}
                {leaveTypeOptions.map(type => (
                  <option key={type.id} value={type.name}>{type.name}</option>
                ))}
              </select>
              {userLeaveTypesThisMonth.includes(formData["Leave Type"]) && (
                <p className="text-xs text-status-purple mt-1">You've already applied for this leave type this month</p>
              )}
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Application Type</label>
              <select
                name="Application Type"
                value={formData["Application Type"]}
                onChange={handleChange}
                className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                required
              >
                <option value="First Application">First Application</option>
                <option value="Extension">Extension</option>
                <option value="Recall">Recall</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Start Date</label>
              <input
                type="date"
                name="Start Date"
                value={formData["Start Date"]}
                onChange={handleChange}
                className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                required
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">End Date</label>
              <input
                type="date"
                name="End Date"
                value={formData["End Date"]}
                onChange={handleChange}
                className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                required
                min={formData["Start Date"] || new Date().toISOString().split('T')[0]}
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Total Days</label>
              <input
                type="number"
                name="Days"
                value={formData["Days"]}
                className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg bg-gray-50"
                readOnly
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-700">Leave Duration Type</label>
            <div className="flex space-x-6 pt-2">
              <label className="inline-flex items-center">
                <input
                  type="radio"
                  name="Type"
                  value="Full Day"
                  checked={formData["Type"] === 'Full Day'}
                  onChange={handleChange}
                  className="h-4 w-4 text-brand focus:ring-primary border-gray-300"
                />
                <span className="ml-2 text-xs text-gray-700">Full Day</span>
              </label>
              <label className="inline-flex items-center">
                <input
                  type="radio"
                  name="Type"
                  value="Half Day"
                  checked={formData["Type"] === 'Half Day'}
                  onChange={handleChange}
                  className="h-4 w-4 text-brand focus:ring-primary border-gray-300"
                />
                <span className="ml-2 text-xs text-gray-700">Half Day</span>
              </label>
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-700">Reason</label>
            <textarea
              name="Reason"
              rows={4}
              value={formData["Reason"]}
              onChange={handleChange}
              className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              placeholder="Please provide details for your leave request"
              required
              minLength={10}
            />
          </div>

          <div className="pt-4">
            <button
              type="submit"
              disabled={isSubmitDisabled()}
              className={`w-full py-3 px-4 rounded-lg text-xs font-medium transition-colors flex items-center justify-center ${isSubmitDisabled()
                ? 'bg-gray-400 text-white opacity-70 cursor-not-allowed'
                : 'bg-primary text-white hover:bg-primary/90'
                }`}
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Submitting...
                </>
              ) : restrictionMessage ? (
                restrictionMessage
              ) : (
                'Submit Application'
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

// LeaveApplicationsList Component
const LeaveApplicationsList = () => {
  const [applications, setApplications] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchLeaveApplications = async () => {
      const { data: { user } } = await supabase.auth.getUser();

      if (user?.email) {
        try {
          const { data: employeeData, error: employeeError } = await supabase
            .from('employees')
            .select('"Employee Number"')
            .eq('"Work Email"', user.email)
            .single();

          if (employeeError) throw employeeError;

          if (employeeData?.["Employee Number"]) {
            const { data: leaveData, error: leaveError } = await supabase
              .from('leave_application')
              .select('*')
              .eq('"Employee Number"', employeeData["Employee Number"])
              .order('time_added', { ascending: false });

            if (leaveError) throw leaveError;

            setApplications(leaveData || []);
          }
        } catch (error) {
          console.error('Error fetching leave applications:', error);
          setError('Failed to load leave applications');
          toast.error('Could not fetch your leave applications');
        } finally {
          setIsLoading(false);
        }
      }
    };

    fetchLeaveApplications();
  }, []);

  const getStatusBadge = (status: string) => {
    switch ((status || '').toLowerCase()) {
      case 'approved':
        return <StatusPill tone="success" label="Approved" />;
      case 'rejected':
        return <StatusPill tone="danger" label="Rejected" />;
      case 'pending':
        return <StatusPill tone="warning" label="Pending" />;
      default:
        return <StatusPill tone="neutral" label="Unknown" />;
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 flex justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center text-status-danger">
        {error}
      </div>
    );
  }

  if (applications.length === 0) {
    return (
      <div className="p-8 text-center">
        <div className="max-w-md mx-auto bg-gray-50 p-6 rounded-lg">
          <div className="h-12 w-12 mx-auto bg-gray-200 rounded-full flex items-center justify-center mb-4">
            <PhCalendarBlank className="h-5 w-5 text-gray-500" weight="duotone" />
          </div>
          <h3 className="text-lg font-medium text-gray-900">No leave applications</h3>
          <p className="mt-1 text-xs text-gray-500">You haven't submitted any leave applications yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-gray-800">My Leave Applications</h2>
        <div className="flex items-center mt-2">
          <div className="h-1 w-8 bg-brand rounded-full mr-2"></div>
          <p className="text-xs text-brand">View the status of your leave requests</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Leave Type
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Dates
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Days
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Submitted On
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {applications.map((app) => (
                <tr key={app.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-xs font-medium text-gray-900 capitalize">
                      {app["Leave Type"].replace(/-/g, ' ')}
                    </div>
                    <div className="text-xs text-gray-500 mt-1 truncate max-w-xs">
                      {app.reason}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-xs text-gray-900">
                      {new Date(app["Start Date"]).toLocaleDateString()}
                    </div>
                    <div className="text-xs text-gray-500">
                      to {new Date(app["End Date"]).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                    {app.days} day{app.days !== 1 ? 's' : ''}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(app.status)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                    {parseApplicationDate(app).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// Enhanced SalaryAdvanceForm Component with button state control
// Enhanced SalaryAdvanceForm Component with monthly restriction
// Enhanced SalaryAdvanceForm Component with comprehensive status handling
// Enhanced SalaryAdvanceForm Component with 13th-16th monthly schedule
const SalaryAdvanceForm = () => {
  const [formData, setFormData] = useState({
    "Employee Number": '',
    "Full Name": '',
    "Office Branch": '',
    "Basic Salary": '',
    "Amount Requested": '',
    "Net Salary": '',
    "Reason for Advance": '',
    time_added: new Date().toISOString()
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [applications, setApplications] = useState<any[]>([]);
  const [view, setView] = useState<'form' | 'list'>('form');
  const [amountExceeded, setAmountExceeded] = useState(false);
  const [hasAppliedThisMonth, setHasAppliedThisMonth] = useState(false);
  const [currentMonthApplication, setCurrentMonthApplication] = useState<any>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [advanceSettings, setAdvanceSettings] = useState({
    isOpen: false,
    message: ''
  });
  // Check if advance applications are open based on settings
  const isAdvancePeriod = () => {
    return advanceSettings.isOpen;
  };

  useEffect(() => {
    const fetchAdvanceSettings = async () => {
      try {
        const { data } = await supabase
          .from('salary_advance_settings')
          .select('*')
          .eq('id', 1)
          .single();

        if (data) {
          setAdvanceSettings({
            isOpen: data.applications_active,
            message: data.custom_message || 'Salary advance applications are currently unavailable. The application window will reopen at the beginning of the next calendar month.'
          });
        }
      } catch (error) {
        console.error('Error fetching advance settings:', error);
      }
    };

    fetchAdvanceSettings();

    // Subscribe to settings changes
    const subscription = supabase
      .channel('salary_advance_settings_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'salary_advance_settings'
        },
        () => {
          fetchAdvanceSettings();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  // Calculate maximum eligible advance amount (20% of basic salary)
  const calculateMaxAdvance = () => {
    const basicSalary = parseFloat(formData["Basic Salary"]) || 0;
    return basicSalary * 0.2;
  };

  // Check if amount exceeds limit and update button state
  const checkAmountValidity = (amount: string) => {
    const numericAmount = parseFloat(amount) || 0;
    const maxAdvance = calculateMaxAdvance();
    setAmountExceeded(numericAmount > maxAdvance);
  };

  // Enhanced status detection that considers all approval fields
  const getEnhancedStatus = (app: any) => {
    // If it has a payment date and M-Pesa transaction, it's definitely paid
    if (app.payment_date && app.mpesa_transaction_id) {
      return {
        status: 'paid',
        label: 'Paid',
        class: 'bg-green-tint text-status-success border border-green-tint',
        description: `Paid on ${new Date(app.payment_date).toLocaleDateString()}`,
        icon: '✅'
      };
    }

    // If admin approved and has payment details
    if (app.admin_approval?.toLowerCase() === 'approved' && app.mpesa_transaction_id) {
      return {
        status: 'paid',
        label: 'Paid',
        class: 'bg-green-tint text-status-success border border-green-tint',
        description: 'Payment processed',
        icon: '✅'
      };
    }

    // Admin approved but not paid yet
    if (app.admin_approval?.toLowerCase() === 'approved') {
      return {
        status: 'approved',
        label: 'Approved - Awaiting Payment',
        class: 'bg-status-info-tint text-status-info border border-status-info-tint',
        description: 'Approved by admin, payment pending',
        icon: '📋'
      };
    }

    // Both managers approved
    if (app.branch_manager_approval && app.regional_manager_approval) {
      return {
        status: 'approved',
        label: 'Approved by Managers',
        class: 'bg-status-info-tint text-status-info border border-status-info-tint',
        description: 'Pending admin approval',
        icon: '👥'
      };
    }

    // Regional manager approved
    if (app.regional_manager_approval) {
      return {
        status: 'pending',
        label: 'Regional Manager Approved',
        class: 'bg-status-purple-tint text-status-purple border border-status-purple-tint',
        description: 'Waiting for branch manager',
        icon: '🏢'
      };
    }

    // Branch manager approved
    if (app.branch_manager_approval) {
      return {
        status: 'pending',
        label: 'Branch Manager Approved',
        class: 'bg-status-purple-tint text-status-purple border border-status-purple-tint',
        description: 'Waiting for regional manager',
        icon: '🏢'
      };
    }

    // Check the basic status field as fallback
    const basicStatus = app.status?.toLowerCase() || 'pending';

    switch (basicStatus) {
      case 'paid':
        return {
          status: 'paid',
          label: 'Paid',
          class: 'bg-green-tint text-status-success border border-green-tint',
          description: 'Payment completed',
          icon: '✅'
        };
      case 'approved':
        return {
          status: 'approved',
          label: 'Approved',
          class: 'bg-status-info-tint text-status-info border border-status-info-tint',
          description: 'Application approved',
          icon: '📋'
        };
      case 'rejected':
        return {
          status: 'rejected',
          label: 'Rejected',
          class: 'bg-orange-tint text-status-danger border border-orange-tint',
          description: 'Application rejected',
          icon: '❌'
        };
      default:
        return {
          status: 'pending',
          label: 'Under Review',
          class: 'bg-orange-tint-alt text-orange-text-alt border border-orange-tint-alt',
          description: 'Waiting for manager approval',
          icon: '⏳'
        };
    }
  };

  // Enhanced status badge component
  const getStatusBadge = (app: any) => {
    const enhancedStatus = getEnhancedStatus(app);

    return (
      <div className="flex flex-col space-y-2 min-w-[200px]">
        <div className="flex items-center space-x-2">
          <span className="text-xs">{enhancedStatus.icon}</span>
          <span className={`px-3 py-2 text-xs rounded-lg ${enhancedStatus.class} font-medium text-center`}>
            {enhancedStatus.label}
          </span>
        </div>
        <div className="text-xs text-gray-600 leading-tight">
          {enhancedStatus.description}
        </div>

        {/* Show payment details if available */}
        {app.mpesa_transaction_id && (
          <div className="text-xs text-status-success bg-green-tint p-1 rounded border border-green-tint">
            <strong>M-Pesa ID:</strong> {app.mpesa_transaction_id}
          </div>
        )}

        {/* Show approval dates if available */}
        {(app.branch_manager_approval_date || app.regional_manager_approval_date || app.admin_approval_date) && (
          <div className="text-xs text-gray-500 space-y-1">
            {app.branch_manager_approval_date && (
              <div>Branch: {new Date(app.branch_manager_approval_date).toLocaleDateString()}</div>
            )}
            {app.regional_manager_approval_date && (
              <div>Regional: {new Date(app.regional_manager_approval_date).toLocaleDateString()}</div>
            )}
            {app.admin_approval_date && (
              <div>Admin: {new Date(app.admin_approval_date).toLocaleDateString()}</div>
            )}
          </div>
        )}
      </div>
    );
  };

  // Check if user has already applied for advance this month
  const checkMonthlyApplication = async (employeeNumber: string) => {
    try {
      const now = new Date();
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const { data, error } = await supabase
        .from('salary_advance')
        .select('*')
        .eq('"Employee Number"', employeeNumber)
        .gte('time_added', firstDayOfMonth.toISOString())
        .lte('time_added', lastDayOfMonth.toISOString())
        .order('time_added', { ascending: false });

      if (error) throw error;

      if (data && data.length > 0) {
        setHasAppliedThisMonth(true);
        setCurrentMonthApplication(data[0]);
      } else {
        setHasAppliedThisMonth(false);
        setCurrentMonthApplication(null);
      }
    } catch (error) {
      console.error('Error checking monthly applications:', error);
    }
  };

  useEffect(() => {
    let subscription: any;

    const fetchEmployeeData = async () => {
      const { data: { user } } = await supabase.auth.getUser();

      if (user?.email) {
        try {
          const { data, error } = await supabase
            .from('employees')
            .select('"Employee Number", "First Name", "Last Name", "Office", "Basic Salary", "Termination Date"')
            .eq('"Work Email"', user.email)
            .single();

          if (error) throw error;

          if (data) {
            // Check if terminated
            if (data['Termination Date']) {
               toast.error('Your employment account has been deactivated. You are not eligible to apply for a salary advance.', { duration: 6000 });
               // Let them see the screen but prevent them from passing validation
               setFormData(prev => ({ ...prev, "Employee Number": '' }));
               return;
            }
            const basicSalary = data["Basic Salary"] || '0';
            setFormData(prev => ({
              ...prev,
              "Employee Number": data["Employee Number"] || '',
              "Full Name": `${data["First Name"]} ${data["Last Name"]}`,
              "Office Branch": data["Office"] || '',
              "Basic Salary": basicSalary,
              "Net Salary": basicSalary
            }));

            await fetchApplications(data["Employee Number"]);
            await checkMonthlyApplication(data["Employee Number"]);

            subscription = supabase
              .channel('salary_advance_changes')
              .on(
                'postgres_changes',
                {
                  event: '*',
                  schema: 'public',
                  table: 'salary_advance',
                  filter: `"Employee Number"=eq.${data["Employee Number"]}`
                },
                (payload) => {
                  console.log('Change detected:', payload);
                  fetchApplications(data["Employee Number"]);
                  checkMonthlyApplication(data["Employee Number"]);
                }
              )
              .subscribe();
          }
        } catch (error) {
          console.error('Error fetching data:', error);
          toast.error('Could not fetch employee information');
        }
      }
    };

    fetchEmployeeData();

    return () => {
      if (subscription) {
        supabase.removeChannel(subscription);
      }
    };
  }, []);

  useEffect(() => {
    if (formData["Amount Requested"] && formData["Basic Salary"]) {
      const amountRequested = parseFloat(formData["Amount Requested"]) || 0;
      const basicSalary = parseFloat(formData["Basic Salary"]) || 0;
      const netSalary = basicSalary - amountRequested;
      setFormData(prev => ({
        ...prev,
        "Net Salary": netSalary.toFixed(2)
      }));

      // Check amount validity whenever amount changes
      checkAmountValidity(formData["Amount Requested"]);
    } else {
      setFormData(prev => ({
        ...prev,
        "Net Salary": formData["Basic Salary"] || '0'
      }));
      setAmountExceeded(false);
    }
  }, [formData["Amount Requested"], formData["Basic Salary"]]);

  const fetchApplications = async (employeeNumber: string) => {
    try {
      const { data, error } = await supabase
        .from('salary_advance')
        .select('*')
        .eq('"Employee Number"', employeeNumber)
        .order('time_added', { ascending: false });

      if (error) throw error;

      setApplications(data || []);
    } catch (error) {
      console.error('Error fetching applications:', error);
      toast.error('Failed to load applications');
    }
  };

  // Add function to manually refresh status
  const refreshApplications = async () => {
    setIsRefreshing(true);
    try {
      if (formData["Employee Number"]) {
        await fetchApplications(formData["Employee Number"]);
        await checkMonthlyApplication(formData["Employee Number"]);
        toast.success('Applications refreshed');
      }
    } catch (error) {
      console.error('Error refreshing applications:', error);
      toast.error('Failed to refresh applications');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;

    if (name === "Amount Requested") {
      const maxAdvance = calculateMaxAdvance();
      const numericValue = parseFloat(value) || 0;

      // Check amount validity
      checkAmountValidity(value);

      // If the entered value exceeds the max, cap it at the max
      if (numericValue > maxAdvance) {
        setFormData(prev => ({
          ...prev,
          "Amount Requested": maxAdvance.toString(),
          "Net Salary": (parseFloat(prev["Basic Salary"]) - maxAdvance).toFixed(2)
        }));
        setAmountExceeded(true);
        toast.error(`Amount cannot exceed 20% of basic salary (Ksh${maxAdvance.toFixed(2)})`);
        return;
      }
    }

    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    // Check if within application period
    if (!isAdvancePeriod()) {
      toast.error(advanceSettings.message || 'Salary advance applications are currently closed.');
      setIsSubmitting(false);
      return;
    }

    // Verify not terminated based on our check in fetchEmployeeData
    if (!formData["Employee Number"]) {
      toast.error('Your employment account is inactive. Application denied.');
      setIsSubmitting(false);
      return;
    }

    // Check if user has already applied this month
    if (hasAppliedThisMonth) {
      toast.error('You have already applied for a salary advance this month. Only one application per month is allowed.');
      setIsSubmitting(false);
      return;
    }

    if (!formData["Amount Requested"] || isNaN(Number(formData["Amount Requested"]))) {
      toast.error('Please enter a valid amount');
      setIsSubmitting(false);
      return;
    }

    const amountRequested = parseFloat(formData["Amount Requested"]);
    const maxAdvance = calculateMaxAdvance();

    if (amountRequested > maxAdvance) {
      toast.error(`Amount requested cannot exceed 20% of basic salary (Ksh${maxAdvance.toFixed(2)})`);
      setIsSubmitting(false);
      return;
    }

    if (!formData["Reason for Advance"] || formData["Reason for Advance"].trim().length < 10) {
      toast.error('Please provide a detailed reason (minimum 10 characters)');
      setIsSubmitting(false);
      return;
    }

    try {
      const { error } = await supabase
        .from('salary_advance')
        .insert([{
          "Employee Number": formData["Employee Number"],
          "Full Name": formData["Full Name"],
          "Office Branch": formData["Office Branch"],
          "Basic Salary": formData["Basic Salary"],
          "Amount Requested": formData["Amount Requested"],
          "Net Salary": formData["Net Salary"],
          "Reason for Advance": formData["Reason for Advance"],
          status: 'Pending',
          time_added: new Date().toISOString()
        }])
        .select();

      if (error) throw error;

      toast.success('Salary advance application submitted successfully!');

      setView('list');

      setFormData(prev => ({
        ...prev,
        "Amount Requested": '',
        "Net Salary": prev["Basic Salary"],
        "Reason for Advance": '',
        time_added: new Date().toISOString()
      }));

      // Refresh the monthly application check
      await checkMonthlyApplication(formData["Employee Number"]);

    } catch (error) {
      console.error('Error submitting salary advance application:', error);
      toast.error('Failed to submit salary advance application');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Enhanced submit button with disabled state
  const renderSubmitButton = () => {
    const isApplicationPeriod = isAdvancePeriod();
    const isDisabled = isSubmitting || !isApplicationPeriod || amountExceeded || !formData["Amount Requested"] || !formData["Reason for Advance"] || hasAppliedThisMonth;

    return (
      <button
        type="submit"
        disabled={isDisabled}
        className={`px-4 py-2 border border-transparent rounded-lg text-xs font-medium text-white flex items-center ${isDisabled
          ? 'bg-gray-400 cursor-not-allowed opacity-70'
          : 'bg-primary hover:bg-primary/90'
          }`}
      >
        {isSubmitting ? (
          <>
            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Submitting...
          </>
        ) : !isApplicationPeriod ? (
          'Outside Application Period'
        ) : hasAppliedThisMonth ? (
          'Already Applied This Month'
        ) : amountExceeded ? (
          'Amount Exceeds Limit'
        ) : (
          <>
            <PhCurrencyDollar className="h-4 w-4 mr-2" weight="duotone" />
            Submit Application
          </>
        )}
      </button>
    );
  };

  if (view === 'list') {
    return (
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-semibold text-gray-800">Salary Advance History</h2>
            <div className="flex items-center mt-2">
              <div className="h-1 w-8 bg-brand rounded-full mr-2"></div>
              <p className="text-xs text-brand">View your salary advance applications and their current status</p>
            </div>
          </div>
          <div className="flex space-x-3">
            <button
              onClick={refreshApplications}
              disabled={isRefreshing}
              className={`px-4 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 flex items-center ${isRefreshing ? 'opacity-70 cursor-not-allowed' : ''
                }`}
            >
              {isRefreshing ? (
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-gray-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            <button
              onClick={() => setView('form')}
              className="px-4 py-2 bg-primary text-white text-xs font-medium rounded-lg hover:bg-primary/90 flex items-center"
            >
              <PhWallet className="h-4 w-4 mr-2" weight="duotone" />
              New Application
            </button>
          </div>
        </div>

        {applications.length === 0 ? (
          <div className="text-center py-8">
            <div className="max-w-md mx-auto bg-gray-50 p-6 rounded-lg">
              <div className="h-12 w-12 mx-auto bg-gray-200 rounded-full flex items-center justify-center mb-4">
                <PhWallet className="h-5 w-5 text-gray-500" weight="duotone" />
              </div>
              <h3 className="text-lg font-medium text-gray-900">No applications yet</h3>
              <p className="mt-1 text-xs text-gray-500">You haven't submitted any salary advance applications.</p>
              <button
                onClick={() => setView('form')}
                className="mt-4 px-4 py-2 bg-primary text-white text-xs font-medium rounded-lg hover:bg-primary/90"
              >
                Apply for Salary Advance
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-lg font-medium text-gray-800">Your Applications</h3>
              <div className="text-xs text-gray-500">
                Showing {applications.length} application{applications.length !== 1 ? 's' : ''}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Amount & Details
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Net Salary
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status & Progress
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date Submitted
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {applications.map((app) => (
                    <tr key={app.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-gray-900">
                          Ksh {parseFloat(app["Amount Requested"]).toLocaleString()}
                        </div>
                        <div className="text-xs text-gray-500 mt-1 max-w-xs">
                          {app["Reason for Advance"]}
                        </div>
                        {app.last_updated && (
                          <div className="text-xs text-gray-400 mt-1">
                            Last updated: {new Date(app.last_updated).toLocaleDateString()}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        Ksh {parseFloat(app["Net Salary"] || "0").toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        {getStatusBadge(app)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {parseApplicationDate(app).toLocaleDateString()}
                        <div className="text-xs text-gray-400">
                          {parseApplicationDate(app).toLocaleTimeString()}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  const isApplicationPeriod = isAdvancePeriod();

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-gray-800">Salary Advance Application</h2>
        <div className="flex items-center mt-2">
          <div className="h-1 w-8 bg-brand rounded-full mr-2"></div>
          <p className="text-xs text-brand">Submit your request for a salary advance (up to 20% of your basic salary)</p>
        </div>

        {/* Application Schedule Information */}
        <div className={`mt-3 border-l-4 p-4 rounded-r-lg ${isApplicationPeriod ? 'bg-green-tint border-status-success' : 'bg-orange-tint border-status-danger'}`}>
          <div className="flex">
            {isApplicationPeriod ? (
              <CheckCircle2 className="h-5 w-5 text-status-success" />
            ) : (
              <Lock className="h-5 w-5 text-status-danger" />
            )}
            <div className="ml-3">
              <p className={`text-xs ${isApplicationPeriod ? 'text-status-success' : 'text-status-danger'}`}>
                {isApplicationPeriod ? (
                  <>
                    <strong>Applications Open:</strong> You can currently submit salary advance applications.
                  </>
                ) : (
                  <>
                    <strong>Applications Closed:</strong> {advanceSettings.message}
                  </>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Monthly Application Restriction Warning */}
        {hasAppliedThisMonth && (
          <div className="mt-4 bg-orange-tint border-l-4 border-status-danger p-4 rounded-r-lg">
            <div className="flex">
              <PhWarning className="h-5 w-5 text-status-danger" weight="duotone" />
              <div className="ml-3">
                <p className="text-xs text-status-danger">
                  <strong>Monthly Application Limit:</strong> You have already applied for a salary advance this month.
                  Only one salary advance application is allowed per calendar month.
                </p>
                {currentMonthApplication && (
                  <p className="text-xs text-status-danger mt-1">
                    Your current application status: <strong>{getEnhancedStatus(currentMonthApplication).label}</strong> -
                    Submitted on {parseApplicationDate(currentMonthApplication).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Employee Number</label>
              <input
                type="text"
                name="Employee Number"
                value={formData["Employee Number"]}
                className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg bg-gray-50"
                readOnly
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Full Name</label>
              <input
                type="text"
                name="Full Name"
                value={formData["Full Name"]}
                className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg bg-gray-50"
                readOnly
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Office Branch</label>
              <input
                type="text"
                name="Office Branch"
                value={formData["Office Branch"]}
                className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg bg-gray-50"
                readOnly
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Basic Salary</label>
              <input
                type="text"
                name="Basic Salary"
                value={`Ksh ${parseFloat(formData["Basic Salary"] || "0").toLocaleString()}`}
                className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg bg-gray-50"
                readOnly
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Amount Requested</label>
              <div className="relative rounded-lg shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-gray-500 sm:text-xs">Ksh</span>
                </div>
                <input
                  type="number"
                  name="Amount Requested"
                  value={formData["Amount Requested"]}
                  onChange={handleChange}
                  className={`focus:ring-primary focus:border-primary block w-full pl-10 pr-12 py-2 sm:text-xs border border-gray-300 rounded-lg ${!isApplicationPeriod || hasAppliedThisMonth ? 'bg-gray-100 cursor-not-allowed' : ''
                    }`}
                  placeholder="0.00"
                  required
                  min="0"
                  max={calculateMaxAdvance()}
                  step="0.01"
                  disabled={!isApplicationPeriod || hasAppliedThisMonth}
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <span className="text-gray-500 text-xs">
                    Max: Ksh{calculateMaxAdvance().toLocaleString()}
                  </span>
                </div>
              </div>
              {amountExceeded && (
                <p className="text-xs text-status-danger mt-1">
                  Amount exceeds 20% of basic salary
                </p>
              )}
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Salary After Deduction</label>
              <input
                type="text"
                name="Net Salary"
                value={`Ksh ${parseFloat(formData["Net Salary"] || "0").toLocaleString()}`}
                className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg bg-gray-50"
                readOnly
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-700">Reason for Advance</label>
            <textarea
              name="Reason for Advance"
              rows={4}
              value={formData["Reason for Advance"]}
              onChange={handleChange}
              className={`w-full px-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary ${!isApplicationPeriod || hasAppliedThisMonth ? 'bg-gray-100 cursor-not-allowed' : ''
                }`}
              placeholder="Please explain why you need this salary advance"
              required
              minLength={10}
              disabled={!isApplicationPeriod || hasAppliedThisMonth}
            />
          </div>

          <div className="pt-4 flex justify-between">
            <button
              type="button"
              onClick={() => setView('list')}
              className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 flex items-center"
            >
              <PhFileText className="h-4 w-4 mr-2" weight="duotone" />
              View History
            </button>
            {renderSubmitButton()}
          </div>
        </div>
      </form>
    </div>
  );
};

// Enhanced LoanRequestForm Component
const LoanRequestForm = () => {
  const [formData, setFormData] = useState({
    "Employee Number": '',
    "Full Name": '',
    "Office Branch": '',
    "Basic Salary": '',
    "Loan Amount": '',
    "Number of Months": 2,
    "Monthly Deduction": '',
    "Custom Monthly Deduction": '',
    "Use Custom Deduction": false,
    "Repayment Schedule": [] as string[],
    "Reason for Loan": '',
    time_added: new Date().toISOString()
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [applications, setApplications] = useState<any[]>([]);
  const [view, setView] = useState<'form' | 'list'>('form');

  // Calculate monthly deduction based on loan amount and number of months
  const calculateMonthlyDeduction = () => {
    const loanAmount = parseFloat(formData["Loan Amount"]) || 0;
    const months = formData["Number of Months"] || 1;
    return (loanAmount / months).toFixed(2);
  };

  // Generate repayment schedule dates
  const generateRepaymentSchedule = (months: number) => {
    const schedule = [];
    const today = new Date();

    for (let i = 1; i <= months; i++) {
      const paymentDate = new Date(today);
      paymentDate.setMonth(today.getMonth() + i);
      schedule.push(paymentDate.toISOString().split('T')[0]);
    }

    return schedule;
  };

  useEffect(() => {
    let subscription: any;

    const fetchEmployeeData = async () => {
      const { data: { user } } = await supabase.auth.getUser();

      if (user?.email) {
        try {
          const { data, error } = await supabase
            .from('employees')
            .select('"Employee Number", "First Name", "Last Name", "Office", "Basic Salary"')
            .eq('"Work Email"', user.email)
            .single();

          if (error) throw error;

          if (data) {
            const basicSalary = data["Basic Salary"] || '0';

            setFormData(prev => ({
              ...prev,
              "Employee Number": data["Employee Number"] || '',
              "Full Name": `${data["First Name"]} ${data["Last Name"]}`,
              "Office Branch": data["Office"] || '',
              "Basic Salary": basicSalary,
              "Repayment Schedule": generateRepaymentSchedule(2)
            }));

            await fetchApplications(data["Employee Number"]);

            subscription = supabase
              .channel('loan_request_changes')
              .on(
                'postgres_changes',
                {
                  event: '*',
                  schema: 'public',
                  table: 'loan_requests',
                  filter: `"Employee Number"=eq.${data["Employee Number"]}`
                },
                (payload) => {
                  console.log('Change detected:', payload);
                  fetchApplications(data["Employee Number"]);
                }
              )
              .subscribe();
          }
        } catch (error) {
          console.error('Error fetching data:', error);
          toast.error('Could not fetch employee information');
        }
      }
    };

    fetchEmployeeData();

    return () => {
      if (subscription) {
        supabase.removeChannel(subscription);
      }
    };
  }, []);

  // Update monthly deduction and repayment schedule when loan amount or number of months changes
  useEffect(() => {
    if (formData["Loan Amount"]) {
      const calculatedDeduction = calculateMonthlyDeduction();
      const newSchedule = generateRepaymentSchedule(formData["Number of Months"]);

      setFormData(prev => ({
        ...prev,
        "Monthly Deduction": calculatedDeduction,
        "Repayment Schedule": newSchedule
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        "Monthly Deduction": '',
        "Repayment Schedule": []
      }));
    }
  }, [formData["Loan Amount"], formData["Number of Months"]]);

  const fetchApplications = async (employeeNumber: string) => {
    try {
      const { data, error } = await supabase
        .from('loan_requests')
        .select('*')
        .eq('"Employee Number"', employeeNumber)
        .order('time_added', { ascending: false });

      if (error) throw error;

      setApplications(data || []);
    } catch (error) {
      console.error('Error fetching applications:', error);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;

    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData(prev => ({
        ...prev,
        [name]: checked
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: name === 'Number of Months' ? parseInt(value) || 2 : value
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    if (!formData["Employee Number"]) {
      toast.error(NO_EMPLOYEE_RECORD_MESSAGE);
      setIsSubmitting(false);
      return;
    }

    if (!formData["Loan Amount"] || isNaN(Number(formData["Loan Amount"]))) {
      toast.error('Please enter a valid loan amount');
      setIsSubmitting(false);
      return;
    }

    if (!formData["Reason for Loan"] || formData["Reason for Loan"].trim().length < 10) {
      toast.error('Please provide a detailed reason (minimum 10 characters)');
      setIsSubmitting(false);
      return;
    }

    // Validate custom deduction if enabled
    const finalMonthlyDeduction = formData["Use Custom Deduction"]
      ? formData["Custom Monthly Deduction"]
      : formData["Monthly Deduction"];

    if (formData["Use Custom Deduction"]) {
      const customAmount = parseFloat(formData["Custom Monthly Deduction"]);
      const loanAmount = parseFloat(formData["Loan Amount"]);
      const totalCustomPayment = customAmount * formData["Number of Months"];

      if (customAmount <= 0) {
        toast.error('Custom monthly deduction must be greater than 0');
        setIsSubmitting(false);
        return;
      }

      if (totalCustomPayment < loanAmount) {
        toast.error('Total custom payments must cover the full loan amount');
        setIsSubmitting(false);
        return;
      }
    }

    try {
      const { error } = await supabase
        .from('loan_requests')
        .insert([{
          "Employee Number": formData["Employee Number"],
          "Full Name": formData["Full Name"],
          "Office Branch": formData["Office Branch"],
          "Basic Salary": formData["Basic Salary"],
          "Loan Amount": formData["Loan Amount"],
          "Number of Months": formData["Number of Months"],
          "Monthly Deduction": finalMonthlyDeduction,
          "Repayment Schedule": JSON.stringify(formData["Repayment Schedule"]),
          "Reason for Loan": formData["Reason for Loan"],
          status: 'Pending',
          time_added: new Date().toISOString()
        }])
        .select();

      if (error) throw error;

      toast.success('Loan application submitted successfully!');

      setView('list');

      setFormData(prev => ({
        ...prev,
        "Loan Amount": '',
        "Monthly Deduction": '',
        "Custom Monthly Deduction": '',
        "Use Custom Deduction": false,
        "Reason for Loan": '',
        time_added: new Date().toISOString()
      }));

    } catch (error) {
      console.error('Error submitting loan application:', error);
      toast.error('Failed to submit loan application');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'approved':
        return <StatusPill tone="success" label="Approved" />;
      case 'rejected':
        return <StatusPill tone="danger" label="Rejected" />;
      default:
        return <StatusPill tone="warning" label="Pending" />;
    }
  };

  if (view === 'list') {
    return (
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-semibold text-gray-800">Loan Applications</h2>
            <div className="flex items-center mt-2">
              <div className="h-1 w-8 bg-brand rounded-full mr-2"></div>
              <p className="text-xs text-brand">View your loan application history</p>
            </div>
          </div>
          <button
            onClick={() => setView('form')}
            className="px-4 py-2 bg-primary text-white text-xs font-medium rounded-lg hover:bg-primary/90 flex items-center"
          >
            <PhCurrencyDollar className="h-4 w-4 mr-2" weight="duotone" />
            New Application
          </button>
        </div>

        {applications.length === 0 ? (
          <div className="text-center py-8">
            <div className="max-w-md mx-auto bg-gray-50 p-6 rounded-lg">
              <div className="h-12 w-12 mx-auto bg-gray-200 rounded-full flex items-center justify-center mb-4">
                <PhCurrencyDollar className="h-5 w-5 text-gray-500" weight="duotone" />
              </div>
              <h3 className="text-lg font-medium text-gray-900">No loan applications</h3>
              <p className="mt-1 text-xs text-gray-500">You haven't submitted any loan applications yet.</p>
              <button
                onClick={() => setView('form')}
                className="mt-4 px-4 py-2 bg-primary text-white text-xs font-medium rounded-lg hover:bg-primary/90"
              >
                Apply for Loan
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Loan Details
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Monthly Deduction
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Duration
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date Submitted
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {applications.map((app) => (
                    <tr key={app.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-xs font-medium text-gray-900">
                          Ksh{app["Loan Amount"]}
                        </div>
                        <div className="text-xs text-gray-500 mt-1 truncate max-w-xs">
                          {app["Reason for Loan"]}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-900">
                        Ksh{app["Monthly Deduction"]}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                        {app["Number of Months"] || 2} month{(app["Number of Months"] || 2) !== 1 ? 's' : ''}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(app.status)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                        {new Date(app.time_added).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  const finalMonthlyDeduction = formData["Use Custom Deduction"]
    ? formData["Custom Monthly Deduction"]
    : formData["Monthly Deduction"];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-gray-800">Loan Request</h2>
        <div className="flex items-center mt-2">
          <div className="h-1 w-8 bg-brand rounded-full mr-2"></div>
          <p className="text-xs text-brand">Submit your request for a staff loan with flexible payment terms</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Employee Number</label>
              <input
                type="text"
                name="Employee Number"
                value={formData["Employee Number"]}
                className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg bg-gray-50"
                readOnly
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Full Name</label>
              <input
                type="text"
                name="Full Name"
                value={formData["Full Name"]}
                className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg bg-gray-50"
                readOnly
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Office Branch</label>
              <input
                type="text"
                name="Office Branch"
                value={formData["Office Branch"]}
                className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg bg-gray-50"
                readOnly
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Basic Salary</label>
              <input
                type="text"
                name="Basic Salary"
                value={`Ksh${formData["Basic Salary"]}`}
                className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg bg-gray-50"
                readOnly
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Loan Amount</label>
              <div className="relative rounded-lg shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-gray-500 sm:text-xs">Ksh</span>
                </div>
                <input
                  type="number"
                  name="Loan Amount"
                  value={formData["Loan Amount"]}
                  onChange={handleChange}
                  className="focus:ring-primary focus:border-primary block w-full pl-10 pr-12 py-2 sm:text-xs border border-gray-300 rounded-lg"
                  placeholder="0.00"
                  required
                  min="0"
                  step="0.01"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Number of Monthly Deductions</label>
              <select
                name="Number of Months"
                value={formData["Number of Months"]}
                onChange={handleChange}
                className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                required
              >
                <option value={2}>2 Months</option>
                <option value={3}>3 Months</option>
                <option value={4}>4 Months</option>
                <option value={6}>6 Months</option>
                <option value={12}>12 Months</option>
              </select>
            </div>
          </div>

          {/* Monthly Deduction Section */}
          <div className="bg-gray-50 p-4 rounded-lg space-y-4">
            <h3 className="text-lg font-medium text-gray-800">Monthly Deduction Settings</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-700">Calculated Monthly Deduction</label>
                <input
                  type="text"
                  name="Monthly Deduction"
                  value={`Ksh${formData["Monthly Deduction"]}`}
                  className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg bg-gray-100"
                  readOnly
                />
                <p className="text-xs text-gray-500">
                  Based on loan amount divided by {formData["Number of Months"]} months
                </p>
              </div>

              <div className="space-y-3">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    name="Use Custom Deduction"
                    checked={formData["Use Custom Deduction"]}
                    onChange={handleChange}
                    className="h-4 w-4 text-brand focus:ring-primary border-gray-300 rounded"
                  />
                  <span className="ml-2 text-xs font-medium text-gray-700">Use Custom Monthly Deduction</span>
                </label>

                {formData["Use Custom Deduction"] && (
                  <div className="space-y-1">
                    <div className="relative rounded-lg shadow-sm">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <span className="text-gray-500 sm:text-xs">Ksh</span>
                      </div>
                      <input
                        type="number"
                        name="Custom Monthly Deduction"
                        value={formData["Custom Monthly Deduction"]}
                        onChange={handleChange}
                        className="focus:ring-primary focus:border-primary block w-full pl-10 pr-12 py-2 sm:text-xs border border-gray-300 rounded-lg"
                        placeholder="0.00"
                        min="0"
                        step="0.01"
                      />
                    </div>
                    <p className="text-xs text-orange-text-alt">
                      Total custom payments over {formData["Number of Months"]} months: Ksh{(parseFloat(formData["Custom Monthly Deduction"]) * formData["Number of Months"] || 0).toFixed(2)}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white p-3 rounded border">
              <h4 className="text-xs font-medium text-gray-700 mb-2">Final Monthly Deduction</h4>
              <div className="text-2xl font-bold text-brand">
                Ksh{finalMonthlyDeduction || '0.00'}
              </div>
            </div>
          </div>

          {/* Repayment Schedule */}
          {formData["Repayment Schedule"].length > 0 && (
            <div className="bg-status-info-tint p-4 rounded-lg">
              <h3 className="text-lg font-medium text-gray-800 mb-3">Repayment Schedule</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {formData["Repayment Schedule"].map((date, index) => (
                  <div key={index} className="bg-white p-3 rounded-lg shadow-sm text-center">
                    <div className="text-xs text-gray-500">Payment {index + 1}</div>
                    <div className="text-xs font-medium text-gray-900">
                      {new Date(date).toLocaleDateString()}
                    </div>
                    <div className="text-xs text-brand">
                      Ksh{finalMonthlyDeduction || '0.00'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-700">Reason for Loan</label>
            <textarea
              name="Reason for Loan"
              rows={4}
              value={formData["Reason for Loan"]}
              onChange={handleChange}
              className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              placeholder="Please explain why you need this loan"
              required
              minLength={10}
            />
          </div>

          <div className="pt-4 flex justify-between">
            <button
              type="button"
              onClick={() => setView('list')}
              className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 flex items-center"
            >
              <PhFileText className="h-4 w-4 mr-2" weight="duotone" />
              View History
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`px-4 py-2 border border-transparent rounded-lg text-xs font-medium text-white bg-primary hover:bg-primary/90 flex items-center ${isSubmitting ? 'opacity-70 cursor-not-allowed' : ''
                }`}
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Submitting...
                </>
              ) : (
                <>
                  <PhCurrencyDollar className="h-4 w-4 mr-2" weight="duotone" />
                  Submit Application
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

// Enhanced DashboardHome with Payslip button
const DashboardHome = ({ setActiveTab, userName }: { setActiveTab: (tab: string) => void, userName: string }) => {
  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? "Good Morning" : currentHour < 17 ? "Good Afternoon" : "Good Evening";

  return (
    <div className="px-3 py-2 md:p-6 space-y-5 md:space-y-8">
      {/* Clean Welcome Banner */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-3 pt-2 pb-1"
      >
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 bg-green-tint border border-green-tint rounded text-[9px] font-bold tracking-[0.2em] text-status-success uppercase">
              System Active
            </span>
            <div className="h-px w-6 bg-gray-300" />
            <span className="text-[9px] font-medium text-gray-500 lowercase tracking-wider">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </span>
          </div>

          <div className="flex flex-col gap-0 shadow-sm leading-tight text-shadow-sm">
            <h2 className="text-xl md:text-2xl font-light tracking-tight text-gray-900 leading-none pb-1">
              {greeting}, <span className="font-bold text-gray-900 tracking-normal">{userName.split(' ')[0]}</span><span className="text-brand">.</span>
            </h2>
            <p className="text-gray-500 text-[11px] md:text-xs font-medium max-w-md pt-0.5">
              Your workspace is optimized and ready for deployment.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2 md:pt-0 w-full md:w-auto">
          <motion.button
            whileHover={{ scale: 1.02, y: -1 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setActiveTab('details')}
            className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-800 transition-all shadow-sm"
          >
            <PhUserCircle size={14} weight="bold" />
            Profile
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02, y: -1 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setActiveTab('VideoConf')}
            className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-50 transition-all shadow-sm"
          >
            <PhChatCircleDots size={14} weight="bold" />
            Hub
          </motion.button>
        </div>
      </motion.div>

      <CompleteProfileCard onOpen={() => setActiveTab('biodata')} />

      {/* Services Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-2">
          <div>
            <h3 className="text-base md:text-lg font-bold text-gray-900">Quick Services</h3>
            <p className="text-[10px] md:text-xs text-gray-500 font-medium tracking-tight">Access your employee tools and resources</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
          <PortalCard
            icon={<WalletCards className="w-5 h-5" strokeWidth={1.5} />}
            title="Salary Advance"
            description="Emergency financial support"
            onClick={() => setActiveTab('salary-advance')}
            color="green"
          />
          <PortalCard
            icon={<HandCoins className="w-5 h-5" strokeWidth={1.5} />}
            title="Loan Request"
            description="Affordable staff credit facilities"
            onClick={() => setActiveTab('loan')}
            color="green"
          />
          <PortalCard
            icon={<ReceiptText className="w-5 h-5" strokeWidth={1.5} />}
            title="Payslips"
            description="Download salary breakdowns"
            onClick={() => setActiveTab('payslips')}
            color="green"
          />
          <PortalCard
            icon={<MessageSquarePlus className="w-5 h-5" strokeWidth={1.5} />}
            title="Comm Hub"
            description="Collaborate with your team"
            onClick={() => setActiveTab('VideoConf')}
            color="green"
          />
          <PortalCard
            icon={<CalendarClock className="w-5 h-5" strokeWidth={1.5} />}
            title="Leave Request"
            description="Plan your time off"
            onClick={() => setActiveTab('leave')}
            color="green"
          />
          <PortalCard
            icon={<History className="w-5 h-5" strokeWidth={1.5} />}
            title="Leave History"
            description="Review previous applications"
            onClick={() => setActiveTab('leave-history')}
            color="green"
          />
          <PortalCard
            icon={<FileSignature className="w-5 h-5" strokeWidth={1.5} />}
            title="Contracts"
            description="Review employment documents"
            onClick={() => setActiveTab('contract')}
            color="green"
          />
          <PortalCard
            icon={<Fingerprint className="w-5 h-5" strokeWidth={1.5} />}
            title="My Profile"
            description="Manage your personal info"
            onClick={() => setActiveTab('details')}
            color="green"
          />
          <PortalCard
            icon={<FolderClosed className="w-5 h-5" strokeWidth={1.5} />}
            title="Documents"
            description="Secure file storage"
            onClick={() => setActiveTab('documents')}
            color="green"
          />
          <PortalCard
            icon={<ShieldAlert className="w-5 h-5" strokeWidth={1.5} />}
            title="Report Incident"
            description="Whistleblower protection"
            onClick={() => setActiveTab('incident-report')}
            color="green"
          />
          <PortalCard
            icon={<BriefcaseBusiness className="w-5 h-5" strokeWidth={1.5} />}
            title="Opportunities"
            description="Career growth paths"
            onClick={() => setActiveTab('job-applications')}
            color="green"
          />
        </div>
      </div>
    </div >
  );
};

interface MenuItem {
  id: string;
  label: string;
  icon?: any;
  hasSubmenu?: boolean;
  submenu?: {
    id: string;
    label: string;
    isExternal?: boolean;
    path?: string;
  }[];
}

interface MenuGroup {
  title: string;
  items: MenuItem[];
}

// Staff Menu Groups
const staffMenuGroups: MenuGroup[] = [
  {
    title: "Overview",
    items: [
      { id: 'home', label: 'Dashboard', icon: PhSquaresFour },
    ]
  },
  {
    title: "Work & Development",
    items: [
      { id: 'training', label: 'Training', icon: PhGraduationCap },
      { id: 'job-applications', label: 'Job Opportunities', icon: PhTrendUp },
      { id: 'incident-report', label: 'Report Incident', icon: PhShieldCheck },
    ]
  },
  {
    title: "Finance",
    items: [
      {
        id: 'financial',
        label: 'Financial',
        icon: PhWallet,
        hasSubmenu: true,
        submenu: [
          { id: 'salary-advance', label: 'Salary Advance' },
          { id: 'loan', label: 'Loan Request' }
        ]
      },
      { id: 'payslips', label: 'Payslips', icon: PhFileText },
    ]
  },
  {
    title: "Communication",
    items: [
      {
        id: 'communication',
        label: 'Communication',
        icon: PhPhone,
        hasSubmenu: true,
        submenu: [
          { id: 'chat', label: 'Chat' },
          { id: 'VideoConf', label: 'Video Conference' }
        ]
      }
    ]
  },
  {
    title: "Personal & HR",
    items: [
      {
        id: 'leave',
        label: 'Leave',
        icon: PhCalendarBlank,
        hasSubmenu: true,
        submenu: [
          { id: 'leave', label: 'Apply for Leave' },
          { id: 'leave-history', label: 'Leave History' }
        ]
      },
      { id: 'contract', label: 'Contracts', icon: PhFile },
      { id: 'details', label: 'Profile', icon: PhUserCircle },
      { id: 'biodata', label: 'Bio Data', icon: PhBriefcase },
      { id: 'documents', label: 'Documents', icon: PhUpload },
      { id: 'appearance', label: 'Appearance', icon: PhPalette },
    ]
  }
];

// Main StaffPortal Component with Time Tracking
const StaffPortal = () => {
  // shows this person as online in Teams on every page of the portal
  useOnlinePeople();
  const [activeTab, setActiveTab] = useState('home');
  const [showResetModal, setShowResetModal] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false); // For mobile
  const [expandedMenu, setExpandedMenu] = useState<string | null>(null);
  // New Sidebar States
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const sidebarVariants = {
    expanded: {
      width: 260,
      transition: { type: "spring", stiffness: 300, damping: 30 }
    },
    collapsed: {
      width: 68,
      transition: { type: "spring", stiffness: 300, damping: 30 }
    }
  };
  // collapsed stays collapsed (the mouse is always over the bar when the toggle is clicked, so hover must not re-open it)
  const isExpanded = !isCollapsed;

  const [loginStatus, setLoginStatus] = useState({
    isLoggedIn: false,
    lastLogin: null as string | null
  });
  const [userName, setUserName] = useState('Staff Member');
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);
  const [notifications, setNotifications] = useState<NotificationState>({
    items: [],
    lastUpdated: null
  });
  const [, setShowNotificationDot] = useState(false);
  const [notificationSidebarOpen, setNotificationSidebarOpen] = useState(false);
  const [employeeNumber, setEmployeeNumber] = useState<string>('');
  // False once we know this login has no employees row with a matching Work Email
  // (null = not checked yet). Every Staff Portal lookup depends on that row.
  const [employeeLinked, setEmployeeLinked] = useState<boolean | null>(null);
  // Badge on "Communication" (FIG-577/578): unread chat message count,
  // persisted via `user_channel_states.last_read_at` (the same table the
  // admin chat service already writes to) rather than in-memory-only state,
  // so it survives a refresh and reflects reality across sessions. Lives
  // here rather than inside ChatComponent since the badge must show even
  // before the user opens the Chat tab.
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);

  const fetchCompanyProfile = async () => {
    try {
      const { data, error } = await supabase
        .from('company_logo')
        .select('*')
        .order('id', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        setCompanyProfile(data);
      }
    } catch (error) {
      console.error('Error fetching company profile:', error);
    }
  };

  // Create notification item from warning data
  const createNotificationItem = (warning: any): NotificationItem => {
    return {
      id: `warning-${warning.id}`,
      type: 'warning',
      title: `Warning: ${warning.type}`,
      message: warning.message,
      timestamp: new Date(warning.created_at || new Date()),
      isRead: false
    };
  };

  // Fetch notifications from the warnings table, merged with leave
  // approve/reject decisions (FIG-574) from the shared hr_notifications
  // system (previously only read by the admin bell in Header.tsx).
  //
  // Takes the employee number as a parameter rather than reading the
  // `employeeNumber` state directly: the only call site invokes this
  // synchronously right after `setEmployeeNumber(...)`, and since state
  // updates aren't applied until the next render, reading the closure
  // variable there would still see the old ('') value and bail out on the
  // `if (!employeeNumber) return` guard below - notifications (including
  // pre-existing warnings, not just the new leave ones) never actually
  // loaded on initial mount because of this.
  const fetchNotifications = async (empNumber: string) => {
    if (!empNumber) return;

    try {
      const { data: warnings, error } = await supabase
        .from('warnings')
        .select('*')
        .eq('employee_id', empNumber)
        .order('issued_at', { ascending: false });

      if (error) throw error;

      const warningItems = (warnings || []).map(warning =>
        createNotificationItem(warning)
      );

      const hrNotifs = await fetchStaffHRNotifications(empNumber);
      const leaveItems = hrNotifs
        .filter(n => n.notification_type === 'leave_approved' || n.notification_type === 'leave_rejected' || n.notification_type === 'leave_year_end_reminder')
        .map(n => ({
          id: `hr-${n.id}`,
          type: 'leave',
          title: n.title,
          message: n.message,
          timestamp: new Date(n.created_at),
          isRead: false
        }));

      const notificationItems = [...warningItems, ...leaveItems].sort(
        (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
      );

      setNotifications(_prev => ({
        items: notificationItems,
        lastUpdated: new Date()
      }));

      // Show notification dot if there are unread items
      const hasUnread = notificationItems.some(item => !item.isRead);
      setShowNotificationDot(hasUnread);

    } catch (error) {
      console.error('Error fetching notifications:', error);
    }
  };

  // Setup real-time subscription for warnings
  useEffect(() => {
    if (!employeeNumber) return;

    const warningChannel = supabase
      .channel('warnings_notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'warnings',
          filter: `employee_id=eq.${employeeNumber}`
        },
        (payload) => {
          const newNotification = createNotificationItem(payload.new);
          setNotifications(prev => ({
            items: [newNotification, ...prev.items],
            lastUpdated: new Date()
          }));
          setShowNotificationDot(true);
          toast.success('New warning notification received');
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(warningChannel);
    };
  }, [employeeNumber]);

  // Total unread chat messages across all channels, using the persisted
  // `user_channel_states.last_read_at` (per user, per channel) rather than
  // in-memory state - a channel with no row yet is treated as fully unread
  // (matches standard chat-app behavior: you haven't opened it yet).
  const fetchUnreadMessageCount = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return;

      const { data: channelsData } = await supabase.from('channels').select('id');
      if (!channelsData || channelsData.length === 0) {
        setUnreadMessageCount(0);
        return;
      }

      const { data: readStates } = await supabase
        .from('user_channel_states')
        .select('channel_id, last_read_at')
        .eq('user_id', user.id);

      const lastReadMap = new Map((readStates || []).map((r: any) => [r.channel_id, r.last_read_at]));

      const counts = await Promise.all(channelsData.map(async (ch: any) => {
        const lastRead = lastReadMap.get(ch.id);
        let query = supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('channel_id', ch.id);
        if (lastRead) query = query.gt('created_at', lastRead);
        const { count } = await query;
        return count || 0;
      }));

      setUnreadMessageCount(counts.reduce((a, b) => a + b, 0));
    } catch (err) {
      console.error('Error fetching unread message count:', err);
    }
  }, []);

  // Check login status and fetch data on component mount
  useEffect(() => {
    checkLoginStatus();
    fetchUserData();
    fetchCompanyProfile();
    fetchUnreadMessageCount();
  }, []);

  // Live updates once a new message arrives anywhere (requires the
  // supabase_realtime publication to include `messages` - see
  // supabase/migrations/chat_realtime.sql; verified empirically that this
  // wasn't the case before that migration, so without it this badge only
  // updates on next page load, not live).
  useEffect(() => {
    const channel = supabase
      .channel('staffportal_unread_messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        fetchUnreadMessageCount();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchUnreadMessageCount]);

  const fetchUserData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) return;

      const { data: employeeData } = await supabase
        .from('employees')
        .select('"Employee Number", "First Name", "Last Name"')
        .eq('"Work Email"', user.email)
        .maybeSingle();

      setEmployeeLinked(!!employeeData);

      if (employeeData) {
        setUserName(`${employeeData["First Name"]} ${employeeData["Last Name"]}`);
        setEmployeeNumber(employeeData["Employee Number"]);

        // Pass the freshly-fetched number directly - see fetchNotifications'
        // own comment for why reading the `employeeNumber` state here
        // instead would still see the pre-update ('') value.
        fetchNotifications(employeeData["Employee Number"]);
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
    }
  };

  // Handle notification click
  const handleNotificationClick = (notification: NotificationItem) => {
    // Mark as read
    setNotifications(prev => ({
      ...prev,
      items: prev.items.map(item =>
        item.id === notification.id ? { ...item, isRead: true } : item
      )
    }));

    setShowNotificationDot(false);
  };

  // Handle clear all notifications
  const handleClearAll = () => {
    setNotifications(prev => ({
      ...prev,
      items: []
    }));
    setShowNotificationDot(false);
    toast.success('All notifications cleared');
  };

  // Handle remove single notification
  const handleRemoveNotification = (notificationId: string) => {
    setNotifications(prev => ({
      ...prev,
      items: prev.items.filter(item => item.id !== notificationId)
    }));
  };

  const unreadNotifications = notifications.items.filter(item => !item.isRead);
  // Badge on the "Leave" nav item (FIG-575): unread leave decisions only,
  // not warnings - those already have their own bell indicator.
  const unreadLeaveCount = notifications.items.filter(item => item.type === 'leave' && !item.isRead).length;

  const checkLoginStatus = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get employee number from user email
      const { data: employeeData } = await supabase
        .from('employees')
        .select('"Employee Number"')
        .eq('"Work Email"', user.email)
        .single();

      if (!employeeData) return;

      // Check if user has an active login session
      const { data: activeLog } = await supabase
        .from('attendance_logs')
        .select('login_time')
        .eq('employee_number', employeeData["Employee Number"])
        .is('logout_time', null)
        .order('login_time', { ascending: false })
        .limit(1)
        .single();

      setLoginStatus({
        isLoggedIn: !!activeLog,
        lastLogin: activeLog?.login_time || null
      });

      // If no active login session, create one automatically
      if (!activeLog) {
        const loggedIn = await logLoginTime(employeeData["Employee Number"]);
        if (loggedIn) {
          setLoginStatus({
            isLoggedIn: true,
            lastLogin: new Date().toISOString()
          });
        }
      }
    } catch (error) {
      console.error('Error checking login status:', error);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 relative flex font-sans text-gray-900 transition-colors duration-300 overflow-hidden">
      {/* Dynamic Background Blobs */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full bg-gray-200/30 blur-[130px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-gray-200/30 blur-[130px] animate-pulse" />
        <div className="absolute top-[20%] right-[-5%] w-[40%] h-[40%] rounded-full bg-gray-100/20 blur-[110px]" />
      </div>

      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* NEW SIDEBAR - Matches Main Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-50 md:relative md:z-0 md:flex ${sidebarOpen ? 'flex' : 'hidden md:flex'}`}>
        {/* Sidebar Container */}
        <div className="relative h-screen flex flex-col select-none">
          <motion.div
            initial="expanded"
            animate={isExpanded ? "expanded" : "collapsed"}
            variants={sidebarVariants}
            className="relative flex flex-col h-full border-r border-shell-fg/5 shadow-2xl overflow-hidden font-lexend bg-shell"
          >
            {/* Glowy Background: Brand Accents */}
            <div className="absolute inset-0 bg-black/10 z-[-2] backdrop-blur-2xl" />
            <div className="absolute top-0 left-0 w-96 h-96 bg-black/10 rounded-full blur-[100px] pointer-events-none z-[-1]" />
            <div className="absolute bottom-0 right-0 w-96 h-96 bg-shell-fg/5 rounded-full blur-[100px] pointer-events-none z-[-1]" />



            {/* Brand Section */}
            <div className={`relative z-10 px-5 pt-4 pb-6 flex items-center transition-all duration-300 ${isExpanded ? 'justify-between' : 'flex-col justify-center gap-6'}`}>
              <div className="flex items-center gap-3">
                <motion.div
                  layout
                  className="relative flex items-center justify-center group cursor-pointer"
                  whileHover={{ rotate: 5, scale: 1.05 }}
                  onClick={() => !isExpanded && setIsCollapsed(false)}
                >
                  <img src={bloomMark} alt="Logo" className="relative w-10 h-10 object-contain shell-logo drop-shadow-md" />
                </motion.div>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      className="flex flex-col"
                    >
                      <h1 className="font-lexend font-bold text-xl text-shell-fg tracking-tight flex items-center">
                        Figbloom<span className="text-shell-fg font-light ml-0.5">HR</span>
                      </h1>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Collapse/Expand Toggle: chevron when open, hamburger when collapsed (same as the main sidebar) */}
              <motion.button
                onClick={() => setIsCollapsed(!isCollapsed)}
                aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
                className={`p-2 rounded-xl hover:bg-shell-fg/10 transition-all duration-300 group border border-transparent hover:border-shell-fg/10 hover:shadow-sm ${!isExpanded ? 'bg-shell-fg/5' : ''}`}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                {isExpanded ? (
                  <ChevronLeft className="w-4 h-4 transition-colors text-shell-fg/50 group-hover:text-orange" />
                ) : (
                  <Menu className="w-4 h-4 transition-colors text-orange" />
                )}
              </motion.button>
            </div>

            {/* Search Bar */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="px-5 mb-4 overflow-hidden"
                >
                  <div className="relative group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-shell-fg/45 transition-colors" />
                    <input
                      type="text"
                      placeholder="Search..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-shell-fg/10 border border-shell-fg/10 rounded-xl py-2 pl-9 pr-3 text-xs text-shell-fg placeholder-shell-fg/40 focus:outline-none focus:ring-1 focus:ring-shell-fg/30 focus:border-shell-fg/30 transition-all font-normal"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Navigation Area */}
            <div className="relative z-10 flex-1 overflow-y-auto px-3 pb-4 sidebar-scroll hover:overflow-y-auto overflow-hidden">
              <div className="space-y-6">
                {staffMenuGroups.map((group) => {
                  const filteredItems = group.items.filter(item =>
                    item.label.toLowerCase().includes(searchQuery.toLowerCase())
                  );

                  if (filteredItems.length === 0 && searchQuery) return null;

                  return (
                    <motion.div
                      key={group.title}
                    >
                      {/* Section Header */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="px-3 mb-2"
                          >
                            <span className="text-[10px] font-normal text-shell-fg/40 tracking-wider font-sans pl-1">
                              {group.title}
                            </span>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Items */}
                      <div className="space-y-1">
                        {filteredItems.map((item) => {
                          const isActive = activeTab === item.id;
                          const isMenuExpanded = expandedMenu === item.id;
                          // the row is drawn as the light "active" pill when it is the page or its submenu is open: its text must follow
                          const highlighted = isActive || (item.hasSubmenu && isMenuExpanded);

                          return (
                            <div key={item.id}>
                              <motion.button
                                onClick={() => {
                                  if (item.hasSubmenu) {
                                    setExpandedMenu(isMenuExpanded ? null : item.id);
                                  } else {
                                    setActiveTab(item.id);
                                    if (window.innerWidth < 768) setSidebarOpen(false);
                                  }
                                }}
                                className={`relative w-full flex items-center px-3 py-2.5 rounded-xl transition-all duration-300 group overflow-hidden ${!isExpanded && 'justify-center px-0'} ${isActive || (item.hasSubmenu && isMenuExpanded)
                                  ? 'bg-shell-active text-shell-active-fg font-semibold border border-shell-fg/20 ring-1 ring-shell-fg/10'
                                  : 'text-shell-fg/80 hover:bg-shell-fg/10 hover:text-shell-fg'}`}
                                whileTap={{ scale: 0.98 }}
                              >
                                {/* Icon */}
                                <div className="relative z-10 flex items-center justify-center">
                                  <item.icon
                                    className={`w-4 h-4 transition-all duration-300 ${isActive || (item.hasSubmenu && isMenuExpanded)
                                      ? 'text-shell-active-fg'
                                      : 'text-shell-fg/80 group-hover:text-shell-fg group-hover:scale-110'
                                      }`}
                                    weight={isActive ? "fill" : "duotone"}
                                  />
                                  {item.id === 'leave' && unreadLeaveCount > 0 && !isExpanded && (
                                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-orange border border-shell"></span>
                                  )}
                                  {item.id === 'communication' && unreadMessageCount > 0 && !isExpanded && (
                                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-orange border border-shell"></span>
                                  )}
                                </div>

                                {/* Label */}
                                <AnimatePresence>
                                  {isExpanded && (
                                    <>
                                      <motion.span
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -10 }}
                                        className={`ml-3 text-xs truncate font-sans relative z-10 tracking-wide font-normal flex-1 text-left ${highlighted ? 'text-shell-active-fg' : 'text-shell-fg/80'}`}
                                      >
                                        {item.label}
                                      </motion.span>
                                      {item.id === 'leave' && unreadLeaveCount > 0 && (
                                        <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-orange text-white text-[10px] font-bold mr-1">
                                          {unreadLeaveCount > 99 ? '99+' : unreadLeaveCount}
                                        </span>
                                      )}
                                      {item.id === 'communication' && unreadMessageCount > 0 && (
                                        <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-orange text-white text-[10px] font-bold mr-1">
                                          {unreadMessageCount > 99 ? '99+' : unreadMessageCount}
                                        </span>
                                      )}
                                      {item.hasSubmenu && (
                                        <ChevronRight className={`w-3.5 h-3.5 ml-2 ${highlighted ? 'text-shell-active-fg/80' : 'text-shell-fg/40'} transition-transform duration-200 ${isMenuExpanded ? 'rotate-90' : ''}`} />
                                      )}
                                    </>
                                  )}
                                </AnimatePresence>

                                {/* Tooltip (Collapsed) */}
                                {!isExpanded && (
                                  <div className="absolute left-full ml-5 px-2.5 py-1.5 bg-slate-800 text-white text-[10px] font-semibold rounded-md opacity-0 group-hover:opacity-100 pointer-events-none transition-all z-50 whitespace-nowrap shadow-xl translate-x-2 group-hover:translate-x-0">
                                    {item.label}
                                    {item.id === 'leave' && unreadLeaveCount > 0 && ` (${unreadLeaveCount})`}
                                    {item.id === 'communication' && unreadMessageCount > 0 && ` (${unreadMessageCount})`}
                                    <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 w-2 h-2 bg-slate-800 rotate-45" />
                                  </div>
                                )}
                              </motion.button>

                              {/* Submenu Items */}
                              <AnimatePresence>
                                {isExpanded && item.hasSubmenu && isMenuExpanded && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden ml-4 pl-3 border-l border-shell-fg/10 space-y-1 mt-1"
                                  >
                                    {item.submenu?.map((subItem: any) => (
                                      <button
                                        key={subItem.id}
                                        onClick={() => {
                                          if (subItem.isExternal && subItem.path) {
                                            window.location.href = subItem.path;
                                          } else {
                                            setActiveTab(subItem.id);
                                            if (item.id === 'leave') {
                                              setNotifications(prev => ({
                                                ...prev,
                                                items: prev.items.map(n => n.type === 'leave' ? { ...n, isRead: true } : n)
                                              }));
                                            }
                                            if (window.innerWidth < 768) setSidebarOpen(false);
                                          }
                                        }}
                                        className={`w-full flex items-center px-3 py-2 rounded-lg text-xs font-normal transition-all ${activeTab === subItem.id ? 'text-shell-fg bg-shell-fg/10' : 'text-shell-fg/60 hover:text-shell-fg hover:bg-shell-fg/5'}`}
                                      >
                                        <span className={`w-1.5 h-1.5 rounded-full mr-2 ${activeTab === subItem.id ? 'bg-orange shadow-[0_0_8px_rgb(var(--highlight)/0.5)]' : 'bg-shell-fg/20'}`}></span>
                                        {subItem.label}
                                        {/* Per-source breakdown under "Communication" (FIG-578): Chat's
                                            own count, so "Communication"'s badge reads as the total of
                                            its children rather than a single opaque number. Video
                                            Conference has no unread concept yet, so it gets none. */}
                                        {subItem.id === 'chat' && unreadMessageCount > 0 && (
                                          <span className="ml-auto min-w-[16px] h-[16px] px-1 flex items-center justify-center rounded-full bg-orange text-white text-[9px] font-bold">
                                            {unreadMessageCount > 99 ? '99+' : unreadMessageCount}
                                          </span>
                                        )}
                                      </button>
                                    ))}
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* Profile Section */}
            <div className="relative z-10 p-3 mt-auto border-t border-shell-fg/10">
              <div
                className={`flex items-center gap-3 p-2 rounded-xl transition-all duration-300 hover:bg-shell-fg/5 cursor-pointer ${!isExpanded ? 'justify-center' : ''}`}
                onClick={() => setActiveTab('details')}
              >
                <div className="relative">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand to-brand-dark flex items-center justify-center text-white font-bold text-xs shadow-lg shadow-brand/20">
                    {userName[0]?.toUpperCase() || 'S'}
                  </div>
                  <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-status-success border-2 border-shell rounded-full"></div>
                </div>
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      className="flex-1 overflow-hidden"
                    >
                      <p className="text-xs font-semibold text-shell-fg truncate">{userName}</p>
                      <p className="text-[10px] text-shell-fg/40 truncate">Staff Member</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

          </motion.div>
        </div>
      </div>

      {/* Main Content Wrapper */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden relative">

        {/* Mobile Header Toggle */}
        <div className="md:hidden flex items-center justify-between p-4 bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-40">
          <div className="flex items-center space-x-3">
            <div className="relative w-8 h-8 rounded-lg bg-brand flex items-center justify-center shadow-lg shadow-brand/20">
              <img src={bloomMark} alt="Logo" className="w-5 h-5 object-contain brightness-0 invert" />
            </div>
            <span className="font-sans font-bold text-gray-900 tracking-tight">Staff Portal</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('details')}
              className="w-8 h-8 rounded-full bg-green-tint border border-green-tint flex items-center justify-center text-brand font-bold text-xs"
            >
              {userName[0]?.toUpperCase()}
            </button>
            <button onClick={() => setSidebarOpen(true)} className="p-2 text-gray-500 hover:text-brand">
              <Menu className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Floating Header */}
        <motion.header
          className="z-40 mx-6 mt-4 mb-6 relative hidden md:block"
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <div className="px-6 py-3 bg-white/80 backdrop-blur-xl rounded-[24px] shadow-sm border border-white/50 flex items-center justify-between hover:shadow-md hover:bg-white/90 transition-all">
            {/* Left: Company Identity / Title */}
            <div className="flex items-center space-x-4 cursor-pointer group">
              <div className="relative">
                {companyProfile?.image_url ? (
                  <img src={companyProfile.image_url} alt="Logo" className="w-10 h-10 rounded-xl object-cover shadow-sm ring-2 ring-white group-hover:ring-offset-1 transition-all" />
                ) : (
                  <div className="w-10 h-10 bg-gradient-to-br from-brand to-brand-dark rounded-xl flex items-center justify-center shadow-md ring-2 ring-white text-white font-bold text-lg">
                    {companyProfile?.company_name?.[0] || 'Z'}
                  </div>
                )}
              </div>
              <div className="flex flex-col">
                <h1 className="text-sm font-bold text-gray-800 group-hover:text-brand transition-colors">{companyProfile?.company_name || 'Staff Portal'}</h1>
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Employee Dashboard</p>
              </div>
            </div>

            {/* Right: Status & Actions */}
            <div className="flex items-center space-x-4">
              <HeaderStatus
                isLoggedIn={loginStatus.isLoggedIn}
                lastLogin={loginStatus.lastLogin}
                userName={userName}
              />

              <div className="w-px h-6 bg-gray-200 mx-2"></div>

              <motion.button
                onClick={() => setNotificationSidebarOpen(true)}
                className="relative p-2.5 text-gray-400 hover:text-brand transition-colors rounded-full hover:bg-green-tint/50"
                whileTap={{ scale: 0.95 }}
              >
                <Bell className="w-5 h-5 stroke-[1.5px]" />
                {unreadNotifications.length > 0 && (
                  <span className="absolute top-2 right-2.5 w-2 h-2 bg-status-danger rounded-full ring-2 ring-white"></span>
                )}
              </motion.button>

              <UserProfileDropdown
                onPasswordReset={() => setShowResetModal(true)}
                loginStatus={loginStatus}
                userName={userName}
                setActiveTab={setActiveTab}
              />
            </div>
          </div>
        </motion.header>

        {/* Main Scrollable Area */}
        <main className={`flex-1 min-h-0 bg-transparent p-4 pt-0 md:p-6 md:pt-0 scrollbar-hide ${activeTab === 'chat' ? 'overflow-hidden flex flex-col' : 'overflow-y-auto'}`}>
          <div className={`max-w-7xl mx-auto ${activeTab === 'chat' ? 'w-full flex-1 min-h-0 flex flex-col' : 'pb-10'}`}>
            {/* Warnings */}


            {/* Content */}
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={activeTab === 'chat' ? 'flex-1 min-h-0' : undefined}
            >
              {employeeLinked === false && (
                <div className="m-6 mb-0 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
                  <div>
                    <p className="font-semibold">Your account isn't linked to an employee record</p>
                    <p className="mt-1">
                      We couldn't find an employee with the work email you signed in with, so leave, payslips and
                      other staff features won't load. Please contact HR to link your account.
                    </p>
                  </div>
                </div>
              )}
              {/* Render Active Tab */}
              {activeTab === 'home' && <DashboardHome setActiveTab={setActiveTab} userName={userName} />}
              {activeTab === 'salary-advance' && <div className="p-6"><SalaryAdvanceForm /></div>}
              {activeTab === 'biodata' && <EmployeeBioPage />}
              {activeTab === 'payslips' && <PayslipViewer />}
              {activeTab === 'loan' && <LoanRequestForm />}
              {activeTab === 'training' && <TrainingModule />}
              {activeTab === 'leave' && <LeaveApplicationForm />}
              {activeTab === 'leave-history' && <LeaveApplicationsList />}
              {activeTab === 'contract' && <MyContract />}
              {activeTab === 'details' && <Profile />}
              {activeTab === 'documents' && <DocumentsUploadPage />}
              {activeTab === 'appearance' && <Appearance />}
              {activeTab === 'incident-report' && <IncidentReport />}
              {activeTab === 'job-applications' && <JobApplications />}
              {activeTab === 'chat' && <div className="relative h-full"><ChatLayout onMessagesRead={fetchUnreadMessageCount} /></div>}
              {activeTab === 'VideoConf' && <VideoConferenceComponent />}
            </motion.div>
          </div>
        </main>

        <PasswordResetModal isOpen={showResetModal} onClose={() => setShowResetModal(false)} />

        <NotificationSidebar
          isOpen={notificationSidebarOpen}
          onClose={() => setNotificationSidebarOpen(false)}
          notifications={notifications.items}
          onMarkRead={handleNotificationClick}
          onClearAll={handleClearAll}
          onRemove={handleRemoveNotification}
        />
      </div>
    </div>
  );
};

export default StaffPortal;