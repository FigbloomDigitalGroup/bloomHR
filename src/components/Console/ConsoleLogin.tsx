import { FormEvent, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import ShowPasswordButton from '../UI/ShowPasswordButton';
import { authButtonPrimary, authInputOpen, authLabel, authQuietLink } from '../Auth/authStyles';

// The console's own sign-in (src/lib/console.ts): Figbloom staff only, so none of the company app's sign-in page (its
// brand photo, "create your company", the employee and account checks). Who gets in is decided after signing in, by
// is_platform_admin() in ConsoleApp; this page only proves who the person is.

export default function ConsoleLogin() {
  const [mode, setMode] = useState<'signIn' | 'reset'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    // a success moves on by itself: ConsoleApp listens for the new session
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) toast.error(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
  };

  const sendReset = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    // the link comes back to the console, which shows the new-password page
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/update-password`,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else setResetSent(true);
  };

  const backToSignIn = () => {
    setMode('signIn');
    setResetSent(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center space-y-1">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Figbloom</p>
          <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em] text-ink">Console</h1>
        </div>

        <div className="bg-white border border-border rounded-card shadow-sm p-6">
          {mode === 'signIn' ? (
            <form onSubmit={signIn} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="console-email" className={authLabel}>Email</label>
                <input id="console-email" type="email" autoComplete="username" required value={email}
                  onChange={(e) => setEmail(e.target.value)} className={authInputOpen} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="console-password" className={authLabel}>Password</label>
                  <button type="button" className={authQuietLink} onClick={() => setMode('reset')}>Forgot password?</button>
                </div>
                <div className="relative">
                  <input id="console-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password"
                    required value={password} onChange={(e) => setPassword(e.target.value)} className={`${authInputOpen} pr-10`} />
                  <ShowPasswordButton shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />
                </div>
              </div>
              <button type="submit" disabled={busy} className={authButtonPrimary}>{busy ? 'Signing in…' : 'Sign in'}</button>
            </form>
          ) : resetSent ? (
            <div className="space-y-4">
              <p className="m-0 text-sm text-ink">If <span className="font-semibold">{email.trim()}</span> has an account, a link to set a new password is on its way.</p>
              <button type="button" className={authQuietLink} onClick={backToSignIn}>Back to sign in</button>
            </div>
          ) : (
            <form onSubmit={sendReset} className="space-y-4">
              <p className="m-0 text-sm text-gray-600">We'll email you a link to set a new password.</p>
              <div className="space-y-1.5">
                <label htmlFor="console-reset-email" className={authLabel}>Email</label>
                <input id="console-reset-email" type="email" autoComplete="username" required value={email}
                  onChange={(e) => setEmail(e.target.value)} className={authInputOpen} />
              </div>
              <button type="submit" disabled={busy} className={authButtonPrimary}>{busy ? 'Sending…' : 'Send reset link'}</button>
              <button type="button" className={authQuietLink} onClick={backToSignIn}>Back to sign in</button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          For Figbloom staff only. Customers sign in at{' '}
          <a href="https://hr.figbloom.org" className="font-medium text-ink underline underline-offset-2">hr.figbloom.org</a>.
        </p>
      </div>
    </div>
  );
}
