import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SearchInput } from '../UI';
import { usePermissions } from '../../hooks/usePermissions';
import { searchScreens } from '../../lib/routeModules';

/**
 * The header search: finds the screens this person can open (the same list as the menu, routeModules.ts), so it
 * never offers a screen their role does not give them.
 */
export default function ScreenSearch() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { hasPermission, loading } = usePermissions();
  const results = loading ? [] : searchScreens(query, hasPermission).slice(0, 8);

  const go = (path: string) => {
    setQuery('');
    setOpen(false);
    navigate(path);
  };

  return (
    <div className="relative">
      <SearchInput
        placeholder="Search Figbloom HR"
        aria-label="Search screens"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) go(results[0].path);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && query.trim() && (
        <ul role="listbox" aria-label="Screens" className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-tile border border-border bg-white py-1 shadow-lg">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">No screens match</li>
          ) : (
            results.map((s) => (
              <li key={s.path} role="option" aria-selected={false}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(s.path)}
                  className="w-full px-3 py-2 text-left text-xs text-ink hover:bg-background"
                >
                  {s.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
