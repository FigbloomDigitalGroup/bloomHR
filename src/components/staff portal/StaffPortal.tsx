import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Phosphor Icons - Premium icon set
import {
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
  Warning as PhWarning,
  ClipboardText as PhClipboardText,
  ListChecks as PhListChecks,
  SignOut as PhSignOut,
  Target as PhTarget,
  UsersThree as PhUsersThree,
  Buildings as PhBuildings,
  Kanban as PhKanban,
  Plant as PhPlant
} from '@phosphor-icons/react';

// Keep Lucide icons for UI elements only
import {
  X,
  ChevronRight,
  ChevronLeft,
  Trash2,
  Bell,
  Menu,
  Search,
  AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import StatusPill from '../UI/StatusPill';
import ApprovalChain from '../Approvals/ApprovalChain';
import LeaveAwaitingMe from '../Approvals/LeaveAwaitingMe';
import { ApprovalChain as ApprovalChainData, loadApprovalChains } from '../../lib/approvals';
import { fetchStaffHRNotifications, markStaffNotificationRead } from '../../hooks/useHRNotifications';
import EmailNotificationsToggle from './EmailNotificationsToggle';
import { supabase } from '../../lib/supabase';
import { loadCompanyIdentity } from '../../lib/companyProfile';
import { useNavigate } from 'react-router-dom';
import TrainingModule from './Training';
import MyKpis from '../Perfomance/kpis/MyKpis';
import Profile from './Profile';
import { ChatLayout } from '../chat/ChatLayout';
import { useOnlinePeople } from '../chat/lib/presence';
import { realChannelId } from '../chat/lib/names';
import { addIncoming, toUnreadCounts, totalUnread, type IncomingMessage, type UnreadCounts } from '../chat/lib/unread';
import StaffHome from './StaffHome';
import VideoConferenceComponent from './VideoConf';
import UserProfileDropdown from './UserProfile';
import StaffMobileHeader from './StaffMobileHeader';
import PasswordResetModal from './PasswordRestModal';
import MyDocumentsPage from '../Onboarding/MyDocumentsPage';
import Appearance from '../Settings/Appearance';
import MyContract from './MyContract';
import MyResignation from './MyResignation';
import MyOvertime from './MyOvertime';
import MyTeam from './MyTeam';
import TaskWorkspace from '../Tasks/TaskWorkspace';
import { loadMyTeam, type TeamMember } from '../../lib/myTeamApi';
import StaffCompany from './StaffCompany';
import MyApprovalChain from './MyApprovalChain';
import LeavePlanningHints from './LeavePlanningHints';
import { isCompanySection } from '../../lib/staffCompany';
import MyAbsences from './MyAbsences';
import { NO_EMPLOYEE_RECORD_MESSAGE } from '../../lib/leaveDays';
import { describeFree, useLeaveCheck } from '../../lib/leaveRules';
import { LEAVE_DOCUMENTS_BUCKET, LeaveDocumentRule, loadLeaveDocumentRules, uploadLeaveDocument } from '../../lib/leaveDocuments';
import LeaveDocuments from '../Leave/LeaveDocuments';
import OnboardingForm from '../Onboarding/OnboardingForm';
import MyFirstWeeks from '../AfterHiring/MyFirstWeeks';
import PayslipViewer from './PayslipViewer';
import EmployeeBioPage from './Bio';
import IncidentReport from './IncidentReport';
import JobApplications from './JobApplications';
import bloomMark from '../../../public/bloom-mark.png';
import FigbloomLoader from '../UI/FigbloomLoader';
import AdvanceRequest from '../SalaryAdvance/AdvanceRequest';
import LoanRequest from '../Loans/LoanRequest';
import { useBackToClose } from '../../hooks/useBackToClose';
import { useStaffPortalTab } from './useStaffPortalTab';
import MyWork from '../PieceRate/staff/MyWork';
import { useMyWorkProfile } from '../PieceRate/staff/useMyWorkProfile';

interface CompanyProfile {
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

/** hr_notifications that are for HR, not the employee */
const HR_ONLY_NOTIFICATIONS = ['contract_expiring', 'probation_expiring', 'leave_recommended', 'exit_requested', 'application_received', 'loan_requested', 'contract_signed', 'leave_exhausted', 'casual_limit', 'leave_document_overdue', 'contribution_requested'];

/** Marks an hr_notifications item ("hr-<id>") read, so it stays cleared; warnings are not stored as read. */
const persistRead = (id: string) => {
  if (id.startsWith('hr-')) void markStaffNotificationRead(Number(id.slice(3)));
};

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
  // the phone's Back closes the panel
  useBackToClose(isOpen, onClose);
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
              <button onClick={onClose} aria-label="Close notifications" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <EmailNotificationsToggle />

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

const LeaveApplicationForm = ({ onSeeCalendar }: { onSeeCalendar?: () => void }) => {
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
  // the document the leave type asks for with the application (a doctor's report...), sent with it (FIG-876)
  const [docFile, setDocFile] = useState<File | null>(null);
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

          }
        } catch (error) {
          console.error('Error fetching employee data:', error);
        }
      }
    };

    fetchEmployeeData();
  }, []);

  // The company's rules for this leave type (balance, most days per application, notice, once a month) and the days it
  // covers, as the database will count them when it is submitted (FIG-875).
  const { check, checking } = useLeaveCheck(formData["Employee Number"], formData["Leave Type"], formData["Start Date"], formData["End Date"], formData["Type"] === 'Half Day');
  const problems = check?.problems ?? [];
  const docNeededNow = !!check?.document?.name && check.document.when === 'with_application';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (problems.length) {
      toast.error(problems[0]);
      return;
    }

    setIsSubmitting(true);

    if (!formData["Employee Number"]) {
      toast.error(NO_EMPLOYEE_RECORD_MESSAGE);
      setIsSubmitting(false);
      return;
    }

    if (!check || check.days <= 0) {
      toast.error('Choose a start date, and an end date that is the same day or later');
      setIsSubmitting(false);
      return;
    }

    if (docNeededNow && !docFile) {
      toast.error(`Attach the ${check?.document?.name}`);
      setIsSubmitting(false);
      return;
    }

    if (!formData["Reason"] || formData["Reason"].trim().length < 10) {
      toast.error('Please provide a detailed reason (minimum 10 characters)');
      setIsSubmitting(false);
      return;
    }

    let uploaded: { path: string; name: string } | null = null;
    try {
      if (docFile) uploaded = await uploadLeaveDocument(docFile);
      const { error } = await supabase
        .from('leave_application')
        .insert([{
          ...(uploaded ? { document_path: uploaded.path, document_name: uploaded.name } : {}),
          "Employee Number": formData["Employee Number"],
          "name": formData["Name"],
          "Office Branch": formData["Office Branch"],
          "Leave Type": formData["Leave Type"],
          "Start Date": formData["Start Date"],
          "End Date": formData["End Date"],
          // the database works the days out again from the dates and the leave type
          "days": check.days,
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
      setDocFile(null);

    } catch (error) {
      console.error('Error submitting leave application:', error);
      if (uploaded) void supabase.storage.from(LEAVE_DOCUMENTS_BUCKET).remove([uploaded.path]);
      // the database refuses an application that breaks one of the company's leave rules, and says which
      toast.error((error as { message?: string })?.message || 'Failed to submit leave application');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Check if submit should be disabled - FIXED LOGIC
  const isSubmitDisabled = () => {
    if (isSubmitting) return true;

    if (checking || !check || problems.length > 0 || (docNeededNow && !docFile)) {
      return true;
    }

    // Basic form validation
    if (!formData["Leave Type"] || !formData["Start Date"] || !formData["End Date"] || !formData["Reason"]) {
      return true;
    }

    return false;
  };

  const restrictionMessage = problems.length ? "Can't submit yet - see above" : null;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-gray-800">Leave Application</h2>
        <div className="flex items-center mt-2">
          <div className="h-1 w-8 bg-brand rounded-full mr-2"></div>
          <p className="text-xs text-brand">
            {check && describeFree(check)
              ? `${formData["Leave Type"]}: ${describeFree(check)}${check.halfPayDays > 0 ? `. ${check.halfPayDays} of these days would be at half pay.` : ''}`
              : 'Choose the leave type and dates to see what you have left.'}
          </p>
        </div>

        {/* what stops this application, from the company's leave rules */}
        {problems.length > 0 && (
          <div className="mt-4 bg-orange-tint-alt border-l-4 border-orange-text-alt p-4 rounded-r-lg">
            <div className="flex">
              <PhWarning className="h-5 w-5 text-orange-text-alt" weight="duotone" />
              <div className="ml-3 space-y-1">
                {problems.map((p) => (
                  <p key={p} className="text-xs text-orange-text-alt">{p}</p>
                ))}
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
                min={formData["Start Date"] || undefined}
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Total Days</label>
              <input
                type="number"
                name="Days"
                value={check?.days ?? 0}
                className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg bg-gray-50"
                readOnly
              />
            </div>
          </div>

          {/* the holidays, company events and the employee's tasks around the dates (only to inform) */}
          <LeavePlanningHints
            employeeNumber={formData["Employee Number"]}
            startDate={formData["Start Date"]}
            endDate={formData["End Date"]}
            onSeeCalendar={onSeeCalendar}
          />

          {/* who it will go to, before applying (the company's approval workflow for this employee) */}
          <MyApprovalChain compact />

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

          {check?.document && (
            <div className="space-y-1 rounded-lg border border-gray-200 bg-gray-50 p-3">
              {check.document.name && (
                check.document.when === 'with_application' ? (
                  <>
                    <label className="block text-xs font-medium text-gray-700" htmlFor="leave-document">
                      {check.document.name} <span className="text-red-500">(required)</span>
                    </label>
                    <input
                      id="leave-document"
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                      onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
                      className="block w-full text-xs text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-primary"
                    />
                  </>
                ) : (
                  <p className="m-0 text-xs text-gray-700">
                    Add the {check.document.name.toLowerCase()} within {check.document.within_days} days of the leave starting (Leave History).
                  </p>
                )
              )}
              {check.document.followup_name && (
                <p className="m-0 text-xs text-gray-700">
                  Then add the {check.document.followup_name.toLowerCase()} within {check.document.followup_within_days} days of the leave starting (Leave History).
                </p>
              )}
            </div>
          )}

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
  // each application's approval chain (FIG-829): who has approved and who it is waiting on
  const [chains, setChains] = useState<Record<string, ApprovalChainData>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  // which documents each leave type asks for (FIG-876), and a reload after one is added
  const [docRules, setDocRules] = useState<LeaveDocumentRule[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    loadLeaveDocumentRules().then(setDocRules).catch((e) => console.error('Error fetching leave document rules:', e));
  }, []);

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
            loadApprovalChains('leave', (leaveData || []).map((l: any) => l.id))
              .then(setChains)
              .catch((e) => console.error('Error fetching approval chains:', e));
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
  }, [reloadKey]);

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
        <FigbloomLoader label="Loading" />
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
        <div className="text-left">
          <LeaveAwaitingMe />
        </div>
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
      <LeaveAwaitingMe />
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
                  Approvals
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Documents
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
                  <td className="px-6 py-4">
                    {chains[app.id] ? <ApprovalChain chain={chains[app.id]} compact /> : <span className="text-xs text-gray-400">-</span>}
                  </td>
                  <td className="px-6 py-4">
                    <LeaveDocuments
                      app={app}
                      rule={docRules.find((r) => r.leave_type === app["Leave Type"])}
                      canAdd
                      onChanged={() => setReloadKey((k) => k + 1)}
                    />
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
      { id: 'tasks', label: 'Tasks', icon: PhKanban },
      { id: 'my-kpis', label: 'My KPIs', icon: PhTarget },
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
          { id: 'loan', label: 'Loans' }
        ]
      },
      { id: 'payslips', label: 'Payslips', icon: PhFileText },
      { id: 'overtime', label: 'Overtime', icon: PhClock },
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
    title: "Company",
    items: [
      {
        id: 'company',
        label: 'Company',
        icon: PhBuildings,
        hasSubmenu: true,
        submenu: [
          { id: 'company-calendar', label: 'Calendar' },
          { id: 'company-organogram', label: 'Organogram' },
          { id: 'company-departments', label: 'Departments' },
          { id: 'company-approvers', label: 'Who approves my leave' }
        ]
      }
    ]
  },
  {
    title: "Personal & HR",
    items: [
      { id: 'onboarding', label: 'Onboarding', icon: PhClipboardText },
      { id: 'first-weeks', label: 'My First Weeks', icon: PhListChecks },
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
      { id: 'resignation', label: 'Resignation', icon: PhSignOut },
    ]
  }
];

// Shown only to someone who supervises at least one person (migration 20261018900000)
const myTeamGroup: MenuGroup = { title: 'My team', items: [{ id: 'my-team', label: 'My team', icon: PhUsersThree }] };
// Shown only to someone paid by work or given contract jobs (FIG-812, migration 20261020100000)
const myWorkGroup: MenuGroup = { title: 'My work', items: [{ id: 'my-work', label: 'My work', icon: PhPlant }] };

// Main StaffPortal Component with Time Tracking
const StaffPortal = () => {
  // shows this person as online in Teams on every page of the portal
  useOnlinePeople();
  // the open section is in the address (?tab=payslips), so Back, refresh and links work (useStaffPortalTab)
  const [activeTab, setActiveTab] = useStaffPortalTab();
  // a task to open when Tasks next shows (picked on the calendar)
  const [taskToOpen, setTaskToOpen] = useState<string | null>(null);
  const openTask = (taskId: string) => {
    setTaskToOpen(taskId);
    setActiveTab('tasks');
  };
  // only once: opening Tasks from the menu later starts on the list
  useEffect(() => {
    if (activeTab !== 'tasks') setTaskToOpen(null);
  }, [activeTab]);
  const [showResetModal, setShowResetModal] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false); // For mobile
  // the phone's Back closes the menu first
  useBackToClose(sidebarOpen, () => setSidebarOpen(false));
  const [expandedMenu, setExpandedMenu] = useState<string | null>(null);
  // New Sidebar States
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const sidebarVariants = {
    expanded: {
      width: 260,
      transition: { type: "spring" as const, stiffness: 300, damping: 30 }
    },
    collapsed: {
      width: 68,
      transition: { type: "spring" as const, stiffness: 300, damping: 30 }
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
  // before the user opens the Chat tab. Kept per channel, so a message read in the chat clears just its channel.
  const [unreadByChannel, setUnreadByChannel] = useState<UnreadCounts>({});
  const unreadMessageCount = totalUnread(unreadByChannel);
  const myUserIdRef = useRef<string | null>(null);
  // the people this staff member supervises: the My team section shows when there is at least one
  const [team, setTeam] = useState<TeamMember[]>([]);
  useEffect(() => {
    loadMyTeam().then(setTeam).catch((e) => console.error('Could not load your team:', e));
  }, []);
  const myWork = useMyWorkProfile();
  const showMyWork = !!myWork?.qualifies;
  const extraGroups = [...(showMyWork ? [myWorkGroup] : []), ...(team.length > 0 ? [myTeamGroup] : [])];
  const menuGroups = [staffMenuGroups[0], ...extraGroups, ...staffMenuGroups.slice(1)];

  const fetchCompanyProfile = async () => {
    try {
      // name, logo and tagline from the company profile (FIG-825)
      const data = await loadCompanyIdentity();
      if (data) {
        setCompanyProfile(data);
      }
    } catch (error) {
      console.error('Error fetching company profile:', error);
    }
  };

  // Fetch the bell's notifications from the shared hr_notifications.
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
      // everything HR, managers and payroll did that concerns them (database triggers write these, warnings
      // included; FIG-776); not the reminders meant for HR (contracts and probation ending, leave recommended)
      const hrNotifs = await fetchStaffHRNotifications(empNumber);
      const leaveItems = hrNotifs
        .filter(n => !HR_ONLY_NOTIFICATIONS.includes(n.notification_type))
        .map(n => ({
          id: `hr-${n.id}`,
          type: n.notification_type.startsWith('leave_') ? 'leave' : n.notification_type === 'warning_issued' ? 'warning' : 'update',
          title: n.title,
          message: n.message,
          timestamp: new Date(n.created_at),
          isRead: false
        }));

      const notificationItems = leaveItems.sort(
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

  // new notifications as they are written (hr_notifications is in the realtime publication)
  useEffect(() => {
    if (!employeeNumber) return;

    const hrChannel = supabase
      .channel('staff_hr_notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'hr_notifications', filter: `employee_number=eq.${employeeNumber}` },
        (payload) => {
          const n = payload.new as { notification_type?: string; title?: string };
          if (!n.notification_type || HR_ONLY_NOTIFICATIONS.includes(n.notification_type)) return;
          void fetchNotifications(employeeNumber);
          toast(n.title || 'New notification');
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(hrChannel);
    };
  }, [employeeNumber]);

  // Unread chat messages per channel, using the persisted `user_channel_states.last_read_at` (per user, per channel)
  // rather than in-memory state - a channel with no row yet is treated as fully unread (matches standard chat-app
  // behavior: you haven't opened it yet). One query for all channels (my_unread_counts, FIG-817).
  const fetchUnreadMessageCount = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return;
      myUserIdRef.current = user.id;

      const { data, error } = await supabase.rpc('my_unread_counts');
      if (error) throw error;
      setUnreadByChannel(toUnreadCounts(data as { channel_id: string; unread: number }[]));
    } catch (err) {
      console.error('Error fetching unread message count:', err);
    }
  }, []);

  // the chat read a conversation (opened it, or a message arrived while it was open): its messages are no longer unread
  const handleChatRead = useCallback((chatId: string) => {
    const channelId = realChannelId(chatId);
    setUnreadByChannel(prev => (prev[channelId] ? { ...prev, [channelId]: 0 } : prev));
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
  // updates on next page load, not live). The new row says which channel it is in: +1 there, no re-count (one message
  // in general reaches the whole company at once). Realtime only delivers messages I can read; my own do not count.
  useEffect(() => {
    const channel = supabase
      .channel('staffportal_unread_messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        setUnreadByChannel(prev => addIncoming(prev, payload.new as IncomingMessage, myUserIdRef.current));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

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
    persistRead(notification.id);
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
    notifications.items.forEach(item => persistRead(item.id));
    setNotifications(prev => ({
      ...prev,
      items: []
    }));
    setShowNotificationDot(false);
    toast.success('All notifications cleared');
  };

  // Handle remove single notification
  const handleRemoveNotification = (notificationId: string) => {
    persistRead(notificationId);
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
    <div className="min-h-screen bg-page relative flex font-sans text-gray-900 transition-colors duration-300 overflow-hidden">
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
                {menuGroups.map((group) => {
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
        <StaffMobileHeader
          userName={userName}
          hasUnread={unreadNotifications.length > 0}
          loginStatus={loginStatus}
          onOpenNotifications={() => setNotificationSidebarOpen(true)}
          onOpenMenu={() => setSidebarOpen(true)}
          onPasswordReset={() => setShowResetModal(true)}
          setActiveTab={setActiveTab}
          atHome={activeTab === 'home'}
        />

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
                <div className="m-0 mb-4 sm:m-6 sm:mb-0 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
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
              {activeTab === 'home' && <StaffHome setActiveTab={setActiveTab} userName={userName} onOpenTask={openTask} showMyWork={showMyWork} />}
              {activeTab === 'my-work' && myWork?.qualifies && <MyWork profile={myWork} />}
              {activeTab === 'salary-advance' && <AdvanceRequest />}
              {activeTab === 'onboarding' && <OnboardingForm />}
              {activeTab === 'first-weeks' && <MyFirstWeeks onOpenTraining={() => setActiveTab('training')} />}
              {activeTab === 'biodata' && <EmployeeBioPage />}
              {activeTab === 'payslips' && <PayslipViewer />}
              {activeTab === 'overtime' && <MyOvertime />}
              {activeTab === 'loan' && <LoanRequest />}
              {activeTab === 'training' && <TrainingModule />}
              {activeTab === 'tasks' && <TaskWorkspace key={taskToOpen ?? 'tasks'} mode="staff" initialOpenId={taskToOpen} />}
              {activeTab === 'my-kpis' && <MyKpis />}
              {activeTab === 'my-team' && team.length > 0 && <MyTeam team={team} />}
              {activeTab === 'leave' && <LeaveApplicationForm onSeeCalendar={() => setActiveTab('company-calendar')} />}
              {activeTab === 'leave-history' && <><LeaveApplicationsList /><MyAbsences /></>}
              {isCompanySection(activeTab) && (
                <StaffCompany section={activeTab} onSectionChange={setActiveTab} employeeNumber={employeeNumber} onOpenTask={openTask} />
              )}
              {activeTab === 'contract' && <MyContract />}
              {activeTab === 'resignation' && <MyResignation />}
              {activeTab === 'details' && <Profile />}
              {activeTab === 'documents' && <MyDocumentsPage />}
              {activeTab === 'appearance' && <Appearance />}
              {activeTab === 'incident-report' && <IncidentReport />}
              {activeTab === 'job-applications' && <JobApplications />}
              {activeTab === 'chat' && <div className="relative h-full"><ChatLayout onMessagesRead={handleChatRead} /></div>}
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