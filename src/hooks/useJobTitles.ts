import { useEffect, useState } from 'react';
import { JobTitle, loadJobTitles } from '../lib/jobTitles';

/**
 * The company's job titles (everyone may read them), read when the page opens. Null while loading or if they could
 * not be read; forms then offer the titles employees already have.
 */
export function useJobTitles() {
  const [titles, setTitles] = useState<JobTitle[] | null>(null);

  useEffect(() => {
    let live = true;
    loadJobTitles()
      .then((next) => {
        if (live) setTitles(next);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return titles;
}

/** The active titles' names for a form's list, or null when there are none (the form keeps its own list). */
export const activeTitleNames = (titles: JobTitle[] | null, current?: string | null): string[] | null => {
  if (!titles?.length) return null;
  const names = titles.filter((t) => t.active).map((t) => t.name);
  // an employee already on an inactive title still sees it
  const cur = (current ?? '').trim();
  if (cur && !names.some((n) => n.toLowerCase() === cur.toLowerCase())) names.push(cur);
  return names.sort((a, b) => a.localeCompare(b));
};
