import { FormEvent, useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle } from 'lucide-react';
import { Button, Card, Modal, PageHeader, StatusPill, TableScroll } from '../UI';
import type { StatusTone } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import {
  PLATFORM_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, assignableRoles, myPlatformRole, roleCan, staffChangeAllowed,
  type PlatformRole,
} from '../../lib/platformRoles';
import {
  invitePlatformAdmin, inviteMessage, isEmail, listPlatformStaff, recentPlatformAdminChanges, removePlatformAdmin,
  setPlatformAdminRole, type PlatformAdminChange, type PlatformStaffMember,
} from '../../lib/platformStaff';

// Figbloom's platform admins, on the console (migrations 20261102100000_platform_staff.sql and
// 20261103100000_platform_roles.sql): see them and their roles; owners and admins invite, remove and change roles
// (an admin never touches an owner). Not about one product, so the console shows it apart from the product groups.
// The database enforces all of it; this page only hides what you can't do.

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

const companyLabel = (s: PlatformStaffMember) =>
  !s.in_company ? 'No company' : s.companies > 1 ? `Also in ${s.companies} companies` : 'Also in a company';

const ROLE_TONES: Record<PlatformRole, StatusTone> = { owner: 'purple', admin: 'info', support: 'warning', viewer: 'neutral' };

const roleLabel = (r: string | null | undefined) => (r && r in ROLE_LABELS ? ROLE_LABELS[r as PlatformRole] : r ?? '');

function changeText(c: PlatformAdminChange) {
  if (c.action === 'role_changed') return `changed from ${roleLabel(c.old_role)} to ${roleLabel(c.new_role)}`;
  if (c.action === 'added') return c.new_role ? `added as ${roleLabel(c.new_role)}` : 'added';
  return 'removed';
}

interface StaffPageProps {
  /** the signed-in admin, who cannot remove themselves */
  currentUserId: string;
}

export default function StaffPage({ currentUserId }: StaffPageProps) {
  // undefined while loading; null when not a platform admin
  const [myRole, setMyRole] = useState<PlatformRole | null | undefined>(undefined);
  const [staff, setStaff] = useState<PlatformStaffMember[] | null>(null);
  const [changes, setChanges] = useState<PlatformAdminChange[]>([]);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [role, setRole] = useState<PlatformRole>('viewer');
  const [inviting, setInviting] = useState(false);
  const [outcome, setOutcome] = useState<ReturnType<typeof inviteMessage> | null>(null);
  const [removing, setRemoving] = useState<PlatformStaffMember | null>(null);
  const [changing, setChanging] = useState<PlatformStaffMember | null>(null);
  const [newRole, setNewRole] = useState<PlatformRole | ''>('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void myPlatformRole().then(setMyRole);
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
    if (myRole) void load();
  }, [myRole, load]);

  const manages = roleCan(myRole, 'manage_staff');
  const inviteRoles = assignableRoles(myRole);
  const emailOk = isEmail(email);
  const rolesFor = (s: PlatformStaffMember) => PLATFORM_ROLES.filter((r) => r !== s.role && staffChangeAllowed(myRole, s.role, r));
  const canRemove = (s: PlatformStaffMember) => manages && s.user_id !== currentUserId && staffChangeAllowed(myRole, s.role, null);
  const canChangeRole = (s: PlatformStaffMember) => manages && rolesFor(s).length > 0;

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    if (!emailOk || inviting) return;
    setInviting(true);
    try {
      const r = await invitePlatformAdmin(email, note, role);
      const message = inviteMessage(r);
      // kept on the page too, so a failed notification isn't missed when the toast goes
      setOutcome(message);
      if (message.tone === 'warning') toast.error(message.text, { duration: 10000 });
      else toast.success(message.text);
      setEmail('');
      setNote('');
      setRole('viewer');
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

  const openChange = (s: PlatformStaffMember) => {
    setReason('');
    setNewRole('');
    setChanging(s);
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

  const confirmChange = async () => {
    if (!changing || !newRole || !reason.trim()) return;
    setBusy(true);
    try {
      const to = await setPlatformAdminRole(changing.user_id, newRole, reason);
      toast.success(`${changing.email} is now ${ROLE_LABELS[to] ?? to}.`);
      setChanging(null);
      // your own role may have changed what you can do here
      if (changing.user_id === currentUserId) setMyRole(await myPlatformRole());
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The role was not changed.');
    } finally {
      setBusy(false);
    }
  };

  if (myRole === undefined) return <FigbloomLoader label="Loading" />;
  if (!myRole) {
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
      <PageHeader title="Staff" subtitle="Figbloom's platform admins: who can use this console, and what each may do" />

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
                  <th className="py-1 pr-3 font-medium">Role</th>
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
                    <td className="py-1.5 pr-3">
                      <StatusPill label={roleLabel(s.role)} tone={ROLE_TONES[s.role] ?? 'neutral'} />
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
                      {canChangeRole(s) && (
                        <button type="button" onClick={() => openChange(s)} className="ml-3 font-semibold text-brand">
                          Change role
                        </button>
                      )}
                      {canRemove(s) && (
                        <button type="button" onClick={() => openRemove(s)} className="ml-3 font-semibold text-status-danger">
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

      <div className={`grid gap-3 ${manages ? 'lg:grid-cols-[1fr_1fr]' : ''}`}>
        {manages && (
          <Card>
            <h2 className="text-sm font-semibold text-ink">Invite a platform admin</h2>
            <p className="mt-2 flex items-start gap-2 rounded-tile bg-orange-tint-alt px-3 py-2 text-xs text-ink" role="note">
              <AlertTriangle className="w-4 h-4 shrink-0 text-orange-text-alt" />
              <span>
                An owner or admin can approve and suspend every company on Figbloom HR, change the statutory rates and add
                or remove other platform admins. Invite only Figbloom staff who need it, with the smallest role that does.
              </span>
            </p>
            <form className="mt-3 space-y-3" onSubmit={(e) => void invite(e)}>
              <label className="block text-xs text-ink">
                Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="off"
                  className="block mt-1 w-full rounded-lg border border-border px-2 py-1.5 text-sm" />
              </label>
              <fieldset className="text-xs text-ink">
                <legend>Role</legend>
                <div className="mt-1 space-y-1.5">
                  {inviteRoles.map((r) => (
                    <label key={r} className="flex items-start gap-2 cursor-pointer">
                      <input type="radio" name="invite-role" value={r} checked={role === r} onChange={() => setRole(r)} className="mt-0.5" />
                      <span>
                        <span className="font-semibold">{ROLE_LABELS[r]}</span>
                        <span className="block text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="block text-xs text-ink">
                Note (optional, e.g. their job)
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
        )}

        <Card>
          <h2 className="text-sm font-semibold text-ink mb-3">Recent changes</h2>
          {changes.length === 0 ? (
            <p className="text-xs text-muted-foreground">No changes yet.</p>
          ) : (
            <ul className="space-y-2" aria-label="Recent changes">
              {changes.map((c) => (
                <li key={c.id} className="text-xs text-ink">
                  <span className="font-semibold">{c.email ?? 'A deleted login'}</span> {changeText(c)}
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

      <Modal open={!!changing} onClose={() => !busy && setChanging(null)} title={changing ? `Change ${changing.email}'s role` : ''} size="sm"
        closeOnBackdrop={!busy}>
        {changing && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Now: {roleLabel(changing.role)}.</p>
            <label className="block text-xs text-ink">
              New role
              <select value={newRole} onChange={(e) => setNewRole(e.target.value as PlatformRole | '')}
                className="block mt-1 w-full rounded-lg border border-border px-2 py-1.5 text-sm">
                <option value="">Choose a role</option>
                {rolesFor(changing).map((r) => (
                  <option key={r} value={r}>{`${ROLE_LABELS[r]}: ${ROLE_DESCRIPTIONS[r]}`}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-ink">
              Why? (kept in the recent changes)
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000}
                className="block mt-1 w-full rounded-lg border border-border px-2 py-1 text-sm" />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setChanging(null)} disabled={busy}>Cancel</Button>
              <Button onClick={() => void confirmChange()} disabled={busy || !newRole || !reason.trim()}>
                {busy ? 'Saving…' : 'Change role'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
