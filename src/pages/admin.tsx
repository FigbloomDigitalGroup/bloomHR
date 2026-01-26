import { useState, useEffect } from 'react';
import { supabase, supabaseAdmin } from '../lib/supabase';
import toast from 'react-hot-toast';
import { sendEmail } from '../services/email';
import {
  Users,
  FileText,
  Clock,
  Building,
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
  Eye,
  Table,
  Radio,
  Wifi,
  WifiOff,
  ChevronLeft,
  ChevronRight,
  Filter,
  Search,
  ChevronDown,
  CheckSquare,
  Square,
  RefreshCw,
  AlertTriangle,
  Key,
  Upload,
  Download,
  X,
  Mail
} from 'lucide-react';

// You'll need to install these dependencies:
// npm install xlsx file-saver
import * as XLSX from 'xlsx';

import { saveAs } from 'file-saver';
import EmailDashboard from '../components/Email/EmailDashboard';

export default function StaffSignupRequests() {
  const [requests, setRequests] = useState<any[]>([]);
  const [allBranches, setAllBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [processingId, setProcessingId] = useState(null);
  const [selectedBranch, setSelectedBranch] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRequests, setSelectedRequests] = useState(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [checkingExistingUsers, setCheckingExistingUsers] = useState(false);
  const [existingUsersCache, setExistingUsersCache] = useState(new Map());
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [bulkEmails, setBulkEmails] = useState('');
  const [bulkBranch, setBulkBranch] = useState('');
  const [uploadingBulk, setUploadingBulk] = useState(false);
  const [emailLogs, setEmailLogs] = useState(new Map());
  const [checkingBounces, setCheckingBounces] = useState(false);
  const [uploadMethod, setUploadMethod] = useState('excel');
  const [excelFile, setExcelFile] = useState(null);
  const [parsedData, setParsedData] = useState([]);
  const [parsingExcel, setParsingExcel] = useState(false);
  const [webhookEnabled, setWebhookEnabled] = useState(true);
  const [webhookStats, setWebhookStats] = useState({
    total: 0,
    bounced: 0,
    delivered: 0,
    sent: 0,
    lastUpdate: null
  });
  const [filterBounced, setFilterBounced] = useState(false);
  const [activeTab, setActiveTab] = useState<'requests' | 'emails'>('requests');

  const itemsPerPage = 100;

  useEffect(() => {
    fetchRequests();
    fetchBranches();
    setupRealtimeSubscription();
  }, [currentPage, selectedBranch]);

  // Set up real-time subscription for email logs
  const setupRealtimeSubscription = () => {
    const subscription = supabase
      .channel('email_logs_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'email_logs',
        },
        (payload) => {
          console.log('Real-time email log update:', payload);

          // Update local email logs state
          const updatedLogs = new Map(emailLogs);
          const rawSentTo = payload.new ? (payload.new.sent_to || payload.new.email) : null;

          if (rawSentTo) {
            const emailKey = rawSentTo.toLowerCase();

            updatedLogs.set(emailKey, {
              ...payload.new,
              request_id: payload.new.request_id ? payload.new.request_id.toString() : null,
              message_id: payload.new.message_id || payload.new.resend_id
            });

            setEmailLogs(updatedLogs);
            updateWebhookStats(updatedLogs);

            // Show notification for new bounces
            if (payload.new.status === 'bounced' && payload.eventType === 'UPDATE') {
              toast.error(`Email bounced for ${rawSentTo}: ${payload.new.bounce_reason || 'Unknown reason'}`, {
                duration: 6000,
                icon: '🚫'
              });

              // Refresh requests to update UI
              fetchRequests();
            }

            // Show notification for deliveries
            if (payload.new.status === 'delivered' && payload.eventType === 'UPDATE') {
              toast.success(`Email delivered to ${rawSentTo}`, {
                duration: 3000,
                icon: '✅'
              });
            }
          }
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  };

  // Update webhook statistics
  const updateWebhookStats = (logsMap = emailLogs) => {
    const logsArray = Array.from(logsMap.values());
    setWebhookStats({
      total: logsArray.length,
      bounced: logsArray.filter(log => log.status === 'bounced').length,
      delivered: logsArray.filter(log => log.status === 'delivered').length,
      sent: logsArray.filter(log => log.status === 'sent').length,
      lastUpdate: new Date() as any
    });
  };

  // Fetch email logs for bounce detection
  const fetchEmailLogs = async () => {
    try {
      const { data, error } = await supabase
        .from('email_logs')
        .select('*')
        .order('sent_at', { ascending: false });

      if (error) throw error;

      const logsMap = new Map();
      data.forEach(log => {
        const emailKey = (log.sent_to || log.email || '').toLowerCase();
        if (emailKey) {
          logsMap.set(emailKey, {
            ...log,
            request_id: log.request_id ? log.request_id.toString() : null,
            message_id: log.message_id || log.resend_id
          });
        }
      });
      setEmailLogs(logsMap);
      updateWebhookStats(logsMap);
    } catch (error) {
      console.error('Error fetching email logs:', error);
    }
  };

  const fetchBranches = async () => {
    try {
      const { data, error } = await supabase
        .from('staff_signup_requests')
        .select('branch')
        .eq('status', 'pending');

      if (error) throw error;

      const uniqueBranches = [...new Set(data
        .map(item => item.branch)
        .filter(branch => branch != null && branch.trim() !== '')
      )].sort();
      setAllBranches(uniqueBranches);
    } catch (error) {
      console.error('Fetch branches error:', error);
    }
  };

  const fetchRequests = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('staff_signup_requests')
        .select('*', { count: 'exact' })
        .eq('status', 'pending');

      if (selectedBranch !== 'all') {
        query = query.eq('branch', selectedBranch);
      }

      const from = (currentPage - 1) * itemsPerPage;
      const to = from + itemsPerPage - 1;

      const { data, error, count } = await query
        .order('created_at', { ascending: true })
        .range(from, to);

      if (error) throw error;

      const requestsWithStringIds = (data || []).map(request => ({
        ...request,
        id: request.id.toString()
      }));

      setRequests(requestsWithStringIds);
      setTotalCount(count || 0);
      setSelectedRequests(new Set());

      await fetchEmailLogs();
    } catch (error) {
      console.error('Fetch error:', error);
      toast.error('Failed to fetch signup requests');
    } finally {
      setLoading(false);
    }
  };

  // Track email sends in database
  const trackEmailSend = async (email: any, subject: any, requestId: any = null, resendId: any = null) => {
    try {
      const requestIdBigInt = requestId ? parseInt(requestId, 10) : null;
      const client = supabaseAdmin || supabase;

      const { data, error } = await client
        .from('email_logs')
        .insert([
          {
            sent_to: email,
            subject: subject,
            request_id: requestIdBigInt,
            message_id: resendId,
            status: 'sent',
            sent_at: new Date().toISOString()
          }
        ])
        .select();

      if (error) throw error;

      if (data && data.length > 0) {
        const newLog = data[0];
        const updatedLogs = new Map(emailLogs);
        updatedLogs.set(email.toLowerCase(), {
          ...newLog,
          request_id: newLog.request_id ? newLog.request_id.toString() : null
        });
        setEmailLogs(updatedLogs);
        updateWebhookStats(updatedLogs);
      }

      return data;
    } catch (error) {
      console.error('Error tracking email:', error);
    }
  };

  // Update email status when bounce is detected
  const updateEmailStatus = async (email: any, status: any, bounceReason: any = null) => {
    try {
      const { data, error } = await supabase
        .from('email_logs')
        .update({
          status: status,
          bounce_reason: bounceReason,
          bounced_at: status === 'bounced' ? new Date().toISOString() : null
        })
        .eq('sent_to', email)
        .order('sent_at', { ascending: false })
        .limit(1)
        .select();

      if (error) throw error;

      if (data && data.length > 0) {
        const updatedLog = data[0];
        const updatedLogs = new Map(emailLogs);
        updatedLogs.set(email.toLowerCase(), {
          ...updatedLog,
          request_id: updatedLog.request_id ? updatedLog.request_id.toString() : null
        });
        setEmailLogs(updatedLogs);
        updateWebhookStats(updatedLogs);
      }

      return data;
    } catch (error) {
      console.error('Error updating email status:', error);
    }
  };

  // Get all auth users with pagination
  const getAllAuthUsers = async () => {
    let allUsers = [];
    let page = 1;
    const perPage = 1000;
    let hasMore = true;

    try {
      while (hasMore) {
        const { data: users, error } = await supabaseAdmin.auth.admin.listUsers({
          page: page,
          perPage: perPage
        });

        if (error) {
          console.error('Error fetching auth users page', page, error);
          break;
        }

        if (users && users.users.length > 0) {
          allUsers = [...allUsers, ...users.users];
          page++;

          if (users.users.length < perPage) {
            hasMore = false;
          }
        } else {
          hasMore = false;
        }
      }

      console.log(`Fetched ${allUsers.length} total auth users`);
      return allUsers;
    } catch (error) {
      console.error('Error in getAllAuthUsers:', error);
      return [];
    }
  };

  // Check if user exists and return user data
  const checkExistingUser = async (email) => {
    try {
      let allAuthUsers;
      if (existingUsersCache.size > 0) {
        allAuthUsers = Array.from(existingUsersCache.values());
      } else {
        allAuthUsers = await getAllAuthUsers();
        const newCache = new Map();
        allAuthUsers.forEach(user => {
          if (user.email) {
            newCache.set(user.email.toLowerCase(), user);
          }
        });
        setExistingUsersCache(newCache);
      }

      const normalizedEmail = email.toLowerCase();
      const existingAuthUser = allAuthUsers.find(user =>
        user.email && user.email.toLowerCase() === normalizedEmail
      );

      if (existingAuthUser) {
        return {
          exists: true,
          type: 'auth',
          user: existingAuthUser,
          message: 'User already has an auth account'
        };
      }

      return {
        exists: false,
        type: null,
        user: null,
        message: 'User does not exist in system'
      };
    } catch (error) {
      console.error('Error checking existing user:', error);
      return {
        exists: false,
        type: 'error',
        user: null,
        message: 'Error checking user existence'
      };
    }
  };

  // Check all pending requests for existing users
  const checkAllExistingUsers = async () => {
    setCheckingExistingUsers(true);
    try {
      setExistingUsersCache(new Map());

      const results = [];
      let foundCount = 0;

      const allAuthUsers = await getAllAuthUsers();
      const authUserEmails = new Set(
        allAuthUsers
          .filter(user => user.email)
          .map(user => user.email.toLowerCase())
      );

      for (const request of requests) {
        const normalizedEmail = request.email.toLowerCase();
        const exists = authUserEmails.has(normalizedEmail);
        const existingUser = allAuthUsers.find(user =>
          user.email && user.email.toLowerCase() === normalizedEmail
        );

        results.push({
          ...request,
          existingUser: {
            exists,
            type: exists ? 'auth' : null,
            user: existingUser || null,
            message: exists ? 'User already has an auth account' : 'User does not exist in system'
          }
        });

        if (exists) {
          foundCount++;
        }
      }

      setRequests(results);

      if (foundCount > 0) {
        toast.success(`Found ${foundCount} users already in the system`);
      } else {
        toast.success('No existing users found in the system');
      }
    } catch (error) {
      console.error('Error checking all users:', error);
      toast.error('Failed to check for existing users');
    } finally {
      setCheckingExistingUsers(false);
    }
  };

  // Webhook-based status check
  const checkWebhookStatus = async () => {
    setCheckingBounces(true);
    try {
      await fetchEmailLogs();
      await fetchRequests();

      const bounceCount = webhookStats.bounced;

      if (bounceCount > 0) {
        toast.info(`Webhooks detected ${bounceCount} bounced emails`);
      } else {
        toast.success('No bounced emails detected via webhooks');
      }
    } catch (error) {
      console.error('Error checking webhook status:', error);
      toast.error('Failed to check email status');
    } finally {
      setCheckingBounces(false);
    }
  };

  const generateRandomPassword = () => {
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numbers = '0123456789';
    const symbols = '!@#$%&*';
    const allChars = lowercase + uppercase + numbers + symbols;

    let password = '';

    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += symbols[Math.floor(Math.random() * symbols.length)];

    for (let i = 4; i < 12; i++) {
      password += allChars[Math.floor(Math.random() * allChars.length)];
    }

    return password.split('').sort(() => 0.5 - Math.random()).join('');
  };

  const sendWelcomeEmail = async (email, tempPassword, branch, isResend = false, requestId = null) => {
    const subject = isResend
      ? `Your Zira HR Login Credentials - Resent`
      : `Welcome to Zira HR - Staff Account Approved`;

    try {
      const htmlContent = isResend ? `
        <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #2563eb; text-align: center;">Your Zira HR Login Credentials</h2>
          <p style="font-size: 16px;">Your login credentials have been resent as requested.</p>
          
          <div style="background-color: #fef3cd; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #f59e0b;">
            <p style="font-weight: bold; margin-bottom: 8px; color: #92400e;">Your login credentials:</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Temporary Password:</strong> ${tempPassword}</p>
          </div>
          
          <p style="font-size: 14px; color: #64748b;">Please log in and change your password immediately for security reasons.</p>
          <p style="font-size: 14px;"><strong>Assigned Branch:</strong> ${branch}</p>
          
          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
            <p>If you didn't request these credentials, please contact our support team immediately.</p>
          </div>
        </div>
      ` : `
        <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #2563eb; text-align: center;">Welcome to Zira HR!</h2>
          <p style="font-size: 16px;">Your staff account has been approved by the administrator.</p>
          
          <div style="background-color: #f8fafc; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="font-weight: bold; margin-bottom: 8px;">Your login credentials:</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Temporary Password:</strong> ${tempPassword}</p>
          </div>
          
          <p style="font-size: 14px; color: #64748b;">Please log in and change your password immediately for security reasons.</p>
          <p style="font-size: 14px;"><strong>Assigned Branch:</strong> ${branch}</p>
          
          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
            <p>If you didn't request this account, please contact our support team immediately.</p>
          </div>
        </div>
      `;

      const result = await sendEmail({
        to: email,
        subject: subject,
        html: htmlContent
      });

      await trackEmailSend(
        email,
        subject,
        requestId,
        result.id || null
      );

      return result;
    } catch (error) {
      console.error('Email sending error:', error);
      await trackEmailSend(email, subject, requestId, null);
      throw error;
    }
  };

  const handleProcessRequest = async (requestId, email, branch) => {
    setProcessingId(requestId);
    const tempPassword = generateRandomPassword();

    try {
      const existingUserCheck = await checkExistingUser(email);

      if (existingUserCheck.exists) {
        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
          existingUserCheck.user.id,
          {
            password: tempPassword,
            user_metadata: {
              ...existingUserCheck.user.user_metadata,
              role: 'STAFF',
              branch: branch || 'Main Branch',
              updated_at: new Date().toISOString()
            }
          }
        );

        if (updateError) throw updateError;

        const { error: deleteError } = await supabase
          .from('staff_signup_requests')
          .delete()
          .eq('id', parseInt(requestId, 10));

        if (deleteError) throw deleteError;

        await sendWelcomeEmail(email, tempPassword, branch || 'Main Branch', true, requestId);
        toast.success(`Credentials updated and resent to ${email}`);

      } else {
        const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: {
            role: 'STAFF',
            branch: branch || 'Main Branch'
          }
        });

        if (userError) {
          if (userError.message.includes('already registered') || userError.status === 422) {
            toast.error(`User ${email} was just created by another process. Please try again.`);
            return;
          }
          throw userError;
        }

        const { error: deleteError } = await supabase
          .from('staff_signup_requests')
          .delete()
          .eq('id', parseInt(requestId, 10));

        if (deleteError) throw deleteError;

        await sendWelcomeEmail(email, tempPassword, branch || 'Main Branch', false, requestId);
        toast.success(`Account created! Welcome email sent to ${email}`);
      }

      fetchRequests();
      fetchBranches();
      setExistingUsersCache(new Map());

    } catch (error) {
      console.error('Process request error:', error);
      toast.error(`Failed to process request: ${error.message}`);
    } finally {
      setProcessingId(null);
    }
  };

  const handleBulkProcess = async () => {
    if (selectedRequests.size === 0) {
      toast.error('Please select at least one request to process');
      return;
    }

    setBulkProcessing(true);
    const selectedRequestsArray = Array.from(selectedRequests);
    let successCount = 0;
    let errorCount = 0;
    let updatedExistingCount = 0;
    let createdNewCount = 0;

    try {
      const allAuthUsers = await getAllAuthUsers();
      const authUserMap = new Map();
      allAuthUsers.forEach(user => {
        if (user.email) {
          authUserMap.set(user.email.toLowerCase(), user);
        }
      });

      const requestsToProcess = requests.filter(req => selectedRequests.has(req.id));

      for (const request of requestsToProcess) {
        try {
          const tempPassword = generateRandomPassword();
          const normalizedEmail = request.email.toLowerCase();
          const existingUser = authUserMap.get(normalizedEmail);

          if (existingUser) {
            const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
              existingUser.id,
              {
                password: tempPassword,
                user_metadata: {
                  ...existingUser.user_metadata,
                  role: 'STAFF',
                  branch: request.branch || 'Main Branch',
                  updated_at: new Date().toISOString()
                }
              }
            );

            if (updateError) throw updateError;
            updatedExistingCount++;
          } else {
            const { error: userError } = await supabaseAdmin.auth.admin.createUser({
              email: request.email,
              password: tempPassword,
              email_confirm: true,
              user_metadata: {
                role: 'STAFF',
                branch: request.branch || 'Main Branch'
              }
            });

            if (userError) {
              if (userError.message.includes('already registered') || userError.status === 422) {
                continue;
              }
              throw userError;
            }
            createdNewCount++;
          }

          const { error: deleteError } = await supabase
            .from('staff_signup_requests')
            .delete()
            .eq('id', parseInt(request.id, 10));

          if (deleteError) throw deleteError;

          await sendWelcomeEmail(request.email, tempPassword, request.branch || 'Main Branch', !!existingUser, request.id);
          successCount++;
        } catch (error) {
          console.error(`Failed to process request ${request.id}:`, error);
          errorCount++;
        }
      }

      let message = `Successfully processed ${successCount} request(s)`;
      if (createdNewCount > 0) {
        message += ` - ${createdNewCount} new accounts created`;
      }
      if (updatedExistingCount > 0) {
        message += ` - ${updatedExistingCount} existing accounts updated`;
      }

      toast.success(message);

      if (errorCount > 0) {
        toast.error(`Failed to process ${errorCount} request(s)`);
      }

      fetchRequests();
      fetchBranches();
      setSelectedRequests(new Set());
      setExistingUsersCache(new Map());
    } catch (error) {
      console.error('Bulk process error:', error);
      toast.error('Bulk process failed');
    } finally {
      setBulkProcessing(false);
    }
  };

  // Download Excel template
  const downloadExcelTemplate = () => {
    const templateData = [
      {
        'Email': 'john.doe@company.com',
        'Branch': 'Main Branch',
        'Notes': 'HR Manager'
      },
      {
        'Email': 'jane.smith@company.com',
        'Branch': 'New York Office',
        'Notes': 'Sales Executive'
      },
      {
        'Email': 'mike.wilson@company.com',
        'Branch': 'London Office',
        'Notes': 'IT Support'
      }
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(templateData);

    const colWidths = [
      { wch: 25 },
      { wch: 20 },
      { wch: 30 }
    ];
    ws['!cols'] = colWidths;

    const instructionsData = [
      ['Instructions for Bulk Upload:'],
      [''],
      ['1. Fill in the "Staff Emails" sheet with staff information'],
      ['2. Required columns: Email, Branch'],
      ['3. Optional column: Notes (for internal reference)'],
      ['4. Save the file and upload it using the form'],
      ['5. All emails will be created as pending signup requests'],
      [''],
      ['Column Descriptions:'],
      ['- Email: Staff email address (required)'],
      ['- Branch: Assigned branch/department (required)'],
      ['- Notes: Any additional information (optional)'],
      [''],
      ['Example:'],
      ['Email', 'Branch', 'Notes'],
      ['john.doe@company.com', 'Main Branch', 'HR Manager'],
      ['jane.smith@company.com', 'New York Office', 'Sales Executive']
    ];

    const wsInstructions = XLSX.utils.aoa_to_sheet(instructionsData);
    const instructionColWidths = [
      { wch: 50 }
    ];
    wsInstructions['!cols'] = instructionColWidths;

    XLSX.utils.book_append_sheet(wb, ws, 'Staff Emails');
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    saveAs(blob, 'staff_bulk_upload_template.xlsx');
  };

  // Parse Excel file
  const parseExcelFile = (file) => {
    setParsingExcel(true);
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });

        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        const validatedData = jsonData
          .map((row, index) => {
            const email = row['Email'] || row['email'];
            const branch = row['Branch'] || row['branch'] || bulkBranch;

            if (!email) {
              console.warn(`Row ${index + 2}: Missing email address`);
              return null;
            }

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
              console.warn(`Row ${index + 2}: Invalid email format - ${email}`);
              return null;
            }

            return {
              email: email.trim(),
              branch: branch ? branch.trim() : bulkBranch,
              notes: row['Notes'] || row['notes'] || ''
            };
          })
          .filter(row => row !== null);

        setParsedData(validatedData);
        setExcelFile(file);

        if (validatedData.length === 0) {
          toast.error('No valid email addresses found in the Excel file');
        } else {
          toast.success(`Found ${validatedData.length} valid staff records`);
        }
      } catch (error) {
        console.error('Error parsing Excel file:', error);
        toast.error('Error reading Excel file. Please check the format.');
      } finally {
        setParsingExcel(false);
      }
    };

    reader.onerror = () => {
      toast.error('Error reading file');
      setParsingExcel(false);
    };

    reader.readAsArrayBuffer(file);
  };

  // Handle Excel file upload
  const handleExcelUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.match(/\.(xlsx|xls)$/)) {
      toast.error('Please upload a valid Excel file (.xlsx or .xls)');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size must be less than 5MB');
      return;
    }

    parseExcelFile(file);
  };

  // Handle bulk upload from Excel
  const handleBulkUploadFromExcel = async () => {
    if (parsedData.length === 0) {
      toast.error('No valid data to upload');
      return;
    }

    if (!bulkBranch.trim() && parsedData.some(item => !item.branch)) {
      toast.error('Please set a default branch or ensure all records have a branch');
      return;
    }

    setUploadingBulk(true);

    try {
      let successCount = 0;
      let duplicateCount = 0;
      let errorCount = 0;

      const { data: existingRequests, error: fetchError } = await supabase
        .from('staff_signup_requests')
        .select('email')
        .eq('status', 'pending');

      if (fetchError) throw fetchError;

      const existingEmails = new Set(
        (existingRequests || []).map(req => req.email.toLowerCase())
      );

      for (const record of parsedData) {
        try {
          const finalBranch = record.branch || bulkBranch;

          if (existingEmails.has(record.email.toLowerCase())) {
            duplicateCount++;
            continue;
          }

          const { error: insertError } = await supabase
            .from('staff_signup_requests')
            .insert([
              {
                email: record.email,
                branch: finalBranch,
                status: 'pending',
                created_at: new Date().toISOString()
              }
            ]);

          if (insertError) {
            if (insertError.code === '23505') {
              duplicateCount++;
            } else {
              throw insertError;
            }
          } else {
            successCount++;
          }
        } catch (error) {
          console.error(`Error adding email ${record.email}:`, error);
          errorCount++;
        }
      }

      let message = `Successfully added ${successCount} staff records`;
      if (duplicateCount > 0) {
        message += ` - ${duplicateCount} duplicates skipped`;
      }
      if (errorCount > 0) {
        message += ` - ${errorCount} errors`;
      }

      toast.success(message);

      setExcelFile(null);
      setParsedData([]);
      setShowBulkUpload(false);
      fetchRequests();
      fetchBranches();

    } catch (error) {
      console.error('Bulk upload error:', error);
      toast.error('Failed to upload staff records');
    } finally {
      setUploadingBulk(false);
    }
  };

  // Handle manual bulk upload
  const handleManualBulkUpload = async () => {
    if (!bulkEmails.trim()) {
      toast.error('Please enter at least one email address');
      return;
    }

    if (!bulkBranch.trim()) {
      toast.error('Please select a branch for the users');
      return;
    }

    setUploadingBulk(true);

    try {
      const emailList = bulkEmails
        .split(/[\n,;]+/)
        .map(email => email.trim())
        .filter(email => {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          return email && emailRegex.test(email);
        });

      if (emailList.length === 0) {
        toast.error('No valid email addresses found');
        return;
      }

      let successCount = 0;
      let duplicateCount = 0;
      let errorCount = 0;

      const { data: existingRequests, error: fetchError } = await supabase
        .from('staff_signup_requests')
        .select('email')
        .eq('status', 'pending');

      if (fetchError) throw fetchError;

      const existingEmails = new Set(
        (existingRequests || []).map(req => req.email.toLowerCase())
      );

      for (const email of emailList) {
        try {
          if (existingEmails.has(email.toLowerCase())) {
            duplicateCount++;
            continue;
          }

          const { error: insertError } = await supabase
            .from('staff_signup_requests')
            .insert([
              {
                email: email,
                branch: bulkBranch,
                status: 'pending',
                created_at: new Date().toISOString()
              }
            ]);

          if (insertError) {
            if (insertError.code === '23505') {
              duplicateCount++;
            } else {
              throw insertError;
            }
          } else {
            successCount++;
          }
        } catch (error) {
          console.error(`Error adding email ${email}:`, error);
          errorCount++;
        }
      }

      let message = `Successfully added ${successCount} signup request(s)`;
      if (duplicateCount > 0) {
        message += ` - ${duplicateCount} duplicates skipped`;
      }
      if (errorCount > 0) {
        message += ` - ${errorCount} errors`;
      }

      toast.success(message);

      setBulkEmails('');
      setShowBulkUpload(false);
      fetchRequests();
      fetchBranches();

    } catch (error) {
      console.error('Bulk upload error:', error);
      toast.error('Failed to upload emails');
    } finally {
      setUploadingBulk(false);
    }
  };

  // Get email status for a specific request
  const getEmailStatus = (email) => {
    const log = emailLogs.get(email.toLowerCase());
    if (!log) return null;

    return {
      status: log.status,
      bounceReason: log.bounce_reason,
      sentAt: log.sent_at,
      bouncedAt: log.bounced_at,
      lastWebhookEvent: log.last_webhook_event,
      webhookReceivedAt: log.webhook_received_at
    };
  };

  // Get status badge color
  const getStatusBadgeColor = (status) => {
    switch (status) {
      case 'bounced': return 'bg-red-100 text-red-800 border border-red-200';
      case 'delivered': return 'bg-green-100 text-green-800 border border-green-200';
      case 'sent': return 'bg-blue-100 text-blue-800 border border-blue-200';
      default: return 'bg-gray-100 text-gray-800 border border-gray-200';
    }
  };

  const handleReject = async (requestId, email) => {
    setProcessingId(requestId);
    try {
      const { error } = await supabase
        .from('staff_signup_requests')
        .delete()
        .eq('id', parseInt(requestId, 10));

      if (error) throw error;

      toast.success(`Request from ${email} has been rejected`);
      fetchRequests();
      fetchBranches();
    } catch (error) {
      console.error('Rejection error:', error);
      toast.error('Failed to reject request');
    } finally {
      setProcessingId(null);
    }
  };

  const handleBranchSelect = (branch) => {
    setSelectedBranch(branch);
    setCurrentPage(1);
    setIsDropdownOpen(false);
    setSearchTerm('');
  };

  const filteredBranches = allBranches.filter(branch =>
    branch && branch.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleRequestSelection = (requestId) => {
    const newSelected = new Set(selectedRequests);
    if (newSelected.has(requestId)) {
      newSelected.delete(requestId);
    } else {
      newSelected.add(requestId);
    }
    setSelectedRequests(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedRequests.size === requests.length) {
      setSelectedRequests(new Set());
    } else {
      setSelectedRequests(new Set(requests.map(req => req.id)));
    }
  };

  const totalPages = Math.ceil(totalCount / itemsPerPage);

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const getSelectedBranchLabel = () => {
    if (selectedBranch === 'all') return 'All Branches';
    return selectedBranch;
  };

  const getBranchDisplayName = (branch) => {
    return branch || 'No Branch Assigned';
  };

  // Filter requests based on bounce filter
  const filteredRequests = filterBounced
    ? requests.filter(request => getEmailStatus(request.email)?.status === 'bounced')
    : requests;

  if (loading && requests.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center space-y-4">
              <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
              <p className="text-gray-600 font-medium">Loading requests...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Staff Signup Requests</h1>
              <p className="text-gray-600">Review and manage pending staff account requests</p>
            </div>
            <div className="flex text-xs items-center space-x-3">
              <button
                onClick={checkWebhookStatus}
                disabled={checkingBounces}
                className="inline-flex items-center text-xs px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm shadow-sm"
              >
                {checkingBounces ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Checking Status...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Refresh Email Status
                  </>
                )}
              </button>
              <button
                onClick={checkAllExistingUsers}
                disabled={checkingExistingUsers || requests.length === 0}
                className="inline-flex text-xs items-center px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm shadow-sm"
              >
                {checkingExistingUsers ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Checking Users...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Check Existing Users
                  </>
                )}
              </button>
              <button
                onClick={() => setShowBulkUpload(true)}
                className="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 transition-all duration-200 font-medium text-xs shadow-sm"
              >
                <Upload className="w-4 h-4 mr-2" />
                Bulk Upload
              </button>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex items-center space-x-1 bg-gray-200 p-1 rounded-lg w-fit mt-6">
            <button
              onClick={() => setActiveTab('requests')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'requests'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'
                }`}
            >
              Signup Requests
            </button>
            <button
              onClick={() => setActiveTab('emails')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'emails'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'
                }`}
            >
              Email Logs (Resend)
            </button>
          </div>
        </div>

        {activeTab === 'emails' ? (
          <EmailDashboard />
        ) : (
          <>



            {/* Webhook Status Panel */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 mb-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className={`flex items-center space-x-2 ${webhookEnabled ? 'text-green-600' : 'text-red-600'}`}>
                    {webhookEnabled ? (
                      <>
                        <Wifi className="w-5 h-5" />
                        <span className="font-medium text-sm">Webhook Active</span>
                      </>
                    ) : (
                      <>
                        <WifiOff className="w-5 h-5" />
                        <span className="font-medium text-sm">Webhook Offline</span>
                      </>
                    )}
                  </div>
                  <div className="h-4 w-px bg-blue-300"></div>
                  <div className="flex items-center space-x-4 text-xs">
                    <span className="text-gray-600">Total: <strong>{webhookStats.total}</strong></span>
                    <span className="text-green-600">Delivered: <strong>{webhookStats.delivered}</strong></span>
                    <span className="text-red-600">Bounced: <strong>{webhookStats.bounced}</strong></span>
                    <span className="text-blue-600">Sent: <strong>{webhookStats.sent}</strong></span>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => setFilterBounced(!filterBounced)}
                    className={`flex items-center space-x-2 px-3 py-1 rounded-lg text-xs font-medium transition-all ${filterBounced
                      ? 'bg-red-100 text-red-800 border border-red-300'
                      : 'bg-white text-gray-700 border border-gray-300 hover:border-gray-400'
                      }`}
                  >
                    <AlertCircle className="w-4 h-4" />
                    <span>Show Bounced Only</span>
                    {filterBounced && webhookStats.bounced > 0 && (
                      <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">
                        {webhookStats.bounced}
                      </span>
                    )}
                  </button>
                  {webhookStats.lastUpdate && (
                    <span className="text-xs text-gray-500">
                      Updated: {webhookStats.lastUpdate.toLocaleTimeString()}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Bulk Upload Modal */}
            {showBulkUpload && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-xl shadow-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto">
                  <div className="flex items-center justify-between p-6 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">Bulk Upload Staff Emails</h3>
                    <button
                      onClick={() => {
                        setShowBulkUpload(false);
                        setExcelFile(null);
                        setParsedData([]);
                        setBulkEmails('');
                      }}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <X className="w-6 h-6" />
                    </button>
                  </div>

                  <div className="p-6 space-y-6">
                    {/* Upload Method Selection */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-3">
                        Upload Method
                      </label>
                      <div className="grid grid-cols-2 gap-4">
                        <button
                          onClick={() => setUploadMethod('excel')}
                          className={`p-4 border-2 rounded-lg text-center transition-all ${uploadMethod === 'excel'
                            ? 'border-purple-500 bg-purple-50 text-purple-700'
                            : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                            }`}
                        >
                          <Table className="w-8 h-8 mx-auto mb-2" />
                          <div className="font-medium">Excel Template</div>
                          <div className="text-sm text-gray-500">Recommended for large lists</div>
                        </button>
                        <button
                          onClick={() => setUploadMethod('manual')}
                          className={`p-4 border-2 rounded-lg text-center transition-all ${uploadMethod === 'manual'
                            ? 'border-purple-500 bg-purple-50 text-purple-700'
                            : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                            }`}
                        >
                          <FileText className="w-8 h-8 mx-auto mb-2" />
                          <div className="font-medium">Manual Entry</div>
                          <div className="text-sm text-gray-500">For small lists</div>
                        </button>
                      </div>
                    </div>

                    {/* Branch Assignment */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Default Branch Assignment
                      </label>
                      <input
                        type="text"
                        value={bulkBranch}
                        onChange={(e) => setBulkBranch(e.target.value)}
                        placeholder="Enter default branch name (e.g., 'Main Branch', 'New York Office')"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        This branch will be used for all uploaded emails unless specified in the Excel file
                      </p>
                    </div>

                    {/* Excel Upload Section */}
                    {uploadMethod === 'excel' && (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Upload Excel File
                          </label>
                          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                            <input
                              type="file"
                              accept=".xlsx,.xls"
                              onChange={handleExcelUpload}
                              className="hidden"
                              id="excel-upload"
                            />
                            <label
                              htmlFor="excel-upload"
                              className="cursor-pointer block"
                            >
                              <Table className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                              <div className="text-sm text-gray-600">
                                {excelFile ? (
                                  <span className="text-green-600 font-medium">
                                    {excelFile.name} ({parsedData.length} records found)
                                  </span>
                                ) : (
                                  <>
                                    <span className="font-medium text-purple-600">Click to upload Excel file</span>
                                    <div className="text-xs text-gray-500 mt-1">
                                      .xlsx or .xls files only, max 5MB
                                    </div>
                                  </>
                                )}
                              </div>
                            </label>
                          </div>
                        </div>

                        {/* Preview parsed data */}
                        {parsedData.length > 0 && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Preview ({parsedData.length} records)
                            </label>
                            <div className="border border-gray-200 rounded-lg overflow-hidden">
                              <div className="max-h-48 overflow-y-auto">
                                <table className="min-w-full divide-y divide-gray-200">
                                  <thead className="bg-gray-50">
                                    <tr>
                                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                        Email
                                      </th>
                                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                        Branch
                                      </th>
                                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                        Notes
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody className="bg-white divide-y divide-gray-200">
                                    {parsedData.slice(0, 10).map((record, index) => (
                                      <tr key={index}>
                                        <td className="px-3 py-2 text-sm text-gray-900">
                                          {record.email}
                                        </td>
                                        <td className="px-3 py-2 text-sm text-gray-900">
                                          {record.branch}
                                        </td>
                                        <td className="px-3 py-2 text-sm text-gray-500">
                                          {record.notes}
                                        </td>
                                      </tr>
                                    ))}
                                    {parsedData.length > 10 && (
                                      <tr>
                                        <td colSpan="3" className="px-3 py-2 text-sm text-gray-500 text-center">
                                          ... and {parsedData.length - 10} more records
                                        </td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Manual Upload Section */}
                    {uploadMethod === 'manual' && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Email List
                        </label>
                        <textarea
                          value={bulkEmails}
                          onChange={(e) => setBulkEmails(e.target.value)}
                          placeholder="Enter email addresses (one per line, or separated by commas/semicolons)
john.doe@company.com
jane.smith@company.com
mike.wilson@company.com"
                          rows={8}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Supports: one email per line, comma-separated, or semicolon-separated
                        </p>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                      <div className="flex items-center space-x-4">
                        <button
                          onClick={downloadExcelTemplate}
                          className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-all duration-200 font-medium text-sm"
                        >
                          <Download className="w-4 h-4 mr-2" />
                          Download Excel Template
                        </button>
                      </div>

                      <div className="flex items-center space-x-3">
                        <button
                          onClick={() => {
                            setShowBulkUpload(false);
                            setExcelFile(null);
                            setParsedData([]);
                            setBulkEmails('');
                          }}
                          className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={uploadMethod === 'excel' ? handleBulkUploadFromExcel : handleManualBulkUpload}
                          disabled={
                            uploadingBulk ||
                            parsingExcel ||
                            (uploadMethod === 'excel' && parsedData.length === 0) ||
                            (uploadMethod === 'manual' && !bulkEmails.trim()) ||
                            !bulkBranch.trim()
                          }
                          className="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
                        >
                          {uploadingBulk || parsingExcel ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              {parsingExcel ? 'Parsing...' : 'Uploading...'}
                            </>
                          ) : (
                            <>
                              <Upload className="w-4 h-4 mr-2" />
                              {uploadMethod === 'excel' ? `Upload ${parsedData.length} Records` : 'Upload Emails'}
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Stats and Filters */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
              {/* Stats Card */}
              <div className="lg:col-span-1 bg-white rounded-xl shadow-xs border border-gray-200 p-6 transition-all hover:shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Pending Requests</p>
                    <p className="text-3xl font-bold text-gray-900 mt-1">{totalCount}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Page {currentPage} of {totalPages}
                    </p>
                    {selectedRequests.size > 0 && (
                      <p className="text-xs text-blue-600 font-medium mt-1">
                        {selectedRequests.size} selected
                      </p>
                    )}
                    {filterBounced && (
                      <p className="text-xs text-red-600 font-medium mt-1">
                        Showing {filteredRequests.length} bounced emails
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Branch Filter Dropdown */}
              <div className="lg:col-span-3 bg-white rounded-xl shadow-xs border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-2">
                    <Filter className="w-4 h-4 text-gray-500" />
                    <h3 className="text-sm font-semibold text-gray-900">Filter by Branch</h3>
                  </div>
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-md">
                    {selectedBranch === 'all' ? 'Showing all branches' : `Filtered by: ${selectedBranch}`}
                  </span>
                </div>

                <div className="relative">
                  <button
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-white border border-gray-300 rounded-lg shadow-sm hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                  >
                    <div className="flex items-center space-x-2">
                      <Building className="w-4 h-4 text-gray-500" />
                      <span className="text-sm font-medium text-gray-900">
                        {getSelectedBranchLabel()}
                      </span>
                    </div>
                    <ChevronDown
                      className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${isDropdownOpen ? 'transform rotate-180' : ''
                        }`}
                    />
                  </button>

                  {isDropdownOpen && (
                    <div className="absolute z-10 w-full mt-2 bg-white border border-gray-200 rounded-lg shadow-lg max-h-80 overflow-hidden">
                      <div className="p-2 border-b border-gray-200">
                        <div className="relative">
                          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                          <input
                            type="text"
                            placeholder="Search branches..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                          />
                        </div>
                      </div>

                      <div className="max-h-60 overflow-y-auto">
                        <button
                          onClick={() => handleBranchSelect('all')}
                          className={`w-full flex items-center px-4 py-3 text-sm text-left hover:bg-gray-50 transition-colors ${selectedBranch === 'all' ? 'bg-blue-50 text-blue-700' : 'text-gray-900'
                            }`}
                        >
                          <div className="flex items-center space-x-2">
                            <Building className="w-4 h-4" />
                            <span className="font-medium">All Branches</span>
                          </div>
                        </button>

                        {filteredBranches.length > 0 ? (
                          filteredBranches.map((branch) => (
                            <button
                              key={branch}
                              onClick={() => handleBranchSelect(branch)}
                              className={`w-full flex items-center px-4 py-3 text-sm text-left hover:bg-gray-50 transition-colors ${selectedBranch === branch ? 'bg-blue-50 text-blue-700' : 'text-gray-900'
                                }`}
                            >
                              <div className="flex items-center space-x-2">
                                <Building className="w-4 h-4" />
                                <span>{branch}</span>
                              </div>
                            </button>
                          ))
                        ) : (
                          <div className="px-4 py-3 text-sm text-gray-500 text-center">
                            No branches found matching "{searchTerm}"
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {selectedBranch !== 'all' && (
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-gray-600">
                      Showing requests for: <strong>{selectedBranch}</strong>
                    </span>
                    <button
                      onClick={() => handleBranchSelect('all')}
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                    >
                      Clear filter
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Bulk Actions */}
            {filteredRequests.length > 0 && (
              <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-4 mb-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <button
                      onClick={toggleSelectAll}
                      className="flex items-center space-x-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                    >
                      {selectedRequests.size === filteredRequests.length ? (
                        <CheckSquare className="w-5 h-5 text-blue-600" />
                      ) : (
                        <Square className="w-5 h-5 text-gray-400" />
                      )}
                      <span>
                        {selectedRequests.size === filteredRequests.length ? 'Deselect All' : 'Select All'}
                      </span>
                    </button>

                    {selectedRequests.size > 0 && (
                      <span className="text-sm text-gray-600">
                        {selectedRequests.size} request(s) selected
                      </span>
                    )}
                  </div>

                  <div className="flex items-center space-x-3">
                    {selectedRequests.size > 0 && (
                      <button
                        onClick={handleBulkProcess}
                        disabled={bulkProcessing}
                        className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg hover:from-green-700 hover:to-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-100 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm shadow-sm"
                      >
                        {bulkProcessing ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Processing {selectedRequests.size} Request(s)...
                          </>
                        ) : (
                          <>
                            <Key className="w-4 h-4 mr-2" />
                            Process Selected ({selectedRequests.size})
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Requests List */}
            {filteredRequests.length === 0 ? (
              <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-12 text-center">
                <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <FileText className="w-6 h-6 text-gray-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {filterBounced
                    ? 'No bounced emails found'
                    : selectedBranch === 'all'
                      ? 'No pending requests'
                      : `No pending requests for ${selectedBranch}`
                  }
                </h3>
                <p className="text-gray-500 max-w-md mx-auto">
                  {filterBounced
                    ? 'All emails have been delivered successfully or are still in transit.'
                    : selectedBranch === 'all'
                      ? 'All staff signup requests have been processed.'
                      : `There are no pending requests for the ${selectedBranch} branch.`
                  }
                </p>
                {filterBounced && (
                  <button
                    onClick={() => setFilterBounced(false)}
                    className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200 font-medium text-sm mt-4"
                  >
                    <Eye className="w-4 h-4 mr-2" />
                    Show All Requests
                  </button>
                )}
                {!filterBounced && (
                  <button
                    onClick={() => setShowBulkUpload(true)}
                    className="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 transition-all duration-200 font-medium text-sm mt-4"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Bulk Upload Staff Emails
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredRequests.map((request) => {
                  const emailStatus = getEmailStatus(request.email);
                  const hasBounced = emailStatus?.status === 'bounced';

                  return (
                    <div
                      key={request.id}
                      className={`bg-white rounded-xl shadow-xs border transition-all duration-200 overflow-hidden ${selectedRequests.has(request.id)
                        ? 'border-blue-500 ring-2 ring-blue-100'
                        : hasBounced
                          ? 'border-red-300 ring-1 ring-red-100'
                          : request.existingUser?.exists
                            ? 'border-amber-300 ring-1 ring-amber-100'
                            : 'border-gray-200 hover:shadow-sm'
                        }`}
                    >
                      <div className="p-5">
                        <div className="flex items-start justify-between">
                          {/* Selection Checkbox and Request Info */}
                          <div className="flex-1">
                            <div className="flex items-start space-x-4">
                              <button
                                onClick={() => toggleRequestSelection(request.id)}
                                className="mt-2 flex-shrink-0"
                              >
                                {selectedRequests.has(request.id) ? (
                                  <CheckSquare className="w-5 h-5 text-blue-600" />
                                ) : (
                                  <Square className="w-5 h-5 text-gray-400 hover:text-gray-600" />
                                )}
                              </button>
                              <div className={`w-12 h-12 rounded-full flex items-center justify-center shadow-sm mt-1 flex-shrink-0 ${hasBounced
                                ? 'bg-gradient-to-r from-red-500 to-pink-600'
                                : request.existingUser?.exists
                                  ? 'bg-gradient-to-r from-amber-500 to-orange-600'
                                  : 'bg-gradient-to-r from-blue-500 to-indigo-600'
                                }`}>
                                {hasBounced ? (
                                  <AlertCircle className="w-6 h-6 text-white" />
                                ) : request.existingUser?.exists ? (
                                  <AlertTriangle className="w-6 h-6 text-white" />
                                ) : (
                                  <span className="text-white font-semibold text-lg">
                                    {request.email.charAt(0).toUpperCase()}
                                  </span>
                                )}
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center space-x-3">
                                  <h3 className="text-lg font-semibold text-gray-900">{request.email}</h3>
                                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${hasBounced
                                    ? 'bg-red-100 text-red-800 border border-red-200'
                                    : request.existingUser?.exists
                                      ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                      : 'bg-blue-100 text-blue-800 border border-blue-200'
                                    }`}>
                                    {hasBounced ? 'Email Bounced' : request.existingUser?.exists ? 'User Exists' : 'Pending'}
                                  </span>
                                  {emailStatus && (
                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadgeColor(emailStatus.status)}`}>
                                      {emailStatus.status}
                                      {emailStatus.lastWebhookEvent && (
                                        <span className="ml-1 text-xs opacity-75">
                                          ({emailStatus.lastWebhookEvent})
                                        </span>
                                      )}
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-600 mt-2">
                                  <div className="flex items-center space-x-1.5">
                                    <Building className="w-4 h-4 text-gray-400" />
                                    <span>{getBranchDisplayName(request.branch)}</span>
                                  </div>
                                  <div className="flex items-center space-x-1.5">
                                    <Clock className="w-4 h-4 text-gray-400" />
                                    <span>{new Date(request.created_at).toLocaleString()}</span>
                                  </div>
                                  {request.existingUser?.exists && (
                                    <div className="flex items-center space-x-1.5 text-amber-600">
                                      <AlertTriangle className="w-4 h-4" />
                                      <span>User already in system</span>
                                    </div>
                                  )}
                                  {emailStatus && emailStatus.sentAt && (
                                    <div className="flex items-center space-x-1.5 text-gray-500">
                                      <Mail className="w-4 h-4" />
                                      <span>Sent: {new Date(emailStatus.sentAt).toLocaleDateString()}</span>
                                    </div>
                                  )}
                                  {emailStatus && emailStatus.webhookReceivedAt && (
                                    <div className="flex items-center space-x-1.5 text-green-500">
                                      <Radio className="w-4 h-4" />
                                      <span>Webhook: {new Date(emailStatus.webhookReceivedAt).toLocaleTimeString()}</span>
                                    </div>
                                  )}
                                </div>

                                {/* Bounce Details */}
                                {hasBounced && (
                                  <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                                    <div className="flex items-start space-x-2 text-red-700">
                                      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                      <div className="flex-1">
                                        <p className="font-medium text-sm">Email Delivery Failed</p>
                                        <p className="text-xs mt-1">{emailStatus.bounceReason || 'Unknown bounce reason'}</p>
                                        <div className="flex items-center space-x-4 text-xs mt-2 text-red-600">
                                          <span>Sent: {new Date(emailStatus.sentAt).toLocaleString()}</span>
                                          {emailStatus.bouncedAt && (
                                            <span>Bounced: {new Date(emailStatus.bouncedAt).toLocaleString()}</span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center space-x-2 ml-4">
                            <button
                              onClick={() => handleReject(request.id, request.email)}
                              disabled={processingId === request.id || bulkProcessing}
                              className="inline-flex items-center px-4 py-2 border border-gray-200 text-gray-700 bg-white rounded-lg hover:bg-gray-50 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-100 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-xs"
                            >
                              {processingId === request.id ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                  Processing
                                </>
                              ) : (
                                <>
                                  <XCircle className="w-4 h-4 mr-2 text-red-500" />
                                  Reject
                                </>
                              )}
                            </button>

                            <button
                              onClick={() => handleProcessRequest(request.id, request.email, request.branch)}
                              disabled={processingId === request.id || bulkProcessing || hasBounced}
                              className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-100 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-xs shadow-sm"
                            >
                              {processingId === request.id ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                  Processing
                                </>
                              ) : hasBounced ? (
                                <>
                                  <AlertCircle className="w-4 h-4 mr-2" />
                                  Email Bounced
                                </>
                              ) : (
                                <>
                                  <Key className="w-4 h-4 mr-2" />
                                  {request.existingUser?.exists ? 'Update & Resend' : 'Approve'}
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-8 bg-white rounded-xl shadow-xs border border-gray-200 p-4">
                <div className="text-sm text-gray-700">
                  Showing {(currentPage - 1) * itemsPerPage + 1} to{' '}
                  {Math.min(currentPage * itemsPerPage, totalCount)} of {totalCount} requests
                  {filterBounced && ` (${filteredRequests.length} bounced)`}
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handlePreviousPage}
                    disabled={currentPage === 1}
                    className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    Previous
                  </button>
                  <span className="px-3 py-2 text-sm text-gray-700">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={handleNextPage}
                    disabled={currentPage === totalPages}
                    className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}