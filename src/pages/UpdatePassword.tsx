import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Check, X, ArrowLeft, Loader2, ShieldCheck, CheckCircle2 } from 'lucide-react';

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

  // 1. Initial Identity Check
  useEffect(() => {
    const validateAccess = async () => {
      try {
        setIsValidating(true);
        const { data: { session } } = await supabase.auth.getSession();

        // If we have a session, we're good to go
        if (session) {
          setIsValidSession(true);
        } else {
          // Check if we have a recovery code in URL to exchange
          const params = new URLSearchParams(window.location.search || window.location.hash.replace('#', '?'));
          const code = params.get('code');

          if (code) {
            const { data, error } = await supabase.auth.exchangeCodeForSession(code);
            if (!error && data.session) {
              setIsValidSession(true);
            }
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

    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (!Object.values(passwordStrength).every(v => v)) {
      toast.error('Please fulfill all security requirements');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        toast.error(error.message);
      } else {
        // SUCCESS!
        sessionStorage.removeItem('isPasswordRecovery');
        setIsSuccess(true);
        // Do signout in background without blocking UI
        supabase.auth.signOut().catch(() => { });
      }
    } catch (err) {
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

  // --- UI STATES ---

  // SUCCESS STATE
  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white p-6">
        <div className="max-w-md w-full text-center space-y-8">
          <div className="flex justify-center">
            <div className="bg-green-100 p-6 rounded-full">
              <CheckCircle2 className="h-16 w-16 text-green-600" />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-black text-gray-900">All Set!</h1>
            <p className="text-gray-500 font-medium">Your password has been successfully updated. You can now use your new password to sign in.</p>
          </div>
          <button
            onClick={() => navigate('/login')}
            className="w-full py-4 bg-black text-white rounded-2xl font-bold hover:bg-gray-800 transition-all shadow-xl"
          >
            Sign In Now
          </button>
        </div>
      </div>
    );
  }

  // LOADING STATE
  if (isValidating) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white">
        <Loader2 className="animate-spin h-10 w-10 text-green-500 mb-4" />
        <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">Securing Session...</p>
      </div>
    );
  }

  // ERROR STATE
  if (!isValidSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white p-6">
        <div className="max-w-md w-full text-center space-y-6">
          <X className="h-16 w-16 text-red-500 mx-auto" />
          <h2 className="text-2xl font-bold">Session Missing</h2>
          <p className="text-gray-500">Your security link may have expired or was already used. Please request a new one from the login page.</p>
          <button onClick={() => navigate('/login')} className="text-green-600 font-bold flex items-center justify-center gap-2 mx-auto">
            <ArrowLeft size={16} /> Back to Login
          </button>
        </div>
      </div>
    );
  }

  // FORM STATE
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="max-w-md w-full bg-white p-10 rounded-[2.5rem] shadow-2xl border border-gray-100">
        <div className="text-center mb-10">
          <ShieldCheck className="h-12 w-12 text-green-600 mx-auto mb-4" />
          <h2 className="text-3xl font-black text-gray-900">New Password</h2>
          <p className="text-sm text-gray-400 mt-2">Enter a secure password for your account</p>
        </div>

        <form onSubmit={handlePasswordUpdate} className="space-y-6">
          <div className="space-y-4">
            <input
              type="password"
              placeholder="Enter new password"
              className="w-full px-6 py-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-green-500 transition-all outline-none font-medium"
              value={password}
              autoFocus
              onChange={(e) => { setPassword(e.target.value); validate(e.target.value); }}
              required
            />

            <div className="p-5 bg-gray-50 rounded-2xl space-y-2">
              <CheckRow met={passwordStrength.minLength} label="At least 8 characters" />
              <CheckRow met={passwordStrength.hasUppercase} label="Uppercase letter" />
              <CheckRow met={passwordStrength.hasLowercase} label="Lowercase letter" />
              <CheckRow met={passwordStrength.hasNumber} label="At least one number" />
              <CheckRow met={passwordStrength.hasSpecial} label="Special character" />
            </div>

            <input
              type="password"
              placeholder="Confirm new password"
              className="w-full px-6 py-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-green-500 transition-all outline-none font-medium"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          <button
            disabled={loading}
            className="w-full py-5 bg-green-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-green-700 transition-all shadow-xl shadow-green-100"
          >
            {loading ? 'Processing...' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
};

const CheckRow = ({ met, label }: { met: boolean, label: string }) => (
  <div className={`flex items-center gap-3 text-[11px] font-bold ${met ? 'text-green-600' : 'text-gray-300'}`}>
    {met ? <Check size={14} /> : <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-200" />}
    {label}
  </div>
);

export default UpdatePasswordPage;