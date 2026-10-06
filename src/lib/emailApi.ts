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
  | 'performance'
  | 'staff-signup';

export interface OutgoingEmail {
  to: string | string[];
  subject: string;
  html: string;
  attachments?: { filename: string; content: string }[];
  provider?: 'resend' | 'cpanel';
  /** cPanel mailbox to send as; the server only allows the ones it is configured with. */
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

/** The provider's sent-mail list ({ data: [...], has_more }). */
export const listEmailLogs = (limit: number, cursor?: string) =>
  request<{ data?: any[]; has_more?: boolean }>(
    'GET',
    `/logs?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
  );

export const getEmailLog = (id: string) => request<any>('GET', `/logs/${encodeURIComponent(id)}`);
