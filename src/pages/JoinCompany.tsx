import { FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { companyApi, InvitePreview } from '../lib/companyApi';
import AuthShell, { Field } from '../components/Company/AuthShell';
import Button from '../components/UI/Button';
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
        <p className="text-[13px] text-muted-foreground">One moment.</p>
      </AuthShell>
    );
  }

  if (!preview) {
    return (
      <AuthShell title="This invitation is not valid" subtitle="The link may have expired, been used already, or been cancelled. Ask the person who invited you to send a new one.">
        <a href="/login" className="text-[13px] font-semibold text-brand">
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
        <p className="text-[12.5px] text-muted-foreground">You can close this page.</p>
      </AuthShell>
    );
  }

  if (sessionEmail) {
    const matches = sessionEmail.toLowerCase() === preview.email.toLowerCase();
    return (
      <AuthShell title={heading} subtitle={about}>
        {matches ? (
          <Button onClick={join} disabled={busy} className="w-full justify-center">
            {busy ? 'Joining…' : `Join ${preview.company_name}`}
          </Button>
        ) : (
          <div className="space-y-3">
            <p className="text-[13px] text-ink">
              You are signed in as <strong>{sessionEmail}</strong>, but this invitation was sent to <strong>{preview.email}</strong>.
            </p>
            <Button variant="secondary" onClick={() => supabase.auth.signOut()} className="w-full justify-center">
              Sign out and use {preview.email}
            </Button>
          </div>
        )}
      </AuthShell>
    );
  }

  return (
    <AuthShell title={heading} subtitle={`${about} ${mode === 'create' ? 'Create your account to join.' : 'Sign in to join.'}`}>
      <form onSubmit={authenticate} className="space-y-3.5">
        <Field label="Email" type="email" value={preview.email} onChange={() => undefined} readOnly autoComplete="email" />
        <Field
          label={mode === 'create' ? 'Choose a password' : 'Password'}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
        />
        <Button type="submit" disabled={busy || !password} className="w-full justify-center">
          {busy ? 'Please wait…' : mode === 'create' ? 'Create account' : 'Sign in'}
        </Button>
      </form>
      <button type="button" onClick={() => setMode(mode === 'create' ? 'signin' : 'create')} className="mt-4 text-[12.5px] font-semibold text-brand">
        {mode === 'create' ? 'I already have an account' : 'I need to create an account'}
      </button>
    </AuthShell>
  );
}
