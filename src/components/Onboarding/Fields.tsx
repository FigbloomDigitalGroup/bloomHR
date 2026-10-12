import type { ReactNode } from 'react';

// Small form controls shared by the onboarding screens: a label, the control, and the problem with its value.

const inputClass = (error?: string | null) =>
  `w-full rounded-lg border px-3 py-2 text-sm text-ink bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-secondary disabled:text-muted-foreground ${
    error ? 'border-status-danger' : 'border-border'
  }`;

interface FieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}

export function Field({ label, required, hint, error, children }: FieldProps) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink mb-1">
        {label}
        {required && <span className="text-status-danger"> *</span>}
      </span>
      {children}
      {error ? (
        <span role="alert" className="block text-xs text-status-danger mt-1">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-muted-foreground mt-1">{hint}</span>
      ) : null}
    </label>
  );
}

interface TextFieldProps extends Omit<FieldProps, 'children'> {
  value: unknown;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'date' | 'tel';
  placeholder?: string;
  disabled?: boolean;
}

export function TextField({ value, onChange, type = 'text', placeholder, disabled, ...field }: TextFieldProps) {
  return (
    <Field {...field}>
      <input
        type={type}
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={Boolean(field.error)}
        className={inputClass(field.error)}
      />
    </Field>
  );
}

interface AmountFieldProps extends Omit<FieldProps, 'children'> {
  value: unknown;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}

/** A monthly amount in KSh; blank is saved as nothing. */
export function AmountField({ value, onChange, disabled, ...field }: AmountFieldProps) {
  return (
    <Field {...field}>
      <input
        type="number"
        min={0}
        step="0.01"
        inputMode="decimal"
        value={value === null || value === undefined || value === '' ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        disabled={disabled}
        aria-invalid={Boolean(field.error)}
        className={inputClass(field.error)}
      />
    </Field>
  );
}

interface SelectFieldProps extends Omit<FieldProps, 'children'> {
  value: unknown;
  options: readonly string[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function SelectField({ value, options, onChange, disabled, ...field }: SelectFieldProps) {
  return (
    <Field {...field}>
      <select
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={Boolean(field.error)}
        className={inputClass(field.error)}
      >
        <option value="">Choose…</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </Field>
  );
}

interface YesNoFieldProps extends Omit<FieldProps, 'children'> {
  value: boolean | null | undefined;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export function YesNoField({ value, onChange, disabled, ...field }: YesNoFieldProps) {
  const option = (v: boolean, text: string) => (
    <label className="inline-flex items-center gap-2 text-sm text-ink mr-5">
      <input type="radio" checked={value === v} onChange={() => onChange(v)} disabled={disabled} />
      {text}
    </label>
  );
  return (
    <Field {...field}>
      <div className="py-1">
        {option(true, 'Yes')}
        {option(false, 'No')}
      </div>
    </Field>
  );
}

export function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="border-t border-border pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">{children}</div>
    </section>
  );
}
