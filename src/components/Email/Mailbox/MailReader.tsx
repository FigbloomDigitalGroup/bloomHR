import { useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, Download, Forward, Paperclip, Reply, ReplyAll } from 'lucide-react';
import { Button } from '../../UI';
import { downloadAttachment, type MailAttachment, type MailMessage, type MailPerson } from '../../../lib/mailboxApi';
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

/** The reading pane: who, when, the subject, the attachments to download, the body, and Reply / Reply all / Forward. */
export default function MailReader({ message, onBack, onRespond }: { message: MailMessage; onBack?: () => void; onRespond?: (mode: ReplyMode) => void }) {
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
      <h2 className="text-[16px] font-bold text-ink break-words">{message.subject || '(no subject)'}</h2>
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
