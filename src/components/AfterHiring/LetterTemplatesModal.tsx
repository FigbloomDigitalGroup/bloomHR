import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button, Modal, StatusPill } from '../UI';
import { Field, inputClass } from './OfferEditor';
import { type OfferTemplate, unknownPlaceholders } from '../../lib/offers';
import { confirmDialog } from '../../lib/confirmDialog';
import { LoaderBlock } from '../UI/FigbloomLoader';

// A company's letter templates (offer letters, exit letters, ...): a title and a body with placeholders. The default one
// starts every new letter.

export type LetterTemplate = OfferTemplate;
type Draft = Pick<LetterTemplate, 'title' | 'body' | 'is_default' | 'active'> & { id: string | null };

export interface LetterTemplatesModalProps {
  heading: string;
  placeholders: { key: string; label: string }[];
  /** the title a new template starts with */
  newTitle: string;
  /** what the default checkbox says, e.g. "Use for new offers (default)" */
  defaultLabel: string;
  load: () => Promise<LetterTemplate[]>;
  save: (id: string | null, t: Pick<LetterTemplate, 'title' | 'body' | 'is_default' | 'active'>) => Promise<unknown>;
  remove: (id: string) => Promise<void>;
  /** what happens to letters already written when a template is deleted */
  deleteNote: string;
  onClose: () => void;
}

export default function LetterTemplatesModal({ heading, placeholders, newTitle, defaultLabel, load, save, remove, deleteNote, onClose }: LetterTemplatesModalProps) {
  const [templates, setTemplates] = useState<LetterTemplate[] | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => load().then(setTemplates, (err) => toast.error((err as Error).message));
  useEffect(() => {
    void reload();
    // load once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveDraft = async () => {
    if (!editing) return;
    if (!editing.title.trim() || !editing.body.trim()) {
      toast.error('Give the template a title and text');
      return;
    }
    setBusy(true);
    try {
      await save(editing.id, editing);
      toast.success('Template saved');
      setEditing(null);
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeTemplate = async (t: LetterTemplate) => {
    if (!(await confirmDialog({ title: `Delete the template “${t.title}”?`, message: deleteNote, confirmLabel: 'Delete', tone: 'danger' }))) return;
    try {
      await remove(t.id);
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const unknown = editing ? unknownPlaceholders(`${editing.title}\n${editing.body}`, placeholders) : [];

  return (
    <Modal open onClose={onClose} title={heading} size="3xl">
      {editing ? (
        <div className="space-y-3 mt-3">
          <Field label="Title">
            <input className={inputClass} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
          </Field>
          <Field label="Text">
            <textarea className={`${inputClass} font-mono text-[12.5px]`} rows={14} value={editing.body} aria-label="Template text"
              onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
          </Field>
          <p className="text-xs text-muted-foreground">
            Placeholders: {placeholders.map((p) => `{{${p.key}}}`).join(' ')}
          </p>
          {unknown.length > 0 && <p className="text-xs text-orange-text-alt">Not a known placeholder: {unknown.map((k) => `{{${k}}}`).join(', ')}</p>}
          <div className="flex flex-wrap gap-4 text-sm text-ink">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={editing.is_default} onChange={(e) => setEditing({ ...editing, is_default: e.target.checked })} />
              {defaultLabel}
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
              Active
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void saveDraft()} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>Save template</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2 mt-3">
          {templates === null && <LoaderBlock label="Loading templates" compact />}
          {templates?.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
              <p className="flex-1 min-w-[160px] text-sm font-medium text-ink">{t.title}</p>
              {t.is_default && <StatusPill label="Default" tone="success" />}
              {!t.active && <StatusPill label="Inactive" />}
              <Button variant="secondary" onClick={() => setEditing({ ...t })}>Edit</Button>
              <Button variant="ghost" aria-label={`Delete ${t.title}`} onClick={() => void removeTemplate(t)} icon={<Trash2 className="h-4 w-4" />}>{''}</Button>
            </div>
          ))}
          <div className="flex justify-end pt-2">
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ id: null, title: newTitle, body: '', is_default: false, active: true })}>
              New template
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
