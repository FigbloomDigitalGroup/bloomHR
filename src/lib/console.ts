// The Figbloom console (stage 1): Figbloom's own pages for platform admins (Organisations, Platform rates), served by
// this same app on hostnames of its own. There App shows only the console (src/components/Console/ConsoleApp.tsx): no
// company, no staff portal, no company role. Who gets in is is_platform_admin(), and the database checks it again on
// every platform call, so the hostname only decides which app is shown, never what anyone may do.

/** The hostnames that open the console instead of the company app. */
export const CONSOLE_HOSTNAMES: readonly string[] = ['console.figbloom.org', 'console-staging.figbloom.org'];

// To try the console locally (`npm run dev` only): open any page with ?console=1, which is remembered in this browser
// until ?console=0. Production builds drop this, so no address other than the ones above opens the console.
export const CONSOLE_DEV_FLAG = 'figbloom.console';

function devOverride(): boolean {
  try {
    const asked = new URLSearchParams(window.location.search).get('console');
    if (asked === '1') localStorage.setItem(CONSOLE_DEV_FLAG, '1');
    if (asked === '0') localStorage.removeItem(CONSOLE_DEV_FLAG);
    return localStorage.getItem(CONSOLE_DEV_FLAG) === '1';
  } catch {
    return false; // storage blocked: the company app, as on any other address
  }
}

/** Whether this address opens the Figbloom console. */
export function isConsoleHost(hostname: string = window.location.hostname): boolean {
  if (CONSOLE_HOSTNAMES.includes(hostname.toLowerCase())) return true;
  return import.meta.env.DEV === true && devOverride();
}
