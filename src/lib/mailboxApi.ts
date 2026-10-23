import { supabase } from './supabase';

// Client for the backend mailbox API (mailbox_routes.js): the signed-in person's own mailbox, read through the server,
// which logs in to their mail server for each request. The password goes to the server once (connect) and never
// comes back.
const API_URL =
  import.meta.env.VITE_API_URL || (import.meta.env.MODE === 'production' ? '/api' : 'http://localhost:3001/api');

async function token() {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  if (!t) throw new Error('You are not signed in');
  return t;
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  const auth = await token();
  try {
    return await fetch(`${API_URL}/mailbox${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection.');
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await send(method, path, body);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // a body over the hosting limit is refused before it reaches the API, without a JSON answer
    if (response.status === 413 && !payload.error) throw new Error('This is too large to send. Remove some attachments and try again.');
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload as T;
}

export interface MailboxAccount {
  email: string;
  imap_host: string;
  imap_port: number;
  secure: boolean;
  username: string;
  smtp_host: string | null;
  smtp_port: number | null;
  connected_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  password_set: boolean;
}

export interface MailboxDefaults {
  email: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  /** the suggestion came from the company's own mail server settings */
  from_company_server: boolean;
}

export interface MailboxInput {
  email: string;
  password?: string;
  imap_host: string;
  imap_port: number;
  username?: string;
  smtp_host?: string;
  smtp_port?: number;
}

export interface MailPerson {
  name: string;
  address: string;
}

export interface MailFolder {
  path: string;
  name: string;
  special: 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | null;
  unread: number;
  total: number;
  delimiter: string;
}

export interface MailListItem {
  uid: number;
  from: MailPerson | null;
  to: MailPerson[];
  subject: string;
  date: string | null;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  has_attachments: boolean;
  size: number;
}

export interface MailAttachment {
  part: string;
  filename: string;
  size: number;
  contentType: string;
}

export interface MailMessage {
  uid: number;
  folder: string;
  subject: string;
  from: MailPerson[];
  to: MailPerson[];
  cc: MailPerson[];
  reply_to: MailPerson[];
  date: string | null;
  message_id: string | null;
  seen: boolean;
  flagged: boolean;
  html: string | null;
  text: string;
  attachments: MailAttachment[];
}

export interface MessagePage {
  folder: string;
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
  messages: MailListItem[];
}

const q = (params: Record<string, string | number>) =>
  Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

export const getMailbox = () => request<{ account: MailboxAccount | null; defaults: MailboxDefaults }>('GET', '/account');
export const testMailbox = (input: MailboxInput) => request<{ ok: boolean; message: string }>('POST', '/test', input);
/** Saves when reading works; `smtp` says whether sending works with the same login. */
export const connectMailbox = (input: MailboxInput) => request<{ account: MailboxAccount; smtp?: { ok: boolean; message: string } }>('PUT', '/account', input);
export const disconnectMailbox = () => request<{ ok: boolean }>('DELETE', '/account');
export const listFolders = () => request<{ folders: MailFolder[] }>('GET', '/folders');
export const listMessages = (folder: string, page = 1) => request<MessagePage>('GET', `/messages?${q({ folder, page })}`);
export const getMessage = (folder: string, uid: number) => request<{ message: MailMessage }>('GET', `/message?${q({ folder, uid })}`);

/** Downloads an attachment through the server and hands it to the browser as a file. */
export async function downloadAttachment(folder: string, uid: number, attachment: MailAttachment) {
  const response = await send('GET', `/attachment?${q({ folder, uid, part: attachment.part })}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Download failed (${response.status})`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = attachment.filename || 'attachment';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------------------------------------------------------------------------------------------
// sending (FIG-1205, PR 2 of 3)
// ---------------------------------------------------------------------------------------------

/** Files added from this device: 3 MB in all (they travel to the server as base64, under the hosting's 4.5 MB). */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
/** The whole email, with the files being forwarded (read on the server). */
export const MAX_SEND_BYTES = 20 * 1024 * 1024;
export const MAX_RECIPIENTS = 50;

export interface SendInput {
  to: MailPerson[];
  cc: MailPerson[];
  bcc: MailPerson[];
  subject: string;
  text: string;
  attachments: { filename: string; content_type: string; data: string }[];
  reply?: { folder: string; uid: number };
  forward?: { folder: string; uid: number; parts: string[] };
}

export interface SendResult {
  ok: boolean;
  saved_to_sent: boolean;
  /** the Sent folder the copy went to (null when it couldn't be saved) */
  sent_folder: string | null;
  /** recipients the mail server refused (the rest got it) */
  rejected: string[];
  message: string;
}

/** Sends from the person's own mailbox (From is always their mailbox) and saves a copy to their Sent folder. */
export const sendMail = (input: SendInput) => request<SendResult>('POST', '/send', input);

// ---------------------------------------------------------------------------------------------
// managing mail (FIG-1205, PR 3 of 3)
// ---------------------------------------------------------------------------------------------

/** Emails acted on at once (the server's cap). */
export const MAX_UIDS = 200;

export interface DeleteResult {
  ok: boolean;
  folder: string;
  uids: number[];
  /** true: removed for good (only ever from Trash, when asked); false: moved to `trash` */
  permanent: boolean;
  trash: string | null;
}

export interface SearchFilters {
  q?: string;
  unread?: boolean;
  attachments?: boolean;
  /** YYYY-MM-DD, inclusive */
  since?: string;
  before?: string;
}

export interface SearchPage extends MessagePage {
  q: string;
  /** more than 500 matched: only the newest 500 are shown */
  capped: boolean;
}

/** Mark read / unread and flag / unflag. */
export const setFlags = (folder: string, uids: number[], change: { seen?: boolean; flagged?: boolean }) =>
  request<{ ok: boolean }>('POST', '/flags', { folder, uids, ...change });
/** Move to another folder of the mailbox. */
export const moveMessages = (folder: string, uids: number[], to: string) => request<{ ok: boolean }>('POST', '/move', { folder, uids, to });
/** To Trash; in Trash, `permanent` deletes for good (the screen asks first). */
export const deleteMessages = (folder: string, uids: number[], permanent = false) =>
  request<DeleteResult>('POST', '/delete', { folder, uids, ...(permanent ? { permanent: true } : {}) });
/** Searches one folder, newest first, 50 a page. */
export function searchMessages(folder: string, filters: SearchFilters, page = 1) {
  const params: Record<string, string | number> = { folder, page };
  if (filters.q) params.q = filters.q;
  if (filters.unread) params.unread = 1;
  if (filters.attachments) params.attachments = 1;
  if (filters.since) params.since = filters.since;
  if (filters.before) params.before = filters.before;
  return request<SearchPage>('GET', `/search?${q(params)}`);
}
/** INBOX's unread count, for the sidebar badge; `connected: false` when there is no mailbox. */
export const getUnreadCount = () => request<{ connected: boolean; unread: number }>('GET', '/unread');

const TRASH_NAMES = ['trash', 'inbox.trash', 'inbox/trash', 'deleted items', 'inbox.deleted items', 'inbox/deleted items', 'deleted messages', 'inbox.deleted messages'];
const ARCHIVE_NAMES = ['archive', 'inbox.archive', 'inbox/archive'];

const byNames = (folders: MailFolder[], names: string[]) => {
  for (const name of names) {
    const hit = folders.find((f) => f.path.toLowerCase() === name);
    if (hit) return hit.path;
  }
  return null;
};

/** The Trash folder as the server finds it: marked Trash, else Trash / INBOX.Trash, else Deleted Items. */
export const findTrash = (folders: MailFolder[]) => folders.find((f) => f.special === 'trash')?.path ?? byNames(folders, TRASH_NAMES);
/** The Archive folder (for the "e" shortcut), or null when there is none. */
export const findArchive = (folders: MailFolder[]) => folders.find((f) => f.special === 'archive')?.path ?? byNames(folders, ARCHIVE_NAMES);
