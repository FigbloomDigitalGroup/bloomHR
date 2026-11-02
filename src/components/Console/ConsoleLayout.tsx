import { ReactNode, useEffect, useRef, type MouseEvent } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LogOut, Menu, Users, X } from 'lucide-react';
import { ROLE_LABELS, type PlatformRole } from '../../lib/platformRoles';
import { useMobileNav } from '../Layout/useMobileNav';
import { onOverlayEntry } from '../../hooks/useBackToClose';

// The frame of the Figbloom console (src/lib/console.ts): Figbloom's own pages, without a company's sidebar, header
// or company switcher. A left sidebar (one section per product, then Staff and who is signed in at the bottom), and on
// a phone the same sidebar as a drawer behind a menu button (the company app's pattern: useMobileNav, which closes it
// on navigation and on the phone's Back).

export interface ConsoleNavGroup {
  product: string;
  items: { label: string; path: string }[];
}

// Grouped by product: Figbloom HR (bloomHR's database) and Figbloom Schools (its own, through bloomHR's backend:
// ERP/SCHOOLS_CONSOLE_CONTRACT.md); other products get their own group when they join the platform (ERP design 2.1,
// 7.2). The product's name shows only when there are two or more, so a lone group doesn't read as the console's name.
const CONSOLE_NAV: ConsoleNavGroup[] = [
  {
    product: 'Figbloom HR',
    items: [
      { label: 'Organisations', path: '/platform/organisations' },
      { label: 'Statutory rates', path: '/platform/rates' },
    ],
  },
  { product: 'Figbloom Schools', items: [{ label: 'Schools', path: '/platform/schools' }] },
];

// Figbloom's own, not one product's: at the bottom of the sidebar, above who is signed in
const PLATFORM_NAV = [{ label: 'Staff', path: '/platform/staff' }];

const SIDEBAR_ID = 'console-sidebar';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 min-h-9 px-3 rounded-[9px] text-[12.5px] transition-colors ${
    isActive ? 'bg-shell-active text-shell-active-fg font-semibold shadow-sm' : 'text-shell-fg/80 hover:bg-shell-fg/10 hover:text-shell-fg'
  }`;

interface ConsoleLayoutProps {
  email: string;
  /** the signed-in person's console role, shown under their email */
  role?: PlatformRole | null;
  onSignOut: () => void;
  children: ReactNode;
  /** the product sections (tests pass their own) */
  nav?: ConsoleNavGroup[];
}

export default function ConsoleLayout({ email, role, onSignOut, children, nav = CONSOLE_NAV }: ConsoleLayoutProps) {
  const { isMobile, open, openNav, closeNav } = useMobileNav();
  const navigate = useNavigate();
  const drawerOpen = isMobile && open;
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

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
        data-state={!isMobile ? 'docked' : drawerOpen ? 'open' : 'closed'}
        className={`fixed left-0 top-0 z-50 h-screen w-60 flex flex-col bg-shell text-shell-fg border-r border-shell-fg/5 shadow-2xl transition-[transform,visibility] duration-300 ${
          drawerOpen ? '' : 'max-md:-translate-x-full max-md:invisible'
        }`}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <span className="text-[15px] font-bold tracking-tight">Figbloom console</span>
          {isMobile && (
            <button ref={closeButtonRef} type="button" onClick={closeNav} aria-label="Close menu" className="p-1.5 rounded-lg hover:bg-shell-fg/10">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <nav aria-label="Console" className="flex-1 overflow-y-auto px-3 pb-4 space-y-5">
          {nav.map((group) => {
            const labelId = `console-nav-${group.product.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
            const labelled = nav.length > 1;
            return (
              <div key={group.product} role="group" aria-labelledby={labelled ? labelId : undefined} aria-label={labelled ? undefined : group.product}>
                {labelled && (
                  <p id={labelId} className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-shell-fg/50">
                    {group.product}
                  </p>
                )}
                <ul className="space-y-1">
                  {group.items.map((item) => (
                    <li key={item.path}>
                      <NavLink to={item.path} className={linkClass} onClick={follow(item.path)}>
                        {item.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-shell-fg/10 p-3 space-y-3">
          <nav aria-label="Figbloom">
            <ul className="space-y-1">
              {PLATFORM_NAV.map((item) => (
                <li key={item.path}>
                  <NavLink to={item.path} className={linkClass} onClick={follow(item.path)}>
                    <Users className="w-[15px] h-[15px]" aria-hidden="true" />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="rounded-xl bg-shell-fg/5 border border-shell-fg/10 p-2.5" aria-label="Signed in" role="group">
            <p className="text-xs font-semibold truncate" title={email}>{email}</p>
            {role && (
              <p className="mt-0.5 text-[11px] text-shell-fg/60" title="Your console role">
                {ROLE_LABELS[role]}
              </p>
            )}
            <button
              type="button"
              onClick={onSignOut}
              className="mt-2 w-full flex items-center justify-center gap-2 rounded-[9px] border border-shell-fg/15 px-3 py-1.5 text-[12px] font-semibold hover:bg-shell-fg/10"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <div className="md:pl-60">
        <main className="w-full max-w-6xl mx-auto p-4">{children}</main>
      </div>
    </div>
  );
}
