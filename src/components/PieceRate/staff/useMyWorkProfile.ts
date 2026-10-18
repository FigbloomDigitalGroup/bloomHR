import { useEffect, useState } from 'react';
import { loadMyWorkProfile } from '../../../lib/myWorkApi';
import type { MyWorkProfile } from '../../../lib/myWork';

/**
 * The signed-in worker's piece-rate setup, for the staff portal: "My work" shows only when they are paid by work or
 * have contract jobs (profile.qualifies). Null while loading or when it can't be read (the section stays hidden).
 */
export function useMyWorkProfile(): MyWorkProfile | null {
  const [profile, setProfile] = useState<MyWorkProfile | null>(null);
  useEffect(() => {
    let live = true;
    loadMyWorkProfile()
      .then((p) => live && setProfile(p))
      .catch((e) => console.error('Could not load your work setup:', e));
    return () => {
      live = false;
    };
  }, []);
  return profile;
}
