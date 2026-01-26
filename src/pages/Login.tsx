import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Select from 'react-select';
import { useAppUpdate } from '../sw';

interface LoginProps {
  onLoginSuccess: (selectedTown: string, userRole: string) => void;
}

interface Branch {
  'Branch Office': string;
}

interface SuccessPopupProps {
  show: boolean;
  onClose: () => void;
  message: string;
}

// SMS Service functions (same as your SMS center)
const formatPhoneNumberForSMS = (phone: string): string => {
  if (!phone) return '';

  let cleaned = phone.replace(/\D/g, '');

  if (cleaned.startsWith('0') && cleaned.length === 10) {
    cleaned = '254' + cleaned.substring(1);
  } else if (cleaned.startsWith('7') && cleaned.length === 9) {
    cleaned = '254' + cleaned;
  } else if (cleaned.startsWith('254') && cleaned.length === 12) {
    // Keep as is
  } else if (cleaned.startsWith('+254') && cleaned.length === 13) {
    cleaned = cleaned.substring(1);
  }

  if (cleaned.length === 12 && cleaned.startsWith('254')) {
    return cleaned;
  }

  return '';
};

const sendSMS = async (phoneNumber: string, message: string): Promise<{
  success: boolean;
  message?: string;
  error?: string;
  messageId?: string;
}> => {
  try {
    const formattedPhone = formatPhoneNumberForSMS(phoneNumber);

    if (!formattedPhone) {
      throw new Error(`Invalid phone number format: ${phoneNumber}`);
    }

    if (!message || message.trim().length === 0) {
      throw new Error('Message cannot be empty');
    }

    // Celcom Africa API Configuration
    const CELCOM_AFRICA_CONFIG = {
      baseUrl: 'https://isms.celcomafrica.com/api/services/sendsms',
      apiKey: '***REMOVED***',
      partnerID: '928',
      defaultShortcode: 'MularCredit'
    };

    // URL encode the message
    const encodedMessage = encodeURIComponent(message.trim());

    // Construct GET URL
    const endpoint = `${CELCOM_AFRICA_CONFIG.baseUrl}/?apikey=${CELCOM_AFRICA_CONFIG.apiKey}&partnerID=${CELCOM_AFRICA_CONFIG.partnerID}&message=${encodedMessage}&shortcode=${CELCOM_AFRICA_CONFIG.defaultShortcode}&mobile=${formattedPhone}`;

    console.log('🚀 Sending MFA SMS...');

    // Use fetch with no-cors mode
    const response = await fetch(endpoint, {
      method: 'GET',
      mode: 'no-cors',
    });

    console.log('✅ MFA SMS request sent successfully');

    // Log the SMS to database
    const messageId = `mfa-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    await logSMS(
      formattedPhone,
      message,
      'sent',
      CELCOM_AFRICA_CONFIG.defaultShortcode,
      undefined,
      messageId,
      0
    );

    return {
      success: true,
      message: 'MFA SMS sent successfully',
      messageId: messageId
    };

  } catch (error) {
    console.error('❌ MFA SMS sending error:', error);

    await logSMS(
      formatPhoneNumberForSMS(phoneNumber),
      message,
      'failed',
      'MularCredit',
      (error as Error).message
    );

    return {
      success: false,
      error: (error as Error).message
    };
  }
};

const logSMS = async (
  recipientPhone: string,
  message: string,
  status: 'sent' | 'failed',
  senderId: string,
  errorMessage?: string,
  messageId?: string,
  cost?: number
): Promise<void> => {
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
        cost: cost,
        sms_type: 'mfa'
      });

    if (error) {
      console.error('Failed to log MFA SMS:', error);
    }
  } catch (error) {
    console.error('Error logging MFA SMS:', error);
  }
};

function SuccessPopup({ show, onClose, message }: SuccessPopupProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg shadow-lg max-w-md w-full">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-lg font-medium text-green-600">Success!</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
            aria-label="Close popup"
          >
            &times;
          </button>
        </div>
        <p className="text-gray-700">{message}</p>
        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isFetchingBranches, setIsFetchingBranches] = useState(true);
  const [isSignUp, setIsSignUp] = useState(false);
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [isBranchAutoPopulated, setIsBranchAutoPopulated] = useState(false);
  const [isRegionalManager, setIsRegionalManager] = useState(false);
  const [isCheckingEmail, setIsCheckingEmail] = useState(false);
  const [emailExists, setEmailExists] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Admin emails that should skip branch auto-detection
  const ADMIN_EMAILS = [
    'admin@mularcredit.co.ke',
    'checker@mularcredit.com',
    'hr@mularcredit.co.ke',
    'it@mularcredit.co.ke',
    'hr@zira.com',
    'olivia.hr@mularcredit.com',
    'daniel.admin@mularcredit.com',
    'checker.superadmin@mularcredit.com',
    'titus1admin@mularcredit.co.ke',
    'ian3admin@mularcredit.co.ke',
    'collins2admin@mularcredit.co.ke',
    'zira@zira.io'

  ];

  const isAdminEmail = (email: string) => {
    return ADMIN_EMAILS.includes(email.toLowerCase());
  };

  const { checkForUpdates } = useAppUpdate();

  // Clear any existing toasts when login page loads
  useEffect(() => {
    // Dismiss all toasts to prevent stale messages from showing
    toast.dismiss();
    // Check for updates on login page load
    checkForUpdates();
  }, [checkForUpdates]);

  // Check for email confirmation redirect
  useEffect(() => {
    const checkSession = async () => {
      const { data, error } = await supabase.auth.getSession();

      if (data.session && searchParams.get('type') === 'signup') {
        toast.success('Email verified successfully! Welcome to Zira HR.');
        navigate('/');
      }
    };

    checkSession();
  }, [navigate, searchParams]);

  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const { data, error } = await supabase
          .from('kenya_branches_duplicate')
          .select('"Branch Office"')
          .order('Branch Office', { ascending: true });

        if (error) throw error;
        setBranches(data || []);
      } catch (error) {
        console.error('Error fetching branches:', error);
        toast.error('Failed to load branch offices');
      } finally {
        setIsFetchingBranches(false);
      }
    };

    fetchBranches();
  }, []);

  // Function to check if email already exists
  const checkEmailExists = async (email: string) => {
    if (!email) return false;

    setIsCheckingEmail(true);
    try {
      // Check auth.users table
      const { data: authData, error: authError } = await supabase
        .from('users')
        .select('email')
        .eq('email', email)
        .single();

      if (authData) {
        setEmailExists(true);
        return true;
      }

      // Check pending signup requests
      const { data: signupData, error: signupError } = await supabase
        .from('staff_signup_requests')
        .select('email')
        .eq('email', email)
        .eq('status', 'pending')
        .single();

      if (signupData) {
        setEmailExists(true);
        return true;
      }

      setEmailExists(false);
      return false;
    } catch (error) {
      console.error('Error checking email:', error);
      setEmailExists(false);
      return false;
    } finally {
      setIsCheckingEmail(false);
    }
  };

  const fetchBranchFromEmail = async (email: string) => {
    const lowerEmail = email.toLowerCase();

    // Keep your existing domain/admin checks
    const isValidDomain = lowerEmail.endsWith('@mularcredit.co.ke') || lowerEmail.endsWith('@mularcredit.com');
    if (!isValidDomain || isAdminEmail(lowerEmail)) {
      setIsBranchAutoPopulated(false);
      setIsRegionalManager(false);
      return;
    }

    try {
      console.log('🔍 Searching for email:', lowerEmail);

      // FIRST: Check manager_email column for branch managers
      console.log('1. Checking manager_email column...');
      const { data: managerData, error: managerError } = await supabase
        .from('employees')
        .select('Town, manager_email, "Job Title"')
        .ilike('manager_email', lowerEmail)
        .maybeSingle();

      if (managerData && managerData.Town) {
        console.log('✅ Found branch manager in manager_email column:', managerData.Town);
        setSelectedBranch(managerData.Town);
        setIsBranchAutoPopulated(true);

        // Check for Regional Manager
        if (managerData['Job Title']?.toLowerCase().includes('regional')) {
          setIsRegionalManager(true);
        } else {
          setIsRegionalManager(false);
        }
        return; // Stop here if found
      }

      // SECOND: If not found, check "Work Email" column for staff
      console.log('2. Checking "Work Email" column...');
      const { data: employeeData, error: employeeError } = await supabase
        .from('employees')
        .select('Town, "Work Email", "Job Title"')
        .ilike('"Work Email"', lowerEmail)
        .maybeSingle();

      if (employeeData && employeeData.Town) {
        console.log('✅ Found staff in "Work Email" column:', employeeData.Town);
        setSelectedBranch(employeeData.Town);
        setIsBranchAutoPopulated(true);

        // Check for Regional Manager
        if (employeeData['Job Title']?.toLowerCase().includes('regional')) {
          setIsRegionalManager(true);
        } else {
          setIsRegionalManager(false);
        }
        return;
      }

      // THIRD: Check if this email is listed as a regional_manager for ANY employee
      console.log('3. Checking "regional_manager" column...');
      const { data: rmCheckData } = await supabase
        .from('employees')
        .select('regional_manager')
        .ilike('regional_manager', lowerEmail)
        .limit(1);

      if (rmCheckData && rmCheckData.length > 0) {
        console.log('✅ Identified as Regional Manager via regional_manager column');
        setIsRegionalManager(true);
      }

      // If neither column has the email
      console.log('❌ Email not found in manager_email or "Work Email" columns');
      setIsBranchAutoPopulated(false);

    } catch (error) {
      console.error('🚨 Unexpected error:', error);
      setIsBranchAutoPopulated(false);
    }
  };

  // Get phone number from mfa_numbers table
  const getPhoneNumberForMFA = async (email: string): Promise<string | null> => {
    try {
      const { data, error } = await supabase
        .from('mfa_numbers')
        .select('phone_number')
        .eq('email', email)
        .single();

      if (error) {
        console.error('Error fetching phone number:', error);
        return null;
      }

      return data?.phone_number || null;
    } catch (error) {
      console.error('Error getting phone number for MFA:', error);
      return null;
    }
  };

  // Store MFA code in database
  const storeMFACode = async (userId: string, email: string, code: string, phoneNumber: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('mfa_codes')
        .upsert({
          user_id: userId,
          email: email,
          code: code,
          phone_number: phoneNumber,
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes
          used: false
        });

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Error storing MFA code:', error);
      return false;
    }
  };

  // Send MFA code via SMS
  const sendMFACode = async (userId: string, email: string): Promise<boolean> => {
    try {
      // Get phone number from mfa_numbers table
      const phoneNumber = await getPhoneNumberForMFA(email);

      if (!phoneNumber) {
        throw new Error('Phone number not found for MFA. Please contact administrator.');
      }

      // Generate a 6-digit code
      const mfaCode = Math.floor(100000 + Math.random() * 900000).toString();

      // Store the MFA code in the database
      const stored = await storeMFACode(userId, email, mfaCode, phoneNumber);
      if (!stored) {
        throw new Error('Failed to generate MFA code');
      }

      // Send SMS with the code
      const message = `Your Mular Credit verification code is: ${mfaCode}. This code expires in 10 minutes.`;

      const smsResult = await sendSMS(phoneNumber, message);

      if (!smsResult.success) {
        throw new Error(smsResult.error || 'Failed to send verification code via SMS');
      }

      console.log(`✅ MFA code ${mfaCode} sent to ${phoneNumber}`);
      return true;
    } catch (error: any) {
      console.error('MFA SMS error:', error);
      // Use the actual error message
      toast.error(error.message || 'Failed to send verification code');
      return false;
    }
  };

  // Handle email change with debounce
  useEffect(() => {
    if (!email) {
      setIsBranchAutoPopulated(false);
      setIsRegionalManager(false);
      setEmailExists(false);
      return;
    }

    const timer = setTimeout(() => {
      fetchBranchFromEmail(email);
      if (isSignUp) {
        checkEmailExists(email);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [email, isSignUp]);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!resetEmail) {
      toast.error('Please enter your email address');
      return;
    }

    setResetLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: `${window.location.origin}/auth/callback`,
      });


      if (error) throw error;

      toast.success('Password reset link sent! Check your email.');
      setShowForgotPassword(false);
      setResetEmail('');
    } catch (error: any) {
      console.error('Password reset error:', error);
      toast.error(error.message || 'Failed to send reset email');
    } finally {
      setResetLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      const userRole = data.user?.user_metadata?.role || 'STAFF';
      console.log('User role detected:', userRole);

      // Check if user is CHECKER or ADMIN role - require MFA
      if (userRole === 'CHECKER' || userRole === 'ADMIN') {
        console.log(`${userRole} role detected, initiating MFA...`);

        // Check if phone number exists for MFA
        const phoneNumber = await getPhoneNumberForMFA(email);
        if (!phoneNumber) {
          throw new Error('MFA phone number not configured. Please contact administrator.');
        }

        // CRITICAL: Set MFA process flag to prevent dashboard flash
        sessionStorage.setItem('isMFAProcess', 'true');

        // Immediately redirect to verification page
        navigate(`/mfa?email=${encodeURIComponent(email)}&userId=${data.user.id}&role=${userRole}`);

        // Send MFA code via SMS in the background
        sendMFACode(data.user.id, email)
          .then((success) => {
            if (success) {
              toast.success(`Verification code sent to your phone number`);
            } else {
              toast.error('Failed to send verification code');
            }
          })
          .catch((error) => {
            console.error('Failed to send MFA code:', error);
          });

        setLoading(false);
        return; // Stop execution here
      }

      // Handle other roles (non-CHECKER, non-ADMIN) normally
      console.log('Non-MFA role, proceeding with normal login...');

      // Check if Regional Manager by email lookup (if role didn't catch it)
      // This covers the case where "a user is a regional manager if they have a regional manager email"
      let isRegionalByEmail = false;
      const { data: rmCheck } = await supabase
        .from('employees')
        .select('regional_manager')
        .ilike('regional_manager', email)
        .limit(1);

      if (rmCheck && rmCheck.length > 0) {
        isRegionalByEmail = true;
      }

      if (userRole === 'ADMIN' || userRole === 'REGIONAL' || isRegionalByEmail || isAdminEmail(email)) {
        toast.success('Login successful!');
        onLoginSuccess('ADMIN_ALL', isRegionalByEmail ? 'REGIONAL' : userRole);
        navigate('/dashboard');
        return;
      }

      if (!selectedBranch) {
        throw new Error('Please select your branch office');
      }

      toast.success('Login successful!');
      onLoginSuccess(selectedBranch, userRole);

      if (userRole === 'STAFF') {
        navigate('/staff');
      } else {
        navigate('/dashboard');
      }
    } catch (error: any) {
      console.error('Login error:', error);
      toast.error(error.message || 'Login failed');
      if (error.message === 'Please select your branch office') {
        await supabase.auth.signOut();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleStaffSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (!email.endsWith('@mularcredit.co.ke')) {
        throw new Error('Only company email addresses are allowed for sign up');
      }

      if (isAdminEmail(email)) {
        throw new Error('Admin accounts must be created by system administrators');
      }

      if (!selectedBranch && !isAdminEmail(email)) {
        throw new Error('Please select your branch office');
      }

      // Check if email exists one more time right before submission
      const emailAlreadyExists = await checkEmailExists(email);
      if (emailAlreadyExists) {
        throw new Error('This email is already registered or has a pending request');
      }

      // Submit signup request to admin (no password needed)
      const { data, error } = await supabase
        .from('staff_signup_requests')
        .insert([
          {
            email,
            branch: isAdminEmail(email) ? 'HEAD_OFFICE' : selectedBranch,
            status: 'pending'
          }
        ]);

      if (error) throw error;

      setShowSuccessPopup(true);
      setEmail('');
      setSelectedBranch('');
      setIsBranchAutoPopulated(false);
    } catch (error: any) {
      toast.error(error.message || 'Sign up request failed');
    } finally {
      setLoading(false);
    }
  };

  const branchOptions = branches.map(branch => ({
    value: branch['Branch Office'],
    label: branch['Branch Office']
  }));

  return (
    <div className="flex min-h-screen">
      {/* Left side - Modern Design */}
      <div className="hidden lg:flex w-1/2 bg-black bg-opacity-80 items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0">
          <img
            src="/leaf.jpg"
            alt="Decorative background"
            className="h-full w-full object-cover opacity-30"
          />
        </div>

        <div className="absolute top-8 left-8 z-10">
          <img src="/solo.png" alt="Company Logo" className="h-16" />
        </div>
      </div>

      {/* Right side - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-white">
        <div className="w-full max-w-md">
          <div className="text-center mb-8 lg:hidden">
            <img src="/logo.png" alt="Company Logo" className="h-16 mx-auto mb-4" />
            <h1 className="text-3xl font-bold text-green-700 mb-2"></h1>
            <p className="text-gray-600 italic"></p>
          </div>

          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-gray-900">
              {isSignUp ? 'Request Staff Account' : 'Welcome back'}
            </h2>
            <p className="mt-2 text-xs text-gray-600">
              {isSignUp ? 'Submit your details for account approval' : 'Sign in with your credentials'}
            </p>
          </div>

          <form className="space-y-6" onSubmit={isSignUp ? handleStaffSignUp : handleLogin}>
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-gray-700">
                Email address
              </label>
              <div className="relative">
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className={`mt-1 block w-full px-4 py-3 border ${emailExists && isSignUp ? 'border-red-500' : 'border-gray-300'} rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200`}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="staff@mularcredit.co.ke"
                />
                {isCheckingEmail && (
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                    <svg className="animate-spin h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  </div>
                )}
              </div>
              {emailExists && isSignUp && (
                <p className="mt-1 text-xs text-red-600">This email is already registered or has a pending request</p>
              )}
            </div>

            {/* Only show password field for login, not signup */}
            {!isSignUp && (
              <div>
                <label htmlFor="password" className="block text-xs font-medium text-gray-700">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="mt-1 block w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            )}

            {/* Show branch selection for both login and signup, except for admin emails or regional managers */}
            {!isAdminEmail(email) && !isRegionalManager && (
              <div className="relative z-20">
                <label htmlFor="branch" className="block text-xs font-medium text-gray-700">
                  Branch Office
                  {isBranchAutoPopulated && (
                    <span className="ml-2 text-xs text-green-600">(Auto-detected from your email)</span>
                  )}
                </label>
                {isFetchingBranches ? (
                  <div className="mt-1 block h-3 w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm bg-gray-100 animate-pulse">
                    Loading branches...
                  </div>
                ) : isBranchAutoPopulated ? (
                  <input
                    type="text"
                    className="mt-1 block w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm bg-gray-100 cursor-not-allowed"
                    value={selectedBranch}
                    readOnly
                  />
                ) : (
                  <Select
                    id="branch"
                    name="branch"
                    options={branchOptions}
                    className="mt-1 text-xs"
                    classNamePrefix="select"
                    placeholder="Select or type to search..."
                    isSearchable
                    isLoading={isFetchingBranches}
                    value={selectedBranch ? { value: selectedBranch, label: selectedBranch } : null}
                    onChange={(selectedOption) => {
                      setSelectedBranch(selectedOption?.value || '');
                    }}
                    styles={{
                      control: (base) => ({
                        ...base,
                        minHeight: '48px',
                        borderColor: '#d1d5db',
                        '&:hover': {
                          borderColor: '#9ca3af'
                        },
                        boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)'
                      }),
                      menu: (base) => ({
                        ...base,
                        zIndex: 30,
                        maxHeight: '200px',
                        overflow: 'auto'
                      }),
                      menuPortal: base => ({ ...base, zIndex: 9999 }),
                      option: (base, { isFocused }) => ({
                        ...base,
                        backgroundColor: isFocused ? '#f0fdf4' : 'white',
                        color: '#1f2937',
                        '&:active': {
                          backgroundColor: '#dcfce7'
                        }
                      })
                    }}
                    menuPortalTarget={document.body}
                    menuPosition={'fixed'}
                    theme={(theme) => ({
                      ...theme,
                      colors: {
                        ...theme.colors,
                        primary: '#10b981',
                        primary25: '#dcfce7',
                        primary50: '#bbf7d0'
                      }
                    })}
                  />
                )}
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={loading || isFetchingBranches || (isSignUp && emailExists)}
                className={`w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-xs font-medium text-white ${loading || isFetchingBranches || (isSignUp && emailExists)
                  ? 'bg-green-400 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700'
                  } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-all duration-200`}
              >
                {loading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {isSignUp ? 'Submitting...' : 'Signing in...'}
                  </>
                ) : (
                  isSignUp ? 'Request Account' : 'Sign in'
                )}
              </button>
            </div>
          </form>

          {/* Forgot Password Link - Only show on login, not signup */}
          {!isSignUp && (
            <div className="mt-4 text-center">
              <button
                onClick={() => setShowForgotPassword(true)}
                className="text-xs text-green-600 hover:text-green-500 font-medium transition-colors duration-200"
              >
                Forgot your password?
              </button>
            </div>
          )}

          <div className="mt-6 text-center text-xs text-gray-600">
            <p>
              {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
              <button
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setEmail('');
                  setPassword('');
                  setSelectedBranch('');
                  setIsBranchAutoPopulated(false);
                  setEmailExists(false);
                }}
                className="font-medium text-green-600 hover:text-green-500 transition-colors duration-200"
              >
                {isSignUp ? 'Sign in' : 'Request account'}
              </button>
            </p>
          </div>
        </div>
      </div>

      <SuccessPopup
        show={showSuccessPopup}
        onClose={() => {
          setShowSuccessPopup(false);
          setIsSignUp(false);
        }}
        message="Your account request has been submitted. An admin will create your account and provide you with login credentials."
      />

      {/* Forgot Password Modal */}
      {showForgotPassword && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-8 rounded-2xl shadow-lg max-w-md w-full mx-4">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Reset Password</h3>
                <p className="text-xs text-gray-600 mt-1">Enter your email to receive a password reset link</p>
              </div>
              <button
                onClick={() => {
                  setShowForgotPassword(false);
                  setResetEmail('');
                }}
                className="text-gray-500 hover:text-gray-700 text-2xl"
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div>
                <label htmlFor="reset-email" className="block text-xs font-medium text-gray-700 mb-2">
                  Email address
                </label>
                <input
                  id="reset-email"
                  name="reset-email"
                  type="email"
                  autoComplete="email"
                  required
                  className="block w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="your.email@mularcredit.co.ke"
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowForgotPassword(false);
                    setResetEmail('');
                  }}
                  className="flex-1 py-3 px-4 border border-gray-300 rounded-md shadow-sm text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetLoading}
                  className="flex-1 py-3 px-4 border border-transparent rounded-md shadow-sm text-xs font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                >
                  {resetLoading ? (
                    <span className="flex items-center justify-center">
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Sending...
                    </span>
                  ) : (
                    'Send Reset Link'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}