import { ReactNode, useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Briefcase, Building2, ChevronDown, ChevronLeft, ChevronRight, GraduationCap, LayoutDashboard, LogOut, Menu, Percent,
  School, Users, X, type LucideIcon,
} from 'lucide-react';
import bloomMark from '../../../public/bloom-mark.png';
import { ROLE_LABELS, type PlatformRole } from '../../lib/platformRoles';
import { useMobileNav } from '../Layout/useMobileNav';
import { onOverlayEntry } from '../../hooks/useBackToClose';
import type { ConsoleBadges } from './consoleBadges';

// The frame of the Figbloom console (src/lib/console.ts): Figbloom's own pages, without a company's sidebar, header
// or company switcher. It follows Figbloom Schools' platform console (ConsoleShell there): a forest-green sidebar (the
// app's shell tokens: --shell is that green) with the Figbloom mark, "PLATFORM CONSOLE" and a collapse chevron; items
// with icons, the active one a white pill, count badges in orange; the account at the bottom. Here: Overview, then one
// collapsible section per product, then Staff and the account. On a desktop it folds down to icons; on a phone it is a
// drawer behind a menu button (the company app's useMobileNav, which closes it on navigation and on the phone's Back).
// Folded sections and the folded sidebar are remembered in this browser.

export interface ConsoleNavItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

export interface ConsoleNavGroup {
  product: string;
  /** the product's mark: an icon on a small coloured square */
  icon: LucideIcon;
  /** Tailwind classes for the mark (background and icon colour) */
  mark: string;
  items: ConsoleNavItem[];
}

// Grouped by product: Figbloom HR (bloomHR's database) and Figbloom Schools (its own, through bloomHR's backend:
// ERP/SCHOOLS_CONSOLE_CONTRACT.md); other products get their own group when they join the platform (ERP design 2.1,
// 7.2). The product's name shows only when there are two or more, so a lone group doesn't read as the console's name.
const CONSOLE_NAV: ConsoleNavGroup[] = [
  {
    product: 'Figbloom HR',
    icon: Briefcase,
    mark: 'bg-orange text-white',
    items: [
      { label: 'Organisations', path: '/platform/organisations', icon: Building2 },
      { label: 'Statutory rates', path: '/platform/rates', icon: Percent },
    ],
  },
  {
    product: 'Figbloom Schools',
    icon: GraduationCap,
    mark: 'bg-shell-active text-shell-active-fg',
    items: [{ label: 'Schools', path: '/platform/schools', icon: School }],
  },
];

// every product at a glance: first, above the products
const HOME_NAV: ConsoleNavItem[] = [{ label: 'Overview', path: '/platform/overview', icon: LayoutDashboard }];
// Figbloom's own, not one product's: at the bottom of the sidebar, above the account
const PLATFORM_NAV: ConsoleNavItem[] = [{ label: 'Staff', path: '/platform/staff', icon: Users }];

const SIDEBAR_ID = 'console-sidebar';
export const SECTIONS_KEY = 'figbloom.console.sections';
export const COLLAPSED_KEY = 'figbloom.console.sidebarCollapsed';

// localStorage can be blocked (private windows, storage settings): then nothing is remembered, and nothing breaks
function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // not remembered
  }
}

const initials = (email: string) => {
  const name = email.split('@')[0] ?? '';
  const parts = name.split(/[._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return (letters || '?').toUpperCase();
};

interface ConsoleLayoutProps {
  email: string;
  /** the signed-in person's console role, shown in the account card */
  role?: PlatformRole | null;
  onSignOut: () => void;
  children: ReactNode;
  /** count badges by page path (consoleBadges.ts) */
  badges?: ConsoleBadges;
  /** the product sections (tests pass their own) */
  nav?: ConsoleNavGroup[];
}

export default function ConsoleLayout({ email, role, onSignOut, children, badges = {}, nav = CONSOLE_NAV }: ConsoleLayoutProps) {
  const { isMobile, open, openNav, closeNav } = useMobileNav();
  const navigate = useNavigate();
  const drawerOpen = isMobile && open;
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // folded product sections ({ product: true }) and the folded sidebar, remembered in this browser
  const [folded, setFolded] = useState<Record<string, boolean>>(() => readJson<Record<string, boolean>>(SECTIONS_KEY, {}));
  const [collapsedPref, setCollapsedPref] = useState<boolean>(() => readJson<boolean>(COLLAPSED_KEY, false) === true);
  // the phone drawer always shows everything
  const collapsed = collapsedPref && !isMobile;

  const toggleSection = useCallback((product: string) => {
    setFolded((prev) => {
      const next = { ...prev, [product]: !prev[product] };
      writeJson(SECTIONS_KEY, next);
      return next;
    });
  }, []);
  const toggleCollapsed = useCallback(() => {
    setCollapsedPref((prev) => {
      writeJson(COLLAPSED_KEY, !prev);
      return !prev;
    });
  }, []);

  // the drawer takes focus when it opens and gives it back to the menu button when it closes; Escape closes it
  useEffect(() => {
    if (drawerOpen) {
      wasOpen.current = true;
      closeButtonRef.current?.focus();
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') closeNav();
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      menuButtonRef.current?.focus();
    }
  }, [drawerOpen, closeNav]);

  // in the drawer, a link replaces the drawer's own history entry (as in the company app), so Back goes to the page
  // before rather than reopening the menu; useMobileNav closes the drawer once the page changes
  const follow = (path: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (!drawerOpen || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(path, { replace: onOverlayEntry() });
  };

  const link = (item: ConsoleNavItem) => {
    const Icon = item.icon;
    const badge = badges[item.path];
    return (
      <NavLink
        to={item.path}
        onClick={follow(item.path)}
        // folded to icons, the name is the tooltip (the label stays for screen readers)
        title={collapsed ? (badge ? `${item.label} (${badge.label})` : item.label) : undefined}
        className={({ isActive }) =>
          `relative flex items-center gap-3 h-[38px] rounded-[9px] px-2.5 overflow-hidden whitespace-nowrap text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-shell-fg/60 ${
            collapsed ? 'justify-center' : ''
          } ${isActive ? 'bg-shell-active text-shell-active-fg font-semibold' : 'text-shell-fg/75 hover:bg-shell-fg/10 hover:text-shell-fg'}`
        }
      >
        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span className={collapsed ? 'sr-only' : 'flex-1 truncate'}>{item.label}</span>
        {badge && (
          <>
            <span
              className={`rounded-full bg-orange px-1.5 font-mono text-[10px] leading-[16px] text-white ${collapsed ? 'absolute top-1 right-1' : ''}`}
              aria-hidden="true"
            >
              {badge.count}
            </span>
            <span className="sr-only">({badge.label})</span>
          </>
        )}
      </NavLink>
    );
  };

  const labelled = nav.length > 1;

  return (
    <div className="min-h-screen bg-page">
      {/* phones and narrow screens: a slim bar with the menu button */}
      <header className="md:hidden sticky top-0 z-30 flex items-center gap-2 h-12 px-3 bg-shell text-shell-fg border-b border-shell-fg/10">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={openNav}
          aria-label="Open menu"
          aria-expanded={drawerOpen}
          aria-controls={SIDEBAR_ID}
          className="p-2 rounded-lg hover:bg-shell-fg/10"
        >
          <Menu className="w-5 h-5" />
        </button>
        <span className="text-sm font-bold">Figbloom console</span>
      </header>

      {drawerOpen && (
        <div data-testid="console-sidebar-backdrop" className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={closeNav} aria-hidden="true" />
      )}

      {/* below md the sidebar slides off-screen (and out of the tab order) until the menu button opens it */}
      <aside
        id={SIDEBAR_ID}
        aria-label="Console menu"
        role={isMobile ? 'dialog' : undefined}
        aria-modal={drawerOpen ? true : undefined}
        data-state={!isMobile ? (collapsed ? 'collapsed' : 'docked') : drawerOpen ? 'open' : 'closed'}
        className={`fixed left-0 top-0 z-50 h-screen flex flex-col bg-shell text-shell-fg px-3 py-4 shadow-2xl transition-[transform,visibility,width] duration-150 ${
          collapsed ? 'w-[68px]' : 'w-56'
        } ${drawerOpen ? '' : 'max-md:-translate-x-full max-md:invisible'}`}
      >
        {/* the Figbloom mark, the console's name, and the collapse chevron */}
        <div className={`flex min-h-[34px] shrink-0 items-center gap-3 px-0.5 pb-2 ${collapsed ? 'flex-col' : ''}`}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-white p-1">
            <img src={bloomMark} alt="Figbloom" className="h-full w-full object-contain" />
          </span>
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14.5px] font-semibold tracking-tight">Figbloom</span>
              <span className="block truncate font-mono text-[8.5px] tracking-[0.1em] text-shell-fg/50">PLATFORM CONSOLE</span>
            </span>
          )}
          {isMobile ? (
            <button ref={closeButtonRef} type="button" onClick={closeNav} aria-label="Close menu"
              className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-md text-shell-fg/60 hover:bg-shell-fg/10">
              <X className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-pressed={collapsed}
              aria-controls={SIDEBAR_ID}
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-md text-shell-fg/60 hover:bg-shell-fg/10 ${collapsed ? '' : 'ml-auto'}`}
            >
              {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>

        <nav aria-label="Console" className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 pb-3">
          <ul className="space-y-0.5">
            {HOME_NAV.map((item) => (
              <li key={item.path}>{link(item)}</li>
            ))}
          </ul>
          {nav.map((group) => {
            const slug = group.product.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            const listId = `console-nav-${slug}`;
            // folded to icons, every section shows its pages
            const isFolded = labelled && !collapsed && !!folded[group.product];
            const Mark = group.icon;
            return (
              <div key={group.product} role="group" aria-label={group.product}>
                {labelled && !collapsed && (
                  <button
                    type="button"
                    onClick={() => toggleSection(group.product)}
                    aria-expanded={!isFolded}
                    aria-controls={listId}
                    className="mb-0.5 flex w-full items-center gap-2 rounded-md px-2.5 py-1 text-left hover:bg-shell-fg/5"
                  >
                    <span className={`grid h-4 w-4 shrink-0 place-items-center rounded ${group.mark}`} aria-hidden="true">
                      <Mark className="h-2.5 w-2.5" />
                    </span>
                    <span className="flex-1 truncate font-mono text-[9.5px] uppercase tracking-[0.1em] text-shell-fg/55">{group.product}</span>
                    <ChevronDown className={`h-3 w-3 text-shell-fg/40 transition-transform ${isFolded ? '-rotate-90' : ''}`} aria-hidden="true" />
                  </button>
                )}
                {labelled && collapsed && (
                  <span className={`mx-auto mb-1 grid h-4 w-4 place-items-center rounded ${group.mark}`} title={group.product} aria-hidden="true">
                    <Mark className="h-2.5 w-2.5" />
                  </span>
                )}
                <ul id={listId} className="space-y-0.5" hidden={isFolded}>
                  {group.items.map((item) => (
                    <li key={item.path}>{link(item)}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="shrink-0 space-y-2 border-t border-shell-fg/10 pt-2">
          <nav aria-label="Figbloom">
            <ul className="space-y-0.5">
              {PLATFORM_NAV.map((item) => (
                <li key={item.path}>{link(item)}</li>
              ))}
            </ul>
          </nav>
          <div role="group" aria-label="Signed in" className={`flex items-center gap-3 rounded-[9px] px-0.5 py-1.5 ${collapsed ? 'flex-col' : ''}`}>
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-shell-fg/15 text-[11px] font-semibold text-shell-fg"
              aria-hidden="true"
              title={collapsed ? email : undefined}
            >
              {initials(email)}
            </span>
            <span className={collapsed ? 'sr-only' : 'min-w-0 flex-1 leading-tight'}>
              <span className="block truncate text-[12.5px]" title={email}>{email}</span>
              {role && (
                <span className="block font-mono text-[8.5px] uppercase tracking-[0.08em] text-shell-fg/50" title="Your console role">
                  {ROLE_LABELS[role]}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={onSignOut}
              aria-label="Sign out"
              title="Sign out"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-shell-fg/60 hover:bg-shell-fg/10 hover:text-shell-fg"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      <div className={collapsed ? 'md:pl-[68px]' : 'md:pl-56'}>
        <main className="w-full max-w-6xl mx-auto p-4">{children}</main>
      </div>
    </div>
  );
}
