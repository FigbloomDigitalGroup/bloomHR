import type { KeyboardEvent, ReactNode } from 'react';
import { panelId, tabId } from './tabIds';

// Tabs the way keyboard and screen-reader users expect (WAI-ARIA tabs pattern): one tab in the Tab order, arrow keys move
// between tabs and select them, Home and End jump to the ends. The panel belongs to the page that uses this, so it can
// lay its content out freely; tabIds.ts gives it the ids that connect the two.

interface TabListProps<U extends { id: string }> {
  label: string;
  prefix: string;
  tabs: readonly U[];
  active: U['id'];
  onSelect: (id: U['id']) => void;
  className?: string;
  tabClassName: (active: boolean) => string;
  children: (tab: U, active: boolean) => ReactNode;
}

export function TabList<U extends { id: string }>({ label, prefix, tabs, active, onSelect, className = '', tabClassName, children }: TabListProps<U>) {
  const move = (to: number) => {
    const next = tabs[(to + tabs.length) % tabs.length];
    onSelect(next.id);
    document.getElementById(tabId(prefix, next.id))?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // the browser's own shortcuts stay the browser's: Alt+Left is "back", Ctrl+Home is "top of the page"
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const at = tabs.findIndex((t) => t.id === active);
    // the tabs lie in a row, so Up and Down are left to scroll the page
    const keys: Record<string, number> = {
      ArrowRight: at + 1,
      ArrowLeft: at - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    move(keys[event.key]);
  };

  return (
    <div role="tablist" aria-label={label} className={className} onKeyDown={onKeyDown}>
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={tabId(prefix, tab.id)}
            aria-selected={selected}
            // only the open tab's panel is in the page, so only that tab points at one
            aria-controls={selected ? panelId(prefix, tab.id) : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            className={tabClassName(selected)}
          >
            {children(tab, selected)}
          </button>
        );
      })}
    </div>
  );
}
