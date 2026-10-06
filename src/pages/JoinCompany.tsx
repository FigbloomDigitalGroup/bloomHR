import { FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { companyApi, InvitePreview } from '../lib/companyApi';
import AuthShell, { AuthButton, Field, authLinkClass } from '../components/Company/AuthShell';
import { useSessionEmail } from '../components/Company/useSessionEmail';

const roleLabel = (role: string) => role.charAt(0) + role.slice(1).toLowerCase();

/** The page an invitation link opens: join an existing company, signing in or creating the account first. */
export default function JoinCompany() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const sessionEmail = useSessionEmail();

  const [preview, setPreview] = useState<InvitePreview | null | undefined>(undefined);
  const [mode, setMode] = useState<'create' | 'signin'>('create');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

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

  const join = async () => {
    setBusy(true);
    try {
      await companyApi.acceptInvitation(token);
      window.location.assign('/dashboard'); // a full load so every screen starts from the new company
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };

  const authenticate = async (e: FormEvent) => {
    e.preventDefault();
    if (!preview || busy) return;
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: preview.email, password });
        if (error) throw new Error(error.message);
        return; // the session appears and the join button takes over
      }
      if (password.length < 8) throw new Error('Password must be at least 8 characters.');
      const { data, error } = await supabase.auth.signUp({
        email: preview.email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/join?token=${encodeURIComponent(token)}` },
      });
      if (error) throw new Error(error.message);
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        setMode('signin');
        throw new Error('You already have an account with this email. Sign in to join.');
      }
      if (!data.session) setCheckEmail(true);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
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

  if (checkEmail) {
    return (
      <AuthShell title="Check your email" subtitle={`We sent a confirmation link to ${preview.email}. Open it to finish joining ${preview.company_name}.`}>
        <p className="text-xs text-gray-500">You can close this page.</p>
      </AuthShell>
    );
  }

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
    <AuthShell title={heading} subtitle={`${about} ${mode === 'create' ? 'Create your account to join.' : 'Sign in to join.'}`}>
      <form onSubmit={authenticate} className="space-y-6">
        <Field label="Email" type="email" value={preview.email} onChange={() => undefined} readOnly autoComplete="email" />
        <Field
          label={mode === 'create' ? 'Choose a password' : 'Password'}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
        />
        <AuthButton type="submit" disabled={busy || !password}>
          {busy ? 'Please wait…' : mode === 'create' ? 'Create account' : 'Sign in'}
        </AuthButton>
      </form>
      <button type="button" onClick={() => setMode(mode === 'create' ? 'signin' : 'create')} className={`mt-8 pt-8 border-t border-gray-100 w-full text-center ${authLinkClass}`}>
        {mode === 'create' ? 'I already have an account' : 'I need to create an account'}
      </button>
    </AuthShell>
  );
}
