import { FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { companyApi, InvitePreview } from '../lib/companyApi';
import { ApiError } from '../lib/adminApi';
import AuthShell, { AuthButton, Field, authLinkClass } from '../components/Company/AuthShell';
import { useSessionEmail } from '../components/Company/useSessionEmail';

const roleLabel = (role: string) => role.charAt(0) + role.slice(1).toLowerCase();

/**
 * The page an invitation link opens. The link came to the invited address, so that is proof it is theirs: a new
 * person just gives their name and a password and is in (no confirmation email). Someone who already has an
 * account, for example from another company, signs in and the company is added to it.
 */
export default function JoinCompany() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const sessionEmail = useSessionEmail();

  const [preview, setPreview] = useState<InvitePreview | null | undefined>(undefined);
  const [mode, setMode] = useState<'create' | 'signin'>('create');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setPreview(null);
      return;
    }
    companyApi
      .invitationPreview(token)
      .then((p) => !cancelled && setPreview(p))
      .catch(() => !cancelled && setPreview(null));
    return () => {
      cancelled = true;
    };
  }, [token]);

  // a full load so every screen starts from the new company
  const enter = () => window.location.assign('/dashboard');

  // already signed in with the invited address: one click
  const join = async () => {
    setBusy(true);
    try {
      await companyApi.acceptInvitation(token);
      enter();
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!preview || busy) return;
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: preview.email, password });
        if (error) throw new Error(error.message);
        setFinishing(true);
        await companyApi.acceptInvitation(token); // adds this company to the account they already have
        enter();
        return;
      }

      if (password.length < 8) throw new Error('Password must be at least 8 characters.');
      try {
        await companyApi.createAccountAndJoin(token, password, fullName.trim());
      } catch (err) {
        if (err instanceof ApiError && err.code === 'account_exists') {
          // this address already has an account (maybe from another company): sign in to add this one
          setMode('signin');
          setPassword('');
          toast('You already have an account with this email. Sign in to join.', { icon: 'ℹ️' });
          setBusy(false);
          return;
        }
        throw err;
      }
      const { error } = await supabase.auth.signInWithPassword({ email: preview.email, password });
      if (error) throw new Error(error.message);
      setFinishing(true);
      enter();
    } catch (err) {
      setFinishing(false);
      toast.error((err as Error).message);
      setBusy(false);
    }
  };

  if (preview === undefined || sessionEmail === undefined) {
    return (
      <AuthShell title="Opening your invitation…">
        <p className="text-xs text-gray-500">One moment.</p>
      </AuthShell>
    );
  }

  if (finishing) {
    return (
      <AuthShell title="Setting up your account…" subtitle="You will land in your workspace automatically.">
        <p className="text-xs text-gray-500">One moment.</p>
      </AuthShell>
    );
  }

  if (!preview) {
    return (
      <AuthShell title="This invitation is not valid" subtitle="The link may have expired, been used already, or been cancelled. Ask the person who invited you to send a new one.">
        <a href="/login" className={authLinkClass}>
          Go to sign in
        </a>
      </AuthShell>
    );
  }

  const heading = `Join ${preview.company_name}`;
  const about = `You have been invited as ${roleLabel(preview.role)}.`;

  if (sessionEmail) {
    const matches = sessionEmail.toLowerCase() === preview.email.toLowerCase();
    return (
      <AuthShell title={heading} subtitle={about}>
        {matches ? (
          <AuthButton onClick={join} disabled={busy}>
            {busy ? 'Joining…' : `Join ${preview.company_name}`}
          </AuthButton>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-gray-700">
              You are signed in as <strong>{sessionEmail}</strong>, but this invitation was sent to <strong>{preview.email}</strong>.
            </p>
            <AuthButton variant="secondary" onClick={() => supabase.auth.signOut()}>
              Sign out and use {preview.email}
            </AuthButton>
          </div>
        )}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={heading}
      subtitle={`${about} ${mode === 'create' ? 'Tell us your name and choose a password to get started.' : 'You already have an account: sign in to add this company to it.'}`}
    >
      <form onSubmit={submit} className="space-y-6">
        {mode === 'create' && <Field label="Your full name" value={fullName} onChange={setFullName} autoComplete="name" placeholder="Jane Doe" />}
        <Field label="Email" type="email" value={preview.email} onChange={() => undefined} readOnly autoComplete="email" />
        <Field
          label={mode === 'create' ? 'Choose a password' : 'Password'}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
        />
        <AuthButton type="submit" disabled={busy || !password || (mode === 'create' && !fullName.trim())}>
          {busy ? 'Please wait…' : mode === 'create' ? `Create account and join ${preview.company_name}` : `Sign in and join ${preview.company_name}`}
        </AuthButton>
      </form>
      <button
        type="button"
        onClick={() => {
          setMode(mode === 'create' ? 'signin' : 'create');
          setPassword('');
        }}
        className={`mt-8 pt-8 border-t border-gray-100 w-full text-center ${authLinkClass}`}
      >
        {mode === 'create' ? 'I already have an account' : 'I need to create an account'}
      </button>
    </AuthShell>
  );
}
