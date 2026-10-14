import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { MfaError, sendMfaCode, verifyMfaCode, type TwoStepMethod } from '../lib/mfaApi';

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
    <div className="min-h-screen flex items-center justify-center py-8 px-4 sm:px-6" style={{ background: 'linear-gradient(135deg, #022c22 0%, #065f46 50%, #4ade80 100%)' }}>
      <div className="w-full max-w-md">
        <div className="bg-white p-5 sm:p-8 rounded-2xl shadow-lg border border-gray-100">
          <div className="flex justify-center mb-5">
            <div className="p-4 rounded-full" style={{ background: 'linear-gradient(135deg, #022c22 0%, #4ade80 100%)' }}>
              <img src="/bloom-mark.png" alt="Company Logo" className="h-10 w-10 sm:h-12 sm:w-12 object-contain" />
            </div>
          </div>

          <h1 className="text-center text-2xl sm:text-3xl font-bold text-gray-900">Check your {method === 'sms' ? 'phone' : 'email'}</h1>
          <p className="mt-2 text-center text-sm text-gray-600" role="status" aria-live="polite">
            {destination
              ? <>We {where} a 6-digit code to <span className="font-semibold text-gray-900 break-all">{destination}</span>. It expires in 10 minutes.</>
              : sending ? 'Sending your code...' : 'Enter the 6-digit code we sent you.'}
          </p>

          <form
            className="mt-6 space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void verify(codes.join(''));
            }}
          >
            <fieldset className="flex justify-center gap-1.5 sm:gap-3">
              <legend className="sr-only">Sign-in code</legend>
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
                  className="w-10 h-12 sm:w-12 sm:h-14 text-center text-xl sm:text-2xl font-semibold bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 shadow-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
                />
              ))}
            </fieldset>

            {error && (
              <p className="m-0 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-center text-sm" role="alert">{error}</p>
            )}
            {notice && !error && <p className="m-0 text-center text-sm text-green-700">{notice}</p>}

            <button
              type="submit"
              disabled={busy || needsNewCode || codes.some((c) => c === '')}
              className="w-full flex justify-center py-3 px-4 rounded-lg shadow-sm text-sm font-medium text-white bg-gradient-to-r from-green-600 to-cyan-600 hover:from-green-700 hover:to-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {verifying ? 'Checking...' : 'Verify'}
            </button>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-between items-center gap-3 pt-2">
              <button type="button" onClick={() => void backToLogin()} className="text-sm text-green-700 hover:text-green-600 font-medium">
                Back to sign in
              </button>
              <button
                type="button"
                onClick={() => void send(true)}
                disabled={sending || cooldown > 0}
                className="text-sm text-green-700 hover:text-green-600 font-medium disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                {sending ? 'Sending...' : cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
              </button>
            </div>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-white/80">
          {method === 'sms' ? 'No text? Check the number with your administrator.' : 'No email? Check your spam folder, or send a new code.'}
        </p>
      </div>
    </div>
  );
}
