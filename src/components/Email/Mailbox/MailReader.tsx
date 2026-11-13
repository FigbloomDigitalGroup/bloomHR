import { useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { Archive, ArrowLeft, ChevronDown, ChevronUp, Download, Forward, MailOpen, Paperclip, Reply, ReplyAll, Star, Trash2 } from 'lucide-react';
import { downloadAttachment, type MailAttachment, type MailFolder, type MailMessage, type MailPerson } from '../../../lib/mailboxApi';
import { fileSize } from '../../../lib/mailCompose';
import MailAvatar from './MailAvatar';
import MailBody from './MailBody';

const personLabel = (p: MailPerson) => (p.name ? `${p.name} <${p.address}>` : p.address);
const people = (list: MailPerson[]) => list.map(personLabel).join(', ');
const firstNames = (list: MailPerson[]) => list.map((p) => p.name || p.address).join(', ');

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

/** A toolbar icon button: its name as the tooltip. */
function Tool({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="p-2 rounded-full text-muted-foreground hover:bg-secondary hover:text-ink disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** What can be done to the open email: flag, mark unread, archive, move, delete. */
export interface ReaderActions {
  onToggleFlag: () => void;
  onMarkUnread: () => void;
  onDelete: () => void;
  /** moves it to the Archive folder (when the mailbox has one and it isn't already there) */
  onArchive?: () => void;
  /** the folders it can be moved to (not the one it's in) */
  moveTargets: MailFolder[];
  onMove: (to: string) => void;
  busy?: boolean;
}

/**
 * The reading pane, laid out like Gmail's: a toolbar that stays at the top (back on a phone, archive, delete, mark
 * unread, move, reply, flag), then the subject, the sender, the attachments and the body, which fill the pane; Reply /
 * Reply all / Forward stay at the bottom, so nobody scrolls to answer.
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
  const [details, setDetails] = useState(false);
  const sender = message.from[0];
  const senderName = sender ? sender.name || sender.address : '(unknown sender)';

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
      {(onBack || actions || onRespond) && (
        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border shrink-0" role="toolbar" aria-label="This email">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to messages"
              title="Back to messages"
              className="md:hidden p-2 rounded-full text-muted-foreground hover:bg-secondary hover:text-ink"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden />
            </button>
          )}
          {actions && (
            <>
              {actions.onArchive && (
                <Tool label="Archive" onClick={actions.onArchive} disabled={actions.busy}>
                  <Archive className="w-4 h-4" aria-hidden />
                </Tool>
              )}
              <Tool label="Delete" onClick={actions.onDelete} disabled={actions.busy}>
                <Trash2 className="w-4 h-4" aria-hidden />
              </Tool>
              <Tool label="Mark unread" onClick={actions.onMarkUnread} disabled={actions.busy}>
                <MailOpen className="w-4 h-4" aria-hidden />
              </Tool>
              {actions.moveTargets.length > 0 && (
                <select
                  className="ml-1 max-w-[9rem] rounded-full border border-border bg-white px-2.5 py-1 text-[12px] text-ink"
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
            </>
          )}
          <span className="flex-1" />
          {onRespond && (
            <Tool label="Reply to the sender" onClick={() => onRespond('reply')}>
              <Reply className="w-4 h-4" aria-hidden />
            </Tool>
          )}
          {actions && (
            <button
              type="button"
              onClick={actions.onToggleFlag}
              disabled={actions.busy}
              aria-pressed={message.flagged}
              aria-label={message.flagged ? 'Unflag' : 'Flag'}
              title={message.flagged ? 'Unflag' : 'Flag'}
              className="p-2 rounded-full hover:bg-secondary disabled:opacity-50"
            >
              <Star className={`w-4 h-4 ${message.flagged ? 'fill-current text-status-warning' : 'text-muted-foreground'}`} aria-hidden />
            </button>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col px-4 md:px-6 pt-4">
        <h2 className="text-[18px] md:text-[20px] font-semibold text-ink break-words leading-snug shrink-0">{message.subject || '(no subject)'}</h2>

        <div className="mt-4 flex items-start gap-3 shrink-0">
          <MailAvatar name={senderName} />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[13px] font-bold text-ink">{senderName}</span>
              {sender?.name && <span className="text-[12px] text-muted-foreground break-all">&lt;{sender.address}&gt;</span>}
            </div>
            <button
              type="button"
              onClick={() => setDetails((v) => !v)}
              aria-expanded={details}
              className="inline-flex items-center gap-0.5 text-[12px] text-muted-foreground hover:text-ink"
            >
              <span className="truncate max-w-[28rem]">to {firstNames(message.to) || '(no one)'}{message.cc.length ? `, cc ${firstNames(message.cc)}` : ''}</span>
              {details ? <ChevronUp className="w-3.5 h-3.5 shrink-0" aria-hidden /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" aria-hidden />}
            </button>
          </div>
          <span className="shrink-0 text-[12px] text-muted-foreground whitespace-nowrap">{message.date ? new Date(message.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''}</span>
        </div>

        {details && (
          <div className="mt-2 ml-12 space-y-0.5 rounded-tile border border-border p-2.5 shrink-0">
            <Row label="From" value={people(message.from)} />
            <Row label="To" value={people(message.to)} />
            <Row label="Cc" value={people(message.cc)} />
            <Row label="Date" value={message.date ? new Date(message.date).toLocaleString() : ''} />
          </div>
        )}

        <div className="mt-4 flex flex-col flex-1 min-h-[360px]">
          <MailBody html={message.html} text={message.text} />
        </div>

        {message.attachments.length > 0 && (
          <div className="mt-4 shrink-0">
            <div className="text-[12px] font-semibold text-ink mb-2">
              {message.attachments.length} attachment{message.attachments.length === 1 ? '' : 's'}
            </div>
            <ul className="flex flex-wrap gap-2" aria-label="Attachments">
              {message.attachments.map((a) => (
                <li key={a.part}>
                  <button
                    type="button"
                    onClick={() => download(a)}
                    disabled={downloading === a.part}
                    className="group inline-flex items-center gap-2 w-56 px-3 py-2 rounded-tile border border-border bg-white text-left hover:bg-secondary hover:shadow-sm disabled:opacity-50"
                    title={`Download ${a.filename}`}
                  >
                    <Paperclip className="w-4 h-4 shrink-0 text-brand" aria-hidden />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-[12px] font-semibold text-ink">{a.filename}</span>
                      <span className="block text-[11px] text-muted-foreground">{fileSize(a.size)}</span>
                    </span>
                    <Download className="w-4 h-4 shrink-0 text-muted-foreground group-hover:text-ink" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* answering: always in view at the bottom of the pane */}
        {onRespond && (
          <div className="sticky bottom-0 -mx-4 md:-mx-6 mt-4 px-4 md:px-6 py-3 bg-white/95 backdrop-blur border-t border-border flex flex-wrap gap-2 shrink-0">
            <RespondButton icon={<Reply className="w-4 h-4" aria-hidden />} label="Reply" onClick={() => onRespond('reply')} />
            <RespondButton icon={<ReplyAll className="w-4 h-4" aria-hidden />} label="Reply all" onClick={() => onRespond('replyAll')} />
            <RespondButton icon={<Forward className="w-4 h-4" aria-hidden />} label="Forward" onClick={() => onRespond('forward')} />
          </div>
        )}
        {!onRespond && <div className="h-4 shrink-0" />}
      </div>
    </article>
  );
}

/** Gmail's outlined, rounded Reply / Reply all / Forward buttons. */
function RespondButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-4 py-1.5 text-[12.5px] font-semibold text-ink hover:bg-secondary hover:shadow-sm"
    >
      {icon}
      {label}
    </button>
  );
}
