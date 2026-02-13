import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Select from 'react-select';
import { useAppUpdate } from '../sw';
import { motion, AnimatePresence } from 'framer-motion';
import {
  EnvelopeSimple,
  LockKey,
  Buildings,
  ArrowRight,
  CircleNotch,
  CheckCircle
} from '@phosphor-icons/react';

interface LoginProps {
  onLoginSuccess: (userData: any) => void;
}

interface Branch {
  Town: string;
}

interface SuccessPopupProps {
  show: boolean;
  onClose: () => void;
  message: string;
}

// End of helper functions

function SuccessPopup({ show, onClose, message }: SuccessPopupProps) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white/10 backdrop-blur-3xl border border-white/20 p-8 rounded-lg shadow-2xl max-w-sm w-full text-center"
      >
        <div className="w-20 h-20 bg-gray-900/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle size={40} className="text-gray-900" weight="fill" />
        </div>
        <h3 className="text-2xl font-bold text-white mb-2">Request Sent!</h3>
        <p className="text-gray-200 text-xs mb-8">{message}</p>
        <button
          onClick={onClose}
          className="w-full py-4 bg-gray-900 hover:bg-gray-800 text-white text-xs font-bold rounded-lg shadow-lg transition-all"
        >
          Got it
        </button>
      </motion.div>
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
    'zira@zira.io',
    'admin@malicash.co'
  ];

  const isAdminEmail = (email: string) => ADMIN_EMAILS.includes(email.toLowerCase());
  const { checkForUpdates } = useAppUpdate();

  useEffect(() => {
    toast.dismiss();
    checkForUpdates();
  }, [checkForUpdates]);

  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session && searchParams.get('type') === 'signup') {
        toast.success('Email verified successfully!');
        navigate('/');
      }
    };
    checkSession();
  }, [navigate, searchParams]);

  useEffect(() => {
    const fetchTowns = async () => {
      try {
        const { data, error } = await supabase
          .from('kenya_branches_duplicate')
          .select('Town')
          .order('Town', { ascending: true });
        if (error) throw error;
        setBranches(data || []);
      } catch (error) {
        toast.error('Failed to load towns');
      } finally {
        setIsFetchingBranches(false);
      }
    };
    fetchTowns();
  }, []);

  const checkEmailExists = async (email: string) => {
    if (!email) return false;
    setIsCheckingEmail(true);
    try {
      const { data: authData } = await supabase
        .from('users')
        .select('email')
        .eq('email', email)
        .single();
      if (authData) {
        setEmailExists(true);
        return true;
      }
      const { data: signupData } = await supabase
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
      return false;
    } finally {
      setIsCheckingEmail(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (email && isSignUp) checkEmailExists(email);
    }, 500);
    return () => clearTimeout(timer);
  }, [email, isSignUp]);

  useEffect(() => {
    const detectTown = async () => {
      // Don't detect for empty or admin emails
      if (!email || isAdminEmail(email)) {
        setIsBranchAutoPopulated(false);
        setIsRegionalManager(false);
        return;
      }

      const searchEmail = email.trim();
      if (searchEmail.length < 5) return; // Wait for more characters

      try {
        // 1. Check regional managers first
        const { data: managerData } = await supabase
          .from('regional_managers')
          .select('email')
          .ilike('email', searchEmail)
          .maybeSingle();

        if (managerData) {
          setIsRegionalManager(true);
          setIsBranchAutoPopulated(false);
          return;
        }

        // 2. Check main employees table (current source of truth)
        const { data: mainEmpData } = await supabase
          .from('employees')
          .select('Town')
          .ilike('"Work Email"', searchEmail)
          .maybeSingle();

        if (mainEmpData?.Town) {
          setSelectedBranch(mainEmpData.Town);
          setIsBranchAutoPopulated(true);
          setIsRegionalManager(false);
          return;
        }

        // 3. Fallback to duplicate records table
        const { data: employeeData } = await supabase
          .from('Employee_Records_Duplicate')
          .select('Town')
          .ilike('"Official Email"', searchEmail)
          .maybeSingle();

        if (employeeData && employeeData.Town) {
          setSelectedBranch(employeeData.Town);
          setIsBranchAutoPopulated(true);
          setIsRegionalManager(false);
        } else {
          setIsBranchAutoPopulated(false);
          setIsRegionalManager(false);
        }
      } catch (err) {
        console.error('Branch detection error:', err);
      }
    };

    const timer = setTimeout(() => {
      detectTown();
    }, 600); // 600ms debounce

    return () => clearTimeout(timer);
  }, [email]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('id', data.user.id)
        .single();

      if (userData) {
        onLoginSuccess(userData);
      }
    } catch (error: any) {
      toast.error(error.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleStaffSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (emailExists) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('staff_signup_requests')
        .insert([{
          email,
          branch: isAdminEmail(email) ? 'HEAD_OFFICE' : selectedBranch,
          status: 'pending'
        }]);
      if (error) throw error;
      setShowSuccessPopup(true);
      setEmail('');
      setSelectedBranch('');
      setIsBranchAutoPopulated(false);
    } catch (error: any) {
      toast.error(error.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail);
      if (error) throw error;
      toast.success('Reset link sent to your email');
      setShowForgotPassword(false);
    } catch (error: any) {
      toast.error(error.message || 'Failed to send reset link');
    } finally {
      setResetLoading(false);
    }
  };

  const branchOptions = branches.map(branch => ({
    value: branch.Town,
    label: branch.Town
  }));

  return (
    <div className="flex min-h-screen bg-gray-50 font-sans [&_h1]:font-sans [&_h2]:font-sans [&_h3]:font-sans [&_h4]:font-sans [&_button]:font-sans [&_input]:font-sans [&_label]:font-sans">
      {/* Left side - Visual & Brand */}
      <div className="hidden lg:flex lg:w-[45%] relative overflow-hidden bg-gray-900">
        {/* Animated Background Layers */}
        <div className="absolute inset-0 z-0">
          <img
            src="/leaf.jpg"
            alt="Nature Background"
            className="absolute inset-0 w-full h-full object-cover opacity-50"
          />
          <div className="absolute inset-0 bg-black/40" />
        </div>

        {/* Content Overlay */}
        <div className="relative z-10 w-full flex flex-col justify-between p-16">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center shadow-lg shadow-black/20">
              <img src="/solo.png" alt="Company Logo" className="w-6 h-6 object-contain brightness-0 invert" />
            </div>
            <span className="text-white font-bold text-2xl tracking-tight">Zira<span className="text-gray-400">HR</span></span>
          </div>

          <div className="space-y-6">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
            >
              <h1 className="text-5xl font-extrabold text-white leading-tight">
                Automate Your <br />
                <span className="text-gray-400">Payroll & HR Workflows</span>
              </h1>
              <p className="mt-4 text-gray-400 text-xs max-w-md">
                Manage staff records, automate compensation, and handle branch operations with a single, unified business dashboard.
              </p>
            </motion.div>

            <div className="flex gap-12 pt-8">
              <div className="flex flex-col">
                <span className="text-white font-bold text-2xl">99.9%</span>
                <span className="text-gray-500 text-xs uppercase tracking-widest font-bold">Uptime</span>
              </div>
              <div className="flex flex-col">
                <span className="text-white font-bold text-2xl">24/7</span>
                <span className="text-gray-500 text-xs uppercase tracking-widest font-bold">Support</span>
              </div>
            </div>
          </div>

          <div className="text-white text-xs font-light">
            © 2026 Mular Credit · Business edition
          </div>
        </div>
      </div>

      {/* Right side - Auth Form */}
      <div className="w-full lg:w-[55%] flex items-center justify-center p-6 lg:p-12 relative bg-white">
        <div className="w-full max-w-[440px]">
          {/* Mobile Logo */}
          <div className="lg:hidden text-center mb-10">
            <div className="inline-flex items-center gap-2 mb-2">
              <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center">
                <img src="/solo.png" alt="Logo" className="w-5 h-5 brightness-0 invert" />
              </div>
              <span className="text-2xl font-bold text-gray-900 tracking-tight">Zira<span className="text-gray-500">HR</span></span>
            </div>
          </div>

          <AnimatePresence mode='wait'>
            <motion.div
              key={isSignUp ? 'signup' : 'login'}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="space-y-8"
            >
              <div className="space-y-2">
                <h2 className="text-3xl font-bold text-gray-900">
                  {isSignUp ? 'Apply for Account' : 'Welcome Back'}
                </h2>
                <p className="text-gray-500 text-xs font-medium">
                  {isSignUp
                    ? 'Submit your details to join the organization.'
                    : 'Enter your credentials to access your dashboard.'}
                </p>
              </div>

              <form className="space-y-6" onSubmit={isSignUp ? handleStaffSignUp : handleLogin}>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-500 ml-1">Email address</label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <EnvelopeSimple size={20} className="text-gray-400 group-focus-within:text-gray-900 transition-colors" />
                    </div>
                    <input
                      type="email"
                      required
                      className={`block w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900 transition-all ${emailExists && isSignUp ? 'border-red-300 focus:border-red-500' : 'hover:border-gray-300'
                        }`}
                      placeholder="name@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    {isCheckingEmail && (
                      <div className="absolute inset-y-0 right-4 flex items-center">
                        <CircleNotch size={18} className="animate-spin text-gray-900" />
                      </div>
                    )}
                  </div>
                </div>

                {!isSignUp && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center ml-1">
                      <label className="text-xs font-bold text-gray-500">Password</label>
                      <button
                        type="button"
                        onClick={() => setShowForgotPassword(true)}
                        className="text-xs font-medium text-gray-400 hover:text-gray-900 transition-colors"
                      >
                        Forgot?
                      </button>
                    </div>
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <LockKey size={20} className="text-gray-400 group-focus-within:text-gray-900 transition-colors" />
                      </div>
                      <input
                        type="password"
                        required
                        className="block w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900 hover:border-gray-300 transition-all"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {!isAdminEmail(email) && !isRegionalManager && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-500 ml-1 flex items-center gap-2">
                      Town office
                      {isBranchAutoPopulated && (
                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-gray-900 text-[10px] font-bold border border-gray-200 bg-gray-100">
                          <CheckCircle size={10} weight="fill" /> AUTO
                        </span>
                      )}
                    </label>
                    <div className="relative group">
                      <div className="absolute z-10 top-[14px] left-4 pointer-events-none">
                        <Buildings size={20} className="text-gray-400 group-focus-within:text-gray-900 transition-colors" />
                      </div>
                      <div className="relative">
                        {isBranchAutoPopulated ? (
                          <input
                            type="text"
                            className="block w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-900 font-medium cursor-not-allowed"
                            value={selectedBranch}
                            readOnly
                          />
                        ) : (
                          <Select
                            id="branch"
                            name="branch"
                            options={branchOptions}
                            placeholder="Select branch..."
                            isSearchable
                            isLoading={isFetchingBranches}
                            styles={{
                              control: (base: any, state: any) => ({
                                ...base,
                                minHeight: '48px',
                                backgroundColor: '#f9fafb',
                                borderRadius: '0.5rem',
                                paddingLeft: '32px',
                                fontSize: '0.75rem',
                                borderColor: state.isFocused ? '#111827' : '#e5e7eb',
                                boxShadow: 'none',
                                '&:hover': {
                                  borderColor: state.isFocused ? '#111827' : '#d1d5db'
                                }
                              }),
                              menu: (base: any) => ({
                                ...base,
                                borderRadius: '0.5rem',
                                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                                padding: '0.5rem',
                                fontSize: '0.75rem'
                              }),
                              option: (base: any, state: any) => ({
                                ...base,
                                borderRadius: '0.25rem',
                                backgroundColor: state.isSelected ? '#111827' : state.isFocused ? '#f3f4f6' : 'transparent',
                                color: state.isSelected ? 'white' : '#374151'
                              })
                            }}
                            value={selectedBranch ? { value: selectedBranch, label: selectedBranch } : null}
                            onChange={(selectedOption: any) => setSelectedBranch(selectedOption?.value || '')}
                            components={{ IndicatorSeparator: () => null }}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="pt-2">
                  <motion.button
                    type="submit"
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    disabled={loading || isFetchingBranches || (isSignUp && emailExists)}
                    className={`w-full flex justify-center items-center gap-2 py-4 px-4 rounded-lg text-xs font-bold text-white shadow-lg transition-all ${loading || isFetchingBranches || (isSignUp && emailExists)
                      ? 'bg-gray-300 cursor-not-allowed shadow-none'
                      : 'bg-gray-900 hover:bg-gray-800 shadow-gray-900/20'
                      }`}
                  >
                    {loading ? (
                      <>
                        <CircleNotch size={20} className="animate-spin" />
                        <span>Processing...</span>
                      </>
                    ) : (
                      <>
                        <span>{isSignUp ? 'Request Access' : 'Sign In'}</span>
                        <ArrowRight size={18} weight="bold" />
                      </>
                    )}
                  </motion.button>
                </div>
              </form>

              <div className="text-center pt-8 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsSignUp(!isSignUp)}
                  className="text-gray-500 text-xs font-medium hover:text-gray-900 transition-colors"
                >
                  {isSignUp ? 'Already have an account?' : 'Need an account?'}
                  <span className="ml-1 text-gray-900 font-bold underline decoration-gray-200 underline-offset-4">
                    {isSignUp ? 'Sign In' : 'Apply Now'}
                  </span>
                </button>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <SuccessPopup
        show={showSuccessPopup}
        onClose={() => {
          setShowSuccessPopup(false);
          setIsSignUp(false);
        }}
        message="Your account request has been submitted successfully."
      />

      {showForgotPassword && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white p-8 rounded-lg shadow-2xl max-w-md w-full relative"
          >
            <div className="flex justify-between items-start mb-6">
              <div className="space-y-1">
                <h3 className="text-xl font-bold text-gray-900">Reset Password</h3>
                <p className="text-xs text-gray-500">We'll send a recovery link to your email.</p>
              </div>
              <button
                onClick={() => {
                  setShowForgotPassword(false);
                  setResetEmail('');
                }}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <span className="text-2xl">&times;</span>
              </button>
            </div>

            <form onSubmit={handleForgotPassword} className="space-y-6">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-500 ml-1">Work email</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <EnvelopeSimple size={20} className="text-gray-400" />
                  </div>
                  <input
                    type="email"
                    required
                    className="block w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-900 transition-all"
                    placeholder="name@company.com"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowForgotPassword(false);
                    setResetEmail('');
                  }}
                  className="flex-1 py-3 px-4 bg-gray-50 hover:bg-gray-100 text-gray-700 text-xs font-semibold rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetLoading}
                  className="flex-1 py-3 px-4 bg-gray-900 hover:bg-gray-800 text-white text-xs font-bold rounded-lg shadow-lg shadow-gray-900/25 transition-all disabled:opacity-50"
                >
                  {resetLoading ? 'Sending...' : 'Send Link'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}