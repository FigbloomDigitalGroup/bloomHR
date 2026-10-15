import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import Modal from './Modal';
import { answerDialog, subscribeDialogs, type OpenDialog } from '../../lib/confirmDialog';

// Shows the dialogs asked for with confirmDialog() and noticeDialog() (lib/confirmDialog), one at a time.
// Mounted once at the app's root.

const button =
  'inline-flex items-center justify-center px-4 py-2 rounded-tile text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40';

export default function DialogHost() {
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  useEffect(() => subscribeDialogs(setDialog), []);

  if (!dialog) return null;
  const danger = dialog.tone === 'danger';

  return (
    <Modal open onClose={() => answerDialog(false)} title={dialog.title || (dialog.notice ? 'Notice' : 'Are you sure?')} size="sm">
      <div className="space-y-5">
        {dialog.message && (
          <div className="flex gap-3 text-sm text-muted-foreground whitespace-pre-line">
            {danger && <AlertTriangle className="w-5 h-5 text-status-danger shrink-0 mt-0.5" aria-hidden />}
            <div className="min-w-0">{dialog.message}</div>
          </div>
        )}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          {!dialog.notice && (
            <button type="button" className={`${button} border border-border bg-white text-ink hover:bg-secondary`} onClick={() => answerDialog(false)}>
              {dialog.cancelLabel || 'Cancel'}
            </button>
          )}
          <button
            type="button"
            autoFocus
            className={`${button} text-white ${danger ? 'bg-status-danger hover:opacity-90' : 'bg-brand hover:bg-brand-dark'}`}
            onClick={() => answerDialog(true)}
          >
            {dialog.confirmLabel || (dialog.notice ? 'OK' : 'Confirm')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
