import { useNavigate, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { X, ArrowLeft, Clock, FileText, AlertTriangle, Shield, CheckCircle, UserCheck, Loader, Mail, Trash2, PrinterIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import GlowButton from '../UI/GlowButton';
import { User } from 'lucide-react';
import { format } from 'date-fns';
import { jwtDecode } from 'jwt-decode';
import { useUser } from '../ProtectedRoutes/UserContext';


type Employee = any;
type Profile = any;
type TerminationRequest = any;

interface GmailToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

const ViewEmployeePage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user: currentUser } = useUser();
  const isAdmin = currentUser?.role === 'ADMIN';
  const [employee, setEmployee] = useState<Employee | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [terminationDate, setTerminationDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [terminationReason, setTerminationReason] = useState<string>('');
  const [exitInterview, setExitInterview] = useState<string>('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [isTerminating, setIsTerminating] = useState(false);
  const [terminationSuccess, setTerminationSuccess] = useState(false);
  const [userRole, setUserRole] = useState<'employee' | 'manager' | 'admin'>('employee');
  const [userId, setUserId] = useState<string | null>(null);
  const [pendingTerminationRequests, setPendingTerminationRequests] = useState<TerminationRequest[]>([]);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [gmailAuthorized, setGmailAuthorized] = useState(false);
  const [isCheckingGmail, setIsCheckingGmail] = useState(false);
  const [userProfile, setUserProfile] = useState<Profile | null>(null);
  const [showEmailOptions, setShowEmailOptions] = useState(false);
  const [emailContent, setEmailContent] = useState({
    subject: '',
    body: '',
    includeLetter: true
  });

  // Initialize email content
  useEffect(() => {
    if (employee) {
      setEmailContent({
        subject: `Termination Notice - ${employee['First Name']} ${employee['Last Name']}`,
        body: `Dear ${employee['First Name']},\n\nThis email serves as formal notification of your termination from ${employee['Employee Type']} position at our company, effective ${terminationDate}.\n\nReason: ${terminationReason}\n\nPlease review the attached termination letter for complete details.\n\nSincerely,\nHuman Resources Department`,
        includeLetter: true
      });
    }
  }, [employee, terminationDate, terminationReason]);

  // Check user authentication and role
  useEffect(() => {
    const checkUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setUserId(user.id);

          // Get user profile with role
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

          if (profileError) throw profileError;

          if (profile) {
            setUserProfile(profile);
            setUserRole(profile.role || 'employee');
          }

          // Check Gmail authorization status
          await checkGmailAuthorization();
        }
      } catch (err) {
        console.error('Error checking user:', err);
      }
    };

    checkUser();
  }, []);

  // Fetch employee data
  useEffect(() => {
    const fetchEmployee = async () => {
      try {
        setLoading(true);
        setError(null);

        const { data, error } = await supabase
          .from('employees')
          .select('*')
          .eq('Employee Number', id)
          .single();

        if (error) throw error;
        if (!data) throw new Error('Employee not found');

        setEmployee(data);

        // If employee is already terminated, pre-fill the form
        if (data['Termination Date']) {
          setTerminationDate(data['Termination Date']);
          setTerminationReason(data['Termination Reason'] || '');
          setExitInterview(data['Exit Interview Notes'] || '');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch employee');
      } finally {
        setLoading(false);
      }
    };

    fetchEmployee();
  }, [id]);

  // Fetch pending termination requests
  useEffect(() => {
    if (userRole === 'admin' || userRole === 'manager') {
      fetchTerminationRequests();
    }
  }, [userRole, id]);

  const fetchTerminationRequests = async () => {
    try {
      const { data, error } = await supabase
        .from('termination_requests')
        .select(`
          *,
          requester:profiles!termination_requests_requested_by_fkey(
            id,
            email,
            full_name
          ),
          approver:profiles!termination_requests_approved_by_fkey(
            id,
            email,
            full_name
          )
        `)
        .eq('employee_id', id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;

      setPendingTerminationRequests(data || []);
    } catch (err) {
      console.error('Error fetching termination requests:', err);
    }
  };

  // Check Gmail authorization
  const checkGmailAuthorization = async () => {
    try {
      setIsCheckingGmail(true);
      const { data: settings } = await supabase
        .from('system_settings')
        .select('gmail_access_token, gmail_refresh_token, gmail_token_expiry')
        .single();

      if (settings?.gmail_access_token) {
        // Check if token is expired
        const isExpired = settings.gmail_token_expiry
          ? new Date(settings.gmail_token_expiry).getTime() < Date.now()
          : true;

        if (!isExpired) {
          setGmailAuthorized(true);
        } else if (settings.gmail_refresh_token) {
          // Try to refresh the token
          await refreshGmailToken(settings.gmail_refresh_token);
        }
      }
    } catch (err) {
      console.error('Error checking Gmail authorization:', err);
    } finally {
      setIsCheckingGmail(false);
    }
  };

  // Refresh Gmail token
  const refreshGmailToken = async (refreshToken: string) => {
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
          client_secret: import.meta.env.VITE_GOOGLE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (!response.ok) throw new Error('Failed to refresh token');

      const data = await response.json();

      // Save new token
      const { error } = await supabase
        .from('system_settings')
        .upsert({
          id: 1,
          gmail_access_token: data.access_token,
          gmail_refresh_token: data.refresh_token || refreshToken,
          gmail_token_expiry: new Date(Date.now() + data.expires_in * 1000).toISOString(),
          updated_at: new Date().toISOString()
        });

      if (!error) {
        setGmailAuthorized(true);
      }
    } catch (err) {
      console.error('Error refreshing Gmail token:', err);
      setGmailAuthorized(false);
    }
  };

  // Check if termination requires approval
  const requiresApproval = () => {
    if (!employee) return false;

    // If user is admin, no approval needed
    if (userRole === 'admin') return false;

    // Managers require admin approval
    const isManager = employee['Employee Type']?.toLowerCase().includes('manager') ||
      employee['Job Title']?.toLowerCase().includes('manager') ||
      employee['Employee Type']?.toLowerCase().includes('director') ||
      employee['Job Title']?.toLowerCase().includes('director');

    return isManager;
  };

  // Check if user can approve terminations
  const canApproveTerminations = () => {
    return userRole === 'admin';
  };

  // Check if user can terminate employees
  const canTerminateEmployees = () => {
    return userRole === 'admin' || userRole === 'manager';
  };

  // Submit termination request for approval
  const submitTerminationRequest = async () => {
    if (!employee || !userId) {
      setError('User or employee information missing');
      return;
    }

    try {
      setIsTerminating(true);

      const { data, error } = await supabase
        .from('termination_requests')
        .insert({
          employee_id: employee['Employee Number'],
          requested_by: userId,
          status: 'pending',
          termination_date: terminationDate,
          termination_reason: terminationReason,
          exit_interview: exitInterview,
          employee_name: `${employee['First Name']} ${employee['Last Name']}`,
          employee_email: employee['Email Address'],
          employee_position: employee['Job Title']
        })
        .select()
        .single();

      if (error) throw error;

      // Notify admins about pending request
      await notifyAdminsOfPendingRequest(data);

      setTerminationSuccess(true);
      setTimeout(() => setTerminationSuccess(false), 3000);
      await fetchTerminationRequests();

      // Show success message
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit termination request');
    } finally {
      setIsTerminating(false);
      setShowConfirm(false);
    }
  };

  // Notify admins about pending termination request
  const notifyAdminsOfPendingRequest = async (request: TerminationRequest) => {
    try {
      // Get all admin users
      const { data: admins } = await supabase
        .from('profiles')
        .select('email')
        .eq('role', 'admin');

      if (admins && admins.length > 0) {
        // Send email notifications to admins
        const adminEmails = admins.map(admin => admin.email).filter(Boolean);

        // You can implement email sending to admins here
        console.log('Notifying admins:', adminEmails, 'about request:', request.id);
      }
    } catch (err) {
      console.error('Error notifying admins:', err);
    }
  };

  // Approve termination request
  const approveTerminationRequest = async (requestId: string) => {
    try {
      setIsTerminating(true);

      // Get the termination request
      const { data: request, error: fetchError } = await supabase
        .from('termination_requests')
        .select('*')
        .eq('id', requestId)
        .single();

      if (fetchError) throw fetchError;
      if (!request) throw new Error('Request not found');

      // Execute termination
      const { error: updateError } = await supabase
        .from('employees')
        .update({
          'Termination Date': request.termination_date,
          'Termination Reason': request.termination_reason,
          'Exit Interview Notes': request.exit_interview,
          'Status': 'Terminated',
          'updated_at': new Date().toISOString()
        })
        .eq('Employee Number', request.employee_id);

      if (updateError) throw updateError;

      // Update request status
      const { error: requestError } = await supabase
        .from('termination_requests')
        .update({
          approved_by: userId,
          status: 'approved',
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', requestId);

      if (requestError) throw requestError;

      // Send termination email
      await sendTerminationEmail(request);

      // Refresh data
      await fetchEmployee();
      await fetchTerminationRequests();

      setTerminationSuccess(true);
      setTimeout(() => setTerminationSuccess(false), 3000);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve termination');
    } finally {
      setIsTerminating(false);
    }
  };

  // Reject termination request
  const rejectTerminationRequest = async (requestId: string) => {
    try {
      const { error } = await supabase
        .from('termination_requests')
        .update({
          status: 'rejected',
          rejected_by: userId,
          rejected_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', requestId);

      if (error) throw error;

      await fetchTerminationRequests();
      setTerminationSuccess(true);
      setTimeout(() => setTerminationSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject termination');
    }
  };

  // Direct termination (no approval needed)
  const handleDirectTermination = async () => {
    if (!employee) return;

    try {
      setIsTerminating(true);

      const { error } = await supabase
        .from('employees')
        .update({
          'Termination Date': terminationDate,
          'Termination Reason': terminationReason,
          'Exit Interview Notes': exitInterview,
          'Status': 'Terminated',
          'updated_at': new Date().toISOString()
        })
        .eq('Employee Number', employee['Employee Number']);

      if (error) throw error;

      // Create termination request record for audit trail
      await supabase
        .from('termination_requests')
        .insert({
          employee_id: employee['Employee Number'],
          requested_by: userId,
          approved_by: userId,
          status: 'approved',
          termination_date: terminationDate,
          termination_reason: terminationReason,
          exit_interview: exitInterview,
          approved_at: new Date().toISOString(),
          employee_name: `${employee['First Name']} ${employee['Last Name']}`,
          employee_email: employee['Email Address'],
          employee_position: employee['Job Title']
        });

      // Send termination email
      await sendTerminationEmail({
        employee_id: employee['Employee Number'],
        termination_date: terminationDate,
        termination_reason: terminationReason,
        exit_interview: exitInterview,
        employee_name: `${employee['First Name']} ${employee['Last Name']}`,
        employee_email: employee['Email Address'],
        employee_position: employee['Job Title']
      } as TerminationRequest);

      // Update local state
      setEmployee({
        ...employee,
        'Termination Date': terminationDate,
        'Termination Reason': terminationReason,
        'Exit Interview Notes': exitInterview,
        'Status': 'Terminated'
      });

      setTerminationSuccess(true);
      setTimeout(() => setTerminationSuccess(false), 3000);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to terminate employee');
    } finally {
      setIsTerminating(false);
      setShowConfirm(false);
    }
  };

  // Send termination email using Gmail API
  const sendTerminationEmail = async (request: TerminationRequest) => {
    if (!employee || !gmailAuthorized) {
      console.warn('Cannot send email: Gmail not authorized or employee not found');
      return;
    }

    try {
      setSendingEmail(true);

      // Get Gmail access token
      const { data: settings } = await supabase
        .from('system_settings')
        .select('gmail_access_token')
        .single();

      if (!settings?.gmail_access_token) {
        throw new Error('Gmail access token not found');
      }

      // Create email content
      const terminationLetter = generateTerminationLetter();
      const emailBody = `
${emailContent.body}

${emailContent.includeLetter ? '\n\n--- Termination Letter ---\n' + terminationLetter : ''}
      `.trim();

      // Create email message
      const email = [
        'Content-Type: text/plain; charset="UTF-8"\n',
        'MIME-Version: 1.0\n',
        'Content-Transfer-Encoding: 7bit\n',
        'to: ' + employee['Email Address'] + '\n',
        'cc: hr@company.com\n', // Add HR email as CC
        'subject: ' + emailContent.subject + '\n',
        '\n',
        emailBody
      ].join('');

      // Encode email in base64
      const encodedEmail = btoa(email)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      // Send email using Gmail API
      const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${settings.gmail_access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          raw: encodedEmail
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Gmail API error: ${errorData.error?.message || 'Unknown error'}`);
      }

      // Log email sent
      await supabase
        .from('email_logs')
        .insert({
          employee_id: employee['Employee Number'],
          email_type: 'termination_notice',
          sent_to: employee['Email Address'],
          subject: emailContent.subject,
          status: 'sent',
          sent_at: new Date().toISOString(),
          sent_by: userId
        });

      setEmailSent(true);
      setTimeout(() => {
        setEmailSent(false);
        setShowEmailOptions(false);
      }, 3000);

    } catch (err) {
      console.error('Failed to send email:', err);

      // Log failed email attempt
      await supabase
        .from('email_logs')
        .insert({
          employee_id: employee['Employee Number'],
          email_type: 'termination_notice',
          sent_to: employee['Email Address'],
          subject: emailContent.subject,
          status: 'failed',
          error_message: err instanceof Error ? err.message : 'Unknown error',
          sent_at: new Date().toISOString(),
          sent_by: userId
        });

      setError('Failed to send termination email. Please check Gmail authorization.');
    } finally {
      setSendingEmail(false);
    }
  };

  // Authorize Gmail
  const authorizeGmail = () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    const redirectUri = `${window.location.origin}/auth/gmail/callback`;
    const scope = 'https://www.googleapis.com/auth/gmail.send';

    const authUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code&access_type=offline&prompt=consent`;

    window.location.href = authUrl;
  };

  // Handle Gmail OAuth callback (you'll need to create a callback page)
  // This function should be called from your callback page
  const handleGmailCallback = async (code: string) => {
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code,
          client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
          client_secret: import.meta.env.VITE_GOOGLE_CLIENT_SECRET,
          redirect_uri: `${window.location.origin}/auth/gmail/callback`,
          grant_type: 'authorization_code',
        }),
      });

      if (!response.ok) throw new Error('Failed to get access token');

      const data = await response.json();

      // Decode token to get expiry
      const decodedToken = jwtDecode(data.id_token);

      // Save tokens to database
      const { error } = await supabase
        .from('system_settings')
        .upsert({
          id: 1,
          gmail_access_token: data.access_token,
          gmail_refresh_token: data.refresh_token,
          gmail_token_expiry: new Date((decodedToken.exp || 0) * 1000).toISOString(),
          updated_at: new Date().toISOString()
        });

      if (error) throw error;

      setGmailAuthorized(true);
      return true;
    } catch (err) {
      console.error('Error handling Gmail callback:', err);
      return false;
    }
  };

  // Generate termination letter
  const generateTerminationLetter = () => {
    if (!employee) return '';

    const letter = `
TERMINATION LETTER

Date: ${format(new Date(), 'MMMM d, yyyy')}

To: ${employee['First Name']} ${employee['Last Name']}
Employee ID: ${employee['Employee Number']}
Position: ${employee['Job Title']}
Department: ${employee['Employee Type']}

Dear ${employee['First Name']},

This letter serves as formal notification of your termination from ${employee['Employee Type']} position at our company, effective ${terminationDate}.

Reason for Termination: ${terminationReason}

${exitInterview ? `Exit Interview Notes: ${exitInterview}` : ''}

Please return all company property in your possession by your last day of employment. Your final paycheck will be processed according to company policy and applicable laws.

We appreciate your contributions during your time with us and wish you success in your future endeavors.

Sincerely,

[HR Manager Name]
Human Resources Department
Company Name
    `;

    return letter.trim();
  };

  // Print termination letter
  const handlePrintTerminationLetter = () => {
    const letter = generateTerminationLetter();
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>Termination Letter - ${employee?.['First Name']} ${employee?.['Last Name']}</title>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 40px; }
              h1 { text-align: center; margin-bottom: 40px; border-bottom: 2px solid #000; padding-bottom: 20px; }
              .letter-content { white-space: pre-line; margin-top: 30px; }
              .signature { margin-top: 100px; }
              .footer { margin-top: 150px; font-size: 0.9em; color: #666; border-top: 1px solid #ccc; padding-top: 20px; }
              @media print {
                body { padding: 0; }
                .no-print { display: none; }
              }
            </style>
          </head>
          <body>
            <div class="letter-content">${letter}</div>
            <div class="footer">
              <p>Confidential Document - Employee Termination</p>
              <p>Generated on: ${format(new Date(), 'MMMM d, yyyy h:mm a')}</p>
            </div>
            <div class="no-print" style="margin-top: 30px; text-align: center;">
              <button onclick="window.print()" style="padding: 10px 20px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;">
                Print Letter
              </button>
              <button onclick="window.close()" style="padding: 10px 20px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; margin-left: 10px;">
                Close Window
              </button>
            </div>
          </body>
        </html>
      `);
      printWindow.document.close();
    }
  };

  // Reverse termination
  const handleReverseTermination = async () => {
    if (!employee) return;

    try {
      setIsTerminating(true);

      const { error } = await supabase
        .from('employees')
        .update({
          'Termination Date': null,
          'Termination Reason': null,
          'Exit Interview Notes': null,
          'Status': 'Active',
          'updated_at': new Date().toISOString()
        })
        .eq('Employee Number', employee['Employee Number']);

      if (error) throw error;

      // Update termination request status
      await supabase
        .from('termination_requests')
        .update({
          status: 'reversed',
          reversed_by: userId,
          reversed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('employee_id', employee['Employee Number'])
        .eq('status', 'approved');

      // Update local state
      setEmployee({
        ...employee,
        'Termination Date': null,
        'Termination Reason': null,
        'Exit Interview Notes': null,
        'Status': 'Active'
      });

      setTerminationSuccess(true);
      setTimeout(() => setTerminationSuccess(false), 3000);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reverse termination');
    } finally {
      setIsTerminating(false);
    }
  };

  // Main termination handler
  const handleTerminateEmployee = async () => {
    if (!employee || !terminationDate || !terminationReason) {
      setError('Please fill in all required fields');
      return;
    }

    if (requiresApproval()) {
      await submitTerminationRequest();
    } else {
      await handleDirectTermination();
    }
  };

  // Fetch employee data (reusable function)
  const fetchEmployee = async () => {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('Employee Number', id)
        .single();

      if (error) throw error;
      setEmployee(data);
    } catch (err) {
      console.error('Error fetching employee:', err);
    }
  };

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="p-6 max-w-6xl mx-auto flex justify-center items-center min-h-[60vh] text-xs"
      >
        <div className="text-center">
          <div className="animate-pulse flex flex-col items-center">
            <div className="w-16 h-16 bg-gradient-to-r from-green-50 to-green-200 rounded-full mb-6"></div>
            <div className="h-5 bg-gradient-to-r from-gray-100 to-gray-200 rounded-full w-64 mb-4"></div>
            <div className="h-4 bg-gradient-to-r from-gray-100 to-gray-200 rounded-full w-48"></div>
          </div>
        </div>
      </motion.div>
    );
  }

  if (error && !employee) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="p-6 max-w-6xl mx-auto flex justify-center items-center min-h-[60vh] text-xs"
      >
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center border border-green-100">
          <div className="bg-red-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <X className="w-8 h-8 text-red-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Error Loading Employee</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <GlowButton
            onClick={() => navigate('/employees')}
            icon={ArrowLeft}
            className="w-full max-w-xs mx-auto text-xs"
          >
            Back to Employee List
          </GlowButton>
        </div>
      </motion.div>
    );
  }

  if (!employee) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="p-6 max-w-6xl mx-auto flex justify-center items-center min-h-[60vh] text-xs"
      >
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center border border-red-100">
          <div className="bg-green-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <X className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Employee Not Found</h2>
          <p className="text-gray-600 mb-6">The requested employee could not be found.</p>
          <GlowButton
            onClick={() => navigate('/employees')}
            icon={ArrowLeft}
            className="w-full max-w-xs mx-auto text-xs"
          >
            Back to Employee List
          </GlowButton>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="p-4 md:p-6 max-w-6xl mx-auto text-xs"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate('/employees')}
          className="flex items-center text-gray-600 hover:text-gray-900 transition-colors group text-xs"
        >
          <div className="p-1 rounded-full group-hover:bg-gray-100 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </div>
          <span className="ml-2 font-medium hidden sm:inline">Back to Employees</span>
        </button>

        <div className="flex items-center space-x-4">
          {terminationSuccess && (
            <div className="bg-green-100 text-green-800 px-4 py-2 rounded-md flex items-center">
              <CheckCircle className="w-4 h-4 mr-2" />
              {employee['Termination Date'] ? 'Employee terminated successfully' : 'Termination reversed successfully'}
            </div>
          )}

          {emailSent && (
            <div className="bg-blue-100 text-blue-800 px-4 py-2 rounded-md flex items-center">
              <Mail className="w-4 h-4 mr-2" />
              Termination email sent successfully
            </div>
          )}

          {error && (
            <div className="bg-red-100 text-red-800 px-4 py-2 rounded-md">
              {error}
            </div>
          )}

          {/* User role badge */}
          <div className={`px-3 py-1 rounded-full text-xs font-medium ${userRole === 'admin'
            ? 'bg-purple-100 text-purple-800 border border-purple-200'
            : userRole === 'manager'
              ? 'bg-blue-100 text-blue-800 border border-blue-200'
              : 'bg-gray-100 text-gray-800 border border-gray-200'
            }`}>
            {userRole.charAt(0).toUpperCase() + userRole.slice(1)}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-300 overflow-hidden">
        {/* Header */}
        <div className={`p-6 md:p-8 border-b border-gray-300 ${employee['Termination Date'] ? 'bg-red-50' : 'bg-gradient-to-r from-green-50 to-emerald-50'}`}>
          <div className="flex flex-col md:flex-row md:items-start justify-between">
            <div className="flex items-start space-x-4">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold ${employee['Termination Date']
                ? 'bg-red-100 text-red-800'
                : 'bg-gradient-to-br from-green-100 to-emerald-200 text-emerald-800'
                }`}>
                {employee['First Name']?.[0]}{employee['Last Name']?.[0]}
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-gray-900">
                  {employee['First Name']} {employee['Last Name']}
                </h1>
                <p className="text-gray-600 mt-1">
                  <span className="font-medium">Employee ID:</span> {employee['Employee Number']}
                </p>
                {employee['Termination Date'] && (
                  <p className="text-red-600 mt-2 font-medium">
                    Terminated on {format(new Date(employee['Termination Date']), 'MMMM d, yyyy')}
                  </p>
                )}
              </div>
            </div>
            <div className={`px-3 py-1 rounded-full text-xs font-medium mt-4 md:mt-0 ${employee['Termination Date']
              ? 'bg-red-100 text-red-800 border border-red-200'
              : 'bg-green-100 text-green-800 border border-green-200'
              }`}>
              {employee['Termination Date'] ? 'Inactive' : 'Active'}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="p-6 md:p-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Termination Form / Details */}
            <div className={`bg-gray-50 rounded-lg p-5 border ${employee['Termination Date'] ? 'border-red-200' : 'border-green-200'}`}>
              <h3 className="font-semibold text-gray-800 flex items-center mb-4">
                {employee['Termination Date'] ? (
                  <>
                    <AlertTriangle className="mr-3 text-red-600" size={18} />
                    <span>Termination Details</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="mr-3 text-green-600" size={18} />
                    <span>Terminate Employee</span>
                  </>
                )}
              </h3>

              {employee['Termination Date'] ? (
                <div className="space-y-4">
                  <DetailRow label="Termination Date" value={format(new Date(employee['Termination Date']), 'MMMM d, yyyy')} />
                  <DetailRow label="Termination Reason" value={employee['Termination Reason'] || 'Not specified'} />
                  <DetailRow label="Exit Interview Notes" value={employee['Exit Interview Notes'] || 'Not conducted'} />

                  <div className="pt-4 mt-4 border-t border-gray-200">
                    <GlowButton
                      onClick={handlePrintTerminationLetter}
                      icon={PrinterIcon}
                      variant="secondary"
                      className="w-full mb-3"
                    >
                      Print Termination Letter
                    </GlowButton>

                    {canApproveTerminations() && (
                      <GlowButton
                        onClick={() => setShowConfirm(true)}
                        icon={Clock}
                        variant="secondary"
                        className="w-full"
                      >
                        Reverse Termination
                      </GlowButton>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Show warning if user cannot terminate */}
                  {!canTerminateEmployees() && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <div className="flex items-start">
                        <Shield className="w-5 h-5 text-red-600 mr-2 mt-0.5" />
                        <div>
                          <p className="font-medium text-red-800">Permission Denied</p>
                          <p className="text-red-700 text-sm mt-1">
                            You do not have permission to terminate employees. Please contact an administrator.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {canTerminateEmployees() && (
                    <>
                      <div className="space-y-2">
                        <label className="block text-xs font-medium text-gray-700">Termination Date *</label>
                        <input
                          type="date"
                          value={terminationDate}
                          onChange={(e) => setTerminationDate(e.target.value)}
                          min={format(new Date(), 'yyyy-MM-dd')}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="block text-xs font-medium text-gray-700">Termination Reason *</label>
                        <select
                          value={terminationReason}
                          onChange={(e) => setTerminationReason(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        >
                          <option value="">Select a reason...</option>
                          <option value="Voluntary Resignation">Voluntary Resignation</option>
                          <option value="Termination for Cause">Termination for Cause</option>
                          <option value="Performance Issues">Performance Issues</option>
                          <option value="Redundancy">Redundancy</option>
                          <option value="End of Contract">End of Contract</option>
                          <option value="Mutual Agreement">Mutual Agreement</option>
                          <option value="Retirement">Retirement</option>
                          <option value="Violation of Company Policy">Violation of Company Policy</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="block text-xs font-medium text-gray-700">Exit Interview Notes</label>
                        <textarea
                          rows={4}
                          value={exitInterview}
                          onChange={(e) => setExitInterview(e.target.value)}
                          placeholder="Optional notes from exit interview..."
                          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        />
                      </div>

                      {/* Approval Required Notice */}
                      {requiresApproval() && (
                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                          <div className="flex items-start">
                            <Shield className="w-5 h-5 text-yellow-600 mr-2 mt-0.5" />
                            <div>
                              <p className="font-medium text-yellow-800">Approval Required</p>
                              <p className="text-yellow-700 text-sm mt-1">
                                This employee has a managerial role. Termination requires admin approval.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      <GlowButton
                        onClick={() => setShowConfirm(true)}
                        icon={Trash2}
                        className="w-full mt-4"
                        disabled={!terminationDate || !terminationReason || !canTerminateEmployees()}
                      >
                        {requiresApproval() ? 'Submit for Approval' : 'Process Termination'}
                      </GlowButton>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Employee Information */}
            <div className="bg-gray-50 rounded-lg p-5 border border-gray-300">
              <h3 className="font-semibold text-gray-800 flex items-center mb-4">
                <User className="mr-3 text-emerald-600" size={18} />
                <span>Employee Summary</span>
              </h3>

              <div className="space-y-3">
                <DetailRow label="Full Name" value={`${employee['First Name']} ${employee['Middle Name'] || ''} ${employee['Last Name']}`.trim()} />
                <DetailRow label="Job Title" value={employee['Job Title'] || 'N/A'} />
                <DetailRow label="Department" value={employee['Employee Type'] || 'N/A'} />
                <DetailRow label="Start Date" value={employee['Start Date'] ? format(new Date(employee['Start Date']), 'MMMM d, yyyy') : 'N/A'} />
                <DetailRow label="Email" value={employee['Email Address'] || 'N/A'} />
                <DetailRow label="Phone" value={employee['Phone Number'] || 'N/A'} />
                {isAdmin && (
                  <DetailRow label="Basic Salary" value={employee['Basic Salary'] ? `KSh ${Number(employee['Basic Salary']).toLocaleString()}` : 'N/A'} />
                )}
              </div>
            </div>

            {/* Pending Approval Requests (for managers/admins) */}
            {(userRole === 'admin' || userRole === 'manager') && pendingTerminationRequests.length > 0 && (
              <div className="lg:col-span-2 bg-yellow-50 rounded-lg p-5 border border-yellow-200">
                <h3 className="font-semibold text-gray-800 flex items-center mb-4">
                  <UserCheck className="mr-3 text-yellow-600" size={18} />
                  <span>Pending Approval Requests</span>
                </h3>

                <div className="space-y-4">
                  {pendingTerminationRequests.map(request => (
                    <div key={request.id} className="bg-white rounded-lg p-4 border border-yellow-100">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <p className="text-sm font-medium text-gray-700">Requested By:</p>
                          <p className="text-sm">{request.requester?.full_name || 'Unknown'}</p>
                          <p className="text-xs text-gray-500">
                            {format(new Date(request.created_at), 'MMM d, yyyy h:mm a')}
                          </p>
                        </div>

                        <div>
                          <p className="text-sm font-medium text-gray-700">Termination Details:</p>
                          <p className="text-sm">Date: {format(new Date(request.termination_date), 'MMM d, yyyy')}</p>
                          <p className="text-sm">Reason: {request.termination_reason}</p>
                        </div>

                        <div>
                          {userRole === 'admin' ? (
                            <div className="flex space-x-2">
                              <GlowButton
                                onClick={() => approveTerminationRequest(request.id)}
                                icon={CheckCircle}
                                className="flex-1 text-xs"
                                size="sm"
                              >
                                Approve
                              </GlowButton>
                              <GlowButton
                                onClick={() => rejectTerminationRequest(request.id)}
                                icon={X}
                                variant="danger"
                                className="flex-1 text-xs"
                                size="sm"
                              >
                                Reject
                              </GlowButton>
                            </div>
                          ) : (
                            <p className="text-sm text-gray-600">Waiting for admin approval</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Termination Checklist */}
            <div className="bg-gray-50 rounded-lg p-5 border border-gray-300">
              <h3 className="font-semibold text-gray-800 flex items-center mb-4">
                <FileText className="mr-3 text-emerald-600" size={18} />
                <span>Termination Checklist</span>
              </h3>

              <div className="space-y-3">
                <ChecklistItem
                  label="Process final paycheck and benefits"
                  checked={employee['Termination Date'] !== null}
                />
                <ChecklistItem
                  label="Collect company property (laptop, badge, etc.)"
                  checked={employee['Termination Date'] !== null}
                />
                <ChecklistItem
                  label="Revoke system access"
                  checked={employee['Termination Date'] !== null}
                />
                <ChecklistItem
                  label="Conduct exit interview"
                  checked={!!employee['Exit Interview Notes']}
                />
                <ChecklistItem
                  label="Complete termination documentation"
                  checked={employee['Termination Date'] !== null}
                />
                <ChecklistItem
                  label="Send termination email"
                  checked={emailSent}
                />
              </div>

              {/* Gmail Integration Section */}
              {!employee['Termination Date'] && canTerminateEmployees() && (
                <div className="mt-6 pt-4 border-t border-gray-200">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-medium text-gray-700">Email Notification</h4>
                    <button
                      onClick={() => setShowEmailOptions(!showEmailOptions)}
                      className="text-sm text-emerald-600 hover:text-emerald-700"
                    >
                      {showEmailOptions ? 'Hide Options' : 'Customize'}
                    </button>
                  </div>

                  {showEmailOptions && (
                    <div className="space-y-3 mb-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Email Subject</label>
                        <input
                          type="text"
                          value={emailContent.subject}
                          onChange={(e) => setEmailContent({ ...emailContent, subject: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Email Body</label>
                        <textarea
                          rows={4}
                          value={emailContent.body}
                          onChange={(e) => setEmailContent({ ...emailContent, body: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-xs"
                        />
                      </div>
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          id="include-letter"
                          checked={emailContent.includeLetter}
                          onChange={(e) => setEmailContent({ ...emailContent, includeLetter: e.target.checked })}
                          className="mr-2"
                        />
                        <label htmlFor="include-letter" className="text-xs text-gray-700">
                          Include termination letter as attachment
                        </label>
                      </div>
                    </div>
                  )}

                  {!gmailAuthorized ? (
                    <div className="space-y-3">
                      <div className="text-sm text-gray-600 mb-2">
                        Authorize Gmail to send termination emails automatically.
                      </div>
                      <button
                        onClick={authorizeGmail}
                        disabled={isCheckingGmail}
                        className="flex items-center justify-center w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                      >
                        {isCheckingGmail ? (
                          <>
                            <Loader className="w-4 h-4 mr-2 animate-spin" />
                            Checking authorization...
                          </>
                        ) : (
                          <>
                            <Mail className="w-4 h-4 mr-2" />
                            Authorize Gmail
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div className="text-sm text-green-600 flex items-center">
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Gmail authorized. Emails will be sent automatically.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Termination Letter Preview */}
            {employee['Termination Date'] && (
              <div className="bg-gray-50 rounded-lg p-5 border border-gray-300">
                <h3 className="font-semibold text-gray-800 flex items-center mb-4">
                  <FileText className="mr-3 text-emerald-600" size={18} />
                  <span>Termination Letter Preview</span>
                </h3>

                <div className="bg-white p-4 rounded border border-gray-200 text-xs whitespace-pre-line h-64 overflow-y-auto">
                  {generateTerminationLetter()}
                </div>

                <div className="flex space-x-3 mt-4">
                  <GlowButton
                    onClick={handlePrintTerminationLetter}
                    icon={PrinterIcon}
                    variant="secondary"
                    className="flex-1"
                  >
                    Print Letter
                  </GlowButton>

                  {gmailAuthorized && !emailSent && (
                    <GlowButton
                      onClick={() => sendTerminationEmail({
                        employee_id: employee['Employee Number'],
                        termination_date: terminationDate,
                        termination_reason: terminationReason,
                        exit_interview: exitInterview,
                        employee_name: `${employee['First Name']} ${employee['Last Name']}`,
                        employee_email: employee['Email Address'],
                        employee_position: employee['Job Title']
                      } as TerminationRequest)}
                      icon={Mail}
                      className="flex-1"
                      disabled={sendingEmail}
                    >
                      {sendingEmail ? 'Sending...' : 'Send Email'}
                    </GlowButton>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full"
          >
            <div className="text-center">
              <div className={`mx-auto flex items-center justify-center h-12 w-12 rounded-full ${employee['Termination Date'] ? 'bg-blue-100' : 'bg-red-100'
                }`}>
                {employee['Termination Date'] ? (
                  <Clock className="h-6 w-6 text-blue-600" />
                ) : (
                  <AlertTriangle className="h-6 w-6 text-red-600" />
                )}
              </div>
              <h3 className="mt-3 text-lg font-medium text-gray-900">
                {employee['Termination Date']
                  ? 'Reverse Termination?'
                  : requiresApproval()
                    ? 'Submit for Approval?'
                    : 'Confirm Employee Termination'}
              </h3>
              <div className="mt-2 text-xs text-gray-500">
                {employee['Termination Date']
                  ? 'Are you sure you want to reverse this termination and reinstate the employee?'
                  : requiresApproval()
                    ? `This termination requires admin approval. A request will be submitted for review.`
                    : `You are about to terminate ${employee['First Name']} ${employee['Last Name']}. This action cannot be undone.`}
              </div>
            </div>
            <div className="mt-5 sm:mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                className="inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 sm:text-xs"
                onClick={() => setShowConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 sm:text-xs ${employee['Termination Date']
                  ? 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
                  : 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                  }`}
                onClick={employee['Termination Date'] ? handleReverseTermination : handleTerminateEmployee}
                disabled={isTerminating}
              >
                {isTerminating ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Processing...
                  </span>
                ) : employee['Termination Date']
                  ? 'Reverse Termination'
                  : requiresApproval()
                    ? 'Submit for Approval'
                    : 'Confirm Termination'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
};

// Helper Components
const DetailRow = ({ label, value }: { label: string; value: string | number | null }) => (
  <div className="flex justify-between py-2 px-2 hover:bg-gray-100 rounded-lg transition-colors">
    <span className="text-gray-600 font-medium">{label}</span>
    <span className="text-gray-900 text-right max-w-[60%] break-words">
      {value || <span className="text-gray-400">N/A</span>}
    </span>
  </div>
);

const ChecklistItem = ({ label, checked }: { label: string; checked: boolean }) => (
  <div className="flex items-start">
    <div className={`flex-shrink-0 h-5 w-5 rounded border flex items-center justify-center mt-0.5 mr-2 ${checked ? 'bg-green-100 border-green-500 text-green-600' : 'bg-gray-100 border-gray-300'
      }`}>
      {checked && (
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      )}
    </div>
    <span className={`text-sm ${checked ? 'text-gray-600 line-through' : 'text-gray-800'}`}>
      {label}
    </span>
  </div>
);

export default ViewEmployeePage;