import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import ShowPasswordButton from '../components/UI/ShowPasswordButton';
import { Check, X, ArrowLeft, Loader2, CheckCircle2 } from 'lucide-react';
import AuthShell, { AuthButton } from '../components/Company/AuthShell';

const UpdatePasswordPage = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
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
  // where to go once the password is set: an invitation the person was joining (only a /join link), else sign-in
  const [params] = useSearchParams();
  const next = params.get('next') ?? '';
  const backToInvite = /^\/join\?token=[A-Za-z0-9%._~-]+(&account=existing)?$/.test(next) ? next : null;

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

  if (isSuccess) {
    return (
      <AuthShell
        title="Password updated"
        subtitle={backToInvite
          ? 'Your password has been updated. Sign in on your invitation to join the company.'
          : 'Your password has been updated. You can now sign in with your new password.'}
      >
        <div className="space-y-6">
          <div className="flex items-center gap-3 p-4 rounded-lg bg-gray-50 border border-gray-200">
            <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
            <span className="text-xs font-medium text-gray-700">Use your new password from now on.</span>
          </div>
          <AuthButton onClick={() => navigate(backToInvite ?? '/login')}>
            {backToInvite ? 'Back to your invitation' : 'Sign in'}
          </AuthButton>
        </div>
      </AuthShell>
    );
  }

  if (isValidating) {
    return (
      <AuthShell title="Checking your link" subtitle="One moment while we check your reset link.">
        <div className="flex justify-center py-6">
          <Loader2 className="animate-spin h-8 w-8 text-gray-400" />
        </div>
      </AuthShell>
    );
  }

  if (!isValidSession) {
    return (
      <AuthShell
        title="Link expired"
        subtitle="Your reset link may have expired or was already used. Ask for a new one from the sign-in page."
      >
        <AuthButton onClick={() => navigate('/login')}>
          <ArrowLeft size={16} /> Back to sign in
        </AuthButton>
      </AuthShell>
    );
  }

  const allMet = Object.values(passwordStrength).every(v => v);
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const input = 'block w-full px-4 py-3 pr-11 bg-gray-50 border rounded-lg text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 transition-all hover:border-gray-300';

  return (
    <AuthShell title="Set a new password" subtitle="Choose a strong password for your account.">
      <form onSubmit={handlePasswordUpdate} className="space-y-6">
        <div className="space-y-1.5">
          <label htmlFor="new-password" className="block text-xs font-bold text-gray-500 ml-1">New password</label>
          <div className="relative">
            <input
              id="new-password"
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter new password"
              autoComplete="new-password"
              className={`${input} border-gray-200 focus:border-gray-900 focus:ring-gray-900`}
              value={password}
              autoFocus
              onChange={(e) => { setPassword(e.target.value); validate(e.target.value); }}
              required
            />
            <ShowPasswordButton shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />
          </div>
        </div>

        {password.length > 0 && (
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-1.5">
            <p className="text-xs font-bold text-gray-500 mb-2">Your password needs</p>
            <CheckRow met={passwordStrength.minLength} label="At least 8 characters" />
            <CheckRow met={passwordStrength.hasUppercase} label="One uppercase letter (A–Z)" />
            <CheckRow met={passwordStrength.hasLowercase} label="One lowercase letter (a–z)" />
            <CheckRow met={passwordStrength.hasNumber} label="At least one number" />
            <CheckRow met={passwordStrength.hasSpecial} label="One special character (!@#...)" />
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="confirm-password" className="block text-xs font-bold text-gray-500 ml-1">Confirm password</label>
          <div className="relative">
            <input
              id="confirm-password"
              type={showConfirm ? 'text' : 'password'}
              placeholder="Re-enter your new password"
              autoComplete="new-password"
              className={`${input} ${
                passwordsMatch
                  ? 'border-green-400 focus:border-green-600 focus:ring-green-600'
                  : confirmPassword && !passwordsMatch
                    ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                    : 'border-gray-200 focus:border-gray-900 focus:ring-gray-900'
              }`}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            <ShowPasswordButton shown={showConfirm} onToggle={() => setShowConfirm(!showConfirm)} />
          </div>
          {confirmPassword.length > 0 && (
            <p className={`text-xs ml-1 flex items-center gap-1 font-medium ${passwordsMatch ? 'text-green-600' : 'text-red-600'}`}>
              {passwordsMatch ? <Check size={12} /> : <X size={12} />}
              {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
            </p>
          )}
        </div>

        <AuthButton type="submit" disabled={loading || !allMet || !passwordsMatch}>
          {loading ? 'Updating...' : 'Update password'}
        </AuthButton>
      </form>
    </AuthShell>
  );
};

const CheckRow = ({ met, label }: { met: boolean; label: string }) => (
  <div className={`flex items-center gap-2.5 text-xs font-medium ${met ? 'text-green-600' : 'text-gray-400'}`}>
    {met
      ? <Check size={13} className="text-green-600 flex-shrink-0" />
      : <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 flex-shrink-0" />}
    {label}
  </div>
);

export default UpdatePasswordPage;