import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button, Modal, StatusPill } from '../UI';
import { Field, inputClass } from './OfferEditor';
import {
  OFFER_PLACEHOLDERS,
  type OfferTemplate,
  deleteOfferTemplate,
  loadOfferTemplates,
  saveOfferTemplate,
  unknownPlaceholders,
} from '../../lib/offers';

// The company's offer letter templates: a title and a body with placeholders. The default one starts every new offer.

type Draft = Pick<OfferTemplate, 'title' | 'body' | 'is_default' | 'active'> & { id: string | null };

export default function OfferTemplatesModal({ onClose }: { onClose: () => void }) {
  const [templates, setTemplates] = useState<OfferTemplate[] | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => loadOfferTemplates().then(setTemplates, (err) => toast.error((err as Error).message));
  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    if (!editing) return;
    if (!editing.title.trim() || !editing.body.trim()) {
      toast.error('Give the template a title and text');
      return;
    }
    setBusy(true);
    try {
      await saveOfferTemplate(editing.id, editing);
      toast.success('Template saved');
      setEditing(null);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t: OfferTemplate) => {
    if (!window.confirm(`Delete the template “${t.title}”? Offers already written keep their text.`)) return;
    try {
      await deleteOfferTemplate(t.id);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const unknown = editing ? unknownPlaceholders(`${editing.title}\n${editing.body}`) : [];

  return (
    <Modal open onClose={onClose} title="Offer letter templates" size="3xl">
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
            Placeholders: {OFFER_PLACEHOLDERS.map((p) => `{{${p.key}}}`).join(' ')}
          </p>
          {unknown.length > 0 && <p className="text-xs text-orange-text-alt">Not a known placeholder: {unknown.map((k) => `{{${k}}}`).join(', ')}</p>}
          <div className="flex flex-wrap gap-4 text-sm text-ink">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={editing.is_default} onChange={(e) => setEditing({ ...editing, is_default: e.target.checked })} />
              Use for new offers (default)
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
              Active
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void save()} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}>Save template</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2 mt-3">
          {templates === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {templates?.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
              <p className="flex-1 min-w-[160px] text-sm font-medium text-ink">{t.title}</p>
              {t.is_default && <StatusPill label="Default" tone="success" />}
              {!t.active && <StatusPill label="Inactive" />}
              <Button variant="secondary" onClick={() => setEditing({ ...t })}>Edit</Button>
              <Button variant="ghost" aria-label={`Delete ${t.title}`} onClick={() => void remove(t)} icon={<Trash2 className="h-4 w-4" />}>{''}</Button>
            </div>
          ))}
          <div className="flex justify-end pt-2">
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ id: null, title: 'Offer of employment', body: '', is_default: false, active: true })}>
              New template
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
