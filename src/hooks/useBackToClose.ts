import { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';

// The phone's Back button and gesture close what is open on top of the page first (the menu, a drawer, a dialog),
// and in the installed app the first Back on the start page asks before leaving.
//
// How: an overlay that opens adds a history entry with the same address, marked as its own. Back removes that
// entry, the browser says so (popstate) and the overlay closes. An overlay closed another way (its X, Escape, a
// tap outside) takes its entry back off, so no stray entries are left and Back never needs pressing twice.
//
// One history is shared by every overlay, so all of this is kept here, once, rather than in each hook:
// - entries are numbered by depth (a dialog over a drawer is 2), and Back closes every overlay above where it lands;
// - while we are stepping back ourselves, other steps wait their turn (pushing during a step back would land wrong);
// - an entry left behind by an overlay that closed while a page was opened over it is skipped when Back reaches it.

const OVERLAY = '__overlay';
const GUARD = '__exitGuard';
const SETTLE_MS = 800;
export const EXIT_WINDOW_MS = 2000;

interface OverlayEntry {
  token: string;
  depth: number;
}

interface LiveOverlay {
  token: string;
  depth: number;
  /** its entry is in the history (it may wait its turn while we step back) */
  pushed: boolean;
  close: () => void;
}

type HistoryState = Record<string, unknown> | null;

const live: LiveOverlay[] = [];
const queue: Array<() => void> = [];
// steps back we started ourselves and have not heard about yet
let ownPops = 0;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let listening = false;
let counter = 0;

// the installed app's start page guard (one owner at a time: the staff portal or the admin app)
let guard: { atHome: () => boolean; goHome: () => void } | null = null;
let exitWindow: ReturnType<typeof setTimeout> | null = null;

const state = (): HistoryState => (typeof window === 'undefined' ? null : (window.history.state as HistoryState));
const entryOf = (s: HistoryState): OverlayEntry | null => {
  const e = s?.[OVERLAY];
  return e && typeof e === 'object' ? (e as OverlayEntry) : null;
};
const idxOf = (s: HistoryState): number | null => (typeof s?.idx === 'number' ? (s.idx as number) : null);

/** True when the current history entry belongs to an open overlay: opening a page from it should replace it. */
export function onOverlayEntry(): boolean {
  return entryOf(state()) !== null;
}

/** The app runs installed (added to the home screen), where Back on the first page closes the app. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const media = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  return media || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Whether there is an earlier page of this app to go back to. React Router numbers its entries (idx), the first
 * one 0; without that number (tests with a memory router) the first entry's key is 'default'.
 */
export function canGoBackInApp(locationKey: string): boolean {
  const idx = idxOf(state());
  if (idx !== null) return idx > 0;
  return locationKey !== 'default';
}

function settle() {
  if (settleTimer) clearTimeout(settleTimer);
  // a step back that never reports (it should) must not hold up everything after it
  settleTimer = setTimeout(() => {
    settleTimer = null;
    ownPops = 0;
    flush();
  }, SETTLE_MS);
}

function stepBack() {
  ownPops += 1;
  settle();
  window.history.back();
}

function flush() {
  while (ownPops === 0 && queue.length) queue.shift()!();
}

function run(op: () => void) {
  if (ownPops > 0) queue.push(op);
  else op();
}

function push(overlay: LiveOverlay) {
  if (!live.includes(overlay)) return; // closed again before its turn came
  const s = state() ?? {};
  const top = entryOf(s);
  const parent = top ? live.find((l) => l.token === top.token) : undefined;
  overlay.depth = (parent?.depth ?? 0) + 1;
  overlay.pushed = true;
  const idx = idxOf(s);
  window.history.pushState(
    { ...s, ...(idx !== null ? { idx: idx + 1 } : {}), [OVERLAY]: { token: overlay.token, depth: overlay.depth } },
    '',
  );
}

function release(overlay: LiveOverlay) {
  const i = live.indexOf(overlay);
  if (i < 0) return; // Back already closed it and took its entry
  live.splice(i, 1);
  run(() => {
    // only our own entry is taken off: if a page was opened over it, it stays and is skipped later
    if (entryOf(state())?.token === overlay.token) stepBack();
  });
}

function armGuard() {
  run(() => {
    if (!guard || exitWindow) return;
    const s = state();
    if (idxOf(s) !== 0 || s?.[GUARD] || entryOf(s)) return;
    window.history.pushState({ ...s, idx: 1, [GUARD]: true }, '');
  });
}

function onFirstEntry() {
  if (!guard) return;
  if (!guard.atHome()) {
    // the first page was not the start page (opened from a link): Back goes to the start page
    guard.goHome();
    setTimeout(armGuard, 0);
    return;
  }
  if (exitWindow) return;
  toast('Press back again to exit', { id: 'exit-app', duration: EXIT_WINDOW_MS });
  exitWindow = setTimeout(() => {
    exitWindow = null;
    armGuard();
  }, EXIT_WINDOW_MS);
}

function onPopState() {
  const own = ownPops > 0;
  if (own) {
    ownPops -= 1;
    if (ownPops === 0 && settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
  }

  const s = state();
  const entry = entryOf(s);
  const depth = entry ? live.find((l) => l.token === entry.token)?.depth ?? entry.depth : 0;
  // Back closes every overlay above the entry it landed on, the top one first
  const above = live.filter((l) => l.pushed && l.depth > depth).reverse();
  for (const l of above) {
    live.splice(live.indexOf(l), 1);
    l.close();
  }

  if (!own && entry && !live.some((l) => l.token === entry.token)) {
    // a leftover entry of an overlay that is gone: skip it, so Back goes where it looks like it should
    window.history.back();
    return;
  }

  if (!own && above.length === 0 && guard && idxOf(s) === 0 && !s?.[GUARD]) onFirstEntry();
  else if (guard && idxOf(s) === 0) armGuard();

  if (ownPops === 0) flush();
}

function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('popstate', onPopState);
}

/**
 * While `open`, the phone's Back closes the overlay (calls `onClose`) instead of leaving the page. Closing it any
 * other way removes the history entry it added.
 */
export function useBackToClose(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    listen();
    counter += 1;
    const overlay: LiveOverlay = {
      token: `${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 8)}`,
      depth: Number.MAX_SAFE_INTEGER,
      pushed: false,
      close: () => closeRef.current(),
    };
    live.push(overlay);
    run(() => push(overlay));
    return () => release(overlay);
  }, [open]);
}

/**
 * In the installed app only: on the first page, the first Back says "Press back again to exit" and only a second
 * Back within two seconds leaves. If the first page is not the start page, Back goes to the start page first.
 * In a browser tab Back is never held.
 */
export function useExitGuard(atHome: boolean, goHome: () => void) {
  const atHomeRef = useRef(atHome);
  atHomeRef.current = atHome;
  const goHomeRef = useRef(goHome);
  goHomeRef.current = goHome;

  useEffect(() => {
    if (!isStandalone()) return;
    listen();
    const mine = { atHome: () => atHomeRef.current, goHome: () => goHomeRef.current() };
    guard = mine;
    armGuard();
    return () => {
      if (guard === mine) guard = null;
    };
  }, []);
}

/** Tests only: forget every overlay and pending step. */
export function resetBackToCloseForTests() {
  live.length = 0;
  queue.length = 0;
  ownPops = 0;
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = null;
  if (exitWindow) clearTimeout(exitWindow);
  exitWindow = null;
  guard = null;
}
