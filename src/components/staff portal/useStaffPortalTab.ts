import { useCallback, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { onOverlayEntry, useExitGuard } from '../../hooks/useBackToClose';

/** The address parameter that holds the staff portal's section: /staff?tab=payslips. No parameter is home. */
export const STAFF_TAB_PARAM = 'tab';
export const STAFF_HOME = 'home';

/** params: more for the section to read, e.g. My team's { view: 'work' } (a notification opening it there) */
export type SetStaffTab = (tab: string, options?: { replace?: boolean; params?: Record<string, string> }) => void;

/** The address of a staff portal section, on the page the portal is shown on. */
export function staffTabSearch(tab: string, params: Record<string, string> = {}): string {
  if (tab === STAFF_HOME) return '';
  return `?${new URLSearchParams({ [STAFF_TAB_PARAM]: tab, ...params }).toString()}`;
}

/**
 * The staff portal's open section, kept in the address. Opening a section adds a history entry, so the phone's
 * Back returns to the previous section, a refresh stays on the same one, and a link can open any section.
 * Opening one from the phone menu replaces the menu's own entry, so Back does not land on the closed menu.
 * In the installed app, Back on home asks before leaving (useExitGuard).
 */
export function useStaffPortalTab(): [string, SetStaffTab] {
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const activeTab = params.get(STAFF_TAB_PARAM) || STAFF_HOME;
  const current = useRef(activeTab);
  current.current = activeTab;

  const setActiveTab = useCallback<SetStaffTab>(
    (tab, options) => {
      if (tab === current.current && !options?.replace && !options?.params) return;
      navigate({ pathname, search: staffTabSearch(tab, options?.params) }, { replace: !!options?.replace || onOverlayEntry() });
    },
    [navigate, pathname],
  );

  useExitGuard(activeTab === STAFF_HOME, () => setActiveTab(STAFF_HOME, { replace: true }));

  return [activeTab, setActiveTab];
}
