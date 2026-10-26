// Signing people out after a spell away. The last activity is kept in localStorage, which every tab shares, so working
// in one tab keeps the others signed in, and a tab left open in the background doesn't sign out a person who is busy
// in another one. How long is the company's "stay signed in" setting (migration 20261026100000, 7 days unless changed).
export const IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
/** while the company's setting can't be read: the old, stricter limit */
export const FALLBACK_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const IDLE_WARNING_MS = 60 * 1000;
const KEY = 'lastActivityAt';

export function markActivity(now = Date.now()): void {
  try {
    localStorage.setItem(KEY, String(now));
  } catch {
    // storage blocked: this tab's own timer still works, it just isn't shared
  }
}

export function lastActivity(): number | null {
  try {
    const at = Number(localStorage.getItem(KEY));
    return at > 0 ? at : null;
  } catch {
    return null;
  }
}

// Measured from the clock rather than counted by a timer, so a laptop that slept past the limit signs out on waking
export function idleState(now: number, last: number | null, timeoutMs = IDLE_TIMEOUT_MS): 'active' | 'warn' | 'expired' {
  if (last === null) return 'active';
  const idle = now - last;
  if (idle >= timeoutMs) return 'expired';
  if (idle >= timeoutMs - IDLE_WARNING_MS) return 'warn';
  return 'active';
}
