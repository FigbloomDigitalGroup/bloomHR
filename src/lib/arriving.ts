// Arriving from another Figbloom product ("Open Figbloom HR" in Fleet, Property or Schools): from the click until the
// first real page (the dashboard, or the sign-in form) the person sees one screen that never changes, the full-screen
// logo loader saying "Opening Figbloom HR". /handoff (src/pages/PlatformHandoff.tsx) sets a flag in this tab just
// before it opens the next page; index.html's boot screen and the full-screen FigbloomLoaders read it and say the same
// words, opaque and without fading in. It is cleared once no full-screen loader has been showing for a moment, that is,
// once a real page is on screen, so a flag left behind never changes a normal load for longer than its first page.

export const ARRIVING_KEY = 'fb-arriving'; // index.html reads the same key
export const ARRIVING_LABEL = 'Opening Figbloom HR';
const APP_TITLE = 'Figbloom HR'; // index.html's <title>
const SETTLE_MS = 600; // the same as FigbloomLoader's follow-on: a loader that comes this soon after another continues it

/** /handoff while it works (not its ?status= page), which is "arriving" before the flag exists. */
export function isHandoffWorking(pathname: string, search: string): boolean {
  return pathname === '/handoff' && !/[?&]status=/.test(search);
}

export function markArriving(): void {
  try {
    sessionStorage.setItem(ARRIVING_KEY, '1');
  } catch {
    /* storage blocked: the next page loads with its usual loaders */
  }
}

export function isArriving(): boolean {
  if (typeof window === 'undefined') return false;
  if (isHandoffWorking(window.location.pathname, window.location.search)) return true;
  try {
    return sessionStorage.getItem(ARRIVING_KEY) === '1';
  } catch {
    return false;
  }
}

export function clearArriving(): void {
  try {
    sessionStorage.removeItem(ARRIVING_KEY);
  } catch {
    /* nothing to clear */
  }
  if (typeof document !== 'undefined' && document.title === ARRIVING_LABEL) document.title = APP_TITLE;
}

let loadersShown = 0;
let settleTimer: ReturnType<typeof setTimeout> | undefined;

/** Clears the flag once no full-screen loader has shown for a moment: a real page is on screen. */
export function settleArrival(delay = SETTLE_MS): void {
  if (settleTimer !== undefined) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    settleTimer = undefined;
    if (loadersShown === 0) clearArriving();
  }, delay);
}

/** A full-screen loader is showing; call the function it returns when it goes. */
export function trackArrivalLoader(): () => void {
  loadersShown += 1;
  return () => {
    loadersShown -= 1;
    settleArrival();
  };
}
