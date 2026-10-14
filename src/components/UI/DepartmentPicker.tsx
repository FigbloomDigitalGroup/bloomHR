import { useId, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useDepartments } from '../../hooks/useDepartments';
import { usePermissions } from '../../hooks/usePermissions';
import { Department, addDepartment, departmentTree, flatten } from '../../lib/orgStructure';

interface DepartmentPickerProps {
  /** Selected department id ('' or null for none). */
  value: string | null | undefined;
  onChange: (department: Department | null) => void;
  label?: string;
  disabled?: boolean;
  /** Shown when there is no department id but the employee has an old free-text department. */
  fallbackLabel?: string;
  className?: string;
}

const fieldClass =
  'w-full px-3 py-2 text-xs border border-border rounded-tile bg-white text-ink outline-none focus:border-brand transition-colors disabled:bg-secondary disabled:cursor-not-allowed';

/**
 * Pick one of the company's departments (sub-departments indented under their parent). HR can add a new one here
 * without leaving the form ("+ Add").
 */
export default function DepartmentPicker({ value, onChange, label = 'Department', disabled = false, fallbackLabel, className = '' }: DepartmentPickerProps) {
  const selectId = `department-${useId()}`;
  const { departments, loading, reload } = useDepartments();
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const canAdd = !permissionsLoading && hasPermission('employees');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // the active ones in tree order, plus the selected one even if it was deactivated since
  const options = useMemo(
    () => flatten(departmentTree(departments)).filter((n) => n.item.active || n.item.id === value),
    [departments, value]
  );

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      const made = await addDepartment(name);
      await reload();
      onChange(made);
      setAdding(false);
      setName('');
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-1.5">
        <label htmlFor={selectId} className="block text-[11px] font-semibold text-ink">{label}</label>
        {canAdd && !disabled && !adding && (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand hover:underline">
            <Plus className="w-3 h-3" strokeWidth={2.4} /> Add
          </button>
        )}
      </div>
      {adding ? (
        <div className="flex flex-wrap gap-2">
          <input
            autoFocus
            aria-label="New department name"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void save();
              } else if (e.key === 'Escape') {
                setAdding(false);
              }
            }}
            placeholder="New department"
            className={`${fieldClass} flex-1 min-w-[140px]`}
          />
          <button type="button" disabled={busy || !name.trim()} onClick={() => void save()} className="px-3 py-2 rounded-tile bg-brand text-white text-xs font-semibold disabled:opacity-50">
            {busy ? 'Adding...' : 'Add'}
          </button>
          <button type="button" onClick={() => { setAdding(false); setProblem(null); }} className="px-3 py-2 rounded-tile border border-border text-xs text-ink">
            Cancel
          </button>
          {problem && <p className="w-full m-0 text-[11px] text-status-danger" role="alert">{problem}</p>}
        </div>
      ) : (
        <select
          id={selectId}
          value={value || ''}
          disabled={disabled}
          onChange={(e) => onChange(departments.find((d) => d.id === e.target.value) || null)}
          className={fieldClass}
        >
          <option value="">{loading ? 'Loading...' : !value && fallbackLabel ? `${fallbackLabel} (not set up)` : 'No department'}</option>
          {options.map((n) => (
            <option key={n.item.id} value={n.item.id}>
              {`${'  '.repeat(n.depth)}${n.item.name}${n.item.active ? '' : ' (inactive)'}`}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
