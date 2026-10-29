import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAppUpdate } from '../sw';
import ShowPasswordButton from '../components/UI/ShowPasswordButton';
import AuthLayout from '../components/Auth/AuthLayout';
import { authButtonPrimary, authHeading, authInputOpen, authLabel, authLink, authQuietLink, authSubtitle } from '../components/Auth/authStyles';
import { motion, AnimatePresence } from 'framer-motion';
import {
  EnvelopeSimple,
  LockKey,
  ArrowRight,
  CircleNotch
} from '@phosphor-icons/react';

interface LoginProps {
  onLoginSuccess: (userData: any) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

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
        // Immediate termination checks - verify account status
        if (userData.account_status && userData.account_status !== 'ACTIVE') {
          await supabase.auth.signOut();
          toast.error(`Your account is ${userData.account_status.toLowerCase()}. Please contact support.`);
          setLoading(false);
          return;
        }

        // Verify employment status for everyone except ADMIN (admins may have no employee record)
        if (userData.role !== 'ADMIN') {
          const { data: empData } = await supabase
            .from('employees')
            .select('Status, "Termination Date"')
            .eq('"Work Email"', email)
            .maybeSingle();

          // left: Inactive/Terminated, or their termination date has come (an exit approved for a later day keeps
          // them signed in until then; it ends their access the day after their last day, FIG-832)
          const left = String(empData?.['Termination Date'] ?? '').slice(0, 10);
          const now = new Date();
          const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
          if (empData && (['inactive', 'terminated'].includes(String(empData.Status ?? '').toLowerCase()) || (left && left < todayStr))) {
            await supabase.auth.signOut();
            toast.error('Your employment account has been deactivated. Please contact HR for assistance.');
            setLoading(false);
            return;
          }
        }

        onLoginSuccess(userData);
      }
    } catch (error: any) {
      toast.error(error.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetLoading(true);
    try {
      // the link opens the page that sets the new password, whatever Site URL Supabase has
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, { redirectTo: `${window.location.origin}/update-password` });
      if (error) throw error;
      toast.success('Reset link sent to your email');
      setShowForgotPassword(false);
    } catch (error: any) {
      toast.error(error.message || 'Failed to send reset link');
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <>
    <AuthLayout>
          <AnimatePresence mode='wait'>
            <motion.div
              key="login"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="space-y-8"
            >
              <div className="space-y-2">
                <h2 className={authHeading}>
                  Welcome Back
                </h2>
                <p className={authSubtitle}>
                  Enter your credentials to access your dashboard.
                </p>
              </div>

              <form className="space-y-6" onSubmit={handleLogin}>
                <div className="space-y-1.5">
                  <label className={authLabel}>Email address</label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <EnvelopeSimple size={20} className="text-gray-400 group-focus-within:text-brand transition-colors" />
                    </div>
                    <input
                      type="email"
                      required
                      className={`${authInputOpen} pl-11`}
                      placeholder="name@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>

                {(
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className={authLabel}>Password</label>
                      <button
                        type="button"
                        onClick={() => setShowForgotPassword(true)}
                        className={authQuietLink}
                      >
                        Forgot?
                      </button>
                    </div>
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <LockKey size={20} className="text-gray-400 group-focus-within:text-brand transition-colors" />
                      </div>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        className={`${authInputOpen} pl-11 pr-11`}
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <ShowPasswordButton shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />
                    </div>
                  </div>
                )}

                <div className="pt-2">
                  <motion.button
                    type="submit"
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    disabled={loading}
                    className={`${authButtonPrimary} ${loading
                      ? 'cursor-not-allowed'
                      : ''
                      }`}
                  >
                    {loading ? (
                      <>
                        <CircleNotch size={20} className="animate-spin" />
                        <span>Processing...</span>
                      </>
                    ) : (
                      <>
                        <span>Sign In</span>
                        <ArrowRight size={18} weight="bold" />
                      </>
                    )}
                  </motion.button>
                </div>
              </form>

              <div className="text-center pt-8 border-t border-gray-100">
                <div>
                  <Link to="/create-company" className={authQuietLink}>
                    Starting a new company?
                    <span className={`ml-1 ${authLink}`}>Create one</span>
                  </Link>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
    </AuthLayout>

      {showForgotPassword && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white p-8 rounded-card shadow-2xl max-w-md w-full relative overflow-y-auto max-h-[90vh]"
          >
            <div className="flex justify-between items-start mb-6">
              <div className="space-y-1">
                <h3 className="m-0 text-xl font-semibold tracking-[-0.02em] text-ink">Reset Password</h3>
                <p className="m-0 text-[13px] text-gray-600">We'll send a recovery link to your email.</p>
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
                <label className={authLabel}>Work email</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <EnvelopeSimple size={20} className="text-gray-400" />
                  </div>
                  <input
                    type="email"
                    required
                    className={`${authInputOpen} pl-11`}
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
                  className="flex-1 rounded-card border border-gray-300 bg-white px-4 py-3 text-[14px] font-semibold text-ink transition-colors hover:border-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetLoading}
                  className="flex-1 rounded-card bg-brand px-4 py-3 text-[14px] font-semibold text-white shadow-[0_12px_26px_-12px_rgba(23,64,42,0.7)] transition-all hover:bg-brand-dark disabled:opacity-50"
                >
                  {resetLoading ? 'Sending...' : 'Send Link'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </>
  );
}