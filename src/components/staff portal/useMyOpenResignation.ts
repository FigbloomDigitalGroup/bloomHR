import { useEffect, useState } from 'react';
import { findOpenExit, loadMyExit, type ExitRecord } from '../../lib/exits';

/**
 * My resignation still under way (sent, accepted, or serving notice through clearance), or null when there is none.
 * Loads once; a failure to load just shows nothing (the Resignation page itself reports errors).
 */
export function useMyOpenResignation(): ExitRecord | null {
  const [open, setOpen] = useState<ExitRecord | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadMyExit()
      .then((state) => {
        if (!cancelled) setOpen(findOpenExit(state.exits) ?? null);
      })
      .catch(() => {
        if (!cancelled) setOpen(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return open;
}
