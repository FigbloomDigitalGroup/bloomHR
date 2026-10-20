import { supabase } from './supabase';

// Client for the backend email API (email_routes.js). The mail provider keys live on the server; the browser
// authenticates with the caller's own session token, and the server checks the caller's role may send this kind of mail.
const API_URL =
  import.meta.env.VITE_API_URL || (import.meta.env.MODE === 'production' ? '/api' : 'http://localhost:3001/api');

/** What the email is for. The server ties each purpose to a permission. */
export type EmailPurpose =
  | 'email-portal'
  | 'termination'
  | 'hr-reminder'
  | 'warning'
  | 'recruitment'
  | 'offer'
  | 'performance'
  | 'staff-signup';

export interface OutgoingEmail {
  to: string | string[];
  subject: string;
  html: string;
  attachments?: { filename: string; content: string }[];
  /** Ignored when the company sends from its own mail server, which always wins. */
  provider?: 'resend' | 'cpanel';
  /** cPanel mailbox to send as (the server-wide cPanel account); the server only allows the ones it is configured with. */
  cpanelUser?: string;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('You are not signed in');

  let response: Response;
  try {
    response = await fetch(`${API_URL}/email${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the server. Is the backend running?');
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload as T;
}

/** Sends one email. Throws if the request is refused or the provider rejects it. */
export const sendEmailViaServer = (email: OutgoingEmail, options: { purpose: EmailPurpose }) =>
  request<{ message: string; id?: string }>('POST', '/send', { ...email, purpose: options.purpose });

/**
 * Queues one email to many of the company's employees (each gets their own copy); the server sends it over the next
 * few minutes. Only the work emails of the company's own employees are queued; the answer says how many were skipped.
 */
export const queueBulkEmail = (email: Omit<OutgoingEmail, 'to' | 'provider' | 'cpanelUser'> & { to: string[] }) =>
  request<{ id: string; queued: number; skipped: number }>('POST', '/bulk', { ...email, purpose: 'email-portal' });

/** The provider's sent-mail list ({ data: [...], has_more }). */
export const listEmailLogs = (limit: number, cursor?: string) =>
  request<{ data?: any[]; has_more?: boolean }>(
    'GET',
    `/logs?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
  );

export const getEmailLog = (id: string) => request<any>('GET', `/logs/${encodeURIComponent(id)}`);

/** Who the company's email comes from: its own mail server's address, or Figbloom HR mail. */
export interface EmailSender {
  own_server: boolean;
  from_address: string | null;
  from_name: string;
}
export const getEmailSender = () => request<EmailSender>('GET', '/sender');

/** The company's own mail server (cPanel or any SMTP) as the server shows it: never the password, only whether one is set. */
export interface MailServerSettings {
  host: string;
  port: number;
  /** true: SSL/TLS from the start (usually port 465); false: STARTTLS (usually port 587) */
  secure: boolean;
  username: string;
  from_name: string;
  from_address: string;
  enabled: boolean;
  password_set: boolean;
  last_test_ok: boolean | null;
  last_test_at: string | null;
  last_test_message: string | null;
  updated_at: string | null;
}

/** What is saved. A password left out (or empty) keeps the saved one. */
export type MailServerInput = Pick<MailServerSettings, 'host' | 'port' | 'secure' | 'username' | 'from_name' | 'from_address' | 'enabled'> & {
  password?: string;
};

export const getMailServer = () => request<{ settings: MailServerSettings | null }>('GET', '/mail-server');
export const saveMailServer = (settings: MailServerInput) => request<{ settings: MailServerSettings }>('PUT', '/mail-server', settings);

/** Sends a test email to the signed-in person through the saved server, and says how it went. */
export const testMailServer = () => request<{ ok: boolean; message: string; tested_at: string }>('POST', '/mail-server/test');
