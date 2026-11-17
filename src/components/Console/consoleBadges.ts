import { createContext, useContext, useEffect } from 'react';

// The console menu's count badges (Organisations: waiting for approval; Schools: needing attention). No extra calls:
// a page that has loaded the numbers anyway publishes them here, and the menu shows them from then on. Outside the
// console (the company app shows these pages too) there is no provider and publishing does nothing.

export interface ConsoleBadge {
  count: number;
  /** what the number means, for screen readers ("2 waiting for approval") */
  label: string;
}

export type ConsoleBadges = Record<string, ConsoleBadge | undefined>;

export const ConsoleBadgesContext = createContext<(path: string, badge: ConsoleBadge | null) => void>(() => {});

/** Shows `count` on the menu item for `path` (none while null or 0). */
export function useConsoleBadge(path: string, count: number | null | undefined, label: (n: number) => string) {
  const publish = useContext(ConsoleBadgesContext);
  const text = count ? label(count) : '';
  useEffect(() => {
    if (count == null) return;
    publish(path, count > 0 ? { count, label: text } : null);
  }, [publish, path, count, text]);
}
