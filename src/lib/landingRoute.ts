import { LEGAL_PATHS, LEGAL_REVIEWED } from './legalGate';

// What opens at an address: the app, or the public landing page and legal pages. src/main.tsx asks before it loads
// anything else, so a visitor who only wants the landing page never downloads the app (sign-in, the database client,
// every screen). The rules are a pure function so they can be tested; main.tsx itself has no tests.
//
// The landing page only ever replaces the signed-OUT view of exactly "/". Everything that arrives there for another
// reason still reaches the app: the links Supabase sends back to the site root (email confirmation, password reset,
// errors) carry their tokens in the query or the hash, and email links carry ?tab=...

export type FrontDoor = 'landing' | 'legal' | 'app';

export interface FrontDoorInput {
  pathname: string;
  search: string;
  hash: string;
  /** the keys in localStorage, or null when storage is blocked (then nobody can tell whether someone is signed in) */
  storageKeys: string[] | null;
  /** opened from the home screen as an installed app: that is the app, whoever is signed in */
  standalone: boolean;
  /** VITE_LANDING_PAGE=off: everything behaves as it did before the landing page */
  switchedOff: boolean;
  /** the Privacy Policy and Terms are approved (src/lib/legalGate.ts) */
  legalLive: boolean;
}

// a stored sign-in: the same test index.html makes to decide whether to show the loader
const STORED_SIGN_IN = /^sb-.*-auth-token$/;
// all a link to the home page may carry: where the visitor came from
const MARKETING_PARAM = /^(utm_[a-z_]+|ref|gclid|fbclid)$/i;

export function frontDoor(input: FrontDoorInput): FrontDoor {
  if (input.switchedOff) return 'app';
  const path = input.pathname.replace(/\/+$/, '') || '/';

  if ((LEGAL_PATHS as readonly string[]).includes(path)) return input.legalLive ? 'legal' : 'app';
  if (path !== '/') return 'app';

  if (input.storageKeys === null || input.storageKeys.some((key) => STORED_SIGN_IN.test(key))) return 'app';
  if (input.standalone) return 'app';
  for (const key of new URLSearchParams(input.search).keys()) {
    if (!MARKETING_PARAM.test(key)) return 'app';
  }
  // "#features" is a place on the page; "#access_token=..." and "#error=..." are Supabase talking to the app
  if (/[=&?]/.test(input.hash)) return 'app';
  return 'landing';
}

/** The decision for the page that is open now. */
export function frontDoorFromWindow(): FrontDoor {
  let storageKeys: string[] | null = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) storageKeys.push(key);
    }
  } catch {
    storageKeys = null;
  }
  const installed =
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return frontDoor({
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    storageKeys,
    standalone: installed,
    switchedOff: import.meta.env.VITE_LANDING_PAGE === 'off',
    legalLive: LEGAL_REVIEWED,
  });
}
