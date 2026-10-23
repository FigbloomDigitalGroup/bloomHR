import { useId, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, Paperclip, Send, Trash2, X } from 'lucide-react';
import { Button } from '../../UI';
import { confirmDialog } from '../../../lib/confirmDialog';
import { MAX_RECIPIENTS, MAX_SEND_BYTES, MAX_UPLOAD_BYTES, sendMail, type MailboxAccount, type SendResult } from '../../../lib/mailboxApi';
import { fileSize, fileToBase64, parseRecipients, type ComposeDraft } from '../../../lib/mailCompose';

const inputClass =
  'w-full min-w-0 rounded-tile border border-border bg-white px-3 py-2 text-[12.5px] text-ink outline-none focus:border-brand disabled:bg-secondary';

const TITLES: Record<ComposeDraft['mode'], string> = { new: 'New message', reply: 'Reply', replyAll: 'Reply all', forward: 'Forward' };

interface Upload {
  id: number;
  file: File;
}

function Line({ label, children, htmlFor }: { label: string; children: React.ReactNode; htmlFor: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-border py-1.5">
      <label htmlFor={htmlFor} className="w-14 shrink-0 text-[12px] text-muted-foreground">
        {label}
      </label>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

/**
 * Writing an email from your own mailbox: To (and Cc / Bcc), the subject, plain text, and files. A reply starts with
 * the original quoted; a forward with its headers and its attachments, which can be removed (the server adds them from
 * the original, so they never pass through the browser). Files added here: 3 MB in all.
 */
export default function MailCompose({
  account,
  draft,
  onClose,
  onSent,
}: {
  account: MailboxAccount;
  draft: ComposeDraft;
  onClose: () => void;
  onSent: (result: SendResult) => void;
}) {
  const id = useId();
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState(draft.cc);
  const [bcc, setBcc] = useState('');
  const [showCopies, setShowCopies] = useState(Boolean(draft.cc));
  const [subject, setSubject] = useState(draft.subject);
  const [text, setText] = useState(draft.text);
  const [forwarded, setForwarded] = useState(draft.forwardAttachments);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);

  const uploaded = uploads.reduce((n, u) => n + u.file.size, 0);
  const forwardedSize = forwarded.reduce((n, a) => n + a.size, 0);
  const share = Math.min(100, Math.round((uploaded / MAX_UPLOAD_BYTES) * 100));
  const dirty = to !== draft.to || cc !== draft.cc || bcc !== '' || subject !== draft.subject || text !== draft.text || uploads.length > 0 || forwarded.length !== draft.forwardAttachments.length;

  const recipients = useMemo(() => ({ to: parseRecipients(to), cc: parseRecipients(cc), bcc: parseRecipients(bcc) }), [to, cc, bcc]);
  const everyone = recipients.to.people.length + recipients.cc.people.length + recipients.bcc.people.length;

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    let total = uploaded;
    const added: Upload[] = [];
    for (const file of Array.from(files)) {
      if (total + file.size > MAX_UPLOAD_BYTES) {
        toast.error(`${file.name} is too large: files added here can be up to ${fileSize(MAX_UPLOAD_BYTES)} in all.`);
        continue;
      }
      total += file.size;
      added.push({ id: nextId.current++, file });
    }
    if (added.length) setUploads((prev) => [...prev, ...added]);
    if (fileInput.current) fileInput.current.value = '';
  };

  const discard = async () => {
    if (dirty) {
      const ok = await confirmDialog({ title: 'Discard this email?', message: 'What you wrote is not saved.', confirmLabel: 'Discard', tone: 'danger' });
      if (!ok) return;
    }
    onClose();
  };

  const send = async () => {
    setError('');
    const invalid = [...recipients.to.invalid, ...recipients.cc.invalid, ...recipients.bcc.invalid];
    if (invalid.length) return setError(`${invalid.length === 1 ? 'This is' : 'These are'} not a valid email address: ${invalid.join(', ')}`);
    if (!everyone) return setError('Add at least one recipient.');
    if (everyone > MAX_RECIPIENTS) return setError(`Send to at most ${MAX_RECIPIENTS} people at once.`);
    if (uploaded > MAX_UPLOAD_BYTES) return setError(`Files added here can be up to ${fileSize(MAX_UPLOAD_BYTES)} in all.`);
    if (uploaded + forwardedSize > MAX_SEND_BYTES) return setError(`The attachments are too large to send (over ${fileSize(MAX_SEND_BYTES)} in all).`);
    setSending(true);
    try {
      const attachments = await Promise.all(
        uploads.map(async (u) => ({ filename: u.file.name, content_type: u.file.type || 'application/octet-stream', data: await fileToBase64(u.file) }))
      );
      const result = await sendMail({
        to: recipients.to.people,
        cc: recipients.cc.people,
        bcc: recipients.bcc.people,
        subject: subject.trim(),
        text,
        attachments,
        ...(draft.reply ? { reply: draft.reply } : {}),
        ...(draft.forward ? { forward: { ...draft.forward, parts: forwarded.map((a) => a.part) } } : {}),
      });
      if (result.saved_to_sent && !result.rejected.length) toast.success(result.message);
      else toast.error(result.message);
      onSent(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      className="flex flex-col h-full min-h-0"
      aria-label={TITLES[draft.mode]}
      onSubmit={(e) => {
        e.preventDefault();
        if (!sending) send();
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <button type="button" onClick={discard} className="md:hidden p-1 -ml-1 text-muted-foreground hover:text-ink" aria-label="Back to messages">
          <ArrowLeft className="w-4 h-4" aria-hidden />
        </button>
        <h2 className="flex-1 text-[15px] font-bold text-ink">{TITLES[draft.mode]}</h2>
        <span className="hidden sm:inline text-[11.5px] text-muted-foreground truncate">From {account.email}</span>
      </div>

      <Line label="To" htmlFor={`${id}-to`}>
        <div className="flex items-center gap-2">
          <input
            id={`${id}-to`}
            className={inputClass}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="name@company.com, another@company.com"
            autoComplete="off"
            autoFocus={draft.mode === 'new' || draft.mode === 'forward'}
            disabled={sending}
          />
          {!showCopies && (
            <button type="button" className="shrink-0 text-[12px] font-semibold text-brand hover:underline" onClick={() => setShowCopies(true)}>
              Cc / Bcc
            </button>
          )}
        </div>
      </Line>
      {showCopies && (
        <>
          <Line label="Cc" htmlFor={`${id}-cc`}>
            <input id={`${id}-cc`} className={inputClass} value={cc} onChange={(e) => setCc(e.target.value)} autoComplete="off" disabled={sending} />
          </Line>
          <Line label="Bcc" htmlFor={`${id}-bcc`}>
            <input id={`${id}-bcc`} className={inputClass} value={bcc} onChange={(e) => setBcc(e.target.value)} autoComplete="off" disabled={sending} />
          </Line>
        </>
      )}
      <Line label="Subject" htmlFor={`${id}-subject`}>
        <input id={`${id}-subject`} className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={900} disabled={sending} />
      </Line>

      <label htmlFor={`${id}-text`} className="sr-only">
        Message
      </label>
      <textarea
        id={`${id}-text`}
        className={`${inputClass} mt-2 flex-1 min-h-[220px] resize-y font-sans leading-relaxed`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus={draft.mode === 'reply' || draft.mode === 'replyAll'}
        onFocus={(e) => {
          // a reply starts above the quoted original
          if (draft.mode !== 'new' && text === draft.text) e.currentTarget.setSelectionRange(0, 0);
        }}
        disabled={sending}
      />

      {(forwarded.length > 0 || uploads.length > 0) && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Attachments">
          {forwarded.map((a) => (
            <li key={`f-${a.part}`} className="inline-flex items-center gap-1.5 max-w-full px-2.5 py-1 rounded-tile border border-border bg-white text-[12px] text-ink">
              <Paperclip className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{a.filename}</span>
              <span className="shrink-0 text-muted-foreground">{fileSize(a.size)}</span>
              <button
                type="button"
                className="shrink-0 p-0.5 text-muted-foreground hover:text-status-danger"
                onClick={() => setForwarded((prev) => prev.filter((x) => x.part !== a.part))}
                aria-label={`Remove ${a.filename}`}
                disabled={sending}
              >
                <X className="w-3.5 h-3.5" aria-hidden />
              </button>
            </li>
          ))}
          {uploads.map((u) => (
            <li key={`u-${u.id}`} className="inline-flex items-center gap-1.5 max-w-full px-2.5 py-1 rounded-tile border border-border bg-white text-[12px] text-ink">
              <Paperclip className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{u.file.name}</span>
              <span className="shrink-0 text-muted-foreground">{fileSize(u.file.size)}</span>
              <button
                type="button"
                className="shrink-0 p-0.5 text-muted-foreground hover:text-status-danger"
                onClick={() => setUploads((prev) => prev.filter((x) => x.id !== u.id))}
                aria-label={`Remove ${u.file.name}`}
                disabled={sending}
              >
                <X className="w-3.5 h-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 space-y-1">
        <div className="flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
          <span id={`${id}-meter`}>
            Files added: {fileSize(uploaded)} of {fileSize(MAX_UPLOAD_BYTES)}
            {forwardedSize > 0 ? ` · forwarded: ${fileSize(forwardedSize)}` : ''}
          </span>
        </div>
        <div
          role="progressbar"
          aria-labelledby={`${id}-meter`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={share}
          className="h-1.5 w-full rounded-full bg-secondary overflow-hidden"
        >
          <div className={`h-full ${share >= 90 ? 'bg-status-warning' : 'bg-brand'}`} style={{ width: `${share}%` }} />
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-[12px] text-status-danger">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="submit" icon={<Send className="w-4 h-4" />} disabled={sending}>
          {sending ? 'Sending…' : 'Send'}
        </Button>
        <Button variant="secondary" icon={<Paperclip className="w-4 h-4" />} onClick={() => fileInput.current?.click()} disabled={sending}>
          Attach files
        </Button>
        <input ref={fileInput} type="file" multiple className="sr-only" tabIndex={-1} aria-label="Attach files" onChange={(e) => addFiles(e.target.files)} />
        <Button variant="ghost" icon={<Trash2 className="w-4 h-4" />} onClick={discard} disabled={sending} className="ml-auto">
          Discard
        </Button>
      </div>
    </form>
  );
}
