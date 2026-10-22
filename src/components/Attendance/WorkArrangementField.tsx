import { WEEK_DAYS, WORK_ARRANGEMENT_HINT, WORK_ARRANGEMENT_LABEL, type WorkArrangement } from '../../lib/attendance';

/**
 * How someone works (migration 20261024100000), on the employee's profile: On-site (follows the company's clock-in
 * policy), Hybrid (from anywhere on the remote days chosen here), Remote or Field (from anywhere; field records where
 * they are). Only HR can change it; the database refuses anyone else.
 */
export default function WorkArrangementField({ arrangement, remoteDays, onChange, disabled = false }: {
  arrangement: WorkArrangement | null | undefined;
  remoteDays: number[] | null | undefined;
  onChange: (arrangement: WorkArrangement, remoteDays: number[]) => void;
  disabled?: boolean;
}) {
  const value: WorkArrangement = arrangement ?? 'on_site';
  const days = remoteDays ?? [];
  const toggle = (d: number) => onChange('hybrid', days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b));

  return (
    <div className="min-w-0 space-y-2">
      <label htmlFor="work-arrangement" className="block text-sm font-medium text-gray-700">Work arrangement</label>
      <select
        id="work-arrangement"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value as WorkArrangement;
          onChange(next, next === 'hybrid' ? (days.length ? days : [5]) : []);
        }}
      >
        {(Object.keys(WORK_ARRANGEMENT_LABEL) as WorkArrangement[]).map((a) => (
          <option key={a} value={a}>{WORK_ARRANGEMENT_LABEL[a]}</option>
        ))}
      </select>
      <p className="text-xs text-gray-500">{WORK_ARRANGEMENT_HINT[value]}</p>
      {value === 'hybrid' && (
        <fieldset>
          <legend className="text-xs font-medium text-gray-700 mb-1">Remote days</legend>
          <div className="flex flex-wrap gap-1.5">
            {WEEK_DAYS.map((d) => {
              const on = days.includes(d.iso);
              return (
                <button
                  key={d.iso}
                  type="button"
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() => toggle(d.iso)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border ${on ? 'bg-brand text-white border-brand' : 'bg-white text-gray-600 border-gray-300'}`}
                >
                  {d.short}
                </button>
              );
            })}
          </div>
          {days.length === 0 && <p role="alert" className="text-xs text-status-danger mt-1">Choose at least one remote day</p>}
        </fieldset>
      )}
    </div>
  );
}
