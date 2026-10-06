import { FormEvent, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { companyApi, PendingInvitation } from '../lib/companyApi';
import AuthShell, { AuthButton, Field } from '../components/Company/AuthShell';
import { tokenFromInput } from '../lib/inviteToken';
import { clearPendingCompany, readPendingCompany } from '../lib/pendingCompany';

/** Shown to a signed-in person who belongs to no company yet. */
export default function NoCompany({ email }: { email: string }) {
  // a company name typed before they confirmed their email: create it now instead of asking again
  const pending = useRef(readPendingCompany());
  const started = useRef(false);
  const [name, setName] = useState(pending.current ?? '');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [settingUp, setSettingUp] = useState(!!pending.current);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [joining, setJoining] = useState<string | null>(null);

  // invitations sent to this address that have not been used: join in one click, no link to paste
  useEffect(() => {
    let cancelled = false;
    companyApi
      .myPendingInvitations()
      .then((list) => !cancelled && setInvitations(list))
      .catch(() => {
        /* the form below still works */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const joinInvited = async (inv: PendingInvitation) => {
    setJoining(inv.id);
    try {
      await companyApi.acceptMyInvitation(inv.id);
      window.location.assign('/dashboard');
    } catch (err) {
      toast.error((err as Error).message);
      setJoining(null);
    }
  };

  useEffect(() => {
    const wanted = pending.current;
    if (!wanted || started.current) return;
    started.current = true;
    clearPendingCompany(); // before the call, so a reload cannot create it twice
    companyApi
      .createCompany(wanted)
      .then(() => window.location.assign('/dashboard'))
      .catch((err: Error) => {
        toast.error(err.message);
        setName(wanted);
        setSettingUp(false);
      });
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await companyApi.createCompany(name);
      window.location.assign('/dashboard');
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };

  const openInvite = (e: FormEvent) => {
    e.preventDefault();
    const token = tokenFromInput(link);
    if (token) window.location.assign(`/join?token=${encodeURIComponent(token)}`);
  };

  if (settingUp) {
    return (
      <AuthShell title="Setting up your company…" subtitle={`Creating ${name}. One moment.`}>
        <p className="text-xs text-gray-500">You will land on your dashboard automatically.</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={invitations.length > 0 ? 'You have been invited' : 'You are not in a company yet'}
      subtitle={
        invitations.length > 0
          ? `Signed in as ${email}. Join the company that invited you, or start your own below.`
          : `Signed in as ${email}. Create a company, or open the invitation link you were sent.`
      }
    >
      {invitations.length > 0 && (
        <div className="space-y-3 mb-8">
          {invitations.map((inv) => (
            <AuthButton key={inv.id} onClick={() => joinInvited(inv)} disabled={joining !== null}>
              {joining === inv.id ? 'Joining…' : `Join ${inv.company_name} as ${inv.role.charAt(0)}${inv.role.slice(1).toLowerCase()}`}
            </AuthButton>
          ))}
          <div className="border-t border-gray-100 pt-6" />
        </div>
      )}
      <form onSubmit={create} className="space-y-4">
        <Field label="Create a company" value={name} onChange={setName} placeholder="Company name" />
        <AuthButton type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create company'}
        </AuthButton>
      </form>
      <div className="my-8 border-t border-gray-100" />
      <form onSubmit={openInvite} className="space-y-4">
        <Field label="Have an invitation link?" value={link} onChange={setLink} placeholder="Paste the link here" />
        <AuthButton type="submit" variant="secondary" disabled={!link.trim()}>
          Open invitation
        </AuthButton>
      </form>
      <button type="button" onClick={() => supabase.auth.signOut()} className="mt-8 text-gray-500 text-xs font-medium hover:text-gray-900 transition-colors">
        Sign out
      </button>
    </AuthShell>
  );
}
