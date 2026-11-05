import { supabase } from './supabase';
import { ApiError } from './adminApi';

// One-click sign-in from Figbloom Schools (ERP/SCHOOLS_HR_HANDOFF_CONTRACT.md, platform_handoff_routes.js).
//
// The backend sends the browser to /handoff with either a one-time sign-in token (a linked person), a status (off,
// invalid, no access, ...), or, the first time, a pending id ("connect"). The pending id is kept in this browser for
// the 10 minutes it is valid, in localStorage so it survives an invitation opened in another tab; after the person
// signs in to HR normally, the app asks them to confirm and then links their HR login (POST /platform/handoff/link,
// which also needs the HttpOnly cookie the backend set in this browser).

const API_URL =
  import.meta.env.VITE_API_URL || (import.meta.env.MODE === 'production' ? '/api' : 'http://localhost:3001/api');

const PENDING_KEY = 'figbloom.platformHandoff';
export const PENDING_MS = 10 * 60 * 1000;
export const DEFAULT_LANDING = '/dashboard';
const TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/;
// pages a handoff must never land on (the same list as the backend's safeReturnTo)
const NOT_A_LANDING = /^\/(api|iclock|handoff|login|mfa|auth|join|offer|update-password|create-company)(\/|$)/i;

/** A path on this site to open after signing in, or the dashboard: never another address (as the backend checks). */
export function safeNext(value: unknown, fallback = DEFAULT_LANDING): string {
  if (typeof value !== 'string') return fallback;
  const v = value.trim();
  if (!v || v.length > 512 || !v.startsWith('/') || v.startsWith('//') || v.includes('\\')) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(v)) return fallback;
  let u: URL;
  try {
    u = new URL(v, 'https://hr.invalid');
  } catch {
    return fallback;
  }
  if (u.origin !== 'https://hr.invalid' || NOT_A_LANDING.test(u.pathname)) return fallback;
  return `${u.pathname}${u.search}${u.hash}`;
}

// ---- the pending id, in this browser

export function savePendingHandoff(id: string, now = Date.now()) {
  if (!TOKEN_RE.test(id)) return;
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ id, until: now + PENDING_MS }));
  } catch {
    /* storage refused: the person can open HR from Schools again */
  }
}

export function loadPendingHandoff(now = Date.now()): string | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { id?: unknown; until?: unknown };
    if (typeof v.id === 'string' && TOKEN_RE.test(v.id) && typeof v.until === 'number' && v.until > now) return v.id;
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* unreadable: nothing pending */
  }
  return null;
}

export function clearPendingHandoff() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* nothing to clear */
  }
}

// ---- what /handoff was opened with

export type HandoffArrival =
  | { kind: 'signin'; tokenHash: string; next: string }
  | { kind: 'connect'; pending: string }
  | { kind: 'status'; status: string };

/** Reads /handoff's query (?status=) and fragment (#token_hash=&next= or #connect=). */
export function readArrival(search: string, hash: string): HandoffArrival {
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const tokenHash = fragment.get('token_hash') ?? '';
  if (/^[A-Za-z0-9_-]{8,200}$/.test(tokenHash)) return { kind: 'signin', tokenHash, next: safeNext(fragment.get('next')) };
  const pending = fragment.get('connect') ?? '';
  if (TOKEN_RE.test(pending)) return { kind: 'connect', pending };
  const status = new URLSearchParams(search).get('status') ?? '';
  return { kind: 'status', status: /^[a-z_]{1,40}$/.test(status) ? status : 'invalid' };
}

/** The page shown for each status the backend sends. */
export function statusMessage(status: string): { title: string; body: string } {
  switch (status) {
    case 'off':
      return {
        title: 'Not available yet',
        body: 'Opening Figbloom HR from Figbloom Schools isn\'t available yet. Sign in to HR directly in the meantime.',
      };
    case 'no_access':
      return { title: 'No access', body: 'You don\'t have access to HR for this school. Ask your HR administrator.' };
    case 'not_set_up':
      return {
        title: 'HR isn\'t set up for this school',
        body: 'Figbloom HR isn\'t set up for this school yet. Ask your Figbloom contact to switch HR & Payroll on.',
      };
    case 'error':
      return { title: 'Something went wrong', body: 'We couldn\'t open Figbloom HR just now. Go back to Figbloom Schools and try again.' };
    case 'invalid':
    default:
      return {
        title: 'This link has expired',
        body: 'Links from Figbloom Schools work once, for a minute. Go back to Figbloom Schools and click HR & Payroll again.',
      };
  }
}

// ---- the backend

export interface PendingPreview {
  outcome: 'ready';
  person_name: string | null;
  company_name: string | null;
}

export interface LinkResult {
  ok: true;
  outcome: 'linked' | 'already_linked';
  company_name: string | null;
  return_to: string;
}

async function call<T>(method: string, path: string, body: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError('You are not signed in', 401, 'not_signed_in');
  let response: Response;
  try {
    response = await fetch(`${API_URL}/platform/handoff${path}`, {
      method,
      // the cookie that ties the pending handoff to this browser
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Could not reach the server. Try again.', 0, 'unreachable');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload?.error;
    const message = typeof error === 'string' ? error : typeof error?.message === 'string' ? error.message : '';
    throw new ApiError(message || `Request failed (${response.status})`, response.status, typeof error?.code === 'string' ? error.code : undefined);
  }
  if (!payload || typeof payload !== 'object') throw new ApiError('The server did not answer. Try again.', response.status, 'unavailable');
  return payload as T;
}

export const handoffApi = {
  preview: (pending: string) => call<PendingPreview>('POST', '/pending', { pending }),
  link: (pending: string) => call<LinkResult>('POST', '/link', { pending }),
  unlink: (source = 'schools') => call<{ ok: true; removed: number }>('DELETE', '/link', { source }),
};

export interface ExternalLogin {
  source: string;
  linked_at: string;
}

/** The signed-in person's own links in the company they are working in (row-level security shows only theirs). */
export async function loadMyExternalLogins(): Promise<ExternalLogin[]> {
  const { data, error } = await supabase.from('external_logins').select('source, linked_at').order('linked_at');
  if (error) throw new Error(error.message);
  return (data ?? []) as ExternalLogin[];
}

export const sourceLabel = (source: string) => (source === 'schools' ? 'Figbloom Schools' : source);
