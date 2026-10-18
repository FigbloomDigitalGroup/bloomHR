import { useId, useMemo } from 'react';
import { useBranches } from '../../hooks/useBranches';
import { Branch } from '../../lib/branches';

interface BranchPickerProps {
  /** Selected branch id ('' or null: the default branch). */
  value: string | null | undefined;
  onChange: (branch: Branch | null) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

const fieldClass =
  'w-full px-3 py-2 text-xs border border-border rounded-tile bg-white text-ink outline-none focus:border-brand transition-colors disabled:bg-secondary disabled:cursor-not-allowed';

/**
 * Pick one of the company's branches (FIG-905): each is an office in a country, and holidays and the minimum wage
 * follow it. No choice means the default branch. Branches are set up in Settings → Branches.
 */
export default function BranchPicker({ value, onChange, label = 'Branch', disabled = false, className = '' }: BranchPickerProps) {
  const selectId = `branch-${useId()}`;
  const { branches, loading } = useBranches();
  const fallback = branches.find((b) => b.is_default);

  // the active ones (the default first), plus the selected one even if it was deactivated since
  const options = useMemo(
    () =>
      branches
        .filter((b) => b.active || b.id === value)
        .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name)),
    [branches, value]
  );

  return (
    <div className={className}>
      <label htmlFor={selectId} className="block text-[11px] font-semibold text-ink mb-1.5">{label}</label>
      <select
        id={selectId}
        value={value || ''}
        disabled={disabled}
        onChange={(e) => onChange(branches.find((b) => b.id === e.target.value) || null)}
        className={fieldClass}
      >
        <option value="">{loading ? 'Loading...' : fallback ? `Default (${fallback.name}, ${fallback.country})` : 'Default branch'}</option>
        {options.map((b) => (
          <option key={b.id} value={b.id}>
            {`${b.name} (${b.country})${b.active ? '' : ' (inactive)'}`}
          </option>
        ))}
      </select>
    </div>
  );
}
