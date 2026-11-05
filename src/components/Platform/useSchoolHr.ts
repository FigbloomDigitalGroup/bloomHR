import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  enableSchoolHr, indexSchoolHr, listSchoolHr, platformNotConnected, withSchoolHr, type SchoolHr,
} from '../../lib/platformSchoolHr';

// The HR & Payroll state of every school, for SchoolHrCell (SchoolHr.tsx) on the Schools and School groups pages.

const POLL_MS = 10 * 1000;
const MAX_POLLS = 6; // a minute of "Enabling" before it waits for a reload

export interface SchoolHrData {
  /** undefined while loading; null when the platform couldn't be asked */
  list: SchoolHr[] | null | undefined;
  /** the platform isn't connected to the console (a setting) */
  notConnected: boolean;
  bySchoolsId: Map<string, SchoolHr>;
  byPlatformId: Map<string, SchoolHr>;
  enable: (school: SchoolHr) => Promise<SchoolHr>;
}

/** Every school's HR state, loaded once `enabled` (the caller is a platform admin), refreshed while any is enabling. */
export function useSchoolHr(enabled: boolean): SchoolHrData {
  const [list, setList] = useState<SchoolHr[] | null | undefined>(undefined);
  const [notConnected, setNotConnected] = useState(false);
  const polls = useRef(0);

  const load = useCallback(async () => {
    try {
      setList((await listSchoolHr()).schools);
      setNotConnected(false);
    } catch (err) {
      setNotConnected(platformNotConnected(err));
      setList(null); // the page still shows; HR shows as —
    }
  }, []);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  // HR links the school's company a few seconds after it is switched on
  const enabling = !!list?.some((s) => s.hr.state === 'enabling');
  useEffect(() => {
    if (!enabling || polls.current >= MAX_POLLS) return;
    const timer = setTimeout(() => {
      polls.current += 1;
      void load();
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [enabling, list, load]);

  const enable = useCallback(async (school: SchoolHr) => {
    const updated = await enableSchoolHr(school.platform_tenant_id);
    polls.current = 0;
    setList((l) => (l ? withSchoolHr(l, updated) : l));
    return updated;
  }, []);

  const { bySchoolsId, byPlatformId } = useMemo(() => indexSchoolHr(list ?? []), [list]);
  return { list, notConnected, bySchoolsId, byPlatformId, enable };
}

