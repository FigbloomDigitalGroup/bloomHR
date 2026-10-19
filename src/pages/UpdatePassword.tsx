import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import ShowPasswordButton from '../components/UI/ShowPasswordButton';
import { Check, X, ArrowLeft, Loader2, CheckCircle2 } from 'lucide-react';
import AuthShell, { AuthButton } from '../components/Company/AuthShell';

/** How long to wait for the sign-in client to read a link before deciding it did not work. */
const LINK_WAIT_MS = 5000;

type LinkProblem =
  | { kind: 'expired' }
  | { kind: 'used' }
  | { kind: 'other-browser' }
  | { kind: 'invalid'; detail?: string }
  | { kind: 'missing' };

type LinkState = { status: 'checking' } | { status: 'valid' } | { status: 'invalid'; problem: LinkProblem };

/** The reset link's parts, from the query or the hash (Supabase uses both, depending on the email). */
const readLinkParams = () => {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const get = (key: string) => query.get(key) ?? hash.get(key);
  return {
    error: get('error'),
    errorCode: get('error_code'),
    errorDescription: get('error_description'),
    tokenHash: get('token_hash'),
    code: query.get('code'),
    accessToken: hash.get('access_token'),
    refreshToken: hash.get('refresh_token'),
    email: get('email'),
  };
};

const VERIFIER = /code[ _-]?verifier/i;

/** Supabase's own words for why a link failed, turned into one of the reasons we explain. */
const classify = (code: string | null | undefined, text: string | null | undefined): LinkProblem => {
  const message = (text ?? '').replace(/\+/g, ' ');
  if (code === 'bad_code_verifier' || VERIFIER.test(message)) return { kind: 'other-browser' };
  if (/already (been )?used|consumed/i.test(message)) return { kind: 'used' };
  if (code === 'otp_expired' || code === 'flow_state_expired' || code === 'flow_state_not_found' || /expired/i.test(message)) {
    return { kind: 'expired' };
  }
  return { kind: 'invalid', detail: message || undefined };
};

const SCANNER_TIP = 'Some email apps and security scanners open links before you do, which uses them up.';

const describeProblem = (problem: LinkProblem): { title: string; message: string } => {
  switch (problem.kind) {
    case 'expired':
      return {
        title: 'Link expired',
        message: `This reset link has expired or was already used. Each link works once, for a limited time. ${SCANNER_TIP}`,
      };
    case 'used':
      return { title: 'Link already used', message: `This reset link was already used. Each link works only once. ${SCANNER_TIP}` };
    case 'other-browser':
      return {
        title: 'Opened in another browser',
        message: 'This link has to be opened in the same browser where the reset was asked for. Ask for a new link below and open it in this browser.',
      };
    case 'invalid':
      return {
        title: 'Link not valid',
        message: `We could not use this reset link${problem.detail ? ` (${problem.detail})` : ''}. Ask for a new one below.`,
      };
    default:
      return { title: 'Link expired', message: 'Your reset link may have expired or was already used. Ask for a new one below.' };
  }
};

// A token works once; React may run the check twice in development, so the same token is sent only once.
const inFlight = new Map<string, Promise<unknown>>();
const once = <T,>(key: string, run: () => Promise<T>): Promise<T> => {
  if (!inFlight.has(key)) inFlight.set(key, run());
  return inFlight.get(key) as Promise<T>;
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const UpdatePasswordPage = ({ waitMs = LINK_WAIT_MS }: { waitMs?: number }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [link, setLink] = useState<LinkState>({ status: 'checking' });
  const [resendEmail, setResendEmail] = useState(() => readLinkParams().email ?? '');
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

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
    let done = false;
    const finish = (state: LinkState) => {
      if (done) return;
      done = true;
      setLink(state);
    };
    const valid = () => {
      if (done) return;
      // the link's tokens have done their job: keep them out of the address bar and history (but keep ?next=)
      const url = new URL(window.location.href);
      ['code', 'token_hash', 'type', 'email'].forEach(key => url.searchParams.delete(key));
      window.history.replaceState(window.history.state, '', url.pathname + url.search);
      finish({ status: 'valid' });
    };
    const invalid = (problem: LinkProblem) => finish({ status: 'invalid', problem });

    // dashboard (implicit) links: the client reads the hash on its own and announces the session
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN')) valid();
    });

    const p = readLinkParams();

    const check = async () => {
      // Supabase says why the link failed: show that rather than guessing
      if (p.error || p.errorCode || p.errorDescription) {
        invalid(classify(p.errorCode, p.errorDescription ?? p.error));
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (session) return valid();

      if (p.tokenHash) {
        const tokenHash = p.tokenHash;
        const { data, error } = await once(`otp:${tokenHash}`, () =>
          supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' }));
        if (!error && data.session) return valid();
        return invalid(error ? classify(error.code, error.message) : { kind: 'invalid' });
      }

      if (p.code) {
        const code = p.code;
        const { data, error } = await once(`code:${code}`, () => supabase.auth.exchangeCodeForSession(code));
        if (!error && data.session) return valid();
        return invalid(error ? classify(error.code, error.message) : { kind: 'invalid' });
      }

      // give the client time to read the hash (and its event time to arrive)
      await delay(waitMs);
      if (done) return;
      const { data: { session: later } } = await supabase.auth.getSession();
      if (later) return valid();

      if (p.accessToken && p.refreshToken) {
        const accessToken = p.accessToken;
        const refreshToken = p.refreshToken;
        const { data, error } = await once(`hash:${refreshToken}`, () =>
          supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }));
        if (!error && data.session) return valid();
        return invalid(error ? classify(error.code, error.message) : { kind: 'invalid' });
      }

      invalid({ kind: 'missing' });
    };

    check().catch(err => {
      console.error('Validation error:', err);
      invalid({ kind: 'missing' });
    });

    return () => {
      done = true;
      subscription.unsubscribe();
    };
  }, [waitMs]);

  const sendNewLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = resendEmail.trim();
    if (!email) { toast.error('Enter your email address'); return; }
    setResending(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/update-password` });
      if (error) toast.error(error.message);
      else setResent(true);
    } catch {
      toast.error('We could not send a new link. Try again.');
    } finally {
      setResending(false);
    }
  };

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

  if (link.status === 'checking') {
    return (
      <AuthShell title="Checking your link" subtitle="One moment while we check your reset link.">
        <div className="flex justify-center py-6">
          <Loader2 className="animate-spin h-8 w-8 text-gray-400" />
        </div>
      </AuthShell>
    );
  }

  if (link.status === 'invalid') {
    const { title, message } = describeProblem(link.problem);
    return (
      <AuthShell title={title} subtitle={message}>
        <div className="space-y-6">
          {resent ? (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-gray-50 border border-gray-200">
              <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
              <span className="text-xs font-medium text-gray-700">
                If an account uses {resendEmail.trim()}, a new link is on its way. Open it in this same browser.
              </span>
            </div>
          ) : (
            <form onSubmit={sendNewLink} className="space-y-3">
              <label htmlFor="resend-email" className="block text-xs font-bold text-gray-500 ml-1">Your email</label>
              <input
                id="resend-email"
                type="email"
                placeholder="name@company.com"
                autoComplete="email"
                className="block w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:border-gray-900 focus:ring-gray-900"
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
                required
              />
              <p className="text-xs text-gray-500 ml-1">Tip: open the new link in this same browser.</p>
              <AuthButton type="submit" disabled={resending}>
                {resending ? 'Sending...' : 'Send me a new link'}
              </AuthButton>
            </form>
          )}
          <AuthButton variant="secondary" onClick={() => navigate('/login')}>
            <ArrowLeft size={16} /> Back to sign in
          </AuthButton>
        </div>
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