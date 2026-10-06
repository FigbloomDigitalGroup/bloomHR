// After a new version is deployed, a tab that was opened before it still asks for the old page files, which no
// longer exist ("Failed to fetch dynamically imported module"). A reload fetches the new ones, so do that once
// automatically instead of showing "Something went wrong".
const KEY = 'stale_chunk_reload_at';
const WINDOW_MS = 30_000;

export function isStaleChunkError(error: unknown): boolean {
  const message = typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: unknown }).message) : String(error ?? '');
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError/i.test(message);
}

/** Reloads the page once per 30 seconds; returns whether it did (false means "already tried, show the error"). */
export function reloadOnceForStaleChunk(now: number = Date.now(), reload: () => void = () => window.location.reload()): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (last && now - last < WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(now));
  } catch {
    return false; // cannot remember that we tried, so do not risk a reload loop
  }
  reload();
  return true;
}
