import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { companyApi } from '../lib/companyApi';
import AuthShell, { AuthButton, Field, authLinkClass } from '../components/Company/AuthShell';
import { useSessionEmail } from '../components/Company/useSessionEmail';
import { clearPendingCompany, readPendingCompany, writePendingCompany } from '../lib/pendingCompany';

/** Create a company: new people sign up and create it in one step; people already signed in just name it. */
export default function CreateCompany() {
  const sessionEmail = useSessionEmail();
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  const create = async (name: string) => {
    await companyApi.createCompany(name);
    clearPendingCompany();
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
      if (password.length < 8) throw new Error('Password must be at least 8 characters.');
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
          </>
        )}
        <AuthButton type="submit" disabled={busy || sessionEmail === undefined || !companyName.trim() || (sessionEmail === null && (!email || !password))}>
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
