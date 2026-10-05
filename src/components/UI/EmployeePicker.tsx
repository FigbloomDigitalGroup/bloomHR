import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, X } from 'lucide-react';
import { useEmployeeDirectory } from '../../hooks/useEmployeeDirectory';
import { DirectoryEmployee, employeeDetail, employeeLabel, matchEmployees } from '../../lib/employeeDirectory';

const MAX_RESULTS = 50;

interface EmployeePickerProps {
  /** Selected employee number ('' or null for none). */
  value: string | null | undefined;
  onChange: (employee: DirectoryEmployee | null) => void;
  id?: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  /** Show a clear (x) button once someone is selected. Default true. */
  clearable?: boolean;
  /** Restrict which employees can be chosen (e.g. exclude people already assigned). */
  filter?: (employee: DirectoryEmployee) => boolean;
  /**
   * Only these employee numbers can be chosen. Pass the list a screen already scoped to the user's
   * region/town so the picker never offers anyone that screen would not have. Omit for everyone.
   */
  allowedNumbers?: Array<string | number>;
  /** Shown when `value` is set but that person is not in the directory (older records). */
  fallbackLabel?: string;
  className?: string;
}

const initials = (e: DirectoryEmployee) =>
  `${e.firstName[0] || ''}${e.lastName[0] || e.middleName[0] || ''}`.toUpperCase() || '?';

/**
 * Type a name, ID, job title or branch and pick the person from a list (name, ID, job title, location).
 * The caller receives the whole employee, so it can store the ID, the name or both.
 */
export default function EmployeePicker({
  value,
  onChange,
  id,
  label,
  placeholder = 'Search by name or ID...',
  disabled = false,
  required = false,
  clearable = true,
  filter,
  allowedNumbers,
  fallbackLabel,
  className = '',
}: EmployeePickerProps) {
  const autoId = useId();
  const inputId = id || `employee-picker-${autoId}`;
  const listId = `${inputId}-list`;

  const { employees, loading, error } = useEmployeeDirectory();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // joined so a fresh array with the same contents each render does not rebuild the list
  const allowedKey = allowedNumbers ? allowedNumbers.map(String).join('|') : null;
  const pool = useMemo(() => {
    let list = employees;
    if (allowedKey !== null) {
      const allowed = new Set(allowedKey.split('|'));
      list = list.filter((e) => allowed.has(e.employeeNumber));
    }
    return filter ? list.filter(filter) : list;
  }, [employees, filter, allowedKey]);
  const selected = useMemo(
    () => (value ? employees.find((e) => e.employeeNumber === String(value)) || null : null),
    [employees, value]
  );
  const results = useMemo(() => matchEmployees(pool, query), [pool, query]);
  const shown = results.slice(0, MAX_RESULTS);

  const displayValue = open
    ? query
    : selected
      ? employeeLabel(selected)
      : value
        ? fallbackLabel || String(value)
        : '';

  const place = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ left: r.left, top: r.bottom + 4, width: r.width });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  // close when the user clicks anywhere outside the field and its list
  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      const t = ev.target as Node;
      if (wrapRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
      setQuery('');
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  // keep the highlighted row in view while arrowing through a long list
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, open]);

  const choose = (e: DirectoryEmployee) => {
    onChange(e);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (!open) setOpen(true);
      else setActiveIndex((i) => Math.min(i + 1, Math.max(shown.length - 1, 0)));
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (ev.key === 'Home' && open) {
      ev.preventDefault();
      setActiveIndex(0);
    } else if (ev.key === 'End' && open) {
      ev.preventDefault();
      setActiveIndex(Math.max(shown.length - 1, 0));
    } else if (ev.key === 'Enter') {
      if (open) {
        // never submit the surrounding form just to confirm a pick
        ev.preventDefault();
        if (shown[activeIndex]) choose(shown[activeIndex]);
      }
    } else if (ev.key === 'Escape' && open) {
      ev.preventDefault();
      ev.stopPropagation();
      setOpen(false);
      setQuery('');
    } else if (ev.key === 'Tab') {
      setOpen(false);
      setQuery('');
    }
  };

  const showClear = clearable && !disabled && (!!selected || !!value) && !open;

  const listbox =
    open && rect
      ? createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label || 'Employees'}
            style={{ position: 'fixed', left: rect.left, top: rect.top, width: rect.width, zIndex: 70 }}
            // The list lives in a portal outside whatever modal holds the field. Keep clicks on it from reaching
            // document-level "click outside to close" handlers, which would otherwise close that modal.
            onMouseDown={(ev) => ev.nativeEvent.stopPropagation()}
            className="m-0 p-1 list-none max-h-64 overflow-y-auto bg-white border border-border rounded-xl shadow-lg"
          >
            {loading && <li className="px-3 py-2 text-xs text-muted-foreground">Loading employees...</li>}
            {error && <li className="px-3 py-2 text-xs text-status-danger">Could not load employees: {error}</li>}
            {!loading && !error && shown.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">
                {query ? `No employees match "${query}"` : 'No employees to choose from'}
              </li>
            )}
            {shown.map((e, i) => {
              const isActive = i === activeIndex;
              const isSelected = selected?.employeeNumber === e.employeeNumber;
              return (
                <li
                  key={e.employeeNumber}
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(i)}
                  // mousedown (not click) so the input keeps focus and blur never closes the list first
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    choose(e);
                  }}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer ${
                    isActive ? 'bg-green-tint' : ''
                  }`}
                >
                  <div className="w-7 h-7 shrink-0 rounded-full bg-brand text-white flex items-center justify-center text-[10px] font-bold">
                    {initials(e)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-ink truncate">{e.fullName}</div>
                    <div className="text-[10.5px] text-muted-foreground truncate">{employeeDetail(e)}</div>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-brand shrink-0" strokeWidth={2.5} />}
                </li>
              );
            })}
            {results.length > MAX_RESULTS && (
              <li className="px-3 py-2 text-[11px] text-subtle">
                Showing {MAX_RESULTS} of {results.length} - keep typing to narrow it down
              </li>
            )}
          </ul>,
          document.body
        )
      : null;

  return (
    <div ref={wrapRef} className={className}>
      {label && (
        <label htmlFor={inputId} className="block text-[11px] font-semibold text-ink mb-1.5">
          {label}
          {required && <span className="text-status-danger"> *</span>}
        </label>
      )}
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          autoComplete="off"
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          value={displayValue}
          onFocus={() => {
            if (disabled) return;
            setOpen(true);
            setQuery('');
          }}
          onChange={(ev) => {
            setQuery(ev.target.value);
            if (!open) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            // option picks use mousedown+preventDefault, so a blur here is a real "left the field"
            setOpen(false);
            setQuery('');
          }}
          className="w-full px-3 py-2 pr-14 text-xs border border-border rounded-tile bg-white text-ink placeholder-subtle outline-none focus:border-brand transition-colors disabled:bg-secondary disabled:cursor-not-allowed"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {showClear && (
            <button
              type="button"
              aria-label="Clear selected employee"
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => {
                onChange(null);
                inputRef.current?.focus();
              }}
              className="p-0.5 rounded text-subtle hover:text-ink"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <ChevronDown className="w-3.5 h-3.5 text-subtle pointer-events-none" strokeWidth={2} />
        </div>
      </div>
      {listbox}
    </div>
  );
}
