import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '../UI';
import { TextField } from './Fields';
import { type Referee, deleteReferee, emptyReferee, loadReferees, refereeProblem, saveReferee } from '../../lib/employeeDocuments';
import FigbloomLoader from '../UI/FigbloomLoader';

import { confirmDialog } from '../../lib/confirmDialog';
// The employee's referees: as many as they like, at least one. Each has a phone number or an email.

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

export default function RefereesSection({ employeeId, onChanged }: { employeeId: string; onChanged?: () => void }) {
  const [referees, setReferees] = useState<Referee[] | null>(null);
  const [editing, setEditing] = useState<Referee | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setReferees(await loadReferees(employeeId));
    } catch (err) {
      setReferees([]);
      toast.error(errorText(err, 'Could not load your referees.'));
    }
  }, [employeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await saveReferee(employeeId, editing);
      setEditing(null);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(errorText(err, 'The referee was not saved.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Referee) => {
    if (!r.id || !(await confirmDialog({ title: `Remove ${r.full_name}?`, confirmLabel: 'Remove', tone: 'danger' }))) return;
    try {
      await deleteReferee(r.id);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(errorText(err, 'The referee was not removed.'));
    }
  };

  if (!referees) return <FigbloomLoader label="Loading referees" size={48} />;
  const set = (key: keyof Referee) => (v: string) => setEditing((e) => (e ? { ...e, [key]: v } : e));

  return (
    <div className="space-y-3">
      {referees.length === 0 && !editing && <p className="text-sm text-muted-foreground">Add at least one referee.</p>}
      {referees.map((r) => (
        <div key={r.id} className="flex flex-wrap items-start gap-3 rounded-lg border border-border px-3 py-2">
          <div className="flex-1 min-w-[200px] text-sm">
            <p className="font-medium text-ink">{r.full_name}</p>
            <p className="text-xs text-muted-foreground">
              {[r.position, r.organisation].filter(Boolean).join(', ')}
              {r.relationship ? ` · ${r.relationship}` : ''}
            </p>
            <p className="text-xs text-muted-foreground">{[r.phone, r.email].filter(Boolean).join(' · ')}</p>
          </div>
          <button type="button" onClick={() => setEditing(r)} className="text-xs text-brand inline-flex items-center gap-1"><Pencil className="h-3.5 w-3.5" /> Edit</button>
          <button type="button" onClick={() => void remove(r)} className="text-xs text-muted-foreground hover:text-status-danger inline-flex items-center gap-1"><Trash2 className="h-3.5 w-3.5" /> Remove</button>
        </div>
      ))}

      {editing ? (
        <div className="rounded-lg border border-border p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextField label="Full name" required value={editing.full_name} onChange={set('full_name')} />
            <TextField label="Organisation" value={editing.organisation} onChange={set('organisation')} />
            <TextField label="Position" value={editing.position} onChange={set('position')} />
            <TextField label="Relationship to you" value={editing.relationship} onChange={set('relationship')} placeholder="Former supervisor" />
            <TextField label="Phone number" type="tel" value={editing.phone} onChange={set('phone')} />
            <TextField label="Email" type="email" value={editing.email} onChange={set('email')} hint="A phone number or an email is needed" />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void save()} disabled={busy || Boolean(refereeProblem(editing))}>
              {busy ? 'Saving…' : 'Save referee'}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(emptyReferee())}>
          Add a referee
        </Button>
      )}
    </div>
  );
}
