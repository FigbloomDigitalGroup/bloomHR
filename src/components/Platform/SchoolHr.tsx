import { useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { Button, Modal, StatusPill } from '../UI';
import type { StatusTone } from '../UI';
import { HR_STATE_LABELS, type HrState, type SchoolHr } from '../../lib/platformSchoolHr';
import type { SchoolHrData } from './useSchoolHr';
import { WithHrRequest } from './HrRequest';
import { hrAdminInviteMessage, inviteHrAdmin, type HrAdminInvite } from '../../lib/platformHrAdmin';

// "HR & Payroll: Off / Enabling / On" for each school on the Schools and School groups pages, each company on the
// Fleet companies page and each workspace on the Property workspaces page, with Enable for console roles that approve
// companies (Owner, Admin), and, once it is On, Invite admin (the same roles): another administrator for the customer's
// HR company, when the address the customer gave is wrong (platform_hr_admin_routes.js).
// ERP/SCHOOLS_HR_PHASE1_CONTRACT.md, ERP/FLEET_HR_CONTRACT.md, ERP/PROPERTY_HR_CONTRACT.md.

const TONES: Record<HrState, StatusTone> = { off: 'neutral', enabling: 'warning', on: 'success', unknown: 'neutral' };

interface HrPayrollCellProps {
  /** the school's, company's or workspace's name */
  name: string;
  state: HrState;
  canEnable: boolean;
  /** switches it on; resolves the state now */
  enable: () => Promise<HrState>;
  /** what HR does, for the confirm dialog */
  explain: string;
  /** who HR invites, for the toast ("the school's admins") */
  invitees: string;
  labelled?: boolean;
  /** the platform's ID for it: Invite admin (canEnable, once On) needs it */
  platformTenantId?: string | null;
}

/** The HR state of one school, company or workspace, and Enable when it is off and the caller may switch it on. */
export function HrPayrollCell({
  name, state, canEnable, enable, explain, invitees, labelled = false, platformTenantId = null,
}: HrPayrollCellProps) {
  const [confirming, setConfirming] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState(false);
  const prefix = labelled ? 'HR & Payroll: ' : '';

  const confirm = async () => {
    setBusy(true);
    try {
      const now = await enable();
      toast.success(
        now === 'on'
          ? `${name}: HR & Payroll is on.`
          : `${name}: HR & Payroll is being switched on. Figbloom HR creates the company and invites ${invitees}.`
      );
      setConfirming(false);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : 'HR & Payroll was not switched on.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <span className="inline-flex items-center gap-2 whitespace-nowrap">
        <StatusPill label={`${prefix}${HR_STATE_LABELS[state]}`} tone={TONES[state]} />
        {canEnable && state === 'off' && (
          <button type="button" onClick={() => setConfirming(true)} className="font-semibold text-brand"
            aria-label={`Enable HR & Payroll for ${name}`}>
            Enable
          </button>
        )}
        {canEnable && state === 'on' && platformTenantId && (
          <button type="button" onClick={() => setInviting(true)} className="font-semibold text-brand"
            aria-label={`Invite an HR admin for ${name}`}>
            Invite admin
          </button>
        )}
      </span>
      {inviting && platformTenantId && (
        <InviteHrAdminDialog name={name} platformTenantId={platformTenantId} onClose={() => setInviting(false)} />
      )}
      <Modal open={confirming} onClose={() => !busy && setConfirming(false)} title={`Switch HR & Payroll on for ${name}?`}
        size="sm" closeOnBackdrop={!busy}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{explain}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void confirm()} disabled={busy}>{busy ? 'Enabling…' : 'Enable'}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

const ALREADY: Record<HrAdminInvite['outcome'], boolean> = { queued: false, already_invited: true, already_member: true };

/**
 * Invite admin: an email (and a name, for the record) for another administrator of the customer's HR company. Says
 * inline what happened: sent, already invited, or already an admin. Stays open to invite someone else.
 */
function InviteHrAdminDialog({ name, platformTenantId, onClose }: { name: string; platformTenantId: string; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [person, setPerson] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HrAdminInvite | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await inviteHrAdmin(platformTenantId, address, person);
      setResult(r);
      if (r.outcome === 'queued') {
        setEmail('');
        setPerson('');
      }
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'The invitation was not sent. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={() => !busy && onClose()} title={`Invite an HR admin for ${name}`} size="sm" closeOnBackdrop={!busy}>
      <form className="space-y-3" onSubmit={(e) => void submit(e)} noValidate>
        <p className="text-sm text-muted-foreground">
          {`Figbloom HR emails them an invitation to administer ${name}'s HR company, as it did for the admins given when ` +
            'HR & Payroll was switched on. Use this when that address was wrong. Recorded with your email.'}
        </p>
        <label className="block text-xs text-ink">
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="off"
            required disabled={busy} className="block mt-1 w-full rounded-lg border border-border px-2 py-1.5 text-sm" />
        </label>
        <label className="block text-xs text-ink">
          Name (optional)
          <input type="text" value={person} onChange={(e) => setPerson(e.target.value)} maxLength={200} autoComplete="off"
            disabled={busy} className="block mt-1 w-full rounded-lg border border-border px-2 py-1.5 text-sm" />
        </label>
        {error && <p className="text-xs text-status-danger" role="alert">{error}</p>}
        {result && (
          <p className={`text-sm ${ALREADY[result.outcome] ? 'text-ink' : 'text-status-success'}`} role="status">
            {hrAdminInviteMessage(result)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>{result ? 'Done' : 'Cancel'}</Button>
          <Button type="submit" disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Send invitation'}</Button>
        </div>
      </form>
    </Modal>
  );
}

const SCHOOL_EXPLAIN =
  "Figbloom HR creates an HR company for the school, links it to the school and emails the school's admins an " +
  'invitation to it. Staff sent from Figbloom Schools are added as draft employees, who are not paid until HR ' +
  'completes and approves their records. Recorded on the Figbloom platform with your email.';

interface CellProps {
  school: SchoolHr | undefined;
  data: SchoolHrData;
  canEnable: boolean;
  /** show "HR & Payroll:" before the state (where no column header says it) */
  labelled?: boolean;
  /** when the school asked for Figbloom HR in Schools (its hr_requested_at): "Requested …" beside Off */
  requestedAt?: string | null;
}

/** One school's HR state, and Enable when it is off and the caller may switch it on; "Requested …" while asked for. */
export function SchoolHrCell({ school, data, canEnable, labelled = false, requestedAt = null }: CellProps) {
  const prefix = labelled ? 'HR & Payroll: ' : '';
  // no "Requested" until the HR state is known: it may already be on
  if (data.list === undefined) return <span className="text-muted-foreground">…</span>;
  let cell;
  if (!school) {
    const why = data.list === null
      ? data.notConnected ? "The Figbloom platform isn't connected to the console yet" : "The Figbloom platform couldn't be asked"
      : "This school isn't on the Figbloom platform yet";
    cell = <span className="text-muted-foreground" title={why}>{prefix}—</span>;
  } else {
    cell = (
      <HrPayrollCell name={school.name} state={school.hr.state} canEnable={canEnable} labelled={labelled}
        enable={async () => (await data.enable(school)).hr.state} explain={SCHOOL_EXPLAIN} invitees="the school's admins"
        platformTenantId={school.platform_tenant_id} />
    );
  }
  return <WithHrRequest row={{ hr_requested_at: requestedAt, hr: school?.hr ?? null }}>{cell}</WithHrRequest>;
}
