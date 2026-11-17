// "Sign in with Figbloom" (ERP/HR_COGNITO_CONTRACT.md section 2). The app sends the browser to Figbloom's sign-in
// page (Cognito managed login) with PKCE; it comes back to /auth/figbloom (customers) or /auth/staff/callback (the
// console's Figbloom staff) with a code, which the API swaps for a one-time sign-in token
// (POST /api/auth/cognito/exchange); verifying that token gives the person's usual Supabase session. The code
// verifier and state live in sessionStorage for that round trip only.
//
// Settings (public build settings; none is a secret):
//   VITE_FIGBLOOM_SIGN_IN=on           the switch (with the API's COGNITO_SIGN_IN)
//   VITE_COGNITO_CUSTOMERS_DOMAIN      https://<prefix>.auth.eu-west-1.amazoncognito.com
//   VITE_HR_SIGNIN_CLIENT_ID           the hr-signin app client
//   VITE_COGNITO_STAFF_DOMAIN, VITE_HR_CONSOLE_CLIENT_ID   the same for the console's staff

export type FigbloomPool = 'customers' | 'staff';

const STORAGE_KEY = 'hr:figbloom-sign-in';
const SCOPES = 'openid email profile';
const API_BASE: string =
  import.meta.env.VITE_API_URL || (import.meta.env.MODE === 'production' ? '/api' : 'http://localhost:3001/api');

// Written out in full: Vite only fills in VITE_* settings it can see by name.
const POOLS: Record<FigbloomPool, { domain?: string; clientId?: string; callback: string; signOut: string }> = {
  customers: {
    domain: import.meta.env.VITE_COGNITO_CUSTOMERS_DOMAIN,
    clientId: import.meta.env.VITE_HR_SIGNIN_CLIENT_ID,
    callback: '/auth/figbloom',
    signOut: '/login',
  },
  staff: {
    domain: import.meta.env.VITE_COGNITO_STAFF_DOMAIN,
    clientId: import.meta.env.VITE_HR_CONSOLE_CLIENT_ID,
    callback: '/auth/staff/callback',
    signOut: '/',
  },
};

export const figbloomSignInEnabled = (): boolean => import.meta.env.VITE_FIGBLOOM_SIGN_IN === 'on';

function config(pool: FigbloomPool) {
  const { domain, clientId, callback } = POOLS[pool];
  if (!domain || !clientId) return null;
  return { domain: domain.replace(/\/+$/, ''), clientId, redirectUri: `${window.location.origin}${callback}` };
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = (size: number) => base64url(crypto.getRandomValues(new Uint8Array(size)));

/** Off to Figbloom's sign-in page. next: a path to open afterwards. Throws when the pool isn't set up here. */
export async function startFigbloomSignIn(pool: FigbloomPool, next?: string | null): Promise<void> {
  const c = config(pool);
  if (!c) throw new Error("Figbloom sign-in isn't set up on this site yet. Please contact Figbloom support.");
  const verifier = randomString(48); // 64 characters
  const state = randomString(24);
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ pool, state, verifier, next: next ?? null }));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  window.location.assign(`${c.domain}/oauth2/authorize?${params}`);
}

export interface FigbloomReturn {
  pool: FigbloomPool;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  next: string | null;
}

/** What came back to the callback page, checked against what was sent; single use. */
export function readFigbloomReturn(pool: FigbloomPool, query: URLSearchParams): FigbloomReturn | { error: string } {
  let saved: { pool?: string; state?: string; verifier?: string; next?: string | null } | null = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    saved = null;
  }
  const cognitoError = query.get('error');
  if (cognitoError) {
    return { error: cognitoError === 'access_denied' ? 'Sign-in was cancelled.' : "Figbloom couldn't sign you in. Please try again." };
  }
  const code = query.get('code');
  const c = config(pool);
  if (!code || !c || !saved?.verifier || saved.pool !== pool || !saved.state || saved.state !== query.get('state')) {
    return { error: 'This sign-in link has expired. Please sign in again.' };
  }
  return { pool, code, codeVerifier: saved.verifier, redirectUri: c.redirectUri, next: saved.next ?? null };
}

/** The API's half: the code for a one-time sign-in token, or an Error with the API's message and code. */
export async function exchangeFigbloomCode(back: FigbloomReturn): Promise<{ tokenHash: string; firstSignIn: boolean }> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/auth/cognito/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pool: back.pool, code: back.code, codeVerifier: back.codeVerifier, redirectUri: back.redirectUri }),
    });
  } catch {
    throw new Error("We couldn't reach Figbloom HR. Check your internet connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data?.tokenHash !== 'string') {
    throw Object.assign(new Error(data?.error?.message || 'Sign-in failed. Please try again.'), { code: data?.error?.code });
  }
  return { tokenHash: data.tokenHash, firstSignIn: !!data.firstSignIn };
}

/** Where to send the browser so Figbloom's own sign-in ends too, or null. */
export function figbloomLogoutUrl(pool: FigbloomPool): string | null {
  const c = config(pool);
  if (!c) return null;
  const params = new URLSearchParams({ client_id: c.clientId, logout_uri: `${window.location.origin}${POOLS[pool].signOut}` });
  return `${c.domain}/logout?${params}`;
}
