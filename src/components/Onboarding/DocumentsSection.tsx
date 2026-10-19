import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Eye, FileText, Loader2, Plus, Trash2, UploadCloud } from 'lucide-react';
import { StatusPill } from '../UI';
import {
  ACCEPTED_FILES,
  type ChecklistItem,
  DOCUMENT_STATUS_LABELS,
  type DocumentSection,
  type EmployeeDocument,
  OTHER_DOCUMENT,
  SECTION_TITLES,
  deleteMyDocument,
  documentName,
  extraDocumentTypes,
  isExtraDocument,
  loadChecklist,
  loadDocuments,
  openDocument,
  uploadMyDocument,
} from '../../lib/employeeDocuments';
import FigbloomLoader from '../UI/FigbloomLoader';

import { confirmDialog } from '../../lib/confirmDialog';
// The employee's documents, by section: what is required, what they uploaded and what HR made of each file. Under
// "Other documents" they add anything else (a type they are not asked for, or "Other" with their own title); those
// are never required. Only the employee uploads (HR reviews them in the Onboarding review panel).

const STATUS_TONE = { pending: 'warning', accepted: 'success', rejected: 'danger' } as const;
const SECTIONS: DocumentSection[] = ['core', 'qualifications', 'role', 'claims'];

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

function FileList({ files, onChanged, name }: { files: EmployeeDocument[]; onChanged: () => void; name?: (doc: EmployeeDocument) => string }) {
  const remove = async (doc: EmployeeDocument) => {
    if (!(await confirmDialog({ title: `Remove ${doc.file_name}?`, confirmLabel: 'Remove', tone: 'danger' }))) return;
    try {
      await deleteMyDocument(doc);
      onChanged();
    } catch (err) {
      toast.error(errorText(err, 'The file was not removed.'));
    }
  };

  const view = (doc: EmployeeDocument) => openDocument(doc).catch((err) => toast.error(errorText(err, 'The file could not be opened.')));

  if (files.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1.5">
      {files.map((doc) => (
        <li key={doc.id} className="flex flex-wrap items-center gap-2 text-xs">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          {name && <span className="text-ink font-medium">{name(doc)}</span>}
          <span className="text-ink truncate max-w-[220px]">{doc.file_name}</span>
          <StatusPill label={DOCUMENT_STATUS_LABELS[doc.status]} tone={STATUS_TONE[doc.status]} />
          {doc.status === 'rejected' && doc.review_note && <span className="text-status-danger">“{doc.review_note}”, please upload it again</span>}
          <button type="button" onClick={() => void view(doc)} className="inline-flex items-center gap-1 text-brand"><Eye className="h-3.5 w-3.5" /> View</button>
          {doc.status !== 'accepted' && (
            <button type="button" onClick={() => void remove(doc)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-status-danger">
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          )}
          {doc.description && <span className="basis-full pl-5 text-muted-foreground">{doc.description}</span>}
        </li>
      ))}
    </ul>
  );
}

function DocumentRow({ item, files, employeeId, onChanged }: { item: ChecklistItem; files: EmployeeDocument[]; employeeId: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const live = files.filter((f) => f.status !== 'rejected');
  const canUpload = item.allows_many || live.length === 0;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await uploadMyDocument(employeeId, item.code, file);
      toast.success(`${item.label} uploaded`);
      onChanged();
    } catch (err) {
      toast.error(errorText(err, 'The file was not uploaded.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="py-3 border-b border-border last:border-b-0">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[200px]">
          <p className="text-sm font-medium text-ink">
            {item.label}
            {item.required ? <span className="text-status-danger"> *</span> : <span className="text-xs text-muted-foreground font-normal"> (optional)</span>}
          </p>
          {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
        </div>
        {canUpload && (
          <label className={`inline-flex items-center gap-1.5 text-xs font-semibold text-brand cursor-pointer ${busy ? 'opacity-60' : ''}`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            {live.length > 0 ? 'Add another' : 'Upload'}
            <input type="file" accept={ACCEPTED_FILES} className="hidden" disabled={busy} aria-label={`Upload ${item.label}`}
              onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        )}
      </div>
      <FileList files={files} onChanged={onChanged} />
    </li>
  );
}

// "Other documents": what the employee adds beyond what they are asked for. Never required.
function OtherDocuments({ checklist, files, employeeId, onChanged }: { checklist: ChecklistItem[]; files: EmployeeDocument[]; employeeId: string; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [chosen, setChosen] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  const live = (c: string) => files.some((f) => f.code === c && f.status !== 'rejected');
  // a type that takes one file is offered until it has one
  const types = extraDocumentTypes(checklist).filter((t) => t.allows_many || !live(t.code));
  const isOther = code === OTHER_DOCUMENT;
  const ready = !!code && chosen.length > 0 && (!isOther || title.trim() !== '');

  const reset = () => {
    setAdding(false);
    setCode('');
    setTitle('');
    setDescription('');
    setChosen([]);
  };

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    let done = 0;
    try {
      for (const file of chosen) {
        await uploadMyDocument(employeeId, code, file, isOther ? { title, description } : { description });
        done += 1;
      }
      toast.success(done === 1 ? 'Document uploaded' : `${done} documents uploaded`);
      reset();
    } catch (err) {
      toast.error(errorText(err, 'The file was not uploaded.'));
    } finally {
      setBusy(false);
      if (done > 0) onChanged();
    }
  };

  const name = (doc: EmployeeDocument) => documentName(doc, checklist);
  const inputClass = 'w-full rounded-lg border border-border px-2 py-1.5 text-sm';

  return (
    <section>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{SECTION_TITLES.other}</h4>
      <p className="text-xs text-muted-foreground mt-0.5">Certificates, licences or anything else you want HR to have. These are optional.</p>
      <FileList files={files} onChanged={onChanged} name={name} />
      {!adding ? (
        <button type="button" onClick={() => setAdding(true)} className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-brand">
          <Plus className="h-4 w-4" /> Add a document
        </button>
      ) : (
        <div className="mt-3 space-y-2 rounded-lg border border-border p-3" role="group" aria-label="Add a document">
          <label className="block text-xs font-medium text-ink">
            What is it?
            <select value={code} onChange={(e) => setCode(e.target.value)} className={`${inputClass} mt-1`} aria-label="Document type">
              <option value="">Choose…</option>
              {types.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
              <option value={OTHER_DOCUMENT}>Other (give it a title)</option>
            </select>
          </label>
          {isOther && (
            <label className="block text-xs font-medium text-ink">
              Title <span className="text-status-danger">*</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. First Aid certificate" className={`${inputClass} mt-1`} aria-label="Title" />
            </label>
          )}
          {code && (
            <label className="block text-xs font-medium text-ink">
              Description <span className="text-muted-foreground font-normal">(optional)</span>
              <input value={description} onChange={(e) => setDescription(e.target.value)} className={`${inputClass} mt-1`} aria-label="Description" />
            </label>
          )}
          <label className="block text-xs font-medium text-ink">
            Files
            <input type="file" multiple accept={ACCEPTED_FILES} className="mt-1 block text-xs" aria-label="Choose files" disabled={busy}
              onChange={(e) => setChosen(Array.from(e.target.files ?? []))} />
          </label>
          {isOther && !title.trim() && <p className="text-xs text-muted-foreground">Give the document a title.</p>}
          <div className="flex gap-3">
            <button type="button" disabled={!ready || busy} onClick={() => void submit()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />} Upload
            </button>
            <button type="button" onClick={reset} disabled={busy} className="text-xs text-muted-foreground">Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}

export default function DocumentsSection({ employeeId, onChanged }: { employeeId: string; onChanged?: () => void }) {
  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null);
  const [files, setFiles] = useState<EmployeeDocument[]>([]);

  const load = useCallback(async () => {
    try {
      const [c, f] = await Promise.all([loadChecklist(), loadDocuments(employeeId)]);
      setChecklist(c);
      setFiles(f);
    } catch (err) {
      setChecklist([]);
      toast.error(errorText(err, 'Could not load your documents.'));
    }
  }, [employeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = () => {
    void load();
    onChanged?.();
  };

  if (!checklist) return <FigbloomLoader label="Loading documents" size={48} />;

  return (
    <div className="space-y-5">
      {SECTIONS.map((section) => {
        // what this employee is asked for; anything else is added under "Other documents"
        const items = checklist.filter((i) => i.section === section && i.required);
        if (items.length === 0) return null;
        return (
          <section key={section}>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{SECTION_TITLES[section]}</h4>
            <ul>
              {items.map((item) => (
                <DocumentRow key={item.code} item={item} files={files.filter((f) => f.code === item.code)} employeeId={employeeId} onChanged={changed} />
              ))}
            </ul>
          </section>
        );
      })}
      <OtherDocuments checklist={checklist} files={files.filter((f) => isExtraDocument(f, checklist))} employeeId={employeeId} onChanged={changed} />
      <p className="text-xs text-muted-foreground">PDF, Word or photos, up to 10 MB each. HR reviews every file.</p>
    </div>
  );
}
