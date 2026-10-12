import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Eye, FileText, Loader2, Trash2, UploadCloud } from 'lucide-react';
import { StatusPill } from '../UI';
import {
  ACCEPTED_FILES,
  type ChecklistItem,
  DOCUMENT_STATUS_LABELS,
  type DocumentSection,
  type EmployeeDocument,
  SECTION_TITLES,
  deleteMyDocument,
  loadChecklist,
  loadDocuments,
  openDocument,
  uploadMyDocument,
} from '../../lib/employeeDocuments';

// The employee's documents, by section: what is required, what they uploaded and what HR made of each file.
// Only the employee uploads (HR reviews them in the Onboarding review panel).

const STATUS_TONE = { pending: 'warning', accepted: 'success', rejected: 'danger' } as const;
const SECTIONS: DocumentSection[] = ['core', 'qualifications', 'role', 'claims'];

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

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

  const remove = async (doc: EmployeeDocument) => {
    if (!window.confirm(`Remove ${doc.file_name}?`)) return;
    try {
      await deleteMyDocument(doc);
      onChanged();
    } catch (err) {
      toast.error(errorText(err, 'The file was not removed.'));
    }
  };

  const view = (doc: EmployeeDocument) => openDocument(doc).catch((err) => toast.error(errorText(err, 'The file could not be opened.')));

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
      {files.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {files.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center gap-2 text-xs">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-ink truncate max-w-[220px]">{doc.file_name}</span>
              <StatusPill label={DOCUMENT_STATUS_LABELS[doc.status]} tone={STATUS_TONE[doc.status]} />
              {doc.status === 'rejected' && doc.review_note && <span className="text-status-danger">“{doc.review_note}”, please upload it again</span>}
              <button type="button" onClick={() => void view(doc)} className="inline-flex items-center gap-1 text-brand"><Eye className="h-3.5 w-3.5" /> View</button>
              {doc.status !== 'accepted' && (
                <button type="button" onClick={() => void remove(doc)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-status-danger">
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
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

  if (!checklist) return <Loader2 className="h-5 w-5 animate-spin text-brand" aria-label="Loading documents" />;

  return (
    <div className="space-y-5">
      {SECTIONS.map((section) => {
        // claim documents only while the claim is made; everything else is listed, required or optional
        const items = checklist.filter((i) => i.section === section && (section !== 'claims' || i.required));
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
      <p className="text-xs text-muted-foreground">PDF, Word or photos, up to 10 MB each. HR reviews every file.</p>
    </div>
  );
}
