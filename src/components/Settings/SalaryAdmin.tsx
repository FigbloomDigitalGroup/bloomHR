import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import {
  CheckCircle2, XCircle, Clock, Search, ChevronDown, Send, Users,
  CheckSquare, Square, ChevronLeft, ChevronRight, UserCheck, ShieldCheck,
  Eye, AlertTriangle, Loader, CheckCircle, XCircle as XCircleIcon,
  User, UserCog, Settings, MapPin, Filter, X, Edit3, DollarSign,
  Crown, Key, Building, Map, Award, Smartphone, RefreshCw,
  Download, Upload, Calendar, Activity, TrendingUp,
  Banknote
} from 'lucide-react';
import {
  AreaChart,
  Area,
  ResponsiveContainer
} from 'recharts';
import RoleButtonWrapper from '../ProtectedRoutes/RoleButton';
import AdvanceApplicationManager from './staffSetting';
import SearchableDropdown from '../UI/SearchableDropdown';
import TransactionStatusChecker from './TransactionStatusChecker';


// SMS Service Configuration
const CELCOM_AFRICA_CONFIG = {
  baseUrl: 'https://isms.celcomafrica.com/api/services/sendsms',
  apiKey: '***REMOVED***',
  partnerID: '928',
  defaultShortcode: 'MularCredit'
};

// SMS Service Functions
// SMS Service Functions
const SMSService = {
  // Format phone number for SMS - handles all Kenyan formats
  formatPhoneNumberForSMS(phone: string | number) {
    if (!phone) {
      console.warn('Empty phone number provided');
      return '';
    }

    // Remove all non-numeric characters
    let cleaned = String(phone).replace(/\D/g, '');

    console.log('Formatting phone:', phone, '-> cleaned:', cleaned);

    // Handle different formats
    if (cleaned.startsWith('254')) {
      // Already in 254 format
      if (cleaned.length === 12) {
        return cleaned;
      } else if (cleaned.length === 13 && cleaned.startsWith('2540')) {
        // Remove extra 0: 2540712345678 -> 254712345678
        return '254' + cleaned.substring(4);
      }
    } else if (cleaned.startsWith('0')) {
      // Kenyan local format (0712345678)
      if (cleaned.length === 10) {
        return '254' + cleaned.substring(1);
      } else if (cleaned.length === 11 && cleaned.startsWith('07')) {
        // Handle 07012345678 -> 254712345678
        return '254' + cleaned.substring(2);
      }
    } else if (cleaned.startsWith('7') || cleaned.startsWith('1')) {
      // Number without prefix (712345678 or 112345678)
      if (cleaned.length === 9) {
        return '254' + cleaned;
      } else if (cleaned.length === 10 && (cleaned.startsWith('70') || cleaned.startsWith('71') || cleaned.startsWith('72') || cleaned.startsWith('11'))) {
        // Handle 0712345678 pattern
        return '254' + cleaned.substring(1);
      }
    }

    // If we reach here, the format is invalid
    console.error('Invalid phone number format:', phone, 'cleaned:', cleaned);
    return '';
  },

  // Send SMS function
  async sendSMS(phoneNumber: string | number, message: string, shortcode: string = CELCOM_AFRICA_CONFIG.defaultShortcode) {
    try {
      const formattedPhone = this.formatPhoneNumberForSMS(phoneNumber);

      if (!formattedPhone) {
        const errorMsg = `Invalid phone number format: ${phoneNumber}`;
        console.error('❌ SMS Error:', errorMsg);
        throw new Error(errorMsg);
      }

      if (!message || message.trim().length === 0) {
        throw new Error('Message cannot be empty');
      }

      const encodedMessage = encodeURIComponent(message.trim());
      const endpoint = `${CELCOM_AFRICA_CONFIG.baseUrl}/?apikey=${CELCOM_AFRICA_CONFIG.apiKey}&partnerID=${CELCOM_AFRICA_CONFIG.partnerID}&message=${encodedMessage}&shortcode=${shortcode}&mobile=${formattedPhone}`;

      console.log('🚀 Sending SMS via Celcom Africa to:', formattedPhone);

      const response: any = await fetch(endpoint, {
        method: 'GET',
        mode: 'no-cors',
      });

      console.log('✅ SMS request sent successfully to:', formattedPhone);

      // Log the SMS to database as sent
      const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      await this.logSMS(
        formattedPhone,
        message,
        'sent',
        shortcode,
        undefined,
        messageId,
        0
      );

      return {
        success: true,
        message: 'SMS sent successfully',
        messageId: messageId,
        cost: 0,
        recipient: formattedPhone
      };

    } catch (error: any) {
      console.error('❌ SMS sending error:', error);

      const formattedPhone = this.formatPhoneNumberForSMS(phoneNumber);
      if (formattedPhone) {
        await this.logSMS(
          formattedPhone,
          message,
          'failed',
          shortcode,
          error.message || 'Unknown error',
          `err-${Date.now()}`,
          0
        );
      }

      return {
        success: false,
        error: error.message,
        originalNumber: phoneNumber
      };
    }
  },

  // Log SMS to database
  async logSMS(recipientPhone: string, message: string, status: string, senderId: string, errorMessage?: string, messageId?: string, cost?: number) {
    try {
      const { error } = await supabase
        .from('sms_logs')
        .insert({
          recipient_phone: recipientPhone,
          message: message,
          status: status,
          error_message: errorMessage,
          message_id: messageId,
          sender_id: senderId,
          cost: cost
        });

      if (error) {
        console.error('Failed to log SMS:', error);
      }
    } catch (error) {
      console.error('Error logging SMS:', error);
    }
  },

  // Send disbursement notification
  async sendDisbursementNotification(employeeName: string, phoneNumber: string | number, amount: number, transactionId?: string) {
    const message = `Dear ${employeeName}, thank you for being an invaluable team member. Your salary advance of KES ${amount.toLocaleString()} is now in your M-Pesa account. We're here to support you. Keep up the great work! - Mular Credit`;

    return await this.sendSMS(phoneNumber, message);
  }
};

// Role mapping - Connect your actual roles to SalaryAdvanceAdmin roles
const ROLE_MAPPING = {
  'ADMIN': 'credit_analyst_officer',      // Full admin access
  'CHECKER': 'checker',                   // Payment approver
  'OPERATIONS': 'maker',                  // Request creator  
  'STAFF': 'maker',                       // Request creator
  'MANAGER': 'branch_manager',           // Branch manager
  'REGIONAL': 'regional_manager',        // Regional manager
  'HR': 'maker'                          // Request creator
};

// Status Badge Component for Maker-Checker
const StatusBadge = ({ status }: { status: string }) => {
  const statusConfig = {
    pending: {
      bg: 'bg-yellow-100',
      text: 'text-yellow-800',
      icon: Clock,
      label: 'Pending Approval'
    },
    approved: {
      bg: 'bg-green-100',
      text: 'text-green-800',
      icon: CheckCircle,
      label: 'Approved'
    },
    rejected: {
      bg: 'bg-red-100',
      text: 'text-red-800',
      icon: XCircleIcon,
      label: 'Rejected'
    },
    processing: {
      bg: 'bg-blue-100',
      text: 'text-blue-800',
      icon: Loader,
      label: 'Processing'
    },
    completed: {
      bg: 'bg-emerald-100',
      text: 'text-emerald-800',
      icon: CheckCircle,
      label: 'Completed'
    },
    failed: {
      bg: 'bg-red-100',
      text: 'text-red-800',
      icon: XCircleIcon,
      label: 'Failed'
    },
    'bm-recommend-current': {
      bg: 'bg-green-100',
      text: 'text-green-800',
      icon: CheckCircle,
      label: 'BM: Recommend Current'
    },
    'bm-recommend-adjusted': {
      bg: 'bg-blue-100',
      text: 'text-blue-800',
      icon: Edit3,
      label: 'BM: Recommend Adjusted'
    },
    'bm-recommend-reject': {
      bg: 'bg-red-100',
      text: 'text-red-800',
      icon: XCircleIcon,
      label: 'BM: Recommend Reject'
    },
    'rm-recommend-current': {
      bg: 'bg-green-100',
      text: 'text-green-800',
      icon: CheckCircle,
      label: 'RM: Recommend Current'
    },
    'rm-recommend-adjusted': {
      bg: 'bg-blue-100',
      text: 'text-blue-800',
      icon: Edit3,
      label: 'RM: Recommend Adjusted'
    },
    'rm-recommend-reject': {
      bg: 'bg-red-100',
      text: 'text-red-800',
      icon: XCircleIcon,
      label: 'RM: Recommend Reject'
    },
    'pending-branch-manager': {
      bg: 'bg-orange-100',
      text: 'text-orange-800',
      icon: Clock,
      label: 'Pending Branch Manager'
    },
    'pending-regional-manager': {
      bg: 'bg-yellow-100',
      text: 'text-yellow-800',
      icon: Clock,
      label: 'Pending Regional Manager'
    },
    'pending-admin': {
      bg: 'bg-purple-100',
      text: 'text-purple-800',
      icon: Clock,
      label: 'Pending Admin Approval'
    },
    'fully-approved': {
      bg: 'bg-green-100',
      text: 'text-green-800',
      icon: CheckCircle,
      label: 'Fully Approved'
    }
  };

  const config = (statusConfig as any)[status] || statusConfig.pending;
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${config.bg} ${config.text}`}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
};

// Enhanced Export Modal Component with Filter Options
const ExportModal = ({ isOpen, onClose, onExport, isLoading, filterOptions }: {
  isOpen: boolean;
  onClose: () => void;
  onExport: (config: any) => void;
  isLoading: boolean;
  filterOptions: any;
}) => {
  const [format, setFormat] = useState('excel');
  const [dateRange, setDateRange] = useState('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [exportStatus, setExportStatus] = useState('all');
  const [exportTown, setExportTown] = useState('all');
  const [exportMonth, setExportMonth] = useState('all');

  if (!isOpen) return null;

  const handleExport = () => {
    onExport({
      format,
      dateRange,
      customStartDate,
      customEndDate,
      status: exportStatus,
      town: exportTown,
      month: exportMonth
    });
  };

  const statusOptions = [
    { value: 'all', label: 'All Statuses' },
    { value: 'pending', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'paid', label: 'Paid' },
    { value: 'pending-branch-manager', label: 'Pending Branch Manager' },
    { value: 'pending-regional-manager', label: 'Pending Regional Manager' },
    { value: 'pending-admin', label: 'Pending Admin' }
  ];

  const monthOptions = [
    { value: 'all', label: 'All Months' },
    { value: '0', label: 'January' },
    { value: '1', label: 'February' },
    { value: '2', label: 'March' },
    { value: '3', label: 'April' },
    { value: '4', label: 'May' },
    { value: '5', label: 'June' },
    { value: '6', label: 'July' },
    { value: '7', label: 'August' },
    { value: '8', label: 'September' },
    { value: '9', label: 'October' },
    { value: '10', label: 'November' },
    { value: '11', label: 'December' }
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
          <Download className="h-5 w-5 text-green-600" />
          Export Salary Advances
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">
              Export Format
            </label>
            <SearchableDropdown
              options={[
                { label: 'Excel (.xlsx)', value: 'excel' },
                { label: 'CSV (.csv)', value: 'csv' }
              ]}
              value={format}
              onChange={setFormat}
              placeholder="Select Format"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">
              Date Range
            </label>
            <SearchableDropdown
              options={[
                { value: 'all', label: 'All Time' },
                { value: 'today', label: 'Today' },
                { value: 'this_week', label: 'This Week' },
                { value: 'this_month', label: 'This Month' },
                { value: 'last_month', label: 'Last Month' },
                { value: 'last_3_months', label: 'Last 3 Months' },
                { value: 'custom', label: 'Custom Range' }
              ]}
              value={dateRange}
              onChange={setDateRange}
              placeholder="Select Range"
            />
          </div>

          {dateRange === 'custom' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  Start Date
                </label>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  End Date
                </label>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">
              Status Filter
            </label>
            <SearchableDropdown
              options={statusOptions}
              value={exportStatus}
              onChange={setExportStatus}
              placeholder="Select Status"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">
              Town/Region Filter
            </label>
            <SearchableDropdown
              options={[
                { value: 'all', label: 'All Towns/Regions' },
                ...(filterOptions?.allTowns?.map(town => ({ value: town, label: town })) || [])
              ]}
              value={exportTown}
              onChange={(town: string) => setExportTown(town)}
              placeholder="Select Town"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">
              Month Filter
            </label>
            <SearchableDropdown
              options={monthOptions}
              value={exportMonth}
              onChange={setExportMonth}
              placeholder="Select Month"
            />
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
            <p className="text-xs text-blue-800">
              <strong>Exporting Columns:</strong>
            </p>
            <ul className="text-xs text-blue-700 mt-1 list-disc list-inside">
              <li>Employee Name & Number</li>
              <li>Mobile Number</li>
              <li>Branch/Region</li>
              <li>Amount Requested</li>
              <li>Status</li>
              <li>Request Date</li>
              <li>Reason for Advance</li>
              <li>Approval Status</li>
              <li>Manager Recommendations</li>
            </ul>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={isLoading}
            className="px-4 py-2 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                Exporting...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Export
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// Import Modal Component
const ImportModal = ({ isOpen, onClose, onImport, isLoading }: {
  isOpen: boolean;
  onClose: () => void;
  onImport: (file: File, type: string) => void;
  isLoading: boolean;
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [importType, setImportType] = useState('updates');

  if (!isOpen) return null;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      // Validate file type
      const validTypes = ['.csv', '.xlsx', '.xls'];
      const fileExtension = '.' + selectedFile.name.toLowerCase().split('.').pop();

      if (!validTypes.includes(fileExtension)) {
        toast.error('Please select a CSV or Excel file');
        return;
      }

      setFile(selectedFile);
    }
  };

  const handleImport = () => {
    if (!file) {
      toast.error('Please select a file');
      return;
    }

    onImport(file, importType);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
          <Upload className="h-5 w-5 text-blue-600" />
          Import Salary Advance Data
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">
              Import Type
            </label>
            <SearchableDropdown
              options={[
                { value: 'updates', label: 'Update Existing Records' },
                { value: 'new', label: 'Import New Applications' }
              ]}
              value={importType}
              onChange={setImportType}
              placeholder="Select Type"
            />
            <p className="text-xs text-gray-500 mt-1">
              {importType === 'updates'
                ? 'Update existing applications with employee number matching'
                : 'Create new salary advance applications'
              }
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">
              Select File
            </label>
            <div className="border-2 border-dashed border-gray-300 rounded-md p-4 text-center">
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileSelect}
                className="hidden"
                id="file-import"
              />
              <label
                htmlFor="file-import"
                className="cursor-pointer block"
              >
                <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <span className="text-xs text-gray-600">
                  {file ? file.name : 'Click to select CSV or Excel file'}
                </span>
                <p className="text-xs text-gray-500 mt-1">
                  Supported formats: .csv, .xlsx, .xls
                </p>
              </label>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
            <p className="text-xs text-blue-800">
              <strong>Required Columns:</strong>
            </p>
            <ul className="text-xs text-blue-700 mt-1 list-disc list-inside">
              <li>Employee (Full Name)</li>
              <li>Mobile Number</li>
              <li>Branch</li>
              <li>Amount</li>
              {importType === 'updates' && <li>Employee Number (for matching)</li>}
            </ul>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
            <p className="text-xs text-yellow-800">
              <strong>Note:</strong> For updates, include Employee Number to match existing records.
              For new applications, Employee Number will be auto-generated if not provided.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={isLoading || !file}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                Importing...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Import
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// Enhanced Filter Component
const EnhancedFilter = ({
  selectedTown,
  onTownChange,
  allTowns,
  userRole,
  userTown,
  isRegionalManager,
  selectedStatus,
  onStatusChange,
  selectedMonth,
  onMonthChange,
  selectedDateRange,
  onDateRangeChange,
  customStartDate,
  onCustomStartDateChange,
  customEndDate,
  onCustomEndDateChange
}: any) => {
  const [showFilter, setShowFilter] = useState(false);

  const statusOptions = [
    { value: 'all', label: 'All Status' },
    { value: 'pending', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'paid', label: 'Paid' },
    { value: 'pending-branch-manager', label: 'Pending Branch Manager' },
    { value: 'pending-regional-manager', label: 'Pending Regional Manager' },
    { value: 'pending-admin', label: 'Pending Admin' }
  ];

  const monthOptions = [
    { value: 'all', label: 'All Months' },
    { value: '0', label: 'January' },
    { value: '1', label: 'February' },
    { value: '2', label: 'March' },
    { value: '3', label: 'April' },
    { value: '4', label: 'May' },
    { value: '5', label: 'June' },
    { value: '6', label: 'July' },
    { value: '7', label: 'August' },
    { value: '8', label: 'September' },
    { value: '9', label: 'October' },
    { value: '10', label: 'November' },
    { value: '11', label: 'December' }
  ];

  const dateRangeOptions = [
    { value: 'all', label: 'All Time' },
    { value: 'today', label: 'Today' },
    { value: 'this_week', label: 'This Week' },
    { value: 'this_month', label: 'This Month' },
    { value: 'last_month', label: 'Last Month' },
    { value: 'last_3_months', label: 'Last 3 Months' },
    { value: 'custom', label: 'Custom Range' }
  ];

  const isBranchManager = userRole === 'branch_manager';
  const isManager = isBranchManager || isRegionalManager;

  const activeFilterCount = [
    selectedTown,
    selectedStatus !== 'all',
    selectedMonth !== 'all',
    selectedDateRange !== 'all'
  ].filter(Boolean).length;

  return (
    <div className="relative">
      <button
        onClick={() => setShowFilter(!showFilter)}
        className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50"
      >
        <Filter className="w-4 h-4" />
        Filters
        {activeFilterCount > 0 && (
          <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">
            {activeFilterCount}
          </span>
        )}
      </button>

      {showFilter && (
        <div className="absolute top-full left-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50 p-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-medium text-gray-900">
              Filter Applications
            </h3>
            <button
              onClick={() => setShowFilter(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4">
            {/* Status Filter */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-2">
                Status
              </label>
              <SearchableDropdown
                options={statusOptions}
                value={selectedStatus}
                onChange={onStatusChange}
                placeholder="Select Status"
              />
            </div>

            {/* Month Filter */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-2">
                Month
              </label>
              <SearchableDropdown
                options={monthOptions}
                value={selectedMonth}
                onChange={onMonthChange}
                placeholder="Select Month"
              />
            </div>

            {/* Date Range Filter */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-2">
                Date Range
              </label>
              <SearchableDropdown
                options={dateRangeOptions}
                value={selectedDateRange}
                onChange={onDateRangeChange}
                placeholder="Select Range"
              />
            </div>

            {/* Custom Date Range Inputs */}
            {selectedDateRange === 'custom' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => onCustomStartDateChange(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-1 focus:ring-green-500 focus:border-green-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => onCustomEndDateChange(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-1 focus:ring-green-500 focus:border-green-500"
                  />
                </div>
              </div>
            )}

            {/* Town/Region Filter */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-2">
                {isRegionalManager ? 'Region' : 'Town'}
                {isManager && <span className="text-gray-500"> (Auto-filtered)</span>}
              </label>
              <select
                value={selectedTown || ''}
                onChange={(e) => onTownChange(e.target.value)}
                disabled={isManager}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-1 focus:ring-green-500 focus:border-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">All {isRegionalManager ? 'Regions' : 'Towns'}</option>
                {allTowns.map(town => (
                  <option key={town} value={town}>
                    {town}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-between pt-2 border-t border-gray-200">
              <button
                onClick={() => {
                  onStatusChange('all');
                  onMonthChange('all');
                  onDateRangeChange('all');
                  onTownChange('');
                  onCustomStartDateChange('');
                  onCustomEndDateChange('');
                }}
                className="text-xs text-gray-600 hover:text-gray-800"
              >
                Clear All Filters
              </button>
              <button
                onClick={() => setShowFilter(false)}
                className="px-3 py-1 bg-green-600 text-white text-xs rounded-md hover:bg-green-700"
              >
                Apply Filters
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Manager Badge Component
const ManagerBadge = ({ isBranchManager, isRegionalManager }) => {
  if (!isBranchManager && !isRegionalManager) return null;

  const config = isRegionalManager ? {
    bg: 'bg-purple-100',
    text: 'text-purple-800',
    icon: Award,
    label: 'Regional Manager'
  } : {
    bg: 'bg-blue-100',
    text: 'text-blue-800',
    icon: UserCog,
    label: 'Branch Manager'
  };

  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${config.bg} ${config.text}`}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
};

// Comment Modal Component for Regional Managers
const CommentModal = ({
  isOpen,
  onClose,
  onConfirm,
  application
}) => {
  const [comment, setComment] = useState('');

  const handleConfirm = () => {
    if (!comment.trim()) {
      toast.error('Please provide a comment');
      return;
    }

    onConfirm(comment.trim());
    setComment('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-2 flex items-center gap-2">
          <Smartphone className="h-5 w-5 text-blue-600" />
          Add Comment
        </h3>

        <p className="text-sm text-gray-600 mb-4">
          Provide advisory comments for this application (Regional Manager only)
        </p>

        {application && (
          <div className="bg-gray-50 rounded-lg p-3 mb-4">
            <div className="text-xs text-gray-700">
              <div className="font-medium">{application["Full Name"]}</div>
              <div>Employee: {application["Employee Number"]}</div>
              <div>Amount: KSh {Number(application["Amount Requested"]).toLocaleString()}</div>
            </div>
          </div>
        )}

        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-700 mb-2">
            Comment <span className="text-red-500">*</span>
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Provide your advisory comments..."
            rows={4}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!comment.trim()}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Submit Comment
          </button>
        </div>
      </div>
    </div>
  );
};

// Payment Request Card Component
const PaymentRequestCard = ({ request, onApprove, onReject, onViewDetails, userRole }: {
  request: any;
  onApprove: (request: any) => void;
  onReject: (request: any) => void;
  onViewDetails: (request: any) => void;
  userRole: string;
}) => {
  const isChecker = userRole === 'checker' || userRole === 'credit_analyst_officer';
  const totalAmount = request.advances_data?.reduce((sum: number, advance: any) => sum + (advance.amount_requested || 0), 0) || 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-100 rounded-lg">
            <Users className="w-5 h-5 text-orange-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">
              Salary Advance Bulk Payment ({request.advances_data?.length || 0} advances)
            </h3>
            <p className="text-xs text-gray-600">
              Initiated by {request.created_by_email} • {new Date(request.created_at).toLocaleString()}
            </p>
          </div>
        </div>
        <StatusBadge status={request.status} />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-xs text-gray-600">Total Amount</p>
          <p className="font-bold text-lg text-green-600">KSh {totalAmount.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-xs text-gray-600">Payment Method</p>
          <p className="font-medium">M-Pesa B2C</p>
        </div>
      </div>

      {request.advances_data && (
        <div className="mb-4">
          <p className="text-xs text-gray-600 mb-2">Advances:</p>
          <div className="max-h-20 overflow-y-auto text-xs">
            {request.advances_data.slice(0, 3).map((advance, index) => (
              <div key={index} className="flex justify-between py-1">
                <span>{advance.full_name}</span>
                <span>KSh {advance.amount_requested?.toLocaleString()}</span>
              </div>
            ))}
            {request.advances_data.length > 3 && (
              <p className="text-gray-500 text-xs mt-1">
                +{request.advances_data.length - 3} more advances
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => onViewDetails(request)}
          className="flex-1 px-3 py-2 text-xs font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 flex items-center justify-center gap-2"
        >
          <Eye className="w-4 h-4" />
          View Details
        </button>

        {isChecker && request.status === 'pending' && (
          <>
            <button
              onClick={() => onApprove(request)}
              className="flex-1 px-3 py-2 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 flex items-center justify-center gap-2"
            >
              <CheckCircle className="w-4 h-4" />
              Approve
            </button>
            <button
              onClick={() => onReject(request)}
              className="flex-1 px-3 py-2 text-xs font-medium text-white bg-red-600 rounded-md hover:bg-red-700 flex items-center justify-center gap-2"
            >
              <XCircleIcon className="w-4 h-4" />
              Reject
            </button>
          </>
        )}
      </div>
    </div>
  );
};

// Payment Details Modal Component
const PaymentDetailsModal = ({ payment, isOpen, onClose, onApprove, onReject, userRole }: {
  payment: any;
  isOpen: boolean;
  onClose: () => void;
  onApprove: (payment: any) => void;
  onReject: (payment: any) => void;
  userRole: string;
}) => {
  if (!isOpen || !payment) return null;

  const isChecker = userRole === 'checker' || userRole === 'credit_analyst_officer';
  const totalAmount = payment.advances_data?.reduce((sum: number, advance: any) => sum + (advance.amount_requested || 0), 0) || 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-4xl max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-white p-6 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-900">Salary Advance Payment Request Details</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <XCircleIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6">
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-gray-600">Payment Type</p>
                <p className="font-semibold">Salary Advance Bulk Payment</p>
              </div>
              <div>
                <p className="text-xs text-gray-600">Total Amount</p>
                <p className="font-semibold text-green-600">KSh {totalAmount.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-gray-600">Status</p>
                <StatusBadge status={payment.status} />
              </div>
              <div>
                <p className="text-xs text-gray-600">Created</p>
                <p className="font-semibold">{new Date(payment.created_at).toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="mb-6">
            <h3 className="font-semibold text-gray-900 mb-2">Justification</h3>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-gray-700">{payment.justification}</p>
            </div>
          </div>

          <div className="mb-6">
            <h3 className="font-semibold text-gray-900 mb-3">Audit Trail</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-xs">
                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                <span>Payment request created by {payment.created_by_email}</span>
                <span className="text-gray-500">{new Date(payment.created_at).toLocaleString()}</span>
              </div>
              {payment.approved_by_email && (
                <div className="flex items-center gap-3 text-xs">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span>Approved by {payment.approved_by_email}</span>
                  <span className="text-gray-500">{new Date(payment.approved_at).toLocaleString()}</span>
                </div>
              )}
              {payment.rejected_by_email && (
                <div className="flex items-center gap-3 text-xs">
                  <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                  <span>Rejected by {payment.rejected_by_email}</span>
                  <span className="text-gray-500">{new Date(payment.rejected_at).toLocaleString()}</span>
                  {payment.rejection_reason && (
                    <span className="text-red-600">- {payment.rejection_reason}</span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="mb-6">
            <h3 className="font-semibold text-gray-900 mb-3">Salary Advances to be Paid</h3>

            {payment.advances_data && (
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left">Employee</th>
                      <th className="px-3 py-2 text-right">Phone Number</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 text-center">Approval Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payment.advances_data.map((advance: any, index: number) => (
                      <tr key={index} className="border-t">
                        <td className="px-3 py-2">
                          <div>
                            <p className="font-medium">{advance.full_name}</p>
                            <p className="text-gray-500 text-xs">{advance.employee_number}</p>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">{advance.mobile_number}</td>
                        <td className="px-3 py-2 text-right font-medium">KSh {advance.amount_requested?.toLocaleString()}</td>
                        <td className="px-3 py-2 text-center">
                          {advance.branch_manager_approval && advance.regional_manager_approval ? (
                            <span className="inline-flex items-center px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full">
                              Fully Approved
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded-full">
                              Pending Approval
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {isChecker && payment.status === 'pending' && (
            <div className="flex gap-3 pt-4 border-t border-gray-200">
              <button
                onClick={() => onApprove(payment)}
                className="flex-1 px-4 py-3 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 flex items-center justify-center gap-2"
              >
                <CheckCircle className="w-4 h-4" />
                Approve Payment
              </button>
              <button
                onClick={() => onReject(payment)}
                className="flex-1 px-4 py-3 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 flex items-center justify-center gap-2"
              >
                <XCircleIcon className="w-4 h-4" />
                Reject Payment
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Rejection Modal Component
const RejectionModal = ({ isOpen, onClose, onConfirm }: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) => {
  const [reason, setReason] = useState('');

  const handleConfirm = () => {
    if (reason.trim()) {
      onConfirm(reason);
      setReason('');
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
          <XCircleIcon className="h-5 w-5 text-red-600" />
          Reject Payment Request
        </h3>

        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-700 mb-2">
            Reason for rejection <span className="text-red-500">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Please provide a reason for rejecting this payment request..."
            rows={4}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
          />
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!reason.trim()}
            className="px-4 py-2 text-xs font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirm Rejection
          </button>
        </div>
      </div>
    </div>
  );
};

// Recommendation Modal Component for BM and RM
const RecommendationModal = ({
  isOpen,
  onClose,
  onConfirm,
  application,
  actionType,
  currentAmount
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: any) => void;
  application: any;
  actionType: string;
  currentAmount: number | null;
}) => {
  const [notes, setNotes] = useState('');
  const [adjustedAmount, setAdjustedAmount] = useState(currentAmount?.toString() || '');
  const [showAmountField, setShowAmountField] = useState(false);

  useEffect(() => {
    if (actionType === 'bm-recommend-adjusted' || actionType === 'rm-recommend-adjusted' || actionType === 'admin-approve-adjusted') {
      setShowAmountField(true);
      setAdjustedAmount(currentAmount?.toString() || '');
    } else {
      setShowAmountField(false);
    }
    setNotes('');
  }, [actionType, currentAmount]);

  const handleConfirm = () => {
    if (!notes.trim()) {
      toast.error('Please provide notes for your recommendation');
      return;
    }

    if (showAmountField && (!adjustedAmount || isNaN(Number(adjustedAmount)) || Number(adjustedAmount) <= 0)) {
      toast.error('Please enter a valid adjusted amount');
      return;
    }

    onConfirm({
      action: actionType,
      notes: notes.trim(),
      adjustedAmount: showAmountField ? Number(adjustedAmount) : null
    });
    setNotes('');
    setAdjustedAmount('');
    onClose();
  };

  const getActionTitle = () => {
    const titles: Record<string, string> = {
      'bm-recommend-current': 'Branch Manager - Recommend Current Amount',
      'bm-recommend-adjusted': 'Branch Manager - Recommend Adjusted Amount',
      'bm-recommend-reject': 'Branch Manager - Recommend Rejection',
      'rm-recommend-current': 'Regional Manager - Recommend Current Amount',
      'rm-recommend-adjusted': 'Regional Manager - Recommend Adjusted Amount',
      'rm-recommend-reject': 'Regional Manager - Recommend Rejection',
      'admin-approve-current': 'Admin - Approve Current Amount',
      'admin-approve-adjusted': 'Admin - Approve Adjusted Amount',
      'admin-reject': 'Admin - Reject Application'
    };
    return titles[actionType] || 'Action';
  };

  const getActionDescription = () => {
    const descriptions: Record<string, string> = {
      'bm-recommend-current': 'Recommend approval with the current requested amount.',
      'bm-recommend-adjusted': 'Recommend approval with an adjusted amount.',
      'bm-recommend-reject': 'Recommend rejection of this application.',
      'rm-recommend-current': 'Recommend approval with the current requested amount.',
      'rm-recommend-adjusted': 'Recommend approval with an adjusted amount.',
      'rm-recommend-reject': 'Recommend rejection of this application.',
      'admin-approve-current': 'Final approval with the current requested amount.',
      'admin-approve-adjusted': 'Final approval with an adjusted amount.',
      'admin-reject': 'Final rejection of this application.'
    };
    return descriptions[actionType] || '';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-2 flex items-center gap-2">
          <CheckCircle className="h-5 w-5 text-blue-600" />
          {getActionTitle()}
        </h3>

        <p className="text-sm text-gray-600 mb-4">
          {getActionDescription()}
        </p>

        {application && (
          <div className="bg-gray-50 rounded-lg p-3 mb-4">
            <div className="text-xs text-gray-700">
              <div className="font-medium">{application["Full Name"]}</div>
              <div>Employee: {application["Employee Number"]}</div>
              <div>Current Amount: KSh {Number(application["Amount Requested"]).toLocaleString()}</div>
              {application.isBranchManager && (
                <div className="text-blue-600 font-medium">Branch Manager</div>
              )}
            </div>
          </div>
        )}

        {showAmountField && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-700 mb-2">
              Adjusted Amount (KES) <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="number"
                value={adjustedAmount}
                onChange={(e) => setAdjustedAmount(e.target.value)}
                placeholder="Enter adjusted amount"
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            {currentAmount && (
              <p className="text-xs text-gray-500 mt-1">
                Current amount: KSh {Number(currentAmount).toLocaleString()}
              </p>
            )}
          </div>
        )}

        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-700 mb-2">
            Recommendation Notes <span className="text-red-500">*</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Please provide detailed notes for your recommendation..."
            rows={4}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!notes.trim() || (showAmountField && (!adjustedAmount || isNaN(Number(adjustedAmount))))}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Submit Recommendation
          </button>
        </div>
      </div>
    </div>
  );
};

// Enhanced// User Role Display Component
const UserRoleDisplay = ({ userRole, userEmail, actualRole, userTown, userRegion, isRegionalManager }: {
  userRole: string;
  userEmail: string;
  actualRole: string;
  userTown: string;
  userRegion: string;
  isRegionalManager: boolean;
}) => {
  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'credit_analyst_officer': return 'Admin';
      case 'checker': return 'Checker';
      case 'maker': return 'Maker';
      case 'branch_manager': return 'Branch Manager';
      case 'regional_manager': return 'Regional Manager';
      default: return role;
    }
  };

  const getActualRoleLabel = (role: string) => {
    return role;
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'maker': return <User className="w-4 h-4" />;
      case 'checker': return <UserCheck className="w-4 h-4" />;
      case 'credit_analyst_officer': return <Crown className="w-4 h-4" />;
      case 'branch_manager': return <Building className="w-4 h-4" />;
      case 'regional_manager': return <Map className="w-4 h-4" />;
      default: return <User className="w-4 h-4" />;
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'maker': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'checker': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'credit_analyst_officer': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'branch_manager': return 'bg-green-100 text-green-800 border-green-200';
      case 'regional_manager': return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-col items-end">
        <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium border ${getRoleColor(userRole)}`}>
          {getRoleIcon(userRole)}
          {userRole.replace(/_/g, ' ').toUpperCase()}
        </span>
        <div className="text-xs text-gray-500 mt-1">
          <div>Actual: {actualRole}</div>
          {userTown && <div>{isRegionalManager ? 'Region' : 'Town'}: {userTown}</div>}
          {userRegion && isRegionalManager && <div>Region: {userRegion}</div>}
        </div>
      </div>
    </div>
  );
};

// Town/Region Filter Component
const TownFilter = ({
  selectedTown,
  onTownChange,
  allTowns,
  userRole,
  userTown,
  isRegionalManager
}: {
  selectedTown: string;
  onTownChange: (town: string) => void;
  allTowns: string[];
  userRole: string;
  userTown: string;
  isRegionalManager: boolean;
}) => {
  const [showFilter, setShowFilter] = useState(false);

  const isBranchManager = userRole === 'branch_manager';
  const isManager = isBranchManager || isRegionalManager;

  return (
    <div className="relative">
      <button
        onClick={() => setShowFilter(!showFilter)}
        className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50"
      >
        <MapPin className="w-4 h-4" />
        {isRegionalManager ? 'Region Filter' : 'Town Filter'}
        {selectedTown && (
          <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">
            1
          </span>
        )}
      </button>

      {showFilter && (
        <div className="absolute top-full left-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-50 p-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-medium text-gray-900">
              {isRegionalManager ? 'Filter by Region' : 'Filter by Town'}
            </h3>
            <button
              onClick={() => setShowFilter(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {isManager && selectedTown && (
            <div className="mb-3 p-2 bg-blue-50 rounded-md">
              <p className="text-xs text-blue-700">
                {isRegionalManager
                  ? `Viewing applications for your region: ${selectedTown}`
                  : `Viewing applications for your town: ${selectedTown}`
                }
              </p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-2">
                {isRegionalManager ? 'Region' : 'Town'}
                {isManager && <span className="text-gray-500"> (Auto-filtered)</span>}
              </label>
              <select
                value={selectedTown || ''}
                onChange={(e) => onTownChange(e.target.value)}
                disabled={isManager}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-1 focus:ring-green-500 focus:border-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">All {isRegionalManager ? 'Regions' : 'Towns'}</option>
                {allTowns.map(town => (
                  <option key={town} value={town}>
                    {town}
                  </option>
                ))}
              </select>
              {isManager && (
                <p className="text-xs text-gray-500 mt-1">
                  Managers are automatically filtered to their assigned {isRegionalManager ? 'region' : 'town'}
                </p>
              )}
            </div>

            <div className="flex justify-between pt-2 border-t border-gray-200">
              <button
                onClick={() => {
                  onTownChange('');
                }}
                className="text-xs text-gray-600 hover:text-gray-800"
                disabled={isManager}
              >
                Clear Filter
              </button>
              <button
                onClick={() => setShowFilter(false)}
                className="px-3 py-1 bg-green-600 text-white text-xs rounded-md hover:bg-green-700"
              >
                Apply Filter
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// MpesaCallbacks Component
// MpesaCallbacks Component
// Complete MpesaCallbacks Component with Export Functionality
const MpesaCallbacks = ({ filterType = 'all' }: { filterType?: 'payments' | 'status' | 'all' }) => {
  const [callbacks, setCallbacks] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedCallback, setSelectedCallback] = useState<any>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [isExporting, setIsExporting] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [stats, setStats] = useState({
    totalPaid: 0,
    successful: 0,
    pending: 0,
    failed: 0,
    successRate: 0,
    totalPaidChange: 0,
    successfulChange: 0,
    lastMonthPaid: 0,
    trendData: [] as any[],
    pieData: [] as any[]
  });
  const [utilityBalance, setUtilityBalance] = useState(0);
  const [selectedBranch, setSelectedBranch] = useState('all');
  const [availableBranches, setAvailableBranches] = useState<string[]>([]);

  // Enhanced function to match M-Pesa transactions with employees
  const enhanceCallbackWithEmployeeData = async (callbacks: any[]) => {
    try {
      // Extract all phone numbers from callbacks
      const phoneNumbers = callbacks.map(callback => {
        // Use the phone number we already fixed!
        let phoneToUse = callback.phone_number;

        if (!phoneToUse) {
          const transactionData = extractTransactionData(callback);
          const receiverParty = transactionData?.ReceiverPartyPublicName || '';
          const match = receiverParty.match(/(?:254|0)[17]\d{8}/);
          phoneToUse = match ? match[0] : receiverParty;
        }

        // Clean phone number - remove non-digits and get last 9 digits
        return phoneToUse ? phoneToUse.replace(/\D/g, '').slice(-9) : null;
      }).filter(phone => phone && phone.length >= 9);

      // console.log('📞 Phone numbers to match:', phoneNumbers);

      if (phoneNumbers.length === 0) return callbacks;

      // Query employees table to match phone numbers
      const { data: employees, error } = await supabase
        .from('employees')
        .select('"Employee Number", "First Name", "Middle Name", "Last Name", "Mobile Number", "Town"')
        .or(phoneNumbers.map(phone =>
          `"Mobile Number".ilike.%${phone}%`
        ).join(','));

      if (error) {
        console.error('Error fetching employee data:', error);
        return callbacks;
      }

      // console.log('👥 Found employees:', employees);

      // Create a mapping of phone numbers to employee data
      const employeeMap: Record<string, any> = {};
      employees?.forEach(emp => {
        if (emp['Mobile Number']) {
          // Normalize phone number for matching
          const cleanPhone = emp['Mobile Number'].replace(/\D/g, '').slice(-9);
          // Construct full name from parts
          const fullName = [emp['First Name'], emp['Middle Name'], emp['Last Name']]
            .filter(Boolean)
            .join(' ');
          employeeMap[cleanPhone] = {
            employee_number: emp['Employee Number'],
            full_name: fullName || 'N/A',
            branch: emp['Town']  // Using Town instead of Branch
          };
        }
      });

      // Enhance callbacks with employee data
      const enhancedCallbacks = callbacks.map(callback => {
        // Use the phone number we already fixed!
        let phoneToUse = callback.phone_number;

        if (!phoneToUse) {
          const transactionData = extractTransactionData(callback);
          const receiverParty = transactionData?.ReceiverPartyPublicName || '';
          const match = receiverParty.match(/(?:254|0)[17]\d{8}/);
          phoneToUse = match ? match[0] : receiverParty;
        }

        const cleanReceiverPhone = phoneToUse ? phoneToUse.replace(/\D/g, '').slice(-9) : '';

        const employeeData = employeeMap[cleanReceiverPhone];

        // If we found employee data, use it. Otherwise keep existing data or set to N/A
        const enhancedCallback = {
          ...callback,
          full_name: employeeData?.full_name || (callback.full_name && callback.full_name !== 'N/A' ? callback.full_name : 'N/A'),
          employee_number: employeeData?.employee_number || (callback.employee_number && callback.employee_number !== 'N/A' ? callback.employee_number : 'N/A'),
          branch: employeeData?.branch || (callback.branch && callback.branch !== 'N/A' ? callback.branch : 'N/A')
        };

        return enhancedCallback;
      });

      return enhancedCallbacks;

    } catch (error: unknown) {
      console.error('Error enhancing callback data:', error);
      return callbacks;
    }
  };

  const fetchCallbacks = async () => {
    try {
      setIsLoading(true);
      console.log('🔄 Fetching M-Pesa callbacks from Supabase...');

      let query = supabase
        .from('mpesa_callbacks')
        .select('*')
        .order('callback_date', { ascending: false });

      if (filterStatus !== 'all') {
        query = query.eq('status', filterStatus);
      }

      const { data, error } = await query;

      if (error) {
        console.error('❌ Supabase Query Error:', error);
        console.error('Table: mpesa_callbacks');
        console.error('Query state:', { filterStatus, filterType });
        throw error;
      }

      // Filter in memory to avoid 404 on restricted columns
      let processedData = data || [];

      // Fix generic UAT1000000 IDs by extracting real ReceiptNo from raw_response
      processedData = processedData.map(record => {
        if (record.transaction_id === 'UAT1000000' && record.raw_response) {
          try {
            const raw = typeof record.raw_response === 'string' ? JSON.parse(record.raw_response) : record.raw_response;
            const resultObj = raw.Result || raw;
            const params = resultObj?.ResultParameters?.ResultParameter;

            if (Array.isArray(params)) {
              // 1. Find Receipt Number (Transaction ID)
              const receipt = params.find((p: any) => p.Key === 'ReceiptNo' || p.Key === 'TransactionReceipt');

              // 2. Find Phone Number
              let updatedPhone = record.phone_number;
              const phoneKeys = ['CreditPartyName', 'ReceiverPartyPublicName', 'ReceiverPartyName', 'B2CRecipientIsRegisteredCustomer'];

              for (const key of phoneKeys) {
                const param = params.find((p: any) => p.Key === key);
                if (param && param.Value) {
                  // Simpler Regex: Just find 254... or 07... (10-12 digits) anywhere
                  const match = param.Value.toString().match(/(254\d{9}|0[17]\d{8})/);
                  if (match) {
                    updatedPhone = match[0];
                    break;
                  }
                }
              }

              // 3. Find Amount (if generic N/A)
              let updatedAmount = record.amount;
              if (!updatedAmount || updatedAmount == '0' || updatedAmount == 'N/A') {
                const amountParam = params.find((p: any) => p.Key === 'Amount' || p.Key === 'TransactionAmount');
                if (amountParam && amountParam.Value) {
                  updatedAmount = amountParam.Value;
                }
              }

              // 4. Apply Updates
              if (receipt && receipt.Value) {
                return {
                  ...record,
                  transaction_id: receipt.Value,
                  phone_number: updatedPhone,
                  amount: updatedAmount
                };
              } else if (updatedPhone !== record.phone_number || updatedAmount !== record.amount) {
                return {
                  ...record,
                  phone_number: updatedPhone,
                  amount: updatedAmount
                };
              }
            }
          } catch (e) {
            console.error("❌ Error parsing UAT transaction:", e);
          }
        }
        return record;
      });
      if (filterType === 'status') {
        processedData = processedData.filter(c => String(c.result_type || '').toLowerCase().includes('status'));
      } else if (filterType === 'payments') {
        processedData = processedData.filter(c => !String(c.result_type || '').toLowerCase().includes('status'));
      }

      // console.log(`✅ Loaded ${processedData.length} M-Pesa records (client-side filtered)`);

      // Remove duplicates based on transaction_id
      const uniqueCallbacks = removeDuplicateCallbacks(processedData);
      // console.log(`🔄 Removed duplicates, showing ${uniqueCallbacks.length} unique records`);

      // Enhance callbacks with employee data
      // console.log('🔍 Enhancing callbacks with employee data...');
      const enhancedCallbacks = await enhanceCallbackWithEmployeeData(uniqueCallbacks);

      // --- ROBUST STATS CALCULATION WITH BRANCH FILTER ---

      // Helper to safely get amount
      const getAmount = (cb: any) => {
        let amount = parseFloat(cb.amount || '0');
        if (amount === 0 && cb.raw_response) {
          const txData = extractTransactionData(cb);
          amount = parseFloat(txData?.TransactionAmount || '0');
        }
        return amount;
      };

      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonth = lastMonthDate.getMonth();
      const lastMonthYear = lastMonthDate.getFullYear();

      // Apply branch filter to all callbacks for stats
      const branchFilteredCallbacks = selectedBranch === 'all'
        ? enhancedCallbacks
        : enhancedCallbacks.filter((cb: any) => cb.branch === selectedBranch);

      // 1. Total Disbursed (All Time) & Monthly Trend Data
      // More flexible success check - based on screenshot showing "Received" status
      const successfulCallbacks = branchFilteredCallbacks.filter((cb: any) => {
        const resultCode = String(cb.result_code || '').trim();
        const status = String(cb.status || '').toLowerCase().trim();

        return (
          resultCode === '0' ||
          resultCode === '00' ||
          status === 'completed' ||
          status === 'success' ||
          status === 'successful' ||
          status === 'received' || // From screenshot
          status === 'processed'
        );
      });



      // Prepare Trend Data (Last 6 Months)
      const months: Array<{ name: string; month: number; year: number; amount: number }> = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
          name: d.toLocaleString('default', { month: 'short' }),
          month: d.getMonth(),
          year: d.getFullYear(),
          amount: 0
        });
      }

      successfulCallbacks.forEach((cb: any) => {
        const cbDate = new Date(cb.callback_date || cb.created_at);
        const monthEntry = months.find(m => m.month === cbDate.getMonth() && m.year === cbDate.getFullYear());
        if (monthEntry) {
          monthEntry.amount += getAmount(cb);
        }
      });
      const trendData = months.map(m => ({ name: m.name, amount: m.amount }));

      // 2. This Month vs Last Month Metrics (with branch filter)
      const thisMonthCallbacks = branchFilteredCallbacks.filter((cb: any) => {
        const cbDate = new Date(cb.callback_date || cb.created_at);
        return cbDate.getMonth() === currentMonth && cbDate.getFullYear() === currentYear;
      });

      const lastMonthCallbacks = branchFilteredCallbacks.filter((cb: any) => {
        const cbDate = new Date(cb.callback_date || cb.created_at);
        return cbDate.getMonth() === lastMonth && cbDate.getFullYear() === lastMonthYear;
      });

      // Helper to check if transaction is successful
      const isSuccessful = (cb: any) => {
        const resultCode = String(cb.result_code || '').trim();
        const status = String(cb.status || '').toLowerCase().trim();
        return (
          resultCode === '0' || resultCode === '00' ||
          status === 'completed' || status === 'success' || status === 'successful' ||
          status === 'received' || status === 'processed'
        );
      };

      const thisMonthPaid = thisMonthCallbacks
        .filter(isSuccessful)
        .reduce((sum: number, cb: any) => sum + getAmount(cb), 0);

      const lastMonthTotalPaid = lastMonthCallbacks
        .filter(isSuccessful)
        .reduce((sum: number, cb: any) => sum + getAmount(cb), 0);

      // ALL-TIME TOTAL PAID (not just this month)
      const allTimeTotalPaid = successfulCallbacks.reduce((sum: number, cb: any) => sum + getAmount(cb), 0);

      const successful = thisMonthCallbacks.filter(isSuccessful).length;

      const lastMonthSuccessful = lastMonthCallbacks.filter(isSuccessful).length;

      const pending = thisMonthCallbacks.filter((cb: any) =>
        cb.status === 'Pending' || cb.status === 'pending'
      ).length;

      const failed = thisMonthCallbacks.filter((cb: any) =>
        cb.result_code !== '0' && cb.result_code !== 0 && cb.status !== 'Completed' && cb.status !== 'Pending' && cb.status !== 'pending'
      ).length;

      // Calculate trends
      const totalPaidChange = lastMonthTotalPaid === 0 ? 0 : ((thisMonthPaid - lastMonthTotalPaid) / lastMonthTotalPaid) * 100;
      const successfulChange = lastMonthSuccessful === 0 ? 0 : ((successful - lastMonthSuccessful) / lastMonthSuccessful) * 100;

      // Pie Chart Data (Status Breakdown)
      const pieData = [
        { name: 'Success', value: successful, color: '#10b981' }, // emerald-500
        { name: 'Pending', value: pending, color: '#f59e0b' }, // amber-500
        { name: 'Failed', value: failed, color: '#ef4444' } // red-500
      ].filter(d => d.value > 0);

      console.log('📊 M-Pesa Stats Calculated:', {
        allTimeTotalPaid,
        thisMonthPaid,
        totalCallbacks: branchFilteredCallbacks.length,
        successfulCallbacks: successfulCallbacks.length,
        thisMonthCallbacks: thisMonthCallbacks.length,
        selectedBranch
      });

      setStats({
        totalPaid: allTimeTotalPaid, // Show ALL-TIME total
        successful,
        pending,
        failed,
        successRate: thisMonthCallbacks.length > 0 ? (successful / thisMonthCallbacks.length) * 100 : 0,
        totalPaidChange,
        successfulChange,
        lastMonthPaid: lastMonthTotalPaid,
        trendData,
        pieData
      });

      // Extract utility balance from the most recent callback
      if (enhancedCallbacks.length > 0) {
        // Sort by date to get most recent
        const sortedCallbacks = [...enhancedCallbacks].sort((a: any, b: any) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );

        const mostRecent = sortedCallbacks[0];
        const transactionData = extractTransactionData(mostRecent);
        // Try to get balance from UtilityBalance or B2CUtilityAccountAvailableFunds
        const balance = parseFloat(transactionData?.UtilityBalance || transactionData?.B2CUtilityAccountAvailableFunds || '0');
        if (!isNaN(balance)) {
          setUtilityBalance(balance);
        }
      }

      // Populate available branches
      const branches = Array.from(new Set(
        enhancedCallbacks
          .map((cb: any) => cb.branch)
          .filter((branch: string) => branch && branch !== 'N/A')
      )) as string[];
      setAvailableBranches(branches.sort());

      setCallbacks(enhancedCallbacks);
      setLastRefresh(new Date());

    } catch (error: unknown) {
      console.error('❌ Error fetching M-Pesa callbacks:', error);
      toast.error('Failed to load M-Pesa callbacks');
    } finally {
      setIsLoading(false);
    }
  };

  // Function to remove duplicate callbacks based on transaction_id
  const removeDuplicateCallbacks = (callbacks: any[]) => {
    const seenTransactionIds = new Set();
    const uniqueCallbacks: any[] = [];

    callbacks.forEach(callback => {
      const transactionId = callback.transaction_id;

      if (!transactionId) {
        // Include records without transaction_id (they might be important)
        uniqueCallbacks.push(callback);
        return;
      }

      if (!seenTransactionIds.has(transactionId)) {
        seenTransactionIds.add(transactionId);
        uniqueCallbacks.push(callback);
      } else {
        console.log(`🔄 Removing duplicate transaction: ${transactionId}`);
      }
    });

    return uniqueCallbacks;
  };

  // Extract important data from raw_response
  const extractTransactionData = (callback: any) => {
    try {
      if (!callback.raw_response) return null;

      const rawResponse = typeof callback.raw_response === 'string'
        ? JSON.parse(callback.raw_response)
        : callback.raw_response;

      if (!rawResponse.Result?.ResultParameters?.ResultParameter) return null;

      const parameters = rawResponse.Result.ResultParameters.ResultParameter;
      const transactionData: Record<string, any> = {};

      parameters.forEach((param: any) => {
        if (param.Key && param.Value !== undefined) {
          transactionData[param.Key] = param.Value;
        }
      });

      return transactionData;
    } catch (error: unknown) {
      console.error('Error extracting transaction data:', error);
      return null;
    }
  };

  // Auto-refresh every 30 seconds
  useEffect(() => {
    fetchCallbacks();

    const interval = setInterval(() => {
      // console.log('🔄 Auto-refreshing M-Pesa callbacks...');
      fetchCallbacks();
    }, 300000); // Refresh every 5 minutes

    return () => clearInterval(interval);
  }, [filterStatus, filterType, selectedBranch]);

  // Manual refresh function
  const handleManualRefresh = async () => {
    await fetchCallbacks();
    toast.success('M-Pesa callbacks refreshed');
  };

  // Enhanced search filter to include Receiver Party, better employee matching, and branch filtering
  const filteredCallbacks = callbacks.filter(callback => {
    const transactionData = extractTransactionData(callback);
    const receiverParty = transactionData?.ReceiverPartyPublicName || '';

    const searchLower = searchTerm.toLowerCase();

    // Branch filter
    const branchMatch = !selectedBranch || selectedBranch === 'all' || callback.branch === selectedBranch;

    // Search filter
    const searchMatch = (
      callback.transaction_id?.toLowerCase().includes(searchLower) ||
      callback.conversation_id?.toLowerCase().includes(searchLower) ||
      callback.originator_conversation_id?.toLowerCase().includes(searchLower) ||
      callback.full_name?.toLowerCase().includes(searchLower) ||
      callback.employee_number?.toLowerCase().includes(searchLower) ||
      receiverParty.toLowerCase().includes(searchLower) || // Search in Receiver Party
      callback.result_desc?.toLowerCase().includes(searchLower) // Search in description
    );

    return branchMatch && searchMatch;
  });

  // Pagination calculations
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredCallbacks.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredCallbacks.length / itemsPerPage);

  // Change page
  const paginate = (pageNumber: number) => setCurrentPage(pageNumber);

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
      received: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Received' },
      processed: { bg: 'bg-green-100', text: 'text-green-800', label: 'Processed' },
      failed: { bg: 'bg-red-100', text: 'text-red-800', label: 'Failed' }
    };

    const config = statusConfig[status.toLowerCase()] || statusConfig.received;
    return (
      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
        {config.label}
      </span>
    );
  };

  const getResultCodeBadge = (code: number) => {
    if (code === 0) {
      return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">Success</span>;
    } else if (code === 1) {
      return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">Failed</span>;
    } else if (code === 17) {
      return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">Canceled</span>;
    } else {
      return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">Code: {code}</span>;
    }
  };

  const viewCallbackDetails = (callback: any) => {
    setSelectedCallback(callback);
    setShowDetails(true);
  };

  // Format amount with KES
  const formatAmount = (amount: number) => {
    if (!amount) return 'N/A';
    return `KSh ${amount.toLocaleString()}`;
  };

  // Export Modal Component for M-Pesa Statements
  const ExportMpesaModal = ({ isOpen, onClose, onExport, isLoading }: {
    isOpen: boolean;
    onClose: () => void;
    onExport: (config: any) => void;
    isLoading: boolean;
  }) => {
    const [format, setFormat] = useState('csv');
    const [dateRange, setDateRange] = useState('all');
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');

    if (!isOpen) return null;

    const handleExport = () => {
      onExport({
        format,
        dateRange,
        customStartDate,
        customEndDate
      });
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg max-w-md w-full p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
            <Download className="h-5 w-5 text-green-600" />
            Export M-Pesa Statements
          </h3>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-2">
                Export Format
              </label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500"
              >
                <option value="csv">CSV (.csv)</option>
                <option value="excel">Excel (.xlsx)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-2">
                Date Range
              </label>
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500"
              >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="this_week">This Week</option>
                <option value="this_month">This Month</option>
                <option value="last_month">Last Month</option>
                <option value="last_3_months">Last 3 Months</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>

            {dateRange === 'custom' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500"
                  />
                </div>
              </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
              <p className="text-xs text-blue-800">
                <strong>Exporting Columns:</strong>
              </p>
              <ul className="text-xs text-blue-700 mt-1 list-disc list-inside">
                <li>Transaction Date & Time</li>
                <li>Transaction ID & Conversation IDs</li>
                <li>Result Code & Description</li>
                <li>Transaction Amount</li>
                <li>Receiver Party Details</li>
                <li>Employee Name & Number</li>
                <li>Transaction Status</li>
                <li>Processing Timestamp</li>
              </ul>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={isLoading}
              className="px-4 py-2 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Statement
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Enhanced export function with date filtering
  const handleExportWithFilters = async (exportConfig: any) => {
    try {
      setIsExporting(true);

      let query = supabase
        .from('mpesa_callbacks')
        .select('*')
        .order('callback_date', { ascending: false });

      // Apply status filter
      if (filterStatus !== 'all') {
        query = query.eq('status', filterStatus);
      }

      // Apply date range filter
      if (exportConfig.dateRange !== 'all') {
        const today = new Date();
        let startDate = new Date();

        switch (exportConfig.dateRange) {
          case 'today':
            startDate.setHours(0, 0, 0, 0);
            break;
          case 'this_week':
            startDate.setDate(today.getDate() - today.getDay());
            startDate.setHours(0, 0, 0, 0);
            break;
          case 'this_month':
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
            break;
          case 'last_month':
            startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            break;
          case 'last_3_months':
            startDate = new Date(today.getFullYear(), today.getMonth() - 3, 1);
            break;
          case 'custom':
            if (exportConfig.customStartDate) {
              startDate = new Date(exportConfig.customStartDate);
            }
            break;
        }

        if (exportConfig.dateRange !== 'custom' || exportConfig.customStartDate) {
          query = query.gte('callback_date', startDate.toISOString());
        }

        if (exportConfig.dateRange === 'custom' && exportConfig.customEndDate) {
          const endDate = new Date(exportConfig.customEndDate);
          endDate.setHours(23, 59, 59, 999);
          query = query.lte('callback_date', endDate.toISOString());
        }
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching callbacks for export:', error);
        toast.error('Failed to fetch data for export');
        return;
      }

      // Filter in memory to avoid 404 on restricted columns
      let processedData = data || [];
      if (filterType === 'status') {
        processedData = processedData.filter(c => String(c.result_type || '').toLowerCase().includes('status'));
      } else if (filterType === 'payments') {
        processedData = processedData.filter(c => !String(c.result_type || '').toLowerCase().includes('status'));
      }
      // Enhance data with employee information
      const enhancedData = await enhanceCallbackWithEmployeeData(processedData);

      // Remove duplicates
      const uniqueCallbacks = removeDuplicateCallbacks(enhancedData);

      // Prepare data for export
      const exportData = uniqueCallbacks.map(callback => {
        const transactionData = extractTransactionData(callback);
        const transactionAmount = transactionData?.TransactionAmount || callback.amount;
        const receiverParty = transactionData?.ReceiverPartyPublicName || 'N/A';

        return {
          'Transaction Date': callback.callback_date ? new Date(callback.callback_date).toLocaleString() : 'N/A',
          'Transaction ID': callback.transaction_id || 'N/A',
          'Conversation ID': callback.conversation_id || 'N/A',
          'Originator Conversation ID': callback.originator_conversation_id || 'N/A',
          'Result Code': callback.result_code,
          'Result Description': callback.result_desc || 'N/A',
          'Transaction Amount': transactionAmount ? `KSh ${Number(transactionAmount).toLocaleString()}` : 'N/A',
          'Receiver Party': receiverParty,
          'Employee Name': callback.full_name,
          'Employee Number': callback.employee_number,
          'Status': callback.status,
          'Processed At': callback.processed_at ? new Date(callback.processed_at).toLocaleString() : 'N/A'
        };
      });

      if (exportConfig.format === 'csv') {
        // Convert to CSV
        const headers = Object.keys(exportData[0] || {});

        const csvContent = [
          headers.join(','),
          ...exportData.map(row =>
            headers.map(header => {
              const value = row[header];
              return `"${String(value || '').replace(/"/g, '""')}"`;
            }).join(',')
          )
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `mpesa_statements_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        // For Excel export - using tab-separated format
        const headers = Object.keys(exportData[0] || {});
        const excelContent = [
          headers.join('\t'),
          ...exportData.map(row =>
            headers.map(header => {
              const value = row[header];
              return String(value || '');
            }).join('\t')
          )
        ].join('\n');

        const blob = new Blob([excelContent], { type: 'application/vnd.ms-excel' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `mpesa_statements_${new Date().toISOString().split('T')[0]}.xls`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }

      toast.success(`Exported ${exportData.length} M-Pesa transactions successfully`);
      setShowExportModal(false);

    } catch (error: unknown) {
      console.error('Export error:', error);
      toast.error('Failed to export M-Pesa statements');
    } finally {
      setIsExporting(false);
    }
  };

  const checkTransactionStatus = async (transactionID: string) => {
    if (!transactionID) {
      toast.error('No Transaction ID available');
      return;
    }

    try {
      setIsCheckingStatus(true);
      const toastId = toast.loading('Checking M-Pesa transaction status...');

      // Call the external M-Pesa Service API
      const response = await fetch('https://mpesa-22p0.onrender.com/api/mpesa/check-transaction-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transactionID: transactionID,
          remarks: 'Status check from Admin Portal',
          occasion: 'AdminStatusCheck'
        }),
      });

      const result = await response.json();

      if (result.success) {
        toast.success('Status check initiated. Please wait for update.', { id: toastId });
        // Optionally trigger a refresh after a delay
        setTimeout(() => fetchCallbacks(), 5000);
      } else {
        toast.error('Failed: ' + (result.message || 'Unknown error'), { id: toastId });
      }
    } catch (error: unknown) {
      console.error('Error checking status:', error);
      toast.error('Error checking status');
    } finally {
      setIsCheckingStatus(false);
    }
  };

  // Bulk Transaction Status Check
  const checkBulkTransactionStatus = async () => {
    // Get all pending transactions
    const pendingTransactions = filteredCallbacks.filter(
      callback => callback.status?.toLowerCase() === 'pending' && callback.transaction_id
    );

    if (pendingTransactions.length === 0) {
      toast.error('No pending transactions to check');
      return;
    }

    const toastId = toast.loading(`Checking ${pendingTransactions.length} pending transactions...`);
    let successCount = 0;
    let failCount = 0;

    try {
      setIsCheckingStatus(true);

      // Process in batches to avoid overwhelming the server
      const batchSize = 5;
      for (let i = 0; i < pendingTransactions.length; i += batchSize) {
        const batch = pendingTransactions.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async (callback) => {
            try {
              const response = await fetch('https://mpesa-22p0.onrender.com/api/mpesa/check-transaction-status', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  transactionID: callback.transaction_id,
                  remarks: 'Bulk status check from Admin Portal',
                  occasion: 'BulkStatusCheck'
                }),
              });

              const result = await response.json();
              if (result.success) {
                successCount++;
              } else {
                failCount++;
              }
            } catch (error) {
              console.error(`Error checking ${callback.transaction_id}:`, error);
              failCount++;
            }
          })
        );

        // Update progress
        toast.loading(
          `Checking transactions... ${Math.min(i + batchSize, pendingTransactions.length)}/${pendingTransactions.length}`,
          { id: toastId }
        );

        // Small delay between batches
        if (i + batchSize < pendingTransactions.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Show final result
      if (failCount === 0) {
        toast.success(
          `✅ Successfully initiated status checks for ${successCount} transactions. Results will update shortly.`,
          { id: toastId, duration: 5000 }
        );
      } else {
        toast.success(
          `Completed: ${successCount} successful, ${failCount} failed`,
          { id: toastId, duration: 5000 }
        );
      }

      // Refresh after a delay to show updated statuses
      setTimeout(() => fetchCallbacks(), 10000);

    } catch (error: unknown) {
      console.error('Bulk status check error:', error);
      toast.error('Error during bulk status check', { id: toastId });
    } finally {
      setIsCheckingStatus(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <img src='M-PESA_LOGO-01.svg.png' className='w-14' alt="M-Pesa Logo" />
            {filterType === 'status' ? 'M-Pesa Transaction Status' : 'M-Pesa Callbacks'}
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Last refreshed: {lastRefresh.toLocaleTimeString()} | Auto-refreshes every 30 seconds
            {callbacks.length > 0 && ` | Showing ${filteredCallbacks.length} unique records`}
            {callbacks.length > 0 && (
              <span className="text-green-600 ml-1">
                (Duplicates removed by Transaction ID)
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by Transaction ID, Name, Employee No, Receiver Party..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="pl-10 pr-4 py-2 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 w-80"
            />
          </div>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="all">All Status</option>
            <option value="received">Received</option>
            <option value="processed">Processed</option>
            <option value="failed">Failed</option>
          </select>

          <button
            onClick={handleManualRefresh}
            className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>


      {/* Standard Clean Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">

        {/* Card 1: Total Paid (This Month) */}
        <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm relative overflow-hidden group hover:border-emerald-200 transition-all duration-300">
          <div className="flex justify-between items-start z-10 relative">
            <div>
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider">Total Paid (All-Time)</p>
              <h3 className="text-2xl font-bold text-gray-900 mt-1">
                <span className="text-xs font-medium text-gray-500 mr-1">KES</span>
                {stats.totalPaid?.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </h3>
              <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${stats.totalPaidChange >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {stats.totalPaidChange >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingUp className="w-3 h-3 rotate-180" />}
                {Math.abs(stats.totalPaidChange).toFixed(1)}% vs last month
              </div>
            </div>
            <div className="p-2 bg-emerald-50 rounded-lg">
              <Banknote className="w-6 h-6 text-emerald-600" />
            </div>
          </div>
          {/* Subtle background chart */}
          <div className="absolute bottom-0 left-0 right-0 h-12 opacity-10">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.trendData}>
                <Area type="monotone" dataKey="amount" stroke="#10b981" fill="#10b981" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Card 2: Transaction Count */}
        <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm hover:border-blue-200 transition-all duration-300">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider">Transactions</p>
              <h3 className="text-2xl font-bold text-gray-900 mt-1">
                {stats.successful} <span className="text-sm font-normal text-gray-400">/ {stats.successful + stats.failed + stats.pending}</span>
              </h3>
              <div className="flex items-center gap-2 mt-2">
                <span className={`text-xs px-2 py-0.5 rounded ${stats.successRate >= 98 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                  {stats.successRate.toFixed(1)}% Success Rate
                </span>
              </div>
            </div>
            <div className="p-2 bg-blue-50 rounded-lg">
              <Activity className="w-6 h-6 text-blue-600" />
            </div>
          </div>

          <div className="w-full bg-gray-100 rounded-full h-1.5 mt-4">
            <div
              className={`h-1.5 rounded-full ${stats.successRate >= 98 ? 'bg-emerald-500' : 'bg-amber-500'}`}
              style={{ width: `${stats.successRate}%` }}>
            </div>
          </div>
        </div>

        {/* Card 3: Pending & Failed */}
        <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm hover:border-amber-200 transition-all duration-300">
          <div className="flex justify-between items-center mb-4">
            <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider">Action Needed</p>
            <AlertTriangle className="w-5 h-5 text-amber-500" />
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600 flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-500" /> Pending
              </span>
              <span className="font-bold text-gray-900">{stats.pending}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600 flex items-center gap-2">
                <XCircleIcon className="w-4 h-4 text-red-500" /> Failed
              </span>
              <span className="font-bold text-gray-900">{stats.failed}</span>
            </div>
          </div>
        </div>

        {/* Card 4: Utility Balance */}
        <div className="bg-gradient-to-br from-[#43B02A] to-[#257C1F] rounded-xl p-5 text-white shadow-md relative overflow-hidden group border border-[#43B02A]/30">
          {/* Background decoration */}
          <div className="absolute top-0 right-0 w-40 h-40 bg-white opacity-10 rounded-full blur-3xl -mr-10 -mt-10"></div>
          <div className="absolute bottom-0 left-0 w-24 h-24 bg-black/10 opacity-20 rounded-full blur-2xl -ml-5 -mb-5"></div>

          <div className="relative z-10">
            <div className="flex justify-between items-start mb-6">
              <div>
                <p className="text-white/90 text-xs font-bold uppercase tracking-wider mb-1">Utility Balance</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-sm font-medium text-white/90">KES</span>
                  <h3 className="text-3xl font-bold tracking-tight text-white shadow-sm">
                    {utilityBalance.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </h3>
                </div>
                <div className="flex items-center mt-2 gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-[#83D36F] animate-pulse"></div>
                  <span className="text-[10px] text-white/90 font-medium">Live Balance</span>
                </div>
              </div>
              <div className="bg-white p-1.5 rounded-lg shadow-sm">
                <img
                  src="/M-PESA_LOGO-01.svg.png"
                  alt="M-Pesa"
                  className="h-8 w-auto object-contain"
                />
              </div>
            </div>

            <button
              onClick={handleManualRefresh}
              disabled={isLoading}
              className="w-full py-2.5 bg-white/20 hover:bg-white/30 backdrop-blur-md rounded-lg text-xs font-bold transition-all duration-300 flex items-center justify-center gap-2 border border-white/20 shadow-sm group-hover:shadow-md"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
              {isLoading ? 'Refreshing...' : 'Refresh Balance'}
            </button>
          </div>
        </div>

      </div>

      {/* Branch Filter & Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-end sm:items-center gap-4 mb-6 bg-gray-50 p-4 rounded-lg border border-gray-200">

        <div className="w-full sm:w-auto">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Filter by Branch</label>
          <div className="relative">
            <Building className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <select
              value={selectedBranch}
              onChange={(e) => {
                setSelectedBranch(e.target.value);
                setCurrentPage(1);
              }}
              className="pl-10 pr-8 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full sm:w-64 appearance-none shadow-sm"
            >
              <option value="all">All Branches</option>
              {availableBranches.map((branch) => (
                <option key={branch} value={branch}>{branch}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 mr-2 items-center flex gap-1">
            <TrendingUp className="w-3 h-3" />
            Real-time updates active
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-600"></div>
          <span className="ml-2 text-sm text-gray-600">Loading M-Pesa callbacks...</span>
        </div>
      ) : filteredCallbacks.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <Smartphone className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {searchTerm ? 'No matching M-Pesa callbacks found' : 'No M-Pesa callbacks found'}
          </h3>
          <p className="text-gray-600 mb-4">
            {searchTerm
              ? 'No callback results match your search criteria.'
              : 'No callback results found in the database.'
            }
          </p>
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="mt-2 px-4 py-2 text-xs bg-gray-600 text-white rounded-md hover:bg-gray-700"
            >
              Clear Search
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date & Time
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    M-Pesa Code
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Employee Details
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Phone Number
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Result
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {currentItems.map((callback) => {
                  const transactionData = extractTransactionData(callback);
                  // Prioritize the amount we already fixed in processedData
                  const transactionAmount = callback.amount || transactionData?.TransactionAmount || '0';

                  const receiverParty = transactionData?.ReceiverPartyPublicName || 'N/A';

                  // Prioritize the phone number we already fixed in processedData
                  // If not present, try to extract from receiverParty as fallback
                  let phoneNumber = callback.phone_number;

                  if (!phoneNumber || phoneNumber === 'N/A') {
                    const phoneMatch = receiverParty.match(/(?:254|0)[17]\d{8}/);
                    phoneNumber = phoneMatch ? phoneMatch[0] : (receiverParty !== 'N/A' ? receiverParty.replace(/\D/g, '').slice(-9) : 'N/A');
                  }

                  return (
                    <tr key={callback.id} className="hover:bg-gray-50">
                      {/* Date & Time */}
                      <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-900">
                        {callback.callback_date ? new Date(callback.callback_date).toLocaleString() : 'N/A'}
                      </td>

                      {/* M-Pesa Code (Transaction ID) */}
                      <td className="px-4 py-3 whitespace-nowrap text-xs font-mono text-gray-600">
                        <div className="flex items-center gap-1">
                          <span className="font-semibold text-blue-600">{callback.transaction_id || 'N/A'}</span>
                        </div>
                      </td>

                      {/* Amount */}
                      <td className="px-4 py-3 whitespace-nowrap text-xs font-bold text-emerald-600">
                        {formatAmount(transactionAmount)}
                      </td>

                      {/* Employee Details - COMPREHENSIVE */}
                      <td className="px-4 py-3 text-xs">
                        <div className="space-y-1">
                          {callback.full_name && callback.full_name !== 'N/A' ? (
                            <>
                              <div className="font-semibold text-gray-900">{callback.full_name}</div>
                              <div className="text-gray-600">
                                <span className="font-medium">Emp #:</span> {callback.employee_number || 'N/A'}
                              </div>
                              <div className="text-gray-600">
                                <span className="font-medium">Branch:</span> {callback.branch || 'N/A'}
                              </div>
                            </>
                          ) : (
                            <div className="text-amber-600 font-medium">⚠️ Not Matched</div>
                          )}
                        </div>
                      </td>

                      {/* Phone Number */}
                      <td className="px-4 py-3 whitespace-nowrap text-xs font-mono text-gray-700">
                        {phoneNumber || 'N/A'}
                      </td>

                      {/* Result Code */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {getResultCodeBadge(callback.result_code)}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {getStatusBadge(callback.status)}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 whitespace-nowrap text-xs">
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => viewCallbackDetails(callback)}
                            className="text-blue-600 hover:text-blue-900 font-medium text-left"
                          >
                            View Details
                          </button>
                          {callback.transaction_id && (
                            <button
                              onClick={() => checkTransactionStatus(callback.transaction_id)}
                              disabled={isCheckingStatus}
                              className="text-green-600 hover:text-green-900 font-medium text-left flex items-center gap-1"
                              title="Query M-Pesa for live status"
                            >
                              <RefreshCw className={`w-3 h-3 ${isCheckingStatus ? 'animate-spin' : ''}`} />
                              Check Status
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 px-4 py-3 border-t border-gray-200">
              <div className="flex justify-between flex-1 sm:hidden">
                <button
                  onClick={() => paginate(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="relative inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => paginate(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="relative inline-flex items-center px-4 py-2 ml-3 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
              <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-gray-700">
                    Showing <span className="font-medium">{indexOfFirstItem + 1}</span> to{' '}
                    <span className="font-medium">
                      {Math.min(indexOfLastItem, filteredCallbacks.length)}
                    </span>{' '}
                    of <span className="font-medium">{filteredCallbacks.length}</span> unique records
                  </p>
                </div>
                <div>
                  <nav className="inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
                    <button
                      onClick={() => paginate(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="relative inline-flex items-center px-2 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-l-md hover:bg-gray-50 disabled:opacity-50"
                    >
                      <span className="sr-only">Previous</span>
                      <ChevronLeft className="h-5 w-5" />
                    </button>

                    {/* Page numbers */}
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter(page => {
                        // Show first, last, and pages around current page
                        if (page === 1 || page === totalPages) return true;
                        if (page >= currentPage - 1 && page <= currentPage + 1) return true;
                        return false;
                      })
                      .map((page, index, array) => {
                        // Add ellipsis for gaps
                        const showEllipsis = index > 0 && page - array[index - 1] > 1;
                        return (
                          <div key={page} className="flex">
                            {showEllipsis && (
                              <span className="relative inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300">
                                ...
                              </span>
                            )}
                            <button
                              onClick={() => paginate(page)}
                              className={`relative inline-flex items-center px-4 py-2 text-sm font-medium ${currentPage === page
                                ? 'z-10 bg-blue-50 border-blue-500 text-blue-600'
                                : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                                } border`}
                            >
                              {page}
                            </button>
                          </div>
                        );
                      })}

                    <button
                      onClick={() => paginate(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="relative inline-flex items-center px-2 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-r-md hover:bg-gray-50 disabled:opacity-50"
                    >
                      <span className="sr-only">Next</span>
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </nav>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Enhanced Callback Details Modal */}
      {showDetails && selectedCallback && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-4xl max-h-[90vh] overflow-auto">
            <div className="sticky top-0 bg-white p-6 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-xl font-semibold text-gray-900">Callback Details</h2>
              <button
                onClick={() => setShowDetails(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                <div>
                  <p className="text-xs text-gray-600">Date & Time</p>
                  <p className="font-semibold text-sm">
                    {selectedCallback.callback_date ? new Date(selectedCallback.callback_date).toLocaleString() : 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600">Status</p>
                  <div className="mt-1">{getStatusBadge(selectedCallback.status)}</div>
                </div>
                <div>
                  <p className="text-xs text-gray-600">Result Code</p>
                  <div className="mt-1">{getResultCodeBadge(selectedCallback.result_code)}</div>
                </div>
                <div>
                  <p className="text-xs text-gray-600">Transaction ID</p>
                  <p className="font-mono font-semibold text-sm">{selectedCallback.transaction_id || 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600">Conversation ID</p>
                  <p className="font-mono text-sm">{selectedCallback.conversation_id || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600">Originator Conversation ID</p>
                  <p className="font-mono text-sm">{selectedCallback.originator_conversation_id || 'N/A'}</p>
                </div>
              </div>

              {/* Enhanced Employee Information Section */}
              <div className="mb-6">
                <h3 className="font-semibold text-gray-900 mb-3">Employee Information</h3>
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-gray-600">Employee Name</p>
                      <p className={`font-semibold text-sm ${selectedCallback.full_name !== 'N/A' ? 'text-blue-600' : 'text-gray-500'
                        }`}>
                        {selectedCallback.full_name}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600">Employee Number</p>
                      <p className={`font-semibold text-sm ${selectedCallback.employee_number !== 'N/A' ? 'text-green-600' : 'text-gray-500'
                        }`}>
                        {selectedCallback.employee_number}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Enhanced Transaction Details from Raw Response */}
              <div className="mb-6">
                <h3 className="font-semibold text-gray-900 mb-3">Transaction Details</h3>
                {(() => {
                  const transactionData = extractTransactionData(selectedCallback);
                  if (!transactionData) {
                    return <p className="text-gray-500 text-sm">No transaction data available</p>;
                  }

                  const importantFields: Record<string, string> = {
                    'TransactionAmount': 'Transaction Amount',
                    'TransactionReceipt': 'Transaction Receipt',
                    'ReceiverPartyPublicName': 'Receiver Party',
                    'TransactionCompletedDateTime': 'Completed Date Time',
                    'B2CUtilityAccountAvailableFunds': 'Utility Account Funds',
                    'B2CWorkingAccountAvailableFunds': 'Working Account Funds',
                    'B2CRecipientIsRegisteredCustomer': 'Recipient Registered',
                    'B2CChargesPaidAccountAvailableFunds': 'Charges Paid Funds'
                  };

                  return (
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {Object.entries(importantFields).map(([key, label]) => {
                          if (transactionData[key] !== undefined) {
                            return (
                              <div key={key}>
                                <p className="text-xs text-gray-600">{label}</p>
                                <p className={`font-semibold text-sm mt-1 ${key === 'ReceiverPartyPublicName' ? 'text-green-600 font-bold' :
                                  key.includes('Amount') || key.includes('Funds') ? 'text-blue-600' :
                                    'text-gray-900'
                                  }`}>
                                  {key.includes('Amount') || key.includes('Funds')
                                    ? formatAmount(Number(transactionData[key]))
                                    : String(transactionData[key])
                                  }
                                </p>
                              </div>
                            );
                          }
                          return null;
                        }).filter(Boolean)}
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="mb-4">
                <h3 className="font-semibold text-gray-900 mb-2">Raw Response Data</h3>
                <pre className="bg-gray-50 rounded-lg p-4 text-xs overflow-auto max-h-60">
                  {JSON.stringify(selectedCallback.raw_response, null, 2)}
                </pre>
              </div>

              <div className="flex justify-end pt-4 border-t border-gray-200">
                <button
                  onClick={() => checkTransactionStatus(selectedCallback.transaction_id)}
                  disabled={isCheckingStatus}
                  className="mr-3 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {isCheckingStatus ? 'Checking...' : 'Check Live Status'}
                </button>
                <button
                  onClick={() => setShowDetails(false)}
                  className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      <ExportMpesaModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        onExport={handleExportWithFilters}
        isLoading={isExporting}
      />
    </div>
  );
};

// Enhanced Bulk Payment Modal with Search
const BulkPaymentModal = ({
  isOpen,
  onClose,
  onProcess,
  isLoading,
  applications,
  selectedStaff,
  onToggleStaff,
  onSelectAll,
  onDeselectAll,
  employeeMobileNumbers,
  isBranchManagerMap,
  justification,
  onJustificationChange,
  userRole
}: {
  isOpen: boolean;
  onClose: () => void;
  onProcess: () => void;
  isLoading: boolean;
  applications: any[];
  selectedStaff: Record<string, boolean>;
  onToggleStaff: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  employeeMobileNumbers: Record<string, string>;
  isBranchManagerMap: Record<string, boolean>;
  justification: string;
  onJustificationChange: (justification: string) => void;
  userRole: string;
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);

  if (!isOpen) return null;

  const isMaker = userRole === 'maker';

  // Helper function to safely parse date from application (Robust version)
  const parseApplicationDate = (app: any): Date => {
    const dateValue = app.time_added || app.created_at || app.application_date;
    if (!dateValue) return new Date();
    let parsedDate = new Date(dateValue);
    if (isNaN(parsedDate.getTime()) || parsedDate.getFullYear() < 2020) {
      return new Date();
    }
    return parsedDate;
  };

  // Helper to check if application is from current month
  const isCurrentMonth = (app: any) => {
    const appDate = parseApplicationDate(app);
    const now = new Date();
    return appDate.getMonth() === now.getMonth() && appDate.getFullYear() === now.getFullYear();
  };

  const fullyApprovedApplications = applications.filter(app =>
    app.status?.toLowerCase() === 'approved' && isCurrentMonth(app)
  );

  const filteredApplications = fullyApprovedApplications.filter(app => {
    const matchesSearch =
      app["Full Name"]?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      app["Employee Number"]?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      employeeMobileNumbers[app["Employee Number"]]?.includes(searchTerm);

    if (showSelectedOnly) {
      return matchesSearch && selectedStaff[app.id];
    }

    return matchesSearch;
  });

  const calculateTotalAmount = () => {
    return fullyApprovedApplications.reduce((total, app) => {
      if (selectedStaff[app.id]) {
        return total + Number(app["Amount Requested"] || 0);
      }
      return total;
    }, 0);
  };

  const getSelectedStaffCount = () => {
    return fullyApprovedApplications.filter(app => selectedStaff[app.id]).length;
  };

  const formatKES = (amount: number) => {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: 'KES',
      minimumFractionDigits: 2
    }).format(amount);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-4xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
          <Users className="h-5 w-5 text-green-600" />
          {isMaker ? 'Create Payment Request' : 'Process M-Pesa Bulk Payment'}
        </h3>

        <div className="mb-4 p-3 bg-gray-50 rounded-md">
          <p className="text-xs text-gray-600">
            {isMaker
              ? `You are creating a payment request for ${getSelectedStaffCount()} selected staff members. This will require approval before processing.`
              : `You are about to process M-Pesa B2C payments for ${getSelectedStaffCount()} selected staff members.`
            }
          </p>

          <div className="mt-3 flex gap-2">
            <button
              onClick={onSelectAll}
              className="text-xs bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded"
            >
              Select All
            </button>
            <button
              onClick={onDeselectAll}
              className="text-xs bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded"
            >
              Deselect All
            </button>
          </div>

          <div className="mt-3 border-t pt-3">
            <div className="flex justify-between text-xs">
              <span className="font-medium">Total Amount:</span>
              <span className="font-bold text-green-700">{formatKES(calculateTotalAmount())}</span>
            </div>
          </div>

          {/* Current Month Notice */}
          <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded">
            <p className="text-xs text-amber-800">
              <strong>Note:</strong> Only applications from {new Date().toLocaleString('default', { month: 'long', year: 'numeric' })} are shown and can be processed.
            </p>
          </div>
        </div>

        {/* Search Bar */}
        <div className="mb-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search employees by name, employee number, or phone..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500"
              />
            </div>
            <button
              onClick={() => setShowSelectedOnly(!showSelectedOnly)}
              title={showSelectedOnly ? "Show all staff" : "Show only selected staff"}
              className={`px-3 py-2 text-xs border rounded-md whitespace-nowrap transition-colors ${showSelectedOnly
                ? 'bg-green-50 border-green-200 text-green-700 font-medium'
                : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
            >
              {showSelectedOnly ? 'Show All' : `Show Selected (${getSelectedStaffCount()})`}
            </button>
          </div>
        </div>

        {/* Justification field - required for all roles */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-700 mb-2">
            {isMaker ? 'Justification for Payment Request' : 'Payment Notes'} <span className="text-red-500">*</span>
          </label>
          <textarea
            value={justification}
            onChange={(e) => onJustificationChange(e.target.value)}
            placeholder={
              isMaker
                ? "Please provide justification for this payment request..."
                : "Please provide notes for this payment processing..."
            }
            rows={3}
            className="w-full p-3 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500"
          />
          <p className="text-xs text-gray-500 mt-1">
            {isMaker
              ? 'This payment request will be submitted for approval before processing.'
              : 'These notes will be recorded in the payment history.'
            }
          </p>
        </div>

        <div className="mb-4 max-h-60 overflow-y-auto">
          <div className="flex justify-between items-center mb-2">
            <p className="text-xs font-medium">Staff to be paid ({filteredApplications.length} found):</p>
            {getSelectedStaffCount() > filteredApplications.filter(app => selectedStaff[app.id]).length && (
              <span className="text-xs text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                Warning: {getSelectedStaffCount() - filteredApplications.filter(app => selectedStaff[app.id]).length} selected staff hidden by filter
              </span>
            )}
          </div>
          <ul className="text-xs divide-y divide-gray-200">
            {filteredApplications.map((app: any) => {
              const isFromCurrentMonth = isCurrentMonth(app);
              return (
                <li key={app.id} className={`py-2 flex items-center justify-between ${!isFromCurrentMonth ? 'opacity-50 pointer-events-none' : ''}`}>
                  <div className="flex items-center">
                    <button
                      onClick={() => onToggleStaff(app.id)}
                      className="mr-2 text-green-600 hover:text-green-800"
                      disabled={!isFromCurrentMonth}
                    >
                      {selectedStaff[app.id] ? (
                        <CheckSquare className="h-5 w-5" />
                      ) : (
                        <Square className="h-5 w-5" />
                      )}
                    </button>
                    <div className="flex items-center gap-2">
                      <div>
                        <div className={selectedStaff[app.id] ? "font-medium" : "text-gray-500"}>
                          {app["Full Name"]}
                          {!isFromCurrentMonth && <span className="ml-2 text-xs text-red-500">(Not current month)</span>}
                        </div>
                        <div className="text-xs text-gray-500">
                          {employeeMobileNumbers[app["Employee Number"]] || 'No mobile number'}
                        </div>
                      </div>
                      <ManagerBadge
                        isBranchManager={isBranchManagerMap[app["Employee Number"]] || false}
                        isRegionalManager={false}
                      />
                    </div>
                  </div>
                  <span className={selectedStaff[app.id] ? "font-medium" : "text-gray-500"}>
                    {formatKES(Number(app["Amount Requested"]))}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            onClick={onProcess}
            className="px-4 py-2 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 flex items-center gap-2"
            disabled={isLoading || getSelectedStaffCount() === 0 || !justification.trim()}
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                Processing...
              </>
            ) : (
              <>
                <Send size={16} />
                {isMaker
                  ? `Submit Request (${getSelectedStaffCount()})`
                  : `Process Payments (${getSelectedStaffCount()})`
                }
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

interface SalaryAdvanceAdminProps {
  selectedTown: string;
  selectedRegion: string;
  allTowns: string[];
  regions: string[];
  onTownChange?: (town: string) => void;
  onRegionChange?: (region: string) => void;
}

// MAIN COMPONENT - SalaryAdvanceAdmin
const SalaryAdvanceAdmin: React.FC<SalaryAdvanceAdminProps> = ({
  selectedTown,
  selectedRegion,
  allTowns: propAllTowns,
  regions,
  onTownChange
}) => {
  const [applications, setApplications] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedAmount, setEditedAmount] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [showNotesDropdown, setShowNotesDropdown] = useState<string | null>(null);
  const [showBulkPaymentModal, setShowBulkPaymentModal] = useState(false);
  const [isProcessingBulkPayment, setIsProcessingBulkPayment] = useState(false);
  const [employeeMobileNumbers, setEmployeeMobileNumbers] = useState<Record<string, string>>({});
  const [selectedStaff, setSelectedStaff] = useState<Record<string, boolean>>({});
  const [justification, setJustification] = useState('');


  const [allTownsState, setAllTownsState] = useState<string[]>([]);
  const [userTown, setUserTown] = useState<string>('');
  const [userRegion, setUserRegion] = useState<string>('');
  const [areaTownMapping, setAreaTownMapping] = useState<Record<string, string[]>>({});
  const [branchAreaMapping, setBranchAreaMapping] = useState<Record<string, string>>({});
  // const [isArea, setIsArea] = useState<boolean>(false);
  // const [townsInArea, setTownsInArea] = useState<string[]>([]);

  // Manager data state
  // const [employeeJobTitles, setEmployeeJobTitles] = useState<Record<string, string>>({});
  const [isBranchManagerMap, setIsBranchManagerMap] = useState<Record<string, boolean>>({});

  // Recommendation modal state
  const [showRecommendationModal, setShowRecommendationModal] = useState(false);
  const [recommendationAction, setRecommendationAction] = useState<string | null>(null);
  const [selectedApplication, setSelectedApplication] = useState<any>(null);

  // Comment modal state
  const [showCommentModal, setShowCommentModal] = useState(false);

  // Maker-Checker Payment Flow State
  const [paymentRequests, setPaymentRequests] = useState<any[]>([]);
  const [userRole, setUserRole] = useState('maker');
  const [actualUserRole, setActualUserRole] = useState('STAFF');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userEmail, setUserEmail] = useState<string>('');
  const [showApprovalQueue, setShowApprovalQueue] = useState(false);
  const [selectedPaymentForDetails, setSelectedPaymentForDetails] = useState(null);
  const [showPaymentDetails, setShowPaymentDetails] = useState(false);
  const [showRejectionModal, setShowRejectionModal] = useState(false);
  const [paymentToReject, setPaymentToReject] = useState(null);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(6);

  // NEW: Active tab state for M-Pesa callbacks
  const [activeTab, setActiveTab] = useState('applications');

  // NEW: Enhanced filter states
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [selectedDateRange, setSelectedDateRange] = useState('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // NEW: Export/Import states
  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Role-based permissions
  const isAdmin = userRole === 'credit_analyst_officer';
  const isBranchManager = userRole === 'branch_manager';
  const isRegionalManager = userRole === 'regional_manager';
  const isChecker = userRole === 'checker';
  const isMaker = userRole === 'maker';
  const isAdminOrChecker = isAdmin || isChecker;

  // Enhanced status filter handler
  const handleStatusFilter = (status: string) => {
    setSelectedStatus(status);
    setCurrentPage(1);
  };

  /*
  // Duplicate prevention function
  const checkForDuplicateApplication = async (employeeNumber: any, month: any, year: any) => {
    try {
      const { data, error } = await supabase
        .from('salary_advance')
        .select('*')
        .eq('Employee Number', employeeNumber)
        .eq('application_month', month)
        .eq('application_year', year);

      if (error) throw error;
      return data && data.length > 0;
    } catch (error) {
      console.error('Error checking for duplicates:', error);
      return false;
    }
  };
  */

  // Enhanced status management
  const updateApplicationStatus = async (applicationId: string, newStatus: string, additionalData: Record<string, any> = {}) => {
    try {
      const updateData: Record<string, any> = {
        status: newStatus,
        last_updated: new Date().toISOString(),
        ...additionalData
      };

      // Ensure status transitions are handled correctly
      if (newStatus === 'approved') {
        updateData.admin_approval = true;
        updateData.admin_approval_date = new Date().toISOString();
      } else if (newStatus === 'paid') {
        updateData.payment_date = new Date().toISOString();
        updateData.payment_processed = true;
      } else if (newStatus === 'rejected') {
        updateData.admin_approval = false;
        updateData.admin_rejection_date = new Date().toISOString();
      }

      const { error } = await supabase
        .from('salary_advance')
        .update(updateData)
        .eq('id', applicationId);

      if (error) throw error;

      toast.success(`Status updated to ${newStatus}`);
      return true;
    } catch (error: unknown) {
      console.error('Error updating status:', error);
      toast.error('Failed to update status');
      return false;
    }
  };

  // BORROWED FROM LEAVE MANAGEMENT: Load area-town mapping and saved town
  useEffect(() => {
    const loadMappings = async () => {
      try {
        const { data, error: employeesError } = await supabase
          .from('employees')
          .select('"Branch", "Town"');

        if (employeesError) {
          console.error("Error loading area-town mapping:", employeesError);
          return;
        }

        const areaMapping: Record<string, string[]> = {};
        data?.forEach((item: any) => {
          if (item.Branch && item.Town) {
            if (!areaMapping[item.Branch]) {
              areaMapping[item.Branch] = [];
            }
            if (!areaMapping[item.Branch].includes(item.Town)) {
              areaMapping[item.Branch].push(item.Town);
            }
          }
        });
        setAreaTownMapping(areaMapping);

        const { data: branchesData, error: branchesError } = await supabase
          .from('kenya_branches')
          .select('"Branch Office", "Area"');

        if (branchesError) {
          console.error("Error loading branch-area mapping:", branchesError);
          return;
        }

        const branchMapping = {};
        branchesData?.forEach(item => {
          if (item['Branch Office'] && item['Area']) {
            branchMapping[item['Branch Office']] = item['Area'];
          }
        });

        setBranchAreaMapping(branchMapping);

        /* 
        const savedTown = localStorage.getItem('selectedTown');
        if (savedTown && onTownChange) {
          onTownChange(savedTown);
          console.log('🎯 Loaded saved town from storage:', savedTown);
        }
        */
      } catch (error) {
        console.error("Error in loadMappings:", error);
      }
    };

    loadMappings();
    fetchUserProfile();
    fetchTowns();
  }, []);

  // BORROWED FROM LEAVE MANAGEMENT: Check if current selection is an area and get its towns
  // REMOVED isArea logic as it's handled by props
  /*
  useEffect(() => {
    if (selectedTown && areaTownMapping[selectedTown]) {
      // setIsArea(true);
    } else {
      // setIsArea(false);
    }
  }, [selectedTown, areaTownMapping]);
  */

  // Enhanced user profile fetching with manager lookup
  const fetchUserProfile = async () => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (userError || !user) {
        console.warn('User not authenticated');
        return;
      }

      setCurrentUser(user);
      console.log('🚀 SalaryAdmin v2.2 - Schema & Query Fixes Applied');
      setUserEmail(user.email || '');

      const actualRole = user.user_metadata?.role || 'STAFF';
      const mappedRole = ROLE_MAPPING[actualRole] || 'maker';

      let userTown = '';
      let userRegion = '';

      console.log('🔍 Looking up manager assignment for email:', user.email);

      const { data: regionalManagerData, error: regionalManagerError } = await supabase
        .from('employees')
        .select('"Town", "Branch"')
        .eq('regional_manager', user.email)
        .maybeSingle();

      if (regionalManagerData) {
        console.log('✅ User found as Regional Manager:', regionalManagerData);
        userRegion = regionalManagerData.Branch || '';
        userTown = userRegion;
        console.log('📍 Regional Manager assigned to Region:', userRegion);
      } else {
        const { data: branchManagerData, error: branchManagerError } = await supabase
          .from('employees')
          .select('"Town", "Branch"')
          .eq('manager_email', user.email)
          .maybeSingle();

        if (branchManagerData) {
          console.log('✅ User found as Branch Manager:', branchManagerData);
          userTown = branchManagerData.Town || '';
          userRegion = branchManagerData.Branch || '';
          console.log('📍 Branch Manager assigned to Town:', userTown);
        } else {
          console.log('❌ User email not found in regional_manager or manager_email columns');

          const { data: employeeData, error: employeeError } = await supabase
            .from('employees')
            .select('"Town", "Branch"')
            .eq('"Work Email"', user.email)
            .maybeSingle();

          if (employeeData) {
            userTown = employeeData.Town || '';
            userRegion = employeeData.Branch || '';
            console.log('📍 Regular employee - Town:', userTown, 'Region:', userRegion);
          }
        }
      }

      console.log('🎯 Final result:', {
        email: user.email,
        actualRole,
        mappedRole,
        userTown,
        userRegion
      });

      setActualUserRole(actualRole);
      setUserRole(mappedRole);
      setUserTown(userTown);
      setUserRegion(userRegion);

      /*
      if (mappedRole === 'regional_manager' && userRegion) {
        // onRegionChange && onRegionChange(userRegion);
        console.log('🎯 Regional Manager - auto-filtering by region:', userRegion);
      } else if (mappedRole === 'branch_manager' && userTown) {
        // onTownChange && onTownChange(userTown);
        console.log('🎯 Branch Manager - auto-filtering by town:', userTown);
      }
      */

    } catch (error) {
      console.error('❌ Error fetching user profile:', error);
      setUserRole('maker');
      setActualUserRole('STAFF');
    }
  };

  const fetchPaymentRequests = async () => {
    try {
      setIsLoadingRequests(true);
      const { data, error } = await supabase
        .from('salary_advance_payment_flows')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching payment requests:', error);
        toast.error('Failed to load payment requests');
        return;
      }

      setPaymentRequests(data || []);
    } catch (error) {
      console.error('Error fetching payment requests:', error);
      toast.error('Failed to load payment requests');
    } finally {
      setIsLoadingRequests(false);
    }
  };

  // BORROWED FROM LEAVE MANAGEMENT: Fetch towns and regions data
  const fetchTowns = async () => {
    try {
      console.log('📍 Fetching towns and regions from database...');
      const { data: employeesData, error: employeesError } = await supabase
        .from('employees')
        .select('"Town", "Branch"')
        .not('Town', 'is', null);

      if (employeesError) {
        console.error('❌ Error fetching towns:', employeesError);
        return;
      }

      const allLocations = [...new Set([
        ...employeesData.map(item => item.Town).filter(Boolean),
        ...employeesData.map(item => item.Branch).filter(Boolean)
      ])].sort();

      console.log('📍 Available locations for filter:', allLocations);
      console.log('📍 Current user town:', userTown);
      console.log('📍 Current user region:', userRegion);

      setAllTownsState(allLocations);
    } catch (error) {
      console.error('❌ Error fetching towns:', error);
    }
  };

  useEffect(() => {
    if (currentUser) {
      fetchPaymentRequests();
    }
  }, [currentUser]);

  // BORROWED FROM LEAVE MANAGEMENT: Enhanced fetchApplications with proper filtering
  const fetchApplications = async () => {
    setIsLoading(true);
    try {
      console.log('🔍 Fetching applications - Role:', userRole, 'Selected Town:', selectedTown, 'Selected Region:', selectedRegion);

      let query = supabase
        .from('salary_advance')
        .select('*')
        .order('time_added', { ascending: false });

      // Role-based filtering
      if (!isAdminOrChecker) {
        if (isRegionalManager && selectedRegion && selectedRegion !== 'All Regions') {
          console.log('🌍 Regional Manager - Filtering by region:', selectedRegion);

          const { data: regionTowns, error: townsError } = await supabase
            .from('employees')
            .select('"Town"')
            .ilike('Branch', `%${selectedRegion}%`)
            .not('Town', 'is', null);

          if (townsError) {
            console.error('❌ Error fetching region towns:', townsError);
            throw townsError;
          }

          const uniqueTowns = [...new Set(regionTowns.map(item => item.Town))].filter(Boolean);
          console.log('🏙️ Towns in region:', uniqueTowns);

          if (uniqueTowns.length > 0) {
            query = query.in('Office Branch', uniqueTowns);
            console.log('🔍 Filtering by Office Branch with towns:', uniqueTowns);
          } else {
            console.log('❌ No towns found for region:', selectedRegion);
            query = query.eq('id', '00000000-0000-0000-0000-000000000000'); // Return no results
          }
        } else if (isBranchManager && selectedTown && selectedTown !== 'All Towns') {
          console.log('🏢 Branch Manager - Filtering by town:', selectedTown);
          query = query.eq('Office Branch', selectedTown);
        } else if (userRole === 'maker' && selectedTown && selectedTown !== 'All Towns') {
          console.log('👤 Maker - Filtering by town:', selectedTown);
          query = query.eq('Office Branch', selectedTown);
        }
      }

      const { data, error } = await query;

      if (error) {
        console.error('❌ Error fetching applications:', error);
        throw error;
      }

      console.log('✅ Fetched applications:', data?.length);

      if (data && data.length > 0) {
        console.log('📊 First application sample:', {
          id: data[0].id,
          'Office Branch': data[0]['Office Branch'],
          'Branch': data[0].Branch,
          Employee: data[0]['Employee Number']
        });
      } else {
        console.log('❌ No applications found with current filter');
      }

      const enhancedApplications = data?.map(app => ({
        ...app,
        isBranchManager: isBranchManagerMap[app["Employee Number"]] || false
      })) || [];

      setApplications(enhancedApplications);

      await fetchJobTitles(enhancedApplications);

      const initialNotes: Record<string, string> = {};
      enhancedApplications.forEach(app => {
        initialNotes[app.id] = app.admin_notes || '';
      });
      setNotes(initialNotes);

      const initialSelected: Record<string, boolean> = {};
      enhancedApplications.forEach(app => {
        if (app.status?.toLowerCase() === 'approved') {
          initialSelected[app.id] = true;
        }
      });
      setSelectedStaff(initialSelected);

      await fetchMobileNumbers(enhancedApplications);

    } catch (error) {
      console.error('❌ Error fetching applications:', error);
      toast.error('Failed to load applications');
    } finally {
      setIsLoading(false);
    }
  };

  // BORROWED FROM LEAVE MANAGEMENT: Update the useEffect to trigger on town/region changes
  useEffect(() => {
    console.log('🔄 Triggering fetch due to town/region change:', selectedTown, selectedRegion);
    fetchApplications();
  }, [selectedTown, selectedRegion, selectedStatus, selectedMonth, selectedDateRange, customStartDate, customEndDate]);

  // BORROWED FROM LEAVE MANAGEMENT: Handle town change
  const handleTownChange = (town: string) => {
    if (onTownChange) {
      onTownChange(town);
    }
    setCurrentPage(1);
    console.log('💾 Town change requested:', town);
  };

  // BORROWED FROM LEAVE MANAGEMENT: Get display name for current selection
  const getDisplayName = (currentTown: string) => {
    if (!currentTown) return "All Towns";

    // Check if it's a region
    if (regions && regions.includes(currentTown)) {
      return `${currentTown} Region`;
    }

    return currentTown;
  };

  // Fetch job titles for all applications
  const fetchJobTitles = async (apps: any[]) => {
    try {
      const employeeNumbers = apps.map(app => app["Employee Number"]).filter(Boolean);

      if (employeeNumbers.length === 0) return;

      const { data, error } = await supabase
        .from('employees')
        .select('"Employee Number", "Job Title"')
        .in('"Employee Number"', employeeNumbers);

      if (error) throw error;

      const jobTitleMap: Record<string, string> = {};
      const branchManagerMap: Record<string, boolean> = {};

      data?.forEach(emp => {
        jobTitleMap[emp["Employee Number"]] = emp["Job Title"] || '';

        const jobTitle = emp["Job Title"]?.toLowerCase() || '';
        const isManager = jobTitle.includes('branch manager') ||
          jobTitle.includes('manager') ||
          jobTitle.includes('bm') ||
          jobTitle.includes('head of');

        branchManagerMap[emp["Employee Number"]] = isManager;
      });

      setEmployeeJobTitles(jobTitleMap);
      setIsBranchManagerMap(branchManagerMap);

    } catch (error) {
      console.error('Error fetching job titles:', error);
    }
  };

  const fetchMobileNumbers = async (apps: any[]) => {
    try {
      const employeeNumbers = apps.map(app => app["Employee Number"]).filter(Boolean);

      if (employeeNumbers.length === 0) return;

      const { data, error } = await supabase
        .from('employees')
        .select('"Employee Number", "Mobile Number"')
        .in('"Employee Number"', employeeNumbers);

      if (error) throw error;

      const mobileMap: Record<string, string> = {};
      data?.forEach(emp => {
        mobileMap[emp["Employee Number"]] = emp["Mobile Number"];
      });

      setEmployeeMobileNumbers(mobileMap);
    } catch (error) {
      console.error('Error fetching mobile numbers:', error);
      toast.error('Failed to load mobile numbers');
    }
  };

  // Helper function to safely parse date from application
  const parseApplicationDate = (app: any): Date => {
    // Try multiple date fields in order of preference
    const dateValue = app.time_added || app.created_at || app.application_date;

    if (!dateValue) {
      console.warn('No date found for application:', app.id, 'Using current date as fallback');
      return new Date();
    }

    // Handle different date formats
    let parsedDate: Date;

    if (typeof dateValue === 'number') {
      // If it's a timestamp (milliseconds)
      parsedDate = new Date(dateValue);
    } else if (typeof dateValue === 'string') {
      // If it's an ISO string or other string format
      parsedDate = new Date(dateValue);
    } else {
      parsedDate = new Date();
    }

    // Validate the parsed date
    if (isNaN(parsedDate.getTime()) || parsedDate.getFullYear() < 2020) {
      console.warn('Invalid date for application:', app.id, 'Value:', dateValue, 'Using current date as fallback');
      return new Date();
    }

    return parsedDate;
  };

  // Helper function to check if application is from current month
  const isCurrentMonth = (app: any) => {
    const appDate = parseApplicationDate(app);
    const now = new Date();
    return appDate.getMonth() === now.getMonth() && appDate.getFullYear() === now.getFullYear();
  };

  // Get fully approved applications (only current month for payment processing)
  const getFullyApprovedApplications = () => {
    return applications.filter(app =>
      app.status?.toLowerCase() === 'approved' && isCurrentMonth(app)
    );
  };

  // Format amount as Kenyan Shillings
  const formatKES = (amount: number) => {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: 'KES',
      minimumFractionDigits: 2
    }).format(amount);
  };

  // Format phone number for M-Pesa (254 format) - FIXED VERSION
  // Format phone number for M-Pesa (254 format)
  const formatPhoneNumber = (phone: string) => {
    return SMSService.formatPhoneNumberForSMS(phone);
  };

  // Calculate total amount for selected applications
  const calculateTotalAmount = () => {
    const approvedApps = getFullyApprovedApplications();
    return approvedApps.reduce((total, app) => {
      if (selectedStaff[app.id]) {
        return total + Number(app["Amount Requested"] || 0);
      }
      return total;
    }, 0);
  };

  // Get count of selected staff
  const getSelectedStaffCount = () => {
    return getFullyApprovedApplications().filter(app => selectedStaff[app.id]).length;
  };

  // Toggle selection for a staff member
  const toggleStaffSelection = (id: string) => {
    setSelectedStaff(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // Select all staff (only current month)
  const selectAllStaff = () => {
    const newSelection: Record<string, boolean> = {};
    getFullyApprovedApplications().forEach(app => {
      // Only select if it's from current month
      if (isCurrentMonth(app)) {
        newSelection[app.id] = true;
      }
    });
    setSelectedStaff(newSelection);
  };

  // Deselect all staff
  const deselectAllStaff = () => {
    setSelectedStaff({});
  };

  const handleAmountEdit = (id: string, currentAmount: string) => {
    setEditingId(id);
    const numericValue = currentAmount.replace(/[^0-9.]/g, '');
    setEditedAmount(numericValue);
  };

  const handleAmountSave = async (id: string) => {
    if (!editedAmount || isNaN(Number(editedAmount))) {
      toast.error('Please enter a valid amount');
      return;
    }

    try {
      const { error } = await supabase
        .from('salary_advance')
        .update({ "Amount Requested": Number(editedAmount) })
        .eq('id', id);

      if (error) throw error;

      toast.success('Amount updated!');
      setEditingId(null);
      fetchApplications();
    } catch (error) {
      console.error('Error updating amount:', error);
      toast.error('Failed to update amount');
    }
  };

  // Check if user is approving themselves
  const checkIfSelfApproval = (application: any) => {
    if (!currentUser || !application) return false;

    const userEmployeeNumber = currentUser.user_metadata?.employee_number;
    if (userEmployeeNumber && application["Employee Number"] === userEmployeeNumber) {
      return true;
    }

    const userEmail = currentUser.email?.toLowerCase();
    const applicationEmail = application["Email"]?.toLowerCase();
    if (userEmail && applicationEmail && userEmail === applicationEmail) {
      return true;
    }

    return false;
  };

  // Open recommendation modal
  const openRecommendationModal = (application: any, action: string) => {
    setSelectedApplication(application);
    setRecommendationAction(action);
    setShowRecommendationModal(true);
  };

  // Open comment modal
  const openCommentModal = (application: any) => {
    setSelectedApplication(application);
    setShowCommentModal(true);
  };

  // Enhanced recommendation handler with proper status updates
  const handleRecommendation = async (recommendationData: any) => {
    const { action, notes, adjustedAmount } = recommendationData;

    try {
      let updateData: any = {
        admin_notes: notes,
        last_updated: new Date().toISOString()
      };

      let newStatus = '';

      switch (action) {
        case 'bm-recommend-current':
          updateData.branch_manager_recommendation = 'recommend_current';
          updateData.branch_manager_notes = notes;
          updateData.branch_manager_approval = true;
          updateData.branch_manager_approval_date = new Date().toISOString();
          newStatus = 'pending-regional-manager';
          break;

        case 'bm-recommend-adjusted':
          updateData.branch_manager_recommendation = 'recommend_adjusted';
          updateData.branch_manager_notes = notes;
          updateData.branch_manager_adjusted_amount = adjustedAmount;
          updateData.branch_manager_approval = true;
          updateData.branch_manager_approval_date = new Date().toISOString();
          newStatus = 'pending-regional-manager';
          if (adjustedAmount) {
            updateData["Amount Requested"] = adjustedAmount;
          }
          break;

        case 'bm-recommend-reject':
          updateData.branch_manager_recommendation = 'recommend_reject';
          updateData.branch_manager_notes = notes;
          updateData.branch_manager_approval = false;
          newStatus = 'rejected';
          break;

        case 'rm-recommend-current':
          updateData.regional_manager_recommendation = 'recommend_current';
          updateData.regional_manager_notes = notes;
          updateData.regional_manager_approval = true;
          updateData.regional_manager_approval_date = new Date().toISOString();
          newStatus = 'pending-admin';
          break;

        case 'rm-recommend-adjusted':
          updateData.regional_manager_recommendation = 'recommend_adjusted';
          updateData.regional_manager_notes = notes;
          updateData.regional_manager_adjusted_amount = adjustedAmount;
          updateData.regional_manager_approval = true;
          updateData.regional_manager_approval_date = new Date().toISOString();
          newStatus = 'pending-admin';
          if (adjustedAmount) {
            updateData["Amount Requested"] = adjustedAmount;
          }
          break;

        case 'rm-recommend-reject':
          updateData.regional_manager_recommendation = 'recommend_reject';
          updateData.regional_manager_notes = notes;
          updateData.regional_manager_approval = false;
          newStatus = 'rejected';
          break;

        case 'admin-approve-current':
          updateData.admin_approval = true;
          updateData.admin_approval_date = new Date().toISOString();
          updateData.admin_notes = notes;
          newStatus = 'approved'; // This should change from 'pending-admin' to 'approved'
          updateData.approved_by = currentUser?.id;
          updateData.approved_by_email = currentUser?.email;
          break;

        case 'admin-approve-adjusted':
          updateData.admin_approval = true;
          updateData.admin_approval_date = new Date().toISOString();
          updateData.admin_notes = notes;
          updateData.admin_adjusted_amount = adjustedAmount;
          newStatus = 'approved'; // This should change from 'pending-admin' to 'approved'
          updateData.approved_by = currentUser?.id;
          updateData.approved_by_email = currentUser?.email;
          if (adjustedAmount) {
            updateData["Amount Requested"] = adjustedAmount;
          }
          break;

        case 'admin-reject':
          updateData.admin_approval = false;
          updateData.admin_rejection_date = new Date().toISOString();
          updateData.admin_notes = notes;
          newStatus = 'rejected'; // This should change from 'pending-admin' to 'rejected'
          updateData.rejected_by = currentUser?.id;
          updateData.rejected_by_email = currentUser?.email;
          break;
      }

      // Ensure status is always set
      updateData.status = newStatus;

      const { error } = await supabase
        .from('salary_advance')
        .update(updateData)
        .eq('id', selectedApplication.id);

      if (error) throw error;

      // Update selection state
      if ((action.includes('recommend-current') || action.includes('recommend-adjusted') || action.includes('admin-approve')) && !action.includes('reject')) {
        setSelectedStaff(prev => ({
          ...prev,
          [selectedApplication.id]: true
        }));
      }

      if (action.includes('recommend-reject') || action.includes('admin-reject')) {
        setSelectedStaff(prev => {
          const newSelection = { ...prev };
          delete newSelection[selectedApplication.id];
          return newSelection;
        });
      }

      toast.success('Action completed successfully!');
      fetchApplications();
    } catch (error) {
      console.error('Error submitting action:', error);
      toast.error('Failed to submit action');
    }
  };

  // Handle comment submission
  const handleComment = async (comment: string) => {
    try {
      const updateData = {
        regional_manager_comment: comment,
        regional_manager_comment_date: new Date().toISOString(),
        last_updated: new Date().toISOString()
      };

      const { error } = await supabase
        .from('salary_advance')
        .update(updateData)
        .eq('id', selectedApplication.id);

      if (error) throw error;

      toast.success('Comment submitted successfully!');
      fetchApplications();
    } catch (error) {
      console.error('Error submitting comment:', error);
      toast.error('Failed to submit comment');
    }
  };

  const handleNoteChange = (id: string, value: string) => {
    setNotes(prev => ({
      ...prev,
      [id]: value
    }));
  };

  const saveNotes = async (id: string) => {
    try {
      const { error } = await supabase
        .from('salary_advance')
        .update({ admin_notes: notes[id] || null })
        .eq('id', id);

      if (error) throw error;
      toast.success('Notes saved!');
      setShowNotesDropdown(null);
    } catch (error) {
      console.error('Error saving notes:', error);
      toast.error('Failed to save notes');
    }
  };

  // Enhanced M-Pesa payment function with SMS notifications
  // Enhanced M-Pesa payment function with SMS notifications
  const processMpesaPayment = async (employeeNumber: string, amount: number, fullName: string) => {
    try {
      const mobileNumber = employeeMobileNumbers[employeeNumber];
      if (!mobileNumber) {
        throw new Error(`Mobile number not found for employee ${employeeNumber}`);
      }

      const formattedPhone = formatPhoneNumber(mobileNumber);

      if (!formattedPhone) {
        throw new Error(`Invalid phone number format for ${employeeNumber}: ${mobileNumber}`);
      }

      console.log(`💰 Processing M-Pesa payment:`, {
        employee: fullName,
        employeeNumber,
        amount,
        originalPhone: mobileNumber,
        formattedPhone
      });

      const MPESA_API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.MODE === 'production' ? '/api' : "http://localhost:3001/api");

      const response = await fetch(`${MPESA_API_BASE}/mpesa/b2c`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phoneNumber: formattedPhone,
          amount: amount,
          employeeNumber: employeeNumber,
          fullName: fullName
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to process payment');
      }

      const result = await response.json();

      console.log('✅ M-Pesa payment processed:', result);

      // Send SMS notification after successful payment
      if (result.success) {
        try {
          const smsResult = await SMSService.sendDisbursementNotification(
            fullName,
            mobileNumber,
            amount,
            result.transactionId || 'N/A'
          );

          if (smsResult.success) {
            console.log(`✅ SMS notification sent to ${fullName} (${smsResult.recipient})`);
          } else {
            console.error(`❌ SMS failed for ${fullName}:`, smsResult.error);
          }
        } catch (smsError) {
          console.error('❌ Failed to send SMS notification:', smsError);
          // Don't throw error - payment was successful, just SMS failed
        }
      }

      return result;
    } catch (error) {
      console.error('❌ M-Pesa payment error:', error);

      if (process.env.NODE_ENV === 'development' && error.message.includes('Failed to fetch')) {
        console.warn('⚠️ Backend unavailable, using mock mode');
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Mock SMS notification in development
        try {
          const mockTransactionId = 'MOCK_' + Date.now();
          await SMSService.sendDisbursementNotification(
            fullName,
            employeeMobileNumbers[employeeNumber],
            amount,
            mockTransactionId
          );
        } catch (smsError) {
          console.error('❌ Failed to send mock SMS:', smsError);
        }

        return {
          success: true,
          message: 'Mock payment processed successfully',
          transactionId: 'MOCK_' + Date.now()
        };
      }

      throw error;
    }
  };
  // Create payment request function for maker-checker flow
  const createPaymentRequest = async (selectedAdvances: any[], justification: string) => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error('User not authenticated');
      }

      const requestData = {
        type: 'bulk',
        advances_data: selectedAdvances,
        justification: justification,
        total_amount: selectedAdvances.reduce((sum: number, advance: any) => sum + (advance.amount_requested || 0), 0),
        created_by: user.id,
        created_by_email: user.email,
        status: 'pending'
      };

      const { data, error } = await supabase
        .from('salary_advance_payment_flows')
        .insert([requestData])
        .select()
        .single();

      if (error) {
        console.error('Supabase insert error:', error);
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error in createPaymentRequest:', error);
      throw error;
    }
  };

  // Enhanced payment processing with proper status updates and SMS notifications
  const processBulkMpesaPayment = async (advancesData: any[]) => {
    if (userRole === 'maker') {
      throw new Error('Makers are not authorized to process payments directly');
    }

    const results = [];

    for (const advance of advancesData) {
      try {
        console.log(`💰 Processing payment for ${advance.full_name}, amount: ${advance.amount_requested}`);

        const result = await processMpesaPayment(
          advance.employee_number,
          advance.amount_requested,
          advance.full_name
        );

        results.push({ success: true, advance, result });

        // Use the enhanced status update function
        const updateSuccess = await updateApplicationStatus(
          advance.id,
          'paid',
          {
            mpesa_transaction_id: result.transactionId || `MPESA_${Date.now()}`,
            mpesa_result_desc: result.message || 'Payment processed successfully'
          }
        );

        if (!updateSuccess) {
          throw new Error('Failed to update application status');
        }

        console.log(`✅ Successfully updated ${advance.full_name} status to 'paid'`);
        toast.success(`Payment sent to ${advance.full_name} and status updated to Paid`);

      } catch (error) {
        console.error(`❌ Failed to pay ${advance.full_name}:`, error);
        results.push({ success: false, advance, error });
        toast.error(`Failed to pay ${advance.full_name}: ${error.message}`);
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return results;
  };

  // Approve payment request function
  const approvePayment = async (payment) => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (userError || !user) {
        toast.error('User not authenticated');
        return;
      }

      const updateData = {
        status: 'approved',
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        approved_by_email: user.email
      };

      const { data, error } = await supabase
        .from('salary_advance_payment_flows')
        .update(updateData)
        .eq('id', payment.id)
        .select('*')
        .single();

      if (error) {
        console.error('Error approving payment request:', error);
        toast.error('Failed to approve payment request');
        return;
      }

      try {
        const paymentResults = await processBulkMpesaPayment(payment.advances_data);

        await supabase
          .from('salary_advance_payment_flows')
          .update({
            status: 'completed',
            processed_at: new Date().toISOString(),
            metadata: { results: paymentResults }
          })
          .eq('id', payment.id);

        setPaymentRequests(prev =>
          prev.map(req => req.id === payment.id ? { ...req, status: 'completed' } : req)
        );

        await fetchApplications();

        toast.success('Payment approved and processed successfully! Applications updated to Paid status.');

      } catch (error) {
        await supabase
          .from('salary_advance_payment_flows')
          .update({
            status: 'failed',
            processed_at: new Date().toISOString(),
            metadata: { error: error.message }
          })
          .eq('id', payment.id);

        setPaymentRequests(prev =>
          prev.map(req => req.id === payment.id ? { ...req, status: 'failed' } : req)
        );

        console.error('Payment processing error:', error);
        toast.error('Payment approved but failed to process: ' + error.message);
      }
    } catch (error) {
      console.error('Payment approval error:', error);
      toast.error('Failed to approve payment request: ' + error.message);
    }
  };

  // Reject payment request function
  const rejectPayment = async (payment, reason) => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (userError || !user) {
        toast.error('User not authenticated');
        return;
      }

      setPaymentRequests(prev =>
        prev.map(req =>
          req.id === payment.id
            ? {
              ...req,
              status: 'rejected',
              rejected_by: user.id,
              rejected_at: new Date().toISOString(),
              rejection_reason: reason,
              rejected_by_email: user.email
            }
            : req
        )
      );

      const updateData = {
        status: 'rejected',
        rejected_by: user.id,
        rejected_at: new Date().toISOString(),
        rejection_reason: reason,
        rejected_by_email: user.email
      };

      const { data, error } = await supabase
        .from('salary_advance_payment_flows')
        .update(updateData)
        .eq('id', payment.id)
        .select('*')
        .single();

      if (error) {
        console.error('Error rejecting payment request:', error);
        toast.error('Failed to reject payment request');
        fetchPaymentRequests();
        return;
      }

      toast.success('Payment request rejected');
    } catch (error) {
      console.error('Payment rejection error:', error);
      toast.error('Failed to reject payment request');
    }
  };

  const handleBulkPayment = async () => {
    const selectedApps = getFullyApprovedApplications().filter((app: any) => selectedStaff[app.id]);

    if (selectedApps.length === 0) {
      toast.error('No staff members selected for payment');
      return;
    }

    if (!justification.trim()) {
      toast.error('Please provide justification for the payment request');
      return;
    }

    const advancesData = selectedApps.map((app: any) => ({
      id: app.id,
      employee_number: app["Employee Number"],
      full_name: app["Full Name"],
      mobile_number: (employeeMobileNumbers as any)[app["Employee Number"]],
      amount_requested: Number(app["Amount Requested"]),
      branch_manager_approval: app.branch_manager_approval,
      regional_manager_approval: app.regional_manager_approval,
      isBranchManager: (isBranchManagerMap as any)[app["Employee Number"]] || false
    }));

    if (userRole === 'maker') {
      try {
        await createPaymentRequest(advancesData, justification);
        toast.success('Payment request submitted for approval!');

        setSelectedStaff({});
        setJustification('');
        setShowBulkPaymentModal(false);
        fetchPaymentRequests();

      } catch (error: any) {
        console.error('Error creating payment request:', error);
        toast.error('Failed to submit payment request');
      }
    }
    else if (userRole === 'checker' || userRole === 'credit_analyst_officer') {
      setIsProcessingBulkPayment(true);
      try {
        const results = await processBulkMpesaPayment(advancesData);

        const successCount = results.filter((r: any) => r.success).length;
        const totalCount = selectedApps.length;

        if (successCount === totalCount) {
          toast.success(`All ${totalCount} payments processed successfully! Status updated to Paid.`);
        } else if (successCount > 0) {
          toast.success(`${successCount} of ${totalCount} payments processed successfully`);
        } else {
          toast.error('All payments failed. Please check your payment service configuration.');
        }

        setSelectedStaff({});
        setJustification('');
        setShowBulkPaymentModal(false);

        setTimeout(() => {
          fetchApplications();
          fetchPaymentRequests();
        }, 1000);

      } catch (error: any) {
        console.error('Error processing bulk payments:', error);
        toast.error(`Failed to process payments: ${error.message}`);
      } finally {
        setIsProcessingBulkPayment(false);
      }
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'approved':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'rejected':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'paid':
        return <CheckCircle2 className="h-4 w-4 text-blue-500" />;
      default:
        return <Clock className="h-4 w-4 text-yellow-500" />;
    }
  };

  // Get approval status
  const getApprovalStatus = (app: any) => {
    if (app.status?.toLowerCase() === 'paid') {
      return 'Paid';
    }

    if (app.status?.toLowerCase() === 'rejected') {
      return 'Rejected';
    }

    if (app.status?.toLowerCase() === 'approved') {
      return 'Fully Approved';
    }

    if (app.status === 'pending-admin') {
      return 'Pending Admin Approval';
    }

    if (app.branch_manager_recommendation) {
      switch (app.branch_manager_recommendation) {
        case 'recommend_current':
          return 'BM: Recommend Current';
        case 'recommend_adjusted':
          return 'BM: Recommend Adjusted';
        case 'recommend_reject':
          return 'BM: Recommend Reject';
      }
    }

    if (app.regional_manager_recommendation) {
      switch (app.regional_manager_recommendation) {
        case 'recommend_current':
          return 'RM: Recommend Current';
        case 'recommend_adjusted':
          return 'RM: Recommend Adjusted';
        case 'recommend_reject':
          return 'RM: Recommend Reject';
      }
    }

    const isEmployeeBranchManager = isBranchManagerMap[app["Employee Number"]] || false;

    if (app.branch_manager_approval && !isEmployeeBranchManager) {
      return 'Pending Regional Manager';
    }

    if (app.regional_manager_approval && isEmployeeBranchManager) {
      return 'Pending Admin Approval';
    }

    if (isEmployeeBranchManager) {
      return 'Pending Regional Manager';
    } else {
      return 'Pending Branch Manager';
    }
  };

  const getApprovalBadgeColor = (status: string) => {
    switch (status) {
      case 'Fully Approved':
        return 'bg-green-100 text-green-800';
      case 'Pending Admin Approval':
        return 'bg-purple-100 text-purple-800';
      case 'Pending Regional Manager':
        return 'bg-yellow-100 text-yellow-800';
      case 'Pending Branch Manager':
        return 'bg-orange-100 text-orange-800';
      case 'Rejected':
        return 'bg-red-100 text-red-800';
      case 'Paid':
        return 'bg-blue-100 text-blue-800';
      case 'BM: Recommend Current':
        return 'bg-green-100 text-green-800';
      case 'BM: Recommend Adjusted':
        return 'bg-blue-100 text-blue-800';
      case 'BM: Recommend Reject':
        return 'bg-red-100 text-red-800';
      case 'RM: Recommend Current':
        return 'bg-green-100 text-green-800';
      case 'RM: Recommend Adjusted':
        return 'bg-blue-100 text-blue-800';
      case 'RM: Recommend Reject':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  // Check if branch manager can approve this application
  const canBranchManagerApprove = (app: any) => {
    if (!isBranchManager) return false;

    const isSelfApproval = checkIfSelfApproval(app);

    const isEmployeeBranchManager = isBranchManagerMap[app["Employee Number"]] || false;

    const hasBranchApproval = app.branch_manager_approval;

    return !isSelfApproval && !isEmployeeBranchManager && !hasBranchApproval;
  };

  // Check if regional manager can approve this application
  const canRegionalManagerApprove = (app: any) => {
    if (!isRegionalManager && !isAdmin) return false;

    const isEmployeeBranchManager = isBranchManagerMap[app["Employee Number"]] || false;
    const canApproveThisUser = isAdmin || isEmployeeBranchManager;

    const isSelfApproval = checkIfSelfApproval(app);

    const hasRegionalApproval = app.regional_manager_approval;

    return canApproveThisUser && !isSelfApproval && !hasRegionalApproval;
  };

  // Check if regional manager can comment on regular employees
  const canRegionalManagerComment = (app: any) => {
    if (!isRegionalManager) return false;

    const isEmployeeBranchManager = isBranchManagerMap[app["Employee Number"]] || false;
    const hasBranchApproval = app.branch_manager_approval;

    return !isEmployeeBranchManager && !hasBranchApproval;
  };

  // Check if admin can approve this application
  const canAdminApprove = (app: any) => {
    if (!isAdmin) return false;

    return app.status === 'pending-admin';
  };

  // Enhanced Export function with filtering options
  const handleExport = async (exportConfig: any) => {
    try {
      setIsExporting(true);

      let query = supabase
        .from('salary_advance')
        .select('*')
        .order('time_added', { ascending: false });

      // Apply date range filter for export
      if (exportConfig.dateRange !== 'all') {
        const today = new Date();
        let startDate = new Date();

        switch (exportConfig.dateRange) {
          case 'today':
            startDate.setHours(0, 0, 0, 0);
            break;
          case 'this_week':
            startDate.setDate(today.getDate() - today.getDay());
            startDate.setHours(0, 0, 0, 0);
            break;
          case 'this_month':
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
            break;
          case 'last_month':
            startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            break;
          case 'last_3_months':
            startDate = new Date(today.getFullYear(), today.getMonth() - 3, 1);
            break;
          case 'custom':
            if (exportConfig.customStartDate) {
              startDate = new Date(exportConfig.customStartDate);
            }
            break;
        }

        if (exportConfig.dateRange !== 'custom' || exportConfig.customStartDate) {
          query = query.gte('time_added', startDate.toISOString());
        }

        if (exportConfig.dateRange === 'custom' && exportConfig.customEndDate) {
          const endDate = new Date(exportConfig.customEndDate);
          endDate.setHours(23, 59, 59, 999);
          query = query.lte('time_added', endDate.toISOString());
        }
      }

      // Apply status filter
      if (exportConfig.status !== 'all') {
        query = query.eq('status', exportConfig.status);
      }

      // Apply town filter
      if (exportConfig.town !== 'all') {
        query = query.ilike('"Office Branch"', `%${exportConfig.town}%`);
      }

      // Apply month filter
      if (exportConfig.month !== 'all') {
        const month = parseInt(exportConfig.month);
        const year = new Date().getFullYear();
        const startDate = new Date(year, month, 1);
        const endDate = new Date(year, month + 1, 0);
        endDate.setHours(23, 59, 59, 999);

        query = query.gte('time_added', startDate.toISOString())
          .lte('time_added', endDate.toISOString());
      }

      const { data, error } = await query;

      if (error) throw error;

      // Prepare data for export
      const exportData = data.map(app => ({
        'Employee Name': app['Full Name'],
        'Employee Number': app['Employee Number'],
        'Mobile Number': employeeMobileNumbers[app["Employee Number"]] || 'N/A',
        'Branch': app['Office Branch'] || app.Office_Branch || app.office_branch || 'N/A',
        'Amount Requested': app['Amount Requested'],
        'Status': app.status || 'pending',
        'Request Date': parseApplicationDate(app).toLocaleDateString(),
        'Reason': app['Reason for Advance'] || '',
        'Branch Manager Approval': app.branch_manager_approval ? 'Approved' : 'Pending',
        'Regional Manager Approval': app.regional_manager_approval ? 'Approved' : 'Pending',
        'Admin Approval': app.admin_approval ? 'Approved' : 'Pending',
        'Final Status': getApprovalStatus(app)
      }));

      // Convert to CSV or Excel
      if (exportConfig.format === 'csv') {
        const headers = Object.keys(exportData[0] || {});

        const csvContent = [
          headers.join(','),
          ...exportData.map((row: any) =>
            headers.map((header: string) => {
              const value = row[header];
              // Handle special characters and formatting
              if (header === 'Amount Requested') {
                return `"${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}"`;
              }
              return `"${String(value || '').replace(/"/g, '""')}"`;
            }).join(',')
          )
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `salary_advances_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        // For Excel export - using simple tab-separated format that Excel can open
        const headers = Object.keys(exportData[0] || {});
        const excelContent = [
          headers.join('\t'),
          ...exportData.map((row: any) =>
            headers.map((header: string) => {
              const value = row[header];
              if (header === 'Amount Requested') {
                return Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 });
              }
              return String(value || '');
            }).join('\t')
          )
        ].join('\n');

        const blob = new Blob([excelContent], { type: 'application/vnd.ms-excel' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `salary_advances_${new Date().toISOString().split('T')[0]}.xls`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }

      toast.success(`Exported ${exportData.length} records successfully`);
      setShowExportModal(false);
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export data');
    } finally {
      setIsExporting(false);
    }
  };

  // Import function
  const handleImport = async (file: File, importType: string) => {
    try {
      setIsImporting(true);

      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const content = e.target?.result;

          if (!content || typeof content !== 'string') {
            toast.error('Failed to read file content');
            return;
          }

          // Parse CSV content
          const lines = content.split('\n').filter(line => line.trim() !== '');

          if (lines.length === 0) {
            toast.error('File is empty');
            return;
          }

          // Parse headers
          const firstLine = lines[0];
          let headers = [];

          // Handle different CSV formats
          if (firstLine.includes('","')) {
            // Standard CSV with quotes
            headers = firstLine.split('","').map(h => h.replace(/"/g, '').trim());
          } else if (firstLine.includes(',')) {
            // CSV without quotes
            headers = firstLine.split(',').map(h => h.trim());
          } else if (firstLine.includes('\t')) {
            // Tab-separated
            headers = firstLine.split('\t').map(h => h.trim());
          } else {
            toast.error('Unsupported file format. Please use CSV or Excel file.');
            return;
          }

          console.log('Detected headers:', headers);

          // Normalize header names for comparison
          const normalizedHeaders = headers.map(header =>
            header.toLowerCase().replace(/\s+/g, '_')
          );

          // Check for required columns
          const requiredColumns = ['employee', 'mobile_number', 'branch', 'amount'];
          const missingColumns = requiredColumns.filter(required =>
            !normalizedHeaders.includes(required)
          );

          if (missingColumns.length > 0) {
            toast.error(`Missing required columns: ${missingColumns.join(', ')}`);
            return;
          }

          // Process data rows
          const updates = [];
          for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;

            let values = [];
            const currentLine = lines[i];

            // Parse values using the same method as headers
            if (currentLine.includes('","')) {
              values = currentLine.split('","').map(v => v.replace(/"/g, '').trim());
            } else if (currentLine.includes(',')) {
              values = currentLine.split(',').map(v => v.trim());
            } else if (currentLine.includes('\t')) {
              values = currentLine.split('\t').map(v => v.trim());
            }

            if (values.length !== headers.length) {
              console.warn(`Skipping row ${i} - column count mismatch`);
              continue;
            }

            const row: any = {};
            headers.forEach((header: string, index: number) => {
              row[header] = values[index] || '';
            });

            updates.push(row);
          }

          console.log('Processed updates:', updates);

          if (importType === 'updates') {
            // Update existing records
            let updatedCount = 0;

            for (const update of updates) {
              const updateData: any = {};

              // Map imported fields to database fields
              if (update['Mobile Number']) updateData['Mobile Number'] = update['Mobile Number'];
              if (update['Branch']) updateData['Office Branch'] = update['Branch'];
              if (update['Amount']) {
                const cleanAmount = update['Amount'].replace(/[^\d.-]/g, '');
                updateData['Amount Requested'] = parseFloat(cleanAmount) || 0;
              }

              if (Object.keys(updateData).length > 0) {
                updateData.last_updated = new Date().toISOString();

                // Try to find by employee number first, then by name
                let query = supabase.from('salary_advance');

                if (update['Employee Number']) {
                  // Update by employee number
                  const { error } = await query
                    .update(updateData)
                    .eq('Employee Number', update['Employee Number']);

                  if (!error) updatedCount++;
                } else if (update['Employee']) {
                  // Update by employee name (fuzzy match)
                  const { error } = await query
                    .update(updateData)
                    .ilike('Full Name', `%${update['Employee']}%`);

                  if (!error) updatedCount++;
                }
              }
            }

            toast.success(`Successfully updated ${updatedCount} records`);
          } else {
            // Import new applications
            const newApplications = updates.map((update, index) => ({
              'Employee Number': update['Employee Number'] || `IMP_${Date.now()}_${index}`,
              'Full Name': update['Employee'] || 'Unknown Employee',
              'Office Branch': update['Branch'] || 'Unknown Branch',
              'Amount Requested': parseFloat(update['Amount']?.replace(/[^\d.-]/g, '') || 0),
              'Mobile Number': update['Mobile Number'] || '',
              'status': 'pending',
              'time_added': new Date().toISOString()
            }));

            if (newApplications.length > 0) {
              const { error } = await supabase
                .from('salary_advance')
                .insert(newApplications);

              if (error) {
                console.error('Insert error:', error);
                throw error;
              }

              toast.success(`Successfully imported ${newApplications.length} new applications`);
            }
          }

          setShowImportModal(false);
          fetchApplications(); // Refresh the data
        } catch (error) {
          console.error('Import processing error:', error);
          toast.error(`Failed to process import file: ${error.message}`);
        }
      };

      reader.onerror = () => {
        toast.error('Failed to read file');
      };

      // Read the file as text
      reader.readAsText(file);

    } catch (error) {
      console.error('Import error:', error);
      toast.error('Failed to import data');
    } finally {
      setIsImporting(false);
    }
  };

  // Enhanced filtering function
  const getFilteredApplications = () => {
    let filtered = applications.filter(app => {
      const matchesSearch =
        app["Employee Number"]?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        app["Full Name"]?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        app["Office Branch"]?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        employeeMobileNumbers[app["Employee Number"]]?.includes(searchTerm);

      if (!matchesSearch) return false;

      // Status filter
      if (selectedStatus !== 'all') {
        const appStatus = app.status?.toLowerCase();
        const approvalStatus = getApprovalStatus(app).toLowerCase();

        if (selectedStatus === 'pending') {
          if (!appStatus.includes('pending') && !approvalStatus.includes('pending')) {
            return false;
          }
        } else if (appStatus !== selectedStatus && approvalStatus !== selectedStatus) {
          return false;
        }
      }

      // Month filter
      if (selectedMonth !== 'all') {
        const appDate = parseApplicationDate(app);
        if (appDate.getMonth().toString() !== selectedMonth) {
          return false;
        }
      }

      // Date range filter
      if (selectedDateRange !== 'all') {
        const appDate = parseApplicationDate(app);
        const today = new Date();
        const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay());
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const startOfLast3Months = new Date(today.getFullYear(), today.getMonth() - 3, 1);

        switch (selectedDateRange) {
          case 'today':
            if (appDate < startOfToday) return false;
            break;
          case 'this_week':
            if (appDate < startOfWeek) return false;
            break;
          case 'this_month':
            if (appDate < startOfMonth) return false;
            break;
          case 'last_month':
            const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
            if (appDate < startOfLastMonth || appDate > endOfLastMonth) return false;
            break;
          case 'last_3_months':
            if (appDate < startOfLast3Months) return false;
            break;
          case 'custom':
            if (customStartDate && customEndDate) {
              const start = new Date(customStartDate);
              const end = new Date(customEndDate);
              end.setHours(23, 59, 59, 999);
              if (appDate < start || appDate > end) return false;
            }
            break;
        }
      }

      return true;
    });

    return filtered.sort((a, b) => {
      // Prioritize active applications over completed ones (Paid/Rejected)
      const getPriority = (status) => {
        const s = status?.toLowerCase() || '';
        if (s === 'paid' || s === 'rejected') return 0; // Completed - Move to bottom
        return 1; // Active - Keep at top
      };

      const priorityA = getPriority(a.status);
      const priorityB = getPriority(b.status);

      if (priorityA !== priorityB) {
        return priorityB - priorityA; // Higher priority first
      }

      // Then sort by date descending
      const dateA = parseApplicationDate(a).getTime();
      const dateB = parseApplicationDate(b).getTime();

      return dateB - dateA;
    });
  };

  // Update the filtered applications to use enhanced filtering
  const filteredApplications = getFilteredApplications();

  // Pagination calculations
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredApplications.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredApplications.length / itemsPerPage);

  // Change page
  const paginate = (pageNumber: number) => setCurrentPage(pageNumber);

  const fullyApprovedApplications = getFullyApprovedApplications();

  // Pending payment requests count
  const pendingCount = paymentRequests.filter(p => p.status === 'pending').length;

  return (
    <div className="p-6">
      {/* Tab Navigation */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('applications')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${activeTab === 'applications'
              ? 'border-green-500 text-green-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
          >
            Salary Advance Applications
          </button>
          <RoleButtonWrapper allowedRoles={['ADMIN', 'CHECKER']}>
            <button
              onClick={() => setActiveTab('callbacks')}
              className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${activeTab === 'callbacks'
                ? 'border-green-500 text-green-600'
                : 'border-transparent text-blue-500 text-xs hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              <img src='M-PESA_LOGO-01.svg.png' className='w-14'></img> M-Pesa Results
            </button>
            <button
              onClick={() => setActiveTab('transaction_status')}
              className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${activeTab === 'transaction_status'
                ? 'border-green-500 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              <RefreshCw className="w-4 h-4" /> Transaction Status
            </button>
          </RoleButtonWrapper>

          <RoleButtonWrapper allowedRoles={['ADMIN']}>
            <button
              onClick={() => setActiveTab('settings')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${activeTab === 'settings'
                ? 'border-green-500 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              <Settings className="w-4 h-4 inline-block mr-1" />
              Settings
            </button>
          </RoleButtonWrapper>
        </nav>
      </div>

      {activeTab === 'settings' ? (
        <AdvanceApplicationManager />
      ) : activeTab === 'applications' ? (
        <div>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">


            <div className="flex items-center gap-3 flex-wrap">
              {/* Enhanced Filter Component */}
              <EnhancedFilter
                selectedTown={selectedTown}
                onTownChange={handleTownChange}
                allTowns={propAllTowns}
                userRole={userRole}
                userTown={userTown}
                isRegionalManager={isRegionalManager}
                selectedStatus={selectedStatus}
                onStatusChange={setSelectedStatus}
                selectedMonth={selectedMonth}
                onMonthChange={setSelectedMonth}
                selectedDateRange={selectedDateRange}
                onDateRangeChange={setSelectedDateRange}
                customStartDate={customStartDate}
                onCustomStartDateChange={setCustomStartDate}
                customEndDate={customEndDate}
                onCustomEndDateChange={setCustomEndDate}
              />

              {/* Export/Import Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => setShowExportModal(true)}
                  className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  <img src='logo (2).png' className='w-5'></img>
                  Export
                </button>
                <button
                  onClick={() => setShowImportModal(true)}
                  className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50"
                >

                  <img src='stats.png' className='w-5'></img>
                  Import
                </button>
              </div>

              {/* User Role Display */}
              <UserRoleDisplay
                userRole={userRole}
                userEmail={userEmail}
                actualRole={actualUserRole}
                userTown={userTown}
                userRegion={userRegion}
                isRegionalManager={isRegionalManager}
              />

              {/* Approval Queue Button for Checkers */}
              {(isChecker || isAdmin) && pendingCount > 0 && (
                <button
                  onClick={() => setShowApprovalQueue(true)}
                  className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 px-3 py-1"
                >
                  <AlertTriangle className="w-4 h-4 text-orange-600" />
                  <span className="text-xs font-medium text-orange-700">
                    {pendingCount} Pending Approvals
                  </span>
                </button>
              )}

              {fullyApprovedApplications.length > 0 && (
                <button
                  onClick={() => setShowBulkPaymentModal(true)}
                  className="flex items-center gap-2 bg-green-800 hover:bg-green-900 text-white px-4 py-2 rounded-md text-xs font-medium"
                >
                  <img src='M-PESA_LOGO-01.svg.png' className='w-12'></img>
                  {isMaker ? 'Create Payment Request' : 'Process Payments'} ({getSelectedStaffCount()})
                </button>
              )}

              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search applications..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500"
                />
              </div>
            </div>
          </div>

          {/* Role-based Information Panel */}
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center gap-2 text-xs text-blue-800">
              <Key className="w-4 h-4" />
              <span>
                <strong>Role:</strong> {userRole.replace(/_/g, ' ').toUpperCase()} |
                <strong> Actual Role:</strong> {actualUserRole} |
                <strong> Email:</strong> {userEmail}
                {userTown && ` | ${isRegionalManager ? 'Region' : 'Town'}: ${userTown}`}
              </span>
            </div>
          </div>

          {/* Custom Date Range Inputs */}
          {selectedDateRange === 'custom' && (
            <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-gray-600" />
                  <span className="text-xs font-medium text-gray-700">Custom Date Range:</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="border border-gray-300 rounded px-2 py-1 text-xs"
                  />
                  <span className="text-xs text-gray-500">to</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="border border-gray-300 rounded px-2 py-1 text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          {/* BORROWED FROM LEAVE MANAGEMENT: Auto-filter Notice for Managers */}
          {(isBranchManager || isRegionalManager) && selectedTown && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center gap-2 text-xs text-blue-800">
                <MapPin className="w-4 h-4" />
                <span>
                  {isRegionalManager
                    ? `Viewing applications for your region: ${selectedRegion || selectedTown}`
                    : `Viewing applications for your town: ${selectedTown}`
                  }
                  <span className="text-blue-600 ml-2">(Auto-filtered)</span>
                </span>
              </div>
            </div>
          )}

          {/* BORROWED FROM LEAVE MANAGEMENT: Manual Filter Display */}
          {!isBranchManager && !isRegionalManager && selectedTown && (
            <div className="mb-4 flex items-center gap-2">
              <span className="text-xs text-gray-600">Active filter:</span>
              <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">
                <MapPin className="w-3 h-3" />
                Town/Region: {getDisplayName(selectedTown)}
                <button
                  onClick={() => handleTownChange('')}
                  className="text-blue-600 hover:text-blue-800 ml-1"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            </div>
          )}

          {/* Payment Restriction Notice */}
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-center gap-2 text-xs text-amber-800">
              <Calendar className="w-4 h-4" />
              <span>
                <strong>Payment Restriction:</strong> Only salary advance applications from the current month ({new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}) can be processed for payment. Applications from previous months are disabled and shown with reduced opacity.
              </span>
            </div>
          </div>


          {/* Payment Approval Queue */}
          {showApprovalQueue && (isChecker || isAdmin) && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-orange-600" />
                  Payment Approval Queue
                  {isLoadingRequests && (
                    <Loader className="w-4 h-4 animate-spin text-gray-400" />
                  )}
                </h2>
                <button
                  onClick={() => setShowApprovalQueue(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              {paymentRequests.length > 0 ? (
                <div className="grid gap-4">
                  {paymentRequests
                    .filter(payment => payment.status === 'pending')
                    .map((payment) => (
                      <PaymentRequestCard
                        key={payment.id}
                        request={payment}
                        userRole={userRole}
                        onApprove={() => approvePayment(payment)}
                        onReject={() => {
                          setPaymentToReject(payment);
                          setShowRejectionModal(true);
                        }}
                        onViewDetails={() => {
                          setSelectedPaymentForDetails(payment);
                          setShowPaymentDetails(true);
                        }}
                      />
                    ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Clock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No pending payments</h3>
                  <p className="text-gray-600">All payment requests have been processed.</p>
                </div>
              )}
            </div>
          )}

          {/* Rest of your existing applications JSX */}
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-green-600"></div>
            </div>
          ) : filteredApplications.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No salary advance requests found.
              {selectedTown && (
                <p className="text-xs mt-2">
                  No applications found for {isRegionalManager ? 'region' : 'town'} "{getDisplayName(selectedTown)}". Try changing your filter or search term.
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Employee
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Mobile Number
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {isRegionalManager ? 'Region' : 'Branch'}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Amount
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Reason
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Approval Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Notes
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {currentItems.map((app) => {
                      const appDate = parseApplicationDate(app);
                      const now = new Date();
                      const isCurrentMonth = appDate.getMonth() === now.getMonth() && appDate.getFullYear() === now.getFullYear();

                      return (
                        <tr key={app.id} className={!isCurrentMonth ? "bg-gray-50 opacity-60 grayscale pointer-events-none" : ""}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <div>
                                <div className="text-xs font-medium text-gray-900">{app["Full Name"]}</div>
                                <div className="text-xs text-gray-500">{app["Employee Number"]}</div>
                              </div>
                              <ManagerBadge
                                isBranchManager={isBranchManagerMap[app["Employee Number"]] || false}
                                isRegionalManager={false}
                              />
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                            {employeeMobileNumbers[app["Employee Number"]] || 'N/A'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                            {app['Office Branch'] || app.Office_Branch || app.office_branch || 'N/A'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {editingId === app.id ? (
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={editedAmount}
                                  onChange={(e) => setEditedAmount(e.target.value)}
                                  className="w-24 p-1 border rounded text-xs"
                                />
                                <button
                                  onClick={() => handleAmountSave(app.id)}
                                  className="text-xs bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => setEditingId(null)}
                                  className="text-xs bg-gray-500 text-white px-2 py-1 rounded hover:bg-gray-600"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div
                                className="text-xs font-medium text-gray-900 cursor-pointer hover:underline"
                                onClick={() => handleAmountEdit(app.id, app["Amount Requested"])}
                              >
                                {formatKES(Number(app["Amount Requested"]))}
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 text-xs text-gray-500 max-w-xs truncate">
                            {app["Reason for Advance"]}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex flex-col gap-1">
                              <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getApprovalBadgeColor(getApprovalStatus(app))}`}>
                                {getApprovalStatus(app)}
                              </span>
                              <div className="flex items-center gap-2 text-xs text-gray-500">
                                <UserCheck className="h-3 w-3" />
                                <span>BM: {app.branch_manager_approval ? '✓' : (app.branch_manager_recommendation ? 'Recommended' : 'Pending')}</span>
                              </div>
                              <div className="flex items-center gap-2 text-xs text-gray-500">
                                <ShieldCheck className="h-3 w-3" />
                                <span>RM: {app.regional_manager_approval ? '✓' : (app.regional_manager_recommendation ? 'Recommended' : 'Pending')}</span>
                              </div>
                              {app.regional_manager_comment && (
                                <div className="flex items-center gap-2 text-xs text-blue-600">
                                  <Smartphone className="h-3 w-3" />
                                  <span>RM Comment: {app.regional_manager_comment}</span>
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap relative">
                            <div className="flex items-center">
                              <button
                                onClick={() => setShowNotesDropdown(showNotesDropdown === app.id ? null : app.id)}
                                className="flex items-center text-xs text-gray-500 hover:text-gray-700"
                              >
                                Notes <ChevronDown className="h-4 w-4 ml-1" />
                              </button>
                            </div>
                            {showNotesDropdown === app.id && (
                              <div className="absolute z-10 mt-2 w-64 bg-white shadow-lg rounded-md p-2 border border-gray-200">
                                <textarea
                                  value={notes[app.id] || ''}
                                  onChange={(e) => handleNoteChange(app.id, e.target.value)}
                                  placeholder="Add admin notes..."
                                  className="w-full p-2 border rounded text-xs mb-2"
                                  rows={3}
                                />
                                <div className="flex justify-end space-x-2">
                                  <button
                                    onClick={() => setShowNotesDropdown(null)}
                                    className="text-xs bg-gray-500 text-white px-2 py-1 rounded hover:bg-gray-600"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => saveNotes(app.id)}
                                    className="text-xs bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600"
                                  >
                                    Save
                                  </button>
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                            <div className="flex flex-col">
                              <span className="text-gray-900 font-medium">{parseApplicationDate(app).toLocaleDateString()}</span>
                              <span className="text-xs text-gray-500">{parseApplicationDate(app).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-xs font-medium">
                            <div className="flex flex-col gap-1">
                              {/* Branch Manager Actions */}
                              {canBranchManagerApprove(app) && (
                                <div className="flex flex-col gap-1">
                                  <button
                                    onClick={() => openRecommendationModal(app, 'bm-recommend-current')}
                                    className="text-green-600 hover:text-green-900 text-xs border border-green-200 px-2 py-1 rounded bg-green-50 flex items-center gap-1"
                                  >
                                    <CheckCircle className="w-3 h-3" />
                                    Recommend Current
                                  </button>
                                  <button
                                    onClick={() => openRecommendationModal(app, 'bm-recommend-adjusted')}
                                    className="text-blue-600 hover:text-blue-900 text-xs border border-blue-200 px-2 py-1 rounded bg-blue-50 flex items-center gap-1"
                                  >
                                    <Edit3 className="w-3 h-3" />
                                    Recommend Adjusted
                                  </button>
                                  <button
                                    onClick={() => openRecommendationModal(app, 'bm-recommend-reject')}
                                    className="text-red-600 hover:text-red-900 text-xs border border-red-200 px-2 py-1 rounded bg-red-50 flex items-center gap-1"
                                  >
                                    <XCircleIcon className="w-3 h-3" />
                                    Recommend Reject
                                  </button>
                                </div>
                              )}

                              {/* Regional Manager Actions */}
                              {canRegionalManagerApprove(app) && (
                                <div className="flex flex-col gap-1">
                                  <button
                                    onClick={() => openRecommendationModal(app, 'rm-recommend-current')}
                                    className="text-green-600 hover:text-green-900 text-xs border border-green-200 px-2 py-1 rounded bg-green-50 flex items-center gap-1"
                                  >
                                    <CheckCircle className="w-3 h-3" />
                                    Recommend Current
                                  </button>
                                  <button
                                    onClick={() => openRecommendationModal(app, 'rm-recommend-adjusted')}
                                    className="text-blue-600 hover:text-blue-900 text-xs border border-blue-200 px-2 py-1 rounded bg-blue-50 flex items-center gap-1"
                                  >
                                    <Edit3 className="w-3 h-3" />
                                    Recommend Adjusted
                                  </button>
                                  <button
                                    onClick={() => openRecommendationModal(app, 'rm-recommend-reject')}
                                    className="text-red-600 hover:text-red-900 text-xs border border-red-200 px-2 py-1 rounded bg-red-50 flex items-center gap-1"
                                  >
                                    <XCircleIcon className="w-3 h-3" />
                                    Recommend Reject
                                  </button>
                                </div>
                              )}

                              {/* Regional Manager Comment Action */}
                              {canRegionalManagerComment(app) && (
                                <button
                                  onClick={() => openCommentModal(app)}
                                  className="text-blue-600 hover:text-blue-900 text-xs border border-blue-200 px-2 py-1 rounded bg-blue-50 flex items-center gap-1"
                                >
                                  <Smartphone className="w-3 h-3" />
                                  Add Comment
                                </button>
                              )}

                              {/* Admin Final Approval Action */}
                              {canAdminApprove(app) && (
                                <div className="flex flex-col gap-1">
                                  <button
                                    onClick={() => openRecommendationModal(app, 'admin-approve-current')}
                                    className="text-green-600 hover:text-green-900 text-xs border border-green-200 px-2 py-1 rounded bg-green-50 flex items-center gap-1"
                                  >
                                    <CheckCircle className="w-3 h-3" />
                                    Approve Current
                                  </button>
                                  <button
                                    onClick={() => openRecommendationModal(app, 'admin-approve-adjusted')}
                                    className="text-blue-600 hover:text-blue-900 text-xs border border-blue-200 px-2 py-1 rounded bg-blue-50 flex items-center gap-1"
                                  >
                                    <Edit3 className="w-3 h-3" />
                                    Approve Adjusted
                                  </button>
                                  <button
                                    onClick={() => openRecommendationModal(app, 'admin-reject')}
                                    className="text-red-600 hover:text-red-900 text-xs border border-red-200 px-2 py-1 rounded bg-red-50 flex items-center gap-1"
                                  >
                                    <XCircleIcon className="w-3 h-3" />
                                    Reject
                                  </button>
                                </div>
                              )}

                              {/* Self-approval warning */}
                              {checkIfSelfApproval(app) && !['paid', 'rejected'].includes(app.status?.toLowerCase()) && (
                                <span className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded border border-red-200">
                                  Cannot approve own request
                                </span>
                              )}

                              {/* No actions available message */}
                              {/* Terminal Statuses or Ready for Payment */}
                              {app.status?.toLowerCase() === 'paid' && (
                                <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded border border-green-200 flex items-center gap-1">
                                  <CheckCircle className="w-3 h-3" />
                                  Payment Processed
                                </span>
                              )}

                              {['approved', 'fully approved'].includes(app.status?.toLowerCase()) && (
                                <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-200 flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  Ready for Payment
                                </span>
                              )}

                              {app.status?.toLowerCase() === 'rejected' && (
                                <span className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded border border-red-200 flex items-center gap-1">
                                  <XCircleIcon className="w-3 h-3" />
                                  Request Rejected
                                </span>
                              )}

                              {/* No actions available message (Only for true pending states) */}
                              {!canBranchManagerApprove(app) && !canRegionalManagerApprove(app) && !canRegionalManagerComment(app) && !canAdminApprove(app) &&
                                !['paid', 'approved', 'fully approved', 'rejected'].includes(app.status?.toLowerCase()) && !checkIfSelfApproval(app) && (
                                  <span className="text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded border border-gray-200 flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    Awaiting approval
                                  </span>
                                )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center mt-6 px-4 py-4">
                  {/* Mobile pagination */}
                  <div className="flex items-center justify-between w-full sm:hidden">
                    <button
                      onClick={() => paginate(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="relative inline-flex items-center px-3 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Previous
                    </button>
                    <span className="text-xs text-gray-700">
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      onClick={() => paginate(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="relative inline-flex items-center px-3 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </button>
                  </div>

                  {/* Desktop pagination */}
                  <div className="hidden sm:flex sm:flex-col sm:items-center sm:gap-3">
                    <p className="text-xs text-gray-700">
                      Showing <span className="font-medium">{indexOfFirstItem + 1}</span> to{' '}
                      <span className="font-medium">
                        {Math.min(indexOfLastItem, filteredApplications.length)}
                      </span>{' '}
                      of <span className="font-medium">{filteredApplications.length}</span> results
                    </p>
                    <nav className="inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
                      <button
                        onClick={() => paginate(currentPage - 1)}
                        disabled={currentPage === 1}
                        className="relative inline-flex items-center px-2 py-2 text-xs font-medium text-gray-500 bg-white border border-gray-300 rounded-l-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <span className="sr-only">Previous</span>
                        <ChevronLeft className="h-4 w-4" />
                      </button>

                      {/* Page numbers - show limited set for better layout */}
                      {(() => {
                        const maxVisible = 5;
                        let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
                        let endPage = Math.min(totalPages, startPage + maxVisible - 1);

                        if (endPage - startPage < maxVisible - 1) {
                          startPage = Math.max(1, endPage - maxVisible + 1);
                        }

                        const pages = [];

                        // First page
                        if (startPage > 1) {
                          pages.push(
                            <button
                              key={1}
                              onClick={() => paginate(1)}
                              className="relative inline-flex items-center px-3 py-2 text-xs font-medium bg-white border-gray-300 text-gray-500 hover:bg-gray-50 border"
                            >
                              1
                            </button>
                          );
                          if (startPage > 2) {
                            pages.push(
                              <span key="dots1" className="relative inline-flex items-center px-3 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300">
                                ...
                              </span>
                            );
                          }
                        }

                        // Visible pages
                        for (let i = startPage; i <= endPage; i++) {
                          pages.push(
                            <button
                              key={i}
                              onClick={() => paginate(i)}
                              className={`relative inline-flex items-center px-3 py-2 text-xs font-medium ${currentPage === i
                                ? 'z-10 bg-green-50 border-green-500 text-green-600'
                                : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                                } border`}
                            >
                              {i}
                            </button>
                          );
                        }

                        // Last page
                        if (endPage < totalPages) {
                          if (endPage < totalPages - 1) {
                            pages.push(
                              <span key="dots2" className="relative inline-flex items-center px-3 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300">
                                ...
                              </span>
                            );
                          }
                          pages.push(
                            <button
                              key={totalPages}
                              onClick={() => paginate(totalPages)}
                              className="relative inline-flex items-center px-3 py-2 text-xs font-medium bg-white border-gray-300 text-gray-500 hover:bg-gray-50 border"
                            >
                              {totalPages}
                            </button>
                          );
                        }

                        return pages;
                      })()}

                      <button
                        onClick={() => paginate(currentPage + 1)}
                        disabled={currentPage === totalPages}
                        className="relative inline-flex items-center px-2 py-2 text-xs font-medium text-gray-500 bg-white border border-gray-300 rounded-r-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <span className="sr-only">Next</span>
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </nav>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Enhanced Bulk Payment Modal with Search */}
          <BulkPaymentModal
            isOpen={showBulkPaymentModal}
            onClose={() => {
              setShowBulkPaymentModal(false);
              setJustification('');
            }}
            onProcess={handleBulkPayment}
            isLoading={isProcessingBulkPayment}
            applications={applications}
            selectedStaff={selectedStaff}
            onToggleStaff={toggleStaffSelection}
            onSelectAll={selectAllStaff}
            onDeselectAll={deselectAllStaff}
            employeeMobileNumbers={employeeMobileNumbers}
            isBranchManagerMap={isBranchManagerMap}
            justification={justification}
            onJustificationChange={setJustification}
            userRole={userRole}
          />

          {/* Payment Details Modal */}
          <PaymentDetailsModal
            payment={selectedPaymentForDetails}
            isOpen={showPaymentDetails}
            onClose={() => setShowPaymentDetails(false)}
            onApprove={() => {
              approvePayment(selectedPaymentForDetails);
              setShowPaymentDetails(false);
            }}
            onReject={() => {
              setPaymentToReject(selectedPaymentForDetails);
              setShowRejectionModal(true);
              setShowPaymentDetails(false);
            }}
            userRole={userRole}
          />

          {/* Rejection Modal */}
          <RejectionModal
            isOpen={showRejectionModal}
            onClose={() => setShowRejectionModal(false)}
            onConfirm={(reason) => {
              rejectPayment(paymentToReject, reason);
              setPaymentToReject(null);
            }}
          />

          {/* Recommendation Modal */}
          <RecommendationModal
            isOpen={showRecommendationModal}
            onClose={() => setShowRecommendationModal(false)}
            onConfirm={handleRecommendation}
            application={selectedApplication}
            actionType={recommendationAction}
            currentAmount={selectedApplication?.["Amount Requested"]}
          />

          {/* Comment Modal */}
          <CommentModal
            isOpen={showCommentModal}
            onClose={() => setShowCommentModal(false)}
            onConfirm={handleComment}
            application={selectedApplication}
          />

          {/* Export Modal */}
          <ExportModal
            isOpen={showExportModal}
            onClose={() => setShowExportModal(false)}
            onExport={handleExport}
            isLoading={isExporting}
            filterOptions={{ allTowns: propAllTowns }}
          />

          {/* Import Modal */}
          <ImportModal
            isOpen={showImportModal}
            onClose={() => setShowImportModal(false)}
            onImport={handleImport}
            isLoading={isImporting}
          />
        </div>
      ) : activeTab === 'callbacks' ? (
        <MpesaCallbacks filterType="payments" />
      ) : activeTab === 'transaction_status' ? (
        <TransactionStatusChecker />
      ) : (
        <MpesaCallbacks filterType="all" />
      )}
    </div>
  );
};

export default SalaryAdvanceAdmin;