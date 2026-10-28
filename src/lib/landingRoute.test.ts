import { afterEach, describe, expect, it, vi } from 'vitest';
import { frontDoor, frontDoorFromWindow, type FrontDoorInput } from './landingRoute';
import { LEGAL_PATHS } from './legalGate';

const signedOutAtHome: FrontDoorInput = {
  pathname: '/',
  search: '',
  hash: '',
  storageKeys: ['figbloom.a11y'],
  standalone: false,
  switchedOff: false,
  legalLive: false,
};
const door = (over: Partial<FrontDoorInput> = {}) => frontDoor({ ...signedOutAtHome, ...over });

describe('who sees the landing page', () => {
  it('a signed-out visitor to the home page does', () => {
    expect(door()).toBe('landing');
    expect(door({ storageKeys: [] })).toBe('landing');
  });

  it('a stored sign-in goes to the app, so signed-in people never see it', () => {
    expect(door({ storageKeys: ['sb-abcdefgh-auth-token'] })).toBe('app');
    expect(door({ storageKeys: ['figbloom_theme', 'sb-xyz-auth-token'] })).toBe('app');
  });

  it('blocked storage goes to the app: nobody can tell whether someone is signed in', () => {
    expect(door({ storageKeys: null })).toBe('app');
  });

  it('only the home page: every other address is the app', () => {
    for (const pathname of ['/login', '/create-company', '/join', '/offer', '/mfa', '/dashboard', '/staff', '/careers/acme', '/update-password']) {
      expect(door({ pathname })).toBe('app');
    }
  });

  it('where a visitor came from does not stop it, but any other query does', () => {
    expect(door({ search: '?utm_source=whatsapp&utm_campaign=launch' })).toBe('landing');
    expect(door({ search: '?ref=newsletter&fbclid=abc&gclid=def' })).toBe('landing');
    // email links to the staff portal and Supabase's own links carry other keys
    expect(door({ search: '?tab=payslips' })).toBe('app');
    expect(door({ search: '?code=pkce-code' })).toBe('app');
    expect(door({ search: '?type=recovery' })).toBe('app');
    expect(door({ search: '?utm_source=x&token_hash=abc' })).toBe('app');
  });

  it('a place on the page is fine; a link from Supabase in the hash is not', () => {
    expect(door({ hash: '#features' })).toBe('landing');
    expect(door({ hash: '#' })).toBe('landing');
    expect(door({ hash: '#access_token=a&refresh_token=b&type=signup' })).toBe('app');
    expect(door({ hash: '#type=recovery&access_token=a' })).toBe('app');
    expect(door({ hash: '#error=access_denied&error_code=otp_expired' })).toBe('app');
  });

  it('a trailing slash is the same address', () => {
    expect(door({ pathname: '//' })).toBe('landing');
    expect(door({ pathname: '/login/' })).toBe('app');
  });

  it('an installed app opens the app, not marketing', () => {
    expect(door({ standalone: true })).toBe('app');
  });

  it('the off switch brings back the old front door everywhere', () => {
    expect(door({ switchedOff: true })).toBe('app');
    expect(door({ switchedOff: true, pathname: '/privacy', legalLive: true })).toBe('app');
  });
});

describe('the legal pages', () => {
  it('are off until they are approved: the address belongs to the app, as before', () => {
    for (const pathname of LEGAL_PATHS) expect(door({ pathname })).toBe('app');
  });

  it('open for anyone once approved, signed in or not', () => {
    for (const pathname of LEGAL_PATHS) {
      expect(door({ pathname, legalLive: true })).toBe('legal');
      expect(door({ pathname, legalLive: true, storageKeys: ['sb-abc-auth-token'] })).toBe('legal');
      expect(door({ pathname: `${pathname}/`, legalLive: true })).toBe('legal');
    }
  });
});

describe('reading the page that is open', () => {
  const at = (address: string) => window.history.replaceState(null, '', address);

  afterEach(() => {
    window.localStorage.clear();
    at('/');
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    // jsdom has no matchMedia, and no navigator.standalone: put both back to "absent"
    delete (window as { matchMedia?: unknown }).matchMedia;
    delete (navigator as { standalone?: boolean }).standalone;
  });

  it('a fresh browser at the home page gets the landing page', () => {
    vi.stubEnv('VITE_LANDING_PAGE', 'on');
    at('/?utm_source=test#how');
    expect(frontDoorFromWindow()).toBe('landing');
  });

  it('a browser with a stored sign-in gets the app', () => {
    window.localStorage.setItem('sb-project-auth-token', '{}');
    expect(frontDoorFromWindow()).toBe('app');
  });

  // each of these would still say "landing" if the function read an empty query, an empty hash or the wrong path
  it('reads the address as well as the browser: a link from Supabase or an email at the home page gets the app', () => {
    at('/#access_token=a&type=recovery');
    expect(frontDoorFromWindow()).toBe('app');
    at('/?code=pkce-code');
    expect(frontDoorFromWindow()).toBe('app');
    at('/?tab=payslips');
    expect(frontDoorFromWindow()).toBe('app');
    at('/login');
    expect(frontDoorFromWindow()).toBe('app');
    at('/privacy'); // not approved yet
    expect(frontDoorFromWindow()).toBe('app');
  });

  it('blocked storage gets the app', () => {
    vi.spyOn(Storage.prototype, 'length', 'get').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    expect(frontDoorFromWindow()).toBe('app');
  });

  it('an installed app gets the app, however the browser says so', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: query === '(display-mode: standalone)' })) as unknown as typeof window.matchMedia;
    expect(frontDoorFromWindow()).toBe('app');
    delete (window as { matchMedia?: unknown }).matchMedia;

    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    expect(frontDoorFromWindow()).toBe('app');
  });

  it('the off switch in the environment brings back the old front door', () => {
    vi.stubEnv('VITE_LANDING_PAGE', 'off');
    expect(frontDoorFromWindow()).toBe('app');
  });
});
