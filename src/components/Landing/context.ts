import { createContext, useContext } from 'react';
import type { PreviewKey } from '../../lib/landing';

// What the sections of the landing page share through the page.

export interface LandingState {
  /** the tab open in the feature showcase; the header's Features list can open another */
  tab: PreviewKey;
  setTab: (tab: PreviewKey) => void;
  /** this visitor wants less motion (src/components/Landing/hooks.ts) */
  reduce: boolean;
}

export const LandingContext = createContext<LandingState>({ tab: 'people', setTab: () => undefined, reduce: false });
export const useLanding = () => useContext(LandingContext);
