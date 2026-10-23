import { useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, Download, Forward, MailOpen, Paperclip, Reply, ReplyAll, Star, Trash2 } from 'lucide-react';
import { Button } from '../../UI';
import { downloadAttachment, type MailAttachment, type MailFolder, type MailMessage, type MailPerson } from '../../../lib/mailboxApi';
import { fileSize } from '../../../lib/mailCompose';
import MailBody from './MailBody';

const personLabel = (p: MailPerson) => (p.name ? `${p.name} <${p.address}>` : p.address);
const people = (list: MailPerson[]) => list.map(personLabel).join(', ');

export type ReplyMode = 'reply' | 'replyAll' | 'forward';

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-[12px] min-w-0">
      <span className="w-12 shrink-0 text-muted-foreground">{label}</span>
      <span className="text-ink break-words min-w-0">{value}</span>
    </div>
  );
}

/** What can be done to the open email (PR 3): flag, mark unread, move, delete. */
export interface ReaderActions {
  onToggleFlag: () => void;
  onMarkUnread: () => void;
  onDelete: () => void;
  /** the folders it can be moved to (not the one it's in) */
  moveTargets: MailFolder[];
  onMove: (to: string) => void;
  busy?: boolean;
}

/**
 * The reading pane: who, when, the subject, the attachments to download, the body, Reply / Reply all / Forward, and
 * flag, mark unread, move and delete.
 */
export default function MailReader({
  message,
  onBack,
  onRespond,
  actions,
}: {
  message: MailMessage;
  onBack?: () => void;
  onRespond?: (mode: ReplyMode) => void;
  actions?: ReaderActions;
}) {
  const [downloading, setDownloading] = useState('');

  const download = async (a: MailAttachment) => {
    setDownloading(a.part);
    try {
      await downloadAttachment(message.folder, message.uid, a);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDownloading('');
    }
  };

  return (
    <article className="flex flex-col h-full min-h-0">
      {onBack && (
        <div className="mb-3 md:hidden">
          <Button variant="ghost" icon={<ArrowLeft className="w-4 h-4" />} onClick={onBack}>
            Back to messages
          </Button>
        </div>
      )}
      <div className="flex items-start gap-2">
        <h2 className="flex-1 min-w-0 text-[16px] font-bold text-ink break-words">{message.subject || '(no subject)'}</h2>
        {actions && (
          <button
            type="button"
            onClick={actions.onToggleFlag}
            disabled={actions.busy}
            aria-pressed={message.flagged}
            aria-label={message.flagged ? 'Unflag' : 'Flag'}
            title={message.flagged ? 'Unflag' : 'Flag'}
            className="shrink-0 p-1 rounded-tile hover:bg-secondary disabled:opacity-50"
          >
            <Star className={`w-4 h-4 ${message.flagged ? 'fill-current text-status-warning' : 'text-muted-foreground'}`} aria-hidden />
          </button>
        )}
      </div>
      <div className="mt-2 space-y-0.5">
        <Row label="From" value={people(message.from)} />
        <Row label="To" value={people(message.to)} />
        <Row label="Cc" value={people(message.cc)} />
        <Row label="Date" value={message.date ? new Date(message.date).toLocaleString() : ''} />
      </div>
      {onRespond && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Reply className="w-4 h-4" />} onClick={() => onRespond('reply')}>
            Reply
          </Button>
          <Button variant="secondary" icon={<ReplyAll className="w-4 h-4" />} onClick={() => onRespond('replyAll')}>
            Reply all
          </Button>
          <Button variant="secondary" icon={<Forward className="w-4 h-4" />} onClick={() => onRespond('forward')}>
            Forward
          </Button>
        </div>
      )}
      {actions && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button variant="ghost" icon={<MailOpen className="w-4 h-4" />} onClick={actions.onMarkUnread} disabled={actions.busy}>
            Mark unread
          </Button>
          {actions.moveTargets.length > 0 && (
            <select
              className="rounded-tile border border-border bg-white px-2 py-1.5 text-[12px] text-ink"
              aria-label="Move this email to"
              value=""
              disabled={actions.busy}
              onChange={(e) => e.target.value && actions.onMove(e.target.value)}
            >
              <option value="">Move to…</option>
              {actions.moveTargets.map((f) => (
                <option key={f.path} value={f.path}>
                  {f.name}
                </option>
              ))}
            </select>
          )}
          <Button variant="ghost" icon={<Trash2 className="w-4 h-4" />} onClick={actions.onDelete} disabled={actions.busy}>
            Delete
          </Button>
        </div>
      )}
      {message.attachments.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Attachments">
          {message.attachments.map((a) => (
            <li key={a.part}>
              <button
                type="button"
                onClick={() => download(a)}
                disabled={downloading === a.part}
                className="inline-flex items-center gap-1.5 max-w-[260px] px-2.5 py-1.5 rounded-tile border border-border bg-white text-[12px] text-ink hover:bg-secondary disabled:opacity-50"
                title={`Download ${a.filename}`}
              >
                <Paperclip className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{a.filename}</span>
                <span className="shrink-0 text-muted-foreground">{fileSize(a.size)}</span>
                <Download className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-col flex-1 min-h-0">
        <MailBody html={message.html} text={message.text} />
      </div>
    </article>
  );
}
