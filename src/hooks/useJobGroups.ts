import { useEffect, useState } from 'react';
import { JobGroup, loadJobGroups } from '../lib/jobGroups';

/**
 * The company's job groups with their current amounts, read when the page opens. Null while loading or when the
 * person may not see them (only ADMIN, Payroll and Employees may); forms then keep the free-text "Job Group".
 */
export function useJobGroups() {
  const [groups, setGroups] = useState<JobGroup[] | null>(null);

  useEffect(() => {
    let live = true;
    loadJobGroups().then((next) => {
      if (live) setGroups(next);
    });
    return () => {
      live = false;
    };
  }, []);

  return groups;
}
