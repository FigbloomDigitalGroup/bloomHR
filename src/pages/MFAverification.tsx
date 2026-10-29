import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ArrowRight, CircleNotch } from '@phosphor-icons/react';
import { MfaError, sendMfaCode, verifyMfaCode, type TwoStepMethod } from '../lib/mfaApi';
import AuthLayout from '../components/Auth/AuthLayout';
import { authButtonPrimary, authHeading, authLabel, authLink, authQuietLink, authSubtitle } from '../components/Auth/authStyles';

// Two-step sign-in (FIG-834, FIG-658). The server makes the code, sends it (by email, or SMS where the company chose
// it) and checks it; a right code is recorded against this sign-in on the server, which is what lets the app in. This
// page only asks for a code and passes on what was typed, so nothing here can mark the sign-in as verified.

const CODE_LENGTH = 6;

const clearMfaFlags = () => {
  sessionStorage.removeItem('mfaData');
  sessionStorage.removeItem('isMFAProcess');
  sessionStorage.removeItem('mfaInProgress');
};

export default function MFAVerification() {
  const navigate = useNavigate();
  const [codes, setCodes] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [destination, setDestination] = useState('');
  const [method, setMethod] = useState<TwoStepMethod>('email');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // the code can no longer be used (expired, too many tries): only a new one helps
  const [needsNewCode, setNeedsNewCode] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const started = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const finish = useCallback(() => {
    clearMfaFlags();
    sessionStorage.setItem('mfaCompleted', 'true');
    navigate('/dashboard', { replace: true });
  }, [navigate]);

  const backToLogin = useCallback(async () => {
    clearMfaFlags();
    sessionStorage.removeItem('mfaCompleted');
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  }, [navigate]);

  const send = useCallback(async (resend: boolean) => {
    setSending(true);
    setError('');
    setNotice('');
    try {
      const result = await sendMfaCode(resend);
      setDestination(result.destination);
      setMethod(result.method);
      setCooldown(result.resendIn);
      setNeedsNewCode(false);
      setCodes(Array(CODE_LENGTH).fill(''));
      if (resend) setNotice('A new code is on its way.');
      inputRefs.current[0]?.focus();
    } catch (e) {
      const err = e as MfaError;
      if (err.reason === 'not_required') return finish(); // this company does not ask this person for a code
      if (err.status === 401) return void backToLogin();
      if (err.reason === 'cooldown' && err.retryAfter) setCooldown(err.retryAfter);
      setError(err.message || 'Could not send a code');
    } finally {
      setSending(false);
    }
  }, [finish, backToLogin]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return void backToLogin();
      void send(false);
    });
  }, [send, backToLogin]);

  const verify = async (code: string) => {
    if (code.length !== CODE_LENGTH || verifying) return;
    setVerifying(true);
    setError('');
    setNotice('');
    try {
      await verifyMfaCode(code);
      finish();
    } catch (e) {
      const err = e as MfaError;
      if (err.status === 401) return void backToLogin();
      setError(err.message || 'Could not check the code');
      if (err.reason === 'expired' || err.reason === 'too_many' || err.reason === 'none') setNeedsNewCode(true);
      setCodes(Array(CODE_LENGTH).fill(''));
      inputRefs.current[0]?.focus();
    } finally {
      setVerifying(false);
    }
  };

  const setDigits = (index: number, value: string) => {
    const digits = value.replace(/\D/g, '');
    if (!digits && value) return;
    const next = [...codes];
    if (digits.length > 1) {
      // pasted or autofilled: spread from here
      digits.slice(0, CODE_LENGTH - index).split('').forEach((d, i) => (next[index + i] = d));
    } else {
      next[index] = digits;
    }
    setCodes(next);
    const filled = Math.min(index + Math.max(digits.length, 1), CODE_LENGTH - 1);
    if (digits) inputRefs.current[filled]?.focus();
    if (next.every((c) => c !== '')) void verify(next.join(''));
  };

  const onKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !codes[index] && index > 0) inputRefs.current[index - 1]?.focus();
  };

  const busy = verifying || sending;
  const where = method === 'sms' ? 'texted' : 'emailed';

  return (
    <AuthLayout>
      <div className="space-y-8">
        <div className="space-y-2">
          <h2 className={authHeading}>Check your {method === 'sms' ? 'phone' : 'email'}</h2>
          <p className={authSubtitle} role="status" aria-live="polite">
            {destination
              ? <>We {where} a 6-digit code to <span className="font-semibold text-ink break-all">{destination}</span>. It expires in 60 minutes.</>
              : sending ? 'Sending your code...' : 'Enter the 6-digit code we sent you.'}
          </p>
        </div>

        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            void verify(codes.join(''));
          }}
        >
          <fieldset className="space-y-1.5">
            <legend className={`${authLabel} mb-1.5`}>Sign-in code</legend>
            <div className="flex justify-between gap-2">
              {codes.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => (inputRefs.current[index] = el)}
                  aria-label={`Digit ${index + 1}`}
                  type="text"
                  inputMode="numeric"
                  autoComplete={index === 0 ? 'one-time-code' : 'off'}
                  pattern="[0-9]*"
                  maxLength={index === 0 ? CODE_LENGTH : 1}
                  value={digit}
                  onChange={(e) => setDigits(index, e.target.value)}
                  onKeyDown={(e) => onKeyDown(index, e)}
                  autoFocus={index === 0}
                  disabled={busy || needsNewCode}
                  className="w-full min-w-0 h-14 text-center text-xl font-semibold text-ink bg-white border border-gray-200 rounded-tile focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 hover:border-gray-300 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                />
              ))}
            </div>
          </fieldset>

          {error && (
            <p className="m-0 p-3 bg-red-50 border border-red-100 text-red-700 rounded-lg text-xs font-medium" role="alert">{error}</p>
          )}
          {notice && !error && <p className="m-0 text-xs font-medium text-gray-700">{notice}</p>}

          <button
            type="submit"
            disabled={busy || needsNewCode || codes.some((c) => c === '')}
            className={authButtonPrimary}
          >
            {verifying ? (
              <>
                <CircleNotch size={20} className="animate-spin" />
                <span>Checking...</span>
              </>
            ) : (
              <>
                <span>Verify</span>
                <ArrowRight size={18} weight="bold" />
              </>
            )}
          </button>
        </form>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-between items-center gap-3 pt-6 border-t border-gray-100">
          <button type="button" onClick={() => void backToLogin()} className={authQuietLink}>
            Back to sign in
          </button>
          <button
            type="button"
            onClick={() => void send(true)}
            disabled={sending || cooldown > 0}
            className={`text-[13px] ${authLink} disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed`}
          >
            {sending ? 'Sending...' : cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
          </button>
        </div>

        <p className="text-center text-xs text-gray-400">
          {method === 'sms' ? 'No text? Check the number with your administrator.' : 'No email? Check your spam folder, or send a new code.'}
        </p>
      </div>
    </AuthLayout>
  );
}
