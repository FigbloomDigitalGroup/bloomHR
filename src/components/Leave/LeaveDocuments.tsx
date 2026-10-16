import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { FileText, Upload } from 'lucide-react';
import {
  DocumentKind,
  LeaveDocumentRule,
  LeaveWithDocuments,
  attachLeaveDocument,
  leaveDocuments,
  openLeaveDocument,
} from '../../lib/leaveDocuments';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * A leave application's documents (FIG-876): each one its leave type asks for, or that was added, with a link to open
 * it, or (for the employee whose leave it is, and HR) a button to add it. Missing past its last day shows as overdue.
 */
export default function LeaveDocuments({
  app,
  rule,
  canAdd,
  onChanged,
}: {
  app: LeaveWithDocuments;
  rule: LeaveDocumentRule | undefined;
  canAdd: boolean;
  onChanged?: () => void;
}) {
  const docs = leaveDocuments(app, rule, today());
  const input = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState<DocumentKind | null>(null);
  const [busy, setBusy] = useState(false);

  if (!docs.length) return <span className="text-xs text-gray-400">-</span>;

  const open = async (path: string) => {
    try {
      await openLeaveDocument(path);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const add = async (file: File | undefined) => {
    if (!file || !adding) return;
    setBusy(true);
    try {
      await attachLeaveDocument(app.id, adding, file);
      toast.success('Document added');
      onChanged?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setAdding(null);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="flex flex-col gap-1">
      {docs.map((d) => (
        <div key={d.kind} className="flex flex-wrap items-center gap-1.5 text-xs">
          {d.path ? (
            <button type="button" onClick={() => void open(d.path as string)} className="inline-flex items-center gap-1 text-brand hover:underline" title={d.fileName || undefined}>
              <FileText className="w-3 h-3" aria-hidden />
              {d.label}
            </button>
          ) : (
            <>
              <span className={d.overdue ? 'text-red-600 font-medium' : 'text-gray-600'}>
                {d.label}: {d.overdue ? 'missing' : d.due ? `due by ${new Date(`${d.due}T00:00:00`).toLocaleDateString()}` : 'not added'}
              </span>
              {canAdd && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setAdding(d.kind);
                    input.current?.click();
                  }}
                  className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-primary hover:bg-primary/20 disabled:opacity-50"
                >
                  <Upload className="w-3 h-3" aria-hidden />
                  {busy && adding === d.kind ? 'Adding...' : 'Add'}
                </button>
              )}
            </>
          )}
        </div>
      ))}
      <input
        ref={input}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
        className="hidden"
        aria-label="Choose the document"
        onChange={(e) => void add(e.target.files?.[0])}
      />
    </div>
  );
}
