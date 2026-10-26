import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Download, FileSignature, FileText, Loader2, Send, Settings2 } from 'lucide-react';
import { Button, Card, Modal } from '../UI';
import OfferLetter from '../AfterHiring/OfferLetter';
import { Field, inputClass } from '../AfterHiring/OfferEditor';
import LetterTemplatesModal from '../AfterHiring/LetterTemplatesModal';
import MySignature from '../Signature/MySignature';
import { formatDay, parseDay } from '../../lib/contract';
import { fillPlaceholders, letterPdfBlob, loadBranding, unknownPlaceholders, type LetterBranding } from '../../lib/offers';
import { loadDocumentsFor, openGeneratedDocument, type GeneratedDocument } from '../../lib/generatedDocuments';
import {
  EXIT_LETTER_PLACEHOLDERS,
  archiveDownloadedExitLetter,
  deleteExitLetterTemplate,
  exitLetterFileName,
  exitLetterValues,
  loadExitLetterTemplates,
  loadLetterRecipient,
  loadLetterSender,
  saveExitLetterTemplate,
  sendExitLetter,
  startingTemplate,
  type ExitLetterTemplate,
  type LetterRecipient,
  type LetterSender,
} from '../../lib/exitLetters';
import type { ExitRecord } from '../../lib/exits';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const sentOn = (iso: string) => formatDay(parseDay(iso.slice(0, 10))) || iso.slice(0, 10);

export function ExitLetterTemplates({ onClose }: { onClose: () => void }) {
  return (
    <LetterTemplatesModal
      heading="Exit letter templates"
      placeholders={EXIT_LETTER_PLACEHOLDERS}
      newTitle="RE: TERMINATION OF EMPLOYMENT"
      defaultLabel="Start new letters with this one (default)"
      load={loadExitLetterTemplates}
      save={saveExitLetterTemplate}
      remove={deleteExitLetterTemplate}
      deleteNote="Letters already sent are kept as they were."
      onClose={onClose}
    />
  );
}

interface ComposerProps {
  exit: ExitRecord;
  onClose: () => void;
  onDone: () => void;
}

/** Writes one letter for an exit: a template, the text, who it goes to, then send (as a PDF) or download. */
function ExitLetterComposer({ exit, onClose, onDone }: ComposerProps) {
  const [templates, setTemplates] = useState<ExitLetterTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [recipient, setRecipient] = useState<LetterRecipient | null>(null);
  const [sender, setSender] = useState<LetterSender>({ name: '', title: '' });
  const [branding, setBranding] = useState<LetterBranding>({ name: 'Your company' });
  const [signature, setSignature] = useState<string | null>(null);
  const [to, setTo] = useState<string[]>([]);
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState<'send' | 'download' | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const letterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([loadExitLetterTemplates(), loadLetterRecipient(exit.employee_number), loadLetterSender(), loadBranding()]).then(
      ([t, r, s, b]) => {
        setTemplates(t);
        setRecipient(r);
        setSender(s);
        setBranding(b);
        const start = startingTemplate(t);
        if (start) {
          setTemplateId(start.id);
          setTitle(start.title);
          setBody(start.body);
        }
        setTo([r.workEmail, r.personalEmail].filter((e): e is string => !!e));
      },
      (err) => setLoadError((err as Error).message)
    );
  }, [exit.employee_number]);

  const pick = (id: string) => {
    const t = templates.find((x) => x.id === id);
    setTemplateId(id);
    if (t) {
      setTitle(t.title);
      setBody(t.body);
    }
  };

  const values = useMemo(
    () => (recipient ? exitLetterValues(exit, recipient, { companyName: branding.name, sender }) : {}),
    [exit, recipient, branding.name, sender]
  );
  const filledTitle = fillPlaceholders(title, values);
  const filledText = fillPlaceholders(body, values);
  const unknown = unknownPlaceholders(`${title}\n${body}`, EXIT_LETTER_PLACEHOLDERS);
  const usesSignature = /\{\{\s*signature\s*\}\}/i.test(body);

  const addresses = [recipient?.workEmail, recipient?.personalEmail].filter((e): e is string => !!e);
  const otherAddress = other.trim().toLowerCase();
  const recipients = [...new Set([...to, ...(EMAIL.test(otherAddress) ? [otherAddress] : [])])];
  const toggle = (email: string, on: boolean) => setTo((list) => (on ? [...new Set([...list, email])] : list.filter((e) => e !== email)));

  const pdf = async () => {
    if (!letterRef.current) throw new Error('The letter is not ready yet');
    return letterPdfBlob(letterRef.current);
  };

  const send = async () => {
    if (!recipient) return;
    if (!recipients.length) return void toast.error('Choose at least one email address');
    if (other.trim() && !EMAIL.test(otherAddress)) return void toast.error('Enter the other address like jane@gmail.com');
    setBusy('send');
    try {
      const outcome = await sendExitLetter({ exit, title: filledTitle, pdf: await pdf(), to: recipients, recipient, branding });
      if (outcome.status === 'sent') toast.success(`Letter sent to ${outcome.to.join(', ')}`);
      else toast.error(`The letter was not emailed (${outcome.reason}). It is kept on this exit: download it and hand it over.`, { duration: 12000 });
      if (outcome.archiveProblem) toast.error(`The letter was not kept in the archive: ${outcome.archiveProblem}`, { duration: 12000 });
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    if (!recipient) return;
    setBusy('download');
    try {
      const file = await pdf();
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = exitLetterFileName(recipient);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      try {
        await archiveDownloadedExitLetter({ exit, title: filledTitle, pdf: file });
        onDone();
      } catch (err) {
        toast.error(`Downloaded, but not kept in the archive: ${(err as Error).message}`);
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Letter to ${exit.employee_name ?? exit.employee_number}`} size="7xl" closeOnBackdrop={false}>
      {loadError ? (
        <p role="alert" className="mt-3 text-sm text-status-danger">{loadError}</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] mt-2">
          <div className="space-y-3">
            <Field label="Template">
              <select className={inputClass} value={templateId} onChange={(e) => pick(e.target.value)} aria-label="Template">
                {!templates.some((t) => t.active) && <option value="">No templates yet</option>}
                {templates.filter((t) => t.active || t.id === templateId).map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
            </Field>
            <Field label="Title">
              <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Text" hint="Change it for this letter only; the template stays as it is.">
              <textarea className={`${inputClass} font-mono text-[12.5px]`} rows={14} value={body} aria-label="Letter text" onChange={(e) => setBody(e.target.value)} />
            </Field>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Placeholders</summary>
              <ul className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-3">
                {EXIT_LETTER_PLACEHOLDERS.map((p) => (
                  <li key={p.key}><code>{`{{${p.key}}}`}</code> {p.label}</li>
                ))}
              </ul>
            </details>
            {unknown.length > 0 && <p className="text-xs text-orange-text-alt">Not a known placeholder: {unknown.map((k) => `{{${k}}}`).join(', ')}</p>}

            <fieldset className="space-y-1.5">
              <legend className="text-xs font-medium text-ink mb-1">Send to</legend>
              {addresses.map((email) => (
                <label key={email} className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={to.includes(email)} onChange={(e) => toggle(email, e.target.checked)} />
                  {email} <span className="text-[11px] text-muted-foreground">({email === recipient?.workEmail ? 'work' : 'personal'})</span>
                </label>
              ))}
              {recipient && !addresses.length && <p className="m-0 text-[12px] text-muted-foreground">No email on their record: add one below.</p>}
              <input type="email" className={inputClass} placeholder="Another address (optional)" aria-label="Another address" value={other} onChange={(e) => setOther(e.target.value)} />
            </fieldset>

            <div>
              <p className="text-xs font-medium text-ink mb-1">Your signature</p>
              <MySignature bare onChange={setSignature} />
              {!usesSignature && <p className="mt-1 mb-0 text-[11px] text-subtle">This text has no {'{{signature}}'} line, so the signature is not shown.</p>}
            </div>
          </div>

          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Preview</p>
            <div className="bg-secondary rounded-xl p-2 sm:p-4 overflow-x-auto">
              {recipient ? (
                <OfferLetter ref={letterRef} branding={branding} title={filledTitle} text={filledText} signature={signature} />
              ) : (
                <p className="m-4 text-sm text-muted-foreground">Loading…</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-5 pt-4 border-t border-border flex flex-wrap items-center justify-end gap-2">
        <p className="mr-auto m-0 text-[11px] text-subtle">Every letter sent or downloaded is kept with this exit and in the audit trail.</p>
        <Button variant="ghost" onClick={onClose} disabled={busy !== null}>Cancel</Button>
        <Button variant="secondary" disabled={busy !== null || !recipient || !title.trim() || !body.trim()} onClick={() => void download()}
          icon={busy === 'download' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}>
          Download PDF
        </Button>
        <Button disabled={busy !== null || !recipient || !title.trim() || !body.trim()} onClick={() => void send()}
          icon={busy === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}>
          Send by email
        </Button>
      </div>
    </Modal>
  );
}

/** An exit's letters: the ones sent or downloaded so far, and writing a new one. */
export default function ExitLetters({ exit }: { exit: ExitRecord }) {
  const [letters, setLetters] = useState<GeneratedDocument[] | null>(null);
  const [writing, setWriting] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const load = useCallback(() => {
    loadDocumentsFor(exit.id).then(setLetters, (err) => {
      setLetters([]);
      toast.error((err as Error).message);
    });
  }, [exit.id]);
  useEffect(load, [load]);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="m-0 text-[14px] font-bold text-ink">Letters</h3>
          <p className="mt-0.5 mb-0 text-[12px] text-muted-foreground">
            {exit.kind === 'termination' ? 'The termination letter' : 'A letter accepting the resignation'}, from a template, on the company letterhead and with your signature.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setTemplatesOpen(true)} icon={<Settings2 className="h-4 w-4" />}>Templates</Button>
          <Button onClick={() => setWriting(true)} icon={<FileSignature className="h-4 w-4" />}>Write a letter</Button>
        </div>
      </div>

      {letters === null ? (
        <p className="mt-3 mb-0 text-[12px] text-muted-foreground">Loading letters…</p>
      ) : letters.length === 0 ? (
        <p className="mt-3 mb-0 text-[12px] text-muted-foreground">No letter yet.</p>
      ) : (
        <ul className="mt-3 mb-0 p-0 list-none divide-y divide-border">
          {letters.map((l) => (
            <li key={l.id} className="py-2 flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[180px]">
                <div className="text-[12.5px] font-semibold text-ink">{l.title}</div>
                <div className="text-[11px] text-muted-foreground">
                  {sentOn(l.created_at)} · {l.emailed_to.length ? `Emailed to ${l.emailed_to.join(', ')}` : 'Downloaded, not emailed'}
                </div>
              </div>
              <Button variant="ghost" icon={<FileText className="h-4 w-4" />}
                onClick={() => openGeneratedDocument(l).catch((err) => toast.error((err as Error).message))}>
                Open PDF
              </Button>
            </li>
          ))}
        </ul>
      )}

      {writing && (
        <ExitLetterComposer
          exit={exit}
          onClose={() => setWriting(false)}
          onDone={() => {
            setWriting(false);
            load();
          }}
        />
      )}
      {templatesOpen && <ExitLetterTemplates onClose={() => setTemplatesOpen(false)} />}
    </Card>
  );
}
