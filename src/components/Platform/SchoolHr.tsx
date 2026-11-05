import { useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Modal, StatusPill } from '../UI';
import type { StatusTone } from '../UI';
import { HR_STATE_LABELS, type HrState, type SchoolHr } from '../../lib/platformSchoolHr';
import type { SchoolHrData } from './useSchoolHr';

// "HR & Payroll: Off / Enabling / On" for each school on the Schools and School groups pages, with Enable for console
// roles that approve companies (Owner, Admin). ERP/SCHOOLS_HR_PHASE1_CONTRACT.md.

const TONES: Record<HrState, StatusTone> = { off: 'neutral', enabling: 'warning', on: 'success', unknown: 'neutral' };

interface CellProps {
  school: SchoolHr | undefined;
  data: SchoolHrData;
  canEnable: boolean;
  /** show "HR & Payroll:" before the state (where no column header says it) */
  labelled?: boolean;
}

/** One school's HR state, and Enable when it is off and the caller may switch it on. */
export function SchoolHrCell({ school, data, canEnable, labelled = false }: CellProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const prefix = labelled ? 'HR & Payroll: ' : '';

  if (data.list === undefined) return <span className="text-muted-foreground">…</span>;
  if (!school) {
    const why = data.list === null
      ? data.notConnected ? "The Figbloom platform isn't connected to the console yet" : "The Figbloom platform couldn't be asked"
      : "This school isn't on the Figbloom platform yet";
    return <span className="text-muted-foreground" title={why}>{prefix}—</span>;
  }

  const state = school.hr.state;
  const confirm = async () => {
    setBusy(true);
    try {
      const updated = await data.enable(school);
      toast.success(
        updated.hr.state === 'on'
          ? `${school.name}: HR & Payroll is on.`
          : `${school.name}: HR & Payroll is being switched on. Figbloom HR creates the company and invites the school's admins.`
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
            aria-label={`Enable HR & Payroll for ${school.name}`}>
            Enable
          </button>
        )}
      </span>
      <Modal open={confirming} onClose={() => !busy && setConfirming(false)} title={`Switch HR & Payroll on for ${school.name}?`}
        size="sm" closeOnBackdrop={!busy}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Figbloom HR creates an HR company for the school, links it to the school and emails the school's admins an
            invitation to it. Staff sent from Figbloom Schools are added as draft employees, who are not paid until HR
            completes and approves their records. Recorded on the Figbloom platform with your email.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void confirm()} disabled={busy}>{busy ? 'Enabling…' : 'Enable'}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
