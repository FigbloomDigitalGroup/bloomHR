import type { EmailLevel } from '../../lib/notificationPreferences';

/** One email category's level: a label and a dropdown (FIG-890). */
export default function LevelSelect({ label, value, options, disabled, onChange }: {
  label: string;
  value: EmailLevel;
  options: { id: EmailLevel; label: string }[];
  disabled?: boolean;
  onChange: (level: EmailLevel) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="font-semibold">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as EmailLevel)}
        className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
