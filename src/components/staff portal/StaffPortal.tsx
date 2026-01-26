import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Phosphor Icons - Premium icon set
import {
  CreditCard as PhCreditCard,
  Coins as PhCoins,
  Receipt as PhReceipt,
  ChatCircleDots as PhChatCircleDots,
  ClockCounterClockwise as PhClockCounterClockwise,
  FileText as PhFileText,
  Fingerprint as PhFingerprint,
  FolderOpen as PhFolderOpen,
  Lifebuoy as PhLifebuoy,
  Sparkle as PhSparkle,
  SquaresFour as PhSquaresFour,
  GraduationCap as PhGraduationCap,
  TrendUp as PhTrendUp,
  ShieldCheck as PhShieldCheck,
  Wallet as PhWallet,
  UserCircle as PhUserCircle,
  CalendarBlank as PhCalendarBlank,
  File as PhFile,
  Upload as PhUpload,
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
  MapPin,
  MapPinOff,
  Trash2,
  Bell,
  Menu,
  PartyPopper,
  Lock,
  CheckCircle2
} from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';
import TrainingModule from './Training';
import Profile from './Profile';
import ChatComponent from './Chat';
import VideoConferenceComponent from './VideoConf';
import UserProfileDropdown from './UserProfile';
import PasswordResetModal from './PasswordRestModal';
import DocumentsUploadPage from './Documents';
import PayslipViewer from './PayslipViewer';
import EmployeeBioPage from './Bio';
import IncidentReport from './IncidentReport';
import JobApplications from './JobApplications';
import solo from '../../../public/solo.png';

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
interface TrainingDocument {
  id: string;
  title: string;
  description: string | null;
  url: string;
  file_name: string;
  file_size: number;
  file_type: string;
  category: string;
  required: boolean;
  order: number;
  quiz_required: boolean;
  created_at: string;
}

interface NotificationState {
  items: NotificationItem[];
  lastUpdated: Date | null;
}

// Geolocation and Time Tracking Types
interface GeolocationPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
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

interface AttendanceLog {
  id?: string;
  employee_number: string;
  login_time: string;
  logout_time: string | null;
  geolocation: GeolocationPosition | null;
  status: 'logged_in' | 'logged_out';
  created_at?: string;
}
interface TrainingProgress {
  document_id: string;
  employee_number: string;
  completed: boolean;
  completed_at: string | null;
  quiz_passed: boolean | null;
  quiz_score: number | null;
  time_spent: number; // in minutes
  last_accessed: string;
}
// SidebarNavItem Component
const SidebarNavItem = ({
  icon,
  label,
  active,
  onClick,
  hasSubmenu = false,
  isExpanded = false
}: {
  icon: React.ReactNode,
  label: string,
  active: boolean,
  onClick: () => void,
  hasSubmenu?: boolean,
  isExpanded?: boolean
}) => (
  <button
    onClick={onClick}
    className={`flex items-center justify-between w-full px-4 py-3 text-xs font-medium rounded-lg transition-colors ${active
      ? 'bg-[#42fcff]/60 text-green-700'
      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
      }`}
  >
    <div className="flex items-center">
      <span className="mr-3">{icon}</span>
      {label}
    </div>
    {hasSubmenu && (
      <ChevronRight className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
    )}
  </button>
);

// PasswordResetModal Component

// GeolocationWarningModal Component
const GeolocationWarningModal = ({
  isOpen,
  onConfirm
}: {
  isOpen: boolean,
  onConfirm: () => void
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md"
      >
        <div className="flex justify-center mb-4">
          <MapPin className="h-12 w-12 text-green-500" />
        </div>

        <h3 className="text-lg font-medium text-gray-900 text-center mb-2">
          Enable Location Services
        </h3>

        <p className="text-xs text-gray-600 text-center mb-6">
          To track your attendance and working hours, we need access to your location.
          This helps verify your presence and ensures accurate time logging.
        </p>

        <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded-r-lg mb-4">
          <div className="flex">
            <div className="ml-3">
              <p className="text-xs text-green-700">
                <strong>Note:</strong> Enabling location services will automatically log you in and start tracking your work hours.
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-center">
          <button
            onClick={onConfirm}
            className="px-6 py-2.5 border border-transparent rounded-xl text-xs font-bold text-white bg-green-600 hover:bg-green-700 shadow-lg shadow-green-200 transition-all"
          >
            Enable Location Services
          </button>
        </div>
      </motion.div>
    </div>
  );
};

// Geolocation and Time Tracking Functions
const getCurrentPosition = (): Promise<GeolocationPosition> => {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this browser'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp
        });
      },
      (error) => {
        reject(error);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  });
};

const logLoginTime = async (employeeNumber: string): Promise<boolean> => {
  try {
    let position: GeolocationPosition | null = null;

    try {
      position = await getCurrentPosition();
    } catch (error) {
      console.warn('Could not get geolocation:', error);
      // We'll still log the login but with null geolocation
    }

    const { data, error } = await supabase
      .from('attendance_logs')
      .insert([{
        employee_number: employeeNumber,
        login_time: new Date().toISOString(),
        logout_time: null,
        geolocation: position,
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
};

const checkExistingLogin = async (employeeNumber: string): Promise<boolean> => {
  try {
    const { data, error } = await supabase
      .from('attendance_logs')
      .select('id')
      .eq('employee_number', employeeNumber)
      .is('logout_time', null)
      .order('login_time', { ascending: false })
      .limit(1)
      .single();

    return !!data;
  } catch (error) {
    return false;
  }
};

// Header Status Component with Geolocation Toggle
const HeaderStatus = ({
  isLoggedIn,
  lastLogin,
  geolocationStatus,
  userName,
  onGeolocationToggle
}: {
  isLoggedIn: boolean;
  lastLogin: string | null;
  geolocationStatus: 'granted' | 'denied' | 'prompt';
  userName: string;
  onGeolocationToggle: () => void;
}) => {
  const navigate = useNavigate();

  return (
    <div className="flex items-center space-x-4">
      {/* Geolocation Status with Toggle */}
      <div className="flex items-center text-xs">
        <button
          onClick={onGeolocationToggle}
          className="flex items-center space-x-1 px-2 py-1 rounded-lg hover:bg-gray-50 transition-colors group"
          title={geolocationStatus === 'granted' ? 'Location enabled - Click to refresh' : 'Click to enable location tracking'}
        >
          {geolocationStatus === 'granted' ? (
            <MapPin className="h-4 w-4 text-green-500 mr-1 group-hover:scale-110 transition-transform" />
          ) : (
            <MapPinOff className="h-4 w-4 text-gray-400 mr-1 group-hover:scale-110 transition-transform" />
          )}
          <span className={geolocationStatus === 'granted' ? 'text-green-600 font-medium' : 'text-gray-500 font-medium'}>
            {geolocationStatus === 'granted' ? 'Location Enabled' : 'Location Optional'}
          </span>
        </button>
      </div>

      {/* Login Status */}
      <div className="flex items-center text-xs">
        <PhClock className="h-4 w-4 text-gray-500 mr-1" weight="duotone" />
        {isLoggedIn ? (
          <span className="text-green-600 font-medium">
            Logged in at {lastLogin ? new Date(lastLogin).toLocaleTimeString() : 'recently'}
          </span>
        ) : (
          <span className="text-gray-500 font-medium">Not logged in</span>
        )}
      </div>
    </div>
  );
};

// ComingSoon Component
const ComingSoon = ({ title }: { title: string }) => (
  <div className="p-12 text-center">
    <div className="max-w-md mx-auto bg-gray-50 p-8 rounded-lg">
      <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-full shadow-sm mb-4">
        <PartyPopper className="h-8 w-8 text-gray-500" />
      </div>
      <h2 className="mt-2 text-xl font-medium text-gray-900">{title} Portal</h2>
      <p className="mt-3 text-xs text-gray-500">
        This section is currently under development and will be available soon.
      </p>
      <div className="mt-6">
        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
          Coming soon...
        </span>
      </div>
    </div>
  </div>
);

// NotificationSidebar Component
const NotificationSidebar = ({
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
}) => {
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
                    className={`p-4 rounded-2xl border transition-all ${n.isRead ? 'bg-white border-gray-100' : 'bg-green-50/30 border-green-100/50'}`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <h4 className={`text-[11px] font-bold ${n.isRead ? 'text-gray-700' : 'text-green-700'}`}>{n.title}</h4>
                      <button onClick={() => onRemove(n.id)} className="text-gray-400 hover:text-red-500 p-1">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-600 mb-3 leading-relaxed">{n.message}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-gray-400">{new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      {!n.isRead && (
                        <button
                          onClick={() => onMarkRead(n)}
                          className="text-[10px] font-bold text-green-600 hover:text-green-700"
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
};

// PortalCard Component
const PortalCard = ({ icon, title, description, onClick, color = 'green' }: {
  icon: React.ReactNode,
  title: string,
  description: string,
  onClick: () => void,
  color?: 'green' | 'blue' | 'purple' | 'amber' | 'rose' | 'indigo' | 'cyan'
}) => {
  const themes = {
    green: { bg: 'bg-emerald-50', icon: 'text-emerald-600', hover: 'group-hover:bg-emerald-600', shadow: 'shadow-emerald-100' },
    blue: { bg: 'bg-blue-50', icon: 'text-blue-600', hover: 'group-hover:bg-blue-600', shadow: 'shadow-blue-100' },
    purple: { bg: 'bg-purple-50', icon: 'text-purple-600', hover: 'group-hover:bg-purple-600', shadow: 'shadow-purple-100' },
    amber: { bg: 'bg-amber-50', icon: 'text-amber-600', hover: 'group-hover:bg-amber-600', shadow: 'shadow-amber-100' },
    rose: { bg: 'bg-rose-50', icon: 'text-rose-600', hover: 'group-hover:bg-rose-600', shadow: 'shadow-rose-100' },
    indigo: { bg: 'bg-indigo-50', icon: 'text-indigo-600', hover: 'group-hover:bg-indigo-600', shadow: 'shadow-indigo-100' },
    cyan: { bg: 'bg-cyan-50', icon: 'text-cyan-600', hover: 'group-hover:bg-cyan-600', shadow: 'shadow-cyan-100' },
  };

  const theme = themes[color];

  return (
    <motion.div
      whileHover={{
        y: -5,
        transition: { duration: 0.2 }
      }}
      whileTap={{ scale: 0.98 }}
      className={`group relative bg-white/70 backdrop-blur-xl border border-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-[28px] p-6 cursor-pointer hover:bg-white transition-all duration-300 hover:${theme.shadow}/50`}
      onClick={onClick}
    >
      <div className="relative z-10">
        <div className={`w-14 h-14 ${theme.bg} rounded-[20px] flex items-center justify-center mb-5 group-hover:scale-110 ${theme.hover} group-hover:text-white transition-all duration-500 group-hover:shadow-lg group-hover:shadow-current/20`}>
          <div className={`${theme.icon} group-hover:text-white transition-colors duration-300`}>
            {icon}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-bold text-gray-900 mb-1.5 group-hover:text-gray-900 transition-colors">
            {title}
          </h3>
          <p className="text-[11px] text-gray-500 leading-relaxed font-medium">
            {description}
          </p>
        </div>
      </div>
      <div className={`absolute bottom-6 right-6 opacity-20 group-hover:opacity-100 group-hover:translate-x-1 transition-all duration-300 ${theme.icon}`}>
        <ChevronRight className="w-4 h-4" />
      </div>
    </motion.div>
  );
};

// LeaveApplicationForm Component with enhanced restrictions
// LeaveApplicationForm Component with corrected restrictions
const LeaveApplicationForm = () => {
  const [formData, setFormData] = useState({
    "Employee Number": '',
    "Name": '',
    "Office Branch": '',
    "Leave Type": 'month',
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
  const [existingLeave, setExistingLeave] = useState<any>(null);
  const [userLeavesThisMonth, setUserLeavesThisMonth] = useState(0);
  const [userLeaveTypesThisMonth, setUserLeaveTypesThisMonth] = useState<string[]>([]);
  const navigate = useNavigate();

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
              "Name": `${data["First Name"]} ${data["Last Name"]}` || '',
              "Office Branch": officeBranch
            }));

            // Check leave rules with office branch
            await checkLeaveRules(data["Employee Number"], officeBranch);
          }
        } catch (error) {
          console.error('Error fetching employee data:', error);
        }
      }
    };

    fetchEmployeeData();
  }, []);

  const checkLeaveRules = async (employeeNumber: string, officeBranch: string) => {
    try {
      const now = new Date();
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      console.log('Checking leave rules for:', { employeeNumber, officeBranch });

      // Only check for monthly leaves from same branch
      const { data: activeMonthlyLeaves, error } = await supabase
        .from('leave_application')
        .select('*,"Name","Employee Number","Office Branch","Leave Type"')
        .eq('"Office Branch"', officeBranch) // Compare with the same branch
        .eq('"Leave Type"', 'month') // Only check monthly leaves
        .in('Status', ['Pending', 'Approved'])
        .gte('"Start Date"', firstDayOfMonth.toISOString().split('T')[0])
        .lte('"Start Date"', lastDayOfMonth.toISOString().split('T')[0]);

      if (error) {
        console.error('Error fetching active leaves:', error);
        return;
      }

      console.log('Active monthly leaves in same branch:', activeMonthlyLeaves);

      // Filter out the current user's applications
      const otherStaffLeaves = activeMonthlyLeaves?.filter(
        leave => leave["Employee Number"] !== employeeNumber
      ) || [];

      console.log('Other staff leaves in same branch:', otherStaffLeaves);

      if (otherStaffLeaves.length > 0) {
        setExistingLeave(otherStaffLeaves[0]);
      } else {
        setExistingLeave(null);
      }

      // Check user's own leaves for the month
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

  const calculateDays = (startDate: string, endDate: string) => {
    if (!startDate || !endDate) return 0;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));

    if (name === "Start Date" || name === "End Date") {
      const days = calculateDays(
        name === "Start Date" ? value : formData["Start Date"],
        name === "End Date" ? value : formData["Start Date"]
      );
      setFormData(prev => ({
        ...prev,
        "Days": days
      }));
    }

    // If leave type changes, re-check rules
    if (name === "Leave Type") {
      // Re-fetch employee data to get current branch and check rules
      const fetchAndCheckRules = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.email) {
          try {
            const { data } = await supabase
              .from('employees')
              .select('"Employee Number", "Town"')
              .eq('"Work Email"', user.email)
              .single();

            if (data) {
              await checkLeaveRules(data["Employee Number"], data["Town"] || '');
            }
          } catch (error) {
            console.error('Error re-checking leave rules:', error);
          }
        }
      };
      fetchAndCheckRules();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Check leave rules - only restrict for monthly leave type
    if (formData["Leave Type"] === "month") {
      if (existingLeave) {
        toast.error(`Cannot submit monthly leave application. ${existingLeave.Name} from your office branch (${existingLeave["Office Branch"]}) already has an active monthly leave.`);
        return;
      }

      // Allow multiple leaves per month but only one monthly leave per month
      if (userLeaveTypesThisMonth.includes("month")) {
        toast.error('You have already applied for monthly leave this month.');
        return;
      }
    }

    // For non-monthly leaves, check if user is trying to apply for the same type again
    if (formData["Leave Type"] !== "month" && userLeaveTypesThisMonth.includes(formData["Leave Type"])) {
      toast.error(`You have already applied for ${formData["Leave Type"]} leave this month.`);
      return;
    }

    setIsSubmitting(true);

    if (formData["Days"] <= 0) {
      toast.error('End date must be after start date');
      setIsSubmitting(false);
      return;
    }

    if (!formData["Reason"] || formData["Reason"].trim().length < 10) {
      toast.error('Please provide a detailed reason (minimum 10 characters)');
      setIsSubmitting(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('leave_application')
        .insert([{
          "Employee Number": formData["Employee Number"],
          "Name": formData["Name"],
          "Office Branch": formData["Office Branch"],
          "Leave Type": formData["Leave Type"],
          "Start Date": formData["Start Date"],
          "End Date": formData["End Date"],
          "Days": formData["Days"],
          "Type": formData["Type"],
          "Application Type": formData["Application Type"],
          "Reason": formData["Reason"],
          "Status": formData["Status"],
          time_added: new Date().toISOString()
        }])
        .select();

      if (error) throw error;

      toast.success('Leave application submitted successfully!');

      // Redirect to leave history
      navigate('/staff?tab=leave-history');

      setFormData(prev => ({
        ...prev,
        "Leave Type": 'month',
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

    // For monthly leave, check restrictions
    if (formData["Leave Type"] === "month") {
      if (existingLeave) return true;
      if (userLeaveTypesThisMonth.includes("month")) return true;
    }

    // For other leave types, only disable if already applied this month
    if (formData["Leave Type"] !== "month" && userLeaveTypesThisMonth.includes(formData["Leave Type"])) {
      return true;
    }

    // Basic form validation
    if (!formData["Start Date"] || !formData["End Date"] || !formData["Reason"]) {
      return true;
    }

    return false;
  };

  // Get the current restriction message
  const getRestrictionMessage = () => {
    if (formData["Leave Type"] === "month") {
      if (existingLeave) {
        return `Monthly leave restricted: ${existingLeave.Name} from ${existingLeave["Office Branch"]} branch has an active monthly leave`;
      }
      if (userLeaveTypesThisMonth.includes("month")) {
        return "You have already applied for monthly leave this month";
      }
    } else if (userLeaveTypesThisMonth.includes(formData["Leave Type"])) {
      return `You have already applied for ${formData["Leave Type"]} leave this month`;
    }
    return null;
  };

  const restrictionMessage = getRestrictionMessage();

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-gray-800">Leave Application</h2>
        <div className="flex items-center mt-2">
          <div className="h-1 w-8 bg-green-500 rounded-full mr-2"></div>
          <p className="text-xs text-green-600">Staff members accrue two leave days each calendar month.</p>
        </div>

        {/* Show warning messages */}
        {existingLeave && formData["Leave Type"] === "month" && (
          <div className="mt-4 bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg">
            <div className="flex">
              <PhWarning className="h-5 w-5 text-red-500" weight="duotone" />
              <div className="ml-3">
                <p className="text-xs text-red-700">
                  <strong>Monthly Leave Restriction:</strong> {existingLeave.Name} from your office branch ({existingLeave["Office Branch"]}) already has an active monthly leave application. Monthly leaves are restricted to one staff member per branch.
                </p>
              </div>
            </div>
          </div>
        )}

        {userLeaveTypesThisMonth.includes("month") && formData["Leave Type"] === "month" && (
          <div className="mt-4 bg-blue-50 border-l-4 border-blue-500 p-4 rounded-r-lg">
            <div className="flex">
              <PhWarning className="h-5 w-5 text-blue-500" weight="duotone" />
              <div className="ml-3">
                <p className="text-xs text-blue-700">
                  You have already applied for monthly leave this month. You can apply for other leave types.
                </p>
              </div>
            </div>
          </div>
        )}

        {formData["Leave Type"] !== "month" && userLeaveTypesThisMonth.includes(formData["Leave Type"]) && (
          <div className="mt-4 bg-orange-50 border-l-4 border-orange-500 p-4 rounded-r-lg">
            <div className="flex">
              <PhWarning className="h-5 w-5 text-orange-500" weight="duotone" />
              <div className="ml-3">
                <p className="text-xs text-orange-700">
                  You have already applied for {formData["Leave Type"]} leave this month.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Debug information */}
        <div className="mt-4 bg-gray-50 p-3 rounded-lg">
          <p className="text-xs text-gray-600">
            <strong>Info:</strong> Branch: {formData["Office Branch"]} |
            Existing Leave: {existingLeave ? 'Yes' : 'No'} |
            User Monthly Leaves: {userLeaveTypesThisMonth.includes("month") ? 'Yes' : 'No'}
          </p>
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
                className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                required
              >
                <option value="month">Monthly Leave</option>
                <option value="sick">Sick Leave</option>
                <option value="maternity">Maternity Leave</option>
                <option value="paternity">Paternity Leave</option>
                <option value="compassionate">Compassionate Leave</option>
                <option value="annual" disabled>Annual Leave (Disabled)</option>
              </select>
              {userLeaveTypesThisMonth.includes(formData["Leave Type"]) && (
                <p className="text-xs text-purple-500 mt-1">You've already applied for this leave type this month</p>
              )}
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Application Type</label>
              <select
                name="Application Type"
                value={formData["Application Type"]}
                onChange={handleChange}
                className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
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
                className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
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
                className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
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
                  className="h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300"
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
                  className="h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300"
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
              className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
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
                : 'bg-green-600 text-white hover:bg-green-700'
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
    switch (status.toLowerCase()) {
      case 'approved':
        return <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">Approved</span>;
      case 'rejected':
        return <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">Rejected</span>;
      case 'pending':
        return <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-800">Pending</span>;
      default:
        return <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-800">Unknown</span>;
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 flex justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-green-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center text-red-500">
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
          <div className="h-1 w-8 bg-green-500 rounded-full mr-2"></div>
          <p className="text-xs text-green-600">View the status of your leave requests</p>
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
                      {app["Reason"]}
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
                    {app["Days"]} day{app["Days"] !== 1 ? 's' : ''}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(app["Status"])}
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
        const { data, error } = await supabase
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

  // Get the next application period
  const getNextApplicationPeriod = () => {
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    let nextMonth = currentMonth;
    let nextYear = currentYear;

    if (today.getDate() > 16) {
      nextMonth = currentMonth + 1;
      if (nextMonth > 11) {
        nextMonth = 0;
        nextYear = currentYear + 1;
      }
    }

    const nextStart = new Date(nextYear, nextMonth, 13);
    const nextEnd = new Date(nextYear, nextMonth, 16);

    return {
      start: nextStart,
      end: nextEnd
    };
  };

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
        class: 'bg-green-100 text-green-800 border border-green-200',
        description: `Paid on ${new Date(app.payment_date).toLocaleDateString()}`,
        icon: '✅'
      };
    }

    // If admin approved and has payment details
    if (app.admin_approval?.toLowerCase() === 'approved' && app.mpesa_transaction_id) {
      return {
        status: 'paid',
        label: 'Paid',
        class: 'bg-green-100 text-green-800 border border-green-200',
        description: 'Payment processed',
        icon: '✅'
      };
    }

    // Admin approved but not paid yet
    if (app.admin_approval?.toLowerCase() === 'approved') {
      return {
        status: 'approved',
        label: 'Approved - Awaiting Payment',
        class: 'bg-blue-100 text-blue-800 border border-blue-200',
        description: 'Approved by admin, payment pending',
        icon: '📋'
      };
    }

    // Both managers approved
    if (app.branch_manager_approval && app.regional_manager_approval) {
      return {
        status: 'approved',
        label: 'Approved by Managers',
        class: 'bg-blue-100 text-blue-800 border border-blue-200',
        description: 'Pending admin approval',
        icon: '👥'
      };
    }

    // Regional manager approved
    if (app.regional_manager_approval) {
      return {
        status: 'pending',
        label: 'Regional Manager Approved',
        class: 'bg-purple-100 text-purple-800 border border-purple-200',
        description: 'Waiting for branch manager',
        icon: '🏢'
      };
    }

    // Branch manager approved
    if (app.branch_manager_approval) {
      return {
        status: 'pending',
        label: 'Branch Manager Approved',
        class: 'bg-purple-100 text-purple-800 border border-purple-200',
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
          class: 'bg-green-100 text-green-800 border border-green-200',
          description: 'Payment completed',
          icon: '✅'
        };
      case 'approved':
        return {
          status: 'approved',
          label: 'Approved',
          class: 'bg-blue-100 text-blue-800 border border-blue-200',
          description: 'Application approved',
          icon: '📋'
        };
      case 'rejected':
        return {
          status: 'rejected',
          label: 'Rejected',
          class: 'bg-red-100 text-red-800 border border-red-200',
          description: 'Application rejected',
          icon: '❌'
        };
      default:
        return {
          status: 'pending',
          label: 'Under Review',
          class: 'bg-yellow-100 text-yellow-800 border border-yellow-200',
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
          <div className="text-xs text-green-700 bg-green-50 p-1 rounded border border-green-200">
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
            .select('"Employee Number", "First Name", "Last Name", "Office", "Basic Salary"')
            .eq('"Work Email"', user.email)
            .single();

          if (error) throw error;

          if (data) {
            const basicSalary = data["Basic Salary"] || '0';
            setFormData(prev => ({
              ...prev,
              "Employee Number": data["Employee Number"] || '',
              "Full Name": `${data["First Name"]} ${data["Last Name"]}` || '',
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
      const { data, error } = await supabase
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
          : 'bg-green-600 hover:bg-green-700'
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
              <div className="h-1 w-8 bg-green-500 rounded-full mr-2"></div>
              <p className="text-xs text-green-600">View your salary advance applications and their current status</p>
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
              className="px-4 py-2 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 flex items-center"
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
                className="mt-4 px-4 py-2 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700"
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
  const nextPeriod = getNextApplicationPeriod();

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-gray-800">Salary Advance Application</h2>
        <div className="flex items-center mt-2">
          <div className="h-1 w-8 bg-green-500 rounded-full mr-2"></div>
          <p className="text-xs text-green-600">Submit your request for a salary advance (up to 20% of your basic salary)</p>
        </div>

        {/* Application Schedule Information */}
        <div className={`mt-3 border-l-4 p-4 rounded-r-lg ${isApplicationPeriod ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-500'}`}>
          <div className="flex">
            {isApplicationPeriod ? (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            ) : (
              <Lock className="h-5 w-5 text-red-500" />
            )}
            <div className="ml-3">
              <p className={`text-xs ${isApplicationPeriod ? 'text-green-700' : 'text-red-700'}`}>
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
          <div className="mt-4 bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg">
            <div className="flex">
              <PhWarning className="h-5 w-5 text-red-500" weight="duotone" />
              <div className="ml-3">
                <p className="text-xs text-red-700">
                  <strong>Monthly Application Limit:</strong> You have already applied for a salary advance this month.
                  Only one salary advance application is allowed per calendar month.
                </p>
                {currentMonthApplication && (
                  <p className="text-xs text-red-600 mt-1">
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
                  className={`focus:ring-green-500 focus:border-green-500 block w-full pl-10 pr-12 py-2 sm:text-xs border border-gray-300 rounded-lg ${!isApplicationPeriod || hasAppliedThisMonth ? 'bg-gray-100 cursor-not-allowed' : ''
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
                <p className="text-xs text-red-500 mt-1">
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
              className={`w-full px-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 ${!isApplicationPeriod || hasAppliedThisMonth ? 'bg-gray-100 cursor-not-allowed' : ''
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
              "Full Name": `${data["First Name"]} ${data["Last Name"]}` || '',
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
      const { data, error } = await supabase
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
        return <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">Approved</span>;
      case 'rejected':
        return <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">Rejected</span>;
      default:
        return <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-800">Pending</span>;
    }
  };

  if (view === 'list') {
    return (
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-semibold text-gray-800">Loan Applications</h2>
            <div className="flex items-center mt-2">
              <div className="h-1 w-8 bg-green-500 rounded-full mr-2"></div>
              <p className="text-xs text-green-600">View your loan application history</p>
            </div>
          </div>
          <button
            onClick={() => setView('form')}
            className="px-4 py-2 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 flex items-center"
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
                className="mt-4 px-4 py-2 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700"
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
          <div className="h-1 w-8 bg-green-500 rounded-full mr-2"></div>
          <p className="text-xs text-green-600">Submit your request for a staff loan with flexible payment terms</p>
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
                  className="focus:ring-green-500 focus:border-green-500 block w-full pl-10 pr-12 py-2 sm:text-xs border border-gray-300 rounded-lg"
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
                className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
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
                    className="h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded"
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
                        className="focus:ring-green-500 focus:border-green-500 block w-full pl-10 pr-12 py-2 sm:text-xs border border-gray-300 rounded-lg"
                        placeholder="0.00"
                        min="0"
                        step="0.01"
                      />
                    </div>
                    <p className="text-xs text-orange-600">
                      Total custom payments over {formData["Number of Months"]} months: Ksh{(parseFloat(formData["Custom Monthly Deduction"]) * formData["Number of Months"] || 0).toFixed(2)}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white p-3 rounded border">
              <h4 className="text-xs font-medium text-gray-700 mb-2">Final Monthly Deduction</h4>
              <div className="text-2xl font-bold text-green-600">
                Ksh{finalMonthlyDeduction || '0.00'}
              </div>
            </div>
          </div>

          {/* Repayment Schedule */}
          {formData["Repayment Schedule"].length > 0 && (
            <div className="bg-blue-50 p-4 rounded-lg">
              <h3 className="text-lg font-medium text-gray-800 mb-3">Repayment Schedule</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {formData["Repayment Schedule"].map((date, index) => (
                  <div key={index} className="bg-white p-3 rounded-lg shadow-sm text-center">
                    <div className="text-xs text-gray-500">Payment {index + 1}</div>
                    <div className="text-xs font-medium text-gray-900">
                      {new Date(date).toLocaleDateString()}
                    </div>
                    <div className="text-xs text-green-600">
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
              className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
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
              className={`px-4 py-2 border border-transparent rounded-lg text-xs font-medium text-white bg-green-600 hover:bg-green-700 flex items-center ${isSubmitting ? 'opacity-70 cursor-not-allowed' : ''
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

// Document Upload Form Component
const DocumentUploadForm = ({
  onUpload,
  availableTypes,
  uploading
}: {
  onUpload: (file: File, type: string) => Promise<boolean>;
  availableTypes: string[];
  uploading: boolean;
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedFile || !documentType) {
      toast.error('Please select a file and document type');
      return;
    }

    const success = await onUpload(selectedFile, documentType);
    if (success) {
      setSelectedFile(null);
      setDocumentType('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-700">Document Type</label>
          <select
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
            className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
            required
            disabled={availableTypes.length === 0}
          >
            <option value="">Select document type</option>
            {availableTypes.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          {availableTypes.length === 0 && (
            <p className="text-xs text-orange-600">All document types have been uploaded</p>
          )}
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-700">Choose File</label>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelect}
            className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
            required
          />
        </div>
      </div>

      {selectedFile && (
        <div className="bg-gray-50 p-3 rounded-lg">
          <p className="text-xs text-gray-700">
            Selected: <strong>{selectedFile.name}</strong> ({Math.round(selectedFile.size / 1024)} KB)
          </p>
        </div>
      )}

      <button
        type="submit"
        disabled={uploading || !selectedFile || !documentType || availableTypes.length === 0}
        className={`w-full px-4 py-2 border border-transparent rounded-lg text-xs font-medium text-white bg-green-600 hover:bg-green-700 flex items-center justify-center ${uploading || !selectedFile || !documentType || availableTypes.length === 0 ? 'opacity-70 cursor-not-allowed' : ''
          }`}
      >
        {uploading ? (
          <>
            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Uploading...
          </>
        ) : (
          <>
            <PhUpload className="h-4 w-4 mr-2" weight="duotone" />
            Upload Document
          </>
        )}
      </button>
    </form>
  );
};

// Enhanced DashboardHome with Payslip button
const DashboardHome = ({ setActiveTab, userName }: { setActiveTab: (tab: string) => void, userName: string }) => {
  return (
    <div className="p-4 md:p-8 space-y-10">
      {/* Welcome Section */}
      <div className="space-y-4">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <h2 className="text-3xl font-bold tracking-tight text-gray-900">
            Welcome back, <span className="text-green-600 font-extrabold italic select-none">
              {userName.split(' ')[0]}
            </span>! 👋
          </h2>
        </motion.div>

        {/* Slick Thin Line Separator */}
        <div className="h-[1px] w-full bg-gradient-to-r from-green-600 via-gray-200 to-transparent opacity-60"></div>
      </div>

      {/* Services Grid */}
      <div className="space-y-6">
        <div className="flex items-center justify-between px-2">
          <div>
            <h3 className="text-lg font-bold text-gray-900 italic">Quick Services</h3>
            <p className="text-xs text-gray-500 font-medium tracking-tight">Access your employee tools and resources</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          <PortalCard
            icon={<PhCreditCard className="w-6 h-6" weight="duotone" />}
            title="Salary Advance"
            description="Emergency financial support"
            onClick={() => setActiveTab('salary-advance')}
            color="green"
          />
          <PortalCard
            icon={<PhCoins className="w-6 h-6" weight="duotone" />}
            title="Loan Request"
            description="Affordable staff credit facilities"
            onClick={() => setActiveTab('loan')}
            color="blue"
          />
          <PortalCard
            icon={<PhReceipt className="w-6 h-6" weight="duotone" />}
            title="Payslips"
            description="Download salary breakdowns"
            onClick={() => setActiveTab('payslips')}
            color="amber"
          />
          <PortalCard
            icon={<PhChatCircleDots className="w-6 h-6" weight="duotone" />}
            title="Comm Hub"
            description="Collaborate with your team"
            onClick={() => setActiveTab('VideoConf')}
            color="purple"
          />
          <PortalCard
            icon={<PhCalendarBlank className="w-6 h-6" weight="duotone" />}
            title="Leave Request"
            description="Plan your time off"
            onClick={() => setActiveTab('leave')}
            color="cyan"
          />
          <PortalCard
            icon={<PhClockCounterClockwise className="w-6 h-6" weight="duotone" />}
            title="Leave History"
            description="Review previous applications"
            onClick={() => setActiveTab('leave-history')}
            color="indigo"
          />
          <PortalCard
            icon={<PhFile className="w-6 h-6" weight="duotone" />}
            title="Contracts"
            description="Review employment documents"
            onClick={() => setActiveTab('contract')}
            color="rose"
          />
          <PortalCard
            icon={<PhFingerprint className="w-6 h-6" weight="duotone" />}
            title="My Profile"
            description="Manage your personal info"
            onClick={() => setActiveTab('details')}
            color="green"
          />
          <PortalCard
            icon={<PhFolderOpen className="w-6 h-6" weight="duotone" />}
            title="Documents"
            description="Secure file storage"
            onClick={() => setActiveTab('documents')}
            color="blue"
          />
          <PortalCard
            icon={<PhLifebuoy className="w-6 h-6" weight="duotone" />}
            title="Report Incident"
            description="Whistleblower protection"
            onClick={() => setActiveTab('incident-report')}
            color="rose"
          />
          <PortalCard
            icon={<PhSparkle className="w-6 h-6" weight="duotone" />}
            title="Opportunities"
            description="Career growth paths"
            onClick={() => setActiveTab('job-applications')}
            color="amber"
          />
        </div>
      </div>
    </div>
  );
};

type UserProfileHeaderProps = {
  userName: string;
  setActiveTab: (tab: string) => void;
};

// UserProfileHeader Component for the header
const UserProfileHeader = ({ userName, setActiveTab }: UserProfileHeaderProps) => {
  const navigate = useNavigate();
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className="flex items-center space-x-4">
      <UserProfileDropdown
        onPasswordReset={() => setIsModalOpen(true)}
        loginStatus={{ isLoggedIn: true, lastLogin: "2025-08-21" }}
        userName={userName}
        setActiveTab={setActiveTab}
      />
      <PasswordResetModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
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
          { id: 'chat', label: 'Chat', isExternal: true, path: '/teams' },
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
    ]
  }
];

// Main StaffPortal Component with Geolocation and Time Tracking
const StaffPortal = () => {
  const [activeTab, setActiveTab] = useState('home');
  const [showResetModal, setShowResetModal] = useState(false);
  const [showGeolocationWarning, setShowGeolocationWarning] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true); // For mobile
  const [expandedMenu, setExpandedMenu] = useState<string | null>(null);
  // New Sidebar States
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

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
  const isExpanded = isHovered || !isCollapsed;

  const [loginStatus, setLoginStatus] = useState({
    isLoggedIn: false,
    lastLogin: null as string | null
  });
  const [geolocationStatus, setGeolocationStatus] = useState<'granted' | 'denied' | 'prompt'>('prompt');
  const [userName, setUserName] = useState('Staff Member');
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);
  const [notifications, setNotifications] = useState<NotificationState>({
    items: [],
    lastUpdated: null
  });
  const [showNotificationDot, setShowNotificationDot] = useState(false);
  const [notificationSidebarOpen, setNotificationSidebarOpen] = useState(false);
  const [employeeNumber, setEmployeeNumber] = useState<string>('');

  const fetchCompanyProfile = async () => {
    try {
      const { data, error } = await supabase
        .from('company_logo')
        .select('*')
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

  // Fetch notifications from warnings table
  const fetchNotifications = async () => {
    if (!employeeNumber) return;

    try {
      const { data: warnings, error } = await supabase
        .from('warnings')
        .select('*')
        .eq('employee_id', employeeNumber)
        .order('issued_at', { ascending: false });

      if (error) throw error;

      const notificationItems = (warnings || []).map(warning =>
        createNotificationItem(warning)
      );

      setNotifications(prev => ({
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

  // Check geolocation status on component mount
  useEffect(() => {
    checkGeolocationPermission();
    checkLoginStatus();
    fetchUserData();
    fetchCompanyProfile();
  }, []);

  // Auto-create login session when geolocation is granted
  useEffect(() => {
    const createLoginSession = async () => {
      if (geolocationStatus === 'granted' && !loginStatus.isLoggedIn) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user?.email) return;

          const { data: employeeData } = await supabase
            .from('employees')
            .select('"Employee Number"')
            .eq('"Work Email"', user.email)
            .single();

          if (employeeData) {
            // Check if there's already an active session
            const hasActiveSession = await checkExistingLogin(employeeData["Employee Number"]);

            if (!hasActiveSession) {
              const loggedIn = await logLoginTime(employeeData["Employee Number"]);
              if (loggedIn) {
                setLoginStatus({
                  isLoggedIn: true,
                  lastLogin: new Date().toISOString()
                });
                toast.success('Logged in successfully with location services');
              }
            } else {
              // Update the UI to reflect the existing session
              setLoginStatus({
                isLoggedIn: true,
                lastLogin: new Date().toISOString()
              });
            }
          }
        } catch (error) {
          console.error('Error creating login session:', error);
        }
      }
    };

    createLoginSession();
  }, [geolocationStatus]);

  const fetchUserData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) return;

      const { data: employeeData } = await supabase
        .from('employees')
        .select('"Employee Number", "First Name", "Last Name"')
        .eq('"Work Email"', user.email)
        .single();

      if (employeeData) {
        setUserName(`${employeeData["First Name"]} ${employeeData["Last Name"]}`);
        setEmployeeNumber(employeeData["Employee Number"]);

        // Fetch notifications after we have the employee number
        fetchNotifications();
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

  const checkGeolocationPermission = async () => {
    if (!navigator.geolocation) {
      setGeolocationStatus('denied');
      // Don't show warning - geolocation is optional
      return;
    }

    try {
      // First, try to actually get the position to verify real access
      // This is more reliable than just checking permissions API
      try {
        await getCurrentPosition();
        // If we successfully got position, geolocation is definitely granted
        setGeolocationStatus('granted');
        return;
      } catch (positionError: any) {
        // If position failed, check the error code
        if (positionError.code === 1) {
          // PERMISSION_DENIED
          setGeolocationStatus('denied');
          // Don't show warning - geolocation is optional
          return;
        }
        // For other errors (timeout, unavailable), still check permissions API
      }

      // Fallback to permissions API if position check was inconclusive
      const result = await navigator.permissions.query({ name: 'geolocation' as PermissionName });

      if (result.state === 'granted') {
        setGeolocationStatus('granted');
      } else if (result.state === 'denied') {
        setGeolocationStatus('denied');
        // Don't show warning - geolocation is optional
      } else {
        setGeolocationStatus('prompt');
        // Don't show warning - geolocation is optional
      }

      // Listen for changes in permission state
      result.onchange = () => {
        setGeolocationStatus(result.state as 'granted' | 'denied');
        if (result.state === 'granted') {
          // Re-check login status when permission is granted
          checkLoginStatus();
        }
      };
    } catch (error) {
      console.error('Error checking geolocation permission:', error);
      // If permissions API fails, try one more time to get position
      try {
        await getCurrentPosition();
        setGeolocationStatus('granted');
      } catch {
        setGeolocationStatus('denied');
        // Don't show warning - geolocation is optional
      }
    }
  };

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

      // If no active login session, create one
      if (!activeLog && geolocationStatus === 'granted') {
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

  const handleGeolocationConfirm = async () => {
    setShowGeolocationWarning(false);

    try {
      // Try to get current position to trigger permission prompt
      await getCurrentPosition();
      setGeolocationStatus('granted');

      // Log login time after permission is granted
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        const { data: employeeData } = await supabase
          .from('employees')
          .select('"Employee Number"')
          .eq('"Work Email"', user.email)
          .single();

        if (employeeData) {
          const loggedIn = await logLoginTime(employeeData["Employee Number"]);
          if (loggedIn) {
            setLoginStatus({
              isLoggedIn: true,
              lastLogin: new Date().toISOString()
            });
            toast.success('Successfully logged in with geolocation');
          }
        }
      }
    } catch (error) {
      console.error('Error getting geolocation:', error);
      setGeolocationStatus('denied');
      toast.error('Geolocation is required to log in. Please enable it in your browser settings.');
    }
  };

  const handleGeolocationToggle = async () => {
    if (geolocationStatus === 'granted') {
      // Force a complete re-check to verify geolocation is still working
      toast.info('Refreshing location status...');
      await checkGeolocationPermission();
      toast.success('Location status refreshed');
    } else {
      // If not granted, trigger the permission request
      setShowGeolocationWarning(true);
    }
  };

  const toggleMenu = (menu: string) => {
    if (expandedMenu === menu) {
      setExpandedMenu(null);
    } else {
      setExpandedMenu(menu);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 relative flex font-sans text-gray-900 transition-colors duration-300 overflow-hidden">
      {/* Dynamic Background Blobs */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-200/20 blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-sky-200/20 blur-[120px] animate-pulse" />
        <div className="absolute top-[20%] right-[10%] w-[30%] h-[30%] rounded-full bg-purple-100/20 blur-[100px]" />
      </div>

      <GeolocationWarningModal
        isOpen={showGeolocationWarning}
        onConfirm={handleGeolocationConfirm}
      />

      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* NEW SIDEBAR - Matches Main Sidebar but Green */}
      <div className={`fixed inset-y-0 left-0 z-50 md:relative md:z-0 md:flex ${sidebarOpen ? 'flex' : 'hidden md:flex'}`}>
        {/* Sidebar Container */}
        <div className="relative py-4 ml-4 min-h-screen flex items-start">
          <motion.div
            initial="expanded"
            animate={isExpanded ? "expanded" : "collapsed"}
            variants={sidebarVariants}
            className="relative flex flex-col z-20 bg-white/80 backdrop-blur-2xl shadow-xl border border-white/50 h-[95vh] rounded-[32px] overflow-hidden"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >


            {/* Mobile Close Button */}
            <button
              onClick={() => setSidebarOpen(false)}
              className="absolute top-4 right-4 p-2 text-gray-500 md:hidden"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Logo Section */}
            <div className="px-5 pt-8 pb-6 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center">
                <motion.div
                  className="w-9 h-9 rounded-xl bg-gray-900 flex items-center justify-center shadow-lg border border-gray-700 hover:scale-105 transition-transform"
                  layout
                >
                  <img src={solo} alt="Logo" className="w-5 h-5 object-contain" />
                </motion.div>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      className="ml-3"
                    >
                      <h1 className="font-bold text-lg text-gray-800 tracking-tight leading-none">
                        Staff<span className="text-green-600 font-medium">Portal</span>
                      </h1>
                      <p className="text-[10px] text-gray-400 font-medium tracking-wide mt-0.5">Employee Space</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Toggle Button (Hamburger) - Moved here for visibility */}
              <motion.button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="p-2 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900 transition-colors hidden md:block"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Menu className="w-5 h-5" />
              </motion.button>
            </div>

            {/* Navigation Area */}
            <div className="flex-1 px-3 pb-4 space-y-6 overflow-y-auto no-scrollbar scrollbar-hide">
              {staffMenuGroups.map((group) => (
                <div key={group.title}>
                  {/* Group Title */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.h3
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="px-3 mb-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest"
                      >
                        {group.title}
                      </motion.h3>
                    )}
                  </AnimatePresence>

                  {/* Items */}
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const isActive = activeTab === item.id;
                      const isMenuExpanded = expandedMenu === item.id;

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
                            className={`relative w-full flex items-center p-2 rounded-xl transition-all duration-300 group ${isActive || (item.hasSubmenu && isMenuExpanded) ? 'bg-green-50/80 text-green-600' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}
                            whileTap={{ scale: 0.98 }}
                          >
                            {/* Active Dot */}
                            {(isActive) && (
                              <motion.div layoutId="activeDot" className="absolute left-0 w-1 h-6 bg-green-500 rounded-r-full" style={{ left: '-12px' }} transition={{ type: "spring", stiffness: 300, damping: 30 }} />
                            )}

                            <div className="relative flex items-center justify-center min-w-[24px]">
                              <item.icon className={`w-[18px] h-[18px] transition-colors duration-300 ${isActive || (item.hasSubmenu && isMenuExpanded) ? 'text-green-600' : 'text-gray-400 group-hover:text-gray-600'}`} strokeWidth={isActive ? 2.5 : 2} />
                            </div>

                            <AnimatePresence>
                              {isExpanded && (
                                <>
                                  <motion.span
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -10 }}
                                    className={`ml-3 text-[13px] font-medium truncate flex-1 text-left ${isActive ? 'font-semibold' : ''}`}
                                  >
                                    {item.label}
                                  </motion.span>
                                  {item.hasSubmenu && (
                                    <ChevronRight className={`w-3 h-3 text-gray-400 transition-transform duration-200 ${isMenuExpanded ? 'rotate-90' : ''}`} />
                                  )}
                                </>
                              )}
                            </AnimatePresence>

                            {/* Tooltip for collapsed state */}
                            {!isExpanded && !isHovered && (
                              <div className="absolute left-full ml-4 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                                {item.label}
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
                                className="overflow-hidden ml-9 space-y-1 mt-1"
                              >
                                {item.submenu?.map((subItem: any) => (
                                  <button
                                    key={subItem.id}
                                    onClick={() => {
                                      if (subItem.isExternal && subItem.path) {
                                        window.location.href = subItem.path;
                                      } else {
                                        setActiveTab(subItem.id);
                                        if (window.innerWidth < 768) setSidebarOpen(false);
                                      }
                                    }}
                                    className={`w-full flex items-center p-2 rounded-lg text-xs font-medium transition-colors ${activeTab === subItem.id ? 'text-green-600 bg-green-50 font-semibold' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'}`}
                                  >
                                    <span className={`w-1.5 h-1.5 rounded-full mr-2 ${activeTab === subItem.id ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                                    {subItem.label}
                                  </button>
                                ))}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Profile Section */}
            <div className="p-4 border-t border-gray-100 mt-auto">
              <div className={`flex items-center gap-3 p-2 rounded-xl transition-colors hover:bg-gray-50 cursor-pointer ${!isExpanded ? 'justify-center' : ''}`} onClick={() => setActiveTab('details')}>
                <div className="w-8 h-8 rounded-full bg-green-50 border border-green-100 shadow-sm flex items-center justify-center overflow-hidden flex-shrink-0 text-green-600 font-bold text-xs ring-2 ring-white">
                  {userName[0]?.toUpperCase() || 'S'}
                </div>
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      className="flex-1 overflow-hidden"
                    >
                      <p className="text-sm font-semibold text-gray-700 truncate">{userName}</p>
                      <p className="text-[10px] text-gray-400 truncate">Staff Member</p>
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
        <div className="md:hidden flex items-center justify-between p-4 bg-white border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <img src={solo} alt="Logo" className="w-8 h-8" />
            <span className="font-bold text-gray-800">Staff Portal</span>
          </div>
          <button onClick={() => setSidebarOpen(true)} className="p-2 text-gray-600">
            <Menu className="w-6 h-6" />
          </button>
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
                  <div className="w-10 h-10 bg-gradient-to-br from-green-600 to-teal-700 rounded-xl flex items-center justify-center shadow-md ring-2 ring-white text-white font-bold text-lg">
                    {companyProfile?.company_name?.[0] || 'Z'}
                  </div>
                )}
              </div>
              <div className="flex flex-col">
                <h1 className="text-sm font-bold text-gray-800 group-hover:text-green-600 transition-colors">{companyProfile?.company_name || 'Staff Portal'}</h1>
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Employee Dashboard</p>
              </div>
            </div>

            {/* Right: Status & Actions */}
            <div className="flex items-center space-x-4">
              <HeaderStatus
                isLoggedIn={loginStatus.isLoggedIn}
                lastLogin={loginStatus.lastLogin}
                geolocationStatus={geolocationStatus}
                userName={userName}
                onGeolocationToggle={handleGeolocationToggle}
              />

              <div className="w-px h-6 bg-gray-200 mx-2"></div>

              <motion.button
                onClick={() => setNotificationSidebarOpen(true)}
                className="relative p-2.5 text-gray-400 hover:text-green-600 transition-colors rounded-full hover:bg-green-50/50"
                whileTap={{ scale: 0.95 }}
              >
                <Bell className="w-5 h-5 stroke-[1.5px]" />
                {unreadNotifications.length > 0 && (
                  <span className="absolute top-2 right-2.5 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white"></span>
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
        <main className="flex-1 overflow-y-auto bg-transparent p-4 pt-0 md:p-6 md:pt-0 scrollbar-hide">
          <div className="max-w-7xl mx-auto pb-10">
            {/* Warnings */}
            {!loginStatus.isLoggedIn && (
              <div className="mb-6 bg-amber-50 border-l-4 border-amber-400 p-4 rounded-r-lg shadow-sm">
                <div className="flex items-center">
                  <PhWarning className="h-5 w-5 text-amber-500 mr-3" weight="duotone" />
                  <div className=""><p className="text-xs text-amber-700 font-medium"><strong>Attendance Status:</strong> Please enable geolocation and log in to record your attendance.</p></div>
                </div>
              </div>
            )}

            {/* Content */}
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              {/* Render Active Tab */}
              {activeTab === 'home' && <DashboardHome setActiveTab={setActiveTab} userName={userName} />}
              {activeTab === 'salary-advance' && <div className="p-6"><SalaryAdvanceForm /></div>}
              {activeTab === 'biodata' && <EmployeeBioPage />}
              {activeTab === 'payslips' && <PayslipViewer />}
              {activeTab === 'loan' && <LoanRequestForm />}
              {activeTab === 'training' && <TrainingModule />}
              {activeTab === 'leave' && <LeaveApplicationForm />}
              {activeTab === 'leave-history' && <LeaveApplicationsList />}
              {activeTab === 'contract' && <ComingSoon title="Contracts" />}
              {activeTab === 'details' && <Profile />}
              {activeTab === 'documents' && <DocumentsUploadPage />}
              {activeTab === 'incident-report' && <IncidentReport />}
              {activeTab === 'job-applications' && <JobApplications />}
              {activeTab === 'chat' && <div className="relative h-screen"><ChatComponent /></div>}
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