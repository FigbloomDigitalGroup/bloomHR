import { FormEvent, useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle } from 'lucide-react';
import { Button, Card, Modal, PageHeader, StatusPill, TableScroll } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import { isPlatformAdmin } from '../../lib/platformRates';
import {
  invitePlatformAdmin, inviteMessage, isEmail, listPlatformStaff, recentPlatformAdminChanges, removePlatformAdmin,
  type PlatformAdminChange, type PlatformStaffMember,
} from '../../lib/platformStaff';

// Figbloom's platform admins, on the console (migration 20261102100000_platform_staff.sql): see them, invite one
// (they need no company) and remove one with a reason. Not about one product, so the console shows it apart from the
// product groups. The database refuses anyone who is not a platform admin, and refuses removing yourself or the last one.

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

const companyLabel = (s: PlatformStaffMember) =>
  !s.in_company ? 'No company' : s.companies > 1 ? `Also in ${s.companies} companies` : 'Also in a company';

interface StaffPageProps {
  /** the signed-in admin, who cannot remove themselves */
  currentUserId: string;
}

export default function StaffPage({ currentUserId }: StaffPageProps) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [staff, setStaff] = useState<PlatformStaffMember[] | null>(null);
  const [changes, setChanges] = useState<PlatformAdminChange[]>([]);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [inviting, setInviting] = useState(false);
  const [outcome, setOutcome] = useState<ReturnType<typeof inviteMessage> | null>(null);
  const [removing, setRemoving] = useState<PlatformStaffMember | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void isPlatformAdmin().then(setAllowed);
  }, []);

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([listPlatformStaff(), recentPlatformAdminChanges(10)]);
      setStaff(s);
      setChanges(c);
    } catch (err) {
      setStaff([]);
      toast.error(err instanceof Error ? err.message : 'Could not load the platform admins.');
    }
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const emailOk = isEmail(email);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    if (!emailOk || inviting) return;
    setInviting(true);
    try {
      const r = await invitePlatformAdmin(email, note);
      const message = inviteMessage(r);
      // kept on the page too, so a failed notification isn't missed when the toast goes
      setOutcome(message);
      if (message.tone === 'warning') toast.error(message.text, { duration: 10000 });
      else toast.success(message.text);
      setEmail('');
      setNote('');
      await load();
    } catch (err) {
      setOutcome(null);
      toast.error(err instanceof Error ? err.message : 'The platform admin was not added.');
    } finally {
      setInviting(false);
    }
  };

  const openRemove = (s: PlatformStaffMember) => {
    setReason('');
    setRemoving(s);
  };

  const confirmRemove = async () => {
    if (!removing || !reason.trim()) return;
    setBusy(true);
    try {
      await removePlatformAdmin(removing.user_id, reason);
      toast.success(`${removing.email} is no longer a platform admin.`);
      setRemoving(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The platform admin was not removed.');
    } finally {
      setBusy(false);
    }
  };

  if (allowed === null) return <FigbloomLoader label="Loading" />;
  if (!allowed) {
    return (
      <div className="space-y-4">
        <PageHeader title="Staff" subtitle="Figbloom's platform admins" />
        <Card>
          <p className="text-sm text-ink">Only Figbloom platform admins can see and change the platform admins.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Staff" subtitle="Figbloom's platform admins: who can use this console" />

      <Card>
        {!staff ? (
          <FigbloomLoader label="Loading platform admins" size={48} />
        ) : staff.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No platform admins.</p>
        ) : (
          <TableScroll>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">Email</th>
                  <th className="py-1 pr-3 font-medium">Note</th>
                  <th className="py-1 pr-3 font-medium">Company</th>
                  <th className="py-1 pr-3 font-medium">Added</th>
                  <th className="py-1 pr-3 font-medium">Last sign-in</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.user_id} className="border-t border-border/60 align-top">
                    <td className="py-1.5 pr-3 text-ink font-semibold">
                      {s.email}
                      {s.user_id === currentUserId && <span className="ml-1 font-normal text-muted-foreground">(you)</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{s.note ?? '—'}</td>
                    <td className="py-1.5 pr-3">
                      <StatusPill label={companyLabel(s)} tone={s.in_company ? 'info' : 'neutral'} />
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">
                      {day(s.added_at)}
                      <span className="block">{s.added_by_email ? `by ${s.added_by_email}` : 'by Figbloom (set up directly)'}</span>
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{s.last_sign_in_at ? day(s.last_sign_in_at) : 'Never'}</td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      {s.user_id !== currentUserId && (
                        <button type="button" onClick={() => openRemove(s)} className="font-semibold text-status-danger">
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <Card>
          <h2 className="text-sm font-semibold text-ink">Invite a platform admin</h2>
          <p className="mt-2 flex items-start gap-2 rounded-tile bg-orange-tint-alt px-3 py-2 text-xs text-ink" role="note">
            <AlertTriangle className="w-4 h-4 shrink-0 text-orange-text-alt" />
            <span>
              A platform admin can approve and suspend every company on Figbloom HR, change the statutory rates and add or
              remove other platform admins. Invite only Figbloom staff who need it.
            </span>
          </p>
          <form className="mt-3 space-y-3" onSubmit={(e) => void invite(e)}>
            <label className="block text-xs text-ink">
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="off"
                className="block mt-1 w-full rounded-lg border border-border px-2 py-1.5 text-sm" />
            </label>
            <label className="block text-xs text-ink">
              Note (optional, e.g. their role)
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
                className="block mt-1 w-full rounded-lg border border-border px-2 py-1.5 text-sm" />
            </label>
            <p className="text-[11.5px] text-muted-foreground">
              They need no company. Without a login yet, they get an email to set a password here; with one, they sign in as usual.
            </p>
            <Button type="submit" disabled={!emailOk || inviting}>
              {inviting ? 'Inviting…' : 'Invite'}
            </Button>
          </form>
          {outcome && (
            <p role="status"
              className={`mt-3 rounded-tile px-3 py-2 text-xs ${outcome.tone === 'warning' ? 'bg-orange-tint-alt text-orange-text-alt' : 'bg-green-tint text-status-success'}`}>
              {outcome.text}
            </p>
          )}
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-ink mb-3">Recent changes</h2>
          {changes.length === 0 ? (
            <p className="text-xs text-muted-foreground">No changes yet.</p>
          ) : (
            <ul className="space-y-2" aria-label="Recent changes">
              {changes.map((c) => (
                <li key={c.id} className="text-xs text-ink">
                  <span className="font-semibold">{c.email ?? 'A deleted login'}</span>{' '}
                  {c.action === 'added' ? 'added' : 'removed'}
                  {c.changed_by_email ? ` by ${c.changed_by_email}` : ''}
                  <span className="text-muted-foreground">, {day(c.changed_at)}</span>
                  {c.note && <span className="block text-muted-foreground">{c.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Modal open={!!removing} onClose={() => !busy && setRemoving(null)} title={removing ? `Remove ${removing.email}?` : ''} size="sm"
        closeOnBackdrop={!busy}>
        {removing && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              They can no longer use this console. Their login stays, and so does any company they belong to.
            </p>
            <label className="block text-xs text-ink">
              Why? (kept in the recent changes)
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000}
                className="block mt-1 w-full rounded-lg border border-border px-2 py-1 text-sm" />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRemoving(null)} disabled={busy}>Cancel</Button>
              <Button onClick={() => void confirmRemove()} disabled={busy || !reason.trim()}>
                {busy ? 'Removing…' : 'Remove'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
