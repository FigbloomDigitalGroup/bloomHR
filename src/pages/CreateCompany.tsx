import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { companyApi } from '../lib/companyApi';
import AuthShell, { AuthButton, Field, authLinkClass } from '../components/Company/AuthShell';
import { useSessionEmail } from '../components/Company/useSessionEmail';
import { clearPendingCompany, readPendingCompany, writePendingCompany } from '../lib/pendingCompany';
import { markCompanyChosen } from '../lib/companyChoice';
import {
  FIGBLOOM_PASSWORD_RULE,
  FigbloomApiError,
  confirmFigbloomEmail,
  figbloomPasswordProblem,
  figbloomSignInEnabled,
  figbloomSignUp,
  startFigbloomSignIn,
} from '../lib/figbloomSignIn';

// With Figbloom sign-in (ERP/HR_COGNITO_CONTRACT.md) the password goes to the person's new Figbloom account (the API
// makes it and their HR login); the confirmation email works as before.
const FIGBLOOM = figbloomSignInEnabled();

/** Create a company: new people sign up and create it in one step; people already signed in just name it. */
export default function CreateCompany() {
  const sessionEmail = useSessionEmail();
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // typed twice when signing up, so a typo can't lock them out
  const [confirmPassword, setConfirmPassword] = useState('');
  const mismatch = confirmPassword.length > 0 && confirmPassword !== password;
  const [busy, setBusy] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  // the email already has an account: sign in with Figbloom, then name the company here
  const [signInFirst, setSignInFirst] = useState<string | null>(null);

  const create = async (name: string) => {
    await companyApi.createCompany(name);
    clearPendingCompany();
    // the new company is already the current one: open it, not the "which company?" picker
    const { data } = await supabase.auth.getSession();
    // the confirmation link proved the email: Figbloom's "Forgot password" can reach them now (best effort)
    if (FIGBLOOM && data.session?.access_token) await confirmFigbloomEmail(data.session.access_token).catch(() => undefined);
    if (data.session?.user?.id) markCompanyChosen(data.session.user.id);
    // a full load so every screen starts from the new company
    window.location.assign('/dashboard');
  };

  // came back from the confirmation email with a company name waiting
  useEffect(() => {
    const pending = readPendingCompany();
    if (sessionEmail && pending) {
      setBusy(true);
      create(pending).catch((e: Error) => {
        toast.error(e.message);
        setCompanyName(pending);
        setBusy(false);
      });
    }
  }, [sessionEmail]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (sessionEmail) {
        await create(companyName);
        return;
      }
      if (FIGBLOOM) {
        const weak = figbloomPasswordProblem(password);
        if (weak) throw new Error(weak);
        if (password !== confirmPassword) throw new Error('The passwords don’t match.');
        try {
          await figbloomSignUp(email.trim(), password);
        } catch (err) {
          if (err instanceof FigbloomApiError && (err.code === 'account_exists' || err.code === 'figbloom_account_exists')) {
            writePendingCompany(companyName);
            setSignInFirst(err.message);
            return;
          }
          throw err;
        }
        writePendingCompany(companyName);
        setCheckEmail(true);
        return;
      }
      if (password.length < 8) throw new Error('Password must be at least 8 characters.');
      if (password !== confirmPassword) throw new Error('The passwords don’t match.');
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: `${window.location.origin}/create-company` },
      });
      if (error) throw new Error(error.message);
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        throw new Error('That email already has an account. Sign in, then create your company.');
      }
      if (data.session) {
        await create(companyName);
      } else {
        writePendingCompany(companyName);
        setCheckEmail(true);
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (signInFirst) {
    return (
      <AuthShell title="You already have an account" subtitle={signInFirst}>
        <AuthButton onClick={() => void startFigbloomSignIn('customers', '/create-company')}>Sign in with Figbloom</AuthButton>
      </AuthShell>
    );
  }

  if (checkEmail) {
    return (
      <AuthShell title="Check your email" subtitle={`We sent a confirmation link to ${email}. Open it, and your company is created when you come back.`}>
        <Link to="/login" className={authLinkClass}>
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your company"
      subtitle={sessionEmail ? `Signed in as ${sessionEmail}. You will be its administrator.` : 'Set up a company and invite your team. You will be its administrator.'}
    >
      <form onSubmit={submit} className="space-y-6">
        <Field label="Company name" value={companyName} onChange={setCompanyName} placeholder="Acme Ltd" autoComplete="organization" />
        {sessionEmail === null && (
          <>
            <Field label="Your email" type="email" value={email} onChange={setEmail} autoComplete="email" />
            <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
            <Field label="Confirm password" type="password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password"
              error={mismatch ? 'The passwords don’t match' : null} />
            {FIGBLOOM && (
              <p className="text-xs text-gray-500">This is your Figbloom password, for every Figbloom product: {FIGBLOOM_PASSWORD_RULE}.</p>
            )}
          </>
        )}
        <AuthButton type="submit" disabled={busy || sessionEmail === undefined || !companyName.trim() || (sessionEmail === null && (!email || !password || password !== confirmPassword))}>
          {busy ? 'Creating…' : 'Create company'}
        </AuthButton>
      </form>
      {sessionEmail === null && (
        <p className="mt-8 pt-8 border-t border-gray-100 text-center text-gray-500 text-xs font-medium">
          Already have an account?{' '}
          <Link to="/login" className={authLinkClass}>
            Sign in
          </Link>
        </p>
      )}
    </AuthShell>
  );
}
