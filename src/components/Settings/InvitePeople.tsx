import { FormEvent, useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Card, PageHeader, StatusPill, EmptyState, Button } from '../UI';
import type { StatusTone } from '../UI';
import { companyApi, inviteLink, Invitation, INVITABLE_ROLES } from '../../lib/companyApi';
import { sendInvitations, summariseInvites } from '../../lib/employeeInvite';

const roleLabel = (role: string) => role.charAt(0) + role.slice(1).toLowerCase();

const effectiveStatus = (inv: Invitation): { label: string; tone: StatusTone } => {
  if (inv.status === 'accepted') return { label: 'Joined', tone: 'success' };
  if (inv.status === 'revoked') return { label: 'Cancelled', tone: 'neutral' };
  if (new Date(inv.expires_at).getTime() < Date.now()) return { label: 'Expired', tone: 'warning' };
  return { label: 'Waiting', tone: 'info' };
};

interface InvitePeopleProps {
  /** HR may only invite staff; administrators may invite any role. */
  callerRole?: string;
}

/** Invite people to the company you are working in: they get a link that creates their account in it. */
export default function InvitePeople({ callerRole = 'ADMIN' }: InvitePeopleProps) {
  const roles = callerRole === 'ADMIN' ? INVITABLE_ROLES : (['STAFF'] as const);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('STAFF');
  const [busy, setBusy] = useState(false);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [latest, setLatest] = useState<{ email: string; link: string; mail: 'sending' | 'sent' | 'failed'; reason?: string } | null>(null);
  const [resending, setResending] = useState<{ done: number; total: number } | null>(null);

  const load = useCallback(async () => {
    try {
      setInvitations(await companyApi.listInvitations());
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy. Select the link and copy it by hand.');
    }
  };

  /** Creates the invitation and emails it. If the email cannot go out, the link is still there to send by hand. */
  const invite = async (to: string, inviteRole: string) => {
    const created = await companyApi.createInvitation(to, inviteRole);
    const entry = { email: to.trim().toLowerCase(), link: inviteLink(created.token) };
    setLatest({ ...entry, mail: 'sending' });
    await load();
    try {
      await companyApi.emailInvitation(created.token);
      setLatest({ ...entry, mail: 'sent' });
    } catch (err) {
      setLatest({ ...entry, mail: 'failed', reason: (err as Error).message });
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await invite(email, role);
      setEmail('');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // a new invitation replaces the old link, so "resend" makes a fresh one and emails it
  const resend = async (inv: Invitation) => {
    try {
      await invite(inv.email, inv.role);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  // invitations nobody has used yet, including expired ones: these can be sent again
  const due = (invitations ?? []).filter((inv) => ['Waiting', 'Expired'].includes(effectiveStatus(inv).label));

  /** Sends every unused invitation again, one after another. Each gets a new link; the old links stop working. */
  const resendAll = async () => {
    if (due.length === 0) return;
    if (!window.confirm(`Send ${due.length} invitation(s) again? Each person gets a new link, and their old link stops working.`)) return;
    setResending({ done: 0, total: due.length });
    const outcomes = await sendInvitations(
      due.map((inv) => ({ email: inv.email, role: inv.role })),
      (done, total) => setResending({ done, total })
    );
    setResending(null);
    await load();
    const { sent, members, notSent } = summariseInvites(outcomes);
    const joined = members ? `, ${members} had already joined` : '';
    if (notSent.length) {
      toast.error(`${sent} sent${joined}. Not sent: ${notSent.map((o) => `${o.email} (${o.reason})`).join('; ')}`, { duration: 10000 });
    } else {
      toast.success(`${sent} invitation(s) sent again${joined}.`);
    }
  };

  const cancel = async (id: string) => {
    try {
      await companyApi.revokeInvitation(id);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div>
      <PageHeader title="Invite people" subtitle="We email them a link that creates their account in this company. Works with company or personal email." />

      <Card className="mb-4">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[220px]">
            <span className="block text-[12px] font-semibold text-muted-foreground mb-1">Email address</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@gmail.com"
              className="w-full px-3 py-2 rounded-tile border border-border text-[13px] text-ink focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand"
            />
          </label>
          <label>
            <span className="block text-[12px] font-semibold text-muted-foreground mb-1">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="px-3 py-2 rounded-tile border border-border text-[13px] text-ink bg-white focus:outline-none focus:ring-1 focus:ring-brand"
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={busy || !email.trim()}>
            {busy ? 'Creating link…' : 'Create invitation'}
          </Button>
        </form>

        {latest && (
          <div className="mt-4 p-3 rounded-tile bg-green-tint border border-border">
            {latest.mail === 'sending' && <p className="text-[12.5px] text-ink">Emailing the invitation to <strong>{latest.email}</strong>…</p>}
            {latest.mail === 'sent' && (
              <p className="text-[12.5px] text-ink">
                We emailed the invitation to <strong>{latest.email}</strong>. The link works once, only for that address, and expires in 7 days. You can also copy it:
              </p>
            )}
            {latest.mail === 'failed' && (
              <p className="text-[12.5px] text-ink">
                We could not email the invitation ({latest.reason}). Send this link to <strong>{latest.email}</strong> yourself. It works once, only for that address, and expires in 7 days.
              </p>
            )}
            <div className="mt-2 flex gap-2">
              <input readOnly value={latest.link} onFocus={(e) => e.currentTarget.select()} className="flex-1 px-3 py-2 rounded-tile border border-border bg-white text-[12px] text-ink" aria-label="Invitation link" />
              <Button variant="secondary" onClick={() => copy(latest.link)}>
                Copy link
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card padding="none">
        {due.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-border">
            <span className="text-[12.5px] text-muted-foreground">
              {resending ? `Sending ${resending.done} of ${resending.total}…` : `${due.length} invitation(s) not used yet`}
            </span>
            <Button variant="secondary" onClick={resendAll} disabled={!!resending}>
              {resending ? 'Sending…' : 'Resend all'}
            </Button>
          </div>
        )}
        {loadError ? (
          <div className="p-4 text-[13px] text-status-danger">Could not load invitations: {loadError}</div>
        ) : invitations === null ? (
          <div className="p-4 text-[13px] text-muted-foreground">Loading…</div>
        ) : invitations.length === 0 ? (
          <EmptyState icon={<span aria-hidden>✉</span>} title="No invitations yet" description="Invite someone above and they will appear here." />
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11.5px] text-muted-foreground border-b border-border">
                <th className="px-4 py-2.5 font-semibold">Email</th>
                <th className="px-4 py-2.5 font-semibold">Role</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Sent</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => {
                const status = effectiveStatus(inv);
                return (
                  <tr key={inv.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 text-ink">{inv.email}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{roleLabel(inv.role)}</td>
                    <td className="px-4 py-2.5">
                      <StatusPill label={status.label} tone={status.tone} />
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{new Date(inv.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-2.5 text-right">
                      {(status.label === 'Waiting' || status.label === 'Expired') && (
                        <button type="button" onClick={() => resend(inv)} className="mr-3 text-[12px] font-semibold text-brand">
                          Resend
                        </button>
                      )}
                      {status.label === 'Waiting' && (
                        <button type="button" onClick={() => cancel(inv.id)} className="text-[12px] font-semibold text-status-danger">
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
