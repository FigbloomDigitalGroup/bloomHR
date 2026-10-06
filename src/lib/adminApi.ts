import { supabase } from './supabase';

// Client for the backend admin API (admin_routes.js). It authenticates with the
// caller's own session token; the service-role key never reaches the browser.
const API_URL =
  import.meta.env.VITE_API_URL || (import.meta.env.MODE === 'production' ? '/api' : 'http://localhost:3001/api');

export interface AdminUser {
  id: string;
  email: string;
  role: string;
  account_status: string;
  last_sign_in_at: string | null;
  created_at: string;
  location: string | null;
  branch: string | null;
  user_metadata: Record<string, any>;
}

export interface AuthUserSummary {
  id: string;
  email: string;
  user_metadata: Record<string, any>;
}

export interface CreateUserInput {
  email: string;
  password: string;
  role: string;
  account_status?: string;
  location?: string | null;
  branch?: string | null;
}

export interface UpdateUserInput {
  email?: string;
  password?: string;
  role?: string;
  account_status?: string;
  location?: string | null;
  branch?: string | null;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('You are not signed in');

  let response: Response;
  try {
    response = await fetch(`${API_URL}/admin${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the server. Is the backend running?');
  }

  // Where no backend is deployed, the website itself answers (its home page, status 200): that is not JSON
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error((payload && payload.error) || `Request failed (${response.status})`);
  if (payload === null || typeof payload !== 'object') throw new Error(BACKEND_UNAVAILABLE);
  return payload as T;
}

export const BACKEND_UNAVAILABLE =
  'The user-management service is not available yet (the backend is not deployed or VITE_API_URL is not set).';

/** The list a response should carry, or a clear error instead of an undefined that crashes the screen. */
function listOf<T>(value: unknown): T[] {
  if (!Array.isArray(value)) throw new Error(BACKEND_UNAVAILABLE);
  return value as T[];
}

export const adminApi = {
  listUsers: () => request<{ users: AdminUser[] }>('GET', '/users').then((r) => listOf<AdminUser>(r.users)),
  listAuthUsers: () => request<{ users: AuthUserSummary[] }>('GET', '/auth-users').then((r) => listOf<AuthUserSummary>(r.users)),
  createUser: (input: CreateUserInput) => request<{ user: AdminUser }>('POST', '/users', input).then((r) => r.user),
  updateUser: (id: string, input: UpdateUserInput) =>
    request<{ user: AdminUser }>('PATCH', `/users/${id}`, input).then((r) => r.user),
  deleteUser: (id: string) => request<{ ok: true }>('DELETE', `/users/${id}`),
  sendResetEmail: (id: string, redirectTo?: string) =>
    request<{ ok: true }>('POST', `/users/${id}/reset-email`, { redirectTo }),
};
