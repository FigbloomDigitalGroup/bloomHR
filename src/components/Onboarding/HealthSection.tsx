import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Eye, FileText, Pencil, Plus, ShieldCheck, Trash2, UploadCloud } from 'lucide-react';
import { Button } from '../UI';
import { Field, SelectField, TextField } from './Fields';
import { ACCEPTED_FILES } from '../../lib/employeeDocuments';
import {
  CONSENT_TEXT,
  HEALTH_KIND_LABELS,
  type HealthInfo,
  type HealthKind,
  type HealthRecord,
  deleteHealthFile,
  deleteHealthRecord,
  emptyHealthRecord,
  giveHealthConsent,
  healthRecordProblem,
  loadHealth,
  openHealthFile,
  saveHealthRecord,
  uploadHealthFile,
  withdrawHealthConsent,
} from '../../lib/employeeHealth';
import FigbloomLoader from '../UI/FigbloomLoader';

import { confirmDialog } from '../../lib/confirmDialog';
// The employee's health information: optional, after consent. Medical conditions and disability / accommodation
// needs, with supporting documents from medical institutions.

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);
const KIND_OPTIONS = Object.values(HEALTH_KIND_LABELS);
const kindFromLabel = (label: string) => (Object.keys(HEALTH_KIND_LABELS) as HealthKind[]).find((k) => HEALTH_KIND_LABELS[k] === label) ?? 'condition';

export default function HealthSection({ employeeId }: { employeeId: string }) {
  const [info, setInfo] = useState<HealthInfo | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [editing, setEditing] = useState<HealthRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setInfo(await loadHealth(employeeId));
    } catch (err) {
      toast.error(errorText(err, 'Could not load your health information.'));
    }
  }, [employeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast.success(done);
      await load();
    } catch (err) {
      toast.error(errorText(err, 'That did not work.'));
    } finally {
      setBusy(false);
    }
  };

  if (!info) return <FigbloomLoader label="Loading health information" size={48} />;

  if (!info.consent_given_at) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-ink">
          You can tell us about a medical condition (for example diabetes or asthma) or a disability or need we should
          accommodate, with documents from your doctor or hospital. This is optional.
        </p>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>{CONSENT_TEXT}</span>
        </label>
        <Button variant="secondary" icon={<ShieldCheck className="h-4 w-4" />} disabled={!agreed || busy}
          onClick={() => void act(() => giveHealthConsent(employeeId), 'Consent saved')}>
          I consent, add health information
        </Button>
      </div>
    );
  }

  const set = (key: keyof HealthRecord) => (v: string) => setEditing((e) => (e ? { ...e, [key]: v } : e));

  return (
    <div className="space-y-3">
      {info.records.length === 0 && !editing && <p className="text-sm text-muted-foreground">Nothing added yet.</p>}
      {info.records.map((r) => (
        <div key={r.id} className="rounded-lg border border-border px-3 py-2">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex-1 min-w-[200px] text-sm">
              <p className="font-medium text-ink">{r.title} <span className="text-xs text-muted-foreground font-normal">· {HEALTH_KIND_LABELS[r.kind]}</span></p>
              <p className="text-xs text-muted-foreground">{[r.institution, r.diagnosed_on].filter(Boolean).join(' · ')}</p>
              {r.details && <p className="text-xs text-ink mt-1">{r.details}</p>}
            </div>
            <label className="text-xs text-brand inline-flex items-center gap-1 cursor-pointer">
              <UploadCloud className="h-3.5 w-3.5" /> Add document
              <input type="file" accept={ACCEPTED_FILES} className="hidden" aria-label={`Add a document for ${r.title}`} disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f && r.id) void act(() => uploadHealthFile(r.id as string, f), 'Document uploaded'); }} />
            </label>
            <button type="button" onClick={() => setEditing(r)} className="text-xs text-brand inline-flex items-center gap-1"><Pencil className="h-3.5 w-3.5" /> Edit</button>
            <button type="button" onClick={async () => { if (await confirmDialog({ title: `Delete ${r.title} and its documents?`, confirmLabel: 'Delete', tone: 'danger' })) void act(() => deleteHealthRecord(r)); }}
              className="text-xs text-muted-foreground hover:text-status-danger inline-flex items-center gap-1"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
          </div>
          {(r.files ?? []).length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {(r.files ?? []).map((f) => (
                <li key={f.id} className="flex items-center gap-2 text-xs">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-ink truncate max-w-[220px]">{f.file_name}</span>
                  <button type="button" className="inline-flex items-center gap-1 text-brand"
                    onClick={() => openHealthFile(f).catch((err) => toast.error(errorText(err, 'The document could not be opened.')))}>
                    <Eye className="h-3.5 w-3.5" /> View
                  </button>
                  <button type="button" className="text-muted-foreground hover:text-status-danger" onClick={() => void act(() => deleteHealthFile(f))}>Remove</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {editing ? (
        <div className="rounded-lg border border-border p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SelectField label="Type" required value={HEALTH_KIND_LABELS[editing.kind]} options={KIND_OPTIONS}
              onChange={(v) => setEditing((e) => (e ? { ...e, kind: kindFromLabel(v) } : e))} />
            <TextField label={editing.kind === 'condition' ? 'Condition' : 'Need'} required value={editing.title} onChange={set('title')}
              placeholder={editing.kind === 'condition' ? 'Asthma' : 'Ground-floor workstation'} />
            <TextField label="Medical institution" value={editing.institution} onChange={set('institution')} placeholder="Hospital or clinic" />
            <TextField label="Date diagnosed" type="date" value={editing.diagnosed_on} onChange={set('diagnosed_on')} />
          </div>
          <Field label="Details (what we should know, e.g. medication or what to do in an emergency)">
            <textarea value={editing.details} onChange={(e) => set('details')(e.target.value)} rows={3}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
          </Field>
          <div className="flex gap-2">
            <Button disabled={busy || Boolean(healthRecordProblem(editing))}
              onClick={() => void act(async () => { await saveHealthRecord(employeeId, editing); setEditing(null); }, 'Saved')}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
          {!editing.id && <p className="text-xs text-muted-foreground">Save first, then add documents from your doctor or hospital.</p>}
        </div>
      ) : (
        <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(emptyHealthRecord())}>
          Add health information
        </Button>
      )}

      <p className="text-xs text-muted-foreground">
        You consented on {new Date(info.consent_given_at).toLocaleDateString('en-KE', { dateStyle: 'medium' })}.{' '}
        <button type="button" className="underline hover:text-status-danger" disabled={busy}
          onClick={async () => {
            if (await confirmDialog({ title: 'Withdraw your consent?', message: 'All your health information and documents will be deleted.', confirmLabel: 'Withdraw consent', tone: 'danger' })) {
              void act(() => withdrawHealthConsent(employeeId, info), 'Your health information was deleted');
            }
          }}>
          Withdraw consent and delete it
        </button>
      </p>
    </div>
  );
}
