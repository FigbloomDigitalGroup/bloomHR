import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Copy, Mail, RotateCcw } from 'lucide-react';
import { inviteEmployee, type InviteOutcome } from '../../lib/employeeInvite';

/** How the invitation to join went, and what to do if it did not go out. */
export default function InviteStatus({ initial }: { initial: InviteOutcome }) {
  const [invite, setInvite] = useState(initial);
  const [busy, setBusy] = useState(false);

  const retry = async () => {
    setBusy(true);
    setInvite(await inviteEmployee(invite.email));
    setBusy(false);
  };

  const copy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy. Select the link and copy it by hand.');
    }
  };

  const box = 'mx-auto mb-8 max-w-md rounded-lg border px-4 py-3 text-left text-sm';
  if (invite.status === 'sent') {
    return (
      <div className={`${box} border-emerald-200 bg-emerald-50 text-emerald-800`}>
        <div className="flex items-center gap-2 font-semibold">
          <Mail className="h-4 w-4" />
          Invitation sent to {invite.email}
        </div>
        <p className="mt-1 text-emerald-700">The link lets them set a password and join. It works for 7 days.</p>
      </div>
    );
  }
  if (invite.status === 'member') {
    return (
      <div className={`${box} border-gray-200 bg-gray-50 text-gray-700`}>
        {invite.email} already has access to this company, so no invitation was needed.
      </div>
    );
  }
  const permission = invite.status === 'failed' && /administrator or HR/i.test(invite.reason);
  return (
    <div className={`${box} border-amber-200 bg-amber-50 text-amber-900`}>
      <div className="font-semibold">
        {invite.status === 'not-emailed' ? `The invitation email to ${invite.email} did not go out` : `No invitation was sent to ${invite.email}`}
      </div>
      <p className="mt-1">{invite.reason}</p>
      {permission && (
        <p className="mt-1">
          Ask an administrator or HR to invite them from <Link to="/invite-people" className="underline">Invite people</Link>.
        </p>
      )}
      {invite.status === 'not-emailed' && (
        <div className="mt-2 flex items-center gap-2">
          <input readOnly value={invite.link} aria-label="Invitation link" className="min-w-0 flex-1 rounded border border-amber-200 bg-white px-2 py-1 text-xs" />
          <button type="button" onClick={() => copy(invite.link)} className="inline-flex items-center gap-1 rounded border border-amber-300 bg-white px-2 py-1 text-xs font-semibold">
            <Copy className="h-3 w-3" />
            Copy
          </button>
        </div>
      )}
      {!permission && (
        <button
          type="button"
          onClick={retry}
          disabled={busy}
          className="mt-2 inline-flex items-center gap-1 rounded border border-amber-300 bg-white px-2 py-1 text-xs font-semibold disabled:opacity-50"
        >
          <RotateCcw className="h-3 w-3" />
          {busy ? 'Sending…' : 'Try again'}
        </button>
      )}
    </div>
  );
}
