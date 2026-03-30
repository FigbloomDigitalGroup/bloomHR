import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Check, X, ArrowLeft, Loader2, CheckCircle2 } from 'lucide-react';

const UpdatePasswordPage = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isValidSession, setIsValidSession] = useState(false);
  const [isValidating, setIsValidating] = useState(true);

  const [passwordStrength, setPasswordStrength] = useState({
    minLength: false,
    hasUppercase: false,
    hasLowercase: false,
    hasNumber: false,
    hasSpecial: false
  });

  const navigate = useNavigate();

  useEffect(() => {
    const validateAccess = async () => {
      try {
        setIsValidating(true);
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          setIsValidSession(true);
        } else {
          const params = new URLSearchParams(window.location.search || window.location.hash.replace('#', '?'));
          const code = params.get('code');
          if (code) {
            const { data, error } = await supabase.auth.exchangeCodeForSession(code);
            if (!error && data.session) setIsValidSession(true);
          }
        }
      } catch (err) {
        console.error('Validation error:', err);
      } finally {
        setIsValidating(false);
      }
    };
    validateAccess();
  }, []);

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) { toast.error('Passwords do not match'); return; }
    if (!Object.values(passwordStrength).every(v => v)) { toast.error('Please fulfill all security requirements'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) { toast.error(error.message); }
      else {
        sessionStorage.removeItem('isPasswordRecovery');
        setIsSuccess(true);
        supabase.auth.signOut().catch(() => { });
      }
    } catch {
      toast.error('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const validate = (pwd: string) => {
    setPasswordStrength({
      minLength: pwd.length >= 8,
      hasUppercase: /[A-Z]/.test(pwd),
      hasLowercase: /[a-z]/.test(pwd),
      hasNumber: /[0-9]/.test(pwd),
      hasSpecial: /[!@#$%^&*(),.?":{}|<>]/.test(pwd)
    });
  };

  const bgStyle = { background: 'linear-gradient(135deg, #022c22 0%, #065f46 50%, #4ade80 100%)' };

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={bgStyle}>
        <div className="bg-white rounded-2xl shadow-2xl p-10 max-w-md w-full text-center border border-white/10">
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle2 className="h-10 w-10 text-green-600" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Password Updated!</h1>
          <p className="text-sm text-gray-500 mb-8">Your password has been successfully updated. You can now sign in with your new credentials.</p>
          <button
            onClick={() => navigate('/login')}
            className="w-full py-3 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 transition-all shadow-lg shadow-green-100"
          >
            Sign In Now
          </button>
        </div>
      </div>
    );
  }

  if (isValidating) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center" style={bgStyle}>
        <Loader2 className="animate-spin h-10 w-10 text-white mb-4" />
        <p className="text-sm font-semibold text-white/70 uppercase tracking-widest">Securing Session...</p>
      </div>
    );
  }

  if (!isValidSession) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={bgStyle}>
        <div className="bg-white rounded-2xl shadow-2xl p-10 max-w-md w-full text-center border border-white/10">
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center">
              <X className="h-10 w-10 text-red-500" />
            </div>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Link Expired</h2>
          <p className="text-sm text-gray-500 mb-8">Your security link may have expired or was already used. Please request a new one from the login page.</p>
          <button
            onClick={() => navigate('/login')}
            className="flex items-center justify-center gap-2 mx-auto text-sm text-green-600 font-semibold hover:text-green-700 transition-colors"
          >
            <ArrowLeft size={16} /> Back to Login
          </button>
        </div>
      </div>
    );
  }

  const allMet = Object.values(passwordStrength).every(v => v);
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={bgStyle}>
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full border border-white/10">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="p-3 rounded-full" style={{ background: 'linear-gradient(135deg, #022c22 0%, #4ade80 100%)' }}>
              <img src="/logo.png" alt="Logo" className="h-10 w-10 object-contain" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Set New Password</h2>
          <p className="text-sm text-gray-500 mt-1">Create a strong, secure password for your account</p>
        </div>

        <form onSubmit={handlePasswordUpdate} className="space-y-4">
          {/* New Password */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">New password</label>
            <input
              type="password"
              placeholder="Enter new password"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none text-sm transition-all bg-gray-50 focus:bg-white"
              value={password}
              autoFocus
              onChange={(e) => { setPassword(e.target.value); validate(e.target.value); }}
              required
            />
          </div>

          {/* Strength checker */}
          {password.length > 0 && (
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 space-y-1.5">
              <p className="text-xs font-semibold text-gray-600 mb-2">Password requirements:</p>
              <CheckRow met={passwordStrength.minLength} label="At least 8 characters" />
              <CheckRow met={passwordStrength.hasUppercase} label="One uppercase letter (A–Z)" />
              <CheckRow met={passwordStrength.hasLowercase} label="One lowercase letter (a–z)" />
              <CheckRow met={passwordStrength.hasNumber} label="At least one number" />
              <CheckRow met={passwordStrength.hasSpecial} label="One special character (!@#...)" />
            </div>
          )}

          {/* Confirm Password */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Confirm password</label>
            <input
              type="password"
              placeholder="Re-enter your new password"
              className={`w-full px-4 py-3 border rounded-xl focus:ring-2 outline-none text-sm transition-all bg-gray-50 focus:bg-white ${
                passwordsMatch
                  ? 'border-green-400 focus:ring-green-500 focus:border-green-500'
                  : confirmPassword && !passwordsMatch
                  ? 'border-red-300 focus:ring-red-400 focus:border-red-400'
                  : 'border-gray-200 focus:ring-green-500 focus:border-green-500'
              }`}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            {confirmPassword.length > 0 && (
              <p className={`text-xs mt-1.5 flex items-center gap-1 font-medium ${passwordsMatch ? 'text-green-600' : 'text-red-500'}`}>
                {passwordsMatch ? <Check size={12} /> : <X size={12} />}
                {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !allMet || !passwordsMatch}
            className="w-full py-3 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-green-100 mt-2"
          >
            {loading ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
};

const CheckRow = ({ met, label }: { met: boolean; label: string }) => (
  <div className={`flex items-center gap-2.5 text-xs font-medium ${met ? 'text-green-600' : 'text-gray-400'}`}>
    {met
      ? <Check size={13} className="text-green-500 flex-shrink-0" />
      : <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 flex-shrink-0" />}
    {label}
  </div>
);

export default UpdatePasswordPage;