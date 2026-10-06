import { FormEvent, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { companyApi } from '../lib/companyApi';
import AuthShell, { Field } from '../components/Company/AuthShell';
import Button from '../components/UI/Button';
import { tokenFromInput } from '../lib/inviteToken';

/** Shown to a signed-in person who belongs to no company yet. */
export default function NoCompany({ email }: { email: string }) {
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);

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

  return (
    <AuthShell title="You are not in a company yet" subtitle={`Signed in as ${email}. Create a company, or open the invitation link you were sent.`}>
      <form onSubmit={create} className="space-y-3">
        <Field label="Create a company" value={name} onChange={setName} placeholder="Company name" />
        <Button type="submit" disabled={busy || !name.trim()} className="w-full justify-center">
          {busy ? 'Creating…' : 'Create company'}
        </Button>
      </form>
      <div className="my-5 border-t border-border" />
      <form onSubmit={openInvite} className="space-y-3">
        <Field label="Have an invitation link?" value={link} onChange={setLink} placeholder="Paste the link here" />
        <Button type="submit" variant="secondary" disabled={!link.trim()} className="w-full justify-center">
          Open invitation
        </Button>
      </form>
      <button type="button" onClick={() => supabase.auth.signOut()} className="mt-5 text-[12.5px] font-semibold text-muted-foreground">
        Sign out
      </button>
    </AuthShell>
  );
}
