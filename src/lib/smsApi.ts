import { supabase } from './supabase';

// Client for the backend SMS API (sms_routes.js). The SMS provider key lives on the server; the browser
// authenticates with the caller's own session token.
const API_URL =
  import.meta.env.VITE_API_URL || (import.meta.env.MODE === 'production' ? '/api' : 'http://localhost:3001/api');

/** What the message is for. The server ties each purpose to a permission (or, for 'mfa', to your own number). */
export type SmsPurpose = 'sms-center' | 'salary-advance' | 'birthday' | 'mfa';

export interface SmsMessage {
  phone: string;
  message: string;
}

export interface SmsResult {
  phone: string;
  success: boolean;
  /** false when the provider accepted the request but its reply could not be read */
  confirmed?: boolean;
  messageId?: string;
  error?: string;
}

const MAX_PER_REQUEST = 1000; // keep in step with MAX_BATCH in sms_routes.js

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('You are not signed in');

  let response: Response;
  try {
    response = await fetch(`${API_URL}/sms${path}`, {
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

/** Sends many messages (in requests of up to 1000). Results come back in the same order as `messages`. */
export async function sendSms(
  messages: SmsMessage[],
  options: { purpose: SmsPurpose; senderId?: string }
): Promise<SmsResult[]> {
  const results: SmsResult[] = [];
  for (let i = 0; i < messages.length; i += MAX_PER_REQUEST) {
    const chunk = messages.slice(i, i + MAX_PER_REQUEST);
    const out = await request<{ results: SmsResult[] }>('POST', '/send', {
      purpose: options.purpose,
      senderId: options.senderId || undefined,
      messages: chunk,
    });
    results.push(...out.results);
  }
  return results;
}

/** Sends one message and returns its result. Throws if the request itself is refused (not signed in, no permission, limit...). */
export async function sendSingleSms(
  phone: string,
  message: string,
  options: { purpose: SmsPurpose; senderId?: string }
): Promise<SmsResult> {
  const [result] = await sendSms([{ phone, message }], options);
  return result;
}

/** The provider's current balance, or null when the provider's reply has no readable balance. */
export async function getSmsBalance(): Promise<number | null> {
  const out = await request<{ balance: number | null }>('GET', '/balance');
  return out.balance;
}
