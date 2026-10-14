import { Field, TextField } from '../Onboarding/Fields';
import { JobGroup, basicLabel, formatKsh, payFromGroup } from '../../lib/jobGroups';

// The job group on the add and edit employee pages. Choosing a group fills the basic salary and allowances from the
// group's current amounts (the database does the same when the employee is saved); HR may instead set this
// employee's pay by hand, with a reason.

const selectClass =
  'w-full rounded-lg border border-border px-3 py-2 text-sm text-ink bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-secondary disabled:text-muted-foreground';

interface Props {
  groups: JobGroup[];
  values: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  disabled?: boolean;
}

export default function JobGroupPicker({ groups, values, onChange, disabled }: Props) {
  const current = groups.find((g) => g.id === values.job_group_id) ?? null;
  // inactive groups can't be chosen, but an employee already on one keeps it
  const choices = groups.filter((g) => g.active || g.id === current?.id);
  const overridden = Boolean(values.pay_overridden);

  const choose = (id: string) => {
    const group = groups.find((g) => g.id === id);
    if (!group) {
      onChange({ job_group_id: null, 'Job Group': null, pay_overridden: false, pay_override_reason: null });
      return;
    }
    onChange({ job_group_id: group.id, 'Job Group': group.code, ...(overridden ? {} : payFromGroup(group, values['Basic Salary'])) });
  };

  const setOverride = (on: boolean) => {
    if (on) onChange({ pay_overridden: true });
    else onChange({ pay_overridden: false, pay_override_reason: null, ...(current ? payFromGroup(current, values['Basic Salary']) : {}) });
  };

  return (
    <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-6">
      <Field label="Job Group" hint={current ? undefined : 'Set up job groups and their pay in Settings'}>
        <select value={current?.id ?? ''} onChange={(e) => choose(e.target.value)} disabled={disabled} className={selectClass}>
          <option value="">No job group</option>
          {choices.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name !== g.code ? `${g.code} – ${g.name}` : g.code}
              {g.active ? '' : ' (inactive)'}
            </option>
          ))}
        </select>
      </Field>

      {current && (
        <div className="md:col-span-2 rounded-lg border border-border bg-secondary/40 p-3 text-xs text-ink">
          {current.effective_from ? (
            <p className="m-0" data-testid="job-group-amounts">
              Basic {basicLabel(current)} · House {formatKsh(current.house_allowance)} · Travel {formatKsh(current.travel_allowance)} · Other{' '}
              {formatKsh(current.other_allowances)}
            </p>
          ) : (
            <p className="m-0 text-muted-foreground">This group has no amounts yet; the pay below is as entered.</p>
          )}
          <label className="mt-2 flex items-center gap-2">
            <input type="checkbox" checked={overridden} onChange={(e) => setOverride(e.target.checked)} disabled={disabled} className="accent-brand" />
            Set this employee’s pay by hand (override the group)
          </label>
        </div>
      )}

      {current && overridden && (
        <div className="md:col-span-3">
          <TextField
            label="Reason for the override"
            required
            value={values.pay_override_reason}
            onChange={(v) => onChange({ pay_override_reason: v })}
            placeholder="e.g. Specialist skills agreed at hiring"
            error={!String(values.pay_override_reason ?? '').trim() ? 'Give a reason' : null}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}
