import { useState } from 'react';
import toast from 'react-hot-toast';
import { Button, EmployeePicker, Modal } from '../UI';
import { ABSENCE_KIND_LABEL, formatDateRange, workingDaysText, type AbsenceKind, type AbsenceRecord, type WarningDraft } from '../../lib/leaveDiscipline';
import { excuseAbsence, issueDisciplineWarning, recordAbsence } from '../../lib/leaveDisciplineApi';

// The three dialogs of Leave discipline (FIG-881): record an absence, excuse one, issue a warning.

const input = 'w-full px-3 py-2 text-xs border border-border rounded-tile bg-white text-ink outline-none focus:border-brand';
const labelClass = 'block text-[11px] font-semibold text-ink mb-1.5';
const today = () => new Date().toISOString().slice(0, 10);
const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong. Please try again.');

export function RecordAbsenceModal({
  open, kind: initialKind, allowedNumbers, onClose, onSaved,
}: {
  open: boolean;
  kind: AbsenceKind;
  /** only these employees (a supervisor's team); undefined for everyone */
  allowedNumbers?: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [employee, setEmployee] = useState('');
  const [kind, setKind] = useState<AbsenceKind>(initialKind);
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await recordAbsence({ employeeNumber: employee, kind, start, end: end || start, note });
      toast.success(`${ABSENCE_KIND_LABEL[kind]} recorded. The employee has been told.`);
      setEmployee('');
      setNote('');
      onSaved();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Record an absence" closeOnBackdrop={!busy}>
      <div className="space-y-4 mt-4">
        <EmployeePicker label="Employee" value={employee} allowedNumbers={allowedNumbers} onChange={(e) => setEmployee(e?.employeeNumber ?? '')} />
        <fieldset className="m-0 p-0 border-0">
          <legend className={labelClass}>What happened</legend>
          <div className="space-y-1.5">
            {(Object.keys(ABSENCE_KIND_LABEL) as AbsenceKind[]).map((k) => (
              <label key={k} className="flex items-start gap-2 text-xs cursor-pointer">
                <input type="radio" name="absence-kind" className="mt-0.5" checked={kind === k} onChange={() => setKind(k)} />
                <span>
                  <span className="font-semibold text-ink">{ABSENCE_KIND_LABEL[k]}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {k === 'unexcused_absence'
                      ? 'Away from work without permission or a valid reason. Unpaid unless excused.'
                      : "Didn't tell their supervisor or HR in time. A conduct record; not deducted from pay."}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={labelClass}>First day</span>
            <input type="date" className={input} value={start} max={today()} onChange={(e) => { setStart(e.target.value); if (!end || end < e.target.value) setEnd(e.target.value); }} />
          </label>
          <label className="block">
            <span className={labelClass}>Last day</span>
            <input type="date" className={input} value={end} min={start} max={today()} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className={labelClass}>Note (the employee sees it)</span>
          <textarea className={`${input} resize-none`} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <p className="m-0 text-[11px] text-muted-foreground">Only working days count: the employee&apos;s work week, less public holidays.</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy || !employee || !start}>{busy ? 'Saving...' : 'Record'}</Button>
        </div>
      </div>
    </Modal>
  );
}

export function ExcuseAbsenceModal({
  absence, leaveTypes, canMakeLeave, onClose, onSaved,
}: {
  absence: AbsenceRecord | null;
  leaveTypes: string[];
  canMakeLeave: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState('');
  const [leaveType, setLeaveType] = useState('');
  const [busy, setBusy] = useState(false);
  if (!absence) return null;

  const save = async () => {
    setBusy(true);
    try {
      await excuseAbsence(absence.id, note, leaveType || null);
      toast.success(leaveType ? `Excused and recorded as ${leaveType}.` : 'Absence excused.');
      setNote('');
      setLeaveType('');
      onSaved();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Excuse this absence" closeOnBackdrop={!busy}>
      <div className="space-y-4 mt-4">
        <p className="m-0 text-xs text-ink">
          {absence.employee_name}: {ABSENCE_KIND_LABEL[absence.kind].toLowerCase()} on {formatDateRange(absence.start_date, absence.end_date)} ({workingDaysText(absence.days)}).
          Once excused it is not deducted from pay.
        </p>
        <label className="block">
          <span className={labelClass}>Why (e.g. a doctor&apos;s note was brought)</span>
          <textarea className={`${input} resize-none`} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {canMakeLeave && absence.kind === 'unexcused_absence' && (
          <label className="block">
            <span className={labelClass}>Record the days as leave (optional)</span>
            <select className={input} value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
              <option value="">No, just excuse it</option>
              {leaveTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <span className="block text-[11px] text-muted-foreground mt-1">An approved application for the same days, taken from that leave&apos;s balance.</span>
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving...' : 'Excuse'}</Button>
        </div>
      </div>
    </Modal>
  );
}

export function DisciplineWarningModal({
  draft: initial, onClose, onSent,
}: {
  draft: WarningDraft | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [draft, setDraft] = useState<WarningDraft | null>(initial);
  const [busy, setBusy] = useState(false);
  if (!initial) return null;
  // the parent mounts it afresh (a key) for each record, so it starts from that record's template
  const d = draft ?? initial;
  const set = (patch: Partial<WarningDraft>) => setDraft({ ...d, ...patch });

  const send = async () => {
    setBusy(true);
    try {
      await issueDisciplineWarning(d);
      toast.success(`Warning issued to ${d.employeeName}. They have been notified and emailed.`);
      onSent();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Issue warning: ${d.employeeName}`} closeOnBackdrop={!busy} size="xl">
      <div className="space-y-4 mt-4">
        <label className="block">
          <span className={labelClass}>Warning type</span>
          <input className={input} value={d.type} maxLength={120} onChange={(e) => set({ type: e.target.value })} />
        </label>
        <fieldset className="m-0 p-0 border-0">
          <legend className={labelClass}>Severity</legend>
          <div className="flex gap-4">
            {(['low', 'medium', 'high'] as const).map((s) => (
              <label key={s} className="flex items-center gap-2 text-xs capitalize cursor-pointer">
                <input type="radio" name="warning-severity" checked={d.severity === s} onChange={() => set({ severity: s })} />
                {s}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className={labelClass}>Message</span>
          <textarea className={`${input} resize-y`} rows={6} maxLength={5000} value={d.message} onChange={(e) => set({ message: e.target.value })} />
        </label>
        <p className="m-0 text-[11px] text-muted-foreground">
          The warning is kept with the employee&apos;s warnings (Disciplinary) and linked to this record; the employee is notified and emailed.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button className="!bg-status-danger !border-status-danger" onClick={() => void send()} disabled={busy || !d.message.trim() || !d.type.trim()}>
            {busy ? 'Sending...' : 'Send warning'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
