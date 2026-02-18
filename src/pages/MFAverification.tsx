import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { useNavigate, useSearchParams } from 'react-router-dom';

interface MFAData {
  userId: string;
  email: string;
  userRole: string;
  branch: string;
  session: any;
}

// Utility for phone number formatting
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
  return cleaned.length === 12 && cleaned.startsWith('254') ? cleaned : phone;
};

export default function MFAVerification() {
  const [codes, setCodes] = useState<string[]>(Array(6).fill(''));
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [userId, setUserId] = useState('');
  const [resendLoading, setResendLoading] = useState(false);
  const [attemptCount, setAttemptCount] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [lockTime, setLockTime] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [isVerified, setIsVerified] = useState(false);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const hasShownSessionError = useRef(false); // Prevent infinite error loop
  const hasTriggeredInitialSend = useRef(false); // NEW: Prevent race conditions in auto-send
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // CRITICAL FIX: Prevent back button bypass
  useEffect(() => {
    // Set MFA verification flag
    sessionStorage.setItem('mfaInProgress', 'true');

    const handleBackButton = (event: PopStateEvent) => {
      if (!isVerified) {
        event.preventDefault();
        event.stopPropagation();
        toast.error('Please complete MFA verification first');
        window.history.pushState(null, '', window.location.href);
      }
    };

    window.addEventListener('popstate', handleBackButton);
    window.history.pushState(null, '', window.location.href);

    return () => {
      window.removeEventListener('popstate', handleBackButton);
      if (!isVerified) {
        sessionStorage.removeItem('mfaInProgress');
      }
    };
  }, [isVerified]);

  useEffect(() => {
    // Check if user is already locked out
    const lockUntil = localStorage.getItem('mfaLockUntil');
    if (lockUntil && parseInt(lockUntil) > Date.now()) {
      setIsLocked(true);
      setLockTime(parseInt(lockUntil));
      return;
    }

    // Retrieve MFA data from sessionStorage
    const mfaData = sessionStorage.getItem('mfaData');
    if (mfaData) {
      try {
        const parsedData: MFAData = JSON.parse(mfaData);
        setEmail(parsedData.email);
        setUserId(parsedData.userId);

        if (parsedData.session) {
          supabase.auth.setSession(parsedData.session);
        }
      } catch (error) {
        console.error('Error parsing MFA data:', error);
        toast.error('Invalid session data');
        navigate('/login');
      }
    } else {
      const redirectEmail = searchParams.get('email');
      const redirectUserId = searchParams.get('userId');

      if (redirectEmail && redirectUserId) {
        setEmail(redirectEmail);
        setUserId(redirectUserId);
      } else {
        const initFromSession = async () => {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            setEmail(session.user.email || '');
            setUserId(session.user.id);
            return true;
          }
          return false;
        };

        initFromSession().then((foundSession) => {
          if (!foundSession && !hasShownSessionError.current) {
            hasShownSessionError.current = true;
            toast.dismiss();
            supabase.auth.signOut().finally(() => {
              sessionStorage.removeItem('isMFAProcess');
              navigate('/login', { replace: true });
            });
          }
        });
      }
    }

    // REMOVED: Premature countdown set here. It should only start after a successful send.
  }, []);

  // Initial code send effect
  useEffect(() => {
    if (userId && email && !isVerified && !loading && !resendLoading && !hasTriggeredInitialSend.current) {
      const sentFlag = `mfa_sent_${userId}`;
      const hasSentInitial = sessionStorage.getItem(sentFlag);

      if (!hasSentInitial) {
        hasTriggeredInitialSend.current = true;

        // Reduced delay for better UX, but keep enough for session stability
        const timeoutId = setTimeout(() => {
          console.log('🚀 Triggering initial MFA code send for:', email);
          handleResendCode(true)
            .then(() => {
              sessionStorage.setItem(sentFlag, 'true');
            })
            .catch((err) => {
              console.error('Failed initial send:', err);
              hasTriggeredInitialSend.current = false;
            });
        }, 800);

        return () => clearTimeout(timeoutId);
      }
    }
  }, [userId, email]);

  // Handle lockout timer
  useEffect(() => {
    if (!isLocked) return;

    const interval = setInterval(() => {
      const remainingTime = lockTime - Date.now();
      if (remainingTime <= 0) {
        setIsLocked(false);
        localStorage.removeItem('mfaLockUntil');
        localStorage.removeItem('mfaAttemptCount');
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isLocked, lockTime]);

  const handleCodeChange = (index: number, value: string) => {
    if (isLocked) return;

    if (!/^\d*$/.test(value)) return;

    const newCodes = [...codes];
    newCodes[index] = value;
    setCodes(newCodes);

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    if (newCodes.every(code => code !== '') && index === 5) {
      handleVerification(newCodes.join(''));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !codes[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text');
    const digits = pastedData.replace(/\D/g, '').split('').slice(0, 6);

    if (digits.length === 6) {
      const newCodes = [...codes];
      digits.forEach((digit, index) => {
        newCodes[index] = digit;
      });
      setCodes(newCodes);
      inputRefs.current[5]?.focus();
    }
  };

  const handleVerification = async (fullCode: string) => {
    if (isLocked) {
      toast.error(`Please wait ${Math.ceil((lockTime - Date.now()) / 1000)} seconds before trying again`);
      return;
    }

    if (!fullCode || fullCode.length !== 6) {
      toast.error('Please enter a valid 6-digit code');
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase
        .from('mfa_codes')
        .select('*')
        .eq('email', email)
        .eq('code', fullCode)
        .eq('used', false)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        await supabase
          .from('mfa_codes')
          .update({ used: true })
          .eq('id', data.id);

        setIsVerified(true);
        sessionStorage.setItem('mfaVerified', 'true');
        sessionStorage.setItem('mfaCompleted', 'true');
        sessionStorage.setItem('mfaVerifiedUserId', userId);
        sessionStorage.setItem('mfaVerifiedTime', Date.now().toString());

        localStorage.removeItem('mfaAttemptCount');
        localStorage.removeItem('mfaLockUntil');
        sessionStorage.removeItem('mfaData');
        sessionStorage.removeItem('isMFAProcess');
        localStorage.removeItem(`mfa_${userId}`);

        toast.success('Verification successful!');

        setTimeout(() => {
          navigate('/dashboard', { replace: true });
        }, 1000);
      } else {
        const newAttemptCount = attemptCount + 1;
        setAttemptCount(newAttemptCount);
        localStorage.setItem('mfaAttemptCount', newAttemptCount.toString());

        if (newAttemptCount >= 5) {
          const lockUntil = Date.now() + 5 * 60 * 1000;
          setIsLocked(true);
          setLockTime(lockUntil);
          localStorage.setItem('mfaLockUntil', lockUntil.toString());
          toast.error('Too many failed attempts. Please try again in 5 minutes.');
        } else {
          throw new Error(`Invalid verification code or code expired. ${5 - newAttemptCount} attempts remaining`);
        }
      }
    } catch (error: any) {
      toast.error(error.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async (isInitial = false) => {
    if (!isInitial && (isLocked || countdown > 0)) {
      toast.error(`Please wait ${countdown} seconds before requesting a new code`);
      return;
    }

    setResendLoading(true);
    try {
      // 1. Get phone number
      const { data: numData, error: numError } = await supabase
        .from('mfa_numbers')
        .select('phone_number')
        .eq('email', email)
        .single();

      if (numError || !numData?.phone_number) {
        throw new Error('MFA phone number not found. Please contact administrator.');
      }

      const phoneNumber = numData.phone_number;
      const formattedPhone = formatPhoneNumberForSMS(phoneNumber);

      // 2. Generate and store code
      const mfaCode = Math.floor(100000 + Math.random() * 900000).toString();

      // Invalidate ALL previous unused codes for this email first
      // This prevents the race condition where multiple codes exist and
      // the SMS delivers an older code that no longer matches the DB
      await supabase
        .from('mfa_codes')
        .update({ used: true })
        .eq('email', email)
        .eq('used', false);

      // Now insert a fresh code as the single valid one
      const { error: storeError } = await supabase
        .from('mfa_codes')
        .insert({
          user_id: userId,
          email: email,
          code: mfaCode,
          phone_number: formattedPhone,
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          used: false
        });

      if (storeError) throw storeError;

      // 3. Send SMS via backend (avoids no-cors blind sends, gets real delivery status)
      const message = `Your Mular Credit verification code is: ${mfaCode}. This code expires in 10 minutes.`;

      console.log(`📡 Sending MFA SMS to ${formattedPhone}...`);
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
      const smsResponse = await fetch(`${apiUrl}/sms/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: formattedPhone, message }),
      });

      if (!smsResponse.ok) {
        const errData = await smsResponse.json().catch(() => ({}));
        console.error('❌ SMS send failed:', errData);
        throw new Error(errData.error || 'Failed to send verification SMS. Please try again.');
      }

      console.log(`✅ MFA SMS sent successfully to ${formattedPhone}`);

      setCountdown(30);
      const countdownInterval = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(countdownInterval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      toast.success('Verification code sent successfully!');
    } catch (error: any) {
      console.error('MFA Resend error:', error);
      toast.error(error.message || 'Failed to resend code');
    } finally {
      setResendLoading(false);
    }
  };

  const handleBackToLogin = () => {
    // Clear all MFA data
    sessionStorage.removeItem('mfaData');
    sessionStorage.removeItem('mfaInProgress');
    sessionStorage.removeItem('mfaVerified');
    sessionStorage.removeItem('mfaVerifiedUserId');
    sessionStorage.removeItem('mfaVerifiedTime');
    localStorage.removeItem(`mfa_${userId}`);
    localStorage.removeItem('mfaAttemptCount');
    localStorage.removeItem('mfaLockUntil');

    supabase.auth.signOut();

    // Use replace to prevent back navigation
    navigate('/login', { replace: true });
  };

  const formatTimeRemaining = () => {
    const seconds = Math.ceil((lockTime - Date.now()) / 1000);
    return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-cyan-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="bg-white p-8 rounded-2xl shadow-lg border border-gray-100">
          <div className="flex justify-center mb-6">
            <div className="bg-green-900 p-4 rounded-full">
              <img
                src="/logo.png"
                alt="Company Logo"
                className="h-12 w-12 object-contain"
              />
            </div>
          </div>

          <h2 className="mt-4 text-center text-3xl font-bold text-gray-900">
            Verify Your Identity
          </h2>
          <p className="mt-2 text-center text-xs text-gray-600">
            Enter the 6-digit verification code sent to your phone
          </p>
          <p className="text-center text-xs font-medium text-green-600">
            {email}
          </p>

          {isLocked && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-center">
              <p className="text-xs font-medium">Account temporarily locked</p>
              <p className="text-xs">Please try again in {formatTimeRemaining()}</p>
            </div>
          )}

          <form className="mt-8 space-y-6" onSubmit={(e) => {
            e.preventDefault();
            handleVerification(codes.join(''));
          }}>
            <div className="flex justify-center space-x-3">
              {codes.map((code, index) => (
                <input
                  key={index}
                  ref={(el) => (inputRefs.current[index] = el)}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={1}
                  value={code}
                  onChange={(e) => handleCodeChange(index, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  onPaste={index === 0 ? handlePaste : undefined}
                  disabled={loading || isLocked}
                  className="w-12 h-12 text-center text-2xl font-semibold bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 shadow-sm transition-all duration-200 disabled:bg-gray-100 disabled:cursor-not-allowed"
                  autoFocus={index === 0}
                />
              ))}
            </div>

            <div>
              <button
                type="submit"
                disabled={loading || isLocked || codes.some(code => code === '')}
                className="group relative w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-xs font-medium text-white bg-gradient-to-r from-green-600 to-cyan-600 hover:from-green-700 hover:to-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                {loading ? (
                  <span className="flex items-center">
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Verifying...
                  </span>
                ) : (
                  'Verify Code'
                )}
              </button>
            </div>

            <div className="flex justify-between items-center pt-4">
              <button
                type="button"
                onClick={handleBackToLogin}
                className="text-xs text-green-600 hover:text-green-500 font-medium flex items-center transition-colors duration-200"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back to Login
              </button>

              <button
                type="button"
                onClick={() => handleResendCode()}
                disabled={resendLoading || isLocked || countdown > 0}
                className="text-xs text-green-600 hover:text-green-500 font-medium disabled:text-gray-400 disabled:cursor-not-allowed transition-colors duration-200"
              >
                {resendLoading ? 'Sending...' : countdown > 0 ? `Resend in ${countdown}s` : 'Resend Code'}
              </button>
            </div>
          </form>
        </div>

        <div className="text-center text-xs text-gray-500">
          <p>Having trouble receiving the code?</p>
          <p className="mt-1">Check your phone connection or contact support</p>
        </div>
      </div>
    </div>
  );
}