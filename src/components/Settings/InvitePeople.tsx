import { FormEvent, useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Card, PageHeader, StatusPill, EmptyState, Button } from '../UI';
import type { StatusTone } from '../UI';
import { companyApi, inviteLink, Invitation, INVITABLE_ROLES } from '../../lib/companyApi';

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
  const [latest, setLatest] = useState<{ email: string; link: string } | null>(null);

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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const created = await companyApi.createInvitation(email, role);
      setLatest({ email: email.trim().toLowerCase(), link: inviteLink(created.token) });
      setEmail('');
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
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
      <PageHeader title="Invite people" subtitle="They get a link that creates their account in this company. Works with company or personal email." />

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
            <p className="text-[12.5px] text-ink">
              Send this link to <strong>{latest.email}</strong>. It works once, only for that address, and expires in 7 days.
            </p>
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
