import { supabase } from './supabase';

// Two-step sign-in (FIG-834). The server (mfa_routes.js) makes, sends and checks the code and records the pass for
// this sign-in; the browser only asks for a code and hands back what the person typed. The company's setting is read
// and changed through database functions (migration 20261016010000).
const API_URL =
  import.meta.env.VITE_API_URL || (import.meta.env.MODE === 'production' ? '/api' : 'http://localhost:3001/api');

export type TwoStepMode = 'off' | 'privileged' | 'everyone';
export type TwoStepMethod = 'email' | 'sms';

export interface CodeSent {
  /** false when a code already on its way was reused (a page reload) */
  sent: boolean;
  method: TwoStepMethod;
  /** masked: j***@company.com or +254 *** *** 678 */
  destination: string;
  expiresAt: string;
  /** seconds before another code may be asked for */
  resendIn: number;
}

/** Why the server said no: 'wrong', 'expired', 'too_many', 'none', 'cooldown', 'rate_limited', 'not_required', ... */
export class MfaError extends Error {
  constructor(
    message: string,
    public status: number,
    public reason?: string,
    public attemptsLeft?: number,
    public retryAfter?: number
  ) {
    super(message);
  }
}

async function request<T>(path: string, body: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new MfaError('You are not signed in', 401);

  let response: Response;
  try {
    response = await fetch(`${API_URL}/mfa${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new MfaError('Could not reach the server. Check your connection and try again.', 0);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new MfaError(payload.error || `Request failed (${response.status})`, response.status, payload.reason, payload.attemptsLeft, payload.retryAfter);
  }
  return payload as T;
}

/** Sends a code (or, unless `resend`, reuses the one already sent to this sign-in). */
export const sendMfaCode = (resend = false) => request<CodeSent>('/send', { resend });

/** Checks a code; resolves when it was right, throws MfaError otherwise. */
export const verifyMfaCode = (code: string) => request<{ verified: true }>('/verify', { code });

export interface TwoStepSettings {
  mode: TwoStepMode;
  method: TwoStepMethod;
  /** only an ADMIN may change it */
  can_edit: boolean;
}

/** The company's setting; null when it cannot be read. */
export async function loadTwoStepSettings(): Promise<TwoStepSettings | null> {
  const { data, error } = await supabase.rpc('two_step_settings');
  if (error) return null;
  return ((Array.isArray(data) ? data[0] : data) as TwoStepSettings | undefined) ?? null;
}

/** Saves the company's setting (ADMIN). Throws with the reason when refused. */
export async function saveTwoStepSettings(mode: TwoStepMode, method: TwoStepMethod): Promise<TwoStepSettings> {
  const { data, error } = await supabase.rpc('set_two_step_settings', { p_mode: mode, p_method: method });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data[0] : data) as TwoStepSettings;
}

// ---------------------------------------------------------------------------------------------
// how long people stay signed in (migration 20261026100000): the idle limit, and how long a passed code is trusted
// ---------------------------------------------------------------------------------------------

export const STAY_SIGNED_IN_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 30, label: '30 minutes' },
  { minutes: 480, label: '8 hours' },
  { minutes: 1440, label: '1 day' },
  { minutes: 10080, label: '7 days' },
];

export interface StaySignedIn {
  minutes: number;
  /** people whose role has Sign-in security */
  can_edit: boolean;
}

/** The company's setting; null when it cannot be read. */
export async function loadStaySignedIn(): Promise<StaySignedIn | null> {
  const { data, error } = await supabase.rpc('stay_signed_in_settings');
  if (error) return null;
  return ((Array.isArray(data) ? data[0] : data) as StaySignedIn | undefined) ?? null;
}

/** Saves the company's setting. Throws with the reason when refused. */
export async function saveStaySignedIn(minutes: number): Promise<StaySignedIn> {
  const { data, error } = await supabase.rpc('set_stay_signed_in', { p_minutes: minutes });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data[0] : data) as StaySignedIn;
}

// ---------------------------------------------------------------------------------------------
// a person's own setting (FIG-891, migration 20261018500000)
// ---------------------------------------------------------------------------------------------

export interface MyTwoStep {
  enabled: boolean;
  method: TwoStepMethod;
  /** the company asks it of them: it can't be turned off */
  company_requires: boolean;
  company_method: TwoStepMethod;
}

export async function loadMyTwoStep(): Promise<MyTwoStep | null> {
  const { data, error } = await supabase.rpc('my_two_step');
  if (error) return null;
  return ((Array.isArray(data) ? data[0] : data) as MyTwoStep | undefined) ?? null;
}

export async function saveMyTwoStep(enabled: boolean, method: TwoStepMethod): Promise<MyTwoStep> {
  const { data, error } = await supabase.rpc('set_my_two_step', { p_enabled: enabled, p_method: method });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data[0] : data) as MyTwoStep;
}

export interface TwoStepPerson {
  user_id: string;
  name: string | null;
  email: string | null;
  method: TwoStepMethod;
}

/** ADMIN: who turned it on for themselves; [] when it cannot be read. */
export async function loadTwoStepPeople(): Promise<TwoStepPerson[]> {
  const { data, error } = await supabase.rpc('two_step_people');
  if (error) return [];
  return (data || []) as TwoStepPerson[];
}

/** ADMIN: turns someone's own setting off and removes their registered SMS number (they lost access). */
export async function resetTwoStep(userId: string): Promise<void> {
  const { error } = await supabase.rpc('reset_two_step', { p_user: userId });
  if (error) throw new Error(error.message);
}
