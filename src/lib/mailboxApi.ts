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
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
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
export const connectMailbox = (input: MailboxInput) => request<{ account: MailboxAccount }>('PUT', '/account', input);
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
