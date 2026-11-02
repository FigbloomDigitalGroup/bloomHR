import { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Button } from '../UI';

// The frame of the Figbloom console (src/lib/console.ts): Figbloom's own pages, without a company's sidebar, header
// or company switcher.

// Grouped by product: today the console sees only Figbloom HR (bloomHR's database); other products get their own
// group when they join the platform (ERP design 2.1, 7.2). The product's name shows only once there are two, so a
// lone "Figbloom HR" doesn't read as the console's name.
const NAV = [
  {
    product: 'Figbloom HR',
    items: [
      { label: 'Organisations', path: '/platform/organisations' },
      { label: 'Statutory rates', path: '/platform/rates' },
    ],
  },
];

interface ConsoleLayoutProps {
  email: string;
  onSignOut: () => void;
  children: ReactNode;
}

export default function ConsoleLayout({ email, onSignOut, children }: ConsoleLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col bg-page">
      <header className="bg-white border-b border-border">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-sm font-bold text-ink">Figbloom console</span>
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Console">
            {NAV.map((group) => (
              <div key={group.product} className="flex items-center gap-1">
                {NAV.length > 1 && (
                  <span className="pr-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{group.product}</span>
                )}
                {group.items.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive }) =>
                      `px-3 py-1.5 rounded-tile text-[12.5px] transition-colors ${
                        isActive ? 'bg-secondary text-ink font-semibold' : 'text-muted-foreground hover:text-ink'
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 min-w-0">
            <span className="text-xs text-muted-foreground truncate">{email}</span>
            <Button variant="secondary" onClick={onSignOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1 w-full max-w-6xl mx-auto p-4">{children}</main>
    </div>
  );
}
