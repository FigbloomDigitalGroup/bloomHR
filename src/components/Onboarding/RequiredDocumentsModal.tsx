import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, X } from 'lucide-react';
import {
  type CompanyDocumentType,
  type DocumentSection,
  type DocumentTypeSetting,
  type FileMode,
  SECTION_TITLES,
  loadCompanyDocumentSettings,
  removeCompanyDocumentType,
  saveCompanyDocumentType,
  setCompanyDocumentRequired,
  setDocumentFilesSetting,
} from '../../lib/employeeDocuments';
import { confirmDialog } from '../../lib/confirmDialog';
import FigbloomLoader from '../UI/FigbloomLoader';

// Which documents every employee of the company must provide, how many files each takes (one file, named slots such
// as Front and Back, or many labelled files), and the company's own document types. Role-specific ones can also be
// asked of one employee in their review panel; tax-claim documents are required whenever the employee makes the claim.

const SECTIONS: DocumentSection[] = ['core', 'qualifications', 'role'];
const COUNTRIES = ['Kenya', 'Tanzania', 'Uganda'];
const MODE_LABELS: Record<FileMode, string> = { single: 'One file', slots: 'Named slots', many: 'Many files' };
const MODES = Object.keys(MODE_LABELS) as FileMode[];
const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);
const splitSlots = (text: string) => text.split(',').map((s) => s.trim()).filter(Boolean);

/** Default slots in words: a list, or a list per identity type ("Front, Back (passport: Bio page)"). */
const describeSlots = (def: unknown): string => {
  if (Array.isArray(def)) return def.join(', ');
  if (def && typeof def === 'object') {
    const byType = def as Record<string, string[]>;
    const passport = byType['Passport Number'];
    return `${(byType['*'] ?? []).join(', ')}${passport ? ` (passport: ${passport.join(', ')})` : ''}`;
  }
  return '';
};

// a type's files setting: the company's own, else the default
function FilesSetting({ t, onSaved }: { t: DocumentTypeSetting; onSaved: () => void }) {
  const saved: FileMode = t.file_mode ?? t.default_file_mode ?? 'single';
  const [mode, setMode] = useState<FileMode>(saved);
  const [slotText, setSlotText] = useState((t.slots ?? (Array.isArray(t.default_slots) ? (t.default_slots as string[]) : [])).join(', '));
  const [busy, setBusy] = useState(false);
  const defaultSlots = !t.slots && t.default_file_mode === 'slots';

  const save = async (next: FileMode | null, slots?: string[]) => {
    setBusy(true);
    try {
      await setDocumentFilesSetting(t.code, next, slots);
      onSaved();
    } catch (err) {
      setMode(saved);
      toast.error(errorText(err, 'The setting was not saved.'));
    } finally {
      setBusy(false);
    }
  };

  const choose = (next: FileMode) => {
    setMode(next);
    if (next === t.default_file_mode && next !== 'slots') void save(null);
    else if (next === 'slots' && t.default_file_mode === 'slots') void save(null); // the default slots
    else if (next !== 'slots') void save(next);
    // named slots of its own: saved with "Save slots"
  };

  return (
    <div className="ml-6 mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <label className="inline-flex items-center gap-1">
        Files
        <select value={mode} disabled={busy} onChange={(e) => choose(e.target.value as FileMode)} aria-label={`Files for ${t.label}`}
          className="rounded border border-border px-1 py-0.5 text-xs text-ink">
          {MODES.map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
        </select>
      </label>
      {mode === 'slots' && (
        <>
          {defaultSlots && !Array.isArray(t.default_slots) && <span>Default: {describeSlots(t.default_slots)}.</span>}
          <input value={slotText} onChange={(e) => setSlotText(e.target.value)} placeholder="e.g. Front, Back" aria-label={`Slots for ${t.label}`}
            className="min-w-[160px] flex-1 rounded border border-border px-1.5 py-0.5 text-xs text-ink" />
          <button type="button" disabled={busy || !splitSlots(slotText).length} onClick={() => void save('slots', splitSlots(slotText))} aria-label={`Save slots for ${t.label}`}
            className="font-semibold text-brand disabled:opacity-50">Save slots</button>
        </>
      )}
      {t.file_mode && <button type="button" disabled={busy} onClick={() => void save(null)} className="underline">Use the default</button>}
    </div>
  );
}

const emptyType = (): CompanyDocumentType => ({ label: '', description: '', section: 'core', countries: [], required: true, file_mode: 'single', slots: [] });

function NewDocumentType({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [t, setT] = useState<CompanyDocumentType>(emptyType);
  const [slotText, setSlotText] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof CompanyDocumentType>(k: K, v: CompanyDocumentType[K]) => setT((x) => ({ ...x, [k]: v }));
  const ready = t.label.trim() !== '' && (t.file_mode !== 'slots' || splitSlots(slotText).length > 0);
  const input = 'w-full rounded-lg border border-border px-2 py-1.5 text-sm mt-1';

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      await saveCompanyDocumentType({ ...t, slots: splitSlots(slotText) });
      toast.success(`${t.label.trim()} added`);
      onSaved();
    } catch (err) {
      toast.error(errorText(err, 'The document type was not saved.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-border p-3" role="group" aria-label="New document type">
      <label className="block text-xs font-medium text-ink">Name <span className="text-status-danger">*</span>
        <input value={t.label} onChange={(e) => set('label', e.target.value)} placeholder="e.g. Firearm licence" className={input} aria-label="Name" />
      </label>
      <label className="block text-xs font-medium text-ink">Description <span className="font-normal text-muted-foreground">(optional)</span>
        <input value={t.description} onChange={(e) => set('description', e.target.value)} className={input} aria-label="Description" />
      </label>
      <div className="flex flex-wrap gap-3">
        <label className="text-xs font-medium text-ink">Section
          <select value={t.section} onChange={(e) => set('section', e.target.value as CompanyDocumentType['section'])} className={input} aria-label="Section">
            {SECTIONS.map((s) => <option key={s} value={s}>{SECTION_TITLES[s]}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-ink">Files
          <select value={t.file_mode} onChange={(e) => set('file_mode', e.target.value as FileMode)} className={input} aria-label="How many files">
            {MODES.map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
          </select>
        </label>
      </div>
      {t.file_mode === 'slots' && (
        <label className="block text-xs font-medium text-ink">Slot names, separated by commas <span className="text-status-danger">*</span>
          <input value={slotText} onChange={(e) => setSlotText(e.target.value)} placeholder="e.g. Certificate, Practising licence" className={input} aria-label="Slot names" />
        </label>
      )}
      <fieldset className="text-xs text-ink">
        <legend className="font-medium">Countries <span className="font-normal text-muted-foreground">(none ticked: every country)</span></legend>
        <div className="mt-1 flex gap-4">
          {COUNTRIES.map((c) => (
            <label key={c} className="inline-flex items-center gap-1">
              <input type="checkbox" checked={t.countries.includes(c)}
                onChange={(e) => set('countries', e.target.checked ? [...t.countries, c] : t.countries.filter((x) => x !== c))} />
              {c}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="inline-flex items-center gap-2 text-xs text-ink">
        <input type="checkbox" checked={t.required} onChange={(e) => set('required', e.target.checked)} /> Required of every employee
      </label>
      <div className="flex gap-3">
        <button type="button" disabled={!ready || busy} onClick={() => void save()}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Save document type</button>
        <button type="button" disabled={busy} onClick={onCancel} className="text-xs text-muted-foreground">Cancel</button>
      </div>
    </div>
  );
}

export default function RequiredDocumentsModal({ onClose }: { onClose: () => void }) {
  const [types, setTypes] = useState<DocumentTypeSetting[] | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    loadCompanyDocumentSettings().then(setTypes, (err) => {
      setTypes([]);
      toast.error(errorText(err, 'Could not load the settings.'));
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (t: DocumentTypeSetting, required: boolean) => {
    setTypes((ts) => ts?.map((x) => (x.code === t.code ? { ...x, required } : x)) ?? ts);
    try {
      await setCompanyDocumentRequired(t.code, required);
    } catch (err) {
      setTypes((ts) => ts?.map((x) => (x.code === t.code ? t : x)) ?? ts);
      toast.error(errorText(err, 'The setting was not saved.'));
    }
  };

  const remove = async (t: DocumentTypeSetting) => {
    if (!(await confirmDialog({ title: `Remove ${t.label}?`, confirmLabel: 'Remove', tone: 'danger' }))) return;
    try {
      const result = await removeCompanyDocumentType(t.code);
      toast.success(result === 'deactivated' ? `${t.label} switched off; the files already uploaded stay` : `${t.label} removed`);
      load();
    } catch (err) {
      toast.error(errorText(err, 'The document type was not removed.'));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto" role="dialog" aria-label="Required documents">
      <div className="bg-white rounded-[10px] border border-border shadow-lg w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Required documents</h2>
            <p className="text-xs text-muted-foreground">What every employee must upload, and how many files each document takes.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-muted-foreground hover:text-ink"><X className="h-4 w-4" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {!types && <FigbloomLoader label="Loading" size={48} />}
          {types && SECTIONS.map((section) => (
            <section key={section}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{SECTION_TITLES[section]}</h3>
              <ul>
                {types.filter((t) => t.section === section).map((t) => (
                  <li key={t.code} className="border-b border-border/50 last:border-b-0">
                    <div className="flex items-center gap-2 py-1">
                      <label className="flex flex-1 items-center gap-2 text-sm text-ink">
                        <input type="checkbox" checked={t.required ?? t.required_by_default} onChange={(e) => void toggle(t, e.target.checked)} />
                        {t.label}
                        {t.custom && <span className="text-xs text-muted-foreground">(your company’s)</span>}
                        {t.countries?.length ? <span className="text-xs text-muted-foreground">({t.countries.join(', ')} only)</span> : null}
                      </label>
                      {t.custom && (
                        <button type="button" onClick={() => void remove(t)} aria-label={`Remove ${t.label}`} className="p-1 text-muted-foreground hover:text-status-danger">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <FilesSetting key={`${t.code}-${t.file_mode ?? ''}-${(t.slots ?? []).join('|')}`} t={t} onSaved={load} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {types && (adding ? (
            <NewDocumentType onSaved={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand">
              <Plus className="h-4 w-4" /> Add a document type
            </button>
          ))}
          <p className="text-xs text-muted-foreground">
            One file: a split scan can still be uploaded as extra pages. Named slots: each slot (e.g. Front and Back) is
            uploaded once, and the document is complete when all are in. Many files: each file gets a label. Removing your
            own document type switches it off instead when employees have uploaded it. The KRA PWD exemption certificate,
            mortgage interest statement and insurance policy are asked for automatically when an employee claims them, and
            the HESLB letter for Tanzania HESLB loan holders. Each employee is only asked for the documents of their
            branch's country, and can add other documents themselves.
          </p>
        </div>
      </div>
    </div>
  );
}
