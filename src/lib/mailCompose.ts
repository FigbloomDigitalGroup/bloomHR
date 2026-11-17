// Writing an email from your own mailbox (FIG-1205, PR 2 of 3): the drafts for New, Reply, Reply all and Forward, and
// the recipients typed into the To / Cc / Bcc boxes. Plain text: the reply quotes the original with "> ".
import type { MailAttachment, MailMessage, MailPerson } from './mailboxApi';

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward';

export interface ComposeDraft {
  mode: ComposeMode;
  to: string;
  cc: string;
  subject: string;
  text: string;
  /** replying: the original, which the server reads to thread the reply */
  reply?: { folder: string; uid: number };
  /** forwarding: the original, whose attachments the server adds (never through the browser) */
  forward?: { folder: string; uid: number };
  forwardAttachments: MailAttachment[];
}

const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

/** "Name <a@b.co>", or just the address. */
export const personLabel = (p: MailPerson) => (p.name ? `${p.name.replace(/[<>,;"]/g, '')} <${p.address}>` : p.address);
const labels = (list: MailPerson[]) => list.map(personLabel).join(', ');

/**
 * What was typed into a To / Cc / Bcc box: addresses separated by commas, semicolons or new lines, each either
 * "a@b.co" or "Name <a@b.co>". The ones that are not addresses come back in `invalid`, as typed.
 */
export function parseRecipients(value: string): { people: MailPerson[]; invalid: string[] } {
  const people: MailPerson[] = [];
  const invalid: string[] = [];
  for (const piece of value.split(/[,;\n]+/)) {
    const item = piece.trim();
    if (!item) continue;
    const named = /^"?([^"<]*?)"?\s*<([^<>]+)>$/.exec(item);
    const address = (named ? named[2] : item).trim();
    if (EMAIL_RE.test(address) && address.length <= 254) people.push({ name: named ? named[1].trim() : '', address });
    else invalid.push(item);
  }
  return { people, invalid };
}

const prefixed = (subject: string, prefix: 'Re' | 'Fwd') => {
  const s = subject.trim();
  const already = prefix === 'Re' ? /^re:/i : /^(fwd?|fw):/i;
  return already.test(s) ? s : `${prefix}: ${s}`;
};

/** The original's words: its text, or (an HTML-only email) the text of its HTML, read without running anything. */
export function originalText(message: MailMessage): string {
  if (message.text.trim()) return message.text;
  if (!message.html || typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(message.html, 'text/html');
  doc.querySelectorAll('style, script, head').forEach((el) => el.remove());
  doc.querySelectorAll('br').forEach((el) => el.replaceWith('\n'));
  doc.querySelectorAll('p, div, tr, li, h1, h2, h3, h4').forEach((el) => el.append('\n'));
  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');

const sameAddress = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A reply (or reply all) to `message`, from the mailbox `ownAddress`: who, "Re:", and the original quoted. */
export function replyDraft(message: MailMessage, ownAddress: string, all: boolean): ComposeDraft {
  const sender = message.reply_to.length ? message.reply_to : message.from.slice(0, 1);
  // replying to your own sent email goes to the people it went to
  const fromMe = sender.length > 0 && sender.every((p) => sameAddress(p.address, ownAddress));
  let to = fromMe ? message.to : sender;
  let cc: MailPerson[] = [];
  if (all) {
    const seen = new Set([ownAddress.toLowerCase(), ...to.map((p) => p.address.toLowerCase())]);
    const others = [...(fromMe ? [] : message.to), ...message.cc];
    cc = others.filter((p) => {
      const key = p.address.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  to = to.filter((p, i, list) => list.findIndex((q) => sameAddress(q.address, p.address)) === i);
  const who = message.from[0] ? personLabel(message.from[0]) : 'someone';
  const quoted = originalText(message)
    .split(/\r?\n/)
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
  return {
    mode: all ? 'replyAll' : 'reply',
    to: labels(to),
    cc: labels(cc),
    subject: prefixed(message.subject, 'Re'),
    text: `\n\nOn ${when(message.date) || 'an earlier date'}, ${who} wrote:\n${quoted}\n`,
    reply: { folder: message.folder, uid: message.uid },
    forwardAttachments: [],
  };
}

/** A forward of `message`: "Fwd:", the original's headers and words, and its attachments (removable). */
export function forwardDraft(message: MailMessage): ComposeDraft {
  const header = [
    '---------- Forwarded message ---------',
    `From: ${labels(message.from)}`,
    message.date ? `Date: ${when(message.date)}` : '',
    `Subject: ${message.subject}`,
    `To: ${labels(message.to)}`,
    message.cc.length ? `Cc: ${labels(message.cc)}` : '',
  ].filter(Boolean);
  return {
    mode: 'forward',
    to: '',
    cc: '',
    subject: prefixed(message.subject, 'Fwd'),
    text: `\n\n${header.join('\n')}\n\n${originalText(message)}\n`,
    forward: { folder: message.folder, uid: message.uid },
    forwardAttachments: message.attachments,
  };
}

export const newDraft = (): ComposeDraft => ({ mode: 'new', to: '', cc: '', subject: '', text: '', forwardAttachments: [] });

export const fileSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;

/** A file as base64 (no "data:" prefix), for sending in JSON. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}
